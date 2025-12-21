const ffmpeg = require('fluent-ffmpeg');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Extract audio segment for a specific word with context
 * @param {Buffer} audioBuffer - Full audio buffer
 * @param {number} startTime - Start time in seconds
 * @param {number} duration - Duration in seconds
 * @returns {Promise<Buffer>} - Extracted audio segment
 */
async function extractAudioSegment(audioBuffer, startTime, duration) {
  return new Promise((resolve, reject) => {
    // Use temp files for reliability
    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `input-${Date.now()}.webm`);
    const outputPath = path.join(tempDir, `output-${Date.now()}.mp3`);
    
    // Write input buffer to temp file
    fs.writeFileSync(inputPath, audioBuffer);
    
    ffmpeg(inputPath)
      .setStartTime(startTime)
      .setDuration(duration)
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .format('mp3')
      .on('error', (err) => {
        // Cleanup
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        console.error('❌ FFmpeg extraction error:', err);
        reject(err);
      })
      .on('end', () => {
        // Read output file
        const extractedBuffer = fs.readFileSync(outputPath);
        console.log(`✅ Extracted ${duration}s from ${startTime}s (${Math.round(extractedBuffer.length / 1024)}KB)`);
        
        // Cleanup
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        
        resolve(extractedBuffer);
      })
      .save(outputPath);
  });
}

/**
 * Get audio for a specific word with context
 * Uses Whisper API to get word-level timestamps, then extracts audio
 */
async function getWordAudio(gcsPath, word, fullText) {
  try {
    // Download audio from GCS
    const storageConfig = {
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    };
    
    if (process.env.GOOGLE_CLOUD_KEY_FILE) {
      storageConfig.keyFilename = process.env.GOOGLE_CLOUD_KEY_FILE;
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      storageConfig.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    }
    
    const storage = new Storage(storageConfig);
    const match = gcsPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid GCS path: ${gcsPath}`);
    }
    
    const [, bucketName, filename] = match;
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filename);
    
    const [audioBuffer] = await file.download();
    console.log(`📥 Downloaded audio: ${Math.round(audioBuffer.length / 1024)}KB`);
    
    // Get word-level timestamps from Whisper
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    // Create a temp file-like object for Whisper
    const audioFile = {
      buffer: audioBuffer,
      originalname: 'audio.webm',
      mimetype: 'audio/webm'
    };
    
    console.log(`🎤 Getting word timestamps from Whisper...`);
    const transcription = await openai.audio.transcriptions.create({
      file: await convertBufferToFile(audioBuffer, 'audio.webm'),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word']
    });
    
    if (!transcription.words || transcription.words.length === 0) {
      throw new Error('No word-level timestamps available');
    }
    
    // Find the target word (case-insensitive)
    const targetWord = word.toLowerCase();
    const wordData = transcription.words.find(w => 
      w.word.toLowerCase().replace(/[^\w]/g, '') === targetWord.replace(/[^\w]/g, '')
    );
    
    if (!wordData) {
      console.log(`⚠️  Word "${word}" not found in transcription`);
      console.log('Available words:', transcription.words.map(w => w.word).join(', '));
      throw new Error(`Word "${word}" not found in audio`);
    }
    
    console.log(`✅ Found word "${wordData.word}" at ${wordData.start}s-${wordData.end}s`);
    
    // Extract word with 0.3s padding before and after
    const padding = 0.3;
    const startTime = Math.max(0, wordData.start - padding);
    const endTime = wordData.end + padding;
    const duration = endTime - startTime;
    
    // Extract the audio segment
    const extractedAudio = await extractAudioSegment(audioBuffer, startTime, duration);
    
    return {
      audio: extractedAudio,
      startTime: wordData.start,
      endTime: wordData.end,
      word: wordData.word
    };
    
  } catch (error) {
    console.error('❌ Error getting word audio:', error);
    throw error;
  }
}

/**
 * Convert buffer to File-like object for OpenAI
 */
async function convertBufferToFile(buffer, filename) {
  const { Blob } = require('buffer');
  const blob = new Blob([buffer], { type: 'audio/webm' });
  // Create File-like object
  const file = Object.assign(blob, {
    name: filename,
    lastModified: Date.now()
  });
  return file;
}

module.exports = {
  extractAudioSegment,
  getWordAudio
};


