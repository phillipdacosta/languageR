const mongoose = require('mongoose');

const vocabEntrySchema = new mongoose.Schema({
  word: {
    type: String,
    required: true,
    trim: true
  },
  translation: {
    type: String,
    required: true,
    trim: true
  },
  example: {
    type: String,
    default: '',
    trim: true
  },
  addedBy: {
    type: String,
    enum: ['tutor', 'student'],
    default: 'tutor'
  }
}, { _id: true });

const goalEntrySchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    trim: true
  },
  completed: {
    type: Boolean,
    default: false
  },
  addedBy: {
    type: String,
    enum: ['tutor', 'student'],
    default: 'student'
  }
}, { _id: true });

const lessonVocabularySchema = new mongoose.Schema({
  lessonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lesson',
    required: true,
    index: true
  },
  // Both tutor and student can contribute vocab
  tutorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  vocabulary: [vocabEntrySchema],
  goals: [goalEntrySchema],
  language: {
    type: String,
    default: 'Spanish'
  }
}, {
  timestamps: true
});

// Compound index: one vocab document per lesson
lessonVocabularySchema.index({ lessonId: 1 }, { unique: true });
// Fast lookup for student's vocabulary across all lessons
lessonVocabularySchema.index({ studentId: 1, createdAt: -1 });

module.exports = mongoose.model('LessonVocabulary', lessonVocabularySchema);

