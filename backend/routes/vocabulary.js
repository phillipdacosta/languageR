const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const LessonVocabulary = require('../models/LessonVocabulary');
const VocabularyCard = require('../models/VocabularyCard');
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

// ═══════════════════════════════════════════════════════
// SRS Flashcard Routes
// ═══════════════════════════════════════════════════════

/**
 * @route   GET /api/vocabulary/srs/languages
 * @desc    Get all languages that have vocabulary cards
 * @access  Private
 */
router.get('/srs/languages', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const languages = await VocabularyCard.distinct('language', { studentId: user._id });

    const stats = await Promise.all(languages.map(async (lang) => {
      const dueNow = await VocabularyCard.countDocuments({
        studentId: user._id,
        language: lang,
        nextReviewDate: { $lte: new Date() },
        status: { $ne: 'mastered' }
      });
      const total = await VocabularyCard.countDocuments({ studentId: user._id, language: lang });
      return { language: lang, total, dueNow };
    }));

    res.json({ success: true, languages: stats });
  } catch (error) {
    console.error('Error fetching SRS languages:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/vocabulary/srs/:language/due
 * @desc    Get vocabulary cards due for review today
 * @access  Private
 */
router.get('/srs/:language/due', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { limit = 20 } = req.query;
    const cards = await VocabularyCard.find({
      studentId: user._id,
      language: req.params.language,
      nextReviewDate: { $lte: new Date() },
      status: { $ne: 'mastered' }
    })
      .sort({ nextReviewDate: 1 })
      .limit(parseInt(limit));

    res.json({ success: true, cards });
  } catch (error) {
    console.error('Error fetching due cards:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/vocabulary/srs/:language/stats
 * @desc    Get SRS stats for a language
 * @access  Private
 */
router.get('/srs/:language/stats', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const query = { studentId: user._id, language: req.params.language };

    const [total, newCount, learning, review, mastered, dueNow] = await Promise.all([
      VocabularyCard.countDocuments(query),
      VocabularyCard.countDocuments({ ...query, status: 'new' }),
      VocabularyCard.countDocuments({ ...query, status: 'learning' }),
      VocabularyCard.countDocuments({ ...query, status: 'review' }),
      VocabularyCard.countDocuments({ ...query, status: 'mastered' }),
      VocabularyCard.countDocuments({
        ...query,
        nextReviewDate: { $lte: new Date() },
        status: { $ne: 'mastered' }
      })
    ]);

    res.json({ success: true, total, new: newCount, learning, review, mastered, dueNow });
  } catch (error) {
    console.error('Error fetching SRS stats:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/vocabulary/srs/review
 * @desc    Submit a review result for a card
 * @access  Private
 */
router.post('/srs/review', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { cardId, quality } = req.body;
    if (quality === undefined || quality < 0 || quality > 5) {
      return res.status(400).json({ success: false, message: 'Quality must be 0-5' });
    }

    const card = await VocabularyCard.findOne({ _id: cardId, studentId: user._id });
    if (!card) return res.status(404).json({ success: false, message: 'Card not found' });

    await card.applyReview(quality);

    res.json({ success: true, card });
  } catch (error) {
    console.error('Error reviewing card:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/vocabulary/srs/add
 * @desc    Manually add a vocabulary card
 * @access  Private
 */
router.post('/srs/add', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { term, translation, context, language } = req.body;
    if (!term || !language) {
      return res.status(400).json({ success: false, message: 'Term and language are required' });
    }

    const existing = await VocabularyCard.findOne({
      studentId: user._id,
      language,
      term: term.trim().toLowerCase()
    });
    if (existing) {
      return res.status(200).json({ success: true, card: existing, alreadyExists: true });
    }

    const card = await VocabularyCard.create({
      studentId: user._id,
      language,
      term: term.trim(),
      translation: translation?.trim() || '',
      context: context?.trim() || '',
      source: { type: 'manual' }
    });

    res.status(201).json({ success: true, card });
  } catch (error) {
    console.error('Error adding card:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   PUT /api/vocabulary/srs/:cardId
 * @desc    Update a vocabulary card (translation, context)
 * @access  Private
 */
router.put('/srs/:cardId', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const card = await VocabularyCard.findOne({ _id: req.params.cardId, studentId: user._id });
    if (!card) return res.status(404).json({ success: false, message: 'Card not found' });

    if (req.body.translation !== undefined) card.translation = req.body.translation;
    if (req.body.context !== undefined) card.context = req.body.context;
    await card.save();

    res.json({ success: true, card });
  } catch (error) {
    console.error('Error updating card:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   DELETE /api/vocabulary/srs/:cardId
 * @desc    Delete a vocabulary card
 * @access  Private
 */
router.delete('/srs/:cardId', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const card = await VocabularyCard.findOneAndDelete({ _id: req.params.cardId, studentId: user._id });
    if (!card) return res.status(404).json({ success: false, message: 'Card not found' });

    res.json({ success: true, message: 'Card deleted' });
  } catch (error) {
    console.error('Error deleting card:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;

