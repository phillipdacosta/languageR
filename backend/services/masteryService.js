/**
 * Mastery service — single source of truth for "did the student earn it?"
 *
 * Phase promotion in a learning plan must be tied to demonstrated mastery,
 * not just to lesson count. A clock-based gate produces false promotions
 * (mediocre students advance) and false stagnation (strong students stuck).
 *
 * This module:
 *   1. Reduces a LessonAnalysis into a single 0–100 mastery score.
 *   2. Decides whether the current phase should advance, given the
 *      rolling history of mastery scores in that phase.
 *
 * Used by both the free (rule-based) and premium (AI-driven) paths so that
 * promotion logic stays consistent — the AI can recommend "advance" but
 * the floor/ceiling here is the safety net.
 */

// ── Tunables ─────────────────────────────────────────────────────
// Floor: never advance a phase before this many lessons. Even an
// excellent first lesson shouldn't skip a phase — the data is too noisy.
const MIN_LESSONS_PER_PHASE = 3;

// Ceiling: if a student has done this many lessons in a single phase,
// advance regardless of score. Prevents stagnation and keeps the
// roadmap moving even when scoring is harsh or noisy.
const MAX_LESSONS_PER_PHASE = 10;

// Mastery threshold to advance once minimum lessons are met.
const MASTERY_ADVANCE_THRESHOLD = 70;

// Window of recent scores we average over (most-recent-first).
const MASTERY_WINDOW = 3;

// Minimum mastery score we ever assign — keeps a single bad lesson
// from tanking the phase's rolling average to 0.
const MIN_LESSON_SCORE = 10;

// ── Chapter graduation tunables (Batch 1) ────────────────────────
// Stricter than phase advancement to prevent premature graduations.
const CHAPTER_GRADUATION_THRESHOLD = 80;        // avg of last 5 ≥ 80
const CHAPTER_GRADUATION_MIN_LESSONS = 5;       // min lessons in phase 4
const CHAPTER_GRADUATION_WINDOW = 5;            // window for the rolling avg

// ── Decay tunables (Batch 1) ─────────────────────────────────────
const DECAY_THRESHOLD = 50;                     // avg of last 3 < 50
const DECAY_MIN_LESSONS_IN_CHAPTER = 5;         // require ≥ 5 lessons in chapter (G14)
const DECAY_MIN_DISTINCT_TUTORS = 2;            // require ≥ 2 distinct tutors (G12)

// ── Calibration tunables (Batch 5) ───────────────────────────────
const CALIBRATION_LESSON_WINDOW = 3;            // first 3 lessons used for calibration check
const CALIBRATION_LOCK_AFTER_LESSON = 5;        // after lesson 5 in chapter 1, lock
const CALIBRATION_PROMOTE_THRESHOLD = 85;       // avg of first 3 > 85 → promote
const CALIBRATION_DEMOTE_THRESHOLD = 40;        // avg of first 3 < 40 → demote

// ── Tutor vote bias (Batch 10) ───────────────────────────────────
const TUTOR_VOTE_THRESHOLD_DELTA = 5;           // each advance vote -5, each hold +5

// Component weights when ALL signals are present.
const WEIGHTS_FULL = {
  grammar: 0.30,
  fluency: 0.25,
  pronunciation: 0.15,
  confidence: 0.15,
  proficiencyChange: 0.15
};

// Component weights when pronunciation isn't present.
const WEIGHTS_NO_PRONUNCIATION = {
  grammar: 0.35,
  fluency: 0.30,
  pronunciation: 0.00,
  confidence: 0.20,
  proficiencyChange: 0.15
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function toNumber(n) {
  const x = typeof n === 'number' ? n : parseFloat(n);
  return Number.isFinite(x) ? x : null;
}

/**
 * Convert qualitative proficiency change into a 0–100 component.
 * +improved = 100, maintained = 60, declined = 30, first_lesson = 60 (neutral).
 */
function proficiencyChangeScore(change) {
  switch (change) {
    case 'improved':     return 100;
    case 'maintained':   return 60;
    case 'declined':     return 30;
    case 'first_lesson': return 60;
    default:             return 60;
  }
}

/**
 * Reduce a LessonAnalysis into a single 0–100 mastery score for *this*
 * lesson. Pure function — no DB, no side effects.
 *
 * Returns null if the analysis is missing required data and we can't
 * meaningfully score it (caller should not push a null into history).
 */
function computeMasteryScore(analysis) {
  if (!analysis) return null;

  const grammar       = toNumber(analysis.grammarAnalysis?.accuracyScore);
  const fluency       = toNumber(analysis.fluencyAnalysis?.overallFluencyScore);
  const pronunciation = toNumber(analysis.pronunciationAnalysis?.overallScore);
  const confidence    = toNumber(analysis.overallAssessment?.confidence);
  const change        = analysis.progressionMetrics?.proficiencyChange;

  // We need at least grammar OR fluency to score meaningfully.
  if (grammar === null && fluency === null) return null;

  const weights = pronunciation !== null ? WEIGHTS_FULL : WEIGHTS_NO_PRONUNCIATION;

  // For any missing component, redistribute its weight evenly across
  // the present components (so total weight = 1.0 always).
  const present = {
    grammar:           grammar           !== null,
    fluency:           fluency           !== null,
    pronunciation:     pronunciation     !== null,
    confidence:        confidence        !== null,
    proficiencyChange: !!change
  };
  const presentKeys = Object.keys(present).filter(k => present[k]);
  const missingWeight = Object.entries(weights)
    .filter(([k]) => !present[k])
    .reduce((sum, [, w]) => sum + w, 0);
  const bonus = presentKeys.length > 0 ? missingWeight / presentKeys.length : 0;
  const w = {};
  presentKeys.forEach(k => { w[k] = weights[k] + bonus; });

  let score = 0;
  if (present.grammar)           score += clamp(grammar, 0, 100)           * w.grammar;
  if (present.fluency)           score += clamp(fluency, 0, 100)           * w.fluency;
  if (present.pronunciation)     score += clamp(pronunciation, 0, 100)     * w.pronunciation;
  if (present.confidence)        score += clamp(confidence, 0, 100)        * w.confidence;
  if (present.proficiencyChange) score += proficiencyChangeScore(change)   * w.proficiencyChange;

  return Math.max(MIN_LESSON_SCORE, Math.round(score));
}

/**
 * Average of the last MASTERY_WINDOW scores in the current phase.
 * Returns null if no scores yet.
 */
function rollingMastery(scores) {
  if (!Array.isArray(scores) || scores.length === 0) return null;
  const window = scores.slice(-MASTERY_WINDOW);
  const sum = window.reduce((a, b) => a + b, 0);
  return Math.round(sum / window.length);
}

/**
 * Sum the threshold delta from active tutor votes on a phase.
 * Each `advance` vote lowers the bar by TUTOR_VOTE_THRESHOLD_DELTA;
 * each `hold` vote raises it. Expired votes are ignored (G16).
 * One vote per tutor — latest wins (G29) is enforced at write time.
 */
function applyTutorVoteBias(threshold, tutorVotes) {
  if (!Array.isArray(tutorVotes) || tutorVotes.length === 0) return threshold;
  const now = Date.now();
  let delta = 0;
  for (const v of tutorVotes) {
    if (!v || !v.expiresAt || new Date(v.expiresAt).getTime() < now) continue;
    if (v.vote === 'advance') delta -= TUTOR_VOTE_THRESHOLD_DELTA;
    else if (v.vote === 'hold') delta += TUTOR_VOTE_THRESHOLD_DELTA;
  }
  return Math.max(0, Math.min(100, threshold + delta));
}

/**
 * Decide whether the current phase should advance.
 *
 * Returns one of:
 *   - { advance: false, reason: 'min_lessons', message }
 *   - { advance: false, reason: 'mastery_below_threshold', message }
 *   - { advance: true,  reason: 'mastery_met', message }
 *   - { advance: true,  reason: 'max_lessons_safety', message }
 *   - { advance: false, reason: 'last_phase_in_chapter', message } — phase 4 of chapter, defer to evaluateChapterGraduation
 *
 * @param {Object} phase           The current phase object on the plan
 * @param {Boolean} hasMorePhases  Is there a next phase to advance to in this chapter?
 */
function evaluateAdvancement(phase, hasMorePhases) {
  if (!hasMorePhases) {
    // Last phase in chapter — caller should run evaluateChapterGraduation instead.
    // We do NOT short-circuit here; we return a distinct reason so the caller
    // knows to take the chapter-graduation path.
    return { advance: false, reason: 'last_phase_in_chapter', message: 'Last phase in chapter — defer to chapter graduation.' };
  }
  const lessons = phase?.lessonsCompleted || 0;
  const avg = rollingMastery(phase?.lessonScores);
  const threshold = applyTutorVoteBias(MASTERY_ADVANCE_THRESHOLD, phase?.tutorVotes);

  if (lessons < MIN_LESSONS_PER_PHASE) {
    return {
      advance: false,
      reason: 'min_lessons',
      message: `Need at least ${MIN_LESSONS_PER_PHASE} lessons in this phase before advancing.`,
      mastery: avg
    };
  }

  if (lessons >= MAX_LESSONS_PER_PHASE) {
    return {
      advance: true,
      reason: 'max_lessons_safety',
      message: `Reached ${MAX_LESSONS_PER_PHASE}-lesson cap for this phase — advancing to keep momentum.`,
      mastery: avg
    };
  }

  if (avg !== null && avg >= threshold) {
    return {
      advance: true,
      reason: 'mastery_met',
      message: `Rolling mastery ${avg} ≥ adjusted threshold ${threshold}.`,
      mastery: avg,
      thresholdUsed: threshold
    };
  }

  return {
    advance: false,
    reason: 'mastery_below_threshold',
    message: avg === null
      ? 'No mastery data yet.'
      : `Rolling mastery ${avg} below threshold ${threshold}.`,
    mastery: avg,
    thresholdUsed: threshold
  };
}

/**
 * Decide whether the LAST phase of a chapter has met the bar to graduate
 * the student to the next chapter. Stricter than phase advancement —
 * see CHAPTER_GRADUATION_*.
 *
 * Tutor votes apply the same bias.
 */
function evaluateChapterGraduation(phase) {
  const lessons = phase?.lessonsCompleted || 0;
  const scores = phase?.lessonScores || [];
  const window = scores.slice(-CHAPTER_GRADUATION_WINDOW);
  const avg = window.length > 0 ? Math.round(window.reduce((a, b) => a + b, 0) / window.length) : null;
  const threshold = applyTutorVoteBias(CHAPTER_GRADUATION_THRESHOLD, phase?.tutorVotes);

  if (lessons < CHAPTER_GRADUATION_MIN_LESSONS) {
    return {
      graduate: false,
      reason: 'chapter_min_lessons',
      message: `Need at least ${CHAPTER_GRADUATION_MIN_LESSONS} lessons in the final phase before graduating.`,
      mastery: avg,
      thresholdUsed: threshold
    };
  }

  if (avg !== null && avg >= threshold) {
    return {
      graduate: true,
      reason: 'chapter_graduated',
      message: `Rolling mastery (last ${window.length}) ${avg} ≥ chapter graduation threshold ${threshold}.`,
      mastery: avg,
      thresholdUsed: threshold
    };
  }

  return {
    graduate: false,
    reason: 'chapter_mastery_below',
    message: avg === null ? 'No mastery data yet.' : `Rolling mastery ${avg} below chapter graduation threshold ${threshold}.`,
    mastery: avg,
    thresholdUsed: threshold
  };
}

/**
 * Decide whether the student's mastery has decayed enough to warrant a
 * polite demotion to the previous chapter. Two-step rule (G15):
 *   1) First trip → returns { decay: 'warn' } so caller can surface a banner.
 *   2) Second trip while decayWarnings already > 0 → returns { decay: 'demote' }.
 *
 * Requires ≥ 2 distinct tutors in the rolling window (G12) and ≥ 5
 * lessons in the current chapter (G14) to fire at all.
 *
 * @param {Object} plan             The full learning plan
 * @param {Number} chapterLessons   Total lessons completed in current chapter
 *                                  (sum of all phases' lessonsCompleted)
 */
function evaluateDecay(plan, chapterLessons) {
  if (chapterLessons < DECAY_MIN_LESSONS_IN_CHAPTER) {
    return { decay: 'none', reason: 'chapter_min_lessons', message: 'Not enough lessons in chapter yet.' };
  }
  // Pull last MASTERY_WINDOW scores + tutorIds from the current phase only
  // (we don't cross-phase decay; if they just advanced phases, scores reset effectively).
  const phase = plan.phases?.[plan.currentPhaseIndex];
  if (!phase) return { decay: 'none', reason: 'no_phase', message: 'No active phase.' };

  const scores = (phase.lessonScores || []).slice(-MASTERY_WINDOW);
  const tutorIds = (phase.lessonTutorIds || []).slice(-MASTERY_WINDOW).filter(Boolean).map(String);
  if (scores.length < MASTERY_WINDOW) {
    return { decay: 'none', reason: 'window_not_full', message: 'Need a full window of recent lessons.' };
  }
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const distinctTutors = new Set(tutorIds).size;
  if (distinctTutors < DECAY_MIN_DISTINCT_TUTORS) {
    return { decay: 'none', reason: 'single_tutor', message: 'Decay requires multi-tutor signal.' };
  }
  if (avg >= DECAY_THRESHOLD) {
    return { decay: 'none', reason: 'mastery_ok', message: `Mastery ${avg} ≥ ${DECAY_THRESHOLD}.` };
  }

  // Decay condition met. First trip = warn, second trip = demote.
  if ((plan.decayWarnings || 0) === 0) {
    return {
      decay: 'warn',
      reason: 'decay_warning',
      message: `Rolling mastery ${avg} below ${DECAY_THRESHOLD} — surfacing soft warning.`,
      mastery: avg
    };
  }
  return {
    decay: 'demote',
    reason: 'chapter_demoted',
    message: `Rolling mastery ${avg} below ${DECAY_THRESHOLD} after warning — demote one chapter.`,
    mastery: avg
  };
}

/**
 * Map the current phase's mastery + lesson count to a coarse, *student-facing*
 * progress state. Deliberately hides the raw score and the 70 threshold —
 * those are diagnostic signals for the planner, not grades for the student.
 *
 * Returns one of:
 *   - 'getting_started' — fewer than the floor; data is too noisy to score
 *   - 'building'        — past the floor, mastery still well below the bar
 *   - 'progressing'     — past the floor, climbing toward the bar
 *   - 'ready_soon'      — at or above the bar; advancement on the next lesson or two
 *   - 'wrapping_up'     — within 2 lessons of the ceiling; the system will move them on
 *
 * Also returns a 0–100 `windowProgressPercent` for a non-misleading bar
 * (lesson floor → ceiling), and a few raw fields the caller can pass through
 * if it wants to render a debug/details view. The student-facing UI should
 * use only `state` + `windowProgressPercent`.
 *
 * @param {Object}  phase           The current phase object
 * @param {Boolean} hasMorePhases   Is there a next phase to advance to?
 */
function phaseProgressState(phase, hasMorePhases = true) {
  const lessons = phase?.lessonsCompleted || 0;
  const avg = rollingMastery(phase?.lessonScores);
  const threshold = applyTutorVoteBias(MASTERY_ADVANCE_THRESHOLD, phase?.tutorVotes);

  let windowProgressPercent = 0;
  if (lessons > 0 && lessons <= MIN_LESSONS_PER_PHASE) {
    windowProgressPercent = Math.round((lessons / MIN_LESSONS_PER_PHASE) * 50);
  } else if (lessons > MIN_LESSONS_PER_PHASE) {
    const span = Math.max(1, MAX_LESSONS_PER_PHASE - MIN_LESSONS_PER_PHASE);
    const extra = Math.min(lessons - MIN_LESSONS_PER_PHASE, span);
    windowProgressPercent = 50 + Math.round((extra / span) * 50);
  }

  // Last-phase-of-chapter is gated by chapter graduation, not phase
  // advancement — but the student-facing label is the same shape, so we
  // just defer state-naming to the same buckets. The "ready_soon" branch
  // here will line up with the chapter graduation banner the planner shows.
  if (lessons === 0) {
    return { state: 'getting_started', windowProgressPercent, lessons };
  }
  if (lessons < MIN_LESSONS_PER_PHASE) {
    return { state: 'getting_started', windowProgressPercent, lessons };
  }
  if (lessons >= MAX_LESSONS_PER_PHASE - 1) {
    return { state: 'wrapping_up', windowProgressPercent, lessons };
  }
  if (avg !== null && avg >= threshold) {
    return { state: 'ready_soon', windowProgressPercent, lessons };
  }
  // Past the floor, mastery present but below threshold — distinguish
  // "barely climbing" from "well on the way" so the copy can be honest.
  if (avg !== null && avg >= Math.max(40, threshold - 20)) {
    return { state: 'progressing', windowProgressPercent, lessons };
  }
  return { state: 'building', windowProgressPercent, lessons };
}

/**
 * Calibration check (chapter 1 only, first 3 lessons). Returns:
 *   - { calibration: 'promote' }  → avg-3 > CALIBRATION_PROMOTE_THRESHOLD, bump chapter +1
 *   - { calibration: 'demote'  }  → avg-3 < CALIBRATION_DEMOTE_THRESHOLD, bump chapter -1 (or generate fundamentals)
 *   - { calibration: 'hold'    }  → no action this lesson
 */
function evaluateCalibration(plan, chapterLessons) {
  if (plan.calibrationLockedAt) return { calibration: 'hold', reason: 'locked' };
  if (plan.chapterIndex !== 0 && chapterLessons === 0) return { calibration: 'hold', reason: 'no_data' };
  if (chapterLessons < CALIBRATION_LESSON_WINDOW) return { calibration: 'hold', reason: 'window_not_full' };
  if (chapterLessons >= CALIBRATION_LOCK_AFTER_LESSON) return { calibration: 'hold', reason: 'past_window' };

  // Compute avg of FIRST CALIBRATION_LESSON_WINDOW scores in chapter (phase 1).
  const phase = plan.phases?.[0];
  const scores = (phase?.lessonScores || []).slice(0, CALIBRATION_LESSON_WINDOW);
  if (scores.length < CALIBRATION_LESSON_WINDOW) return { calibration: 'hold', reason: 'window_not_full' };
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  if (avg > CALIBRATION_PROMOTE_THRESHOLD && plan.chapterIndex < 5) {
    return { calibration: 'promote', reason: 'calibration_promoted', message: `Calibration avg ${avg} > ${CALIBRATION_PROMOTE_THRESHOLD}.`, mastery: avg };
  }
  if (avg < CALIBRATION_DEMOTE_THRESHOLD) {
    return { calibration: 'demote', reason: 'calibration_demoted', message: `Calibration avg ${avg} < ${CALIBRATION_DEMOTE_THRESHOLD}.`, mastery: avg };
  }
  return { calibration: 'hold', reason: 'within_band', message: `Calibration avg ${avg} within band — no action.`, mastery: avg };
}

module.exports = {
  computeMasteryScore,
  rollingMastery,
  evaluateAdvancement,
  evaluateChapterGraduation,
  evaluateDecay,
  evaluateCalibration,
  phaseProgressState,
  applyTutorVoteBias,
  // Tunables — exported so docs/tests can reference them
  MIN_LESSONS_PER_PHASE,
  MAX_LESSONS_PER_PHASE,
  MASTERY_ADVANCE_THRESHOLD,
  MASTERY_WINDOW,
  CHAPTER_GRADUATION_THRESHOLD,
  CHAPTER_GRADUATION_MIN_LESSONS,
  CHAPTER_GRADUATION_WINDOW,
  DECAY_THRESHOLD,
  DECAY_MIN_LESSONS_IN_CHAPTER,
  DECAY_MIN_DISTINCT_TUTORS,
  CALIBRATION_LESSON_WINDOW,
  CALIBRATION_LOCK_AFTER_LESSON,
  CALIBRATION_PROMOTE_THRESHOLD,
  CALIBRATION_DEMOTE_THRESHOLD,
  TUTOR_VOTE_THRESHOLD_DELTA
};
