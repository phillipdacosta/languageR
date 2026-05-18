# Scenarios

Every scenario the journey system must handle. New behavior = new scenario added here. PRs that touch journey code reference scenario IDs.

## Chapter system

| ID | Scenario | Required behavior |
|---|---|---|
| G1 | Student inactive 60+ days | Plan auto-pauses (`plan.status = 'paused'`); on resume, no calibration reset, show "Welcome back" card. |
| G2 | Student changes goal type mid-chapter | Cooldown: 1 goal change per 7 days (free) / none (premium), with a 24h grace window after plan creation for onboarding-mistake fixes. Plan is **not** recreated — `chapterIndex`, `chapterLevel`, `chapterTheme`, `chaptersCompleted`, calibration/decay state, AI quota, intro-seen state, and tutor context are all preserved. Only the current chapter's 4 phases are rewritten (free: template at preserved CEFR; premium: AI with old-vs-new-goal context, template fallback on AI error per G7). `currentPhaseIndex` resets to 0; `phase.tutorVotes`/`lessonScores`/`lessonsCompleted` clear on the new phases (those phases didn't exist yet). `mastery_mode` plans only update the goal — no phase regen. |
| G3 | Student switches languages | New plan per language (existing unique index). Chapter history is per-plan, not cross-language. |
| G4 | Calibration would skip multiple chapters | Cap at 1 chapter promotion per calibration window. Excess high mastery boosts the bar for normal advancement instead. |
| G5 | Student finishes Chapter 6 (C2) | Plan enters `mastery_mode` state. No new chapters generated. UI shows "Mastery Mode — keep practicing to maintain C2." Optional weekly micro-challenges. |
| G6 | Repeated demotion failures | Cap at chapter 1 — never demote below. After 2 demotions in 90 days, prompt student to talk to a tutor (human intervention card). |
| G7 | AI chapter generation fails | Fallback to free-tier template silently. Log for review. Student doesn't see the failure. |
| G8 | Tutor advances phase on paused/completed plan | Reject with clear API error. Show tutor: "This student's plan is paused." |
| G9 | Past chapters mutated by accident | `chaptersCompleted` is read-only by API design — no update endpoints. |
| G10 | Premium downgrades to free mid-chapter | One-time toast: "Your AI features pause when premium ends." Plan continues with rule-based path. Existing AI-generated phases stay (no rewrite). |
| G11 | Free upgrades to premium mid-chapter | AI takes over from next lesson. No backfill. |

## Mastery / decay

| ID | Scenario | Required behavior |
|---|---|---|
| G12 | Bad rolling avg from a single tutor (style mismatch) | Decay requires ≥ 2 distinct tutors contributing to the bad rolling avg before triggering. |
| G13 | Student in 14-day decay window pauses plan | Pause freezes the decay timer. Resume continues from where it left off. |
| G14 | Decay condition met but few lessons recently | Min lesson floor: never decay before 5 total lessons in current chapter. |
| G15 | Student about to be demoted has no warning | Soft warning at first decay-trajectory match: "Your last few lessons were tough — let's review next time." If pattern continues 1 more lesson, then demote. |
| G16 | Tutor vote expires unused (no lessons in 14 days) | Silently expire. No notification. Tutor sees in their UI: "Your last vote expired — no lessons taken in 14 days." |
| G36 | Student in A2 P1 decays | Demote to **A1's last phase** marked `_isRecovery = true` (the "bridge phase"). They keep consolidation skills they had; only need to lock them in. Recovery phase uses stricter graduation gate (mastery 80, ≥ 2 distinct tutors OR an explicit advance vote). UI: green "Steady" chip on the home widget, green node badge on the roadmap, soft callout in the detail card. Voice: never "demoted", "fell back", or "regressed". |
| G37 | Student graduates recovery, advances, decays again from same level | Increment `pingPongCount`. At `pingPongCount >= 1`: `pendingTransitions.humanInterventionSuggested` fires (existing post-lesson human-intervention card). At `pingPongCount >= 2`: `pendingTransitions.recoveryStuck` fires — new highest-priority `recovery_stuck` post-lesson card ("Let's catch our breath", CTA: message tutor). The system explicitly suggests a conversation, not another lesson. |
| G38 | Recovery phase has only one tutor's data | Block graduation regardless of mastery score. The multi-source gate prevents a single tutor from pushing the student back into the level they just fell out of. Exception: the same tutor's explicit non-expired `advance` vote satisfies the gate (they've put their professional judgement on the record). |

## Premium AI

| ID | Scenario | Required behavior |
|---|---|---|
| G17 | AI hallucinates wrong advancement | Mastery floor sacred — already enforced. AI can only nudge borderline cases. |
| G18 | AI generates plan that contradicts student's stated goal | Validation step in `_updatePlanWithAi` — verify generated focus mentions goal-relevant context. If not, reject and re-prompt once, then fallback to rule-based. |
| G19 | AI quiz has wrong answer | Two-pass generation: AI generates → AI verifies. Student-facing thumbs-down feedback flags for human review. Quizzes with > 30% thumbs-down auto-removed from pool. |
| G20 | AI generates same content across all students for same struggle | This is the goal (reuse). Pool stores 5+ template variants per `{language, level, struggle, type}` and rotates. |

## Tutor experience

| ID | Scenario | Required behavior |
|---|---|---|
| G21 | Tutor leaves platform mid-plan | Their past notes anonymized to "A previous tutor". Their entry removed from `tutorFocusByTutorId`. Mastery scores stay. |
| G22 | "Your teaching is sticking" notification spam | Cap: max 1 per tutor per student per week. |
| G23 | First tutor with this student has no other-tutor context | Briefing simply omits the "general progress" section — don't show "no data". |

## Quiz system

| ID | Scenario | Required behavior |
|---|---|---|
| G24 | Student opens immediate quiz, doesn't finish, batch wants to push another | Skip the batch push that day. Don't queue more until current is finished/dismissed. |
| G25 | Pool empty for a struggle+level combo | Generate fresh, save to pool, push to student. Pool grows organically. |
| G26 | Student rates 5 quizzes negatively in a row | Pause auto-quiz pushes for 14 days, show "Take a break? You can still find quizzes in Materials." Re-enable on next student-initiated quiz interaction. |
| G27 | Quiz becomes outdated | `quizVersion` field. Old quizzes soft-deleted from pool but remain accessible to students who already have them in history. |
| G28 | Free student wants quizzes | They can browse static pre-built quizzes in Materials. Premium = personalized + auto-pushed. |

## Multi-tutor vote

| ID | Scenario | Required behavior |
|---|---|---|
| G29 | Same tutor votes twice (changes mind) | Latest vote replaces previous one. Older vote removed. |
| G30 | Tutor votes hold; mastery system advances anyway | Their hold raises threshold by 5 — if mastery exceeds even raised bar, advance still happens. Hold is advisory, not absolute. |

## Calibration

| ID | Scenario | Required behavior |
|---|---|---|
| G31 | Student starts on chapter 1, calibration says demote | Can't go below chapter 1. Instead: extend chapter 1 with extra "fundamentals" phase 0 (only generated in this case). |
| G32 | Student promoted in calibration, then struggles | Normal mastery gate handles. Decay can demote them back. No special re-calibration. |

## Pace / timeline

| ID | Scenario | Required behavior |
|---|---|---|
| G39 | Student says "exam in 4 weeks" at onboarding | `paceCategory = 'urgent'` → AI prompt receives "design ~3 phases × ~3 lessons each, expect 3-4x per week cadence". `weeklyRecommendations.lessonFrequency` is overwritten with "3-4x per week" (deterministic — AI suggestion ignored). |
| G40 | Student says "few months" with no targetDate | `paceCategory = 'focused'` → 3 phases × 4 lessons, "2-3x per week". |
| G41 | Student selects "no rush" | `paceCategory = 'relaxed'` → 5 phases × 5 lessons, "1-2x per week". |
| G42 | Student passes their `targetDate` without finishing the plan | `weeksToTarget` returns 0 → still `urgent` until they update the goal. We do not surface "you missed your date" — the next pace recompute happens on goal change. |
| G43 | Student changes from "no rush" to "few months" mid-plan | `_regeneratePlanForGoalChange` recomputes `weeklyRecommendations` to "2-3x per week" and the AI regen for the current chapter targets 3 phases. Existing chapter history + CEFR state preserved. |
| G44 | Free student, no AI on plan generation | `generateChapterFromTemplate` keeps the 4-phase pedagogical structure but `estimatedLessons` per phase is pace-tuned. Free students get pace-aware lesson budgets even without AI. |

## Frontend / state

| ID | Scenario | Required behavior |
|---|---|---|
| G33 | Student navigates away mid-celebration modal | Flag stays set on backend. Re-show on next visit (max 3 times, then auto-dismiss). |
| G34 | Two devices open simultaneously, one acks the celebration | Backend clears flag → other device's next refresh removes the modal. |
| G35 | Background asset fails to load | Fallback to a solid Airbnb-style gradient with the chapter's accent color. Don't block the journey from rendering. |

## Empty states matrix

| Screen | State | Empty state copy | CTA |
|---|---|---|---|
| Home journey widget | No goal set | "Set a learning goal to get your map" | Set goal |
| Home journey widget | Goal set, no plan generated yet | "Building your map…" (auto-resolves) | (loading) |
| Home journey widget | Plan ready, 0 lessons | "Your map is ready. Book your first lesson to begin." | Book first lesson |
| Home journey widget | Plan complete (Chapter 6 mastered) | "Mastery mode — you've completed your journey." | Open mastery view |
| Home journey widget | Plan paused | "Your plan is paused" | Resume |
| Journey page | No plan | "No journey yet — set your goal." | Set goal |
| Journey page | Plan ready, 0 lessons | Map shows chapter 1, all phases locked except phase 1 (highlighted as "Up next") | Book your first lesson |
| Journey page | Calibration in progress | Banner above map: "We're tuning your map to your real level — done in N more lessons" | (no CTA) |
| Journey page | Decay warning active | Banner above map: "Last few lessons were tough — your tutor will help next time" | (no CTA) |
| Journey page | Demotion in progress | Modal then banner: "Refreshing chapter X — progress saved" | Got it |
| Journey page | Visiting past chapter | Sticky header: "Visiting Chapter X (read-only)" | Return to current |
| Journey page | Plan complete (Mastery Mode) | Celebratory map with "Mastered" badge over each phase | Try mastery challenges |
| Past maps modal | No completed chapters yet | "Your past maps will appear here once you complete your first chapter." | (no CTA) |
| Pre-call (free) | First lesson with this tutor | "First lesson with [Tutor] — no notes yet" | (no CTA) |
| Pre-call (premium) | First lesson, no warm-up | Skip the warm-up card entirely | — |
| Pre-call (premium) | Has warm-up | "Warm up: 2-min refresh on today's focus" | Start |
| Quiz section (free) | No quizzes available | "Browse the quiz library" | Browse |
| Quiz section (premium) | No personalized quizzes yet | "Quizzes will appear here as you take lessons. Or browse the library." | Browse |
| Quiz section (premium) | Auto-push paused | "We're holding back auto-suggestions for now. Browse manually anytime." | Browse library |
| Tutor briefing | First lesson with this student | "First lesson — get to know each other. Their goal: X." | (no CTA) |
| Tutor briefing | No general progress yet | Skip the section entirely | — |
| Tutor briefing | Student-edited phases | "Personalised by student" pill (already implemented) | — |
