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
 */
async function evaluateTutorForBadge(tutor) {
  const feedbackService = new FeedbackQualityService();
  
  try {
    // Get last 30 completed lessons
    const recentLessons = await Lesson.find({
      tutorId: tutor._id,
      status: 'completed',
      actualCallEndTime: { $exists: true }
    })
    .sort({ actualCallEndTime: -1 })
    .limit(CRITERIA.ROLLING_WINDOW)
    .lean();
    
    if (recentLessons.length < CRITERIA.MIN_LESSONS) {
      // Not enough lessons yet
      return { earned: false, removed: false, reason: 'not enough lessons' };
    }
    
    // Check which lessons have feedback
    const lessonIds = recentLessons.map(l => l._id);
    const analyses = await LessonAnalysis.find({
      lessonId: { $in: lessonIds },
      'tutorNote.text': { $exists: true, $ne: null }
    }).lean();
    
    const feedbackMap = new Map();
    analyses.forEach(a => {
      if (a.tutorNote && a.tutorNote.text) {
        const qualityScore = feedbackService.calculateQualityScore(a.tutorNote);
        feedbackMap.set(a.lessonId.toString(), {
          qualityScore,
          wordCount: a.tutorNote.text.split(/\s+/).filter(w => w.length > 0).length,
          hasHomework: !!a.tutorNote.homework,
          hasQuickImpression: !!a.tutorNote.quickImpression
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
    
    // Check for consecutive feedback streak
    let currentStreak = 0;
    for (const lesson of recentLessons) {
      if (feedbackMap.has(lesson._id.toString())) {
        currentStreak++;
      } else {
        break; // Streak broken
      }
    }
    
    // Eligibility check
    const meetsRequirements = 
      feedbackRate >= CRITERIA.MIN_FEEDBACK_RATE &&
      avgQuality >= CRITERIA.MIN_QUALITY_SCORE &&
      currentStreak >= CRITERIA.MIN_STREAK;
    
    const hadBadge = tutor.stats?.feedbackMetrics?.coachingBadge?.active || false;
    
    // Update tutor stats
    if (!tutor.stats) tutor.stats = {};
    if (!tutor.stats.feedbackMetrics) tutor.stats.feedbackMetrics = {};
    
    tutor.stats.feedbackMetrics.totalLessonsCompleted = recentLessons.length;
    tutor.stats.feedbackMetrics.totalFeedbackProvided = feedbackCount;
    tutor.stats.feedbackMetrics.feedbackRate = Math.round(feedbackRate);
    tutor.stats.feedbackMetrics.averageFeedbackQuality = Math.round(avgQuality);
    tutor.stats.feedbackMetrics.lastQualityUpdate = new Date();
    
    if (!tutor.stats.feedbackMetrics.coachingBadge) {
      tutor.stats.feedbackMetrics.coachingBadge = {};
    }
    
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





