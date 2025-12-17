require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const Lesson = require('../models/Lesson');
const LessonAnalysis = require('../models/LessonAnalysis');

// Format AI analysis into readable notes for the tutor
function formatAnalysisAsNotes(analysis) {
  let notes = '📊 AI Analysis from Previous Lesson\n\n';
  
  if (analysis.overallAssessment) {
    notes += `🎯 Proficiency: ${analysis.overallAssessment.proficiencyLevel}\n\n`;
    notes += `${analysis.overallAssessment.summary}\n\n`;
    notes += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  }
  
  if (analysis.areasForImprovement && analysis.areasForImprovement.length > 0) {
    notes += '⚠️  Focus Areas:\n\n';
    analysis.areasForImprovement.forEach((area, i) => {
      notes += `${i + 1}. ${area}\n\n`;
    });
  }
  
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
  
  if (analysis.recommendedFocus && analysis.recommendedFocus.length > 0) {
    notes += '📚 Recommended Topics:\n\n';
    analysis.recommendedFocus.forEach((topic, i) => {
      notes += `${i + 1}. ${topic}\n\n`;
    });
  }
  
  if (analysis.homeworkSuggestions && analysis.homeworkSuggestions.length > 0) {
    notes += '✏️  Homework:\n\n';
    analysis.homeworkSuggestions.forEach((hw, i) => {
      notes += `${i + 1}. ${hw}\n\n`;
    });
  }
  
  if (analysis.strengths && analysis.strengths.length > 0) {
    notes += '💪 Strengths:\n\n';
    analysis.strengths.forEach((strength, i) => {
      notes += `• ${strength}\n\n`;
    });
  }
  
  return notes.trim();
}

async function addNotes() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Get the upcoming lesson
    const lesson = await Lesson.findById('692cdf6af17b81b3acb334df');
    
    if (!lesson) {
      console.log('❌ Lesson not found');
      return;
    }
    
    console.log('📚 Updating lesson:', lesson._id);
    console.log('   Start time:', lesson.startTime.toISOString());
    
    // Get the completed analysis
    const analysis = await LessonAnalysis.findById('692c5812d0e83188379a202e');
    
    if (!analysis) {
      console.log('❌ Analysis not found');
      return;
    }
    
    console.log('🤖 Using analysis from:', analysis.lessonDate.toISOString());
    
    // Format and add notes
    const notes = formatAnalysisAsNotes(analysis);
    lesson.notes = notes;
    await lesson.save();
    
    console.log('\n✅ Notes added successfully!');
    console.log('📝 Preview:', notes.substring(0, 200) + '...');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

addNotes();
