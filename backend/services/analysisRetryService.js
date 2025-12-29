const LessonAnalysis = require('../models/LessonAnalysis');
const LessonTranscript = require('../models/LessonTranscript');
const Lesson = require('../models/Lesson');
const { analyzeLessonTranscript } = require('./aiService');

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
    }).populate('transcriptId');
    
    console.log(`Found ${failedAnalyses.length} failed analyses to retry`);
    
    let retried = 0;
    let succeeded = 0;
    let failed = 0;
    
    for (const analysis of failedAnalyses) {
      console.log(`🔄 Retrying analysis for lesson ${analysis.lessonId}`);
      retried++;
      
      try {
        // Get the transcript
        const transcript = await LessonTranscript.findById(analysis.transcriptId);
        if (!transcript) {
          console.error(`❌ Transcript not found for analysis ${analysis._id}`);
          analysis.canRetry = false;
          analysis.error = 'Transcript not found';
          await analysis.save();
          failed++;
          continue;
        }
        
        // Check if transcript has segments
        if (!transcript.segments || transcript.segments.length === 0) {
          console.error(`❌ Transcript has no segments for analysis ${analysis._id}`);
          analysis.canRetry = false;
          analysis.error = 'No transcript segments available';
          await analysis.save();
          failed++;
          continue;
        }
        
        // Get lesson for context
        const lesson = await Lesson.findById(analysis.lessonId)
          .populate('studentId')
          .populate('tutorId');
        
        if (!lesson) {
          console.error(`❌ Lesson not found for analysis ${analysis._id}`);
          analysis.canRetry = false;
          analysis.error = 'Lesson not found';
          await analysis.save();
          failed++;
          continue;
        }
        
        // Update status to processing
        analysis.status = 'processing';
        analysis.retryAttempts++;
        analysis.lastRetryAttempt = new Date();
        await analysis.save();
        
        console.log(`📊 Analyzing transcript with ${transcript.segments.length} segments...`);
        
        // Attempt analysis
        const analysisResult = await analyzeLessonTranscript(
          transcript.segments,
          transcript.language,
          analysis.studentId
        );
        
        // Success! Update the analysis record with new data
        analysis.overallAssessment = analysisResult.overallAssessment;
        analysis.progressionMetrics = analysisResult.progressionMetrics;
        analysis.strengths = analysisResult.strengths;
        analysis.areasForImprovement = analysisResult.areasForImprovement;
        analysis.errorPatterns = analysisResult.errorPatterns;
        analysis.topErrors = analysisResult.topErrors;
        analysis.correctedExcerpts = analysisResult.correctedExcerpts;
        analysis.grammarAnalysis = analysisResult.grammarAnalysis;
        analysis.vocabularyAnalysis = analysisResult.vocabularyAnalysis;
        analysis.fluencyAnalysis = analysisResult.fluencyAnalysis;
        analysis.topicsDiscussed = analysisResult.topicsDiscussed;
        analysis.conversationQuality = analysisResult.conversationQuality;
        analysis.recommendedFocus = analysisResult.recommendedFocus;
        analysis.suggestedExercises = analysisResult.suggestedExercises;
        analysis.homeworkSuggestions = analysisResult.homeworkSuggestions;
        analysis.studentSummary = analysisResult.studentSummary;
        
        analysis.status = 'completed';
        analysis.error = null;
        analysis.processingTime = Date.now() - new Date(analysis.lastRetryAttempt).getTime();
        
        await analysis.save();
        
        succeeded++;
        console.log(`✅ Successfully analyzed lesson ${analysis.lessonId} (attempt ${analysis.retryAttempts})`);
        
        // Update lesson status if needed
        if (lesson.status !== 'completed') {
          lesson.status = 'completed';
          await lesson.save();
        }
        
      } catch (error) {
        // Increment attempt count and save error
        analysis.retryAttempts++;
        analysis.lastRetryAttempt = new Date();
        analysis.error = error.message;
        
        // If max attempts reached, mark as cannot retry
        if (analysis.retryAttempts >= maxAttempts) {
          analysis.canRetry = false;
          console.error(`❌ Max retry attempts reached for analysis ${analysis._id}`);
        }
        
        await analysis.save();
        
        failed++;
        console.error(`❌ Retry failed for analysis ${analysis._id}:`, error.message);
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
  try {
    const analysis = await LessonAnalysis.findById(analysisId).populate('transcriptId');
    if (!analysis) {
      throw new Error('Analysis not found');
    }
    
    if (analysis.status === 'completed') {
      return { success: false, message: 'Analysis already completed' };
    }
    
    const transcript = await LessonTranscript.findById(analysis.transcriptId);
    if (!transcript || !transcript.segments || transcript.segments.length === 0) {
      throw new Error('No transcript segments available');
    }
    
    const lesson = await Lesson.findById(analysis.lessonId)
      .populate('studentId')
      .populate('tutorId');
    
    if (!lesson) {
      throw new Error('Lesson not found');
    }
    
    // Update status
    analysis.status = 'processing';
    analysis.retryAttempts++;
    analysis.lastRetryAttempt = new Date();
    await analysis.save();
    
    // Attempt analysis
    const analysisResult = await analyzeLessonTranscript(
      transcript.segments,
      transcript.language,
      analysis.studentId
    );
    
    // Update with results
    analysis.overallAssessment = analysisResult.overallAssessment;
    analysis.progressionMetrics = analysisResult.progressionMetrics;
    analysis.strengths = analysisResult.strengths;
    analysis.areasForImprovement = analysisResult.areasForImprovement;
    analysis.errorPatterns = analysisResult.errorPatterns;
    analysis.topErrors = analysisResult.topErrors;
    analysis.correctedExcerpts = analysisResult.correctedExcerpts;
    analysis.grammarAnalysis = analysisResult.grammarAnalysis;
    analysis.vocabularyAnalysis = analysisResult.vocabularyAnalysis;
    analysis.fluencyAnalysis = analysisResult.fluencyAnalysis;
    analysis.topicsDiscussed = analysisResult.topicsDiscussed;
    analysis.conversationQuality = analysisResult.conversationQuality;
    analysis.recommendedFocus = analysisResult.recommendedFocus;
    analysis.suggestedExercises = analysisResult.suggestedExercises;
    analysis.homeworkSuggestions = analysisResult.homeworkSuggestions;
    analysis.studentSummary = analysisResult.studentSummary;
    
    analysis.status = 'completed';
    analysis.error = null;
    analysis.processingTime = Date.now() - new Date(analysis.lastRetryAttempt).getTime();
    
    await analysis.save();
    
    return { success: true, message: 'Analysis completed successfully' };
    
  } catch (error) {
    console.error('❌ Error retrying analysis:', error);
    
    // Update analysis with error
    const analysis = await LessonAnalysis.findById(analysisId);
    if (analysis) {
      analysis.retryAttempts++;
      analysis.lastRetryAttempt = new Date();
      analysis.error = error.message;
      analysis.status = 'failed';
      await analysis.save();
    }
    
    throw error;
  }
}

module.exports = {
  retryFailedAnalyses,
  getAnalysisRetryStats,
  retryAnalysis
};

