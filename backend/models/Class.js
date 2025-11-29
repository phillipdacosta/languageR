const mongoose = require('mongoose');

const ClassSchema = new mongoose.Schema({
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  description: { type: String }, // Topic/focus of the class
  capacity: { type: Number, default: 1 },
  minStudents: { type: Number, default: 1 }, // Minimum students required for class to run
  flexibleMinimum: { type: Boolean, default: false }, // If true, class runs even if minStudents not met
  level: { type: String, enum: ['any', 'beginner', 'intermediate', 'advanced'], default: 'any' }, // Class level
  duration: { type: Number, default: 60 }, // Duration in minutes (25, 30, 45, or 60)
  isPublic: { type: Boolean, default: false },
  thumbnail: { type: String }, // URL to the class thumbnail image (required for public classes)
  price: { type: Number, default: 0 }, // Price per student for the class
  useSuggestedPricing: { type: Boolean, default: true }, // Whether tutor is using platform-suggested pricing
  suggestedPrice: { type: Number, default: 0 }, // Platform-calculated suggested price per student
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  recurrence: {
    type: { type: String, enum: ['none', 'daily', 'weekly', 'monthly'], default: 'none' },
    count: { type: Number, default: 1 }
  },
  invitedStudents: [{
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
    invitedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date }
  }],
  confirmedStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Students who accepted
  whiteboardRoomUUID: {
    type: String,
    default: null
  },
  whiteboardCreatedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('Class', ClassSchema);


