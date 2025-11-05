const mongoose = require('mongoose');

const ClassSchema = new mongoose.Schema({
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  capacity: { type: Number, default: 1 },
  isPublic: { type: Boolean, default: false },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  recurrence: {
    type: { type: String, enum: ['none', 'daily', 'weekly', 'monthly'], default: 'none' },
    count: { type: Number, default: 1 }
  }
}, { timestamps: true });

module.exports = mongoose.model('Class', ClassSchema);


