const Payment = require('../models/Payment');
const User = require('../models/User');
const Notification = require('../models/Notification');
const alertService = require('../services/alertService');

/**
 * Release Earnings Cron Job (WITH BATCHING + RETRY LOGIC)
 * 
 * Runs every 5 minutes to check for tutor earnings that have passed the 1-hour hold period
 * and moves them from pendingBalance to availableBalance.
 * 
 * SCALABILITY FEATURES:
 * - Processes in batches of 100
 * - Max 1000 per run (prevents overload)
 * - Automatic retry with exponential backoff
 * - Tracks failed attempts
 * - Admin alerts after 3 failures
 * 
 * Schedule: Every hour at :20 minutes (20 * * * *)
 */

// Configuration
const BATCH_SIZE = 100; // Process 100 payments at a time
const MAX_PER_RUN = 1000; // Maximum payments to process in a single run
const MAX_ATTEMPTS = 3; // Give up after 3 failed attempts

async function releaseEarnings(io = null) {
  console.log('\n========================================');
  console.log('🔄 [CRON] Release Earnings Job Started');
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log(`   Batch Size: ${BATCH_SIZE}, Max Per Run: ${MAX_PER_RUN}`);
  console.log('========================================\n');
  
  const now = new Date();
  let totalProcessed = 0;
  let totalFailed = 0;
  let totalSkipped = 0; // Paused or already processing
  const tutorsToNotify = new Map(); // tutorId -> { totalReleased, paymentCount }
  
  try {
    // Process in batches
    while (totalProcessed < MAX_PER_RUN) {
      // Find payments that are:
      // 1. On hold and past release date
      // 2. Haven't failed too many times
      // 3. Are past their retry time (if they failed before)
      // 4. NOT refunded or partially refunded (NEW)
      const paymentsToRelease = await Payment.find({
        transferStatus: 'on_hold',
        earningsReleaseDate: { $lte: now },
        status: { $nin: ['refunded', 'partially_refunded', 'cancelled'] }, // Skip refunded/cancelled payments
        $or: [
          { processingAttempts: { $exists: false } }, // Field doesn't exist yet (NEW)
          { processingAttempts: { $lt: MAX_ATTEMPTS } } // Less than max attempts
        ],
        $and: [ // nextRetryAt conditions
          {
            $or: [
              { nextRetryAt: { $exists: false } }, // Never tried
              { nextRetryAt: null }, // Never tried
              { nextRetryAt: { $lte: now } } // Retry time has passed
            ]
          }
        ]
      })
      .populate('tutorId', 'name email auth0Id tutorEarnings withdrawalSettings')
      .populate('lessonId', 'payoutPaused underInvestigation issueType')
      .limit(BATCH_SIZE)
      .sort({ earningsReleaseDate: 1 }); // Process oldest first
      
      // If no payments found, we're done
      if (paymentsToRelease.length === 0) {
        console.log('✅ No more payments to release at this time\n');
        break;
      }
      
      console.log(`\n📦 Processing batch of ${paymentsToRelease.length} payments...`);
      
      // Filter out payments with paused payouts
      const releasablePayments = paymentsToRelease.filter(payment => {
        if (payment.lessonId?.payoutPaused) {
          console.log(`⏸️  Skipping payment ${payment._id} - payout paused (lesson under investigation)`);
          totalSkipped++;
          return false;
        }
        return true;
      });
      
      console.log(`   ${releasablePayments.length} releasable (${paymentsToRelease.length - releasablePayments.length} paused)`);
      
      // Process each payment with retry tracking
      for (const payment of releasablePayments) {
        try {
          // SAFETY: Re-fetch payment to ensure it's still on_hold (prevent race conditions)
          const freshPayment = await Payment.findById(payment._id);
          if (!freshPayment || freshPayment.transferStatus !== 'on_hold') {
            console.log(`⏭️  Skipping payment ${payment._id} - status already changed to "${freshPayment?.transferStatus}"`);
            continue;
          }
          
          const tutor = payment.tutorId;
          
          if (!tutor) {
            throw new Error(`Payment ${payment._id} has no associated tutor`);
          }
          
          console.log(`💰 Releasing $${payment.tutorPayout.toFixed(2)} for tutor ${tutor.name} (${tutor._id})`);
          
          // Ensure tutorEarnings exists (migration support)
          if (!tutor.tutorEarnings) {
            tutor.tutorEarnings = {
              availableBalance: 0,
              pendingBalance: 0,
              lifetimeEarnings: 0,
              lastWithdrawal: null,
              totalWithdrawn: 0
            };
          }
          
          // Move from pending to available and count toward lifetime
          // lifetimeEarnings only reflects confirmed earnings (not pending/on_hold)
          tutor.tutorEarnings.pendingBalance -= payment.tutorPayout;
          tutor.tutorEarnings.availableBalance += payment.tutorPayout;
          tutor.tutorEarnings.lifetimeEarnings += payment.tutorPayout;
          await tutor.save();
          
          // Update payment status
          payment.transferStatus = 'available';
          
          // SUCCESS: Reset retry tracking
          payment.processingAttempts = 0;
          payment.lastProcessingError = null;
          payment.nextRetryAt = null;
          await payment.save();
          
          console.log(`✅ Released $${payment.tutorPayout.toFixed(2)} to ${tutor.name}`);
          console.log(`   New Available: $${tutor.tutorEarnings.availableBalance.toFixed(2)}`);
          console.log(`   New Pending: $${tutor.tutorEarnings.pendingBalance.toFixed(2)}`);
          
          totalProcessed++;
          
          // Track for notification batching
          const tutorData = tutorsToNotify.get(tutor._id.toString()) || { 
            tutor,
            totalReleased: 0, 
            paymentCount: 0 
          };
          tutorData.totalReleased += payment.tutorPayout;
          tutorData.paymentCount++;
          tutorsToNotify.set(tutor._id.toString(), tutorData);
          
        } catch (error) {
          // FAILURE: Track and schedule retry
          payment.processingAttempts = (payment.processingAttempts || 0) + 1;
          payment.lastProcessingError = error.message;
          
          // Exponential backoff: 5min, 15min, 1hr
          const backoffMinutes = Math.pow(2, payment.processingAttempts) * 5;
          payment.nextRetryAt = new Date(now.getTime() + backoffMinutes * 60 * 1000);
          
          await payment.save();
          
          totalFailed++;
          console.error(`❌ Failed (attempt ${payment.processingAttempts}/${MAX_ATTEMPTS}): ${error.message}`);
          
          // Alert admin if max attempts reached
          if (payment.processingAttempts >= MAX_ATTEMPTS) {
            await alertService.createAlert({
              type: 'PAYMENT_PROCESSING_FAILED',
              severity: 'HIGH',
              title: `Release Earnings Failed After ${MAX_ATTEMPTS} Attempts`,
              description: `Payment ${payment._id} failed to release after ${MAX_ATTEMPTS} attempts. Last error: ${error.message}`,
              paymentId: payment._id,
              data: {
                tutorId: payment.tutorId?._id,
                tutorName: payment.tutorId?.name,
                amount: payment.tutorPayout,
                error: error.message,
                attempts: payment.processingAttempts
              }
            });
          }
        }
      }
      
      // If we got less than BATCH_SIZE, we've processed everything
      if (paymentsToRelease.length < BATCH_SIZE) {
        console.log(`\n✅ Processed all available payments (batch was not full)`);
        break;
      }
      
      // Safety check: if we've processed MAX_PER_RUN, stop
      if (totalProcessed >= MAX_PER_RUN) {
        console.log(`\n⚠️  Reached max per run limit (${MAX_PER_RUN}), stopping`);
        break;
      }
    }
    
    // Send batch notifications to tutors
    if (tutorsToNotify.size > 0) {
      console.log(`\n📬 Sending ${tutorsToNotify.size} batch notifications...`);
      
      for (const [tutorId, data] of tutorsToNotify) {
        try {
          const { tutor, totalReleased, paymentCount } = data;
          
          // SAFETY: Check if we already sent a similar notification in the last 5 minutes
          // This prevents duplicate notifications if the cron job runs twice
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
          const recentNotification = await Notification.findOne({
            userId: tutor._id,
            type: 'payment_received',
            createdAt: { $gte: fiveMinutesAgo },
            'data.amount': totalReleased,
            'data.paymentCount': paymentCount
          });
          
          if (recentNotification) {
            console.log(`⏭️  Skipping notification for ${tutor.name} - similar notification sent recently`);
            continue;
          }
          
          // Create notification
          const paymentText = paymentCount === 1 ? 'payment' : 'payments';
          const notification = new Notification({
            userId: tutor._id,
            type: 'payment_received',
            title: '💵 Earnings Now Available',
            message: `<strong>$${totalReleased.toFixed(2)}</strong> from ${paymentCount} ${paymentText} is now available for withdrawal.`,
            link: '/tabs/home/earnings',
            data: {
              amount: totalReleased,
              paymentCount,
              availableBalance: tutor.tutorEarnings.availableBalance
            }
          });
          await notification.save();
          
          console.log(`✅ Notification sent to ${tutor.name}`);
          
          // Send real-time WebSocket notification
          if (io) {
            const { getUserSocketId } = require('../socket/socketManager');
            const tutorSocketId = await getUserSocketId(tutor.auth0Id);
            
            if (tutorSocketId) {
              io.to(tutorSocketId).emit('earnings_available', {
                notificationId: notification._id.toString(),
                title: notification.title,
                message: notification.message,
                amount: totalReleased,
                paymentCount,
                availableBalance: tutor.tutorEarnings.availableBalance
              });
              console.log(`🔔 Real-time notification sent to ${tutor.name}`);
            }
          }
          
        } catch (error) {
          console.error(`❌ Failed to notify tutor ${tutorId}:`, error.message);
        }
      }
    }
    
    console.log('\n========================================');
    console.log(`✅ [CRON] Release Earnings Job Completed`);
    console.log(`   ✅ Processed: ${totalProcessed} payments`);
    console.log(`   ❌ Failed: ${totalFailed} payments`);
    console.log(`   ⏸️  Skipped: ${totalSkipped} payments (paused)`);
    console.log(`   📬 Tutors Notified: ${tutorsToNotify.size}`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log('========================================\n');
    
    return {
      success: true,
      totalProcessed,
      totalFailed,
      totalSkipped,
      tutorsNotified: tutorsToNotify.size
    };
    
  } catch (error) {
    console.error('\n❌ [CRON] Release Earnings Job Failed:', error.message);
    console.error(error.stack);
    
    // Create critical alert for job-level failure
    await alertService.createAlert({
      type: 'CRON_JOB_FAILED',
      severity: 'CRITICAL',
      title: 'Release Earnings Job Failed',
      description: `The release earnings cron job failed completely. Error: ${error.message}`,
      data: {
        jobName: 'releaseEarnings',
        error: error.message,
        stack: error.stack,
        processedBeforeFailure: totalProcessed
      }
    });
    
    throw error;
  }
}

/**
 * Helper function to manually trigger the job (for testing)
 */
async function triggerManualRelease() {
  console.log('🔧 Manual trigger of release earnings job');
  return await releaseEarnings();
}

module.exports = {
  releaseEarnings,
  triggerManualRelease
};
