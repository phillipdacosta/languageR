require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const Payment = require('./models/Payment');
const User = require('./models/User'); // Need to load User model for populate
const paypalService = require('./services/paypalService'); // Import singleton instance

/**
 * Manually send PayPal payout (for testing/sandbox)
 * This bypasses the Stripe payout completion wait
 */

const paymentIdToProcess = process.argv[2]; // Get payment ID from command line argument

if (!paymentIdToProcess) {
  console.error('Usage: node send-paypal-payout.js <paymentId>');
  process.exit(1);
}

console.log(`💰 Manually sending PayPal payout for payment: ${paymentIdToProcess}`);

async function sendPayPalPayout() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not found in config.env');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const payment = await Payment.findById(paymentIdToProcess).populate('tutorId');

    if (!payment) {
      console.error('❌ Payment not found.');
      return;
    }

    console.log('📋 Payment found:', {
      id: payment._id,
      tutor: payment.tutorId.email,
      amount: payment.amount,
      tutorPayout: payment.tutorPayout,
      status: payment.transferStatus,
      paypalEmail: payment.tutorId.payoutDetails?.paypalEmail
    });

    if (!payment.tutorId.payoutDetails?.paypalEmail) {
      console.error('❌ Tutor does not have a PayPal email configured.');
      return;
    }

    if (payment.transferStatus === 'succeeded') {
      console.warn('⚠️ Payment already succeeded. Skipping.');
      console.log('   PayPal Payout ID:', payment.paypalPayoutId);
      console.log('   Transferred at:', payment.transferredAt);
      return;
    }

    if (payment.paypalPayoutId) {
      console.warn('⚠️ PayPal payout already sent (has paypalPayoutId). Skipping to prevent duplicates.');
      console.log('   PayPal Payout ID:', payment.paypalPayoutId);
      return;
    }

    const paypalEmail = payment.tutorId.payoutDetails.paypalEmail;
    const amount = payment.tutorPayout;

    console.log(`💸 Sending $${amount} to ${paypalEmail} via PayPal...`);

    // Use PayPal service singleton to send payout
    if (!paypalService.isAvailable()) {
      console.error('❌ PayPal service is not configured. Check PAYPAL_CLIENT_ID and PAYPAL_SECRET in config.env');
      return;
    }

    const response = await paypalService.sendPayout({
      tutorId: payment.tutorId._id.toString(),
      paypalEmail: paypalEmail,
      amount: amount,
      lessonId: payment.lessonId?.toString(),
      note: `Payout for lesson payment ${payment._id}`
    });
    
    console.log('✅ PayPal payout created:', {
      batchId: response.batchId,
      status: response.status,
      amount: amount
    });

    // Update payment record
    payment.transferStatus = 'succeeded'; // Use 'succeeded' enum value
    payment.transferredAt = new Date();
    payment.paypalPayoutId = response.batchId;
    payment.paypalPayoutStatus = 'pending'; // Use 'pending' enum value (lowercase)
    await payment.save();

    console.log('✅ Payment record updated to "completed"');
    console.log('\n🎉 PayPal payout sent successfully!');
    console.log(`📧 Tutor will receive $${amount} at ${paypalEmail}`);

  } catch (error) {
    console.error('❌ Error sending PayPal payout:', error);
    if (error.statusCode) {
      console.error('Status Code:', error.statusCode);
    }
    if (error.message) {
      console.error('Error message:', error.message);
    }
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

sendPayPalPayout();

