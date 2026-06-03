/**
 * Shared policy for outstanding tutor feedback (AI-off lessons).
 *
 * Graduated enforcement — a single missed note should cost visibility, not a
 * tutor's livelihood:
 *   • 0..(THRESHOLD-1) lifetime grace violations → "soft" state: the tutor keeps
 *     receiving bookings and stays searchable, but is deprioritized in search
 *     ranking and gets escalating reminders.
 *   • >= THRESHOLD lifetime grace violations → "hard" state: while they have any
 *     overdue pending feedback, they are blocked from new bookings and hidden
 *     from discovery search.
 *
 * Existing students are never affected — they reach a tutor via messaging /
 * rebooking, not the discovery surfaces gated here.
 */

// Time after a lesson ends before its missing feedback counts against the tutor.
const FEEDBACK_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Lifetime grace violations at which a tutor moves from "soft" to "hard" state.
const HIDE_VIOLATION_THRESHOLD = 3;

/**
 * Read a tutor's lifetime grace-violation count from a User doc/lean object.
 * @param {object} tutor
 * @returns {number}
 */
function getViolationCount(tutor) {
  return tutor?.stats?.feedbackMetrics?.feedbackGraceViolations || 0;
}

/**
 * Decide whether a single tutor should be hard-blocked from new bookings.
 * Hard-block requires BOTH a repeat-offender history (>= threshold lifetime
 * violations) AND at least one currently-overdue pending feedback item.
 *
 * @param {object} tutor - User doc/lean with _id, auth0Id, stats.feedbackMetrics
 * @returns {Promise<{ blocked: boolean, pendingCount: number, violations: number }>}
 */
async function evaluateBookingBlock(tutor) {
  const violations = getViolationCount(tutor);
  if (violations < HIDE_VIOLATION_THRESHOLD) {
    return { blocked: false, pendingCount: 0, violations };
  }

  const TutorFeedback = require('../models/TutorFeedback');
  const pendingCount = await TutorFeedback.countDocuments({
    $or: [
      { tutorId: tutor._id },
      { tutorId: tutor.auth0Id }
    ],
    status: 'pending',
    required: { $ne: false },
    createdAt: { $lt: new Date(Date.now() - FEEDBACK_GRACE_MS) }
  });

  return { blocked: pendingCount > 0, pendingCount, violations };
}

module.exports = {
  FEEDBACK_GRACE_MS,
  HIDE_VIOLATION_THRESHOLD,
  getViolationCount,
  evaluateBookingBlock,
};
