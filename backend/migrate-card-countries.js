/**
 * Migration Script: Update Saved Cards with Country Data
 * 
 * This script fetches card country from Stripe for all saved payment methods
 * that don't have a country field yet.
 * 
 * Run once to update all existing cards.
 */

require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const User = require('./models/User');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function updateCardCountries() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not found in config.env');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find all users with saved payment methods
    const users = await User.find({ 'savedPaymentMethods.0': { $exists: true } });
    console.log(`📊 Found ${users.length} users with saved payment methods`);

    let updatedCards = 0;
    let alreadyHaveCountry = 0;
    let errors = 0;

    for (const user of users) {
      console.log(`\n👤 Processing user: ${user.email}`);
      
      let userUpdated = false;

      for (let i = 0; i < user.savedPaymentMethods.length; i++) {
        const card = user.savedPaymentMethods[i];
        
        // Skip if already has country
        if (card.country) {
          console.log(`  ✓ Card ${card.brand} ****${card.last4} already has country: ${card.country}`);
          alreadyHaveCountry++;
          continue;
        }

        // Fetch from Stripe
        try {
          console.log(`  🔄 Fetching country for ${card.brand} ****${card.last4}...`);
          const paymentMethod = await stripe.paymentMethods.retrieve(card.stripePaymentMethodId);
          
          if (paymentMethod.card && paymentMethod.card.country) {
            user.savedPaymentMethods[i].country = paymentMethod.card.country;
            console.log(`  ✅ Updated: ${card.brand} ****${card.last4} → ${paymentMethod.card.country}`);
            updatedCards++;
            userUpdated = true;
          } else {
            console.log(`  ⚠️  No country found for ${card.brand} ****${card.last4}`);
          }
        } catch (error) {
          console.error(`  ❌ Error fetching ${card.brand} ****${card.last4}:`, error.message);
          errors++;
        }
      }

      // Save user if any cards were updated
      if (userUpdated) {
        await user.save();
        console.log(`  💾 Saved updates for ${user.email}`);
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`  - Total users processed: ${users.length}`);
    console.log(`  - Cards updated: ${updatedCards}`);
    console.log(`  - Cards already had country: ${alreadyHaveCountry}`);
    console.log(`  - Errors: ${errors}`);
    console.log('\n✅ Migration completed!');

  } catch (error) {
    console.error('❌ Error during migration:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

updateCardCountries().catch(console.error);

