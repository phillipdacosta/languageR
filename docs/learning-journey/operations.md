# Operations Runbook

When something goes wrong with the journey system, look here.

## AI generation failure (per-lesson update)

**Symptom:** Logs show `[LearningPlan] AI update failed, falling back to rule path`.

**Behavior:** System falls back to rule-based path silently. Student doesn't see an error.

**Action:** None required for one-off failures. If pattern recurs (>10/hour) check OpenAI API status, key, quota.

## AI chapter generation failure

**Symptom:** Logs show `[ChapterGen] AI generation failed, using template fallback`. Plan now has a templated chapter the student wasn't supposed to get.

**Behavior:** Falls back to free-tier template. Premium student gets a template chapter (acceptable degradation per scenario G7).

**Action:** Investigate why AI failed. If user complains, manually trigger regeneration via admin endpoint (TBD).

## Decay false positive

**Symptom:** Student reports they were demoted but they think they're improving.

**Diagnosis:** Check `plan.history` for recent `decay_warning` and `chapter_demoted` entries. Look at `lessonScores` of last 5 lessons.

**Action:**
1. Verify decay rule fired correctly (avg-3 < 50, ≥ 5 lessons in chapter, ≥ 2 distinct tutors).
2. If false positive (e.g., one bad day skewed the average), manually advance the chapter back via admin endpoint.
3. Add the case to [`scenarios.md`](scenarios.md) for future tuning.

## Manual chapter override (admin)

**When:** User support cases. E.g., a student insists they should be at C1 but the system stuck them at B1 due to bad early lessons.

**How:** (TBD admin endpoint) `POST /admin/learning-plan/:planId/set-chapter` with body `{ chapterIndex, chapterLevel, reason }`.

**Logged:** Writes to `plan.history` with reason `admin_override`.

## Background asset failure (frontend)

**Symptom:** Journey page renders without a background image; a gradient appears instead.

**Diagnosis:** Check browser network tab for 404 on the background asset.

**Action:** Verify asset exists at `language-learning-app/src/assets/journey-backgrounds/<theme>.png`. If missing, restore from git history.

## Quiz pool exhausted for a struggle

**Symptom:** AI generation runs frequently for a popular struggle (e.g., `ser_vs_estar`) because the pool is too small.

**Diagnosis:** Check `Quiz` collection count for that combo: `db.quizzes.count({language, level, struggle, type})`.

**Action:** Pre-seed pool with 10 hand-curated variants for high-frequency struggles to avoid AI cost.

## Premium downgrade orphaned features

**Symptom:** Premium-only features (warm-up, quiz auto-push, AI updates) still appear for a downgraded user.

**Diagnosis:** Check `entitlementsService` cache TTL. Webhook may be lagging.

**Action:** Force entitlements refresh: invalidate cache for that user.

## Notifications spam ("Your teaching is sticking")

**Symptom:** Tutor reports getting too many notifications.

**Diagnosis:** Check `notificationsLog` for that tutor — should show ≤ 1 per (tutor, student, week).

**Action:** Verify rate-limiter respected the 1-per-week cap. If not, check the cron + dedupe logic.
