/**
 * cefrEstimatorService — single source of truth for the student's
 * estimated CEFR level.
 *
 * Why this exists:
 *   chapterLevel is a *bucket* that only changes on graduation/demotion.
 *   It lags real proficiency by 5+ lessons by design.
 *   We need a smoother per-student estimate for AI prompts, tutor briefings,
 *   and a milestone-gated student-facing reveal.
 *
 * Design (see docs/learning-journey/cefr-estimation.md):
 *   - Two-stage: internal estimate (always on, used by backend consumers)
 *     and revealed level (milestone-gated, shown to the student).
 *   - Aggregates LessonAnalysis records (both source: 'ai' and source: 'tutor').
 *   - Tutor scores get a flat downward bias correction (TUTOR_BIAS_OFFSET)
 *     to compensate for documented tutor inflation.
 *   - Reveal triggers: 5+ lessons (first time), chapter graduation, monthly thereafter.
 *   - Narrative is template-generated (English-only for v1; i18n is a known follow-up).
 */

const LessonAnalysis = require('../models/LessonAnalysis');

// ────────────────────────── Constants ──────────────────────────

const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const CEFR_TO_NUMERIC = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

// Tutor bias correction. Tutors tend to grade students higher than
// objective measures (encouragement bias, relationship dynamics, financial
// disincentive to label a paying student low). We shift their CEFR
// assessments down by this amount before aggregating.
//
// Default global offset. When a tutor accumulates enough comparable data
// (≥ TUTOR_BIAS_MIN_SAMPLES AI/tutor pairs on the same students), we
// replace this with their empirical mean delta — see getTutorBiasOffset.
const TUTOR_BIAS_OFFSET = 0.5;

// Per-tutor calibration parameters.
const TUTOR_BIAS_MIN_SAMPLES = 5;            // Need at least this many AI/tutor comparisons.
const TUTOR_BIAS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // Recompute weekly.
const TUTOR_BIAS_MAX_OFFSET = 2.0;           // Clamp absurd offsets (data error guards).
// Pairing window — only count an AI assessment as "comparable" to a tutor
// assessment if they're within this window of each other for the same student.
const TUTOR_BIAS_PAIRING_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

// Window of recent lessons to average over.
const ROLLING_WINDOW = 5;

// Reveal thresholds.
const REVEAL_HARD_FLOOR = 3;          // Never reveal with fewer lessons than this.
const REVEAL_FIRST_THRESHOLD = 5;     // First reveal at this lesson count.
const REVEAL_REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Agreement thresholds — measured as stddev of the bias-adjusted numeric
// levels in the rolling window. Tighter spread → higher confidence.
const AGREEMENT_HIGH_STDDEV  = 0.5;
const AGREEMENT_MEDIUM_STDDEV = 1.0;

// ────────────────────────── Bias correction ──────────────────────────

/**
 * Compute the bias-adjusted numeric level for a single LessonAnalysis.
 * AI sources pass through unchanged. Tutor sources get the offset
 * subtracted (clamped at 0.5 — never push below A1).
 *
 * Optional `tutorOffsetOverride`: per-tutor empirical offset from the
 * calibration step. Falls back to the global TUTOR_BIAS_OFFSET when not
 * provided (or null). Used by the aggregator at read-time so the latest
 * calibration is always applied without backfilling historical docs.
 *
 * Returns { level: 'B1', numeric: 3.0 } (numeric may be fractional).
 */
function computeBiasAdjusted(analysis, tutorOffsetOverride = null) {
  const raw = analysis?.overallAssessment?.proficiencyLevel;
  if (!raw || !CEFR_TO_NUMERIC[raw]) return { level: null, numeric: null };

  const rawNumeric = CEFR_TO_NUMERIC[raw];
  const isTutor = analysis.source === 'tutor';
  const offset = (typeof tutorOffsetOverride === 'number') ? tutorOffsetOverride : TUTOR_BIAS_OFFSET;
  const adjustedNumeric = isTutor
    ? Math.max(0.5, rawNumeric - offset)
    : rawNumeric;

  return {
    level: numericToLevel(adjustedNumeric),
    numeric: adjustedNumeric
  };
}

/**
 * Round a fractional numeric back to the nearest CEFR band.
 * 1.0..1.49 → A1, 1.5..2.49 → A2, etc.
 */
function numericToLevel(n) {
  if (n === null || n === undefined || isNaN(n)) return null;
  const idx = Math.max(0, Math.min(5, Math.round(n) - 1));
  return CEFR_LEVELS[idx];
}

// ────────────────────────── Aggregation ──────────────────────────

/**
 * Aggregate the rolling window of analyses into a single estimate.
 *
 * Weighting:
 *   recency_weight  = 1 + (i / N) * 0.5   (most recent ≈ 1.5×, oldest = 1×)
 *   confidence_w    = (analysis.confidence || 70) / 100
 *   final_weight    = recency × confidence
 *
 * If `tutorBiasMap` (Map<tutorAuth0Id, offset>) is provided, per-tutor
 * empirical offsets override the global TUTOR_BIAS_OFFSET stored in
 * biasAdjustedNumeric. This keeps historical docs untouched while always
 * applying the latest tutor calibration at read time.
 *
 * Inputs MUST be sorted oldest → newest. Pass at most ROLLING_WINDOW items.
 * Returns null if no usable analyses.
 */
function aggregate(analyses, tutorBiasMap = null) {
  if (!Array.isArray(analyses) || analyses.length === 0) return null;

  const window = analyses.slice(-ROLLING_WINDOW);
  const items = window
    .map((a, i) => {
      // Prefer the per-tutor calibrated value when available; else use the
      // pre-stamped global one; else compute from raw.
      let adj = null;
      const isTutor = a.source === 'tutor';
      if (isTutor && tutorBiasMap) {
        const offset = tutorBiasMap.get(String(a.tutorId));
        if (typeof offset === 'number') {
          adj = computeBiasAdjusted(a, offset).numeric;
        }
      }
      if (adj === null) adj = a.biasAdjustedNumeric ?? computeBiasAdjusted(a).numeric;
      if (adj === null) return null;

      const conf = (a.overallAssessment?.confidence ?? 70) / 100;
      const recency = 1 + (i / Math.max(1, window.length - 1)) * 0.5;
      return { numeric: adj, weight: recency * conf, source: a.source || 'ai' };
    })
    .filter(Boolean);

  if (items.length === 0) return null;

  const totalWeight = items.reduce((s, x) => s + x.weight, 0);
  const weightedAvg = items.reduce((s, x) => s + x.numeric * x.weight, 0) / totalWeight;

  // Stddev of the (unweighted) numeric levels — used for agreement signal.
  const mean = items.reduce((s, x) => s + x.numeric, 0) / items.length;
  const variance = items.reduce((s, x) => s + (x.numeric - mean) ** 2, 0) / items.length;
  const stddev = Math.sqrt(variance);

  let agreement = 'low';
  if (stddev <= AGREEMENT_HIGH_STDDEV) agreement = 'high';
  else if (stddev <= AGREEMENT_MEDIUM_STDDEV) agreement = 'medium';

  // Confidence: higher when items agree AND individual analyses are confident.
  const meanIndividualConfidence = items.reduce((s, x) => s + x.weight, 0) / items.length / 1.25;
  const agreementBonus = agreement === 'high' ? 1 : agreement === 'medium' ? 0.85 : 0.65;
  const confidencePct = Math.round(Math.max(35, Math.min(98, meanIndividualConfidence * 100 * agreementBonus)));

  const sources = {
    ai: items.filter(x => x.source === 'ai').length,
    tutor: items.filter(x => x.source === 'tutor').length
  };

  // Source divergence — only meaningful when both sources are present.
  // Compare mean numeric level by source. ≥ 1.0 levels apart = surface it.
  let divergence = null;
  if (sources.ai > 0 && sources.tutor > 0) {
    const aiItems = items.filter(x => x.source === 'ai');
    const tutorItems = items.filter(x => x.source === 'tutor');
    const aiMean = aiItems.reduce((s, x) => s + x.numeric, 0) / aiItems.length;
    const tutorMean = tutorItems.reduce((s, x) => s + x.numeric, 0) / tutorItems.length;
    const gap = tutorMean - aiMean;
    if (Math.abs(gap) >= 1.0) {
      divergence = {
        gap: Math.round(gap * 10) / 10,
        aiLevel: numericToLevel(aiMean),
        tutorLevel: numericToLevel(tutorMean),
        // 'tutor_higher' is the typical case (tutor inflation showing through);
        // 'ai_higher' is rarer but worth flagging differently.
        direction: gap > 0 ? 'tutor_higher' : 'ai_higher'
      };
    }
  }

  return {
    level: numericToLevel(weightedAvg),
    numericLevel: Math.round(weightedAvg * 10) / 10,
    confidence: confidencePct,
    agreement,
    sources,
    lessonsConsidered: items.length,
    stddev,
    divergence
  };
}

// ────────────────────────── Per-tutor bias calibration ──────────────────────────

/**
 * Compute the empirical bias offset for a single tutor.
 *
 * Method: for every tutor-source LessonAnalysis by this tutor, find the
 * closest-in-time AI-source LessonAnalysis for the SAME student in the
 * SAME language within TUTOR_BIAS_PAIRING_WINDOW_MS. Compute the mean
 * (tutor_numeric - ai_numeric) across all such pairs.
 *
 * Returns { offset, sampleSize, confidence } or null if not enough data.
 *
 * Pure-ish — reads from DB, doesn't write. Use updateTutorBiasCache to
 * persist. Result is clamped to [-TUTOR_BIAS_MAX_OFFSET, TUTOR_BIAS_MAX_OFFSET].
 */
async function computeTutorBiasFromHistory(tutorAuth0Id) {
  if (!tutorAuth0Id) return null;

  const tutorAnalyses = await LessonAnalysis.find({
    tutorId: tutorAuth0Id,
    source: 'tutor',
    'overallAssessment.proficiencyLevel': { $ne: null }
  })
    .sort({ lessonDate: 1 })
    .select('studentId language lessonDate overallAssessment.proficiencyLevel')
    .lean();

  if (tutorAnalyses.length === 0) return null;

  // Group student/language pairs we need AI baselines for.
  const studentLangPairs = new Map();
  tutorAnalyses.forEach(ta => {
    const key = `${ta.studentId}::${ta.language}`;
    if (!studentLangPairs.has(key)) studentLangPairs.set(key, { studentId: ta.studentId, language: ta.language });
  });

  const aiByStudentLang = new Map();
  await Promise.all([...studentLangPairs.values()].map(async ({ studentId, language }) => {
    const docs = await LessonAnalysis.find({
      studentId,
      language,
      source: 'ai',
      'overallAssessment.proficiencyLevel': { $ne: null }
    })
      .sort({ lessonDate: 1 })
      .select('lessonDate overallAssessment.proficiencyLevel')
      .lean();
    aiByStudentLang.set(`${studentId}::${language}`, docs);
  }));

  const deltas = [];
  for (const ta of tutorAnalyses) {
    const aiList = aiByStudentLang.get(`${ta.studentId}::${ta.language}`) || [];
    if (aiList.length === 0) continue;

    // Find the AI assessment closest in time, within the pairing window.
    const taTime = new Date(ta.lessonDate).getTime();
    let best = null;
    let bestDelta = Infinity;
    for (const ai of aiList) {
      const delta = Math.abs(new Date(ai.lessonDate).getTime() - taTime);
      if (delta < bestDelta && delta <= TUTOR_BIAS_PAIRING_WINDOW_MS) {
        best = ai;
        bestDelta = delta;
      }
    }
    if (!best) continue;

    const tutorNumeric = CEFR_TO_NUMERIC[ta.overallAssessment.proficiencyLevel];
    const aiNumeric = CEFR_TO_NUMERIC[best.overallAssessment.proficiencyLevel];
    if (!tutorNumeric || !aiNumeric) continue;

    deltas.push(tutorNumeric - aiNumeric);
  }

  if (deltas.length < TUTOR_BIAS_MIN_SAMPLES) {
    return { offset: null, sampleSize: deltas.length, confidence: 'low' };
  }

  const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const clamped = Math.max(-TUTOR_BIAS_MAX_OFFSET, Math.min(TUTOR_BIAS_MAX_OFFSET, mean));
  const variance = deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / deltas.length;
  const stddev = Math.sqrt(variance);

  let confidence = 'low';
  if (deltas.length >= 20 && stddev <= 0.6) confidence = 'high';
  else if (deltas.length >= 10 && stddev <= 1.0) confidence = 'medium';
  else if (deltas.length >= TUTOR_BIAS_MIN_SAMPLES) confidence = 'low';

  return {
    offset: Math.round(clamped * 100) / 100,
    sampleSize: deltas.length,
    confidence
  };
}

/**
 * Get a tutor's effective bias offset for use in the aggregator.
 *
 * Resolution order:
 *   1. Cached on User.tutorBias if recent (TTL = TUTOR_BIAS_CACHE_TTL_MS)
 *      AND confidence >= medium.
 *   2. Recompute from history; cache; return new value if confidence
 *      >= medium, else fall back to global.
 *   3. Global default (TUTOR_BIAS_OFFSET) for fresh / low-data tutors.
 *
 * Returns a number (the offset) — never null. Callers can pass this
 * directly as `tutorOffsetOverride` to computeBiasAdjusted.
 */
async function getTutorBiasOffset(tutorAuth0Id) {
  if (!tutorAuth0Id) return TUTOR_BIAS_OFFSET;

  const User = require('../models/User');
  const tutor = await User.findOne({ auth0Id: tutorAuth0Id }).select('tutorBias').lean();
  if (!tutor) return TUTOR_BIAS_OFFSET;

  const cached = tutor.tutorBias;
  const fresh = cached?.computedAt && (Date.now() - new Date(cached.computedAt).getTime() < TUTOR_BIAS_CACHE_TTL_MS);
  if (fresh && typeof cached.offset === 'number' && cached.confidence && cached.confidence !== 'low') {
    return cached.offset;
  }

  // Recompute (best-effort; never throws).
  try {
    const result = await computeTutorBiasFromHistory(tutorAuth0Id);
    if (result) {
      await User.updateOne({ auth0Id: tutorAuth0Id }, {
        $set: {
          'tutorBias.offset': result.offset,
          'tutorBias.sampleSize': result.sampleSize,
          'tutorBias.confidence': result.confidence,
          'tutorBias.computedAt': new Date()
        }
      });
      if (typeof result.offset === 'number' && result.confidence && result.confidence !== 'low') {
        return result.offset;
      }
    }
  } catch (err) {
    console.warn('[CefrEstimator] Per-tutor bias compute failed, falling back to global:', err.message);
  }

  return TUTOR_BIAS_OFFSET;
}

/**
 * Look up bias offsets for a batch of tutors at once. Returns a Map
 * keyed by tutor auth0Id → offset. Used by the aggregator to avoid
 * N+1 lookups across a 5-lesson window.
 */
async function getTutorBiasOffsetsBatch(tutorAuth0Ids) {
  const result = new Map();
  const unique = [...new Set((tutorAuth0Ids || []).filter(Boolean))];
  if (unique.length === 0) return result;

  await Promise.all(unique.map(async tid => {
    const offset = await getTutorBiasOffset(tid);
    result.set(tid, offset);
  }));
  return result;
}

// ────────────────────────── Loaders ──────────────────────────

/**
 * Load up to ROLLING_WINDOW most-recent analyses for this student/language,
 * sorted oldest → newest, with overallAssessment + source + biasAdjusted*.
 */
async function loadRecentAnalyses(studentAuth0Id, language, limit = ROLLING_WINDOW) {
  if (!studentAuth0Id || !language) return [];
  const docs = await LessonAnalysis.find({
    studentId: studentAuth0Id,
    language,
    status: 'completed',
    'overallAssessment.proficiencyLevel': { $ne: null }
  })
    .sort({ lessonDate: -1 })
    .limit(limit)
    .select('overallAssessment source tutorId biasAdjustedLevel biasAdjustedNumeric strengths areasForImprovement grammarAnalysis fluencyAnalysis pronunciationAnalysis vocabularyAnalysis lessonDate progressionMetrics')
    .lean();

  return docs.reverse(); // oldest first
}

// ────────────────────────── Reveal logic ──────────────────────────

/**
 * Decide whether the student should see (or re-see) their CEFR level
 * given an updated internal estimate. Pure function — no DB.
 *
 * Triggers:
 *   - First reveal: ≥ REVEAL_FIRST_THRESHOLD lessons AND no prior reveal.
 *   - Chapter graduation: caller explicitly passes { trigger: 'chapter_graduation' }.
 *   - Monthly refresh: ≥ REVEAL_REFRESH_INTERVAL_MS since last reveal.
 *
 * Returns { reveal: bool, trigger: 'first_milestone'|'chapter_graduation'|'monthly_refresh'|null }.
 */
function shouldReveal(plan, estimate, opts = {}) {
  if (!estimate || !estimate.level) return { reveal: false, trigger: null };
  if (estimate.lessonsConsidered < REVEAL_HARD_FLOOR) return { reveal: false, trigger: null };

  if (opts.trigger === 'chapter_graduation') {
    return { reveal: true, trigger: 'chapter_graduation' };
  }

  const last = plan.revealedCefrLevel;
  if (!last) {
    if (estimate.lessonsConsidered >= REVEAL_FIRST_THRESHOLD) {
      return { reveal: true, trigger: 'first_milestone' };
    }
    return { reveal: false, trigger: null };
  }

  // Monthly refresh — only fire if the level actually changed OR we're past the interval.
  const lastAge = Date.now() - new Date(last.revealedAt || 0).getTime();
  if (lastAge >= REVEAL_REFRESH_INTERVAL_MS) {
    return { reveal: true, trigger: 'monthly_refresh' };
  }

  // Level changed within the same window? Push a refresh anyway (rare, but
  // big movements deserve acknowledgement). Don't fire on every recompute.
  if (last.level !== estimate.level) {
    return { reveal: true, trigger: 'monthly_refresh' };
  }

  return { reveal: false, trigger: null };
}

// ────────────────────────── Narrative templates ──────────────────────────
// English-only for v1. i18n is a known follow-up — keep templates short,
// declarative, and easy to translate. Avoid colloquialisms.

const TREND_PHRASES = {
  surging:    ['strong improvements', 'rapid gains', 'a big jump'],
  improving:  ['clear progress', 'steady gains', 'consistent improvements'],
  steady:     ['steady performance', 'consistent results', 'stable progress'],
  mixed:      ['mixed results', 'some ups and downs', 'an uneven pattern'],
  declining:  ['some recent dips', 'a slight slowdown', 'a small step back']
};

const COMPONENT_LABELS = {
  grammar:       'grammar accuracy',
  fluency:       'fluency',
  pronunciation: 'pronunciation',
  vocabulary:    'vocabulary'
};

const FRAMING = {
  solidly:        'solidly in {level}',
  approaching:    'approaching {next}',
  early_in:       'early in {level}',
  with_emerging:  '{level} with {next} elements emerging'
};

function pick(arr, seed = 0) {
  return arr[seed % arr.length];
}

/**
 * Inspect the rolling window to determine which component is the strongest
 * and which is the weakest, plus an overall trend.
 */
function summarizeComponents(analyses) {
  const componentMeans = { grammar: [], fluency: [], pronunciation: [], vocabulary: [] };

  analyses.forEach(a => {
    if (typeof a.grammarAnalysis?.accuracyScore === 'number') componentMeans.grammar.push(a.grammarAnalysis.accuracyScore);
    if (typeof a.fluencyAnalysis?.overallFluencyScore === 'number') componentMeans.fluency.push(a.fluencyAnalysis.overallFluencyScore);
    if (typeof a.pronunciationAnalysis?.overallScore === 'number') componentMeans.pronunciation.push(a.pronunciationAnalysis.overallScore);
    // Vocabulary range is a category — map to a score.
    const vRange = a.vocabularyAnalysis?.vocabularyRange;
    const vMap = { limited: 50, moderate: 65, good: 80, excellent: 92 };
    if (vRange && vMap[vRange]) componentMeans.vocabulary.push(vMap[vRange]);
  });

  const meanOf = arr => arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : null;
  const means = Object.fromEntries(Object.entries(componentMeans).map(([k, v]) => [k, meanOf(v)]));
  const present = Object.entries(means).filter(([, v]) => v !== null);
  if (present.length === 0) return { top: null, weak: null, trend: 'steady' };

  present.sort((a, b) => b[1] - a[1]);
  const top = present[0][0];
  const weak = present[present.length - 1][0];

  // Trend: slope of the last component (whichever is most populated).
  const fullest = present.reduce((best, [k, _]) => {
    return componentMeans[k].length > componentMeans[best].length ? k : best;
  }, present[0][0]);
  const series = componentMeans[fullest];
  let trend = 'steady';
  if (series.length >= 3) {
    const first = (series[0] + series[1]) / 2;
    const last = (series[series.length - 1] + series[series.length - 2]) / 2;
    const delta = last - first;
    if (delta >= 12) trend = 'surging';
    else if (delta >= 5) trend = 'improving';
    else if (delta <= -8) trend = 'declining';
    else if (Math.abs(delta) <= 3) trend = 'steady';
    else trend = 'mixed';
  }

  return { top, weak, trend, means };
}

/**
 * Build a one-sentence narrative for the reveal modal/profile section.
 * Pure function. Input is the aggregate + the analyses list (oldest first).
 *
 * If `divergence` is provided (AI vs tutor means differ ≥ 1 CEFR level),
 * appends a transparent disagreement sentence so the student understands
 * why agreement is low.
 */
function buildNarrative({ estimate, analyses, nextLevel, divergence = null }) {
  if (!estimate) return '';

  const { top, weak, trend } = summarizeComponents(analyses);
  const seed = (estimate.lessonsConsidered || 0) + (estimate.numericLevel ? Math.floor(estimate.numericLevel * 10) : 0);

  const trendPhrase = pick(TREND_PHRASES[trend] || TREND_PHRASES.steady, seed);
  const topLabel = COMPONENT_LABELS[top] || 'overall performance';
  const weakLabel = weak && weak !== top ? COMPONENT_LABELS[weak] : null;

  // Decide framing based on stddev / agreement and how close numeric is to the next level.
  const fractionalPart = estimate.numericLevel - Math.floor(estimate.numericLevel);
  let framingKey = 'solidly';
  if (estimate.agreement === 'low') framingKey = 'with_emerging';
  else if (fractionalPart >= 0.4 && nextLevel) framingKey = 'approaching';
  else if (fractionalPart <= 0.15 && estimate.numericLevel > 1) framingKey = 'early_in';

  const framing = FRAMING[framingKey]
    .replace('{level}', estimate.level)
    .replace('{next}', nextLevel || estimate.level);

  const secondary = weakLabel
    ? `with ${weakLabel} as your main growth area`
    : `with strong consistency across the board`;

  let narrative = `Over your last ${estimate.lessonsConsidered} lessons you've shown ${trendPhrase} in ${topLabel}, ${secondary}. You're ${framing} territory.`;

  if (divergence) {
    narrative += ' ' + (divergence.direction === 'tutor_higher'
      ? `Your tutors tend to assess you at ${divergence.tutorLevel}; AI signals point to ${divergence.aiLevel}. We've blended both — the truth is usually in between.`
      : `AI signals are pointing higher (${divergence.aiLevel}) than your tutors (${divergence.tutorLevel}). A few more consistent lessons will sharpen this.`);
  }

  return narrative;
}

// ────────────────────────── Public API ──────────────────────────

/**
 * Recompute the internal CEFR estimate and persist it on the plan.
 * Does NOT save the plan — caller is responsible for that.
 *
 * Returns the new estimate (or null if not enough data).
 */
async function recomputeInternalEstimate(plan) {
  if (!plan || !plan.studentId || !plan.language) return null;

  const User = require('../models/User');
  const student = await User.findById(plan.studentId).select('auth0Id').lean();
  if (!student?.auth0Id) return null;

  const recent = await loadRecentAnalyses(student.auth0Id, plan.language, ROLLING_WINDOW);
  if (recent.length === 0) return null;

  // Per-tutor bias calibration (Batch 12 follow-up). Look up the empirical
  // offset for every tutor in the window so the aggregator can swap it in
  // for the global default. Best-effort — falls back to global on error.
  let tutorBiasMap = null;
  try {
    const tutorIds = recent.filter(r => r.source === 'tutor').map(r => String(r.tutorId)).filter(Boolean);
    if (tutorIds.length > 0) tutorBiasMap = await getTutorBiasOffsetsBatch(tutorIds);
  } catch (err) {
    console.warn('[CefrEstimator] Tutor bias batch lookup failed:', err.message);
  }

  const aggregate_ = aggregate(recent, tutorBiasMap);
  if (!aggregate_) return null;

  plan.internalCefrEstimate = {
    level: aggregate_.level,
    numericLevel: aggregate_.numericLevel,
    confidence: aggregate_.confidence,
    agreement: aggregate_.agreement,
    sources: aggregate_.sources,
    lessonsConsidered: aggregate_.lessonsConsidered,
    computedAt: new Date()
  };
  // Stash divergence on the plan in a non-schema field so maybeReveal can
  // pick it up without re-aggregating. Mongoose discards unknown fields,
  // so we attach it to the doc instance directly.
  if (aggregate_.divergence) {
    plan._lastDivergence = aggregate_.divergence;
  } else {
    plan._lastDivergence = null;
  }

  return plan.internalCefrEstimate;
}

/**
 * If the reveal threshold is met, update revealedCefrLevel + push to history.
 * Pass opts.trigger = 'chapter_graduation' to force a reveal.
 *
 * Does NOT save the plan — caller is responsible.
 *
 * Returns { revealed: bool, trigger, reveal? }.
 */
async function maybeReveal(plan, opts = {}) {
  if (!plan?.internalCefrEstimate) {
    await recomputeInternalEstimate(plan);
  }
  const estimate = plan.internalCefrEstimate;
  if (!estimate || !estimate.level) return { revealed: false, trigger: null };

  const decision = shouldReveal(plan, estimate, opts);
  if (!decision.reveal) return { revealed: false, trigger: null };

  // Build narrative — needs the analyses again for component summary.
  const User = require('../models/User');
  const student = await User.findById(plan.studentId).select('auth0Id').lean();
  const analyses = student?.auth0Id ? await loadRecentAnalyses(student.auth0Id, plan.language, ROLLING_WINDOW) : [];

  const currentIdx = CEFR_LEVELS.indexOf(estimate.level);
  const nextLevel = currentIdx >= 0 && currentIdx < 5 ? CEFR_LEVELS[currentIdx + 1] : null;

  const divergence = plan._lastDivergence || null;
  const narrative = buildNarrative({ estimate, analyses, nextLevel, divergence });

  const reveal = {
    level: estimate.level,
    numericLevel: estimate.numericLevel,
    confidence: estimate.confidence,
    agreement: estimate.agreement,
    narrative,
    sources: estimate.sources,
    lessonsAtReveal: estimate.lessonsConsidered,
    trigger: decision.trigger,
    revealedAt: new Date(),
    divergence
  };

  plan.revealedCefrLevel = reveal;
  plan.revealHistory = plan.revealHistory || [];
  plan.revealHistory.push(reveal);
  plan.pendingCefrReveal = true;

  return { revealed: true, trigger: decision.trigger, reveal };
}

/**
 * Convenience: recompute + maybe reveal in one call. Used by the post-lesson
 * pipeline (transcription.js, tutorFeedback.js).
 */
async function refresh(plan, opts = {}) {
  await recomputeInternalEstimate(plan);
  return maybeReveal(plan, opts);
}

// ────────────────────────── Exports ──────────────────────────

module.exports = {
  // Constants (exposed for tests + docs)
  CEFR_LEVELS,
  CEFR_TO_NUMERIC,
  TUTOR_BIAS_OFFSET,
  TUTOR_BIAS_MIN_SAMPLES,
  TUTOR_BIAS_CACHE_TTL_MS,
  ROLLING_WINDOW,
  REVEAL_HARD_FLOOR,
  REVEAL_FIRST_THRESHOLD,
  REVEAL_REFRESH_INTERVAL_MS,

  // Pure helpers
  computeBiasAdjusted,
  numericToLevel,
  aggregate,
  shouldReveal,
  buildNarrative,
  summarizeComponents,

  // Per-tutor calibration
  computeTutorBiasFromHistory,
  getTutorBiasOffset,
  getTutorBiasOffsetsBatch,

  // Stateful
  loadRecentAnalyses,
  recomputeInternalEstimate,
  maybeReveal,
  refresh
};
