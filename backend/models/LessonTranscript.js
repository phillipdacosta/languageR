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
  },
  // Audio data for GPT-4 pronunciation assessment
  audioBase64: {
    type: String,
    required: false  // DEPRECATED - use audioGcsPath instead
  },
  audioGcsPath: {
    type: String,
    required: false  // GCS path (e.g., gs://bucket/lessons/id/segment-0.webm)
  },
  audioMimeType: {
    type: String,
    required: false
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
  
  // Pronunciation assessment segments (from Azure Speech)
  pronunciationSegments: [{
    timestamp: Date,
    accuracyScore: Number,
    fluencyScore: Number,
    prosodyScore: Number,
    pronunciationScore: Number,
    completenessScore: Number,
    words: [{
      word: String,
      accuracyScore: Number,
      errorType: String,
      phonemes: [{
        phoneme: String,
        accuracyScore: Number
      }]
    }]
  }],
  
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
  },
  
  // Audio backup tracking (for transcription retry)
  audioChunks: [{
    chunkIndex: Number,
    gcsPath: String,           // gs://bucket/path/chunk-0.webm
    uploadedAt: Date,
    sizeBytes: Number,
    speaker: String,           // 'student' or 'tutor'
    transcribed: {
      type: Boolean,
      default: false
    },
    transcriptionAttempts: {
      type: Number,
      default: 0
    },
    lastTranscriptionAttempt: Date,
    deleteAt: Date             // Auto-delete timestamp (48 hours after upload)
  }],
  
  fullText: String  // Concatenated transcript text (used by analysis)
}, {
  timestamps: true
});

// Add fullText virtual or field if needed by existing code
lessonTranscriptSchema.virtual('fullTextComputed').get(function() {
  return this.segments.map(s => s.text).join(' ');
});

// Index for efficient querying
lessonTranscriptSchema.index({ studentId: 1, createdAt: -1 });
lessonTranscriptSchema.index({ tutorId: 1, createdAt: -1 });
lessonTranscriptSchema.index({ 'audioChunks.deleteAt': 1 }); // For cleanup cron

const LessonTranscript = mongoose.model('LessonTranscript', lessonTranscriptSchema);

module.exports = LessonTranscript;

