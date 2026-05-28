/**
 * Closed-loop focus tracker.
 *
 * Every time the system (or a tutor) sets a `nextLessonFocus`, we record:
 *   - which skillId was picked
 *   - what the student's Bayesian belief was at that moment
 *   - what produced the pick (aggregator, upstream diagnosis, tutor)
 *
 * After the next lesson lands, we settle the open focus entry:
 *   - measure belief shift (post − pre)
 *   - classify outcome: 'improved', 'stuck', 'worsened', 'untested'
 *
 * Why this matters
 *   1. Lets the priority scorer demote skills we've already focused
 *      multiple times without progress (so we don't grind).
 *   2. Surfaces "we said X 3x without improvement" to tutors.
 *   3. Provides the dataset for the offline counterfactual policy
 *      learner (future).
 *
 * Storage: lives on the LearningPlan as `focusHistory[]`. Append-only,
 * pruned to MAX_HISTORY entries oldest-first.
 */

const bayes = require('./bayesianMastery');

const MAX_HISTORY = 100;             // ~6 months at 1 lesson/week
const STUCK_THRESHOLD_DELTA = 0.03;  // |Δ posterior mean| under this counts as 'stuck'
const IMPROVED_THRESHOLD_DELTA = 0.05;
const STUCK_AFTER_N_OUTCOMES = 3;    // 3 'stuck' settlements escalates the skill

const OUTCOMES = Object.freeze(['pending', 'improved', 'stuck', 'worsened', 'superseded']);
const SOURCES = Object.freeze([
  'aggregator',          // standard rolling-struggle pick
  'upstream_diagnosis',  // redirected to a prereq
  'tutor_priority',      // structured tutor input
  'tutor_override',      // legacy free-text tutor override
  'phase_default',       // first lesson in a new phase, no analysis yet
  'manual'
]);

function summarizeBelief(belief) {
  if (!belief) return { mean: bayes.posteriorMean(null), ess: 0 };
  return {
    mean: bayes.posteriorMean(belief),
    ess: bayes.effectiveSampleSize(belief)
  };
}

/**
 * Record a new focus. Pure — mutates the plan but does not save. The
 * caller is responsible for plan.save().
 *
 * If a pending focus already exists for the same skill, this entry
 * supersedes it (rare — only happens when the system re-runs on the
 * same lesson). The previous pending entry is marked 'superseded'.
 *
 * @param {Object} plan      — LearningPlan doc (mutated in place)
 * @param {Object} params
 *   {
 *     skillId,
 *     source,                  // one of SOURCES
 *     surfacedAt = new Date(),
 *     fromLessonId = null,     // the lesson whose analysis drove this pick
 *     beliefBefore = null,     // current Beta belief on the skill (snapshot)
 *     diagnosedFrom = null,    // if source === 'upstream_diagnosis', the original surface skillId
 *     note = ''
 *   }
 */
function recordFocus(plan, params) {
  if (!plan) throw new Error('[focusHistory] plan is required');
  if (!params || !params.skillId) throw new Error('[focusHistory] skillId is required');
  if (!SOURCES.includes(params.source)) {
    throw new Error(`[focusHistory] invalid source "${params.source}" (one of ${SOURCES.join(', ')})`);
  }

  plan.focusHistory = plan.focusHistory || [];

  // Supersede any pending entry for the same skill.
  for (const entry of plan.focusHistory) {
    if (entry.outcome === 'pending' && entry.skillId === params.skillId) {
      entry.outcome = 'superseded';
      entry.settledAt = new Date();
    }
  }

  plan.focusHistory.push({
    skillId: params.skillId,
    source: params.source,
    surfacedAt: params.surfacedAt || new Date(),
    fromLessonId: params.fromLessonId || null,
    diagnosedFrom: params.diagnosedFrom || null,
    note: params.note || '',
    beliefBefore: params.beliefBefore ? {
      alpha: params.beliefBefore.alpha,
      beta: params.beliefBefore.beta,
      meanAtSurface: summarizeBelief(params.beliefBefore).mean,
      essAtSurface: summarizeBelief(params.beliefBefore).ess
    } : null,
    beliefAfter: null,
    outcome: 'pending',
    settledAt: null,
    settledByLessonId: null,
    deltaMean: null,
    deltaEss: null
  });

  pruneHistory(plan);
}

/**
 * Settle every pending focus entry against the analysis from the lesson
 * that just landed. The Bayesian beliefs Map on the plan must already
 * have been updated for THIS lesson — call this AFTER applying evidence.
 *
 * @param {Object} plan
 * @param {Object} params
 *   {
 *     lessonId,                 // ObjectId / string
 *     evidenceBySkill,          // Map<skillId, evidenceObj> from the just-completed lesson
 *     beliefsByIdAfter,         // Map<skillId, belief> — current beliefs AFTER applying this lesson
 *     now = new Date()
 *   }
 *
 * Outcome classification:
 *   - improved   : Δmean ≥ +IMPROVED_THRESHOLD_DELTA
 *   - worsened   : Δmean ≤ -IMPROVED_THRESHOLD_DELTA
 *   - stuck      : |Δmean| < STUCK_THRESHOLD_DELTA AND skill appeared in this lesson
 *   - untested   : skill did NOT appear in this lesson (can't classify)
 *
 * 'untested' entries are left pending for the next lesson — they'll
 * settle when the skill actually shows up. This avoids penalizing the
 * tutor for not covering a flagged skill in a single specific lesson.
 */
function settleFocus(plan, params) {
  if (!plan || !plan.focusHistory) return [];
  const { lessonId, evidenceBySkill, beliefsByIdAfter, now = new Date() } = params || {};

  const settled = [];
  for (const entry of plan.focusHistory) {
    if (entry.outcome !== 'pending') continue;
    if (entry.fromLessonId && lessonId && String(entry.fromLessonId) === String(lessonId)) {
      // Can't settle on the same lesson that surfaced it.
      continue;
    }

    const wasTested = !!(evidenceBySkill && evidenceBySkill.get && evidenceBySkill.get(entry.skillId));
    if (!wasTested) continue;

    const beliefAfter = beliefsByIdAfter?.get
      ? beliefsByIdAfter.get(entry.skillId)
      : (beliefsByIdAfter || {})[entry.skillId];

    const after = summarizeBelief(beliefAfter);
    const before = entry.beliefBefore || { meanAtSurface: bayes.posteriorMean(null), essAtSurface: 0 };
    const deltaMean = after.mean - (before.meanAtSurface ?? bayes.posteriorMean(null));
    const deltaEss = after.ess - (before.essAtSurface ?? 0);

    let outcome;
    if (deltaMean >= IMPROVED_THRESHOLD_DELTA) outcome = 'improved';
    else if (deltaMean <= -IMPROVED_THRESHOLD_DELTA) outcome = 'worsened';
    else outcome = 'stuck';

    entry.beliefAfter = beliefAfter ? {
      alpha: beliefAfter.alpha,
      beta: beliefAfter.beta,
      meanAtSettle: after.mean,
      essAtSettle: after.ess
    } : null;
    entry.outcome = outcome;
    entry.settledAt = now;
    entry.settledByLessonId = lessonId || null;
    entry.deltaMean = Number(deltaMean.toFixed(4));
    entry.deltaEss = Number(deltaEss.toFixed(2));
    settled.push(entry);
  }
  return settled;
}

/**
 * Returns the most recent settled outcomes for a given skillId, newest
 * first. Used by the priority scorer to demote skills we've ground
 * unsuccessfully.
 */
function recentOutcomesForSkill(plan, skillId, n = 5) {
  if (!plan?.focusHistory) return [];
  return plan.focusHistory
    .filter(e => e.skillId === skillId && e.outcome !== 'pending' && e.outcome !== 'superseded')
    .slice(-n)
    .reverse();
}

/**
 * Is this skill "stuck" — i.e., we've focused it N+ times without
 * meaningful improvement? Used to trigger upstream diagnosis or tutor
 * escalation.
 */
function isStuck(plan, skillId, n = STUCK_AFTER_N_OUTCOMES) {
  const recent = recentOutcomesForSkill(plan, skillId, n);
  if (recent.length < n) return false;
  return recent.every(e => e.outcome === 'stuck' || e.outcome === 'worsened');
}

/**
 * Prune oldest entries beyond MAX_HISTORY. Pending entries are kept
 * regardless of age (they might still settle).
 */
function pruneHistory(plan) {
  if (!plan?.focusHistory) return;
  if (plan.focusHistory.length <= MAX_HISTORY) return;
  const pending = plan.focusHistory.filter(e => e.outcome === 'pending');
  const settled = plan.focusHistory.filter(e => e.outcome !== 'pending');
  // Keep the most recent settled entries up to (MAX_HISTORY − pending.length).
  const keepSettled = Math.max(0, MAX_HISTORY - pending.length);
  const keptSettled = settled.slice(-keepSettled);
  plan.focusHistory = [...keptSettled, ...pending];
}

/**
 * Summary stats for an admin/diagnostic view.
 */
function summarize(plan) {
  if (!plan?.focusHistory) return null;
  const total = plan.focusHistory.length;
  const counts = { pending: 0, improved: 0, stuck: 0, worsened: 0, superseded: 0 };
  for (const e of plan.focusHistory) {
    if (counts[e.outcome] !== undefined) counts[e.outcome]++;
  }
  return { total, counts };
}

module.exports = {
  recordFocus,
  settleFocus,
  recentOutcomesForSkill,
  isStuck,
  pruneHistory,
  summarize,
  OUTCOMES,
  SOURCES,
  STUCK_AFTER_N_OUTCOMES,
  STUCK_THRESHOLD_DELTA,
  IMPROVED_THRESHOLD_DELTA,
  MAX_HISTORY
};
