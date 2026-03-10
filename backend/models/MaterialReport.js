const mongoose = require('mongoose');

const MaterialReportSchema = new mongoose.Schema({
  materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'TutorMaterial', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: {
    type: String,
    enum: ['video_unavailable', 'audio_unavailable', 'content_missing', 'incorrect_content', 'copyright_infringement', 'other'],
    required: true
  },
  copyrightDetails: {
    originalContentUrl: { type: String },
    ownerName: { type: String },
    ownerContact: { type: String }
  },
  details: { type: String, maxlength: 1000 },
  status: {
    type: String,
    enum: ['open', 'under_review', 'resolved', 'dismissed'],
    default: 'open'
  },
  purchaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'MaterialPurchase' },
  hasPurchased: { type: Boolean, default: false },
  hasCompletedQuiz: { type: Boolean, default: false },
  resolution: { type: String },
  resolvedAt: { type: Date },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  refundIssued: { type: Boolean, default: false },
  refundAmount: { type: Number }
}, { timestamps: true });

MaterialReportSchema.index({ materialId: 1, studentId: 1 });
MaterialReportSchema.index({ status: 1 });
MaterialReportSchema.index({ tutorId: 1 });

module.exports = mongoose.model('MaterialReport', MaterialReportSchema);
