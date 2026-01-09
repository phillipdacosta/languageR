/**
 * Script to delete a Stripe Connect account
 * Usage: node delete-stripe-account.js <account_id>
 * Example: node delete-stripe-account.js acct_1SlGRjPlUvUR8UlF
 * 
 * Run from backend directory: cd backend && node delete-stripe-account.js acct_1SlGRjPlUvUR8UlF
 */

require('dotenv').config({ path: './config.env' });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const accountId = process.argv[2] || 'acct_1SlGRjPlUvUR8UlF';

async function deleteStripeAccount() {
  try {
    console.log(`🗑️  Attempting to delete Stripe account: ${accountId}`);
    
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('placeholder')) {
      console.error('❌ STRIPE_SECRET_KEY not configured in config.env');
      process.exit(1);
    }
    
    // First, try to delete the account
    // Note: Stripe Connect accounts can only be deleted if they're in a deletable state
    // For Express accounts, you typically need to close them first
    try {
      const deleted = await stripe.accounts.del(accountId);
      console.log(`✅ Successfully deleted account: ${accountId}`);
      console.log('Account details:', JSON.stringify(deleted, null, 2));
    } catch (deleteError) {
      // If deletion fails, try to close the account first
      if (deleteError.code === 'account_invalid_state' || deleteError.message.includes('cannot be deleted')) {
        console.log('⚠️  Account cannot be deleted directly. Attempting to close it first...');
        
        try {
          // Close the account (for Express accounts)
          const closed = await stripe.accounts.update(accountId, {
            metadata: { closed: 'true' }
          });
          console.log(`✅ Account marked for closure: ${accountId}`);
          console.log('Note: Stripe Express accounts may need to be closed through the dashboard.');
          console.log('Account status:', closed.details_submitted ? 'Details submitted' : 'Not fully onboarded');
        } catch (closeError) {
          console.error('❌ Error closing account:', closeError.message);
          throw closeError;
        }
      } else {
        throw deleteError;
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Error code:', error.code);
    console.error('Error type:', error.type);
    
    if (error.type === 'StripeAuthenticationError') {
      console.error('\n💡 Make sure STRIPE_SECRET_KEY is set correctly in config.env');
    } else if (error.type === 'StripeInvalidRequestError') {
      console.error('\n💡 The account may not exist or may already be deleted');
      console.error('   Try checking the Stripe Dashboard: https://dashboard.stripe.com/connect/accounts');
    } else if (error.code === 'resource_missing') {
      console.error('\n💡 Account not found. It may have already been deleted.');
    }
    
    process.exit(1);
  }
}

// Run the script
deleteStripeAccount();


