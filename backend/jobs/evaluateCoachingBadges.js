/**
 * Coaching Badge Evaluation Cron Job
 * Runs daily at 2 AM to evaluate tutors for "Coaching-Oriented Tutor" badge
 */

const cron = require('node-cron');
const User = require('../models/User');
const Lesson = require('../models/Lesson');
const LessonAnalysis = require('../models/LessonAnalysis');
const FeedbackQualityService = require('../services/feedbackQualityService');

// Badge eligibility criteria
const CRITERIA = {
  MIN_LESSONS: 10,              // Minimum completed lessons
  MIN_FEEDBACK_RATE: 80,        // Minimum % of lessons with feedback
  MIN_QUALITY_SCORE: 60,        // Minimum average quality score (0-100)
  MIN_STREAK: 5,                // Minimum consecutive lessons with feedback
  ROLLING_WINDOW: 30            // Number of recent lessons to evaluate
};

/**
 * Evaluate a single tutor for badge eligibility
 * Always updates metrics even with few lessons so the progress page shows data.
 */
async function evaluateTutorForBadge(tutor) {
  const feedbackService = new FeedbackQualityService();
  const TutorFeedback = require('../models/TutorFeedback');
  
  try {
    // Get last 30 completed lessons (accept with or without actualCallEndTime)
    const recentLessons = await Lesson.find({
      tutorId: tutor._id,
      status: 'completed'
    })
    .sort({ updatedAt: -1 })
    .limit(CRITERIA.ROLLING_WINDOW)
    .lean();
    
    // Always update metrics — even with 0 lessons — so the UI reflects real numbers
    if (!tutor.stats) tutor.stats = {};
    if (!tutor.stats.feedbackMetrics) tutor.stats.feedbackMetrics = {};
    if (!tutor.stats.feedbackMetrics.coachingBadge) {
      tutor.stats.feedbackMetrics.coachingBadge = {};
    }
    
    if (recentLessons.length === 0) {
      tutor.stats.feedbackMetrics.totalLessonsCompleted = 0;
      tutor.stats.feedbackMetrics.totalFeedbackProvided = 0;
      tutor.stats.feedbackMetrics.feedbackRate = 0;
      tutor.stats.feedbackMetrics.averageFeedbackQuality = 0;
      tutor.stats.feedbackMetrics.lastQualityUpdate = new Date();
      tutor.stats.feedbackMetrics.coachingBadge.active = false;
      tutor.stats.feedbackMetrics.coachingBadge.lastEvaluated = new Date();
      tutor.stats.feedbackMetrics.coachingBadge.qualifyingStreak = 0;
      await tutor.save();
      return { earned: false, removed: false, reason: 'no completed lessons', metrics: { feedbackRate: 0, avgQuality: 0, streak: 0, lessons: 0 } };
    }
    
    // Check which lessons have feedback from TWO sources:
    // 1) LessonAnalysis with tutorNote.text (tutor-note endpoint)
    // 2) LessonAnalysis with source: 'tutor' (TutorFeedback form)
    // 3) Completed TutorFeedback records (fallback)
    const lessonIds = recentLessons.map(l => l._id);
    
    // Source 1: LessonAnalysis with tutorNote.text
    const analysesWithNotes = await LessonAnalysis.find({
      lessonId: { $in: lessonIds },
      'tutorNote.text': { $exists: true, $ne: null }
    }).lean();
    
    // Source 2: LessonAnalysis with source: 'tutor' (from TutorFeedback form)
    const tutorSourceAnalyses = await LessonAnalysis.find({
      lessonId: { $in: lessonIds },
      source: 'tutor'
    }).lean();
    
    // Source 3: Completed TutorFeedback records (as fallback)
    const completedTutorFeedback = await TutorFeedback.find({
      $or: [
        { tutorId: tutor._id.toString() },
        { tutorId: tutor.auth0Id }
      ],
      lessonId: { $in: lessonIds },
      status: 'completed'
    }).lean();
    
    // Build feedback map — deduplicate by lessonId
    const feedbackMap = new Map();
    
    // Add tutorNote-based feedback (highest quality data)
    analysesWithNotes.forEach(a => {
      if (a.tutorNote && a.tutorNote.text) {
        const qualityScore = feedbackService.calculateQualityScore(a.tutorNote);
        feedbackMap.set(a.lessonId.toString(), {
          qualityScore,
          wordCount: a.tutorNote.text.split(/\s+/).filter(w => w.length > 0).length,
          hasHomework: !!a.tutorNote.homework,
          hasQuickImpression: !!a.tutorNote.quickImpression,
          source: 'tutorNote'
        });
      }
    });
    
    // Add tutor-source analyses (from TutorFeedback form) — don't overwrite tutorNote entries
    tutorSourceAnalyses.forEach(a => {
      const lid = a.lessonId.toString();
      if (!feedbackMap.has(lid)) {
        // Calculate quality from the structured data
        const strengths = a.strengths || [];
        const areas = a.areasForImprovement || [];
        const summary = a.overallAssessment?.summary || a.studentSummary || '';
        const wordCount = summary.split(/\s+/).filter(w => w.length > 0).length;
        const hasHomework = a.homeworkSuggestions && a.homeworkSuggestions.length > 0;
        
        // Score: base 40 + 15 for strengths + 15 for areas + 15 for length + 15 for homework
        let qualityScore = 40;
        if (strengths.length > 0) qualityScore += Math.min(15, strengths.length * 5);
        if (areas.length > 0) qualityScore += Math.min(15, areas.length * 5);
        if (wordCount > 20) qualityScore += Math.min(15, Math.floor(wordCount / 10) * 3);
        if (hasHomework) qualityScore += 15;
        qualityScore = Math.min(100, qualityScore);
        
        feedbackMap.set(lid, {
          qualityScore,
          wordCount,
          hasHomework,
          hasQuickImpression: false,
          source: 'tutorFeedbackForm'
        });
      }
    });
    
    // Add completed TutorFeedback records (fallback for any missed by above)
    completedTutorFeedback.forEach(tf => {
      const lid = tf.lessonId.toString();
      if (!feedbackMap.has(lid)) {
        const strengths = tf.strengths || [];
        const areas = tf.areasForImprovement || [];
        const notes = tf.overallNotes || '';
        const wordCount = notes.split(/\s+/).filter(w => w.length > 0).length + 
                         strengths.join(' ').split(/\s+/).filter(w => w.length > 0).length +
                         areas.join(' ').split(/\s+/).filter(w => w.length > 0).length;
        const hasHomework = !!tf.homework;
        
        let qualityScore = 40;
        if (strengths.length > 0) qualityScore += Math.min(15, strengths.length * 5);
        if (areas.length > 0) qualityScore += Math.min(15, areas.length * 5);
        if (wordCount > 20) qualityScore += Math.min(15, Math.floor(wordCount / 10) * 3);
        if (hasHomework) qualityScore += 15;
        qualityScore = Math.min(100, qualityScore);
        
        feedbackMap.set(lid, {
          qualityScore,
          wordCount,
          hasHomework,
          hasQuickImpression: false,
          source: 'tutorFeedbackRecord'
        });
      }
    });
    
    // Calculate metrics
    const feedbackCount = feedbackMap.size;
    const feedbackRate = (feedbackCount / recentLessons.length) * 100;
    const qualityScores = Array.from(feedbackMap.values()).map(f => f.qualityScore);
    const avgQuality = qualityScores.length > 0 
      ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length 
      : 0;
    
    // Check for consecutive feedback streak (sorted most recent first)
    let currentStreak = 0;
    for (const lesson of recentLessons) {
      if (feedbackMap.has(lesson._id.toString())) {
        currentStreak++;
      } else {
        break; // Streak broken
      }
    }
    
    // Badge eligibility requires minimum lessons
    const meetsRequirements = 
      recentLessons.length >= CRITERIA.MIN_LESSONS &&
      feedbackRate >= CRITERIA.MIN_FEEDBACK_RATE &&
      avgQuality >= CRITERIA.MIN_QUALITY_SCORE &&
      currentStreak >= CRITERIA.MIN_STREAK;
    
    const hadBadge = tutor.stats?.feedbackMetrics?.coachingBadge?.active || false;
    
    // Always update tutor stats (even with < 10 lessons)
    tutor.stats.feedbackMetrics.totalLessonsCompleted = recentLessons.length;
    tutor.stats.feedbackMetrics.totalFeedbackProvided = feedbackCount;
    tutor.stats.feedbackMetrics.feedbackRate = Math.round(feedbackRate);
    tutor.stats.feedbackMetrics.averageFeedbackQuality = Math.round(avgQuality);
    tutor.stats.feedbackMetrics.lastQualityUpdate = new Date();
    
    tutor.stats.feedbackMetrics.coachingBadge.active = meetsRequirements;
    tutor.stats.feedbackMetrics.coachingBadge.lastEvaluated = new Date();
    tutor.stats.feedbackMetrics.coachingBadge.qualifyingStreak = currentStreak;
    
    let statusChange = null;
    
    if (meetsRequirements && !hadBadge) {
      tutor.stats.feedbackMetrics.coachingBadge.earnedAt = new Date();
      statusChange = 'earned';
      console.log(`🎓 ${tutor.name} earned Coaching-Oriented badge! (rate: ${feedbackRate.toFixed(1)}%, quality: ${avgQuality.toFixed(1)}, streak: ${currentStreak})`);
    } else if (!meetsRequirements && hadBadge) {
      statusChange = 'removed';
      console.log(`⚠️ ${tutor.name} lost Coaching-Oriented badge (rate: ${feedbackRate.toFixed(1)}%, quality: ${avgQuality.toFixed(1)}, streak: ${currentStreak})`);
    }
    
    await tutor.save();
    
    console.log(`📊 [Eval] ${tutor.name}: ${feedbackCount}/${recentLessons.length} lessons with feedback (${Math.round(feedbackRate)}%), quality: ${Math.round(avgQuality)}, streak: ${currentStreak}`);
    
    return {
      earned: meetsRequirements && !hadBadge,
      removed: !meetsRequirements && hadBadge,
      metrics: {
        feedbackRate: Math.round(feedbackRate),
        avgQuality: Math.round(avgQuality),
        streak: currentStreak,
        lessons: recentLessons.length
      }
    };
    
  } catch (error) {
    console.error(`❌ Error evaluating tutor ${tutor._id}:`, error.message);
    return { earned: false, removed: false, error: error.message };
  }
}

/**
 * Run badge evaluation for all tutors
 */
async function runBadgeEvaluation() {
  console.log('🎓 [CRON] Starting coaching badge evaluation...');
  
  try {
    const tutors = await User.find({ 
      userType: 'tutor',
      tutorApproved: true 
    });
    
    let badgesEarned = 0;
    let badgesRemoved = 0;
    let evaluated = 0;
    let errors = 0;
    
    for (const tutor of tutors) {
      const result = await evaluateTutorForBadge(tutor);
      
      if (result.earned) badgesEarned++;
      if (result.removed) badgesRemoved++;
      if (result.error) errors++;
      evaluated++;
    }
    
    console.log(`✅ [CRON] Badge evaluation complete:`);
    console.log(`   Tutors evaluated: ${evaluated}`);
    console.log(`   Badges earned: ${badgesEarned}`);
    console.log(`   Badges removed: ${badgesRemoved}`);
    console.log(`   Errors: ${errors}`);
    
  } catch (error) {
    console.error('❌ [CRON] Error running badge evaluation:', error);
  }
}

/**
 * Schedule the cron job to run daily at 2 AM
 */
function startCoachingBadgeEvaluator() {
  // Run daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    await runBadgeEvaluation();
  });
  
  console.log('✅ Coaching badge evaluator scheduled (runs daily at 2 AM)');
}

module.exports = {
  startCoachingBadgeEvaluator,
  runBadgeEvaluation,
  evaluateTutorForBadge,
  CRITERIA
};





