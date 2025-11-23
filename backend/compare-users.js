const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const User = require('./models/User');

async function compareUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const emails = [
      'travbugg4@gmail.com',
      'phillip.dacosta@gmail.com',
      'travelbuggler@gmail.com'
    ];

    console.log('Comparing users:\n');

    for (const email of emails) {
      const user = await User.findOne({ email });
      if (user) {
        console.log(`📧 ${email}`);
        console.log(`   Name: ${user.name}`);
        console.log(`   ID: ${user._id}`);
        console.log(`   Auth0 ID: ${user.auth0Id}`);
        console.log(`   User Type: ${user.userType}`);
        console.log('');
      } else {
        console.log(`❌ User not found: ${email}\n`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

compareUsers();
