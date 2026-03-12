const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const User = require('../models/User');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const crypto = require('crypto');

const pendingStates = new Map();

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

    const sendError = (err) => res.send(`<html><body><script>
      window.opener && window.opener.postMessage({ type: 'youtube_linked', success: false, error: '${err}' }, '*');
      window.close();
    </script><p>YouTube linking failed. You can close this window.</p></body></html>`);

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

    res.send(`<html><body><script>
      window.opener && window.opener.postMessage({ type: 'youtube_linked', success: true }, '*');
      window.close();
    </script><p>YouTube linked! You can close this window.</p></body></html>`);
  } catch (err) {
    console.error('YouTube OAuth callback error:', err);
    res.send(`<html><body><script>
      window.opener && window.opener.postMessage({ type: 'youtube_linked', success: false, error: 'auth_failed' }, '*');
      window.close();
    </script><p>YouTube linking failed. You can close this window.</p></body></html>`);
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
