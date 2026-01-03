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
    proficiencyLevel: {
      type: String,
      enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
      required: true
    },
    confidence: {
      type: Number,
      min: 0,
      max: 100,
      required: true
    },
    summary: {
      type: String,
      required: true
    },
    progressFromLastLesson: String // e.g., "Improved from A2 to B1"
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
    practiceNeeded: String
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
    teachingPriority: String
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
  
  // Student Feedback (shown at end of lesson)
  studentSummary: {
    type: String,
    required: true
  },
  
  // Tutor Notes
  tutorNotes: String,
  
  // AI Processing
  aiModel: {
    type: String,
    default: 'gpt-4'
  },
  processingTime: Number, // milliseconds
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
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
  }
  
}, {
  timestamps: true
});

// Indexes for efficient querying
lessonAnalysisSchema.index({ studentId: 1, lessonDate: -1 });
lessonAnalysisSchema.index({ tutorId: 1, lessonDate: -1 });
lessonAnalysisSchema.index({ studentId: 1, tutorId: 1, lessonDate: -1 });

const LessonAnalysis = mongoose.model('LessonAnalysis', lessonAnalysisSchema);

module.exports = LessonAnalysis;

