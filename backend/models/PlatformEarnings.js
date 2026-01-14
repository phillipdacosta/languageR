const mongoose = require('mongoose');

const platformEarningsSchema = new mongoose.Schema({
  // Time period
  date: {
    type: Date,
    required: true,
    index: true
  },
  
  // Revenue breakdown
  grossRevenue: {
    type: Number,
    default: 0,
    comment: 'Total amount charged to students'
  },
  
  platformFees: {
    type: Number,
    default: 0,
    comment: 'Total 20% platform fees collected'
  },
  
  tutorPayouts: {
    type: Number,
    default: 0,
    comment: 'Total paid out to tutors (80%)'
  },
  
  stripeProcessingFees: {
    type: Number,
    default: 0,
    comment: 'Fees paid to Stripe for processing'
  },
  
  stripeConnectFees: {
    type: Number,
    default: 0,
    comment: 'Stripe Connect transfer fees'
  },
  
  netPlatformEarnings: {
    type: Number,
    default: 0,
    comment: 'Platform fees minus Stripe fees (what platform actually keeps)'
  },
  
  // Transaction counts
  totalLessons: {
    type: Number,
    default: 0
  },
  
  completedLessons: {
    type: Number,
    default: 0
  },
  
  cancelledLessons: {
    type: Number,
    default: 0
  },
  
  // Breakdown by payment method
  walletPayments: {
    type: Number,
    default: 0
  },
  
  cardPayments: {
    type: Number,
    default: 0
  },
  
  // Related payments (for audit trail)
  paymentIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  }]
}, {
  timestamps: true
});

// Compound index for efficient querying
platformEarningsSchema.index({ date: 1 });

// Calculate net earnings
platformEarningsSchema.methods.calculateNet = function() {
  this.netPlatformEarnings = this.platformFees - this.stripeProcessingFees - this.stripeConnectFees;
  return this.netPlatformEarnings;
};

const PlatformEarnings = mongoose.model('PlatformEarnings', platformEarningsSchema);

module.exports = PlatformEarnings;

