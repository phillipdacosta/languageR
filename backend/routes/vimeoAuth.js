const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const crypto = require('crypto');

const pendingStates = new Map();

const VIMEO_AUTH_URL = 'https://api.vimeo.com/oauth/authorize';
const VIMEO_TOKEN_URL = 'https://api.vimeo.com/oauth/access_token';
const VIMEO_API_BASE = 'https://api.vimeo.com';

function buildCallbackHtml(success, error, origin) {
  const payload = success
    ? JSON.stringify({ type: 'vimeo_linked', success: true })
    : JSON.stringify({ type: 'vimeo_linked', success: false, error: error || 'unknown' });
  const message = success
    ? 'Vimeo account linked successfully!'
    : 'Vimeo linking failed.';

  return `<!DOCTYPE html>
<html><head><title>Vimeo – Barnabi</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex;
    align-items: center; justify-content: center; height: 100vh; margin: 0;
    background: #f5f5f7; color: #1d1d1f; text-align: center; }
  .card { background: #fff; border-radius: 16px; padding: 40px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); max-width: 360px; }
  .icon { font-size: 48px; margin-bottom: 12px; }
  h2 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
  p { font-size: 14px; color: #86868b; margin: 0; }
</style></head>
<body><div class="card">
  <div class="icon">${success ? '✅' : '❌'}</div>
  <h2>${message}</h2>
  <p>You can close this window now.</p>
</div>
<script>
  var msg = ${payload};
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(msg, '${origin}');
  }
</script></body></html>`;
}

router.get('/vimeo/url', verifyToken, async (req, res) => {
  try {
    const dbUser = await User.findOne({ email: req.user.email });
    if (!dbUser) return res.status(404).json({ error: 'User not found' });

    const state = crypto.randomBytes(32).toString('hex');
    pendingStates.set(state, { userId: dbUser._id.toString(), createdAt: Date.now() });

    for (const [key, val] of pendingStates) {
      if (Date.now() - val.createdAt > 10 * 60 * 1000) pendingStates.delete(key);
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.VIMEO_CLIENT_ID,
      redirect_uri: process.env.VIMEO_REDIRECT_URI,
      state,
      scope: 'public private'
    });

    res.json({ url: `${VIMEO_AUTH_URL}?${params.toString()}` });
  } catch (err) {
    console.error('Vimeo auth URL error:', err);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

router.get('/vimeo/callback', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8100';
  const frontendOrigin = frontendUrl.replace(/\/$/, '');

  try {
    const { code, state, error } = req.query;
    const sendError = (err) => res.send(buildCallbackHtml(false, err, frontendOrigin));

    if (error) return sendError('access_denied');
    if (!code || !state) return sendError('missing_params');

    const stateData = pendingStates.get(state);
    if (!stateData) return sendError('invalid_state');
    pendingStates.delete(state);

    const userId = stateData.userId;

    const tokenRes = await fetch(VIMEO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.VIMEO_CLIENT_ID}:${process.env.VIMEO_CLIENT_SECRET}`
        ).toString('base64'),
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.vimeo.*+json;version=3.4'
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.VIMEO_REDIRECT_URI
      })
    });

    if (!tokenRes.ok) {
      console.error('Vimeo token exchange failed:', await tokenRes.text());
      return sendError('token_failed');
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const vimeoUser = tokenData.user;

    if (!vimeoUser) {
      return sendError('no_account');
    }

    const vimeoUri = vimeoUser.uri;
    const vimeoId = vimeoUri ? vimeoUri.replace('/users/', '') : null;

    await User.findByIdAndUpdate(userId, {
      'linkedChannels.vimeoChannelId': vimeoId,
      'linkedChannels.vimeoChannelUrl': vimeoUser.link || `https://vimeo.com/${vimeoId}`,
      'linkedChannels.vimeoChannelName': vimeoUser.name,
      'linkedChannels.vimeoChannelAvatar': vimeoUser.pictures?.sizes?.[2]?.link || vimeoUser.pictures?.sizes?.[0]?.link || null,
      'linkedChannels.vimeoVerified': true,
      'linkedChannels.vimeoAccessToken': accessToken,
    });

    res.send(buildCallbackHtml(true, null, frontendOrigin));
  } catch (err) {
    console.error('Vimeo OAuth callback error:', err);
    const frontendOrigin = (process.env.FRONTEND_URL || 'http://localhost:8100').replace(/\/$/, '');
    res.send(buildCallbackHtml(false, 'auth_failed', frontendOrigin));
  }
});

router.post('/vimeo/unlink', verifyToken, async (req, res) => {
  try {
    const dbUser = await User.findOne({ email: req.user.email });
    if (!dbUser) return res.status(404).json({ error: 'User not found' });

    await User.findByIdAndUpdate(dbUser._id, {
      'linkedChannels.vimeoChannelId': null,
      'linkedChannels.vimeoChannelUrl': null,
      'linkedChannels.vimeoChannelName': null,
      'linkedChannels.vimeoChannelAvatar': null,
      'linkedChannels.vimeoVerified': false,
      'linkedChannels.vimeoAccessToken': null,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Vimeo unlink error:', err);
    res.status(500).json({ error: 'Failed to unlink Vimeo' });
  }
});

module.exports = router;
