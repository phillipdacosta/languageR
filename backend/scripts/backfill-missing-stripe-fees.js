/**
 * Migration Script: Backfill Missing Stripe Fees
 * 
 * Problem: Some payments have stripeFee = $0 when they should have actual Stripe processing fees
 * Root Cause: expand: ['charges.data.balance_transaction'] doesn't work reliably with stripe.paymentIntents.capture()
 * Solution: Query Stripe API for each payment's actual fee and update the database
 * 
 * Run: node scripts/backfill-missing-stripe-fees.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function backfillStripeFees() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Find all card payments with missing Stripe fees
    const paymentsWithMissingFees = await Payment.find({
      paymentMethod: { $in: ['saved-card', 'card', 'apple_pay', 'google_pay'] },
      status: 'succeeded',
      $or: [
        { stripeFee: { $exists: false } },
        { stripeFee: 0 }
      ],
      stripePaymentIntentId: { $exists: true, $ne: null }
    }).sort({ createdAt: -1 });
    
    console.log(`\n📊 Found ${paymentsWithMissingFees.length} payments with missing Stripe fees`);
    
    if (paymentsWithMissingFees.length === 0) {
      console.log('✅ No payments need backfilling!');
      await mongoose.connection.close();
      return;
    }
    
    let fixed = 0;
    let failed = 0;
    let totalFeesAdded = 0;
    
    for (const payment of paymentsWithMissingFees) {
      try {
        console.log(`\n🔍 Processing payment ${payment._id}...`);
        console.log(`   Amount: $${payment.amount}, Method: ${payment.paymentMethod}`);
        console.log(`   Current Stripe Fee: $${payment.stripeFee || 0}`);
        
        // Retrieve the PaymentIntent from Stripe
        const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
        
        if (intent.status !== 'succeeded') {
          console.log(`   ⚠️  Skipping - PaymentIntent status: ${intent.status}`);
          continue;
        }
        
        if (!intent.latest_charge) {
          console.log(`   ⚠️  Skipping - No charge found`);
          continue;
        }
        
        // Retrieve the charge with expanded balance_transaction
        const chargeId = typeof intent.latest_charge === 'string' 
          ? intent.latest_charge 
          : intent.latest_charge.id;
          
        const charge = await stripe.charges.retrieve(chargeId, {
          expand: ['balance_transaction']
        });
        
        if (!charge.balance_transaction || typeof charge.balance_transaction !== 'object') {
          console.log(`   ⚠️  Skipping - No balance_transaction found`);
          continue;
        }
        
        const actualStripeFee = (charge.balance_transaction.fee || 0) / 100;
        
        if (actualStripeFee === 0) {
          console.log(`   ℹ️  Stripe fee is $0.00 (possibly a test or refunded payment)`);
          continue;
        }
        
        // Update the payment record
        payment.stripeFee = actualStripeFee;
        payment.stripeChargeId = charge.id;
        
        // Also store receipt URL if we don't have it
        if (!payment.receiptUrl && charge.receipt_url) {
          payment.receiptUrl = charge.receipt_url;
        }
        
        await payment.save();
        
        console.log(`   ✅ Fixed! Stripe fee: $${actualStripeFee.toFixed(2)}`);
        console.log(`   📋 Platform Fee: $${payment.platformFee.toFixed(2)}`);
        console.log(`   💰 Net Platform Revenue: $${(payment.platformFee - actualStripeFee).toFixed(2)}`);
        
        fixed++;
        totalFeesAdded += actualStripeFee;
        
        // Rate limit: pause briefly between API calls
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`   ❌ Error processing payment ${payment._id}:`, error.message);
        failed++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION COMPLETE');
    console.log('='.repeat(60));
    console.log(`✅ Fixed: ${fixed} payments`);
    console.log(`❌ Failed: ${failed} payments`);
    console.log(`💰 Total Stripe fees added: $${totalFeesAdded.toFixed(2)}`);
    console.log(`\n🔧 Impact on Platform Revenue:`);
    console.log(`   Your net platform revenue was OVER-REPORTED by $${totalFeesAdded.toFixed(2)}`);
    console.log(`   This has now been corrected in the database.`);
    
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
backfillStripeFees();

