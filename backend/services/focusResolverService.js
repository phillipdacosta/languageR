/**
 * Next-lesson focus resolver.
 *
 * Single source of truth for "what skill should the next lesson focus
 * on?" — used by both the free (rule-based) and premium (AI-driven)
 * paths in learningPlanService. The AI path may further polish the
 * focus sentence on top of the resolver's pick, but the chosen
 * skillId / source is always the resolver's responsibility.
 *
 * Resolution order (highest wins):
 *
 *   1. Active free-text tutor override        (legacy "adjust_focus")
 *   2. Active structured tutor skill priority (NEW — severity-weighted)
 *   3. Upstream diagnosis on a stuck struggle (NEW — if top struggle
 *      has been "stuck" for STUCK_AFTER_N_OUTCOMES focus cycles)
 *   4. Aggregator top struggle                (NEW — rolling priority)
 *   5. Active phase fallback                  (phase title / focus areas)
 *
 * Every pick carries a `source` so the home widget and tutor briefing
 * can render the *why*. Every pick is also recorded into
 * plan.focusHistory so we close the loop.
 *
 * The resolver does NOT save the plan. The caller (learningPlanService)
 * owns persistence.
 */

const struggleAggregator = require('./struggleAggregator');
const skillGraph = require('./skillGraph');
const taxonomy = require('./skillTaxonomy');
const focusHistory = require('./focusHistoryService');
const bayes = require('./bayesianMastery');

// ── Focus-line templates ───────────────────────────────────────────
// Deterministic. Locale-aware downstream renderers can swap the EN
// strings for i18n keys; for v1 the focus line is stored as English
// and the existing i18n pipeline handles translation.

function focusLineForAggregator(displayName, appearances) {
  if (!appearances || appearances <= 1) {
    return `Focus on ${displayName.toLowerCase()} — your top recurring struggle from recent lessons.`;
  }
  return `Focus on ${displayName.toLowerCase()} — it has come up across multiple lessons and is your top recurring struggle.`;
}

function focusLineForUpstream(displayName, symptomDisplay) {
  return `Focus on ${displayName.toLowerCase()} first — it's the foundation behind your recent struggle with ${symptomDisplay.toLowerCase()}.`;
}

function focusLineForTutorPriority(displayName, tutorName) {
  const t = tutorName && tutorName.trim() ? tutorName.trim() : 'Your tutor';
  return `${t} flagged ${displayName.toLowerCase()} as a priority — make that the through-line of this lesson.`;
}

function focusLineForPhaseDefault(phase) {
  if (!phase) return '';
  const focus = (phase.focusAreas || []).filter(s => typeof s === 'string' && s.trim())[0];
  if (focus) return `Focus on ${focus.replace(/[.!?]+$/, '').toLowerCase()} during your next lesson.`;
  if (phase.description) return phase.description.split(/(?<=[.!?])\s+/)[0].trim();
  if (phase.title) return `Work on ${phase.title.replace(/[.!?]+$/, '').toLowerCase()}.`;
  return '';
}

// ── Helpers ────────────────────────────────────────────────────────

function readBelief(plan, skillId) {
  if (!plan?.skillBeliefs) return null;
  if (typeof plan.skillBeliefs.get === 'function') return plan.skillBeliefs.get(skillId) || null;
  return plan.skillBeliefs[skillId] || null;
}

/**
 * Active tutor skill priorities — non-decayed, sorted by severity
 * descending, then setAt descending. Mutates the plan to drop decayed
 * entries (so the next read doesn't re-evaluate them).
 */
function getActiveTutorSkillPriorities(plan, now = Date.now()) {
  if (!plan?.tutorSkillPriorities || plan.tutorSkillPriorities.length === 0) return [];
  const kept = [];
  const dropped = [];
  for (const p of plan.tutorSkillPriorities) {
    if (!p?.skillId || !p.setAt) {
      dropped.push(p);
      continue;
    }
    const setAtMs = new Date(p.setAt).getTime();
    const decayMs = (p.decayDays || 14) * 24 * 60 * 60 * 1000;
    if (setAtMs + decayMs >= now) kept.push(p);
    else dropped.push(p);
  }
  if (dropped.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[focusResolver] Dropping ${dropped.length} decayed tutor skill priorities`);
    plan.tutorSkillPriorities = kept;
  }
  return kept
    .slice()
    .sort((a, b) => {
      const sevDiff = (b.severity || 2) - (a.severity || 2);
      if (sevDiff !== 0) return sevDiff;
      return new Date(b.setAt).getTime() - new Date(a.setAt).getTime();
    });
}

function getMostRecentFreeTextOverride(plan) {
  if (!plan?.tutorOverrides) return null;
  const recent = plan.tutorOverrides
    .filter(o => o && o.action === 'adjust_focus' && o.note)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  return recent || null;
}

// ── Main entry point ───────────────────────────────────────────────

/**
 * Resolve and APPLY the next-lesson focus on the plan.
 *
 * Mutates `plan` in place — sets:
 *   plan.nextLessonFocus
 *   plan.activeFocusSkillId
 *   plan.activeFocusSource
 *   plan.activeFocusSetAt
 *   plan.focusHistory (appended via focusHistoryService.recordFocus)
 *
 * Caller must save the plan afterward.
 *
 * @param {Object} opts
 *   {
 *     plan,                    // LearningPlan doc
 *     language,
 *     lessonAnalysis = null,   // the just-completed analysis (drives evidence)
 *     fromLessonId = null,
 *     // For testing / overrides:
 *     aggregator = struggleAggregator,
 *   }
 *
 * @returns {Promise<{
 *   skillId,
 *   source,
 *   focusLine,
 *   displayName,
 *   diagnosedFrom: skillId|null,
 *   aggregatorTop: {skillId, score, displayName, appearances}|null
 * }>}
 */
async function resolveAndApply(opts = {}) {
  const {
    plan,
    language,
    lessonAnalysis = null,
    fromLessonId = null,
    aggregator = struggleAggregator
  } = opts;

  if (!plan) throw new Error('[focusResolver] plan is required');
  if (!language) throw new Error('[focusResolver] language is required');

  const now = new Date();

  // Resolve the aggregator's top struggle first — it's used by multiple
  // branches below.
  let aggregatorTop = null;
  let aggregateResult = null;
  try {
    aggregateResult = await aggregator.aggregateStruggles({
      studentId: plan.studentId,
      language,
      plan,
      windowSize: struggleAggregator.DEFAULT_WINDOW,
      limit: 5
    });
    if (aggregateResult.struggles && aggregateResult.struggles.length > 0) {
      const top = aggregateResult.struggles[0];
      aggregatorTop = {
        skillId: top.skillId,
        score: top.score,
        displayName: top.displayName,
        appearances: top.appearances
      };
    }
  } catch (err) {
    console.warn('[focusResolver] aggregator failed (non-blocking):', err.message);
  }

  let pick = null;
  const phase = plan.phases?.[plan.currentPhaseIndex];

  // ── 1. Free-text tutor override (legacy) ──────────────────────────
  // Kept for backward compatibility. Always wins so existing tutor
  // flows don't break. No skillId associated.
  const recentOverride = getMostRecentFreeTextOverride(plan);
  if (recentOverride) {
    plan.nextLessonFocus = recentOverride.note;
    plan.activeFocusSkillId = null;
    plan.activeFocusSource = 'tutor_override';
    plan.activeFocusSetAt = now;
    // Record into focus history even without a skillId so we still
    // know the source was a tutor override.
    focusHistory.recordFocus(plan, {
      skillId: '__free_text_override__',
      source: 'tutor_override',
      surfacedAt: now,
      fromLessonId,
      note: recentOverride.note.slice(0, 200)
    });
    return {
      skillId: null,
      source: 'tutor_override',
      focusLine: recentOverride.note,
      displayName: null,
      diagnosedFrom: null,
      aggregatorTop
    };
  }

  // ── 2. Structured tutor skill priority ────────────────────────────
  const tutorPriorities = getActiveTutorSkillPriorities(plan, now.getTime());
  if (tutorPriorities.length > 0) {
    const top = tutorPriorities[0];
    pick = {
      skillId: top.skillId,
      source: 'tutor_priority',
      diagnosedFrom: null,
      tutorName: top.tutorName,
      focusLine: focusLineForTutorPriority(
        taxonomy.displayNameFor(top.skillId, 'en'),
        top.tutorName
      )
    };
  }

  // ── 3. Upstream diagnosis when top struggle is stuck ──────────────
  if (!pick && aggregatorTop) {
    if (focusHistory.isStuck(plan, aggregatorTop.skillId)) {
      const beliefs = plan.skillBeliefs;
      const diag = skillGraph.diagnoseRootBlocker(aggregatorTop.skillId, beliefs);
      if (diag.isUpstream && diag.blockerSkillId !== aggregatorTop.skillId) {
        const blockerDisplay = taxonomy.displayNameFor(diag.blockerSkillId, 'en');
        pick = {
          skillId: diag.blockerSkillId,
          source: 'upstream_diagnosis',
          diagnosedFrom: aggregatorTop.skillId,
          focusLine: focusLineForUpstream(blockerDisplay, aggregatorTop.displayName)
        };
      }
    }
  }

  // ── 4. Aggregator top struggle (default path) ─────────────────────
  if (!pick && aggregatorTop) {
    pick = {
      skillId: aggregatorTop.skillId,
      source: 'aggregator',
      diagnosedFrom: null,
      focusLine: focusLineForAggregator(aggregatorTop.displayName, aggregatorTop.appearances)
    };
  }

  // ── 5. Phase-default fallback ─────────────────────────────────────
  if (!pick) {
    const line = focusLineForPhaseDefault(phase);
    if (line) {
      plan.nextLessonFocus = line;
      plan.activeFocusSkillId = null;
      plan.activeFocusSource = 'phase_default';
      plan.activeFocusSetAt = now;
      focusHistory.recordFocus(plan, {
        skillId: '__phase_default__',
        source: 'phase_default',
        surfacedAt: now,
        fromLessonId,
        note: line.slice(0, 200)
      });
    }
    return {
      skillId: null,
      source: 'phase_default',
      focusLine: plan.nextLessonFocus || '',
      displayName: null,
      diagnosedFrom: null,
      aggregatorTop
    };
  }

  // Apply the pick.
  const beliefBefore = readBelief(plan, pick.skillId);
  plan.nextLessonFocus = pick.focusLine;
  plan.activeFocusSkillId = pick.skillId;
  plan.activeFocusSource = pick.source;
  plan.activeFocusSetAt = now;

  focusHistory.recordFocus(plan, {
    skillId: pick.skillId,
    source: pick.source,
    surfacedAt: now,
    fromLessonId,
    diagnosedFrom: pick.diagnosedFrom,
    beliefBefore,
    note: pick.focusLine.slice(0, 200)
  });

  return {
    skillId: pick.skillId,
    source: pick.source,
    focusLine: pick.focusLine,
    displayName: taxonomy.displayNameFor(pick.skillId, 'en'),
    diagnosedFrom: pick.diagnosedFrom,
    aggregatorTop,
    beliefBefore: beliefBefore ? bayes.posteriorMean(beliefBefore) : null
  };
}

module.exports = {
  resolveAndApply,
  // Exposed for testing + admin endpoints
  getActiveTutorSkillPriorities,
  getMostRecentFreeTextOverride,
  focusLineForAggregator,
  focusLineForUpstream,
  focusLineForTutorPriority,
  focusLineForPhaseDefault
};
