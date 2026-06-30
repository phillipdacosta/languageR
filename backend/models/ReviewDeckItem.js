const mongoose = require('mongoose');

const reviewDeckItemSchema = new mongoose.Schema({
  // User who saved this correction
  userId: {
    type: String,
    required: true,
    index: true
  },
  
  // What kind of item this is:
  //   correction — student said `original` (wrong) → `corrected` (right)
  //   phrase/tip — a learning nugget with no "wrong" version (e.g. a goal-
  //                inferred phrase from a roadblock). `original` is blank.
  itemType: {
    type: String,
    enum: ['correction', 'phrase', 'tip'],
    default: 'correction'
  },

  // The incorrect text the student said. Empty for phrase/tip items.
  original: {
    type: String,
    default: ''
  },
  
  // The corrected version (or, for phrase/tip items, the thing to learn).
  corrected: {
    type: String,
    required: true
  },
  
  // Explanation of why it's wrong
  explanation: {
    type: String,
    default: ''
  },
  
  // Context (e.g., "Discussing family advice")
  context: {
    type: String,
    default: ''
  },
  
  // Language being learned
  language: {
    type: String,
    default: 'Spanish'
  },
  
  // Type of error (grammar, vocabulary, pronunciation, etc.)
  errorType: {
    type: String,
    enum: ['grammar', 'vocabulary', 'pronunciation', 'tense', 'preposition', 'agreement', 'spelling', 'word_choice', 'other'],
    default: 'other'
  },
  
  // When it was saved
  savedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // Has the user marked this as mastered?
  mastered: {
    type: Boolean,
    default: false
  },
  
  // How many times has the user reviewed this?
  reviewCount: {
    type: Number,
    default: 0
  },
  
  // Last time the user reviewed this
  lastReviewedAt: {
    type: Date
  },
  
  // Reference to the lesson where this came from (optional)
  lessonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lesson'
  },
  
  // Reference to the analysis where this came from (optional)
  analysisId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LessonAnalysis'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

reviewDeckItemSchema.index({ userId: 1, savedAt: -1 });
reviewDeckItemSchema.index({ userId: 1, mastered: 1 });
reviewDeckItemSchema.index({ userId: 1, language: 1 });
reviewDeckItemSchema.index({ userId: 1, lessonId: 1 });

// Spaced-repetition intervals (days). Index = reviewCount (clamped).
// 0 reviews → due immediately; 1 review → due in 1d; 2 → 3d; 3 → 7d; 4 → 14d; 5+ → 30d.
const SRS_INTERVALS_DAYS = [0, 1, 3, 7, 14, 30];

function nextDueDate(item) {
  const idx = Math.min(item.reviewCount || 0, SRS_INTERVALS_DAYS.length - 1);
  const intervalDays = SRS_INTERVALS_DAYS[idx];
  const last = item.lastReviewedAt ? new Date(item.lastReviewedAt) : new Date(item.savedAt || item.createdAt || Date.now());
  return new Date(last.getTime() + intervalDays * 24 * 60 * 60 * 1000);
}

// Virtual: is this item currently due for review?
reviewDeckItemSchema.virtual('needsReview').get(function() {
  if (this.mastered) return false;
  if (!this.lastReviewedAt) return true; // Never reviewed = due now.
  return nextDueDate(this).getTime() <= Date.now();
});

// Virtual: when is the next review due?
reviewDeckItemSchema.virtual('nextReviewAt').get(function() {
  if (this.mastered) return null;
  return nextDueDate(this);
});

reviewDeckItemSchema.methods.markReviewed = function(quality = 'good') {
  // 'again' = student got it wrong → reset progress so they see it again soon
  // 'good'  = correct → advance one step on the SRS curve
  // 'easy'  = trivially correct → skip ahead two steps
  if (quality === 'again') {
    this.reviewCount = 0;
  } else if (quality === 'easy') {
    this.reviewCount = Math.min((this.reviewCount || 0) + 2, SRS_INTERVALS_DAYS.length - 1);
  } else {
    this.reviewCount = Math.min((this.reviewCount || 0) + 1, SRS_INTERVALS_DAYS.length - 1);
  }
  this.lastReviewedAt = new Date();
  return this.save();
};

reviewDeckItemSchema.methods.toggleMastered = function() {
  this.mastered = !this.mastered;
  return this.save();
};

/**
 * Items that are currently due. Uses the same schedule as the
 * `needsReview` virtual — never-reviewed items first, then those whose
 * SRS interval has elapsed.
 *
 * Note: we do the date comparison server-side (not via the virtual)
 * so we can use indexes and limit cleanly.
 */
reviewDeckItemSchema.statics.getItemsNeedingReview = async function(userId, options = {}) {
  const { limit = 10, language = null } = options;
  const now = Date.now();

  const baseQuery = { userId, mastered: false };
  if (language) baseQuery.language = language;

  // Pull a generous superset and filter by computed due date.
  // For reasonable deck sizes (≤ a few thousand) this is cheap and correct.
  const candidates = await this.find(baseQuery)
    .sort({ lastReviewedAt: 1, savedAt: 1 })
    .lean();

  const due = candidates.filter(item => {
    if (!item.lastReviewedAt) return true;
    const idx = Math.min(item.reviewCount || 0, SRS_INTERVALS_DAYS.length - 1);
    const intervalMs = SRS_INTERVALS_DAYS[idx] * 24 * 60 * 60 * 1000;
    return new Date(item.lastReviewedAt).getTime() + intervalMs <= now;
  });

  return due.slice(0, limit);
};

/**
 * Count of items currently due — used by the home-page Practice badge.
 */
reviewDeckItemSchema.statics.countItemsNeedingReview = async function(userId, language = null) {
  const items = await this.getItemsNeedingReview(userId, { limit: 10000, language });
  return items.length;
};

module.exports = mongoose.model('ReviewDeckItem', reviewDeckItemSchema);



















