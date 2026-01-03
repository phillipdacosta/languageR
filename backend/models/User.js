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
    default: ''
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
    // Tutor-specific fields
    experience: {
      type: String,
      trim: true
    },
    schedule: {
      type: String,
      trim: true
    },
    bio: {
      type: String,
      maxlength: 1000,
      default: ''
    },
    hourlyRate: {
      type: Number,
      default: 25
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
      default: false,
      comment: 'Privacy setting: show or hide wallet balance (default hidden)'
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
    }
  },
  // Native language for providing feedback in the user's language
  nativeLanguage: {
    type: String,
    default: 'en',
    trim: true,
    comment: 'ISO 639-1 language code of student\'s native language for analysis feedback'
  },
  // Interface language preference for the app UI
  interfaceLanguage: {
    type: String,
    enum: ['en', 'es', 'fr', 'pt', 'de'],
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
    default: null,
    unique: true,
    sparse: true,
    index: true,
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
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
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