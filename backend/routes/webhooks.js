/**
 * Stripe Webhook Handler
 * 
 * Handles Stripe webhook events for payment tracking and automation.
 * 
 * Events handled:
 * - payout.paid: When a Stripe payout arrives in the platform bank account
 * - payout.failed: When a Stripe payout fails
 * - account.updated: When a Connect account is updated
 */

const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const paypalService = require('../services/paypalService');
const Lesson = require('../models/Lesson');
const alertService = require('../services/alertService');

// Webhook endpoint MUST use raw body, not JSON parsed body
// This is handled in server.js with express.raw() for this specific route

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('⚠️  STRIPE_WEBHOOK_SECRET not configured - webhook validation skipped');
    return res.status(400).send('Webhook secret not configured');
  }

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log(`🔔 [WEBHOOK] Received Stripe event: ${event.type}`);
  } catch (err) {
    console.error(`❌ [WEBHOOK] Signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'payout.paid':
        await handlePayoutPaid(event.data.object);
        break;

      case 'payout.failed':
        await handlePayoutFailed(event.data.object);
        break;

      case 'payout.canceled':
        await handlePayoutCanceled(event.data.object);
        break;

      case 'transfer.created':
        await handleTransferCreated(event.data.object);
        break;

      case 'transfer.updated':
        await handleTransferUpdated(event.data.object);
        break;

      case 'transfer.reversed':
        await handleTransferReversed(event.data.object);
        break;

      case 'account.updated':
        console.log(`🔔 [WEBHOOK] Stripe Connect account updated: ${event.data.object.id}`);
        // Could update tutor onboarding status here if needed
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;

      case 'payment_intent.canceled':
        await handlePaymentCanceled(event.data.object);
        break;

      case 'charge.refunded':
        await handleChargeRefunded(event.data.object);
        break;

      case 'charge.dispute.created':
        await handleDisputeCreated(event.data.object);
        break;

      case 'charge.dispute.closed':
        await handleDisputeClosed(event.data.object);
        break;

      default:
        console.log(`ℹ️  [WEBHOOK] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error(`❌ [WEBHOOK] Error handling event ${event.type}:`, error);
    res.status(500).send('Webhook handler error');
  }
});

/**
 * Handle payout.paid event
 * When Stripe payout arrives in bank, send PayPal payout to tutor
 */
async function handlePayoutPaid(payout) {
  console.log(`💰 [WEBHOOK] Payout paid: ${payout.id} for $${payout.amount / 100}`);

  try {
    // Find all payments with this payout ID
    const payments = await Payment.find({
      stripePayoutId: payout.id,
      transferStatus: 'awaiting_funds'
    })
      .populate('lessonId')
      .populate('tutorId');

    if (payments.length === 0) {
      console.log(`ℹ️  [WEBHOOK] No pending payments found for payout ${payout.id}`);
      return;
    }

    console.log(`📋 [WEBHOOK] Found ${payments.length} payment(s) for payout ${payout.id}`);

    for (const payment of payments) {
      try {
        const tutor = payment.tutorId;
        const lesson = payment.lessonId;

        // Update payout status
        payment.stripePayoutStatus = 'paid';
        payment.stripePayoutArrivedAt = new Date(payout.arrival_date * 1000);

        const paypalEmail = tutor.payoutDetails?.paypalEmail;
        if (!paypalEmail) {
          console.error(`❌ No PayPal email for tutor ${tutor._id}`);
          payment.transferStatus = 'failed';
          payment.errorMessage = 'PayPal email not configured';
          await payment.save();
          continue;
        }

        if (!paypalService.isAvailable()) {
          console.error(`❌ PayPal service not configured`);
          payment.transferStatus = 'failed';
          payment.errorMessage = 'PayPal service not available';
          await payment.save();
          continue;
        }

        // Send PayPal payout
        const studentName = lesson.studentId?.firstName 
          ? `${lesson.studentId.firstName} ${(lesson.studentId.lastName || '').charAt(0)}.`
          : 'a student';

        const payoutResult = await paypalService.sendPayout({
          tutorId: tutor._id.toString(),
          paypalEmail: paypalEmail,
          amount: payment.stripePayoutAmount,
          lessonId: lesson._id.toString(),
          note: `Payment for lesson with ${studentName}`
        });

        payment.paypalBatchId = payoutResult.batchId;
        payment.paypalPayoutItemId = payoutResult.payoutItemId;
        payment.paypalPayoutStatus = 'success';
        payment.transferredAt = new Date();
        payment.transferStatus = 'succeeded';
        payment.errorMessage = null;

        await payment.save();

        console.log(`✅ [WEBHOOK] PayPal payout sent to ${paypalEmail} for $${payment.stripePayoutAmount}`);

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
              lessonId: lesson._id.toString(),
              paymentId: payment._id.toString(),
              amount: payment.stripePayoutAmount,
              paypalEmail,
              lessonDate
            }
          });
          await notification.save();
        } catch (notifError) {
          console.error(`⚠️  Failed to send notification:`, notifError.message);
        }

      } catch (error) {
        console.error(`❌ Error processing payment ${payment._id}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`❌ Error handling payout.paid:`, error);
    throw error;
  }
}

/**
 * Handle payout.failed event
 */
async function handlePayoutFailed(payout) {
  console.log(`❌ [WEBHOOK] Payout failed: ${payout.id}`);

  try {
    // Find all payments with this payout ID
    const payments = await Payment.find({
      stripePayoutId: payout.id
    }).populate('tutorId lessonId');

    for (const payment of payments) {
      payment.stripePayoutStatus = 'failed';
      payment.transferStatus = 'failed';
      payment.errorMessage = `Stripe payout failed: ${payout.failure_message || 'Unknown error'}`;
      await payment.save();
      console.log(`❌ [WEBHOOK] Marked payment ${payment._id} as failed`);

      // Create alert
      await alertService.createAlert({
        type: 'FAILED_PAYOUT',
        severity: 'HIGH',
        title: `Stripe payout ${payout.id} failed`,
        description: payout.failure_message || 'Payout failed without specific error message',
        paymentId: payment._id,
        lessonId: payment.lessonId?._id,
        userId: payment.tutorId?._id,
        stripePayoutId: payout.id,
        data: {
          tutorEmail: payment.tutorId?.email,
          amount: payment.stripePayoutAmount,
          failureCode: payout.failure_code,
          failureMessage: payout.failure_message
        }
      });
    }
  } catch (error) {
    console.error(`❌ Error handling payout.failed:`, error);
    throw error;
  }
}

/**
 * Handle payout.canceled event
 */
async function handlePayoutCanceled(payout) {
  console.log(`⚠️  [WEBHOOK] Payout canceled: ${payout.id}`);

  try {
    // Find all payments with this payout ID
    const payments = await Payment.find({
      stripePayoutId: payout.id
    }).populate('tutorId');

    for (const payment of payments) {
      payment.stripePayoutStatus = 'canceled';
      payment.transferStatus = 'failed';
      payment.errorMessage = 'Stripe payout was canceled';
      await payment.save();
      console.log(`⚠️  [WEBHOOK] Marked payment ${payment._id} as canceled`);

      // Create alert
      await alertService.createAlert({
        type: 'FAILED_PAYOUT',
        severity: 'MEDIUM',
        title: `Stripe payout ${payout.id} canceled`,
        description: 'Payout was canceled by Stripe or manually',
        paymentId: payment._id,
        stripePayoutId: payout.id,
        data: {
          tutorEmail: payment.tutorId?.email,
          amount: payment.stripePayoutAmount
        }
      });
    }
  } catch (error) {
    console.error(`❌ Error handling payout.canceled:`, error);
    throw error;
  }
}

/**
 * Handle payment_intent.payment_failed
 */
async function handlePaymentFailed(paymentIntent) {
  console.log(`❌ [WEBHOOK] Payment failed: ${paymentIntent.id}`);

  try {
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntent.id
    }).populate('lessonId studentId');

    if (payment) {
      // Create alert for failed payment
      await alertService.createAlert({
        type: 'FAILED_CAPTURE',
        severity: 'HIGH',
        title: `Payment capture failed: ${paymentIntent.id}`,
        description: `Failed to capture $${paymentIntent.amount / 100} - ${paymentIntent.last_payment_error?.message || 'Unknown error'}`,
        paymentId: payment._id,
        lessonId: payment.lessonId?._id,
        userId: payment.studentId,
        stripePaymentIntentId: paymentIntent.id,
        data: {
          amount: paymentIntent.amount / 100,
          errorCode: paymentIntent.last_payment_error?.code,
          errorMessage: paymentIntent.last_payment_error?.message,
          declineCode: paymentIntent.last_payment_error?.decline_code
        }
      });
    }
  } catch (error) {
    console.error(`❌ Error handling payment_intent.payment_failed:`, error);
  }
}

/**
 * Handle payment_intent.canceled
 */
async function handlePaymentCanceled(paymentIntent) {
  console.log(`⚠️  [WEBHOOK] Payment canceled: ${paymentIntent.id}`);

  try {
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntent.id
    });

    if (payment && payment.status === 'authorized') {
      // This is expected for auto-released no-shows
      console.log(`✅ [WEBHOOK] Authorized payment ${payment._id} canceled (likely auto-release)`);
    } else if (payment) {
      // Unexpected cancellation
      await alertService.createAlert({
        type: 'PAYMENT_OUT_OF_SYNC',
        severity: 'MEDIUM',
        title: `Payment unexpectedly canceled: ${paymentIntent.id}`,
        description: 'PaymentIntent was canceled in Stripe',
        paymentId: payment._id,
        stripePaymentIntentId: paymentIntent.id,
        data: {
          paymentStatus: payment.status,
          amount: paymentIntent.amount / 100
        }
      });
    }
  } catch (error) {
    console.error(`❌ Error handling payment_intent.canceled:`, error);
  }
}

/**
 * Handle charge.refunded
 */
async function handleChargeRefunded(charge) {
  console.log(`🔄 [WEBHOOK] Charge refunded: ${charge.id} for $${charge.amount_refunded / 100}`);

  try {
    const payment = await Payment.findOne({
      stripeChargeId: charge.id
    }).populate('lessonId studentId tutorId');

    if (payment) {
      await alertService.createAlert({
        type: 'UNEXPECTED_REFUND',
        severity: 'HIGH',
        title: `Refund issued for charge ${charge.id}`,
        description: `$${charge.amount_refunded / 100} refunded`,
        paymentId: payment._id,
        lessonId: payment.lessonId?._id,
        data: {
          chargeId: charge.id,
          refundedAmount: charge.amount_refunded / 100,
          totalAmount: charge.amount / 100,
          studentEmail: payment.studentId?.email,
          tutorEmail: payment.tutorId?.email,
          reason: charge.refunds?.data[0]?.reason
        }
      });
    }
  } catch (error) {
    console.error(`❌ Error handling charge.refunded:`, error);
  }
}

/**
 * Handle charge.dispute.created
 */
async function handleDisputeCreated(dispute) {
  console.log(`⚠️  [WEBHOOK] Dispute created: ${dispute.id} for $${dispute.amount / 100}`);

  try {
    const payment = await Payment.findOne({
      stripeChargeId: dispute.charge
    }).populate('lessonId studentId tutorId');

    if (payment) {
      await alertService.createAlert({
        type: 'PAYMENT_DISPUTE',
        severity: 'CRITICAL',
        title: `Chargeback/Dispute: ${dispute.id}`,
        description: `Student disputed $${dispute.amount / 100} - Reason: ${dispute.reason}`,
        paymentId: payment._id,
        lessonId: payment.lessonId?._id,
        userId: payment.studentId,
        data: {
          disputeId: dispute.id,
          chargeId: dispute.charge,
          amount: dispute.amount / 100,
          reason: dispute.reason,
          status: dispute.status,
          studentEmail: payment.studentId?.email,
          tutorEmail: payment.tutorId?.email,
          lessonDate: payment.lessonId?.startTime
        }
      });
    }
  } catch (error) {
    console.error(`❌ Error handling charge.dispute.created:`, error);
  }
}

/**
 * Handle transfer.created - When a transfer to tutor is created
 */
async function handleTransferCreated(transfer) {
  console.log(`💸 [WEBHOOK] Transfer created: ${transfer.id} for $${transfer.amount / 100} to ${transfer.destination}`);

  try {
    // Find payment by transfer group (contains payment intent ID)
    const payment = await Payment.findOne({
      stripePaymentIntentId: transfer.transfer_group?.replace('group_', '')
    });

    if (payment) {
      payment.stripeTransferId = transfer.id;
      payment.transferStatus = 'pending';
      payment.transferCreatedAt = new Date(transfer.created * 1000);
      await payment.save();
      console.log(`✅ [WEBHOOK] Updated payment ${payment._id} with transfer ID`);
    } else {
      console.warn(`⚠️  [WEBHOOK] No payment found for transfer ${transfer.id}`);
    }
  } catch (error) {
    console.error(`❌ Error handling transfer.created:`, error);
  }
}

/**
 * Handle transfer.updated - When transfer status changes (e.g., paid, failed)
 */
async function handleTransferUpdated(transfer) {
  console.log(`💸 [WEBHOOK] Transfer updated: ${transfer.id}, status: ${transfer.status || 'N/A'}`);

  try {
    const payment = await Payment.findOne({
      stripeTransferId: transfer.id
    });

    if (payment) {
      // Update transfer status based on Stripe transfer object
      // Note: Transfers don't have a 'status' field, but they can be reversed
      if (transfer.reversed) {
        payment.transferStatus = 'failed';
        payment.transferError = 'Transfer was reversed';
      } else if (transfer.amount_reversed > 0) {
        payment.transferStatus = 'failed';
        payment.transferError = `Partial reversal: $${transfer.amount_reversed / 100}`;
      } else {
        // If not reversed, consider it succeeded
        payment.transferStatus = 'succeeded';
        payment.transferError = null;
        payment.transferredAt = new Date();
      }
      
      await payment.save();
      console.log(`✅ [WEBHOOK] Updated payment ${payment._id} transfer status to: ${payment.transferStatus}`);
    } else {
      console.warn(`⚠️  [WEBHOOK] No payment found for transfer ${transfer.id}`);
    }
  } catch (error) {
    console.error(`❌ Error handling transfer.updated:`, error);
  }
}

/**
 * Handle transfer.reversed - When a transfer is reversed
 */
async function handleTransferReversed(transfer) {
  console.log(`⚠️  [WEBHOOK] Transfer reversed: ${transfer.id} for $${transfer.amount / 100}`);

  try {
    const payment = await Payment.findOne({
      stripeTransferId: transfer.id
    }).populate('tutorId lessonId');

    if (payment) {
      payment.transferStatus = 'failed';
      payment.transferError = 'Transfer was reversed by Stripe';
      await payment.save();

      // Create alert for reversed transfer
      await alertService.createAlert({
        type: 'TRANSFER_REVERSED',
        severity: 'HIGH',
        title: `Transfer reversed: ${transfer.id}`,
        description: `Transfer of $${transfer.amount / 100} to tutor was reversed`,
        paymentId: payment._id,
        lessonId: payment.lessonId?._id,
        userId: payment.tutorId,
        data: {
          transferId: transfer.id,
          amount: transfer.amount / 100,
          tutorEmail: payment.tutorId?.email,
          reversalReason: transfer.reversals?.data[0]?.description
        }
      });

      console.log(`✅ [WEBHOOK] Updated payment ${payment._id} as reversed`);
    } else {
      console.warn(`⚠️  [WEBHOOK] No payment found for reversed transfer ${transfer.id}`);
    }
  } catch (error) {
    console.error(`❌ Error handling transfer.reversed:`, error);
  }
}


/**
 * Handle charge.dispute.closed
 */
async function handleDisputeClosed(dispute) {
  console.log(`✅ [WEBHOOK] Dispute closed: ${dispute.id} - Status: ${dispute.status}`);
  // Could update existing alert or create resolution note
}

module.exports = router;


