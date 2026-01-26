const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

// Load models
const User = require('./models/User');
const Lesson = require('./models/Lesson');
const Payment = require('./models/Payment');
const paymentService = require('./services/paymentService');

async function captureLesson() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected!\n');
    
    // Get lesson ID from command line or use the most recent
    const lessonId = process.argv[2];
    
    let lesson;
    if (lessonId) {
      console.log(`Finding lesson ${lessonId}...`);
      lesson = await Lesson.findById(lessonId).populate('tutorId studentId paymentId');
    } else {
      console.log('Finding most recent lesson...');
      lesson = await Lesson.findOne()
        .sort({ createdAt: -1 })
        .populate('tutorId studentId paymentId')
        .limit(1);
    }
    
    if (!lesson) {
      console.log('❌ Lesson not found');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    console.log('===== LESSON DETAILS =====');
    console.log('Lesson ID:', lesson._id.toString());
    console.log('Status:', lesson.status);
    console.log('Billing Status:', lesson.billingStatus);
    console.log('Price: $' + lesson.price);
    console.log('Actual Call Start:', lesson.actualCallStartTime || 'N/A');
    console.log('');
    
    if (!lesson.paymentId) {
      console.log('❌ No payment found for this lesson');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    const payment = lesson.paymentId;
    console.log('===== PAYMENT DETAILS =====');
    console.log('Payment ID:', payment._id.toString());
    console.log('Status:', payment.status);
    console.log('Method:', payment.paymentMethod);
    console.log('Amount: $' + payment.amount);
    console.log('Charged At:', payment.chargedAt || 'NOT CHARGED YET');
    console.log('');
    
    // Check if already captured
    if (payment.status === 'succeeded' && payment.chargedAt) {
      console.log('✅ Payment already captured at', payment.chargedAt);
      
      // Check if revenue already recognized
      if (payment.revenueRecognized) {
        console.log('✅ Revenue already recognized - nothing to do');
      } else {
        console.log('⚠️  Revenue NOT yet recognized - running completeLessonPayment...');
        await paymentService.completeLessonPayment(lesson._id.toString());
        console.log('✅ Revenue recognition completed!');
      }
      
      await mongoose.disconnect();
      process.exit(0);
    }
    
    // Capture the payment
    if (payment.status !== 'authorized') {
      console.log(`❌ Payment status is '${payment.status}' - cannot capture`);
      console.log('   Only payments with status "authorized" can be captured');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    if (!lesson.actualCallStartTime) {
      console.log('❌ Lesson never started (no actualCallStartTime)');
      console.log('   Cannot capture payment for lessons that never happened');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    console.log('🔄 Capturing payment...');
    console.log('');
    
    try {
      // Step 1: Capture funds (deduct from wallet or capture Stripe payment)
      console.log('STEP 1: Deducting funds / capturing Stripe payment...');
      const captureResult = await paymentService.deductLessonFunds(lesson._id.toString());
      console.log('✅ Payment captured successfully!');
      console.log('');
      
      // Step 2: Complete payment (revenue recognition + tutor payout)
      console.log('STEP 2: Completing payment (revenue recognition + tutor payout)...');
      const completeResult = await paymentService.completeLessonPayment(lesson._id.toString());
      console.log('✅ Payment completed successfully!');
      console.log('');
      
      // Reload lesson and payment to see updated values
      await lesson.reload();
      await payment.reload();
      
      console.log('===== FINAL STATUS =====');
      console.log('Lesson Status:', lesson.status);
      console.log('Lesson Billing Status:', lesson.billingStatus);
      console.log('Lesson Revenue Recognized:', lesson.revenueRecognized);
      console.log('');
      console.log('Payment Status:', payment.status);
      console.log('Payment Charged At:', payment.chargedAt);
      console.log('Payment Revenue Recognized:', payment.revenueRecognized);
      console.log('Payment Transfer Status:', payment.transferStatus);
      console.log('');
      console.log('✅ CAPTURE COMPLETE!');
      console.log(`   Student charged: $${payment.amount}`);
      console.log(`   Platform fee: $${payment.platformFee}`);
      console.log(`   Tutor payout: $${payment.tutorPayout}`);
      
    } catch (captureError) {
      console.error('❌ CAPTURE FAILED:', captureError.message);
      console.error(captureError);
      await mongoose.disconnect();
      process.exit(1);
    }
    
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

console.log('💳 Manual Payment Capture Tool');
console.log('================================\n');

if (process.argv[2]) {
  console.log(`Target: Lesson ${process.argv[2]}\n`);
} else {
  console.log('Target: Most recent lesson\n');
  console.log('Usage: node manual-capture-lesson.js [lessonId]');
  console.log('       (lessonId is optional - defaults to most recent)\n');
}

captureLesson();

