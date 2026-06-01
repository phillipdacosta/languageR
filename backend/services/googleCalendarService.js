const { google } = require('googleapis');
const User = require('../models/User');
const Lesson = require('../models/Lesson');

// Lazy require to avoid circular dependency at module load time. The route
// module exports an in-memory cache invalidator we call whenever a Barnabi
// lesson's googleCalendarEventId changes — so the next /events fetch sees the
// new state immediately instead of waiting for the 60s cache TTL.
function invalidateBarnabiIdsCache(tutorId) {
  try {
    const gcalRoutes = require('../routes/googleCalendarAuth');
    if (typeof gcalRoutes.invalidateBarnabiIdsCache === 'function') {
      gcalRoutes.invalidateBarnabiIdsCache(tutorId);
    }
  } catch { /* invalidation is best-effort */ }
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

async function getAuthenticatedClient(userId) {
  const user = await User.findById(userId)
    .select('+googleCalendar.accessToken +googleCalendar.refreshToken +googleCalendar.tokenExpiry +googleCalendar.connected +googleCalendar.calendarId');

  if (!user) return null;
  const gcal = user.googleCalendar || {};
  if (!gcal.connected || !gcal.refreshToken) return null;

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: gcal.accessToken,
    refresh_token: gcal.refreshToken,
    expiry_date: gcal.tokenExpiry ? gcal.tokenExpiry.getTime() : null
  });

  const now = Date.now();
  const expiry = gcal.tokenExpiry ? gcal.tokenExpiry.getTime() : 0;
  if (now >= expiry - 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      await User.findByIdAndUpdate(userId, {
        'googleCalendar.accessToken': credentials.access_token,
        'googleCalendar.tokenExpiry': credentials.expiry_date ? new Date(credentials.expiry_date) : null
      });
      oauth2Client.setCredentials(credentials);
    } catch (err) {
      console.error('[GCal Service] Token refresh failed:', err.message);
      return null;
    }
  }

  return oauth2Client;
}

function formatDisplayName(user) {
  if (!user) return 'Student';
  if (user.firstName) {
    const last = user.lastName || '';
    return last ? `${user.firstName} ${last.charAt(0)}.` : user.firstName;
  }
  const name = user.name || '';
  if (!name || name.includes('@')) return 'Student';
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1].charAt(0)}.`;
  return parts[0] || 'Student';
}

async function pushLessonToGoogleCalendar(lesson) {
  try {
    const tutor = await User.findById(lesson.tutorId._id || lesson.tutorId);
    if (!tutor?.googleCalendar?.connected || !tutor?.googleCalendar?.pushToGoogle) {
      return null;
    }

    const oauth2Client = await getAuthenticatedClient(tutor._id);
    if (!oauth2Client) return null;

    const calendarId = tutor.googleCalendar.calendarId || 'primary';
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const student = await User.findById(lesson.studentId._id || lesson.studentId)
      .select('firstName lastName name');
    const studentName = formatDisplayName(student);
    const subject = lesson.subject || 'Language Lesson';
    const duration = lesson.duration || 50;

    const event = {
      summary: `Barnabi: ${subject} with ${studentName}`,
      description: `${duration}-minute ${lesson.isOfficeHours ? 'office hours' : 'lesson'} on Barnabi`,
      start: {
        dateTime: new Date(lesson.startTime).toISOString(),
        timeZone: tutor.profile?.timezone || 'UTC'
      },
      end: {
        dateTime: new Date(lesson.endTime).toISOString(),
        timeZone: tutor.profile?.timezone || 'UTC'
      },
      // Stamp our lesson id as a private extended property so we can later
      // identify (and safely clean up) Barnabi-authored events without relying
      // on the summary text — zero false positives against a tutor's own events.
      extendedProperties: {
        private: { barnabiLessonId: String(lesson._id) }
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 10 }
        ]
      }
    };

    const response = await calendar.events.insert({ calendarId, requestBody: event });
    const gcalEventId = response.data.id;

    await Lesson.findByIdAndUpdate(lesson._id, { googleCalendarEventId: gcalEventId });
    invalidateBarnabiIdsCache(tutor._id);
    console.log(`[GCal Service] Pushed lesson ${lesson._id} to Google Calendar as event ${gcalEventId}`);
    return gcalEventId;
  } catch (err) {
    console.error(`[GCal Service] Failed to push lesson ${lesson._id}:`, err.message);
    return null;
  }
}

async function removeLessonFromGoogleCalendar(lesson) {
  try {
    const lessonDoc = typeof lesson === 'string'
      ? await Lesson.findById(lesson)
      : lesson;

    if (!lessonDoc?.googleCalendarEventId) return;

    const tutor = await User.findById(lessonDoc.tutorId._id || lessonDoc.tutorId);
    if (!tutor?.googleCalendar?.connected) return;

    const oauth2Client = await getAuthenticatedClient(tutor._id);
    if (!oauth2Client) return;

    const calendarId = tutor.googleCalendar.calendarId || 'primary';
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    await calendar.events.delete({
      calendarId,
      eventId: lessonDoc.googleCalendarEventId
    });

    await Lesson.findByIdAndUpdate(lessonDoc._id, { googleCalendarEventId: null });
    invalidateBarnabiIdsCache(tutor._id);
    console.log(`[GCal Service] Removed event ${lessonDoc.googleCalendarEventId} for lesson ${lessonDoc._id}`);
  } catch (err) {
    if (err.code === 404 || err.code === 410) {
      const idToClear = lesson._id || lesson;
      await Lesson.findByIdAndUpdate(idToClear, { googleCalendarEventId: null });
      // We don't always have the tutorId here (lesson may be a string id) but
      // the TTL will catch it within 60s and any explicit fetch can refresh.
      const lessonDocAfter = typeof lesson === 'string' ? null : lesson;
      if (lessonDocAfter?.tutorId) {
        invalidateBarnabiIdsCache(lessonDocAfter.tutorId._id || lessonDocAfter.tutorId);
      }
      return;
    }
    console.error(`[GCal Service] Failed to remove event:`, err.message);
  }
}

async function updateLessonOnGoogleCalendar(lesson) {
  try {
    const lessonDoc = typeof lesson === 'string'
      ? await Lesson.findById(lesson).populate('tutorId', 'name firstName').populate('studentId', 'name firstName')
      : lesson;

    if (!lessonDoc?.googleCalendarEventId) {
      return pushLessonToGoogleCalendar(lessonDoc);
    }

    const tutor = await User.findById(lessonDoc.tutorId._id || lessonDoc.tutorId);
    if (!tutor?.googleCalendar?.connected || !tutor?.googleCalendar?.pushToGoogle) return;

    const oauth2Client = await getAuthenticatedClient(tutor._id);
    if (!oauth2Client) return;

    const calendarId = tutor.googleCalendar.calendarId || 'primary';
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const student = await User.findById(lessonDoc.studentId._id || lessonDoc.studentId)
      .select('firstName lastName name');
    const studentName = formatDisplayName(student);
    const subject = lessonDoc.subject || 'Language Lesson';
    const duration = lessonDoc.duration || 50;

    await calendar.events.update({
      calendarId,
      eventId: lessonDoc.googleCalendarEventId,
      requestBody: {
        summary: `Barnabi: ${subject} with ${studentName}`,
        description: `${duration}-minute ${lessonDoc.isOfficeHours ? 'office hours' : 'lesson'} on Barnabi`,
        start: {
          dateTime: new Date(lessonDoc.startTime).toISOString(),
          timeZone: tutor.profile?.timezone || 'UTC'
        },
        end: {
          dateTime: new Date(lessonDoc.endTime).toISOString(),
          timeZone: tutor.profile?.timezone || 'UTC'
        },
        // Backfill the private tag on legacy events as they get updated.
        extendedProperties: {
          private: { barnabiLessonId: String(lessonDoc._id) }
        }
      }
    });

    console.log(`[GCal Service] Updated event ${lessonDoc.googleCalendarEventId} for lesson ${lessonDoc._id}`);
  } catch (err) {
    if (err.code === 404 || err.code === 410) {
      return pushLessonToGoogleCalendar(lessonDoc);
    }
    console.error(`[GCal Service] Failed to update event:`, err.message);
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// True if a Google event was authored by Barnabi. Primary signal is the private
// extended property we stamp on push/update; legacy events fall back to our exact
// push format (summary "Barnabi: …" + the "on Barnabi" description marker).
function isBarnabiAuthoredEvent(evt) {
  if (evt?.extendedProperties?.private?.barnabiLessonId) return true;
  return /^Barnabi:\s/.test(evt?.summary || '') && /on Barnabi\b/.test(evt?.description || '');
}

// Delete Barnabi-authored Google events that no longer correspond to a live
// lesson (orphans). Used by the one-time backfill script and as a reusable
// reconciler. Paginates the window, is idempotent (404/410 swallowed), and
// throttles deletes to stay well under Google's per-user rate limits.
async function reconcileOrphansForUser(userId, opts = {}) {
  const {
    dryRun = false,
    daysBack = 90,
    daysForward = 180,
    maxDeletes = 1000,
    deleteSpacingMs = 120
  } = opts;

  const oauth2Client = await getAuthenticatedClient(userId);
  if (!oauth2Client) return { skipped: true, reason: 'not-connected' };

  const user = await User.findById(userId);
  const calendarId = user?.googleCalendar?.calendarId || 'primary';
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const now = Date.now();
  const timeMin = new Date(now - daysBack * 86400000).toISOString();
  const timeMax = new Date(now + daysForward * 86400000).toISOString();

  // Every Google event id currently referenced by one of this tutor's lessons.
  const linked = await Lesson.find({ tutorId: userId, googleCalendarEventId: { $ne: null } })
    .select('googleCalendarEventId').lean();
  const linkedIds = new Set(linked.map(l => l.googleCalendarEventId));

  let pageToken;
  let scanned = 0;
  let orphanCount = 0;
  let deleted = 0;

  do {
    const resp = await calendar.events.list({
      calendarId, timeMin, timeMax, singleEvents: true, maxResults: 250, pageToken
    });
    const items = resp.data.items || [];
    scanned += items.length;

    for (const evt of items) {
      if (evt.status === 'cancelled') continue;
      if (linkedIds.has(evt.id)) continue;        // backed by a live lesson — keep
      if (!isBarnabiAuthoredEvent(evt)) continue; // a genuine tutor event — never touch

      orphanCount++;
      if (deleted >= maxDeletes) continue;
      if (dryRun) {
        console.log(`[GCal Cleanup][dry-run] would delete ${evt.id} "${evt.summary}" @ ${evt.start?.dateTime || evt.start?.date}`);
        continue;
      }
      try {
        await calendar.events.delete({ calendarId, eventId: evt.id });
        deleted++;
        await sleep(deleteSpacingMs);
      } catch (err) {
        if (err.code === 404 || err.code === 410) continue; // already gone
        console.warn(`[GCal Cleanup] Failed to delete ${evt.id}: ${err.message}`);
      }
    }
    pageToken = resp.data.nextPageToken;
  } while (pageToken);

  return { scanned, orphanCount, deleted, dryRun };
}

module.exports = {
  pushLessonToGoogleCalendar,
  removeLessonFromGoogleCalendar,
  updateLessonOnGoogleCalendar,
  isBarnabiAuthoredEvent,
  reconcileOrphansForUser
};
