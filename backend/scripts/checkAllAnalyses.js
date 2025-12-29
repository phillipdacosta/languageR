/**
 * Check for ANY analyses in the database (not just for these two users)
 */

require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const LessonAnalysis = require('../models/LessonAnalysis');
const LessonTranscript = require('../models/LessonTranscript');

async function checkAllAnalyses() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Find ALL transcripts
    const allTranscripts = await LessonTranscript.find({}).sort({ startTime: -1 }).limit(10);
    console.log(`🎙️ Found ${allTranscripts.length} total transcripts (showing last 10):`);
    allTranscripts.forEach((t, i) => {
      console.log(`   ${i + 1}. ${t._id}`);
      console.log(`      Lesson: ${t.lessonId}`);
      console.log(`      Student: ${t.studentId}`);
      console.log(`      Tutor: ${t.tutorId}`);
      console.log(`      Status: ${t.status}`);
      console.log(`      Segments: ${t.segments.length}`);
      console.log(`      Language: ${t.language}`);
      console.log('');
    });
    
    // Find ALL analyses
    const allAnalyses = await LessonAnalysis.find({}).sort({ createdAt: -1 }).limit(10);
    console.log(`\n🤖 Found ${allAnalyses.length} total analyses (showing last 10):`);
    allAnalyses.forEach((a, i) => {
      console.log(`   ${i + 1}. ${a._id}`);
      console.log(`      Lesson: ${a.lessonId}`);
      console.log(`      Student: ${a.studentId}`);
      console.log(`      Tutor: ${a.tutorId}`);
      console.log(`      Status: ${a.status}`);
      console.log(`      Date: ${a.lessonDate}`);
      if (a.status === 'completed' && a.overallAssessment) {
        console.log(`      Proficiency: ${a.overallAssessment.proficiencyLevel}`);
        console.log(`      Summary: ${a.overallAssessment.summary?.substring(0, 100)}...`);
      }
      if (a.error) {
        console.log(`      Error: ${a.error}`);
      }
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the script
checkAllAnalyses();



