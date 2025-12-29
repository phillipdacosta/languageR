const LessonTranscript = require('../models/LessonTranscript');
const audioBackupService = require('./audioBackupService');
const { transcribeAudio } = require('./aiService');
const { normalizeLanguageCode } = require('../utils/languageUtils');

/**
 * Retry transcription for failed audio chunks
 * Called by cron job or manually
 * @param {number} maxAttempts - Maximum retry attempts per chunk
 * @returns {Promise<{retried: number, succeeded: number, failed: number}>}
 */
async function retryFailedTranscriptions(maxAttempts = 3) {
  try {
    console.log('🔄 Starting retry of failed transcriptions...');
    
    // Find transcripts with failed chunks (not transcribed, attempts < max)
    const transcripts = await LessonTranscript.find({
      'audioChunks': {
        $elemMatch: {
          transcribed: false,
          transcriptionAttempts: { $lt: maxAttempts },
          deleteAt: { $gt: new Date() } // Not expired yet
        }
      }
    });
    
    console.log(`Found ${transcripts.length} transcripts with failed chunks`);
    
    let retried = 0;
    let succeeded = 0;
    let failed = 0;
    
    for (const transcript of transcripts) {
      for (let i = 0; i < transcript.audioChunks.length; i++) {
        const chunk = transcript.audioChunks[i];
        
        // Skip if already transcribed, max attempts reached, or expired
        if (chunk.transcribed || 
            chunk.transcriptionAttempts >= maxAttempts || 
            new Date(chunk.deleteAt) < new Date()) {
          continue;
        }
        
        console.log(`🔄 Retrying chunk ${chunk.chunkIndex} for transcript ${transcript._id}`);
        retried++;
        
        try {
          // Download audio from GCS
          const audioBuffer = await audioBackupService.downloadAudioChunk(chunk.gcsPath);
          
          // Normalize language to ISO-639-1 code (e.g., "Spanish" → "es")
          const normalizedLanguage = normalizeLanguageCode(transcript.language);
          console.log(`🌐 Language normalized: ${transcript.language} → ${normalizedLanguage}`);
          
          // Attempt transcription
          const result = await transcribeAudio(audioBuffer, normalizedLanguage, chunk.speaker);
          
          // Success! Add segments to transcript
          const segments = result.segments
            .filter(seg => seg.text && seg.text.trim().length > 0)
            .map(seg => ({
              timestamp: new Date(transcript.startTime.getTime() + (seg.start * 1000)),
              speaker: chunk.speaker,
              text: seg.text,
              confidence: seg.confidence || 1,
              language: transcript.language
            }));
          
          transcript.segments.push(...segments);
          
          // Mark chunk as transcribed
          transcript.audioChunks[i].transcribed = true;
          transcript.audioChunks[i].transcriptionAttempts++;
          transcript.audioChunks[i].lastTranscriptionAttempt = new Date();
          
          await transcript.save();
          
          succeeded++;
          console.log(`✅ Successfully transcribed chunk ${chunk.chunkIndex} (${segments.length} segments)`);
          
        } catch (error) {
          // Increment attempt count
          transcript.audioChunks[i].transcriptionAttempts++;
          transcript.audioChunks[i].lastTranscriptionAttempt = new Date();
          await transcript.save();
          
          failed++;
          console.error(`❌ Retry failed for chunk ${chunk.chunkIndex}:`, error.message);
        }
      }
    }
    
    console.log(`🔄 Retry complete: ${retried} retried, ${succeeded} succeeded, ${failed} failed`);
    return { retried, succeeded, failed };
    
  } catch (error) {
    console.error('❌ Error in retry service:', error);
    return { retried: 0, succeeded: 0, failed: 0 };
  }
}

/**
 * Get retry statistics
 * @returns {Promise<{pendingRetries: number, failedChunks: number, expiredChunks: number}>}
 */
async function getRetryStats() {
  try {
    const transcripts = await LessonTranscript.find({
      'audioChunks': { $exists: true, $ne: [] }
    });
    
    let pendingRetries = 0;
    let failedChunks = 0;
    let expiredChunks = 0;
    
    const now = new Date();
    
    for (const transcript of transcripts) {
      for (const chunk of transcript.audioChunks) {
        if (!chunk.transcribed) {
          if (new Date(chunk.deleteAt) < now) {
            expiredChunks++;
          } else if (chunk.transcriptionAttempts < 3) {
            pendingRetries++;
          } else {
            failedChunks++;
          }
        }
      }
    }
    
    return {
      pendingRetries,
      failedChunks,
      expiredChunks,
      totalTranscripts: transcripts.length
    };
  } catch (error) {
    console.error('❌ Error getting retry stats:', error);
    return {
      pendingRetries: 0,
      failedChunks: 0,
      expiredChunks: 0,
      totalTranscripts: 0
    };
  }
}

/**
 * Manually retry a specific transcript
 * @param {string} transcriptId - Transcript ID
 * @returns {Promise<{succeeded: number, failed: number}>}
 */
async function retryTranscript(transcriptId) {
  try {
    const transcript = await LessonTranscript.findById(transcriptId);
    if (!transcript) {
      throw new Error('Transcript not found');
    }
    
    let succeeded = 0;
    let failed = 0;
    
    for (let i = 0; i < transcript.audioChunks.length; i++) {
      const chunk = transcript.audioChunks[i];
      
      if (chunk.transcribed) continue;
      
      try {
        const audioBuffer = await audioBackupService.downloadAudioChunk(chunk.gcsPath);
        
        // Normalize language to ISO-639-1 code
        const normalizedLanguage = normalizeLanguageCode(transcript.language);
        
        const result = await transcribeAudio(audioBuffer, normalizedLanguage, chunk.speaker);
        
        const segments = result.segments
          .filter(seg => seg.text && seg.text.trim().length > 0)
          .map(seg => ({
            timestamp: new Date(transcript.startTime.getTime() + (seg.start * 1000)),
            speaker: chunk.speaker,
            text: seg.text,
            confidence: seg.confidence || 1,
            language: transcript.language
          }));
        
        transcript.segments.push(...segments);
        transcript.audioChunks[i].transcribed = true;
        transcript.audioChunks[i].transcriptionAttempts++;
        transcript.audioChunks[i].lastTranscriptionAttempt = new Date();
        
        succeeded++;
      } catch (error) {
        transcript.audioChunks[i].transcriptionAttempts++;
        transcript.audioChunks[i].lastTranscriptionAttempt = new Date();
        failed++;
        console.error(`❌ Retry failed for chunk ${chunk.chunkIndex}:`, error.message);
      }
    }
    
    await transcript.save();
    return { succeeded, failed };
    
  } catch (error) {
    console.error('❌ Error retrying transcript:', error);
    throw error;
  }
}

module.exports = {
  retryFailedTranscriptions,
  getRetryStats,
  retryTranscript
};

