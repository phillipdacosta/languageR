/**
 * Class-anchored group conversation sync.
 *
 * A class has ONE persistent `Conversation` (groupId = `grp_class_<classId>`).
 * This module reconciles that conversation's membership roster with the
 * authoritative source of truth — `Class.tutorId` + `Class.confirmedStudents` —
 * whenever enrollment changes (accept / decline / leave / tutor-removes /
 * auto-cancel / class deletion).
 *
 * Semantics (user choice: "option 2"):
 *   - Joiners append a new member row with `joinedAt = now` (or re-activate an
 *     existing row by clearing `leftAt` and resetting `joinedAt`). Per design,
 *     rejoiners DO NOT see history sent while they were gone — their read
 *     window starts fresh from the new join time.
 *   - Leavers keep their row but get `leftAt = now`. They see historical
 *     messages up to `leftAt` but receive no new ones.
 *   - Tutor is always an active member while the class exists.
 *
 * This module also emits system messages (join / leave / class-cancelled)
 * into the thread so everyone has a chronological trace of the roster changes.
 */

const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const ClassModel = require('../models/Class');
const { formatNameWithInitialListStyle } = require('../utils/nameFormatter');

/** List-style names in system messages (no period after initial — avoids "., "). */
const formatDisplayName = formatNameWithInitialListStyle;

/**
 * Build a snapshot of current class membership: the tutor + every confirmed
 * student, flattened to auth0Ids. Missing users are dropped silently — the
 * caller sees the effective set, not phantoms.
 */
async function resolveClassRoster(classDoc) {
  if (!classDoc) return { tutorAuth0Id: null, studentAuth0Ids: [] };

  const tutorId = classDoc.tutorId && classDoc.tutorId._id
    ? classDoc.tutorId._id
    : classDoc.tutorId;
  const studentIds = (classDoc.confirmedStudents || []).map((s) =>
    s && s._id ? s._id : s
  );

  const ids = [tutorId, ...studentIds].filter(Boolean);
  if (ids.length === 0) return { tutorAuth0Id: null, studentAuth0Ids: [] };

  const users = await User.find({ _id: { $in: ids } }).select('auth0Id _id').lean();
  const auth0Map = new Map();
  for (const u of users) {
    if (u && u.auth0Id) auth0Map.set(u._id.toString(), u.auth0Id);
  }

  const tutorAuth0Id = tutorId ? auth0Map.get(tutorId.toString()) || null : null;
  const studentAuth0Ids = studentIds
    .map((sid) => auth0Map.get(sid.toString()))
    .filter(Boolean);

  return { tutorAuth0Id, studentAuth0Ids };
}

/**
 * Post a system message into the group thread. Uses the existing `Message`
 * schema — `isSystemMessage: true`, `senderId: 'system'` — so the existing
 * rendering + read logic pick it up unchanged.
 *
 * `groupParticipants` here is the snapshot of ACTIVE members at the time of
 * the event, which is consistent with how regular messages are written.
 */
async function postSystemMessage(conv, { content, activeAuth0Ids }) {
  if (!conv || !content) return null;
  const now = new Date();
  const msg = await Message.create({
    conversationId: conv.groupId,
    senderId: 'system',
    isGroup: true,
    groupId: conv.groupId,
    groupParticipants: activeAuth0Ids || [],
    groupName: conv.name || '',
    content,
    type: 'system',
    isSystemMessage: true,
    readBy: [],
    createdAt: now
  });
  conv.lastMessageAt = now;
  await conv.save();
  return msg;
}

/**
 * Reconcile the class conversation's `members` with the current roster.
 *
 * Returns `{ conversation, joined, left, rejoined }` for the caller to
 * optionally emit websocket events. Safe to call repeatedly — it's a pure
 * idempotent merge.
 *
 * NOTE: We post ONE system message per roster delta (not one per user) to
 * keep the thread readable when bulk enrollment happens (eg. a tutor invites
 * 10 students at once via auto-accept).
 */
async function syncClassConversation(classIdOrDoc, options = {}) {
  const classDoc = typeof classIdOrDoc === 'string' || classIdOrDoc instanceof mongoose.Types.ObjectId
    ? await ClassModel.findById(classIdOrDoc).populate('tutorId confirmedStudents')
    : classIdOrDoc;
  if (!classDoc) return { conversation: null, joined: [], left: [], rejoined: [] };

  const conv = await Conversation.findOrCreateForClass(classDoc);

  const { tutorAuth0Id, studentAuth0Ids } = await resolveClassRoster(classDoc);
  const desiredActive = new Set([
    ...(tutorAuth0Id ? [tutorAuth0Id] : []),
    ...studentAuth0Ids
  ]);

  const now = new Date();
  const joined = [];
  const rejoined = [];
  const left = [];

  // Index existing members for O(1) lookup during merge.
  const byAuth0 = new Map(conv.members.map((m) => [m.auth0Id, m]));

  // Upsert each desired-active member.
  for (const auth0Id of desiredActive) {
    const role = auth0Id === tutorAuth0Id ? 'tutor' : 'student';
    const existing = byAuth0.get(auth0Id);
    if (!existing) {
      conv.members.push({ auth0Id, role, joinedAt: now, leftAt: null, lastReadAt: null });
      joined.push(auth0Id);
    } else if (existing.leftAt) {
      // Rejoin: reset visibility window. User will see messages from now forward only.
      existing.leftAt = null;
      existing.joinedAt = now;
      existing.lastReadAt = null;
      existing.role = role;
      rejoined.push(auth0Id);
    } else if (existing.role !== role) {
      // Role correction (e.g. tutor flipped — shouldn't happen in practice).
      existing.role = role;
    }
  }

  // Mark removed members as left (keep history access until leftAt).
  for (const m of conv.members) {
    if (!desiredActive.has(m.auth0Id) && !m.leftAt) {
      m.leftAt = now;
      left.push(m.auth0Id);
    }
  }

  await conv.save();

  // Emit a system message summarising the delta.
  if ((joined.length || left.length || rejoined.length) && !options.suppressSystemMessage) {
    const names = await namesFor([...joined, ...left, ...rejoined]);
    const pieces = [];
    if (joined.length) pieces.push(`${joinNames(joined, names)} joined the class`);
    if (rejoined.length) pieces.push(`${joinNames(rejoined, names)} rejoined the class`);
    if (left.length) pieces.push(`${joinNames(left, names)} left the class`);
    if (pieces.length) {
      const activeAuth0Ids = conv.members.filter((m) => !m.leftAt).map((m) => m.auth0Id);
      await postSystemMessage(conv, {
        content: pieces.join(' · '),
        activeAuth0Ids
      });
    }
  }

  return { conversation: conv, joined, left, rejoined };
}

async function namesFor(auth0Ids) {
  const unique = Array.from(new Set(auth0Ids || []));
  if (unique.length === 0) return new Map();
  const users = await User.find({ auth0Id: { $in: unique } }).lean();
  const map = new Map();
  for (const u of users) {
    map.set(u.auth0Id, formatDisplayName(u));
  }
  return map;
}

function joinNames(auth0Ids, nameMap) {
  const names = auth0Ids.map((id) => nameMap.get(id) || 'Someone');
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Mark every member as left. Used when a class is cancelled / deleted so the
 * thread freezes for everyone but remains readable as an archive.
 */
async function archiveClassConversation(classIdOrDoc, { reason = 'Class was cancelled.' } = {}) {
  const classDoc = typeof classIdOrDoc === 'string' || classIdOrDoc instanceof mongoose.Types.ObjectId
    ? await ClassModel.findById(classIdOrDoc)
    : classIdOrDoc;
  if (!classDoc) return null;

  const conv = await Conversation.findOne({ classId: classDoc._id });
  if (!conv) return null;

  const now = new Date();
  const stillActive = conv.members.filter((m) => !m.leftAt);
  if (stillActive.length === 0) return conv;

  for (const m of stillActive) m.leftAt = now;
  await conv.save();

  await postSystemMessage(conv, {
    content: reason,
    activeAuth0Ids: stillActive.map((m) => m.auth0Id)
  });

  return conv;
}

module.exports = {
  syncClassConversation,
  archiveClassConversation,
  postSystemMessage,
  resolveClassRoster
};
