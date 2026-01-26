/**
 * Auto-release authorized payments for class no-shows
 * 
 * This job runs periodically and:
 * 1. Finds classes that have ended
 * 2. Identifies students who authorized payment but didn't join
 * 3. Releases (cancels) their payment authorizations
 * 4. Marks them as no-shows
 * 
 * This prevents Stripe from capturing expired authorizations and avoids refund fees
 */

const Class = require('../models/Class');
const Payment = require('../models/Payment');

/**
 * Main function to release payments for no-shows
 */
async function autoReleaseClassPayments() {
  try {
    const now = new Date();
    const ONE_HOUR_AGO = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Find completed or in_progress classes that ended at least 1 hour ago
    const eligibleClasses = await Class.find({
      status: { $in: ['in_progress', 'completed'] },
      endTime: { $lt: ONE_HOUR_AGO }, // Ended at least 1 hour ago
      'studentPayments.paymentStatus': 'authorized' // Has at least one authorized payment
    }).limit(50); // Process max 50 at a time
    
    if (eligibleClasses.length === 0) {
      return; // No classes to process
    }
    
    console.log(`💳 [AutoReleasePayments] Found ${eligibleClasses.length} classes with authorized payments to check`);
    
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    let releasedCount = 0;
    let errorCount = 0;
    
    for (const classObj of eligibleClasses) {
      try {
        let classUpdated = false;
        
        // Check each student payment
        for (const studentPayment of classObj.studentPayments) {
          // Skip if not authorized
          if (studentPayment.paymentStatus !== 'authorized') {
            continue;
          }
          
          // Skip if student joined (shouldn't happen, but safety check)
          if (studentPayment.attendanceStatus === 'joined') {
            console.warn(`⚠️ Student ${studentPayment.studentId} has 'authorized' payment but 'joined' attendance - skipping`);
            continue;
          }
          
          try {
            // Cancel the authorization (release the hold)
            const cancelledIntent = await stripe.paymentIntents.cancel(
              studentPayment.stripePaymentIntentId
            );
            
            if (cancelledIntent.status === 'canceled') {
              // Update student payment record
              studentPayment.paymentStatus = 'cancelled';
              studentPayment.cancelledAt = new Date();
              studentPayment.attendanceStatus = 'no_show';
              
              // Update Payment model
              const payment = await Payment.findById(studentPayment.paymentId);
              if (payment) {
                payment.status = 'cancelled';
                payment.metadata = payment.metadata || {};
                payment.metadata.cancelReason = 'no_show';
                payment.metadata.cancelledAt = new Date();
                await payment.save();
              }
              
              classUpdated = true;
              releasedCount++;
              
              console.log(`✅ Released authorization for no-show student in class ${classObj.name} (${classObj._id})`);
            } else {
              console.warn(`⚠️ Unexpected status after cancellation: ${cancelledIntent.status}`);
            }
          } catch (stripeError) {
            console.error(`❌ Failed to cancel authorization for student ${studentPayment.studentId}:`, stripeError.message);
            
            // If authorization already expired or was captured, mark accordingly
            if (stripeError.code === 'payment_intent_unexpected_state') {
              studentPayment.paymentStatus = 'error';
              studentPayment.attendanceStatus = 'no_show';
              classUpdated = true;
            }
            
            errorCount++;
          }
        }
        
        // Save class if any payments were updated
        if (classUpdated) {
          await classObj.save();
        }
        
      } catch (classError) {
        console.error(`❌ Error processing class ${classObj._id}:`, classError.message);
        errorCount++;
      }
    }
    
    if (releasedCount > 0 || errorCount > 0) {
      console.log(`💳 [AutoReleasePayments] Completed: ${releasedCount} released, ${errorCount} errors`);
    }
    
  } catch (error) {
    console.error('❌ [AutoReleasePayments] Job failed:', error);
  }
}

module.exports = autoReleaseClassPayments;

