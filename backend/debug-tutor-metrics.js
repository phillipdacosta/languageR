/**
 * Diagnostic script: Check what data exists for tutor "Phillip Dacosta"
 * and what the coaching metrics evaluation would produce.
 * 
 * Run: node debug-tutor-metrics.js
 */

require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');

async function diagnose() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const User = require('./models/User');
    const Lesson = require('./models/Lesson');
    const LessonAnalysis = require('./models/LessonAnalysis');
    const TutorFeedback = require('./models/TutorFeedback');

    // 1. Find the tutor
    const tutor = await User.findOne({ 
      name: { $regex: /phillip/i },
      userType: 'tutor'
    });

    if (!tutor) {
      // Try broader search
      const allTutors = await User.find({ userType: 'tutor' }).select('name email auth0Id _id').lean();
      console.log('❌ Tutor "Phillip Dacosta" not found. All tutors:');
      allTutors.forEach(t => console.log(`   - ${t.name} (${t.email}) [_id: ${t._id}]`));
      process.exit(1);
    }

    console.log('=== TUTOR INFO ===');
    console.log(`Name: ${tutor.name}`);
    console.log(`Email: ${tutor.email}`);
    console.log(`_id: ${tutor._id}`);
    console.log(`auth0Id: ${tutor.auth0Id}`);
    console.log(`userType: ${tutor.userType}`);
    console.log(`tutorApproved: ${tutor.tutorApproved}`);
    console.log(`Current stats.feedbackMetrics:`, JSON.stringify(tutor.stats?.feedbackMetrics, null, 2));

    // 2. Find all completed lessons for this tutor
    const allLessons = await Lesson.find({ tutorId: tutor._id }).select('status startTime actualCallEndTime updatedAt studentId duration subject').sort({ updatedAt: -1 }).lean();
    const completedLessons = allLessons.filter(l => l.status === 'completed');
    const completedWithEndTime = completedLessons.filter(l => l.actualCallEndTime);
    
    console.log('\n=== LESSONS ===');
    console.log(`Total lessons: ${allLessons.length}`);
    console.log(`Completed lessons: ${completedLessons.length}`);
    console.log(`Completed with actualCallEndTime: ${completedWithEndTime.length}`);
    console.log('\nAll lessons by status:');
    const statusCounts = {};
    allLessons.forEach(l => { statusCounts[l.status] = (statusCounts[l.status] || 0) + 1; });
    Object.entries(statusCounts).forEach(([s, c]) => console.log(`   ${s}: ${c}`));

    if (completedLessons.length > 0) {
      console.log('\nCompleted lessons details:');
      completedLessons.forEach(l => {
        console.log(`   Lesson ${l._id} | ${l.subject || 'N/A'} | ${l.startTime ? new Date(l.startTime).toISOString() : 'no start'} | actualEnd: ${l.actualCallEndTime ? 'YES' : 'NO'} | updated: ${l.updatedAt}`);
      });
    }

    // 3. Check LessonAnalysis records for these lessons
    const lessonIds = completedLessons.map(l => l._id);
    
    const analysesWithNotes = await LessonAnalysis.find({
      lessonId: { $in: lessonIds },
      'tutorNote.text': { $exists: true, $ne: null }
    }).select('lessonId source tutorNote.text tutorNote.quickImpression tutorNote.homework').lean();

    const tutorSourceAnalyses = await LessonAnalysis.find({
      lessonId: { $in: lessonIds },
      source: 'tutor'
    }).select('lessonId source overallAssessment.proficiencyLevel strengths areasForImprovement homeworkSuggestions studentSummary').lean();

    const allAnalyses = await LessonAnalysis.find({
      lessonId: { $in: lessonIds }
    }).select('lessonId source tutorNote.text overallAssessment.proficiencyLevel').lean();
    
    console.log('\n=== LESSON ANALYSES ===');
    console.log(`Total LessonAnalysis for completed lessons: ${allAnalyses.length}`);
    console.log(`With tutorNote.text: ${analysesWithNotes.length}`);
    console.log(`With source='tutor': ${tutorSourceAnalyses.length}`);
    
    if (allAnalyses.length > 0) {
      console.log('\nAll analyses:');
      allAnalyses.forEach(a => {
        console.log(`   Lesson ${a.lessonId} | source: ${a.source || 'ai'} | hasTutorNote: ${!!(a.tutorNote?.text)} | CEFR: ${a.overallAssessment?.proficiencyLevel || 'N/A'}`);
      });
    }

    // 4. Check TutorFeedback records
    const tutorFeedbackById = await TutorFeedback.find({
      tutorId: tutor._id.toString()
    }).select('lessonId status strengths areasForImprovement estimatedCefrLevel providedAt').lean();

    const tutorFeedbackByAuth0 = await TutorFeedback.find({
      tutorId: tutor.auth0Id
    }).select('lessonId status strengths areasForImprovement estimatedCefrLevel providedAt').lean();
    
    console.log('\n=== TUTOR FEEDBACK RECORDS ===');
    console.log(`By _id (${tutor._id}): ${tutorFeedbackById.length}`);
    console.log(`By auth0Id (${tutor.auth0Id}): ${tutorFeedbackByAuth0.length}`);
    
    const allFeedback = [...tutorFeedbackById, ...tutorFeedbackByAuth0];
    // Deduplicate
    const seen = new Set();
    const uniqueFeedback = allFeedback.filter(f => {
      const key = f._id.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    if (uniqueFeedback.length > 0) {
      console.log('\nAll TutorFeedback records:');
      uniqueFeedback.forEach(f => {
        console.log(`   Lesson ${f.lessonId} | status: ${f.status} | CEFR: ${f.estimatedCefrLevel || 'N/A'} | strengths: ${(f.strengths || []).length} | areas: ${(f.areasForImprovement || []).length} | providedAt: ${f.providedAt || 'N/A'}`);
      });
    }

    // 5. Calculate what metrics SHOULD be
    console.log('\n=== EXPECTED METRICS ===');
    const feedbackMap = new Map();
    
    analysesWithNotes.forEach(a => {
      feedbackMap.set(a.lessonId.toString(), 'tutorNote');
    });
    tutorSourceAnalyses.forEach(a => {
      if (!feedbackMap.has(a.lessonId.toString())) {
        feedbackMap.set(a.lessonId.toString(), 'tutorFeedbackForm');
      }
    });
    uniqueFeedback.filter(f => f.status === 'completed').forEach(f => {
      if (!feedbackMap.has(f.lessonId.toString())) {
        feedbackMap.set(f.lessonId.toString(), 'tutorFeedbackRecord');
      }
    });
    
    const feedbackCount = feedbackMap.size;
    const feedbackRate = completedLessons.length > 0 ? (feedbackCount / completedLessons.length) * 100 : 0;
    
    console.log(`Completed lessons: ${completedLessons.length}`);
    console.log(`Lessons with feedback (any source): ${feedbackCount}`);
    console.log(`Expected feedback rate: ${Math.round(feedbackRate)}%`);
    console.log(`Feedback sources breakdown:`);
    feedbackMap.forEach((source, lid) => {
      console.log(`   Lesson ${lid}: ${source}`);
    });

    console.log('\n✅ Diagnosis complete');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

diagnose();




