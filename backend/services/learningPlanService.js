const OpenAI = require('openai');
const LearningPlan = require('../models/LearningPlan');
const LessonAnalysis = require('../models/LessonAnalysis');
const User = require('../models/User');
const entitlements = require('./entitlementsService');
const postLessonRecommendations = require('./postLessonRecommendationService');
const mastery = require('./masteryService');
const bayes = require('./bayesianMastery');
const struggleAggregator = require('./struggleAggregator');
const focusResolver = require('./focusResolverService');
const focusHistory = require('./focusHistoryService');
const signalFusion = require('./signalFusionService');
const phaseScope = require('./phaseSkillScopeService');
const skillBeliefKey = require('./skillBeliefKey');
const {
  PLAN_FOCUS_PHRASING_PROMPT_BLOCK,
  normalizePlanFocusText,
  isDefinitivePlanFocus,
} = require('../utils/planFocusPhrasing');

// Grace window (ms) after a plan is first created during which we let
// the student change their goal without invoking the cooldown. Lets
// users correct an onboarding mistake without a 7-day wait.
const GOAL_CHANGE_GRACE_MS = 24 * 60 * 60 * 1000;

let openai = null;

function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key is required.');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

const GOAL_TYPE_LABELS = {
  conversational: 'Become conversational',
  exam_prep: 'Prepare for an exam',
  professional: 'Use it for work',
  travel: 'Travel and get by',
  relocation: 'Moving to a new country',
  other: 'Custom goal'
};

const LEVEL_LABELS = {
  complete_beginner: 'Complete beginner',
  some_basics: 'Knows some basics',
  simple_conversations: 'Can hold simple conversations',
  intermediate: 'Intermediate, wants to improve',
  advanced: 'Advanced, refining skills'
};

const LEVEL_TO_CEFR = {
  complete_beginner: 'A1',
  some_basics: 'A1-A2',
  simple_conversations: 'A2-B1',
  intermediate: 'B1-B2',
  advanced: 'B2-C1'
};

function buildAnalysisContext(analysis) {
  if (!analysis) return 'No lesson data available yet.';

  const parts = [];
  if (analysis.overallAssessment?.proficiencyLevel) {
    parts.push(`CEFR level: ${analysis.overallAssessment.proficiencyLevel}`);
  }
  if (analysis.overallAssessment?.summary) {
    parts.push(`Summary: ${analysis.overallAssessment.summary}`);
  }
  if (analysis.grammarAnalysis?.accuracyScore) {
    parts.push(`Grammar accuracy: ${analysis.grammarAnalysis.accuracyScore}%`);
  }
  if (analysis.fluencyAnalysis?.overallFluencyScore) {
    parts.push(`Fluency score: ${analysis.fluencyAnalysis.overallFluencyScore}%`);
  }
  if (analysis.vocabularyAnalysis?.vocabularyRange) {
    parts.push(`Vocabulary range: ${analysis.vocabularyAnalysis.vocabularyRange}`);
  }
  if (analysis.progressionMetrics?.persistentChallenges?.length) {
    parts.push(`Persistent challenges: ${analysis.progressionMetrics.persistentChallenges.join(', ')}`);
  }
  if (analysis.progressionMetrics?.keyImprovements?.length) {
    parts.push(`Key improvements: ${analysis.progressionMetrics.keyImprovements.join(', ')}`);
  }
  if (analysis.topicsDiscussed?.length) {
    parts.push(`Topics discussed: ${analysis.topicsDiscussed.join(', ')}`);
  }
  if (analysis.homeworkSuggestions?.length) {
    parts.push(`Homework suggestions: ${analysis.homeworkSuggestions.join(', ')}`);
  }
  return parts.join('\n');
}

function compactPlanForPrompt(plan) {
  return {
    goal: `${GOAL_TYPE_LABELS[plan.goal?.type] || plan.goal?.type}${plan.goal?.description ? ': ' + plan.goal.description : ''}`,
    targetLevel: plan.goal?.targetLevel || 'not specified',
    timeline: plan.goal?.timelinePressure || 'no_rush',
    currentPhase: plan.currentPhaseIndex,
    phases: plan.phases.map((p, i) => ({
      index: i,
      title: p.title,
      status: p.status,
      lessonsCompleted: p.lessonsCompleted,
      estimatedLessons: p.estimatedLessons,
      // Mastery signals — promotion is gated on these, the AI must respect them.
      lessonScores: p.lessonScores || [],
      masteryAverage: p.masteryAverage,
      focusAreas: p.focusAreas
    })),
    recentOverrides: (plan.tutorOverrides || []).slice(-3).map(o => ({
      action: o.action,
      note: o.note,
      tutorName: o.tutorName
    })),
    promotionRules: {
      minLessonsPerPhase: mastery.MIN_LESSONS_PER_PHASE,
      maxLessonsPerPhase: mastery.MAX_LESSONS_PER_PHASE,
      masteryThreshold: mastery.MASTERY_ADVANCE_THRESHOLD
    }
  };
}

/**
 * Generate the initial learning plan.
 *
 * Works in two modes:
 *   - 'draft' — no lesson data yet; generated from onboarding goal alone.
 *               Status: 'draft'. Triggered by client right after onboarding.
 *   - 'active' — there is a completed LessonAnalysis to draw from.
 *               Status: 'active'. Triggered by the post-lesson pipeline
 *               (or by upgrading an existing draft plan).
 */
async function generateInitialPlan(studentId, language, opts = {}) {
  console.log(`📋 [LearningPlan] Generating initial plan for student ${studentId}, language: ${language}`);

  const user = await User.findById(studentId);
  if (!user?.onboardingData?.learningGoal?.type) {
    console.log('⚠️ [LearningPlan] No learning goal set — skipping plan generation');
    return null;
  }

  const goal = user.onboardingData.learningGoal;
  const selfLevel = goal.selfAssessedLevel || 'some_basics';
  const estimatedCefr = LEVEL_TO_CEFR[selfLevel] || 'A2';

  const latestAnalysis = await LessonAnalysis.findOne({
    studentId: studentId.toString(),
    language,
    status: 'completed'
  }).sort({ lessonDate: -1 }).lean();

  // Prefer the rolling, bias-corrected internal estimate when available.
  // Falls back to last-lesson CEFR (or self-assessed seed) on a fresh plan.
  let actualCefr = latestAnalysis?.overallAssessment?.proficiencyLevel || estimatedCefr;
  let estimateMeta = null;
  try {
    const cefrEstimator = require('./cefrEstimatorService');
    const recent = await cefrEstimator.loadRecentAnalyses(user.auth0Id, language);
    // Apply per-tutor calibration so the AI prompt sees the same numbers
    // the student would (Batch 12 follow-up — per-tutor bias).
    const tutorIds = recent.filter(r => r.source === 'tutor').map(r => String(r.tutorId)).filter(Boolean);
    const tutorBiasMap = tutorIds.length > 0
      ? await cefrEstimator.getTutorBiasOffsetsBatch(tutorIds)
      : null;
    const agg = cefrEstimator.aggregate(recent, tutorBiasMap);
    if (agg && agg.level) {
      actualCefr = agg.level;
      estimateMeta = agg;
    }
  } catch (err) {
    console.warn('[LearningPlan] CEFR estimator inline call failed:', err.message);
  }

  const hasLessonData = !!latestAnalysis;
  const planStatus = hasLessonData ? 'active' : 'draft';
  const analysisContext = buildAnalysisContext(latestAnalysis);

  // Optional context for student-initiated AI regenerations.
  const studentRegenReason = (opts.studentRegenReason || '').toString().trim().slice(0, 400);
  const previousPhasesSummary = Array.isArray(opts.previousPhasesSummary)
    ? opts.previousPhasesSummary.slice(0, 6)
    : [];

  let regenContext = '';
  if (studentRegenReason || previousPhasesSummary.length) {
    const prevList = previousPhasesSummary
      .map((p, i) => `  ${i + 1}. ${p.title || ''} — ${(p.description || '').slice(0, 80)}`)
      .join('\n');
    regenContext = `

STUDENT-DRIVEN REGENERATION CONTEXT:
The student has explicitly asked for a different roadmap. Take this seriously.
${studentRegenReason ? `- Their reason / preference: "${studentRegenReason}"` : ''}
${prevList ? `- Phases they had before (do NOT repeat them as-is, vary topics + framing):\n${prevList}` : ''}
- Generate genuinely different phase titles and topics that better reflect their preference, while still respecting their goal and level.`;
  }

  // Pace: derive concrete pacing knobs from the student's stated timeline
  // / target date. The same knobs flow into the AI prompt AND into
  // weeklyRecommendations on the saved plan, so urgency actually shapes
  // the roadmap (not just the prose).
  const pace = require('./paceService');
  const paceDescriptor = pace.describe(goal);

  // Cold-start guard. A self-declared complete beginner with no lesson data
  // yet must get a roadmap that genuinely starts from zero — otherwise the
  // model tends to assume some prior exposure and opens mid-A1. We only
  // force this when there's no real lesson signal to contradict it.
  const isAbsoluteBeginner = !hasLessonData && selfLevel === 'complete_beginner';
  const beginnerGuidance = isAbsoluteBeginner ? `

ABSOLUTE BEGINNER — CRITICAL:
This student has NEVER studied ${language}. Assume zero prior knowledge: they do
not know the alphabet, sounds, greetings, numbers, or any words.
- Phase 1 MUST start from the true foundations: pronunciation/sounds, the
  alphabet/script if relevant, greetings and introductions, and the most basic
  high-frequency words. Do NOT assume any vocabulary or grammar is already known.
- Introduce only ${language}'s most fundamental grammar first (e.g. the verb
  "to be", basic word order, articles/gender if applicable) — nothing advanced.
- suggestedTopics for early phases must be survival-level (say hello, introduce
  yourself, count, order a drink), not open conversation.
- studentSummary must reassure a nervous first-timer that they are starting at
  the very beginning and nothing is assumed.` : '';

  const prompt = `You are an expert language teacher creating a personalized learning plan.

STUDENT PROFILE:
- Learning: ${language}
- Native language: ${user.nativeLanguage || 'unknown'}
- Goal: ${GOAL_TYPE_LABELS[goal.type] || goal.type}${goal.description ? ' — ' + goal.description : ''}
- Self-assessed level: ${LEVEL_LABELS[selfLevel] || selfLevel}
- Estimated CEFR (rolling, bias-corrected): ${actualCefr}${estimateMeta ? ` · agreement: ${estimateMeta.agreement} · based on ${estimateMeta.lessonsConsidered} lessons (${estimateMeta.sources.ai} AI / ${estimateMeta.sources.tutor} tutor)` : ''}
- Target level: ${goal.targetLevel || 'not specified'}
- Timeline: ${goal.timeline || 'no rush'}
${pace.buildAiPromptLine(goal)}

LATEST LESSON DATA:
${analysisContext}${regenContext}

Create a structured learning plan. Phase count and lesson budget MUST follow the PACE line above:
- urgent / focused → fewer phases (3), tighter lessons each (3-4)
- steady           → 4 phases × ~5 lessons
- relaxed          → up to 5 phases × ~5 lessons
The plan should be specific to ${language}, not generic.${beginnerGuidance}

IMPORTANT:
- The first phase should be "active" status, all others "locked"
- exitCriteria should be qualitative and encouraging, not percentage-based
- suggestedTopics should be conversation scenarios the student would actually enjoy
- focusAreas should target specific ${language} grammar/vocabulary areas
- studentSummary should be warm, encouraging, second-person ("You're...")
- nextLessonFocus should be specific and actionable for the tutor — a suggestion they may adapt, not a commitment to the student
${PLAN_FOCUS_PHRASING_PROMPT_BLOCK}

Respond ONLY with valid JSON:
{
  "phases": [
    {
      "title": "string",
      "description": "string — warm, encouraging description",
      "focusAreas": ["string"],
      "suggestedTopics": ["string — real conversation scenarios"],
      "exitCriteria": "string — qualitative milestone",
      "estimatedLessons": 5,
      "status": "active | locked"
    }
  ],
  "weeklyRecommendations": {
    "lessonFrequency": "string (e.g. '2x per week')",
    "selfStudyMinutes": 15,
    "focusBetweenLessons": "string — specific practice advice"
  },
  "studentSummary": "string — warm, personal summary of where they are and what's ahead",
  "nextLessonFocus": "string — suggested focus for the tutor (recommendatory, not a commitment)"
}`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an expert language teacher who creates personalized, encouraging learning plans. Always respond with valid JSON only. Be specific to the target language, not generic. Plan focus lines are suggestions for tutors — never promise what will happen in a lesson.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  });

  const result = JSON.parse(completion.choices[0].message.content);
  console.log(`✅ [LearningPlan] AI generated ${result.phases?.length || 0} phases`);

  const plan = await LearningPlan.findOneAndUpdate(
    { studentId, language },
    {
      studentId,
      language,
      goal: {
        type: goal.type,
        description: goal.description || '',
        targetLevel: goal.targetLevel || '',
        timeline: goal.timeline || 'no_rush',
        timelinePressure: goal.timeline || 'no_rush',
        targetDate: goal.targetDate || null
      },
      selfAssessedLevel: selfLevel,
      currentPhaseIndex: 0,
      phases: (() => {
        const mapped = (result.phases || []).map((p, i) => ({
          title: p.title,
          description: p.description || '',
          focusAreas: p.focusAreas || [],
          suggestedTopics: p.suggestedTopics || [],
          exitCriteria: p.exitCriteria || '',
          estimatedLessons: p.estimatedLessons || 5,
          lessonsCompleted: 0,
          lessonScores: [],
          lessonTutorIds: [],
          masteryAverage: null,
          focusSkillIds: [],
          bayesianMasteryAverage: null,
          status: i === 0 ? 'active' : 'locked',
          tutorVotes: []
        }));
        phaseScope.syncAllPhases({ phases: mapped, language });
        return mapped;
      })(),
      weeklyRecommendations: pace.buildWeeklyRecommendations(
        goal,
        result.weeklyRecommendations?.focusBetweenLessons || ''
      ),
      studentSummary: result.studentSummary || '',
      nextLessonFocus: normalizePlanFocusText(result.nextLessonFocus || ''),
      lastUpdatedAt: new Date(),
      lastGoalChangedAt: new Date(),
      status: planStatus,
      lastUpdateMode: hasLessonData ? 'lesson' : 'goal_change',
      history: [{
        date: new Date(),
        changeDescription: hasLessonData
          ? 'Initial learning plan created from first lesson'
          : 'Draft learning plan created from onboarding goal',
        phaseIndexBefore: null,
        phaseIndexAfter: 0,
        reason: 'created'
      }]
    },
    { upsert: true, new: true, runValidators: true }
  );

  console.log(`✅ [LearningPlan] Plan saved: ${plan._id}`);
  return plan;
}

/**
 * Update the plan after a lesson analysis completes.
 *
 * Promotion is mastery-gated for BOTH tiers — the AI never bypasses
 * the floor/ceiling defined in masteryService.
 *
 * Free students:    rule-based promotion (mastery only).
 * Premium students: AI rewrites studentSummary + nextLessonFocus on top
 *                   of the same mastery-gated promotion, and may also
 *                   *recommend* advancement (still subject to the floor).
 *
 * Material recommendations run for BOTH tiers — premium gets free's
 * recommendations PLUS the AI plan refresh, never less.
 */
async function updatePlanAfterLesson(planId, lessonAnalysis) {
  const plan = await LearningPlan.findById(planId);
  if (!plan) return null;
  if (plan.status === 'completed') return null;

  // For 'unframed' and 'paused' plans we still want CEFR refresh, review-deck
  // updates, and material recommendations — they are useful even without a
  // structured journey — but we skip every plan-mutating step (phase
  // advancement, calibration, decay, splits, transitions). The student
  // gets value from each lesson without us silently rewriting a plan
  // they explicitly stepped away from.
  if (plan.status === 'unframed' || plan.status === 'paused') {
    return _runPostLessonSideEffectsOnly(plan, lessonAnalysis);
  }

  if (plan.status === 'draft') plan.status = 'active';

  const student = await User.findById(plan.studentId);

  // Snapshot the student-facing journey state BEFORE any mutation so we can
  // diff it after all the phase/chapter/focus logic has run and persist a
  // "what changed this lesson" delta for the post-lesson recap card.
  const impactBefore = _snapshotJourneyState(plan);

  // ── 0. Bayesian beliefs: decay → apply this lesson's evidence ─────
  // Runs BEFORE the existing mastery/phase logic so any new gate or
  // focus resolution that reads beliefs sees the latest state. Cheap:
  // the beliefs Map is bounded to ~100 skills per plan.
  const now = new Date();
  _applyBeliefDecay(plan, now);
  const evidenceBySkill = struggleAggregator.extractEvidenceFromLesson(lessonAnalysis, plan.language);
  _applyEvidenceToBeliefs(plan, evidenceBySkill, now);
  _applyKeyImprovementsToBeliefs(plan, lessonAnalysis, plan.language, now);
  _applyPositiveSignalBeliefs(plan, lessonAnalysis, plan.language, now);
  _refreshPhaseBayesianMastery(plan, now);

  // ── 0b. Settle pending focus history entries against the new beliefs.
  // Compares before/after means and tags each pending entry with its
  // outcome (improved/stuck/worsened/untested). Stuck entries feed the
  // focus resolver's upstream-diagnosis branch.
  try {
    focusHistory.settleFocus(plan, {
      lessonId: lessonAnalysis.lessonId || null,
      evidenceBySkill,
      beliefsByIdAfter: plan.skillBeliefs,
      now
    });
  } catch (err) {
    console.error('[LearningPlan] Focus history settlement failed (non-blocking):', err.message);
  }

  // 1. Score this lesson once. Used by both paths and pushed onto the phase.
  const lessonScore = mastery.computeMasteryScore(lessonAnalysis);
  const currentPhase = plan.phases[plan.currentPhaseIndex];
  if (currentPhase) {
    currentPhase.lessonsCompleted = (currentPhase.lessonsCompleted || 0) + 1;
    if (lessonScore !== null) {
      currentPhase.lessonScores = currentPhase.lessonScores || [];
      currentPhase.lessonScores.push(lessonScore);
      currentPhase.masteryAverage = mastery.rollingMastery(currentPhase.lessonScores);
    }
    // Track which tutor produced each score (parallel array). Required by
    // the decay rule (G12) which needs ≥ 2 distinct tutors before triggering.
    currentPhase.lessonTutorIds = currentPhase.lessonTutorIds || [];
    currentPhase.lessonTutorIds.push(lessonAnalysis.tutorId || null);
  }

  // 1b. Calibration window (Batch 5). Runs ONLY in chapter 1 within the
  //     first 5 lessons. May promote or demote the student to find their
  //     true level before regular mastery logic kicks in. If calibration
  //     fires, we skip the mastery-promotion step this lesson.
  let calibrationFired = false;
  try {
    calibrationFired = await _applyCalibrationIfNeeded(plan, lessonAnalysis);
  } catch (err) {
    console.error('[LearningPlan] Calibration check failed (non-blocking):', err);
  }

  // 2. Run the tier-specific update (mutates `plan` in place). This handles
  //    phase advancement and (Batch 1+) chapter graduation as a side effect
  //    inside _applyMasteryPromotion. Skipped this lesson if calibration
  //    fired — the chapter just changed, so promotion gates would be noisy.
  if (!calibrationFired) {
    if (entitlements.canUseAdaptivePlanAi(student)) {
      await _updatePlanWithAi(plan, lessonAnalysis, lessonScore);
    } else {
      await _updatePlanWithRules(plan, lessonAnalysis);
    }
  }

  // 2b. Decay check after the per-lesson update has settled (Batch 1).
  //     Won't trigger on the same lesson as a promotion or calibration.
  if (!calibrationFired) {
    try {
      await _applyDecayIfNeeded(plan);
    } catch (err) {
      console.error('[LearningPlan] Decay check failed (non-blocking):', err);
    }
  }

  // 2b'. Adaptive phase splitting (Batch 11, premium-only). Won't fire
  //      after a promotion (phase changed this lesson) or calibration.
  if (!calibrationFired && entitlements.canUseAdaptivePlanAi(student)) {
    try {
      await _maybeSplitPhase(plan);
    } catch (err) {
      console.error('[LearningPlan] Phase split check failed (non-blocking):', err.message);
    }
  }

  // 2c. "Your teaching is sticking" notifications (Batch 7). Best-effort —
  //     never blocks the lesson update pipeline.
  try {
    const tutorBriefing = require('./tutorBriefingService');
    await tutorBriefing.emitTeachingStickingSignals(lessonAnalysis);
  } catch (err) {
    console.error('[LearningPlan] Teaching-sticking emission failed (non-blocking):', err.message);
  }

  // 2d. Immediate post-lesson quiz push (Batch 8). Premium-gated inside
  //     quizService. Best-effort, never blocks the pipeline.
  try {
    const quizService = require('./quizService');
    await quizService.pushImmediateFromLesson(lessonAnalysis);
  } catch (err) {
    console.error('[LearningPlan] Immediate quiz push failed (non-blocking):', err.message);
  }

  // 2e. CEFR estimator (Batch 12). Recomputes the internal estimate from the
  //     last 5 LessonAnalysis records (AI + tutor sources, with bias correction)
  //     and may push a milestone reveal. Best-effort, never blocks.
  try {
    const cefrEstimator = require('./cefrEstimatorService');
    await cefrEstimator.refresh(plan);
  } catch (err) {
    console.error('[LearningPlan] CEFR estimator refresh failed (non-blocking):', err.message);
  }

  // 3. Refresh recommendations for any student (free OR premium).
  if (entitlements.shouldRecommendMaterialsPostLesson(student)) {
    try {
      const recs = await postLessonRecommendations.computeRecommendations({
        studentId: plan.studentId,
        language: plan.language,
        lessonAnalysis,
        currentTutorId: lessonAnalysis.tutorId || null,
        limit: 5
      });
      if (recs.length > 0) {
        plan.recommendedMaterials = recs.map(r => ({
          materialId: r.materialId,
          matchedStruggles: r.matchedStruggles,
          fromLessonId: lessonAnalysis.lessonId || null,
          addedAt: new Date()
        }));
        plan.recommendedMaterialsUpdatedAt = new Date();
      }
    } catch (err) {
      console.error('[LearningPlan] Material recommendation step failed (non-blocking):', err);
    }
  }

  // Diff before/after and record what this lesson moved on the journey.
  plan.lastLessonImpact = _buildLessonImpact(impactBefore, plan, lessonAnalysis);

  await plan.save();
  return plan;
}

/**
 * Capture the coarse, student-facing journey state used by the post-lesson
 * "your journey moved" card: phase index/title, chapter level, next focus,
 * and the current phase's window-progress percent. Read-only.
 */
function _snapshotJourneyState(plan) {
  const idx = plan.currentPhaseIndex || 0;
  const phase = (plan.phases || [])[idx] || null;
  const hasMore = idx < (plan.phases || []).length - 1;
  let windowProgress = null;
  try {
    windowProgress = mastery.phaseProgressState(phase, hasMore).windowProgressPercent;
  } catch (_) {
    windowProgress = null;
  }
  return {
    phaseIndex: idx,
    phaseTitle: phase?.title || null,
    chapterLevel: plan.chapterLevel || null,
    focus: plan.nextLessonFocus || '',
    windowProgress
  };
}

/**
 * Build the lastLessonImpact subdocument by diffing the before-snapshot
 * against the plan's current (post-update) state.
 */
function _buildLessonImpact(before, plan, lessonAnalysis) {
  const after = _snapshotJourneyState(plan);
  const phaseAdvanced = after.phaseIndex > before.phaseIndex;
  const chapterChanged = !!before.chapterLevel && !!after.chapterLevel
    && before.chapterLevel !== after.chapterLevel;
  const focusChanged = (before.focus || '') !== (after.focus || '');
  return {
    lessonId: lessonAnalysis.lessonId ? String(lessonAnalysis.lessonId) : null,
    at: new Date(),
    phaseIndexBefore: before.phaseIndex,
    phaseIndexAfter: after.phaseIndex,
    phaseAdvanced,
    phaseTitleBefore: before.phaseTitle,
    phaseTitleAfter: after.phaseTitle,
    chapterChanged,
    chapterLevelBefore: before.chapterLevel,
    chapterLevelAfter: after.chapterLevel,
    focusChanged,
    focusBefore: before.focus || null,
    focusAfter: after.focus || null,
    windowProgressBefore: before.windowProgress,
    windowProgressAfter: after.windowProgress
  };
}

// ─────────────────────────────────────────────────────────────────
//  Bayesian belief helpers (Phase 2 / Adaptive system).
//
//  These run inside updatePlanAfterLesson before the existing mastery /
//  promotion logic so any consumer that reads plan.skillBeliefs sees
//  the latest state. All mutations are local — caller saves the plan.
// ─────────────────────────────────────────────────────────────────

/**
 * Apply time decay to every belief on the plan. Walks the Map in place.
 * Beliefs touched in this lesson will get their lastUpdatedAt re-stamped
 * by `_applyEvidenceToBeliefs` immediately after.
 */
function _applyBeliefDecay(plan, now = new Date()) {
  if (!plan?.skillBeliefs) return;
  for (const [skillId, belief] of skillBeliefKey.beliefEntries(plan.skillBeliefs)) {
    skillBeliefKey.setBelief(plan.skillBeliefs, skillId, bayes.decay(belief, now));
  }
}

/**
 * Translate this lesson's per-skill evidence into Bayesian updates.
 *
 * Each evidence entry contributes failure pseudo-counts proportional to
 * impact × occurrences. ASR-suspect entries are discounted (not zeroed,
 * so a recurring real issue can still register).
 *
 * Beliefs not touched this lesson are left as-is (already decayed).
 */
function _applyEvidenceToBeliefs(plan, evidenceBySkill, now = new Date()) {
  if (!evidenceBySkill || evidenceBySkill.size === 0) return;
  if (!plan.skillBeliefs) plan.skillBeliefs = new Map();
  for (const [skillId, ev] of evidenceBySkill.entries()) {
    const impact = ev.impact || 'medium';
    const occurrences = Math.max(1, ev.occurrences || 1);
    const errorOccurrencesByImpact = { high: 0, medium: 0, low: 0 };
    errorOccurrencesByImpact[impact] = occurrences;
    if (ev.isLikelyTranscriptionError) {
      // Down-weight rather than drop entirely — keeps a recurring
      // "ASR-suspect but actually real" pattern from being invisible.
      errorOccurrencesByImpact[impact] *= 0.3;
    }
    const { successWeight, failureWeight } = bayes.evidenceFromAnalysis({
      errorOccurrencesByImpact,
      improvedCount: 0,
      inScopeNotFlagged: false
    });
    const current = skillBeliefKey.getBelief(plan.skillBeliefs, skillId);
    const updated = bayes.update(current || null, successWeight, failureWeight, now);
    skillBeliefKey.setBelief(plan.skillBeliefs, skillId, updated);
  }
}

// How much a single quiz question is worth as Bayesian evidence. A
// checkpoint quiz answer is a real but lower-stakes signal than
// spontaneous production in a lesson, so each question contributes a
// fraction of a lesson's pseudo-count. `bayes.update` clamps the total
// per call at MAX_EVIDENCE_PER_LESSON, so a full quiz can't overwhelm
// the belief on its own.
const QUIZ_EVIDENCE_PER_QUESTION = 0.3;

/**
 * Fold a checkpoint/practice quiz result into the student's skill belief.
 *
 * Closes the loop for journey-map roadblocks: when a student answers a
 * struggle-targeted quiz, first-try correctness becomes success/failure
 * evidence on that skill. This is what lets a passed checkpoint actually
 * lower how often the struggle re-surfaces (and a missed one keep it up).
 *
 * `correct`/`total` are FIRST-attempt counts from the client. Safe and
 * non-blocking: returns null (no throw) on any missing data.
 *
 * @returns {Promise<null | { skillId, mean, pMastered }>}
 */
async function recordQuizEvidence({ studentId, quizId, correct, total, now = new Date() }) {
  if (!studentId || !quizId) return null;
  if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0) return null;

  const Quiz = require('../models/Quiz');
  const quiz = await Quiz.findById(quizId).select('struggle language').lean();
  if (!quiz || !quiz.struggle || !quiz.language) return null;

  const plan = await LearningPlan.findOne({ studentId, language: quiz.language });
  if (!plan) return null;
  if (!plan.skillBeliefs) plan.skillBeliefs = new Map();

  const safeCorrect = Math.max(0, Math.min(correct, total));
  const wrong = total - safeCorrect;
  const successWeight = safeCorrect * QUIZ_EVIDENCE_PER_QUESTION;
  const failureWeight = wrong * QUIZ_EVIDENCE_PER_QUESTION;

  const current = skillBeliefKey.getBelief(plan.skillBeliefs, quiz.struggle);
  const decayed = current ? bayes.decay(current, now) : null;
  const updated = bayes.update(decayed, successWeight, failureWeight, now);
  skillBeliefKey.setBelief(plan.skillBeliefs, quiz.struggle, updated);
  plan.markModified('skillBeliefs');

  // Keep the cached phase Bayesian average in sync so the next plan read
  // reflects the new evidence without waiting for a lesson.
  try {
    _refreshPhaseBayesianMastery(plan, now);
  } catch (err) {
    console.error('[LearningPlan] recordQuizEvidence phase refresh failed (non-blocking):', err.message);
  }

  await plan.save();

  return {
    skillId: quiz.struggle,
    mean: Number(bayes.posteriorMean(updated).toFixed(4)),
    pMastered: Number(bayes.probabilityMastered(updated).toFixed(4))
  };
}

/**
 * Apply success-side evidence from the analyzer's `keyImprovements`
 * field. Each entry is canonicalized and credited as 1.2 pseudo-counts
 * of success on the matching skill.
 *
 * Capped silently when canonicalization falls through to `unknown.*` —
 * we don't want to inflate beliefs on synthesized skills that may not
 * map cleanly to taxonomy entries.
 */
function _applyKeyImprovementsToBeliefs(plan, lessonAnalysis, language, now = new Date()) {
  const improvements = lessonAnalysis?.progressionMetrics?.keyImprovements;
  if (!Array.isArray(improvements) || improvements.length === 0) return;
  const taxonomy = require('./skillTaxonomy');
  if (!plan.skillBeliefs) plan.skillBeliefs = new Map();
  for (const ki of improvements) {
    if (typeof ki !== 'string' || !ki.trim()) continue;
    const { skillId, confidence } = taxonomy.canonicalize(ki, language);
    if (confidence === 'fallback') continue; // skip unknowns
    const current = skillBeliefKey.getBelief(plan.skillBeliefs, skillId);
    const updated = bayes.update(current || null, 1.2, 0, now);
    skillBeliefKey.setBelief(plan.skillBeliefs, skillId, updated);
  }
}

/**
 * Credit strong pronunciation/fluency metrics as Bayesian success evidence.
 */
/**
 * Sync phase.focusSkillIds and cache bayesianMasteryAverage on the active phase.
 */
function _refreshPhaseBayesianMastery(plan, now = new Date()) {
  const phase = plan?.phases?.[plan.currentPhaseIndex];
  if (!phase || !plan.language) return;
  const skillIds = phaseScope.syncPhaseFocusSkillIds(phase, plan.language);
  if (!skillIds.length) {
    phase.bayesianMasteryAverage = null;
    return;
  }
  const snapshot = bayes.phaseMasterySnapshot(plan.skillBeliefs, skillIds, now);
  phase.bayesianMasteryAverage = snapshot.score;
}

function _applyPositiveSignalBeliefs(plan, lessonAnalysis, language, now = new Date()) {
  const signals = signalFusion.extractPositiveSignals(lessonAnalysis, language);
  if (!signals.length) return;
  if (!plan.skillBeliefs) plan.skillBeliefs = new Map();
  for (const { skillId, successWeight } of signals) {
    if (!skillId || skillId.includes('.unknown.')) continue;
    const current = skillBeliefKey.getBelief(plan.skillBeliefs, skillId);
    const updated = bayes.update(current || null, successWeight, 0, now);
    skillBeliefKey.setBelief(plan.skillBeliefs, skillId, updated);
  }
}

/**
 * Resolve and apply the next-lesson focus via the new resolver. Falls
 * back to the legacy rule-based focus if the resolver throws — defense
 * in depth so a single bug here never blocks the lesson update.
 *
 * Returns the resolver result on success, or null on fallback (legacy
 * path will have already set plan.nextLessonFocus).
 */
async function _resolveNextFocus(plan, lessonAnalysis) {
  try {
    return await focusResolver.resolveAndApply({
      plan,
      language: plan.language,
      lessonAnalysis,
      fromLessonId: lessonAnalysis?.lessonId || null
    });
  } catch (err) {
    console.error('[LearningPlan] Focus resolver failed (using rule fallback):', err.message);
    const fallback = _generateRuleBasedFocus(plan, lessonAnalysis);
    if (fallback) plan.nextLessonFocus = normalizePlanFocusText(fallback);
    return null;
  }
}

/**
 * Apply the mastery-based promotion gate. Returns whether the phase
 * was advanced (or chapter graduated). Pure on inputs apart from
 * mutating `plan` and pushing a history entry.
 *
 * Three branches:
 *   - Inside-chapter phase advancement (existing behavior).
 *   - Last phase of chapter → defer to evaluateChapterGraduation +
 *     _completeChapterAndGenerateNext (Batch 1+).
 *   - No advancement → log the lesson, return.
 */
async function _applyMasteryPromotion(plan, lessonAnalysis, opts = {}) {
  const { aiRecommendsAdvance = false } = opts;
  const prevPhaseIndex = plan.currentPhaseIndex;
  const currentPhase = plan.phases[plan.currentPhaseIndex];
  if (!currentPhase) return { advanced: false, decision: null };

  const hasMorePhases = plan.currentPhaseIndex < plan.phases.length - 1;
  const decision = mastery.evaluateAdvancementForPlan(currentPhase, hasMorePhases, plan);

  // ── Branch 1: Last phase in chapter OR recovery phase → run chapter graduation ──
  // Recovery phases live as the last phase of the previous chapter, so they
  // also funnel through chapter graduation — but with the recovery rules
  // applied inside `evaluateChapterGraduation` (stricter mastery threshold,
  // multi-tutor / advance-vote requirement).
  if (decision.reason === 'last_phase_in_chapter' || decision.reason === 'recovery_phase') {
    const grad = mastery.evaluateChapterGraduationForPlan(currentPhase, plan);
    if (grad.graduate) {
      const result = await _completeChapterAndGenerateNext(plan, lessonAnalysis, grad);
      return { advanced: true, graduated: true, decision: grad, ...result };
    }
    // Final / recovery phase but not yet ready to graduate — log progress.
    plan.history.push({
      date: new Date(),
      lessonId: lessonAnalysis.lessonId || null,
      changeDescription: grad.isRecovery
        ? `Recovery lesson logged · mastery ${grad.mastery ?? 'n/a'}/${grad.thresholdUsed ?? mastery.MASTERY_RECOVERY_THRESHOLD}`
        : `Lesson logged in final phase · mastery ${grad.mastery ?? 'n/a'}/${grad.thresholdUsed ?? mastery.CHAPTER_GRADUATION_THRESHOLD}`,
      phaseIndexBefore: prevPhaseIndex,
      phaseIndexAfter: prevPhaseIndex,
      masteryAtAdvance: grad.mastery ?? null,
      reason: null
    });
    return { advanced: false, decision: grad };
  }

  // ── Branch 2: Mid-chapter phase advancement ──
  // The AI can recommend advancement, but the floor still applies.
  // The ceiling forces advancement regardless of what the AI thinks.
  let shouldAdvance = decision.advance;
  let reason = decision.reason;

  if (aiRecommendsAdvance && !decision.advance && decision.reason === 'mastery_below_threshold') {
    // AI thinks the student is ready despite a slightly low rolling avg.
    // Allow ONLY if the floor (min lessons) is already met. Floor is sacred.
    if ((currentPhase.lessonsCompleted || 0) >= mastery.MIN_LESSONS_PER_PHASE) {
      shouldAdvance = true;
      reason = 'ai_advance';
    }
  }

  if (shouldAdvance && hasMorePhases) {
    currentPhase.status = 'completed';
    currentPhase.completedAt = new Date();
    plan.currentPhaseIndex += 1;
    const nextPhase = plan.phases[plan.currentPhaseIndex];
    if (nextPhase) nextPhase.status = 'active';

    plan.history.push({
      date: new Date(),
      lessonId: lessonAnalysis.lessonId || null,
      changeDescription: reason === 'max_lessons_safety'
        ? `Advanced to Phase ${plan.currentPhaseIndex + 1} (max lessons reached, mastery ${decision.mastery ?? 'n/a'})`
        : reason === 'ai_advance'
          ? `Advanced to Phase ${plan.currentPhaseIndex + 1} (AI judgment, mastery ${decision.mastery ?? 'n/a'})`
          : `Advanced to Phase ${plan.currentPhaseIndex + 1} (mastery ${decision.mastery ?? 'n/a'} ≥ ${decision.thresholdUsed ?? mastery.MASTERY_ADVANCE_THRESHOLD})`,
      phaseIndexBefore: prevPhaseIndex,
      phaseIndexAfter: plan.currentPhaseIndex,
      masteryAtAdvance: decision.mastery ?? null,
      reason
    });
    return { advanced: true, decision };
  }

  // ── Branch 3: No advancement ──
  plan.history.push({
    date: new Date(),
    lessonId: lessonAnalysis.lessonId || null,
    changeDescription: decision.reason === 'min_lessons'
      ? `Lesson ${currentPhase.lessonsCompleted}/${mastery.MIN_LESSONS_PER_PHASE} toward Phase ${plan.currentPhaseIndex + 1} threshold`
      : `Lesson logged · mastery ${decision.mastery ?? 'n/a'}/${decision.thresholdUsed ?? mastery.MASTERY_ADVANCE_THRESHOLD}`,
    phaseIndexBefore: prevPhaseIndex,
    phaseIndexAfter: prevPhaseIndex,
    masteryAtAdvance: decision.mastery ?? null,
    reason: null
  });
  return { advanced: false, decision };
}

/**
 * Complete the current chapter and generate the next one. Called from
 * _applyMasteryPromotion when the final-phase mastery gate passes.
 *
 * Snapshots the completed chapter into chaptersCompleted, bumps
 * chapterIndex/chapterLevel/chapterTheme, and asks chapterGenerationService
 * to produce 4 new phases (free template OR premium AI).
 *
 * If chapter 6 (C2) just completed, transitions to mastery_mode (G5)
 * instead of generating a new chapter.
 *
 * Sets plan._transientFlags.chapterJustCompleted (Batch 4 frontend reads it).
 */
async function _completeChapterAndGenerateNext(plan, lessonAnalysis, gradDecision) {
  const chapterConstants = require('./chapterConstants');
  const chapterGen = (() => {
    try { return require('./chapterGenerationService'); } catch (_) { return null; }
  })();

  const completedIndex = plan.chapterIndex || 0;
  const completedLevel = plan.chapterLevel || chapterConstants.levelForChapterIndex(completedIndex);
  const completedTheme = plan.chapterTheme || chapterConstants.themeForChapterIndex(completedIndex);

  // Mark final phase completed before snapshotting.
  const finalPhase = plan.phases[plan.currentPhaseIndex];
  if (finalPhase) {
    finalPhase.status = 'completed';
    finalPhase.completedAt = new Date();
  }

  // Recovery-graduation? The phase we just promoted from was a recovery
  // bridge created by an earlier demotion. Tag the snapshot so analytics
  // can distinguish "earned graduation" from "recovered through the bridge".
  const wasRecoveryGraduation = !!(finalPhase && finalPhase._isRecovery);

  // Snapshot the completed chapter (read-only forever — G9).
  plan.chaptersCompleted = plan.chaptersCompleted || [];
  plan.chaptersCompleted.push({
    index: completedIndex,
    level: completedLevel,
    theme: completedTheme,
    phases: JSON.parse(JSON.stringify(plan.phases)), // deep clone
    completedAt: new Date(),
    masteryAtCompletion: gradDecision.mastery ?? null,
    exitReason: wasRecoveryGraduation ? 'recovery_graduated' : 'graduated'
  });

  // Was this the final chapter (C2)? Enter mastery_mode (G5).
  if (completedIndex >= chapterConstants.TOTAL_CHAPTERS - 1) {
    plan.status = 'mastery_mode';
    plan.history.push({
      date: new Date(),
      lessonId: lessonAnalysis.lessonId || null,
      changeDescription: `Graduated final chapter ${completedLevel} → entered Mastery Mode`,
      phaseIndexBefore: plan.currentPhaseIndex,
      phaseIndexAfter: plan.currentPhaseIndex,
      masteryAtAdvance: gradDecision.mastery ?? null,
      reason: 'chapter_graduated'
    });
    plan.pendingTransitions = plan.pendingTransitions || {};
    plan.pendingTransitions.chapterJustCompleted = true;
    plan.pendingTransitions.masteryModeEntered = true;
    plan.pendingTransitions.celebrationShownCount = 0;
    try {
      const cefrEstimator = require('./cefrEstimatorService');
      await cefrEstimator.refresh(plan, { trigger: 'chapter_graduation' });
    } catch (err) {
      console.error('[LearningPlan] CEFR reveal at mastery_mode entry failed (non-blocking):', err.message);
    }
    return { masteryMode: true };
  }

  // Generate the next chapter.
  const nextIndex = completedIndex + 1;
  const nextLevel = chapterConstants.levelForChapterIndex(nextIndex);
  const nextTheme = chapterConstants.themeForChapterIndex(nextIndex);

  let newPhases = [];
  try {
    if (chapterGen && typeof chapterGen.generateNextChapter === 'function') {
      newPhases = await chapterGen.generateNextChapter(plan, {
        completedChapterIndex: completedIndex,
        completedChapterLevel: completedLevel,
        nextLevel,
        completedPhases: plan.phases
      });
    }
  } catch (err) {
    console.error('[LearningPlan] Chapter generation failed (will use minimal fallback):', err);
  }

  // Minimal fallback if chapterGen isn't wired in yet (Batch 1 → 2 boundary)
  // or if generation failed (G7).
  if (!Array.isArray(newPhases) || newPhases.length === 0) {
    newPhases = _minimalChapterFallback(nextLevel, plan.goal);
  }

  // Roll over.
  plan.chapterIndex = nextIndex;
  plan.chapterLevel = nextLevel;
  plan.chapterTheme = nextTheme;
  plan.phases = newPhases.map((p, i) => ({
    ...p,
    status: i === 0 ? 'active' : 'locked',
    lessonsCompleted: 0,
    lessonScores: [],
    lessonTutorIds: [],
    masteryAverage: null,
    focusSkillIds: [],
    bayesianMasteryAverage: null,
    completedAt: null,
    studentEditedAt: null,
    tutorVotes: []
  }));
  plan.currentPhaseIndex = 0;
  phaseScope.syncAllPhases(plan);
  // Clear decay state on new chapter.
  plan.decayWarnings = 0;

  plan.history.push({
    date: new Date(),
    lessonId: lessonAnalysis.lessonId || null,
    changeDescription: `Graduated chapter ${completedLevel} → ${nextLevel} (mastery ${gradDecision.mastery ?? 'n/a'})`,
    phaseIndexBefore: plan.currentPhaseIndex,
    phaseIndexAfter: plan.currentPhaseIndex,
    masteryAtAdvance: gradDecision.mastery ?? null,
    reason: 'chapter_graduated'
  });

  plan.pendingTransitions = plan.pendingTransitions || {};
  plan.pendingTransitions.chapterJustCompleted = true;
  plan.pendingTransitions.celebrationShownCount = 0;

  // CEFR reveal — chapter graduation is a natural moment to refresh the
  // student's level estimate. Force a reveal regardless of monthly cooldown.
  try {
    const cefrEstimator = require('./cefrEstimatorService');
    await cefrEstimator.refresh(plan, { trigger: 'chapter_graduation' });
  } catch (err) {
    console.error('[LearningPlan] CEFR reveal at graduation failed (non-blocking):', err.message);
  }

  console.log(`🎓 [LearningPlan] Chapter graduated: ${completedLevel} → ${nextLevel}`);
  return { graduated: true, fromLevel: completedLevel, toLevel: nextLevel };
}

/**
 * Minimal hand-rolled chapter fallback. Used if chapterGenerationService
 * isn't loaded or AI fails (G7). Replaced by Batch 2's deterministic
 * templates + AI path.
 */
function _minimalChapterFallback(level, goal) {
  return [
    { title: `${level} · Phase 1`, description: `Build foundations at ${level} level.`, focusAreas: [], suggestedTopics: [], exitCriteria: '', estimatedLessons: 5 },
    { title: `${level} · Phase 2`, description: `Expand vocabulary and structures at ${level} level.`, focusAreas: [], suggestedTopics: [], exitCriteria: '', estimatedLessons: 5 },
    { title: `${level} · Phase 3`, description: `Apply ${level} skills in real-world scenarios.`, focusAreas: [], suggestedTopics: [], exitCriteria: '', estimatedLessons: 5 },
    { title: `${level} · Phase 4`, description: `Consolidate ${level} mastery and prepare to advance.`, focusAreas: [], suggestedTopics: [], exitCriteria: '', estimatedLessons: 5 }
  ];
}

/**
 * Decay rule (G15). Two-step:
 *   1) First trip → set decayWarnings=1, log decay_warning, surface flag.
 *   2) Second trip → demote one chapter, log chapter_demoted, set demotion flag.
 *
 * Demotion bumps chapterIndex back by 1, regenerates phases for the
 * previous chapter (the original snapshot may have moved on), and clears
 * decayWarnings.
 *
 * Capped at chapter 1 (G6) — never demote below.
 * After 2 demotions in 90 days, set _transientFlags.humanInterventionSuggested.
 */
async function _applyDecayIfNeeded(plan) {
  // Don't decay during calibration window (G14 implicitly).
  if (!plan.calibrationLockedAt && plan.chapterIndex === 0) return;
  // Don't decay paused / completed / mastery_mode plans.
  if (['paused', 'completed', 'mastery_mode'].includes(plan.status)) return;

  const chapterLessons = (plan.phases || []).reduce((s, p) => s + (p.lessonsCompleted || 0), 0);
  const decision = mastery.evaluateDecay(plan, chapterLessons);

  if (decision.decay === 'none') return;

  if (decision.decay === 'warn') {
    plan.decayWarnings = 1;
    plan.history.push({
      date: new Date(),
      lessonId: null,
      changeDescription: `Decay warning · rolling mastery ${decision.mastery} below threshold`,
      phaseIndexBefore: plan.currentPhaseIndex,
      phaseIndexAfter: plan.currentPhaseIndex,
      masteryAtAdvance: decision.mastery ?? null,
      reason: 'decay_warning'
    });
    plan.pendingTransitions = plan.pendingTransitions || {};
    plan.pendingTransitions.decayWarning = true;
    return;
  }

  // decision.decay === 'demote'
  if (plan.chapterIndex <= 0) {
    // At chapter 1 already — can't demote below. Reset warnings, leave chapter alone.
    plan.decayWarnings = 0;
    plan.pendingTransitions = plan.pendingTransitions || {};
    plan.pendingTransitions.decayWarning = true;
    return;
  }

  await _demoteOneChapter(plan, 'decay');
}

/**
 * Demote the student one chapter back (decay or calibration-driven).
 *
 * Behaviour (Batch 13 — "bridge recovery"):
 *   - Snapshots the interrupted chapter as 'demoted' / 'calibrated'.
 *   - Regenerates phases for the previous chapter (template, since AI
 *     generation here would be wasteful), then drops the student onto
 *     the LAST phase of that chapter and marks it as `_isRecovery`.
 *     This is the "bridge" back to the level they fell out of, so a
 *     student who decayed from A2 P1 lands on A1 P4 (not A1 P1) — they
 *     keep the consolidation skills they already had.
 *   - Recovery phase uses a stricter graduation gate (mastery 80,
 *     ≥ 2 distinct tutors OR an explicit advance vote) before they can
 *     re-enter the chapter they fell out of (see masteryService).
 *   - Tracks ping-pong: if `lastDemotedFromLevel` matches the level we
 *     just demoted from, increment `pingPongCount` and surface
 *     `humanInterventionSuggested` (count ≥ 1) and `recoveryStuck`
 *     (count ≥ 2).
 *
 * Capped at chapter 1 — never demote below.
 */
async function _demoteOneChapter(plan, source = 'decay') {
  const chapterConstants = require('./chapterConstants');
  const chapterGen = (() => {
    try { return require('./chapterGenerationService'); } catch (_) { return null; }
  })();

  const fromIndex = plan.chapterIndex;
  const fromLevel = plan.chapterLevel;
  const fromTheme = plan.chapterTheme;
  const toIndex = Math.max(0, fromIndex - 1);
  const toLevel = chapterConstants.levelForChapterIndex(toIndex);
  const toTheme = chapterConstants.themeForChapterIndex(toIndex);

  // Ping-pong detection: if the student previously fell out of fromLevel
  // (i.e., they had been demoted from this level before) and they made
  // it back up here only to fall again, that's a ping-pong.
  const isPingPong = plan.lastDemotedFromLevel === fromLevel;

  // Snapshot current chapter as 'demoted' / 'calibrated'.
  plan.chaptersCompleted = plan.chaptersCompleted || [];
  plan.chaptersCompleted.push({
    index: fromIndex,
    level: fromLevel,
    theme: fromTheme,
    phases: JSON.parse(JSON.stringify(plan.phases)),
    completedAt: new Date(),
    masteryAtCompletion: plan.phases?.[plan.currentPhaseIndex]?.masteryAverage ?? null,
    exitReason: source === 'calibration' ? 'calibrated' : 'demoted'
  });

  // Generate new phases for previous chapter (template only — never AI here).
  let newPhases = [];
  try {
    if (chapterGen && typeof chapterGen.generateNextChapter === 'function') {
      newPhases = await chapterGen.generateNextChapter(plan, {
        completedChapterIndex: fromIndex,
        completedChapterLevel: fromLevel,
        nextLevel: toLevel,
        completedPhases: plan.phases,
        forceTemplate: true
      });
    }
  } catch (err) {
    console.error('[LearningPlan] Demotion regen failed (using minimal fallback):', err);
  }
  if (!Array.isArray(newPhases) || newPhases.length === 0) {
    newPhases = _minimalChapterFallback(toLevel, plan.goal);
  }

  // Hydrate the new chapter. The recovery phase is the LAST one; mark it,
  // make it active, and lock the rest. Lessons/scores/tutorIds reset to
  // give the recovery a clean rolling-window read.
  const recoveryIndex = newPhases.length - 1;
  plan.chapterIndex = toIndex;
  plan.chapterLevel = toLevel;
  plan.chapterTheme = toTheme;
  plan.phases = newPhases.map((p, i) => ({
    ...p,
    status: i === recoveryIndex ? 'active' : 'locked',
    lessonsCompleted: 0,
    lessonScores: [],
    lessonTutorIds: [],
    masteryAverage: null,
    focusSkillIds: [],
    bayesianMasteryAverage: null,
    completedAt: null,
    studentEditedAt: null,
    tutorVotes: [],
    _isRecovery: i === recoveryIndex
  }));
  plan.currentPhaseIndex = recoveryIndex;
  phaseScope.syncAllPhases(plan);
  plan.decayWarnings = 0;

  // Remember which level we fell out of, so the NEXT promotion (when
  // they graduate the recovery phase) can detect ping-pong if they
  // bounce back here.
  plan.lastDemotedFromLevel = fromLevel;

  // Ping-pong counter (independent of the 90-day demotion window —
  // counts the number of times we've fallen out of the same level).
  if (isPingPong) {
    plan.pingPongCount = (plan.pingPongCount || 0) + 1;
  }

  // Track demotion for human-intervention rule (G6) — kept for the
  // 90-day "two demotions in 90 days" surfacing.
  plan.demotionEvents = plan.demotionEvents || [];
  plan.demotionEvents.push(new Date());
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  plan.demotionEvents = plan.demotionEvents.filter(d => new Date(d).getTime() > cutoff);

  plan.history.push({
    date: new Date(),
    lessonId: null,
    changeDescription: source === 'calibration'
      ? `Calibration demoted ${fromLevel} → ${toLevel} (recovery on last phase)${isPingPong ? ' [ping-pong]' : ''}`
      : `Decay demoted ${fromLevel} → ${toLevel} (recovery on last phase)${isPingPong ? ' [ping-pong]' : ''}`,
    phaseIndexBefore: 0,
    phaseIndexAfter: recoveryIndex,
    masteryAtAdvance: null,
    reason: source === 'calibration' ? 'calibration_demoted' : 'chapter_demoted'
  });

  plan.pendingTransitions = plan.pendingTransitions || {};
  plan.pendingTransitions.chapterDemotionPending = true;
  plan.pendingTransitions.celebrationShownCount = 0;
  // Surface human intervention as soon as we've ping-ponged once OR
  // hit two demotions in the trailing 90 days (existing G6 behaviour).
  if ((plan.pingPongCount || 0) >= 1 || plan.demotionEvents.length >= 2) {
    plan.pendingTransitions.humanInterventionSuggested = true;
  }
  // Strong "let's pause and talk to your tutor" surface at ≥ 2 ping-pongs.
  if ((plan.pingPongCount || 0) >= 2) {
    plan.pendingTransitions.recoveryStuck = true;
  }

  console.log(`📉 [LearningPlan] Chapter demoted (${source}): ${fromLevel} → ${toLevel} (recovery@phase ${recoveryIndex + 1}, pingPong=${plan.pingPongCount || 0})`);
}

/**
 * Adaptive phase splitting (Batch 11, premium-only).
 *
 * When a premium student has spent N lessons on a phase with rolling
 * mastery stuck below threshold, split that phase into 2a/2b. Same
 * total length budget — we just give them more time on a sub-section.
 *
 * The AI proposes WHERE to split based on the phase's focusAreas.
 *
 * Called at the end of `_updatePlanWithAi` after the mastery gate ran.
 * Free students never reach this code path.
 *
 * Returns true if a split happened (caller may want to mark the plan
 * for an "I noticed X is harder than expected" notification).
 */
const SPLIT_TRIGGER_LESSONS = 6;     // stuck for ≥ 6 lessons
const SPLIT_TRIGGER_MASTERY = 60;    // and rolling mastery still < 60
async function _maybeSplitPhase(plan) {
  if (!plan?.phases) return false;
  const idx = plan.currentPhaseIndex;
  const phase = plan.phases[idx];
  if (!phase) return false;
  // Already split (we mark with _isSplit) or already a fundamentals.
  if (phase._isSplit || phase._isFundamentals) return false;

  const lessons = phase.lessonsCompleted || 0;
  const avg = phase.masteryAverage;

  if (lessons < SPLIT_TRIGGER_LESSONS) return false;
  if (avg === null || avg === undefined || avg >= SPLIT_TRIGGER_MASTERY) return false;

  // Ask AI to propose a split. If AI fails, hand-roll a simple split:
  // split focusAreas in half, keep the phase title, append 'a' / 'b'.
  let split = null;
  try {
    split = await _generateSplitWithAi(phase, plan);
  } catch (err) {
    console.warn('[LearningPlan] Phase split AI failed, using simple split:', err.message);
  }
  if (!split) split = _simpleSplitPhase(phase);

  // Replace the current phase with two: 2a (active, ongoing focus) and 2b (locked).
  const before = phase;
  const phaseA = {
    ...before,
    title: split.aTitle,
    description: split.aDescription || before.description,
    focusAreas: split.aFocusAreas || before.focusAreas,
    estimatedLessons: Math.max(3, Math.round((before.estimatedLessons || 5) / 2)),
    status: 'active',
    _isSplit: true,
    // Keep the existing scores/lesson count — student doesn't lose progress.
    lessonsCompleted: before.lessonsCompleted,
    lessonScores: before.lessonScores,
    lessonTutorIds: before.lessonTutorIds,
    masteryAverage: before.masteryAverage,
    studentEditedAt: null,
    completedAt: null,
    tutorVotes: []
  };
  const phaseB = {
    title: split.bTitle,
    description: split.bDescription || '',
    focusAreas: split.bFocusAreas || [],
    suggestedTopics: before.suggestedTopics || [],
    exitCriteria: before.exitCriteria || '',
    estimatedLessons: Math.max(3, Math.round((before.estimatedLessons || 5) / 2)),
    lessonsCompleted: 0,
    lessonScores: [],
    lessonTutorIds: [],
    masteryAverage: null,
    status: 'locked',
    completedAt: null,
    studentEditedAt: null,
    tutorVotes: [],
    _isSplit: true
  };

  plan.phases.splice(idx, 1, phaseA, phaseB);
  plan.history.push({
    date: new Date(),
    lessonId: null,
    changeDescription: `Phase split into "${split.aTitle}" + "${split.bTitle}" (stuck at ${avg}/100)`,
    phaseIndexBefore: idx,
    phaseIndexAfter: idx,
    masteryAtAdvance: avg ?? null,
    reason: 'phase_split'
  });
  plan.pendingTransitions = plan.pendingTransitions || {};
  plan.pendingTransitions.phaseSplit = true;
  console.log(`✂️  [LearningPlan] Phase split: "${before.title}" → "${split.aTitle}" + "${split.bTitle}"`);
  return true;
}

async function _generateSplitWithAi(phase, plan) {
  const prompt = `A student is stuck on this phase of their language learning plan. Propose a split.

PHASE TO SPLIT:
- Title: ${phase.title}
- Description: ${phase.description}
- Focus areas: ${(phase.focusAreas || []).join(', ')}
- Exit criteria: ${phase.exitCriteria}
- Lessons completed: ${phase.lessonsCompleted}
- Rolling mastery: ${phase.masteryAverage}/100

CONTEXT:
- Language: ${plan.language}
- Goal: ${plan.goal?.type} (${plan.goal?.description || ''})
- Current chapter: ${plan.chapterLevel}

Split into two sub-phases (2a = current, narrower focus; 2b = follow-up).
Total length stays the same — we're just giving them more space.

Respond ONLY with valid JSON:
{
  "aTitle": "string (max 50 chars)",
  "aDescription": "string (1 sentence)",
  "aFocusAreas": ["string", ...],
  "bTitle": "string (max 50 chars)",
  "bDescription": "string (1 sentence)",
  "bFocusAreas": ["string", ...]
}`;
  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a language pedagogy expert. Propose phase splits that respect the student\'s level and stuck point. Always JSON.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.5,
    max_tokens: 500,
    response_format: { type: 'json_object' }
  });
  return JSON.parse(completion.choices[0].message.content);
}

function _simpleSplitPhase(phase) {
  const focus = phase.focusAreas || [];
  const half = Math.ceil(focus.length / 2) || 1;
  return {
    aTitle: `${phase.title} · part 1`,
    aDescription: phase.description,
    aFocusAreas: focus.slice(0, half),
    bTitle: `${phase.title} · part 2`,
    bDescription: phase.description,
    bFocusAreas: focus.slice(half)
  };
}

/**
 * Calibration window (Batch 5). Only fires in the FIRST 5 lessons of
 * chapter 1 — its job is to find the student's true level before regular
 * mastery logic kicks in.
 *
 * - First 3 lessons average > 85 → promote one chapter (cap +1, G4)
 * - First 3 lessons average < 40 → demote one chapter, OR if already at
 *   chapter 1, generate a "fundamentals" phase 0 (G31 — never go below)
 * - At lesson 5 → lock calibration (calibrationLockedAt) so future
 *   lessons go through the regular mastery path.
 *
 * Returns true if the chapter was modified by calibration this lesson,
 * so the caller can skip the regular mastery gate (it would be noisy).
 */
async function _applyCalibrationIfNeeded(plan, lessonAnalysis) {
  // Already locked or past chapter 1 → nothing to do.
  if (plan.calibrationLockedAt) return false;
  if (plan.chapterIndex !== 0) return false;

  const chapterLessons = (plan.phases || []).reduce((s, p) => s + (p.lessonsCompleted || 0), 0);

  // Lock after the configured lesson count even if calibration didn't fire.
  if (chapterLessons >= mastery.CALIBRATION_LOCK_AFTER_LESSON) {
    plan.calibrationLockedAt = new Date();
    plan.history.push({
      date: new Date(),
      lessonId: lessonAnalysis.lessonId || null,
      changeDescription: `Calibration window closed after ${chapterLessons} lessons`,
      phaseIndexBefore: plan.currentPhaseIndex,
      phaseIndexAfter: plan.currentPhaseIndex,
      masteryAtAdvance: null,
      reason: null
    });
    return false;
  }

  const decision = mastery.evaluateCalibration(plan, chapterLessons);
  if (decision.calibration === 'hold') return false;

  if (decision.calibration === 'promote') {
    await _calibrationPromoteOneChapter(plan, lessonAnalysis, decision);
    return true;
  }
  if (decision.calibration === 'demote') {
    if (plan.chapterIndex > 0) {
      await _demoteOneChapter(plan, 'calibration');
      // _demoteOneChapter pushed its own history + flags. Surface the
      // distinct calibration variant via celebration label override.
      plan.pendingTransitions = plan.pendingTransitions || {};
      plan.pendingTransitions.chapterDemotionPending = true;
    } else {
      // Already at chapter 1 — generate a fundamentals phase 0 (G31).
      _ensureFundamentalsPhaseZero(plan, lessonAnalysis, decision);
    }
    return true;
  }
  return false;
}

/**
 * Promote one chapter forward via calibration. Snapshots the brief
 * chapter 1 stay and generates new phases for the next CEFR level.
 * Sets pendingTransitions.chapterPromotionPending so the celebration
 * modal uses positive framing ("You're ahead of the curve").
 */
async function _calibrationPromoteOneChapter(plan, lessonAnalysis, decision) {
  const chapterConstants = require('./chapterConstants');
  const chapterGen = (() => {
    try { return require('./chapterGenerationService'); } catch (_) { return null; }
  })();

  const fromIndex = plan.chapterIndex;
  const fromLevel = plan.chapterLevel;
  const fromTheme = plan.chapterTheme;
  const toIndex = Math.min(chapterConstants.TOTAL_CHAPTERS - 1, fromIndex + 1);
  const toLevel = chapterConstants.levelForChapterIndex(toIndex);
  const toTheme = chapterConstants.themeForChapterIndex(toIndex);

  // Snapshot the brief stay as 'calibrated'.
  plan.chaptersCompleted = plan.chaptersCompleted || [];
  plan.chaptersCompleted.push({
    index: fromIndex,
    level: fromLevel,
    theme: fromTheme,
    phases: JSON.parse(JSON.stringify(plan.phases)),
    completedAt: new Date(),
    masteryAtCompletion: decision.mastery ?? null,
    exitReason: 'calibrated'
  });

  let newPhases = [];
  try {
    if (chapterGen && typeof chapterGen.generateNextChapter === 'function') {
      newPhases = await chapterGen.generateNextChapter(plan, {
        completedChapterIndex: fromIndex,
        completedChapterLevel: fromLevel,
        nextLevel: toLevel,
        completedPhases: plan.phases,
        forceTemplate: true   // calibration uses template — fast and predictable
      });
    }
  } catch (err) {
    console.error('[LearningPlan] Calibration regen failed (using minimal fallback):', err);
  }
  if (!Array.isArray(newPhases) || newPhases.length === 0) {
    newPhases = _minimalChapterFallback(toLevel, plan.goal);
  }

  plan.chapterIndex = toIndex;
  plan.chapterLevel = toLevel;
  plan.chapterTheme = toTheme;
  plan.phases = newPhases.map((p, i) => ({
    ...p,
    status: i === 0 ? 'active' : 'locked',
    lessonsCompleted: 0,
    lessonScores: [],
    lessonTutorIds: [],
    masteryAverage: null,
    focusSkillIds: [],
    bayesianMasteryAverage: null,
    completedAt: null,
    studentEditedAt: null,
    tutorVotes: []
  }));
  plan.currentPhaseIndex = 0;
  phaseScope.syncAllPhases(plan);
  plan.decayWarnings = 0;

  plan.history.push({
    date: new Date(),
    lessonId: lessonAnalysis.lessonId || null,
    changeDescription: `Calibration promoted ${fromLevel} → ${toLevel} (avg ${decision.mastery})`,
    phaseIndexBefore: 0,
    phaseIndexAfter: 0,
    masteryAtAdvance: decision.mastery ?? null,
    reason: 'calibration_promoted'
  });

  plan.pendingTransitions = plan.pendingTransitions || {};
  plan.pendingTransitions.chapterPromotionPending = true;
  plan.pendingTransitions.celebrationShownCount = 0;

  console.log(`⬆️  [LearningPlan] Calibration promoted: ${fromLevel} → ${toLevel}`);
}

/**
 * Edge case G31: chapter 1 student calibrated below floor. Don't demote
 * (no chapter 0 exists). Instead prepend a "Fundamentals" phase 0 to the
 * current chapter and shift everything forward. Surfaced via the same
 * demotion modal but with calibrated framing in copy.
 */
function _ensureFundamentalsPhaseZero(plan, lessonAnalysis, decision) {
  // Check if we already prepended (idempotent — calibration could in theory
  // re-fire but we lock at lesson 5).
  if (plan.phases?.[0]?._isFundamentals) return;

  const fundamentals = {
    title: 'Foundations refresher',
    description: 'A quick reset on the absolute basics so the rest of the journey lands.',
    focusAreas: ['greetings', 'pronouns', 'basic verbs'],
    suggestedTopics: ['introducing yourself', 'asking simple questions'],
    exitCriteria: 'Hold a 30-second introduction.',
    estimatedLessons: 4,
    lessonsCompleted: 0,
    lessonScores: [],
    lessonTutorIds: [],
    masteryAverage: null,
    status: 'active',
    completedAt: null,
    studentEditedAt: null,
    tutorVotes: [],
    _isFundamentals: true
  };

  // Demote the previously-active phase to locked, prepend fundamentals.
  if (plan.phases?.[0]) plan.phases[0].status = 'locked';
  plan.phases = [fundamentals, ...(plan.phases || [])];
  plan.currentPhaseIndex = 0;

  plan.history.push({
    date: new Date(),
    lessonId: lessonAnalysis.lessonId || null,
    changeDescription: `Calibration added Fundamentals phase (avg ${decision.mastery})`,
    phaseIndexBefore: 0,
    phaseIndexAfter: 0,
    masteryAtAdvance: decision.mastery ?? null,
    reason: 'calibration_demoted'
  });

  plan.pendingTransitions = plan.pendingTransitions || {};
  plan.pendingTransitions.chapterDemotionPending = true;
  plan.pendingTransitions.celebrationShownCount = 0;

  console.log('🛡️  [LearningPlan] Calibration prepended Fundamentals phase');
}

/**
 * Premium path. Lesson count + mastery score have already been pushed
 * onto the phase by `updatePlanAfterLesson`. Here we ask the AI to:
 *   - judge whether the student is ready to advance
 *   - rewrite the studentSummary + nextLessonFocus
 * Then we run the mastery gate, treating the AI's recommendation as a
 * hint that can lift a borderline phase but never bypass the floor.
 */
/**
 * Pull concrete signals from a lesson analysis that the AI prompt insists
 * on referencing — verbs/grammar points named in the analysis, struggle
 * keys, vocabulary items. Used both as prompt input and as validation.
 */
function _extractNamedSignals(lessonAnalysis) {
  const signals = new Set();
  const fields = [
    lessonAnalysis.strugglesKeys,
    lessonAnalysis.struggles,
    lessonAnalysis.grammarFocus,
    lessonAnalysis.vocabularyHighlights,
    lessonAnalysis.topicsCovered
  ];
  for (const field of fields) {
    if (!field) continue;
    if (Array.isArray(field)) {
      for (const item of field) {
        if (typeof item === 'string') signals.add(item.trim());
        else if (item?.key) signals.add(String(item.key).trim());
        else if (item?.name) signals.add(String(item.name).trim());
      }
    } else if (typeof field === 'string') {
      signals.add(field.trim());
    }
  }
  return [...signals].filter(Boolean).slice(0, 8);
}

/**
 * Reject obviously generic AI output. Heuristic — we'd rather re-prompt
 * once than ship "great job, keep practicing" to a paying customer.
 */
function _validateAiPlanUpdate(result, namedSignals) {
  if (!result || typeof result !== 'object') return { ok: false, reason: 'no JSON' };
  const focus = String(result.nextLessonFocus || '').trim();
  if (!focus) return { ok: false, reason: 'empty nextLessonFocus' };
  if (focus.length < 25) return { ok: false, reason: 'nextLessonFocus too short' };

  // Generic-phrase detection.
  const genericPhrases = [
    /^keep practic(e|ing)/i,
    /^great job/i,
    /^well done/i,
    /work on your skills/i,
    /continue (practicing|learning)/i,
    /focus on improving/i
  ];
  if (genericPhrases.some(re => re.test(focus))) {
    return { ok: false, reason: 'starts with a generic phrase' };
  }
  if (isDefinitivePlanFocus(focus)) {
    return { ok: false, reason: 'nextLessonFocus must be suggestive, not a commitment (avoid "We will" / "You will")' };
  }

  // If we have named signals, require at least one to appear (case-insensitive).
  if (namedSignals.length > 0) {
    const lower = focus.toLowerCase();
    const referencesAnySignal = namedSignals.some(sig => sig && lower.includes(sig.toLowerCase()));
    if (!referencesAnySignal) {
      // Soft accept if focus is at least 60 chars and starts with an activity verb
      // (some rare lessons have no extractable signals).
      const startsWithActivityVerb = /^(drill|roleplay|practice|review|build|compare|contrast|explain|describe|tell|write|read|listen|repeat|use)\b/i.test(focus);
      if (!startsWithActivityVerb) return { ok: false, reason: 'does not reference any specific signal from the analysis' };
    }
  }
  return { ok: true };
}

async function _updatePlanWithAi(plan, lessonAnalysis, lessonScore) {
  console.log(`📋 [LearningPlan] [premium/AI] Updating plan ${plan._id} (lessonScore: ${lessonScore})`);

  const compactPlan = compactPlanForPrompt(plan);
  const analysisContext = buildAnalysisContext(lessonAnalysis);

  // Pull concrete signals the prompt insists on referencing — verbs/grammar
  // points named in the analysis, the tutor's name, the goal. The validator
  // uses these to detect generic outputs and trigger a re-prompt.
  const namedSignals = _extractNamedSignals(lessonAnalysis);
  const tutorName = lessonAnalysis.tutorName || (lessonAnalysis.tutorId ? 'your tutor' : '');
  const goalDesc = plan.goal?.description || plan.goal?.type || '';

  const promptBase = (extraNote = '') => `You are updating a premium student's learning plan after their latest lesson.

CURRENT PLAN:
${JSON.stringify(compactPlan, null, 2)}

LATEST LESSON ANALYSIS:
${analysisContext}

THIS LESSON'S MASTERY SCORE (0–100): ${lessonScore ?? 'unavailable'}
TUTOR: ${tutorName || '(unknown)'}
STUDENT GOAL: ${goalDesc || '(unspecified)'}
SPECIFIC SIGNALS FROM THE ANALYSIS (REFERENCE THESE BY NAME, do not be generic):
${namedSignals.length ? namedSignals.map(s => `- ${s}`).join('\n') : '(no specific signals — be honest, lean on the lesson context)'}

Phase promotion is mastery-gated. The system enforces these rules
*after* you respond, you do not control them:
  - Never advance before ${compactPlan.promotionRules.minLessonsPerPhase} lessons in a phase.
  - Always advance after ${compactPlan.promotionRules.maxLessonsPerPhase} lessons in a phase.
  - In between, advance when rolling mastery ≥ ${compactPlan.promotionRules.masteryThreshold}.
You may *recommend* advancement on a borderline case (when the rolling
average is just under threshold but the trajectory is clearly upward).
Only set shouldAdvancePhase=true when you genuinely believe the student
has met the phase's exitCriteria. Do not advance to be encouraging.

Quality bar (REQUIRED for premium tier):
1. nextLessonFocus MUST reference at least one specific verb, grammar
   point, or topic named in the analysis (e.g., "past tense of 'ir'", not
   "past tense practice").
2. nextLessonFocus MUST start with a recommended ACTIVITY VERB (e.g.,
   "Drill", "Roleplay", "Practice", "Review", "Build", "Compare").
3. studentSummary should reference the tutor's name (${tutorName}) when
   appropriate, and should feel like a personal note about today's lesson.
4. Avoid generic phrases like "keep practicing", "great job", "work on
   your skills".
5. ${PLAN_FOCUS_PHRASING_PROMPT_BLOCK.replace(/\n/g, '\n   ')}${extraNote ? '\n\nIMPORTANT: ' + extraNote : ''}

Your job:
1. Decide shouldAdvancePhase (true/false) using the rules above.
2. Write a warm, second-person studentSummary referencing THIS lesson.
3. Write a specific, actionable nextLessonFocus that follows the quality bar — as a suggestion for the tutor, not a promise to the student.
4. Optionally update weeklyRecommendations.focusBetweenLessons.

Respond ONLY with valid JSON:
{
  "shouldAdvancePhase": false,
  "studentSummary": "string — warm update",
  "nextLessonFocus": "string — suggested focus for the tutor (recommendatory, starts with an activity verb)",
  "weeklyRecommendations": {
    "focusBetweenLessons": "string — updated practice advice"
  },
  "planAdjustmentNote": "string — brief note about what changed, or empty"
}`;

  let result = {};
  let attempts = 0;
  const maxAttempts = 2;
  let qualityNote = '';

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const completion = await getOpenAIClient().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert language teacher updating a premium student learning plan. Always respond with valid JSON only. Be SPECIFIC, never generic — your output is the differentiator the student is paying for. Respect the mastery-gated promotion rules. nextLessonFocus must be a suggestive recommendation for the tutor, never a commitment about what will happen in the lesson.'
          },
          { role: 'user', content: promptBase(qualityNote) }
        ],
        temperature: 0.5,
        max_tokens: 800,
        response_format: { type: 'json_object' }
      });
      result = JSON.parse(completion.choices[0].message.content);
    } catch (err) {
      console.error('[LearningPlan] AI update failed, falling back to rule path:', err);
      return _updatePlanWithRules(plan, lessonAnalysis);
    }

    const validation = _validateAiPlanUpdate(result, namedSignals);
    if (validation.ok) break;

    if (attempts < maxAttempts) {
      console.warn(`[LearningPlan] AI output failed validation (${validation.reason}); re-prompting once.`);
      qualityNote = `Your previous response was rejected: ${validation.reason}. Try again with a SPECIFIC nextLessonFocus that names concrete language items.`;
    } else {
      console.warn(`[LearningPlan] AI output still failed validation after retry (${validation.reason}); falling back to rule path.`);
      return _updatePlanWithRules(plan, lessonAnalysis);
    }
  }

  // Apply mastery gate (with AI hint). Now async because chapter graduation
  // may trigger an AI-driven chapter regeneration (Batch 1+).
  await _applyMasteryPromotion(plan, lessonAnalysis, { aiRecommendsAdvance: !!result.shouldAdvancePhase });

  // Note: plan.status === 'completed' is no longer reachable through this
  // every-phase-completed check because chapter graduation regenerates phases
  // for the next chapter (status -> 'active' on phase 0). The terminal state
  // is now plan.status === 'mastery_mode', set inside _completeChapterAndGenerateNext.

  plan.studentSummary = result.studentSummary || plan.studentSummary;
  if (result.weeklyRecommendations?.focusBetweenLessons) {
    plan.weeklyRecommendations.focusBetweenLessons = result.weeklyRecommendations.focusBetweenLessons;
  }

  // Resolve the next-lesson focus through the new resolver. The
  // resolver picks the skillId + source (tutor priority / upstream
  // diagnosis / aggregator / phase default) and stamps focusHistory.
  //
  // For premium AI users, we prefer the AI's nextLessonFocus *string*
  // if it referenced the resolver-picked skill — it carries warmer
  // language. Otherwise we use the resolver's deterministic focus line
  // so the student doesn't get a generic AI sentence overruling a real
  // signal-driven pick. Either way, activeFocusSkillId is the
  // resolver's choice (single source of truth).
  const resolved = await _resolveNextFocus(plan, lessonAnalysis);
  if (resolved && resolved.skillId && result.nextLessonFocus) {
    const lowerAi = String(result.nextLessonFocus).toLowerCase();
    const lowerSkill = (resolved.displayName || '').toLowerCase();
    if (lowerSkill && lowerAi.includes(lowerSkill)) {
      plan.nextLessonFocus = normalizePlanFocusText(result.nextLessonFocus);
    }
  } else if (!resolved?.focusLine && result.nextLessonFocus) {
    // Resolver had no signal at all — keep the AI line as a last resort.
    plan.nextLessonFocus = normalizePlanFocusText(result.nextLessonFocus);
  }

  plan.lastUpdatedAt = new Date();
  plan.lastUpdatedFromLessonId = lessonAnalysis.lessonId || null;
  plan.lastUpdateMode = 'lesson';

  console.log(`✅ [LearningPlan] Plan updated (AI). Phase: ${plan.currentPhaseIndex + 1}/${plan.phases.length}, focus: ${plan.activeFocusSource || 'none'} → ${plan.activeFocusSkillId || '<free-text>'}`);
  return plan;
}

/**
 * Free-tier path. Lesson count + mastery score were already pushed onto
 * the phase by `updatePlanAfterLesson`. We:
 *   1) run the mastery gate
 *   2) generate a fresh, personalized nextLessonFocus from analysis signals
 *      (no AI call — uses fields the analysis already produces)
 *   3) honour any tutor override (highest priority)
 */
async function _updatePlanWithRules(plan, lessonAnalysis) {
  console.log(`📋 [LearningPlan] [free/rule] Updating plan ${plan._id}`);

  await _applyMasteryPromotion(plan, lessonAnalysis);

  // Note: see _updatePlanWithAi note — plan.status terminal is now 'mastery_mode'.

  // Focus selection: resolver is the new single source of truth
  // (handles tutor overrides, structured tutor priorities, upstream
  // diagnosis, aggregator top struggle, phase fallback). It also
  // records the pick into focusHistory.
  await _resolveNextFocus(plan, lessonAnalysis);

  plan.lastUpdatedAt = new Date();
  plan.lastUpdatedFromLessonId = lessonAnalysis.lessonId || null;
  plan.lastUpdateMode = 'rule';

  console.log(`✅ [LearningPlan] Plan updated (rule). Phase: ${plan.currentPhaseIndex + 1}/${plan.phases.length}, focus: ${plan.activeFocusSource || 'none'} → ${plan.activeFocusSkillId || '<free-text>'}`);
  return plan;
}

/**
 * Build a one-sentence "Next lesson focus" line from real analysis signals.
 * Returns null if the analysis is too thin to be useful (caller will keep the
 * existing focus).
 *
 * Priority of signals:
 *   1. Persistent challenges (recurring across lessons → most actionable)
 *   2. Top error #1                                  (impact-ranked by AI)
 *   3. First areaForImprovement                      (broader bucket)
 *   4. recommendedFocus[0]                           (analyzer's suggestion)
 *   5. Active phase title fallback                   (always exists)
 *
 * We mix in one phrasing template per call to keep the line feeling fresh
 * even though the underlying logic is deterministic.
 */
function _generateRuleBasedFocus(plan, analysis) {
  if (!analysis) return null;

  const phase = plan.phases?.[plan.currentPhaseIndex || 0];
  const phaseTitle = phase?.title || '';

  const persistent = (analysis.progressionMetrics?.persistentChallenges || [])
    .filter(s => typeof s === 'string' && s.trim());
  const topError = (analysis.topErrors || [])
    .sort((a, b) => (a.rank || 99) - (b.rank || 99))[0];
  const areaToImprove = (analysis.areasForImprovement || [])
    .find(s => typeof s === 'string' && s.trim());
  const recommended = (analysis.recommendedFocus || [])
    .find(s => typeof s === 'string' && s.trim());

  let primary = null;
  let kind = null;

  if (persistent.length > 0) {
    primary = persistent[0];
    kind = 'persistent';
  } else if (topError?.issue) {
    primary = topError.issue;
    kind = 'top-error';
  } else if (areaToImprove) {
    primary = areaToImprove;
    kind = 'area';
  } else if (recommended) {
    primary = recommended;
    kind = 'recommended';
  }

  if (!primary) {
    // Nothing to base the focus on — keep whatever exists.
    return null;
  }

  // Compress to a tight clause (the home widget clamps to 2 lines).
  const tight = String(primary).replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');

  // Rotate phrasing per analysis to avoid the line ever feeling stuck.
  const seed = (analysis._id?.toString().charCodeAt(0) || 0) % 4;
  const templates = {
    persistent: [
      `Keep working on ${tight} — it has come up across multiple lessons.`,
      `Practice ${tight} again — small reps each lesson will compound.`,
      `Revisit ${tight} so it stops being the recurring blocker.`,
      `Spend a few minutes on ${tight}; it has shown up more than once.`
    ],
    'top-error': [
      `Focus on ${tight} — this was your biggest stumble last lesson.`,
      `Drill ${tight} next session to clean up the most-impactful error.`,
      `Work on ${tight}; addressing it will move your accuracy the most.`,
      `Target ${tight} early in the next lesson while it's fresh.`
    ],
    area: [
      `Build on ${tight} during your next lesson.`,
      `Carry ${tight} into your next conversation as a clear theme.`,
      `Use ${tight} as the through-line for your next session.`,
      `Bring ${tight} into focus next time you speak.`
    ],
    recommended: [
      `Try ${tight} in your next lesson.`,
      `Bring ${tight} to the next session and see how it lands.`,
      `Add ${tight} to your next lesson plan.`,
      `Work ${tight} into the next lesson naturally.`
    ]
  };

  let line = templates[kind][seed];

  // Anchor to phase context if we have it — helps the student see *why*.
  if (phaseTitle && kind !== 'persistent') {
    line += ` (${phaseTitle.toLowerCase()})`;
  }

  // Soft length cap — keep it skimmable in the widget clamp.
  if (line.length > 180) line = line.slice(0, 177).replace(/\s+\S*$/, '') + '…';

  return normalizePlanFocusText(line);
}

/**
 * Regenerate plan when student changes their goal.
 *
 * IMPORTANT: This does NOT wipe the plan. The student's demonstrated
 * proficiency (chapterIndex/chapterLevel/chapterTheme), past chapters,
 * tutor context, AI quota, and UX state are all PRESERVED. Only the
 * current chapter's phases + goal-derived copy are rewritten so the
 * roadmap reflects the new intent.
 *
 * Why: a goal change is almost always a refinement ("Travel" → "Move
 * abroad"), not a restart. Wiping the plan punishes engaged students
 * disproportionately and lies about their level on the next tutor
 * briefing. See docs/learning-journey/scenarios.md G2.
 *
 * Enforces tier-appropriate cooldown, with a 24h grace window after the
 * plan's *initial* creation so users can correct an onboarding mistake.
 *
 * Edge cases:
 *  - No existing plan       → falls back to generateInitialPlan (first plan).
 *  - Plan in 'mastery_mode' → updates goal + summary only; no phases to regenerate.
 *  - Plan in 'draft'        → preserves chapter (which is just the default A1)
 *                             but rewrites phases — same end result as a reset
 *                             would produce, with no information lost.
 */
/**
 * Run only the post-lesson side effects that make sense for a student
 * without a structured plan ('unframed') or with a paused plan.
 *
 * Skipped: phase advancement, chapter graduation, calibration, decay,
 *          adaptive splits, plan-update transitions.
 * Run:     CEFR estimate refresh, material recommendations, immediate
 *          quiz push, tutor "teaching is sticking" emission.
 *
 * Lessons taken without a plan still nudge counters used by the soft
 * "Want a plan?" prompt — see _markUnframedLessonObserved.
 */
async function _runPostLessonSideEffectsOnly(plan, lessonAnalysis) {
  // Tutor "teaching is sticking" notifications. Independent of plan state.
  try {
    const tutorBriefing = require('./tutorBriefingService');
    await tutorBriefing.emitTeachingStickingSignals(lessonAnalysis);
  } catch (err) {
    console.error('[LearningPlan] Teaching-sticking emission failed (non-blocking):', err.message);
  }

  // Immediate post-lesson quiz push (premium-gated inside quizService).
  try {
    const quizService = require('./quizService');
    await quizService.pushImmediateFromLesson(lessonAnalysis);
  } catch (err) {
    console.error('[LearningPlan] Immediate quiz push failed (non-blocking):', err.message);
  }

  // CEFR estimator — useful for both unframed and paused students; their
  // level should keep updating even without a journey to spend it on.
  try {
    const cefrEstimator = require('./cefrEstimatorService');
    await cefrEstimator.refresh(plan);
  } catch (err) {
    console.error('[LearningPlan] CEFR estimator refresh failed (non-blocking):', err.message);
  }

  // Material recommendations still help; the recommended-materials surface
  // on the home page is independent of the journey roadmap.
  try {
    const student = await User.findById(plan.studentId);
    if (entitlements.shouldRecommendMaterialsPostLesson(student)) {
      const recs = await postLessonRecommendations.computeRecommendations({
        studentId: plan.studentId,
        language: plan.language,
        lessonAnalysis,
        currentTutorId: lessonAnalysis.tutorId || null,
        limit: 5
      });
      if (recs.length > 0) {
        plan.recommendedMaterials = recs.map(r => ({
          materialId: r.materialId,
          matchedStruggles: r.matchedStruggles,
          fromLessonId: lessonAnalysis.lessonId || null,
          addedAt: new Date()
        }));
        plan.recommendedMaterialsUpdatedAt = new Date();
      }
    }
  } catch (err) {
    console.error('[LearningPlan] Material recommendation step failed (non-blocking):', err);
  }

  await plan.save();
  return plan;
}

/**
 * Create a thin "unframed" plan — no goal, no phases, no chapters. Used
 * when a student opts out of the structured journey ("learn at my own
 * pace") either during onboarding or from the profile.
 *
 * The plan still anchors per-language data (recommendations, CEFR
 * estimate, tutor focus lanes, history) so we can promote it later
 * without losing anything.
 */
async function createUnframedPlan(studentId, language) {
  const existing = await LearningPlan.findOne({ studentId, language });
  if (existing) return existing;

  const plan = new LearningPlan({
    studentId,
    language,
    // Goal is required by the schema; use 'other' as a sentinel for "no
    // structured goal yet". The journey UI keys off `status === 'unframed'`,
    // not goal type, so this is purely a placeholder.
    goal: {
      type: 'other',
      description: '',
      targetLevel: '',
      timeline: 'no_rush',
      timelinePressure: 'no_rush',
      targetDate: null
    },
    selfAssessedLevel: 'some_basics',
    currentPhaseIndex: 0,
    phases: [],
    chapterIndex: 0,
    chapterLevel: 'A1',
    chapterTheme: 'a1-desert',
    status: 'unframed',
    unframedAt: new Date(),
    history: [{
      changeDescription: 'Plan created without a goal — student chose to learn at their own pace.',
      reason: 'created'
    }]
  });

  await plan.save();
  console.log(`📋 [LearningPlan] Created unframed plan for student ${studentId}, language ${language}`);
  return plan;
}

/**
 * Pause an existing plan. Preserves all state — phases, chapters, history,
 * CEFR estimate. Resume later restores everything in place.
 */
async function pausePlan(studentId, language) {
  const plan = await LearningPlan.findOne({ studentId, language });
  if (!plan) {
    const err = new Error('No plan to pause');
    err.statusCode = 404;
    throw err;
  }
  if (plan.status === 'paused') return plan;
  if (plan.status === 'completed') {
    const err = new Error('Cannot pause a completed plan');
    err.statusCode = 409;
    throw err;
  }

  const lessonsSoFar = (plan.phases || [])
    .reduce((sum, p) => sum + (p.lessonsCompleted || 0), 0);

  plan.status = 'paused';
  plan.pausedAt = new Date();
  plan.lessonsAtUnframed = lessonsSoFar;
  plan.softPlanPromptDismissedAt = null;
  plan.history = plan.history || [];
  plan.history.push({
    changeDescription: 'Plan paused by student.',
    reason: null
  });

  await plan.save();
  return plan;
}

/**
 * Resume a paused plan. Restores 'active' (or 'draft' if no lessons yet).
 */
async function resumePlan(studentId, language) {
  const plan = await LearningPlan.findOne({ studentId, language });
  if (!plan) {
    const err = new Error('No plan to resume');
    err.statusCode = 404;
    throw err;
  }
  if (plan.status !== 'paused') return plan;

  const hasLessons = (plan.phases || [])
    .some(p => (p.lessonsCompleted || 0) > 0);

  plan.status = hasLessons ? 'active' : 'draft';
  plan.pausedAt = null;
  plan.softPlanPromptDismissedAt = null;
  plan.history = plan.history || [];
  plan.history.push({
    changeDescription: 'Plan resumed by student.',
    reason: null
  });

  await plan.save();
  return plan;
}

/**
 * Drop a structured plan in favor of unframed mode. Different from pause:
 * the chapter snapshot is archived to chaptersCompleted (so past maps still
 * works) and phases are cleared, but the plan can be re-promoted from
 * scratch later via promoteUnframedPlan.
 */
async function unframeExistingPlan(studentId, language) {
  const plan = await LearningPlan.findOne({ studentId, language });
  if (!plan) return await createUnframedPlan(studentId, language);
  if (plan.status === 'unframed') return plan;

  const lessonsSoFar = (plan.phases || [])
    .reduce((sum, p) => sum + (p.lessonsCompleted || 0), 0);

  plan.status = 'unframed';
  plan.unframedAt = new Date();
  plan.lessonsAtUnframed = lessonsSoFar;
  plan.hadStructuredPlan = true;
  plan.softPlanPromptDismissedAt = null;
  plan.phases = [];
  plan.currentPhaseIndex = 0;
  plan.history = plan.history || [];
  plan.history.push({
    changeDescription: 'Student switched to learn-at-own-pace mode.',
    reason: null
  });

  await plan.save();
  return plan;
}

/**
 * Promote an unframed plan to a structured plan. Sets the goal, then runs
 * the same generator path used at onboarding so we get phases and chapters.
 */
async function promoteUnframedPlan(studentId, language, newGoal) {
  const plan = await LearningPlan.findOne({ studentId, language });
  if (!plan) return null;
  if (plan.status !== 'unframed') return plan;

  const user = await User.findById(studentId);
  if (user) {
    user.onboardingData = user.onboardingData || {};
    user.onboardingData.learningGoal = {
      type: newGoal.type,
      description: newGoal.description || '',
      targetLevel: newGoal.targetLevel || '',
      selfAssessedLevel: newGoal.selfAssessedLevel || user.onboardingData.learningGoal?.selfAssessedLevel || 'some_basics',
      timeline: newGoal.timeline || 'no_rush',
      targetDate: newGoal.targetDate || null
    };
    await user.save();
  }

  // Regenerate against the new goal — preserves chapter history and CEFR
  // state since `_regeneratePlanForGoalChange` mutates in place.
  plan.status = 'draft';
  plan.unframedAt = null;
  plan.lessonsAtUnframed = 0;
  plan.softPlanPromptDismissedAt = null;
  await plan.save();

  return await _regeneratePlanForGoalChange(plan, newGoal);
}

/**
 * Restore a previously-structured plan that the student switched to own
 * pace, reusing the goal still stored on the plan — so they pick up their
 * roadmap rather than starting over. Returns null with `{ needsGoal: true }`
 * semantics (i.e. null) when there's no usable saved goal, so the caller can
 * fall back to the build-a-plan (goal picker) flow instead.
 */
async function restoreUnframedPlan(studentId, language) {
  const plan = await LearningPlan.findOne({ studentId, language });
  if (!plan) return null;
  if (plan.status !== 'unframed') return plan;

  const goal = plan.goal;
  // 'other' is the sentinel used by createUnframedPlan for plans that never
  // had a real structured goal — those should build fresh, not restore.
  if (!goal?.type || goal.type === 'other') return null;

  return await promoteUnframedPlan(studentId, language, {
    type: goal.type,
    description: goal.description || '',
    targetLevel: goal.targetLevel || '',
    timeline: goal.timeline || 'no_rush',
    targetDate: goal.targetDate || null,
    selfAssessedLevel: plan.selfAssessedLevel || 'some_basics'
  });
}

/**
 * Mark the soft "Want a plan?" prompt as dismissed. Throttles re-firing
 * for ~30 days from the dismissal moment.
 */
async function dismissSoftPlanPrompt(studentId, language) {
  const plan = await LearningPlan.findOne({ studentId, language });
  if (!plan) return null;
  plan.softPlanPromptDismissedAt = new Date();
  await plan.save();
  return plan;
}

async function regeneratePlan(studentId, language, newGoal) {
  const existing = await LearningPlan.findOne({ studentId, language });
  const user = await User.findById(studentId);
  const cooldownDays = entitlements.getGoalChangeCooldownDays(user);

  if (cooldownDays > 0 && existing?.lastGoalChangedAt) {
    const planAgeMs = existing.createdAt ? Date.now() - new Date(existing.createdAt).getTime() : Infinity;
    const isWithinGrace = planAgeMs < GOAL_CHANGE_GRACE_MS;

    if (!isWithinGrace) {
      const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
      const msSinceChange = Date.now() - existing.lastGoalChangedAt.getTime();
      if (msSinceChange < cooldownMs) {
        const nextAvailable = new Date(existing.lastGoalChangedAt.getTime() + cooldownMs);
        const error = new Error('Goal change cooldown active');
        error.statusCode = 429;
        error.nextChangeAvailableAt = nextAvailable;
        error.cooldownDays = cooldownDays;
        throw error;
      }
    }
  }

  if (user) {
    user.onboardingData = user.onboardingData || {};
    user.onboardingData.learningGoal = {
      type: newGoal.type,
      description: newGoal.description || '',
      targetLevel: newGoal.targetLevel || '',
      selfAssessedLevel: newGoal.selfAssessedLevel || user.onboardingData.learningGoal?.selfAssessedLevel || 'some_basics',
      timeline: newGoal.timeline || 'no_rush',
      targetDate: newGoal.targetDate || null
    };
    await user.save();
  }

  // No existing plan → first-time creation path. Nothing to preserve.
  if (!existing) {
    return await generateInitialPlan(studentId, language);
  }

  return await _regeneratePlanForGoalChange(existing, newGoal);
}

/**
 * In-place mutation of an existing plan for a goal change. Preserves
 * demonstrated state and chapter history. Caller has already validated
 * cooldown and updated user.onboardingData.
 */
async function _regeneratePlanForGoalChange(plan, newGoal) {
  const chapterGen = (() => {
    try { return require('./chapterGenerationService'); } catch (_) { return null; }
  })();

  const oldGoal = {
    type: plan.goal?.type,
    description: plan.goal?.description || '',
    targetLevel: plan.goal?.targetLevel || '',
    timeline: plan.goal?.timeline || plan.goal?.timelinePressure || 'no_rush'
  };
  const previousPhasesSnapshot = (plan.phases || []).map(p => ({
    title: p.title,
    description: p.description
  }));
  const phaseIndexBefore = plan.currentPhaseIndex || 0;

  // 1. Update the goal itself.
  plan.goal = {
    type: newGoal.type,
    description: newGoal.description || '',
    targetLevel: newGoal.targetLevel || '',
    timeline: newGoal.timeline || 'no_rush',
    timelinePressure: newGoal.timeline || 'no_rush',
    targetDate: newGoal.targetDate || null
  };

  // 2. Mastery_mode plans don't have phases to regenerate — they're
  // post-C2. Just record the change and exit.
  if (plan.status === 'mastery_mode') {
    plan.lastUpdatedAt = new Date();
    plan.lastGoalChangedAt = new Date();
    plan.lastUpdateMode = 'goal_change';
    plan.history.push({
      date: new Date(),
      changeDescription: `Goal changed: ${GOAL_TYPE_LABELS[oldGoal.type] || oldGoal.type || 'unknown'} → ${GOAL_TYPE_LABELS[newGoal.type] || newGoal.type} (mastery mode — no phase change)`,
      phaseIndexBefore,
      phaseIndexAfter: phaseIndexBefore,
      reason: 'goal_change'
    });
    await plan.save();
    return plan;
  }

  // 3. Regenerate the current chapter's 4 phases. Free → template,
  // Premium → AI, with G7 fallback handled inside chapterGen.
  let newPhases = [];
  if (chapterGen && typeof chapterGen.regenerateChapterForGoalChange === 'function') {
    try {
      newPhases = await chapterGen.regenerateChapterForGoalChange(plan, {
        oldGoal,
        previousPhases: previousPhasesSnapshot
      });
    } catch (err) {
      console.error('[LearningPlan] Goal-change chapter regen failed (using minimal fallback):', err);
    }
  }
  if (!Array.isArray(newPhases) || newPhases.length === 0) {
    newPhases = _minimalChapterFallback(plan.chapterLevel || 'A1', plan.goal);
  }

  // 4. Replace phases. Reset per-phase mastery state (the new phases
  // haven't been taught yet) and tutor votes (votes were on phases that
  // no longer exist). Cross-phase state (chapter, decay, calibration,
  // tutor overrides, tutor focus, recommended materials, AI quota,
  // intro state) is preserved.
  plan.phases = newPhases.map((p, i) => ({
    title: p.title,
    description: p.description || '',
    focusAreas: p.focusAreas || [],
    suggestedTopics: p.suggestedTopics || [],
    exitCriteria: p.exitCriteria || '',
    estimatedLessons: p.estimatedLessons || 5,
    lessonsCompleted: 0,
    lessonScores: [],
    lessonTutorIds: [],
    masteryAverage: null,
    focusSkillIds: [],
    bayesianMasteryAverage: null,
    status: i === 0 ? 'active' : 'locked',
    completedAt: null,
    studentEditedAt: null,
    tutorVotes: []
  }));
  plan.currentPhaseIndex = 0;
  phaseScope.syncAllPhases(plan);

  // 5. Refresh goal-derived copy. weeklyRecommendations IS goal-specific
  // now (pace), so recompute it here when the goal changes — keep any
  // existing focusBetweenLessons copy if present.
  try {
    const pace = require('./paceService');
    plan.weeklyRecommendations = pace.buildWeeklyRecommendations(
      plan.goal,
      plan.weeklyRecommendations?.focusBetweenLessons || ''
    );
  } catch (err) {
    console.warn('[LearningPlan] Pace refresh on goal change failed (non-blocking):', err.message);
  }
  const firstPhase = plan.phases[0];
  if (firstPhase) {
    const raw =
      firstPhase.description
      || (firstPhase.focusAreas && firstPhase.focusAreas[0])
      || `Start ${firstPhase.title}`;
    plan.nextLessonFocus = normalizePlanFocusText(raw);
  }
  plan.studentSummary = `Your roadmap has been updated to reflect your new goal: ${GOAL_TYPE_LABELS[newGoal.type] || newGoal.type}. You're keeping your progress at level ${plan.chapterLevel || 'A1'} — only the upcoming phases have changed.`;

  // 6. Bookkeeping.
  plan.lastUpdatedAt = new Date();
  plan.lastGoalChangedAt = new Date();
  plan.lastUpdateMode = 'goal_change';
  plan.history.push({
    date: new Date(),
    changeDescription: `Goal changed: ${GOAL_TYPE_LABELS[oldGoal.type] || oldGoal.type || 'unknown'} → ${GOAL_TYPE_LABELS[newGoal.type] || newGoal.type}. Chapter ${plan.chapterLevel || 'A1'} preserved, phases rewritten.`,
    phaseIndexBefore,
    phaseIndexAfter: 0,
    reason: 'goal_change'
  });

  await plan.save();
  console.log(`✅ [LearningPlan] Goal change applied — chapter ${plan.chapterLevel} preserved, ${plan.phases.length} new phases`);
  return plan;
}

// ── Premium AI regeneration (rate-limited) ────────────────────────────
//
// Premium students can ask the AI to rewrite their journey on demand
// (e.g. "I don't want Exploring Daily Life — try again with my goal").
// Capped at REGEN_LIMIT_PER_30_DAYS to control cost and prevent thrashing.
// Free users cannot trigger this — they edit their plan in place instead.

const REGEN_LIMIT_PER_30_DAYS = 2;
const REGEN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Drop timestamps older than 30 days from the plan's regeneration log.
 * Mutates the plan in place. Returns the pruned array for convenience.
 */
function _pruneAiRegenerations(plan) {
  const cutoff = Date.now() - REGEN_WINDOW_MS;
  plan.aiRegenerationsAt = (plan.aiRegenerationsAt || []).filter(
    d => d && new Date(d).getTime() > cutoff
  );
  return plan.aiRegenerationsAt;
}

/**
 * Read-only snapshot of how many AI regenerations a premium student has
 * left in the rolling 30-day window. Safe to expose to the client.
 *
 * Returns: { used, remaining, limit, nextAvailableAt|null }
 */
function getAiRegenerationStatus(plan) {
  if (!plan) {
    return { used: 0, remaining: REGEN_LIMIT_PER_30_DAYS, limit: REGEN_LIMIT_PER_30_DAYS, nextAvailableAt: null };
  }
  _pruneAiRegenerations(plan);
  const used = plan.aiRegenerationsAt.length;
  const remaining = Math.max(0, REGEN_LIMIT_PER_30_DAYS - used);
  let nextAvailableAt = null;
  if (remaining === 0 && used > 0) {
    const oldest = plan.aiRegenerationsAt
      .slice()
      .sort((a, b) => new Date(a) - new Date(b))[0];
    nextAvailableAt = new Date(new Date(oldest).getTime() + REGEN_WINDOW_MS);
  }
  return { used, remaining, limit: REGEN_LIMIT_PER_30_DAYS, nextAvailableAt };
}

/**
 * Regenerate the plan via AI without changing the student's goal.
 * Premium-only. Enforces the 2-per-30-day cap. The student's own
 * `regenReason` is folded into the AI prompt so the AI knows what to
 * change ("I don't want Exploring Daily Life topics", etc.).
 */
async function regeneratePlanWithAi(studentId, language, regenReason = '') {
  const user = await User.findById(studentId);
  if (!user) {
    const e = new Error('User not found');
    e.statusCode = 404;
    throw e;
  }
  if (!entitlements.isPremium(user)) {
    const e = new Error('AI regeneration is a Premium feature');
    e.statusCode = 403;
    throw e;
  }

  const existing = await LearningPlan.findOne({ studentId, language });
  if (!existing) {
    const e = new Error('No learning plan found for this language');
    e.statusCode = 404;
    throw e;
  }

  const status = getAiRegenerationStatus(existing);
  if (status.remaining <= 0) {
    const e = new Error('AI regeneration limit reached for this 30-day window');
    e.statusCode = 429;
    e.nextRegenAvailableAt = status.nextAvailableAt;
    e.regenLimit = status.limit;
    throw e;
  }

  // Carry the student's reason forward so generateInitialPlan can incorporate
  // it. We stash it on the user temporarily — generateInitialPlan reads
  // user.onboardingData.learningGoal which we don't change here.
  const prevHistory = (existing.history || []).slice(-3);
  const prevPhases = (existing.phases || []).map(p => ({
    title: p.title,
    description: p.description,
    status: p.status
  }));

  // Delete the old plan + recreate via the existing pipeline, then patch
  // the new plan with the regen log + history breadcrumb.
  await LearningPlan.deleteOne({ _id: existing._id });

  const fresh = await generateInitialPlan(studentId, language, {
    studentRegenReason: regenReason,
    previousPhasesSummary: prevPhases
  });

  if (fresh) {
    fresh.aiRegenerationsAt = [...(existing.aiRegenerationsAt || []), new Date()];
    _pruneAiRegenerations(fresh);
    fresh.history.push({
      date: new Date(),
      changeDescription: regenReason
        ? `AI regenerated by student: ${regenReason.slice(0, 200)}`
        : 'AI regenerated by student',
      phaseIndexBefore: existing.currentPhaseIndex,
      phaseIndexAfter: 0,
      reason: 'goal_change'
    });
    await fresh.save();
  }

  return fresh;
}

// ── Student-owned phase edits ─────────────────────────────────────────
//
// Free + Premium can edit phase text fields directly. No AI cost.
// Edits are append-only into history for audit. Completed phases are
// frozen — students can only edit active or locked phases.

const MAX_TITLE_LEN = 60;
const MAX_DESC_LEN = 300;
const MAX_LIST_ITEMS = 12;
const MAX_LIST_ITEM_LEN = 80;

function _sanitizeStringList(list) {
  if (!Array.isArray(list)) return null;
  const cleaned = list
    .filter(s => typeof s === 'string')
    .map(s => s.trim().slice(0, MAX_LIST_ITEM_LEN))
    .filter(s => s.length > 0)
    .slice(0, MAX_LIST_ITEMS);
  return cleaned;
}

/**
 * Apply a student-driven edit to a single phase.
 * `updates` may contain: title, description, focusAreas, suggestedTopics.
 */
async function editPhase(studentId, language, phaseIndex, updates) {
  const plan = await LearningPlan.findOne({ studentId, language });
  if (!plan) {
    const e = new Error('No learning plan found');
    e.statusCode = 404;
    throw e;
  }

  const idx = Number(phaseIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= plan.phases.length) {
    const e = new Error('Invalid phase index');
    e.statusCode = 400;
    throw e;
  }

  const phase = plan.phases[idx];
  if (phase.status === 'completed') {
    const e = new Error('Completed phases cannot be edited');
    e.statusCode = 400;
    throw e;
  }

  const changes = [];

  if (typeof updates.title === 'string') {
    const next = updates.title.trim().slice(0, MAX_TITLE_LEN);
    if (next.length === 0) {
      const e = new Error('Phase title cannot be empty');
      e.statusCode = 400;
      throw e;
    }
    if (next !== phase.title) {
      changes.push(`title → "${next}"`);
      phase.title = next;
    }
  }

  if (typeof updates.description === 'string') {
    const next = updates.description.trim().slice(0, MAX_DESC_LEN);
    if (next !== phase.description) {
      changes.push('description');
      phase.description = next;
    }
  }

  const focusAreas = _sanitizeStringList(updates.focusAreas);
  if (focusAreas !== null) {
    changes.push('focus areas');
    phase.focusAreas = focusAreas;
  }

  const suggestedTopics = _sanitizeStringList(updates.suggestedTopics);
  if (suggestedTopics !== null) {
    changes.push('suggested topics');
    phase.suggestedTopics = suggestedTopics;
  }

  if (changes.length === 0) {
    return plan; // nothing to do — caller can re-render with fresh server state
  }

  // High-signal cue for tutors that this phase's framing reflects the
  // student's own priorities (not AI defaults).
  phase.studentEditedAt = new Date();

  // If the *active* phase was just edited, seed nextLessonFocus from the
  // student's own framing so the home widget and tutor briefing reflect
  // the new priorities immediately — without waiting for the next lesson
  // analysis. We respect a recent tutor override (which always wins).
  if (idx === (plan.currentPhaseIndex || 0)) {
    const recentTutorOverride = (plan.tutorOverrides || [])
      .filter(o => o.action === 'adjust_focus' && o.note)
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const recentTutorLane = (plan.tutorFocusByTutorId || [])
      .filter(t => t.focus)
      .sort((a, b) => new Date(b.setAt) - new Date(a.setAt))[0];

    if (!recentTutorOverride && !recentTutorLane) {
      const seeded = _seedFocusFromPhase(phase);
      if (seeded) {
        plan.nextLessonFocus = seeded;
        changes.push('next-lesson focus seeded from edits');
      }
    }
  }

  plan.history.push({
    date: new Date(),
    changeDescription: `Phase ${idx + 1} edited by student: ${changes.join(', ')}`,
    phaseIndexBefore: idx,
    phaseIndexAfter: idx
  });
  plan.lastUpdatedAt = new Date();
  await plan.save();
  return plan;
}

/**
 * Build a short, actionable next-lesson focus line from a phase's own
 * fields. Used when the student edits the active phase so the tutor and
 * home-widget messaging reflect the new framing without a lesson cycle.
 *
 * Priority: focus areas → first sentence of description → phase title.
 */
function _seedFocusFromPhase(phase) {
  const focusAreas = (phase.focusAreas || [])
    .filter(s => typeof s === 'string' && s.trim());
  if (focusAreas.length) {
    const top = focusAreas.slice(0, 2).map(s => s.trim().replace(/[.!?]+$/, ''));
    const line = top.length === 1
      ? `Consider practicing ${top[0].toLowerCase()} in your next lesson.`
      : `Consider practicing ${top[0].toLowerCase()} and ${top[1].toLowerCase()} in your next lesson.`;
    return normalizePlanFocusText(line);
  }

  if (phase.description && phase.description.trim()) {
    const first = phase.description
      .trim()
      .split(/(?<=[.!?])\s+/)[0]
      .trim()
      .slice(0, 160);
    if (first) return normalizePlanFocusText(first);
  }

  if (phase.title && phase.title.trim()) {
    return normalizePlanFocusText(
      `Consider working on ${phase.title.trim().replace(/[.!?]+$/, '').toLowerCase()}.`
    );
  }
  return null;
}

/**
 * Reorder phases. Only locked phases may be moved — completed and active
 * phases stay where they are. Pass an array of the new locked-phase order
 * by their *original indices*.
 *
 * Example: 5 phases [completed, active, locked, locked, locked]
 *          fromIndex=4, toIndex=2  → swaps the last and first locked
 *          → [completed, active, locked(orig#4), locked(orig#2), locked(orig#3)]
 */
async function reorderLockedPhases(studentId, language, fromIndex, toIndex) {
  const plan = await LearningPlan.findOne({ studentId, language });
  if (!plan) {
    const e = new Error('No learning plan found');
    e.statusCode = 404;
    throw e;
  }
  const f = Number(fromIndex);
  const t = Number(toIndex);
  if (!Number.isInteger(f) || !Number.isInteger(t)) {
    const e = new Error('fromIndex and toIndex must be integers');
    e.statusCode = 400;
    throw e;
  }
  if (f === t) return plan;
  if (f < 0 || t < 0 || f >= plan.phases.length || t >= plan.phases.length) {
    const e = new Error('Index out of range');
    e.statusCode = 400;
    throw e;
  }
  if (plan.phases[f].status !== 'locked' || plan.phases[t].status !== 'locked') {
    const e = new Error('Only locked phases can be reordered');
    e.statusCode = 400;
    throw e;
  }

  const moving = plan.phases.splice(f, 1)[0];
  plan.phases.splice(t, 0, moving);

  plan.history.push({
    date: new Date(),
    changeDescription: `Phase reordered by student (was #${f + 1}, now #${t + 1})`,
    phaseIndexBefore: f,
    phaseIndexAfter: t
  });
  plan.lastUpdatedAt = new Date();
  await plan.save();
  return plan;
}

// ─────────────────────────────────────────────────────────────────────
// Conversational plan editing (Batch 12). Premium-only. Two-step flow:
//   1. proposePlanEdits(messages) — cheap, no budget cost. AI proposes a
//      structured set of edits scoped to the CURRENT chapter.
//   2. applyProposedEdits(edits, summary) — consumes one regen credit
//      from the same 2/30-day budget as full regeneration.
// The frontend renders a diff view between proposed phases and the
// current ones; the student approves or rejects.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a sanitized snapshot of the current chapter's phases for the AI
 * to reason about. We strip backend-only fields (lessonScores,
 * tutorVotes, etc.) — those are not editable through chat.
 */
function _phaseSnapshotForChat(phase) {
  return {
    title: phase.title,
    description: phase.description,
    focusAreas: Array.isArray(phase.focusAreas) ? phase.focusAreas : [],
    suggestedTopics: Array.isArray(phase.suggestedTopics) ? phase.suggestedTopics : [],
    exitCriteria: phase.exitCriteria || '',
    estimatedLessons: phase.estimatedLessons || 5,
    status: phase.status || 'locked'
  };
}

/**
 * Propose edits to the current chapter from a chat conversation.
 * Returns:
 *   {
 *     reply: 'natural language reply',
 *     proposedEdits: {
 *       summary: 'one-sentence summary of changes',
 *       phases: [<phase snapshot, full chapter>]   // null if no edits proposed yet
 *     }
 *   }
 *
 * Premium-gated. No budget cost.
 */
async function proposePlanEdits(studentId, language, messages) {
  const user = await User.findById(studentId);
  if (!user) {
    const e = new Error('User not found'); e.statusCode = 404; throw e;
  }
  if (!entitlements.isPremium(user)) {
    const e = new Error('Conversational plan editing is a Premium feature'); e.statusCode = 403; throw e;
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    const e = new Error('messages must be a non-empty array'); e.statusCode = 400; throw e;
  }

  const plan = await LearningPlan.findOne({ studentId, language });
  if (!plan) {
    const e = new Error('No learning plan found for this language'); e.statusCode = 404; throw e;
  }

  const currentPhases = (plan.phases || []).map(_phaseSnapshotForChat);
  const goal = plan.goal || {};
  const chapterContext = {
    chapterIndex: plan.chapterIndex || 0,
    chapterLevel: plan.chapterLevel,
    chapterTheme: plan.chapterTheme,
    goalType: goal.type || null,
    goalDescription: goal.description || ''
  };

  const systemPrompt = `You are a language-pedagogy assistant editing a student's learning plan in their CURRENT chapter only. Constraints:
- Phase count must stay the same (currently ${currentPhases.length}).
- Phase ORDER may NOT change — only content within phases.
- Stay within CEFR level ${chapterContext.chapterLevel}.
- Honor the student's goal: ${chapterContext.goalType} (${chapterContext.goalDescription}).
- Be conversational and concise. Ask clarifying questions if needed.

When you have enough information to propose changes, return a JSON object that includes:
{
  "reply": "<your conversational reply, max 3 sentences>",
  "proposedEdits": {
    "summary": "<one sentence summarizing changes, or empty if none yet>",
    "phases": [<full updated chapter as array of phase objects, OR null if not ready to propose>]
  }
}

Each proposed phase object must have: title, description, focusAreas (array), suggestedTopics (array), exitCriteria, estimatedLessons.
If the student is just chatting and hasn't asked for an edit yet, return phases: null.
Always valid JSON.`;

  const userTurnContent = JSON.stringify({
    chapterContext,
    currentPhases,
    conversation: messages.slice(-10)
  });

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userTurnContent }
    ],
    temperature: 0.4,
    max_tokens: 1500,
    response_format: { type: 'json_object' }
  });

  let parsed;
  try {
    parsed = JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    const e = new Error('AI returned invalid JSON'); e.statusCode = 502; throw e;
  }

  // Sanity-check the proposed phases: same count, valid structure. If
  // invalid, downgrade to a chat-only reply (no edits).
  let phases = parsed?.proposedEdits?.phases;
  if (phases !== null && phases !== undefined) {
    if (!Array.isArray(phases) || phases.length !== currentPhases.length) {
      phases = null;
    } else {
      phases = phases.map((p, i) => ({
        title: String(p?.title || currentPhases[i].title).slice(0, 100),
        description: String(p?.description || currentPhases[i].description).slice(0, 500),
        focusAreas: Array.isArray(p?.focusAreas) ? p.focusAreas.map(String).slice(0, 10) : currentPhases[i].focusAreas,
        suggestedTopics: Array.isArray(p?.suggestedTopics) ? p.suggestedTopics.map(String).slice(0, 10) : currentPhases[i].suggestedTopics,
        exitCriteria: String(p?.exitCriteria || currentPhases[i].exitCriteria).slice(0, 500),
        estimatedLessons: Math.min(20, Math.max(2, Number(p?.estimatedLessons) || currentPhases[i].estimatedLessons))
      }));
    }
  }

  return {
    reply: String(parsed?.reply || '').slice(0, 1000),
    proposedEdits: {
      summary: String(parsed?.proposedEdits?.summary || '').slice(0, 200),
      phases: phases || null
    },
    regen: getAiRegenerationStatus(plan)
  };
}

/**
 * Apply the proposed edits returned by `proposePlanEdits`. Consumes ONE
 * AI regeneration credit (same 2/30-day budget). Edits are limited to
 * the current chapter's phases — order and count are preserved, but per-
 * phase progress (lessonScores, tutorVotes, masteryAverage,
 * lessonsCompleted) is preserved untouched.
 */
async function applyProposedEdits(studentId, language, proposedPhases, summary) {
  const user = await User.findById(studentId);
  if (!user) {
    const e = new Error('User not found'); e.statusCode = 404; throw e;
  }
  if (!entitlements.isPremium(user)) {
    const e = new Error('Conversational plan editing is a Premium feature'); e.statusCode = 403; throw e;
  }
  if (!Array.isArray(proposedPhases) || proposedPhases.length === 0) {
    const e = new Error('proposedPhases must be a non-empty array'); e.statusCode = 400; throw e;
  }

  const plan = await LearningPlan.findOne({ studentId, language });
  if (!plan) {
    const e = new Error('No learning plan found for this language'); e.statusCode = 404; throw e;
  }

  if (proposedPhases.length !== plan.phases.length) {
    const e = new Error('Proposed edits must keep the same number of phases'); e.statusCode = 400; throw e;
  }

  const status = getAiRegenerationStatus(plan);
  if (status.remaining <= 0) {
    const e = new Error('AI regeneration limit reached for this 30-day window');
    e.statusCode = 429;
    e.nextRegenAvailableAt = status.nextAvailableAt;
    e.regenLimit = status.limit;
    throw e;
  }

  proposedPhases.forEach((edit, i) => {
    const phase = plan.phases[i];
    if (!phase) return;
    const previousTitle = phase.title;
    phase.title = String(edit.title || phase.title).slice(0, 100);
    phase.description = String(edit.description || phase.description).slice(0, 500);
    if (Array.isArray(edit.focusAreas)) phase.focusAreas = edit.focusAreas.map(String).slice(0, 10);
    if (Array.isArray(edit.suggestedTopics)) phase.suggestedTopics = edit.suggestedTopics.map(String).slice(0, 10);
    if (edit.exitCriteria != null) phase.exitCriteria = String(edit.exitCriteria).slice(0, 500);
    if (edit.estimatedLessons) {
      phase.estimatedLessons = Math.min(20, Math.max(2, Number(edit.estimatedLessons)));
    }
    phase.studentEditedAt = new Date();
    if (previousTitle !== phase.title) {
      plan.history.push({
        date: new Date(),
        changeDescription: `Chat-edit: "${previousTitle}" → "${phase.title}"`,
        phaseIndexBefore: i,
        phaseIndexAfter: i,
        reason: 'admin_override'
      });
    }
  });

  plan.aiRegenerationsAt = [...(plan.aiRegenerationsAt || []), new Date()];
  _pruneAiRegenerations(plan);
  plan.history.push({
    date: new Date(),
    changeDescription: summary
      ? `Conversational plan edit: ${String(summary).slice(0, 200)}`
      : 'Conversational plan edit applied',
    phaseIndexBefore: plan.currentPhaseIndex,
    phaseIndexAfter: plan.currentPhaseIndex,
    reason: 'admin_override'
  });
  plan.lastUpdatedAt = new Date();
  await plan.save();

  return {
    plan,
    regen: getAiRegenerationStatus(plan)
  };
}

// ─────────────────────────────────────────────────────────────────
//  Trial-lesson seeding.
//
//  Trial lessons capture no audio (cost decision), so there is never an
//  AI LessonAnalysis to tune the plan with. Instead, the trial tutor's
//  30-second mini-assessment (CEFR impression + "start with" focus areas)
//  seeds the plan. Seed-only by design: we activate a draft plan, set the
//  next-lesson focus and the tutor's focus lane, and let the CEFR
//  estimator absorb the tutor-sourced analysis — but we do NOT push a
//  lessonScore. A 25-minute first meeting is an unrepresentative sample
//  and must not advance phases or trigger calibration on its own.
// ─────────────────────────────────────────────────────────────────

/**
 * Seed the student's learning plan from a tutor's post-trial assessment.
 *
 * @param {Object} args
 * @param {ObjectId|string} args.studentId  - student User._id
 * @param {string} args.language            - plan language (e.g. 'German')
 * @param {Object} args.tutorUser           - tutor User doc (for lane attribution)
 * @param {string} args.cefrLevel           - tutor's CEFR impression ('A1'..'C2')
 * @param {string[]} [args.focusAreas]      - "start with" suggestions
 * @param {string} [args.note]              - optional free-text note
 * @param {ObjectId|string|null} [args.lessonId]
 * @returns {{ plan, created: boolean, seeded: boolean } | null}
 */
async function seedPlanFromTrialAssessment({ studentId, language, tutorUser, cefrLevel, focusAreas = [], note = '', lessonId = null }) {
  let plan = await LearningPlan.findOne({
    studentId,
    language,
    status: { $in: ['draft', 'active', 'mastery_mode', 'unframed', 'paused'] }
  });

  let created = false;
  if (!plan) {
    // No plan yet (onboarding goal may have been set without generating one).
    // generateInitialPlan reads the just-saved tutor-sourced LessonAnalysis,
    // so the new plan comes out 'active' and CEFR-informed. Returns null
    // when the student never set a learning goal.
    plan = await generateInitialPlan(studentId, language);
    if (!plan) return null;
    created = true;
  }

  const tutorName = [tutorUser?.firstName, tutorUser?.lastName].filter(Boolean).join(' ')
    || tutorUser?.name || '';
  const focusText = (focusAreas || []).map(f => String(f).trim()).filter(Boolean).join(', ');

  // 1. Upsert this tutor's focus lane (latest setAt wins at resolution time).
  //    Works for the different-next-tutor case too: focusResolverService
  //    prefers the upcoming lesson's tutor lane, falls back to most recent.
  if (focusText && tutorUser?._id) {
    plan.tutorFocusByTutorId = (plan.tutorFocusByTutorId || []).filter(
      e => String(e.tutorId) !== String(tutorUser._id)
    );
    plan.tutorFocusByTutorId.push({
      tutorId: tutorUser._id,
      tutorName,
      focus: focusText,
      note: (note || '').toString().slice(0, 500),
      setAt: new Date()
    });
  }

  // 2. Activate + focus-seed untuned (draft) plans. Plans already tuned by
  //    real lessons keep their focus — the lane above is enough there.
  let seeded = false;
  if (!created && plan.status === 'draft') {
    plan.status = 'active';
    if (focusText) plan.nextLessonFocus = focusText;
    seeded = true;
  } else if (!created && focusText && !plan.nextLessonFocus) {
    plan.nextLessonFocus = focusText;
    seeded = true;
  }

  plan.history.push({
    date: new Date(),
    lessonId: lessonId || null,
    changeDescription: `Trial assessment by ${tutorName || 'tutor'}: level ${cefrLevel || 'n/a'}${focusText ? ` · start with ${focusText.slice(0, 120)}` : ''}`,
    phaseIndexBefore: plan.currentPhaseIndex,
    phaseIndexAfter: plan.currentPhaseIndex,
    reason: 'trial_assessment'
  });
  plan.lastUpdatedAt = new Date();

  // 3. Let the CEFR estimator absorb the tutor-sourced analysis (it applies
  //    per-tutor bias correction and its own reveal gates). Best-effort.
  try {
    const cefrEstimator = require('./cefrEstimatorService');
    await cefrEstimator.refresh(plan);
  } catch (err) {
    console.warn('[LearningPlan] CEFR refresh after trial assessment failed (non-blocking):', err.message);
  }

  await plan.save();
  console.log(`📋 [LearningPlan] Trial assessment seeded plan ${plan._id} (created=${created}, seeded=${seeded})`);
  return { plan, created, seeded };
}

module.exports = {
  generateInitialPlan,
  updatePlanAfterLesson,
  recordQuizEvidence,
  seedPlanFromTrialAssessment,
  regeneratePlan,
  regeneratePlanWithAi,
  getAiRegenerationStatus,
  proposePlanEdits,
  applyProposedEdits,
  editPhase,
  reorderLockedPhases,
  createUnframedPlan,
  pausePlan,
  resumePlan,
  unframeExistingPlan,
  promoteUnframedPlan,
  restoreUnframedPlan,
  dismissSoftPlanPrompt,
  GOAL_TYPE_LABELS,
  LEVEL_LABELS
};
