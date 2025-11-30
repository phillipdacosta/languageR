const express = require('express');
const router = express.Router();
const multer = require('multer');
const LessonTranscript = require('../models/LessonTranscript');
const LessonAnalysis = require('../models/LessonAnalysis');
const Lesson = require('../models/Lesson');
const { transcribeAudio, analyzeLessonTranscript, generateProgressReport } = require('../services/aiService');
const auth = require('../middleware/auth');

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
 * @route   POST /api/transcription/start
 * @desc    Start a new transcription session for a lesson
 * @access  Private
 */
router.post('/start', auth, async (req, res) => {
  try {
    const { lessonId, language } = req.body;
    
    if (!lessonId || !language) {
      return res.status(400).json({ message: 'lessonId and language are required' });
    }
    
    // Verify lesson exists
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) {
      return res.status(404).json({ message: 'Lesson not found' });
    }
    
    // Check if user is participant
    const userId = req.user.sub;
    if (lesson.studentId !== userId && lesson.tutorId !== userId) {
      return res.status(403).json({ message: 'Not authorized for this lesson' });
    }
    
    // Check if transcript already exists
    let transcript = await LessonTranscript.findOne({ lessonId });
    
    if (transcript) {
      // Reset existing transcript
      transcript.status = 'recording';
      transcript.segments = [];
      transcript.startTime = new Date();
      transcript.endTime = null;
      await transcript.save();
    } else {
      // Create new transcript
      transcript = await LessonTranscript.create({
        lessonId,
        studentId: lesson.studentId,
        tutorId: lesson.tutorId,
        language,
        startTime: new Date(),
        status: 'recording'
      });
    }
    
    console.log(`✅ Started transcription for lesson ${lessonId}`);
    
    res.json({
      transcriptId: transcript._id,
      status: 'recording'
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
router.post('/:transcriptId/segments', auth, async (req, res) => {
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
router.post('/:transcriptId/audio', auth, upload.single('audio'), async (req, res) => {
  try {
    const { transcriptId } = req.params;
    const { speaker } = req.body; // 'student' or 'tutor'
    
    if (!req.file) {
      return res.status(400).json({ message: 'Audio file is required' });
    }
    
    const transcript = await LessonTranscript.findById(transcriptId);
    if (!transcript) {
      return res.status(404).json({ message: 'Transcript not found' });
    }
    
    console.log(`🎙️ Transcribing audio for ${speaker}...`);
    
    // Transcribe audio using OpenAI Whisper
    const result = await transcribeAudio(req.file.buffer, transcript.language);
    
    // Add segments to transcript
    const segments = result.segments.map(seg => ({
      timestamp: new Date(transcript.startTime.getTime() + (seg.start * 1000)),
      speaker: speaker || 'student',
      text: seg.text,
      confidence: seg.confidence || 1,
      language: transcript.language
    }));
    
    transcript.segments.push(...segments);
    transcript.status = 'processing';
    await transcript.save();
    
    res.json({
      message: 'Audio transcribed successfully',
      segmentsAdded: segments.length,
      text: result.text
    });
    
  } catch (error) {
    console.error('❌ Error transcribing audio:', error);
    res.status(500).json({ message: 'Transcription failed', error: error.message });
  }
});

/**
 * @route   POST /api/transcription/:transcriptId/complete
 * @desc    Mark transcription as complete and trigger analysis
 * @access  Private
 */
router.post('/:transcriptId/complete', auth, async (req, res) => {
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
    
    await transcript.save();
    
    console.log(`✅ Transcription completed for lesson ${transcript.lessonId}`);
    
    // Trigger analysis (async)
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
 * @route   GET /api/transcription/:transcriptId/analysis
 * @desc    Get analysis results for a transcript
 * @access  Private
 */
router.get('/:transcriptId/analysis', auth, async (req, res) => {
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
router.get('/lesson/:lessonId/analysis', auth, async (req, res) => {
  try {
    const { lessonId } = req.params;
    
    const analysis = await LessonAnalysis.findOne({ lessonId });
    
    if (!analysis) {
      return res.status(404).json({ 
        message: 'Analysis not found',
        status: 'not_started'
      });
    }
    
    res.json(analysis);
    
  } catch (error) {
    console.error('❌ Error getting lesson analysis:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   GET /api/transcription/student/:studentId/latest
 * @desc    Get latest analysis for a student with a specific tutor
 * @access  Private
 */
router.get('/student/:studentId/latest', auth, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { tutorId } = req.query;
    
    const query = { studentId };
    if (tutorId) {
      query.tutorId = tutorId;
    }
    
    const analysis = await LessonAnalysis.findOne(query)
      .sort({ lessonDate: -1 })
      .limit(1);
    
    if (!analysis) {
      return res.status(404).json({ message: 'No previous analysis found' });
    }
    
    res.json(analysis);
    
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
router.get('/student/:studentId/progress', auth, async (req, res) => {
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
    
    const startTime = Date.now();
    
    // Get previous analyses for context
    const previousAnalyses = await LessonAnalysis.find({
      studentId: transcript.studentId,
      tutorId: transcript.tutorId,
      lessonDate: { $lt: transcript.startTime }
    })
    .sort({ lessonDate: -1 })
    .limit(3);
    
    // Separate student and tutor segments
    const studentSegments = transcript.segments.filter(s => s.speaker === 'student');
    const tutorSegments = transcript.segments.filter(s => s.speaker === 'tutor');
    
    // Analyze with GPT-4
    const analysisResult = await analyzeLessonTranscript({
      transcript: transcript.segments,
      language: transcript.language,
      studentSegments,
      tutorSegments,
      previousAnalyses
    });
    
    // Create analysis record
    const analysis = await LessonAnalysis.create({
      lessonId: transcript.lessonId,
      transcriptId: transcript._id,
      studentId: transcript.studentId,
      tutorId: transcript.tutorId,
      language: transcript.language,
      lessonDate: transcript.startTime,
      ...analysisResult,
      processingTime: Date.now() - startTime,
      status: 'completed'
    });
    
    console.log(`✅ Analysis completed for lesson ${transcript.lessonId}`);
    
    return analysis;
    
  } catch (error) {
    console.error('❌ Error in analyzeLesson:', error);
    
    // Update analysis status to failed
    await LessonAnalysis.updateOne(
      { transcriptId },
      { 
        status: 'failed',
        error: error.message
      }
    );
    
    throw error;
  }
}

module.exports = router;

