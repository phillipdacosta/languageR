/**
 * Script to delete the stuck failed analysis that's blocking new analyses
 * Run this once: node delete-stuck-analysis.js
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB Connected');
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  }
};

const LessonAnalysis = require('./models/LessonAnalysis');

async function deleteStuckAnalysis() {
  await connectDB();
  
  const lessonId = '692dac407394efaa631222ed'; // The stuck lesson ID
  
  console.log(`🔍 Looking for analysis for lesson ${lessonId}...`);
  
  const analysis = await LessonAnalysis.findOne({ lessonId });
  
  if (analysis) {
    console.log(`📊 Found analysis:`);
    console.log(`   Status: ${analysis.status}`);
    console.log(`   Created: ${analysis.createdAt}`);
    console.log(`   Summary: ${analysis.studentSummary?.substring(0, 80)}...`);
    
    console.log(`\n🗑️  Deleting stuck analysis...`);
    await LessonAnalysis.deleteOne({ lessonId });
    console.log(`✅ Deleted successfully!`);
    console.log(`\n✨ You can now test the lesson again and get a fresh analysis.`);
  } else {
    console.log(`⚠️  No analysis found for this lesson`);
  }
  
  await mongoose.connection.close();
  console.log('\n👋 Database connection closed');
}

deleteStuckAnalysis().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});



