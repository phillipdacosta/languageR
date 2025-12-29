const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const LessonTranscript = require('./models/LessonTranscript');
const LessonAnalysis = require('./models/LessonAnalysis');
const { analyzeLessonTranscript } = require('./services/aiService');

async function testEnhancedAnalysis() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Get the most recent transcript
    const transcriptId = '692e00fdd780ecd16c06c495';
    const transcript = await LessonTranscript.findById(transcriptId);
    
    if (!transcript) {
      console.error('❌ Transcript not found');
      process.exit(1);
    }
    
    console.log('📋 Testing enhanced analysis for lesson:', transcript.lessonId);
    console.log('🎯 Language:', transcript.language);
    console.log('📊 Total segments:', transcript.segments.length);
    
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
    
    console.log('👨‍🎓 Student segments:', studentSegments.length);
    console.log('👨‍🏫 Tutor segments:', tutorSegments.length);
    
    console.log('\n🤖 Starting enhanced analysis...\n');
    
    // Run the enhanced analysis
    const result = await analyzeLessonTranscript({
      transcript: transcript.segments,
      language: transcript.language,
      studentSegments,
      tutorSegments,
      previousAnalyses
    });
    
    console.log('\n✅ ENHANCED ANALYSIS RESULTS:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n📊 OVERALL ASSESSMENT:');
    console.log('Level:', result.overallAssessment.proficiencyLevel);
    console.log('Summary:', result.overallAssessment.summary);
    console.log('\n📈 PROGRESS FROM LAST LESSON:');
    console.log(result.overallAssessment.progressFromLastLesson);
    console.log('\n📝 TOPICS DISCUSSED:');
    result.topicsDiscussed.forEach((topic, i) => console.log(`${i+1}. ${topic}`));
    console.log('\n✏️  HOMEWORK SUGGESTIONS:');
    result.homeworkSuggestions.forEach((hw, i) => console.log(`${i+1}. ${hw}`));
    console.log('\n💬 STUDENT SUMMARY:');
    console.log(result.studentSummary);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    console.log('\n✅ Test complete! The analysis should now be much more specific and personalized.');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testEnhancedAnalysis();



