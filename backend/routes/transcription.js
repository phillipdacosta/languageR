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
const { transcribeAudio, analyzeLessonTranscript, generateProgressReport } = require('../services/aiService');
const { uploadAudio, getSignedUrl } = require('../services/cloudStorageService');
const { assessPronunciationScore, intelligentSampleSegments } = require('../services/gpt4PronunciationService');
const { assessSegmentPronunciation } = require('../services/pronunciationService');
const { getWordAudio } = require('../services/audioSlicingService');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const audioBackupService = require('../services/audioBackupService');

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
    
    console.log(`📤 Attempting transcription with ${isWebm ? 'WebM' : 'original'} format (${audioBuffer.length} bytes)`);
    
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
    
    // Transcribe audio using OpenAI Whisper (with retry logic)
    let result;
    let transcriptionSuccess = false;
    try {
      // Try with original format first
      result = await transcribeAudio(audioBuffer, normalizedLanguage, speaker);
      transcriptionSuccess = true;
      
      console.log('✅ Whisper transcription result:', {
        text: result.text,
        segmentsCount: result.segments?.length || 0
      });
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
            segmentsCount: result.segments?.length || 0
          });
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
      .filter(seg => seg.text && seg.text.trim().length > 0)  // Filter out empty segments
      .map(seg => {
      const segmentData = {
        timestamp: new Date(transcript.startTime.getTime() + (seg.start * 1000)),
        speaker: speaker || 'student',
        text: seg.text,
        confidence: seg.confidence || 1,
        language: transcript.language
      };
      
      // Note: Audio will be uploaded to GCS in a separate batch after all segments are processed
      // This avoids uploading duplicate audio for every segment (segments share the same audio chunk)
      
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
    
    transcript.metadata = {
      totalDuration: (transcript.endTime - transcript.startTime) / 1000, // seconds
      studentSpeakingTime: studentSegments.length,
      tutorSpeakingTime: tutorSegments.length,
      wordCount: transcript.segments.reduce((sum, seg) => sum + seg.text.split(' ').length, 0)
    };
    
    // Populate fullText from segments (required for audio slicing)
    transcript.fullText = transcript.segments.map(s => s.text).join(' ');
    console.log(`📝 Populated fullText: ${transcript.fullText.length} characters`);
    
    await transcript.save();
    
    console.log(`✅ Transcription completed for lesson ${transcript.lessonId}`);
    
    // Check if student has AI analysis enabled
    const User = require('../models/User');
    const student = await User.findOne({ auth0Id: transcript.studentId });
    
    if (student?.profile?.aiAnalysisEnabled === false) {
      console.log('⏭️  AI analysis disabled by student - creating manual feedback requirement');
      
      // Mark lesson as requiring tutor feedback
      const Lesson = require('../models/Lesson');
      const TutorFeedback = require('../models/TutorFeedback');
      const Notification = require('../models/Notification');
      const { getRandomFeedbackMessage } = require('../utils/feedbackMessages');
      
      const lesson = await Lesson.findById(transcript.lessonId);
      if (lesson) {
        lesson.requiresTutorFeedback = true;
        lesson.status = 'completed';
        await lesson.save();
        
        // Create pending feedback record
        await TutorFeedback.create({
          lessonId: transcript.lessonId,
          tutorId: transcript.tutorId,
          studentId: transcript.studentId,
          status: 'pending'
        });
        
        // Get tutor for notification
        const tutor = await User.findOne({ auth0Id: transcript.tutorId });
        const studentData = await User.findOne({ auth0Id: transcript.studentId });
        
        // Get dynamic message
        const feedbackMsg = getRandomFeedbackMessage(transcript.lessonId.toString());
        
        // Create notification for tutor
        if (tutor) {
          await Notification.create({
            userId: tutor._id,
            type: 'feedback_required',
            title: feedbackMsg.title,
            message: feedbackMsg.message,
            data: {
              lessonId: transcript.lessonId,
              studentName: studentData?.name || 'Student',
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
      return res.status(404).json({ 
        success: false,
        message: 'Analysis not found',
        status: 'not_started'
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
    
    res.json({
      success: true,
      analysis: analysis,  // Return the full LessonAnalysis document with populated users
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
    
    res.json(previousAnalysis);
    
  } catch (error) {
    console.error('❌ Error getting latest analysis:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
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
    
    // Separate student and tutor segments
    const studentSegments = transcript.segments.filter(s => s.speaker === 'student');
    const tutorSegments = transcript.segments.filter(s => s.speaker === 'tutor');
    
    // CRITICAL DEBUG: Log what we're actually analyzing
    console.log('🔍 TRANSCRIPT DEBUG INFO:');
    console.log(`   Total segments: ${transcript.segments.length}`);
    console.log(`   Student segments: ${studentSegments.length}`);
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
    
    if (totalStudentWords < 50) {
      console.warn(`⚠️ WARNING: Very short student transcript (${totalStudentWords} words). This may not be enough for accurate analysis.`);
    }
    
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
    
    // After analysis, update the next upcoming lesson with notes
    try {
      await updateNextLessonWithNotes(transcript.studentId, transcript.tutorId, analysis);
    } catch (notesError) {
      console.error('⚠️ Error updating next lesson notes:', notesError);
      // Don't fail the analysis if notes update fails
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
          type: 'struggle_milestone',
          'data.language': transcript.language,
          'data.milestone': totalLessons
        });
        
        if (!existingNotification) {
          // Get last 5 REGULAR lessons to identify top struggle
          const recentAnalyses = await LessonAnalysis.find({
            studentId: transcript.studentId,
            language: transcript.language,
            status: 'completed'
          })
            .populate({
              path: 'lessonId',
              select: 'isTrialLesson isOfficeHours officeHoursType'
            })
            .sort({ lessonDate: -1 })
            .select('topErrors lessonId')
            .lean();
          
          // Filter out trial/office hours and take last 5
          const recentLessons = recentAnalyses
            .filter(analysis => {
              const lesson = analysis.lessonId;
              if (!lesson) return true;
              if (lesson.isTrialLesson === true) return false;
              if (lesson.isOfficeHours === true && lesson.officeHoursType === 'quick') return false;
              return true;
            })
            .slice(0, 5);

          
          // Count struggles
          const struggleMap = new Map();
          recentLessons.forEach(lesson => {
            lesson.topErrors?.forEach(error => {
              const key = error.issue.toLowerCase().trim();
              if (!struggleMap.has(key)) {
                struggleMap.set(key, { issue: error.issue, count: 0 });
              }
              struggleMap.get(key).count += 1;
            });
          });
          
          const topStruggle = Array.from(struggleMap.values())
            .filter(s => s.count >= 2)
            .sort((a, b) => b.count - a.count)[0];
          
          // Create notification
          const message = topStruggle 
            ? `You've completed <strong>${totalLessons} ${transcript.language}</strong> lessons! We've noticed you're working on <strong>${topStruggle.issue}</strong>. Check your progress page for insights.`
            : `Great progress! You've completed <strong>${totalLessons} ${transcript.language}</strong> lessons. Check your progress page to see how you're doing!`;
          
          await Notification.create({
            userId: transcript.studentId,
            type: 'struggle_milestone',
            title: `${transcript.language} Progress Milestone! 🎯`,
            message: message,
            data: {
              language: transcript.language,
              milestone: totalLessons,
              topStruggle: topStruggle?.issue
            },
            read: false
          });
          
          console.log(`✅ Created struggle milestone notification - ${transcript.language} (${totalLessons} lessons)`);
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

module.exports = router;
module.exports.analyzeLesson = analyzeLesson;




