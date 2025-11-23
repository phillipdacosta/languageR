const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const ClassModel = require('./models/Class');
const User = require('./models/User');

async function checkStudentClasses() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const email = process.argv[2] || 'travelbuggler@gmail.com';
    
    const student = await User.findOne({ email });
    if (!student) {
      console.log('❌ Student not found:', email);
      process.exit(1);
    }

    console.log('👤 Student:', student.name || email);
    console.log('📧 Email:', student.email);
    console.log('🆔 ID:', student._id);
    console.log('');

    // Find all classes where student is invited
    const allClasses = await ClassModel.find({
      'invitedStudents.studentId': student._id
    })
    .populate('tutorId', 'name email')
    .sort({ startTime: 1 });

    console.log('📚 Total classes with invitations:', allClasses.length);
    console.log('');

    allClasses.forEach((cls, index) => {
      console.log(`\n📖 Class ${index + 1}:`);
      console.log('   Name:', cls.name);
      console.log('   Tutor:', cls.tutorId?.name || cls.tutorId?.email);
      console.log('   Start:', new Date(cls.startTime).toLocaleString());
      console.log('   End:', new Date(cls.endTime).toLocaleString());
      console.log('   Capacity:', cls.capacity);
      console.log('   Confirmed students:', cls.confirmedStudents.length);
      
      const invitation = cls.invitedStudents.find(inv => 
        inv.studentId.toString() === student._id.toString()
      );
      console.log('   Invitation status:', invitation?.status || 'not found');
      
      const isConfirmed = cls.confirmedStudents.some(s => 
        s.toString() === student._id.toString()
      );
      console.log('   Student is confirmed:', isConfirmed);
      
      const now = new Date();
      const ended = new Date(cls.endTime) < now;
      console.log('   Has ended:', ended);
    });

    // Find classes where student is confirmed
    const confirmedClasses = await ClassModel.find({
      confirmedStudents: student._id,
      endTime: { $gte: new Date() }
    })
    .populate('tutorId', 'name email')
    .sort({ startTime: 1 });

    console.log('\n\n✅ Confirmed classes (not ended):', confirmedClasses.length);
    confirmedClasses.forEach((cls, index) => {
      console.log(`\n  ${index + 1}. ${cls.name}`);
      console.log('     Start:', new Date(cls.startTime).toLocaleString());
      console.log('     End:', new Date(cls.endTime).toLocaleString());
      console.log('     Tutor:', cls.tutorId?.name);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkStudentClasses();
