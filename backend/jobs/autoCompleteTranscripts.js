/**
 * Auto-complete transcripts for lessons that have ended
 * 
 * This job runs every minute and:
 * 1. Finds lessons that have passed their scheduled end time
 * 2. Have transcripts in 'recording' or 'processing' status
 * 3. Automatically completes the transcript
 * 4. Finalizes the lesson (status, billing)
 * 5. Triggers AI analysis
 * 
 * Use case: Student dismisses early exit modal and never returns
 * The lesson will be auto-finalized at scheduled end time
 */

const LessonTranscript = require('../models/LessonTranscript');
const Lesson = require('../models/Lesson');
const LessonAnalysis = require('../models/LessonAnalysis');
const User = require('../models/User');
const { analyzeLesson } = require('../routes/transcription');

/**
 * Main function to auto-complete eligible transcripts
 */
async function autoCompleteTranscripts() {
  try {
    const now = new Date();
    
    // Find all transcripts in 'recording' or 'processing' status
    const activeTranscripts = await LessonTranscript.find({
      status: { $in: ['recording', 'processing'] }
    }).limit(100); // Process max 100 at a time to avoid overwhelming
    
    if (activeTranscripts.length === 0) {
      // No active transcripts - this is normal most of the time
      return;
    }
    
    console.log(`🔍 [AutoComplete] Found ${activeTranscripts.length} active transcripts to check`);
    
    let completedCount = 0;
    let skippedCount = 0;
    
    for (const transcript of activeTranscripts) {
      try {
        // Get lesson details
        const lesson = await Lesson.findById(transcript.lessonId);
        
        if (!lesson) {
          console.warn(`⚠️ [AutoComplete] Transcript ${transcript._id} has no lesson, skipping`);
          skippedCount++;
          continue;
        }
        
        // Check if lesson has ended (scheduled end time has passed)
        const scheduledEndTime = new Date(lesson.endTime);
        const hasEnded = now >= scheduledEndTime;
        
        if (!hasEnded) {
          // Lesson still ongoing - skip
          skippedCount++;
          continue;
        }
        
        // Check if transcript has any student segments
        const studentSegments = transcript.segments.filter(s => s.speaker === 'student');
        
        if (studentSegments.length === 0) {
          console.warn(`⚠️ [AutoComplete] Transcript ${transcript._id} has no student segments, marking as failed`);
          transcript.status = 'failed';
          await transcript.save();
          skippedCount++;
          continue;
        }
        
        console.log(`✅ [AutoComplete] Lesson ${lesson._id} ended, completing transcript ${transcript._id}`);
        console.log(`   Scheduled end: ${scheduledEndTime.toISOString()}`);
        console.log(`   Current time: ${now.toISOString()}`);
        console.log(`   Student segments: ${studentSegments.length}`);
        
        // 1. Complete the transcript
        transcript.endTime = now;
        transcript.status = 'completed';
        
        // Calculate metadata
        const tutorSegments = transcript.segments.filter(s => s.speaker === 'tutor');
        const totalDuration = (now - transcript.startTime) / 1000; // seconds
        const wordCount = studentSegments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
        
        transcript.metadata = {
          totalDuration,
          studentSpeakingTime: studentSegments.length * 10, // rough estimate
          tutorSpeakingTime: tutorSegments.length * 10,
          wordCount
        };
        
        // Populate fullText from segments (required for audio slicing)
        transcript.fullText = transcript.segments.map(s => s.text).join(' ');
        console.log(`📝 [AutoComplete] Populated fullText: ${transcript.fullText.length} characters`);
        
        await transcript.save();
        console.log(`💾 [AutoComplete] Transcript ${transcript._id} marked as completed`);
        
        // 2. Finalize the lesson (status, billing, etc.)
        await finalizeLesson(lesson, now);
        
        // 3. Check if analysis already exists
        const existingAnalysis = await LessonAnalysis.findOne({ lessonId: lesson._id });
        
        if (existingAnalysis) {
          console.log(`ℹ️  [AutoComplete] Analysis already exists for lesson ${lesson._id} (status: ${existingAnalysis.status}), skipping analysis generation`);
        } else {
          // 3. Trigger analysis in background (don't await - let it run async)
          console.log(`🤖 [AutoComplete] Triggering AI analysis for lesson ${lesson._id}...`);
          analyzeLesson(transcript._id).catch(err => {
            console.error(`❌ [AutoComplete] Error analyzing transcript ${transcript._id}:`, err.message);
          });
        }
        
        completedCount++;
        
      } catch (error) {
        console.error(`❌ [AutoComplete] Error processing transcript ${transcript._id}:`, error.message);
        skippedCount++;
      }
    }
    
    if (completedCount > 0 || skippedCount > 0) {
      console.log(`📊 [AutoComplete] Summary: ${completedCount} completed, ${skippedCount} skipped`);
    }
    
  } catch (error) {
    console.error('❌ [AutoComplete] Error in autoCompleteTranscripts job:', error);
  }
}

/**
 * Finalize a lesson - update status, calculate billing, set end time
 * This is the same logic as the /call-end endpoint
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
            console.log(`💰 [AutoComplete] Office hours billing: ${actualMinutes} minutes (${actualMinutes - bookedMinutes} min over) = $${lesson.actualPrice}`);
          } else {
            console.log(`💰 [AutoComplete] Office hours billing: ${actualMinutes} minutes = $${lesson.actualPrice}`);
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
      }
    }
    
    // Update lesson status to completed
    lesson.status = 'completed';
    
    await lesson.save();
    console.log(`✅ [AutoComplete] Lesson ${lesson._id} finalized: status=${lesson.status}, duration=${lesson.actualDurationMinutes}min, price=$${lesson.actualPrice}`);
    
    // Mark payment as succeeded when lesson completes
    if (lesson.paymentId) {
      const Payment = require('../models/Payment');
      const payment = await Payment.findById(lesson.paymentId);
      if (payment && payment.status === 'authorized') {
        payment.status = 'succeeded';
        payment.chargedAt = endTime;
        await payment.save();
        console.log(`💳 [AutoComplete] Payment ${payment._id} marked as succeeded`);
      }
    }
    
  } catch (error) {
    console.error(`❌ [AutoComplete] Error finalizing lesson ${lesson._id}:`, error.message);
    throw error;
  }
}

module.exports = { autoCompleteTranscripts };

