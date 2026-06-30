const mongoose = require('mongoose');

// Tutor vote on the current phase. Tutors don't directly advance students
// anymore — their action becomes a vote that biases the mastery threshold.
// See docs/learning-journey/scenarios.md (G29, G30) and Batch 10.
const tutorVoteSchema = new mongoose.Schema({
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tutorName: { type: String, default: '' },
  vote: { type: String, enum: ['advance', 'hold'], required: true },
  note: { type: String, default: '' },
  setAt: { type: Date, default: Date.now },
  // 14-day window. After this, vote is silently ignored (G16).
  expiresAt: { type: Date, default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) }
}, { _id: false });

const phaseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  focusAreas: [{ type: String }],
  suggestedTopics: [{ type: String }],
  exitCriteria: { type: String, default: '' },
  estimatedLessons: { type: Number, default: 5 },
  lessonsCompleted: { type: Number, default: 0 },
  // Per-lesson mastery scores (0–100) for lessons taken while this phase
  // was active. Promotion is gated on the rolling average of this list.
  // See backend/services/masteryService.js.
  lessonScores: [{ type: Number, min: 0, max: 100 }],
  // Per-lesson tutor IDs aligned with lessonScores (parallel arrays). Used by
  // the decay rule (G12) which requires ≥ 2 distinct tutors before triggering.
  lessonTutorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // Cached rolling-window average so the client doesn't recompute it.
  // Maintained by learningPlanService whenever lessonScores changes.
  masteryAverage: { type: Number, default: null, min: 0, max: 100 },
  // Canonical skill IDs in scope for this phase (from focusAreas / topics).
  // Drives the Bayesian promotion gate when plan.masteryGateMode ≠ rollingScore.
  focusSkillIds: [{ type: String }],
  // Cached aggregate of Beta beliefs over focusSkillIds (0–100).
  bayesianMasteryAverage: { type: Number, default: null, min: 0, max: 100 },
  status: {
    type: String,
    enum: ['locked', 'active', 'completed'],
    default: 'locked'
  },
  completedAt: { type: Date, default: null },
  // Set the first time a student edits any field on this phase. Used to
  // signal to tutors that the framing here reflects the student's own
  // priorities (high-signal cue), not the AI's default copy.
  studentEditedAt: { type: Date, default: null },
  // Tutor votes on this phase (Batch 10). One vote per tutor; latest wins (G29).
  tutorVotes: [tutorVoteSchema],
  // Batch 11: marks a phase that was created by adaptive splitting (so
  // we don't re-split a sub-phase forever).
  _isSplit: { type: Boolean, default: false },
  // Batch 5: marks a fundamentals phase 0 added during calibration
  // (skip splitting / decay logic on it).
  _isFundamentals: { type: Boolean, default: false },
  // Batch 13: marks a phase that was created by a chapter demotion as the
  // single active recovery target (always the LAST phase of the demoted-to
  // chapter — the "bridge" back to the level the student fell out of).
  // Recovery phases use a stricter graduation gate (see
  // masteryService.MASTERY_RECOVERY_THRESHOLD) and require multi-tutor or
  // tutor-vote confirmation to graduate, to prevent ping-pong demotions.
  _isRecovery: { type: Boolean, default: false }
}, { _id: false });

const historyEntrySchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', default: null },
  changeDescription: { type: String, required: true },
  phaseIndexBefore: { type: Number, default: null },
  phaseIndexAfter: { type: Number, default: null },
  // Mastery snapshot at the time of the entry (for promotion entries).
  masteryAtAdvance: { type: Number, default: null },
  // Why the phase changed — useful for support / debugging / future analytics.
  reason: {
    type: String,
    enum: [
      'mastery_met', 'max_lessons_safety', 'tutor_advance', 'tutor_skip',
      'ai_advance', 'goal_change', 'created',
      // Trial lessons capture no audio; the tutor's post-trial mini-assessment
      // seeds the plan instead (activates draft, sets focus). Seed-only: no
      // lessonScore is pushed for trials.
      'trial_assessment',
      // Chapter system (Batch 1+)
      'chapter_graduated', 'chapter_demoted', 'calibration_promoted', 'calibration_demoted',
      'decay_warning', 'chapter_regenerated', 'tutor_vote_advance', 'tutor_vote_hold',
      'admin_override',
      // Batch 11: AI split a stuck phase into 2a/2b.
      'phase_split',
      // Tutor explicitly accepted the suggested next-lesson focus (adherence signal).
      'tutor_accept_focus',
      null
    ],
    default: null
  }
}, { _id: false });

// Snapshot of a completed chapter. Read-only by API design — there's no
// update endpoint that touches chaptersCompleted (G9). Past chapters are
// browsable via "Past maps" in the journey UI.
const completedChapterSchema = new mongoose.Schema({
  index: { type: Number, required: true },
  level: { type: String, required: true },
  theme: { type: String, required: true },
  phases: [phaseSchema],
  completedAt: { type: Date, default: Date.now },
  masteryAtCompletion: { type: Number, default: null },
  exitReason: {
    type: String,
    // 'graduated'           — earned the chapter cleanly
    // 'demoted'             — fell out due to decay
    // 'calibrated'          — moved by calibration window
    // 'recovery_graduated'  — graduated *out of* a recovery bridge phase
    //                         (Batch 13). Distinguished so analytics can
    //                         see which graduations came back through the
    //                         bridge instead of climbing first-time.
    enum: ['graduated', 'demoted', 'calibrated', 'recovery_graduated'],
    default: 'graduated'
  }
}, { _id: false });

const recommendedMaterialSchema = new mongoose.Schema({
  materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'TutorMaterial', required: true },
  matchedStruggles: [{ type: String }],
  fromLessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', default: null },
  addedAt: { type: Date, default: Date.now },
  dismissedAt: { type: Date, default: null }
}, { _id: false });

const tutorOverrideSchema = new mongoose.Schema({
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tutorName: { type: String, default: '' },
  date: { type: Date, default: Date.now },
  action: {
    type: String,
    enum: ['extend_phase', 'advance_phase', 'skip_phase', 'adjust_focus', 'add_note', 'accept_focus'],
    required: true
  },
  note: { type: String, default: '' }
}, { _id: false });

// Structured tutor-flagged skill priority. Beats the free-text
// adjust_focus override because it (a) canonicalizes to a skillId so
// the system can route it correctly, (b) carries a severity weight so
// multiple priorities can be ranked, and (c) decays gracefully instead
// of being silently overwritten by the next override.
const tutorSkillPrioritySchema = new mongoose.Schema({
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tutorName: { type: String, default: '' },
  skillId: { type: String, required: true },
  // 1 = nudge, 2 = important, 3 = blocking. Used multiplicatively when
  // resolving the next-lesson focus pick.
  severity: { type: Number, default: 2, min: 1, max: 3 },
  note: { type: String, default: '' },
  setAt: { type: Date, default: Date.now },
  // Auto-decays after this many days unless re-asserted by the tutor.
  // Default 14 — matches the tutorVote window so the two concepts line up.
  decayDays: { type: Number, default: 14, min: 1, max: 90 }
}, { _id: false });

// Per-skill Bayesian mastery belief. α + β are pseudo-counts of success
// and failure evidence; mean = α/(α+β). Updated after every lesson via
// bayesianMastery.update(). Decay applied at read time as needed.
const skillBeliefSchema = new mongoose.Schema({
  alpha: { type: Number, required: true, min: 0.0001 },
  beta: { type: Number, required: true, min: 0.0001 },
  lastUpdatedAt: { type: Date, default: null }
}, { _id: false });

// Snapshot of a Beta belief at the moment a focus was surfaced or settled.
// Stored on focusHistory entries so we can compute Δmean later without
// reading back the full belief history.
const beliefSnapshotSchema = new mongoose.Schema({
  alpha: { type: Number, default: null },
  beta: { type: Number, default: null },
  meanAtSurface: { type: Number, default: null },
  essAtSurface: { type: Number, default: null },
  meanAtSettle: { type: Number, default: null },
  essAtSettle: { type: Number, default: null }
}, { _id: false });

// Closed-loop focus tracking. One entry per time we surfaced a focus
// skill to the student or tutor. Settled by the NEXT lesson that
// actually tests that skill — see focusHistoryService.settleFocus.
const focusHistoryEntrySchema = new mongoose.Schema({
  skillId: { type: String, required: true },
  source: {
    type: String,
    enum: ['aggregator', 'analysis_recommendation', 'upstream_diagnosis', 'tutor_priority', 'tutor_override', 'phase_default', 'manual'],
    required: true
  },
  surfacedAt: { type: Date, default: Date.now },
  fromLessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', default: null },
  // If source === 'upstream_diagnosis', this is the original symptom
  // skill we redirected from.
  diagnosedFrom: { type: String, default: null },
  note: { type: String, default: '' },
  beliefBefore: { type: beliefSnapshotSchema, default: null },
  beliefAfter: { type: beliefSnapshotSchema, default: null },
  outcome: {
    type: String,
    enum: ['pending', 'improved', 'stuck', 'worsened', 'superseded'],
    default: 'pending'
  },
  settledAt: { type: Date, default: null },
  settledByLessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', default: null },
  deltaMean: { type: Number, default: null },
  deltaEss: { type: Number, default: null }
}, { _id: false });

// Per-tutor focus lane. When a student works with multiple tutors, each
// tutor sets their own next-lesson focus for that student without
// stomping on the other tutors' focus. The home-widget focus is then
// resolved by `resolveNextFocus` based on the student's next upcoming
// lesson and which tutor it's with.
const tutorFocusEntrySchema = new mongoose.Schema({
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tutorName: { type: String, default: '' },
  focus: { type: String, default: '' },
  note: { type: String, default: '' },
  setAt: { type: Date, default: Date.now }
}, { _id: false });

// CEFR estimate computed from the rolling window of LessonAnalysis records
// (both AI and tutor sources). Internal estimate is recomputed after every
// lesson; revealed estimate is gated to milestones to avoid noisy fluctuation.
// See backend/services/cefrEstimatorService.js + docs/learning-journey/cefr-estimation.md.
const cefrEstimateSchema = new mongoose.Schema({
  level: { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], default: null },
  numericLevel: { type: Number, default: null, min: 1, max: 6 },
  confidence: { type: Number, default: null, min: 0, max: 100 },
  agreement: { type: String, enum: ['high', 'medium', 'low', null], default: null },
  sources: {
    ai: { type: Number, default: 0 },
    tutor: { type: Number, default: 0 }
  },
  lessonsConsidered: { type: Number, default: 0 },
  computedAt: { type: Date, default: Date.now }
}, { _id: false });

const cefrDivergenceSchema = new mongoose.Schema({
  // For 'tutor_higher' / 'ai_higher': signed gap (tutorMean - aiMean).
  // For 'tutor_split': unsigned spread (max - min) across tutor reads.
  gap: { type: Number, required: true },
  // AI-vs-tutor case fields.
  aiLevel: { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], default: null },
  tutorLevel: { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], default: null },
  // Tutor-vs-tutor case fields (the cold-start "two trials, two opinions" case).
  lowLevel: { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], default: null },
  highLevel: { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], default: null },
  direction: { type: String, enum: ['tutor_higher', 'ai_higher', 'tutor_split'], required: true }
}, { _id: false });

const cefrRevealSchema = new mongoose.Schema({
  level: { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], required: true },
  numericLevel: { type: Number, required: true, min: 1, max: 6 },
  confidence: { type: Number, default: null, min: 0, max: 100 },
  agreement: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  // Plain-English narrative (template-generated, English only for v1 — i18n later).
  narrative: { type: String, default: '' },
  sources: {
    ai: { type: Number, default: 0 },
    tutor: { type: Number, default: 0 }
  },
  lessonsAtReveal: { type: Number, default: 0 },
  // Why this reveal fired: 'first_milestone' | 'chapter_graduation' | 'monthly_refresh'
  trigger: { type: String, enum: ['first_milestone', 'chapter_graduation', 'monthly_refresh'], default: 'first_milestone' },
  revealedAt: { type: Date, default: Date.now },
  // Source disagreement (Batch 12 follow-up). Set only when AI vs tutor
  // means diverge by ≥ 1 CEFR level. Drives the "AI tends to assess you
  // at X; your tutors at Y" transparency UI.
  divergence: { type: cefrDivergenceSchema, default: null }
}, { _id: false });

const learningPlanSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  language: {
    type: String,
    required: true,
    trim: true
  },
  goal: {
    type: {
      type: String,
      enum: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation', 'other'],
      required: true
    },
    description: { type: String, default: '' },
    targetLevel: { type: String, default: '' },
    timeline: { type: String, default: 'no_rush' },
    timelinePressure: {
      type: String,
      enum: ['specific_date', 'few_months', 'no_rush'],
      default: 'no_rush'
    },
    targetDate: { type: Date, default: null }
  },
  selfAssessedLevel: {
    type: String,
    enum: ['complete_beginner', 'some_basics', 'simple_conversations', 'intermediate', 'advanced'],
    default: 'some_basics'
  },
  currentPhaseIndex: {
    type: Number,
    default: 0
  },
  phases: [phaseSchema],
  // Idempotency guard: lesson IDs already folded into the plan (scores,
  // lessonsCompleted, beliefs, advancement). Prevents a re-analyzed lesson
  // from double-counting toward the phase-advancement floor. Capped to the
  // most recent ~100 ids since only recency matters for dedupe.
  appliedLessonIds: [{ type: mongoose.Schema.Types.ObjectId }],
  // Phase promotion gate: rollingScore (default) | bayesian | hybrid.
  // See masteryService.evaluateAdvancementForPlan.
  masteryGateMode: {
    type: String,
    enum: ['rollingScore', 'bayesian', 'hybrid'],
    default: 'rollingScore'
  },

  // Chapter system (Batch 1). Each chapter has 4 phases mapped to a CEFR
  // level and a scenic background theme. See docs/learning-journey/.
  chapterIndex: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  chapterLevel: {
    type: String,
    enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
    default: 'A1'
  },
  chapterTheme: {
    type: String,
    default: 'a1-desert'
  },
  // Frozen snapshots of every completed chapter, oldest first. Read-only.
  chaptersCompleted: [completedChapterSchema],
  // Calibration window (G31, G32). Set when first 5 lessons of chapter 1
  // are done — after this, the chapter is locked for normal advancement.
  calibrationLockedAt: { type: Date, default: null },
  // Decay tracking (G15). Incremented on first decay-trajectory match;
  // cleared on demotion or after a recovery lesson. Used to gate the
  // "soft warning then demote" two-step rule.
  decayWarnings: { type: Number, default: 0 },
  // Total demotions in the trailing 90 days. Used to surface human
  // intervention card when ≥ 2 (G6). Cleaned on read.
  demotionEvents: [{ type: Date }],
  // Batch 13: ping-pong tracking. Incremented when a student is demoted
  // back to a chapter level they had previously graduated FROM (i.e.,
  // the recovery → graduate → re-decay loop). Drives a tighter
  // human-intervention rule: 1 ping-pong = nudge, 2 = strong "let's
  // talk to your tutor" surface (recoveryStuck flag).
  pingPongCount: { type: Number, default: 0 },
  // Snapshot of the chapter level the student was in immediately before
  // a demotion landed. Used by the next promotion to detect "they bounced
  // back to where they fell from" → ping-pong increment.
  lastDemotedFromLevel: { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', null], default: null },

  // Pending transition flags. Persisted (so multiple devices / refreshes
  // see them until acknowledged) but cleared via dedicated endpoints.
  // See docs/learning-journey/architecture.md.
  pendingTransitions: {
    chapterJustCompleted: { type: Boolean, default: false },
    chapterDemotionPending: { type: Boolean, default: false },
    chapterPromotionPending: { type: Boolean, default: false },
    masteryModeEntered: { type: Boolean, default: false },
    decayWarning: { type: Boolean, default: false },
    humanInterventionSuggested: { type: Boolean, default: false },
    // Batch 11: AI just split the active phase. Show a polite "I noticed
    // X is harder than expected" toast on next journey-page visit.
    phaseSplit: { type: Boolean, default: false },
    // Batch 13: pingPongCount has reached 2 — the student has bounced
    // back to the same chapter twice. Surface a strong "let's slow down
    // and talk to your tutor" card on the post-lesson recap. Acked
    // separately from humanInterventionSuggested.
    recoveryStuck: { type: Boolean, default: false },
    // For G33: count how many times the celebration modal has been shown
    // (max 3) before auto-dismissing. Frontend pings ack endpoint.
    celebrationShownCount: { type: Number, default: 0 }
  },

  // Snapshot of what THIS most-recent lesson changed on the plan. Computed
  // in updatePlanAfterLesson by diffing before/after state, persisted here
  // (the callers are fire-and-forget so they can't return it), and surfaced
  // on the student's post-lesson recap as the "your journey moved" card.
  // `lessonId` lets the client confirm the delta belongs to the lesson it's
  // showing before rendering any "what changed" copy.
  lastLessonImpact: {
    lessonId: { type: String, default: null },
    at: { type: Date, default: null },
    phaseIndexBefore: { type: Number, default: null },
    phaseIndexAfter: { type: Number, default: null },
    phaseAdvanced: { type: Boolean, default: false },
    phaseTitleBefore: { type: String, default: null },
    phaseTitleAfter: { type: String, default: null },
    chapterChanged: { type: Boolean, default: false },
    chapterLevelBefore: { type: String, default: null },
    chapterLevelAfter: { type: String, default: null },
    focusChanged: { type: Boolean, default: false },
    focusBefore: { type: String, default: null },
    focusAfter: { type: String, default: null },
    windowProgressBefore: { type: Number, default: null },
    windowProgressAfter: { type: Number, default: null }
  },

  weeklyRecommendations: {
    lessonFrequency: { type: String, default: '2x per week' },
    selfStudyMinutes: { type: Number, default: 15 },
    focusBetweenLessons: { type: String, default: '' }
  },
  studentSummary: {
    type: String,
    default: ''
  },
  nextLessonFocus: {
    type: String,
    default: ''
  },
  history: [historyEntrySchema],
  tutorOverrides: [tutorOverrideSchema],
  // Structured per-skill priorities (replacement for free-text overrides).
  // Persists across lessons until decayDays elapses or the tutor clears it.
  tutorSkillPriorities: [tutorSkillPrioritySchema],
  // One focus entry per tutor that has set one. Newest setAt wins
  // resolution ties when no upcoming lesson hint is available.
  tutorFocusByTutorId: [tutorFocusEntrySchema],
  // Per-skill Bayesian mastery beliefs. Keyed by skillId. Updated after
  // every lesson; aggregated into phase mastery for the legacy gate
  // while the new gate reads beliefs directly.
  skillBeliefs: {
    type: Map,
    of: skillBeliefSchema,
    default: () => new Map()
  },
  // Closed-loop focus history (skillId + source + before/after beliefs).
  // Pruned to MAX_HISTORY entries — see focusHistoryService.
  focusHistory: [focusHistoryEntrySchema],
  // Last skillId we surfaced as the active next-lesson focus, plus the
  // source. Useful for the home widget to render "We chose this because
  // X is your top struggle" or "Your tutor flagged Y."
  activeFocusSkillId: { type: String, default: null },
  activeFocusSource: {
    type: String,
    enum: ['aggregator', 'analysis_recommendation', 'upstream_diagnosis', 'tutor_priority', 'tutor_override', 'phase_default', 'manual', null],
    default: null
  },
  activeFocusSetAt: { type: Date, default: null },
  // Snapshot of struggle-matched materials surfaced to the student between
  // lessons. Populated for free students after each lesson analysis.
  recommendedMaterials: [recommendedMaterialSchema],
  recommendedMaterialsUpdatedAt: { type: Date, default: null },

  // ── Journey-map gamification (treasure chests) ──────────────────────
  // Cumulative XP earned from opening map treasure chests. Chests are
  // performance-gated: a chest unlocks when its phase is completed, and the
  // reward tier (and XP) scales with that phase's mastery — so coasting
  // students get less, and not everyone earns the top tier by just tapping.
  journeyXp: { type: Number, default: 0 },
  // One entry per opened chest. `chestId` is map-stable
  // (`${chapterTheme}-${variant}-chest-${i}`) so a chest can only be
  // claimed once, ever.
  claimedChests: [{
    chestId: { type: String, required: true },
    chapterIndex: { type: Number, default: 0 },
    phaseIndex: { type: Number, default: 0 },
    tier: { type: String, enum: ['bronze', 'silver', 'gold'], default: 'bronze' },
    xp: { type: Number, default: 0 },
    claimedAt: { type: Date, default: Date.now }
  }],
  // One entry per passed roadblock checkpoint. `key` is map-stable
  // (`${chapterTheme}-${phaseCount}-rb-${afterPhase}`) so a gate is treated
  // as cleared even before the NEXT phase is completed — fixes the bug where
  // a passed gate auto-reopened on every journey visit until phase N+1 was
  // finished.
  clearedRoadblocks: [{
    key: { type: String, required: true },
    afterPhase: { type: Number, default: 0 },
    chapterTheme: { type: String, default: '' },
    phaseCount: { type: Number, default: 0 },
    quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', default: null },
    clearedAt: { type: Date, default: Date.now }
  }],
  lastUpdatedAt: {
    type: Date,
    default: Date.now
  },
  lastUpdatedFromLessonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lesson',
    default: null
  },
  lastGoalChangedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    // 'unframed' = student hasn't set a goal / wants to learn at their own
    // pace. The plan exists as a thin shell so CEFR estimation, review-deck
    // generation, and tutor briefings still have something to write into,
    // but no phases/chapters are surfaced. Students can promote to a full
    // plan whenever they want — see learningPlanService.promoteUnframedPlan.
    // 'paused' = student had a real plan and asked us to hibernate it. All
    // historical data is preserved; the journey UI is hidden until resumed.
    enum: ['draft', 'active', 'completed', 'paused', 'mastery_mode', 'unframed'],
    default: 'draft'
  },
  // Lifecycle timestamps for the unframed / paused flow. Set when the plan
  // enters that state; cleared on resume/promote. Used by the soft "Want a
  // plan?" prompt so we can throttle by lessons-since-paused.
  unframedAt: { type: Date, default: null },
  pausedAt: { type: Date, default: null },
  // Last time the student dismissed the "Want a plan?" prompt. Throttles
  // re-firing — see post-lesson soft-prompt logic.
  softPlanPromptDismissedAt: { type: Date, default: null },
  // Lesson count snapshot when the plan went unframed/paused. Lets us
  // compute "how many lessons since" for the soft-prompt cadence without
  // walking the full lesson history.
  lessonsAtUnframed: { type: Number, default: 0 },
  // 'lesson' = AI-driven (premium), 'rule' = lesson-count-based (free), null = not yet
  lastUpdateMode: {
    type: String,
    enum: ['lesson', 'rule', 'tutor_override', 'goal_change', null],
    default: null
  },
  // Premium-only: timestamps of student-initiated AI regenerations.
  // Used to enforce a rolling 30-day cap (default 2/month) without
  // needing a separate counters collection. Pruned on read.
  aiRegenerationsAt: [{ type: Date }],
  // First time the student dismissed the "Your roadmap is ready" intro
  // sheet. Used to show it exactly once after onboarding. Stays set so
  // we can also drive a "Why this plan?" reference link without re-prompting.
  journeyIntroSeenAt: { type: Date, default: null },

  // CEFR estimation (see docs/learning-journey/cefr-estimation.md).
  // internalCefrEstimate: refreshed after every lesson, used by AI plan
  // prompts + tutor briefings. Never shown raw to the student.
  // revealedCefrLevel: snapshot of the estimate the student has seen. Updated
  // only at milestones (5+ lessons, chapter graduation, monthly thereafter).
  // revealHistory: append-only timeline so students can browse their level evolution.
  internalCefrEstimate: { type: cefrEstimateSchema, default: null },
  revealedCefrLevel: { type: cefrRevealSchema, default: null },
  revealHistory: [cefrRevealSchema],
  // Pending UX flag: set when revealedCefrLevel is updated and the student
  // hasn't seen the celebration/toast yet. Cleared by an ack endpoint.
  pendingCefrReveal: { type: Boolean, default: false }
}, {
  timestamps: true
});

learningPlanSchema.index({ studentId: 1, language: 1 }, { unique: true });
learningPlanSchema.index({ studentId: 1, status: 1 });

module.exports = mongoose.model('LearningPlan', learningPlanSchema);
