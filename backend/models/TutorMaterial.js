const mongoose = require('mongoose');

const QuizQuestionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['multiple_choice', 'fill_blank', 'true_false', 'ordering'],
    default: 'multiple_choice'
  },
  question: { type: String, required: true },
  options: [{
    text: { type: String, required: true },
    isCorrect: { type: Boolean, default: false }
  }],
  acceptedAnswers: [{ type: String }],
  correctAnswer: { type: Boolean },
  correctOrder: [{ type: String }],
  explanation: { type: String }
}, { _id: true });

const TutorMaterialSchema = new mongoose.Schema({
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: { type: String },
  language: { type: String, required: true },
  level: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced', 'any'],
    default: 'any'
  },

  materialType: {
    type: String,
    enum: ['video_quiz', 'reading', 'listening'],
    required: true,
    default: 'video_quiz'
  },

  // ── Video Quiz fields ──────────────────────────────────
  videoUrl: { type: String },
  videoProvider: {
    type: String,
    enum: ['youtube', 'vimeo']
  },
  videoEmbedUrl: { type: String },
  thumbnailUrl: { type: String },

  // ── Reading Comprehension fields ───────────────────────
  passage: { type: String },

  // ── Listening Exercise fields ──────────────────────────
  audioUrl: { type: String },
  audioProvider: {
    type: String,
    enum: ['soundcloud', 'spotify', 'direct']
  },
  audioEmbedUrl: { type: String },

  // ── Topic tags for recommendation matching ───────────
  topics: [{ type: String, trim: true, lowercase: true }],

  // ── Structured taxonomy tags (language-agnostic IDs from ContentTag) ──
  structuredTags: [{ type: String, trim: true, lowercase: true }],

  // ── Tutor pitch (shown to students before purchase) ───
  whyTakeThis: { type: String, maxlength: 100 },

  // ── Shared ─────────────────────────────────────────────
  pricingType: {
    type: String,
    enum: ['free', 'paid'],
    default: 'free'
  },
  price: { type: Number, default: 0 },

  quiz: [QuizQuestionSchema],

  status: {
    type: String,
    enum: ['draft', 'published', 'archived', 'deleted'],
    default: 'draft'
  },

  stats: {
    views: { type: Number, default: 0 },
    referralViews: { type: Number, default: 0 },
    quizAttempts: { type: Number, default: 0 },
    purchases: { type: Number, default: 0 },
    averageScore: { type: Number, default: 0 }
  },

  mediaUnavailable: { type: Boolean, default: false },
  mediaUnavailableSince: { type: Date },

  // Content ownership attestation
  contentAttested: { type: Boolean, default: false },
  contentAttestedAt: { type: Date },

  // Review status for content verification
  reviewStatus: {
    type: String,
    enum: ['auto_approved', 'pending_review', 'approved', 'rejected'],
    default: 'auto_approved'
  },
  reviewNote: { type: String },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  channelVerified: { type: Boolean, default: false },

  visibility: {
    type: String,
    enum: ['private', 'public', 'past_students'],
    default: 'private'
  },
  sharedStudentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  revokedStudentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

TutorMaterialSchema.index({ tutorId: 1, status: 1 });
TutorMaterialSchema.index({ language: 1, level: 1, status: 1 });
TutorMaterialSchema.index({ materialType: 1, status: 1 });
TutorMaterialSchema.index({ structuredTags: 1, status: 1 });

module.exports = mongoose.model('TutorMaterial', TutorMaterialSchema);
