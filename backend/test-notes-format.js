const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const LessonAnalysis = require('./models/LessonAnalysis');

// Import the formatAnalysisAsNotes function
const formatAnalysisAsNotes = (analysis) => {
  let notes = '📋 Quick Brief for Today\'s Class\n\n';
  
  // === QUESTION 1: What did we work on last time? ===
  notes += '━━━━━━━━━━━━━━━━━━━━━\n';
  notes += '💬 LAST CLASS SUMMARY\n';
  notes += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  // Topics discussed
  if (analysis.topicsDiscussed && analysis.topicsDiscussed.length > 0) {
    notes += 'Topics we covered:\n';
    analysis.topicsDiscussed.forEach((topic, i) => {
      notes += `• ${topic}\n`;
    });
    notes += '\n';
  }
  
  // Overall assessment summary
  if (analysis.overallAssessment) {
    notes += `Level: ${analysis.overallAssessment.proficiencyLevel} `;
    if (analysis.progressionMetrics) {
      notes += `(${analysis.progressionMetrics.proficiencyChange || 'maintained'})\n\n`;
    } else {
      notes += '\n\n';
    }
    
    // Add brief progress note if available
    if (analysis.overallAssessment.progressFromLastLesson) {
      notes += `Progress: ${analysis.overallAssessment.progressFromLastLesson}\n\n`;
    }
  }
  
  // === QUESTION 2: What did they struggle with / do well on? ===
  notes += '━━━━━━━━━━━━━━━━━━━━━\n';
  notes += '📊 PERFORMANCE HIGHLIGHTS\n';
  notes += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  // Strengths (what they did well)
  if (analysis.strengths && analysis.strengths.length > 0) {
    notes += '✅ What They Did Well:\n';
    analysis.strengths.slice(0, 3).forEach((strength) => {
      notes += `• ${strength}\n`;
    });
    notes += '\n';
  }
  
  // Struggles (areas for improvement)
  if (analysis.areasForImprovement && analysis.areasForImprovement.length > 0) {
    notes += '⚠️  What They Struggled With:\n';
    analysis.areasForImprovement.forEach((area) => {
      notes += `• ${area}\n`;
    });
    notes += '\n';
  }
  
  // Specific error patterns (most useful for tutors)
  if (analysis.errorPatterns && analysis.errorPatterns.length > 0) {
    notes += '🔍 Common Mistakes to Watch:\n';
    analysis.errorPatterns.slice(0, 3).forEach((error) => {
      notes += `• ${error.pattern} (appeared ${error.frequency}x`;
      if (error.severity) {
        notes += `, ${error.severity} priority`;
      }
      notes += ')\n';
      
      // Add example if available
      if (error.examples && error.examples.length > 0 && error.examples[0].original) {
        notes += `  Example: "${error.examples[0].original}" → "${error.examples[0].corrected}"\n`;
      }
    });
    notes += '\n';
  }
  
  // Grammar accuracy score if available
  if (analysis.grammarAnalysis && analysis.grammarAnalysis.accuracyScore) {
    notes += `Grammar Accuracy: ${analysis.grammarAnalysis.accuracyScore}%\n`;
  }
  if (analysis.fluencyAnalysis && analysis.fluencyAnalysis.overallFluencyScore) {
    notes += `Fluency Score: ${analysis.fluencyAnalysis.overallFluencyScore}/100\n`;
  }
  if (analysis.grammarAnalysis || analysis.fluencyAnalysis) {
    notes += '\n';
  }
  
  // === QUESTION 3: Optional ideas for this next class ===
  notes += '━━━━━━━━━━━━━━━━━━━━━\n';
  notes += '💡 IDEAS FOR TODAY\'S CLASS\n';
  notes += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  // Recommended focus areas
  if (analysis.recommendedFocus && analysis.recommendedFocus.length > 0) {
    notes += 'Suggested Focus:\n';
    analysis.recommendedFocus.forEach((topic, i) => {
      notes += `${i + 1}. ${topic}\n`;
    });
    notes += '\n';
  }
  
  // Suggested exercises
  if (analysis.suggestedExercises && analysis.suggestedExercises.length > 0) {
    notes += 'Exercise Ideas:\n';
    analysis.suggestedExercises.forEach((exercise, i) => {
      notes += `${i + 1}. ${exercise}\n`;
    });
    notes += '\n';
  }
  
  // Check if they did homework
  if (analysis.homeworkSuggestions && analysis.homeworkSuggestions.length > 0) {
    notes += '✏️  Check Their Homework:\n';
    analysis.homeworkSuggestions.forEach((hw, i) => {
      notes += `${i + 1}. ${hw}\n`;
    });
    notes += '\n';
  }
  
  // Persistent challenges to keep in mind
  if (analysis.progressionMetrics && analysis.progressionMetrics.persistentChallenges 
      && analysis.progressionMetrics.persistentChallenges.length > 0) {
    notes += '🎯 Keep Working On (recurring issues):\n';
    analysis.progressionMetrics.persistentChallenges.forEach((challenge) => {
      notes += `• ${challenge}\n`;
    });
    notes += '\n';
  }
  
  notes += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  notes += '💭 Tip: Start by asking about their homework and what they found challenging!';
  
  return notes.trim();
};

async function testNotesFormat() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Get the most recent analysis
    const analysis = await LessonAnalysis.findOne({ 
      lessonId: '692e0679d780ecd16c06d5d5'
    });
    
    if (!analysis) {
      console.error('❌ Analysis not found');
      process.exit(1);
    }
    
    console.log('📝 GENERATING ENHANCED NOTES FOR TUTOR VIEW\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const notes = formatAnalysisAsNotes(analysis);
    
    console.log(notes);
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('✅ This is what tutors will see when they click "View Notes"');
    console.log('   on their upcoming lessons!\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testNotesFormat();


