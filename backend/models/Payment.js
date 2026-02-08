const mongoose = require('mongoose');

/**
 * Payment Model - Tracks all monetary transactions
 * 
 * Handles:
 * - Direct card/Apple Pay payments
 * - Wallet top-ups
 * - Wallet deductions
 * - Refunds (wallet or card)
 * - Platform fee tracking
 * - Stripe Connect payouts to tutors
 */

const paymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  tutorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  lessonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lesson',
    index: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  paymentMethod: {
    type: String,
    enum: ['wallet', 'card', 'saved-card', 'apple_pay', 'google_pay'],
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'authorized', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'cancelled'],
    default: 'pending',
    index: true
  },
  // Stripe Payment Intent data
  stripePaymentIntentId: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  stripeChargeId: String,
  stripeRefundId: String,
  receiptUrl: String, // Customer-facing receipt URL from Stripe
  stripeFee: {
    type: Number,
    default: 0
  }, // Stripe processing fee (platform absorbs)
  stripeNetAmount: Number, // Amount after Stripe fees
  
  // Platform revenue (recognized only after lesson completion)
  platformFee: {
    type: Number,
    default: 0
  },
  platformFeePercentage: {
    type: Number,
    default: 20 // 20% platform fee
  },
  tutorPayout: {
    type: Number,
    default: 0
  },
  
  // Stripe Connect Transfer (payout to tutor)
  stripeTransferId: String,
  stripeTransferAmount: Number,
  
  // Stripe Payout (for moving funds from platform to bank)
  stripePayoutId: String, // Payout ID for transferring funds to platform bank
  stripePayoutAmount: Number, // Amount being moved to bank
  stripePayoutStatus: {
    type: String,
    enum: ['pending', 'in_transit', 'paid', 'failed', 'canceled', null],
    default: null
  },
  stripePayoutCreatedAt: Date,
  stripePayoutArrivedAt: Date,
  
  // PayPal Payouts (alternative payout method)
  paypalBatchId: String,
  paypalPayoutItemId: String,
  paypalPayoutStatus: {
    type: String,
    enum: ['pending', 'processing', 'success', 'failed', null],
    default: null
  },
  
  // Transfer/Payout tracking (NEW SYSTEM - internal balance tracking)
  transferredAt: Date,
  transferStatus: {
    type: String,
    enum: [
      'pending',           // Awaiting lesson completion
      'on_hold',           // Lesson complete, 24hr hold period (NEW)
      'available',         // Available for withdrawal (NEW)
      'pending_withdrawal',// Included in withdrawal request (NEW)
      'withdrawn',         // Successfully withdrawn (NEW)
      'awaiting_funds',    // Legacy status
      'succeeded',         // Legacy status
      'failed',            // Failed transfer
      'acknowledged',      // Legacy status
      null
    ],
    default: null,
    index: true
  },
  
  // When earnings become available for withdrawal (lesson end + 24hrs)
  earningsReleaseDate: {
    type: Date,
    default: null,
    index: true,
    comment: 'When tutor earnings become available for withdrawal (24hr hold after lesson end for dispute protection)'
  },
  
  // Link to withdrawal request
  withdrawalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Withdrawal',
    default: null,
    index: true,
    comment: 'Reference to withdrawal that included this payment'
  },
  
  // When funds were actually charged (deducted from wallet or charged to card)
  // For Preply model: set when lesson starts
  chargedAt: Date,
  
  // Revenue recognition (when platform earns the fee)
  revenueRecognized: {
    type: Boolean,
    default: false,
    index: true
  },
  revenueRecognizedAt: Date,
  
  // Platform profit auto-payout tracking
  platformProfitPayoutId: String, // Stripe payout ID
  platformProfitPaidOut: {
    type: Boolean,
    default: false
  },
  platformProfitPayoutAt: Date,
  platformProfitPayoutError: String, // Error message if payout failed
  
  // Refund tracking
  refundAmount: {
    type: Number,
    default: 0
  },
  refundedAt: Date,
  refundReason: String,
  refundMethod: {
    type: String,
    enum: ['wallet', 'card', null],
    default: null
  },
  
  // Payment type indicator
  paymentType: {
    type: String,
    enum: ['lesson_booking', 'class_booking', 'office_hours', 'wallet_top_up', 'tip'],
    required: true,
    index: true
  },
  
  // Additional metadata
  metadata: mongoose.Schema.Types.Mixed,
  
  // Error tracking
  errorMessage: String,
  errorCode: String,
  
  // Cron job retry tracking (for scalability)
  processingAttempts: {
    type: Number,
    default: 0,
    comment: 'Number of times this payment has been attempted for processing (cron jobs)'
  },
  lastProcessingError: {
    type: String,
    default: null,
    comment: 'Last error message if processing failed'
  },
  nextRetryAt: {
    type: Date,
    default: null,
    index: true,
    comment: 'When to retry processing this payment (exponential backoff)'
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ lessonId: 1, status: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ transferStatus: 1, transferredAt: 1 });
paymentSchema.index({ transferStatus: 1, earningsReleaseDate: 1, processingAttempts: 1 }); // For retry logic

// Virtual: Net platform revenue (fee - Stripe costs)
paymentSchema.virtual('netPlatformRevenue').get(function() {
  return this.platformFee - (this.stripeFee || 0);
});

// Ensure virtuals are included in JSON
paymentSchema.set('toJSON', { virtuals: true });
paymentSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Payment', paymentSchema);

