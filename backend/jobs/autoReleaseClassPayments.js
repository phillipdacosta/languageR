/**
 * Auto-finalize classes and release/refund payments
 * 
 * This job runs periodically and handles TWO scenarios:
 * 
 * SCENARIO 1: Classes that NEVER HAPPENED (scheduled but time passed)
 * - Class status is still 'scheduled'
 * - End time has passed
 * - Nobody joined (no actual call)
 * - REFUND all payments to students
 * - Mark class as cancelled
 * 
 * SCENARIO 2: Classes that COMPLETED but have no-shows
 * - Class status is 'in_progress' or 'completed'
 * - Some students paid but didn't join
 * - Release their authorized payments (they shouldn't be charged)
 * 
 * This ensures students aren't charged for classes that never happened
 * and prevents Stripe from capturing expired authorizations
 */

const Class = require('../models/Class');
const Payment = require('../models/Payment');
const User = require('../models/User');
const walletService = require('../services/walletService');

/**
 * Main function to finalize classes and release payments
 */
async function autoReleaseClassPayments() {
  console.log('\n========================================');
  console.log('🔄 [CRON] Auto-Finalize Classes Job Started');
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log('========================================\n');
  
  try {
    const now = new Date();
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    
    let classesFinalized = 0;
    let paymentsRefunded = 0;
    let paymentsReleased = 0;
    let errorCount = 0;
    
    // ============================================
    // SCENARIO 1: Classes that NEVER HAPPENED
    // Find 'scheduled' classes where end time has passed
    // ============================================
    const neverHappenedClasses = await Class.find({
      status: 'scheduled',
      endTime: { $lt: now } // End time is in the past
    }).populate('tutorId', 'name email')
      .populate('confirmedStudents', 'name email')
      .limit(100);
    
    if (neverHappenedClasses.length > 0) {
      console.log(`📦 [AutoFinalizeClasses] Found ${neverHappenedClasses.length} scheduled classes that never happened`);
      
      for (const classObj of neverHappenedClasses) {
        try {
          console.log(`\n🔍 Processing class "${classObj.name}" (${classObj._id})`);
          console.log(`   Scheduled: ${classObj.startTime} - ${classObj.endTime}`);
          console.log(`   Confirmed students: ${classObj.confirmedStudents?.length || 0}`);
          
          // Find all payments for this class
          const classPayments = await Payment.find({
            classId: classObj._id,
            status: { $in: ['authorized', 'succeeded', 'pending'] }
          });
          
          console.log(`   Found ${classPayments.length} payments to process`);
          
          // Refund/release each payment
          for (const payment of classPayments) {
            try {
              await refundClassPayment(payment, classObj, stripe);
              paymentsRefunded++;
              console.log(`   ✅ Refunded payment ${payment._id} ($${payment.amount})`);
            } catch (refundError) {
              console.error(`   ❌ Failed to refund payment ${payment._id}:`, refundError.message);
              errorCount++;
            }
          }
          
          // Also check studentPayments array on the class (legacy structure)
          if (classObj.studentPayments && classObj.studentPayments.length > 0) {
            for (const studentPayment of classObj.studentPayments) {
              if (studentPayment.paymentStatus === 'authorized' && studentPayment.stripePaymentIntentId) {
                try {
                  await stripe.paymentIntents.cancel(studentPayment.stripePaymentIntentId);
                  studentPayment.paymentStatus = 'cancelled';
                  studentPayment.cancelledAt = new Date();
                  paymentsReleased++;
                  console.log(`   ✅ Released authorization ${studentPayment.stripePaymentIntentId}`);
                } catch (cancelError) {
                  console.error(`   ❌ Failed to cancel authorization:`, cancelError.message);
                  errorCount++;
                }
              }
            }
          }
          
          // Update tutor earnings if any were credited
          if (classPayments.length > 0) {
            await reverseTutorEarnings(classObj, classPayments);
          }
          
          // Mark class as cancelled
          classObj.status = 'cancelled';
          classObj.cancelledAt = now;
          classObj.cancelReason = 'no_show_both_parties';
          await classObj.save();
          
          classesFinalized++;
          console.log(`   ✅ Class marked as cancelled (no-show)`);
          
        } catch (classError) {
          console.error(`❌ Error processing class ${classObj._id}:`, classError.message);
          errorCount++;
        }
      }
    }
    
    // ============================================
    // SCENARIO 2: Completed classes with no-show students
    // ============================================
    const ONE_HOUR_AGO = new Date(now.getTime() - 60 * 60 * 1000);
    
    const completedClasses = await Class.find({
      status: { $in: ['in_progress', 'completed'] },
      endTime: { $lt: ONE_HOUR_AGO },
      'studentPayments.paymentStatus': 'authorized'
    }).limit(50);
    
    if (completedClasses.length > 0) {
      console.log(`\n📦 [AutoFinalizeClasses] Found ${completedClasses.length} completed classes with authorized payments`);
      
      for (const classObj of completedClasses) {
        try {
          let classUpdated = false;
          
          for (const studentPayment of classObj.studentPayments) {
            if (studentPayment.paymentStatus !== 'authorized') continue;
            if (studentPayment.attendanceStatus === 'joined') {
              console.warn(`⚠️ Student has 'authorized' but 'joined' - skipping`);
              continue;
            }
            
            try {
              const cancelledIntent = await stripe.paymentIntents.cancel(
                studentPayment.stripePaymentIntentId
              );
              
              if (cancelledIntent.status === 'canceled') {
                studentPayment.paymentStatus = 'cancelled';
                studentPayment.cancelledAt = new Date();
                studentPayment.attendanceStatus = 'no_show';
                
                const payment = await Payment.findById(studentPayment.paymentId);
                if (payment) {
                  payment.status = 'cancelled';
                  payment.metadata = payment.metadata || {};
                  payment.metadata.cancelReason = 'no_show';
                  payment.metadata.cancelledAt = new Date();
                  await payment.save();
                }
                
                classUpdated = true;
                paymentsReleased++;
              }
            } catch (stripeError) {
              if (stripeError.code === 'payment_intent_unexpected_state') {
                studentPayment.paymentStatus = 'error';
                studentPayment.attendanceStatus = 'no_show';
                classUpdated = true;
              }
              errorCount++;
            }
          }
          
          if (classUpdated) {
            await classObj.save();
          }
        } catch (classError) {
          console.error(`❌ Error processing class ${classObj._id}:`, classError.message);
          errorCount++;
        }
      }
    }
    
    console.log('\n========================================');
    console.log(`✅ [CRON] Auto-Finalize Classes Job Completed`);
    console.log(`   📊 Classes finalized: ${classesFinalized}`);
    console.log(`   💰 Payments refunded: ${paymentsRefunded}`);
    console.log(`   🔓 Authorizations released: ${paymentsReleased}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log('========================================\n');
    
    return {
      success: true,
      classesFinalized,
      paymentsRefunded,
      paymentsReleased,
      errorCount
    };
    
  } catch (error) {
    console.error('❌ [AutoFinalizeClasses] Job failed:', error);
    throw error;
  }
}

/**
 * Refund a class payment back to the student
 */
async function refundClassPayment(payment, classObj, stripe) {
  try {
    if (payment.paymentMethod === 'wallet' || payment.paymentType === 'wallet') {
      // Wallet payment - return funds to student's wallet using wallet service
      if (payment.studentId) {
        await walletService.refund({
          userId: payment.studentId,
          lessonId: null, // No lessonId for classes
          amount: payment.amount,
          reason: `Refund for class "${classObj.name}" that didn't happen`,
          paymentId: payment._id
        });
        
        console.log(`   💰 Wallet refund: $${payment.amount} for class ${classObj.name}`);
      }
      
      payment.status = 'refunded';
      payment.refundedAt = new Date();
      payment.refundReason = 'class_no_show';
      await payment.save();
      
    } else if (payment.stripePaymentIntentId) {
      // Stripe payment - cancel authorization or refund
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
        
        if (paymentIntent.status === 'requires_capture') {
          // Authorization not yet captured - just cancel it
          await stripe.paymentIntents.cancel(payment.stripePaymentIntentId);
          payment.status = 'cancelled';
          console.log(`   🔓 Cancelled Stripe authorization`);
        } else if (paymentIntent.status === 'succeeded') {
          // Already captured - need to refund
          const refund = await stripe.refunds.create({
            payment_intent: payment.stripePaymentIntentId,
            reason: 'requested_by_customer'
          });
          payment.status = 'refunded';
          payment.stripeRefundId = refund.id;
          console.log(`   💸 Stripe refund created: ${refund.id}`);
        } else {
          // Other status (canceled, etc.) - just update our record
          payment.status = 'cancelled';
          console.log(`   ℹ️ Payment was in status: ${paymentIntent.status}`);
        }
        
        payment.refundedAt = new Date();
        payment.refundReason = 'class_no_show';
        await payment.save();
        
      } catch (stripeError) {
        console.error(`   ⚠️ Stripe error:`, stripeError.message);
        // Mark as cancelled anyway to prevent retry loops
        payment.status = 'cancelled';
        payment.refundReason = 'class_no_show';
        payment.metadata = payment.metadata || {};
        payment.metadata.stripeError = stripeError.message;
        await payment.save();
      }
    } else {
      // No payment method identified - just mark as cancelled
      payment.status = 'cancelled';
      payment.refundReason = 'class_no_show';
      await payment.save();
    }
  } catch (error) {
    console.error(`   ❌ Error refunding payment ${payment._id}:`, error.message);
    throw error;
  }
}

/**
 * Reverse any tutor earnings that were credited for this class
 */
async function reverseTutorEarnings(classObj, payments) {
  try {
    const tutor = await User.findById(classObj.tutorId);
    if (!tutor || !tutor.tutorEarnings) return;
    
    // Calculate total that was credited to tutor
    let totalToReverse = 0;
    for (const payment of payments) {
      if (payment.tutorPayout) {
        totalToReverse += payment.tutorPayout;
      }
    }
    
    if (totalToReverse > 0) {
      // Deduct from pending balance
      tutor.tutorEarnings.pendingBalance = Math.max(0, 
        (tutor.tutorEarnings.pendingBalance || 0) - totalToReverse
      );
      await tutor.save();
      console.log(`   📉 Reversed $${totalToReverse} from tutor ${tutor.name}'s pending balance`);
    }
  } catch (error) {
    console.error(`   ⚠️ Error reversing tutor earnings:`, error.message);
    // Non-fatal error - don't throw
  }
}

module.exports = autoReleaseClassPayments;

