/**
 * Rolling struggle aggregator — single source of truth for prioritized
 * struggles across a window of recent lessons.
 *
 * Used by:
 *   - GET /api/progress/struggles/:language  (what the student sees)
 *   - learningPlanService nextLessonFocus    (what the next lesson does)
 *
 * The two surfaces MUST agree on what the student's #1 struggle is.
 * This module is the canonical answer.
 *
 * Inputs are kept minimal — the caller provides studentId, language,
 * and optionally the plan (so we can read beliefs + goal). Aggregator
 * fetches its own LessonAnalysis docs because the query is small and
 * cached well at the DB layer.
 *
 * Backward compat: handles both new-format (`skillId` already stamped
 * on errors) and legacy-format (free-text `issue` strings) by running
 * the canonicalizer on legacy errors. New lessons should write skillId
 * at analyze-time; legacy lessons get canonicalized at read-time.
 */

const LessonAnalysis = require('../models/LessonAnalysis');
const taxonomy = require('./skillTaxonomy');
const scorer = require('./struggleScorer');
const bayes = require('./bayesianMastery');
const signalFusion = require('./signalFusionService');

const DEFAULT_WINDOW = 5;       // last N completed lessons
const DEFAULT_TOP_N = 8;        // surface up to this many struggles
const MIN_APPEARANCES_FOR_SURFACE = 1; // be lenient — recurrence is rewarded by scoring

/**
 * Pull the Beta belief for a skill from the plan's beliefs Map.
 * Returns null if not present (caller treats as prior).
 */
function getBelief(plan, skillId) {
  if (!plan || !plan.skillBeliefs) return null;
  if (typeof plan.skillBeliefs.get === 'function') {
    return plan.skillBeliefs.get(skillId) || null;
  }
  if (plan.skillBeliefs[skillId]) return plan.skillBeliefs[skillId];
  return null;
}

/**
 * Extract per-skill evidence from a single LessonAnalysis. Output is a
 * Map keyed by skillId with merged fields ready for scoring.
 *
 * Sources merged (in priority order):
 *   1. topErrors[]                                       — most authoritative
 *   2. progressionMetrics.persistentChallenges[]         — recurring
 *   3. errorPatterns[]                                   — granular grammar
 *   4. areasForImprovement[]                             — broad
 *   5. recommendedFocus[]                                — analyst suggestion
 *   6. grammarAnalysis.mistakeTypes[]                    — tutor assessments
 *   7. pronunciationAnalysis + fluencyAnalysis             — Azure / GPT metrics
 *
 * If two entries normalize to the same skillId, we keep the strongest
 * (highest occurrences, highest impact, isLikelyTranscriptionError=false).
 */
function extractEvidence(analysis, language) {
  const evidenceBySkill = new Map();
  const fold = (skillId, ev) => {
    if (!skillId) return;
    const existing = evidenceBySkill.get(skillId);
    if (!existing) {
      evidenceBySkill.set(skillId, { ...ev });
      return;
    }
    existing.occurrences += ev.occurrences;
    if (impactRank(ev.impact) > impactRank(existing.impact)) {
      existing.impact = ev.impact;
    }
    // A "clean" signal in any source overrides a transcription-suspect flag.
    if (existing.isLikelyTranscriptionError && !ev.isLikelyTranscriptionError) {
      existing.isLikelyTranscriptionError = false;
    }
    if (ev.examples && (!existing.examples || existing.examples.length < ev.examples.length)) {
      existing.examples = ev.examples;
    }
  };

  const resolveSkillId = (rawIssue, alreadyResolved) => {
    if (alreadyResolved && typeof alreadyResolved === 'string' && alreadyResolved.length > 0) {
      return alreadyResolved;
    }
    if (!rawIssue) return null;
    return taxonomy.canonicalize(rawIssue, language).skillId;
  };

  // 1. topErrors[]
  (analysis.topErrors || []).forEach(e => {
    if (!e) return;
    const id = resolveSkillId(e.issue, e.skillId);
    if (!id) return;
    fold(id, {
      skillId: id,
      occurrences: Math.max(1, e.occurrences || 1),
      impact: e.impact || 'medium',
      isLikelyTranscriptionError: !!e.isLikelyTranscriptionError,
      examples: e.examples || [],
      sourceField: 'topErrors',
      rawIssue: e.issue
    });
  });

  // 2. persistentChallenges (lighter weight — already aggregated by GPT)
  (analysis.progressionMetrics?.persistentChallenges || []).forEach(c => {
    if (typeof c !== 'string') return;
    const id = resolveSkillId(c, null);
    if (!id) return;
    fold(id, {
      skillId: id,
      occurrences: 1,
      impact: 'medium',
      isLikelyTranscriptionError: false,
      sourceField: 'persistentChallenges',
      rawIssue: c
    });
  });

  // 3. errorPatterns[]
  (analysis.errorPatterns || []).forEach(p => {
    if (!p) return;
    const id = resolveSkillId(p.pattern, p.skillId);
    if (!id) return;
    fold(id, {
      skillId: id,
      occurrences: Math.max(1, p.frequency || 1),
      impact: p.severity || 'medium',
      isLikelyTranscriptionError: false,
      examples: p.examples || [],
      sourceField: 'errorPatterns',
      rawIssue: p.pattern
    });
  });

  // 4. areasForImprovement[]
  (analysis.areasForImprovement || []).forEach(a => {
    if (typeof a !== 'string') return;
    const id = resolveSkillId(a, null);
    if (!id) return;
    fold(id, {
      skillId: id,
      occurrences: 1,
      impact: 'low',
      isLikelyTranscriptionError: false,
      sourceField: 'areasForImprovement',
      rawIssue: a
    });
  });

  // 5. recommendedFocus[]
  (analysis.recommendedFocus || []).forEach(r => {
    if (typeof r !== 'string') return;
    const id = resolveSkillId(r, null);
    if (!id) return;
    fold(id, {
      skillId: id,
      occurrences: 1,
      impact: 'low',
      isLikelyTranscriptionError: false,
      sourceField: 'recommendedFocus',
      rawIssue: r
    });
  });

  // 6. grammarAnalysis.mistakeTypes[] — populated by tutor-sourced
  // analyses (manual feedback flow) and sometimes by GPT alongside
  // errorPatterns. Treated like errorPatterns but with severity passed
  // through directly.
  (analysis.grammarAnalysis?.mistakeTypes || []).forEach(m => {
    if (!m) return;
    const id = resolveSkillId(m.type, null);
    if (!id) return;
    fold(id, {
      skillId: id,
      occurrences: Math.max(1, m.frequency || 1),
      impact: m.severity || 'medium',
      isLikelyTranscriptionError: false,
      sourceField: 'grammarAnalysis.mistakeTypes',
      rawIssue: m.type
    });
  });

  // 7. Pronunciation (Azure) + fluency (GPT) — objective channels.
  const fusionEvidence = signalFusion.extractPronunciationFluencyEvidence(analysis, language);
  signalFusion.mergeIntoEvidenceMap(evidenceBySkill, fusionEvidence);

  return evidenceBySkill;
}

function impactRank(impact) {
  return impact === 'high' ? 3 : impact === 'medium' ? 2 : impact === 'low' ? 1 : 0;
}

/**
 * Aggregate struggles for a student across a window of recent lessons.
 *
 * @param {Object} opts
 *   {
 *     studentId,         // ObjectId or string
 *     language,
 *     plan,              // optional LearningPlan doc (for beliefs + goal)
 *     windowSize,        // default 5
 *     limit,             // default 8
 *     excludeTrial,      // default true
 *     excludeQuickOfficeHours, // default true
 *   }
 *
 * @returns {Promise<{
 *   hasEnoughData: bool,
 *   lessonsAnalyzed: number,
 *   struggles: Array<{
 *     skillId,
 *     displayName,
 *     category,
 *     cefr,
 *     score,
 *     factors,           // scoring breakdown — observability
 *     appearances,       // number of lessons in window where this skill showed up
 *     totalOccurrences,
 *     lastSeenAt,
 *     highestImpact,
 *     belief,            // current Beta belief (or null)
 *     examples,          // up to 3 examples from errorPatterns / topErrors
 *     evidence           // per-lesson per-source breakdown
 *   }>
 * }>}
 */
async function aggregateStruggles(opts = {}) {
  const {
    studentId,
    language,
    plan = null,
    windowSize = DEFAULT_WINDOW,
    limit = DEFAULT_TOP_N,
    excludeTrial = true,
    excludeQuickOfficeHours = true
  } = opts;

  if (!studentId || !language) {
    return { hasEnoughData: false, lessonsAnalyzed: 0, struggles: [] };
  }

  // Fetch more than the window if we may filter some out.
  const fetchLimit = Math.min(50, Math.max(windowSize * 3, 15));

  const studentIdStr = String(studentId);
  const populatePath = (excludeTrial || excludeQuickOfficeHours) ? {
    path: 'lessonId',
    select: 'isTrialLesson isOfficeHours officeHoursType'
  } : null;

  let query = LessonAnalysis.find({
    studentId: studentIdStr,
    language,
    status: 'completed'
  })
    .sort({ lessonDate: -1 })
    .limit(fetchLimit)
    .select(
      'topErrors errorPatterns progressionMetrics areasForImprovement recommendedFocus ' +
      'grammarAnalysis fluencyAnalysis pronunciationAnalysis lessonDate tutorId lessonId'
    );

  if (populatePath) query = query.populate(populatePath);
  const all = await query.lean();

  const filtered = all
    .filter(lesson => {
      const meta = lesson.lessonId;
      if (!meta) return true;
      if (excludeTrial && meta.isTrialLesson === true) return false;
      if (excludeQuickOfficeHours && meta.isOfficeHours === true && meta.officeHoursType === 'quick') return false;
      return true;
    })
    .slice(0, windowSize);

  if (filtered.length === 0) {
    return { hasEnoughData: false, lessonsAnalyzed: 0, struggles: [] };
  }

  // ── Aggregate ────────────────────────────────────────────────────
  // skillId → { occurrences, score (max across lessons), factors snapshot, examples, ... }
  const merged = new Map();
  const goalType = plan?.goal?.type || null;

  for (let i = 0; i < filtered.length; i++) {
    const lesson = filtered[i];
    const lessonsAgo = i; // 0 = most recent

    const evidenceBySkill = extractEvidence(lesson, language);
    for (const [skillId, ev] of evidenceBySkill.entries()) {
      const belief = getBelief(plan, skillId);
      const { score, factors } = scorer.scoreStruggle(
        {
          skillId,
          occurrences: ev.occurrences,
          impact: ev.impact,
          isLikelyTranscriptionError: ev.isLikelyTranscriptionError,
          lessonsAgo
        },
        { language, goalType, belief }
      );

      let entry = merged.get(skillId);
      if (!entry) {
        entry = {
          skillId,
          appearances: 0,
          totalOccurrences: 0,
          highestImpact: ev.impact,
          lastSeenAt: lesson.lessonDate,
          // Score aggregation: max across lessons + small additive bonus
          // for repeated appearances. Keeps a single high-impact recent
          // lesson dominant, but ensures a stubbornly-recurring lower-
          // impact issue can still climb above it.
          bestScore: 0,
          bestFactors: null,
          examples: [],
          evidence: []
        };
        merged.set(skillId, entry);
      }

      entry.appearances += 1;
      entry.totalOccurrences += ev.occurrences;
      if (impactRank(ev.impact) > impactRank(entry.highestImpact)) {
        entry.highestImpact = ev.impact;
      }
      if (new Date(lesson.lessonDate) > new Date(entry.lastSeenAt)) {
        entry.lastSeenAt = lesson.lessonDate;
      }
      if (score > entry.bestScore) {
        entry.bestScore = score;
        entry.bestFactors = factors;
      }
      if (ev.examples && ev.examples.length > 0 && entry.examples.length < 3) {
        for (const ex of ev.examples) {
          if (entry.examples.length >= 3) break;
          if (ex && ex.original && !entry.examples.find(e => e.original === ex.original)) {
            entry.examples.push(ex);
          }
        }
      }
      entry.evidence.push({
        lessonId: lesson.lessonId,
        lessonDate: lesson.lessonDate,
        lessonsAgo,
        sourceField: ev.sourceField,
        rawIssue: ev.rawIssue,
        occurrences: ev.occurrences,
        impact: ev.impact,
        score
      });
    }
  }

  // Final score with recurrence bonus and decoration.
  const struggles = [];
  for (const entry of merged.values()) {
    if (entry.appearances < MIN_APPEARANCES_FOR_SURFACE) continue;
    // Recurrence bonus: each additional appearance adds 8% (capped at +30%).
    const recurrenceBonus = Math.min(0.3, (entry.appearances - 1) * 0.08);
    const finalScore = Math.min(1, entry.bestScore * (1 + recurrenceBonus));

    const skill = taxonomy.getSkill(entry.skillId);
    struggles.push({
      skillId: entry.skillId,
      displayName: taxonomy.displayNameFor(entry.skillId, 'en'),
      category: skill?.category || 'grammar',
      cefr: skill?.cefr ?? null,
      score: Number(finalScore.toFixed(4)),
      factors: entry.bestFactors,
      appearances: entry.appearances,
      totalOccurrences: entry.totalOccurrences,
      lastSeenAt: entry.lastSeenAt,
      highestImpact: entry.highestImpact,
      belief: getBelief(plan, entry.skillId),
      examples: entry.examples,
      evidence: entry.evidence,
      isSyntheticSkill: !!skill?._synthetic
    });
  }

  struggles.sort((a, b) => b.score - a.score);

  return {
    hasEnoughData: filtered.length >= Math.min(windowSize, 3),
    lessonsAnalyzed: filtered.length,
    struggles: struggles.slice(0, limit)
  };
}

/**
 * Build the per-skill evidence map for ONE lesson (no DB call). Used by
 * the post-lesson Bayesian update so the analyzer's emitted skillIds
 * are honored without re-canonicalizing in two places.
 *
 * Returns the same Map as the private extractor.
 */
function extractEvidenceFromLesson(analysis, language) {
  return extractEvidence(analysis, language);
}

module.exports = {
  aggregateStruggles,
  extractEvidenceFromLesson,
  // Tunables exposed for tests / docs
  DEFAULT_WINDOW,
  DEFAULT_TOP_N
};
