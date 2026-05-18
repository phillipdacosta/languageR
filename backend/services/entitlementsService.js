/**
 * Entitlements service — single source of truth for premium gating.
 *
 * Never read user.subscription.* directly anywhere else; always go through
 * one of these helpers. This keeps the gate composition (e.g. "what does
 * premium include this month?") in one place.
 *
 * GUIDING PRINCIPLE: premium = everything free has + AI on top.
 * Never gate a feature OUT of premium. If something exists for free, it
 * exists for premium too. Premium-only additions go alongside, never
 * instead of, the free experience.
 */

const PREMIUM_ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * Is this user currently entitled to premium-tier features?
 * Tutors are not premium-gated (they have a different monetization model).
 */
function isPremium(user) {
  if (!user) return false;
  if (user.userType === 'tutor') return false;
  const sub = user.subscription;
  if (!sub) return false;
  if (sub.tier !== 'premium') return false;
  return PREMIUM_ACTIVE_STATUSES.has(sub.status || 'active');
}

/**
 * Should the AI re-grade this student's learning plan after every lesson?
 * Premium-only addition. Free students fall back to mastery-based rule
 * promotion (see masteryService.js).
 */
function canUseAdaptivePlanAi(user) {
  return isPremium(user);
}

/**
 * Should the post-lesson hook compute struggle-matched material
 * recommendations? YES for both tiers — recommendations are a baseline
 * student-progress feature, not a premium-only one. Premium gets this
 * AND the AI plan refresh.
 */
function shouldRecommendMaterialsPostLesson(user) {
  if (!user) return false;
  return user.userType === 'student';
}

/**
 * Cooldown (in days) before a student can change their learning goal.
 * Premium = no cooldown. Free = 7 days, with a separate grace window
 * (handled in learningPlanService) for the very first edit after onboarding.
 */
function getGoalChangeCooldownDays(user) {
  return isPremium(user) ? 0 : 7;
}

/**
 * Daily micro-task allowance — placeholder for the future Daily Journey Loop.
 */
function getDailyMicroTaskLimit(user) {
  return isPremium(user) ? Infinity : 1;
}

/**
 * Lightweight summary, safe to send to the client so the UI can render
 * upsell prompts without exposing implementation details.
 */
function describeForClient(user) {
  const premium = isPremium(user);
  const isStudent = user?.userType === 'student';
  return {
    tier: premium ? 'premium' : 'free',
    status: user?.subscription?.status || 'active',
    features: {
      adaptivePlanAi: premium,
      goalChangeCooldownDays: getGoalChangeCooldownDays(user),
      materialRecommendationsPostLesson: isStudent,
      dailyMicroTaskLimit: premium ? null : 1
    }
  };
}

module.exports = {
  isPremium,
  canUseAdaptivePlanAi,
  shouldRecommendMaterialsPostLesson,
  getGoalChangeCooldownDays,
  getDailyMicroTaskLimit,
  describeForClient
};
