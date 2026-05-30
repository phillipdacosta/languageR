const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const User = require('../models/User');
const Lesson = require('../models/Lesson');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const crypto = require('crypto');

const webhookDebounceTimers = new Map();

// OAuth state is signed (HMAC) and self-contained rather than stored in process
// memory. The old in-memory `pendingStates` Map broke in production whenever the
// `/url` request and Google's `/callback` redirect were handled by different
// processes — which happens routinely on Render with multiple instances, a
// redeploy, or an OOM auto-restart — yielding a consistent `invalid_state`
// failure even on a fully warm server. A signed state survives all of those.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function getStateSecret() {
  return process.env.OAUTH_STATE_SECRET
    || process.env.GOOGLE_OAUTH_CLIENT_SECRET
    || 'insecure-dev-oauth-state-secret';
}

function signOAuthState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getStateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyOAuthState(state) {
  if (!state || typeof state !== 'string' || !state.includes('.')) {
    console.error('[GCal State] Rejected: missing/malformed state param');
    return null;
  }
  const [body, sig] = state.split('.');
  if (!body || !sig) {
    console.error('[GCal State] Rejected: state not in body.sig form');
    return null;
  }

  const expected = crypto.createHmac('sha256', getStateSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    // A signature mismatch almost always means the host that SIGNED the state
    // (the one serving /url, i.e. the frontend's apiUrl host) and the host
    // VERIFYING it here (GOOGLE_CALENDAR_REDIRECT_URI host) use different
    // GOOGLE_OAUTH_CLIENT_SECRET / OAUTH_STATE_SECRET values, or are different
    // deployments entirely. Make sure both ends are the same Render service.
    console.error('[GCal State] Rejected: HMAC signature mismatch (secret differs between the /url host and this /callback host?)');
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (_) {
    console.error('[GCal State] Rejected: payload not valid JSON');
    return null;
  }

  if (!payload || !payload.userId || !payload.iat) {
    console.error('[GCal State] Rejected: payload missing userId/iat');
    return null;
  }
  if (Date.now() - payload.iat > OAUTH_STATE_TTL_MS) {
    console.error('[GCal State] Rejected: state expired (older than TTL)');
    return null;
  }
  return payload;
}

// Per-tutor cache of Google event IDs that came from Barnabi-pushed lessons.
// We use this to filter pushed lessons out of the gcal events list (so a Barnabi
// booking doesn't appear twice on the calendar). Hitting the Lesson collection
// on every fetch is wasteful — at scale a tutor may make many fetches per minute
// (poll + navigation + websocket signal). 60s TTL is a good balance: brand-new
// bookings show within a minute, but steady-state load on Mongo drops by ~99%.
const BARNABI_IDS_TTL_MS = 60 * 1000;
const barnabiIdsCache = new Map(); // userId -> { ids: Set<string>, expiresAt: number }

async function getBarnabiEventIds(userId) {
  const cacheKey = userId.toString();
  const cached = barnabiIdsCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.ids;

  const lessons = await Lesson.find({
    tutorId: userId,
    googleCalendarEventId: { $ne: null }
  }).select('googleCalendarEventId').lean();
  const ids = new Set(lessons.map(l => l.googleCalendarEventId));
  barnabiIdsCache.set(cacheKey, { ids, expiresAt: now + BARNABI_IDS_TTL_MS });
  return ids;
}

// Called when a Barnabi lesson is created/updated/deleted so the next fetch
// sees the change immediately (don't wait for TTL). Exported below.
function invalidateBarnabiIdsCache(userId) {
  if (!userId) return;
  barnabiIdsCache.delete(userId.toString());
}

// Periodic GC so the cache doesn't grow unbounded for inactive tutors.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of barnabiIdsCache) {
    if (v.expiresAt <= now) barnabiIdsCache.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email'
];

function buildCallbackHtml(success, error, origin) {
  const payload = success
    ? JSON.stringify({ type: 'google_calendar_linked', success: true })
    : JSON.stringify({ type: 'google_calendar_linked', success: false, error: error || 'unknown' });
  let message;
  let detail = 'You can close this window now.';
  if (success) {
    message = 'Google Calendar connected!';
  } else if (error === 'calendar_scope_not_granted') {
    message = 'Calendar permission is required.';
    detail = 'Please reconnect and check the calendar checkboxes on the Google consent screen.';
  } else {
    message = 'Google Calendar connection failed.';
  }

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
  <p>${detail}</p>
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
    const state = signOAuthState({ userId: dbUser._id.toString(), iat: Date.now() });

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

    const stateData = verifyOAuthState(state);
    if (!stateData) return sendError('invalid_state');

    const userId = stateData.userId;
    const oauth2Client = getOAuth2Client();

    let tokens;
    try {
      ({ tokens } = await oauth2Client.getToken(code));
    } catch (tokenErr) {
      // Google's real reason lives in tokenErr.response.data (e.g.
      // "redirect_uri_mismatch" → the redirect URI here is not registered on
      // this OAuth client, or "invalid_grant" → code already used/expired).
      console.error('[GCal Callback] Token exchange failed.', {
        redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI || '(derived default)',
        callbackHost: req.headers['x-forwarded-host'] || req.headers.host,
        googleError: tokenErr?.response?.data || tokenErr?.message
      });
      return sendError('auth_failed');
    }
    oauth2Client.setCredentials(tokens);

    const grantedScopes = (tokens.scope || '').split(/\s+/).filter(Boolean);
    const hasCalendarScope = grantedScopes.some(s =>
      s === 'https://www.googleapis.com/auth/calendar.readonly' ||
      s === 'https://www.googleapis.com/auth/calendar.events' ||
      s === 'https://www.googleapis.com/auth/calendar'
    );
    console.log('[GCal Callback] Granted scopes:', grantedScopes);
    if (!hasCalendarScope) {
      console.error('[GCal Callback] Calendar scope NOT granted. User must check calendar boxes on consent screen.');
      return sendError('calendar_scope_not_granted');
    }

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfoRes = await oauth2.userinfo.get();
    const googleEmail = userInfoRes.data.email;

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
      'googleCalendar.lastSyncAt': null,
      'googleCalendar.grantedScopes': grantedScopes
    });

    if (req.io) {
      req.io.to(`mongo:${userId}`).emit('gcal-status-updated', {
        connected: true,
        email: googleEmail
      });
    }

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

    if (req.io) {
      req.io.to(`mongo:${dbUser._id}`).emit('gcal-status-updated', { connected: false });
    }

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
      // Only force-disconnect when Google has *actually* revoked the grant.
      // For transient errors (network blip, 5xx, rate limit, clock skew) we leave
      // `connected: true` so the next call / cron can retry — silently flipping
      // tutors to disconnected used to strand them with no further refresh attempts.
      const errorBody = refreshErr.response?.data?.error || refreshErr.data?.error;
      const errorMessage = (refreshErr.message || '').toLowerCase();
      const grantRevoked =
        errorBody === 'invalid_grant' ||
        errorBody === 'invalid_client' ||
        errorMessage.includes('invalid_grant') ||
        errorMessage.includes('token has been expired or revoked');

      if (grantRevoked) {
        console.error('[GCal Auth] Refresh token revoked, marking disconnected:', refreshErr.message);
        await User.findByIdAndUpdate(userId, {
          'googleCalendar.connected': false,
          'googleCalendar.watchChannelId': null,
          'googleCalendar.watchResourceId': null,
          'googleCalendar.watchExpiration': null,
          'googleCalendar.watchToken': null
        });
      } else {
        console.warn('[GCal Auth] Transient token refresh failure (not disconnecting):', refreshErr.message);
      }
      return null;
    }
  }

  return oauth2Client;
}

// Register a Google Calendar watch channel for push notifications
async function registerWatch(userId) {
  const rawBackendUrl = process.env.BACKEND_PUBLIC_URL;
  if (!rawBackendUrl) {
    console.log('[GCal Watch] BACKEND_PUBLIC_URL not set, skipping watch registration (local dev)');
    return null;
  }

  const backendUrl = rawBackendUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(backendUrl)) {
    console.error(`[GCal Watch] BACKEND_PUBLIC_URL must be HTTPS, got "${rawBackendUrl}"`);
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
    const previousChannelId = user?.googleCalendar?.watchChannelId || null;
    const previousResourceId = user?.googleCalendar?.watchResourceId || null;
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

    // Stop the now-orphaned previous channel so Google isn't sending duplicate
    // notifications. Fire-and-forget — failure here doesn't matter, the channel
    // will expire on its own within 7 days.
    if (previousChannelId && previousResourceId && previousChannelId !== channelId) {
      stopChannelById(userId, previousChannelId, previousResourceId).catch(() => {});
    }

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

// Stop a specific channel by id without mutating the user's stored watch fields.
// Used after a successful renewal where the stored fields already point at the
// new channel — we just want Google to drop the previous (now-orphaned) channel.
async function stopChannelById(userId, channelId, resourceId) {
  if (!channelId || !resourceId) return;
  try {
    const oauth2Client = await getAuthenticatedClient(userId);
    if (!oauth2Client) return;
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await calendar.channels.stop({ requestBody: { id: channelId, resourceId } });
    console.log(`[GCal Watch] Stopped replaced channel ${channelId} for user ${userId}`);
  } catch (err) {
    // Channel may already be gone (404/410) — safe to ignore.
    if (err.code !== 404 && err.code !== 410) {
      console.warn(`[GCal Watch] Failed to stop replaced channel ${channelId}:`, err.message);
    }
  }
}

// Fetch events for a user (reusable by both the API endpoint and the webhook handler)
async function fetchEventsForUser(userId, timeMin, timeMax) {
  const oauth2Client = await getAuthenticatedClient(userId);
  if (!oauth2Client) return null;

  const user = await User.findById(userId);
  const calendarId = user?.googleCalendar?.calendarId || 'primary';
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Get Google Calendar event IDs that were pushed from Barnabi lessons so we
  // can exclude them (avoid showing duplicates of Barnabi lessons). Cached per
  // tutor with a 60s TTL — invalidated explicitly when lessons change.
  const barnabiEventIds = await getBarnabiEventIds(userId);

  const response = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250
  });

  const rawCount = (response.data.items || []).length;
  const allMapped = (response.data.items || []).map(evt => ({
    id: evt.id,
    summary: evt.summary || '(No title)',
    start: evt.start?.dateTime || evt.start?.date,
    end: evt.end?.dateTime || evt.end?.date,
    allDay: !evt.start?.dateTime,
    status: evt.status,
    updated: evt.updated
  }));
  const events = allMapped.filter(evt => evt.status !== 'cancelled' && !barnabiEventIds.has(evt.id));

  // Diagnostic: log a compact summary so we can see exactly what Google returned
  // for a given window and which events were dropped by our filters. Helps debug
  // "I added an event in Google Calendar but Barnabi doesn't show it" reports.
  const dropped = allMapped.length - events.length;
  console.log(
    `[GCal Fetch] user=${userId} cal=${calendarId} window=${timeMin}..${timeMax} ` +
    `raw=${rawCount} kept=${events.length} dropped=${dropped} ` +
    `titles=${JSON.stringify(events.slice(0, 6).map(e => `${e.summary}@${e.start}${e.allDay ? ' [allDay]' : ''}`))}`
  );

  await User.findByIdAndUpdate(userId, { 'googleCalendar.lastSyncAt': new Date() });
  return events;
}

// GET /api/auth/google-calendar/events — Fetch events for a date range
router.get('/google-calendar/events', verifyToken, async (req, res) => {
  try {
    // Force fresh responses — Express's default weak ETag would let the browser
    // 304-cache stale data when Google's events.list happens to return the same
    // payload twice in a row (which masks "I just added an event but it's not
    // showing" bugs). Always return 200 with the full body.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

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

// GET /api/auth/google-calendar/debug-scopes — Inspect granted scopes on saved token
router.get('/google-calendar/debug-scopes', verifyToken, async (req, res) => {
  try {
    const dbUser = await User.findOne({ email: req.user.email })
      .select('+googleCalendar.accessToken +googleCalendar.refreshToken +googleCalendar.tokenExpiry +googleCalendar.connected googleCalendar.grantedScopes googleCalendar.email');
    if (!dbUser) return res.status(404).json({ error: 'User not found' });

    const gcal = dbUser.googleCalendar || {};
    const _rawB = process.env.BACKEND_PUBLIC_URL;
    const _backendBase = _rawB ? _rawB.trim().replace(/\/+$/, '') : null;
    const _watch = {
      backendPublicUrlSet: Boolean(_backendBase),
      webhookUrl: _backendBase ? `${_backendBase}/api/webhooks/google-calendar` : null,
      channelId: gcal.watchChannelId || null,
      resourceId: gcal.watchResourceId || null,
      watchExpiration: gcal.watchExpiration || null,
      watchActive: Boolean(
        gcal.watchChannelId && gcal.watchExpiration && new Date(gcal.watchExpiration) > new Date()
      )
    };
    if (!gcal.accessToken) {
      return res.json({
        connected: gcal.connected || false,
        email: gcal.email || null,
        savedGrantedScopes: gcal.grantedScopes || null,
        liveScopes: null,
        note: 'No access token stored.',
        watch: _watch
      });
    }

    let liveScopes = null;
    let liveError = null;
    try {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(gcal.accessToken)}`);
      const data = await r.json();
      liveScopes = (data?.scope || '').split(/\s+/).filter(Boolean);
      if (data?.error) liveError = data.error_description || data.error;
    } catch (e) {
      liveError = e.message;
    }

    res.json({
      connected: gcal.connected || false,
      email: gcal.email || null,
      tokenExpiry: gcal.tokenExpiry || null,
      savedGrantedScopes: gcal.grantedScopes || null,
      liveScopes,
      liveError,
      hasCalendarScope: (liveScopes || []).some(s =>
        s === 'https://www.googleapis.com/auth/calendar.readonly' ||
        s === 'https://www.googleapis.com/auth/calendar.events' ||
        s === 'https://www.googleapis.com/auth/calendar'
      ),
      watch: _watch
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/google-calendar/watch-diagnostics — same watch fields as debug-scopes; safe for quick browser check
router.get('/google-calendar/watch-diagnostics', verifyToken, async (req, res) => {
  try {
    const dbUser = await User.findOne({ email: req.user.email });
    if (!dbUser) return res.status(404).json({ error: 'User not found' });
    const g = dbUser.googleCalendar || {};
    const raw = process.env.BACKEND_PUBLIC_URL;
    const backendBase = raw ? raw.trim().replace(/\/+$/, '') : null;
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({
      connected: g.connected || false,
      email: g.email || null,
      backendPublicUrlSet: Boolean(backendBase),
      webhookUrl: backendBase ? `${backendBase}/api/webhooks/google-calendar` : null,
      channelId: g.watchChannelId || null,
      watchExpiration: g.watchExpiration || null,
      watchActive: Boolean(
        g.watchChannelId && g.watchExpiration && new Date(g.watchExpiration) > new Date()
      )
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/google-calendar/register-watch — Manually (re-)register push notifications
router.post('/google-calendar/register-watch', verifyToken, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');

    const dbUser = await User.findOne({ email: req.user.email });
    if (!dbUser) return res.status(404).json({ error: 'User not found' });
    if (!dbUser.googleCalendar?.connected) return res.status(400).json({ error: 'Google Calendar not connected' });

    // registerWatch now overwrites stored fields and stops the prior channel
    // itself on success — never strand the user with no watch on a transient failure.
    const result = await registerWatch(dbUser._id);
    if (!result) {
      return res.status(500).json({ error: 'Failed to register watch. Check BACKEND_PUBLIC_URL and Google domain verification.' });
    }

    res.json({ success: true, channelId: result.channelId, expiration: result.expiration });
  } catch (err) {
    console.error('[GCal] Manual watch registration error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Debounced per-user webhook processing: batches rapid Google notifications
// into a single fetch + push (Google often sends multiple webhooks within seconds)
const WEBHOOK_DEBOUNCE_MS = 2000;

async function processWebhookForUser(userId, io) {
  try {
    // We emit a lightweight "something changed" signal instead of fetching events
    // ourselves. The server doesn't know which window the client is viewing —
    // pushing events for the *current* week would wipe out future-week events
    // the client may be displaying. The client refetches its own visible window.
    const room = `mongo:${userId.toString()}`;
    if (io) {
      io.to(room).emit('gcal-changed', { userId: userId.toString(), at: Date.now() });
      console.log(`[GCal Webhook] Notified room ${room} of calendar change`);
    }

    // Refresh lastSyncAt so the UI's "last synced" hint stays current even when
    // the client isn't actively viewing the calendar.
    await User.findByIdAndUpdate(userId, { 'googleCalendar.lastSyncAt': new Date() });
  } catch (err) {
    console.error(`[GCal Webhook] Error processing for user ${userId}:`, err.message);
  }
}

// POST /api/webhooks/google-calendar — Google push notification receiver
router.post('/webhooks/google-calendar', async (req, res) => {
  res.status(200).end();

  const channelId = req.headers['x-goog-channel-id'];
  const resourceState = req.headers['x-goog-resource-state'];
  const incomingToken = req.headers['x-goog-channel-token'];

  if (!channelId) return;

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

    if (user.googleCalendar.watchToken !== incomingToken) {
      console.warn(`[GCal Webhook] Token mismatch for channel ${channelId}`);
      return;
    }

    const mongoId = user._id.toString();

    // Debounce: if another webhook arrives for the same user within the window,
    // cancel the pending fetch and restart the timer (only one API call fires)
    if (webhookDebounceTimers.has(mongoId)) {
      clearTimeout(webhookDebounceTimers.get(mongoId));
    }

    webhookDebounceTimers.set(mongoId, setTimeout(() => {
      webhookDebounceTimers.delete(mongoId);
      processWebhookForUser(user._id, req.io);
    }, WEBHOOK_DEBOUNCE_MS));

  } catch (err) {
    console.error('[GCal Webhook] Error processing notification:', err.message);
  }
});

// Exported for use by the cron renewal job and the lesson lifecycle (cache invalidation)
router.registerWatch = registerWatch;
router.stopWatch = stopWatch;
router.getAuthenticatedClient = getAuthenticatedClient;
router.invalidateBarnabiIdsCache = invalidateBarnabiIdsCache;

module.exports = router;
