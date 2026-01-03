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

/**
 * Main function to auto-finalize eligible lessons
 */
async function autoFinalizeLessons() {
  try {
    const now = new Date();
    
    // Find lessons that should be completed but aren't
    // - Scheduled end time has passed
    // - Still in 'scheduled' or 'in_progress' status
    const eligibleLessons = await Lesson.find({
      status: { $in: ['scheduled', 'in_progress'] },
      endTime: { $lt: now } // End time is in the past
    }).limit(100); // Process max 100 at a time
    
    if (eligibleLessons.length === 0) {
      // No lessons to finalize - this is normal most of the time
      return;
    }
    
    console.log(`🔍 [AutoFinalize] Found ${eligibleLessons.length} lessons past end time to check`);
    
    let finalizedCount = 0;
    let skippedCount = 0;
    
    for (const lesson of eligibleLessons) {
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
    
    if (finalizedCount > 0 || skippedCount > 0) {
      console.log(`📊 [AutoFinalize] Summary: ${finalizedCount} finalized, ${skippedCount} skipped`);
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
        // No call start time recorded - use scheduled duration and price
        lesson.actualDurationMinutes = lesson.duration;
        lesson.actualPrice = lesson.price;
        lesson.billingStatus = 'charged';
        console.log(`💰 [AutoFinalize] No call start time - using scheduled duration: ${lesson.duration}min, price: $${lesson.price}`);
      }
    }
    
    // Update lesson status to completed
    lesson.status = 'completed';
    
    await lesson.save();
    console.log(`✅ [AutoFinalize] Lesson ${lesson._id} finalized: status=${lesson.status}, duration=${lesson.actualDurationMinutes}min, price=$${lesson.actualPrice}`);
    
    // Mark payment as succeeded when lesson completes
    if (lesson.paymentId) {
      const Payment = require('../models/Payment');
      const payment = await Payment.findById(lesson.paymentId);
      if (payment && payment.status === 'authorized') {
        payment.status = 'succeeded';
        payment.chargedAt = endTime;
        await payment.save();
        console.log(`💳 [AutoFinalize] Payment ${payment._id} marked as succeeded`);
      }
    }
    
  } catch (error) {
    console.error(`❌ [AutoFinalize] Error finalizing lesson ${lesson._id}:`, error.message);
    throw error;
  }
}

module.exports = { autoFinalizeLessons };

