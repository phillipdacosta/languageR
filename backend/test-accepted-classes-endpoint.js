const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const User = require('./models/User');
const ClassModel = require('./models/Class');

async function testEndpoint() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const email = 'phillip.dacosta@gmail.com';
    const student = await User.findOne({ email });
    
    if (!student) {
      console.log('❌ Student not found');
      process.exit(1);
    }

    console.log('Testing GET /api/classes/student/accepted endpoint for', email);
    console.log('Student ID:', student._id);
    console.log('');
    
    // This is what the endpoint does:
    const classes = await ClassModel.find({
      confirmedStudents: student._id,
      endTime: { $gte: new Date() }
    })
    .populate('tutorId', 'name email picture firstName lastName')
    .populate('confirmedStudents', 'name email picture firstName lastName')
    .sort({ startTime: 1 });

    console.log('📚 Accepted classes (not ended):', classes.length);
    
    if (classes.length > 0) {
      classes.forEach((cls, i) => {
        console.log(`\n   ${i + 1}. ${cls.name}`);
        console.log('      Class ID:', cls._id);
        console.log('      Start:', new Date(cls.startTime).toLocaleString());
        console.log('      End:', new Date(cls.endTime).toLocaleString());
        console.log('      Tutor:', cls.tutorId?.name);
        console.log('      Confirmed students:', cls.confirmedStudents.length);
        cls.confirmedStudents.forEach(s => {
          console.log(`         - ${s.name} (${s.email})`);
        });
      });
    } else {
      console.log('   ⚠️ No accepted classes found!');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testEndpoint();
