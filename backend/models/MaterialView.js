const mongoose = require('mongoose');

const MaterialViewSchema = new mongoose.Schema({
  materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'TutorMaterial', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

MaterialViewSchema.index({ materialId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('MaterialView', MaterialViewSchema);
