const mongoose = require('mongoose');
require('dotenv').config();

const Payment = require('./models/Payment');
const User = require('./models/User');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log('Connected to MongoDB\n');
  
  // Find the tutor
  const tutor = await User.findOne({ name: 'baseathleticsdev' });
  
  if (!tutor) {
    console.log('Tutor not found!');
    process.exit(1);
  }
  
  console.log('=== TUTOR DATABASE BALANCE ===');
  console.log('Tutor Name:', tutor.name);
  console.log('Tutor ID:', tutor._id);
  console.log('\nDatabase tutorEarnings:');
  console.log('- Available:', tutor.tutorEarnings?.availableBalance || 0);
  console.log('- Pending:', tutor.tutorEarnings?.pendingBalance || 0);
  console.log('- Lifetime:', tutor.tutorEarnings?.lifetimeEarnings || 0);
  
  // Calculate real-time from payments
  console.log('\n=== CALCULATED FROM PAYMENTS ===');
  
  const availablePayments = await Payment.find({
    tutorId: tutor._id,
    transferStatus: 'available',
    status: { $nin: ['refunded', 'cancelled'] }
  }).lean();
  
  const pendingPayments = await Payment.find({
    tutorId: tutor._id,
    transferStatus: 'on_hold',
    status: { $nin: ['refunded', 'cancelled'] }
  }).lean();
  
  const calculatedAvailable = availablePayments.reduce((sum, p) => sum + (p.tutorPayout || 0), 0);
  const calculatedPending = pendingPayments.reduce((sum, p) => sum + (p.tutorPayout || 0), 0);
  
  console.log('Available Payments:', availablePayments.length);
  console.log('Available Amount:', calculatedAvailable);
  availablePayments.forEach(p => {
    console.log(`  - Payment ${p._id}: $${p.tutorPayout}, status: ${p.status}, transferStatus: ${p.transferStatus}`);
  });
  
  console.log('\nPending Payments:', pendingPayments.length);
  console.log('Pending Amount:', calculatedPending);
  pendingPayments.forEach(p => {
    console.log(`  - Payment ${p._id}: $${p.tutorPayout}, status: ${p.status}, transferStatus: ${p.transferStatus}`);
  });
  
  console.log('\n=== DISCREPANCY CHECK ===');
  const availableDiscrepancy = Math.abs(calculatedAvailable - (tutor.tutorEarnings?.availableBalance || 0));
  const pendingDiscrepancy = Math.abs(calculatedPending - (tutor.tutorEarnings?.pendingBalance || 0));
  
  console.log('Available discrepancy:', availableDiscrepancy > 0.01 ? `⚠️  $${availableDiscrepancy.toFixed(2)}` : '✅ Match');
  console.log('Pending discrepancy:', pendingDiscrepancy > 0.01 ? `⚠️  $${pendingDiscrepancy.toFixed(2)}` : '✅ Match');
  
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});



