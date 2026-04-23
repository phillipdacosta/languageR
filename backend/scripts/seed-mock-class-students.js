/**
 * Seed the four mock class-attendee preview users used by the frontend
 * (`MOCK_CLASS_ATTENDEES_PREVIEW`). Running this makes the class-detail
 * "GOING" broadcast flow testable end-to-end even when a class has no real
 * confirmed students.
 *
 * Usage: `node backend/scripts/seed-mock-class-students.js`
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'config.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

const MOCK_STUDENTS = [
  {
    auth0Id: 'mock-student-sarah',
    email: 'mock-student-sarah@barnabi.test',
    firstName: 'Sarah',
    lastName: 'Chen',
    picture: 'https://i.pravatar.cc/128?img=47',
  },
  {
    auth0Id: 'mock-student-marcus',
    email: 'mock-student-marcus@barnabi.test',
    firstName: 'Marcus',
    lastName: 'Johnson',
    picture: 'https://i.pravatar.cc/128?img=12',
  },
  {
    auth0Id: 'mock-student-elena',
    email: 'mock-student-elena@barnabi.test',
    firstName: 'Elena',
    lastName: 'Vasquez',
    picture: 'https://i.pravatar.cc/128?img=45',
  },
  {
    auth0Id: 'mock-student-james',
    email: 'mock-student-james@barnabi.test',
    firstName: 'James',
    lastName: 'Okonkwo',
    picture: 'https://i.pravatar.cc/128?img=33',
  },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('✅ Connected');

  for (const s of MOCK_STUDENTS) {
    const name = `${s.firstName} ${s.lastName}`;
    const existing = await User.findOne({ auth0Id: s.auth0Id });
    if (existing) {
      console.log(`↪︎ ${s.auth0Id} already exists (${existing.email})`);
      continue;
    }
    await User.create({
      auth0Id: s.auth0Id,
      email: s.email,
      name,
      firstName: s.firstName,
      lastName: s.lastName,
      picture: s.picture,
      userType: 'student',
      emailVerified: true,
    });
    console.log(`✅ Created ${s.auth0Id} (${s.email})`);
  }

  await mongoose.disconnect();
  console.log('🏁 Done');
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
