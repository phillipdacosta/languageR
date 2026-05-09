# Voice & framing principles

The journey system runs on a precise diagnostic engine — rolling mastery scores, threshold gates, tutor vote bias, decay rules. **None of that vocabulary belongs in the student-facing UI.** This doc is the rule of thumb every product copy and design decision should be checked against.

## The principle

> The student should never feel examined.

Mastery scores, thresholds, percentages, and pass/fail signals are **diagnostic instruments for the planner, not report cards for the student.** When we leak that vocabulary into the UI, learning becomes performance — every lesson becomes a test, the planner becomes a judge, and the student starts gaming or disengaging.

## What this means in practice

| Instinct | Why it feels exam-y | What we do instead |
|---|---|---|
| Show the rolling mastery (`Mastery 75/100`) | Implies a graded test was just administered | Qualitative pill: "Making steady progress" |
| Show the advance threshold (`need 70 to advance`) | Tells students exactly what to chase, turns the journey into a target | Honest cadence copy: "You'll move on when recent lessons feel solid" |
| Show component scores (`Grammar 85%`) | Looks like a graded paper | Qualitative chip ("Solid"), with the % behind a "Show scores" toggle |
| Show every "improved / maintained / declined" verdict | Binary judgment off a single noisy lesson | Trend with confidence gate; never lead with "declined" |
| Use red for low scores | Failure framing | Soft neutral grey for `needs_work`; no red anywhere in the recap |
| Stamp lesson `n / N` everywhere | Counts down to a finish line | Use the qualitative pill; the bar fills, no number sits next to it |

## Surfaces and what they may show

### Always-visible (default)
- Phase title, description, focus areas
- Qualitative phase state ("Building foundations", "Ready to move on soon")
- Progress bar (no labels on it)
- Tutor names, lesson dates
- CEFR estimate **only after milestone reveal** (5+ lessons or chapter graduation), with the agreement label

### Available on tap (one click away)
- Numerical lesson scores (post-lesson "Show scores" toggle)
- "How do I move on?" explainer (mechanic in plain words, no numbers)
- "Why this plan?" explainer
- Source breakdown for the CEFR estimate

### Server-side only (never shipped)
- The composite 0-100 mastery score
- The 70 advancement threshold
- Tutor vote tally / per-tutor votes
- Decay warning counters
- Bias offsets

## Copy rules

1. **No numbers in primary copy.** If a number ends up in a sentence the student reads first, it's wrong.
2. **No "you got X" framing.** "Your grammar was solid this lesson" is fine. "You scored 85%" isn't.
3. **No promises.** "About 5 lessons" makes a promise the data can't keep — phase content varies wildly. Use cadence ("a few lessons", "a handful") not counts.
4. **The student is never stuck.** Always include the safety-net sentence somewhere in any explainer that hints at a gate: "If you've been working on the same phase for a while, we'll move you forward."
5. **Tutors carry weight.** When in doubt, lean on "your tutor will help decide." This humanizes the algorithm and is true.
6. **No red.** Even when the data is bad. Soft neutral grey or amber. Red is reserved for true errors and destructive confirms.
7. **No "fail" / "behind" / "stuck" / "below average".** Use "building", "needs work", "wrapping up", "still working on it".

## Where to look in code

| Concern | File |
|---|---|
| `phaseProgressState` (mapping mastery → student-facing state) | `backend/services/masteryService.js` |
| Strip raw signals from API payload | `backend/routes/learningPlan.js` (GET `/:language`) |
| Qualitative pill rendering | `language-learning-app/src/app/journey/journey.page.{ts,html,scss}` |
| Post-lesson chips + show/hide-scores toggle | `language-learning-app/src/app/post-lesson-student/post-lesson-student.page.{ts,html,scss}` |
| Localized state labels | `language-learning-app/src/assets/i18n/en.json` → `JOURNEY.PROGRESS_STATE.*`, `JOURNEY.PROGRESSION.*` |

## When you're tempted to ship a number

Re-read [the principle](#the-principle). If you still want to ship the number:

1. Is it **diagnostic** (something went wrong, the student needs to act) or **decorative** (just a stat)? Ship only diagnostic.
2. Can the same insight be conveyed qualitatively? Try once.
3. Is it gated behind a tap? If not, gate it.
4. Is it framed as **observation** ("we noticed your grammar was strong") or **judgment** ("you scored 85%")? Rewrite to observation.

If after all of that you still want the number, ship it — but add the rationale to this doc so the next person can audit the decision.

## Plans without a plan: `unframed` and `paused`

Not every student wants — or is ready for — a structured roadmap. The system supports two non-roadmap states without making them feel like dead ends:

- **`unframed`**: the student opted out of a goal at onboarding ("I'll start by trying a lesson"), or actively chose "Learn at my own pace" later. No phases, no chapters. The plan still exists as a thin shell so the post-lesson pipeline (CEFR estimate, recommended materials, tutor briefings) keeps working.
- **`paused`**: the student had a real plan and asked us to hibernate it. All state is preserved. Resuming brings everything back exactly where it was.

### What each surface shows

| Surface | Unframed | Paused |
|---|---|---|
| Home journey widget | Single calm card: "Learning at your own pace" + "Build me a plan" CTA | "Your plan is paused" + "Resume my plan" CTA |
| Premium reassurance card (premium only, home) | Lists what premium still does without a plan (AI analysis, review deck, tutor briefings, CEFR) | Same card, "while paused" framing |
| Profile / "My Learning Goal" | Replaced by an "Add a learning goal" card | Goal card stays, with "Resume" + "Learn at my own pace" actions |
| Post-lesson recap | After ≥ 3 lessons since the plan went unframed/paused, a soft "Want a roadmap?" card appears (server-throttled to once per 30 days when dismissed) | Same prompt, "Ready to pick your plan back up?" |
| Roadmap / map canvas | Hidden | Hidden |

### Copy rules for these states

1. **No urgency.** Never imply the student is missing out. Both states are first-class.
2. **Premium without a plan still earns its keep.** Always remind premium students that AI analysis / review deck / tutor briefings keep working — no plan required.
3. **Resume = no friction.** Returning students should not be asked to re-confirm a goal. Resume is one tap.
4. **The "Want a plan?" prompt is a question, not a pitch.** Phrase as a check-in ("Want a roadmap?") not a marketing line ("Unlock your full potential!").
5. **Premium prompt copy explains the *additive* value of a plan**, not the absence of one ("Premium is doing its job — but a roadmap helps the AI tune each lesson to where you're going next").

### Where to look in code

| Concern | File |
|---|---|
| `unframed` / `paused` status enum + lifecycle timestamps | `backend/models/LearningPlan.js` |
| Generator + lifecycle methods (`createUnframedPlan`, `pausePlan`, `resumePlan`, `unframeExistingPlan`, `promoteUnframedPlan`) | `backend/services/learningPlanService.js` |
| Routes (`/skip`, `/pause`, `/resume`, `/promote`, `/soft-prompt/dismiss`) | `backend/routes/learningPlan.js` |
| Side-effects-only path for unframed/paused lessons | `backend/services/learningPlanService.js` → `_runPostLessonSideEffectsOnly` |
| Onboarding "I'll start by trying a lesson" path | `language-learning-app/src/app/onboarding/onboarding.page.{ts,html,scss}` |
| Home widget unframed / paused states | `language-learning-app/src/app/components/home/journey-widget.component.{ts,html}` |
| Premium-when-unframed value card | `language-learning-app/src/app/components/home/premium-when-unframed.component.ts` |
| Profile pause / resume / skip actions | `language-learning-app/src/app/profile/profile.page.{ts,html,scss}` |
| Post-lesson soft prompt | `language-learning-app/src/app/post-lesson-student/post-lesson-student.page.{ts,html}` |
| Localized strings | `language-learning-app/src/assets/i18n/en.json` → `HOME.JOURNEY_UNFRAMED_*`, `HOME.JOURNEY_PAUSED_*`, `HOME.PREMIUM_UNFRAMED.*`, `POST_LESSON.SOFT_PLAN_PROMPT.*`, `ONBOARDING.STUDENT.SKIP_GOAL_*` |
