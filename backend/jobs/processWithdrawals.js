const Withdrawal = require('../models/Withdrawal');
const withdrawalService = require('../services/withdrawalService');
const alertService = require('../services/alertService');

/**
 * Process Withdrawals Cron Job (WITH BATCHING + RETRY LOGIC)
 * 
 * Processes pending withdrawal requests for tutors
 * Runs every 5 minutes to ensure timely payouts
 * 
 * SCALABILITY FEATURES:
 * - Processes in batches of 50
 * - Max 500 per run (prevents overload)
 * - Automatic retry with exponential backoff
 * - Tracks failed attempts
 * - Admin alerts after 3 failures
 * 
 * Schedule: Every 5 minutes (*\/5 * * * *)
 */

// Configuration
const BATCH_SIZE = 50; // Process 50 withdrawals at a time
const MAX_PER_RUN = 500; // Maximum withdrawals to process in a single run
const MAX_ATTEMPTS = 3; // Give up after 3 failed attempts

async function processWithdrawals() {
  console.log('\n========================================');
  console.log('💸 [CRON] Process Withdrawals Job Started');
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log(`   Batch Size: ${BATCH_SIZE}, Max Per Run: ${MAX_PER_RUN}`);
  console.log('========================================\n');
  
  const now = new Date();
  let totalProcessed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  
  try {
    // Process in batches
    while (totalProcessed < MAX_PER_RUN) {
      // Find withdrawals that are:
      // 1. Pending status
      // 2. Haven't failed too many times
      // 3. Are past their retry time (if they failed before)
      const pendingWithdrawals = await Withdrawal.find({
        status: 'pending',
        retryCount: { $lt: MAX_ATTEMPTS },
        $or: [
          { nextRetryAt: { $exists: false } }, // Never tried
          { nextRetryAt: null }, // Never tried
          { nextRetryAt: { $lte: now } } // Retry time has passed
        ]
      })
      .populate('tutorId', 'name email')
      .limit(BATCH_SIZE)
      .sort({ requestedAt: 1 }); // Process oldest first
      
      // If no withdrawals found, we're done
      if (pendingWithdrawals.length === 0) {
        console.log('✅ No pending withdrawals at this time\n');
        break;
      }
      
      console.log(`\n📦 Processing batch of ${pendingWithdrawals.length} withdrawals...`);
      
      // Process each withdrawal with retry tracking
      for (const withdrawal of pendingWithdrawals) {
        try {
          const tutor = withdrawal.tutorId;
          
          if (!tutor) {
            throw new Error(`Withdrawal ${withdrawal._id} has no associated tutor`);
          }
          
          console.log(`💸 Processing withdrawal ${withdrawal._id} for ${tutor.name}: $${withdrawal.amount.toFixed(2)} via ${withdrawal.method}`);
          
          // Call the withdrawal service to process
          await withdrawalService.processWithdrawal(withdrawal._id);
          
          // SUCCESS: Reset retry tracking
          withdrawal.retryCount = 0;
          withdrawal.nextRetryAt = null;
          withdrawal.errorMessage = null;
          await withdrawal.save();
          
          console.log(`✅ Withdrawal ${withdrawal._id} processed successfully`);
          totalProcessed++;
          
        } catch (error) {
          // FAILURE: Track and schedule retry
          withdrawal.retryCount = (withdrawal.retryCount || 0) + 1;
          withdrawal.errorMessage = error.message;
          
          // Exponential backoff: 5min, 15min, 1hr
          const backoffMinutes = Math.pow(2, withdrawal.retryCount) * 5;
          withdrawal.nextRetryAt = new Date(now.getTime() + backoffMinutes * 60 * 1000);
          
          // If max attempts reached, mark as failed
          if (withdrawal.retryCount >= MAX_ATTEMPTS) {
            withdrawal.status = 'failed';
            withdrawal.failedAt = new Date();
          }
          
          await withdrawal.save();
          
          totalFailed++;
          console.error(`❌ Withdrawal ${withdrawal._id} failed (attempt ${withdrawal.retryCount}/${MAX_ATTEMPTS}): ${error.message}`);
          
          // Alert admin if max attempts reached
          if (withdrawal.retryCount >= MAX_ATTEMPTS) {
            await alertService.createAlert({
              type: 'WITHDRAWAL_FAILED',
              severity: 'HIGH',
              title: `Withdrawal Failed After ${MAX_ATTEMPTS} Attempts`,
              description: `Withdrawal ${withdrawal._id} for tutor ${withdrawal.tutorId?.name} failed after ${MAX_ATTEMPTS} attempts. Amount: $${withdrawal.amount}. Last error: ${error.message}`,
              data: {
                withdrawalId: withdrawal._id,
                tutorId: withdrawal.tutorId?._id,
                tutorName: withdrawal.tutorId?.name,
                tutorEmail: withdrawal.tutorId?.email,
                amount: withdrawal.amount,
                method: withdrawal.method,
                error: error.message,
                attempts: withdrawal.retryCount
              }
            });
          }
        }
      }
      
      // If we got less than BATCH_SIZE, we've processed everything
      if (pendingWithdrawals.length < BATCH_SIZE) {
        console.log(`\n✅ Processed all available withdrawals (batch was not full)`);
        break;
      }
      
      // Safety check: if we've processed MAX_PER_RUN, stop
      if (totalProcessed >= MAX_PER_RUN) {
        console.log(`\n⚠️  Reached max per run limit (${MAX_PER_RUN}), stopping`);
        break;
      }
    }
    
    console.log('\n========================================');
    console.log(`✅ [CRON] Process Withdrawals Job Completed`);
    console.log(`   ✅ Processed: ${totalProcessed} withdrawals`);
    console.log(`   ❌ Failed: ${totalFailed} withdrawals`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log('========================================\n');
    
    return {
      success: true,
      totalProcessed,
      totalFailed
    };
    
  } catch (error) {
    console.error('\n❌ [CRON] Process Withdrawals Job Failed:', error.message);
    console.error(error.stack);
    
    // Create critical alert for job-level failure
    await alertService.createAlert({
      type: 'CRON_JOB_FAILED',
      severity: 'CRITICAL',
      title: 'Process Withdrawals Job Failed',
      description: `The process withdrawals cron job failed completely. Error: ${error.message}`,
      data: {
        jobName: 'processWithdrawals',
        error: error.message,
        stack: error.stack,
        processedBeforeFailure: totalProcessed
      }
    });
    
    throw error;
  }
}

module.exports = { processWithdrawals };
