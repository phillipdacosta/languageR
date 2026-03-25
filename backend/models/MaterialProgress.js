const mongoose = require('mongoose');

const materialProgressSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  materialId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TutorMaterial',
    required: true
  },
  language: {
    type: String,
    required: true
  },

  bestScore: { type: Number, default: 0 },
  attempts: { type: Number, default: 0 },
  lastAttemptAt: { type: Date },

  questionResults: [{
    questionId: mongoose.Schema.Types.ObjectId,
    correct: Boolean,
    attempts: { type: Number, default: 1 }
  }],

  completed: { type: Boolean, default: false },
  completedAt: { type: Date },

  xpEarned: { type: Number, default: 0 }
}, { timestamps: true });

materialProgressSchema.index({ studentId: 1, materialId: 1 }, { unique: true });
materialProgressSchema.index({ studentId: 1, language: 1, completed: 1 });

module.exports = mongoose.model('MaterialProgress', materialProgressSchema);
