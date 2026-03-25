const express = require('express');
const router = express.Router();
const LearningPlan = require('../models/LearningPlan');
const User = require('../models/User');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const learningPlanService = require('../services/learningPlanService');

/**
 * @route   GET /api/learning-plan/:language
 * @desc    Get active learning plan for authenticated student
 * @access  Private
 */
router.get('/:language', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const plan = await LearningPlan.findOne({
      studentId: user._id,
      language: req.params.language,
      status: { $in: ['active', 'completed'] }
    }).lean();

    if (!plan) {
      return res.status(404).json({ success: false, message: 'No learning plan found' });
    }

    res.json({ success: true, plan });
  } catch (error) {
    console.error('Error fetching learning plan:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/learning-plan/student/:studentId/:language
 * @desc    Tutor fetches a student's learning plan
 * @access  Private (tutor)
 */
router.get('/student/:studentId/:language', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const plan = await LearningPlan.findOne({
      studentId: req.params.studentId,
      language: req.params.language,
      status: { $in: ['active', 'completed'] }
    }).lean();

    if (!plan) {
      return res.status(404).json({ success: false, message: 'No learning plan found' });
    }

    res.json({ success: true, plan });
  } catch (error) {
    console.error('Error fetching student learning plan:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/learning-plan/student/:studentId/summary
 * @desc    Lightweight plan summary for pre-call / event-details (tutor use)
 * @access  Private
 */
router.get('/student/:studentId/summary', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const plans = await LearningPlan.find({
      studentId: req.params.studentId,
      status: { $in: ['active', 'completed'] }
    }).lean();

    if (!plans.length) {
      return res.status(404).json({ success: false, message: 'No learning plan found' });
    }

    const summaries = plans.map(plan => ({
      _id: plan._id,
      language: plan.language,
      status: plan.status,
      goal: plan.goal,
      currentPhaseIndex: plan.currentPhaseIndex,
      totalPhases: plan.phases.length,
      currentPhase: plan.phases[plan.currentPhaseIndex] || null,
      studentSummary: plan.studentSummary,
      nextLessonFocus: plan.nextLessonFocus,
      tutorOverrides: (plan.tutorOverrides || []).slice(-5),
      selfAssessedLevel: plan.selfAssessedLevel
    }));

    res.json({ success: true, summaries });
  } catch (error) {
    console.error('Error fetching plan summary:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   PUT /api/learning-plan/goal
 * @desc    Student updates their goal (triggers plan regeneration with 7-day cooldown)
 * @access  Private
 */
router.put('/goal', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { language, goal } = req.body;
    if (!language || !goal?.type) {
      return res.status(400).json({ success: false, message: 'language and goal.type are required' });
    }

    const plan = await learningPlanService.regeneratePlan(user._id, language, goal);

    res.json({ success: true, plan });
  } catch (error) {
    if (error.statusCode === 429) {
      return res.status(429).json({
        success: false,
        message: 'Goal change cooldown active',
        nextChangeAvailableAt: error.nextChangeAvailableAt
      });
    }
    console.error('Error updating goal:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/tutor-override
 * @desc    Tutor submits an override (extend phase, adjust focus, add note)
 * @access  Private (tutor)
 */
router.post('/tutor-override', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { studentId, language, action, note } = req.body;
    if (!studentId || !language || !action) {
      return res.status(400).json({ success: false, message: 'studentId, language, and action are required' });
    }

    const validActions = ['extend_phase', 'advance_phase', 'skip_phase', 'adjust_focus', 'add_note'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ success: false, message: `Invalid action. Must be one of: ${validActions.join(', ')}` });
    }

    const plan = await LearningPlan.findOne({
      studentId,
      language,
      status: 'active'
    });

    if (!plan) {
      return res.status(404).json({ success: false, message: 'No active learning plan found' });
    }

    let tutorDisplayName = user.name || 'Tutor';
    if (user.firstName && user.lastName) {
      tutorDisplayName = `${user.firstName} ${user.lastName.charAt(0)}.`;
    }

    plan.tutorOverrides.push({
      tutorId: user._id,
      tutorName: tutorDisplayName,
      date: new Date(),
      action,
      note: note || ''
    });

    if (action === 'advance_phase' && plan.currentPhaseIndex < plan.phases.length - 1) {
      const currentPhase = plan.phases[plan.currentPhaseIndex];
      if (currentPhase) {
        currentPhase.status = 'completed';
        currentPhase.completedAt = new Date();
      }
      plan.currentPhaseIndex += 1;
      const nextPhase = plan.phases[plan.currentPhaseIndex];
      if (nextPhase) {
        nextPhase.status = 'active';
      }
      plan.history.push({
        date: new Date(),
        changeDescription: `Phase advanced by tutor ${tutorDisplayName}`,
        phaseIndexBefore: plan.currentPhaseIndex - 1,
        phaseIndexAfter: plan.currentPhaseIndex
      });
    } else if (action === 'skip_phase' && plan.currentPhaseIndex < plan.phases.length - 1) {
      const currentPhase = plan.phases[plan.currentPhaseIndex];
      if (currentPhase) {
        currentPhase.status = 'completed';
        currentPhase.completedAt = new Date();
      }
      plan.currentPhaseIndex += 1;
      const nextPhase = plan.phases[plan.currentPhaseIndex];
      if (nextPhase) {
        nextPhase.status = 'active';
      }
      plan.history.push({
        date: new Date(),
        changeDescription: `Phase skipped by tutor ${tutorDisplayName}`,
        phaseIndexBefore: plan.currentPhaseIndex - 1,
        phaseIndexAfter: plan.currentPhaseIndex
      });
    } else if (action === 'extend_phase') {
      const currentPhase = plan.phases[plan.currentPhaseIndex];
      if (currentPhase) {
        currentPhase.estimatedLessons += 3;
      }
      plan.history.push({
        date: new Date(),
        changeDescription: `Phase extended by tutor ${tutorDisplayName}: ${note || ''}`,
        phaseIndexBefore: plan.currentPhaseIndex,
        phaseIndexAfter: plan.currentPhaseIndex
      });
    } else if (action === 'adjust_focus') {
      if (note) {
        plan.nextLessonFocus = note;
      }
      plan.history.push({
        date: new Date(),
        changeDescription: `Focus adjusted by tutor ${tutorDisplayName}: ${note || ''}`,
        phaseIndexBefore: plan.currentPhaseIndex,
        phaseIndexAfter: plan.currentPhaseIndex
      });
    }

    plan.lastUpdatedAt = new Date();
    await plan.save();

    res.json({ success: true, plan });
  } catch (error) {
    console.error('Error submitting tutor override:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
