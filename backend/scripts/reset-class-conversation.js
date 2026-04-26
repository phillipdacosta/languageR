/**
 * reset-class-conversation.js
 *
 * Deletes the class-broadcast `Conversation` row for a class along with
 * every `Message` in that thread. The next time anyone opens the class
 * thread, `syncClassConversation` will recreate it from scratch using the
 * current `Class.confirmedStudents` roster.
 *
 * Intended for local / staging test resets — not production.
 *
 * Usage:
 *   # Dry-run (default):
 *   node backend/scripts/reset-class-conversation.js --class-id <classId>
 *
 *   # Actually delete:
 *   node backend/scripts/reset-class-conversation.js --class-id <classId> --apply
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

function parseArgs(argv) {
  const out = { classId: null, apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--class-id') out.classId = argv[++i];
    else if (a === '--apply') out.apply = true;
  }
  return out;
}

async function main() {
  const { classId, apply } = parseArgs(process.argv);
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

  const groupId = `grp_class_${classId}`;
  const conv = await Conversation.findOne({ groupId });
  const messageCount = await Message.countDocuments({ groupId });

  console.log(`\nTarget: ${groupId}`);
  console.log(`  Conversation row: ${conv ? 'exists' : 'none'}`);
  console.log(`  Messages:         ${messageCount}`);

  if (!conv && messageCount === 0) {
    console.log('\nNothing to delete.');
    await mongoose.disconnect();
    return;
  }

  if (!apply) {
    console.log('\nDry-run. Re-run with --apply to delete.');
    await mongoose.disconnect();
    return;
  }

  if (messageCount > 0) {
    const { deletedCount } = await Message.deleteMany({ groupId });
    console.log(`  deleted ${deletedCount} message(s)`);
  }
  if (conv) {
    await Conversation.deleteOne({ _id: conv._id });
    console.log(`  deleted conversation row ${groupId}`);
  }

  console.log('\nDone. Reopen the class to recreate the thread from current roster.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
