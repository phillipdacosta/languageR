const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const Notification = require('../models/Notification');
const User = require('../models/User');

dotenv.config({ path: path.resolve(__dirname, '../config.env') });

// Sample notification templates
const notificationTypes = [
  {
    type: 'lesson_created',
    titleTemplate: (i) => `Lesson Booked - Session ${i}`,
    messageTemplate: (i) => `Your Spanish lesson ${i} has been scheduled.`,
  },
  {
    type: 'lesson_reminder',
    titleTemplate: (i) => `Lesson Reminder ${i}`,
    messageTemplate: (i) => `Your lesson starts in 15 minutes!`,
  },
  {
    type: 'lesson_cancelled',
    titleTemplate: (i) => `Lesson Cancelled ${i}`,
    messageTemplate: (i) => `Unfortunately, your lesson has been cancelled.`,
  },
  {
    type: 'class_invitation',
    titleTemplate: (i) => `Class Invitation ${i}`,
    messageTemplate: (i) => `You've been invited to join a Spanish conversation class!`,
  },
  {
    type: 'class_accepted',
    titleTemplate: (i) => `Class Confirmed ${i}`,
    messageTemplate: (i) => `You're all set for the upcoming class!`,
  },
  {
    type: 'message',
    titleTemplate: (i) => `New Message ${i}`,
    messageTemplate: (i) => `You have a new message from your tutor.`,
  },
  {
    type: 'lesson_analysis_ready',
    titleTemplate: (i) => `Lesson Analysis Ready ${i}`,
    messageTemplate: (i) => `Your lesson analysis is ready to view!`,
  }
];

async function seedNotifications() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🔌 Connecting to MongoDB...');
    console.log('✅ Connected to MongoDB');

    const userEmail = 'travelbuggler@gmail.com';
    const user = await User.findOne({ email: userEmail });

    if (!user) {
      console.error(`❌ User with email ${userEmail} not found.`);
      return;
    }

    console.log(`✅ Found user: ${user.name} (${user.email})`);

    // Delete existing notifications for this user
    const deleteResult = await Notification.deleteMany({ userId: user._id });
    console.log(`🗑️  Deleting existing notifications for this user...`);
    console.log(`   Deleted ${deleteResult.deletedCount} existing notifications`);

    const notificationsToCreate = [];
    const numNotifications = 150; // Create 150 notifications for testing
    const today = new Date();
    let currentNotificationDate = new Date(today);
    currentNotificationDate.setDate(today.getDate() - 60); // Start 60 days ago

    for (let i = 0; i < numNotifications; i++) {
      // Pick a random notification type
      const template = notificationTypes[Math.floor(Math.random() * notificationTypes.length)];
      
      // Simulate realistic notification timing
      let delayMinutes;
      const random = Math.random();
      if (random < 0.5) { // 50% scattered throughout the day
        delayMinutes = Math.floor(Math.random() * 180) + 30; // 30 min to 3 hours
      } else if (random < 0.8) { // 30% larger gaps
        delayMinutes = Math.floor(Math.random() * 720) + 180; // 3 to 12 hours
      } else { // 20% very large gaps (days)
        delayMinutes = Math.floor(Math.random() * 2880) + 1440; // 1 to 3 days
      }

      currentNotificationDate = new Date(currentNotificationDate.getTime() + delayMinutes * 60 * 1000);

      // 70% read, 30% unread (more recent notifications more likely to be unread)
      const isRecent = i >= numNotifications - 20;
      const isRead = isRecent ? Math.random() < 0.3 : Math.random() < 0.7;

      notificationsToCreate.push({
        userId: user._id,
        type: template.type,
        title: template.titleTemplate(i + 1),
        message: template.messageTemplate(i + 1),
        data: { lessonId: `lesson-${i}`, studentId: user._id.toString() },
        read: isRead,
        readAt: isRead ? new Date(currentNotificationDate.getTime() + Math.random() * 60 * 60 * 1000) : null,
        createdAt: currentNotificationDate,
        updatedAt: currentNotificationDate,
        urgent: template.type === 'lesson_reminder' ? Math.random() < 0.3 : false
      });
    }

    console.log(`📚 Creating ${notificationsToCreate.length} notifications...`);
    await Notification.insertMany(notificationsToCreate);
    console.log(`✅ Created ${notificationsToCreate.length} notifications`);

    console.log('\n✨ Seeding complete!');
    console.log('📊 Summary:');
    console.log(`   - User: ${user.name} (${user.email})`);
    console.log(`   - Notifications created: ${notificationsToCreate.length}`);
    console.log(`   - Date range: ${notificationsToCreate[0].createdAt.toLocaleDateString()} to ${notificationsToCreate[notificationsToCreate.length - 1].createdAt.toLocaleDateString()}`);
    console.log(`   - Unread: ${notificationsToCreate.filter(n => !n.read).length}`);
    console.log(`   - Read: ${notificationsToCreate.filter(n => n.read).length}`);
    console.log('\n🧪 Test lazy loading by:');
    console.log('   1. Login as this user');
    console.log('   2. Open the notifications page');
    console.log('   3. Scroll down to the bottom');
    console.log('   4. Watch for the spinner and smooth loading!');

  } catch (error) {
    console.error('❌ Error seeding data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

seedNotifications();


