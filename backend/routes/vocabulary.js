const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const LessonVocabulary = require('../models/LessonVocabulary');
const Lesson = require('../models/Lesson');
const User = require('../models/User');

/**
 * @route   PUT /api/vocabulary/:lessonId
 * @desc    Save/update vocabulary and goals for a lesson (upsert)
 * @access  Private (tutor or student of the lesson)
 */
router.put('/:lessonId', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const lesson = await Lesson.findById(req.params.lessonId);
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    // Verify user is part of this lesson
    const isTutor = lesson.tutorId.equals(user._id);
    const isStudent = lesson.studentId.equals(user._id);
    if (!isTutor && !isStudent) {
      return res.status(403).json({ success: false, message: 'Not authorized for this lesson' });
    }

    const { vocabulary, goals, language } = req.body;

    const update = {
      tutorId: lesson.tutorId,
      studentId: lesson.studentId,
      language: language || lesson.subject || 'Spanish'
    };

    if (vocabulary !== undefined) {
      update.vocabulary = vocabulary;
    }
    if (goals !== undefined) {
      update.goals = goals;
    }

    const doc = await LessonVocabulary.findOneAndUpdate(
      { lessonId: req.params.lessonId },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, data: doc });
  } catch (error) {
    console.error('Error saving vocabulary:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/vocabulary/:lessonId
 * @desc    Get vocabulary and goals for a specific lesson
 * @access  Private (tutor or student of the lesson)
 */
router.get('/:lessonId', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const lesson = await Lesson.findById(req.params.lessonId);
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    // Verify user is part of this lesson
    const isTutor = lesson.tutorId.equals(user._id);
    const isStudent = lesson.studentId.equals(user._id);
    if (!isTutor && !isStudent) {
      return res.status(403).json({ success: false, message: 'Not authorized for this lesson' });
    }

    const doc = await LessonVocabulary.findOne({ lessonId: req.params.lessonId });

    res.json({
      success: true,
      data: doc || { vocabulary: [], goals: [], lessonId: req.params.lessonId }
    });
  } catch (error) {
    console.error('Error fetching vocabulary:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/vocabulary/student/all
 * @desc    Get all vocabulary from all lessons for the current student
 * @access  Private (student only)
 */
router.get('/student/all', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { limit = 50, skip = 0 } = req.query;

    const docs = await LessonVocabulary.find({
      studentId: user._id,
      'vocabulary.0': { $exists: true } // Only return lessons that have vocab
    })
    .populate('lessonId', 'startTime endTime subject')
    .populate('tutorId', 'name firstName lastName picture')
    .sort({ createdAt: -1 })
    .skip(parseInt(skip))
    .limit(parseInt(limit));

    const total = await LessonVocabulary.countDocuments({
      studentId: user._id,
      'vocabulary.0': { $exists: true }
    });

    res.json({
      success: true,
      data: docs,
      total,
      hasMore: parseInt(skip) + docs.length < total
    });
  } catch (error) {
    console.error('Error fetching student vocabulary:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;

