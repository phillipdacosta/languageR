const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const User = require('./models/User');
const ClassModel = require('./models/Class');

async function testJoin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const email = 'phillip.dacosta@gmail.com';
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log('❌ User not found');
      process.exit(1);
    }

    console.log('👤 User:', user.name);
    console.log('🆔 User ID:', user._id);
    console.log('🔐 Auth0 ID:', user.auth0Id);
    console.log('');

    // Find the Spanish 3 class
    const cls = await ClassModel.findOne({ name: 'Spanish 3' })
      .populate('tutorId', 'name email')
      .populate('confirmedStudents', 'name email');
    
    if (!cls) {
      console.log('❌ Spanish 3 class not found');
      process.exit(1);
    }

    console.log('📚 Class: Spanish 3');
    console.log('🆔 Class ID:', cls._id);
    console.log('👨‍🏫 Tutor:', cls.tutorId.name);
    console.log('👨‍🏫 Tutor ID:', cls.tutorId._id);
    console.log('');
    
    console.log('✅ Confirmed Students:');
    cls.confirmedStudents.forEach((student, i) => {
      console.log(`   ${i + 1}. ${student.name} (${student.email})`);
      console.log(`      ID: ${student._id}`);
    });
    console.log('');

    // Check authorization
    const userIdStr = user._id.toString();
    const isTutor = cls.tutorId._id.toString() === userIdStr;
    const isConfirmedStudent = cls.confirmedStudents.some(s => 
      s._id.toString() === userIdStr
    );

    console.log('🔍 Authorization Check:');
    console.log('   User ID (string):', userIdStr);
    console.log('   Is Tutor:', isTutor);
    console.log('   Is Confirmed Student:', isConfirmedStudent);
    console.log('   Can Join:', isTutor || isConfirmedStudent);
    console.log('');

    // Check time window
    const now = new Date();
    const start = new Date(cls.startTime);
    const end = new Date(cls.endTime);
    const JOIN_EARLY_MINUTES = 15;
    const END_GRACE_MINUTES = 5;
    const earliestJoin = new Date(start.getTime() - JOIN_EARLY_MINUTES * 60000);
    const latestJoin = new Date(end.getTime() + END_GRACE_MINUTES * 60000);

    console.log('⏰ Time Window Check:');
    console.log('   Current time:', now.toLocaleString());
    console.log('   Class start:', start.toLocaleString());
    console.log('   Class end:', end.toLocaleString());
    console.log('   Earliest join:', earliestJoin.toLocaleString());
    console.log('   Latest join:', latestJoin.toLocaleString());
    console.log('   Can join (time):', now >= earliestJoin && now <= latestJoin);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testJoin();
