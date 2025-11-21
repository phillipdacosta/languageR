const mongoose = require('mongoose');

const ClassSchema = new mongoose.Schema({
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  description: { type: String }, // Topic/focus of the class
  capacity: { type: Number, default: 1 },
  isPublic: { type: Boolean, default: false },
  price: { type: Number, default: 0 }, // Price for the class (if applicable)
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
  confirmedStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] // Students who accepted
}, { timestamps: true });

module.exports = mongoose.model('Class', ClassSchema);


