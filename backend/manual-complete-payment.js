const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const paymentService = require('./services/paymentService');

async function manuallyCompletePayment() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const lessonId = '695e8dd586616ae0a5bafc1f';
    
    console.log(`🔄 Manually calling completeLessonPayment for lesson ${lessonId}...`);
    
    await paymentService.completeLessonPayment(lessonId);
    
    console.log('✅ Payment completion process finished');
    console.log('💡 Check the PayPal sandbox account for the payout');

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

manuallyCompletePayment();

