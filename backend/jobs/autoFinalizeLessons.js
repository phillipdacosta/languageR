/**
 * Auto-finalize lessons that have ended but don't have transcripts
 * 
 * This job runs every minute and:
 * 1. Finds lessons that have passed their scheduled end time
 * 2. Are still in 'scheduled' or 'in_progress' status
 * 3. Don't have a transcript (or transcript was never started)
 * 4. Automatically finalizes the lesson (billing, status)
 * 
 * SCALABILITY FEATURES:
 * - Processes in batches of 100
 * - Max 1000 per run (prevents overload)
 * - Continues on individual failures
 * - Logs errors for manual review
 * 
 * Use case: User closes browser without clicking "End Call" and no transcript was recorded
 */

const Lesson = require('../models/Lesson');
const LessonTranscript = require('../models/LessonTranscript');
const User = require('../models/User');
const Notification = require('../models/Notification');
const TutorFeedback = require('../models/TutorFeedback');
const alertService = require('../services/alertService');

// Configuration
const BATCH_SIZE = 100; // Process 100 lessons at a time
const MAX_PER_RUN = 1000; // Maximum lessons to process in a single run

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

    // Emit to both tutor and student (room-based, reaches all devices)
    if (tutorId) {
      io.to(`mongo:${tutorId.toString()}`).emit('lesson_status_changed', payload);
    }
    if (studentId) {
      io.to(`mongo:${studentId.toString()}`).emit('lesson_status_changed', payload);
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
  console.log('\n========================================');
  console.log('🔄 [CRON] Auto-Finalize Lessons Job Started');
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log(`   Batch Size: ${BATCH_SIZE}, Max Per Run: ${MAX_PER_RUN}`);
  console.log('========================================\n');
  
  try {
    const now = new Date();
    const Payment = require('../models/Payment');
    
    let totalProcessed = 0;
    let finalizedCount = 0;
    let skippedCount = 0;
    let paymentsCaptured = 0;
    let failedCount = 0;
    
    // Process in batches
    while (totalProcessed < MAX_PER_RUN) {
      // Find lessons that should be completed but aren't
      // - Scheduled end time has passed
      // - Still in 'scheduled', 'in_progress', or 'ended_early' status
      const eligibleLessons = await Lesson.find({
        status: { $in: ['scheduled', 'in_progress', 'ended_early'] },
        endTime: { $lt: now } // End time is in the past
      }).limit(BATCH_SIZE);
      
      // 🆕 SAFETY NET: Also find 'completed' lessons with uncaptured payments
      // This catches race conditions where status changed to 'completed' without payment capture
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const completedWithUncapturedPayment = await Lesson.find({
        status: 'completed',
        endTime: { $lt: now, $gt: oneHourAgo }, // Completed within last hour
        paymentId: { $exists: true, $ne: null }
      }).populate('paymentId').limit(Math.min(50, BATCH_SIZE - eligibleLessons.length));
      
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
        console.log('✅ No lessons to finalize at this time');
        break;
      }
      
      if (needsPaymentCapture.length > 0) {
        console.log(`⚠️ [AutoFinalize] Found ${needsPaymentCapture.length} completed lessons with uncaptured payments (race condition recovery)`);
      }
      
      console.log(`📦 Processing batch of ${allLessonsToProcess.length} lessons (${eligibleLessons.length} pending + ${needsPaymentCapture.length} uncaptured)`);
      
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
                  failedCount++;
                }
              }
            }
            totalProcessed++;
            continue;
          }
          
          console.log(`✅ [AutoFinalize] Finalizing lesson ${lesson._id} without transcript`);
          console.log(`   Scheduled end: ${lesson.endTime}`);
          console.log(`   Current time: ${now.toISOString()}`);
          console.log(`   Has transcript: ${!!transcript}`);
          
          // Finalize the lesson
          await finalizeLesson(lesson, now);

          // Resolve any `pending` LessonAnalysis placeholder. There's no
          // transcript or it failed, so the real analyzer will never run
          // — leaving the row pending would strand the lesson card on a
          // perpetual "Generating analysis…" spinner.
          try {
            const LessonAnalysis = require('../models/LessonAnalysis');
            await LessonAnalysis.updateOne(
              { lessonId: lesson._id, status: { $in: ['pending', 'processing'] } },
              { $set: { status: 'insufficient_data', error: 'No usable transcript for analysis.' } }
            );
          } catch (analysisErr) {
            console.warn(`⚠️ [AutoFinalize] Failed to clear pending analysis for ${lesson._id}: ${analysisErr.message}`);
          }

          finalizedCount++;
          totalProcessed++;
          
        } catch (error) {
          console.error(`❌ [AutoFinalize] Error processing lesson ${lesson._id}:`, error.message);
          skippedCount++;
          failedCount++;
          
          // Alert if there are many failures
          if (failedCount >= 10) {
            await alertService.createAlert({
              type: 'LESSON_FINALIZATION_ERRORS',
              severity: 'MEDIUM',
              title: `Multiple Lesson Finalization Failures`,
              description: `${failedCount} lessons failed to finalize in this run. Check logs for details.`,
              data: {
                failedCount,
                jobName: 'autoFinalizeLessons',
                timestamp: new Date().toISOString()
              }
            });
          }
        }
      }
      
      // If we got less than BATCH_SIZE, we've processed everything
      if (allLessonsToProcess.length < BATCH_SIZE) {
        console.log(`\n✅ Processed all available lessons (batch was not full)`);
        break;
      }
      
      // Safety check: if we've processed MAX_PER_RUN, stop
      if (totalProcessed >= MAX_PER_RUN) {
        console.log(`\n⚠️  Reached max per run limit (${MAX_PER_RUN}), stopping`);
        break;
      }
    }
    
    console.log('\n========================================');
    console.log(`✅ [CRON] Auto-Finalize Lessons Job Completed`);
    console.log(`   ✅ Finalized: ${finalizedCount} lessons`);
    console.log(`   💳 Payments Captured: ${paymentsCaptured} (race condition)`);
    console.log(`   ⏭️  Skipped: ${skippedCount} lessons`);
    console.log(`   ❌ Failed: ${failedCount} lessons`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log('========================================\n');
    
    return {
      success: true,
      finalizedCount,
      paymentsCaptured,
      skippedCount,
      failedCount
    };
    
  } catch (error) {
    console.error('❌ [CRON] Auto-Finalize Lessons Job Failed:', error);
    
    // Create critical alert for job-level failure
    await alertService.createAlert({
      type: 'CRON_JOB_FAILED',
      severity: 'CRITICAL',
      title: 'Auto-Finalize Lessons Job Failed',
      description: `The auto-finalize lessons cron job failed completely. Error: ${error.message}`,
      data: {
        jobName: 'autoFinalizeLessons',
        error: error.message,
        stack: error.stack
      }
    });
    
    throw error;
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
          const standardRate = Math.max(10, tutor?.onboardingData?.hourlyRate || 25);
          const standardDuration = 50; // Standard lesson duration
          const perMinuteRate = standardRate / standardDuration;
          
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
    
    // 📬 SEND NOTIFICATIONS IF LESSON COMPLETED SUCCESSFULLY
    if (lesson.status === 'completed' && lesson.actualCallStartTime) {
      try {
        // Get populated lesson data for notification messages
        const populatedLesson = await Lesson.findById(lesson._id)
          .populate('tutorId', 'name firstName lastName picture auth0Id')
          .populate('studentId', 'name firstName lastName picture auth0Id profile');
        
        if (populatedLesson) {
          const tutor = populatedLesson.tutorId;
          const student = populatedLesson.studentId;
          
          // Format names
          const tutorName = tutor.firstName || tutor.name?.split(' ')[0] || 'Your tutor';
          const studentName = student.firstName || student.name?.split(' ')[0] || 'Your student';
          
          // Trial lessons have no AI analysis or tipping — skip completion nudges.
          if (!populatedLesson.isTrialLesson) {
            // Notification for STUDENT - Analysis is available
            await Notification.create({
              userId: student._id,
              type: 'lesson_completed',
              title: '📊 Lesson Completed',
              message: `Your lesson with ${tutorName} has ended. View your lesson analysis and leave a tip!`,
              relatedUserPicture: tutor.picture || null,
              data: {
                lessonId: lesson._id.toString(),
                action: 'view_analysis',
                tutorName: tutorName
              }
            });
            console.log(`📬 [AutoFinalize] Sent completion notification to student ${student._id}`);

            // Notification for TUTOR - Leave feedback
            await Notification.create({
              userId: tutor._id,
              type: 'feedback_reminder',
              title: '📝 Leave Feedback',
              message: `Your lesson with ${studentName} has ended. Leave feedback for your student!`,
              relatedUserPicture: student.picture || null,
              data: {
                lessonId: lesson._id.toString(),
                action: 'add_note',
                studentName: studentName
              }
            });
            console.log(`📬 [AutoFinalize] Sent feedback reminder to tutor ${tutor._id}`);

            // Emit WebSocket notifications
            try {
              const io = require('../server').getIO();
              if (io) {
                // Notify student (room-based, reaches all devices)
                io.to(`mongo:${student._id.toString()}`).emit('lesson_completed_notification', {
                  lessonId: lesson._id.toString(),
                  tutorName: tutorName,
                  action: 'view_analysis'
                });

                // Notify tutor
                io.to(`mongo:${tutor._id.toString()}`).emit('feedback_reminder', {
                  lessonId: lesson._id.toString(),
                  studentName: studentName,
                  action: 'add_note'
                });
              }
            } catch (wsError) {
              console.warn('⚠️ [AutoFinalize] WebSocket notification failed:', wsError.message);
            }
          } else {
            console.log(`⏭️ [AutoFinalize] Skipping completion notifications — trial lesson ${lesson._id}`);
          }

          // 📝 CREATE PENDING TUTOR FEEDBACK FOR ALL COMPLETED LESSONS
          // Skip for trial lessons
          if (!populatedLesson.isTrialLesson) {
            // Snapshot the student's AI setting at lesson completion time (immutable once set)
            if (populatedLesson.aiAnalysisEnabledAtTime === null || populatedLesson.aiAnalysisEnabledAtTime === undefined) {
              const snapshotValue = student?.profile?.aiAnalysisEnabled !== false;
              populatedLesson.aiAnalysisEnabledAtTime = snapshotValue;
              await populatedLesson.save();
              console.log(`📸 [AutoFinalize] Snapshotted aiAnalysisEnabledAtTime=${snapshotValue} for lesson ${lesson._id}`);
            }
            
            // Create TutorFeedback record only when AI analysis is disabled (feedback is required)
            const aiEnabledForLesson = populatedLesson.aiAnalysisEnabledAtTime !== false;
            try {
              const feedbackExists = await TutorFeedback.findOne({ lessonId: lesson._id });
              
              if (!feedbackExists && !aiEnabledForLesson) {
                await TutorFeedback.create({
                  lessonId: lesson._id,
                  tutorId: tutor._id,
                  studentId: student._id,
                  status: 'pending',
                  required: true
                });
                
                populatedLesson.requiresTutorFeedback = true;
                await populatedLesson.save();
                
                const feedbackMessages = [
                  { title: '📝 Lesson Feedback Needed', message: `Your lesson with ${studentName} just ended — leave your feedback while it's fresh!` },
                  { title: '✍️ Share Your Insights', message: `${studentName} is waiting for your feedback from today's lesson!` },
                  { title: '💭 Time to Reflect', message: `Quick! Share what went well in your lesson with ${studentName}.` },
                  { title: '📊 Feedback Time', message: `Help ${studentName} improve — leave feedback for today's lesson!` }
                ];
                const randomMsg = feedbackMessages[Math.floor(Math.random() * feedbackMessages.length)];
                
                try {
                  await Notification.create({
                    userId: tutor._id,
                    type: 'feedback_required',
                    title: randomMsg.title,
                    message: randomMsg.message,
                    relatedUserId: student._id,
                    relatedUserPicture: student.picture || null,
                    data: {
                      lessonId: lesson._id.toString(),
                      studentName: studentName,
                      studentAuth0Id: student.auth0Id
                    }
                  });
                } catch (notifErr) {
                  console.warn('⚠️ [AutoFinalize] Notification creation failed:', notifErr.message);
                }
                
                try {
                  const io = require('../server').getIO();
                  if (io && tutor.auth0Id) {
                    io.to(`user:${tutor.auth0Id}`).emit('feedback_required', {
                      lessonId: lesson._id.toString(),
                      studentName: studentName,
                      title: randomMsg.title,
                      message: randomMsg.message
                    });
                  }
                } catch (wsErr) {
                  console.warn('⚠️ [AutoFinalize] feedback_required WebSocket failed:', wsErr.message);
                }
                
                console.log(`✅ [AutoFinalize] Created TutorFeedback for lesson ${lesson._id}`);
              } else {
                console.log(`ℹ️ [AutoFinalize] TutorFeedback already exists for lesson ${lesson._id}`);
              }
            } catch (fbError) {
              console.error('⚠️ [AutoFinalize] Failed to create TutorFeedback:', fbError.message);
            }
          }
        }
      } catch (notifError) {
        console.error('⚠️ [AutoFinalize] Failed to send notifications:', notifError.message);
        // Don't throw - notifications failing shouldn't break the finalization
      }
    }
    
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
          // Check for anomalously short lessons (< 5 min for lessons >= 15 min scheduled)
          const scheduledDuration = lesson.duration || 25;
          const actualDuration = lesson.actualDurationMinutes || 0;
          const shortLessonThreshold = Math.min(5, scheduledDuration * 0.2); // 5 min or 20% of scheduled, whichever is smaller
          const isAnomalouslyShort = scheduledDuration >= 15 && actualDuration > 0 && actualDuration < shortLessonThreshold;

          if (isAnomalouslyShort) {
            // AUTO-FLAG: Lesson was too short — hold payment for admin review
            console.log(`🚩 [AutoFinalize] FLAGGED: Lesson ${lesson._id} was only ${actualDuration} min (scheduled: ${scheduledDuration} min) — auto-holding for review`);
            
            // Capture the payment first
            if (payment.status === 'authorized') {
              const paymentService = require('../services/paymentService');
              try {
                await paymentService.deductLessonFunds(lesson._id);
                console.log(`✅ [AutoFinalize] Payment captured for flagged lesson ${lesson._id}`);
              } catch (captureError) {
                console.error(`❌ [AutoFinalize] Payment capture failed for lesson ${lesson._id}:`, captureError.message);
                throw captureError;
              }
            }
            
            // Complete payment (puts it on_hold for tutor) but also flag for admin
            const paymentService = require('../services/paymentService');
            await paymentService.completeLessonPayment(lesson._id);
            
            // Auto-flag the lesson and pause payout
            lesson.autoFlaggedShortLesson = true;
            lesson.autoFlagReason = `Actual duration ${actualDuration} min vs ${scheduledDuration} min scheduled`;
            lesson.payoutPaused = true;
            lesson.payoutPausedAt = new Date();
            lesson.underInvestigation = true;
            lesson.issueReported = true;
            lesson.issueType = 'ended_early';
            lesson.issueDetails = `Auto-flagged: Lesson lasted only ${actualDuration} minute(s) out of ${scheduledDuration} minutes scheduled. Payment held for admin review.`;
            lesson.issueReportedAt = new Date();
            await lesson.save();
            
            // Create admin alert
            await alertService.createAlert({
              type: 'SHORT_LESSON_FLAGGED',
              severity: 'HIGH',
              title: `Auto-flagged short lesson — ${actualDuration} min of ${scheduledDuration} min`,
              description: `Lesson ${lesson._id} between tutor and student lasted only ${actualDuration} minute(s) out of ${scheduledDuration} minutes scheduled. Payment has been auto-held for admin review.`,
              lessonId: lesson._id,
              data: {
                actualDuration,
                scheduledDuration,
                tutorId: lesson.tutorId?._id || lesson.tutorId,
                studentId: lesson.studentId?._id || lesson.studentId,
                lessonPrice: lesson.price
              }
            });
            
            console.log(`✅ [AutoFinalize] Short lesson flagged and payout paused for lesson ${lesson._id}`);
          } else {
            // Normal completion — capture and complete payment
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
    await walletService.releaseReservedFunds({
      userId: lesson.studentId,
      lessonId: lesson._id,
      amount: payment.amount,
      reason: 'no_show_both_parties'
    });
    payment.status = 'cancelled';
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

