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
const Withdrawal = require('../models/Withdrawal');
const withdrawalService = require('../services/withdrawalService');
const Notification = require('../models/Notification');
const paypalService = require('../services/paypalService');
const Lesson = require('../models/Lesson');
const User = require('../models/User');
const alertService = require('../services/alertService');
const subscriptionService = require('../services/subscriptionService');
const { applyApprovalIfReady } = require('../utils/tutorApproval');

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
        await handleConnectAccountUpdated(event.data.object);
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

      // ── Premium subscription lifecycle ───────────────────────────────
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await subscriptionService.syncSubscriptionFromStripe(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await subscriptionService.syncSubscriptionFromStripe(event.data.object);
        break;

      case 'invoice.payment_failed':
        // Stripe will also fire customer.subscription.updated with status=past_due,
        // but we log here for observability.
        console.warn(`⚠️  [WEBHOOK] Invoice payment failed for customer ${event.data.object.customer}`);
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
 * Handle Stripe Connect account.updated event.
 * Keeps `stripeConnectOnboarded`, `stripePayoutsEnabled`, and
 * `stripeIdentityVerified` in sync so the tutor approval wizard can
 * conditionally hide the manual government-ID step.
 */
async function handleConnectAccountUpdated(account) {
  console.log(`🔔 [WEBHOOK] account.updated: ${account.id}`);
  try {
    const user = await User.findOne({ stripeConnectAccountId: account.id });
    if (!user) {
      console.warn(`⚠️  [WEBHOOK] No user found for Stripe Connect account ${account.id}`);
      return;
    }

    const onboarded = !!(account.charges_enabled && account.payouts_enabled);
    const requirementsDue = account.requirements?.currently_due?.length || 0;
    const pastDue = account.requirements?.past_due?.length || 0;
    const eventuallyDue = account.requirements?.eventually_due?.length || 0;
    const identityVerified =
      onboarded && requirementsDue === 0 && pastDue === 0 && eventuallyDue === 0;
    const disabledReason = account.requirements?.disabled_reason || null;
    const accountDisabled = !!(
      disabledReason ||
      pastDue > 0 ||
      (account.details_submitted && account.charges_enabled === false)
    );

    let changed = false;

    if (onboarded && !user.stripeConnectOnboarded) {
      user.stripeConnectOnboarded = true;
      user.stripeConnectOnboardedAt = user.stripeConnectOnboardedAt || new Date();
      if (user.payoutProvider === 'none') {
        user.payoutProvider = 'stripe';
      }
      changed = true;
      console.log(`✅ [WEBHOOK] Tutor ${user.email} Stripe Connect onboarded via webhook`);
    }
    if (user.stripePayoutsEnabled !== !!account.payouts_enabled) {
      user.stripePayoutsEnabled = !!account.payouts_enabled;
      changed = true;
    }
    if (user.stripeIdentityVerified !== identityVerified) {
      user.stripeIdentityVerified = identityVerified;
      changed = true;
      console.log(`🔄 [WEBHOOK] stripeIdentityVerified=${identityVerified} for ${user.email}`);
    }
    if (user.stripeAccountDisabled !== accountDisabled) {
      user.stripeAccountDisabled = accountDisabled;
      changed = true;
      console.log(`🔄 [WEBHOOK] stripeAccountDisabled=${accountDisabled} (${disabledReason || 'pastDue/charges'}) for ${user.email}`);
    }

    if (changed) {
      const wasTutorApproved = user.tutorApproved === true;

      if (onboarded) {
        user.tutorOnboarding = user.tutorOnboarding || {};
        user.tutorOnboarding.stripeConnected = true;
      }

      const approvalSnapshot = applyApprovalIfReady(user);
      await user.save();
      const isFirstTimeApproval = !wasTutorApproved && user.tutorApproved === true;
      const notificationTitle = isFirstTimeApproval
        ? 'Your profile is live!'
        : 'Stripe account updated';
      const notificationMessage = isFirstTimeApproval
        ? 'Stripe approved your account and all requirements are complete. Your tutor profile is now live.'
        : 'Stripe updated your account status. Your profile checklist has been refreshed.';
      const notificationData = {
        stripeConnectOnboarded: user.stripeConnectOnboarded,
        stripeIdentityVerified: user.stripeIdentityVerified,
        stripeAccountDisabled: user.stripeAccountDisabled,
        stripePayoutsEnabled: user.stripePayoutsEnabled,
        tutorApproved: user.tutorApproved,
        approvalSnapshot,
        isFirstTimeApproval
      };

      if (isFirstTimeApproval) {
        try {
          await Notification.create({
            userId: user._id,
            type: 'stripe_account_updated',
            title: notificationTitle,
            message: notificationMessage,
            data: notificationData,
            read: false
          });
        } catch (notifError) {
          console.error('⚠️ [WEBHOOK] Failed to create Stripe account notification:', notifError.message);
        }
      }

      // Notify the tutor in real time so the approval wizard / checklist
      // refreshes without requiring a page reload.
      if (global.io) {
        const payload = {
          ...notificationData,
          timestamp: new Date()
        };
        global.io.to(`user:${user.auth0Id}`).emit('stripe_account_updated', payload);
        global.io.to(`mongo:${user._id.toString()}`).emit('stripe_account_updated', payload);
        if (isFirstTimeApproval) {
          global.io.to(`user:${user.auth0Id}`).emit('new_notification', {
            type: 'stripe_account_updated',
            title: notificationTitle,
            message: notificationMessage,
            timestamp: new Date(),
            urgent: false,
            data: notificationData
          });
        }
        console.log(`📡 [WEBHOOK] Emitted stripe_account_updated to tutor ${user.email}`);
      }
    }
  } catch (err) {
    console.error('❌ [WEBHOOK] handleConnectAccountUpdated failed:', err);
  }
}

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

        // ✅ IDEMPOTENCY CHECK: Skip if PayPal payout already sent
        if (payment.paypalBatchId && payment.transferStatus === 'succeeded') {
          console.log(`ℹ️  [WEBHOOK] Payment ${payment._id} already has PayPal payout (Batch: ${payment.paypalBatchId}), skipping`);
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

        // Emit WebSocket event for real-time update
        if (global.io) {
          const tutorSocketRoom = `user:${tutor._id}`;
          global.io.to(tutorSocketRoom).emit('payment_status_changed', {
            paymentId: payment._id.toString(),
            lessonId: lesson._id.toString(),
            status: 'paid', // Frontend uses 'paid' status for transferred payments
            transferStatus: 'succeeded',
            updatedAt: new Date()
          });
          console.log(`📡 [WEBHOOK] Emitted payment_status_changed to ${tutorSocketRoom}`);
        }

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
            message: `Your payout of <strong>$${payment.stripePayoutAmount.toFixed(2)}</strong> for the lesson on <strong>${lessonDate}</strong> has been sent to your PayPal account (${paypalEmail})`,
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

    // Tutor withdrawals: capture the real settled amount/currency/FX so the
    // tutor's records match what actually landed in their account.
    await captureWithdrawalSettlement(transfer);
  } catch (error) {
    console.error(`❌ Error handling transfer.created:`, error);
  }
}

/**
 * Find the Withdrawal tied to a Stripe transfer and capture its settlement
 * details (settled currency/amount/FX). Best-effort and idempotent.
 */
async function captureWithdrawalSettlement(transfer) {
  try {
    const withdrawal = await Withdrawal.findOne({ stripeTransferId: transfer.id })
      .populate('tutorId', 'stripeConnectAccountId');

    if (!withdrawal) return;
    if (withdrawal.settlementCapturedAt) return; // already captured

    const accountId = withdrawal.tutorId?.stripeConnectAccountId || transfer.destination;
    await withdrawalService.captureStripeSettlement(withdrawal, transfer, accountId);
  } catch (err) {
    console.error(`⚠️  [WEBHOOK] Failed to capture withdrawal settlement for ${transfer.id}:`, err.message);
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

    // Backfill settlement details if they weren't captured at creation time.
    await captureWithdrawalSettlement(transfer);
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

/**
 * Handle checkout.session.completed
 * Fires once when a brand-new subscription is created via Stripe Checkout.
 * We expand the related subscription and sync it to the local user record.
 */
async function handleCheckoutSessionCompleted(session) {
  if (session.mode !== 'subscription' || !session.subscription) {
    return;
  }
  console.log(`🔔 [WEBHOOK] Checkout completed for subscription ${session.subscription}`);
  try {
    const fullSubscription = await stripe.subscriptions.retrieve(session.subscription);
    if (!fullSubscription.metadata?.userId && session.client_reference_id) {
      // Stripe sometimes drops the subscription_data.metadata when the customer
      // already exists. Backfill so syncSubscriptionFromStripe can match.
      fullSubscription.metadata = fullSubscription.metadata || {};
      fullSubscription.metadata.userId = session.client_reference_id;
    }
    await subscriptionService.syncSubscriptionFromStripe(fullSubscription);
  } catch (err) {
    console.error('❌ [WEBHOOK] checkout.session.completed sync failed:', err);
  }
}

module.exports = router;


