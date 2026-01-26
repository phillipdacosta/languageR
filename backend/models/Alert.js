const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: [
      'PAYMENT_OUT_OF_SYNC',
      'STUCK_AUTHORIZATION',
      'FAILED_CAPTURE',
      'FAILED_PAYOUT',
      'PAYMENT_DISPUTE',
      'UNEXPECTED_REFUND',
      'MISSING_PAYMENT',
      'WEBHOOK_FAILURE',
      'RECONCILIATION_MISMATCH'
    ]
  },
  severity: {
    type: String,
    required: true,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'MEDIUM'
  },
  status: {
    type: String,
    enum: ['active', 'investigating', 'resolved', 'ignored'],
    default: 'active'
  },
  
  // Related records
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Details
  title: { type: String, required: true },
  description: String,
  data: { type: mongoose.Schema.Types.Mixed }, // Flexible data storage
  
  // Stripe/PayPal references
  stripePaymentIntentId: String,
  stripePayoutId: String,
  paypalBatchId: String,
  
  // Resolution
  resolvedAt: Date,
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolutionNotes: String,
  
  // Notifications sent
  notificationsSent: [{
    channel: { type: String, enum: ['email', 'websocket', 'slack'] },
    sentAt: Date,
    recipient: String
  }]
}, {
  timestamps: true
});

// Index for quick queries
alertSchema.index({ status: 1, severity: 1, createdAt: -1 });
alertSchema.index({ type: 1, status: 1 });
alertSchema.index({ paymentId: 1 });
alertSchema.index({ lessonId: 1 });

module.exports = mongoose.model('Alert', alertSchema);

