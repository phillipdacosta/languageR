const express = require('express');
const Progress = require('../models/Progress');
const Lesson = require('../models/Lesson');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get user's progress
router.get('/', auth, async (req, res) => {
  try {
    const { status, language, page = 1, limit = 10 } = req.query;
    
    const filter = { user: req.user._id };
    if (status) filter.status = status;

    let progressQuery = Progress.find(filter)
      .populate('lesson', 'title description language level category estimatedTime')
      .sort({ updatedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // Filter by language if specified
    if (language) {
      progressQuery = progressQuery.populate({
        path: 'lesson',
        match: { language: language }
      });
    }

    const progress = await progressQuery;

    // Filter out null lessons (when language filter doesn't match)
    const filteredProgress = progress.filter(p => p.lesson);

    const total = await Progress.countDocuments(filter);

    res.json({
      progress: filteredProgress,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get progress error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get progress for specific lesson
router.get('/lesson/:lessonId', auth, async (req, res) => {
  try {
    const progress = await Progress.findOne({
      user: req.user._id,
      lesson: req.params.lessonId
    }).populate('lesson');

    if (!progress) {
      return res.status(404).json({ message: 'Progress not found for this lesson' });
    }

    res.json({ progress });
  } catch (error) {
    console.error('Get lesson progress error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get progress statistics
router.get('/stats', auth, async (req, res) => {
  try {
    const { language, timeRange = 'all' } = req.query;
    
    let dateFilter = {};
    if (timeRange !== 'all') {
      const now = new Date();
      switch (timeRange) {
        case 'week':
          dateFilter = { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
          break;
        case 'month':
          dateFilter = { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
          break;
        case 'year':
          dateFilter = { $gte: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000) };
          break;
      }
    }

    const matchFilter = { user: req.user._id };
    if (Object.keys(dateFilter).length > 0) {
      matchFilter.updatedAt = dateFilter;
    }

    const stats = await Progress.aggregate([
      { $match: matchFilter },
      {
        $lookup: {
          from: 'lessons',
          localField: 'lesson',
          foreignField: '_id',
          as: 'lessonData'
        }
      },
      { $unwind: '$lessonData' },
      ...(language ? [{ $match: { 'lessonData.language': language } }] : []),
      {
        $group: {
          _id: null,
          totalLessons: { $sum: 1 },
          completedLessons: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          inProgressLessons: {
            $sum: { $cond: [{ $eq: ['$status', 'in-progress'] }, 1, 0] }
          },
          totalXP: { $sum: '$xpEarned' },
          totalTimeSpent: { $sum: '$timeSpent' },
          averageScore: { $avg: '$score' },
          totalAttempts: { $sum: '$attempts' }
        }
      }
    ]);

    // Get language-specific stats
    const languageStats = await Progress.aggregate([
      { $match: matchFilter },
      {
        $lookup: {
          from: 'lessons',
          localField: 'lesson',
          foreignField: '_id',
          as: 'lessonData'
        }
      },
      { $unwind: '$lessonData' },
      {
        $group: {
          _id: '$lessonData.language',
          totalLessons: { $sum: 1 },
          completedLessons: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          totalXP: { $sum: '$xpEarned' },
          averageScore: { $avg: '$score' }
        }
      },
      { $sort: { totalXP: -1 } }
    ]);

    // Get recent activity
    const recentActivity = await Progress.find(matchFilter)
      .populate('lesson', 'title language level')
      .sort({ updatedAt: -1 })
      .limit(10);

    const result = {
      overall: stats[0] || {
        totalLessons: 0,
        completedLessons: 0,
        inProgressLessons: 0,
        totalXP: 0,
        totalTimeSpent: 0,
        averageScore: 0,
        totalAttempts: 0
      },
      byLanguage: languageStats,
      recentActivity
    };

    res.json({ stats: result });
  } catch (error) {
    console.error('Get progress stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get streak information
router.get('/streak', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    
    // Get lessons completed in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentCompletions = await Progress.find({
      user: req.user._id,
      status: 'completed',
      completedAt: { $gte: thirtyDaysAgo }
    }).sort({ completedAt: -1 });

    // Calculate current streak
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    let lastDate = null;

    recentCompletions.forEach(progress => {
      const completionDate = new Date(progress.completedAt);
      const dateStr = completionDate.toDateString();

      if (lastDate === null) {
        lastDate = dateStr;
        tempStreak = 1;
        currentStreak = 1;
      } else {
        const daysDiff = Math.floor((new Date(lastDate) - completionDate) / (1000 * 60 * 60 * 24));
        
        if (daysDiff === 1) {
          tempStreak++;
        } else if (daysDiff > 1) {
          longestStreak = Math.max(longestStreak, tempStreak);
          if (currentStreak === tempStreak) {
            currentStreak = 0;
          }
          tempStreak = 1;
        }
        
        lastDate = dateStr;
      }
    });

    longestStreak = Math.max(longestStreak, tempStreak);
    if (currentStreak === 0 && tempStreak > 0) {
      currentStreak = tempStreak;
    }

    res.json({
      currentStreak,
      longestStreak,
      totalXP: user.totalXP,
      recentCompletions: recentCompletions.length
    });
  } catch (error) {
    console.error('Get streak error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reset lesson progress
router.delete('/lesson/:lessonId', auth, async (req, res) => {
  try {
    const progress = await Progress.findOneAndDelete({
      user: req.user._id,
      lesson: req.params.lessonId
    });

    if (!progress) {
      return res.status(404).json({ message: 'Progress not found' });
    }

    res.json({ message: 'Progress reset successfully' });
  } catch (error) {
    console.error('Reset progress error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
