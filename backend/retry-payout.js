/**
 * Script to manually retry a PayPal payout
 * Run with: node retry-payout.js <payment-id>
 */

const mongoose = require('mongoose');
const Payment = require('./models/Payment');
const Lesson = require('./models/Lesson');
const User = require('./models/User');
const paymentService = require('./services/paymentService');

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://phillipdacosta:database12@cluster0.8s0vf.mongodb.net/languageR?retryWrites=true&w=majority&appName=Cluster0';

async function retryPayout(paymentId) {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find the payment
    const payment = await Payment.findById(paymentId)
      .populate('lessonId')
      .populate('tutorId')
      .populate('studentId');

    if (!payment) {
      console.log('❌ Payment not found');
      return;
    }

    console.log('📋 Payment found:', {
      id: payment._id,
      tutor: payment.tutorId.email,
      amount: payment.amount,
      tutorPayout: payment.tutorPayout,
      status: payment.transferStatus
    });

    // Call completeLessonPayment
    console.log('🔄 Triggering payout...');
    await paymentService.completeLessonPayment(payment.lessonId);

    console.log('✅ Payout triggered successfully!');
    console.log('Check the payment status in your database');

    mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    mongoose.disconnect();
  }
}

const paymentId = process.argv[2] || '6966927106d04da666d5e2e7';
console.log('💳 Retrying payout for payment:', paymentId);
retryPayout(paymentId);

