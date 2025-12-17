require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const LessonAnalysis = require('../models/LessonAnalysis');
const LessonTranscript = require('../models/LessonTranscript');

async function compare() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Get the two most recent completed analyses
    const analyses = await LessonAnalysis.find({
      status: 'completed'
    })
    .sort({ createdAt: -1 })
    .limit(2);
    
    if (analyses.length < 2) {
      console.log('Not enough analyses to compare');
      return;
    }
    
    const [latest, previous] = analyses;
    
    console.log('🔍 COMPARING TWO MOST RECENT ANALYSES:\n');
    console.log('═══════════════════════════════════════════════════════\n');
    
    console.log('📊 ANALYSIS 1 (Latest):');
    console.log(`   ID: ${latest._id}`);
    console.log(`   Lesson: ${latest.lessonId}`);
    console.log(`   Created: ${latest.createdAt.toISOString()}`);
    console.log(`   Proficiency: ${latest.overallAssessment.proficiencyLevel}`);
    console.log(`   Confidence: ${latest.overallAssessment.confidence}%`);
    console.log(`   Summary: ${latest.overallAssessment.summary}`);
    console.log(`   Progress Note: ${latest.overallAssessment.progressFromLastLesson}`);
    
    console.log('\n📊 ANALYSIS 2 (Previous):');
    console.log(`   ID: ${previous._id}`);
    console.log(`   Lesson: ${previous.lessonId}`);
    console.log(`   Created: ${previous.createdAt.toISOString()}`);
    console.log(`   Proficiency: ${previous.overallAssessment.proficiencyLevel}`);
    console.log(`   Confidence: ${previous.overallAssessment.confidence}%`);
    console.log(`   Summary: ${previous.overallAssessment.summary}`);
    console.log(`   Progress Note: ${previous.overallAssessment.progressFromLastLesson || 'N/A'}`);
    
    console.log('\n═══════════════════════════════════════════════════════\n');
    console.log('🔍 COMPARISON:\n');
    
    // Compare key fields
    console.log(`Proficiency Level: ${latest.overallAssessment.proficiencyLevel === previous.overallAssessment.proficiencyLevel ? '⚠️  SAME' : '✅ DIFFERENT'} (${previous.overallAssessment.proficiencyLevel} → ${latest.overallAssessment.proficiencyLevel})`);
    console.log(`Confidence: ${latest.overallAssessment.confidence === previous.overallAssessment.confidence ? '⚠️  SAME' : '✅ DIFFERENT'} (${previous.overallAssessment.confidence}% → ${latest.overallAssessment.confidence}%)`);
    console.log(`Summary: ${latest.overallAssessment.summary === previous.overallAssessment.summary ? '🚨 IDENTICAL' : '✅ Different'}`);
    
    // Check areas for improvement
    const latestAreas = (latest.areasForImprovement || []).join(', ');
    const prevAreas = (previous.areasForImprovement || []).join(', ');
    console.log(`Areas for Improvement: ${latestAreas === prevAreas ? '🚨 IDENTICAL' : '✅ Different'}`);
    
    // Check error patterns
    const latestErrors = (latest.errorPatterns || []).map(e => e.pattern).join(', ');
    const prevErrors = (previous.errorPatterns || []).map(e => e.pattern).join(', ');
    console.log(`Error Patterns: ${latestErrors === prevErrors ? '🚨 IDENTICAL' : '✅ Different'}`);
    
    // Check homework
    const latestHW = (latest.homeworkSuggestions || []).join(', ');
    const prevHW = (previous.homeworkSuggestions || []).join(', ');
    console.log(`Homework: ${latestHW === prevHW ? '🚨 IDENTICAL' : '✅ Different'}`);
    
    // Get transcripts to compare student speech
    console.log('\n═══════════════════════════════════════════════════════\n');
    console.log('🎙️  COMPARING STUDENT SPEECH:\n');
    
    const transcript1 = await LessonTranscript.findById(latest.transcriptId);
    const transcript2 = await LessonTranscript.findById(previous.transcriptId);
    
    const student1 = transcript1?.segments?.filter(s => s.speaker === 'student').map(s => s.text).join(' ') || '';
    const student2 = transcript2?.segments?.filter(s => s.speaker === 'student').map(s => s.text).join(' ') || '';
    
    console.log(`Latest transcript (${student1.length} chars):`);
    console.log(`   "${student1}"\n`);
    
    console.log(`Previous transcript (${student2.length} chars):`);
    console.log(`   "${student2}"\n`);
    
    if (student1 === student2) {
      console.log('🚨🚨🚨 TRANSCRIPTS ARE IDENTICAL! 🚨🚨🚨');
      console.log('This means the student speech was NOT re-transcribed.');
      console.log('The system is likely reusing old transcript data!\n');
    } else if (student1.length < 50) {
      console.log('⚠️  Latest transcript is TOO SHORT (< 50 characters)');
      console.log('Not enough speech data to generate unique analysis!\n');
    } else {
      console.log('✅ Transcripts are different - analyses should be different too');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

compare();
