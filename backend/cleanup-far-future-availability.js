require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const User = require('./models/User');

const MAX_YEAR_OFFSET = 5; // anything more than 5 years out is a sentinel

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const tutors = await User.find({ userType: 'tutor', 'availability.0': { $exists: true } }).select('_id email availability');
  const maxYear = new Date().getFullYear() + MAX_YEAR_OFFSET;
  let totalRemoved = 0;
  let touchedTutors = 0;
  for (const t of tutors) {
    const before = t.availability.length;
    t.availability = t.availability.filter(b => {
      const probe = b?.absoluteStart ? new Date(b.absoluteStart) : null;
      if (probe && probe.getUTCFullYear() > maxYear) {
        console.log(`removing block ${b.id} (${b.type}) absoluteStart=${probe.toISOString()} from ${t.email}`);
        return false;
      }
      return true;
    });
    if (t.availability.length !== before) {
      totalRemoved += before - t.availability.length;
      touchedTutors += 1;
      await t.save();
    }
  }
  console.log(`Done. Removed ${totalRemoved} sentinel blocks across ${touchedTutors} tutors.`);
  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
