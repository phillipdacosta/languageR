const mongoose = require('mongoose');

const lessonSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  language: {
    type: String,
    required: true
  },
  level: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced'],
    required: true
  },
  category: {
    type: String,
    enum: ['vocabulary', 'grammar', 'pronunciation', 'conversation', 'reading', 'listening'],
    required: true
  },
  content: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  exercises: [{
    type: {
      type: String,
      enum: ['multiple-choice', 'fill-in-blank', 'translation', 'audio', 'speaking'],
      required: true
    },
    question: {
      type: String,
      required: true
    },
    options: [String], // For multiple choice
    correctAnswer: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    explanation: String,
    points: {
      type: Number,
      default: 10
    }
  }],
  estimatedTime: {
    type: Number, // in minutes
    required: true
  },
  difficulty: {
    type: Number,
    min: 1,
    max: 5,
    default: 1
  },
  prerequisites: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lesson'
  }],
  tags: [String],
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
lessonSchema.index({ language: 1, level: 1, category: 1 });
lessonSchema.index({ tags: 1 });

module.exports = mongoose.model('Lesson', lessonSchema);
