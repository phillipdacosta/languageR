const mongoose = require('mongoose');

/**
 * `Conversation` — membership registry for multi-party message threads.
 *
 * Every group thread (class-broadcast OR ad-hoc) has a single row in this
 * collection. It owns the authoritative list of **who is a member** and
 * **when** they joined / left, which lets us implement "option 2" semantics:
 *
 *   • Leavers stop receiving new messages but keep read access to messages
 *     they received while active (history window: [joinedAt, leftAt]).
 *   • Joiners only see messages sent on or after their `joinedAt` so late
 *     enrollees don't get the cohort's earlier chatter.
 *   • Rejoiners reset `joinedAt = now`, so their visibility window starts
 *     fresh and the gap while they were gone is invisible.
 *
 * Messages themselves still live in the `Message` collection keyed by
 * `groupId`; this model is purely the access-control + roster layer.
 *
 * Two variants:
 *  - `type: 'class-broadcast'`  → bound to a Class; `groupId = grp_class_<classId>`.
 *    Membership is synced from `Class.confirmedStudents` + tutor by
 *    `services/classConversation.syncClassConversation`.
 *  - `type: 'ad-hoc-group'`     → arbitrary audience; `groupId` is the sha1
 *    hash of sorted participant auth0Ids (backward compat with existing
 *    group threads created by the messaging modal outside of a class).
 *    Membership is immutable after creation.
 */

const memberSchema = new mongoose.Schema({
  auth0Id: { type: String, required: true, index: true },
  // Role gives us a trivially-queryable way to identify the class tutor —
  // used by `getConversations` to label the thread + by `syncClassConversation`
  // to keep the tutor pinned as an active member across roster changes.
  role: { type: String, enum: ['tutor', 'student', 'member'], default: 'member' },
  // Window of time during which this member receives / can read messages.
  // `leftAt == null` => currently active. On re-join we reset `joinedAt`.
  joinedAt: { type: Date, default: Date.now },
  leftAt: { type: Date, default: null },
  // Optional per-member read cursor; we still store `readBy` on Message for
  // backward compat with the current badge logic, but having a timestamp
  // here lets the conversations-list query compute unread counts without
  // scanning every historical message.
  lastReadAt: { type: Date, default: null },
  // Per-user inbox state, independent of roster (`leftAt`):
  //   • `archivedAt` — user moved the thread to their Archived folder. Hidden
  //     from the default inbox, visible under the Archived filter, still
  //     receives new messages. Reversible via unarchive.
  //   • `hiddenAt` — user permanently removed the thread from their UI.
  //     Combined with `leftAt = now` for groups, this also takes them off
  //     the active roster so no future messages are delivered. For class
  //     tutors we set only `hiddenAt` (never `leftAt`) — see route docs.
  archivedAt: { type: Date, default: null },
  hiddenAt: { type: Date, default: null }
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  // Stable string id shared with `Message.groupId` — this is the primary
  // lookup key from both frontend and backend. Kept as a String (not
  // ObjectId) so legacy ad-hoc threads can migrate without mutation.
  groupId: { type: String, required: true, unique: true, index: true },
  type: { type: String, enum: ['class-broadcast', 'ad-hoc-group'], required: true, index: true },
  // Class anchor — only set when `type === 'class-broadcast'`. Enforces one
  // conversation per class via the unique sparse index below.
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null },
  name: { type: String, default: '' },
  picture: { type: String, default: null },
  members: { type: [memberSchema], default: [] },
  /**
   * Timestamp of the most recent message in the thread — denormalized so
   * the conversations list can sort by activity without joining against
   * the messages collection.
   */
  lastMessageAt: { type: Date, default: null, index: true }
}, { timestamps: true });

// One conversation per class. Sparse so ad-hoc groups (classId=null) don't collide.
conversationSchema.index({ classId: 1 }, { unique: true, sparse: true });
// Fast lookup of "all conversations containing user X".
conversationSchema.index({ 'members.auth0Id': 1 });

/**
 * Find-or-create the class-broadcast conversation for a class. Idempotent.
 * Does NOT sync membership — caller is expected to follow up with
 * `syncClassConversation` or push members explicitly.
 */
conversationSchema.statics.findOrCreateForClass = async function findOrCreateForClass(classDoc) {
  if (!classDoc || !classDoc._id) throw new Error('findOrCreateForClass: classDoc required');
  const groupId = `grp_class_${classDoc._id.toString()}`;
  let conv = await this.findOne({ classId: classDoc._id });
  if (conv) return conv;
  conv = await this.create({
    groupId,
    type: 'class-broadcast',
    classId: classDoc._id,
    name: classDoc.name || '',
    picture: classDoc.thumbnail || null,
    members: []
  });
  return conv;
};

/**
 * Resolve a member row by auth0Id. Returns `null` when the user has never
 * been part of the conversation — callers use this to enforce access checks.
 */
conversationSchema.methods.getMember = function getMember(auth0Id) {
  if (!auth0Id) return null;
  return this.members.find((m) => m.auth0Id === auth0Id) || null;
};

/**
 * True if the user can currently send messages (active membership, not
 * archived for them).
 */
conversationSchema.methods.isActiveMember = function isActiveMember(auth0Id) {
  const m = this.getMember(auth0Id);
  return !!(m && !m.leftAt);
};

module.exports = mongoose.model('Conversation', conversationSchema);
