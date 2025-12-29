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
 * Initialize all audio-related cron jobs
 */
function initializeAudioCronJobs() {
  startAudioCleanupCron();
  startTranscriptionRetryCron();
  startAnalysisRetryCron();
  console.log('✅ All audio cron jobs initialized');
}

module.exports = {
  initializeAudioCronJobs,
  startAudioCleanupCron,
  startTranscriptionRetryCron,
  startAnalysisRetryCron
};

