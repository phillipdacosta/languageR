const mongoose = require('mongoose');

const reviewDeckItemSchema = new mongoose.Schema({
  // User who saved this correction
  userId: {
    type: String,
    required: true,
    index: true
  },
  
  // The incorrect text the student said
  original: {
    type: String,
    required: true
  },
  
  // The corrected version
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
  timestamps: true
});

// Compound index for efficient queries
reviewDeckItemSchema.index({ userId: 1, savedAt: -1 });
reviewDeckItemSchema.index({ userId: 1, mastered: 1 });
reviewDeckItemSchema.index({ userId: 1, language: 1 });

// Virtual for checking if item needs review (spaced repetition)
reviewDeckItemSchema.virtual('needsReview').get(function() {
  if (this.mastered) return false;
  if (!this.lastReviewedAt) return true;
  
  // Simple spaced repetition: review after 1 day, 3 days, 7 days, 14 days
  const daysSinceReview = Math.floor((Date.now() - this.lastReviewedAt) / (1000 * 60 * 60 * 24));
  const intervals = [1, 3, 7, 14, 30];
  const targetInterval = intervals[Math.min(this.reviewCount, intervals.length - 1)];
  
  return daysSinceReview >= targetInterval;
});

// Method to mark as reviewed
reviewDeckItemSchema.methods.markReviewed = function() {
  this.reviewCount += 1;
  this.lastReviewedAt = new Date();
  return this.save();
};

// Method to toggle mastered
reviewDeckItemSchema.methods.toggleMastered = function() {
  this.mastered = !this.mastered;
  return this.save();
};

// Static method to get items that need review
reviewDeckItemSchema.statics.getItemsNeedingReview = function(userId, limit = 10) {
  return this.find({
    userId,
    mastered: false,
    $or: [
      { lastReviewedAt: { $exists: false } },
      { 
        lastReviewedAt: { 
          $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // At least 1 day old
        }
      }
    ]
  })
  .sort({ lastReviewedAt: 1, savedAt: 1 }) // Oldest reviews first
  .limit(limit);
};

module.exports = mongoose.model('ReviewDeckItem', reviewDeckItemSchema);




