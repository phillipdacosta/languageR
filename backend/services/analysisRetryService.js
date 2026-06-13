const LessonAnalysis = require('../models/LessonAnalysis');
const LessonTranscript = require('../models/LessonTranscript');

/**
 * Re-run the FULL analysis pipeline for a transcript.
 *
 * We deliberately go through routes/transcription.analyzeLesson (not
 * aiService.analyzeLessonTranscript directly) so retries get the complete
 * production pipeline: tutor-track download + transcription, text-dedup
 * mic-bleed removal, the grading gate / recap mode, and per-segment language
 * isolation. Calling the low-level analyzer directly would bypass all of that
 * and regenerate a low-quality (over-graded) result.
 *
 * Lazy-required to avoid a circular dependency (routes/transcription pulls in
 * aiService, which is fine, but the route module also wires Express).
 */
function runFullAnalysis(transcriptId) {
  const transcriptionRoutes = require('../routes/transcription');
  if (typeof transcriptionRoutes.analyzeLesson !== 'function') {
    throw new Error('analyzeLesson pipeline is unavailable');
  }
  return transcriptionRoutes.analyzeLesson(transcriptId);
}

/**
 * Retry failed GPT-4 analyses
 * Called by cron job or manually
 * @param {number} maxAttempts - Maximum retry attempts per analysis
 * @returns {Promise<{retried: number, succeeded: number, failed: number}>}
 */
async function retryFailedAnalyses(maxAttempts = 3) {
  try {
    console.log('🔄 Starting retry of failed analyses...');
    
    // Find analyses that failed and can be retried
    const failedAnalyses = await LessonAnalysis.find({
      status: 'failed',
      canRetry: true,
      retryAttempts: { $lt: maxAttempts }
    });
    
    console.log(`Found ${failedAnalyses.length} failed analyses to retry`);
    
    let retried = 0;
    let succeeded = 0;
    let failed = 0;
    
    for (const analysis of failedAnalyses) {
      // The transcript must still have segments to analyze.
      const transcript = await LessonTranscript.findById(analysis.transcriptId).select('_id segments');
      if (!transcript || !transcript.segments || transcript.segments.length === 0) {
        console.error(`❌ No transcript segments for analysis ${analysis._id} — marking non-retryable`);
        await LessonAnalysis.updateOne(
          { _id: analysis._id },
          { canRetry: false, error: 'No transcript segments available for retry' }
        );
        failed++;
        continue;
      }
      
      const priorAttempts = analysis.retryAttempts || 0;
      retried++;
      console.log(`🔄 Retrying analysis for lesson ${analysis.lessonId} (attempt ${priorAttempts + 1}/${maxAttempts})`);
      
      try {
        // Run the FULL pipeline. analyzeLesson owns the LessonAnalysis record:
        // on success it overwrites it (status completed/insufficient_data and
        // clears retry metadata); we only correct bookkeeping on failure below.
        await runFullAnalysis(transcript._id);
        succeeded++;
        console.log(`✅ Successfully re-analyzed lesson ${analysis.lessonId}`);
      } catch (error) {
        // analyzeLesson resets retryAttempts:0/canRetry:true on its own failure
        // path; overwrite that so attempts actually accumulate toward the cap.
        const attempts = priorAttempts + 1;
        await LessonAnalysis.updateOne(
          { transcriptId: transcript._id },
          {
            status: 'failed',
            error: error.message,
            retryAttempts: attempts,
            canRetry: attempts < maxAttempts,
            lastRetryAttempt: new Date()
          }
        );
        if (attempts >= maxAttempts) {
          console.error(`❌ Max retry attempts reached for lesson ${analysis.lessonId}`);
        }
        failed++;
        console.error(`❌ Retry failed for lesson ${analysis.lessonId} (attempt ${attempts}/${maxAttempts}):`, error.message);
      }
    }
    
    console.log(`🔄 Retry complete: ${retried} retried, ${succeeded} succeeded, ${failed} failed`);
    return { retried, succeeded, failed };
    
  } catch (error) {
    console.error('❌ Error in analysis retry service:', error);
    return { retried: 0, succeeded: 0, failed: 0 };
  }
}

/**
 * Resolve analyses stuck in 'pending'/'processing' that can never complete.
 *
 * A placeholder analysis can get orphaned when the transcript ends up empty
 * (no student speech captured). Because the empty-transcript path bails out,
 * and the auto-complete cron only inspects 'recording'/'processing' transcripts,
 * an already-'completed' empty transcript leaves the analysis stuck 'pending'
 * forever — which makes the post-lesson screen poll until it times out.
 *
 * This safety net marks such rows as 'insufficient_data' so the UI shows a
 * definitive state immediately on the next visit.
 *
 * @param {number} olderThanMinutes - Only touch rows untouched for this long.
 * @returns {Promise<{checked: number, resolved: number}>}
 */
async function resolveStuckPendingAnalyses(olderThanMinutes = 15) {
  try {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const stuck = await LessonAnalysis.find({
      status: { $in: ['pending', 'processing'] },
      updatedAt: { $lt: cutoff }
    }).lean();

    if (stuck.length === 0) {
      return { checked: 0, resolved: 0 };
    }

    console.log(`🩹 [StuckAnalyses] Found ${stuck.length} pending/processing analyses older than ${olderThanMinutes}m`);

    let resolved = 0;
    for (const analysis of stuck) {
      const transcript = await LessonTranscript.findOne({ lessonId: analysis.lessonId })
        .select('status segments')
        .lean();

      const segmentCount = transcript?.segments?.length || 0;
      const transcriptEmpty = !transcript
        || transcript.status === 'failed'
        || segmentCount === 0;

      // Only resolve rows that genuinely can't produce analysis. Rows whose
      // transcript still has segments are left alone (the failed-analysis retry
      // path handles those once they're marked 'failed').
      if (transcriptEmpty) {
        await LessonAnalysis.updateOne(
          { _id: analysis._id, status: { $in: ['pending', 'processing'] } },
          {
            $set: {
              status: 'insufficient_data',
              error: 'No student speech was captured during the lesson (empty transcript).'
            }
          }
        );
        resolved++;
        console.log(`🩹 [StuckAnalyses] Resolved lesson ${analysis.lessonId} → insufficient_data (segments=${segmentCount}, transcript=${transcript?.status || 'missing'})`);
      }
    }

    console.log(`🩹 [StuckAnalyses] Resolved ${resolved}/${stuck.length} stuck analyses`);
    return { checked: stuck.length, resolved };
  } catch (error) {
    console.error('❌ Error resolving stuck pending analyses:', error);
    return { checked: 0, resolved: 0 };
  }
}

/**
 * Get analysis retry statistics
 * @returns {Promise<{pendingRetries: number, permanentlyFailed: number, totalFailed: number}>}
 */
async function getAnalysisRetryStats() {
  try {
    const [pendingRetries, permanentlyFailed, totalFailed] = await Promise.all([
      LessonAnalysis.countDocuments({
        status: 'failed',
        canRetry: true,
        retryAttempts: { $lt: 3 }
      }),
      LessonAnalysis.countDocuments({
        status: 'failed',
        canRetry: false
      }),
      LessonAnalysis.countDocuments({
        status: 'failed'
      })
    ]);
    
    return {
      pendingRetries,
      permanentlyFailed,
      totalFailed
    };
  } catch (error) {
    console.error('❌ Error getting analysis retry stats:', error);
    return {
      pendingRetries: 0,
      permanentlyFailed: 0,
      totalFailed: 0
    };
  }
}

/**
 * Manually retry a specific analysis
 * @param {string} analysisId - Analysis ID
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function retryAnalysis(analysisId) {
  const analysis = await LessonAnalysis.findById(analysisId);
  if (!analysis) {
    throw new Error('Analysis not found');
  }
  if (analysis.status === 'completed') {
    return { success: false, message: 'Analysis already completed' };
  }

  const transcript = await LessonTranscript.findById(analysis.transcriptId).select('_id segments');
  if (!transcript || !transcript.segments || transcript.segments.length === 0) {
    throw new Error('No transcript segments available');
  }

  const priorAttempts = analysis.retryAttempts || 0;
  try {
    // Full pipeline (diarization, dedup, grading gate, language isolation).
    await runFullAnalysis(transcript._id);
    return { success: true, message: 'Analysis completed successfully' };
  } catch (error) {
    console.error('❌ Error retrying analysis:', error);
    const attempts = priorAttempts + 1;
    await LessonAnalysis.updateOne(
      { transcriptId: transcript._id },
      {
        status: 'failed',
        error: error.message,
        retryAttempts: attempts,
        canRetry: attempts < 3,
        lastRetryAttempt: new Date()
      }
    );
    throw error;
  }
}

module.exports = {
  retryFailedAnalyses,
  resolveStuckPendingAnalyses,
  getAnalysisRetryStats,
  retryAnalysis
};

