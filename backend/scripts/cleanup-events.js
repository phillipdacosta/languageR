#!/usr/bin/env node
/*
  Cleanup script: delete Lessons, Classes, and class-type availability blocks
  on or after a cutoff date.

  Usage:
    node scripts/cleanup-events.js 2025-11-03 [--apply]

  - First argument: ISO date (YYYY-MM-DD) interpreted as midnight UTC cutoff.
  - Without --apply, script runs in dry-run mode and prints counts only.
*/

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'config.env') });

const mongoose = require('mongoose');
const Lesson = require('../models/Lesson');
const ClassModel = require('../models/Class');
const User = require('../models/User');

async function main() {
  const [,, dateArg, applyFlag] = process.argv;
  if (!dateArg) {
    console.error('Please provide cutoff date, e.g. 2025-11-03');
    process.exit(1);
  }
  const apply = applyFlag === '--apply';
  const cutoff = new Date(dateArg + 'T00:00:00.000Z');
  if (isNaN(cutoff.getTime())) {
    console.error('Invalid cutoff date:', dateArg);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  console.log('Cutoff (UTC):', cutoff.toISOString());
  console\.log\([\s\S]*?\);apply ? 'Mode: APPLY (will delete)' : 'Mode: DRY-RUN (no changes)');

  // Lessons
  const lessonQuery = { startTime: { $gte: cutoff } };
  const lessonCount = await Lesson.countDocuments(lessonQuery);
  console.log(`Lessons to delete: ${lessonCount}`);
  if (apply && lessonCount > 0) {
    const res = await Lesson.deleteMany(lessonQuery);
    console.log('Lessons deleted:', res.deletedCount);
  }

  // Classes
  const classQuery = { startTime: { $gte: cutoff } };
  const classCount = await ClassModel.countDocuments(classQuery);
  console.log(`Classes to delete: ${classCount}`);
  if (apply && classCount > 0) {
    const res = await ClassModel.deleteMany(classQuery);
    console.log('Classes deleted:', res.deletedCount);
  }

  // Users: remove class-type availability blocks on/after cutoff
  const users = await User.find({});
  let usersModified = 0;
  let totalBlocksRemoved = 0;
  for (const user of users) {
    const before = Array.isArray(user.availability) ? user.availability.length : 0;
    if (!before) continue;
    const filtered = [];
    for (const block of user.availability) {
      let keep = true;
      if (block && block.type === 'class') {
        // 1) Remove any class block with absoluteStart on/after cutoff
        if (block.absoluteStart) {
          const d = new Date(block.absoluteStart);
          if (!isNaN(d.getTime()) && d.getTime() >= cutoff.getTime()) {
            keep = false;
          }
        }
        // 2) If it references a class that no longer exists, remove it regardless of date
        if (keep && block.id) {
          const exists = await ClassModel.exists({ _id: block.id });
          if (!exists) keep = false;
        }
      }
      if (keep) filtered.push(block);
    }
    const removed = before - filtered.length;
    if (removed > 0) {
      usersModified++;
      totalBlocksRemoved += removed;
      if (apply) {
        user.availability = filtered;
        await user.save();
      }
    }
  }
  console.log(`Users modified: ${usersModified}`);
  console.log(`Class availability blocks removed: ${totalBlocksRemoved}`);

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


