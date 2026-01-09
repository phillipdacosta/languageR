const mongoose = require('mongoose');

const LessonSchema = new mongoose.Schema({
  tutorId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  studentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  startTime: { 
    type: Date, 
    required: true 
  },
  endTime: { 
    type: Date, 
    required: true 
  },
  channelName: { 
    type: String, 
    required: true,
    unique: true 
  },
  status: { 
    type: String, 
    enum: ['scheduled', 'confirmed', 'in_progress', 'ended_early', 'completed', 'cancelled', 'pending_reschedule'], 
    default: 'scheduled' 
  },
  // Cancellation tracking
  cancelledBy: {
    type: String,
    enum: ['tutor', 'student', 'system', 'admin', null],
    default: null
  },
  cancelReason: {
    type: String,
    default: null
  },
  cancelledAt: {
    type: Date,
    default: null
  },
  cancellationFeeCharged: {
    type: Number,
    default: 0,
    comment: 'Amount charged as cancellation fee (if applicable)'
  },
  subject: {
    type: String,
    default: 'Language Lesson'
  },
  description: String, // Detailed description of the lesson
  notes: String, // Private notes for the tutor
  price: {
    type: Number,
    required: true
  },
  duration: {
    type: Number, // in minutes
    required: true,
    default: 60
  },
  // Flag to indicate if this is a trial lesson (first lesson with a tutor)
  isTrialLesson: {
    type: Boolean,
    default: false
  },
  // Office Hours flags
  isOfficeHours: {
    type: Boolean,
    default: false
  },
  officeHoursType: {
    type: String,
    enum: ['quick', 'scheduled', null],
    default: null
  },
  bookingType: {
    type: String,
    enum: ['scheduled', 'instant', 'office_hours'],
    default: 'scheduled'
  },
  // Attendance tracking (who showed up)
  tutorJoinedAt: {
    type: Date,
    default: null,
    comment: 'When tutor first joined the call'
  },
  studentJoinedAt: {
    type: Date,
    default: null,
    comment: 'When student first joined the call'
  },
  // Per-minute billing tracking (for office hours)
  actualCallStartTime: {
    type: Date,
    default: null,
    comment: 'When BOTH tutor and student were present (lesson actually started)'
  },
  actualCallEndTime: {
    type: Date,
    default: null
  },
  actualDurationMinutes: {
    type: Number,
    default: null
  },
  actualPrice: {
    type: Number,
    default: null
  },
  billingStatus: {
    type: String,
    enum: ['pending', 'authorized', 'charged', 'refunded', 'partially_refunded', 'no_show', null],
    default: null,
    index: true
  },
  // Payment Integration
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    index: true,
    comment: 'Link to Payment record for this lesson'
  },
  paymentMethod: {
    type: String,
    enum: ['wallet', 'card', 'saved-card', 'apple_pay', 'google_pay', null],
    default: null,
    comment: 'How the student paid for this lesson'
  },
  // Platform Revenue Recognition (deferred until lesson completion)
  revenueRecognized: {
    type: Boolean,
    default: false,
    index: true,
    comment: 'Whether platform fee has been recognized as revenue'
  },
  revenueRecognizedAt: {
    type: Date,
    default: null
  },
  platformFee: {
    type: Number,
    default: 0,
    comment: 'Platform fee amount (15% of lesson price)'
  },
  tutorPayout: {
    type: Number,
    default: 0,
    comment: 'Amount paid to tutor (lesson price - platform fee)'
  },
  // Tip tracking
  tip: {
    amount: {
      type: Number,
      default: null
    },
    stripeFee: {
      type: Number,
      default: null
    },
    tutorReceived: {
      type: Number,
      default: null
    },
    paymentIntentId: {
      type: String,
      default: null
    },
    paidAt: {
      type: Date,
      default: null
    }
  },
  // Track participant join/leave history for rejoin logic
  participants: {
    type: Map,
    of: new mongoose.Schema({
      joinedAt: { type: Date },
      leftAt: { type: Date },
      joinCount: { type: Number, default: 0 }
    }, { _id: false }),
    default: undefined
  },
  // Store booking details from checkout
  bookingData: {
    selectedDate: String,
    selectedTime: String,
    timeRange: String
  },
  // Reschedule proposal tracking
  rescheduleProposal: {
    proposedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User'
    },
    proposedStartTime: Date,
    proposedEndTime: Date,
    proposedAt: Date,
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending'
    }
  },
  // Manual feedback tracking (when AI analysis is disabled)
  requiresTutorFeedback: {
    type: Boolean,
    default: false
  },
  // Agora Interactive Whiteboard room info
  whiteboardRoomUUID: {
    type: String,
    default: null
  },
  whiteboardCreatedAt: {
    type: Date,
    default: null
  },
  // AI Analysis (generated after lesson ends)
  aiAnalysis: {
    summary: {
      type: String,
      default: null
    },
    strengths: [{
      type: String
    }],
    areasForImprovement: [{
      type: String
    }],
    recommendations: [{
      type: String
    }],
    generatedAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: ['pending', 'generating', 'completed', 'failed', null],
      default: null
    }
  }
}, { 
  timestamps: true 
});

// Index for efficient queries
LessonSchema.index({ tutorId: 1, startTime: 1 });
LessonSchema.index({ studentId: 1, startTime: 1 });
LessonSchema.index({ startTime: 1, status: 1 });

// Generate unique channel name
LessonSchema.pre('save', function(next) {
  if (!this.channelName) {
    this.channelName = `lesson_${this._id.toString()}`;
  }
  next();
});

module.exports = mongoose.model('Lesson', LessonSchema);