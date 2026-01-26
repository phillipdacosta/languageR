/**
 * Backfill Missing Stripe Fees
 * 
 * This script finds all saved-card payments with $0.00 Stripe fee
 * and retrieves the actual fee from Stripe's API.
 * 
 * Run: node backend/scripts/backfill-stripe-fees.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const User = require('../models/User'); // Required for populate
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function backfillStripeFees() {
  try {
    console.log('🔍 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to database');

    // Find all card payments with $0.00 Stripe fee that succeeded
    const payments = await Payment.find({
      paymentMethod: { $in: ['saved-card', 'card', 'apple_pay', 'google_pay'] },
      stripeFee: 0,
      status: 'succeeded',
      stripePaymentIntentId: { $exists: true, $ne: null }
    }).populate('studentId tutorId', 'name email');

    console.log(`\n📋 Found ${payments.length} payments with missing Stripe fees\n`);

    if (payments.length === 0) {
      console.log('✅ No payments need backfilling');
      process.exit(0);
    }

    let fixed = 0;
    let errors = 0;

    for (const payment of payments) {
      try {
        console.log(`\n🔍 Processing payment ${payment._id}...`);
        console.log(`   Student: ${payment.studentId?.name || 'Unknown'}`);
        console.log(`   Tutor: ${payment.tutorId?.name || 'Unknown'}`);
        console.log(`   Amount: $${payment.amount}`);
        console.log(`   PaymentIntent: ${payment.stripePaymentIntentId}`);

        // Retrieve the PaymentIntent from Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId, {
          expand: ['charges.data.balance_transaction']
        });

        console.log(`   Stripe status: ${paymentIntent.status}`);

        if (paymentIntent.status !== 'succeeded') {
          console.log(`   ⚠️  Skipping - PaymentIntent not succeeded (status: ${paymentIntent.status})`);
          continue;
        }

        // Get the charge and balance transaction
        // Try expanded charges first, then latest_charge as fallback
        let charge = null;
        const charges = paymentIntent.charges?.data || [];
        
        if (charges.length > 0) {
          charge = charges[0];
        } else if (paymentIntent.latest_charge) {
          console.log(`   🔍 Retrieving latest_charge directly: ${paymentIntent.latest_charge}`);
          charge = await stripe.charges.retrieve(paymentIntent.latest_charge, {
            expand: ['balance_transaction']
          });
        }
        
        if (!charge) {
          console.log(`   ⚠️  No charges found for this PaymentIntent`);
          continue;
        }

        const balanceTx = charge.balance_transaction;

        if (!balanceTx) {
          console.log(`   ⚠️  No balance_transaction found for charge ${charge.id}`);
          continue;
        }

        // Calculate Stripe fee
        const stripeFee = (balanceTx.fee || 0) / 100;
        
        if (stripeFee === 0) {
          console.log(`   ⚠️  Stripe fee is still $0.00 in Stripe API - skipping`);
          continue;
        }

        // Update the payment record
        payment.stripeFee = stripeFee;
        payment.stripeNetAmount = (balanceTx.net || 0) / 100;
        payment.stripeChargeId = charge.id;
        await payment.save();

        fixed++;
        console.log(`   ✅ Fixed! Stripe fee: $${stripeFee.toFixed(2)}`);

      } catch (error) {
        errors++;
        console.error(`   ❌ Error processing payment ${payment._id}:`, error.message);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total payments: ${payments.length}`);
    console.log(`   Fixed: ${fixed}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Skipped: ${payments.length - fixed - errors}`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from database');
  }
}

backfillStripeFees();

