const cron = require('node-cron');
const audioBackupService = require('../services/audioBackupService');
const transcriptionRetryService = require('../services/transcriptionRetryService');
const analysisRetryService = require('../services/analysisRetryService');

/**
 * Cron job to cleanup expired audio backups
 * Runs every 6 hours
 */
function startAudioCleanupCron() {
  // Run every 6 hours at minute 0
  cron.schedule('0 */6 * * *', async () => {
    console.log('🧹 [CRON] Starting audio backup cleanup...');
    
    try {
      const result = await audioBackupService.cleanupExpiredAudio();
      console.log(`🧹 [CRON] Cleanup complete: ${result.deleted} files deleted, ${result.errors} errors`);
      
      // Also get storage stats
      const stats = await audioBackupService.getStorageStats();
      console.log(`📊 [CRON] Current storage: ${stats.totalFiles} files, ${stats.totalSizeMB} MB`);
    } catch (error) {
      console.error('❌ [CRON] Error in cleanup job:', error);
    }
  });
  
  console.log('✅ Audio cleanup cron job scheduled (every 6 hours)');
}

/**
 * Cron job to retry failed transcriptions
 * Runs every hour
 */
function startTranscriptionRetryCron() {
  // Run every hour at minute 15
  cron.schedule('15 * * * *', async () => {
    console.log('🔄 [CRON] Starting transcription retry...');
    
    try {
      const result = await transcriptionRetryService.retryFailedTranscriptions(3);
      console.log(`🔄 [CRON] Retry complete: ${result.retried} retried, ${result.succeeded} succeeded, ${result.failed} failed`);
      
      // Also get stats
      const stats = await transcriptionRetryService.getRetryStats();
      console.log(`📊 [CRON] Pending retries: ${stats.pendingRetries}, Failed chunks: ${stats.failedChunks}`);
    } catch (error) {
      console.error('❌ [CRON] Error in retry job:', error);
    }
  });
  
  console.log('✅ Transcription retry cron job scheduled (every hour)');
}

/**
 * Cron job to retry failed GPT-4 analyses
 * Runs every hour (offset from transcription retry)
 */
function startAnalysisRetryCron() {
  // Run every hour at minute 30
  cron.schedule('30 * * * *', async () => {
    console.log('🔄 [CRON] Starting analysis retry...');
    
    try {
      const result = await analysisRetryService.retryFailedAnalyses(3);
      console.log(`🔄 [CRON] Analysis retry complete: ${result.retried} retried, ${result.succeeded} succeeded, ${result.failed} failed`);
      
      // Also get stats
      const stats = await analysisRetryService.getAnalysisRetryStats();
      console.log(`📊 [CRON] Pending analysis retries: ${stats.pendingRetries}, Permanently failed: ${stats.permanentlyFailed}`);
    } catch (error) {
      console.error('❌ [CRON] Error in analysis retry job:', error);
    }
  });
  
  console.log('✅ Analysis retry cron job scheduled (every hour)');
}

/**
 * Cron job to rescue "stuck" transcripts that have audio but were never completed.
 * This catches the edge case where the frontend navigates away before completeTranscription fires.
 * Runs every 15 minutes.
 */
function startStuckTranscriptionCron() {
  cron.schedule('*/15 * * * *', async () => {
    console.log('🩹 [CRON] Checking for stuck transcripts...');
    
    try {
      const LessonTranscript = require('../models/LessonTranscript');
      const Lesson = require('../models/Lesson');
      
      // Find transcripts stuck in "processing" for more than 10 minutes
      // that have segments (audio was uploaded and transcribed) but never got "completed"
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      
      const stuckTranscripts = await LessonTranscript.find({
        status: 'processing',
        startTime: { $lt: tenMinutesAgo },
        'segments.0': { $exists: true } // Has at least 1 segment (audio was processed)
      });
      
      if (stuckTranscripts.length === 0) {
        console.log('🩹 [CRON] No stuck transcripts found');
        return;
      }
      
      console.log(`🩹 [CRON] Found ${stuckTranscripts.length} stuck transcript(s) — attempting to complete them`);
      
      for (const transcript of stuckTranscripts) {
        try {
          // Verify the lesson is completed or in_progress (not cancelled)
          const lesson = await Lesson.findById(transcript.lessonId);
          if (!lesson || lesson.status === 'cancelled') {
            console.log(`⏭️ [CRON] Skipping transcript ${transcript._id} — lesson cancelled or missing`);
            continue;
          }
          
          // Populate fullText from segments
          transcript.fullText = transcript.segments.map(s => s.text).join(' ');
          transcript.status = 'completed';
          transcript.endTime = new Date();
          
          const studentSegments = transcript.segments.filter(s => s.speaker === 'student');
          const tutorSegments = transcript.segments.filter(s => s.speaker === 'tutor');
          transcript.metadata = {
            totalDuration: (transcript.endTime - transcript.startTime) / 1000,
            studentSpeakingTime: studentSegments.length,
            tutorSpeakingTime: tutorSegments.length,
            wordCount: transcript.segments.reduce((sum, seg) => sum + seg.text.split(' ').length, 0)
          };
          
          await transcript.save();
          console.log(`✅ [CRON] Completed stuck transcript ${transcript._id} for lesson ${transcript.lessonId} (${transcript.segments.length} segments, ${transcript.metadata.wordCount} words)`);
          
          // Check AI setting and trigger analysis or tutor feedback
          const User = require('../models/User');
          let aiDisabled = false;
          if (lesson.aiAnalysisEnabledAtTime !== null && lesson.aiAnalysisEnabledAtTime !== undefined) {
            aiDisabled = lesson.aiAnalysisEnabledAtTime === false;
          } else {
            const student = await User.findOne({ auth0Id: transcript.studentId });
            const liveValue = student?.profile?.aiAnalysisEnabled !== false;
            lesson.aiAnalysisEnabledAtTime = liveValue;
            await lesson.save();
            aiDisabled = !liveValue;
          }
          
          if (aiDisabled) {
            console.log(`📝 [CRON] AI disabled for lesson ${transcript.lessonId} — creating tutor feedback requirement`);
            const TutorFeedback = require('../models/TutorFeedback');
            const Notification = require('../models/Notification');
            const { getRandomFeedbackMessage } = require('../utils/feedbackMessages');
            const { formatNameWithInitial } = require('../utils/nameFormatter');
            
            lesson.requiresTutorFeedback = true;
            if (lesson.status !== 'completed') lesson.status = 'completed';
            await lesson.save();
            
            const tutor = await User.findOne({ auth0Id: transcript.tutorId });
            const studentData = await User.findOne({ auth0Id: transcript.studentId });
            
            const existingFeedback = await TutorFeedback.findOne({ lessonId: transcript.lessonId });
            if (!existingFeedback) {
              await TutorFeedback.create({
                lessonId: transcript.lessonId,
                tutorId: tutor ? tutor._id : transcript.tutorId,
                studentId: studentData ? studentData._id : transcript.studentId,
                status: 'pending',
                required: true
              });
              
              const feedbackMsg = getRandomFeedbackMessage(transcript.lessonId.toString());
              if (tutor) {
                await Notification.create({
                  userId: tutor._id,
                  type: 'feedback_required',
                  title: feedbackMsg.title,
                  message: feedbackMsg.message,
                  data: {
                    lessonId: transcript.lessonId,
                    studentName: studentData ? formatNameWithInitial(studentData) : 'Student'
                  }
                });
              }
              console.log(`📢 [CRON] Created tutor feedback requirement for stuck lesson ${transcript.lessonId}`);
            }
          } else {
            // Trigger GPT analysis via the transcription routes export
            try {
              const transcriptionRoutes = require('../routes/transcription');
              if (typeof transcriptionRoutes.analyzeLesson === 'function') {
                transcriptionRoutes.analyzeLesson(transcript._id).catch(err => {
                  console.error(`❌ [CRON] Error analyzing stuck transcript ${transcript._id}:`, err);
                });
                console.log(`🤖 [CRON] Triggered GPT analysis for stuck transcript ${transcript._id}`);
              } else {
                console.warn(`⚠️ [CRON] analyzeLesson not available — will rely on analysis retry cron`);
              }
            } catch (importErr) {
              console.error(`❌ [CRON] Could not import analyzeLesson:`, importErr.message);
            }
          }
          
        } catch (err) {
          console.error(`❌ [CRON] Error processing stuck transcript ${transcript._id}:`, err);
        }
      }
      
    } catch (error) {
      console.error('❌ [CRON] Error in stuck transcript check:', error);
    }
  });
  
  console.log('✅ Stuck transcript rescue cron job scheduled (every 15 minutes)');
}

/**
 * Initialize all audio-related cron jobs
 */
function initializeAudioCronJobs() {
  startAudioCleanupCron();
  startTranscriptionRetryCron();
  startAnalysisRetryCron();
  startStuckTranscriptionCron();
  console.log('✅ All audio cron jobs initialized');
}

module.exports = {
  initializeAudioCronJobs,
  startAudioCleanupCron,
  startTranscriptionRetryCron,
  startAnalysisRetryCron,
  startStuckTranscriptionCron
};

