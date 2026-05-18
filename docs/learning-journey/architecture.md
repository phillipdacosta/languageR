# Architecture

## Schema

`LearningPlan` (one per student per language) at `backend/models/LearningPlan.js`:

```
{
  studentId, language, goal, selfAssessedLevel,

  // Chapter system
  chapterIndex: Number,            // 0-based, 0..5
  chapterLevel: 'A1'|'A2'|'B1'|'B2'|'C1'|'C2',
  chapterTheme: String,            // background asset key, e.g. 'a1-desert'
  chaptersCompleted: [{
    index, level, theme,
    phases: [phase snapshot],
    completedAt, masteryAtCompletion,
    exitReason: 'graduated'|'demoted'|'calibrated'
  }],

  // Phases (current chapter's 4)
  phases: [phaseSchema],
  currentPhaseIndex: Number,       // 0..3

  // Per-phase
  phase.lessonsCompleted, phase.lessonScores, phase.masteryAverage,
  phase.status: 'locked'|'active'|'completed',
  phase.studentEditedAt,

  // Tutor votes (Batch 10)
  phase.tutorVotes: [{ tutorId, vote: 'advance'|'hold', expiresAt, note }],

  // Calibration
  calibrationLockedAt: Date|null,  // first 5 lessons window

  // Decay tracking
  decayWarnings: Number,           // how many times warning shown this chapter

  // Standard plan fields
  studentSummary, nextLessonFocus, weeklyRecommendations,
  history: [historyEntrySchema],
  tutorOverrides, tutorFocusByTutorId,
  recommendedMaterials,
  status: 'draft'|'active'|'completed'|'paused'|'mastery_mode',
  lastUpdateMode, aiRegenerationsAt, journeyIntroSeenAt
}
```

Transient flags returned in API responses (NOT persisted; cleared when client acks):
- `chapterJustCompleted: boolean`
- `chapterDemotionPending: boolean`
- `chapterPromotionPending: boolean`

## Decision flows

### After every lesson

```
lesson saves
  ↓
LessonAnalysis created → emits to learningPlanService.updatePlanAfterLesson()
  ↓
plan.phases[currentPhaseIndex].lessonScores.push(masteryScore)
plan.phases[currentPhaseIndex].lessonsCompleted++
plan.phases[currentPhaseIndex].masteryAverage = rollingMastery(scores)
  ↓
If chapterIndex == 0 AND lessonsCompleted in chapter < 5:
  _applyCalibration(plan)   // can promote OR demote
  ↓
Else:
  _applyMasteryPromotion(plan, analysis, opts)
    Free path: rule-based focus regen
    Premium path: AI rewrites studentSummary + nextLessonFocus
  ↓
_applyDecayIfNeeded(plan)   // can set chapterDemotionPending
  ↓
plan.save()
```

### Mastery gate (per lesson, after lessonScores updated)

```
hasMorePhases = currentPhaseIndex < phases.length - 1
isLastPhaseInChapter = currentPhaseIndex == 3   // 4 phases per chapter

If isLastPhaseInChapter:
  evaluateChapterGraduation(phase4)
    — bar: rolling avg of last 5 >= 80 AND lessonsCompleted >= 5 in phase 4
    — if pass → set chapterJustCompleted, snapshot+regen
Else:
  evaluateAdvancement(phase, hasMorePhases)
    — apply tutor vote bias (-5 for advance, +5 for hold)
    — bar: avg-3 >= adjustedThreshold
    — floor: lessonsCompleted >= 3 (MIN_LESSONS_PER_PHASE)
    — ceiling: lessonsCompleted >= 10 (MAX_LESSONS_PER_PHASE)
    — if pass → mark phase completed, advance currentPhaseIndex++
```

### Decay (per lesson, after mastery gate)

```
If currentChapterLessonsCompleted >= 5:
  rollingAvg = avg of last 3 lessonScores in chapter
  distinctTutors = unique tutor IDs across last 3 lessons
  If rollingAvg < 50 AND distinctTutors >= 2:
    If decayWarnings == 0:
      decayWarnings = 1   // surface warning banner, don't demote yet
    Else:
      // Demote to previous chapter
      _demoteOneChapter(plan)   // sets chapterDemotionPending
      decayWarnings = 0
```

### Calibration (chapter 1, first 5 lessons)

```
After lesson 3:
  rollingAvg = avg of first 3 lessonScores in chapter 1
  If rollingAvg > 85 AND chapterIndex < 5:
    _promoteOneChapter(plan)    // sets chapterPromotionPending (cap +1)
  Else if rollingAvg < 40:
    If chapterIndex > 0:
      _demoteOneChapter(plan)
    Else:
      _generateFundamentalsPhaseZero(plan)  // never go below chapter 1
After lesson 5:
  calibrationLockedAt = new Date()
```

### Tutor vote model (Batch 10)

```
Tutor calls POST /learning-plan/tutor-action with action='advance_phase' or 'hold_phase'
  ↓
Becomes a vote on plan.phases[currentPhaseIndex].tutorVotes
  { tutorId, vote, expiresAt: now + 14 days, note }
Latest vote per tutor wins (G29).
  ↓
Mastery gate consumes votes:
  — Sum: any 'advance' vote lowers threshold by 5
  — Any 'hold' vote raises threshold by 5
  — Tutor sees only their own vote (no other tutor attribution)
```

### Quiz selection (Batch 8)

```
Trigger A — Immediate (post-lesson):
  Pick most-flagged struggle from THIS lesson's analysis
  → quizService.selectAndPushQuiz(userId, struggle)

Trigger B — End-of-day batch (8pm local):
  Aggregate day's distinct struggle signals
  → if 1 quiz already pushed today and remaining cap == 1, pick top distinct
  → quizService.selectAndPushQuiz(userId, struggle)

selectAndPushQuiz:
  Apply 48h same-struggle cooldown
  Apply 2/day cap
  Apply autoPushPaused (5 consecutive negative ratings)
  Pool query: { language, level, struggle } excluding seen
  If pool empty → AI generate (two-pass: generate + verify) → save to pool
  Pick variant, generate personalized header, push notification
```

## Code paths (where things live)

| Concern | File |
|---|---|
| Plan schema | [`backend/models/LearningPlan.js`](../../backend/models/LearningPlan.js) |
| Mastery scoring + gates | [`backend/services/masteryService.js`](../../backend/services/masteryService.js) |
| Plan update orchestration | [`backend/services/learningPlanService.js`](../../backend/services/learningPlanService.js) |
| Chapter generation (free + AI) | [`backend/services/chapterGenerationService.js`](../../backend/services/chapterGenerationService.js) |
| Quiz pool + selection | [`backend/services/quizService.js`](../../backend/services/quizService.js) |
| Tutor briefing synthesis | [`backend/services/tutorBriefingService.js`](../../backend/services/tutorBriefingService.js) |
| Plan API routes | [`backend/routes/learningPlan.js`](../../backend/routes/learningPlan.js) |
| Web journey page | [`language-learning-app/src/app/journey/journey.page.ts`](../../language-learning-app/src/app/journey/journey.page.ts) |
| Web home journey widget | [`language-learning-app/src/app/components/home/journey-widget.component.ts`](../../language-learning-app/src/app/components/home/journey-widget.component.ts) |
| Web chapter complete modal | `language-learning-app/src/app/journey/chapter-complete-modal/` |
| Mobile home | [`mobile/src/screens/HomeScreen.tsx`](../../mobile/src/screens/HomeScreen.tsx) |
| Mobile learning plan service | [`mobile/src/services/learningPlan.ts`](../../mobile/src/services/learningPlan.ts) |

## Audit log

Every algorithmic decision MUST write to `plan.history`. Reasons in current enum:

`mastery_met`, `max_lessons_safety`, `tutor_advance`, `tutor_skip`, `ai_advance`, `goal_change`, `created`

To add (Batch 1+):
`chapter_graduated`, `chapter_demoted`, `calibration_promoted`, `calibration_demoted`, `decay_warning`, `chapter_regenerated`, `tutor_vote_advance`, `tutor_vote_hold`
