# Learning Journey System

A chapter-based learning journey for language students. Every 4 phases form a CEFR-anchored chapter; completing a chapter graduates the student to a new world (new background, new phases, advanced level).

## What this folder contains

- [`architecture.md`](architecture.md) — Schema, decision flows, code paths
- [`scenarios.md`](scenarios.md) — Every behavioral scenario (G1–G35) + empty states matrix
- [`prompts.md`](prompts.md) — Versioned AI prompts
- [`operations.md`](operations.md) — Runbook: AI failure, decay false positives, manual chapter override
- [`voice-and-framing.md`](voice-and-framing.md) — The "no exam vibes" principle and copy rules
- [`changelog.md`](changelog.md) — Every behavior change, dated, with rationale

## Core concepts in 60 seconds

- **Phase** — a focused unit of learning (e.g., "Past tenses"). 4 phases per chapter.
- **Chapter** — a CEFR-anchored bundle of 4 phases with its own scenic background. 6 chapters total: A1 → C2.
- **Mastery** — a 0–100 score per lesson. Rolling averages drive phase advancement and chapter graduation.
- **Calibration** — first 5 lessons of chapter 1 can promote/demote the student to find their true level.
- **Decay** — sustained low mastery over multiple lessons (with multiple tutors) can politely demote a student to refresh fundamentals.
- **Vote** — tutors don't directly advance students; their `advance`/`hold` becomes a vote that biases the mastery threshold.
- **Quiz pool** — premium personalized quizzes share a reusable pool, with personalized header cards generated per push.

## CEFR-to-background mapping

| Chapter | CEFR | Theme | Asset |
|---|---|---|---|
| 1 | A1 | Desert oasis | `a1-desert.png` |
| 2 | A2 | Coastal cliffs | `a2-coast.png` |
| 3 | B1 | Mountain lake | `b1-lake.png` |
| 4 | B2 | Snowy peaks | `b2-snow.png` |
| 5 | C1 | Cherry blossoms | `c1-cherry.png` |
| 6 | C2 | Rolling hills | `c2-tuscany.png` |

After Chapter 6, the plan enters **Mastery Mode** — no new chapters, just maintenance.

## Pull request rule

Any PR that touches journey code (mastery service, learning plan service, journey UI, tutor briefing, quiz system) **must reference a scenario in [`scenarios.md`](scenarios.md)** by ID (G1, G14, etc.). New behavior = new scenario added.

## Where in the codebase

- Backend: `backend/services/learningPlanService.js`, `backend/services/masteryService.js`, `backend/services/chapterGenerationService.js`, `backend/services/quizService.js`, `backend/models/LearningPlan.js`, `backend/routes/learningPlan.js`
- Frontend (web): `language-learning-app/src/app/journey/`, `language-learning-app/src/app/components/home/journey-widget.component.*`
- Frontend (mobile): `mobile/src/screens/HomeScreen.tsx`, `mobile/src/services/learningPlan.ts`
