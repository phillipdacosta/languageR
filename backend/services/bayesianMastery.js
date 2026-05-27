/**
 * Bayesian mastery — per-skill Beta beliefs.
 *
 * Each (student, language, skillId) carries a Beta(α, β) distribution
 * representing "what fraction of attempts at this skill does the
 * student get right." The mean α/(α+β) is the point estimate; the
 * variance shrinks as evidence accumulates.
 *
 * Why Beta over rolling averages:
 *   - Confidence built in: one good lesson doesn't flip the belief
 *   - Decay applied via prior dampening, not arbitrary windowing
 *   - "Need more data" surfaces naturally (high variance)
 *   - Phase promotion can key on P(mastery > threshold) > confidence
 *
 * Pure math — no I/O, no DB. Caller persists beliefs to the LearningPlan.
 *
 * ── Tunables ─────────────────────────────────────────────────────
 *   PRIOR_ALPHA / PRIOR_BETA: weakly-informative prior. Beta(1, 1) = flat,
 *      meaning "no opinion until evidence arrives." We use Beta(1.5, 2.5)
 *      so a fresh student starts slightly below 50% mastered (matching
 *      the reality that most new skills aren't mastered) but the prior
 *      still gets overwhelmed by ~5 lessons of real data.
 *   HALF_LIFE_DAYS: how aggressively unused skills decay back toward
 *      the prior. 60 days = students who haven't practiced a skill for
 *      2 months see their belief drift halfway back to the prior.
 *   MASTERY_THRESHOLD / MASTERY_CONFIDENCE: defaults used by the gate.
 *
 * ── Beta CDF ─────────────────────────────────────────────────────
 * The probability that mastery exceeds a threshold (e.g. 0.7) requires
 * the regularized incomplete beta function I_x(α, β). We implement it
 * via Lentz's continued fraction (Numerical Recipes §6.4) — converges
 * fast for the (α, β) ranges we see in practice (rarely > 50).
 */

const PRIOR_ALPHA = 1.5;
const PRIOR_BETA = 2.5;
const HALF_LIFE_DAYS = 60;
const MASTERY_THRESHOLD = 0.7;
const MASTERY_CONFIDENCE = 0.6;
const MAX_PSEUDO_COUNTS = 100; // sanity cap to avoid runaway numerical issues

// Min/max evidence weight per lesson per skill — bounds how aggressively
// a single lesson can shift the belief. Prevents one extreme analysis
// from making the system claim "mastered" on a single excellent lesson.
const MAX_EVIDENCE_PER_LESSON = 4.0;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Construct a fresh belief, or clone-and-normalize an existing one.
 * `belief` may be null/undefined (fresh) or `{ alpha, beta, lastUpdatedAt }`.
 * Any malformed shape is reset to the prior — defensive against bad reads.
 */
function ensureBelief(belief) {
  if (!belief || typeof belief !== 'object') {
    return { alpha: PRIOR_ALPHA, beta: PRIOR_BETA, lastUpdatedAt: null };
  }
  const a = isFiniteNumber(belief.alpha) && belief.alpha > 0 ? belief.alpha : PRIOR_ALPHA;
  const b = isFiniteNumber(belief.beta) && belief.beta > 0 ? belief.beta : PRIOR_BETA;
  return {
    alpha: Math.min(a, MAX_PSEUDO_COUNTS),
    beta: Math.min(b, MAX_PSEUDO_COUNTS),
    lastUpdatedAt: belief.lastUpdatedAt ? new Date(belief.lastUpdatedAt) : null
  };
}

/**
 * Posterior mean = α / (α + β). The point estimate of mastery probability.
 */
function posteriorMean(belief) {
  const b = ensureBelief(belief);
  return b.alpha / (b.alpha + b.beta);
}

/**
 * Effective sample size = α + β − (PRIOR_ALPHA + PRIOR_BETA).
 * Roughly "how many lessons of evidence we have on this skill."
 * Clamped at 0 so a freshly-decayed belief reads as "0 lessons of evidence,"
 * which is the right downstream signal (we need more data).
 */
function effectiveSampleSize(belief) {
  const b = ensureBelief(belief);
  return Math.max(0, b.alpha + b.beta - (PRIOR_ALPHA + PRIOR_BETA));
}

/**
 * Bayesian update with bounded evidence weight.
 *
 * @param {Object} belief   — current { alpha, beta, lastUpdatedAt } or null
 * @param {Number} successWeight  — pseudo-counts of "got it right" this lesson (≥ 0)
 * @param {Number} failureWeight  — pseudo-counts of "got it wrong" this lesson (≥ 0)
 * @param {Date}   [updatedAt]    — defaults to now
 */
function update(belief, successWeight, failureWeight, updatedAt = new Date()) {
  const b = ensureBelief(belief);
  const s = clamp(isFiniteNumber(successWeight) ? successWeight : 0, 0, MAX_EVIDENCE_PER_LESSON);
  const f = clamp(isFiniteNumber(failureWeight) ? failureWeight : 0, 0, MAX_EVIDENCE_PER_LESSON);
  return {
    alpha: Math.min(b.alpha + s, MAX_PSEUDO_COUNTS),
    beta: Math.min(b.beta + f, MAX_PSEUDO_COUNTS),
    lastUpdatedAt: updatedAt
  };
}

/**
 * Apply time decay to a belief — pulls (α, β) gently back toward the
 * prior proportional to elapsed time. The prior is the "natural rest
 * state" the belief drifts toward when there's no new evidence.
 *
 * Half-life semantics: after HALF_LIFE_DAYS, half of the *accumulated*
 * evidence (everything above the prior) has decayed away.
 *
 * Always safe to call: if the belief has no lastUpdatedAt, returns it
 * unchanged.
 */
function decay(belief, now = new Date(), halfLifeDays = HALF_LIFE_DAYS) {
  const b = ensureBelief(belief);
  if (!b.lastUpdatedAt) return b;
  const elapsedMs = now.getTime() - new Date(b.lastUpdatedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return b;
  const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000);
  const decayFactor = Math.pow(0.5, elapsedDays / halfLifeDays);
  // Pull α/β back toward prior by (1 - decayFactor) fraction of their
  // excess above the prior. decayFactor=1 means no decay; 0 means fully
  // reset to prior.
  const alpha = PRIOR_ALPHA + (b.alpha - PRIOR_ALPHA) * decayFactor;
  const beta = PRIOR_BETA + (b.beta - PRIOR_BETA) * decayFactor;
  return {
    alpha: Math.max(PRIOR_ALPHA, alpha),
    beta: Math.max(PRIOR_BETA, beta),
    lastUpdatedAt: b.lastUpdatedAt
  };
}

// ── Beta CDF (regularized incomplete beta function) ────────────────
// Standard Lentz continued-fraction implementation. We need it to
// compute P(p > threshold) = 1 - I_threshold(α, β).

function logGamma(x) {
  // Lanczos approximation — accurate to ~1e-15 for x > 0.5.
  const c = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.1208650973866179e-2,
    -0.5395239384953e-5
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += c[j] / y;
  }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function betaContinuedFraction(x, a, b) {
  const MAX_ITER = 200;
  const EPS = 3e-7;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/**
 * Regularized incomplete beta I_x(a, b) = P(X ≤ x) for X ~ Beta(a, b).
 * Returns a value in [0, 1].
 */
function regularizedIncompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta =
    logGamma(a + b) - logGamma(a) - logGamma(b) +
    a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(lbeta);
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (bt * betaContinuedFraction(1 - x, b, a)) / b;
}

/**
 * P(mastery > threshold) under the current belief. Used by the phase
 * promotion gate and the upstream-diagnosis "is this prereq actually
 * unmastered?" check.
 *
 * For the default Beta(1.5, 2.5) prior and threshold=0.7, a fresh
 * student gets ~0.21 (correctly skeptical until evidence arrives).
 */
function probabilityMastered(belief, threshold = MASTERY_THRESHOLD) {
  const b = ensureBelief(belief);
  const t = clamp(isFiniteNumber(threshold) ? threshold : MASTERY_THRESHOLD, 0.01, 0.99);
  return 1 - regularizedIncompleteBeta(t, b.alpha, b.beta);
}

/**
 * Convenience: is this skill "confidently mastered" right now?
 * Both the point estimate and the confidence must meet the bar.
 */
function isMastered(belief, threshold = MASTERY_THRESHOLD, confidence = MASTERY_CONFIDENCE) {
  return probabilityMastered(belief, threshold) >= confidence;
}

/**
 * Convenience: is the student "confidently NOT mastered" — i.e., we
 * have enough data and the belief is firmly below the bar?
 */
function isUnmastered(belief, threshold = MASTERY_THRESHOLD, confidence = MASTERY_CONFIDENCE) {
  return probabilityMastered(belief, threshold) <= (1 - confidence) &&
    effectiveSampleSize(belief) >= 2;
}

/**
 * Compute success/failure pseudo-counts for a single skill from a
 * single lesson's analysis. This is the bridge between GPT output and
 * the Beta update.
 *
 * Heuristics:
 *   - Appearance in topErrors → failure evidence, weighted by impact
 *     * occurrences (capped). Default scaling: high=1.5, med=1.0, low=0.6.
 *   - Appearance in keyImprovements → success evidence (the student
 *     made noticeable progress on this skill).
 *   - "In scope but not flagged" → mild success evidence. A skill that
 *     was in scope for the lesson (because it's a prereq for one that
 *     IS flagged, or the phase focuses on it) and didn't show up as an
 *     error is a small positive signal.
 *
 * Returns { successWeight, failureWeight }.
 */
function evidenceFromAnalysis({
  errorOccurrencesByImpact = { high: 0, medium: 0, low: 0 },
  improvedCount = 0,
  inScopeNotFlagged = false
} = {}) {
  // Failure side
  const high = Math.max(0, errorOccurrencesByImpact.high || 0);
  const med  = Math.max(0, errorOccurrencesByImpact.medium || 0);
  const low  = Math.max(0, errorOccurrencesByImpact.low || 0);
  const rawFailure = high * 1.5 + med * 1.0 + low * 0.6;
  const failureWeight = Math.min(MAX_EVIDENCE_PER_LESSON, rawFailure);

  // Success side
  let successWeight = 0;
  successWeight += Math.max(0, improvedCount) * 1.2;
  if (inScopeNotFlagged && failureWeight === 0) {
    // Only counts as success if there were no errors for this skill.
    successWeight += 0.4;
  }
  successWeight = Math.min(MAX_EVIDENCE_PER_LESSON, successWeight);

  return { successWeight, failureWeight };
}

/**
 * Aggregate a set of skill beliefs into a single 0–100 "phase mastery"
 * score, for backward compatibility with the existing mastery gate.
 *
 * Weighting: each belief contributes its posterior mean * weight, where
 * weight = effectiveSampleSize + 1 (so beliefs with more evidence
 * dominate, but every belief always contributes a little).
 *
 * Returns null if no beliefs were supplied.
 */
function aggregatePhaseMastery(beliefs) {
  if (!beliefs || beliefs.length === 0) return null;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const b of beliefs) {
    const weight = effectiveSampleSize(b) + 1;
    weightedSum += posteriorMean(b) * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return null;
  return Math.round((weightedSum / totalWeight) * 100);
}

// Minimum total effective sample size across in-scope skills before the
// Bayesian gate will drive promotion (roughly ≥2 lessons of skill evidence).
const MIN_PHASE_ESS_TOTAL = 5;
// At least one skill must have this much ESS to count as "we measured something."
const MIN_SKILL_ESS_FOR_DATA = 2;

/**
 * Read beliefs for a list of skillIds from a plan Map / plain object.
 * Applies time decay at read time so stale skills don't block promotion.
 */
function readBeliefsForSkills(skillBeliefs, skillIds, now = new Date()) {
  if (!skillBeliefs || !skillIds?.length) return [];
  const out = [];
  for (const skillId of skillIds) {
    let belief = null;
    if (typeof skillBeliefs.get === 'function') {
      belief = skillBeliefs.get(skillId) || null;
    } else if (skillBeliefs[skillId]) {
      belief = skillBeliefs[skillId];
    }
    out.push({
      skillId,
      belief: belief ? decay(belief, now) : null
    });
  }
  return out;
}

/**
 * Rich snapshot for phase / chapter gates and UI caching.
 *
 * @returns {{
 *   score: number|null,           // 0–100 aggregate
 *   totalEss: number,
 *   skillsWithData: number,
 *   masteredCount: number,
 *   skillCount: number,
 *   masteredFraction: number,
 *   perSkill: Array<{ skillId, mean, ess, pMastered }>
 * }}
 */
function phaseMasterySnapshot(skillBeliefs, skillIds, now = new Date(), threshold = MASTERY_THRESHOLD) {
  const rows = readBeliefsForSkills(skillBeliefs, skillIds, now);
  if (rows.length === 0) {
    return {
      score: null,
      totalEss: 0,
      skillsWithData: 0,
      masteredCount: 0,
      skillCount: 0,
      masteredFraction: 0,
      perSkill: []
    };
  }

  const perSkill = rows.map(({ skillId, belief }) => {
    const b = ensureBelief(belief);
    const ess = effectiveSampleSize(b);
    const mean = posteriorMean(b);
    return {
      skillId,
      mean: Number(mean.toFixed(4)),
      ess: Number(ess.toFixed(2)),
      pMastered: Number(probabilityMastered(b, threshold).toFixed(4))
    };
  });

  const beliefsOnly = perSkill.map(p => {
    const row = rows.find(r => r.skillId === p.skillId);
    return row?.belief;
  });

  const totalEss = perSkill.reduce((s, p) => s + p.ess, 0);
  const skillsWithData = perSkill.filter(p => p.ess >= MIN_SKILL_ESS_FOR_DATA).length;
  const masteredCount = perSkill.filter(p => p.pMastered >= MASTERY_CONFIDENCE).length;
  const skillCount = perSkill.length;
  const masteredFraction = skillCount > 0 ? masteredCount / skillCount : 0;

  return {
    score: aggregatePhaseMastery(beliefsOnly.map(b => ensureBelief(b))),
    totalEss: Number(totalEss.toFixed(2)),
    skillsWithData,
    masteredCount,
    skillCount,
    masteredFraction: Number(masteredFraction.toFixed(3)),
    perSkill
  };
}

function hasSufficientPhaseEvidence(snapshot) {
  if (!snapshot) return false;
  return snapshot.totalEss >= MIN_PHASE_ESS_TOTAL && snapshot.skillsWithData >= 1;
}

module.exports = {
  // Constants
  PRIOR_ALPHA,
  PRIOR_BETA,
  HALF_LIFE_DAYS,
  MASTERY_THRESHOLD,
  MASTERY_CONFIDENCE,
  MAX_EVIDENCE_PER_LESSON,
  // Belief lifecycle
  ensureBelief,
  update,
  decay,
  // Queries
  posteriorMean,
  effectiveSampleSize,
  probabilityMastered,
  isMastered,
  isUnmastered,
  // Helpers
  evidenceFromAnalysis,
  aggregatePhaseMastery,
  readBeliefsForSkills,
  phaseMasterySnapshot,
  hasSufficientPhaseEvidence,
  MIN_PHASE_ESS_TOTAL,
  MIN_SKILL_ESS_FOR_DATA,
  // Exposed for tests
  _regularizedIncompleteBeta: regularizedIncompleteBeta,
  _logGamma: logGamma
};
