const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const paymentService = require('./services/paymentService');

async function fixBrokenLesson() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const lessonId = '695e9ce669c1ada98e9a4390';
    
    console.log(`\n🔧 Fixing lesson ${lessonId}...`);
    console.log(`This lesson was ended early and payment was captured but PayPal payout was not sent.`);
    console.log(`Manually sending PayPal payout now...\n`);
    
    // Call completeLessonPayment to send the PayPal payout
    // This will check if revenue is already recognized and skip duplicate processing
    await paymentService.completeLessonPayment(lessonId);
    
    console.log('\n✅ PayPal payout sent successfully!');
    console.log('💡 Check PayPal sandbox account: sb-zhm43m48595821@business.example.com');

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixBrokenLesson();

