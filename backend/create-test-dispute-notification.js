const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const User = require('./models/User');
const Notification = require('./models/Notification');
const Lesson = require('./models/Lesson');
const { formatNameWithInitial } = require('./utils/nameFormatter');

async function createTestNotification() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find the user by email
    const user = await User.findOne({ email: 'baseathleticsdev@gmail.com' });
    
    if (!user) {
      console.error('❌ User not found with email: baseathleticsdev@gmail.com');
      process.exit(1);
    }

    console.log(`✅ Found user: ${user.name} (${user._id})`);

    // Check if user is a tutor
    if (user.userType !== 'tutor') {
      console.log(`⚠️  User is not a tutor (userType: ${user.userType}). Creating notification anyway...`);
    }

    // Find or create a test lesson (we'll use an existing lesson or create minimal data)
    // Let's find a recent lesson for this tutor, or use a placeholder
    let testLesson = await Lesson.findOne({ tutorId: user._id }).populate('studentId tutorId');
    
    // If no lesson exists, we'll create a minimal test notification with placeholder data
    if (!testLesson) {
      console.log('⚠️  No existing lesson found. Creating notification with placeholder data...');
      
      // Create notification with placeholder data
      const notification = await Notification.create({
        userId: user._id,
        type: 'payment_cancelled',
        title: 'Payment Cancelled',
        message: `Payment for your lesson with <strong>Test Student</strong> has been <strong>cancelled</strong> due to investigation findings.`,
        link: `/tabs/home/earnings`,
        data: {
          lessonId: new mongoose.Types.ObjectId(), // Placeholder lesson ID
          studentId: new mongoose.Types.ObjectId(),
          studentName: 'Test Student',
          tutorId: user._id,
          tutorName: formatNameWithInitial(user) || 'Test Tutor',
          scheduledAt: new Date(),
          amount: 25.00,
          reason: 'This is a test notification for dispute functionality. The admin investigation found that the lesson did not meet quality standards. You can dispute this decision by clicking the Dispute button below.',
          resolution: 'refunded',
          canDispute: true
        }
      });

      console.log('✅ Test notification created with placeholder data');
      console.log(`   Notification ID: ${notification._id}`);
      console.log(`   Type: ${notification.type}`);
      console.log(`   Message: ${notification.message}`);
      return;
    }

    // Use real lesson data
    const studentDisplayName = formatNameWithInitial(testLesson.studentId) || 'Student';
    const tutorDisplayName = formatNameWithInitial(user) || 'Tutor';

    const notification = await Notification.create({
      userId: user._id,
      type: 'payment_cancelled',
      title: 'Payment Cancelled',
      message: `Payment for your lesson with <strong>${studentDisplayName}</strong> has been <strong>cancelled</strong> due to investigation findings.`,
      link: `/tabs/earnings`,
      data: {
        lessonId: testLesson._id,
        studentId: testLesson.studentId?._id || new mongoose.Types.ObjectId(),
        studentName: studentDisplayName,
        tutorId: user._id,
        tutorName: tutorDisplayName,
        scheduledAt: testLesson.scheduledAt || new Date(),
        amount: testLesson.price || 25.00,
        reason: 'This is a TEST notification for dispute functionality. The admin investigation found that the lesson did not meet quality standards. You can dispute this decision by clicking the Dispute button below.',
        resolution: 'refunded',
        canDispute: true
      }
    });

    console.log('✅ Test notification created successfully!');
    console.log(`   Notification ID: ${notification._id}`);
    console.log(`   Type: ${notification.type}`);
    console.log(`   Lesson ID: ${testLesson._id}`);
    console.log(`   Student: ${studentDisplayName}`);
    console.log(`   Amount: $${testLesson.price || 25.00}`);
    console.log(`   Message: ${notification.message}`);
    console.log('\n📱 You can now test the dispute functionality in the app!');

  } catch (error) {
    console.error('❌ Error creating test notification:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the script
createTestNotification();

