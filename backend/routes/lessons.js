const express = require('express');
const Lesson = require('../models/Lesson');
const Progress = require('../models/Progress');
const { auth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get all lessons with optional filtering
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { language, level, category, page = 1, limit = 10 } = req.query;
    
    const filter = { isActive: true };
    if (language) filter.language = language;
    if (level) filter.level = level;
    if (category) filter.category = category;

    const lessons = await Lesson.find(filter)
      .populate('createdBy', 'username firstName lastName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Lesson.countDocuments(filter);

    // If user is authenticated, add progress information
    if (req.user) {
      const lessonIds = lessons.map(lesson => lesson._id);
      const progressRecords = await Progress.find({
        user: req.user._id,
        lesson: { $in: lessonIds }
      });

      const progressMap = {};
      progressRecords.forEach(progress => {
        progressMap[progress.lesson.toString()] = progress;
      });

      lessons.forEach(lesson => {
        lesson.progress = progressMap[lesson._id.toString()] || null;
      });
    }

    res.json({
      lessons,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get lessons error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get lesson by ID
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id)
      .populate('createdBy', 'username firstName lastName')
      .populate('prerequisites');

    if (!lesson) {
      return res.status(404).json({ message: 'Lesson not found' });
    }

    // If user is authenticated, add progress information
    if (req.user) {
      const progress = await Progress.findOne({
        user: req.user._id,
        lesson: lesson._id
      });
      lesson.progress = progress;
    }

    res.json({ lesson });
  } catch (error) {
    console.error('Get lesson error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new lesson (admin/teacher only)
router.post('/', auth, async (req, res) => {
  try {
    const lessonData = {
      ...req.body,
      createdBy: req.user._id
    };

    const lesson = new Lesson(lessonData);
    await lesson.save();

    await lesson.populate('createdBy', 'username firstName lastName');

    res.status(201).json({
      message: 'Lesson created successfully',
      lesson
    });
  } catch (error) {
    console.error('Create lesson error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update lesson
router.put('/:id', auth, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);

    if (!lesson) {
      return res.status(404).json({ message: 'Lesson not found' });
    }

    // Check if user is the creator or admin
    if (lesson.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this lesson' });
    }

    const updatedLesson = await Lesson.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('createdBy', 'username firstName lastName');

    res.json({
      message: 'Lesson updated successfully',
      lesson: updatedLesson
    });
  } catch (error) {
    console.error('Update lesson error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete lesson
router.delete('/:id', auth, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);

    if (!lesson) {
      return res.status(404).json({ message: 'Lesson not found' });
    }

    // Check if user is the creator or admin
    if (lesson.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this lesson' });
    }

    // Soft delete by setting isActive to false
    lesson.isActive = false;
    await lesson.save();

    res.json({ message: 'Lesson deleted successfully' });
  } catch (error) {
    console.error('Delete lesson error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Start lesson
router.post('/:id/start', auth, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);

    if (!lesson) {
      return res.status(404).json({ message: 'Lesson not found' });
    }

    // Check if progress already exists
    let progress = await Progress.findOne({
      user: req.user._id,
      lesson: lesson._id
    });

    if (!progress) {
      // Create new progress record
      progress = new Progress({
        user: req.user._id,
        lesson: lesson._id,
        status: 'in-progress'
      });
      await progress.save();
    } else if (progress.status === 'completed') {
      return res.status(400).json({ message: 'Lesson already completed' });
    } else {
      // Update existing progress
      progress.status = 'in-progress';
      progress.attempts += 1;
      await progress.save();
    }

    res.json({
      message: 'Lesson started successfully',
      progress
    });
  } catch (error) {
    console.error('Start lesson error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Submit lesson answers
router.post('/:id/submit', auth, async (req, res) => {
  try {
    const { answers } = req.body;
    const lesson = await Lesson.findById(req.params.id);

    if (!lesson) {
      return res.status(404).json({ message: 'Lesson not found' });
    }

    let progress = await Progress.findOne({
      user: req.user._id,
      lesson: lesson._id
    });

    if (!progress) {
      return res.status(400).json({ message: 'Lesson not started' });
    }

    // Calculate score and XP
    let correctAnswers = 0;
    let totalXP = 0;
    const exerciseResults = [];

    lesson.exercises.forEach((exercise, index) => {
      const userAnswer = answers[index];
      const isCorrect = JSON.stringify(userAnswer) === JSON.stringify(exercise.correctAnswer);
      
      if (isCorrect) {
        correctAnswers++;
        totalXP += exercise.points;
      }

      exerciseResults.push({
        exerciseIndex: index,
        userAnswer,
        isCorrect,
        timeSpent: 0, // This would be calculated on frontend
        attempts: 1
      });
    });

    const score = Math.round((correctAnswers / lesson.exercises.length) * 100);
    const isCompleted = score >= 70; // 70% to pass

    // Update progress
    progress.score = score;
    progress.exerciseResults = exerciseResults;
    progress.xpEarned = totalXP;
    progress.attempts += 1;

    if (isCompleted) {
      progress.status = 'completed';
      progress.completedAt = new Date();
    }

    await progress.save();

    // Update user's total XP and streak
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    user.totalXP += totalXP;
    
    // Simple streak logic - could be more sophisticated
    if (isCompleted) {
      user.streak += 1;
    }

    await user.save();

    res.json({
      message: isCompleted ? 'Lesson completed successfully!' : 'Lesson submitted',
      score,
      correctAnswers,
      totalQuestions: lesson.exercises.length,
      xpEarned: totalXP,
      isCompleted,
      progress
    });
  } catch (error) {
    console.error('Submit lesson error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
