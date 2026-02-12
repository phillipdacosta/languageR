/**
 * Run evaluateTutorForBadge directly for "Phillip Dacosta" and check what happens.
 */

require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const User = require('./models/User');
    const { evaluateTutorForBadge } = require('./jobs/evaluateCoachingBadges');

    const tutor = await User.findOne({ 
      email: 'phillip.dacosta@gmail.com',
      userType: 'tutor'
    });

    if (!tutor) {
      console.log('❌ Tutor not found');
      process.exit(1);
    }

    console.log('=== BEFORE EVALUATION ===');
    console.log('stats.feedbackMetrics:', JSON.stringify(tutor.stats?.feedbackMetrics, null, 2));

    console.log('\n=== RUNNING evaluateTutorForBadge... ===');
    const result = await evaluateTutorForBadge(tutor);
    console.log('Result:', JSON.stringify(result, null, 2));

    console.log('\n=== AFTER EVALUATION (in-memory) ===');
    console.log('stats.feedbackMetrics:', JSON.stringify(tutor.stats?.feedbackMetrics, null, 2));

    // Re-fetch from DB to see if it actually saved
    const tutorRefreshed = await User.findById(tutor._id);
    console.log('\n=== AFTER EVALUATION (re-fetched from DB) ===');
    console.log('stats.feedbackMetrics:', JSON.stringify(tutorRefreshed.stats?.feedbackMetrics, null, 2));

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();


