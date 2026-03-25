const mongoose = require('mongoose');

const vocabularyCardSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  language: {
    type: String,
    required: true,
    index: true
  },
  term: {
    type: String,
    required: true,
    trim: true
  },
  translation: {
    type: String,
    default: '',
    trim: true
  },
  context: {
    type: String,
    default: '',
    trim: true
  },
  source: {
    type: {
      type: String,
      enum: ['lesson', 'material', 'manual'],
      default: 'manual'
    },
    lessonAnalysisId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LessonAnalysis'
    },
    materialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TutorMaterial'
    }
  },

  // SM-2 spaced repetition fields
  easeFactor: { type: Number, default: 2.5 },
  interval: { type: Number, default: 0 },
  repetitions: { type: Number, default: 0 },
  nextReviewDate: { type: Date, default: Date.now },
  lastReviewedAt: { type: Date },

  totalReviews: { type: Number, default: 0 },
  correctReviews: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['new', 'learning', 'review', 'mastered'],
    default: 'new'
  }
}, { timestamps: true });

vocabularyCardSchema.index({ studentId: 1, language: 1, nextReviewDate: 1 });
vocabularyCardSchema.index({ studentId: 1, status: 1 });
vocabularyCardSchema.index({ studentId: 1, language: 1, term: 1 }, { unique: true });

/**
 * SM-2 algorithm: compute next review interval based on quality rating.
 * quality: 0 = complete fail, 1 = bad, 2 = hard, 3 = ok, 4 = good, 5 = easy
 */
vocabularyCardSchema.methods.applyReview = function(quality) {
  let { easeFactor, interval, repetitions } = this;

  if (quality >= 3) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);
    repetitions++;
  } else {
    repetitions = 0;
    interval = 0;
  }

  easeFactor = Math.max(1.3,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );

  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + interval);

  this.easeFactor = easeFactor;
  this.interval = interval;
  this.repetitions = repetitions;
  this.nextReviewDate = nextReviewDate;
  this.lastReviewedAt = new Date();
  this.totalReviews += 1;
  if (quality >= 3) this.correctReviews += 1;

  if (repetitions === 0) this.status = 'learning';
  else if (interval >= 21) this.status = 'mastered';
  else this.status = 'review';

  return this.save();
};

module.exports = mongoose.model('VocabularyCard', vocabularyCardSchema);
