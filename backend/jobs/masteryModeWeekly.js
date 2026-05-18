/**
 * Mastery Mode weekly micro-challenge sweep (Batch 13).
 *
 * Iterates all premium plans currently in `mastery_mode` (post-C2)
 * and pushes a single C2-level micro-challenge if 7+ days have passed
 * since the last one. The underlying push is idempotent — running this
 * job daily is safe and ensures students never miss their challenge
 * even if the box was off on the exact 7-day mark.
 */

const quizService = require('../services/quizService');

async function runMasteryModeWeeklyCron() {
  console.log('🏛️  [Mastery] Running weekly micro-challenge sweep...');
  try {
    const r = await quizService.runMasteryModeWeeklySweep();
    console.log(`🏛️  [Mastery] Done. fired=${r.fired} considered=${r.considered}`);
    return r;
  } catch (err) {
    console.error('🏛️  [Mastery] Failed:', err);
    return { fired: 0, considered: 0, error: err.message };
  }
}

module.exports = { runMasteryModeWeeklyCron };
