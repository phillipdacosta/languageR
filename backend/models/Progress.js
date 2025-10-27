const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lesson: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lesson',
    required: true
  },
  status: {
    type: String,
    enum: ['not-started', 'in-progress', 'completed'],
    default: 'not-started'
  },
  score: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  timeSpent: {
    type: Number, // in minutes
    default: 0
  },
  attempts: {
    type: Number,
    default: 0
  },
  completedAt: {
    type: Date
  },
  exerciseResults: [{
    exerciseIndex: {
      type: Number,
      required: true
    },
    userAnswer: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    isCorrect: {
      type: Boolean,
      required: true
    },
    timeSpent: {
      type: Number, // in seconds
      default: 0
    },
    attempts: {
      type: Number,
      default: 1
    }
  }],
  xpEarned: {
    type: Number,
    default: 0
  },
  streakBonus: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Compound index to ensure one progress record per user per lesson
progressSchema.index({ user: 1, lesson: 1 }, { unique: true });

// Index for efficient queries
progressSchema.index({ user: 1, status: 1 });
progressSchema.index({ user: 1, completedAt: -1 });

module.exports = mongoose.model('Progress', progressSchema);
