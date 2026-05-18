# AI Prompts (versioned)

Every prompt used by the journey system is versioned here. When you change a prompt, increment its version, paste the new version, and add a row to [`changelog.md`](changelog.md).

## P-LP-001 — Per-lesson plan update (premium)

**Used by:** `_updatePlanWithAi` in `backend/services/learningPlanService.js`
**Model:** GPT-4o-mini
**Version:** 1.0 (initial)

(Existing prompt — referenced as-is for now.)

## P-LP-002 — Per-lesson plan update (premium, refined for Batch 7)

**Used by:** `_updatePlanWithAi` in `backend/services/learningPlanService.js`
**Model:** GPT-4o-mini
**Version:** 2.0 (Batch 7)
**Changes:** Requires output to reference specific verbs/grammar points named in analysis, the tutor's name, a recommended activity verb. Adds output validation; reject + re-prompt once if generic.

(To be filled in during Batch 7.)

## P-CH-001 — Chapter generation (premium AI)

**Used by:** `generateChapterWithAi` in `backend/services/chapterGenerationService.js`
**Model:** GPT-4o-mini
**Version:** 1.0 (Batch 2)

Inputs:
- Completed chapter snapshot (titles, mastery scores)
- Top 3 persistent struggles across the chapter
- Goal type + description
- Target CEFR level (next chapter)

Output: 4 phases `{ title, description, focusAreas, exitCriteria, suggestedTopics, estimatedLessons }` keyed to next CEFR level + tuned to weakest areas of completed chapter.

(Detailed prompt to be filled in Batch 2.)

## P-Q-001 — Quiz generation (premium)

**Used by:** `generateQuizForStruggle` in `backend/services/quizService.js`
**Model:** GPT-4o-mini
**Version:** 1.0 (Batch 8)

Inputs: language, level (CEFR), struggle key, type (fill-in-blank, multiple-choice).
Two-pass: pass 1 generates, pass 2 verifies all answers.

(Detailed prompt to be filled in Batch 8.)

## P-Q-002 — Quiz personalized header

**Used by:** `generateQuizHeader` in `backend/services/quizService.js`
**Model:** GPT-4o-mini
**Version:** 1.0 (Batch 8)

Inputs: lesson summary, tutor name, struggle key.
Output: 1-2 sentence "why this quiz" header.

## P-TB-001 — Tutor briefing synthesis

**Used by:** `synthesizeTutorBriefing` in `backend/services/tutorBriefingService.js`
**Model:** GPT-4o-mini
**Version:** 1.0 (Batch 7)

Inputs: student's mastery trajectory, persistent struggles, recent lesson analyses (last 5), requesting tutor's prior notes (if any), other tutors' aggregate signals (anonymized).

Output: two sections — "Your last lesson with this student" (own context) and "General progress" (cross-tutor anonymized).

## P-CE-001 — Conversational plan editing (premium, Batch 12)

(Detailed prompt to be filled in Batch 12.)
