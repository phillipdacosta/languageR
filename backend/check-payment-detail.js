const mongoose = require('mongoose');
require('dotenv').config();

const Payment = require('./models/Payment');
const User = require('./models/User');
const Lesson = require('./models/Lesson');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log('Connected to MongoDB\n');
  
  // Check the specific payment
  const payment = await Payment.findById('696e8f18d7826cf07e55dd67')
    .populate('studentId', 'name picture auth0Picture')
    .populate('tutorId', 'name')
    .populate('lessonId', 'startTime endTime')
    .lean();
  
  if (!payment) {
    console.log('Payment not found!');
    process.exit(1);
  }
  
  console.log('=== PAYMENT DETAILS ===');
  console.log('Payment ID:', payment._id);
  console.log('Status:', payment.status);
  console.log('Transfer Status:', payment.transferStatus);
  console.log('Earnings Release Date:', payment.earningsReleaseDate);
  console.log('\nStudent Details:');
  console.log('- Name:', payment.studentId?.name);
  console.log('- Picture:', payment.studentId?.picture);
  console.log('- Auth0 Picture:', payment.studentId?.auth0Picture);
  console.log('\nLesson Time:');
  console.log('- Start:', payment.lessonId?.startTime);
  console.log('- End:', payment.lessonId?.endTime);
  
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});




