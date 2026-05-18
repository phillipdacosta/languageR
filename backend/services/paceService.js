/**
 * Pace service — translates a student's stated timeline into concrete
 * pacing knobs the rest of the system can act on.
 *
 * Until Batch 13, `goal.timeline` was a passive string ('few_months',
 * 'no_rush', 'specific_date') that we passed into the AI prompt as a
 * label and otherwise ignored. The student's stated urgency had no
 * effect on:
 *   - phase count per chapter
 *   - estimatedLessons per phase
 *   - weekly lesson cadence
 *
 * This service makes the timeline matter:
 *   - Computes a coarse `paceCategory` (relaxed / steady / focused / urgent)
 *     from `timeline` + `targetDate`.
 *   - Exposes derived knobs:
 *       phaseCount               - 3 / 4 / 5 phases per chapter
 *       estimatedLessonsPerPhase - 3-5 lessons baseline
 *       lessonFrequency          - human label for weeklyRecommendations
 *       selfStudyMinutes         - daily self-study suggestion
 *
 * Both the rule-based path (free students) and the AI path (premium)
 * call this so they produce consistent pacing. The AI prompt is told
 * the pace category and the target knobs; it can refine wording but
 * the deterministic floor/ceiling here is the safety net.
 */

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

// Pace categories. Ordered loosely by urgency.
const PACE = {
  RELAXED: 'relaxed',   // no_rush, no targetDate
  STEADY:  'steady',    // few_months, ≥ 12 weeks out, or no urgency hints
  FOCUSED: 'focused',   // specific_date, 6–12 weeks out
  URGENT:  'urgent'     // specific_date, < 6 weeks out
};

// Recommendation thresholds — when goal + targetDate suggest the structured
// chapter roadmap is the wrong shape and the student would be better served
// by the unframed single-lessons path. See Batch 13 voice-and-framing notes.
const EXAM_PREP_TIGHT_WEEKS = 12;
const PROFESSIONAL_TIGHT_WEEKS = 4;

function normalizeTargetDate(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const s = String(raw).trim();
    if (!s) return null;
    const datePart = s.includes('T') ? s.split('T')[0] : s;
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  if (Array.isArray(raw) && raw.length >= 3) {
    const y = Number(raw[0]);
    const m = Number(raw[1]);
    const day = Number(raw[2]);
    if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(day)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }
  if (typeof raw === 'object' && raw !== null && 'year' in raw && 'month' in raw && 'day' in raw) {
    const y = Number(raw.year);
    const m = Number(raw.month);
    const day = Number(raw.day);
    if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(day)) {
      return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

/**
 * Compute weeks remaining until the student's stated target date.
 * Returns null if no target date is set or it's already past.
 */
function weeksToTarget(goal) {
  const nd = normalizeTargetDate(goal?.targetDate);
  if (!nd) return null;
  const [yy, mm, dd] = nd.split('-').map(Number);
  const endOfDayUtc = Date.UTC(yy, mm - 1, dd, 23, 59, 59, 999);
  const diff = endOfDayUtc - Date.now();
  if (diff <= 0) return 0;
  return Math.max(0, Math.floor(diff / MS_PER_WEEK));
}

/**
 * Decide pace from the goal. The rules below are deliberately coarse —
 * we have very little signal at this stage and want stable behaviour.
 *
 *   targetDate < 6 weeks      → urgent
 *   targetDate 6–12 weeks     → focused
 *   targetDate > 12 weeks     → steady
 *   timeline === 'few_months' → focused
 *   timeline === 'no_rush'    → relaxed
 *   default                   → steady
 */
function paceCategory(goal) {
  const wk = weeksToTarget(goal);
  if (wk !== null) {
    if (wk <= 6) return PACE.URGENT;
    if (wk <= 12) return PACE.FOCUSED;
    return PACE.STEADY;
  }
  const t = (goal?.timeline || '').toLowerCase();
  if (t === 'few_months') return PACE.FOCUSED;
  if (t === 'no_rush') return PACE.RELAXED;
  return PACE.STEADY;
}

/**
 * Translate paceCategory into concrete pacing knobs. These are the
 * authoritative numbers — both the AI prompt and the rule-based path
 * read from this map so the student gets a consistent shape regardless
 * of tier.
 *
 * Knobs:
 *   phaseCount               — how many phases the chapter should have.
 *                               Tighter timelines = fewer phases (3),
 *                               relaxed timelines = more depth (5).
 *   estimatedLessonsPerPhase — baseline lesson budget per phase before
 *                               mastery floor/ceiling apply (3–10 from
 *                               masteryService).
 *   lessonFrequency          — human-readable copy for
 *                               weeklyRecommendations.lessonFrequency.
 *   selfStudyMinutes         — between-lesson self-study suggestion.
 */
function paceKnobs(category) {
  switch (category) {
    case PACE.URGENT:
      return {
        phaseCount: 3,
        estimatedLessonsPerPhase: 3,
        lessonFrequency: '3-4x per week',
        selfStudyMinutes: 25
      };
    case PACE.FOCUSED:
      return {
        phaseCount: 3,
        estimatedLessonsPerPhase: 4,
        lessonFrequency: '2-3x per week',
        selfStudyMinutes: 20
      };
    case PACE.STEADY:
      return {
        phaseCount: 4,
        estimatedLessonsPerPhase: 5,
        lessonFrequency: '2x per week',
        selfStudyMinutes: 15
      };
    case PACE.RELAXED:
    default:
      return {
        phaseCount: 5,
        estimatedLessonsPerPhase: 5,
        lessonFrequency: '1-2x per week',
        selfStudyMinutes: 10
      };
  }
}

/**
 * Convenience: bundle category + weeks + knobs for the goal in one call.
 * The shape returned is meant to be passed directly into the AI prompt
 * (so the model can read pace + weeks together) and into
 * weeklyRecommendations on the plan.
 */
function describe(goal) {
  const category = paceCategory(goal);
  return {
    category,
    weeksToTarget: weeksToTarget(goal),
    timeline: goal?.timeline || 'no_rush',
    targetDate: goal?.targetDate || null,
    ...paceKnobs(category)
  };
}

/**
 * Produce a short, human-friendly line we inject into AI prompts so the
 * model knows the cadence to design around. We deliberately do NOT
 * include the raw targetDate in the line — the model doesn't need to
 * count days, it just needs to feel the urgency level.
 */
function buildAiPromptLine(goal) {
  const d = describe(goal);
  const wkLabel = d.weeksToTarget !== null ? ` (${d.weeksToTarget} weeks remaining)` : '';
  return `PACE: ${d.category}${wkLabel} — design ~${d.phaseCount} phases, ~${d.estimatedLessonsPerPhase} lessons each, expect "${d.lessonFrequency}" cadence.`;
}

/**
 * Produce the weeklyRecommendations object that goes onto the plan.
 * Caller may merge with AI-supplied focusBetweenLessons if desired.
 */
function buildWeeklyRecommendations(goal, focusBetweenLessons = '') {
  const d = describe(goal);
  return {
    lessonFrequency: d.lessonFrequency,
    selfStudyMinutes: d.selfStudyMinutes,
    focusBetweenLessons: focusBetweenLessons || ''
  };
}

/**
 * Recommend either the structured roadmap or the unframed single-lessons
 * path based on the student's goal + timeline. Used by the goal-pick UIs
 * (onboarding + SetGoalComponent) to surface a soft, non-blocking
 * suggestion — the student can always override.
 *
 *   exam_prep + specific_date ≤ 12 weeks       → 'single_lessons'
 *   professional + specific_date ≤ 4 weeks     → 'single_lessons'
 *   any other combo                            → 'plan'
 *
 * Deliberately conservative: only `specific_date` triggers a downgrade —
 * `few_months` and `no_rush` stay on the roadmap because we can't say the
 * deadline is actually tight without a real date.
 */
function recommendedMode(goal) {
  if (!goal?.type || !goal?.timeline) return 'plan';
  if (goal.timeline !== 'specific_date') return 'plan';
  const wk = weeksToTarget(goal);
  if (wk === null) return 'plan';
  // exam_prep + specific_date: always recommend single_lessons (kept in sync
  // with frontend `shared/goal-pace.helper.ts`).
  if (goal.type === 'exam_prep') return 'single_lessons';
  if (goal.type === 'professional' && wk <= PROFESSIONAL_TIGHT_WEEKS) return 'single_lessons';
  return 'plan';
}

module.exports = {
  PACE,
  weeksToTarget,
  paceCategory,
  paceKnobs,
  describe,
  buildAiPromptLine,
  buildWeeklyRecommendations,
  recommendedMode,
  EXAM_PREP_TIGHT_WEEKS,
  PROFESSIONAL_TIGHT_WEEKS
};
