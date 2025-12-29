const mongoose = require('mongoose');

/**
 * TutorFeedback Model
 * Used when students have AI analysis disabled
 * Tutors must provide manual feedback for these lessons
 */
const tutorFeedbackSchema = new mongoose.Schema({
  lessonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lesson',
    required: true,
    unique: true,
    index: true
  },
  tutorId: {
    type: String, // auth0Id
    required: true,
    index: true
  },
  studentId: {
    type: String, // auth0Id
    required: true,
    index: true
  },
  
  // Structured feedback fields
  strengths: {
    type: [String],
    default: []
  },
  areasForImprovement: {
    type: [String],
    default: []
  },
  homework: {
    type: String,
    default: ''
  },
  overallNotes: {
    type: String,
    default: ''
  },
  
  // Metadata
  status: {
    type: String,
    enum: ['pending', 'completed'],
    default: 'pending',
    index: true
  },
  providedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  // Reminder tracking
  remindersSent: {
    type: Number,
    default: 0
  },
  lastReminderAt: {
    type: Date,
    default: null
  }
});

// Indexes for efficient queries
tutorFeedbackSchema.index({ tutorId: 1, status: 1 });
tutorFeedbackSchema.index({ studentId: 1, status: 1 });
tutorFeedbackSchema.index({ createdAt: -1 });

module.exports = mongoose.model('TutorFeedback', tutorFeedbackSchema);

