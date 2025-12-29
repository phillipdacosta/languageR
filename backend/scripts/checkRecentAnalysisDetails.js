require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const LessonAnalysis = require('../models/LessonAnalysis');
const LessonTranscript = require('../models/LessonTranscript');
const Lesson = require('../models/Lesson');

async function check() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Get the most recent analysis
    const latestAnalysis = await LessonAnalysis.findOne({
      status: 'completed'
    }).sort({ createdAt: -1 });
    
    if (!latestAnalysis) {
      console.log('No analyses found');
      return;
    }
    
    console.log('📊 MOST RECENT ANALYSIS:');
    console.log(`   Analysis ID: ${latestAnalysis._id}`);
    console.log(`   Lesson ID: ${latestAnalysis.lessonId}`);
    console.log(`   Created: ${latestAnalysis.createdAt.toISOString()}`);
    console.log(`   Processing Time: ${latestAnalysis.processingTime}ms\n`);
    
    // Get the lesson
    const lesson = await Lesson.findById(latestAnalysis.lessonId);
    console.log('📚 LESSON INFO:');
    console.log(`   Subject: ${lesson?.subject}`);
    console.log(`   Duration: ${lesson?.duration} min`);
    console.log(`   Is Trial: ${lesson?.isTrialLesson}`);
    console.log(`   Is Class: ${lesson?.isClass}`);
    console.log(`   Start Time: ${lesson?.startTime.toISOString()}\n`);
    
    // Get the transcript
    const transcript = await LessonTranscript.findById(latestAnalysis.transcriptId);
    console.log('🎙️  TRANSCRIPT INFO:');
    console.log(`   Transcript ID: ${transcript?._id}`);
    console.log(`   Total Segments: ${transcript?.segments?.length || 0}`);
    console.log(`   Student Segments: ${transcript?.segments?.filter(s => s.speaker === 'student').length || 0}`);
    console.log(`   Language: ${transcript?.language}\n`);
    
    console.log('📝 ANALYSIS CONTENT:');
    console.log(`   Proficiency: ${latestAnalysis.overallAssessment.proficiencyLevel}`);
    console.log(`   Summary: ${latestAnalysis.overallAssessment.summary}\n`);
    
    console.log('📈 PROGRESSION METRICS:');
    if (latestAnalysis.progressionMetrics) {
      console.log(`   Previous Level: ${latestAnalysis.progressionMetrics.previousProficiencyLevel}`);
      console.log(`   Proficiency Change: ${latestAnalysis.progressionMetrics.proficiencyChange}`);
      console.log(`   Error Rate: ${latestAnalysis.progressionMetrics.errorRate}`);
      console.log(`   Error Rate Change: ${latestAnalysis.progressionMetrics.errorRateChange}%`);
      console.log(`   Vocabulary Growth: ${latestAnalysis.progressionMetrics.vocabularyGrowth} words`);
      console.log(`   Key Improvements: ${latestAnalysis.progressionMetrics.keyImprovements?.join(', ')}`);
      console.log(`   Persistent Challenges: ${latestAnalysis.progressionMetrics.persistentChallenges?.join(', ')}`);
    } else {
      console.log('   ❌ No progression metrics found!');
    }
    
    console.log('\n📊 STUDENT TRANSCRIPT PREVIEW:');
    const studentSegments = transcript?.segments?.filter(s => s.speaker === 'student') || [];
    studentSegments.slice(0, 3).forEach((seg, i) => {
      console.log(`   ${i + 1}. "${seg.text}"`);
    });
    
    if (studentSegments.length === 0) {
      console.log('   ⚠️  WARNING: NO STUDENT SPEECH DETECTED!');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

check();
