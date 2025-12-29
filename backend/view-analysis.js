/**
 * Script to view the actual analysis that was saved to see what GPT-4 returned
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  }
};

const LessonAnalysis = require('./models/LessonAnalysis');

async function viewAnalysis() {
  await connectDB();
  
  const lessonId = '692db4829a115761e478bce4';
  
  const analysis = await LessonAnalysis.findOne({ lessonId });
  
  if (analysis) {
    console.log('\n📊 ANALYSIS DETAILS:\n');
    console.log('Status:', analysis.status);
    console.log('Level:', analysis.overallAssessment.proficiencyLevel);
    console.log('\n🔍 ERROR PATTERNS:');
    console.log(JSON.stringify(analysis.errorPatterns, null, 2));
    console.log('\n📝 CORRECTED EXCERPTS:');
    console.log(JSON.stringify(analysis.correctedExcerpts, null, 2));
  } else {
    console.log('⚠️  No analysis found');
  }
  
  await mongoose.connection.close();
}

viewAnalysis().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});



