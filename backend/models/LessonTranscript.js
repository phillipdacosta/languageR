const mongoose = require('mongoose');

const transcriptSegmentSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    required: true
  },
  speaker: {
    type: String,
    enum: ['student', 'tutor'],
    required: true
  },
  text: {
    type: String,
    required: true
  },
  confidence: {
    type: Number,
    min: 0,
    max: 1,
    default: 1
  },
  language: {
    type: String,
    required: true
  }
});

const lessonTranscriptSchema = new mongoose.Schema({
  lessonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lesson',
    required: true,
    index: true
  },
  studentId: {
    type: String,
    required: true,
    index: true
  },
  tutorId: {
    type: String,
    required: true,
    index: true
  },
  language: {
    type: String,
    required: true
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: Date,
  segments: [transcriptSegmentSchema],
  status: {
    type: String,
    enum: ['recording', 'processing', 'completed', 'failed'],
    default: 'recording'
  },
  metadata: {
    totalDuration: Number, // in seconds
    studentSpeakingTime: Number,
    tutorSpeakingTime: Number,
    wordCount: Number
  }
}, {
  timestamps: true
});

// Index for efficient querying
lessonTranscriptSchema.index({ studentId: 1, createdAt: -1 });
lessonTranscriptSchema.index({ tutorId: 1, createdAt: -1 });

const LessonTranscript = mongoose.model('LessonTranscript', lessonTranscriptSchema);

module.exports = LessonTranscript;

