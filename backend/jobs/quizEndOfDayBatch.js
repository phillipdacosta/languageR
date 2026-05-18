/**
 * End-of-day quiz batch (Batch 8).
 *
 * Aggregates each premium student's day-of struggle signals and pushes
 * up to 1 quiz per user (cap 2/day total, see quizService.DAILY_PUSH_CAP).
 *
 * Designed to run at ~8pm in the user's local time. For now we run
 * once per cron cycle and let per-user filters (cap, cooldown, paused)
 * decide who actually gets a push. Localized rollout = future work.
 *
 * Idempotent — running it multiple times within the cap window is safe.
 */

const quizService = require('../services/quizService');

async function runQuizEndOfDayBatch() {
  console.log('🌙 [QUIZ-EOD] Running end-of-day quiz batch...');
  try {
    const r = await quizService.runEndOfDayBatch({ olderThanHours: 24 });
    console.log(`🌙 [QUIZ-EOD] Done. fired=${r.fired} considered=${r.considered}`);
    return r;
  } catch (err) {
    console.error('🌙 [QUIZ-EOD] Failed:', err);
    return { fired: 0, considered: 0, error: err.message };
  }
}

module.exports = { runQuizEndOfDayBatch };
