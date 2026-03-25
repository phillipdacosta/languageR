const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const User = require('../models/User');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const crypto = require('crypto');

const pendingStates = new Map();

function buildCallbackHtml(success, error, origin) {
  const payload = success
    ? JSON.stringify({ type: 'youtube_linked', success: true })
    : JSON.stringify({ type: 'youtube_linked', success: false, error: error || 'unknown' });
  const message = success
    ? 'YouTube channel linked successfully!'
    : 'YouTube linking failed.';

  return `<!DOCTYPE html>
<html><head><title>YouTube – Barnabi</title>
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

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
}

// Generate the Google OAuth URL for YouTube channel linking
router.get('/youtube/url', verifyToken, async (req, res) => {
  try {
    const dbUser = await User.findOne({ email: req.user.email });
    if (!dbUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oauth2Client = getOAuth2Client();
    const state = crypto.randomBytes(32).toString('hex');

    pendingStates.set(state, {
      userId: dbUser._id.toString(),
      createdAt: Date.now()
    });

    // Clean up expired states (older than 10 minutes)
    for (const [key, val] of pendingStates) {
      if (Date.now() - val.createdAt > 10 * 60 * 1000) {
        pendingStates.delete(key);
      }
    }

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/youtube.readonly'],
      state,
      prompt: 'consent'
    });

    res.json({ url });
  } catch (err) {
    console.error('YouTube auth URL error:', err);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

// Google redirects here after the tutor authorizes
router.get('/youtube/callback', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8100';

  try {
    const { code, state, error } = req.query;

    const frontendOrigin = frontendUrl.replace(/\/$/, '');
    const sendError = (err) => res.send(buildCallbackHtml(false, err, frontendOrigin));

    if (error) return sendError('access_denied');
    if (!code || !state) return sendError('missing_params');

    const stateData = pendingStates.get(state);
    if (!stateData) return sendError('invalid_state');
    pendingStates.delete(state);

    const userId = stateData.userId;
    const oauth2Client = getOAuth2Client();

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const response = await youtube.channels.list({
      part: 'snippet,statistics',
      mine: true
    });

    const channel = response.data.items?.[0];
    if (!channel) return sendError('no_channel');

    const subscriberCount = channel.statistics?.subscriberCount;
    const formattedSubs = subscriberCount
      ? `${Number(subscriberCount).toLocaleString()} subscribers`
      : null;

    await User.findByIdAndUpdate(userId, {
      'linkedChannels.youtubeChannelId': channel.id,
      'linkedChannels.youtubeChannelUrl': `https://youtube.com/channel/${channel.id}`,
      'linkedChannels.youtubeChannelName': channel.snippet.title,
      'linkedChannels.youtubeChannelAvatar': channel.snippet.thumbnails?.default?.url || null,
      'linkedChannels.youtubeSubscriberCount': formattedSubs,
      'linkedChannels.youtubeVerified': true,
      'linkedChannels.youtubeAccessToken': tokens.access_token,
      'linkedChannels.youtubeRefreshToken': tokens.refresh_token || null,
    });

    res.send(buildCallbackHtml(true, null, frontendOrigin));
  } catch (err) {
    console.error('YouTube OAuth callback error:', err);
    res.send(buildCallbackHtml(false, 'auth_failed', frontendOrigin));
  }
});

// Unlink YouTube channel
router.post('/youtube/unlink', verifyToken, async (req, res) => {
  try {
    const dbUser = await User.findOne({ email: req.user.email });
    if (!dbUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    await User.findByIdAndUpdate(dbUser._id, {
      'linkedChannels.youtubeChannelId': null,
      'linkedChannels.youtubeChannelUrl': null,
      'linkedChannels.youtubeChannelName': null,
      'linkedChannels.youtubeChannelAvatar': null,
      'linkedChannels.youtubeSubscriberCount': null,
      'linkedChannels.youtubeVerified': false,
      'linkedChannels.youtubeAccessToken': null,
      'linkedChannels.youtubeRefreshToken': null,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('YouTube unlink error:', err);
    res.status(500).json({ error: 'Failed to unlink YouTube' });
  }
});

module.exports = router;
