/**
 * Broadcasts compact "class state changed" events to every subscriber in the
 * `class:${classId}` socket.io room. Every client viewing the class detail
 * page (web event-details, RN LessonDetailOverlay) subscribes to its class
 * room on mount and merges the patch into its local cache on each event —
 * no refetch round-trip required.
 *
 * Keep the payload shape small and stable: it is the wire contract between
 * backend and both clients. Any new field here must also be handled on both
 * clients' patch merge paths.
 *
 * Design notes:
 *  - We reload the class on every emit so the patch is always a consistent
 *    snapshot (no risk of callers passing stale partial state). This keeps
 *    emitter call sites trivial: `await emitClassStateChanged(req.io, id, { reason })`.
 *  - We project `confirmedStudents` and `studentPayments` to the minimal
 *    fields the UIs actually render, to keep the payload cheap on slow
 *    mobile networks and avoid leaking internal fields.
 *  - `version` uses the class document's `updatedAt` ISO so clients can drop
 *    out-of-order patches if a newer snapshot has already been applied.
 */

const Class = require('../models/Class');

/**
 * Reasons clients can distinguish to drive toasts / analytics. Purely
 * informational — the patch itself is self-describing. Add new values as
 * needed; keep them stable across releases.
 */
const REASONS = Object.freeze({
  studentEnrolled: 'student_enrolled',
  studentUnenrolled: 'student_unenrolled',
  studentRemoved: 'student_removed',
  studentInvited: 'student_invited',
  paymentStatusChanged: 'payment_status_changed',
  classCancelled: 'class_cancelled',
  classAutoCancelled: 'class_auto_cancelled',
  classUpdated: 'class_updated',
});

function toIdString(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return String(value._id || value.id || '');
  return String(value);
}

function formatPersonName(doc) {
  if (!doc || typeof doc !== 'object') return 'Student';
  const first = (doc.firstName || '').trim();
  const last = (doc.lastName || '').trim();
  if (first && last) return `${first} ${last.charAt(0)}.`;
  if (doc.name) return String(doc.name).trim();
  if (typeof doc.email === 'string' && doc.email.includes('@')) {
    return doc.email.split('@')[0];
  }
  return 'Student';
}

function projectConfirmedStudents(classDoc) {
  const list = Array.isArray(classDoc.confirmedStudents) ? classDoc.confirmedStudents : [];
  return list
    .map((raw) => {
      if (!raw) return null;
      const id = toIdString(raw);
      if (!id) return null;
      const picture = (typeof raw === 'object' && (raw.picture || raw.profilePicture)) || undefined;
      return {
        id,
        name: formatPersonName(raw),
        picture,
      };
    })
    .filter(Boolean);
}

function projectStudentPayments(classDoc) {
  const list = Array.isArray(classDoc.studentPayments) ? classDoc.studentPayments : [];
  const map = {};
  for (const payment of list) {
    if (!payment) continue;
    const sid = toIdString(payment.studentId);
    if (!sid) continue;
    map[sid] = payment.paymentStatus || 'pending';
  }
  return map;
}

/**
 * Build the compact state snapshot clients merge into their cache. Omits any
 * tutor-only or sensitive fields; keep this aligned with what web + RN
 * actually render on the class detail page.
 */
function buildStatePatch(classDoc) {
  return {
    /** Stripe-agnostic list the UI renders directly. */
    confirmedStudents: projectConfirmedStudents(classDoc),
    /** `{ [studentId]: 'pending' | 'authorized' | 'captured' | 'cancelled' | 'refunded' }` */
    studentPayments: projectStudentPayments(classDoc),
    capacity: classDoc.capacity ?? null,
    minStudents: classDoc.minStudents ?? null,
    flexibleMinimum: !!classDoc.flexibleMinimum,
    price: classDoc.price ?? null,
    status: classDoc.status || 'scheduled',
    cancelReason: classDoc.cancelReason || null,
  };
}

/**
 * Emit `class_state_changed` to every subscriber of `class:${classId}`.
 * Safe to call with a missing/null `io` — it just no-ops (useful for unit
 * tests and background jobs that may run without a socket server attached).
 *
 * @param {object} io   socket.io server instance (or null)
 * @param {string} classId class _id
 * @param {{ reason?: string, actorId?: string, classDoc?: object }} [meta]
 *   Optional metadata. Pass an already-loaded `classDoc` to skip the DB
 *   round-trip (useful inside request handlers that just saved the doc).
 * @returns {Promise<{ emitted: boolean, reason: string|null }>}
 */
async function emitClassStateChanged(io, classId, meta = {}) {
  if (!io || !classId) return { emitted: false, reason: null };
  const reason = meta.reason || REASONS.classUpdated;
  const room = `class:${String(classId)}`;

  try {
    const classDoc =
      meta.classDoc ||
      (await Class.findById(classId)
        .populate('confirmedStudents', 'name firstName lastName picture profilePicture email')
        .lean());

    if (!classDoc) return { emitted: false, reason };

    const payload = {
      classId: String(classDoc._id || classId),
      version: classDoc.updatedAt ? new Date(classDoc.updatedAt).toISOString() : null,
      reason,
      actorId: meta.actorId ? String(meta.actorId) : null,
      timestamp: new Date().toISOString(),
      state: buildStatePatch(classDoc),
    };

    io.to(room).emit('class_state_changed', payload);
    return { emitted: true, reason };
  } catch (err) {
    console.error('[classStateBroadcaster] Failed to emit:', err);
    return { emitted: false, reason };
  }
}

module.exports = {
  emitClassStateChanged,
  REASONS,
  /**
   * Exposed for unit tests and for sending an initial snapshot on `class:subscribe`.
   */
  buildStatePatch,
};
