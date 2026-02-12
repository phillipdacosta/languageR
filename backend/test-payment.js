const mongoose = require('mongoose');
require('dotenv').config();

const Payment = require('./models/Payment');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log('Connected to MongoDB\n');
  
  const payment = await Payment.findById('696e8f18d7826cf07e55dd67').lean();
  
  if (!payment) {
    console.log('Payment not found!');
    process.exit(1);
  }
  
  console.log('Payment Fields:');
  console.log('- _id:', payment._id);
  console.log('- status:', payment.status);
  console.log('- transferStatus:', payment.transferStatus);
  console.log('- earningsReleaseDate:', payment.earningsReleaseDate);
  console.log('- processingAttempts:', payment.processingAttempts);
  console.log('- nextRetryAt:', payment.nextRetryAt);
  console.log('- lastProcessingError:', payment.lastProcessingError);
  console.log('- nextRetryAt exists?:', 'nextRetryAt' in payment);
  console.log('- nextRetryAt undefined?:', payment.nextRetryAt === undefined);
  console.log('- nextRetryAt null?:', payment.nextRetryAt === null);
  
  // Test each part of the $or condition
  const now = new Date();
  console.log('\n$or condition tests:');
  console.log('- nextRetryAt exists:', 'nextRetryAt' in payment);
  console.log('- nextRetryAt === null:', payment.nextRetryAt === null);
  console.log('- nextRetryAt <= now:', payment.nextRetryAt ? new Date(payment.nextRetryAt) <= now : 'N/A');
  
  // Test without $or
  console.log('\n\nTesting query WITHOUT $or:');
  const paymentWithoutOr = await Payment.findOne({
    _id: payment._id,
    transferStatus: 'on_hold',
    earningsReleaseDate: { $lte: now },
    status: { $nin: ['refunded', 'partially_refunded', 'cancelled'] },
    processingAttempts: { $lt: 3 }
  });
  console.log('Found without $or:', !!paymentWithoutOr);
  
  // Test WITH $or
  console.log('\nTesting query WITH $or:');
  const paymentWithOr = await Payment.findOne({
    _id: payment._id,
    transferStatus: 'on_hold',
    earningsReleaseDate: { $lte: now },
    status: { $nin: ['refunded', 'partially_refunded', 'cancelled'] },
    processingAttempts: { $lt: 3 },
    $or: [
      { nextRetryAt: { $exists: false } },
      { nextRetryAt: null },
      { nextRetryAt: { $lte: now } }
    ]
  });
  console.log('Found with $or:', !!paymentWithOr);
  
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});





