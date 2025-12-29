require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const LessonAnalysis = require('../models/LessonAnalysis');

async function check() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Get all analyses sorted by date
    const analyses = await LessonAnalysis.find({
      status: 'completed'
    })
    .sort({ createdAt: -1 })
    .limit(5);
    
    console.log(`Found ${analyses.length} completed analyses:\n`);
    
    analyses.forEach((analysis, i) => {
      console.log(`${i + 1}. Analysis ID: ${analysis._id}`);
      console.log(`   Lesson ID: ${analysis.lessonId}`);
      console.log(`   Created: ${analysis.createdAt.toISOString()}`);
      console.log(`   Lesson Date: ${analysis.lessonDate.toISOString()}`);
      console.log(`   Proficiency: ${analysis.overallAssessment?.proficiencyLevel}`);
      console.log(`   Summary: ${analysis.overallAssessment?.summary?.substring(0, 80)}...`);
      console.log(`   Processing Time: ${analysis.processingTime}ms`);
      console.log(`   Has progressionMetrics: ${!!analysis.progressionMetrics}`);
      
      // Check if summary is exactly the same as previous
      if (i > 0 && analyses[i-1].overallAssessment?.summary === analysis.overallAssessment?.summary) {
        console.log(`   ⚠️  WARNING: Summary is IDENTICAL to previous analysis!`);
      }
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

check();
