/**
 * Re-adds the tutor (phillip.dacosta@gmail.com) to a conversation
 * where they were removed, so they can access messages again.
 *
 * Usage:
 *   node scripts/readd-tutor-to-conversation.js [--conversationId <id>] [--apply]
 *
 * Default conversationId: 69e18b8e726dd0e4b1a95928
 * Without --apply this is a dry-run (no writes).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'config.env') });
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const User = require('../models/User');

const TUTOR_EMAIL = 'phillip.dacosta@gmail.com';
const DEFAULT_CONV_ID = '69e18b8e726dd0e4b1a95928';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const convIdxArg = args.indexOf('--conversationId');
  const convId = convIdxArg !== -1 ? args[convIdxArg + 1] : DEFAULT_CONV_ID;

  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI not set (looked in backend/config.env)');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  console.log(`Mode: ${apply ? 'APPLY (writing changes)' : 'DRY-RUN (pass --apply to write)'}`);
  console.log(`Conversation _id: ${convId}`);

  // Look up tutor
  const tutor = await User.findOne({ email: TUTOR_EMAIL });
  if (!tutor) {
    console.error(`Tutor not found: ${TUTOR_EMAIL}`);
    process.exit(1);
  }
  const tutorAuth0Id = tutor.auth0Id || `dev-user-${TUTOR_EMAIL}`;
  console.log(`Tutor: ${tutor.name} (${TUTOR_EMAIL})`);
  console.log(`Tutor auth0Id: ${tutorAuth0Id}`);
  console.log(`Tutor _id: ${tutor._id}`);

  // Look up conversation
  const conv = await Conversation.findById(convId);
  if (!conv) {
    console.error(`Conversation not found with _id: ${convId}`);
    console.log('\nHint: Try finding by groupId instead:');
    const allConvs = await Conversation.find({}, { groupId: 1, type: 1, name: 1, 'members.auth0Id': 1, 'members.leftAt': 1 }).limit(20);
    allConvs.forEach(c => {
      console.log(`  _id=${c._id}  groupId=${c.groupId}  type=${c.type}  name="${c.name}"  members=${c.members.length}`);
    });
    process.exit(1);
  }

  console.log(`\nConversation found:`);
  console.log(`  groupId: ${conv.groupId}`);
  console.log(`  type: ${conv.type}`);
  console.log(`  name: "${conv.name}"`);
  console.log(`  members (${conv.members.length}):`);
  conv.members.forEach(m => {
    console.log(`    ${m.auth0Id}  role=${m.role}  leftAt=${m.leftAt || 'null (active)'}`);
  });

  const existing = conv.members.find(m => m.auth0Id === tutorAuth0Id);

  if (existing && !existing.leftAt) {
    console.log(`\n✅ Tutor is already an active member. No changes needed.`);
    await mongoose.connection.close();
    return;
  }

  if (existing && existing.leftAt) {
    console.log(`\nTutor has leftAt set (${existing.leftAt}). Will clear leftAt and reset joinedAt.`);
    if (apply) {
      await Conversation.updateOne(
        { _id: conv._id, 'members.auth0Id': tutorAuth0Id },
        { $set: { 'members.$.leftAt': null, 'members.$.joinedAt': new Date(), 'members.$.role': 'tutor' } }
      );
      console.log('✅ Tutor re-activated in conversation.');
    } else {
      console.log('[DRY-RUN] Would clear leftAt and set role=tutor for existing member entry.');
    }
  } else {
    console.log(`\nTutor not in members list at all. Will add as role=tutor.`);
    if (apply) {
      await Conversation.updateOne(
        { _id: conv._id },
        {
          $push: {
            members: {
              auth0Id: tutorAuth0Id,
              role: 'tutor',
              joinedAt: new Date(),
              leftAt: null,
              lastReadAt: null
            }
          }
        }
      );
      console.log('✅ Tutor added to conversation.');
    } else {
      console.log('[DRY-RUN] Would push new member entry with role=tutor.');
    }
  }

  if (apply) {
    const updated = await Conversation.findById(convId);
    console.log('\nUpdated members:');
    updated.members.forEach(m => {
      console.log(`  ${m.auth0Id}  role=${m.role}  leftAt=${m.leftAt || 'null (active)'}`);
    });
  } else {
    console.log('\nRe-run with --apply to commit changes.');
  }

  await mongoose.connection.close();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
