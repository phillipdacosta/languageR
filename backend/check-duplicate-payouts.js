require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const Payment = require('./models/Payment');
const Lesson = require('./models/Lesson'); // Import Lesson model
const User = require('./models/User'); // Import User model

async function checkDuplicatePayouts() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not found in config.env');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find recent PayPal payouts for $10
    const recentPayouts = await Payment.find({
      tutorPayout: 10,
      paypalBatchId: { $exists: true, $ne: null },
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
    })
    .populate('lessonId')
    .populate('tutorId', 'email name')
    .sort({ createdAt: -1 });

    console.log(`\n📊 Found ${recentPayouts.length} recent PayPal payouts for $10\n`);

    recentPayouts.forEach((payment, index) => {
      console.log(`\n${index + 1}. Payment ID: ${payment._id}`);
      console.log(`   Lesson ID: ${payment.lessonId?._id || 'N/A'}`);
      console.log(`   Tutor: ${payment.tutorId?.email || 'N/A'}`);
      console.log(`   Amount: $${payment.amount}`);
      console.log(`   Tutor Payout: $${payment.tutorPayout}`);
      console.log(`   PayPal Batch ID: ${payment.paypalBatchId}`);
      console.log(`   PayPal Status: ${payment.paypalPayoutStatus}`);
      console.log(`   Transfer Status: ${payment.transferStatus}`);
      console.log(`   Created At: ${payment.createdAt}`);
      console.log(`   Transferred At: ${payment.transferredAt || 'N/A'}`);
    });

    // Check for duplicate lesson IDs
    const lessonIds = recentPayouts.map(p => p.lessonId?._id?.toString()).filter(Boolean);
    const duplicateLessons = lessonIds.filter((id, index) => lessonIds.indexOf(id) !== index);
    
    if (duplicateLessons.length > 0) {
      console.log(`\n⚠️ WARNING: Found duplicate payouts for the same lesson(s):`);
      const uniqueDuplicates = [...new Set(duplicateLessons)];
      
      for (const lessonId of uniqueDuplicates) {
        const paymentsForLesson = recentPayouts.filter(p => p.lessonId?._id?.toString() === lessonId);
        console.log(`\n🔴 Lesson ${lessonId} has ${paymentsForLesson.length} payments:`);
        paymentsForLesson.forEach(p => {
          console.log(`   - Payment ${p._id}: Batch ${p.paypalBatchId}, Status: ${p.transferStatus}`);
        });
      }
    } else {
      console.log(`\n✅ No duplicate lessons found`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

checkDuplicatePayouts().catch(console.error);
