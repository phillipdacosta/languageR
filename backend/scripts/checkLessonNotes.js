require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const Lesson = require('../models/Lesson');

async function checkNotes() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    const now = new Date();
    
    // Find upcoming lessons
    const upcomingLessons = await Lesson.find({
      startTime: { $gt: now },
      status: { $ne: 'cancelled' }
    })
    .sort({ startTime: 1 })
    .limit(5);
    
    console.log(`📚 Found ${upcomingLessons.length} upcoming lessons:\n`);
    
    upcomingLessons.forEach((lesson, i) => {
      console.log(`${i + 1}. Lesson ID: ${lesson._id}`);
      console.log(`   Subject: ${lesson.subject}`);
      console.log(`   Start: ${lesson.startTime.toISOString()}`);
      console.log(`   Has Notes: ${!!lesson.notes}`);
      if (lesson.notes) {
        console.log(`   Notes Preview: ${lesson.notes.substring(0, 100)}...`);
      }
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

checkNotes();
