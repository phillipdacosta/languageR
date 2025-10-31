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
    enum: ['scheduled', 'in_progress', 'completed', 'cancelled'], 
    default: 'scheduled' 
  },
  subject: {
    type: String,
    default: 'Language Lesson'
  },
  notes: String,
  price: {
    type: Number,
    required: true
  },
  duration: {
    type: Number, // in minutes
    required: true,
    default: 60
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