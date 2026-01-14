require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const Payment = require('./models/Payment');
const Lesson = require('./models/Lesson');
const User = require('./models/User');

async function checkAllRecentPayouts() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not found in config.env');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find ALL payments for the tutor in the last 24 hours
    const tutor = await User.findOne({ email: 'baseathleticsdev@gmail.com' });
    
    if (!tutor) {
      console.log('❌ Tutor not found');
      return;
    }

    const allPayments = await Payment.find({
      tutorId: tutor._id,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    })
    .populate('lessonId')
    .sort({ createdAt: -1 });

    console.log(`\n📊 Found ${allPayments.length} total payments in last 24 hours\n`);

    allPayments.forEach((payment, index) => {
      console.log(`\n${index + 1}. Payment ID: ${payment._id}`);
      console.log(`   Lesson ID: ${payment.lessonId?._id || 'N/A'}`);
      console.log(`   Amount: $${payment.amount}`);
      console.log(`   Platform Fee: $${payment.platformFee}`);
      console.log(`   Tutor Payout: $${payment.tutorPayout}`);
      console.log(`   Payment Method: ${payment.paymentMethod}`);
      console.log(`   Status: ${payment.status}`);
      console.log(`   Transfer Status: ${payment.transferStatus}`);
      console.log(`   PayPal Batch ID: ${payment.paypalBatchId || 'N/A'}`);
      console.log(`   PayPal Status: ${payment.paypalPayoutStatus || 'N/A'}`);
      console.log(`   Created At: ${payment.createdAt}`);
      console.log(`   Transferred At: ${payment.transferredAt || 'N/A'}`);
    });

    // Count PayPal payouts that succeeded
    const successfulPayouts = allPayments.filter(p => 
      p.paypalBatchId && 
      p.transferStatus === 'succeeded'
    );
    
    console.log(`\n\n💰 Total successful PayPal payouts: ${successfulPayouts.length}`);
    
    // Group by PayPal batch ID to see if any batches have multiple payments
    const batchGroups = {};
    successfulPayouts.forEach(p => {
      if (!batchGroups[p.paypalBatchId]) {
        batchGroups[p.paypalBatchId] = [];
      }
      batchGroups[p.paypalBatchId].push(p);
    });
    
    console.log(`\n📦 PayPal Batch Groups:`);
    Object.entries(batchGroups).forEach(([batchId, payments]) => {
      console.log(`\n   Batch ${batchId}: ${payments.length} payment(s)`);
      payments.forEach(p => {
        console.log(`      - Payment ${p._id}: $${p.tutorPayout} for Lesson ${p.lessonId?._id}`);
      });
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

checkAllRecentPayouts().catch(console.error);

