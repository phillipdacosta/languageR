/**
 * Script to fix stuck PayPal payout that failed due to missing bank account
 * Run this with: node fix-stuck-payout.js
 */

const mongoose = require('mongoose');
const Payment = require('./models/Payment');

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://phillipdacosta:database12@cluster0.8s0vf.mongodb.net/languageR?retryWrites=true&w=majority&appName=Cluster0';

async function fixStuckPayout() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find the failed payment for baseathleticsdev@gmail.com
    const failedPayment = await Payment.findOne({
      transferStatus: 'failed',
      errorMessage: { $regex: /external accounts/i }
    })
    .populate('lessonId')
    .populate('tutorId')
    .sort({ createdAt: -1 }); // Get most recent

    if (!failedPayment) {
      console.log('❌ No stuck payment found');
      return;
    }

    console.log('📋 Found stuck payment:', {
      id: failedPayment._id,
      tutor: failedPayment.tutorId.email,
      amount: failedPayment.amount,
      tutorPayout: failedPayment.tutorPayout,
      status: failedPayment.transferStatus,
      error: failedPayment.errorMessage
    });

    // Reset the payment to pending so it can be retried
    failedPayment.transferStatus = 'pending';
    failedPayment.errorMessage = 'Retry after bank account configuration';
    failedPayment.stripePayoutId = null;
    failedPayment.stripePayoutStatus = null;
    failedPayment.stripePayoutCreatedAt = null;

    await failedPayment.save();

    console.log('✅ Payment reset to pending status');
    console.log('📌 Now you need to manually trigger the payout');
    console.log('');
    console.log('Next steps:');
    console.log('1. The payment is now in "pending" status');
    console.log('2. You can either:');
    console.log('   a) Wait for the lesson completion webhook to retry');
    console.log('   b) Manually trigger completeLessonPayment from paymentService');
    console.log('   c) Create a Stripe payout manually and then send PayPal payment');
    console.log('');
    console.log('Payment ID:', failedPayment._id);
    console.log('Tutor PayPal:', failedPayment.tutorId.payoutDetails?.paypalEmail);
    console.log('Amount to pay:', `$${failedPayment.tutorPayout}`);

    mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    mongoose.disconnect();
  }
}

fixStuckPayout();

