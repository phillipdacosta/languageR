const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const User = require('../models/User');
const LearningPlan = require('../models/LearningPlan');
const quizService = require('../services/quizService');
const struggleAggregator = require('../services/struggleAggregator');
const bayes = require('../services/bayesianMastery');
const learningPlanService = require('../services/learningPlanService');
const roadblockContentService = require('../services/roadblockContentService');

/**
 * GET /api/quizzes/me
 * List quizzes pushed to / seen by the authenticated user, newest first.
 * Empty for free students who haven't manually browsed any.
 */
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const language = req.query.language;
    if (!language) return res.status(400).json({ success: false, message: 'language required' });

    const items = await quizService.listSeenForUser(user._id, language);
    res.json({ success: true, items });
  } catch (err) {
    console.error('GET /quizzes/me failed:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/quizzes/library
 * Browse the shared quiz pool. Free students use this for manual practice.
 * Filterable by language, level, struggle.
 */
router.get('/library', verifyToken, async (req, res) => {
  try {
    const { language, level, struggle, limit } = req.query;
    const items = await quizService.browsePool({
      language,
      level,
      struggle,
      limit: Math.min(50, Number(limit) || 20)
    });
    res.json({ success: true, items });
  } catch (err) {
    console.error('GET /quizzes/library failed:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/quizzes/:quizId/complete
 * Record completion and (optionally) a rating. Body: { rating: 1 | 0 | -1 }.
 * Drives auto-pause and pool quality metrics.
 */
router.post('/:quizId/complete', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const rating = Number.isFinite(req.body?.rating) ? req.body.rating : 0;
    const updated = await quizService.recordQuizCompletion({
      userId: user._id,
      quizId: req.params.quizId,
      rating
    });

    // Loop closure: when the client reports first-try performance (the
    // roadblock checkpoint does), fold it into the student's skill belief
    // so a passed gate lowers how often the struggle re-surfaces and a
    // missed one keeps it on the radar. Non-blocking — never fails the
    // completion record if the belief update has a problem.
    let belief = null;
    const correct = Number(req.body?.correct);
    const total = Number(req.body?.total);
    if (Number.isFinite(correct) && Number.isFinite(total) && total > 0) {
      try {
        belief = await learningPlanService.recordQuizEvidence({
          studentId: user._id,
          quizId: req.params.quizId,
          correct,
          total
        });
      } catch (err) {
        console.error('[Quiz] belief update from quiz result failed (non-blocking):', err.message);
      }
    }

    res.json({ success: true, entry: updated, belief });
  } catch (err) {
    console.error('POST /quizzes/complete failed:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/quizzes/manual
 * Premium student manually requests a quiz for a struggle they care about.
 * Bypasses the daily cap (manual trigger) but still respects the cooldown.
 * Body: { language, struggle }.
 */
router.post('/manual', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const { language, struggle } = req.body || {};
    if (!language || !struggle) return res.status(400).json({ success: false, message: 'language and struggle required' });

    const r = await quizService.selectAndPushQuiz({
      userId: user._id,
      language,
      struggle,
      trigger: 'manual'
    });
    res.json({ success: r.pushed, ...r });
  } catch (err) {
    console.error('POST /quizzes/manual failed:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/quizzes/roadblock
 * Journey-map checkpoint gate. Selects a quiz targeted at the student's
 * current top struggle (pool-first, so cost is amortized across students).
 * On-demand selection means tutor/student phase edits never desync it.
 *
 * Body: { language, phaseIndex? }
 * Returns:
 *   - { success: true, available: true, quiz, struggle, personalizedHeader }
 *   - { success: true, available: false, reason } when there isn't enough
 *     signal yet (new student) — the frontend lets them cross with a
 *     friendly note instead of blocking.
 */
router.post('/roadblock', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { language, interfaceLanguage } = req.body || {};
    if (!language) return res.status(400).json({ success: false, message: 'language required' });

    // Load beliefs too: they let the aggregator score with the same
    // mastery context the rest of the app uses, AND let us skip a struggle
    // the student has already proven (no point gating them on a win).
    const plan = await LearningPlan.findOne({ studentId: user._id, language })
      .select('chapterLevel goal skillBeliefs')
      .lean();
    const level = plan?.chapterLevel || 'A1';

    // Tiered content: own-mistakes (A) → tutor notes (B) → goal-inferred (C).
    // Guarantees the gate only ever tests things the student actually
    // encountered (or is honestly framed as a goal-based learning moment),
    // and never invents unrelated vocabulary.
    const gate = await roadblockContentService.buildGate({ user, plan, language, level, interfaceLanguage });

    if (!gate.available) {
      return res.json({ success: true, available: false, reason: gate.reason });
    }

    res.json({
      success: true,
      available: true,
      tier: gate.tier,
      label: gate.label,
      quiz: gate.quiz,
      struggle: gate.struggle,
      struggleLabel: gate.struggleLabel,
      personalizedHeader: gate.personalizedHeader,
      reviewItems: gate.reviewItems || []
    });
  } catch (err) {
    console.error('POST /quizzes/roadblock failed:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
