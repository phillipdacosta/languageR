const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const User = require('./models/User');

async function checkUserType() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const user = await User.findOne({ email: 'phillip.dacosta@gmail.com' });
    
    if (!user) {
      console.log('❌ User not found');
      process.exit(1);
    }

    console.log('👤 User Details for phillip.dacosta@gmail.com:');
    console.log('   Name:', user.name);
    console.log('   Email:', user.email);
    console.log('   User Type:', user.userType);
    console.log('   Auth0 ID:', user.auth0Id);
    console.log('   Has Availability:', user.availability ? user.availability.length : 0);
    console.log('   Has Languages:', user.teachingLanguages ? user.teachingLanguages.length : 0);
    console.log('   Bio:', user.bio ? user.bio.substring(0, 50) : 'None');
    console.log('');
    
    console.log('🔍 Tutor-specific fields:');
    console.log('   hourlyRate:', user.hourlyRate || 'Not set');
    console.log('   teachingLanguages:', user.teachingLanguages || 'Not set');
    console.log('   spokenLanguages:', user.spokenLanguages || 'Not set');
    console.log('   specialty:', user.specialty || 'Not set');
    console.log('');
    
    console.log('✅ Expected frontend behavior:');
    console.log('   isTutor() should return:', user.userType === 'tutor');
    console.log('   Should see:', user.userType === 'tutor' ? 'Tutor dashboard' : 'Student dashboard');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkUserType();
