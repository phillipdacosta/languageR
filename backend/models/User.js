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
  picture: {
    type: String,
    default: null
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
  onboardingCompleted: {
    type: Boolean,
    default: false
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
      maxlength: 500,
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
    completedAt: {
      type: Date,
      default: Date.now
    }
  },
  profile: {
    bio: {
      type: String,
      maxlength: 500,
      default: ''
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    preferredLanguage: {
      type: String,
      default: 'en'
    }
  },
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