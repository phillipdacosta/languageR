/**
 * Backfill receipt URLs for existing payments
 * Fetches receipt_url from Stripe for payments that have stripeChargeId but no receiptUrl
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function backfillReceiptUrls() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find payments with stripeChargeId but no receiptUrl
    const payments = await Payment.find({
      stripeChargeId: { $exists: true, $ne: null },
      receiptUrl: { $exists: false }
    }).limit(50); // Process in batches

    console.log(`📦 Found ${payments.length} payments to update`);

    let updated = 0;
    let failed = 0;

    for (const payment of payments) {
      try {
        console.log(`\n💳 Processing charge: ${payment.stripeChargeId}`);
        
        // Fetch charge from Stripe
        const charge = await stripe.charges.retrieve(payment.stripeChargeId);
        
        if (charge.receipt_url) {
          payment.receiptUrl = charge.receipt_url;
          await payment.save();
          console.log(`✅ Updated payment ${payment._id} with receipt URL`);
          console.log(`   Receipt: ${charge.receipt_url}`);
          updated++;
        } else {
          console.log(`⚠️  No receipt URL found for charge ${payment.stripeChargeId}`);
        }
        
        // Rate limiting - wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Failed to process payment ${payment._id}:`, error.message);
        failed++;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📦 Total processed: ${payments.length}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the script
backfillReceiptUrls();


