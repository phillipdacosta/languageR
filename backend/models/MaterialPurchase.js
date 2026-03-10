const mongoose = require('mongoose');

const MaterialPurchaseSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'TutorMaterial', required: true },
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

MaterialPurchaseSchema.index({ studentId: 1, materialId: 1 }, { unique: true });
MaterialPurchaseSchema.index({ tutorId: 1 });
MaterialPurchaseSchema.index({ materialId: 1 });

module.exports = mongoose.model('MaterialPurchase', MaterialPurchaseSchema);
