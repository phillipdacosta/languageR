/**
 * Script to manually force a PayPal payout
 * This directly creates the Stripe payout without checking if already processed
 */

require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const Payment = require('./models/Payment');
const Lesson = require('./models/Lesson');
const User = require('./models/User');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const alertService = require('./services/alertService');

const MONGODB_URI = process.env.MONGODB_URI;

async function forcePayPalPayout(paymentId) {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const payment = await Payment.findById(paymentId)
      .populate('lessonId')
      .populate('tutorId');

    if (!payment) {
      console.log('❌ Payment not found');
      return;
    }

    console.log('📋 Processing payout:', {
      tutor: payment.tutorId.email,
      paypalEmail: payment.tutorId.payoutDetails?.paypalEmail,
      amount: payment.tutorPayout
    });

    const tutorPayout = payment.tutorPayout;
    const paypalEmail = payment.tutorId.payoutDetails?.paypalEmail;

    if (!paypalEmail) {
      console.log('❌ No PayPal email configured');
      return;
    }

    // Create Stripe payout
    console.log('💳 Creating Stripe payout to platform bank account...');
    try {
      const stripePayout = await stripe.payouts.create({
        amount: Math.round(tutorPayout * 100), // $10 = 1000 cents
        currency: 'usd',
        description: `Tutor payout for ${payment.tutorId.email}`,
        metadata: {
          paymentId: payment._id.toString(),
          purpose: 'paypal_tutor_payout',
          paypalEmail: paypalEmail
        }
      });

      payment.stripePayoutId = stripePayout.id;
      payment.stripePayoutAmount = tutorPayout;
      payment.stripePayoutStatus = stripePayout.status;
      payment.stripePayoutCreatedAt = new Date();
      payment.transferStatus = 'awaiting_funds';
      payment.errorMessage = 'Stripe payout created, awaiting bank transfer (1-2 business days)';

      await payment.save();

      console.log('✅ Stripe payout created:', stripePayout.id);
      console.log('Status:', stripePayout.status);
      console.log('📧 PayPal payment will be sent to:', paypalEmail);
      console.log('💰 Amount:', `$${tutorPayout}`);
    } catch (error) {
      console.error('❌ Stripe payout failed:', error.message);
      payment.transferStatus = 'failed';
      payment.errorMessage = `Stripe payout failed: ${error.message}`;
      await payment.save();
    }

    mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    mongoose.disconnect();
  }
}

const paymentId = process.argv[2] || '6966927106d04da666d5e2e7';
forcePayPalPayout(paymentId);

