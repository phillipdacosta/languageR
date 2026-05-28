/**
 * Struggle priority scorer.
 *
 * Replaces the old `calculateErrorPriority` heuristic (impact + occurrences)
 * with a multiplicative scoring function over orthogonal factors. Each
 * factor returns a multiplier; the final score is the product, clamped
 * to [0, 1].
 *
 *   score(struggle) =
 *       impact_weight        // pedagogical impact (per-skill from taxonomy)
 *     × recency_factor       // exp(-Δlessons / τ)
 *     × frequency_factor     // log(1 + occurrences)
 *     × goal_alignment       // skill matches student's goal
 *     × belief_uncertainty   // (1 - P(mastered)) — don't grind mastered skills
 *     × transcription_risk   // ≤ 1, lower for likely ASR artifacts
 *
 * All factors are bounded so a runaway in one can't dominate. The
 * shape is deliberately tunable — every constant lives at the top of
 * this file.
 *
 * Pure function — no I/O, no DB. Tests live in a sibling file (when added).
 */

const taxonomy = require('./skillTaxonomy');
const bayes = require('./bayesianMastery');

// ── Tunables ─────────────────────────────────────────────────────
// Multipliers are pre-normalized so a "typical" struggle scores around
// 0.3–0.5 and a critical recurring blocker scores 0.8+.
const FACTOR_BOUNDS = Object.freeze({
  impact:        { min: 0.4, max: 1.5 },
  recency:       { min: 0.25, max: 1.0 },
  frequency:     { min: 0.4, max: 1.1 },
  goalAlignment: { min: 0.7, max: 1.0 },
  beliefUncertainty: { min: 0.2, max: 1.0 },
  transcriptionRisk: { min: 0.25, max: 1.0 }
});

// Recency: how fast a struggle's signal decays as lessons accumulate.
// τ = 4 lessons → after 4 lessons, the impact is e^-1 ≈ 0.37 of its
// fresh value. After 8 lessons it's 0.14. Matches the "last 5 lessons"
// rolling window we already use for struggle aggregation.
const RECENCY_TAU_LESSONS = 4;

// Frequency: bounded log so high-occurrence events still rank above
// low-occurrence, but a transcription artifact spammed 20 times can't
// outrank a single critical error.
function frequencyFactor(occurrences) {
  const n = Math.max(0, Number.isFinite(occurrences) ? occurrences : 0);
  // log1p(n)/log1p(8) hits ~1.0 at 8 occurrences; bounded below.
  const raw = Math.log1p(n) / Math.log1p(8);
  return clamp(0.4 + raw * 0.7, FACTOR_BOUNDS.frequency.min, FACTOR_BOUNDS.frequency.max);
}

function recencyFactor(lessonsAgo) {
  const k = Math.max(0, Number.isFinite(lessonsAgo) ? lessonsAgo : 0);
  const raw = Math.exp(-k / RECENCY_TAU_LESSONS);
  return clamp(raw, FACTOR_BOUNDS.recency.min, FACTOR_BOUNDS.recency.max);
}

function impactFactor(skill, declaredImpact) {
  // skill.impactWeight is in (0, 5]. Map to a (0.4–1.5) multiplier.
  // We also fold the GPT-declared per-lesson impact (low/med/high) as a
  // small modulation on top — so a typically-medium skill flagged as
  // 'high' this lesson scores slightly hotter.
  const base = skill?.impactWeight ?? 1.0;
  const declaredAdj =
    declaredImpact === 'high' ? 1.1 :
    declaredImpact === 'low'  ? 0.9 :
    1.0;
  return clamp(base * declaredAdj * 0.65, FACTOR_BOUNDS.impact.min, FACTOR_BOUNDS.impact.max);
}

function goalAlignmentFactor(skill, goalType) {
  if (!skill || !skill.goalTags || skill.goalTags.length === 0) {
    return 0.85; // unknown goal alignment — neutral-ish
  }
  if (!goalType) return 0.85;
  return skill.goalTags.includes(goalType)
    ? FACTOR_BOUNDS.goalAlignment.max
    : FACTOR_BOUNDS.goalAlignment.min;
}

function beliefUncertaintyFactor(belief, threshold = bayes.MASTERY_THRESHOLD) {
  // Don't grind already-mastered skills. P(mastered) high → factor low.
  // Also avoid floor-zero so a "barely above threshold" skill can still
  // bubble up if it recurs — students do regress.
  const pMastered = bayes.probabilityMastered(belief, threshold);
  const factor = 1 - pMastered * 0.8;
  return clamp(factor, FACTOR_BOUNDS.beliefUncertainty.min, FACTOR_BOUNDS.beliefUncertainty.max);
}

function transcriptionRiskFactor(isLikelyTranscriptionError) {
  // ASR-suspect errors are not silenced — they're heavily down-weighted
  // so they only surface if everything else points to them being real.
  // (Old code zeroed them out, which we found hid real recurring issues
  // when ASR happened to glitch on the same word twice.)
  return isLikelyTranscriptionError ? FACTOR_BOUNDS.transcriptionRisk.min : FACTOR_BOUNDS.transcriptionRisk.max;
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Score one error/struggle.
 *
 * @param {Object} struggle
 *   {
 *     skillId,                                      // canonicalized
 *     occurrences,                                  // this lesson
 *     impact,                                       // 'low'|'medium'|'high'
 *     isLikelyTranscriptionError,                   // bool
 *     lessonsAgo                                    // 0 = current lesson
 *   }
 * @param {Object} context
 *   {
 *     language,
 *     goalType,                                     // student's goal
 *     belief                                        // Beta belief for this skillId (or null)
 *   }
 * @returns {{ score, factors }} — score ∈ [0, 1], factors broken out
 *   for observability/debug. Production code should log the breakdown
 *   on the focus-selection decision.
 */
function scoreStruggle(struggle, context) {
  const skill = taxonomy.getSkill(struggle.skillId);

  const factors = {
    impact: impactFactor(skill, struggle.impact),
    recency: recencyFactor(struggle.lessonsAgo),
    frequency: frequencyFactor(struggle.occurrences),
    goalAlignment: goalAlignmentFactor(skill, context?.goalType),
    beliefUncertainty: beliefUncertaintyFactor(context?.belief),
    transcriptionRisk: transcriptionRiskFactor(struggle.isLikelyTranscriptionError)
  };

  const raw =
    factors.impact *
    factors.recency *
    factors.frequency *
    factors.goalAlignment *
    factors.beliefUncertainty *
    factors.transcriptionRisk;

  // Normalize to [0, 1] using the product of factor maxes as the ceiling.
  const ceiling =
    FACTOR_BOUNDS.impact.max *
    FACTOR_BOUNDS.recency.max *
    FACTOR_BOUNDS.frequency.max *
    FACTOR_BOUNDS.goalAlignment.max *
    FACTOR_BOUNDS.beliefUncertainty.max *
    FACTOR_BOUNDS.transcriptionRisk.max;

  const score = clamp(raw / ceiling, 0, 1);

  return { score, factors };
}

module.exports = {
  scoreStruggle,
  // Exposed for testing / introspection
  _factors: {
    impactFactor,
    recencyFactor,
    frequencyFactor,
    goalAlignmentFactor,
    beliefUncertaintyFactor,
    transcriptionRiskFactor
  },
  RECENCY_TAU_LESSONS,
  FACTOR_BOUNDS
};
