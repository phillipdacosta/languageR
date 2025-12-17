const sdk = require('microsoft-cognitiveservices-speech-sdk');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { Readable, Writable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

/**
 * Azure Speech Services Pronunciation Assessment Service
 * 
 * Features:
 * - Smart sampling (20% of audio for cost efficiency)
 * - Target language filtering (only assess Spanish, ignore English)
 * - Parallel processing with Whisper
 * - Phoneme-level accuracy scoring
 * - Automatic audio format conversion (WebM/MP3 to WAV)
 */

/**
 * Convert audio buffer to WAV format (required by Azure Speech)
 * @param {Buffer} audioBuffer - Audio data in any format
 * @returns {Promise<Buffer>} - Audio data in WAV format
 */
async function convertToWav(audioBuffer) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const inputStream = Readable.from(audioBuffer);
    
    console.log(`🔄 Converting audio to WAV format (${audioBuffer.length} bytes)...`);
    
    // Create a writable stream to collect output
    const outputStream = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    
    ffmpeg(inputStream)
      .toFormat('wav')
      .audioCodec('pcm_s16le')  // 16-bit PCM (required by Azure)
      .audioBitrate(256)
      .audioChannels(1)  // Mono
      .audioFrequency(16000)  // 16kHz (required by Azure Speech)
      .on('error', (err) => {
        console.error('❌ FFmpeg WAV conversion error:', err.message);
        reject(err);
      })
      .on('end', () => {
        const wavBuffer = Buffer.concat(chunks);
        console.log(`✅ Audio converted to WAV: ${wavBuffer.length} bytes`);
        resolve(wavBuffer);
      })
      .pipe(outputStream, { end: true });
  });
}

// Configuration
const PRONUNCIATION_CONFIG = {
  SAMPLING_RATE: 0.20, // Assess 20% of audio
  MIN_SEGMENTS_TO_ASSESS: 3, // Minimum segments for reliable assessment
  MAX_SEGMENTS_TO_ASSESS: 10, // Maximum segments to keep costs down
  LANGUAGE_MAP: {
    'es': 'es-ES',
    'en': 'en-US',
    'fr': 'fr-FR',
    'de': 'de-DE',
    'it': 'it-IT',
    'pt': 'pt-BR'
  }
};

/**
 * Sample audio segments intelligently for pronunciation assessment
 * Similar to transcript sampling - beginning, middle, end
 * 
 * @param {Array} segments - Array of audio segments with metadata
 * @param {number} samplingRate - Percentage of segments to assess (0-1)
 * @returns {Array} - Sampled segments
 */
function sampleAudioSegments(segments, samplingRate = PRONUNCIATION_CONFIG.SAMPLING_RATE) {
  if (!segments || segments.length === 0) {
    return [];
  }

  const targetCount = Math.ceil(segments.length * samplingRate);
  const minCount = Math.min(PRONUNCIATION_CONFIG.MIN_SEGMENTS_TO_ASSESS, segments.length);
  const maxCount = Math.min(PRONUNCIATION_CONFIG.MAX_SEGMENTS_TO_ASSESS, segments.length);
  
  const count = Math.max(minCount, Math.min(targetCount, maxCount));
  
  if (count >= segments.length) {
    return segments;
  }

  // Sample from beginning, middle, and end
  const beginningCount = Math.ceil(count * 0.3);
  const middleCount = Math.ceil(count * 0.4);
  const endCount = count - beginningCount - middleCount;

  const sampled = [];
  
  // Beginning
  sampled.push(...segments.slice(0, beginningCount));
  
  // Middle
  const middleStart = Math.floor((segments.length - middleCount) / 2);
  sampled.push(...segments.slice(middleStart, middleStart + middleCount));
  
  // End
  sampled.push(...segments.slice(-endCount));

  console.log(`📊 Pronunciation sampling: ${sampled.length}/${segments.length} segments (${Math.round(samplingRate * 100)}%)`);
  
  return sampled;
}

/**
 * Filter segments to only include target language
 * 
 * @param {Array} segments - Transcript segments with language info
 * @param {string} targetLanguage - Target language code (e.g., 'es')
 * @returns {Array} - Filtered segments
 */
function filterTargetLanguageSegments(segments, targetLanguage) {
  if (!segments || !targetLanguage) {
    return segments;
  }

  const filtered = segments.filter(seg => seg.language === targetLanguage);
  
  console.log(`🌍 Language filtering: ${filtered.length}/${segments.length} segments in ${targetLanguage}`);
  
  return filtered;
}

/**
 * Assess pronunciation for a single audio segment
 * 
 * @param {Buffer} audioBuffer - Audio data in WAV format
 * @param {string} referenceText - Expected text (from transcription)
 * @param {string} language - Language code (e.g., 'es-ES')
 * @returns {Promise<Object>} - Pronunciation assessment results
 */
async function assessSegmentPronunciation(audioBuffer, referenceText, language) {
  if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
    console.warn('⚠️  Azure Speech not configured, skipping pronunciation assessment');
    return null;
  }

  try {
    // Convert audio to WAV format (Azure Speech requires WAV)
    console.log('🔄 Converting audio buffer to WAV format for Azure Speech...');
    let wavBuffer;
    try {
      wavBuffer = await Promise.race([
        convertToWav(audioBuffer),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('WAV conversion timeout after 10 seconds')), 10000)
        )
      ]);
    } catch (conversionError) {
      console.error('⚠️ Audio conversion to WAV failed:', conversionError.message);
      console.warn('⚠️ Attempting to use buffer directly (may fail if not WAV format)...');
      wavBuffer = audioBuffer; // Fallback to original buffer
    }
    
    // Create temporary WAV file
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFile = path.join(tempDir, `pronunciation_${Date.now()}.wav`);
    await writeFile(tempFile, wavBuffer);

    // Configure Speech SDK
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY,
      process.env.AZURE_SPEECH_REGION
    );
    speechConfig.speechRecognitionLanguage = language;

    // Configure pronunciation assessment
    const pronunciationConfig = new sdk.PronunciationAssessmentConfig(
      referenceText,
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true // Enable miscue detection
    );
    pronunciationConfig.enableProsodyAssessment = true;

    // Create audio config from file
    const audioConfig = sdk.AudioConfig.fromWavFileInput(
      fs.readFileSync(tempFile)
    );

    // Create recognizer
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    pronunciationConfig.applyTo(recognizer);

    // Perform assessment
    const result = await new Promise((resolve, reject) => {
      recognizer.recognizeOnceAsync(
        result => {
          if (result.reason === sdk.ResultReason.RecognizedSpeech) {
            const pronunciationResult = sdk.PronunciationAssessmentResult.fromResult(result);
            resolve(pronunciationResult);
          } else {
            reject(new Error(`Recognition failed: ${result.errorDetails}`));
          }
          recognizer.close();
        },
        error => {
          recognizer.close();
          reject(error);
        }
      );
    });

    // Clean up temp file
    await unlink(tempFile);

    // Log the full result for debugging
    console.log('📊 Azure pronunciation result:');
    console.log('   Overall scores:', {
      accuracy: result.accuracyScore,
      fluency: result.fluencyScore,
      prosody: result.prosodyScore,
      pronunciation: result.pronunciationScore
    });
    console.log('   Words count:', result.detailResult?.Words?.length || 0);
    if (result.detailResult?.Words && result.detailResult.Words.length > 0) {
      console.log('   First word sample:', {
        word: result.detailResult.Words[0].Word,
        accuracyScore: result.detailResult.Words[0].PronunciationAssessment?.AccuracyScore,
        errorType: result.detailResult.Words[0].PronunciationAssessment?.ErrorType
      });
    }

    return {
      accuracyScore: result.accuracyScore || 0,
      fluencyScore: result.fluencyScore || 0,
      completenessScore: result.completenessScore || 0,
      prosodyScore: result.prosodyScore || 0,
      pronunciationScore: result.pronunciationScore || 0,
      words: result.detailResult?.Words?.map(word => {
        // Only include words that have actual pronunciation assessment data
        // If PronunciationAssessment doesn't exist, the word wasn't assessed - exclude it
        // If it exists but AccuracyScore is 0, that's a legitimate 0% score - include it
        const hasAssessment = word.PronunciationAssessment != null;
        const accuracyScore = hasAssessment ? (word.PronunciationAssessment.AccuracyScore ?? null) : null;
        
        return {
          word: word.Word,
          accuracyScore: accuracyScore, // null if no assessment, otherwise the actual score (could be 0)
          errorType: word.PronunciationAssessment?.ErrorType || 'None',
          phonemes: word.Phonemes?.map(p => ({
            phoneme: p.Phoneme,
            accuracyScore: p.PronunciationAssessment?.AccuracyScore ?? null
          })) || []
        };
      }).filter(word => word.accuracyScore != null) || [] // Filter out words without assessment data
    };

  } catch (error) {
    console.error('❌ Error in pronunciation assessment:');
    console.error('   Error object:', error);
    console.error('   Error message:', error?.message);
    console.error('   Error stack:', error?.stack);
    console.error('   Error name:', error?.name);
    return null;
  }
}

/**
 * Assess pronunciation for entire lesson (sampled segments)
 * 
 * @param {Array} transcriptSegments - Transcript segments with text and language
 * @param {Array} audioSegments - Corresponding audio buffers
 * @param {string} targetLanguage - Target language code (e.g., 'es')
 * @returns {Promise<Object>} - Aggregated pronunciation assessment
 */
async function assessLessonPronunciation(transcriptSegments, audioSegments, targetLanguage) {
  const startTime = Date.now();
  
  console.log('🎙️ ========================================');
  console.log('🎙️ STARTING PRONUNCIATION ASSESSMENT');
  console.log('🎙️ ========================================');

  if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
    console.log('⚠️  Azure Speech not configured, skipping pronunciation assessment');
    return null;
  }

  if (!transcriptSegments || transcriptSegments.length === 0) {
    console.log('⚠️  No transcript segments provided');
    return null;
  }

  try {
    // Step 1: Filter to target language only (e.g., Spanish)
    const targetLanguageSegments = filterTargetLanguageSegments(transcriptSegments, targetLanguage);
    
    if (targetLanguageSegments.length === 0) {
      console.log(`⚠️  No segments in target language (${targetLanguage})`);
      return null;
    }

    // Step 2: Sample segments (20% by default)
    const sampledSegments = sampleAudioSegments(targetLanguageSegments, PRONUNCIATION_CONFIG.SAMPLING_RATE);

    // Step 3: Get Azure language code
    const azureLanguage = PRONUNCIATION_CONFIG.LANGUAGE_MAP[targetLanguage] || 'es-ES';
    console.log(`🌍 Assessing pronunciation in ${azureLanguage}`);

    // Step 4: Assess each sampled segment (in parallel for speed)
    const assessmentPromises = sampledSegments.map(async (segment, index) => {
      if (!segment.text || segment.text.trim().length === 0) {
        return null;
      }

      // Find corresponding audio (simplified - in real implementation, match by timestamp)
      const audioSegment = audioSegments && audioSegments[index];
      if (!audioSegment) {
        return null;
      }

      return await assessSegmentPronunciation(
        audioSegment,
        segment.text,
        azureLanguage
      );
    });

    const assessments = await Promise.all(assessmentPromises);
    const validAssessments = assessments.filter(a => a !== null);

    if (validAssessments.length === 0) {
      console.log('⚠️  No valid pronunciation assessments');
      return null;
    }

    // Step 5: Aggregate results
    const aggregated = {
      overallScore: average(validAssessments.map(a => a.pronunciationScore)),
      accuracyScore: average(validAssessments.map(a => a.accuracyScore)),
      fluencyScore: average(validAssessments.map(a => a.fluencyScore)),
      prosodyScore: average(validAssessments.map(a => a.prosodyScore)),
      completenessScore: average(validAssessments.map(a => a.completenessScore)),
      
      // Words that need practice (accuracy < 60)
      mispronunciations: extractMispronunciations(validAssessments),
      
      // Stats
      segmentsAssessed: validAssessments.length,
      totalSegments: transcriptSegments.length,
      targetLanguageSegments: targetLanguageSegments.length,
      samplingRate: PRONUNCIATION_CONFIG.SAMPLING_RATE
    };

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Pronunciation assessment completed in ${duration}s`);
    console.log(`📊 Overall Score: ${aggregated.overallScore}/100`);
    console.log(`📊 Accuracy: ${aggregated.accuracyScore}/100`);
    console.log(`📊 Fluency: ${aggregated.fluencyScore}/100`);
    console.log(`📊 Mispronunciations: ${aggregated.mispronunciations.length} words`);

    return aggregated;

  } catch (error) {
    console.error('❌ Error in lesson pronunciation assessment:', error);
    return null;
  }
}

/**
 * Extract words that need pronunciation practice
 */
function extractMispronunciations(assessments) {
  const threshold = 60; // Words below 60% accuracy
  const mispronounced = [];

  assessments.forEach(assessment => {
    if (assessment.words) {
      assessment.words.forEach(word => {
        if (word.accuracyScore < threshold) {
          mispronounced.push({
            word: word.word,
            score: word.accuracyScore,
            errorType: word.errorType,
            problematicPhonemes: word.phonemes
              .filter(p => p.accuracyScore < threshold)
              .map(p => p.phoneme)
          });
        }
      });
    }
  });

  return mispronounced;
}

/**
 * Calculate average of array of numbers
 */
function average(numbers) {
  if (!numbers || numbers.length === 0) return 0;
  const sum = numbers.reduce((a, b) => a + b, 0);
  return Math.round(sum / numbers.length);
}

module.exports = {
  assessLessonPronunciation,
  assessSegmentPronunciation,
  sampleAudioSegments,
  filterTargetLanguageSegments,
  PRONUNCIATION_CONFIG
};

