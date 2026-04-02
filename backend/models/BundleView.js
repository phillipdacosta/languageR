const mongoose = require('mongoose');

const BundleViewSchema = new mongoose.Schema({
  bundleId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentBundle', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

BundleViewSchema.index({ bundleId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('BundleView', BundleViewSchema);
