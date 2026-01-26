const mongoose = require('mongoose');
require('dotenv').config();

// Import required models
const Payment = require('./models/Payment');
const User = require('./models/User');
const Lesson = require('./models/Lesson');
const Notification = require('./models/Notification');
const Alert = require('./models/Alert');

const { triggerManualRelease } = require('./jobs/releaseEarnings');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log('Connected to MongoDB');
  
  console.log('🔧 Manually triggering release earnings job...\n');
  const result = await triggerManualRelease();
  
  console.log('\n✅ Manual release complete:', result);
  
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

