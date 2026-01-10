const mongoose = require('mongoose');

/**
 * Wallet Model - Ledger-based prepaid platform credits
 * 
 * Key Principles:
 * - Wallet is an internal ledger, NOT a bank account
 * - Actual funds live in Stripe platform balance
 * - Balances are not transferable, not withdrawable
 * - Refunds are primarily issued as wallet credits
 * - Can be used for lessons and office hours
 */

const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  // Track reserved funds (authorized but not yet charged)
  reservedBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  // Ledger of all transactions
  transactions: [{
    type: {
      type: String,
      enum: ['top_up', 'deduction', 'refund', 'reservation', 'release'],
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    balanceAfter: {
      type: Number,
      required: true
    },
    lessonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lesson'
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment'
    },
    stripePaymentIntentId: String,
    description: String,
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    metadata: mongoose.Schema.Types.Mixed
  }]
}, {
  timestamps: true
});

// Virtual: Available balance = total balance - reserved
walletSchema.virtual('availableBalance').get(function() {
  return Math.max(0, this.balance - this.reservedBalance);
});

// Index for efficient queries
walletSchema.index({ userId: 1, createdAt: -1 });
walletSchema.index({ 'transactions.createdAt': -1 });

// Ensure virtuals are included in JSON
walletSchema.set('toJSON', { virtuals: true });
walletSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Wallet', walletSchema);



