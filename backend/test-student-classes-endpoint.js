const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const User = require('./models/User');
const ClassModel = require('./models/Class');

async function testEndpoint() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const email = 'travbugg4@gmail.com';
    const student = await User.findOne({ email });
    
    if (!student) {
      console.log('❌ Student not found');
      process.exit(1);
    }

    console.log('Testing GET /api/classes/student/accepted endpoint logic...\n');
    
    // This is what the endpoint does:
    const classes = await ClassModel.find({
      confirmedStudents: student._id,
      endTime: { $gte: new Date() }
    })
    .populate('tutorId', 'name email picture firstName lastName')
    .populate('confirmedStudents', 'name email picture firstName lastName')
    .sort({ startTime: 1 });

    console.log('📚 Query results:');
    console.log('   Found classes:', classes.length);
    
    if (classes.length > 0) {
      classes.forEach((cls, i) => {
        console.log(`\n   Class ${i + 1}:`);
        console.log('      _id:', cls._id);
        console.log('      name:', cls.name);
        console.log('      startTime:', cls.startTime);
        console.log('      endTime:', cls.endTime);
        console.log('      tutorId:', cls.tutorId);
        console.log('      confirmedStudents:', cls.confirmedStudents.length);
        console.log('      capacity:', cls.capacity);
      });
    } else {
      console.log('   ⚠️ No classes found!');
      console.log('\n   Debugging:');
      console.log('   Student ID:', student._id);
      console.log('   Current time:', new Date());
      
      // Check all classes with this student
      const allStudentClasses = await ClassModel.find({
        'invitedStudents.studentId': student._id
      });
      
      console.log('   Total classes with this student invited:', allStudentClasses.length);
      
      allStudentClasses.forEach(cls => {
        const isConfirmed = cls.confirmedStudents.some(s => 
          s.toString() === student._id.toString()
        );
        const hasEnded = new Date(cls.endTime) < new Date();
        console.log(`      - ${cls.name}: confirmed=${isConfirmed}, ended=${hasEnded}`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testEndpoint();
