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
  
  // Transfer/Payout tracking (applies to all payout methods)
  transferredAt: Date,
  transferStatus: {
    type: String,
    enum: ['pending', 'awaiting_funds', 'succeeded', 'failed', 'acknowledged', null],
    default: null
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
    enum: ['lesson_booking', 'office_hours', 'wallet_top_up'],
    required: true,
    index: true
  },
  
  // Additional metadata
  metadata: mongoose.Schema.Types.Mixed,
  
  // Error tracking
  errorMessage: String,
  errorCode: String
}, {
  timestamps: true
});

// Compound indexes for efficient queries
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ lessonId: 1, status: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ transferStatus: 1, transferredAt: 1 });

// Virtual: Net platform revenue (fee - Stripe costs)
paymentSchema.virtual('netPlatformRevenue').get(function() {
  return this.platformFee - (this.stripeFee || 0);
});

// Ensure virtuals are included in JSON
paymentSchema.set('toJSON', { virtuals: true });
paymentSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Payment', paymentSchema);

