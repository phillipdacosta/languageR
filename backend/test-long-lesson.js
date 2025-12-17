const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const User = require('./models/User');
const LessonTranscript = require('./models/LessonTranscript');
const LessonAnalysis = require('./models/LessonAnalysis');
const { analyzeLessonTranscript } = require('./services/aiService');

async function testLongLesson() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Simulate a 25-minute lesson by repeating the short transcript multiple times
    const lessonId = '692e0679d780ecd16c06d5d5';
    const transcript = await LessonTranscript.findOne({ lessonId });
    
    if (!transcript) {
      console.error('❌ Transcript not found');
      process.exit(1);
    }
    
    // Create a simulated long lesson (repeat segments to simulate 25 minutes)
    const originalSegments = transcript.segments.filter(s => s.speaker === 'student');
    const longStudentSegments = [];
    
    // Repeat 25 times to simulate ~25 minutes of speech
    for (let i = 0; i < 25; i++) {
      originalSegments.forEach(seg => {
        longStudentSegments.push({
          ...seg,
          text: seg.text,
          timestamp: new Date(Date.now() + i * 60000) // Space out over time
        });
      });
    }
    
    const tutorSegments = transcript.segments.filter(s => s.speaker === 'tutor');
    
    const wordCount = longStudentSegments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
    
    console.log('\n📊 SIMULATED LONG LESSON:');
    console.log(`   Student segments: ${longStudentSegments.length}`);
    console.log(`   Total words: ${wordCount}`);
    console.log(`   Estimated duration: ~25 minutes\n`);
    
    // Get previous analyses
    const previousAnalyses = await LessonAnalysis.find({
      studentId: transcript.studentId,
      tutorId: transcript.tutorId,
      lessonDate: { $lt: transcript.startTime },
      status: 'completed'
    })
    .sort({ lessonDate: -1 })
    .limit(3);
    
    console.log('🤖 Running analysis with intelligent sampling...\n');
    
    const startTime = Date.now();
    
    // Run analysis
    const result = await analyzeLessonTranscript({
      transcript: [...longStudentSegments, ...tutorSegments],
      language: transcript.language,
      studentSegments: longStudentSegments,
      tutorSegments,
      previousAnalyses
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n✅ ANALYSIS COMPLETE\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`⏱️  Processing time: ${duration}s`);
    
    if (result._samplingNote) {
      console.log(`\n📊 SAMPLING INFO:`);
      console.log(`   Original words: ${result._samplingNote.originalWords.toLocaleString()}`);
      console.log(`   Sampled words: ${result._samplingNote.sampledWords.toLocaleString()}`);
      console.log(`   Reduction: ${result._samplingNote.reductionPercent}%`);
      console.log(`   Strategy: ${result._samplingNote.strategy}`);
    }
    
    console.log('\n📝 STUDENT SUMMARY:');
    console.log(result.studentSummary);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testLongLesson();


