const mongoose = require('mongoose');

const grammarMistakeSchema = new mongoose.Schema({
  type: String, // e.g., "verb conjugation", "article usage"
  examples: [String],
  frequency: Number,
  severity: {
    type: String,
    enum: ['minor', 'moderate', 'major']
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
    required: true
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
  
  // Strengths & Weaknesses
  strengths: [String],
  areasForImprovement: [String],
  
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
  
  // Topics & Conversation
  topicsDiscussed: [String],
  conversationQuality: {
    type: String,
    enum: ['basic', 'intermediate', 'advanced', 'excellent']
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
  error: String
  
}, {
  timestamps: true
});

// Indexes for efficient querying
lessonAnalysisSchema.index({ studentId: 1, lessonDate: -1 });
lessonAnalysisSchema.index({ tutorId: 1, lessonDate: -1 });
lessonAnalysisSchema.index({ studentId: 1, tutorId: 1, lessonDate: -1 });

const LessonAnalysis = mongoose.model('LessonAnalysis', lessonAnalysisSchema);

module.exports = LessonAnalysis;

