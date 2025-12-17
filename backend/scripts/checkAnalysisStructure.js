/**
 * Check the exact analysis structure
 */

require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const LessonAnalysis = require('../models/LessonAnalysis');

async function checkAnalysisStructure() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Get the completed analysis
    const analysis = await LessonAnalysis.findById('692c5812d0e83188379a202e');
    
    if (analysis) {
      console.log('📊 Analysis found!');
      console.log('Student ID type:', typeof analysis.studentId);
      console.log('Student ID value:', analysis.studentId);
      console.log('Tutor ID type:', typeof analysis.tutorId);
      console.log('Tutor ID value:', analysis.tutorId);
      console.log('\nProficiency:', analysis.overallAssessment?.proficiencyLevel);
      console.log('Areas for improvement:', analysis.areasForImprovement);
      console.log('Recommended focus:', analysis.recommendedFocus);
      console.log('Homework suggestions:', analysis.homeworkSuggestions);
    } else {
      console.log('❌ Analysis not found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the script
checkAnalysisStructure();



