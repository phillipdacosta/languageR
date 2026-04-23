const mongoose = require('mongoose');

const savedMaterialSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  materialId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TutorMaterial',
    required: true
  },
  sourceLessonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lesson',
    default: null
  },
  source: {
    type: String,
    enum: ['recommendation', 'explore', 'manual'],
    default: 'manual'
  },
  savedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

savedMaterialSchema.index({ studentId: 1, materialId: 1 }, { unique: true });
savedMaterialSchema.index({ studentId: 1, savedAt: -1 });

module.exports = mongoose.model('SavedMaterial', savedMaterialSchema);
