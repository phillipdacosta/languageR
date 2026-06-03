/**
 * Escalating reminder job for outstanding tutor feedback (AI-off lessons).
 *
 * The initial nudge is sent once when a lesson finalizes (autoFinalizeLessons).
 * This job follows up on items that remain pending past the grace window, with
 * an escalating cadence and a hard cap, using the `remindersSent` /
 * `lastReminderAt` fields on TutorFeedback so we never spam.
 */
const TutorFeedback = require('../models/TutorFeedback');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { FEEDBACK_GRACE_MS } = require('../utils/feedbackPolicy');
const { getReminderMessage } = require('../utils/feedbackMessages');

// Hours to wait since the last reminder (or since the item became overdue)
// before sending the next reminder. Array length = max follow-up reminders.
const REMINDER_INTERVALS_HRS = [6, 24, 72];
const MAX_REMINDERS = REMINDER_INTERVALS_HRS.length;

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

async function resolveUser(idOrAuth0) {
  if (!idOrAuth0) return null;
  const key = String(idOrAuth0);
  if (OBJECT_ID_RE.test(key)) {
    const byId = await User.findById(key).select('_id auth0Id firstName name picture').lean();
    if (byId) return byId;
  }
  return User.findOne({ auth0Id: key }).select('_id auth0Id firstName name picture').lean();
}

async function sendFeedbackReminders() {
  const now = Date.now();
  const graceDeadline = new Date(now - FEEDBACK_GRACE_MS);

  const candidates = await TutorFeedback.find({
    status: 'pending',
    required: { $ne: false },
    createdAt: { $lt: graceDeadline },
    remindersSent: { $lt: MAX_REMINDERS }
  }).lean();

  if (!candidates.length) return;

  let io = null;
  try { io = require('../server').getIO(); } catch (_) { /* io optional */ }

  let sent = 0;
  for (const fb of candidates) {
    const sentCount = fb.remindersSent || 0;
    const intervalHrs = REMINDER_INTERVALS_HRS[sentCount];
    if (intervalHrs === undefined) continue;

    const since = fb.lastReminderAt
      ? new Date(fb.lastReminderAt).getTime()
      : new Date(fb.createdAt).getTime();
    if (now - since < intervalHrs * 60 * 60 * 1000) continue;

    const tutor = await resolveUser(fb.tutorId);
    if (!tutor) continue;
    const student = await resolveUser(fb.studentId);
    const studentName = student?.firstName || student?.name?.split(' ')[0] || 'your student';

    const msg = getReminderMessage(sentCount);
    try {
      await Notification.create({
        userId: tutor._id,
        type: 'feedback_reminder',
        title: msg.title,
        message: msg.message,
        relatedUserPicture: student?.picture || null,
        data: {
          lessonId: String(fb.lessonId),
          action: 'add_note',
          studentName
        }
      });

      if (io && tutor.auth0Id) {
        io.to(`user:${tutor.auth0Id}`).emit('feedback_reminder', {
          lessonId: String(fb.lessonId),
          studentName
        });
      }

      await TutorFeedback.updateOne(
        { _id: fb._id },
        { $inc: { remindersSent: 1 }, $set: { lastReminderAt: new Date() } }
      );
      sent++;
    } catch (err) {
      console.error(`⚠️ [FeedbackReminders] Failed reminder for feedback ${fb._id}:`, err.message);
    }
  }

  if (sent > 0) {
    console.log(`📬 [FeedbackReminders] Sent ${sent} escalating reminder(s)`);
  }
}

module.exports = { sendFeedbackReminders };
