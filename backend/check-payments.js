const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const Payment = require('./models/Payment');
const Lesson = require('./models/Lesson');
const User = require('./models/User');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log('Connected to MongoDB');
  
  const payments = await Payment.find({ 
    transferStatus: 'on_hold'
  })
  .populate('lessonId', 'endTime startTime subject')
  .populate('tutorId', 'name email')
  .sort({ earningsReleaseDate: 1 })
  .limit(10)
  .lean();
  
  console.log('\n=== ON HOLD PAYMENTS ===');
  console.log('Total:', payments.length);
  console.log('Current Time:', new Date().toISOString());
  
  payments.forEach(p => {
    const lessonEnd = p.lessonId?.endTime;
    const releaseDate = p.earningsReleaseDate;
    const now = new Date();
    const isPastRelease = releaseDate ? new Date(releaseDate) <= now : false;
    
    console.log('\n---');
    console.log('Payment ID:', p._id);
    console.log('Tutor:', p.tutorId?.name);
    console.log('Amount:', p.tutorPayout);
    console.log('Lesson End:', lessonEnd);
    console.log('Release Date:', releaseDate);
    console.log('Should Release:', isPastRelease);
    console.log('Status:', p.status);
    console.log('Processing Attempts:', p.processingAttempts || 0);
  });
  
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});





