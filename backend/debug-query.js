const mongoose = require('mongoose');
require('dotenv').config();

const Payment = require('./models/Payment');
const Lesson = require('./models/Lesson');
const User = require('./models/User');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log('Connected to MongoDB\n');
  
  const now = new Date();
  const MAX_ATTEMPTS = 3;
  
  console.log('Current Time:', now.toISOString());
  console.log('\n=== CHECKING QUERY CONDITIONS ===\n');
  
  // Test the exact query from releaseEarnings.js
  const query = {
    transferStatus: 'on_hold',
    earningsReleaseDate: { $lte: now },
    status: { $nin: ['refunded', 'partially_refunded', 'cancelled'] },
    processingAttempts: { $lt: MAX_ATTEMPTS },
    $or: [
      { nextRetryAt: { $exists: false } },
      { nextRetryAt: null },
      { nextRetryAt: { $lte: now } }
    ]
  };
  
  console.log('Query:', JSON.stringify(query, null, 2));
  
  const payments = await Payment.find(query)
    .populate('tutorId', 'name email')
    .populate('lessonId', 'payoutPaused')
    .limit(10)
    .lean();
  
  console.log('\n=== QUERY RESULTS ===');
  console.log('Found:', payments.length, 'payments');
  
  payments.forEach(p => {
    console.log('\n---');
    console.log('Payment ID:', p._id);
    console.log('Tutor:', p.tutorId?.name);
    console.log('Amount:', p.tutorPayout);
    console.log('Status:', p.status);
    console.log('Transfer Status:', p.transferStatus);
    console.log('Release Date:', p.earningsReleaseDate);
    console.log('Processing Attempts:', p.processingAttempts || 0);
    console.log('Payout Paused:', p.lessonId?.payoutPaused || false);
  });
  
  // Now check all on_hold payments regardless of query
  console.log('\n\n=== ALL ON_HOLD PAYMENTS (NO FILTERS) ===');
  const allOnHold = await Payment.find({ transferStatus: 'on_hold' }).lean();
  console.log('Total on_hold:', allOnHold.length);
  
  allOnHold.forEach(p => {
    console.log('\n---');
    console.log('ID:', p._id);
    console.log('Status:', p.status);
    console.log('Transfer Status:', p.transferStatus);
    console.log('Release Date:', p.earningsReleaseDate);
    console.log('Release Date <= Now:', p.earningsReleaseDate ? new Date(p.earningsReleaseDate) <= now : 'NO DATE');
    console.log('Status is valid:', !['refunded', 'partially_refunded', 'cancelled'].includes(p.status));
    console.log('Processing Attempts:', p.processingAttempts || 0, '< 3:', (p.processingAttempts || 0) < 3);
  });
  
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});



