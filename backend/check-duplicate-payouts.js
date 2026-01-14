require('dotenv').config({ path: './config.env' });
const paypalService = require('./services/paypalService');

/**
 * Cancel PayPal payouts (sandbox only)
 */

const batchIds = [
  '6AKPS7REXHPTU',  // First duplicate
  'YAD6TJ3AKRY8U'   // Second duplicate
  // Keep GV6WB76JUC3WY (the intended payout)
];

async function cancelPayouts() {
  try {
    for (const batchId of batchIds) {
      console.log(`🔍 Checking payout batch: ${batchId}`);
      
      try {
        const status = await paypalService.getBatchStatus(batchId);
        console.log(`   Status: ${status.batch_header.batch_status}`);
        
        // Unfortunately, PayPal doesn't allow canceling payouts once submitted
        // They can only be cancelled by the recipient or if they fail
        console.log('   ⚠️  Note: PayPal payouts cannot be cancelled programmatically once submitted');
        console.log('   💡 Recipient would need to decline/refund, or wait for it to fail if email is invalid');
      } catch (error) {
        console.error(`   ❌ Error checking batch ${batchId}:`, error.message);
      }
    }

    console.log('\n📊 Summary:');
    console.log('   - Total duplicate payouts: 2 ($20)');
    console.log('   - Intended payout: 1 ($10)');
    console.log('   - Total sent: $30');
    console.log('\n💡 Options:');
    console.log('   1. Wait for sandbox payouts to auto-cancel (sandbox emails are fake)');
    console.log('   2. Manually adjust the tutor\'s balance in your system (-$20)');
    console.log('   3. In production, implement better duplicate prevention (idempotency keys)');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

cancelPayouts();

