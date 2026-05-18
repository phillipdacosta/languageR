# CEFR Estimation

How we estimate a student's current CEFR level (A1–C2), and when we show it.

## Why this exists

`LearningPlan.chapterLevel` is a **bucket** that only changes on chapter
graduation, demotion, or calibration. By design it lags real proficiency by
5+ lessons. We needed a finer-grained, smoother estimate for:

- Internal consumers (AI plan prompts, tutor briefings)
- A milestone-gated student-facing reveal

This is **distinct from `chapterLevel`** — chapterLevel is the band the
student is currently working through; the estimate is where they actually
are.

## Architecture

Two stages with very different update rates and audiences:

| Stage | Field | Updated | Audience |
|---|---|---|---|
| Internal | `LearningPlan.internalCefrEstimate` | After every lesson | Backend only (AI prompts, tutor briefings) |
| Revealed | `LearningPlan.revealedCefrLevel` | At milestones only | Student-facing UI |

The internal estimate fluctuates lesson-to-lesson; the revealed level is
psychologically stable so the student doesn't see their level ticking up
and down arbitrarily.

## Data sources

Both AI-analyzed lessons and tutor-assessed lessons (when AI analysis is
disabled) end up as `LessonAnalysis` documents with the same shape and the
same `overallAssessment.proficiencyLevel` field. The aggregator treats them
uniformly — students with mixed AI/tutor history are first-class.

| Source | How CEFR is set |
|---|---|
| `source: 'ai'` | GPT-4o-mini writes `proficiencyLevel` directly from the lesson transcript |
| `source: 'tutor'` | Tutor selects A1–C2 in the post-lesson feedback form; mirrored into a `LessonAnalysis` doc |

## Tutor bias correction

Tutors empirically grade students higher than objective measures
(encouragement bias, relationship dynamics, financial disincentive to
demotivate a paying student). To compensate, **tutor scores are shifted
down by `TUTOR_BIAS_OFFSET = 0.5` CEFR levels** before aggregation.

This correction is computed and stored at write time on each
`LessonAnalysis.biasAdjustedLevel` (and `biasAdjustedNumeric`) via a
pre-save hook. Storing it at write time means the aggregator can change
the formula later without mutating historical documents.

### Per-tutor calibration

Once a tutor has ≥ `TUTOR_BIAS_MIN_SAMPLES = 5` AI/tutor pairs (their
assessment + an AI assessment of the same student in the same language
within a 60-day window), we replace the global offset with their
empirical mean delta:

```
delta_i = tutor_numeric_i − ai_numeric_i      (closest-in-time AI baseline)
empirical_offset = mean(delta_i)
```

The result is clamped to ±2.0 levels (data-error guard) and a confidence
tier is assigned from sample size + stddev:

| Confidence | Requires | Used for aggregation? |
|---|---|---|
| `high`   | ≥ 20 samples, stddev ≤ 0.6 | yes |
| `medium` | ≥ 10 samples, stddev ≤ 1.0 | yes |
| `low`    | ≥ 5 samples (anything else) | no — fall back to global |

The result is cached on `User.tutorBias` for `TUTOR_BIAS_CACHE_TTL_MS = 7 days`
to keep the aggregator hot-path cheap. Recomputation happens lazily on
the next aggregation read after the TTL expires.

The aggregator looks up per-tutor offsets at **read time** and applies
them on top of the raw `proficiencyLevel`, ignoring the stored
`biasAdjustedNumeric` for that lesson. Historical `LessonAnalysis` docs
are never rewritten — they keep the global-offset stamp as a fallback.

Implemented in `cefrEstimatorService.js`:
- `computeTutorBiasFromHistory(tutorAuth0Id)` — pure compute
- `getTutorBiasOffset(tutorAuth0Id)` — cached resolver (recomputes on miss)
- `getTutorBiasOffsetsBatch(ids[])` — batched for the aggregator

## Aggregation formula

For each of the last `ROLLING_WINDOW = 5` analyses (oldest → newest):

```
recency_w   = 1 + (i / (N-1)) * 0.5     // newest ≈ 1.5×, oldest = 1×
confidence_w = (analysis.confidence ?? 70) / 100
final_w     = recency_w × confidence_w

weighted_avg_numeric = Σ(numeric × final_w) / Σ(final_w)
revealed_level       = numericToLevel(weighted_avg_numeric)
```

Agreement signal — measured as the standard deviation of the bias-adjusted
numeric levels in the rolling window:

| stddev | agreement |
|---|---|
| ≤ 0.5 | `high` |
| 0.5 – 1.0 | `medium` |
| > 1.0 | `low` |

### Source divergence

A separate signal — `divergence` — is computed only when the rolling
window contains both AI and tutor sources. We compare the per-source
mean numeric level:

```
gap = mean(tutor_numeric) − mean(ai_numeric)        // signed
divergence = gap if |gap| ≥ 1.0 else null
```

When set, divergence is persisted on the reveal (`revealedCefrLevel.divergence`)
and surfaced transparently in the UI:

- The narrative auto-appends a sentence: _"Your tutors tend to assess you
  at B2; AI signals point to B1. We've blended both — the truth is
  usually in between."_
- The journey-page details alert + profile card render a dedicated yellow
  callout explaining the disagreement and suggesting more lessons.

This is independent of the per-tutor calibration above: a calibrated
tutor with high confidence can still diverge from AI on a given student
because of teaching style, lesson focus, or genuine assessment
disagreement.

## Reveal triggers

The revealed level only updates at meaningful moments:

| Trigger | When | Mechanism |
|---|---|---|
| `first_milestone` | First time student reaches ≥ 5 completed lessons | Auto-fired by `cefrEstimatorService.refresh()` after each lesson |
| `chapter_graduation` | Every chapter graduation event | Forced by `_completeChapterAndGenerateNext` |
| `monthly_refresh` | ≥ 30 days since last reveal **or** the level itself changed | Auto-fired by `cefrEstimatorService.refresh()` |

Hard floor: never reveal with fewer than `REVEAL_HARD_FLOOR = 3` lessons.

## Narrative generation

The reveal narrative ("Over your last 5 lessons you've shown steady gains
in vocabulary…") is **template-generated** with structured variable insertion
from the rolling window — no AI cost. Components used:

- **Top component** — highest mean across grammar / fluency / pronunciation / vocabulary
- **Weakest component** — lowest mean
- **Trend** — slope of the most-populated component series (`surging` / `improving` / `steady` / `mixed` / `declining`)
- **Framing** — `solidly` / `approaching {next}` / `early in {level}` / `with {next} elements emerging`

Phrase pools per slot give ~380 unique combinations. Plenty for non-repetitive feel.

> **Known follow-up:** narratives are English-only for v1. The rest of the
> app is i18n'd. Translating templates is straightforward but deferred.
> Until then, narratives stay in English regardless of UI language.

## UX surfaces

| Surface | What it shows | Hidden when |
|---|---|---|
| Journey page header chip (`A1 A2 [B1] B2 C1 C2 ●`) | Compact scale + active level + agreement dot. Tappable → details alert. | No reveal yet |
| Journey details alert | Narrative + sources breakdown + agreement explanation + (when applicable) divergence callout. | No reveal yet |
| Profile page card | Level, narrative, sources breakdown, agreement label. Plus: divergence callout (when AI/tutor gap ≥ 1 level) and an evolution timeline (last 6 reveals as colored dots). Empty-state copy when not yet revealed. | Never — empty-state always shown until reveal |
| First-reveal alert | Full narrative (with divergence sentence if applicable) + sources, dismissible. Fires once on first reveal. | After first reveal |
| Re-reveal toast | "You're at B2" success toast for chapter-graduation / monthly refreshes. | After first reveal — replaces the modal for subsequent reveals |

The `LearningPlan.pendingCefrReveal` flag drives the modal/toast; cleared
via `POST /api/learning-plan/:lang/cefr-reveal/ack`.

## Edge cases

| Scenario | Behavior |
|---|---|
| < 3 lessons total | No internal estimate, no reveal. Profile shows empty state. |
| 3–4 lessons | Internal estimate computed, no reveal yet. |
| ≥ 5 lessons, first time | First reveal fires with `first_milestone` trigger. |
| All lessons AI-only | Aggregate as normal, no bias adjustment. Sources: `{ ai: N, tutor: 0 }`. |
| All lessons tutor-only (AI off) | Aggregate with bias correction. Sources: `{ ai: 0, tutor: N }`. Agreement signal uses only tutor data. |
| Mixed sources | Combined with bias correction on tutor entries. Most informative agreement signal. |
| Big drop (B2 → A2) | Internal estimate updates, but `chapterLevel` is the gating mechanism for chapter changes. Reveal will surface the drop on the next monthly refresh. |
| Chapter graduation | Forced re-reveal regardless of monthly cooldown. |
| `mastery_mode` plan | Reveal logic still runs; estimate will trend toward C2. |

## Internal consumers

These services read `internalCefrEstimate` (NOT `revealedCefrLevel`):

- `learningPlanService.generateInitialPlan` — feeds `actualCefr` to the AI plan prompt with sources + agreement metadata
- `tutorBriefingService.getBriefing` — surfaces the rolling estimate to tutors (with chapter bucket as separate field)

These services **do not** drive any student-visible UI. The student sees
only `revealedCefrLevel`.

## Constants reference

```js
TUTOR_BIAS_OFFSET             = 0.5     // CEFR levels subtracted from tutor scores (global default)
TUTOR_BIAS_MIN_SAMPLES        = 5       // # AI/tutor pairs needed for empirical per-tutor offset
TUTOR_BIAS_CACHE_TTL_MS       = 7 days  // recompute per-tutor offset cadence
TUTOR_BIAS_MAX_OFFSET         = 2.0     // clamp for empirical offsets (data-error guard)
TUTOR_BIAS_PAIRING_WINDOW_MS  = 60 days // AI/tutor pairing window for calibration
ROLLING_WINDOW                = 5       // lessons aggregated
REVEAL_HARD_FLOOR             = 3       // never reveal with fewer
REVEAL_FIRST_THRESHOLD        = 5       // first reveal at this lesson count
REVEAL_REFRESH_INTERVAL_MS    = 30 days // monthly cadence after first reveal
AGREEMENT_HIGH_STDDEV         = 0.5
AGREEMENT_MEDIUM_STDDEV       = 1.0
DIVERGENCE_THRESHOLD          = 1.0     // AI/tutor gap (in levels) to surface divergence UI
```

All defined in `backend/services/cefrEstimatorService.js`.

## Future work

- **i18n for narratives** — translate template phrase pools (deferred — narratives stay English-only for v1).
- **Tutor-facing visibility into their own bias offset** — surface the empirical offset to tutors so they understand their grading tendencies.
- **Trend visualization beyond reveals** — chart the internal estimate (not just reveals) for premium students who want a finer-grained view.
