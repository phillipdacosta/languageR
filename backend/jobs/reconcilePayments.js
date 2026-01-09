/**
 * Payment Reconciliation Job
 * 
 * Runs nightly to:
 * 1. Check database vs Stripe sync
 * 2. Identify stuck authorizations
 * 3. Find failed payouts
 * 4. Detect missing payments
 * 5. Auto-release no-show lessons with uncaptured payments
 * 6. Check Stripe payout status
 * 7. Create alerts for all issues
 */

const Payment = require('../models/Payment');
const Lesson = require('../models/Lesson');
const User = require('../models/User');
const alertService = require('../services/alertService');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function reconcilePayments() {
  console.log('🔍 [RECONCILE] Starting payment reconciliation job...');
  
  try {
    let issuesFound = 0;

    // 1. CHECK DATABASE VS STRIPE SYNC
    console.log('📊 [RECONCILE] Checking database vs Stripe sync...');
    
    const succeededPayments = await Payment.find({
      status: 'succeeded',
      stripePaymentIntentId: { $ne: null },
      chargedAt: { $gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
    }).limit(200);

    for (const payment of succeededPayments) {
      try {
        const stripePI = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
        
        if (stripePI.status !== 'succeeded') {
          console.log(`❌ [RECONCILE] Out of sync: Payment ${payment._id} (DB: succeeded, Stripe: ${stripePI.status})`);
          
          await alertService.createAlert({
            type: 'PAYMENT_OUT_OF_SYNC',
            severity: 'HIGH',
            title: `Payment ${payment._id} out of sync with Stripe`,
            description: `Database shows "succeeded" but Stripe shows "${stripePI.status}"`,
            paymentId: payment._id,
            lessonId: payment.lessonId,
            stripePaymentIntentId: payment.stripePaymentIntentId,
            data: {
              dbStatus: payment.status,
              stripeStatus: stripePI.status,
              amount: payment.amount,
              chargedAt: payment.chargedAt
            }
          });
          
          issuesFound++;
        }
      } catch (error) {
        console.error(`❌ [RECONCILE] Error checking ${payment.stripePaymentIntentId}:`, error.message);
        
        if (error.code === 'resource_missing') {
          await alertService.createAlert({
            type: 'PAYMENT_OUT_OF_SYNC',
            severity: 'CRITICAL',
            title: `Payment ${payment._id} not found in Stripe`,
            description: 'Database has payment record but Stripe PaymentIntent does not exist',
            paymentId: payment._id,
            stripePaymentIntentId: payment.stripePaymentIntentId,
            data: {
              dbStatus: payment.status,
              amount: payment.amount,
              error: error.message
            }
          });
          
          issuesFound++;
        }
      }
    }

    // 2. CHECK FOR STUCK AUTHORIZATIONS
    console.log('🕐 [RECONCILE] Checking for stuck authorizations...');
    
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const stuckAuths = await Payment.find({
      status: 'authorized',
      createdAt: { $lt: weekAgo }
    }).populate('lessonId');

    if (stuckAuths.length > 0) {
      console.log(`⚠️  [RECONCILE] Found ${stuckAuths.length} stuck authorizations (> 7 days old)`);
      
      await alertService.createAlert({
        type: 'STUCK_AUTHORIZATION',
        severity: 'MEDIUM',
        title: `${stuckAuths.length} payments stuck in authorized state`,
        description: 'These payments have been authorized for over 7 days without capture or cancellation',
        data: {
          count: stuckAuths.length,
          paymentIds: stuckAuths.map(p => p._id.toString()),
          oldestCreatedAt: stuckAuths[0].createdAt
        }
      });
      
      issuesFound++;
    }

    // 3. CHECK FOR FAILED PAYOUTS
    console.log('💸 [RECONCILE] Checking for failed payouts...');
    
    const failedPayouts = await Payment.find({
      transferStatus: 'failed',
      updatedAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
    }).populate('tutorId lessonId');

    for (const payment of failedPayouts) {
      console.log(`❌ [RECONCILE] Failed payout: Payment ${payment._id} to ${payment.tutorId?.email}`);
      
      await alertService.createAlert({
        type: 'FAILED_PAYOUT',
        severity: 'HIGH',
        title: `Payout failed for payment ${payment._id}`,
        description: `Failed to send $${payment.tutorPayout} to tutor ${payment.tutorId?.email}`,
        paymentId: payment._id,
        lessonId: payment.lessonId?._id,
        userId: payment.tutorId?._id,
        data: {
          tutorEmail: payment.tutorId?.email,
          payoutProvider: payment.tutorId?.payoutProvider,
          amount: payment.tutorPayout,
          errorMessage: payment.errorMessage,
          stripePayoutId: payment.stripePayoutId,
          paypalBatchId: payment.paypalBatchId
        }
      });
      
      issuesFound++;
    }

    // 4. CHECK FOR COMPLETED LESSONS WITHOUT PAYMENTS
    console.log('📚 [RECONCILE] Checking for completed lessons without payments...');
    
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const lessonsWithoutPayments = await Lesson.find({
      status: 'completed',
      paymentId: null,
      actualCallStartTime: { $ne: null },
      price: { $gt: 0 },
      endTime: { $gt: twoDaysAgo } // Last 2 days
    }).populate('tutorId studentId');

    if (lessonsWithoutPayments.length > 0) {
      console.log(`❌ [RECONCILE] Found ${lessonsWithoutPayments.length} completed lessons without payments`);
      
      for (const lesson of lessonsWithoutPayments) {
        await alertService.createAlert({
          type: 'MISSING_PAYMENT',
          severity: 'CRITICAL',
          title: `Lesson ${lesson._id} completed without payment`,
          description: `Lesson happened but no payment record exists`,
          lessonId: lesson._id,
          userId: lesson.studentId?._id,
          data: {
            tutorEmail: lesson.tutorId?.email,
            studentEmail: lesson.studentId?.email,
            subject: lesson.subject,
            startTime: lesson.startTime,
            endTime: lesson.endTime,
            price: lesson.price
          }
        });
      }
      
      issuesFound += lessonsWithoutPayments.length;
    }

    // 5. CHECK FOR NO-SHOW LESSONS WITH UNCAPTURED PAYMENTS (should be auto-released)
    console.log('👻 [RECONCILE] Checking for no-show lessons with uncaptured payments...');
    
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const noShowLessons = await Lesson.find({
      endTime: { $lt: oneHourAgo },
      actualCallStartTime: null, // Nobody joined OR only one person joined
      status: { $ne: 'cancelled' } // Not already cancelled
    }).populate('paymentId');

    for (const lesson of noShowLessons) {
      if (!lesson.paymentId) continue;
      
      const payment = lesson.paymentId;
      
      const tutorShowed = !!lesson.tutorJoinedAt;
      const studentShowed = !!lesson.studentJoinedAt;
      
      // Check if DB says "succeeded" but Stripe might say otherwise
      if (payment.status === 'succeeded' && payment.stripePaymentIntentId) {
        try {
          const stripePI = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
          
          if (stripePI.status === 'requires_capture') {
            console.log(`⚠️  [RECONCILE] No-show lesson ${lesson._id} has uncaptured payment!`);
            console.log(`   DB shows "succeeded" but Stripe shows "requires_capture"`);
            console.log(`   Attendance: Tutor=${tutorShowed}, Student=${studentShowed}`);
            
            // Determine action based on attendance
            if (!tutorShowed && !studentShowed) {
              // Both no-show - cancel payment
              await stripe.paymentIntents.cancel(stripePI.id);
              console.log(`✅ [RECONCILE] Auto-canceled payment ${stripePI.id}`);
              
              payment.status = 'refunded';
              await payment.save();
              
              lesson.status = 'cancelled';
              lesson.cancelledBy = 'system';
              lesson.cancelReason = 'No-show by both parties - payment auto-released';
              await lesson.save();
              
              await alertService.createAlert({
                type: 'NO_SHOW_AUTO_RELEASED',
                severity: 'MEDIUM',
                title: `No-show lesson ${lesson._id} payment auto-released`,
                description: `Lesson ended ${Math.floor((Date.now() - lesson.endTime) / (1000 * 60 * 60))} hours ago with no participants. Payment was stuck as "succeeded" in DB but uncaptured in Stripe. Auto-canceled and released.`,
                lessonId: lesson._id,
                paymentId: payment._id,
                data: {
                  lessonStartTime: lesson.startTime,
                  lessonEndTime: lesson.endTime,
                  paymentAmount: payment.amount,
                  stripePaymentIntentId: stripePI.id
                }
              });
            } else if (tutorShowed && !studentShowed) {
              // Student no-show - capture 50%
              console.log(`⚠️  [RECONCILE] Student no-show detected - capturing 50% cancellation fee`);
              const partialAmount = Math.round(payment.amount * 0.5 * 100);
              
              try {
                const capturedIntent = await stripe.paymentIntents.capture(stripePI.id, {
                  amount_to_capture: partialAmount
                });
                
                payment.status = 'succeeded';
                payment.chargedAt = new Date();
                payment.amount = partialAmount / 100;
                await payment.save();
                
                lesson.status = 'cancelled';
                lesson.cancelledBy = 'student';
                lesson.cancelReason = 'Student no-show (tutor waited) - 50% fee charged';
                lesson.cancellationFeeCharged = partialAmount / 100;
                await lesson.save();
                
                await alertService.createAlert({
                  type: 'STUDENT_NO_SHOW',
                  severity: 'MEDIUM',
                  title: `Student no-show - Lesson ${lesson._id}`,
                  description: `Student did not attend. Tutor waited. 50% cancellation fee ($${partialAmount / 100}) charged.`,
                  lessonId: lesson._id,
                  paymentId: payment._id,
                  data: {
                    cancellationFee: partialAmount / 100,
                    originalAmount: payment.amount * 2 // Original was double
                  }
                });
              } catch (captureError) {
                console.error(`❌ [RECONCILE] Failed to capture partial payment:`, captureError.message);
              }
            } else if (studentShowed && !tutorShowed) {
              // Tutor no-show - full refund
              await stripe.paymentIntents.cancel(stripePI.id);
              console.log(`✅ [RECONCILE] Auto-canceled payment (tutor no-show) ${stripePI.id}`);
              
              payment.status = 'refunded';
              await payment.save();
              
              lesson.status = 'cancelled';
              lesson.cancelledBy = 'tutor';
              lesson.cancelReason = 'Tutor no-show (student waited)';
              await lesson.save();
              
              await alertService.createAlert({
                type: 'TUTOR_NO_SHOW',
                severity: 'HIGH',
                title: `Tutor no-show - Lesson ${lesson._id}`,
                description: `Tutor did not attend. Student waited. Full refund issued.`,
                lessonId: lesson._id,
                paymentId: payment._id,
                userId: lesson.tutorId,
                data: {
                  tutorEmail: lesson.tutorId?.email,
                  refundAmount: payment.amount
                }
              });
            }
            
            issuesFound++;
          }
        } catch (error) {
          console.error(`❌ [RECONCILE] Error checking no-show lesson ${lesson._id}:`, error.message);
        }
      }
    }

    // 6. CHECK STRIPE PAYOUT STATUS FOR AWAITING_FUNDS
    console.log('🏦 [RECONCILE] Checking Stripe payout status...');
    
    const awaitingFunds = await Payment.find({
      transferStatus: 'awaiting_funds',
      stripePayoutId: { $ne: null }
    }).limit(50);

    for (const payment of awaitingFunds) {
      try {
        const stripePayout = await stripe.payouts.retrieve(payment.stripePayoutId);
        
        // Update status if changed
        if (stripePayout.status !== payment.stripePayoutStatus) {
          console.log(`🔄 [RECONCILE] Updating payout status for payment ${payment._id}: ${payment.stripePayoutStatus} → ${stripePayout.status}`);
          
          payment.stripePayoutStatus = stripePayout.status;
          
          if (stripePayout.status === 'failed' || stripePayout.status === 'canceled') {
            payment.transferStatus = 'failed';
            payment.errorMessage = `Stripe payout ${stripePayout.status}: ${stripePayout.failure_code || 'N/A'}`;
            
            await alertService.createAlert({
              type: 'FAILED_PAYOUT',
              severity: 'HIGH',
              title: `Stripe payout ${stripePayout.id} ${stripePayout.status}`,
              description: `Payout for payment ${payment._id} ${stripePayout.status}`,
              paymentId: payment._id,
              stripePayoutId: stripePayout.id,
              data: {
                status: stripePayout.status,
                failureCode: stripePayout.failure_code,
                amount: payment.stripePayoutAmount
              }
            });
            
            issuesFound++;
          }
          
          await payment.save();
        }
      } catch (error) {
        console.error(`❌ [RECONCILE] Error checking payout ${payment.stripePayoutId}:`, error.message);
      }
    }

    // SUMMARY
    console.log('✅ [RECONCILE] Payment reconciliation complete');
    console.log(`📊 [RECONCILE] Issues found: ${issuesFound}`);
    
    if (issuesFound > 0) {
      console.log(`⚠️  [RECONCILE] ${issuesFound} payment issues detected - alerts created`);
    }

  } catch (error) {
    console.error('❌ [RECONCILE] Error in reconciliation job:', error);
    
    // Create alert for job failure
    await alertService.createAlert({
      type: 'WEBHOOK_FAILURE',
      severity: 'HIGH',
      title: 'Payment reconciliation job failed',
      description: error.message,
      data: {
        error: error.stack
      }
    });
  }
}

module.exports = { reconcilePayments };

