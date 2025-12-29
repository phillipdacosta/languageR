const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });
const transcriptionRetryService = require('./services/transcriptionRetryService');
const analysisRetryService = require('./services/analysisRetryService');

async function testRetrySystem() {
  try {
    console.log('🧪 ========================================');
    console.log('🧪 TESTING RETRY SYSTEM');
    console.log('🧪 ========================================\n');
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Get stats before retry
    console.log('📊 BEFORE RETRY:');
    const beforeTranscriptStats = await transcriptionRetryService.getRetryStats();
    const beforeAnalysisStats = await analysisRetryService.getAnalysisRetryStats();
    
    console.log('   Transcription:');
    console.log(`     - Pending retries: ${beforeTranscriptStats.pendingRetries}`);
    console.log(`     - Failed chunks: ${beforeTranscriptStats.failedChunks}`);
    console.log(`     - Expired chunks: ${beforeTranscriptStats.expiredChunks}`);
    
    console.log('   Analysis:');
    console.log(`     - Pending retries: ${beforeAnalysisStats.pendingRetries}`);
    console.log(`     - Permanently failed: ${beforeAnalysisStats.permanentlyFailed}`);
    console.log(`     - Total failed: ${beforeAnalysisStats.totalFailed}\n`);
    
    // Test transcription retry
    console.log('🔄 TESTING TRANSCRIPTION RETRY...');
    const transcriptResult = await transcriptionRetryService.retryFailedTranscriptions(3);
    console.log(`   ✅ Retried: ${transcriptResult.retried}`);
    console.log(`   ✅ Succeeded: ${transcriptResult.succeeded}`);
    console.log(`   ❌ Failed: ${transcriptResult.failed}\n`);
    
    // Test analysis retry
    console.log('🔄 TESTING ANALYSIS RETRY...');
    const analysisResult = await analysisRetryService.retryFailedAnalyses(3);
    console.log(`   ✅ Retried: ${analysisResult.retried}`);
    console.log(`   ✅ Succeeded: ${analysisResult.succeeded}`);
    console.log(`   ❌ Failed: ${analysisResult.failed}\n`);
    
    // Get stats after retry
    console.log('📊 AFTER RETRY:');
    const afterTranscriptStats = await transcriptionRetryService.getRetryStats();
    const afterAnalysisStats = await analysisRetryService.getAnalysisRetryStats();
    
    console.log('   Transcription:');
    console.log(`     - Pending retries: ${afterTranscriptStats.pendingRetries}`);
    console.log(`     - Failed chunks: ${afterTranscriptStats.failedChunks}`);
    console.log(`     - Expired chunks: ${afterTranscriptStats.expiredChunks}`);
    
    console.log('   Analysis:');
    console.log(`     - Pending retries: ${afterAnalysisStats.pendingRetries}`);
    console.log(`     - Permanently failed: ${afterAnalysisStats.permanentlyFailed}`);
    console.log(`     - Total failed: ${afterAnalysisStats.totalFailed}\n`);
    
    console.log('✅ TEST COMPLETE');
    console.log('🧪 ========================================\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

testRetrySystem();

