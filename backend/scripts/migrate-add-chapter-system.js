/**
 * Migration: Backfill chapter fields on existing LearningPlan documents.
 *
 * For each plan missing chapterIndex/chapterLevel/chapterTheme:
 *   - chapterIndex inferred from selfAssessedLevel (advanced → 4 = C1, etc.)
 *   - chapterLevel & chapterTheme derived from chapterIndex
 *   - chaptersCompleted initialized to []
 *   - calibrationLockedAt set to today if the plan already has ≥ 5 lessons total
 *     (so existing established students aren't subject to surprise demotions)
 *   - decayWarnings = 0, demotionEvents = []
 *
 * Idempotent — running twice is safe.
 *
 * Usage: node scripts/migrate-add-chapter-system.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../config.env') });
const mongoose = require('mongoose');
const LearningPlan = require('../models/LearningPlan');
const {
  chapterIndexForSelfAssessedLevel,
  levelForChapterIndex,
  themeForChapterIndex
} = require('../services/chapterConstants');

async function run() {
  console.log('Starting chapter-system migration...');
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  console.log('Connected.');

  const plans = await LearningPlan.find({
    $or: [
      { chapterIndex: { $exists: false } },
      { chapterLevel: { $exists: false } },
      { chapterTheme: { $exists: false } }
    ]
  });
  console.log(`Found ${plans.length} plans needing migration.`);

  let updated = 0;
  for (const plan of plans) {
    const idx = chapterIndexForSelfAssessedLevel(plan.selfAssessedLevel);
    plan.chapterIndex = plan.chapterIndex ?? idx;
    plan.chapterLevel = plan.chapterLevel || levelForChapterIndex(plan.chapterIndex);
    plan.chapterTheme = plan.chapterTheme || themeForChapterIndex(plan.chapterIndex);
    if (!Array.isArray(plan.chaptersCompleted)) plan.chaptersCompleted = [];
    plan.decayWarnings = plan.decayWarnings || 0;
    if (!Array.isArray(plan.demotionEvents)) plan.demotionEvents = [];

    // Lock calibration for established plans so we don't surprise-promote/demote them.
    const totalLessons = (plan.phases || []).reduce((sum, p) => sum + (p.lessonsCompleted || 0), 0);
    if (totalLessons >= 5 && !plan.calibrationLockedAt) {
      plan.calibrationLockedAt = new Date();
    }

    await plan.save();
    updated++;
  }

  console.log(`Migrated ${updated} plans.`);
  process.exit(0);
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
