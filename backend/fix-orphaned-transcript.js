const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const LessonTranscript = require('./models/LessonTranscript');
const Lesson = require('./models/Lesson');
const LessonAnalysis = require('./models/LessonAnalysis');

/**
 * Fix the orphaned transcript by associating it with the correct lesson
 */
async function fixOrphanedTranscript() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const transcriptId = '6931bc8fff5de8344c044dfa';
    const lessonId = '6931bc0cff5de8344c03d3cb';

    // Get transcript
    const transcript = await LessonTranscript.findById(transcriptId);
    if (!transcript) {
      console.error('❌ Transcript not found');
      process.exit(1);
    }

    console.log('📝 Found transcript:', transcript._id);
    console.log('   Current lessonId:', transcript.lessonId || 'undefined');
    console.log('   Segments:', transcript.segments?.length || 0);
    console.log('   Pronunciation segments:', transcript.pronunciationSegments?.length || 0);

    // Get lesson
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) {
      console.error('❌ Lesson not found');
      process.exit(1);
    }

    console.log('\n📚 Found lesson:', lesson._id);
    console.log('   Status:', lesson.status);

    // Update transcript with lessonId
    transcript.lessonId = lessonId;
    await transcript.save();
    console.log('\n✅ Updated transcript with lessonId');

    // Check if analysis exists
    const analysis = await LessonAnalysis.findOne({ lesson: undefined });
    if (analysis) {
      console.log('\n📊 Found orphaned analysis:', analysis._id);
      console.log('   Status:', analysis.status);
      
      analysis.lesson = lessonId;
      await analysis.save();
      console.log('✅ Updated analysis with lessonId');
    } else {
      console.log('\n⚠️  No orphaned analysis found');
    }

    console.log('\n✅ ✅ ✅ Fix complete! ✅ ✅ ✅\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixOrphanedTranscript();


