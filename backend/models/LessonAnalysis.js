const mongoose = require('mongoose');

const grammarMistakeSchema = new mongoose.Schema({
  type: String, // e.g., "verb conjugation", "article usage"
  examples: [String],
  frequency: Number,
  severity: {
    type: String,
    enum: ['low', 'medium', 'high'] // Changed to match GPT-4 output
  }
});

const lessonAnalysisSchema = new mongoose.Schema({
  lessonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lesson',
    required: true,
    unique: true,
    index: true
  },
  transcriptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LessonTranscript',
    required: false  // Made optional - tutor notes can be added before transcript is created
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
  lessonDate: {
    type: Date,
    required: true,
    index: true
  },
  
  // Overall Assessment
  overallAssessment: {
    // Nullable: a CEFR level is only asserted when the lesson had enough
    // genuine target-language student speech to justify one (see the grading
    // gate in routes/transcription.js -> analyzeLesson). Recap-only lessons
    // store null here, which the CEFR estimator already excludes from accrual.
    proficiencyLevel: {
      type: String,
      enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', null],
      default: null
    },
    confidence: {
      type: Number,
      min: 0,
      max: 100
    },
    summary: {
      type: String
    },
    progressFromLastLesson: String // e.g., "Improved from A2 to B1"
  },

  // Whether a CEFR proficiency level was actually assessed this lesson. False
  // for recap-only lessons (too little genuine target-language speech to grade
  // honestly). Drives the post-lesson UI: a recap is always shown, a level is
  // only shown when proficiencyAssessed === true.
  proficiencyAssessed: {
    type: Boolean,
    default: true
  },

  // Why a grade was withheld, when proficiencyAssessed === false. Telemetry +
  // lets the UI show an honest, specific message.
  gradeWithheldReason: {
    type: String,
    enum: [
      'insufficient_target_language', // spoke too few words in the target language
      'insufficient_student_speech',  // barely spoke at all
      'no_capture',                   // audio capture failed / unavailable
      null
    ],
    default: null
  },

  // Evidence the grading gate was based on. Stored for transparency/debugging
  // and so thresholds can be retuned without re-deriving from raw transcripts.
  gradingEvidence: {
    studentTotalWords: { type: Number, default: null },
    studentTargetLanguageWords: { type: Number, default: null },
    targetLanguage: { type: String, default: null }
  },
  
  // Progression Metrics (NEW - for tracking improvement over time)
  progressionMetrics: {
    previousProficiencyLevel: String, // Previous lesson's level
    proficiencyChange: {
      type: String,
      enum: ['improved', 'maintained', 'declined', 'first_lesson']
    },
    errorRate: Number, // Errors per minute of speaking
    errorRateChange: Number, // Change from last lesson (+/- percentage)
    vocabularyGrowth: Number, // New unique words used vs last lesson
    fluencyImprovement: Number, // Change in fluency score (-100 to +100)
    grammarAccuracyChange: Number, // Change in grammar accuracy score
    confidenceLevel: {
      type: Number,
      min: 1,
      max: 10
    },
    speakingTimeMinutes: Number, // Total student speaking time
    complexSentencesUsed: Number, // Count of complex sentence structures
    keyImprovements: [String], // Specific areas that improved
    persistentChallenges: [String] // Recurring issues from previous lessons
  },
  
  // Strengths & Weaknesses
  strengths: [String],
  areasForImprovement: [String],
  
  // Error Patterns (Detailed error tracking)
  errorPatterns: [{
    pattern: String, // e.g., "Pronoun Agreement Errors"
    frequency: Number,
    severity: {
      type: String,
      enum: ['low', 'medium', 'high']
    },
    examples: [{
      original: String, // Exact quote from transcript
      corrected: String,
      explanation: String
    }],
    practiceNeeded: String,
    // Same canonicalization as topErrors.skillId.
    skillId: { type: String, default: null },
    skillIdConfidence: { type: String, default: null }
  }],
  
  // Top Errors (Most critical issues to address)
  topErrors: [{
    rank: Number,
    issue: String,
    impact: {
      type: String,
      enum: ['low', 'medium', 'high']
    },
    occurrences: Number,
    teachingPriority: String,
    // Canonical skill id from the taxonomy. Stamped at analyze-time by
    // aiService (post-processing the GPT output). Legacy lessons without
    // this field are canonicalized on read by the struggleAggregator.
    skillId: { type: String, default: null },
    // Confidence of the canonicalization — 'exact' | 'token' | 'fallback'.
    // Used to flag low-confidence mappings for taxonomy curation.
    skillIdConfidence: { type: String, default: null },
    // Whether GPT itself flagged this as likely-noise from ASR. Carried
    // forward so the priority scorer can down-weight it without losing
    // the underlying signal entirely.
    isLikelyTranscriptionError: { type: Boolean, default: false }
  }],
  
  // Corrected Excerpts (Before/after examples)
  correctedExcerpts: [{
    context: String, // What the student was talking about
    original: String, // Exact quote from student
    corrected: String, // Corrected version
    keyCorrections: [String] // List of specific changes
  }],
  
  // Grammar Analysis
  grammarAnalysis: {
    mistakeTypes: [grammarMistakeSchema],
    suggestions: [String],
    accuracyScore: {
      type: Number,
      min: 0,
      max: 100
    }
  },
  
  // Vocabulary Analysis
  vocabularyAnalysis: {
    wordsUsed: [String],
    uniqueWordCount: Number,
    vocabularyRange: {
      type: String,
      enum: ['limited', 'moderate', 'good', 'excellent']
    },
    suggestedWords: [String],
    advancedWordsUsed: [String]
  },
  
  // Fluency & Pronunciation
  fluencyAnalysis: {
    speakingSpeed: String, // "too slow", "natural", "too fast"
    pauseFrequency: String,
    fillerWords: {
      count: Number,
      examples: [String]
    },
    overallFluencyScore: {
      type: Number,
      min: 0,
      max: 100
    }
  },
  
  // Pronunciation Assessment (Azure Speech)
  pronunciationAnalysis: {
    overallScore: { type: Number, min: 0, max: 100 },
    accuracyScore: { type: Number, min: 0, max: 100 },
    fluencyScore: { type: Number, min: 0, max: 100 },
    prosodyScore: { type: Number, min: 0, max: 100 },
    completenessScore: { type: Number, min: 0, max: 100 },
    
    // Words that need practice
    mispronunciations: [{
      word: String,
      score: Number,
      errorType: String,
      problematicPhonemes: [String]
    }],
    
    // Stats
    segmentsAssessed: Number,
    totalSegments: Number,
    targetLanguageSegments: Number,
    samplingRate: Number
  },
  
  // Topics & Conversation
  topicsDiscussed: [String],
  conversationQuality: {
    type: String,
    enum: ['basic', 'intermediate', 'advanced', 'excellent', 'native-like']
  },
  
  // Recommendations
  recommendedFocus: [String],
  suggestedExercises: [String],
  homeworkSuggestions: [String],
  
  // Student Feedback (shown at end of lesson). Always present — even recap-only
  // lessons produce an encouraging summary of what was practiced.
  studentSummary: {
    type: String
  },
  
  // Tutor Notes
  tutorNotes: String,
  
  // Analysis source tracking
  source: {
    type: String,
    enum: ['ai', 'tutor'],
    default: 'ai',
    index: true
  },

  // Bias-adjusted CEFR level. For source: 'tutor' this is shifted down
  // by ~0.5 levels (configurable in cefrEstimatorService) to correct for
  // documented tutor inflation. For source: 'ai' this equals the raw level.
  // Stored at write time so the aggregator can change formula without
  // mutating historical analyses. See docs/learning-journey/cefr-estimation.md.
  biasAdjustedLevel: {
    type: String,
    enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', null],
    default: null
  },
  biasAdjustedNumeric: { type: Number, default: null, min: 0.5, max: 6 },
  
  // AI Processing
  aiModel: {
    type: String,
    default: 'gpt-4o-mini'
  },
  processingTime: Number, // milliseconds
  // 'completed' covers both fully-graded lessons and recap-only lessons; the
  // difference is proficiencyAssessed + a null overallAssessment.proficiencyLevel.
  // Keeping recap-only as 'completed' means the post-lesson screen still shows
  // the recap (the state machine treats 'completed' as "ready").
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'insufficient_data'],
    default: 'pending'
  },
  error: String,
  
  // Retry Tracking (for GPT-4 outages)
  retryAttempts: {
    type: Number,
    default: 0
  },
  lastRetryAttempt: Date,
  canRetry: {
    type: Boolean,
    default: true
  },
  
  // Tutor's supplementary note (added immediately after lesson)
  tutorNote: {
    text: String,              // Rich text from Quill editor
    quickImpression: String,   // Tag: '⭐ Excellent', '✅ Good Progress', etc.
    homework: String,          // Homework suggestion
    addedAt: Date,
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // Cached translations of prose fields, keyed by language code
  translations: {
    type: Map,
    of: {
      translatedAt: Date,
      summary: String,
      progressFromLastLesson: String,
      studentSummary: String,
      tutorNoteText: String,
      tutorNoteQuickImpression: String,
      tutorNoteHomework: String,
      strengths: [String],
      areasForImprovement: [String],
      recommendedFocus: [String],
      suggestedExercises: [String],
      homeworkSuggestions: [String],
      topErrors: [{
        issue: String,
        teachingPriority: String
      }],
      correctedExcerpts: [{
        context: String,
        keyCorrections: [String]
      }],
      persistentChallenges: [String],
      keyImprovements: [String]
    },
    default: {}
  }
  
}, {
  timestamps: true
});

// Pre-save hook: stamp biasAdjustedLevel from the raw proficiency level.
// AI sources pass through unchanged; tutor sources get a downward shift to
// correct for documented tutor inflation. Stored at write time so the
// aggregator can change formula later without mutating historical docs.
// See backend/services/cefrEstimatorService.js + docs/learning-journey/cefr-estimation.md.
lessonAnalysisSchema.pre('save', function setBiasAdjusted(next) {
  try {
    const raw = this.overallAssessment?.proficiencyLevel;
    if (!raw) return next();
    const cefrEstimator = require('../services/cefrEstimatorService');
    const adj = cefrEstimator.computeBiasAdjusted({
      overallAssessment: { proficiencyLevel: raw },
      source: this.source
    });
    this.biasAdjustedLevel = adj.level;
    this.biasAdjustedNumeric = adj.numeric;
  } catch (err) {
    console.warn('[LessonAnalysis] biasAdjusted stamp failed (non-blocking):', err.message);
  }
  next();
});

// Indexes for efficient querying
lessonAnalysisSchema.index({ studentId: 1, lessonDate: -1 });
lessonAnalysisSchema.index({ tutorId: 1, lessonDate: -1 });
lessonAnalysisSchema.index({ studentId: 1, tutorId: 1, lessonDate: -1 });

const LessonAnalysis = mongoose.model('LessonAnalysis', lessonAnalysisSchema);

module.exports = LessonAnalysis;

