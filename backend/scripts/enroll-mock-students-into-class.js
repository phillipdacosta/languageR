/**
 * enroll-mock-students-into-class.js
 *
 * Adds the four mock class-attendee preview users (seeded by
 * `seed-mock-class-students.js`) to a class's `confirmedStudents` roster so
 * the class-broadcast thread picks them up when `syncClassConversation`
 * runs.
 *
 * Intended for local / staging test setup — not production.
 *
 * Usage:
 *   # Make sure mock users exist:
 *   node backend/scripts/seed-mock-class-students.js
 *
 *   # Dry-run (default):
 *   node backend/scripts/enroll-mock-students-into-class.js --class-id <classId>
 *
 *   # Apply:
 *   node backend/scripts/enroll-mock-students-into-class.js --class-id <classId> --apply
 *
 *   # Also re-sync the class-broadcast roster immediately (no need to open the
 *   # thread first to trigger it):
 *   node backend/scripts/enroll-mock-students-into-class.js --class-id <classId> --apply --sync
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const User = require('../models/User');
const ClassModel = require('../models/Class');
const { syncClassConversation } = require('../services/classConversation');

const MOCK_AUTH0_IDS = [
  'mock-student-sarah',
  'mock-student-marcus',
  'mock-student-elena',
  'mock-student-james',
];

function parseArgs(argv) {
  const out = { classId: null, apply: false, sync: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--class-id') out.classId = argv[++i];
    else if (a === '--apply') out.apply = true;
    else if (a === '--sync') out.sync = true;
  }
  return out;
}

async function main() {
  const { classId, apply, sync } = parseArgs(process.argv);
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
  console.log(`Class: "${classDoc.name}" (${classDoc._id}) capacity=${classDoc.capacity}`);

  const mockUsers = await User.find({ auth0Id: { $in: MOCK_AUTH0_IDS } }).select('_id auth0Id firstName lastName').lean();
  if (mockUsers.length === 0) {
    console.error('ERROR: no mock users found. Run `node backend/scripts/seed-mock-class-students.js` first.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Found ${mockUsers.length} mock user(s):`);
  for (const u of mockUsers) {
    console.log(`  · ${u.auth0Id} (${u._id})`);
  }

  const existing = new Set((classDoc.confirmedStudents || []).map((id) => id.toString()));
  const toAdd = mockUsers.filter((u) => !existing.has(u._id.toString()));

  console.log(`\nAlready confirmed: ${existing.size}`);
  console.log(`Will add:          ${toAdd.length}`);
  for (const u of toAdd) {
    console.log(`  + ${u.auth0Id}`);
  }

  if (toAdd.length === 0) {
    console.log('\nNothing to add.');
    if (sync && apply) {
      console.log('Still running syncClassConversation because --sync was set.');
      const { conversation } = await syncClassConversation(classDoc);
      console.log(`  conversation: ${conversation?.groupId || 'none'} (active members=${(conversation?.members || []).filter((m) => !m.leftAt).length})`);
    }
    await mongoose.disconnect();
    return;
  }

  if (!apply) {
    console.log('\nDry-run complete. Re-run with --apply to enroll.');
    await mongoose.disconnect();
    return;
  }

  classDoc.confirmedStudents = [
    ...(classDoc.confirmedStudents || []),
    ...toAdd.map((u) => u._id),
  ];
  if (typeof classDoc.capacity === 'number' && classDoc.capacity < classDoc.confirmedStudents.length) {
    console.log(
      `  bumping capacity ${classDoc.capacity} → ${classDoc.confirmedStudents.length} to fit the new roster`
    );
    classDoc.capacity = classDoc.confirmedStudents.length;
  }
  await classDoc.save();
  console.log(`  class roster now has ${classDoc.confirmedStudents.length} confirmed student(s)`);

  if (sync) {
    const populated = await ClassModel.findById(classDoc._id).populate('tutorId confirmedStudents');
    const { conversation } = await syncClassConversation(populated);
    const active = (conversation?.members || []).filter((m) => !m.leftAt).length;
    console.log(`  syncClassConversation: ${conversation?.groupId || 'none'} (active members=${active})`);
  }

  console.log('\nDone.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Enroll failed:', err);
  process.exit(1);
});
