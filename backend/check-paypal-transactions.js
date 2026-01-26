require('dotenv').config({ path: './config.env' });
const paypal = require('@paypal/payouts-sdk');

// PayPal environment setup
const environment = process.env.PAYPAL_MODE === 'live'
  ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
  : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);

const client = new paypal.core.PayPalHttpClient(environment);

async function checkPayPalTransactions() {
  const transactionIds = [
    '8T885807JK298561T',
    '1FJ70284U08714500',
    '1T597326R9797133R'
  ];

  console.log('🔍 Checking PayPal transactions...\n');

  for (const txnId of transactionIds) {
    try {
      const request = new paypal.payouts.PayoutsItemGetRequest(txnId);
      const response = await client.execute(request);
      
      console.log(`\n💰 Transaction ${txnId}:`);
      console.log(`   Payout Batch ID: ${response.result.payout_batch_id || 'N/A'}`);
      console.log(`   Payout Item ID: ${response.result.payout_item_id || 'N/A'}`);
      console.log(`   Amount: ${response.result.payout_item.amount.currency} ${response.result.payout_item.amount.value}`);
      console.log(`   Status: ${response.result.transaction_status}`);
      console.log(`   Sender Note: ${response.result.payout_item.note || 'N/A'}`);
      console.log(`   Time: ${response.result.time_processed || 'N/A'}`);
    } catch (error) {
      console.error(`\n❌ Error fetching transaction ${txnId}:`, error.message);
    }
  }
}

checkPayPalTransactions().catch(console.error);

