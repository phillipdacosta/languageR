const express = require('express');
const router = express.Router();
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const { Readable, Writable } = require('stream');
const mongoose = require('mongoose');
const LessonTranscript = require('../models/LessonTranscript');
const LessonAnalysis = require('../models/LessonAnalysis');
const Lesson = require('../models/Lesson');
const User = require('../models/User');
const { transcribeAudio, analyzeLessonTranscript, generateProgressReport, translateAnalysisFields } = require('../services/aiService');
const { uploadAudio, getSignedUrl } = require('../services/cloudStorageService');
const { assessPronunciationScore, intelligentSampleSegments } = require('../services/gpt4PronunciationService');
const { assessSegmentPronunciation } = require('../services/pronunciationService');
const { getWordAudio } = require('../services/audioSlicingService');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const audioBackupService = require('../services/audioBackupService');

/**
 * Calculate total speaking time from transcript segments (in seconds).
 * Uses segment.duration if available (from Whisper seg.end - seg.start).
 * Falls back to estimating from word count (~150 words/minute) for older segments.
 * @param {Array} segments - Array of transcript segments
 * @returns {number} Speaking time in seconds
 */
function calculateSpeakingTime(segments) {
  if (!segments || segments.length === 0) return 0;
  
  // Check if segments have duration data
  const segmentsWithDuration = segments.filter(s => s.duration && s.duration > 0);
  
  if (segmentsWithDuration.length > 0) {
    // Use actual duration data from Whisper timestamps
    const totalFromDurations = segmentsWithDuration.reduce((sum, s) => sum + s.duration, 0);
    
    // If only some segments have duration, estimate the rest proportionally
    if (segmentsWithDuration.length < segments.length) {
      const avgDuration = totalFromDurations / segmentsWithDuration.length;
      const estimatedRest = (segments.length - segmentsWithDuration.length) * avgDuration;
      return totalFromDurations + estimatedRest;
    }
    
    return totalFromDurations;
  }
  
  // Fallback for older segments without duration: estimate from word count
  // Average speaking rate is ~150 words per minute (2.5 words/second)
  const totalWords = segments.reduce((sum, s) => sum + (s.text ? s.text.split(/\s+/).length : 0), 0);
  return totalWords / 2.5; // words / (words per second) = seconds
}

// Configure multer for audio upload
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max
  },
  fileFilter: (req, file, cb) => {
    // Accept audio files
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  }
});

/**
 * Convert WebM audio to MP3 for better Whisper API compatibility
 */
async function convertWebmToMp3(webmBuffer) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const inputStream = Readable.from(webmBuffer);
    
    console.log(`🔄 Converting WebM (${webmBuffer.length} bytes) to MP3...`);
    
    // Create a writable stream to collect output
    const outputStream = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    
    ffmpeg(inputStream)
      .toFormat('mp3')
      .audioBitrate(128)
      .audioChannels(1) // Mono for voice
      .audioFrequency(16000) // 16kHz is good for speech
      .on('error', (err) => {
        console.error('❌ FFmpeg conversion error:', err.message);
        inputStream.destroy();
        outputStream.destroy();
        reject(new Error(`Audio conversion failed: ${err.message}`));
      })
      .on('end', () => {
        const mp3Buffer = Buffer.concat(chunks);
        console.log(`✅ Conversion complete: ${mp3Buffer.length} bytes`);
        inputStream.destroy();
        outputStream.destroy();
        resolve(mp3Buffer);
      })
      .pipe(outputStream);
  });
}

/**
 * Analyze audio buffer for speech energy using FFmpeg.
 * Returns metrics indicating whether meaningful speech is present.
 * Used as a pre-Whisper gate to prevent hallucinations from silence/noise.
 */
async function analyzeAudioEnergy(audioBuffer, mimeType = 'audio/mpeg') {
  return new Promise((resolve) => {
    const inputStream = Readable.from(audioBuffer);
    let stderrOutput = '';

    const defaultResult = { rmsLevelDb: 0, peakLevelDb: 0, silenceRatio: 0, durationSeconds: 0, hasSpeech: true };

    ffmpeg(inputStream)
      .audioChannels(1)
      .audioFrequency(16000)
      .audioFilters([
        'silencedetect=noise=-35dB:d=0.5',
        'astats=metadata=1:reset=0'
      ])
      .format('null')
      .on('stderr', (line) => {
        stderrOutput += line + '\n';
      })
      .on('error', (err) => {
        console.warn('⚠️ Audio energy analysis failed (non-critical):', err.message);
        resolve(defaultResult);
      })
      .on('end', () => {
        try {
          const rmsMatch = stderrOutput.match(/RMS level dB:\s*([-\d.]+)/);
          const peakMatch = stderrOutput.match(/Peak level dB:\s*([-\d.]+)/);
          const durationMatch = stderrOutput.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);

          const rmsLevelDb = rmsMatch ? parseFloat(rmsMatch[1]) : -91;
          const peakLevelDb = peakMatch ? parseFloat(peakMatch[1]) : -91;

          let durationSeconds = 0;
          if (durationMatch) {
            durationSeconds = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseFloat(durationMatch[3]);
          }

          const silenceStarts = [...stderrOutput.matchAll(/silence_start:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
          const silenceEnds = [...stderrOutput.matchAll(/silence_end:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));

          let totalSilence = 0;
          for (let i = 0; i < silenceEnds.length; i++) {
            const start = i < silenceStarts.length ? silenceStarts[i] : 0;
            totalSilence += silenceEnds[i] - start;
          }
          if (silenceStarts.length > silenceEnds.length && durationSeconds > 0) {
            totalSilence += durationSeconds - silenceStarts[silenceStarts.length - 1];
          }

          const silenceRatio = durationSeconds > 0 ? totalSilence / durationSeconds : 1;

          const hasSpeech = rmsLevelDb > -40 && silenceRatio < 0.90;

          const result = { rmsLevelDb, peakLevelDb, silenceRatio: Math.round(silenceRatio * 1000) / 1000, durationSeconds, hasSpeech };
          console.log(`🔊 Audio energy analysis: RMS=${rmsLevelDb}dB, Peak=${peakLevelDb}dB, silence=${(silenceRatio * 100).toFixed(1)}%, hasSpeech=${hasSpeech}`);
          resolve(result);
        } catch (parseErr) {
          console.warn('⚠️ Failed to parse audio energy output:', parseErr.message);
          resolve(defaultResult);
        }
      })
      .save('/dev/null');
  });
}

/**
 * Run ffmpeg silencedetect on an audio buffer and return the list of
 * speech intervals (the inverse of silence) in seconds, relative to the
 * start of the buffer. Used to derive tutor speech windows from the
 * remote Agora audio track for mic-bleed filtering.
 *
 * Returns: {
 *   intervals: Array<{ startSec: number, endSec: number }>,
 *   durationSeconds: number,
 *   rmsLevelDb: number,
 *   silenceRatio: number
 * }
 */
async function extractSpeechIntervals(audioBuffer, mimeType = 'audio/webm') {
  return new Promise((resolve) => {
    const inputStream = Readable.from(audioBuffer);
    let stderrOutput = '';

    const defaultResult = { intervals: [], durationSeconds: 0, rmsLevelDb: -91, silenceRatio: 1 };

    ffmpeg(inputStream)
      .audioChannels(1)
      .audioFrequency(16000)
      .audioFilters([
        // Slightly more sensitive than the student-side VAD because the tutor
        // signal is already clean and loud (it's the original Agora stream,
        // not a re-captured one). 0.4s minimum silence avoids splitting
        // natural pauses inside a tutor sentence into many intervals.
        'silencedetect=noise=-40dB:d=0.4',
        'astats=metadata=1:reset=0'
      ])
      .format('null')
      .on('stderr', (line) => {
        stderrOutput += line + '\n';
      })
      .on('error', (err) => {
        console.warn('⚠️ Tutor reference VAD failed (non-critical):', err.message);
        resolve(defaultResult);
      })
      .on('end', () => {
        try {
          const rmsMatch = stderrOutput.match(/RMS level dB:\s*([-\d.]+)/);
          const durationMatch = stderrOutput.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);

          const rmsLevelDb = rmsMatch ? parseFloat(rmsMatch[1]) : -91;
          let durationSeconds = 0;
          if (durationMatch) {
            durationSeconds = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseFloat(durationMatch[3]);
          }

          const silenceStarts = [...stderrOutput.matchAll(/silence_start:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
          const silenceEnds = [...stderrOutput.matchAll(/silence_end:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));

          // Build silence intervals first
          const silenceIntervals = [];
          let totalSilence = 0;
          for (let i = 0; i < Math.max(silenceStarts.length, silenceEnds.length); i++) {
            const start = i < silenceStarts.length ? silenceStarts[i] : 0;
            const end = i < silenceEnds.length ? silenceEnds[i] : (durationSeconds > 0 ? durationSeconds : start);
            if (end > start) {
              silenceIntervals.push({ startSec: start, endSec: end });
              totalSilence += end - start;
            }
          }

          // Invert silence intervals to get speech intervals
          const intervals = [];
          let cursor = 0;
          for (const s of silenceIntervals) {
            if (s.startSec > cursor + 0.01) {
              intervals.push({ startSec: Math.max(0, cursor), endSec: s.startSec });
            }
            cursor = Math.max(cursor, s.endSec);
          }
          if (durationSeconds > cursor + 0.01) {
            intervals.push({ startSec: cursor, endSec: durationSeconds });
          }

          const silenceRatio = durationSeconds > 0 ? totalSilence / durationSeconds : 1;
          const merged = mergeIntervals(intervals, 0.2);

          console.log(`🎯 Tutor speech intervals: ${merged.length} intervals across ${durationSeconds.toFixed(1)}s (RMS=${rmsLevelDb}dB, silence=${(silenceRatio * 100).toFixed(1)}%)`);

          resolve({
            intervals: merged,
            durationSeconds,
            rmsLevelDb,
            silenceRatio: Math.round(silenceRatio * 1000) / 1000
          });
        } catch (parseErr) {
          console.warn('⚠️ Failed to parse tutor reference VAD output:', parseErr.message);
          resolve(defaultResult);
        }
      })
      .save('/dev/null');
  });
}

/**
 * Merge intervals that are within `gapTolerance` seconds of each other so
 * that natural micro-pauses inside the tutor's speech don't fragment the
 * interval list.
 */
function mergeIntervals(intervals, gapTolerance = 0.2) {
  if (!intervals || intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startSec - b.startSec);
  const result = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = result[result.length - 1];
    const cur = sorted[i];
    if (cur.startSec <= last.endSec + gapTolerance) {
      last.endSec = Math.max(last.endSec, cur.endSec);
    } else {
      result.push({ ...cur });
    }
  }
  return result;
}

/**
 * Returns true if [segStart, segEnd] overlaps any of the provided tutor
 * speech intervals, applying a small symmetric tolerance to absorb the
 * minor drift between the student-side and tutor-side recorders.
 */
function segmentOverlapsTutor(segStart, segEnd, tutorIntervals, toleranceSec = 0.3) {
  if (!tutorIntervals || tutorIntervals.length === 0) return false;
  const lo = segStart - toleranceSec;
  const hi = segEnd + toleranceSec;
  for (const iv of tutorIntervals) {
    if (iv.endSec >= lo && iv.startSec <= hi) {
      return true;
    }
  }
  return false;
}

/**
 * Get target language from student's profile
 */
async function getTargetLanguageFromStudent(studentId) {
  try {
    const student = await User.findById(studentId);
    if (!student || !student.onboardingData || !student.onboardingData.languages) {
      console.warn(`⚠️  No language found for student ${studentId}, defaulting to Spanish`);
      return 'Spanish';
    }
    
    // Get first language from student's learning list
    const targetLanguage = student.onboardingData.languages[0];
    console.log(`🎯 Target language for student ${studentId}: ${targetLanguage}`);
    return targetLanguage;
  } catch (error) {
    console.error('❌ Error getting target language:', error);
    return 'Spanish'; // Default fallback
  }
}

// ==================== GET ALL ANALYSES FOR STUDENT ====================
/**
 * Get all analyses for the current student
 * @route   GET /api/transcription/my-analyses
 * @access  Private (Students only)
 */
router.get('/my-analyses', verifyToken, async (req, res) => {
  try {
    console.log('🔍 [my-analyses] Looking for user with auth0Id:', req.user.sub);
    
    // Get user ID from auth token (same pattern as /my-lessons)
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      console.log('❌ [my-analyses] User not found in database for auth0Id:', req.user.sub);
      return res.status(404).json({ 
        success: false, 
        message: 'User not found',
        auth0Id: req.user.sub
      });
    }
    
    console.log('📊 Fetching analyses for user:', user._id, user.email);
    
    // Check if user is a student
    if (user.userType !== 'student') {
      return res.status(403).json({
        success: false,
        message: 'Only students can view their analyses',
        userType: user.userType
      });
    }

    // Find all COMPLETED analyses for this student
    const analyses = await LessonAnalysis.find({ 
      studentId: user._id,
      status: 'completed'  // Only show completed analyses
    })
      .populate({
        path: 'lessonId',
        select: 'subject startTime isTrialLesson isOfficeHours officeHoursType bookingType'
      })
      .sort({ lessonDate: -1 }) // Most recent first
      .lean();
    
    // Filter out trial lessons and quick office hours from analyses
    const filteredAnalyses = analyses.filter(analysis => {
      const lesson = analysis.lessonId;
      
      // Exclude if no lesson data
      if (!lesson) return false;
      
      // Exclude trial lessons
      if (lesson.isTrialLesson === true) {
        console.log(`🚫 Excluding trial lesson: ${analysis._id}`);
        return false;
      }
      
      // Exclude quick office hours (officeHoursType === 'quick')
      if (lesson.isOfficeHours === true && lesson.officeHoursType === 'quick') {
        console.log(`🚫 Excluding quick office hours lesson: ${analysis._id}`);
        return false;
      }
      
      return true;
    });

    // Helper function to format display name
    const formatDisplayName = (user) => {
      if (!user) return 'Unknown';
      const firstName = user.firstName || user.name?.split(' ')[0];
      const lastName = user.lastName || user.name?.split(' ').slice(1).join(' ');
      if (firstName && lastName) {
        return `${firstName} ${lastName.charAt(0)}.`;
      }
      return user.name || 'Unknown';
    };

    // Manually fetch tutors for each analysis (since tutorId is stored as string)
    const formattedAnalyses = await Promise.all(filteredAnalyses.map(async (analysis) => {
      const tutor = await User.findById(analysis.tutorId).select('name firstName lastName picture').lean();
      
      return {
        _id: analysis._id,
        lessonId: analysis.lessonId?._id || analysis.lessonId,
        lessonDate: analysis.lessonDate || analysis.createdAt,
        language: analysis.language,
        proficiencyLevel: analysis.overallAssessment?.proficiencyLevel || 'N/A',
        confidence: analysis.overallAssessment?.confidence || 0,
        status: analysis.status,
        tutorName: formatDisplayName(tutor),
        tutorPicture: tutor?.picture,
        subject: analysis.lessonId?.subject || `${analysis.language} Lesson`,
        // Include detailed analysis for progress calculations
        grammarAnalysis: analysis.grammarAnalysis,
        fluencyAnalysis: analysis.fluencyAnalysis,
        vocabularyAnalysis: analysis.vocabularyAnalysis,
        progressionMetrics: analysis.progressionMetrics,
        // Include lesson type info for frontend filtering
        isTrialLesson: analysis.lessonId?.isTrialLesson || false,
        isOfficeHours: analysis.lessonId?.isOfficeHours || false,
        officeHoursType: analysis.lessonId?.officeHoursType || null
      };
    }));

    console.log(`✅ Fetched ${formattedAnalyses.length} analyses for student ${user._id} (filtered from ${analyses.length} total)`);


    res.json({
      success: true,
      analyses: formattedAnalyses
    });
  } catch (error) {
    console.error('❌ Error fetching student analyses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analyses',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/transcription/start
 * @desc    Start a new transcription session for a lesson
 * @access  Private
 */
router.post('/start', verifyToken, async (req, res) => {
  try {
    const { lessonId, language: frontendLanguage } = req.body;
    
    console.log('🎙️ ===== START TRANSCRIPTION REQUEST =====');
    console.log('🎙️ Lesson ID:', lessonId);
    console.log('🎙️ Frontend language hint:', frontendLanguage);
    
    if (!lessonId) {
      return res.status(400).json({ message: 'lessonId is required' });
    }
    
    // Verify lesson exists and populate student
    const lesson = await Lesson.findById(lessonId)
      .populate('studentId')
      .populate('tutorId');
    if (!lesson) {
      return res.status(404).json({ message: 'Lesson not found' });
    }
    
    // Get target language from student's profile (most reliable source)
    const targetLanguage = await getTargetLanguageFromStudent(lesson.studentId._id);
    console.log(`🎯 Target language from student profile: ${targetLanguage}`);
    
    // Use target language from profile, fallback to frontend hint
    const language = targetLanguage || frontendLanguage || 'Spanish';
    console.log(`📝 Final language for transcription: ${language}`);
    
    // Check if user is participant (compare Auth0 IDs)
    const userAuth0Id = req.user.sub;
    const studentAuth0Id = lesson.studentId?.auth0Id;
    const tutorAuth0Id = lesson.tutorId?.auth0Id;
    
    console.log('🔍 Authorization check:', {
      userAuth0Id,
      studentAuth0Id,
      tutorAuth0Id,
      isStudent: userAuth0Id === studentAuth0Id,
      isTutor: userAuth0Id === tutorAuth0Id
    });
    
    if (userAuth0Id !== studentAuth0Id && userAuth0Id !== tutorAuth0Id) {
      return res.status(403).json({ message: 'Not authorized for this lesson' });
    }
    
    // Check if transcript already exists
    let transcript = await LessonTranscript.findOne({ lessonId });
    
    console.log(`🎙️ Starting transcription for lesson ${lessonId} with language: ${language}`);
    
    if (transcript) {
      console.log(`📋 Found existing transcript with status: ${transcript.status}, segments: ${transcript.segments?.length || 0}`);
      
      // Only reset if transcript was previously completed or failed (lesson re-do)
      if (transcript.status === 'completed' || transcript.status === 'failed') {
        console.log(`🔄 Resetting transcript for lesson re-do (was ${transcript.status})`);
        transcript.status = 'recording';
        transcript.segments = [];
        transcript.startTime = new Date();
        transcript.endTime = null;
        transcript.language = language;
      } else if (transcript.status === 'recording' || transcript.status === 'processing') {
        // This is a RESUME of an ongoing session - keep existing segments!
        console.log(`▶️ Resuming existing transcript session (keeping ${transcript.segments?.length || 0} segments)`);
        transcript.status = 'recording'; // Ensure it's in recording state
        transcript.language = language; // Update language if changed
        // DON'T clear segments - this is the fix!
      }
      
      await transcript.save();
      console.log(`✅ Transcript ready with ${transcript.segments?.length || 0} existing segments`);
    } else {
      // Create new transcript
      transcript = await LessonTranscript.create({
        lessonId,
        studentId: lesson.studentId._id,
        tutorId: lesson.tutorId._id,
        language,
        startTime: new Date(),
        status: 'recording'
      });
      console.log(`✨ Created new transcript with language: ${language}`);
    }
    
    console.log(`✅ Started transcription for lesson ${lessonId}`);
    
    res.json({
      transcriptId: transcript._id,
      status: 'recording',
      language: language
    });
    
  } catch (error) {
    console.error('❌ Error starting transcription:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/transcription/:transcriptId/segments
 * @desc    Add transcript segments in real-time
 * @access  Private
 */
router.post('/:transcriptId/segments', verifyToken, async (req, res) => {
  try {
    const { transcriptId } = req.params;
    const { segments } = req.body;
    
    if (!segments || !Array.isArray(segments)) {
      return res.status(400).json({ message: 'segments array is required' });
    }
    
    const transcript = await LessonTranscript.findById(transcriptId);
    if (!transcript) {
      return res.status(404).json({ message: 'Transcript not found' });
    }
    
    // Add segments
    transcript.segments.push(...segments);
    await transcript.save();
    
    res.json({ 
      message: 'Segments added',
      totalSegments: transcript.segments.length
    });
    
  } catch (error) {
    console.error('❌ Error adding segments:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/transcription/:transcriptId/audio
 * @desc    Upload audio file for transcription
 * @access  Private
 */
router.post('/:transcriptId/audio', verifyToken, upload.single('audio'), async (req, res) => {
  try {
    const { transcriptId } = req.params;
    const { speaker } = req.body; // 'student' or 'tutor'
    
    console.log('🎙️ ========== AUDIO UPLOAD RECEIVED ==========');
    console.log('🎙️ Transcript ID:', transcriptId);
    console.log('🎙️ Speaker:', speaker);
    console.log('🎙️ Has file:', !!req.file);
    console.log('🎙️ File size:', req.file?.size, 'bytes');
    console.log('🎙️ File mimetype:', req.file?.mimetype);
    
    if (!req.file) {
      console.error('❌ No audio file in request');
      return res.status(400).json({ message: 'Audio file is required' });
    }
    
    const transcript = await LessonTranscript.findById(transcriptId);
    if (!transcript) {
      console.error('❌ Transcript not found:', transcriptId);
      return res.status(404).json({ message: 'Transcript not found' });
    }
    
    console.log(`🎙️ Found transcript, language: ${transcript.language}`);
    console.log(`🎙️ Language type: ${typeof transcript.language}, empty: ${!transcript.language}`);
    
    // Validate language is present
    if (!transcript.language) {
      console.error('❌ No language set in transcript');
      return res.status(400).json({ message: 'Transcript has no language set' });
    }
    
    // Normalize language to ISO-639-1 code (in case frontend sent full language name)
    const languageMap = {
      'Spanish': 'es',
      'spanish': 'es',
      'spanish lesson': 'es',
      'French': 'fr',
      'french': 'fr',
      'french lesson': 'fr',
      'German': 'de',
      'german': 'de',
      'german lesson': 'de',
      'Italian': 'it',
      'italian': 'it',
      'italian lesson': 'it',
      'Portuguese': 'pt',
      'portuguese': 'pt',
      'portuguese lesson': 'pt',
      'English': 'en',
      'english': 'en',
      'english lesson': 'en',
      'Chinese': 'zh',
      'chinese': 'zh',
      'chinese lesson': 'zh',
      'Japanese': 'ja',
      'japanese': 'ja',
      'japanese lesson': 'ja',
      'Korean': 'ko',
      'korean': 'ko',
      'korean lesson': 'ko',
      'Russian': 'ru',
      'russian': 'ru',
      'russian lesson': 'ru',
      'Arabic': 'ar',
      'arabic': 'ar',
      'arabic lesson': 'ar',
      // Also handle ISO codes directly (in case they're already normalized)
      'es': 'es',
      'fr': 'fr',
      'de': 'de',
      'it': 'it',
      'pt': 'pt',
      'en': 'en',
      'zh': 'zh',
      'ja': 'ja',
      'ko': 'ko',
      'ru': 'ru',
      'ar': 'ar'
    };
    
    // Convert to lowercase for case-insensitive lookup
    const lookupKey = transcript.language.toLowerCase();
    const normalizedLanguage = languageMap[lookupKey] || transcript.language;
    console.log(`🎙️ Normalized language: ${transcript.language} → ${normalizedLanguage}`);
    
    // Validate normalized language is a valid ISO code
    const validIsoCodes = ['es', 'fr', 'de', 'it', 'pt', 'en', 'zh', 'ja', 'ko', 'ru', 'ar'];
    if (!validIsoCodes.includes(normalizedLanguage)) {
      console.error(`❌ Invalid language code: ${normalizedLanguage}`);
      return res.status(400).json({ message: `Invalid language code: ${normalizedLanguage}` });
    }
    
    console.log(`🎙️ Transcribing audio for ${speaker} using OpenAI Whisper...`);
    
    // Store original buffer for pronunciation assessment (before any conversion)
    const originalAudioBuffer = req.file.buffer;
    let audioBuffer = req.file.buffer;
    const isWebm = req.file.mimetype === 'audio/webm' || req.file.originalname.endsWith('.webm');
    
    console.log(`📤 Received audio: ${isWebm ? 'WebM' : 'other'} format (${audioBuffer.length} bytes)`);
    console.log(`📤 First 20 bytes: ${[...audioBuffer.slice(0, 20)].map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    
    // ALWAYS convert WebM to MP3 for better Whisper compatibility
    if (isWebm) {
      console.log('🔄 Converting WebM to MP3 for Whisper compatibility...');
      try {
        audioBuffer = await convertWebmToMp3(originalAudioBuffer);
        console.log(`✅ Converted to MP3: ${audioBuffer.length} bytes`);
      } catch (conversionError) {
        console.error('❌ WebM to MP3 conversion failed:', conversionError.message);
        return res.status(500).json({
          message: `Audio conversion failed: ${conversionError.message}`,
          error: 'audio_conversion_failed',
          details: 'Could not convert WebM to MP3. This audio chunk will be skipped.',
          inputSize: originalAudioBuffer.length,
          firstBytes: [...originalAudioBuffer.slice(0, 20)].map(b => b.toString(16).padStart(2, '0')).join(' ')
        });
      }
    }
    
    console.log(`📤 Attempting transcription with MP3 format (${audioBuffer.length} bytes)`);
    
    // BACKUP: Save audio to GCS BEFORE transcription attempt
    // This allows retry if Whisper/GPT is down
    let backupInfo = null;
    try {
      const chunkIndex = transcript.audioChunks ? transcript.audioChunks.length : 0;
      backupInfo = await audioBackupService.uploadAudioChunk(
        originalAudioBuffer,
        transcript.lessonId.toString(),
        chunkIndex,
        speaker,
        req.file.mimetype
      );
      
      if (backupInfo) {
        console.log(`💾 Audio backed up to GCS: ${backupInfo.gcsPath}`);
        console.log(`🗑️  Will auto-delete at: ${backupInfo.deleteAt}`);
      }
    } catch (backupError) {
      console.error('⚠️  Audio backup failed (non-critical):', backupError.message);
      // Continue - backup failure shouldn't stop transcription
    }
    
    // LAYER 1: Pre-Whisper audio energy check (VAD)
    // Prevents Whisper from hallucinating on silence/noise
    let audioEnergyResult = null;
    try {
      audioEnergyResult = await analyzeAudioEnergy(audioBuffer);
      
      // Store metrics on the transcript for the quality gate later
      const chunkIdx = transcript.audioEnergyMetrics ? transcript.audioEnergyMetrics.length : 0;
      transcript.audioEnergyMetrics = transcript.audioEnergyMetrics || [];
      transcript.audioEnergyMetrics.push({
        chunkIndex: chunkIdx,
        rmsLevelDb: audioEnergyResult.rmsLevelDb,
        peakLevelDb: audioEnergyResult.peakLevelDb,
        silenceRatio: audioEnergyResult.silenceRatio,
        durationSeconds: audioEnergyResult.durationSeconds,
        hasSpeech: audioEnergyResult.hasSpeech
      });
      
      if (!audioEnergyResult.hasSpeech) {
        console.log(`🔇 Audio energy below speech threshold — skipping Whisper to prevent hallucination`);
        console.log(`   RMS: ${audioEnergyResult.rmsLevelDb}dB, Silence: ${(audioEnergyResult.silenceRatio * 100).toFixed(1)}%`);
        
        await transcript.save();
        
        return res.json({
          message: 'Audio chunk skipped — no speech detected (silence/noise only)',
          segmentsAdded: 0,
          text: '',
          skippedReason: 'no_speech_energy'
        });
      }
    } catch (vadError) {
      console.warn('⚠️ VAD analysis failed (non-critical, proceeding with Whisper):', vadError.message);
    }
    
    // Transcribe audio using OpenAI Whisper (with retry logic)
    let result;
    let transcriptionSuccess = false;
    try {
      // Try with original format first
      result = await transcribeAudio(audioBuffer, normalizedLanguage, speaker);
      transcriptionSuccess = true;
      
      console.log('✅ Whisper transcription result:', {
        text: result.text,
        segmentsCount: result.segments?.length || 0,
        originalSegments: result.originalSegmentCount || 0,
        filteredSegments: result.filteredSegmentCount || 0,
        rejectedSegments: result.rejectedSegmentCount || 0
      });
      
      // Log language filtering effectiveness
      if (result.rejectedSegmentCount > 0) {
        console.log(`🔍 Language Filter: Rejected ${result.rejectedSegmentCount} non-${normalizedLanguage} segments`);
        console.log(`   This prevents ${speaker}'s non-target language speech from being analyzed`);
      }
    } catch (transcriptionError) {
      // Check if error is format-related
      const isFormatError = transcriptionError.message && (
        transcriptionError.message.includes('could not be decoded') ||
        transcriptionError.message.includes('format is not supported') ||
        transcriptionError.message.includes('400')
      );
      
      // If WebM and format error, try converting to MP3
      if (isWebm && isFormatError) {
        console.log('⚠️  WebM format error detected. Converting to MP3 and retrying...');
        
        try {
          audioBuffer = await convertWebmToMp3(originalAudioBuffer);
          console.log(`✅ Converted to MP3: ${audioBuffer.length} bytes`);
          
          // Retry with MP3
          result = await transcribeAudio(audioBuffer, normalizedLanguage, speaker);
          transcriptionSuccess = true;
          
          console.log('✅ Whisper transcription result (after MP3 conversion):', {
            text: result.text,
            segmentsCount: result.segments?.length || 0,
            originalSegments: result.originalSegmentCount || 0,
            filteredSegments: result.filteredSegmentCount || 0,
            rejectedSegments: result.rejectedSegmentCount || 0
          });
          
          // Log language filtering effectiveness
          if (result.rejectedSegmentCount > 0) {
            console.log(`🔍 Language Filter: Rejected ${result.rejectedSegmentCount} non-${normalizedLanguage} segments`);
            console.log(`   This prevents ${speaker}'s non-target language speech from being analyzed`);
          }
        } catch (conversionError) {
          console.error('❌ MP3 conversion failed:', conversionError.message);
          console.error('❌ Original Whisper error:', transcriptionError.message);
          
          // Save backup info for retry even though transcription failed
          if (backupInfo) {
            transcript.audioChunks = transcript.audioChunks || [];
            transcript.audioChunks.push({
              chunkIndex: transcript.audioChunks.length,
              gcsPath: backupInfo.gcsPath,
              uploadedAt: new Date(),
              sizeBytes: backupInfo.sizeBytes,
              speaker: speaker,
              transcribed: false,
              transcriptionAttempts: 1,
              lastTranscriptionAttempt: new Date(),
              deleteAt: backupInfo.deleteAt
            });
            await transcript.save();
            console.log('💾 Backup info saved for retry');
          }
          
          // Return error but don't crash - this chunk will be skipped
          return res.status(500).json({ 
            message: `Transcription failed: ${transcriptionError.message}. Conversion also failed: ${conversionError.message}`,
            error: 'audio_transcription_failed',
            details: 'This audio chunk will be skipped. Recording continues.',
            hasBackup: !!backupInfo
          });
        }
      } else {
        // Non-format error or not WebM - just fail
        console.error('❌ Whisper transcription failed:', transcriptionError.message);
        
        // Save backup info for retry
        if (backupInfo) {
          transcript.audioChunks = transcript.audioChunks || [];
          transcript.audioChunks.push({
            chunkIndex: transcript.audioChunks.length,
            gcsPath: backupInfo.gcsPath,
            uploadedAt: new Date(),
            sizeBytes: backupInfo.sizeBytes,
            speaker: speaker,
            transcribed: false,
            transcriptionAttempts: 1,
            lastTranscriptionAttempt: new Date(),
            deleteAt: backupInfo.deleteAt
          });
          await transcript.save();
          console.log('💾 Backup info saved for retry');
        }
        
        // Return error but don't crash - this chunk will be skipped
        return res.status(500).json({ 
          message: `Transcription failed: ${transcriptionError.message}`,
          error: 'audio_transcription_failed',
          details: 'This audio chunk will be skipped. Recording continues.',
          hasBackup: !!backupInfo
        });
      }
    }
    
    // Mark backup as successfully transcribed if we got here
    if (backupInfo && transcriptionSuccess) {
      transcript.audioChunks = transcript.audioChunks || [];
      transcript.audioChunks.push({
        chunkIndex: transcript.audioChunks.length,
        gcsPath: backupInfo.gcsPath,
        uploadedAt: new Date(),
        sizeBytes: backupInfo.sizeBytes,
        speaker: speaker,
        transcribed: true,
        transcriptionAttempts: 1,
        lastTranscriptionAttempt: new Date(),
        deleteAt: backupInfo.deleteAt
      });
      console.log('✅ Backup info saved (transcription successful)');
    }
    
    // Pronunciation assessment disabled - not providing meaningful value
    // Focus is on grammar, tenses, vocabulary, and word choice instead
    let pronunciationResult = null;
    console.log('ℹ️  Pronunciation assessment skipped (disabled)');
    
    // Add segments to transcript
    // Store audio ONLY for student segments in target language (for pronunciation assessment)
    // Compare normalized languages (both should be ISO codes)
    const transcriptNormalizedLanguage = languageMap[transcript.language.toLowerCase()] || transcript.language;
    const isStudentInTargetLanguage = (speaker === 'student' || !speaker) && 
                                       normalizedLanguage === transcriptNormalizedLanguage;
    
    console.log(`🔍 Audio storage check:`, {
      speaker,
      normalizedLanguage,
      transcriptLanguage: transcript.language,
      transcriptNormalizedLanguage,
      isStudentInTargetLanguage,
      willStoreAudio: isStudentInTargetLanguage
    });
    
    const segments = result.segments
      .filter(seg => seg.text && seg.text.trim().length > 0)
      .map(seg => {
      const segmentData = {
        timestamp: new Date(transcript.startTime.getTime() + (seg.start * 1000)),
        speaker: speaker || 'student',
        text: seg.text,
        confidence: seg.confidence || 1,
        language: transcript.language,
        duration: (seg.end != null && seg.start != null) ? (seg.end - seg.start) : 0,
        noSpeechProb: seg.no_speech_prob != null ? seg.no_speech_prob : null
      };
      
      return segmentData;
    });
    
    // Upload audio to Google Cloud Storage if this is student speech in target language
    // Store GCS path instead of base64 to avoid MongoDB 16MB limit
    if (isStudentInTargetLanguage && segments.length > 0) {
      try {
        // Upload to GCS - use first segment index for filename
        const segmentIndex = transcript.segments.length;
        const gcsPath = await uploadAudio(
          originalAudioBuffer,
          transcript.lessonId.toString(),
          segmentIndex,
          req.file.mimetype
        );
        
        // Store GCS path in all segments from this audio chunk
        segments.forEach(seg => {
          seg.audioGcsPath = gcsPath;
          seg.audioMimeType = req.file.mimetype;
        });
        
        console.log(`☁️  Audio uploaded to GCS: ${Math.round(originalAudioBuffer.length / 1024)}KB`);
      } catch (gcsError) {
        console.error('❌ Failed to upload to GCS:', gcsError);
        // Continue without audio storage - don't fail the whole transcription
      }
    }
    
    transcript.segments.push(...segments);
    
    // Save pronunciation result if available
    if (pronunciationResult) {
      console.log('💾 Saving pronunciation result to transcript...');
      transcript.pronunciationSegments = transcript.pronunciationSegments || [];
      transcript.pronunciationSegments.push({
        timestamp: new Date(),
        ...pronunciationResult
      });
      console.log(`✅ Pronunciation segment saved. Total pronunciation segments: ${transcript.pronunciationSegments.length}`);
    } else {
      console.log('ℹ️  No pronunciation result to save (assessment may have been skipped or failed)');
    }
    
    transcript.status = 'processing';
    await transcript.save();
    
    console.log(`✅ Saved ${segments.length} segments to transcript`);
    console.log(`📊 TOTAL TRANSCRIPT STATS:`);
    console.log(`   Total segments now: ${transcript.segments.length}`);
    console.log(`   Student segments: ${transcript.segments.filter(s => s.speaker === 'student').length}`);
    console.log(`   Tutor segments: ${transcript.segments.filter(s => s.speaker === 'tutor').length}`);
    console.log(`   Pronunciation segments: ${transcript.pronunciationSegments?.length || 0}`);
    console.log('📝 Transcribed text:', result.text);
    console.log('🎙️ ========== AUDIO UPLOAD COMPLETE ==========');
    
    res.json({
      message: 'Audio transcribed successfully',
      segmentsAdded: segments.length,
      text: result.text
    });
    
  } catch (error) {
    console.error('❌ ❌ ❌ Error transcribing audio:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: 'Transcription failed', error: error.message });
  }
});

/**
 * @route   POST /api/transcription/:transcriptId/tutor-reference
 * @desc    Receive the tutor's clean Agora remote-audio track and extract
 *          the time intervals where the tutor was actually speaking. These
 *          intervals are later used to filter out student-tagged segments
 *          that overlap (microphone bleed from the student's speakers back
 *          into their mic).
 *
 *          The audio is NOT transcribed — we only need to know WHEN the
 *          tutor was talking. VAD is essentially free (ffmpeg silencedetect)
 *          so this adds no per-lesson cost.
 * @access  Private
 */
router.post('/:transcriptId/tutor-reference', verifyToken, upload.single('audio'), async (req, res) => {
  try {
    const { transcriptId } = req.params;

    console.log('🎯 ========== TUTOR REFERENCE UPLOAD RECEIVED ==========');
    console.log('🎯 Transcript ID:', transcriptId);
    console.log('🎯 Has file:', !!req.file);
    console.log('🎯 File size:', req.file?.size, 'bytes');
    console.log('🎯 File mimetype:', req.file?.mimetype);

    if (!req.file) {
      console.error('❌ No tutor reference audio file in request');
      return res.status(400).json({ message: 'Audio file is required' });
    }

    const transcript = await LessonTranscript.findById(transcriptId);
    if (!transcript) {
      console.error('❌ Transcript not found:', transcriptId);
      return res.status(404).json({ message: 'Transcript not found' });
    }

    const vadResult = await extractSpeechIntervals(req.file.buffer, req.file.mimetype);

    transcript.tutorSpeechIntervals = vadResult.intervals;
    transcript.tutorReferenceMeta = {
      durationSeconds: vadResult.durationSeconds,
      rmsLevelDb: vadResult.rmsLevelDb,
      silenceRatio: vadResult.silenceRatio,
      processedAt: new Date(),
      sizeBytes: req.file.size
    };

    await transcript.save();

    const totalSpeechSec = vadResult.intervals.reduce((sum, iv) => sum + (iv.endSec - iv.startSec), 0);
    console.log(`✅ Tutor reference processed: ${vadResult.intervals.length} speech intervals, ${totalSpeechSec.toFixed(1)}s of speech in ${vadResult.durationSeconds.toFixed(1)}s of audio`);
    console.log('🎯 ========== TUTOR REFERENCE UPLOAD COMPLETE ==========');

    res.json({
      message: 'Tutor reference processed successfully',
      intervalsExtracted: vadResult.intervals.length,
      totalSpeechSeconds: Math.round(totalSpeechSec * 100) / 100,
      durationSeconds: Math.round(vadResult.durationSeconds * 100) / 100
    });

  } catch (error) {
    console.error('❌ Error processing tutor reference:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: 'Tutor reference processing failed', error: error.message });
  }
});

/**
 * @route   POST /api/transcription/:transcriptId/complete
 * @desc    Mark transcription as complete and trigger analysis
 * @access  Private
 */
router.post('/:transcriptId/complete', verifyToken, async (req, res) => {
  try {
    const { transcriptId } = req.params;
    
    const transcript = await LessonTranscript.findById(transcriptId);
    if (!transcript) {
      return res.status(404).json({ message: 'Transcript not found' });
    }
    
    transcript.endTime = new Date();
    transcript.status = 'completed';
    
    // Calculate metadata
    const studentSegments = transcript.segments.filter(s => s.speaker === 'student');
    const tutorSegments = transcript.segments.filter(s => s.speaker === 'tutor');
    
    // Calculate actual speaking time from segment durations (in seconds)
    // Falls back to timestamp-based estimation for older segments without duration field
    const studentSpeakingSeconds = calculateSpeakingTime(studentSegments);
    const tutorSpeakingSeconds = calculateSpeakingTime(tutorSegments);
    
    console.log(`⏱️ Speaking time calculated — Student: ${Math.round(studentSpeakingSeconds)}s, Tutor: ${Math.round(tutorSpeakingSeconds)}s`);
    
    transcript.metadata = {
      totalDuration: (transcript.endTime - transcript.startTime) / 1000, // seconds
      studentSpeakingTime: Math.round(studentSpeakingSeconds), // in seconds
      tutorSpeakingTime: Math.round(tutorSpeakingSeconds), // in seconds
      wordCount: transcript.segments.reduce((sum, seg) => sum + seg.text.split(' ').length, 0)
    };
    
    // Populate fullText from segments (required for audio slicing)
    transcript.fullText = transcript.segments.map(s => s.text).join(' ');
    console.log(`📝 Populated fullText: ${transcript.fullText.length} characters`);
    
    await transcript.save();
    
    console.log(`✅ Transcription completed for lesson ${transcript.lessonId}`);
    
    // Check if student had AI analysis enabled at lesson time (use snapshot, fall back to live profile)
    const User = require('../models/User');
    const Lesson = require('../models/Lesson');
    const lesson = await Lesson.findById(transcript.lessonId);
    
    // Determine AI setting: prefer snapshot, fall back to live profile
    let aiDisabledForThisLesson = false;
    if (lesson) {
      if (lesson.aiAnalysisEnabledAtTime !== null && lesson.aiAnalysisEnabledAtTime !== undefined) {
        aiDisabledForThisLesson = lesson.aiAnalysisEnabledAtTime === false;
      } else {
        // Legacy lesson without snapshot — check live profile and stamp it
        const student = await User.findOne({ auth0Id: transcript.studentId });
        const liveValue = student?.profile?.aiAnalysisEnabled !== false;
        lesson.aiAnalysisEnabledAtTime = liveValue;
        await lesson.save();
        console.log(`📸 [Transcription] Snapshotted aiAnalysisEnabledAtTime=${liveValue} for lesson ${lesson._id}`);
        aiDisabledForThisLesson = !liveValue;
      }
    }
    
    if (aiDisabledForThisLesson) {
      console.log('⏭️  AI analysis disabled (snapshot) - creating manual feedback requirement');
      
      // Mark lesson as requiring tutor feedback
      const TutorFeedback = require('../models/TutorFeedback');
      const Notification = require('../models/Notification');
      const { getRandomFeedbackMessage } = require('../utils/feedbackMessages');
      
      if (lesson) {
        lesson.requiresTutorFeedback = true;
        lesson.status = 'completed';
        await lesson.save();
        
        // Get tutor and student for feedback record and notification
        const tutor = await User.findOne({ auth0Id: transcript.tutorId });
        const studentData = await User.findOne({ auth0Id: transcript.studentId });
        
        // Create pending feedback record using MongoDB _id for consistency
        await TutorFeedback.create({
          lessonId: transcript.lessonId,
          tutorId: tutor ? tutor._id : transcript.tutorId,
          studentId: studentData ? studentData._id : transcript.studentId,
          status: 'pending',
          required: true
        });
        
        // Get dynamic message
        const feedbackMsg = getRandomFeedbackMessage(transcript.lessonId.toString());
        
        // Import name formatter
        const { formatNameWithInitial } = require('../utils/nameFormatter');
        
        // Create notification for tutor
        if (tutor) {
          await Notification.create({
            userId: tutor._id,
            type: 'feedback_required',
            title: feedbackMsg.title,
            message: feedbackMsg.message,
            data: {
              lessonId: transcript.lessonId,
              studentName: studentData ? formatNameWithInitial(studentData) : 'Student',
              studentAuth0Id: transcript.studentId
            }
          });
          
          // Emit WebSocket event
          const io = req.app.get('io');
          if (io) {
            io.to(`user:${transcript.tutorId}`).emit('feedback_required', {
              lessonId: transcript.lessonId,
              studentName: studentData?.name || 'Student',
              title: feedbackMsg.title,
              message: feedbackMsg.message
            });
          }
          
          console.log(`📢 Sent feedback request to tutor: ${tutor.email}`);
        }
      }
      
      return res.json({
        message: 'Transcription completed - Manual feedback required',
        metadata: transcript.metadata,
        analysisStarted: false,
        feedbackRequired: true
      });
    }
    
    // AI analysis enabled - trigger normal analysis (async)
    analyzeLesson(transcript._id).catch(err => {
      console.error('❌ Error analyzing lesson:', err);
    });
    
    res.json({
      message: 'Transcription completed',
      metadata: transcript.metadata,
      analysisStarted: true
    });
    
  } catch (error) {
    console.error('❌ Error completing transcription:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * Get signed URL for audio playback
 * GET /api/transcription/audio-url
 */
router.get('/audio-url', verifyToken, async (req, res) => {
  try {
    const { gcsPath } = req.query;
    
    if (!gcsPath) {
      return res.status(400).json({ error: 'GCS path is required' });
    }
    
    console.log(`🔊 Generating signed URL for: ${gcsPath}`);
    
    // Generate signed URL (valid for 1 hour)
    const signedUrl = await getSignedUrl(gcsPath, 60);
    
    res.json({ url: signedUrl });
  } catch (error) {
    console.error('❌ Error generating signed URL:', error);
    res.status(500).json({ error: 'Failed to generate audio URL' });
  }
});

/**
 * Get word-specific audio (sliced from full segment)
 * GET /api/transcription/word-audio
 */
router.get('/word-audio', verifyToken, async (req, res) => {
  try {
    const { gcsPath, word, text } = req.query;
    
    if (!gcsPath || !word) {
      return res.status(400).json({ error: 'GCS path and word are required' });
    }
    
    console.log(`✂️  Extracting audio for word: "${word}"`);
    
    const result = await getWordAudio(gcsPath, word, text);
    
    // Send audio buffer as response
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', result.audio.length);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.send(result.audio);
    
  } catch (error) {
    console.error('❌ Error extracting word audio:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to extract word audio' });
    }
  }
});

/**
 * Get correct pronunciation audio using TTS
 * GET /api/transcription/correct-pronunciation
 */
router.get('/correct-pronunciation', verifyToken, async (req, res) => {
  try {
    const { word, language } = req.query;
    
    if (!word || !language) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    console.log(`🔊 Generating TTS for word: "${word}" in ${language}`);
    
    // Use Google Cloud TTS for native pronunciation
    const textToSpeech = require('@google-cloud/text-to-speech');
    
    // Initialize client with same credentials as Storage
    const clientConfig = {
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    };
    
    if (process.env.GOOGLE_CLOUD_KEY_FILE) {
      clientConfig.keyFilename = process.env.GOOGLE_CLOUD_KEY_FILE;
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      clientConfig.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    }
    
    const ttsClient = new textToSpeech.TextToSpeechClient(clientConfig);
    
    // Comprehensive language name to ISO code mapping (language-agnostic)
    const languageMap = {
      // Spanish
      'spanish': 'es-ES', 'español': 'es-ES', 'es': 'es-ES',
      // French
      'french': 'fr-FR', 'français': 'fr-FR', 'francais': 'fr-FR', 'fr': 'fr-FR',
      // German
      'german': 'de-DE', 'deutsch': 'de-DE', 'de': 'de-DE',
      // Portuguese
      'portuguese': 'pt-BR', 'português': 'pt-BR', 'portugues': 'pt-BR', 'pt': 'pt-BR',
      // English
      'english': 'en-US', 'en': 'en-US',
      // Italian
      'italian': 'it-IT', 'italiano': 'it-IT', 'it': 'it-IT',
      // Japanese
      'japanese': 'ja-JP', '日本語': 'ja-JP', 'ja': 'ja-JP',
      // Korean
      'korean': 'ko-KR', '한국어': 'ko-KR', 'ko': 'ko-KR',
      // Mandarin Chinese
      'chinese': 'cmn-CN', 'mandarin': 'cmn-CN', '中文': 'cmn-CN', 'zh': 'cmn-CN', 'cmn': 'cmn-CN',
      // Arabic
      'arabic': 'ar-XA', 'العربية': 'ar-XA', 'ar': 'ar-XA',
      // Russian
      'russian': 'ru-RU', 'русский': 'ru-RU', 'ru': 'ru-RU',
      // Hindi
      'hindi': 'hi-IN', 'हिन्दी': 'hi-IN', 'hi': 'hi-IN',
      // Dutch
      'dutch': 'nl-NL', 'nederlands': 'nl-NL', 'nl': 'nl-NL',
      // Polish
      'polish': 'pl-PL', 'polski': 'pl-PL', 'pl': 'pl-PL',
      // Turkish
      'turkish': 'tr-TR', 'türkçe': 'tr-TR', 'turkce': 'tr-TR', 'tr': 'tr-TR',
      // Swedish
      'swedish': 'sv-SE', 'svenska': 'sv-SE', 'sv': 'sv-SE',
      // Norwegian
      'norwegian': 'nb-NO', 'norsk': 'nb-NO', 'no': 'nb-NO', 'nb': 'nb-NO',
      // Danish
      'danish': 'da-DK', 'dansk': 'da-DK', 'da': 'da-DK',
      // Finnish
      'finnish': 'fi-FI', 'suomi': 'fi-FI', 'fi': 'fi-FI',
      // Greek
      'greek': 'el-GR', 'ελληνικά': 'el-GR', 'el': 'el-GR',
      // Czech
      'czech': 'cs-CZ', 'čeština': 'cs-CZ', 'cestina': 'cs-CZ', 'cs': 'cs-CZ',
      // Slovak
      'slovak': 'sk-SK', 'slovenčina': 'sk-SK', 'slovencina': 'sk-SK', 'sk': 'sk-SK',
      // Ukrainian
      'ukrainian': 'uk-UA', 'українська': 'uk-UA', 'uk': 'uk-UA',
      // Vietnamese
      'vietnamese': 'vi-VN', 'tiếng việt': 'vi-VN', 'vi': 'vi-VN',
      // Thai
      'thai': 'th-TH', 'ไทย': 'th-TH', 'th': 'th-TH',
      // Indonesian
      'indonesian': 'id-ID', 'bahasa indonesia': 'id-ID', 'id': 'id-ID',
      // Malay
      'malay': 'ms-MY', 'bahasa melayu': 'ms-MY', 'ms': 'ms-MY',
      // Filipino/Tagalog
      'filipino': 'fil-PH', 'tagalog': 'fil-PH', 'fil': 'fil-PH',
      // Bengali
      'bengali': 'bn-IN', 'বাংলা': 'bn-IN', 'bn': 'bn-IN',
      // Tamil
      'tamil': 'ta-IN', 'தமிழ்': 'ta-IN', 'ta': 'ta-IN',
      // Telugu
      'telugu': 'te-IN', 'తెలుగు': 'te-IN', 'te': 'te-IN',
      // Gujarati
      'gujarati': 'gu-IN', 'ગુજરાતી': 'gu-IN', 'gu': 'gu-IN',
      // Kannada
      'kannada': 'kn-IN', 'ಕನ್ನಡ': 'kn-IN', 'kn': 'kn-IN',
      // Malayalam
      'malayalam': 'ml-IN', 'മലയാളം': 'ml-IN', 'ml': 'ml-IN',
      // Catalan
      'catalan': 'ca-ES', 'català': 'ca-ES', 'catala': 'ca-ES', 'ca': 'ca-ES',
    };
    
    // Get language code (normalize to lowercase for matching)
    const langCode = languageMap[language.toLowerCase()];
    
    // If language not in map, try to use it directly if it looks like an ISO code
    let finalLangCode = langCode;
    if (!langCode) {
      // Check if it's already in ISO format (e.g., "es-ES" or "fr-FR")
      if (/^[a-z]{2,3}(-[A-Z]{2})?$/i.test(language)) {
        finalLangCode = language;
      } else {
        // Fallback to English
        console.warn(`⚠️  Unknown language "${language}", falling back to en-US`);
        finalLangCode = 'en-US';
      }
    }
    
    console.log(`🗣️  Using voice for language code: ${finalLangCode}`);
    
    // Construct the request with dynamic language code
    // Google Cloud will automatically select the best available voice for the language
    const request = {
      input: { text: word },
      voice: {
        languageCode: finalLangCode,
        // Let Google pick the best voice, or specify Neural2 if available
        ssmlGender: 'FEMALE' // or 'MALE' - consistent across languages
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 0.85, // Slightly slower for learning (0.25 to 4.0)
        pitch: 0.0,
        volumeGainDb: 0.0
      }
    };
    
    // Perform the text-to-speech request
    const [response] = await ttsClient.synthesizeSpeech(request);
    const audioBuffer = Buffer.from(response.audioContent);
    
    console.log(`✅ Generated Google TTS: ${Math.round(audioBuffer.length / 1024)}KB (${finalLangCode})`);
    
    // Send audio buffer as response
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.send(audioBuffer);
  } catch (error) {
    console.error('❌ Error in correct-pronunciation endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get transcript for a lesson
 * GET /api/transcription/lesson/:lessonId
 */
router.get('/lesson/:lessonId', verifyToken, async (req, res) => {
  try {
    const { lessonId } = req.params;
    
    const transcript = await LessonTranscript.findOne({ 
      lessonId: new mongoose.Types.ObjectId(lessonId) 
    });
    
    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }
    
    res.json(transcript);
  } catch (error) {
    console.error('❌ Error fetching transcript:', error);
    res.status(500).json({ error: 'Failed to fetch transcript' });
  }
});

/**
 * @route   GET /api/transcription/:transcriptId
 * @desc    Get transcript status (for session validation)
 * @access  Private
 */
router.get('/:transcriptId', verifyToken, async (req, res) => {
  try {
    const { transcriptId } = req.params;
    
    const transcript = await LessonTranscript.findById(transcriptId);
    
    if (!transcript) {
      return res.status(404).json({ message: 'Transcript not found' });
    }
    
    // Only return status info, not full transcript
    res.json({
      _id: transcript._id,
      lessonId: transcript.lessonId,
      status: transcript.status,
      startTime: transcript.startTime,
      endTime: transcript.endTime
    });
    
  } catch (error) {
    console.error('Error fetching transcript:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/transcription/:transcriptId/analysis
 * @desc    Get analysis results for a transcript
 * @access  Private
 */
router.get('/:transcriptId/analysis', verifyToken, async (req, res) => {
  try {
    const { transcriptId } = req.params;
    
    const transcript = await LessonTranscript.findById(transcriptId);
    if (!transcript) {
      return res.status(404).json({ message: 'Transcript not found' });
    }
    
    const analysis = await LessonAnalysis.findOne({ transcriptId });
    
    if (!analysis) {
      return res.status(404).json({ 
        message: 'Analysis not ready yet',
        status: 'processing'
      });
    }
    
    res.json(analysis);
    
  } catch (error) {
    console.error('❌ Error getting analysis:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   GET /api/transcription/lesson/:lessonId/analysis
 * @desc    Get analysis for a specific lesson
 * @access  Private
 */
router.get('/lesson/:lessonId/analysis', verifyToken, async (req, res) => {
  try {
    const { lessonId } = req.params;
    
    const analysis = await LessonAnalysis.findOne({ lessonId })
      .populate('lessonId', 'subject startTime endTime duration actualDurationMinutes')
      .lean();
    
    if (!analysis) {
      // Check transcript to determine if analysis can ever be generated
      const transcript = await LessonTranscript.findOne({ lessonId }).select('status segments').lean();
      const transcriptStatus = transcript?.status || 'not_found';
      const segmentCount = transcript?.segments?.length || 0;
      
      const willNeverGenerate = !transcript
        || transcriptStatus === 'failed'
        || (transcriptStatus === 'completed' && segmentCount === 0);
      
      return res.status(404).json({
        success: false,
        message: 'Analysis not found',
        status: willNeverGenerate ? 'unavailable' : 'not_started',
        transcriptStatus,
        segmentCount
      });
    }
    
    // Manually fetch tutor and student since they're stored as strings
    const User = require('../models/User');
    const tutor = await User.findById(analysis.tutorId).select('name firstName lastName picture').lean();
    const student = await User.findById(analysis.studentId).select('name firstName lastName picture').lean();
    
    const formatDisplayName = (user) => {
      if (!user) return 'Unknown User';
      const firstName = user.firstName || user.name?.split(' ')[0];
      const lastName = user.lastName || user.name?.split(' ').slice(1).join(' ');
      if (firstName && lastName) {
        return `${firstName} ${lastName.charAt(0)}.`;
      }
      return user.name || 'Unknown User';
    };
    
    // Add populated tutor/student to analysis
    analysis.tutorId = tutor;
    analysis.studentId = student;

    // Ensure translations Map is a plain object for JSON serialization
    if (analysis.translations instanceof Map) {
      analysis.translations = Object.fromEntries(analysis.translations);
    }
    
    res.json({
      success: true,
      analysis: analysis,
      lesson: {
        _id: analysis.lessonId?._id,
        subject: analysis.lessonId?.subject || analysis.language + ' Lesson',
        startTime: analysis.lessonDate || analysis.lessonId?.startTime,
        endTime: analysis.lessonId?.endTime,
        duration: analysis.lessonId?.duration,
        actualDurationMinutes: analysis.lessonId?.actualDurationMinutes,
        tutor: {
          _id: tutor?._id,
          name: formatDisplayName(tutor),
          picture: tutor?.picture
        },
        student: {
          _id: student?._id,
          name: formatDisplayName(student),
          picture: student?.picture
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting lesson analysis:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/transcription/student/:studentId/latest
 * @desc    Get latest analysis for a student with a specific tutor (excluding trial lessons)
 * @access  Private
 */
router.get('/student/:studentId/latest', verifyToken, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { tutorId, currentLessonId } = req.query;
    
    const query = { 
      studentId,
      status: 'completed' // Only show completed analyses
    };
    if (tutorId) {
      query.tutorId = tutorId;
    }
    
    // Exclude the current lesson if provided
    if (currentLessonId) {
      query.lessonId = { $ne: currentLessonId };
    }
    
    // Get all analyses sorted by date (most recent first)
    const analyses = await LessonAnalysis.find(query)
      .sort({ lessonDate: -1 })
      .populate('lessonId')
      .limit(10); // Get up to 10 to find the most recent non-trial
    
    // Find the first COMPLETED analysis that's NOT from a trial lesson
    // and NOT from the current lesson
    const previousAnalysis = analyses.find(analysis => {
      return analysis.lessonId && 
             !analysis.lessonId.isTrialLesson && 
             analysis.status === 'completed';
    });
    
    if (!previousAnalysis) {
      return res.status(404).json({ message: 'No previous analysis found' });
    }

    const result = previousAnalysis.toObject();
    if (result.translations instanceof Map) {
      result.translations = Object.fromEntries(result.translations);
    }
    
    res.json(result);

  } catch (error) {
    console.error('❌ Error getting latest analysis:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   GET /api/transcription/student/:studentId/previous-context
 * @desc    Pre-call context for the previous lesson with a tutor. Always 200.
 *          Returns a discriminated state so the client can render the right
 *          thing instead of conflating "no notes" with "still generating",
 *          "waiting on tutor feedback", or a genuine load error:
 *            { state: 'ready', analysis }            — completed analysis
 *            { state: 'generating', lessonDate }     — analysis still running
 *            { state: 'awaiting_tutor', lessonDate }  — AI off, no tutor note yet
 *            { state: 'empty' }                       — first lesson together
 * @access  Private
 */
router.get('/student/:studentId/previous-context', verifyToken, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { tutorId, currentLessonId } = req.query;

    // 1) Most recent COMPLETED, non-trial analysis (excluding the current lesson).
    const completedQuery = { studentId, status: 'completed' };
    if (tutorId) completedQuery.tutorId = tutorId;
    if (currentLessonId) completedQuery.lessonId = { $ne: currentLessonId };

    const analyses = await LessonAnalysis.find(completedQuery)
      .sort({ lessonDate: -1 })
      .populate('lessonId')
      .limit(10);

    const previousAnalysis = analyses.find(a =>
      a.lessonId && !a.lessonId.isTrialLesson && a.status === 'completed'
    );

    if (previousAnalysis) {
      const result = previousAnalysis.toObject();
      if (result.translations instanceof Map) {
        result.translations = Object.fromEntries(result.translations);
      }
      return res.json({ state: 'ready', analysis: result });
    }

    // 2) No completed analysis — diagnose WHY via the most recent real lesson.
    const Lesson = require('../models/Lesson');
    const lessonQuery = {
      studentId,
      isTrialLesson: { $ne: true },
      status: { $in: ['completed', 'ended_early'] }
    };
    if (tutorId) lessonQuery.tutorId = tutorId;
    if (currentLessonId) lessonQuery._id = { $ne: currentLessonId };

    const lastLesson = await Lesson.findOne(lessonQuery).sort({ endTime: -1 }).lean();

    if (!lastLesson) {
      return res.json({ state: 'empty' });
    }

    const anyAnalysis = await LessonAnalysis.findOne({ lessonId: lastLesson._id }).lean();

    // "Generating" must be plausibly true: an analysis only runs for a short
    // window after a lesson ends. Past that, if nothing completed, the recap
    // isn't coming (failed / insufficient transcript / never ran), so we stop
    // promising one. AI off → the tutor still owes manual feedback.
    const endedMs = lastLesson.endTime ? new Date(lastLesson.endTime).getTime() : 0;
    const minutesSinceEnd = endedMs ? (Date.now() - endedMs) / 60000 : Infinity;
    const GENERATING_GRACE_MINUTES = 20;
    const aiOff = lastLesson.aiAnalysisEnabledAtTime === false;

    let state;
    if (anyAnalysis) {
      if (anyAnalysis.status === 'pending' || anyAnalysis.status === 'processing') {
        // Genuinely still being produced.
        state = 'generating';
      } else if (aiOff) {
        // failed / insufficient_data with AI off → still on the tutor.
        state = 'awaiting_tutor';
      } else {
        // failed / insufficient_data with AI on → nothing useful is coming.
        state = 'empty';
      }
    } else if (aiOff) {
      // No analysis row and AI was off → waiting on the tutor's note.
      state = 'awaiting_tutor';
    } else if (minutesSinceEnd <= GENERATING_GRACE_MINUTES) {
      // Just ended, AI on → give the pipeline time to generate.
      state = 'generating';
    } else {
      // AI on but no analysis well after the lesson → it isn't coming.
      state = 'empty';
    }

    return res.json({ state, lessonDate: lastLesson.endTime });

  } catch (error) {
    console.error('❌ Error getting previous lesson context:', error);
    // Surface as an error state to the client (it will offer a retry).
    res.status(500).json({ state: 'error', message: 'Server error' });
  }
});

/**
 * @route   GET /api/transcription/student/:studentId/progress
 * @desc    Get progress report for a student
 * @access  Private
 */
router.get('/student/:studentId/progress', verifyToken, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { tutorId, limit = 10 } = req.query;
    
    const query = { studentId };
    if (tutorId) {
      query.tutorId = tutorId;
    }
    
    const analyses = await LessonAnalysis.find(query)
      .sort({ lessonDate: -1 })
      .limit(parseInt(limit));
    
    if (analyses.length === 0) {
      return res.status(404).json({ message: 'No analyses found' });
    }
    
    // Generate progress report
    const progressReport = await generateProgressReport(analyses);
    
    res.json({
      totalLessons: analyses.length,
      latestLevel: analyses[0].overallAssessment.proficiencyLevel,
      analyses: analyses,
      progressReport
    });
    
  } catch (error) {
    console.error('❌ Error getting progress:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * Helper function to analyze a lesson transcript
 */
async function analyzeLesson(transcriptId) {
  try {
    const transcript = await LessonTranscript.findById(transcriptId);
    if (!transcript) {
      throw new Error('Transcript not found');
    }
    
    console.log(`🤖 Starting AI analysis for lesson ${transcript.lessonId}...`);
    
    // Get lesson details to check if it should be analyzed
    const lesson = await Lesson.findById(transcript.lessonId);
    if (!lesson) {
      throw new Error('Lesson not found');
    }
    
    // Skip analysis for trial lessons, group classes, or quick sessions
    if (lesson.isTrialLesson) {
      console.log('⏭️  Skipping analysis - Trial lesson (no analysis for first lessons)');
      return null;
    }
    
    if (lesson.isClass) {
      console.log('⏭️  Skipping analysis - Group class (analysis only for 1-on-1 lessons)');
      return null;
    }
    
    if (lesson.duration < 25) {
      console.log(`⏭️  Skipping analysis - Quick session (${lesson.duration} min < 25 min minimum)`);
      return null;
    }
    
    console.log(`✅ Lesson qualifies for analysis: Regular 1-on-1 lesson (${lesson.duration} min)`);
    
    const startTime = Date.now();
    
    // Get student's native language for feedback
    const student = await User.findOne({ auth0Id: transcript.studentId });
    const studentNativeLanguage = student?.nativeLanguage || 'en';
    console.log(`🌐 Student's native language: ${studentNativeLanguage} (feedback will be provided in this language)`);
    
    // Get previous analyses for context (only completed analyses)
    const previousAnalyses = await LessonAnalysis.find({
      studentId: transcript.studentId,
      tutorId: transcript.tutorId,
      lessonDate: { $lt: transcript.startTime },
      status: 'completed'
    })
    .sort({ lessonDate: -1 })
    .limit(3);
    
    console.log(`📊 Found ${previousAnalyses.length} previous completed analyses for progression tracking`);

    // ========================================================================
    // MIC BLEED FILTER — Drop student-tagged segments that overlap tutor speech
    //
    // The student client records its local microphone. If the tutor's voice
    // leaks through the student's speakers and back into their mic, it gets
    // transcribed and tagged as "student" — corrupting the analysis. We
    // capture the tutor's clean Agora remote-audio track separately, run VAD
    // on it, and mark any student segment whose [start, end] falls inside a
    // tutor-speaking interval as `excludedByTutorOverlap`. Excluded segments
    // are persisted (for debugging) but skipped by analysis below.
    //
    // Segment batch-time is recovered from segment.timestamp relative to
    // transcript.startTime, since the existing pipeline uploads all student
    // audio as one concatenated blob with this offset baked in at line ~800.
    // ========================================================================
    const tutorIntervals = (transcript.tutorSpeechIntervals || []).map(iv => ({
      startSec: iv.startSec,
      endSec: iv.endSec
    }));

    let excludedCount = 0;
    if (tutorIntervals.length > 0) {
      const transcriptStartMs = transcript.startTime ? transcript.startTime.getTime() : 0;
      transcript.segments.forEach(seg => {
        if (seg.speaker !== 'student') return;
        if (!seg.duration || seg.duration <= 0) return; // can't determine bounds; leave as-is
        if (!seg.timestamp) return;

        const segStartSec = (seg.timestamp.getTime() - transcriptStartMs) / 1000;
        const segEndSec = segStartSec + seg.duration;

        if (segmentOverlapsTutor(segStartSec, segEndSec, tutorIntervals)) {
          seg.excludedByTutorOverlap = true;
          excludedCount++;
        }
      });

      if (excludedCount > 0) {
        console.log(`🚫 Mic-bleed filter: excluded ${excludedCount} student segments overlapping ${tutorIntervals.length} tutor speech intervals`);
        // Persist exclusion flags so they survive into the saved transcript
        try {
          await transcript.save();
        } catch (saveErr) {
          console.warn('⚠️ Failed to persist exclusion flags (non-critical):', saveErr.message);
        }
      } else {
        console.log(`✅ Mic-bleed filter: no student segments overlap tutor speech (${tutorIntervals.length} intervals checked)`);
      }
    } else {
      console.log('ℹ️ Mic-bleed filter: no tutor reference intervals available — skipping (likely a legacy lesson or tutor reference upload failed)');
    }

    // Separate student and tutor segments
    // NOTE: studentSegments excludes any segments flagged as tutor-bleed above
    const studentSegments = transcript.segments.filter(
      s => s.speaker === 'student' && !s.excludedByTutorOverlap
    );
    const tutorSegments = transcript.segments.filter(s => s.speaker === 'tutor');

    // CRITICAL DEBUG: Log what we're actually analyzing
    console.log('🔍 TRANSCRIPT DEBUG INFO:');
    console.log(`   Total segments: ${transcript.segments.length}`);
    console.log(`   Student segments (analyzed): ${studentSegments.length}`);
    console.log(`   Student segments excluded by tutor overlap: ${excludedCount}`);
    console.log(`   Tutor segments: ${tutorSegments.length}`);
    console.log(`   Transcript language: ${transcript.language}`);
    
    if (studentSegments.length === 0) {
      console.error('❌❌❌ CRITICAL: NO STUDENT SEGMENTS FOUND! Cannot analyze empty transcript.');
      throw new Error('No student audio captured - transcript is empty');
    }
    
    // Log first few student segments to verify content
    console.log('📝 Sample student speech (first 3 segments):');
    studentSegments.slice(0, 3).forEach((seg, i) => {
      console.log(`   ${i + 1}. "${seg.text}"`);
    });
    
    // Calculate total words spoken
    const totalStudentWords = studentSegments.reduce((sum, seg) => sum + seg.text.split(' ').length, 0);
    const totalTutorWords = tutorSegments.reduce((sum, seg) => sum + seg.text.split(' ').length, 0);
    console.log(`   Student words: ${totalStudentWords}`);
    console.log(`   Tutor words: ${totalTutorWords}`);
    
    // ========================================================================
    // TRANSCRIPT QUALITY GATE — Prevent GPT-4 from analyzing garbage/hallucinated data
    // ========================================================================
    const qualityIssues = [];
    
    // CHECK 1: Minimum word threshold (hard skip)
    // For a 25+ minute lesson, fewer than 30 words means no meaningful speech occurred
    if (totalStudentWords < 30) {
      qualityIssues.push(`Insufficient speech: only ${totalStudentWords} student words detected (minimum 30 required for a ${lesson.duration}-min lesson)`);
    }
    
    // CHECK 2: Script mismatch detection (Whisper hallucination pattern)
    // If the lesson is for a Latin-script language but transcript contains CJK/Arabic/etc. characters,
    // Whisper was hallucinating from background noise or silence
    const LATIN_BASED_LANGS = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'ro', 'sv', 'da', 'no', 'fi', 'cs', 'hr', 'hu', 'tr', 'vi', 'id', 'ms', 'tl'];
    const CJK_LANGS = ['ja', 'zh', 'ko'];
    const ARABIC_LANGS = ['ar', 'fa', 'ur'];
    const targetLang = transcript.language;
    const allStudentText = studentSegments.map(s => s.text).join(' ');
    
    // Detect non-Latin characters (CJK, Arabic, Devanagari, Cyrillic, etc.)
    const nonLatinMatches = allStudentText.match(/[\u3000-\u9FFF\u30A0-\u30FF\u3040-\u309F\uAC00-\uD7AF\u0600-\u06FF\u0900-\u097F]/g);
    const nonLatinCount = nonLatinMatches ? nonLatinMatches.length : 0;
    
    if (LATIN_BASED_LANGS.includes(targetLang) && nonLatinCount > 5) {
      qualityIssues.push(`Script mismatch: ${nonLatinCount} non-Latin characters found in ${targetLang} lesson transcript (likely Whisper hallucination)`);
    }
    
    // Reverse check: CJK lesson but mostly Latin text
    if (CJK_LANGS.includes(targetLang)) {
      const cjkMatches = allStudentText.match(/[\u3000-\u9FFF\u30A0-\u30FF\u3040-\u309F\uAC00-\uD7AF]/g);
      const cjkCount = cjkMatches ? cjkMatches.length : 0;
      const totalChars = allStudentText.replace(/\s/g, '').length;
      if (totalChars > 20 && cjkCount < totalChars * 0.1) {
        qualityIssues.push(`Script mismatch: ${targetLang} lesson but only ${cjkCount}/${totalChars} CJK characters (likely Whisper hallucination)`);
      }
    }
    
    // CHECK 3: Repetitive content detection (Whisper hallucination pattern)
    // Whisper often repeats the same phrase/sentence when hallucinating from noise
    if (studentSegments.length > 5) {
      const segTexts = studentSegments.map(s => s.text.trim().toLowerCase());
      const uniqueTexts = new Set(segTexts);
      const repetitionRatio = uniqueTexts.size / segTexts.length;
      
      if (repetitionRatio < 0.3) {
        qualityIssues.push(`Repetitive content: only ${uniqueTexts.size}/${segTexts.length} unique segments (${Math.round(repetitionRatio * 100)}% unique, likely Whisper hallucination)`);
      }
    }
    
    // CHECK 4: Known Whisper hallucination phrases
    const HALLUCINATION_PHRASES = [
      'thank you for watching', 'thanks for watching', 'subscribe', 'like and subscribe',
      'please subscribe', 'don\'t forget to subscribe', 'click the bell',
      'see you next time', 'see you in the next', 'bye bye', 'thank you so much',
      'music', '♪', '♫', '[music]', '[Music]',
      'Amara.org', 'subtitles by', 'captions by'
    ];
    const textLower = allStudentText.toLowerCase();
    const hallucinationHits = HALLUCINATION_PHRASES.filter(phrase => textLower.includes(phrase));
    
    if (hallucinationHits.length >= 2) {
      qualityIssues.push(`Known hallucination phrases detected: "${hallucinationHits.join('", "')}"`);
    }
    
    // CHECK 5: Aggregate no_speech_prob across all student segments
    // Whisper returns no_speech_prob per segment; high values mean Whisper itself
    // was uncertain whether speech was present
    const segsWithNoSpeechProb = studentSegments.filter(s => s.noSpeechProb != null);
    if (segsWithNoSpeechProb.length > 0) {
      const avgNoSpeechProb = segsWithNoSpeechProb.reduce((sum, s) => sum + s.noSpeechProb, 0) / segsWithNoSpeechProb.length;
      const highNoSpeechCount = segsWithNoSpeechProb.filter(s => s.noSpeechProb > 0.5).length;
      const highNoSpeechRatio = highNoSpeechCount / segsWithNoSpeechProb.length;
      
      console.log(`🔇 No-speech prob check: avg=${avgNoSpeechProb.toFixed(3)}, high(>0.5)=${highNoSpeechCount}/${segsWithNoSpeechProb.length} (${(highNoSpeechRatio * 100).toFixed(1)}%)`);
      
      if (avgNoSpeechProb > 0.5) {
        qualityIssues.push(`High no_speech_prob: average ${avgNoSpeechProb.toFixed(3)} across ${segsWithNoSpeechProb.length} segments (Whisper uncertain if speech was present)`);
      }
      if (highNoSpeechRatio > 0.6) {
        qualityIssues.push(`${highNoSpeechCount}/${segsWithNoSpeechProb.length} segments (${(highNoSpeechRatio * 100).toFixed(0)}%) have high no_speech_prob (>0.5), indicating mostly noise/silence`);
      }
    }
    
    // CHECK 6: Audio energy metadata from FFmpeg VAD
    // If the pre-Whisper audio energy analysis found the audio was borderline,
    // use it as an additional signal
    if (transcript.audioEnergyMetrics && transcript.audioEnergyMetrics.length > 0) {
      const metrics = transcript.audioEnergyMetrics;
      const allNoSpeech = metrics.every(m => !m.hasSpeech);
      const avgSilenceRatio = metrics.reduce((sum, m) => sum + (m.silenceRatio || 0), 0) / metrics.length;
      const avgRms = metrics.reduce((sum, m) => sum + (m.rmsLevelDb || -91), 0) / metrics.length;
      
      console.log(`🔊 Audio energy check: avgRMS=${avgRms.toFixed(1)}dB, avgSilence=${(avgSilenceRatio * 100).toFixed(1)}%, allNoSpeech=${allNoSpeech}`);
      
      if (allNoSpeech) {
        qualityIssues.push(`Audio energy analysis: all ${metrics.length} audio chunks detected as silence/noise (no speech energy above threshold)`);
      } else if (avgSilenceRatio > 0.85) {
        qualityIssues.push(`Audio is ${(avgSilenceRatio * 100).toFixed(0)}% silence on average across ${metrics.length} chunks — insufficient speech content`);
      }
    }
    
    // CHECK 7: Words-per-second coherence check
    // Whisper hallucinations often produce many words from very short audio.
    // Real speech is typically 2-4 words/second; >5 wps sustained is suspicious.
    const segsWithDuration = studentSegments.filter(s => s.duration && s.duration > 0);
    if (segsWithDuration.length > 3) {
      const suspiciousSegs = segsWithDuration.filter(s => {
        const words = s.text.split(/\s+/).length;
        const wps = words / s.duration;
        return wps > 5 && words > 3;
      });
      const suspiciousRatio = suspiciousSegs.length / segsWithDuration.length;
      
      if (suspiciousRatio > 0.5) {
        qualityIssues.push(`Unrealistic speech rate: ${suspiciousSegs.length}/${segsWithDuration.length} segments (${(suspiciousRatio * 100).toFixed(0)}%) exceed 5 words/second — likely hallucinated text`);
      }
    }
    
    // If ANY quality issues found, skip analysis and save as insufficient_data
    if (qualityIssues.length > 0) {
      console.warn(`\n🚫 ========================================`);
      console.warn(`🚫 TRANSCRIPT QUALITY GATE FAILED — Skipping analysis`);
      console.warn(`🚫 ========================================`);
      qualityIssues.forEach((issue, i) => {
        console.warn(`   ${i + 1}. ${issue}`);
      });
      console.warn(`🚫 Lesson ${transcript.lessonId} will be marked as insufficient_data`);
      console.warn(`🚫 ========================================\n`);
      
      // Save as insufficient_data so the student doesn't see hallucinated content
      await LessonAnalysis.findOneAndUpdate(
        { lessonId: transcript.lessonId },
        {
          lessonId: transcript.lessonId,
          transcriptId: transcript._id,
          studentId: transcript.studentId,
          tutorId: transcript.tutorId,
          language: transcript.language,
          lessonDate: transcript.startTime,
          status: 'insufficient_data',
          error: `Transcript quality check failed: ${qualityIssues.join('; ')}`
        },
        { upsert: true, new: true }
      );
      
      return null;
    }
    
    console.log(`✅ Transcript quality gate passed — proceeding with analysis`);
    
    // Analyze with GPT-4
    console.log(`🤖 Calling GPT-4 for analysis...`);
    const analysisResult = await analyzeLessonTranscript({
      transcript: transcript.segments,
      language: transcript.language,
      studentNativeLanguage: studentNativeLanguage,  // NEW: For multilingual feedback
      studentSegments,
      tutorSegments,
      previousAnalyses
    });
    console.log(`🤖 GPT-4 analysis completed`);
    
    // ========== GPT-4 REALTIME PRONUNCIATION ASSESSMENT ==========
    // This runs AFTER the lesson ends, not during!
    // ========== PRONUNCIATION ASSESSMENT (GPT-4 REALTIME) ==========
    // TEMPORARILY DISABLED: Pronunciation assessment was inaccurate for native/advanced speakers
    // Set ENABLE_PRONUNCIATION_ASSESSMENT to true to re-enable
    const ENABLE_PRONUNCIATION_ASSESSMENT = false; // TODO: Re-calibrate before enabling
    
    // Only assesses TARGET LANGUAGE (not student's native language)
    let aggregatedPronunciation = null;
    
    if (ENABLE_PRONUNCIATION_ASSESSMENT) {
    try {
      console.log(`🎤 ========== STARTING GPT-4 PRONUNCIATION ASSESSMENT ==========`);
      
      // Filter for student segments in TARGET LANGUAGE only
      const targetLanguageSegments = transcript.segments.filter(seg => 
        seg.speaker === 'student' && 
        seg.language === transcript.language  // Only target language!
      );
      
      console.log(`📊 Total segments: ${transcript.segments.length}`);
      console.log(`📊 Student segments: ${transcript.segments.filter(s => s.speaker === 'student').length}`);
      console.log(`📊 Target language (${transcript.language}) segments: ${targetLanguageSegments.length}`);
      
      if (targetLanguageSegments.length >= 3) {  // Need at least 3 segments for meaningful assessment
        // Intelligently sample 15% of segments (focusing on complex words)
        const sampledSegments = intelligentSampleSegments(
          targetLanguageSegments,
          transcript.language,
          analysisResult.overallAssessment?.proficiencyLevel || 'B1',
          0.15  // 15% sampling rate
        );
        
        console.log(`✅ Sampled ${sampledSegments.length}/${targetLanguageSegments.length} segments for assessment`);
        
        // Check if sampled segments have audio data (either base64 or GCS)
        const segmentsWithAudio = sampledSegments.filter(seg => seg.audioBase64 || seg.audioGcsPath);
        
        if (segmentsWithAudio.length === 0) {
          console.log('⚠️  No audio data found in sampled segments');
          console.log('⚠️  This is expected for older lessons. New lessons will have audio.');
        } else {
          console.log(`✅ Found audio in ${segmentsWithAudio.length}/${sampledSegments.length} sampled segments`);
          
          // Prepare audio segments for GPT-4
          // Download from GCS if needed, otherwise use base64
          const audioSegments = [];
          for (const seg of segmentsWithAudio) {
            let audioBase64 = seg.audioBase64;
            
            // If no base64 but has GCS path, download from GCS
            if (!audioBase64 && seg.audioGcsPath) {
              try {
                const { Storage } = require('@google-cloud/storage');
                
                // Configure Storage with proper credentials (same as gcs.js)
                const storageConfig = {
                  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
                };
                
                // For local development, use key file
                if (process.env.GOOGLE_CLOUD_KEY_FILE) {
                  storageConfig.keyFilename = process.env.GOOGLE_CLOUD_KEY_FILE;
                }
                // For cloud deployment (Render), use JSON credentials
                else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
                  storageConfig.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
                }
                
                const storage = new Storage(storageConfig);
                
                // Extract bucket and filename from gs:// path
                const match = seg.audioGcsPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
                if (match) {
                  const [, bucketName, filename] = match;
                  const bucket = storage.bucket(bucketName);
                  const file = bucket.file(filename);
                  
                  // Download file content
                  const [buffer] = await file.download();
                  audioBase64 = buffer.toString('base64');
                  console.log(`☁️  Downloaded audio from GCS: ${Math.round(buffer.length / 1024)}KB`);
                }
              } catch (gcsError) {
                console.error(`❌ Failed to download from GCS: ${seg.audioGcsPath}`, gcsError.message);
                continue; // Skip this segment
              }
            }
            
            if (audioBase64) {
              audioSegments.push({
                audioBase64,
                text: seg.text
              });
            }
          }
          
          if (audioSegments.length === 0) {
            console.log('⚠️  No audio could be loaded for pronunciation assessment');
          } else {
            // Call GPT-4 Realtime for pronunciation assessment
            aggregatedPronunciation = await assessPronunciationScore(
            audioSegments,
            transcript.language,
            analysisResult.overallAssessment?.proficiencyLevel || 'B1',
            segmentsWithAudio  // Pass text segments for context
          );
          
          if (aggregatedPronunciation) {
            console.log(`✅ ✅ ✅ GPT-4 PRONUNCIATION ASSESSMENT COMPLETE ✅ ✅ ✅`);
            console.log(`   Overall Score: ${aggregatedPronunciation.overallScore}/100`);
            console.log(`   Accuracy: ${aggregatedPronunciation.accuracyScore}/100`);
            console.log(`   Fluency: ${aggregatedPronunciation.fluencyScore}/100`);
            console.log(`   Prosody: ${aggregatedPronunciation.prosodyScore}/100`);
            console.log(`   Words to improve: ${aggregatedPronunciation.mispronunciations?.length || 0}`);
            if (aggregatedPronunciation.mispronunciations?.length > 0) {
              console.log(`   Top words:`);
              aggregatedPronunciation.mispronunciations.slice(0, 3).forEach(w => {
                console.log(`     - ${w.word} (${w.score}/100): ${w.errorType}`);
              });
            }
          } else {
            console.log('⚠️  GPT-4 pronunciation assessment returned null');
          }
          }
        }
      } else {
        console.log(`⏭️  Skipping pronunciation: Only ${targetLanguageSegments.length} target language segments (need 3+)`);
      }
      
    } catch (pronError) {
      console.error('❌ Error in GPT-4 pronunciation assessment:', pronError.message);
      console.error(pronError);
      // Continue with analysis even if pronunciation fails
    }
    } // End ENABLE_PRONUNCIATION_ASSESSMENT
    else {
      console.log(`⏭️  Pronunciation assessment disabled (inaccurate for advanced speakers)`);
    }
    
    // OLD AZURE LOGIC (kept as fallback, disabled)
    if (false && transcript.pronunciationSegments && transcript.pronunciationSegments.length > 0) {
      try {
        console.log(`🎙️ Aggregating pronunciation results from ${transcript.pronunciationSegments.length} segments...`);
        
        const validSegments = transcript.pronunciationSegments.filter(seg => 
          seg.accuracyScore !== undefined && seg.accuracyScore !== null
        );
        
        if (validSegments.length > 0) {
          // Calculate averages
          const avg = (arr) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
          
          aggregatedPronunciation = {
            overallScore: avg(validSegments.map(s => s.pronunciationScore || s.accuracyScore)),
            accuracyScore: avg(validSegments.map(s => s.accuracyScore)),
            fluencyScore: avg(validSegments.map(s => s.fluencyScore)),
            prosodyScore: avg(validSegments.map(s => s.prosodyScore || 0)),
            segmentsAssessed: validSegments.length,
            
            // Extract mispronunciations (words with accuracy < 60)
            mispronunciations: []
          };
          
          // Collect all mispronounced words (filter out simple/common words)
          const mispronunciationMap = new Map();
          
          // Common words to exclude (articles, prepositions, pronouns, etc.)
          const EXCLUDED_WORDS = new Set([
            // Spanish
            'a', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
            'de', 'en', 'por', 'para', 'con', 'sin', 'sobre', 'entre',
            'y', 'o', 'pero', 'si', 'no', 'ni', 'que', 'como',
            'yo', 'tú', 'él', 'ella', 'nosotros', 'vosotros', 'ellos', 'ellas',
            'me', 'te', 'se', 'nos', 'os', 'les', 'le', 'lo', 'los', 'las',
            'mi', 'tu', 'su', 'mis', 'tus', 'sus',
            'del', 'al', 'ir', 'va', 'es', 'hay', 'he', 'ha',
            // French
            'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles',
            'le', 'la', 'l', 'les', 'du', 'de', 'des', 'au', 'aux',
            'un', 'une', 'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car',
            'ce', 'cet', 'cette', 'ces', 'mon', 'ton', 'son', 'ma', 'ta', 'sa',
            'ne', 'pas', 'plus', 'rien', 'jamais', 'y', 'en',
            // English
            'a', 'an', 'the', 'and', 'or', 'but', 'if', 'to', 'in', 'on', 'at',
            'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
            'my', 'your', 'his', 'her', 'its', 'our', 'their', 'is', 'am', 'are', 'was', 'were',
            // German
            'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einem', 'einen', 'einer',
            'und', 'oder', 'aber', 'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr',
            'mein', 'dein', 'sein', 'ihr', 'unser', 'euer', 'ist', 'bin', 'sind',
            // Portuguese
            'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
            'de', 'em', 'por', 'para', 'com', 'sem', 'e', 'ou', 'mas', 'se',
            'eu', 'tu', 'ele', 'ela', 'nós', 'vós', 'eles', 'elas',
            'me', 'te', 'lhe', 'nos', 'vos', 'lhes', 'meu', 'teu', 'seu'
          ]);
          
          validSegments.forEach(segment => {
            if (segment.words) {
              segment.words.forEach(word => {
                // Only include words with valid accuracy scores (not null/undefined)
                // Note: accuracyScore can be 0 (legitimate 0% accuracy) or any value up to 100
                // Words without assessment data will have null and are filtered out by pronunciationService
                const accuracyScore = word.accuracyScore;
                if (accuracyScore != null && accuracyScore < 60) {
                  const key = word.word.toLowerCase().trim();
                  
                  // Filter criteria:
                  // 1. Must be at least 3 characters (exclude "ir", "a", "un", etc.)
                  // 2. Must not be in excluded words list (common words)
                  // 3. Must have actual pronunciation issues (not just artifacts)
                  // 4. Must have a valid accuracy score (not 0/undefined/null)
                  if (key.length >= 3 && !EXCLUDED_WORDS.has(key)) {
                    if (!mispronunciationMap.has(key) || accuracyScore < mispronunciationMap.get(key).score) {
                      mispronunciationMap.set(key, {
                        word: word.word,
                        score: accuracyScore, // Use the validated score (can be 0-59)
                        problematicPhonemes: word.phonemes
                          ?.filter(p => p.accuracyScore != null && p.accuracyScore < 60)
                          ?.map(p => p.phoneme) || []
                      });
                    }
                  }
                }
              });
            }
          });
          
          aggregatedPronunciation.mispronunciations = Array.from(mispronunciationMap.values())
            .sort((a, b) => a.score - b.score)  // Sort by worst scores first
            .slice(0, 10);  // Top 10 words to practice
          
          console.log(`✅ Pronunciation aggregation completed:`, {
            overallScore: aggregatedPronunciation.overallScore,
            accuracyScore: aggregatedPronunciation.accuracyScore,
            mispronunciations: aggregatedPronunciation.mispronunciations.length
          });
          
          // Debug: Log the words being included
          if (aggregatedPronunciation.mispronunciations.length > 0) {
            console.log(`📝 Words to practice (first 5):`, 
              aggregatedPronunciation.mispronunciations.slice(0, 5).map(w => `${w.word}: ${w.score}/100`)
            );
          }
        }
      } catch (pronError) {
        console.error('⚠️ Error aggregating pronunciation results:', pronError.message);
      }
    } else {
      console.log('ℹ️  No pronunciation segments found for this lesson');
    }
    
    // Merge pronunciation results into analysis
    if (aggregatedPronunciation) {
      analysisResult.pronunciationAnalysis = aggregatedPronunciation;
    }
    
    // Filter and prioritize errors based on lesson duration
    if (analysisResult.topErrors && analysisResult.topErrors.length > 0) {
      const lessonDuration = transcript.endTime && transcript.startTime 
        ? Math.round((new Date(transcript.endTime) - new Date(transcript.startTime)) / 60000) // minutes
        : 25; // default to 25 if no end time
      
      console.log(`🔍 Applying error filtering for ${lessonDuration}-minute lesson...`);
      const { filterAndPrioritizeErrors } = require('../services/aiService');
      analysisResult.topErrors = filterAndPrioritizeErrors(analysisResult.topErrors, lessonDuration);
      console.log(`✅ Filtered to ${analysisResult.topErrors.length} top errors`);
    }

    // Canonicalize free-text errors to taxonomy skillIds. Must run AFTER
    // filtering so we don't waste taxonomy lookups on transcription
    // artifacts that just got removed. Idempotent — safe to call again.
    try {
      const { canonicalizeAnalysisSkills } = require('../services/aiService');
      canonicalizeAnalysisSkills(analysisResult, transcript.language);
    } catch (err) {
      // Canonicalization is best-effort; the aggregator falls back to
      // on-read canonicalization for any entries we missed here.
      console.warn('⚠️  [transcription] Skill canonicalization failed (non-blocking):', err.message);
    }
    
    console.log(`💾 Saving analysis to database...`);
    
    // Use findOneAndUpdate with upsert to avoid duplicate key errors
    // This will either update existing or create new in one atomic operation
    const analysisData = {
      lessonId: transcript.lessonId,
      transcriptId: transcript._id,
      studentId: transcript.studentId,
      tutorId: transcript.tutorId,
      language: transcript.language,
      lessonDate: transcript.startTime,
      ...analysisResult,
      processingTime: Date.now() - startTime,
      status: 'completed',
      error: undefined // Clear any previous errors
    };
    
    console.log(`💾 Saving analysis with findOneAndUpdate (upsert)...`);
    const analysis = await LessonAnalysis.findOneAndUpdate(
      { lessonId: transcript.lessonId }, // Find by lessonId
      analysisData, // Replace with new data
      { 
        upsert: true, // Create if doesn't exist
        new: true, // Return the new document
        runValidators: true, // Run schema validation
        overwrite: true // Replace entire document (not just merge fields)
      }
    );
    
    console.log(`✅ Analysis saved successfully for lesson ${transcript.lessonId}`);
    
    // Verify the saved analysis
    console.log(`🔍 Verifying saved analysis:`);
    console.log(`   ID: ${analysis._id}`);
    console.log(`   Status: ${analysis.status}`);
    console.log(`   Level: ${analysis.overallAssessment?.proficiencyLevel}`);
    console.log(`   Summary: ${analysis.studentSummary?.substring(0, 100)}...`);
    
    console.log(`✅ Analysis completed for lesson ${transcript.lessonId}`);

    // Auto-create SRS vocabulary cards from analysis
    try {
      await createVocabularyCardsFromAnalysis(analysis, transcript);
    } catch (vocabError) {
      console.error('⚠️ Error creating vocabulary cards:', vocabError);
    }

    // After analysis, update the next upcoming lesson with notes
    try {
      await updateNextLessonWithNotes(transcript.studentId, transcript.tutorId, analysis);
    } catch (notesError) {
      console.error('⚠️ Error updating next lesson notes:', notesError);
      // Don't fail the analysis if notes update fails
    }

    // Auto-hydrate the student's review deck with the AI-extracted
    // corrected excerpts from this lesson. Idempotent + non-blocking.
    try {
      const reviewDeckHydration = require('../services/reviewDeckHydrationService');
      await reviewDeckHydration.hydrateFromAnalysis({
        analysis,
        userId: transcript.studentId,
        language: transcript.language
      });
    } catch (deckError) {
      console.error('⚠️ Review deck hydration failed (non-blocking):', deckError);
    }

    // After analysis is saved, update or create learning plan
    try {
      const LearningPlanModel = require('../models/LearningPlan');
      const learningPlanService = require('../services/learningPlanService');
      const Lesson = require('../models/Lesson');

      const existingPlan = await LearningPlanModel.findOne({
        studentId: transcript.studentId,
        language: transcript.language,
        status: 'active'
      });

      if (existingPlan) {
        await learningPlanService.updatePlanAfterLesson(existingPlan._id, analysis);
      } else if (analysis.lessonId) {
        const lessonForPlan = await Lesson.findById(analysis.lessonId);
        if (lessonForPlan?.isTrialLesson) {
          const studentUser = await User.findById(transcript.studentId);
          if (studentUser?.onboardingData?.learningGoal?.type) {
            const newPlan = await learningPlanService.generateInitialPlan(transcript.studentId, transcript.language);

            if (newPlan) {
              const Notification = require('../models/Notification');
              const goalLabel = learningPlanService.GOAL_TYPE_LABELS[studentUser.onboardingData.learningGoal.type] || 'reach your goal';
              await Notification.create({
                userId: transcript.studentId,
                type: 'learning_plan_ready',
                title: 'Your Learning Plan is Ready! 🎯',
                message: `Based on your first lesson, we've created a personalized path to help you ${goalLabel.toLowerCase()} in <strong>${transcript.language}</strong>.`,
                data: {
                  language: transcript.language,
                  planId: newPlan._id.toString(),
                  hasActionButton: true,
                  actionButtonText: 'View Plan',
                  actionRoute: '/tabs/progress'
                },
                read: false
              });

              const io = req.app.get('io');
              if (io && studentUser.auth0Id) {
                io.to(`user:${studentUser.auth0Id}`).emit('learning_plan_ready', {
                  language: transcript.language,
                  planId: newPlan._id.toString()
                });
              }
            }
          }
        }
      }
    } catch (planError) {
      console.error('⚠️ Learning plan update failed (non-blocking):', planError);
    }

    // Check if student hit a milestone (5, 10, 15, etc. lessons in this language)
    // ONLY count regular lessons (exclude trial & quick office hours)
    try {
      const Lesson = require('../models/Lesson');
      
      // Get all completed analyses with lesson data
      const allAnalyses = await LessonAnalysis.find({
        studentId: transcript.studentId,
        language: transcript.language,
        status: 'completed'
      })
        .populate({
          path: 'lessonId',
          select: 'isTrialLesson isOfficeHours officeHoursType'
        })
        .lean();
      
      // Filter out trial lessons and quick office hours
      const regularLessons = allAnalyses.filter(analysis => {
        const lesson = analysis.lessonId;
        if (!lesson) return true; // Include if no lesson data
        if (lesson.isTrialLesson === true) return false;
        if (lesson.isOfficeHours === true && lesson.officeHoursType === 'quick') return false;
        return true;
      });
      
      const totalLessons = regularLessons.length;
      console.log(`📊 [Milestone] ${totalLessons} regular lessons (from ${allAnalyses.length} total) in ${transcript.language}`);

      
      const isMilestone = totalLessons > 0 && totalLessons % 5 === 0;
      
      if (isMilestone) {
        console.log(`🎯 Milestone reached: ${totalLessons} lessons in ${transcript.language}`);
        
        // Check if we already created a notification for this milestone
        const Notification = require('../models/Notification');
        const existingNotification = await Notification.findOne({
          userId: transcript.studentId,
          type: 'progress_milestone',
          'data.language': transcript.language,
          'data.milestone': totalLessons
        });
        
        if (!existingNotification) {
          // Get the most recent 5-lesson block (sorted oldest-first for the block)
          const milestoneAnalyses = await LessonAnalysis.find({
            studentId: transcript.studentId,
            language: transcript.language,
            status: 'completed'
          })
            .populate({
              path: 'lessonId',
              select: 'isTrialLesson isOfficeHours officeHoursType'
            })
            .sort({ lessonDate: 1 })
            .lean();
          
          const milestoneBlock = milestoneAnalyses
            .filter(a => {
              const l = a.lessonId;
              if (!l) return true;
              if (l.isTrialLesson === true) return false;
              if (l.isOfficeHours === true && l.officeHoursType === 'quick') return false;
              return true;
            })
            .slice(-5);
          
          // Calculate averages for the milestone block
          const levelMap = { 'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6 };
          const levelNames = { 1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: 'C1', 6: 'C2' };
          
          const cefrLevels = milestoneBlock.map(a => levelMap[a.overallAssessment?.proficiencyLevel] || 3);
          const avgCefrNum = Math.round(cefrLevels.reduce((s, l) => s + l, 0) / cefrLevels.length);
          const avgCefrLevel = levelNames[Math.max(1, Math.min(6, avgCefrNum))];
          
          const grammarScores = milestoneBlock.map(a => a.grammarAnalysis?.accuracyScore || 0).filter(s => s > 0);
          const fluencyScores = milestoneBlock.map(a => a.fluencyAnalysis?.overallFluencyScore || 0).filter(s => s > 0);
          const vocabToScore = (range) => ({ 'limited': 30, 'moderate': 55, 'good': 75, 'excellent': 92 }[range] || 50);
          const vocabScores = milestoneBlock.map(a => vocabToScore(a.vocabularyAnalysis?.vocabularyRange)).filter(s => s > 0);
          
          const avgGrammar = grammarScores.length > 0 ? Math.round(grammarScores.reduce((s, v) => s + v, 0) / grammarScores.length) : 0;
          const avgFluency = fluencyScores.length > 0 ? Math.round(fluencyScores.reduce((s, v) => s + v, 0) / fluencyScores.length) : 0;
          const avgVocab = vocabScores.length > 0 ? Math.round(vocabScores.reduce((s, v) => s + v, 0) / vocabScores.length) : 0;
          const totalStudyTime = milestoneBlock.reduce((s, a) => s + (a.progressionMetrics?.speakingTimeMinutes || 0), 0);
          
          const milestoneNumber = totalLessons / 5;
          
          const message = milestoneNumber === 1
            ? `🎉 You've unlocked your Progress Profile after 5 <strong>${transcript.language}</strong> lessons! Tap to see your full breakdown.`
            : `📊 Milestone ${milestoneNumber} complete! You've finished ${totalLessons} <strong>${transcript.language}</strong> lessons. Tap to see how you've improved.`;
          
          await Notification.create({
            userId: transcript.studentId,
            type: 'progress_milestone',
            title: milestoneNumber === 1 ? `Progress Profile Unlocked! 🏆` : `${transcript.language} Milestone ${milestoneNumber}! 🎯`,
            message: message,
            data: {
              language: transcript.language,
              milestone: totalLessons,
              milestoneNumber: milestoneNumber,
              avgCefrLevel: avgCefrLevel,
              avgGrammar: avgGrammar,
              avgFluency: avgFluency,
              avgVocab: avgVocab,
              totalStudyTime: totalStudyTime,
              hasActionButton: true,
              actionButtonText: 'View Progress',
              actionRoute: '/tabs/progress'
            },
            read: false
          });
          
          console.log(`✅ Created progress milestone notification - ${transcript.language} (milestone ${milestoneNumber}, ${totalLessons} lessons, avg CEFR: ${avgCefrLevel})`);
        }
      }
    } catch (milestoneError) {
      console.error('⚠️ Error checking milestone:', milestoneError);
      // Don't fail the analysis if milestone check fails
    }
    
    return analysis;
    
  } catch (error) {
    console.error('❌ Error in analyzeLesson:', error);
    
    // Log validation errors in detail
    if (error.name === 'ValidationError') {
      console.error('❌❌❌ MONGOOSE VALIDATION ERROR:');
      Object.keys(error.errors).forEach(key => {
        console.error(`   Field: ${key}`);
        console.error(`   Message: ${error.errors[key].message}`);
        console.error(`   Value received: ${JSON.stringify(error.errors[key].value)}`);
      });
    }
    
    // Update analysis status to failed with retry metadata
    await LessonAnalysis.updateOne(
      { transcriptId },
      { 
        status: 'failed',
        error: error.message,
        retryAttempts: 0,  // Initialize for retry
        canRetry: true,    // Enable retry
        lastRetryAttempt: new Date()
      }
    );
    
    console.log('💾 Analysis marked as failed - will retry automatically');
    
    throw error;
  }
}

/**
 * Auto-create SRS VocabularyCards from a completed LessonAnalysis.
 * Harvests suggestedWords and advancedWordsUsed — data already paid for.
 */
async function createVocabularyCardsFromAnalysis(analysis, transcript) {
  const VocabularyCard = require('../models/VocabularyCard');

  const vocab = analysis.vocabularyAnalysis;
  if (!vocab) return;

  const words = new Set();
  (vocab.suggestedWords || []).forEach(w => words.add(w.trim().toLowerCase()));
  (vocab.advancedWordsUsed || []).forEach(w => words.add(w.trim().toLowerCase()));

  if (words.size === 0) return;

  let created = 0;
  for (const term of words) {
    if (!term || term.length < 2) continue;
    try {
      await VocabularyCard.findOneAndUpdate(
        {
          studentId: transcript.studentId,
          language: transcript.language,
          term
        },
        {
          $setOnInsert: {
            studentId: transcript.studentId,
            language: transcript.language,
            term,
            source: { type: 'lesson', lessonAnalysisId: analysis._id },
            easeFactor: 2.5,
            interval: 0,
            repetitions: 0,
            nextReviewDate: new Date(),
            status: 'new'
          }
        },
        { upsert: true, new: true }
      );
      created++;
    } catch (err) {
      if (err.code !== 11000) console.error('⚠️ Error creating vocab card:', err.message);
    }
  }

  console.log(`📚 Created ${created} vocabulary cards from analysis for ${transcript.language}`);
}

/**
 * Update the next upcoming lesson with notes from AI analysis
 */
async function updateNextLessonWithNotes(studentId, tutorId, analysis) {
  try {
    const now = new Date();
    
    // Find the next upcoming lesson between this student and tutor
    const nextLesson = await Lesson.findOne({
      studentId: studentId,
      tutorId: tutorId,
      startTime: { $gt: now },
      status: { $ne: 'cancelled' }
    })
    .sort({ startTime: 1 }) // Get the soonest upcoming lesson
    .limit(1);
    
    if (!nextLesson) {
      console.log('📝 No upcoming lesson found to add notes');
      return;
    }
    
    // Format notes from AI analysis
    const notes = formatAnalysisAsNotes(analysis);
    
    // Update the lesson with notes
    nextLesson.notes = notes;
    await nextLesson.save();
    
    console.log(`✅ Updated lesson ${nextLesson._id} with AI-generated notes`);
    
  } catch (error) {
    console.error('❌ Error updating next lesson with notes:', error);
    throw error;
  }
}

/**
 * Format AI analysis into readable notes for the tutor
 * Designed to answer: 1) What did we work on? 2) Struggles/strengths? 3) Ideas for next class?
 */
function formatAnalysisAsNotes(analysis) {
  let notes = '📋 Quick Brief for Today\'s Class\n\n';
  
  // === QUESTION 1: What did we work on last time? ===
  notes += '━━━━━━━━━━━━━━━━━━━━━\n';
  notes += '💬 LAST CLASS SUMMARY\n';
  notes += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  // Topics discussed
  if (analysis.topicsDiscussed && analysis.topicsDiscussed.length > 0) {
    notes += 'Topics we covered:\n';
    analysis.topicsDiscussed.forEach((topic, i) => {
      notes += `• ${topic}\n`;
    });
    notes += '\n';
  }
  
  // Overall assessment summary
  if (analysis.overallAssessment) {
    notes += `Level: ${analysis.overallAssessment.proficiencyLevel} `;
    if (analysis.progressionMetrics && analysis.progressionMetrics.proficiencyChange) {
      // Only show progression if there's actual change data (not first lesson)
      notes += `(${analysis.progressionMetrics.proficiencyChange})\n\n`;
    } else {
      // First lesson - just show level without progression indicator
      notes += '\n\n';
    }
    
    // Add brief progress note if available
    if (analysis.overallAssessment.progressFromLastLesson) {
      notes += `Progress: ${analysis.overallAssessment.progressFromLastLesson}\n\n`;
    }
  }
  
  // === QUESTION 2: What did they struggle with / do well on? ===
  notes += '━━━━━━━━━━━━━━━━━━━━━\n';
  notes += '📊 PERFORMANCE HIGHLIGHTS\n';
  notes += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  // Strengths (what they did well)
  if (analysis.strengths && analysis.strengths.length > 0) {
    notes += '✅ What They Did Well:\n';
    analysis.strengths.slice(0, 3).forEach((strength) => {
      notes += `• ${strength}\n`;
    });
    notes += '\n';
  }
  
  // Struggles (areas for improvement)
  if (analysis.areasForImprovement && analysis.areasForImprovement.length > 0) {
    notes += '⚠️  What They Struggled With:\n';
    analysis.areasForImprovement.forEach((area) => {
      notes += `• ${area}\n`;
    });
    notes += '\n';
  }
  
  // Specific error patterns (most useful for tutors)
  if (analysis.errorPatterns && analysis.errorPatterns.length > 0) {
    notes += '🔍 Common Mistakes to Watch:\n';
    analysis.errorPatterns.slice(0, 3).forEach((error) => {
      notes += `• ${error.pattern} (appeared ${error.frequency}x`;
      if (error.severity) {
        notes += `, ${error.severity} priority`;
      }
      notes += ')\n';
      
      // Add example if available
      if (error.examples && error.examples.length > 0 && error.examples[0].original) {
        notes += `  Example: "${error.examples[0].original}" → "${error.examples[0].corrected}"\n`;
      }
    });
    notes += '\n';
  }
  
  // Grammar accuracy score if available
  if (analysis.grammarAnalysis && analysis.grammarAnalysis.accuracyScore) {
    notes += `Grammar Accuracy: ${analysis.grammarAnalysis.accuracyScore}%\n`;
  }
  if (analysis.fluencyAnalysis && analysis.fluencyAnalysis.overallFluencyScore) {
    notes += `Fluency Score: ${analysis.fluencyAnalysis.overallFluencyScore}/100\n`;
  }
  if (analysis.grammarAnalysis || analysis.fluencyAnalysis) {
    notes += '\n';
  }
  
  // === QUESTION 3: Optional ideas for this next class ===
  notes += '━━━━━━━━━━━━━━━━━━━━━\n';
  notes += '💡 IDEAS FOR TODAY\'S CLASS\n';
  notes += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  // Recommended focus areas
  if (analysis.recommendedFocus && analysis.recommendedFocus.length > 0) {
    notes += 'Suggested Focus:\n';
    analysis.recommendedFocus.forEach((topic, i) => {
      notes += `${i + 1}. ${topic}\n`;
    });
    notes += '\n';
  }
  
  // Suggested exercises
  if (analysis.suggestedExercises && analysis.suggestedExercises.length > 0) {
    notes += 'Exercise Ideas:\n';
    analysis.suggestedExercises.forEach((exercise, i) => {
      notes += `${i + 1}. ${exercise}\n`;
    });
    notes += '\n';
  }
  
  // Check if they did homework
  if (analysis.homeworkSuggestions && analysis.homeworkSuggestions.length > 0) {
    notes += '✏️  Check Their Homework:\n';
    analysis.homeworkSuggestions.forEach((hw, i) => {
      notes += `${i + 1}. ${hw}\n`;
    });
    notes += '\n';
  }
  
  // Persistent challenges to keep in mind
  if (analysis.progressionMetrics && analysis.progressionMetrics.persistentChallenges 
      && analysis.progressionMetrics.persistentChallenges.length > 0) {
    notes += '🎯 Keep Working On (recurring issues):\n';
    analysis.progressionMetrics.persistentChallenges.forEach((challenge) => {
      notes += `• ${challenge}\n`;
    });
    notes += '\n';
  }
  
  notes += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  notes += '💭 Tip: Start by asking about their homework and what they found challenging!';
  
  return notes.trim();
}

/**
 * @route   GET /api/transcription/backup-stats
 * @desc    Get audio backup and retry statistics
 * @access  Private (Admin only for now)
 */
router.get('/backup-stats', verifyToken, async (req, res) => {
  try {
    const transcriptionRetryService = require('../services/transcriptionRetryService');
    const analysisRetryService = require('../services/analysisRetryService');
    
    const [storageStats, retryStats, analysisStats] = await Promise.all([
      audioBackupService.getStorageStats(),
      transcriptionRetryService.getRetryStats(),
      analysisRetryService.getAnalysisRetryStats()
    ]);
    
    res.json({
      success: true,
      storage: storageStats,
      transcriptionRetry: retryStats,
      analysisRetry: analysisStats
    });
  } catch (error) {
    console.error('❌ Error getting backup stats:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/transcription/:transcriptId/retry
 * @desc    Manually retry a failed transcription
 * @access  Private
 */
router.post('/:transcriptId/retry', verifyToken, async (req, res) => {
  try {
    const { transcriptId } = req.params;
    const transcriptionRetryService = require('../services/transcriptionRetryService');
    
    const result = await transcriptionRetryService.retryTranscript(transcriptId);
    
    res.json({
      success: true,
      message: `Retry complete: ${result.succeeded} succeeded, ${result.failed} failed`,
      ...result
    });
  } catch (error) {
    console.error('❌ Error retrying transcript:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Retry failed'
    });
  }
});

/**
 * @route   DELETE /api/transcription/:transcriptId/audio
 * @desc    Delete all audio backups for a lesson (privacy)
 * @access  Private (student/tutor only)
 */
router.delete('/:transcriptId/audio', verifyToken, async (req, res) => {
  try {
    const { transcriptId } = req.params;
    
    const transcript = await LessonTranscript.findById(transcriptId);
    if (!transcript) {
      return res.status(404).json({ success: false, message: 'Transcript not found' });
    }
    
    // Verify user is student or tutor of this lesson
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    if (transcript.studentId !== user.auth0Id && transcript.tutorId !== user.auth0Id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    // Delete from GCS
    const deleted = await audioBackupService.deleteAllAudioForLesson(transcript.lessonId.toString());
    
    // Clear from database
    transcript.audioChunks = [];
    await transcript.save();
    
    res.json({
      success: true,
      message: `Deleted ${deleted} audio files`,
      filesDeleted: deleted
    });
  } catch (error) {
    console.error('❌ Error deleting audio:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/transcription/analysis/:analysisId/retry
 * @desc    Manually retry a failed analysis
 * @access  Private
 */
router.post('/analysis/:analysisId/retry', verifyToken, async (req, res) => {
  try {
    const { analysisId } = req.params;
    const analysisRetryService = require('../services/analysisRetryService');
    
    const result = await analysisRetryService.retryAnalysis(analysisId);
    
    res.json({
      success: result.success,
      message: result.message
    });
  } catch (error) {
    console.error('❌ Error retrying analysis:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Analysis retry failed'
    });
  }
});

/**
 * @route   POST /api/transcription/analysis/:analysisId/translate
 * @desc    Translate analysis prose fields to a target language (cached in DB)
 * @access  Private
 */
router.post('/analysis/:analysisId/translate', verifyToken, async (req, res) => {
  try {
    const { analysisId } = req.params;
    const { targetLanguage } = req.body;

    if (!targetLanguage || typeof targetLanguage !== 'string' || targetLanguage.length < 2) {
      return res.status(400).json({ success: false, message: 'targetLanguage is required' });
    }

    const analysis = await LessonAnalysis.findById(analysisId);
    if (!analysis) {
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }

    const cached = analysis.translations?.get(targetLanguage);
    if (cached) {
      return res.json({ success: true, translation: cached, cached: true });
    }

    const translated = await translateAnalysisFields(analysis.toObject(), targetLanguage);

    if (!analysis.translations) {
      analysis.translations = new Map();
    }
    analysis.translations.set(targetLanguage, translated);
    await analysis.save();

    res.json({ success: true, translation: translated, cached: false });
  } catch (error) {
    console.error('❌ Error translating analysis:', error);
    res.status(500).json({ success: false, message: error.message || 'Translation failed' });
  }
});

module.exports = router;
module.exports.analyzeLesson = analyzeLesson;




