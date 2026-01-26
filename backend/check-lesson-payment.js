const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const Lesson = require('./models/Lesson');
const Payment = require('./models/Payment');
const User = require('./models/User');

async function checkLessonPayment() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const lessonId = '695e8dd586616ae0a5bafc1f';
    
    // Check lesson
    const lesson = await Lesson.findById(lessonId)
      .populate('tutorId', 'name email payoutProvider payoutDetails stripeConnectAccountId stripeConnectOnboarded')
      .populate('studentId', 'name email');
    
    if (!lesson) {
      console.log('❌ Lesson not found');
      process.exit(1);
    }

    console.log('\n📚 LESSON DETAILS:');
    console.log('  ID:', lesson._id);
    console.log('  Status:', lesson.status);
    console.log('  Billing Status:', lesson.billingStatus);
    console.log('  Start Time:', lesson.startTime);
    console.log('  End Time:', lesson.endTime);
    console.log('  Actual Call Start:', lesson.actualCallStartTime);
    console.log('  Actual Call End:', lesson.actualCallEndTime);
    console.log('  Price:', lesson.price);
    console.log('  Platform Fee:', lesson.platformFee);
    console.log('  Tutor Payout:', lesson.tutorPayout);
    console.log('  Payment ID:', lesson.paymentId);

    console.log('\n👨‍🏫 TUTOR INFO:');
    console.log('  Name:', lesson.tutorId.name);
    console.log('  Email:', lesson.tutorId.email);
    console.log('  Payout Provider:', lesson.tutorId.payoutProvider);
    console.log('  PayPal Email:', lesson.tutorId.payoutDetails?.paypalEmail);
    console.log('  Stripe Account:', lesson.tutorId.stripeConnectAccountId);
    console.log('  Stripe Onboarded:', lesson.tutorId.stripeConnectOnboarded);

    // Check payment
    const payment = await Payment.findById(lesson.paymentId);
    
    if (!payment) {
      console.log('\n❌ Payment not found');
      process.exit(1);
    }

    console.log('\n💳 PAYMENT DETAILS:');
    console.log('  ID:', payment._id);
    console.log('  Status:', payment.status);
    console.log('  Amount:', payment.amount);
    console.log('  Payment Method:', payment.paymentMethod);
    console.log('  Platform Fee:', payment.platformFee);
    console.log('  Tutor Payout:', payment.tutorPayout);
    console.log('  Revenue Recognized:', payment.revenueRecognized);
    console.log('  Charged At:', payment.chargedAt);
    console.log('  Transfer Status:', payment.transferStatus);
    console.log('  Transferred At:', payment.transferredAt);
    console.log('  PayPal Batch ID:', payment.paypalBatchId);
    console.log('  PayPal Payout Item ID:', payment.paypalPayoutItemId);
    console.log('  Stripe Payment Intent:', payment.stripePaymentIntentId);
    console.log('  Stripe Transfer ID:', payment.stripeTransferId);
    console.log('  Error Message:', payment.errorMessage);

    console.log('\n🔍 DIAGNOSIS:');
    if (lesson.status !== 'completed' && !lesson.actualCallEndTime) {
      console.log('⚠️  Lesson not completed yet - needs actualCallEndTime or status: completed');
    }
    if (payment.status !== 'succeeded') {
      console.log('⚠️  Payment not captured yet - status:', payment.status);
    }
    if (payment.revenueRecognized) {
      console.log('⚠️  Revenue already recognized - completeLessonPayment already ran');
    }
    if (!lesson.tutorId.payoutDetails?.paypalEmail) {
      console.log('⚠️  Tutor has no PayPal email configured');
    }
    if (lesson.tutorId.payoutProvider !== 'paypal') {
      console.log('⚠️  Tutor payout provider is not PayPal:', lesson.tutorId.payoutProvider);
    }

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkLessonPayment();

