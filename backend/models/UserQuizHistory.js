const mongoose = require('mongoose');

/**
 * Per-user quiz history. Tracks which quizzes the student has seen
 * (so we don't repeat in the auto-push pipeline), per-quiz ratings,
 * and global pause state for auto-push.
 *
 * See docs/learning-journey/scenarios.md (G24, G26, G28).
 */

const seenQuizSchema = new mongoose.Schema({
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
  language: { type: String, default: '' },
  struggle: { type: String, default: '' },
  // When we PUSHED it (notification fired). Distinct from started/completed.
  pushedAt: { type: Date, default: Date.now },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  // 0=neutral, 1=thumbs_up, -1=thumbs_down. Drives auto-pause (G26)
  // and pool quality metrics aggregation (G19).
  rating: { type: Number, default: 0 },
  // The trigger that pushed this quiz — used for analytics + dedupe.
  trigger: {
    type: String,
    enum: ['immediate_post_lesson', 'end_of_day_batch', 'manual', 'mastery_mode_weekly'],
    default: 'manual'
  },
  // Mastery Mode (Batch 13): which C2 theme this challenge covered.
  theme: { type: String, default: '' },
  // Personalized header card content generated for THIS push (cheap AI call).
  personalizedHeader: { type: String, default: '' }
}, { _id: true });

const userQuizHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  language: { type: String, required: true, index: true },
  // Append-only log of every quiz the user has been pushed/seen.
  seen: [seenQuizSchema],
  // Quizzes the student explicitly chose to retake (browse + repeat).
  retakeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Quiz' }],
  // Auto-pause: set when 5 consecutive thumbs-down. Auto-clears 14d later
  // OR when student manually browses a quiz (G26).
  autoPushPausedUntil: { type: Date, default: null },
  // Lastly-seen struggle → pushedAt timestamp. Used for the 48h
  // per-struggle cooldown (avoids drilling the same point too soon).
  lastPushedByStruggle: { type: Map, of: Date, default: () => new Map() },
  // Daily push counter, keyed by ISO date string (YYYY-MM-DD). Cleaned on read.
  dailyPushCounts: { type: Map, of: Number, default: () => new Map() }
}, { timestamps: true });

userQuizHistorySchema.index({ userId: 1, language: 1 });

module.exports = mongoose.model('UserQuizHistory', userQuizHistorySchema);
