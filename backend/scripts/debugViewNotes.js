require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const Lesson = require('../models/Lesson');

async function debug() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    const now = new Date();
    console.log('Current time:', now.toISOString());
    console.log('');
    
    // Check all lessons for this student-tutor pair
    const lessons = await Lesson.find({
      studentId: '6919f3f278696a2e5fd7b794',
      tutorId: '692b88b4b1ed13b61bbe0b13'
    }).sort({ startTime: -1 }).limit(5);
    
    console.log(`Found ${lessons.length} lessons for this student-tutor pair:\n`);
    
    lessons.forEach((lesson, i) => {
      const isPast = new Date(lesson.startTime) < now;
      const isFuture = new Date(lesson.startTime) > now;
      
      console.log(`${i + 1}. Lesson ${lesson._id}`);
      console.log(`   Subject: ${lesson.subject}`);
      console.log(`   Start: ${lesson.startTime.toISOString()}`);
      console.log(`   Status: ${lesson.status}`);
      console.log(`   Time: ${isPast ? 'PAST' : isFuture ? 'FUTURE' : 'NOW'}`);
      console.log(`   Has Notes: ${!!lesson.notes ? 'YES ✅' : 'NO ❌'}`);
      if (lesson.notes) {
        console.log(`   Notes length: ${lesson.notes.length} characters`);
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

debug();
