/**
 * Seed test messages for lazy loading testing
 * Creates 150 messages between travelbuggler@gmail.com and phillip.dacosta@gmail.com
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'config.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Message = require('../models/Message');

const MONGODB_URI = process.env.MONGODB_URI;
const USER1_EMAIL = 'travelbuggler@gmail.com';
const USER2_EMAIL = 'phillip.dacosta@gmail.com';
const MESSAGE_COUNT = 150; // Generate 150 messages for thorough lazy loading testing

// Sample message content for variety
const messageTemplates = [
  "Hey, how's it going?",
  "I'm excited about our next lesson!",
  "Could we reschedule to next week?",
  "That sounds great, looking forward to it.",
  "What time works best for you?",
  "Perfect! See you then.",
  "Thanks for the session today, very helpful!",
  "I have a question about the homework.",
  "Can you help me with pronunciation?",
  "Let me know when you're available.",
  "I'm making good progress with my studies.",
  "Do you have any recommendations for practice?",
  "That lesson was really informative.",
  "I appreciate your patience!",
  "Could we focus on conversation next time?",
  "I'll send you the materials shortly.",
  "Great job on your progress!",
  "Let's work on grammar in our next session.",
  "I'm available Tuesday afternoon.",
  "See you soon!",
  "Thanks for checking in.",
  "I've been practicing every day.",
  "Your teaching style really helps me understand.",
  "Looking forward to tomorrow's class.",
  "Can we review what we learned last time?",
  "I'll be there at 3 PM.",
  "That makes sense now, thank you!",
  "I have a busy week, but I'm committed.",
  "Your feedback is always helpful.",
  "I'm ready for the next challenge!",
];

// Helper to get a random message
function getRandomMessage() {
  return messageTemplates[Math.floor(Math.random() * messageTemplates.length)];
}

// Helper to add minutes to a date
function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

async function seedMessages() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find both users
    const user1 = await User.findOne({ email: USER1_EMAIL });
    const user2 = await User.findOne({ email: USER2_EMAIL });

    if (!user1) {
      console.error(`❌ User not found: ${USER1_EMAIL}`);
      process.exit(1);
    }
    if (!user2) {
      console.error(`❌ User not found: ${USER2_EMAIL}`);
      process.exit(1);
    }

    console.log(`✅ Found user 1: ${user1.name} (${user1.email})`);
    console.log(`✅ Found user 2: ${user2.name} (${user2.email})`);

    // Delete existing messages between these two users
    console.log('🗑️  Deleting existing messages between these users...');
    const deleteResult = await Message.deleteMany({
      $or: [
        { senderId: user1.auth0Id, receiverId: user2.auth0Id },
        { senderId: user2.auth0Id, receiverId: user1.auth0Id }
      ]
    });
    console.log(`   Deleted ${deleteResult.deletedCount} existing messages`);

    // Generate conversation ID (same format as backend)
    const conversationId = [user1.auth0Id, user2.auth0Id].sort().join('_');
    console.log(`💬 Conversation ID: ${conversationId}`);

    // Create messages spanning 30 days back
    const messages = [];
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);

    // Generate messages with realistic timing (some gaps, some bursts)
    let currentTime = new Date(thirtyDaysAgo);
    let messagesCreated = 0;

    while (messagesCreated < MESSAGE_COUNT && currentTime < now) {
      // Decide who sends this message (alternate with some randomness)
      const sender = messagesCreated % 2 === 0 ? user1 : user2;
      const receiver = sender.auth0Id === user1.auth0Id ? user2 : user1;

      // Create message
      messages.push({
        conversationId: conversationId,
        senderId: sender.auth0Id,
        receiverId: receiver.auth0Id,
        content: getRandomMessage(),
        type: 'text',
        read: true, // Mark older messages as read
        createdAt: new Date(currentTime),
        sender: {
          id: sender._id,
          name: sender.name,
          picture: sender.picture
        }
      });

      messagesCreated++;

      // Vary the time between messages (realistic conversation patterns)
      // 70% quick responses (1-5 minutes), 20% gaps (1-3 hours), 10% long gaps (4-24 hours)
      const rand = Math.random();
      if (rand < 0.7) {
        // Quick response: 1-5 minutes
        currentTime = addMinutes(currentTime, Math.floor(Math.random() * 5) + 1);
      } else if (rand < 0.9) {
        // Medium gap: 1-3 hours
        currentTime = addMinutes(currentTime, Math.floor(Math.random() * 180) + 60);
      } else {
        // Long gap: 4-24 hours
        currentTime = addMinutes(currentTime, Math.floor(Math.random() * 1200) + 240);
      }
    }

    // Mark the last 5 messages as unread (from user2 to user1) for realism
    for (let i = messages.length - 5; i < messages.length; i++) {
      if (messages[i] && messages[i].senderId === user2.auth0Id) {
        messages[i].read = false;
      }
    }

    // Bulk insert messages
    console.log(`📚 Creating ${messages.length} messages...`);
    await Message.insertMany(messages);

    console.log('\n✨ Seeding complete!');
    console.log(`📊 Summary:`);
    console.log(`   - User 1: ${user1.name} (${user1.email})`);
    console.log(`   - User 2: ${user2.name} (${user2.email})`);
    console.log(`   - Messages created: ${messages.length}`);
    console.log(`   - Date range: ${thirtyDaysAgo.toLocaleDateString()} to ${now.toLocaleDateString()}`);
    console.log(`   - Conversation ID: ${conversationId}`);
    console.log(`\n🧪 Test lazy loading by:`);
    console.log(`   1. Login as either user`);
    console.log(`   2. Open messages with the other user`);
    console.log(`   3. Scroll up to the top to load older messages`);
    console.log(`   4. Watch for the spinner and smooth loading!`);

    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
    
  } catch (error) {
    console.error('❌ Error seeding messages:', error);
    process.exit(1);
  }
}

// Run the seeding script
seedMessages();



