/**
 * Auto-release authorized payments for individual lesson no-shows
 * 
 * This job runs periodically and:
 * 1. Finds lessons that have ended (past their scheduled end time)
 * 2. Identifies lessons with 'authorized' payments where no one joined
 * 3. Releases (cancels) the payment authorizations
 * 4. Updates lesson status to reflect no-show
 * 
 * This prevents Stripe from capturing expired authorizations and avoids refund fees.
 * Stripe automatically expires authorizations after 7 days, but we want to release them
 * sooner to free up funds on the student's card.
 */

const Lesson = require('../models/Lesson');
const Payment = require('../models/Payment');

/**
 * Main function to release lesson payments for no-shows
 */
async function autoReleaseLessonPayments() {
  try {
    const now = new Date();
    const ONE_HOUR_AGO = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Find lessons that:
    // - Ended at least 1 hour ago
    // - Have a payment in 'authorized' status (not captured)
    // - Never started (no actualCallStartTime means no one joined)
    const eligibleLessons = await Lesson.find({
      endTime: { $lt: ONE_HOUR_AGO }, // Ended at least 1 hour ago
      actualCallStartTime: null, // No one joined
      status: { $in: ['scheduled', 'in_progress'] }, // Not already marked as completed/cancelled
      paymentId: { $exists: true, $ne: null } // Has a payment
    })
    .populate('paymentId')
    .populate('studentId', 'name firstName lastName email')
    .populate('tutorId', 'name firstName lastName email')
    .limit(50); // Process max 50 at a time
    
    if (eligibleLessons.length === 0) {
      return; // No lessons to process
    }
    
    console.log(`💳 [AutoReleaseLessonPayments] Found ${eligibleLessons.length} no-show lessons with authorized payments`);
    
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    let releasedCount = 0;
    let errorCount = 0;
    
    for (const lesson of eligibleLessons) {
      try {
        const payment = lesson.paymentId;
        
        // Double-check payment is authorized
        if (!payment || payment.status !== 'authorized') {
          console.log(`ℹ️  Lesson ${lesson._id} payment is not authorized (status: ${payment?.status || 'N/A'}) - skipping`);
          continue;
        }
        
        // Release the authorization based on payment method
        if (payment.paymentMethod === 'card' && payment.stripePaymentIntentId) {
          try {
            // Cancel the Stripe PaymentIntent
            const cancelledIntent = await stripe.paymentIntents.cancel(
              payment.stripePaymentIntentId
            );
            
            if (cancelledIntent.status === 'canceled') {
              // Update payment record
              payment.status = 'cancelled';
              payment.metadata = payment.metadata || {};
              payment.metadata.cancelReason = 'no_show';
              payment.metadata.cancelledAt = new Date();
              await payment.save();
              
              // Update lesson
              lesson.status = 'cancelled';
              lesson.cancelReason = 'no_show';
              lesson.cancelledBy = 'system';
              lesson.billingStatus = 'no_show';
              await lesson.save();
              
              releasedCount++;
              
              const studentName = lesson.studentId?.firstName 
                ? `${lesson.studentId.firstName} ${lesson.studentId.lastName || ''}`
                : lesson.studentId?.name || 'Unknown';
              const tutorName = lesson.tutorId?.firstName 
                ? `${lesson.tutorId.firstName} ${lesson.tutorId.lastName || ''}`
                : lesson.tutorId?.name || 'Unknown';
              
              console.log(`✅ Released $${payment.amount.toFixed(2)} authorization for no-show lesson ${lesson._id} (${studentName} with ${tutorName})`);
            } else {
              console.warn(`⚠️ Unexpected status after cancellation: ${cancelledIntent.status}`);
              errorCount++;
            }
          } catch (stripeError) {
            console.error(`❌ Failed to cancel Stripe authorization for lesson ${lesson._id}:`, stripeError.message);
            
            // If authorization already expired or was captured, mark accordingly
            if (stripeError.code === 'payment_intent_unexpected_state') {
              payment.status = 'error';
              payment.metadata = payment.metadata || {};
              payment.metadata.errorReason = stripeError.message;
              await payment.save();
              
              lesson.status = 'cancelled';
              lesson.cancelReason = 'no_show';
              lesson.cancelledBy = 'system';
              await lesson.save();
            }
            
            errorCount++;
          }
        } else if (payment.paymentMethod === 'wallet') {
          // For wallet payments, funds were already deducted at booking
          // We should refund them
          const walletService = require('../services/walletService');
          try {
            await walletService.refund({
              userId: lesson.studentId._id,
              lessonId: lesson._id,
              amount: payment.amount,
              reason: 'Lesson no-show - automatic refund'
            });
            
            payment.status = 'refunded';
            payment.metadata = payment.metadata || {};
            payment.metadata.refundReason = 'no_show';
            payment.metadata.refundedAt = new Date();
            await payment.save();
            
            lesson.status = 'cancelled';
            lesson.cancelReason = 'no_show';
            lesson.cancelledBy = 'system';
            lesson.billingStatus = 'refunded';
            await lesson.save();
            
            releasedCount++;
            console.log(`✅ Refunded $${payment.amount.toFixed(2)} wallet payment for no-show lesson ${lesson._id}`);
          } catch (walletError) {
            console.error(`❌ Failed to refund wallet payment for lesson ${lesson._id}:`, walletError.message);
            errorCount++;
          }
        } else {
          console.warn(`⚠️ Unknown payment method '${payment.paymentMethod}' for lesson ${lesson._id} - skipping`);
        }
        
      } catch (lessonError) {
        console.error(`❌ Error processing lesson ${lesson._id}:`, lessonError.message);
        errorCount++;
      }
    }
    
    if (releasedCount > 0 || errorCount > 0) {
      console.log(`💳 [AutoReleaseLessonPayments] Completed: ${releasedCount} released/refunded, ${errorCount} errors`);
    }
    
  } catch (error) {
    console.error('❌ [AutoReleaseLessonPayments] Job failed:', error);
  }
}

module.exports = autoReleaseLessonPayments;

