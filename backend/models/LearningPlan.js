const mongoose = require('mongoose');

const phaseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  focusAreas: [{ type: String }],
  suggestedTopics: [{ type: String }],
  exitCriteria: { type: String, default: '' },
  estimatedLessons: { type: Number, default: 5 },
  lessonsCompleted: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['locked', 'active', 'completed'],
    default: 'locked'
  },
  completedAt: { type: Date, default: null }
}, { _id: false });

const historyEntrySchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', default: null },
  changeDescription: { type: String, required: true },
  phaseIndexBefore: { type: Number, default: null },
  phaseIndexAfter: { type: Number, default: null }
}, { _id: false });

const tutorOverrideSchema = new mongoose.Schema({
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tutorName: { type: String, default: '' },
  date: { type: Date, default: Date.now },
  action: {
    type: String,
    enum: ['extend_phase', 'advance_phase', 'skip_phase', 'adjust_focus', 'add_note'],
    required: true
  },
  note: { type: String, default: '' }
}, { _id: false });

const learningPlanSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  language: {
    type: String,
    required: true,
    trim: true
  },
  goal: {
    type: {
      type: String,
      enum: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation', 'other'],
      required: true
    },
    description: { type: String, default: '' },
    targetLevel: { type: String, default: '' },
    timeline: { type: String, default: 'no_rush' },
    timelinePressure: {
      type: String,
      enum: ['specific_date', 'few_months', 'no_rush'],
      default: 'no_rush'
    },
    targetDate: { type: Date, default: null }
  },
  selfAssessedLevel: {
    type: String,
    enum: ['complete_beginner', 'some_basics', 'simple_conversations', 'intermediate', 'advanced'],
    default: 'some_basics'
  },
  currentPhaseIndex: {
    type: Number,
    default: 0
  },
  phases: [phaseSchema],
  weeklyRecommendations: {
    lessonFrequency: { type: String, default: '2x per week' },
    selfStudyMinutes: { type: Number, default: 15 },
    focusBetweenLessons: { type: String, default: '' }
  },
  studentSummary: {
    type: String,
    default: ''
  },
  nextLessonFocus: {
    type: String,
    default: ''
  },
  history: [historyEntrySchema],
  tutorOverrides: [tutorOverrideSchema],
  lastUpdatedAt: {
    type: Date,
    default: Date.now
  },
  lastUpdatedFromLessonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lesson',
    default: null
  },
  lastGoalChangedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'completed', 'paused'],
    default: 'draft'
  }
}, {
  timestamps: true
});

learningPlanSchema.index({ studentId: 1, language: 1 }, { unique: true });
learningPlanSchema.index({ studentId: 1, status: 1 });

module.exports = mongoose.model('LearningPlan', learningPlanSchema);
