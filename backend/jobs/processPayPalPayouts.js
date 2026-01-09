/**
 * Process PayPal Payouts Cron Job
 * 
 * This job runs every hour to check Stripe payout statuses and send PayPal payouts
 * when funds have arrived in the platform's bank account.
 * 
 * Flow:
 * 1. Find payments with transferStatus = 'awaiting_funds'
 * 2. Check Stripe payout status
 * 3. If payout is 'paid' (arrived in bank), send PayPal payout
 * 4. Update payment record
 */

const Payment = require('../models/Payment');
const Lesson = require('../models/Lesson');
const User = require('../models/User');
const stripeService = require('../services/stripeService');
const paypalService = require('../services/paypalService');
const Notification = require('../models/Notification');

async function processPayPalPayouts() {
  console.log('\n🔄 [CRON] Starting PayPal payout processing job...');

  try {
    // Find all payments awaiting Stripe payout completion
    const pendingPayments = await Payment.find({
      transferStatus: 'awaiting_funds',
      stripePayoutId: { $exists: true, $ne: null }
    })
      .populate('lessonId')
      .populate('tutorId')
      .limit(50); // Process in batches

    if (pendingPayments.length === 0) {
      console.log('✅ No pending PayPal payouts to process');
      return;
    }

    console.log(`📋 Found ${pendingPayments.length} payment(s) awaiting Stripe payout completion`);

    let processed = 0;
    let paypalSent = 0;
    let stillPending = 0;
    let failed = 0;

    for (const payment of pendingPayments) {
      try {
        const lessonId = payment.lessonId._id;
        const tutor = payment.tutorId;

        console.log(`\n💳 Processing payment ${payment._id} for lesson ${lessonId}`);
        console.log(`   Stripe Payout ID: ${payment.stripePayoutId}`);
        console.log(`   Current Status: ${payment.stripePayoutStatus}`);

        // Check Stripe payout status
        const stripePayout = await stripeService.getPayout(payment.stripePayoutId);
        
        console.log(`   Updated Stripe Status: ${stripePayout.status}`);
        console.log(`   Arrival Date: ${stripePayout.arrival_date ? new Date(stripePayout.arrival_date * 1000).toISOString() : 'N/A'}`);

        // Update payment with latest payout status
        payment.stripePayoutStatus = stripePayout.status;

        if (stripePayout.status === 'paid') {
          // Funds have arrived in bank! Send PayPal payout now
          console.log(`🎉 Stripe payout ${stripePayout.id} has been paid - sending PayPal payout...`);
          
          payment.stripePayoutArrivedAt = new Date(stripePayout.arrival_date * 1000);

          const paypalEmail = tutor.payoutDetails?.paypalEmail;
          if (!paypalEmail) {
            console.error(`❌ No PayPal email for tutor ${tutor._id}`);
            payment.transferStatus = 'failed';
            payment.errorMessage = 'PayPal email not configured';
            await payment.save();
            failed++;
            continue;
          }

          if (!paypalService.isAvailable()) {
            console.error(`❌ PayPal service not configured`);
            payment.transferStatus = 'failed';
            payment.errorMessage = 'PayPal service not available';
            await payment.save();
            failed++;
            continue;
          }

          // Send PayPal payout
          try {
            const lesson = payment.lessonId;
            const studentName = lesson.studentId?.firstName 
              ? `${lesson.studentId.firstName} ${(lesson.studentId.lastName || '').charAt(0)}.`
              : 'a student';

            const payoutResult = await paypalService.sendPayout({
              tutorId: tutor._id.toString(),
              paypalEmail: paypalEmail,
              amount: payment.stripePayoutAmount, // Use the same amount as Stripe payout
              lessonId: lessonId.toString(),
              note: `Payment for lesson with ${studentName}`
            });

            payment.paypalBatchId = payoutResult.batchId;
            payment.paypalPayoutItemId = payoutResult.payoutItemId;
            payment.paypalPayoutStatus = 'success';
            payment.transferredAt = new Date();
            payment.transferStatus = 'succeeded';
            payment.errorMessage = null;

            await payment.save();
            
            console.log(`✅ PayPal payout sent to ${paypalEmail} for $${payment.stripePayoutAmount}`);
            paypalSent++;

            // Send notification to tutor
            try {
              const lessonDate = new Date(lesson.startTime).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              });

              const notification = new Notification({
                userId: tutor._id,
                type: 'payment_received',
                title: '💸 PayPal Payout Sent',
                message: `Your payout of $${payment.stripePayoutAmount.toFixed(2)} for the lesson on ${lessonDate} has been sent to your PayPal account (${paypalEmail})`,
                data: {
                  lessonId: lessonId.toString(),
                  paymentId: payment._id.toString(),
                  amount: payment.stripePayoutAmount,
                  paypalEmail,
                  lessonDate
                }
              });
              await notification.save();
              console.log(`📬 PayPal payout notification sent to tutor`);
            } catch (notifError) {
              console.error(`⚠️  Failed to send notification:`, notifError.message);
            }

          } catch (paypalError) {
            console.error(`❌ PayPal payout failed:`, paypalError.message);
            payment.transferStatus = 'failed';
            payment.errorMessage = `PayPal payout failed: ${paypalError.message}`;
            payment.paypalPayoutStatus = 'failed';
            await payment.save();
            failed++;
          }

        } else if (stripePayout.status === 'in_transit') {
          console.log(`⏳ Stripe payout still in transit - will check again next run`);
          await payment.save();
          stillPending++;

        } else if (stripePayout.status === 'failed' || stripePayout.status === 'canceled') {
          console.error(`❌ Stripe payout ${stripePayout.status} - marking payment as failed`);
          payment.transferStatus = 'failed';
          payment.errorMessage = `Stripe payout ${stripePayout.status}: ${stripePayout.failure_message || 'Unknown error'}`;
          await payment.save();
          failed++;

        } else {
          console.log(`⏳ Stripe payout status: ${stripePayout.status} - will check again later`);
          await payment.save();
          stillPending++;
        }

        processed++;

      } catch (error) {
        console.error(`❌ Error processing payment ${payment._id}:`, error.message);
        failed++;
      }
    }

    console.log('\n📊 [CRON] PayPal payout processing summary:');
    console.log(`   Total processed: ${processed}`);
    console.log(`   PayPal payouts sent: ${paypalSent}`);
    console.log(`   Still awaiting funds: ${stillPending}`);
    console.log(`   Failed: ${failed}`);
    console.log('✅ [CRON] PayPal payout processing complete\n');

  } catch (error) {
    console.error('❌ [CRON] Error in PayPal payout processing:', error);
  }
}

module.exports = { processPayPalPayouts };

