require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const Payment = require('./models/Payment');

/**
 * Migration script to fix missing stripeFee values in existing payments
 * 
 * Logic:
 * 1. Wallet payments: stripeFee = 0 (no credit card processing)
 * 2. Card payments with balance_transaction: calculate from Stripe API
 * 3. Card payments without balance_transaction: estimate 2.9% + $0.30
 */

async function fixStripeFees() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not found in config.env');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find all payments where stripeFee is 0 or undefined
    const paymentsToFix = await Payment.find({
      $or: [
        { stripeFee: { $exists: false } },
        { stripeFee: 0 }
      ],
      status: { $in: ['succeeded', 'authorized', 'captured'] }
    });

    console.log(`📋 Found ${paymentsToFix.length} payments to fix`);

    let walletFixed = 0;
    let cardEstimated = 0;
    let cardCalculated = 0;
    let errors = 0;

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    for (const payment of paymentsToFix) {
      try {
        if (payment.paymentMethod === 'wallet') {
          // Wallet payments have no Stripe fees
          payment.stripeFee = 0;
          payment.stripeNetAmount = payment.amount;
          await payment.save();
          walletFixed++;
          console.log(`💰 [WALLET] Fixed payment ${payment._id}: $${payment.amount} (no fees)`);
        } else if (payment.stripePaymentIntentId) {
          // Try to get actual Stripe fee from balance_transaction
          try {
            const paymentIntent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
            
            if (paymentIntent.charges?.data?.length > 0) {
              const charge = paymentIntent.charges.data[0];
              
              if (charge.balance_transaction) {
                const balanceTx = typeof charge.balance_transaction === 'string'
                  ? await stripe.balanceTransactions.retrieve(charge.balance_transaction)
                  : charge.balance_transaction;
                
                payment.stripeFee = (balanceTx.fee || 0) / 100;
                payment.stripeNetAmount = (balanceTx.net || 0) / 100;
                await payment.save();
                cardCalculated++;
                console.log(`💳 [CARD-ACTUAL] Fixed payment ${payment._id}: $${payment.amount} - Stripe fee: $${payment.stripeFee.toFixed(2)}`);
              } else {
                throw new Error('No balance_transaction');
              }
            } else {
              throw new Error('No charges');
            }
          } catch (stripeError) {
            // If we can't get actual fee, estimate it
            // Stripe standard rate: 2.9% + $0.30
            const estimatedFee = (payment.amount * 0.029) + 0.30;
            payment.stripeFee = Math.round(estimatedFee * 100) / 100; // Round to 2 decimals
            payment.stripeNetAmount = payment.amount - payment.stripeFee;
            await payment.save();
            cardEstimated++;
            console.log(`💳 [CARD-ESTIMATED] Fixed payment ${payment._id}: $${payment.amount} - Estimated fee: $${payment.stripeFee.toFixed(2)}`);
          }
        } else {
          console.warn(`⚠️  Skipping payment ${payment._id}: Unknown payment method or missing data`);
        }
      } catch (error) {
        console.error(`❌ Error fixing payment ${payment._id}:`, error.message);
        errors++;
      }
    }

    console.log('\n✅ Migration completed!');
    console.log('📊 Summary:');
    console.log(`  - Wallet payments fixed: ${walletFixed}`);
    console.log(`  - Card payments (actual Stripe fees): ${cardCalculated}`);
    console.log(`  - Card payments (estimated fees): ${cardEstimated}`);
    console.log(`  - Errors: ${errors}`);
    console.log(`  - Total fixed: ${walletFixed + cardCalculated + cardEstimated}`);

  } catch (error) {
    console.error('❌ Migration error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

fixStripeFees();

