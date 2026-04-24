/**
 * merge-legacy-adhoc-into-class-broadcast.js
 *
 * One-off migration. Moves messages from a legacy ad-hoc group conversation
 * (type='ad-hoc-group', classId=null) into the canonical class-broadcast
 * conversation (type='class-broadcast', groupId='grp_class_<classId>') for a
 * given class.
 *
 * Background:
 *   The first iteration of the "message this class" modal created threads
 *   keyed by a sha1 of participant auth0Ids (ad-hoc groups). The current
 *   iteration routes all class messages to a single per-class broadcast
 *   thread whose membership is synced from enrollment. Any thread that
 *   existed before the classId wiring is orphaned — we need to merge it.
 *
 * Usage:
 *   # Dry-run (default): discovers and prints candidates without modifying.
 *   node backend/scripts/merge-legacy-adhoc-into-class-broadcast.js \
 *     --class-id 69e18b8e726dd0e4b1a95926
 *
 *   # Apply the migration for an auto-discovered source:
 *   node backend/scripts/merge-legacy-adhoc-into-class-broadcast.js \
 *     --class-id 69e18b8e726dd0e4b1a95926 --apply
 *
 *   # Specify the source groupId explicitly (skip discovery):
 *   node backend/scripts/merge-legacy-adhoc-into-class-broadcast.js \
 *     --class-id 69e18b8e726dd0e4b1a95926 \
 *     --source-group-id grp_159f3d5c9481bf1823674415 \
 *     --apply
 *
 * Safety:
 *   - Dry-run by default; prints what would change without touching data.
 *   - Auto-discovery requires (a) same class name AND (b) every ad-hoc
 *     member is in the class roster (tutor + any ever-confirmed student).
 *     Use --source-group-id to force an exact source you've verified.
 *   - After merge, the source conversation row is deleted and a system
 *     message is posted in the class thread.
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const ClassModel = require('../models/Class');

function parseArgs(argv) {
  const out = { classId: null, sourceGroupId: null, apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--class-id') out.classId = argv[++i];
    else if (a === '--source-group-id') out.sourceGroupId = argv[++i];
    else if (a === '--apply') out.apply = true;
    else if (a === '--help' || a === '-h') {
      console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 40).join('\n'));
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const { classId, sourceGroupId, apply } = parseArgs(process.argv);

  if (!classId) {
    console.error('ERROR: --class-id <classId> is required');
    process.exit(1);
  }
  if (!mongoose.Types.ObjectId.isValid(classId)) {
    console.error(`ERROR: --class-id ${classId} is not a valid ObjectId`);
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI not set (looked in backend/config.env)');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN (pass --apply to write)'}`);

  const classDoc = await ClassModel.findById(classId);
  if (!classDoc) {
    console.error(`ERROR: class ${classId} not found`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Class: "${classDoc.name}" (${classDoc._id})`);

  const targetGroupId = `grp_class_${classDoc._id.toString()}`;
  const target = await Conversation.findOne({ groupId: targetGroupId });
  if (!target) {
    console.error(
      `ERROR: class-broadcast conversation ${targetGroupId} does not exist yet. ` +
      'Open the class thread at least once (or run syncClassConversation) to create it, then re-run.'
    );
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Target : ${target.groupId} (type=${target.type}, members=${target.members.length})`);

  const candidates = [];
  if (sourceGroupId) {
    const src = await Conversation.findOne({ groupId: sourceGroupId });
    if (!src) {
      console.error(`ERROR: --source-group-id ${sourceGroupId} not found`);
      await mongoose.disconnect();
      process.exit(1);
    }
    if (src.type !== 'ad-hoc-group') {
      console.error(`ERROR: --source-group-id ${sourceGroupId} is type=${src.type}, must be ad-hoc-group`);
      await mongoose.disconnect();
      process.exit(1);
    }
    candidates.push(src);
  } else {
    const rosterAuth0Ids = await getClassRosterAuth0Ids(classDoc);
    console.log(`Class roster (tutor + ever-confirmed students): ${rosterAuth0Ids.size} users`);

    const sameName = await Conversation.find({
      type: 'ad-hoc-group',
      name: classDoc.name,
    });
    console.log(`Found ${sameName.length} ad-hoc thread(s) named "${classDoc.name}"`);

    for (const conv of sameName) {
      const members = conv.members.map((m) => m.auth0Id);
      const outsiders = members.filter((id) => !rosterAuth0Ids.has(id));
      if (outsiders.length === 0) {
        candidates.push(conv);
      } else {
        console.log(
          `  · skipping ${conv.groupId}: ${outsiders.length} member(s) not in class roster (${outsiders.slice(0, 3).join(', ')}${outsiders.length > 3 ? ',…' : ''})`
        );
      }
    }
  }

  if (candidates.length === 0) {
    console.log('No candidates to merge. Exiting.');
    await mongoose.disconnect();
    return;
  }

  console.log(`\nCandidates (${candidates.length}):`);
  for (const src of candidates) {
    const count = await Message.countDocuments({ groupId: src.groupId });
    console.log(
      `  · ${src.groupId}  members=${src.members.length}  messages=${count}  lastMessageAt=${src.lastMessageAt ? src.lastMessageAt.toISOString() : 'none'}`
    );
  }

  if (!apply) {
    console.log('\nDry-run complete. Re-run with --apply to perform the merge.');
    await mongoose.disconnect();
    return;
  }

  for (const src of candidates) {
    console.log(`\nMerging ${src.groupId} → ${target.groupId}`);

    const updateResult = await Message.updateMany(
      { groupId: src.groupId },
      { $set: { groupId: target.groupId, conversationId: target.groupId } }
    );
    console.log(`  moved ${updateResult.modifiedCount} message(s)`);

    const newest = await Message.findOne({ groupId: target.groupId })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean();
    if (newest?.createdAt) {
      target.lastMessageAt = newest.createdAt;
    }

    const activeAuth0Ids = target.members.filter((m) => !m.leftAt).map((m) => m.auth0Id);
    const now = new Date();
    await Message.create({
      conversationId: target.groupId,
      senderId: 'system',
      isGroup: true,
      groupId: target.groupId,
      groupParticipants: activeAuth0Ids,
      groupName: target.name || classDoc.name || '',
      content: `Earlier messages for "${classDoc.name}" were merged into this class thread.`,
      type: 'system',
      isSystemMessage: true,
      readBy: [],
      createdAt: now,
    });
    target.lastMessageAt = now;
    await target.save();

    await Conversation.deleteOne({ _id: src._id });
    console.log(`  deleted legacy conversation row ${src.groupId}`);
  }

  console.log('\nDone.');
  await mongoose.disconnect();
}

async function getClassRosterAuth0Ids(classDoc) {
  const userIds = new Set();
  const tutorId = classDoc.tutorId && classDoc.tutorId._id ? classDoc.tutorId._id : classDoc.tutorId;
  if (tutorId) userIds.add(tutorId.toString());

  for (const s of classDoc.confirmedStudents || []) {
    const id = s && s._id ? s._id : s;
    if (id) userIds.add(id.toString());
  }
  for (const a of classDoc.appliedStudents || []) {
    const id = a && a.studentId ? (a.studentId._id || a.studentId) : null;
    if (id) userIds.add(id.toString());
  }
  for (const i of classDoc.invitedStudents || []) {
    const id = i && i.studentId ? (i.studentId._id || i.studentId) : (i && i._id ? i._id : i);
    if (id) userIds.add(id.toString());
  }

  const users = await User.find({ _id: { $in: Array.from(userIds) } }).select('auth0Id').lean();
  return new Set(users.map((u) => u.auth0Id).filter(Boolean));
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
