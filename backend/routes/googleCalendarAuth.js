const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const User = require('../models/User');
const Lesson = require('../models/Lesson');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const crypto = require('crypto');

const pendingStates = new Map();

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email'
];

function buildCallbackHtml(success, error, origin) {
  const payload = success
    ? JSON.stringify({ type: 'google_calendar_linked', success: true })
    : JSON.stringify({ type: 'google_calendar_linked', success: false, error: error || 'unknown' });
  const message = success
    ? 'Google Calendar connected!'
    : 'Google Calendar connection failed.';

  return `<!DOCTYPE html>
<html><head><title>Google Calendar – Barnabi</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; min-height: 100dvh; margin: 0; padding: 24px;
    background: #f5f5f7; color: #1d1d1f; text-align: center; }
  .card { background: #fff; border-radius: 20px; padding: 48px 32px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.08); width: 100%; max-width: 400px; }
  .icon { font-size: 64px; margin-bottom: 16px; line-height: 1; }
  h2 { font-size: 22px; font-weight: 700; margin: 0 0 8px; letter-spacing: -0.3px; }
  p { font-size: 16px; color: #86868b; margin: 0; line-height: 1.4; }
</style></head>
<body><div class="card">
  <div class="icon">${success ? '✅' : '❌'}</div>
  <h2>${message}</h2>
  <p>You can close this window now.</p>
</div>
<script>
  var msg = ${payload};
  if (window.opener && !window.opener.closed) {
    try { window.opener.postMessage(msg, '${origin}'); } catch(e) {}
    try { window.opener.postMessage(msg, '*'); } catch(e) {}
  }
  setTimeout(function() { window.close(); }, 1500);
</script></body></html>`;
}

function getOAuth2Client() {
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI
    || (process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:3000/api/auth/youtube/callback').replace('/youtube/callback', '/google-calendar/callback');
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri
  );
}

// GET /api/auth/google-calendar/url — Generate OAuth consent URL
router.get('/google-calendar/url', verifyToken, async (req, res) => {
  try {
    const dbUser = await User.findOne({ email: req.user.email });
    if (!dbUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oauth2Client = getOAuth2Client();
    const state = crypto.randomBytes(32).toString('hex');

    pendingStates.set(state, { userId: dbUser._id.toString(), createdAt: Date.now() });

    for (const [key, val] of pendingStates) {
      if (Date.now() - val.createdAt > 10 * 60 * 1000) {
        pendingStates.delete(key);
      }
    }

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      state,
      prompt: 'consent'
    });

    res.json({ url });
  } catch (err) {
    console.error('Google Calendar auth URL error:', err);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

// GET /api/auth/google-calendar/callback — OAuth callback
router.get('/google-calendar/callback', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8100';
  const frontendOrigin = frontendUrl.replace(/\/$/, '');
  const sendError = (err) => res.send(buildCallbackHtml(false, err, frontendOrigin));

  try {
    const { code, state, error } = req.query;

    if (error) return sendError('access_denied');
    if (!code || !state) return sendError('missing_params');

    const stateData = pendingStates.get(state);
    if (!stateData) return sendError('invalid_state');
    pendingStates.delete(state);

    const userId = stateData.userId;
    const oauth2Client = getOAuth2Client();

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get the user's email from the Google account
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfoRes = await oauth2.userinfo.get();
    const googleEmail = userInfoRes.data.email;

    // Compute token expiry
    const tokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    await User.findByIdAndUpdate(userId, {
      'googleCalendar.connected': true,
      'googleCalendar.accessToken': tokens.access_token,
      'googleCalendar.refreshToken': tokens.refresh_token || null,
      'googleCalendar.tokenExpiry': tokenExpiry,
      'googleCalendar.email': googleEmail,
      'googleCalendar.calendarId': 'primary',
      'googleCalendar.syncEnabled': true,
      'googleCalendar.pushToGoogle': true,
      'googleCalendar.lastSyncAt': null
    });

    // Register push notification watch channel (non-blocking)
    registerWatch(userId).catch(err => {
      console.error('[GCal Callback] Watch registration failed (non-blocking):', err.message);
    });

    res.send(buildCallbackHtml(true, null, frontendOrigin));
  } catch (err) {
    console.error('Google Calendar OAuth callback error:', err);
    res.send(buildCallbackHtml(false, 'auth_failed', frontendOrigin));
  }
});

// POST /api/auth/google-calendar/disconnect — Disconnect Google Calendar
router.post('/google-calendar/disconnect', verifyToken, async (req, res) => {
  try {
    const dbUser = await User.findOne({ email: req.user.email });
    if (!dbUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Stop push notification watch channel before clearing tokens
    await stopWatch(dbUser._id).catch(err => {
      console.error('[GCal Disconnect] Stop watch failed (non-blocking):', err.message);
    });

    await User.findByIdAndUpdate(dbUser._id, {
      'googleCalendar.connected': false,
      'googleCalendar.accessToken': null,
      'googleCalendar.refreshToken': null,
      'googleCalendar.tokenExpiry': null,
      'googleCalendar.email': null,
      'googleCalendar.syncEnabled': false,
      'googleCalendar.pushToGoogle': false,
      'googleCalendar.lastSyncAt': null,
      'googleCalendar.watchChannelId': null,
      'googleCalendar.watchResourceId': null,
      'googleCalendar.watchExpiration': null,
      'googleCalendar.watchToken': null
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Google Calendar disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect Google Calendar' });
  }
});

// Helper: get a valid OAuth2 client for a user (refreshes token if needed)
async function getAuthenticatedClient(userId) {
  const user = await User.findById(userId)
    .select('+googleCalendar.accessToken +googleCalendar.refreshToken +googleCalendar.tokenExpiry +googleCalendar.connected +googleCalendar.calendarId');
  
  if (!user) {
    console.error('[GCal Auth] User not found:', userId);
    return null;
  }

  const gcal = user.googleCalendar || {};
  console.log('[GCal Auth] Token state:', {
    connected: gcal.connected,
    hasAccessToken: !!gcal.accessToken,
    hasRefreshToken: !!gcal.refreshToken,
    tokenExpiry: gcal.tokenExpiry,
    accessTokenLength: gcal.accessToken?.length || 0,
    refreshTokenLength: gcal.refreshToken?.length || 0
  });

  if (!gcal.connected || !gcal.refreshToken) {
    console.error('[GCal Auth] Not connected or missing refresh token');
    return null;
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: gcal.accessToken,
    refresh_token: gcal.refreshToken,
    expiry_date: gcal.tokenExpiry ? gcal.tokenExpiry.getTime() : null
  });

  const now = Date.now();
  const expiry = gcal.tokenExpiry ? gcal.tokenExpiry.getTime() : 0;
  if (now >= expiry - 5 * 60 * 1000) {
    console.log('[GCal Auth] Token expired or expiring, refreshing...');
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      console.log('[GCal Auth] Token refreshed successfully, new expiry:', credentials.expiry_date);
      await User.findByIdAndUpdate(userId, {
        'googleCalendar.accessToken': credentials.access_token,
        'googleCalendar.tokenExpiry': credentials.expiry_date ? new Date(credentials.expiry_date) : null
      });
      oauth2Client.setCredentials(credentials);
    } catch (refreshErr) {
      console.error('[GCal Auth] Token refresh failed:', refreshErr.message);
      await User.findByIdAndUpdate(userId, { 'googleCalendar.connected': false });
      return null;
    }
  }

  return oauth2Client;
}

// Register a Google Calendar watch channel for push notifications
async function registerWatch(userId) {
  const backendUrl = process.env.BACKEND_PUBLIC_URL;
  if (!backendUrl) {
    console.log('[GCal Watch] BACKEND_PUBLIC_URL not set, skipping watch registration (local dev)');
    return null;
  }

  const webhookAddress = `${backendUrl}/api/webhooks/google-calendar`;
  console.log(`[GCal Watch] Attempting to register webhook at: ${webhookAddress} for user ${userId}`);

  try {
    const oauth2Client = await getAuthenticatedClient(userId);
    if (!oauth2Client) {
      console.error('[GCal Watch] Could not get authenticated client for user', userId);
      return null;
    }

    const user = await User.findById(userId);
    const calendarId = user?.googleCalendar?.calendarId || 'primary';
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const channelId = crypto.randomUUID();
    const watchToken = crypto.randomBytes(32).toString('hex');

    const response = await calendar.events.watch({
      calendarId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookAddress,
        token: watchToken
      }
    });

    const expiration = response.data.expiration
      ? new Date(parseInt(response.data.expiration))
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await User.findByIdAndUpdate(userId, {
      'googleCalendar.watchChannelId': channelId,
      'googleCalendar.watchResourceId': response.data.resourceId,
      'googleCalendar.watchExpiration': expiration,
      'googleCalendar.watchToken': watchToken
    });

    console.log(`[GCal Watch] ✅ Registered channel ${channelId} for user ${userId}, expires ${expiration.toISOString()}`);
    return { channelId, resourceId: response.data.resourceId, expiration };
  } catch (err) {
    console.error(`[GCal Watch] ❌ Failed to register watch for user ${userId}:`, err.message);
    if (err.errors) console.error('[GCal Watch] Google API errors:', JSON.stringify(err.errors));
    return null;
  }
}

// Stop an existing Google Calendar watch channel
async function stopWatch(userId) {
  try {
    const user = await User.findById(userId)
      .select('+googleCalendar.accessToken +googleCalendar.refreshToken +googleCalendar.tokenExpiry +googleCalendar.connected +googleCalendar.calendarId');
    const gcal = user?.googleCalendar || {};
    if (!gcal.watchChannelId || !gcal.watchResourceId) return;

    const oauth2Client = await getAuthenticatedClient(userId);
    if (!oauth2Client) {
      await clearWatchFields(userId);
      return;
    }

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await calendar.channels.stop({
      requestBody: {
        id: gcal.watchChannelId,
        resourceId: gcal.watchResourceId
      }
    });

    console.log(`[GCal Watch] Stopped channel ${gcal.watchChannelId} for user ${userId}`);
    await clearWatchFields(userId);
  } catch (err) {
    console.error('[GCal Watch] Failed to stop watch:', err.message);
    await clearWatchFields(userId);
  }
}

async function clearWatchFields(userId) {
  await User.findByIdAndUpdate(userId, {
    'googleCalendar.watchChannelId': null,
    'googleCalendar.watchResourceId': null,
    'googleCalendar.watchExpiration': null,
    'googleCalendar.watchToken': null
  });
}

// Fetch events for a user (reusable by both the API endpoint and the webhook handler)
async function fetchEventsForUser(userId, timeMin, timeMax) {
  const oauth2Client = await getAuthenticatedClient(userId);
  if (!oauth2Client) return null;

  const user = await User.findById(userId);
  const calendarId = user?.googleCalendar?.calendarId || 'primary';
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Get Google Calendar event IDs that were pushed from Barnabi lessons
  // so we can exclude them (avoid showing duplicates of Barnabi lessons)
  const barnabiLessons = await Lesson.find({
    tutorId: userId,
    googleCalendarEventId: { $ne: null }
  }).select('googleCalendarEventId').lean();
  const barnabiEventIds = new Set(barnabiLessons.map(l => l.googleCalendarEventId));

  const response = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250
  });

  const events = (response.data.items || []).map(evt => ({
    id: evt.id,
    summary: evt.summary || '(No title)',
    start: evt.start?.dateTime || evt.start?.date,
    end: evt.end?.dateTime || evt.end?.date,
    allDay: !evt.start?.dateTime,
    status: evt.status
  })).filter(evt => evt.status !== 'cancelled' && !barnabiEventIds.has(evt.id));

  await User.findByIdAndUpdate(userId, { 'googleCalendar.lastSyncAt': new Date() });
  return events;
}

// GET /api/auth/google-calendar/events — Fetch events for a date range
router.get('/google-calendar/events', verifyToken, async (req, res) => {
  try {
    const dbUser = await User.findOne({ email: req.user.email });
    if (!dbUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!dbUser.googleCalendar?.connected) {
      return res.status(400).json({ error: 'Google Calendar not connected', disconnected: true });
    }

    const { timeMin, timeMax } = req.query;
    if (!timeMin || !timeMax) {
      return res.status(400).json({ error: 'timeMin and timeMax query params required' });
    }

    const events = await fetchEventsForUser(dbUser._id, timeMin, timeMax);
    if (!events) {
      return res.status(400).json({ error: 'Google Calendar not connected', disconnected: true });
    }

    res.json({ success: true, events });
  } catch (err) {
    console.error('Google Calendar events error:', err.message);
    if (err.message?.includes('insufficient authentication scopes')) {
      return res.status(403).json({ 
        error: 'Insufficient scopes. Please disconnect and reconnect Google Calendar.', 
        reconnectRequired: true 
      });
    }
    if (err.code === 401 || err.code === 403) {
      return res.status(401).json({ error: 'Google Calendar authorization expired', disconnected: true });
    }
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// GET /api/auth/google-calendar/status — Get connection status
router.get('/google-calendar/status', verifyToken, async (req, res) => {
  try {
    const dbUser = await User.findOne({ email: req.user.email });
    if (!dbUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      connected: dbUser.googleCalendar?.connected || false,
      email: dbUser.googleCalendar?.email || null,
      syncEnabled: dbUser.googleCalendar?.syncEnabled || false,
      pushToGoogle: dbUser.googleCalendar?.pushToGoogle || false,
      lastSyncAt: dbUser.googleCalendar?.lastSyncAt || null,
      calendarId: dbUser.googleCalendar?.calendarId || 'primary',
      watchActive: !!(dbUser.googleCalendar?.watchChannelId && dbUser.googleCalendar?.watchExpiration && new Date(dbUser.googleCalendar.watchExpiration) > new Date())
    });
  } catch (err) {
    console.error('Google Calendar status error:', err);
    res.status(500).json({ error: 'Failed to get calendar status' });
  }
});

// PUT /api/auth/google-calendar/settings — Update sync settings
router.put('/google-calendar/settings', verifyToken, async (req, res) => {
  try {
    const dbUser = await User.findOne({ email: req.user.email });
    if (!dbUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { syncEnabled, pushToGoogle } = req.body;
    const updates = {};
    if (syncEnabled !== undefined) updates['googleCalendar.syncEnabled'] = syncEnabled;
    if (pushToGoogle !== undefined) updates['googleCalendar.pushToGoogle'] = pushToGoogle;

    await User.findByIdAndUpdate(dbUser._id, { $set: updates });

    res.json({ success: true });
  } catch (err) {
    console.error('Google Calendar settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// POST /api/auth/google-calendar/register-watch — Manually (re-)register push notifications
router.post('/google-calendar/register-watch', verifyToken, async (req, res) => {
  try {
    const dbUser = await User.findOne({ email: req.user.email });
    if (!dbUser) return res.status(404).json({ error: 'User not found' });
    if (!dbUser.googleCalendar?.connected) return res.status(400).json({ error: 'Google Calendar not connected' });

    await stopWatch(dbUser._id).catch(() => {});
    const result = await registerWatch(dbUser._id);
    if (result) {
      res.json({ success: true, channelId: result.channelId, expiration: result.expiration });
    } else {
      res.status(500).json({ error: 'Failed to register watch. Check BACKEND_PUBLIC_URL and Google domain verification.' });
    }
  } catch (err) {
    console.error('[GCal] Manual watch registration error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webhooks/google-calendar — Google push notification receiver
router.post('/webhooks/google-calendar', async (req, res) => {
  // Always respond 200 immediately (Google retries on non-2xx)
  res.status(200).end();

  const channelId = req.headers['x-goog-channel-id'];
  const resourceState = req.headers['x-goog-resource-state'];
  const incomingToken = req.headers['x-goog-channel-token'];

  if (!channelId) return;

  // Initial sync handshake -- nothing to do
  if (resourceState === 'sync') {
    console.log(`[GCal Webhook] Sync handshake for channel ${channelId}`);
    return;
  }

  if (resourceState !== 'exists') return;

  try {
    const user = await User.findOne({ 'googleCalendar.watchChannelId': channelId });
    if (!user) {
      console.warn(`[GCal Webhook] No user found for channel ${channelId}`);
      return;
    }

    // Verify token
    if (user.googleCalendar.watchToken !== incomingToken) {
      console.warn(`[GCal Webhook] Token mismatch for channel ${channelId}`);
      return;
    }

    // Fetch this week's events
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const events = await fetchEventsForUser(user._id, weekStart.toISOString(), weekEnd.toISOString());
    if (!events) return;

    // Push to frontend via WebSocket
    const mongoId = user._id.toString();
    const socketId = global.userSockets?.[mongoId];
    if (socketId && req.io) {
      req.io.to(socketId).emit('gcal-events-updated', { events });
      console.log(`[GCal Webhook] Pushed ${events.length} events to user ${mongoId}`);
    } else {
      console.log(`[GCal Webhook] User ${mongoId} not connected via WebSocket, events cached via lastSyncAt`);
    }
  } catch (err) {
    console.error('[GCal Webhook] Error processing notification:', err.message);
  }
});

// Exported for use by the cron renewal job
router.registerWatch = registerWatch;
router.stopWatch = stopWatch;
router.getAuthenticatedClient = getAuthenticatedClient;

module.exports = router;
