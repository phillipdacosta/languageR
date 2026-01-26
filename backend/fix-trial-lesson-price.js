/**
 * Find and fix the incorrectly priced trial lesson
 */

require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const User = require('./models/User');
const Lesson = require('./models/Lesson');
const Payment = require('./models/Payment');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function findAndFixLesson() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find recent lessons with $2.25 or $2.50 price
    const lessons = await Lesson.find({
      $or: [
        { price: 2.25 },
        { price: 2.50 },
        { price: { $gte: 2.20, $lte: 2.30 } }
      ],
      createdAt: { $gte: new Date('2025-01-09') } // Today
    })
      .sort({ createdAt: -1 })
      .populate('tutorId', 'name email')
      .populate('studentId', 'name email')
      .limit(5);

    console.log(`\n📚 Found ${lessons.length} lesson(s) with price around $2.25-$2.50`);

    if (lessons.length === 0) {
      console.log('\n🔍 Let me check ALL recent lessons...');
      
      const recentLessons = await Lesson.find({
        createdAt: { $gte: new Date('2025-01-09') }
      })
        .sort({ createdAt: -1 })
        .populate('tutorId', 'name email')
        .populate('studentId', 'name email')
        .limit(5);

      console.log(`\n📚 Recent lessons from today:`);
      recentLessons.forEach((l, i) => {
        console.log(`\n   ${i + 1}. Lesson ${l._id}`);
        console.log(`      Price: $${l.price}`);
        console.log(`      Duration: ${l.duration} min`);
        console.log(`      Trial: ${l.isTrialLesson}`);
        console.log(`      Status: ${l.status}`);
        console.log(`      Created: ${l.createdAt}`);
        console.log(`      Tutor: ${l.tutorId?.name || 'Unknown'}`);
        console.log(`      Student: ${l.studentId?.name || 'Unknown'}`);
      });

      console.log('\n❓ Which lesson ID should I fix? (or type "exit" to quit)');
      process.exit(0);
    }

    // Show found lessons
    lessons.forEach((l, i) => {
      console.log(`\n   ${i + 1}. Lesson ${l._id}`);
      console.log(`      Price: $${l.price}`);
      console.log(`      Duration: ${l.duration} min`);
      console.log(`      Trial: ${l.isTrialLesson}`);
      console.log(`      Status: ${l.status}`);
      console.log(`      Tutor: ${l.tutorId?.name || 'Unknown'}`);
      console.log(`      Student: ${l.studentId?.name || 'Unknown'}`);
    });

    // Fix the first one
    const lesson = lessons[0];
    const correctPrice = 4.50;

    console.log(`\n💰 Fixing lesson ${lesson._id}: $${lesson.price} → $${correctPrice}`);

    // Find payment
    const payment = await Payment.findById(lesson.paymentId);
    
    if (!payment) {
      console.log('❌ No payment found');
      process.exit(1);
    }

    console.log(`\n💳 Payment ${payment._id}:`);
    console.log(`   Stripe PI: ${payment.stripePaymentIntentId}`);
    console.log(`   Status: ${payment.status}`);
    console.log(`   Amount: $${payment.amount}`);

    // Update Stripe if authorized
    if (payment.stripePaymentIntentId && payment.status === 'authorized') {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          payment.stripePaymentIntentId
        );

        if (paymentIntent.status === 'requires_capture') {
          const updatedPI = await stripe.paymentIntents.update(
            payment.stripePaymentIntentId,
            {
              amount: Math.round(correctPrice * 100),
              metadata: {
                ...paymentIntent.metadata,
                priceCorrection: 'true',
                originalPrice: lesson.price.toString(),
                correctedPrice: correctPrice.toString()
              }
            }
          );
          console.log(`   ✅ Updated Stripe: $${updatedPI.amount / 100}`);
        }
      } catch (stripeError) {
        console.error(`   ⚠️ Stripe error:`, stripeError.message);
      }
    }

    // Update database
    const platformFeeRate = 0.20;
    const platformFee = correctPrice * platformFeeRate;
    const tutorPayout = correctPrice - platformFee;

    lesson.price = correctPrice;
    lesson.actualPrice = correctPrice;
    await lesson.save();

    payment.amount = correctPrice;
    payment.platformFee = platformFee;
    payment.tutorPayout = tutorPayout;
    await payment.save();

    console.log(`\n✅ Fixed!`);
    console.log(`   Lesson price: $${lesson.price}`);
    console.log(`   Platform fee: $${platformFee.toFixed(2)}`);
    console.log(`   Tutor payout: $${tutorPayout.toFixed(2)}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Done');
    process.exit(0);
  }
}

findAndFixLesson();
