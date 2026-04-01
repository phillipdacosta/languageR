const mongoose = require('mongoose');

const BundlePurchaseSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  bundleId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentBundle', required: true },
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'usd' },
  stripePaymentIntentId: { type: String },
  status: {
    type: String,
    enum: ['completed', 'refunded'],
    default: 'completed'
  },
  refundedAt: { type: Date },
  refundReason: { type: String }
}, { timestamps: true });

BundlePurchaseSchema.index({ studentId: 1, bundleId: 1 }, { unique: true });
BundlePurchaseSchema.index({ tutorId: 1 });

module.exports = mongoose.model('BundlePurchase', BundlePurchaseSchema);
