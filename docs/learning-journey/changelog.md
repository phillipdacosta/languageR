# Changelog

Every behavior change in the journey system. Newest at the top. Each entry: date, batch, change, rationale.

## 2026-05-08 — Plans without a plan: `unframed` + `paused` lifecycle (free + premium)

**Problem.** Not every student is ready to commit to a structured roadmap at onboarding, and not every existing student wants their plan running every week. Until now, the only options were "have a goal + a roadmap" or "have nothing at all" — and the second one meant the post-lesson pipeline (CEFR estimate, recommended materials, tutor briefings) had nowhere to write to. Premium students paying for AI analysis got nothing extra in the "no plan" state, which made premium feel wasted.

**Solution.** Two new first-class plan states, plus a graceful soft re-entry path.

**Backend (`backend/`).**
- `LearningPlan.status` enum extended with `'unframed'` (no goal, thin shell) and `'paused'` was already there — both now carry lifecycle timestamps (`unframedAt`, `pausedAt`, `lessonsAtUnframed`, `softPlanPromptDismissedAt`).
- `learningPlanService.js` — five new lifecycle helpers: `createUnframedPlan(studentId, language)`, `pausePlan`, `resumePlan`, `unframeExistingPlan` (drops the active chapter into history, clears phases), `promoteUnframedPlan(studentId, language, newGoal)` (delegates to the existing `_regeneratePlanForGoalChange` so chapter history + CEFR state are preserved). Plus `dismissSoftPlanPrompt`.
- `updatePlanAfterLesson` no longer early-returns for `paused` and now also handles `unframed` — both routes through the new `_runPostLessonSideEffectsOnly(plan, lessonAnalysis)` which still runs CEFR refresh, recommendations, immediate quiz push, and tutor "teaching is sticking" emission, but skips every plan-mutating step (phase advancement, calibration, decay, splits, transitions). Lessons taken without a plan still earn value.
- `routes/learningPlan.js`:
  - GET `/:language` widened to include `'unframed'` and `'paused'` (so the client can render the right empty state instead of treating them as 404).
  - GET `/:language` attaches a `softPlanPrompt: { eligible, lessonsSince, dismissedAt }` envelope on unframed/paused plans, gated to `lessonsSince ≥ 3` and a 30-day dismissal throttle.
  - New POST routes: `/:language/skip` (→ `unframeExistingPlan`), `/pause`, `/resume`, `/promote` (body `{ goal }`), `/soft-prompt/dismiss`.
- `routes/users.js` — onboarding accepts `skipGoalSetup: true` in the student payload and creates a `createUnframedPlan` for each selected language. The existing goal-change side-effect path is unchanged.

**Onboarding (`onboarding.page.{ts,html,scss}`).**
- Step 4 (goal) now shows a small ghost link under the goal cards: `"I'll start by trying a lesson"` (`ONBOARDING.STUDENT.SKIP_GOAL_LINK`) plus a one-line help blurb ("Skip the goal for now…").
- Tapping it sets `skipGoalSetup = true` and jumps from step 4 → `totalSteps` (skipping the level + timeline steps); `canProceed()` and `nextStep()` short-circuit on the flag. The preview page renders "Learning at my own pace" via `SKIP_GOAL_PREVIEW`. Submission omits the `learningGoal` object and sends `skipGoalSetup: true` instead.
- `navigateToHome` no longer sets the `showJourneyIntro` session flag for unframed students — there's no roadmap to introduce.

**Home (`tab1.page.{ts,html}` + `journey-widget.component.{ts,html}`).**
- `journeyWidgetState` extended with `'unframed'` and `'paused'`. `applyLearningPlan` early-returns *after* setting state (skips the journey-page preload + intro modal + warmup) when the plan is unframed/paused.
- `<app-journey-widget>` got two new states with bespoke layouts:
  - `unframed` — leaf icon, "Learning at your own pace" headline, tier-aware body (`HOME.JOURNEY_UNFRAMED_BODY_PREMIUM` reassures premium students), "Build me a plan" CTA → emits `buildPlanTap` → routes to `/tabs/profile?editGoal=1&from=unframed`.
  - `paused` — pause icon, "Your plan is paused" headline, "Resume my plan" CTA → emits `resumePlanTap` → calls `LearningPlanService.resumePlan(language)` and re-renders the active widget on success.
- The compact variant (mobile islands) gets matching one-liner pills.

**Premium-when-unframed value card (`components/home/premium-when-unframed.component.ts`).**
- New self-contained standalone component, lazy-loaded for premium students whose plan is `unframed` or `paused`. Surfaces the four things premium still does without a plan (AI analysis, review deck, tutor briefings, CEFR). Light + dark mode styled inline.
- Rendered in `tab1.page.html` directly under `<app-journey-widget>` with `*ngIf="isStudentUser && journeyIsPremium && (state === 'unframed' || state === 'paused')"`.
- Registered in `tab1.module.ts`.

**Profile (`profile.page.{ts,html,scss}`).**
- `applyPlanLifecycleFromPlan(plan, entitlements)` populates `planStatus`, `isUnframed`, `isPaused`, `hasStructuredPlan`, `planIsPremium` from the same `/learning-plan/:lang` call we already make for the goal display.
- New action buttons on the goal card:
  - Active plan → "Pause my plan" (secondary) + "Learn at my own pace" (ghost).
  - Paused → "Resume my plan" (primary) + "Learn at my own pace" (ghost).
  - Unframed → goal card hidden, replaced by an "Add a learning goal" card that promotes via the existing `openGoalEditor` flow (sends them through onboarding which now goes through `regeneratePlan` / `promoteUnframedPlan`).
- All actions are wrapped in tier-aware confirmation alerts (premium copy mentions premium-still-works; free copy is simpler).

**Post-lesson soft prompt (`post-lesson-student.page.{ts,html}`).**
- After `loadPlanUpdate` runs, if `plan.status` is `unframed`/`paused` and `softPlanPrompt.eligible` is set, render a "Want a roadmap?" card under the existing plan-update card slot. Tier-aware body, never shown alongside a higher-priority plan-update card.
- CTA: paused → resumes in place (toast + state refresh); unframed → routes to profile with `from=post_lesson`. Dismiss → server-throttled to 30 days via `softPlanPromptDismissedAt`.

**i18n.**
- `HOME.JOURNEY_UNFRAMED_*`, `HOME.JOURNEY_PAUSED_*` (compact + full + body + CTA).
- `HOME.PREMIUM_UNFRAMED.*` (chip + two titles + body + four list items).
- `POST_LESSON.SOFT_PLAN_PROMPT.*` (titles + four bodies + two CTAs).
- `ONBOARDING.STUDENT.SKIP_GOAL_LINK`, `SKIP_GOAL_HELP`, `SKIP_GOAL_PREVIEW`.
- `COMMON.DISMISS`.

**Why it matters.** Premium students get a real value reminder when they don't have a roadmap, instead of an empty home page that makes premium feel wasted. Free students get a no-pressure on-ramp (try a lesson first, decide on a plan later). Existing students get a reversible pause they can lean on instead of churning when life gets busy. The mastery engine and CEFR estimator are unchanged — only the lifecycle around them is.

**Files changed:**
- `backend/models/LearningPlan.js`
- `backend/services/learningPlanService.js`
- `backend/routes/learningPlan.js`
- `backend/routes/users.js`
- `language-learning-app/src/app/services/learning-plan.service.ts`
- `language-learning-app/src/app/components/home/journey-widget.component.{ts,html}`
- `language-learning-app/src/app/components/home/premium-when-unframed.component.ts` (new)
- `language-learning-app/src/app/tab1/tab1.{module,page}.{ts,html}`
- `language-learning-app/src/app/profile/profile.page.{ts,html,scss}`
- `language-learning-app/src/app/onboarding/onboarding.page.{ts,html,scss}`
- `language-learning-app/src/app/post-lesson-student/post-lesson-student.page.{ts,html}`
- `language-learning-app/src/assets/i18n/en.json`
- `docs/learning-journey/voice-and-framing.md` (new section: "Plans without a plan")

## 2026-05-08 — Voice & framing follow-ups: locked-phase preview + qualitative mastery on celebration / past maps

**Two leftover number leaks + a dead-end UX.**

**1. Locked-phase preview.** Tapping a future-phase node on the roadmap previously rendered an empty card — just the phase title and a pill, no description, no focus areas, no anchor back to the active phase. The full content was already on `PhaseRow` (`description`, `focusAreas`, `exitCriteria`); it was just hidden behind `*ngIf="status === 'active'"` gates. Reframed the card into a read-only "what's coming" disclosure:
- New `JOURNEY.LOCKED.*` i18n group: `EYEBROW` ("Coming up"), `FOCUS_LABEL` ("What you'll work on"), `OUTCOME_LABEL` ("What you'll get from it" — outcome framing rather than the gate-y "you'll know you're ready when…"), `CONTINUES_FROM`, `BACK_TO_CURRENT`.
- New `PhaseRow.previousPhaseTitle`, populated in `applyPlan`'s `phases.map` (and the visiting-chapter / split-preview siblings). Surfaced in the card as "Continues from {title}" so the student is anchored in *where they are now*.
- New `<ng-container *ngIf="selectedRow.status === 'locked'">` block in `journey.page.html` between the title and the (active-only) progress block. Renders eyebrow + lock icon, description, focus chips (outlined variant — visually distinct from the active phase), exit criteria reframed as "outcome", anchor line, and a quiet "Back to your current phase" ghost link instead of a primary CTA.
- **Deliberately omitted**: estimated lesson count (varies wildly per phase content; would make a promise the data can't keep), any mastery target, any "you'll need to score X" framing. Per `voice-and-framing.md`.
- Light + dark mode styled.

**2. Chapter-complete celebration.** The graduation/promotion/mastery-mode modal showed `{{masteryAtCompletion}}<span>/100</span>` next to a "MASTERY" label. Replaced with a qualitative phrase from the new `JOURNEY.MASTERY_LABEL.*` group:
- `MASTERED` (≥ 90), `STRONG` ("Strong finish", 80–89), `SOLID` (70–79), `STEADY` (60–69), `BUILDING` ("Foundations laid", < 60).
- New `masteryLabelKey` getter on `ChapterCompleteModalComponent` returns the i18n key. Template uses `{{ masteryLabelKey | translate }}` directly (no template function — getter is OK per Angular change-detection rules but could move to a precomputed field if needed).
- New `.ccm-stat--word` SCSS variant shrinks `font-size` from 28 → 20 since the value is now a phrase, not a number; keeps the column visually balanced against the lesson-count stat.

**3. Past maps modal.** The completed-chapters list showed `· {{ c.masteryAtCompletion }}/100` in each card subtitle. Same buckets as the celebration; same labels. Implemented as a precomputed `masteryLabelKey` field on the local `CompletedChapter` interface populated in `ngOnInit` (no template function calls per AGENTS.md). A chapter that landed as "Strong finish" in the celebration now stays "Strong finish" in past maps — symmetry across surfaces.

**Why it matters.** The student now sees zero raw mastery numbers anywhere — in-progress, celebrated, or remembered. The diagnostic engine is unchanged; only the outward voice is. Three-surface consistency (active phase pill / chapter celebration / past maps) reinforces the framing principle every time the student touches the journey.

**Files changed:**
- `language-learning-app/src/assets/i18n/en.json` — `JOURNEY.MASTERY_LABEL.*` + `JOURNEY.LOCKED.*` keys.
- `language-learning-app/src/app/journey/journey.page.{ts,html,scss}` — `PhaseRow.previousPhaseTitle`, locked-phase preview block, light + dark styles.
- `language-learning-app/src/app/journey/chapter-complete-modal/chapter-complete-modal.component.{ts,scss}` — `masteryLabelKey` getter, `.ccm-stat--word` variant, no more `/100`.
- `language-learning-app/src/app/journey/past-maps/past-maps-modal.component.ts` — `CompletedChapter.masteryLabelKey`, `toMasteryLabelKey` helper, template swap.

## 2026-05-08 — Voice & framing: hide raw mastery, qualitative phase state, "How do I move on?" explainer

**Problem.** The student-facing surfaces leaked the diagnostic vocabulary of the planner. The journey page's progress card literally said `Mastery 75/100 · need 70 to advance` — turning each lesson into an exam, exposing the threshold (which students would then chase or game), and making the journey read like a graded course rather than a learning path. The post-lesson recap surfaced raw component percentages (`Grammar 85%`, etc.) as headline values, which compounded the effect — and several of those percentages (especially `confidence`, `proficiencyChange`) are LLM heuristics, not measurements, so leading with them was overstating their precision.

**Architectural fix.** The mastery engine stays *exactly* as it was — same floor, ceiling, threshold, scoring, tutor vote bias. What changed is the *outward voice*. The 0–100 score and the 70 threshold are now **server-side only**; they're stripped from every student-facing payload.

**Backend.**
- `masteryService.phaseProgressState(phase, hasMorePhases)` — new pure function that maps `(lessonsCompleted, rollingMastery, threshold)` → one of `getting_started | building | progressing | ready_soon | wrapping_up`. Also returns the existing `windowProgressPercent` (0–100) for the visual bar. The student never receives the raw score; the planner still uses it.
- GET `/api/learning-plan/:language` attaches `progressState` and `windowProgressPercent` to each non-completed phase in the payload. `tutorVoteSummary` is already privacy-stripped (G30); now `progressState` is the only progression signal a student sees.
- New `mastery` import on the route file.

**Frontend — Journey page.**
- `LearningPlanPhase.progressState` and `.windowProgressPercent` typed in the service.
- `PhaseRow.windowLabel` and the `MASTERY_THRESHOLD = 70` constant **removed** from `journey.page.ts`. Replaced with `progressState` + `progressStateLabel`. The label is computed once in TS via the `PROGRESS_STATE_KEY` lookup → i18n string (no template function calls per AGENTS.md).
- `journey.page.html` swaps `Mastery 75/100 · need 70 to advance` for a calm qualitative pill ("Making steady progress", "Ready to move on soon", etc.). The pill defaults to neutral grey, picks up a soft green tint for `ready_soon`, soft blue for `wrapping_up`. Same shape across all states — no jump on update.
- New "How do I move on?" disclosure trigger sits below the progress bar. Opens `openProgressionExplainer()` — an Apple-style alert that explains progression honestly (cadence, tutor input, the safety net) without naming a number. The mechanism is now legible and defused at the same time.
- Dark-mode rules added for both new elements.

**Frontend — Post-lesson recap.**
- Quick-summary cards switched from raw percentages to qualitative chips. Pre-built in TS as `quickSummaryChips: { key, label, qualitative, detail, tone }[]` so no template function calls. `Grammar 85%` → "Strong"; `Grammar 65%` → "Solid"; `45%` → "Building"; `<40%` → "Needs work". Same data, calmer voice.
- New "Show scores" / "Hide scores" toggle (`showAnalysisDetails`) lets number-curious students see the raw values on demand. Default is qualitative every time the page mounts — we deliberately don't persist the preference, so the qualitative read is the first thing every student sees.
- Tone CSS variants use soft tints only. **No red anywhere** — the "needs_work" tone uses neutral grey on purpose. Goal is feedback, not a graded paper.

**Voice principle codified.** New `docs/learning-journey/voice-and-framing.md` is now the source of truth for "what may / may not appear in student-facing copy". Linked from the README. Every future PR that touches student-facing text checks against it.

**Files changed.**
- `backend/services/masteryService.js` — `phaseProgressState()`, exported.
- `backend/routes/learningPlan.js` — imports `mastery`, attaches `progressState` + `windowProgressPercent` to each phase.
- `language-learning-app/src/app/services/learning-plan.service.ts` — `progressState` / `windowProgressPercent` on `LearningPlanPhase`.
- `language-learning-app/src/app/journey/journey.page.{ts,html,scss}` — qualitative pill, explainer link + alert, dark-mode rules.
- `language-learning-app/src/app/post-lesson-student/post-lesson-student.page.{ts,html,scss}` — `quickSummaryChips`, `toggleAnalysisDetails`, tone CSS.
- `language-learning-app/src/assets/i18n/en.json` — `JOURNEY.PROGRESS_STATE.*` and `JOURNEY.PROGRESSION.*` keys.
- `docs/learning-journey/voice-and-framing.md` — new.
- `docs/learning-journey/README.md` — link added.

## 2026-05-08 — Better-than-toast UX (Phases 2 + 3): plan-update card on post-lesson recap, split annotation on roadmap

**Problem.** Three of the journey-page transient signals — `decayWarning`, `humanInterventionSuggested`, and `phaseSplit` — were surfaced as 4–6-second toasts that auto-dismiss, can't be referenced later, only fire on the journey page (which the student may skip), and undersell their actual importance. The decay warning carries no CTA; the human-intervention signal implies "talk to a tutor" but doesn't link there; the phase-split signal announces a structural plan change with no way to revisit the explanation.

**Phase 2 — Roadmap split annotation.**
- Added `_isSplit` to the frontend `LearningPlanPhase` interface (already on the schema since Batch 11).
- `PhaseRow.isSplit` mirrored from `phase._isSplit` and used in two places:
  - **Map node badge.** New `.jm-split-badge` (small monochrome ✂ pill anchored top-right of the dot) on every node whose phase was adaptively split. Persistent visual marker — students can find the change weeks later. Title attribute carries the tooltip.
  - **Detail-card callout.** New `.jpcd-split-callout` block appears between the phase title and progress bar when a split phase is selected. Eyebrow + 1-line body + a "Why?" link that opens a deeper alert with full explanation. Inline rather than a separate sheet, since the card is already the explainer surface for the tapped node.
- New `JOURNEY.SPLIT.{NODE_BADGE, NODE_TOOLTIP, CARD_EYEBROW, CARD_BODY, WHY, MODAL_TITLE, MODAL_BODY_1, MODAL_BODY_2, MODAL_FOOTNOTE}` i18n keys.
- Dark-mode styled.

**Phase 3 — Plan-update card on post-lesson recap.**
- New `loadPlanUpdate()` in `post-lesson-student.page.ts` runs after every non-trial lesson. Fetches the plan once, picks the highest-urgency unacknowledged flag (humanIntervention > decayWarning > phaseSplit), and surfaces an Apple-style card at the top of the recap with intent-aligned copy + a single primary CTA:
  - `humanInterventionSuggested` → "Message your tutor" → routes to `/messages?tutorId=<currentTutor>`.
  - `decayWarning` → "Got it" → in-place dismiss.
  - `phaseSplit` → "See the change" → routes to the standalone `/tabs/home/journey` view.
- **Eager ack.** The card calls `ackTransition` on display so the journey-page toast doesn't replay the same signal later. The recap is a high-attention surface; the user has already seen it once.
- Coloured left rail conveys urgency without being loud (red for human intervention, amber for decay warning, neutral for phase split). Each kind gets its own icon background tint inside an otherwise white card.

**Cache invalidation.** `LearningPlanService.ackTransition` now patches `pendingTransitions` on the cached plan (via `tap`) so a subsequent `getPlanWithCache` doesn't return a stale flag and re-fire the journey-page toast.

**Existing toast pattern preserved as fallback.** Tutor-feedback-only flows (where the flag may not be set yet at recap load time) still get the journey-page toast on next visit. Once the persistent banner work (Phase 1) lands, both will be unified.

**Files changed:**
- `backend/models/LearningPlan.js` — no change (already had `_isSplit`).
- `language-learning-app/src/app/services/learning-plan.service.ts` — added `_isSplit` / `_isFundamentals` to `LearningPlanPhase`; `ackTransition` now updates the cache.
- `language-learning-app/src/app/journey/journey.page.{ts,html,scss}` — `PhaseRow.isSplit`, node badge, detail-card callout, `openSplitExplainer()` alert, dark-mode rules.
- `language-learning-app/src/app/post-lesson-student/post-lesson-student.page.{ts,html,scss}` — `planUpdate` state, `loadPlanUpdate()` / `onPlanUpdateCta()` / `dismissPlanUpdate()` / `ackPlanUpdate()`, new card markup, accent-coloured styling.
- `language-learning-app/src/assets/i18n/en.json` — `JOURNEY.SPLIT.*` keys.

## 2026-05-08 — Batch 12 follow-ups: per-tutor calibration, evolution timeline, divergence transparency

- **Per-tutor bias calibration.** Once a tutor has ≥ `TUTOR_BIAS_MIN_SAMPLES = 5` AI/tutor pairs (their assessment + an AI assessment of the same student/language within a 60-day window), the global `TUTOR_BIAS_OFFSET = 0.5` is replaced by their empirical mean delta. New `User.tutorBias` field (`offset`, `sampleSize`, `confidence`, `computedAt`) caches the result for 7 days. The aggregator looks up per-tutor offsets at read time via the new `cefrEstimatorService.getTutorBiasOffsetsBatch(ids[])` and applies them on top of the raw `proficiencyLevel`, ignoring the stored `biasAdjustedNumeric` for that lesson — historical docs are never rewritten. Confidence tiers (`high` / `medium` / `low`) gate whether the empirical offset is used or we fall back to the global default. Implemented in `cefrEstimatorService.js` (`computeTutorBiasFromHistory`, `getTutorBiasOffset`, `getTutorBiasOffsetsBatch`).
- **Evolution timeline in profile CEFR card.** `revealHistory[]` is already persisted from Batch 12 — we now surface the last 6 reveals as a horizontal timeline of colored dots (green = level up, red = level down, grey = flat) with per-reveal level + month/year labels. The current reveal is highlighted. Pure data binding, no template functions. Dark-mode styled. Implemented in `profile.page.{html,scss,ts}` and the new `cefrEvolution` precomputed array.
- **Source divergence transparency.** Aggregator now computes a per-source `divergence` signal whenever the rolling window contains both AI and tutor sources: `gap = mean(tutor_numeric) − mean(ai_numeric)`, persisted on the reveal as `revealedCefrLevel.divergence` (with `aiLevel`, `tutorLevel`, `direction`) when `|gap| ≥ 1.0`. Surfaced in three places:
  - The narrative auto-appends a sentence: _"Your tutors tend to assess you at B2; AI signals point to B1. We've blended both — the truth is usually in between."_
  - The journey-page details alert renders a yellow callout block.
  - The profile CEFR card renders a yellow callout above the evolution timeline.
- New `LearningPlan.revealedCefrLevel.divergence` schema (gap, aiLevel, tutorLevel, direction). Same shape persisted on every entry in `revealHistory[]`.
- New i18n strings under `JOURNEY.CEFR.{EVOLUTION_TITLE, DIVERGENCE_TITLE, DIVERGENCE_BODY}`.
- Rationale: tutor inflation isn't uniform — encouragement bias varies tutor-to-tutor, so a single global offset systematically over- or under-corrects for individual tutors. Per-tutor calibration tightens accuracy as data accumulates without breaking on day one (low-data tutors fall back to global). The evolution timeline gives students a sense of trajectory beyond a single number, and the divergence callout converts an opaque "low agreement" dot into actionable copy that explains *why* the agreement is low.
- Documentation updated: `cefr-estimation.md` now has a "Per-tutor calibration" subsection, a "Source divergence" subsection, expanded constants reference, and revised future-work list (only i18n + tutor-facing visibility remain).

## 2026-05-08 — Batch 12: CEFR estimation + milestone-gated reveal

- New `backend/services/cefrEstimatorService.js` — single source of truth for the student's estimated CEFR level. Two-stage architecture (internal estimate + revealed level). See `docs/learning-journey/cefr-estimation.md`.
- New `LearningPlan` fields: `internalCefrEstimate` (recomputed every lesson, backend-only consumers), `revealedCefrLevel` (milestone-gated, student-facing), `revealHistory[]` (append-only), `pendingCefrReveal` flag.
- New `LessonAnalysis.biasAdjustedLevel` + `biasAdjustedNumeric` — stamped at write time via a pre-save hook. Tutor sources are shifted down by `TUTOR_BIAS_OFFSET = 0.5` CEFR levels to compensate for documented tutor inflation. AI sources pass through unchanged. Storing at write time means the aggregator can change formula later without mutating historical docs.
- Aggregation: rolling window of 5 most-recent analyses, weighted by recency × confidence. Agreement signal (high/medium/low) computed from the stddev of the window.
- Reveal triggers: first reveal at 5 completed lessons (hard floor of 3), forced re-reveal on every chapter graduation, monthly refresh thereafter (or whenever the level itself changes).
- Wired into `updatePlanAfterLesson` (single integration point — both AI and tutor paths). Wired into `_completeChapterAndGenerateNext` and the mastery-mode entry path.
- Internal consumers updated: `learningPlanService.generateInitialPlan` AI prompt now uses the rolling estimate (with sources + agreement) instead of the latest single lesson. `tutorBriefingService.getBriefing` surfaces the rolling estimate alongside `chapterLevel` (the gated bucket).
- New API: `POST /api/learning-plan/:lang/cefr-reveal/ack` — clears `pendingCefrReveal` after the student sees the modal/toast.
- API additions on `GET /api/learning-plan/:lang`: server attaches `cefrScale` (A1..C2 with the active level marked) for direct UI rendering when a reveal is present.
- UX surfaces:
  - Journey page header chip — compact `A1 A2 [B1] B2 C1 C2 ●` scale with agreement dot. Tappable → details alert. Hidden until first reveal.
  - Profile page card — level, narrative, sources breakdown, agreement label. Empty-state copy when not yet revealed.
  - First reveal — full-narrative alert; subsequent re-reveals (chapter graduation, monthly refresh) — success toast.
- Narrative is template-generated from structured data (top component, weakest component, trend, framing) — no AI cost. ~380 unique combinations from the phrase pools. **Known follow-up: English-only for v1; i18n deferred.**
- Goal-change alert copy in profile expanded with explicit "What's kept / What changes" sections so students see the consequences before confirming.
- Rationale: `chapterLevel` is a gated bucket that lags real proficiency by 5+ lessons; we needed a smoother, source-balanced estimate for AI prompts and tutor briefings, plus a stable student-facing reveal that doesn't tick up and down arbitrarily lesson-to-lesson. Tutor inflation correction is critical because tutors empirically grade higher than objective measures.

## 2026-05-08 — Goal change preserves demonstrated progress (G2 fix)

- `learningPlanService.regeneratePlan` no longer deletes the plan and recreates it from scratch. It now mutates in place via the new `_regeneratePlanForGoalChange`.
- New `chapterGenerationService.regenerateChapterForGoalChange(plan, { oldGoal, previousPhases })`. Premium → AI with goal-change-specific prompt (different titles than before, same CEFR). Free → existing CEFR template, goal-flavored. Silent template fallback on AI error (G7).
- Preserved across goal change: `chapterIndex`, `chapterLevel`, `chapterTheme`, `chaptersCompleted`, `calibrationLockedAt`, `decayWarnings`, `demotionEvents`, `aiRegenerationsAt`, `journeyIntroSeenAt`, `tutorOverrides`, `tutorFocusByTutorId`, `recommendedMaterials`, `pendingTransitions`, `selfAssessedLevel`, `weeklyRecommendations`, full `history` (now appended, not reset).
- Replaced: `phases` (4 fresh phases at preserved CEFR), `goal`, `studentSummary`, `nextLessonFocus`, `currentPhaseIndex` (back to 0). New phases start clean — `lessonScores`, `lessonsCompleted`, `tutorVotes`, `studentEditedAt` all empty.
- `mastery_mode` plans short-circuit: only the `goal` and history are updated; no phase regeneration (post-C2 plans don't have phases to rewrite).
- New history entry uses `reason: 'goal_change'` with a "from → to" `changeDescription` so support / debug can trace the pivot.
- Wired `PUT /api/users/onboarding` to invoke `regeneratePlan` after the user's `learningGoal` changes (the existing UI re-runs onboarding to "change goal", which previously updated the user but never touched the plan — silent staleness gap).
- Profile "Change Goal" alert copy updated: "Your current level and chapter progress will be kept — only your upcoming phases will be rewritten."
- Cooldown remains 7d (free) / 0d (premium) with the existing 24h grace.
- Rationale: a goal change is almost always a refinement, not a restart. The previous full-reset behavior wiped chapter history, demonstrated CEFR, tutor context, and AI quota — punishing engaged students disproportionately and lying to the next tutor briefing about the student's level. See scenarios.md G2.

## 2026-05-07 — Tutor visibility: plan context on calendar + messages

- Tutor mobile calendar: each upcoming 1:1 lesson card now shows a tiny phase + focus chip below the title (`mcal-plan-chip`). Phase is shown as `N/total · {phase title}`, followed by the next-lesson focus. Cached per-student so flipping days doesn't re-fetch.
- Tutor messages thread: when a tutor opens a 1:1 conversation with a student (desktop & mobile), an inline `plan-strip` appears between the chat header and the message list — same phase + focus surface, sourced from `getStudentPlanSummary`. Cached per-student to keep thread switching instant.
- Both surfaces use the existing `/api/learning-plan/student/:studentId/summary` endpoint — no backend changes required. Strips/chips only render when the student has an active plan and the language matches; otherwise they're silently absent.
- Rationale: closes the two largest tutor-visibility gaps identified after Batch 10. Tutors can now triage their day (calendar) and pick up a thread (messages) without first opening the lesson briefing.

## 2026-05-07 — Batch 13: Mastery Mode (post-C2 endgame)

- After Chapter 6 (C2) graduates, `plan.status` is set to `mastery_mode` (already wired in Batch 4 via `_completeChapterAndGenerateNext`). No further chapters generated.
- Decay rule short-circuits on `mastery_mode` plans (already in place at line 655 of `learningPlanService.js`) — no demotions at C2.
- New `quizService.maybePushMasteryWeekly({ userId, language })`: idempotent. Pushes one C2 micro-challenge per 7-day window using a curated theme rotation (`MASTERY_MODE_THEMES`).
- New `quizService.runMasteryModeWeeklySweep()`: iterates all `mastery_mode` plans and calls `maybePushMasteryWeekly`. Cron job at `30 9 * * *` (09:30 daily, idempotent per-user).
- New cron registration for the previously-unscheduled `runQuizEndOfDayBatch` (Batch 8) — now fires every hour with per-user filters deciding actual pushes.
- Quiz schema gains `mastery_weekly` type; UserQuizHistory schema gains `theme` field and `mastery_mode_weekly` trigger value.
- New `GET /api/learning-plan/:language/mastery-weekly` endpoint returns the active challenge (and triggers a push if eligible).
- New journey-page Mastery Mode card: dark-themed banner with "This week's challenge" CTA, theme label, next-eligible date.
- New i18n keys under `JOURNEY.MASTERY.*`.

## 2026-05-07 — Batch 12: Premium conversational plan editing

- New `POST /api/learning-plan/:language/chat` endpoint — premium-only. Sends chat history; AI returns reply + structured proposed edits scoped to current chapter (no mutation, no budget cost).
- New `POST /api/learning-plan/:language/chat/apply` — applies proposed edits, consumes one credit from the existing 2/30-day regen budget.
- Service additions: `proposePlanEdits`, `applyProposedEdits` in `learningPlanService.js`.
- Constraints enforced: same phase count, same order, same CEFR level, same goal. Per-phase progress (lessonScores, tutorVotes, lessonsCompleted, masteryAverage) is preserved untouched.
- New `PlanChatModalComponent` — two-pane chat + diff view (before/after per phase), confirmation alert when about to spend last credit.
- New i18n keys under `JOURNEY.CHAT.*`.

## 2026-05-07 — Batch 11: Premium adaptive phase splitting

- New `_maybeSplitPhase` in `learningPlanService.js`. Triggers on premium-only when a phase has ≥ 6 lessons with rolling mastery < 60.
- AI proposes a split into 2a/2b based on focus areas; deterministic fallback if AI fails.
- Splits keep total length constant (each half = ½ of original `estimatedLessons`, min 3).
- Adds `_isSplit` and `_isFundamentals` flags to `phaseSchema` to prevent re-splitting and skip splitting on fundamentals phases.
- New `phase_split` history reason.
- New `pendingTransitions.phaseSplit` flag → polite toast on next journey-page visit ("Your tutor noticed X is harder than expected").
- Frontend: `JOURNEY.PHASE_SPLIT_TOAST` i18n key, ack-transition extended to clear the flag.

## 2026-05-07 — Batch 10: Multi-tutor vote model

- `tutor-override` route: `advance_phase` and `extend_phase` (alias `hold_phase`) no longer auto-mutate `currentPhaseIndex`. They now write `tutorVotes` entries on the current phase.
- Mastery service consumes votes via `applyTutorVoteBias` — single advance lowers threshold by 5, single hold raises by 5; aggregated across distinct tutors within 14d window.
- Tutors only ever see their own latest vote (`yourVote` on `lesson-prep`); never other tutors' votes (G30).
- Students get a privacy-safe aggregate (`tutorVoteSummary` with consensus signal) instead of raw votes.

## 2026-05-07 — Batch 0: Documentation scaffolding

- Created `docs/learning-journey/` with README, architecture, scenarios, prompts, operations, changelog.
- Established convention: PRs touching journey code reference scenario IDs.
- Established convention: prompt changes increment versions in `prompts.md`.

## TBD — Batch 1: Chapter system foundation

- Adds `chapterIndex`, `chapterLevel`, `chapterTheme`, `chaptersCompleted` to `LearningPlan` schema.
- Replaces `last_phase` short-circuit in `evaluateAdvancement` with chapter graduation logic.
- Migration: existing plans treated as chapter 1; level inferred from `selfAssessedLevel`.

## TBD — Batch 2: Chapter generation

- New `chapterGenerationService.js` for free template + premium AI paths.
- Hooks into `_applyMasteryPromotion` to trigger graduation + regen.
- Adds `_applyDecayIfNeeded` for polite demotion.
