const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const User = require('../models/User');
const quizService = require('../services/quizService');

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
    res.json({ success: true, entry: updated });
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

module.exports = router;
