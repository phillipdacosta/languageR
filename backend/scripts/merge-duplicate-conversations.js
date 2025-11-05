const mongoose = require('mongoose');
const Message = require('../models/Message');

// Load environment variables
require('dotenv').config({ path: './config.env' });

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

async function mergeDuplicateConversations() {
  try {
    console.log('🔍 Finding all messages...');
    
    const allMessages = await Message.find({}).sort({ createdAt: 1 });
    console.log(`Found ${allMessages.length} total messages`);

    let updateCount = 0;

    for (const message of allMessages) {
      let needsUpdate = false;
      const updates = {};

      // Fix senderId: remove 'dev-user-' prefix if it doesn't have it, or normalize it
      if (message.senderId && !message.senderId.startsWith('dev-user-')) {
        updates.senderId = `dev-user-${message.senderId}`;
        needsUpdate = true;
      }

      // Fix receiverId: remove 'dev-user-' prefix if it doesn't have it, or normalize it
      if (message.receiverId && !message.receiverId.startsWith('dev-user-')) {
        updates.receiverId = `dev-user-${message.receiverId}`;
        needsUpdate = true;
      }

      if (needsUpdate) {
        // Recalculate conversationId with corrected IDs
        const correctedSenderId = updates.senderId || message.senderId;
        const correctedReceiverId = updates.receiverId || message.receiverId;
        const ids = [correctedSenderId, correctedReceiverId].sort();
        updates.conversationId = `${ids[0]}_${ids[1]}`;

        console.log(`\n📝 Updating message ${message._id}:`);
        console.log(`   Old: ${message.conversationId}`);
        console.log(`   New: ${updates.conversationId}`);
        console.log(`   SenderId: ${message.senderId} → ${updates.senderId || message.senderId}`);
        console.log(`   ReceiverId: ${message.receiverId} → ${updates.receiverId || message.receiverId}`);

        await Message.updateOne({ _id: message._id }, { $set: updates });
        updateCount++;
      }
    }

    console.log(`\n✅ Updated ${updateCount} messages`);
    console.log('🔍 Checking for remaining duplicates...');

    const updatedMessages = await Message.find({}).sort({ createdAt: 1 });
    const conversations = new Set(updatedMessages.map(m => m.conversationId));
    console.log(`Now have ${conversations.size} unique conversation(s)`);

    process.exit(0);
  } catch (error) {
    console.error('Error merging conversations:', error);
    process.exit(1);
  }
}

mergeDuplicateConversations();

