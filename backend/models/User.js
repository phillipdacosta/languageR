const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  auth0Id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  firstName: {
    type: String,
    trim: true,
    default: ''
  },
  lastName: {
    type: String,
    trim: true,
    default: ''
  },
  country: {
    type: String,
    trim: true,
    default: '',
    comment: 'Country of origin (nationality) - "Where are you from?"'
  },
  residenceCountry: {
    type: String,
    trim: true,
    default: '',
    comment: 'Country of residence (where they live/have bank account) - used for payout method selection'
  },
  picture: {
    type: String,
    default: null
  },
  auth0Picture: {
    type: String,
    default: null  // Store original Auth0/Google picture to restore later
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  userType: {
    type: String,
    enum: ['student', 'tutor'],
    required: true,
    default: 'student'
  },
  isAdmin: {
    type: Boolean,
    default: false,
    index: true
  },
  onboardingCompleted: {
    type: Boolean,
    default: false
  },
  // Tutor-specific onboarding tracking
  tutorOnboarding: {
    photoUploaded: {
      type: Boolean,
      default: false
    },
    videoUploaded: {
      type: Boolean,
      default: false
    },
    videoApproved: {
      type: Boolean,
      default: false
    },
    videoRejected: {
      type: Boolean,
      default: false
    },
    videoRejectionReason: {
      type: String,
      default: null
    },
    stripeConnected: {
      type: Boolean,
      default: false
    },
    completedAt: {
      type: Date,
      default: null
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    approvedAt: {
      type: Date,
      default: null
    }
  },
  // Tutor credential verification documents
  tutorCredentials: {
    governmentId: {
      url: { type: String, default: null },
      fileName: { type: String, default: null },
      fileType: { type: String, default: null },
      uploadedAt: { type: Date, default: null },
      status: {
        type: String,
        enum: ['not_uploaded', 'pending', 'approved', 'rejected'],
        default: 'not_uploaded'
      },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt: { type: Date, default: null },
      rejectionReason: { type: String, default: null }
    },
    teachingCertifications: [{
      url: { type: String, required: true },
      fileName: { type: String, required: true },
      fileType: { type: String, default: null },
      certificationName: { type: String, default: '' },
      uploadedAt: { type: Date, default: Date.now },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt: { type: Date, default: null },
      rejectionReason: { type: String, default: null }
    }],
    additionalDocuments: [{
      url: { type: String, required: true },
      fileName: { type: String, required: true },
      fileType: { type: String, default: null },
      documentType: {
        type: String,
        enum: ['degree', 'resume', 'reference_letter', 'other'],
        default: 'other'
      },
      label: { type: String, default: '' },
      uploadedAt: { type: Date, default: Date.now },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt: { type: Date, default: null },
      rejectionReason: { type: String, default: null }
    }],
    higherEducation: {
      noDegree: { type: Boolean, default: false },
      entries: [{
        university: { type: String, default: '' },
        degree: { type: String, default: '' },
        degreeType: {
          type: String,
          enum: ['teaching', 'subject', 'other', ''],
          default: ''
        },
        startYear: { type: String, default: '' },
        endYear: { type: String, default: '' }
      }]
    }
  },
  // Whether tutor is approved and can show up in searches
  tutorApproved: {
    type: Boolean,
    default: false,
    index: true
  },
  onboardingData: {
    languages: [{
      type: String,
      trim: true
    }],
    goals: [{
      type: String,
      trim: true
    }],
    experienceLevel: {
      type: String,
      enum: ['Beginner', 'Intermediate', 'Advanced'],
      default: 'Beginner'
    },
    preferredSchedule: {
      type: String,
      trim: true
    },
    // Structured learning goal (student-only, powers the Learning Plan)
    learningGoal: {
      type: {
        type: String,
        enum: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation', 'other'],
        default: null
      },
      description: { type: String, default: '' },
      targetLevel: { type: String, default: '' },
      selfAssessedLevel: {
        type: String,
        enum: ['complete_beginner', 'some_basics', 'simple_conversations', 'intermediate', 'advanced', null],
        default: null
      },
      timeline: {
        type: String,
        enum: ['specific_date', 'few_months', 'no_rush', null],
        default: null
      },
      targetDate: { type: Date, default: null }
    },
    // Tutor-specific fields
    experience: {
      type: String,
      trim: true
    },
    schedule: {
      type: String,
      trim: true
    },
    summary: {
      type: String,
      maxlength: 150,
      trim: true,
      default: ''
    },
    bio: {
      type: String,
      maxlength: 1000,
      default: ''
    },
    hourlyRate: {
      type: Number,
      default: 25,
      min: [10, 'Minimum hourly rate is $10']
    },
    introductionVideo: {
      type: String,
      trim: true,
      default: ''
    },
    videoThumbnail: {
      type: String,
      trim: true,
      default: ''
    },
    videoType: {
      type: String,
      enum: ['upload', 'youtube', 'vimeo'],
      default: 'upload'
    },
    // Pending video fields (for videos under review)
    pendingVideo: {
      type: String,
      trim: true,
      default: ''
    },
    pendingVideoThumbnail: {
      type: String,
      trim: true,
      default: ''
    },
    pendingVideoType: {
      type: String,
      enum: ['upload', 'youtube', 'vimeo'],
      default: 'upload'
    },
    completedAt: {
      type: Date,
      default: Date.now
    }
  },
  profile: {
    bio: {
      type: String,
      maxlength: 1000,
      default: ''
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    preferredLanguage: {
      type: String,
      default: 'en'
    },
    officeHoursEnabled: {
      type: Boolean,
      default: false
    },
    officeHoursLastActive: {
      type: Date,
      default: null
    },
    showWalletBalance: {
      type: Boolean,
      default: true,
      comment: 'Privacy setting: show or hide wallet balance (default visible for new users)'
    },
    remindersEnabled: {
      type: Boolean,
      default: true,
      comment: 'Enable/disable lesson reminder notifications'
    },
    aiAnalysisEnabled: {
      type: Boolean,
      default: true,
      comment: 'Enable/disable AI analysis of lessons. When disabled, tutor must provide manual feedback.'
    },
    calendarTimeFormat: {
      type: String,
      enum: ['12h', '24h'],
      default: '12h',
      comment: 'Time display format on calendar (12-hour or 24-hour)'
    },
    calendarDefaultView: {
      type: String,
      enum: ['week', 'day'],
      default: 'week',
      comment: 'Default calendar view when opening availability setup'
    },
    calendarWeekStartsOn: {
      type: Number,
      enum: [0, 1, 2, 3, 4, 5, 6],
      default: 0,
      comment: 'First day of the calendar week (0=Sunday, 1=Monday, 6=Saturday)'
    },
    calendarWeekStartsOnUserSet: {
      type: Boolean,
      default: false,
      comment: 'True once the user manually picks week start in calendar settings'
    },
    weeklyEarningsGoal: {
      type: Number,
      default: 500,
      min: 0,
      comment: 'Tutor-configurable weekly earnings target in USD — used by the Home earnings widget progress bar'
    }
  },
  // Google Calendar integration
  googleCalendar: {
    connected: { type: Boolean, default: false },
    accessToken: { type: String, default: null, select: false },
    refreshToken: { type: String, default: null, select: false },
    tokenExpiry: { type: Date, default: null },
    calendarId: { type: String, default: 'primary', comment: 'Which Google Calendar to sync' },
    email: { type: String, default: null, comment: 'Google account email used for calendar' },
    syncEnabled: { type: Boolean, default: true, comment: 'Block availability when Google Calendar has events' },
    pushToGoogle: { type: Boolean, default: true, comment: 'Push booked lessons to Google Calendar' },
    lastSyncAt: { type: Date, default: null },
    watchChannelId: { type: String, default: null },
    watchResourceId: { type: String, default: null },
    watchExpiration: { type: Date, default: null },
    watchToken: { type: String, default: null },
    grantedScopes: { type: [String], default: [] }
  },
  // Native language for providing feedback in the user's language
  nativeLanguage: {
    type: String,
    default: 'en',
    trim: true,
    comment: 'ISO 639-1 language code of student\'s native language for analysis feedback'
  },
  // Additional languages the tutor speaks, each with a CEFR proficiency level
  spokenLanguages: {
    type: [
      {
        code: { type: String, required: true, trim: true },
        level: {
          type: String,
          enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
          required: true
        },
        _id: false
      }
    ],
    default: [],
    comment: 'Additional languages the tutor can speak with CEFR proficiency levels'
  },
  // Interface language preference for the app UI
  interfaceLanguage: {
    type: String,
    enum: ['en', 'es', 'fr', 'pt', 'de', 'it', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi', 'nl', 'pl', 'tr', 'sv', 'no', 'da', 'fi', 'el', 'cs', 'ro', 'uk', 'vi', 'th', 'id', 'ms', 'he', 'fa'],
    default: 'en',
    trim: true,
    comment: 'Preferred language for app interface (UI text)'
  },
  // Payment & Stripe Integration
  stripeCustomerId: {
    type: String,
    default: null,
    index: true,
    comment: 'Stripe Customer ID for students making payments'
  },
  stripeConnectAccountId: {
    type: String,
    default: undefined, // Use undefined instead of null for sparse index
    unique: true,
    sparse: true,
    comment: 'Stripe Connect Account ID for tutors receiving payouts'
  },
  stripeConnectOnboarded: {
    type: Boolean,
    default: false,
    comment: 'Whether tutor has completed Stripe Connect onboarding'
  },
  stripeConnectOnboardedAt: {
    type: Date,
    default: null
  },
  stripePayoutsEnabled: {
    type: Boolean,
    default: false,
    comment: 'Whether tutors Connect account has payouts enabled'
  },
  stripeIdentityVerified: {
    type: Boolean,
    default: false,
    comment: 'Whether Stripe has fully verified the tutor identity (charges_enabled + payouts_enabled + no outstanding requirements). When true, we skip Barnabi manual government-ID review.'
  },
  stripeAccountDisabled: {
    type: Boolean,
    default: false,
    comment: 'True when Stripe has flagged the Connect account as disabled / blocked (requirements.disabled_reason set, or past-due requirements present). Used to re-show the manual government-ID step as a fallback.'
  },
  // Tax classification for payout routing
  isUSPersonForTax: {
    type: Boolean,
    default: null,
    comment: 'Is the tutor a US Person for tax purposes? (US citizen, resident, green card holder). null = not yet answered'
  },
  hasUSBankAccount: {
    type: Boolean,
    default: null,
    comment: 'Does the tutor have a US bank account? Only relevant if isUSPersonForTax=true. null = not yet answered'
  },
  taxInfoCompletedAt: {
    type: Date,
    default: null,
    comment: 'When the tutor completed the tax classification questions'
  },
  // Payout method configuration
  payoutProvider: {
    type: String,
    enum: ['stripe', 'paypal', 'manual', 'none'],
    default: 'none',
    comment: 'Selected payout method: stripe (US Person + US bank), paypal (US Person w/o US bank OR non-US), manual (fallback), none (not set up)'
  },
  payoutDetails: {
    paypalEmail: {
      type: String,
      default: null,
      comment: 'PayPal email for PayPal payouts'
    },
    manualBankInfo: {
      type: String,
      default: null,
      comment: 'Bank account details for manual transfers (encrypted/secure storage recommended)'
    }
  },
  tosAcceptedAt: {
    type: Date,
    default: null,
    comment: 'When the tutor accepted the Terms of Service & Independent Contractor Agreement'
  },
  tosVersion: {
    type: String,
    default: null,
    comment: 'Version of the TOS the tutor accepted (e.g. "1.0")'
  },
  defaultPaymentMethod: {
    type: String,
    enum: ['wallet', 'card', null],
    default: null,
    comment: 'Student\'s preferred payment method'
  },
  savedPaymentMethods: [{
    stripePaymentMethodId: String,
    brand: String, // e.g., 'visa', 'mastercard'
    last4: String, // Last 4 digits
    expiryMonth: Number,
    expiryYear: Number,
    country: String, // Card country code (e.g., 'US', 'CA', 'GB')
    isDefault: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],
  stats: {
    totalLessons: {
      type: Number,
      default: 0
    },
    totalHours: {
      type: Number,
      default: 0
    },
    streak: {
      type: Number,
      default: 0
    },
    lastActive: {
      type: Date,
      default: Date.now
    },
    // Coaching badge metrics (for tutors)
    feedbackMetrics: {
      totalLessonsCompleted: { type: Number, default: 0 },
      totalFeedbackProvided: { type: Number, default: 0 },
      feedbackRate: { type: Number, default: 0 }, // Percentage (0-100)
      averageFeedbackQuality: { type: Number, default: 0 }, // Score (0-100)
      lastQualityUpdate: { type: Date, default: null },
      // Rolling window tracking (last 30 lessons)
      recentFeedback: [{
        lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' },
        providedAt: Date,
        qualityScore: Number, // 0-100
        wordCount: Number,
        hasHomework: Boolean,
        hasQuickImpression: Boolean
      }],
      // Badge status
      coachingBadge: {
        active: { type: Boolean, default: false },
        earnedAt: { type: Date, default: null },
        lastEvaluated: { type: Date, default: null },
        qualifyingStreak: { type: Number, default: 0 }
      },
      // How many times this tutor's profile was hidden because feedback
      // exceeded the 2-hour grace window. Used as a negative ranking
      // signal in tutor search (higher = deprioritized).
      feedbackGraceViolations: { type: Number, default: 0 }
    }
  },
  // Tutor earnings tracking (internal balance system)
  tutorEarnings: {
    // Available for withdrawal
    availableBalance: {
      type: Number,
      default: 0,
      min: 0,
      comment: 'Earnings available for immediate withdrawal'
    },
    // Lesson completed but funds on hold (1-hour dispute protection)
    pendingBalance: {
      type: Number,
      default: 0,
      min: 0,
      comment: 'Earnings from recently completed lessons (1-hour hold period)'
    },
    // Total earned lifetime
    lifetimeEarnings: {
      type: Number,
      default: 0,
      min: 0,
      comment: 'Total amount earned across all time'
    },
    // Last withdrawal date
    lastWithdrawal: {
      type: Date,
      default: null,
      comment: 'Date of last withdrawal request'
    },
    // Total withdrawn
    totalWithdrawn: {
      type: Number,
      default: 0,
      min: 0,
      comment: 'Total amount withdrawn to external accounts'
    }
  },
  // Withdrawal settings
  withdrawalSettings: {
    minimumAmount: {
      type: Number,
      default: 10,
      min: 5,
      comment: 'Minimum withdrawal amount (default $10)'
    },
    autoWithdraw: {
      type: Boolean,
      default: false,
      comment: 'Automatically withdraw when balance reaches threshold'
    },
    autoWithdrawThreshold: {
      type: Number,
      default: 100,
      comment: 'Balance threshold for auto-withdrawal (default $100)'
    }
  },
  // Tutor availability calendar
  availability: [{
    id: {
      type: String,
      required: true
    },
    // Optional absolute start/end for one-off blocks (e.g., classes)
    absoluteStart: {
      type: Date,
      required: false
    },
    absoluteEnd: {
      type: Date,
      required: false
    },
    startTime: {
      type: String,
      required: true
    },
    endTime: {
      type: String,
      required: true
    },
    day: {
      type: Number,
      required: true,
      min: 0,
      max: 6
    },
    type: {
      type: String,
      enum: ['available', 'unavailable', 'break', 'class'],
      default: 'available'
    },
    title: {
      type: String,
      default: 'Available'
    },
    color: {
      type: String,
      default: '#4A90E2'
    }
  }],
  lastAvailabilityUpdate: {
    type: Date,
    required: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },

  // Content channel linking (for material ownership verification)
  linkedChannels: {
    youtubeChannelId: { type: String, default: null },
    youtubeChannelUrl: { type: String, default: null, trim: true },
    youtubeChannelName: { type: String, default: null },
    youtubeChannelAvatar: { type: String, default: null },
    youtubeSubscriberCount: { type: String, default: null },
    youtubeVerified: { type: Boolean, default: false },
    youtubeAccessToken: { type: String, default: null, select: false },
    youtubeRefreshToken: { type: String, default: null, select: false },
    vimeoChannelId: { type: String, default: null },
    vimeoChannelUrl: { type: String, default: null, trim: true },
    vimeoChannelName: { type: String, default: null },
    vimeoChannelAvatar: { type: String, default: null },
    vimeoVerified: { type: Boolean, default: false },
    vimeoAccessToken: { type: String, default: null, select: false },
    soundcloudProfileUrl: { type: String, default: null, trim: true },
    soundcloudProfileName: { type: String, default: null },
    soundcloudProfileAvatar: { type: String, default: null }
  },

  // Branding & referral tracking
  materialReferralViews: { type: Number, default: 0 },
  isAmbassador: { type: Boolean, default: false },

  // Premium subscription (students). Tutors keep their own monetization (earnings).
  // Reads should always go through services/entitlementsService.js, never direct.
  subscription: {
    tier: {
      type: String,
      enum: ['free', 'premium'],
      default: 'free',
      index: true
    },
    status: {
      type: String,
      enum: ['active', 'past_due', 'canceled', 'trialing'],
      default: 'active'
    },
    source: {
      type: String,
      enum: ['stripe', 'apple_iap', 'google_iap', 'comp', null],
      default: null
    },
    externalId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    renewsAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
    trialEndsAt: { type: Date, default: null }
  },

  // Last "your teaching is sticking" notification timestamp per (other) student.
  // Keyed by studentId string; used to enforce 1 notification per tutor/student/week
  // (G22). See backend/services/tutorBriefingService.js.
  teachingStickingLastNotifiedAt: {
    type: Map,
    of: Date,
    default: () => new Map()
  },

  // Per-tutor CEFR bias calibration (Batch 12 follow-up). Set only on tutor
  // accounts. When a tutor has accumulated enough comparable data (their
  // CEFR estimates side-by-side with AI assessments on the same students),
  // we replace the global TUTOR_BIAS_OFFSET with their empirical mean delta.
  // Refreshed lazily via cefrEstimatorService.getTutorBiasOffset (cached
  // for TUTOR_BIAS_CACHE_TTL_MS) and persisted here so concurrent reads
  // hit the cache. See docs/learning-journey/cefr-estimation.md.
  tutorBias: {
    offset: { type: Number, default: null },     // CEFR levels (e.g. 0.7 means tutor grades 0.7 levels higher than AI)
    sampleSize: { type: Number, default: 0 },    // # of comparable AI/tutor pairs used to compute it
    computedAt: { type: Date, default: null },
    // Track confidence so the aggregator can fall back to global if low.
    confidence: { type: String, enum: ['low', 'medium', 'high', null], default: null }
  }
});

// Update the updatedAt field before saving
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Create indexes for better performance
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);