const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const User = require('./models/User');
const ClassModel = require('./models/Class');

async function checkCapacity() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const cls = await ClassModel.findOne({ name: 'Spanish 3' })
      .populate('tutorId', 'name email')
      .populate('confirmedStudents', 'name email');
    
    if (!cls) {
      console.log('❌ Spanish 3 class not found');
      process.exit(1);
    }

    console.log('📚 Spanish 3 Class Details:');
    console.log('   Capacity:', cls.capacity);
    console.log('   Tutor:', cls.tutorId.name);
    console.log('   Confirmed Students:', cls.confirmedStudents.length);
    console.log('');
    
    console.log('✅ Confirmed Students:');
    cls.confirmedStudents.forEach((student, i) => {
      console.log(`   ${i + 1}. ${student.name} (${student.email})`);
    });
    console.log('');
    
    console.log('📊 Capacity Check:');
    console.log('   Total participants (tutor + students):', 1 + cls.confirmedStudents.length);
    console.log('   Class capacity:', cls.capacity);
    console.log('   Seats available:', cls.capacity - cls.confirmedStudents.length);
    console.log('');
    
    console.log('🔍 Can each person join?');
    console.log('   Tutor (travelbuggler): ✅ Always can join (host)');
    cls.confirmedStudents.forEach((student) => {
      console.log(`   ${student.name}: ✅ Confirmed student, can join`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkCapacity();
