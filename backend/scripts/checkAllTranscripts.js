require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const LessonTranscript = require('../models/LessonTranscript');

async function check() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    const transcripts = await LessonTranscript.find({})
      .sort({ startTime: -1 })
      .limit(5);
    
    console.log(`Found ${transcripts.length} transcripts:\n`);
    
    transcripts.forEach((t, i) => {
      const studentSegs = t.segments.filter(s => s.speaker === 'student');
      const tutorSegs = t.segments.filter(s => s.speaker === 'tutor');
      
      console.log(`${i + 1}. Transcript ${t._id}`);
      console.log(`   Lesson: ${t.lessonId}`);
      console.log(`   Status: ${t.status}`);
      console.log(`   Language: ${t.language}`);
      console.log(`   Total Segments: ${t.segments.length}`);
      console.log(`   Student Segments: ${studentSegs.length}`);
      console.log(`   Tutor Segments: ${tutorSegs.length}`);
      console.log(`   Started: ${t.startTime.toISOString()}`);
      console.log(`   Ended: ${t.endTime?.toISOString() || 'Not ended'}`);
      
      if (studentSegs.length > 0) {
        console.log(`   Student speech samples:`);
        studentSegs.slice(0, 3).forEach((seg, j) => {
          console.log(`      ${j + 1}. "${seg.text}"`);
        });
      } else {
        console.log(`   ⚠️  NO STUDENT SPEECH CAPTURED!`);
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

check();
