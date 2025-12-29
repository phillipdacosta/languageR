require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const Lesson = require('../models/Lesson');
const LessonAnalysis = require('../models/LessonAnalysis');
const User = require('../models/User');

async function check() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Get the upcoming lesson
    const upcomingLesson = await Lesson.findById('692cd128f17b81b3acb3215c');
    
    if (!upcomingLesson) {
      console.log('❌ Lesson not found');
      return;
    }
    
    console.log('📚 Upcoming Lesson:');
    console.log(`   Student ID: ${upcomingLesson.studentId}`);
    console.log(`   Tutor ID: ${upcomingLesson.tutorId}`);
    console.log(`   Has Notes: ${!!upcomingLesson.notes}\n`);
    
    // Check for completed analysis
    const analysis = await LessonAnalysis.findOne({
      status: 'completed'
    }).sort({ lessonDate: -1 });
    
    if (analysis) {
      console.log('🤖 Found completed analysis:');
      console.log(`   For lesson: ${analysis.lessonId}`);
      console.log(`   Proficiency: ${analysis.overallAssessment?.proficiencyLevel || 'N/A'}`);
      console.log(`\n   This analysis belongs to a previous lesson.`);
      console.log(`   The system should auto-populate notes for matching student-tutor pairs.`);
    } else {
      console.log('❌ No completed analysis found');
      console.log('\n💡 To see the "View Notes" button:');
      console.log('   1. Complete a lesson with transcription enabled');
      console.log('   2. AI will analyze the lesson');
      console.log('   3. System will auto-populate notes for next lesson');
      console.log('   4. "View Notes" button will appear');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

check();
