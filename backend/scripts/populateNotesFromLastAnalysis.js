/**
 * One-time script to populate notes for upcoming lessons based on past analyses
 */

require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const Lesson = require('../models/Lesson');
const LessonAnalysis = require('../models/LessonAnalysis');

// Format AI analysis into readable notes for the tutor
function formatAnalysisAsNotes(analysis) {
  let notes = '📊 AI Analysis from Previous Lesson\n\n';
  
  // Proficiency Level
  if (analysis.overallAssessment) {
    notes += `🎯 Proficiency: ${analysis.overallAssessment.proficiencyLevel}\n\n`;
    notes += `${analysis.overallAssessment.summary}\n\n`;
    notes += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  }
  
  // Areas for Improvement (Priority)
  if (analysis.areasForImprovement && analysis.areasForImprovement.length > 0) {
    notes += '⚠️  Focus Areas:\n\n';
    analysis.areasForImprovement.forEach((area, i) => {
      notes += `${i + 1}. ${area}\n\n`;
    });
  }
  
  // Error Patterns (top 3)
  if (analysis.errorPatterns && analysis.errorPatterns.length > 0) {
    notes += '🔍 Common Errors:\n\n';
    analysis.errorPatterns.slice(0, 3).forEach((error, i) => {
      notes += `${i + 1}. ${error.pattern} (${error.frequency}x)\n`;
      if (error.practiceNeeded) {
        notes += `   Practice: ${error.practiceNeeded}\n\n`;
      } else {
        notes += '\n';
      }
    });
  }
  
  // Recommended Focus
  if (analysis.recommendedFocus && analysis.recommendedFocus.length > 0) {
    notes += '📚 Recommended Topics:\n\n';
    analysis.recommendedFocus.forEach((topic, i) => {
      notes += `${i + 1}. ${topic}\n\n`;
    });
  }
  
  // Homework Suggestions
  if (analysis.homeworkSuggestions && analysis.homeworkSuggestions.length > 0) {
    notes += '✏️  Homework:\n\n';
    analysis.homeworkSuggestions.forEach((hw, i) => {
      notes += `${i + 1}. ${hw}\n\n`;
    });
  }
  
  // Strengths
  if (analysis.strengths && analysis.strengths.length > 0) {
    notes += '💪 Strengths:\n\n';
    analysis.strengths.forEach((strength, i) => {
      notes += `• ${strength}\n\n`;
    });
  }
  
  return notes.trim();
}

async function populateNotes() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const now = new Date();
    
    // Find all upcoming lessons
    const upcomingLessons = await Lesson.find({
      startTime: { $gt: now },
      status: { $ne: 'cancelled' }
    }).sort({ startTime: 1 });
    
    console.log(`📚 Found ${upcomingLessons.length} upcoming lessons`);
    
    let updatedCount = 0;
    
    // For each upcoming lesson, find the most recent analysis
    for (const lesson of upcomingLessons) {
      console.log(`\n🔍 Looking for analysis for lesson ${lesson._id}`);
      console.log(`   Student: ${lesson.studentId}`);
      console.log(`   Tutor: ${lesson.tutorId}`);
      
      // Find ALL analyses to debug
      const allAnalyses = await LessonAnalysis.find({ status: 'completed' });
      console.log(`   Total completed analyses in DB: ${allAnalyses.length}`);
      
      // Try to match by extracting _id from nested objects
      const latestAnalysis = allAnalyses.find(analysis => {
        // The IDs are stored as stringified objects, need to parse
        let analysisStudentId, analysisTutorId;
        
        try {
          // Try to extract _id from the object
          if (typeof analysis.studentId === 'object') {
            analysisStudentId = analysis.studentId._id ? String(analysis.studentId._id) : null;
          } else {
            // It's a string that might contain an object
            const studentStr = String(analysis.studentId);
            // Try to extract ObjectId from the string
            const match = studentStr.match(/_id:\s*new ObjectId\('([^']+)'\)/);
            analysisStudentId = match ? match[1] : studentStr;
          }
          
          if (typeof analysis.tutorId === 'object') {
            analysisTutorId = analysis.tutorId._id ? String(analysis.tutorId._id) : null;
          } else {
            // It's a string that might contain an object
            const tutorStr = String(analysis.tutorId);
            // Try to extract ObjectId from the string
            const match = tutorStr.match(/_id:\s*new ObjectId\('([^']+)'\)/);
            analysisTutorId = match ? match[1] : tutorStr;
          }
        } catch (e) {
          console.log(`   ⚠️  Error parsing IDs: ${e.message}`);
          return false;
        }
        
        const lessonStudentId = String(lesson.studentId);
        const lessonTutorId = String(lesson.tutorId);
        
        console.log(`   Comparing analysis ${analysis._id}:`);
        console.log(`      Analysis student: ${analysisStudentId}`);
        console.log(`      Lesson student:   ${lessonStudentId}`);
        console.log(`      Analysis tutor:   ${analysisTutorId}`);
        console.log(`      Lesson tutor:     ${lessonTutorId}`);
        
        const match = analysisStudentId === lessonStudentId && analysisTutorId === lessonTutorId;
        
        if (match) {
          console.log(`   ✅ MATCH FOUND!`);
        } else {
          console.log(`   ❌ No match`);
        }
        
        return match;
      });
      
      if (latestAnalysis) {
        // Format notes from analysis
        const notes = formatAnalysisAsNotes(latestAnalysis);
        
        // Update lesson with notes
        lesson.notes = notes;
        await lesson.save();
        
        console.log(`✅ Updated lesson ${lesson._id} (${lesson.startTime.toISOString()}) with notes from analysis ${latestAnalysis._id}`);
        updatedCount++;
      } else {
        console.log(`⏭️  No analysis found for lesson ${lesson._id} (student: ${lesson.studentId}, tutor: ${lesson.tutorId})`);
      }
    }
    
    console.log(`\n🎉 Script completed! Updated ${updatedCount} out of ${upcomingLessons.length} lessons`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the script
populateNotes();

