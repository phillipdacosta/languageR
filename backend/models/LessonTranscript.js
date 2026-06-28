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
  // The language Whisper actually detected for this chunk, normalized to an
  // ISO-639-1 code (e.g. 'de', 'en'). `language` above is the lesson's TARGET
  // language and is the same for every segment; `detectedLanguage` is what was
  // really spoken, so grading can require genuine target-language speech and
  // skip segments the student spoke in their native language. Null on legacy
  // segments recorded before this field existed.
  detectedLanguage: {
    type: String,
    default: null
  },
  // Duration of this segment in seconds (from Whisper seg.end - seg.start)
  duration: {
    type: Number,
    default: 0
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
  },
  noSpeechProb: {
    type: Number,
    min: 0,
    max: 1,
    default: null
  },
  // True when this student-tagged segment overlaps a tutor speech interval
  // (mic bleed). Excluded segments are kept for debugging but skipped by
  // the analysis step.
  excludedByTutorOverlap: {
    type: Boolean,
    default: false
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
  
  // Audio energy metrics from FFmpeg VAD (per audio chunk upload)
  audioEnergyMetrics: [{
    chunkIndex: Number,
    rmsLevelDb: Number,
    peakLevelDb: Number,
    silenceRatio: Number,
    durationSeconds: Number,
    hasSpeech: Boolean,
    analyzedAt: { type: Date, default: Date.now }
  }],

  // Tutor speech intervals (in batch-time seconds, aligned to the concatenated
  // student audio batch). Used to filter out student segments that overlap
  // tutor speech captured from the Agora remote audio track — solves the
  // microphone bleed problem where the tutor's voice comes through the
  // student's speakers and gets re-recorded by the student's mic.
  tutorSpeechIntervals: [{
    startSec: Number,
    endSec: Number
  }],
  tutorReferenceMeta: {
    durationSeconds: Number,
    rmsLevelDb: Number,
    silenceRatio: Number,
    processedAt: Date,
    sizeBytes: Number,
    // GCS path + mime of the tutor's clean remote-track audio. Stored at upload
    // time so the (async, server-side) analysis step can transcribe it for
    // dual-track diarization without blocking the client upload request.
    gcsPath: { type: String, default: null },
    mimeType: { type: String, default: null }
  },

  // Per-sampling-window tutor reference clips. The lesson records the tutor's
  // clean Agora remote track in 3 separate windows; each is stored as its own
  // GCS file here (the legacy single `tutorReferenceMeta.gcsPath` overwrote
  // windows 1 & 2, losing most tutor speech). `windowStartSec` is the elapsed
  // lesson time at which the window began, so analysis can offset this clip's
  // transcript + VAD intervals onto the lesson timeline.
  tutorReferenceSegments: [{
    windowIndex: Number,
    windowStartSec: Number,
    gcsPath: String,
    mimeType: String,
    durationSeconds: Number,
    rmsLevelDb: Number,
    silenceRatio: Number,
    sizeBytes: Number,
    processedAt: { type: Date, default: Date.now }
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

