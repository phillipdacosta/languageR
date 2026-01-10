/**
 * Auto-finalize lessons that have ended but don't have transcripts
 * 
 * This job runs every minute and:
 * 1. Finds lessons that have passed their scheduled end time
 * 2. Are still in 'scheduled' or 'in_progress' status
 * 3. Don't have a transcript (or transcript was never started)
 * 4. Automatically finalizes the lesson (billing, status)
 * 
 * Use case: User closes browser without clicking "End Call" and no transcript was recorded
 */

const Lesson = require('../models/Lesson');
const LessonTranscript = require('../models/LessonTranscript');
const User = require('../models/User');

// Helper function to emit WebSocket events for lesson/payment status changes
function emitStatusChange(lessonId, status, tutorId, studentId) {
  try {
    const io = require('../server').getIO();
    if (!io) return;

    const payload = {
      lessonId: lessonId.toString(),
      status,
      updatedAt: new Date()
    };

    // Emit to both tutor and student
    if (tutorId) {
      const tutorSocketId = global.userSockets?.[tutorId.toString()];
      if (tutorSocketId) {
        io.to(tutorSocketId).emit('lesson_status_changed', payload);
      }
    }
    if (studentId) {
      const studentSocketId = global.userSockets?.[studentId.toString()];
      if (studentSocketId) {
        io.to(studentSocketId).emit('lesson_status_changed', payload);
      }
    }

    console.log(`📡 Emitted lesson_status_changed for lesson ${lessonId}: ${status}`);
  } catch (error) {
    console.warn('⚠️ Could not emit WebSocket for lesson status change:', error.message);
  }
}

/**
 * Main function to auto-finalize eligible lessons
 */
async function autoFinalizeLessons() {
  try {
    const now = new Date();
    const Payment = require('../models/Payment');
    
    // Find lessons that should be completed but aren't
    // - Scheduled end time has passed
    // - Still in 'scheduled', 'in_progress', or 'ended_early' status
    const eligibleLessons = await Lesson.find({
      status: { $in: ['scheduled', 'in_progress', 'ended_early'] },
      endTime: { $lt: now } // End time is in the past
    }).limit(100); // Process max 100 at a time
    
    // 🆕 SAFETY NET: Also find 'completed' lessons with uncaptured payments
    // This catches race conditions where status changed to 'completed' without payment capture
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const completedWithUncapturedPayment = await Lesson.find({
      status: 'completed',
      endTime: { $lt: now, $gt: oneHourAgo }, // Completed within last hour
      paymentId: { $exists: true, $ne: null }
    }).populate('paymentId').limit(50);
    
    // Filter to only those with uncaptured payments
    const needsPaymentCapture = completedWithUncapturedPayment.filter(lesson => {
      const payment = lesson.paymentId;
      return payment && 
             payment.status === 'authorized' && 
             !payment.chargedAt && 
             lesson.actualCallStartTime; // Only if lesson actually happened
    });
    
    // Combine both lists
    const allLessonsToProcess = [...eligibleLessons, ...needsPaymentCapture];
    
    if (allLessonsToProcess.length === 0) {
      // No lessons to finalize - this is normal most of the time
      return;
    }
    
    if (needsPaymentCapture.length > 0) {
      console.log(`⚠️ [AutoFinalize] Found ${needsPaymentCapture.length} completed lessons with uncaptured payments (race condition recovery)`);
    }
    
    console.log(`🔍 [AutoFinalize] Found ${allLessonsToProcess.length} lessons to process (${eligibleLessons.length} pending + ${needsPaymentCapture.length} uncaptured)`);
    
    let finalizedCount = 0;
    let skippedCount = 0;
    let paymentsCaptured = 0;
    
    for (const lesson of allLessonsToProcess) {
      try {
        // Check if lesson has an active transcript
        const transcript = await LessonTranscript.findOne({ 
          lessonId: lesson._id 
        });
        
        // If transcript exists and is still being processed, skip
        // (autoCompleteTranscripts job will handle it)
        if (transcript && ['recording', 'processing'].includes(transcript.status)) {
          skippedCount++;
          continue;
        }
        
        // If transcript is already completed, skip
        // (lesson should have been finalized by autoCompleteTranscripts)
        if (transcript && transcript.status === 'completed') {
          // Transcript is done but lesson wasn't finalized - do it now
          console.log(`⚠️ [AutoFinalize] Lesson ${lesson._id} has completed transcript but wasn't finalized`);
        }
        
        // Special handling for already-completed lessons (race condition recovery)
        if (lesson.status === 'completed') {
          console.log(`🔧 [AutoFinalize] Processing completed lesson ${lesson._id} with uncaptured payment (race condition recovery)`);
          
          // Just capture the payment, don't change status
          if (lesson.paymentId) {
            const payment = await Payment.findById(lesson.paymentId);
            if (payment && payment.status === 'authorized') {
              console.log(`💳 [AutoFinalize] Capturing payment for race-condition lesson ${lesson._id}`);
              const paymentService = require('../services/paymentService');
              
              try {
                await paymentService.deductLessonFunds(lesson._id);
                await paymentService.completeLessonPayment(lesson._id);
                paymentsCaptured++;
                console.log(`✅ [AutoFinalize] Payment captured and completed for lesson ${lesson._id}`);
              } catch (paymentError) {
                console.error(`❌ [AutoFinalize] Payment capture failed for lesson ${lesson._id}:`, paymentError.message);
              }
            }
          }
          continue;
        }
        
        console.log(`✅ [AutoFinalize] Finalizing lesson ${lesson._id} without transcript`);
        console.log(`   Scheduled end: ${lesson.endTime}`);
        console.log(`   Current time: ${now.toISOString()}`);
        console.log(`   Has transcript: ${!!transcript}`);
        
        // Finalize the lesson
        await finalizeLesson(lesson, now);
        
        finalizedCount++;
        
      } catch (error) {
        console.error(`❌ [AutoFinalize] Error processing lesson ${lesson._id}:`, error.message);
        skippedCount++;
      }
    }
    
    if (finalizedCount > 0 || skippedCount > 0 || paymentsCaptured > 0) {
      console.log(`📊 [AutoFinalize] Summary: ${finalizedCount} finalized, ${paymentsCaptured} payments captured (race condition), ${skippedCount} skipped`);
    }
    
  } catch (error) {
    console.error('❌ [AutoFinalize] Error in autoFinalizeLessons job:', error);
  }
}

/**
 * Finalize a lesson - update status, calculate billing, set end time
 */
async function finalizeLesson(lesson, endTime = new Date()) {
  try {
    // Set actual call end time if not already set
    if (!lesson.actualCallEndTime) {
      lesson.actualCallEndTime = endTime;
      
      // Calculate actual duration if call was started
      if (lesson.actualCallStartTime) {
        const durationMs = endTime - new Date(lesson.actualCallStartTime);
        const actualMinutes = Math.ceil(durationMs / (1000 * 60)); // Round up to nearest minute
        lesson.actualDurationMinutes = actualMinutes;
        
        // Calculate actual price for office hours (per-minute billing)
        if (lesson.isOfficeHours) {
          const tutor = await User.findById(lesson.tutorId);
          const standardRate = tutor?.onboardingData?.hourlyRate || 25;
          const standardDuration = 50; // Standard lesson duration
          const perMinuteRate = standardRate / standardDuration;
          
          // Calculate actual price based on actual time used
          const calculatedPrice = Math.round(perMinuteRate * actualMinutes * 100) / 100;
          lesson.actualPrice = calculatedPrice;
          lesson.billingStatus = 'charged';
          
          const bookedMinutes = lesson.duration || 7;
          if (actualMinutes > bookedMinutes) {
            console.log(`💰 [AutoFinalize] Office hours billing: ${actualMinutes} minutes (${actualMinutes - bookedMinutes} min over) = $${lesson.actualPrice}`);
          } else {
            console.log(`💰 [AutoFinalize] Office hours billing: ${actualMinutes} minutes = $${lesson.actualPrice}`);
          }
        } else {
          // For regular lessons, use the full price
          lesson.actualPrice = lesson.price;
          lesson.billingStatus = 'charged';
        }
      } else {
        // NO CALL START TIME = Check individual attendance
        // This determines WHO showed up and applies cancellation policy
        
        const tutorShowed = !!lesson.tutorJoinedAt;
        const studentShowed = !!lesson.studentJoinedAt;
        
        console.log(`👥 [AutoFinalize] Attendance check: Tutor=${tutorShowed}, Student=${studentShowed}`);
        
        lesson.actualDurationMinutes = 0;
        
        if (!tutorShowed && !studentShowed) {
          // SCENARIO 1: Nobody showed up
          lesson.actualPrice = 0;
          lesson.billingStatus = 'no_show';
          lesson.status = 'cancelled';
          lesson.cancelledBy = 'system';
          lesson.cancelledAt = endTime;
          lesson.cancelReason = 'No-show by both parties';
          lesson.cancellationFeeCharged = 0;
          console.log(`❌ [AutoFinalize] BOTH no-show - Full refund to student`);
          
        } else if (tutorShowed && !studentShowed) {
          // SCENARIO 2: Tutor showed, student didn't
          // Charge 50% cancellation fee, pay tutor for wasted time
          const cancellationFee = lesson.price * 0.5;
          lesson.actualPrice = cancellationFee;
          lesson.billingStatus = 'charged';
          lesson.status = 'cancelled';
          lesson.cancelledBy = 'student';
          lesson.cancelledAt = endTime;
          lesson.cancelReason = 'Student no-show (tutor waited)';
          lesson.cancellationFeeCharged = cancellationFee;
          console.log(`⚠️  [AutoFinalize] STUDENT no-show - Charging 50% cancellation fee ($${cancellationFee}) to compensate tutor`);
          
        } else if (studentShowed && !tutorShowed) {
          // SCENARIO 3: Student showed, tutor didn't
          // Full refund to student, no payment to tutor
          lesson.actualPrice = 0;
          lesson.billingStatus = 'no_show';
          lesson.status = 'cancelled';
          lesson.cancelledBy = 'tutor';
          lesson.cancelledAt = endTime;
          lesson.cancelReason = 'Tutor no-show (student waited)';
          lesson.cancellationFeeCharged = 0;
          console.log(`⚠️  [AutoFinalize] TUTOR no-show - Full refund to student, tutor penalized`);
          
        } else {
          // SCENARIO 4: Both showed but actualCallStartTime wasn't set (edge case)
          // This shouldn't happen, but treat as completed
          console.log(`⚠️  [AutoFinalize] Both showed but actualCallStartTime not set - treating as completed`);
          lesson.actualPrice = lesson.price;
          lesson.billingStatus = 'charged';
        }
      }
    }
    
    // Update lesson status (completed if it happened, cancelled if no-show)
    if (!lesson.status || lesson.status === 'scheduled' || lesson.status === 'in_progress' || lesson.status === 'ended_early') {
      lesson.status = lesson.actualCallStartTime ? 'completed' : 'cancelled';
    }
    
    await lesson.save();
    console.log(`✅ [AutoFinalize] Lesson ${lesson._id} finalized: status=${lesson.status}, duration=${lesson.actualDurationMinutes}min, price=$${lesson.actualPrice}`);
    
    // Emit WebSocket event for lesson status change
    emitStatusChange(lesson._id, lesson.status, lesson.tutorId, lesson.studentId);
    
    // 💰 HANDLE PAYMENT BASED ON LESSON OUTCOME
    if (lesson.paymentId) {
      try {
        const Payment = require('../models/Payment');
        const payment = await Payment.findById(lesson.paymentId);
        const alertService = require('../services/alertService');
        
        if (!payment) {
          console.error(`❌ [AutoFinalize] Payment ${lesson.paymentId} not found for lesson ${lesson._id}`);
          return;
        }
        
        // CASE 1: Lesson completed successfully (both showed up)
        if (lesson.actualCallStartTime && lesson.status === 'completed') {
          // Capture full payment
          if (payment.status === 'authorized') {
            console.log(`💳 [AutoFinalize] Capturing full payment for completed lesson ${lesson._id}`);
            const paymentService = require('../services/paymentService');
            try {
              await paymentService.deductLessonFunds(lesson._id);
              console.log(`✅ [AutoFinalize] Payment captured for lesson ${lesson._id}`);
            } catch (captureError) {
              console.error(`❌ [AutoFinalize] Payment capture failed for lesson ${lesson._id}:`, captureError.message);
              throw captureError;
            }
          }
          
          // Complete payment (revenue recognition + tutor payout)
          const paymentService = require('../services/paymentService');
          await paymentService.completeLessonPayment(lesson._id);
          console.log(`✅ [AutoFinalize] Payment completed (payout sent) for lesson ${lesson._id}`);
        }
        
        // CASE 2: Both no-show - full refund
        else if (lesson.cancelReason === 'No-show by both parties') {
          console.log(`🔄 [AutoFinalize] Both no-show - releasing full payment for lesson ${lesson._id}`);
          await releasePayment(payment, lesson);
        }
        
        // CASE 3: Student no-show - charge 50% cancellation fee
        else if (lesson.cancelledBy === 'student' && lesson.cancellationFeeCharged > 0) {
          console.log(`💳 [AutoFinalize] Student no-show - capturing 50% cancellation fee ($${lesson.cancellationFeeCharged})`);
          await capturePartialPayment(payment, lesson, 0.5);
          
          // Create alert for tutor compensation
          await alertService.createAlert({
            type: 'STUDENT_NO_SHOW',
            severity: 'MEDIUM',
            title: `Student no-show - Lesson ${lesson._id}`,
            description: `Student did not attend lesson. Tutor waited. 50% cancellation fee ($${lesson.cancellationFeeCharged}) charged and paid to tutor.`,
            lessonId: lesson._id,
            userId: lesson.studentId,
            data: {
              tutorName: lesson.tutorId?.name,
              studentName: lesson.studentId?.name,
              cancellationFee: lesson.cancellationFeeCharged,
              lessonPrice: lesson.price
            }
          });
        }
        
        // CASE 4: Tutor no-show - full refund + alert
        else if (lesson.cancelledBy === 'tutor') {
          console.log(`🚫 [AutoFinalize] Tutor no-show - full refund for lesson ${lesson._id}`);
          await releasePayment(payment, lesson);
          
          // Create alert for tutor no-show (needs manual review/penalty)
          await alertService.createAlert({
            type: 'TUTOR_NO_SHOW',
            severity: 'HIGH',
            title: `Tutor no-show - Lesson ${lesson._id}`,
            description: `Tutor did not attend lesson. Student waited. Full refund issued. Consider tutor penalty.`,
            lessonId: lesson._id,
            userId: lesson.tutorId,
            data: {
              tutorName: lesson.tutorId?.name,
              studentName: lesson.studentId?.name,
              lessonPrice: lesson.price,
              tutorEmail: lesson.tutorId?.email
            }
          });
        }
        
      } catch (paymentError) {
        console.error(`❌ [AutoFinalize] Payment processing failed for lesson ${lesson._id}:`, paymentError.message);
        console.error(`❌ [AutoFinalize] Full payment error:`, paymentError);
      }
    }
    
  } catch (error) {
    console.error(`❌ [AutoFinalize] Error finalizing lesson ${lesson._id}:`, error.message);
    throw error;
  }
}

/**
 * Release payment (cancel authorization or refund)
 */
async function releasePayment(payment, lesson) {
  if (payment.status === 'authorized' && payment.stripePaymentIntentId) {
    console.log(`💳 Canceling Stripe PaymentIntent ${payment.stripePaymentIntentId}`);
    
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    try {
      await stripe.paymentIntents.cancel(payment.stripePaymentIntentId);
      payment.status = 'refunded';
      await payment.save();
      console.log(`✅ Payment released (authorization cancelled)`);
    } catch (cancelError) {
      console.error(`❌ Failed to cancel PaymentIntent:`, cancelError.message);
      throw cancelError;
    }
  } else if (payment.status === 'authorized' && payment.paymentMethod === 'wallet') {
    // Release wallet funds
    console.log(`💰 Releasing wallet funds`);
    const walletService = require('../services/walletService');
    await walletService.releaseFunds({
      userId: lesson.studentId,
      lessonId: lesson._id,
      amount: payment.amount
    });
    payment.status = 'refunded';
    await payment.save();
    console.log(`✅ Wallet funds released`);
  } else {
    console.log(`ℹ️  Payment status is ${payment.status}, no release needed`);
  }
}

/**
 * Capture partial payment (for cancellation fees)
 */
async function capturePartialPayment(payment, lesson, percentage) {
  const partialAmount = Math.round(lesson.price * percentage * 100) / 100;
  
  if (payment.status === 'authorized' && payment.stripePaymentIntentId) {
    console.log(`💳 Capturing ${percentage * 100}% ($${partialAmount}) of Stripe PaymentIntent`);
    
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    try {
      // Capture partial amount (in cents)
      const capturedIntent = await stripe.paymentIntents.capture(
        payment.stripePaymentIntentId,
        { amount_to_capture: Math.round(partialAmount * 100) }
      );
      
      if (capturedIntent.status === 'succeeded') {
        payment.status = 'succeeded';
        payment.chargedAt = new Date();
        payment.amount = partialAmount; // Update to actual charged amount
        await payment.save();
        console.log(`✅ Partial payment captured: $${partialAmount}`);
        
        // Complete payment to send to tutor (as compensation)
        const paymentService = require('../services/paymentService');
        await paymentService.completeLessonPayment(lesson._id);
        console.log(`✅ Cancellation fee paid to tutor`);
      } else {
        throw new Error(`Partial capture failed: status ${capturedIntent.status}`);
      }
    } catch (captureError) {
      console.error(`❌ Failed to capture partial payment:`, captureError.message);
      // Fall back to full release if partial capture fails
      console.log(`⚠️  Falling back to full refund`);
      await releasePayment(payment, lesson);
    }
  } else if (payment.status === 'authorized' && payment.paymentMethod === 'wallet') {
    // For wallet, deduct partial amount
    console.log(`💰 Deducting ${percentage * 100}% ($${partialAmount}) from wallet`);
    const walletService = require('../services/walletService');
    await walletService.deductFunds({
      userId: lesson.studentId,
      lessonId: lesson._id,
      amount: partialAmount,
      paymentId: payment._id
    });
    payment.status = 'succeeded';
    payment.chargedAt = new Date();
    payment.amount = partialAmount;
    await payment.save();
    console.log(`✅ Partial wallet payment deducted`);
    
    // Complete payment to send to tutor
    const paymentService = require('../services/paymentService');
    await paymentService.completeLessonPayment(lesson._id);
    console.log(`✅ Cancellation fee paid to tutor`);
  }
}

module.exports = { autoFinalizeLessons };

