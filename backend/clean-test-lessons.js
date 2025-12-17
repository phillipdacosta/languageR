const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const Lesson = require('./models/Lesson');
const LessonAnalysis = require('./models/LessonAnalysis');
const LessonTranscript = require('./models/LessonTranscript');

/**
 * Delete recent test lessons and their associated data
 * (analyses and transcripts)
 * 
 * Keeps lessons older than 7 days to preserve historical data
 */
async function cleanTestLessons() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find lessons from the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const lessons = await Lesson.find({
      createdAt: { $gte: sevenDaysAgo }
    }).sort({ createdAt: -1 }).lean();

    console.log(`📊 Found ${lessons.length} lessons from the last 7 days\n`);

    if (lessons.length === 0) {
      console.log('✅ No recent lessons to delete');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Show lessons to be deleted
    console.log('📋 Lessons to be deleted:');
    lessons.forEach((lesson, index) => {
      const created = new Date(lesson.createdAt).toLocaleString();
      const scheduled = new Date(lesson.scheduledStartTime).toLocaleString();
      console.log(`  ${index + 1}. ${lesson._id}`);
      console.log(`     Created: ${created}`);
      console.log(`     Scheduled: ${scheduled}`);
      console.log(`     Status: ${lesson.status}`);
      console.log(`     Trial: ${lesson.isTrial || false}`);
      console.log();
    });

    // Get lesson IDs
    const lessonIds = lessons.map(l => l._id);

    // Count related documents
    const analysisCount = await LessonAnalysis.countDocuments({ lesson: { $in: lessonIds } });
    const transcriptCount = await LessonTranscript.countDocuments({ lesson: { $in: lessonIds } });

    console.log(`\n⚠️  This will delete:
   - ${lessons.length} lesson(s)
   - ${analysisCount} lesson analyses
   - ${transcriptCount} lesson transcripts
   
⚠️  All lessons from the last 7 days will be deleted!\n`);

    // Confirm deletion
    console.log('⚠️  Type "DELETE" to proceed with deletion:');
    
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question('> ', async (answer) => {
      if (answer.trim() !== 'DELETE') {
        console.log('❌ Deletion cancelled');
        readline.close();
        await mongoose.disconnect();
        process.exit(0);
      }

      readline.close();

      console.log('\n🗑️  Starting deletion...\n');

      // Delete in order: analyses → transcripts → lessons
      console.log('🗑️  Deleting lesson analyses...');
      const analysisResult = await LessonAnalysis.deleteMany({ lesson: { $in: lessonIds } });
      console.log(`✅ Deleted ${analysisResult.deletedCount} lesson analyses`);

      console.log('🗑️  Deleting lesson transcripts...');
      const transcriptResult = await LessonTranscript.deleteMany({ lesson: { $in: lessonIds } });
      console.log(`✅ Deleted ${transcriptResult.deletedCount} lesson transcripts`);

      console.log('🗑️  Deleting lessons...');
      const lessonResult = await Lesson.deleteMany({ _id: { $in: lessonIds } });
      console.log(`✅ Deleted ${lessonResult.deletedCount} lessons`);

      console.log('\n✅ ✅ ✅ Cleanup complete! ✅ ✅ ✅\n');
      
      // Check remaining lessons
      const remainingCount = await Lesson.countDocuments();
      console.log(`📊 Remaining lessons in database: ${remainingCount}\n`);

      await mongoose.disconnect();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the script
cleanTestLessons();
