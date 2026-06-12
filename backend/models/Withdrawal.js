const mongoose = require('mongoose');

/**
 * Withdrawal Model
 * Tracks tutor withdrawal requests from their internal balance
 * to external payment methods (Stripe Connect or PayPal)
 */
const withdrawalSchema = new mongoose.Schema({
  tutorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  idempotencyKey: {
    type: String,
    default: null,
    index: true,
    sparse: true,
    comment: 'Client-generated UUID to prevent duplicate withdrawal requests'
  },
  
  amount: {
    type: Number,
    required: true,
    min: 0,
    comment: 'Withdrawal amount requested'
  },
  
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true,
    comment: 'pending: awaiting processing, processing: transfer initiated, completed: funds sent, failed: transfer error, cancelled: manually cancelled'
  },
  
  method: {
    type: String,
    enum: ['stripe_connect', 'paypal'],
    required: true,
    comment: 'Payment method for withdrawal'
  },
  
  // Stripe-specific fields
  stripeTransferId: {
    type: String,
    default: null,
    comment: 'Stripe Transfer ID (tr_xxx)'
  },
  
  stripePayoutId: {
    type: String,
    default: null,
    comment: 'Stripe Payout ID if payout was created (po_xxx)'
  },
  
  // PayPal-specific fields
  paypalBatchId: {
    type: String,
    default: null,
    comment: 'PayPal Batch ID for payout'
  },
  
  paypalPayoutItemId: {
    type: String,
    default: null,
    comment: 'PayPal Payout Item ID'
  },
  
  // Payment IDs included in this withdrawal
  paymentIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    comment: 'Individual lesson payments included in this withdrawal'
  }],
  
  // Fee breakdown
  platformFee: {
    type: Number,
    default: 0,
    comment: 'Any additional platform withdrawal fee (currently $0)'
  },
  
  stripeFee: {
    type: Number,
    default: 0,
    comment: 'Stripe transfer fee if applicable (typically $0 for Standard Connect)'
  },
  
  paypalFee: {
    type: Number,
    default: 0,
    comment: 'PayPal fee charged to the tutor (deducted from withdrawal amount)'
  },

  paypalSenderFee: {
    type: Number,
    default: 0,
    comment: 'PayPal sender fee charged to the platform for sending the payout (2% of netAmount, min $0.25, max $20)'
  },
  
  netAmount: {
    type: Number,
    required: true,
    comment: 'Amount tutor actually receives after all fees (in source/platform currency, USD)'
  },

  // ── Settlement (what actually landed in the tutor's account) ──
  // The platform sends funds in USD. When a tutor's connected account settles
  // in another currency (e.g. EUR), Stripe converts at transfer time and may
  // deduct a conversion/cross-border fee. These fields record the real numbers
  // returned by Stripe so the tutor sees exactly what they received.
  sourceCurrency: {
    type: String,
    default: 'usd',
    lowercase: true,
    comment: 'Currency the platform sent the transfer in (always USD today)'
  },

  settledCurrency: {
    type: String,
    default: null,
    lowercase: true,
    comment: "Currency the funds actually settled in on the tutor's account (e.g. 'eur')"
  },

  settledAmount: {
    type: Number,
    default: null,
    comment: 'Gross amount in the settled currency before Stripe conversion fees'
  },

  settledFee: {
    type: Number,
    default: 0,
    comment: 'Stripe conversion / cross-border fee, in the settled currency'
  },

  settledNetAmount: {
    type: Number,
    default: null,
    comment: 'Net amount the tutor actually received, in the settled currency'
  },

  exchangeRate: {
    type: Number,
    default: null,
    comment: 'FX rate applied (settled per 1 source unit), if a conversion occurred'
  },

  settlementCapturedAt: {
    type: Date,
    default: null,
    comment: 'When settlement details were captured from Stripe'
  },

  // Timing
  requestedAt: {
    type: Date,
    default: Date.now,
    index: true,
    comment: 'When withdrawal was requested'
  },
  
  processedAt: {
    type: Date,
    default: null,
    comment: 'When withdrawal processing started'
  },
  
  completedAt: {
    type: Date,
    default: null,
    comment: 'When withdrawal successfully completed'
  },
  
  failedAt: {
    type: Date,
    default: null,
    comment: 'When withdrawal failed'
  },
  
  // Error handling
  errorMessage: {
    type: String,
    default: null,
    comment: 'Error message if withdrawal failed'
  },
  
  retryCount: {
    type: Number,
    default: 0,
    comment: 'Number of retry attempts'
  },
  
  nextRetryAt: {
    type: Date,
    default: null,
    index: true,
    comment: 'When to retry processing (exponential backoff)'
  },
  
  // Administrative
  notes: {
    type: String,
    default: null,
    comment: 'Admin notes about this withdrawal'
  },
  
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    comment: 'Additional metadata for tracking/debugging'
  }
  
}, { 
  timestamps: true,
  comment: 'Automatic createdAt and updatedAt timestamps'
});

// Compound indexes for common queries
withdrawalSchema.index({ tutorId: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, createdAt: -1 });
withdrawalSchema.index({ method: 1, status: 1 });

// Virtual field: feePercentage
withdrawalSchema.virtual('feePercentage').get(function() {
  if (this.amount === 0) return 0;
  const totalFees = this.platformFee + this.stripeFee + this.paypalFee;
  return ((totalFees / this.amount) * 100).toFixed(2);
});

withdrawalSchema.virtual('totalPlatformCost').get(function() {
  return (this.paypalSenderFee || 0) + (this.stripeFee || 0);
});

// True when the payout settled in a currency other than what we sent.
withdrawalSchema.virtual('wasConverted').get(function() {
  return !!(this.settledCurrency && this.settledCurrency !== (this.sourceCurrency || 'usd'));
});

// Ensure virtuals are included in JSON output
withdrawalSchema.set('toJSON', { virtuals: true });
withdrawalSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);

