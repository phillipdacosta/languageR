/**
 * Subscription routes — premium upgrade flow.
 *
 *   POST /api/subscription/checkout  → returns { url } to Stripe Checkout
 *   POST /api/subscription/portal    → returns { url } to Stripe Customer Portal
 *   GET  /api/subscription/me        → current tier + status (read-only summary)
 *
 * The Stripe webhook (`/api/webhooks/stripe`) is what ultimately flips the
 * local User.subscription tier — these routes only kick off the redirect.
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const User = require('../models/User');
const subscriptionService = require('../services/subscriptionService');
const entitlements = require('../services/entitlementsService');

router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    res.json({
      success: true,
      subscription: subscriptionService.getClientSummary(user),
      entitlements: entitlements.describeForClient(user)
    });
  } catch (error) {
    console.error('[Subscription] /me failed:', error);
    res.status(500).json({ success: false, error: 'Failed to load subscription' });
  }
});

router.post('/checkout', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const { successPath, cancelPath } = req.body || {};
    const { url } = await subscriptionService.createCheckoutSession({
      user,
      successPath,
      cancelPath
    });
    res.json({ success: true, url });
  } catch (error) {
    console.error('[Subscription] /checkout failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.message || 'Failed to start checkout'
    });
  }
});

router.post('/portal', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const { returnPath } = req.body || {};
    const { url } = await subscriptionService.createPortalSession({ user, returnPath });
    res.json({ success: true, url });
  } catch (error) {
    console.error('[Subscription] /portal failed:', error);
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.message || 'Failed to open customer portal'
    });
  }
});

module.exports = router;
