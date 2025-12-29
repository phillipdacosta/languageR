const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const User = require('./models/User');
const LessonTranscript = require('./models/LessonTranscript');
const LessonAnalysis = require('./models/LessonAnalysis');
const { analyzeLessonTranscript } = require('./services/aiService');

async function reanalyzeLesson() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const lessonId = '692e0679d780ecd16c06d5d5';
    const transcript = await LessonTranscript.findOne({ lessonId });
    
    if (!transcript) {
      console.error('❌ Transcript not found');
      process.exit(1);
    }
    
    console.log('📋 Re-analyzing lesson with ENHANCED prompts:', lessonId);
    console.log('🎯 Language:', transcript.language);
    
    // Get previous analyses for context
    const previousAnalyses = await LessonAnalysis.find({
      studentId: transcript.studentId,
      tutorId: transcript.tutorId,
      lessonDate: { $lt: transcript.startTime },
      status: 'completed'
    })
    .sort({ lessonDate: -1 })
    .limit(3);
    
    console.log('📚 Previous analyses found:', previousAnalyses.length);
    
    // Separate student and tutor segments
    const studentSegments = transcript.segments.filter(s => s.speaker === 'student');
    const tutorSegments = transcript.segments.filter(s => s.speaker === 'tutor');
    
    console.log('Student said:', studentSegments.map(s => s.text).join(' '));
    
    console.log('\n🤖 Running enhanced analysis with new prompts...\n');
    
    // Run the enhanced analysis
    const result = await analyzeLessonTranscript({
      transcript: transcript.segments,
      language: transcript.language,
      studentSegments,
      tutorSegments,
      previousAnalyses
    });
    
    // Update the existing analysis
    await LessonAnalysis.findOneAndUpdate(
      { lessonId },
      {
        ...result,
        status: 'completed',
        processingTime: Date.now()
      },
      { upsert: true, new: true, overwrite: true }
    );
    
    console.log('\n✅ UPDATED ANALYSIS:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n📊 OVERALL ASSESSMENT:');
    console.log('Summary:', result.overallAssessment.summary);
    console.log('\n📈 PROGRESS FROM LAST LESSON:');
    console.log(result.overallAssessment.progressFromLastLesson);
    console.log('\n📝 TOPICS DISCUSSED:');
    result.topicsDiscussed.forEach((topic, i) => console.log(`${i+1}. ${topic}`));
    console.log('\n✏️  HOMEWORK:');
    result.homeworkSuggestions.forEach((hw, i) => console.log(`${i+1}. ${hw}`));
    console.log('\n💬 STUDENT SUMMARY:');
    console.log(result.studentSummary);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    console.log('\n✅ Analysis updated! Refresh the page to see the enhanced version.');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

reanalyzeLesson();



