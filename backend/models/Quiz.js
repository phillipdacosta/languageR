const mongoose = require('mongoose');

/**
 * Shared quiz pool. One Quiz document is reusable across many students —
 * personalization happens via `UserQuizHistory` and a per-push generated
 * "header" card that names the lesson context.
 *
 * See docs/learning-journey/scenarios.md (G19, G20, G25, G27).
 */

const quizQuestionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['multiple_choice', 'fill_blank', 'translate', 'listen_select'],
    required: true
  },
  prompt: { type: String, required: true },
  options: [{ type: String }],          // for multiple_choice / listen_select
  correctAnswer: { type: String, required: true }, // canonical answer (string compare or index for MC)
  acceptableAlternatives: [{ type: String }],
  // When true, any reasonable free-text answer is accepted (e.g. "Ich heiße ___"
  // where any name works). Avoids penalizing students for typing their own name.
  openAnswer: { type: Boolean, default: false },
  explanation: { type: String, default: '' },
  example: { type: String, default: '' }
}, { _id: false });

const quizSchema = new mongoose.Schema({
  language: { type: String, required: true, index: true },
  level: {
    type: String,
    enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
    required: true,
    index: true
  },
  // Canonical struggle key this quiz addresses (e.g., "ser_vs_estar").
  struggle: { type: String, required: true, index: true },
  // Quiz format. Lets us rotate styles for variety per (language, level, struggle).
  type: {
    type: String,
    enum: ['drill', 'roleplay_prompts', 'mini_dialogue', 'gap_fill', 'translation_set', 'mastery_weekly'],
    default: 'drill',
    index: true
  },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  // The actual quiz body (5-10 questions typically).
  questions: [quizQuestionSchema],
  // Variant index — multiple variants per (language, level, struggle, type)
  // so we can rotate without showing the same content twice.
  templateVariant: { type: Number, default: 0, index: true },
  // Quality metrics — soft delete via thumbsDown / 30%+ negative.
  qualityMetrics: {
    impressions: { type: Number, default: 0 },
    completions: { type: Number, default: 0 },
    thumbsUp: { type: Number, default: 0 },
    thumbsDown: { type: Number, default: 0 }
  },
  source: {
    type: String,
    enum: ['ai_generated', 'hand_curated'],
    default: 'ai_generated'
  },
  // Bumped when content changes. History rows reference the version they served.
  quizVersion: { type: Number, default: 1 },
  // Soft-deleted quizzes don't show in pool queries but stay readable for
  // students who already received them (G27).
  retiredAt: { type: Date, default: null }
}, { timestamps: true });

// Pool query index: shared selection by language+level+struggle.
quizSchema.index({ language: 1, level: 1, struggle: 1, retiredAt: 1 });

module.exports = mongoose.model('Quiz', quizSchema);
