const express = require('express');
const router = express.Router();
const multer = require('multer');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const { initializeGCS } = require('../config/gcs');
const Message = require('../models/Message');
const User = require('../models/User');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

// In-memory storage for real-time messages (in production, use Redis or similar)
const channelMessages = new Map();

// Send a message to a channel (lesson)
router.post('/channels/:channelName/messages', verifyToken, async (req, res) => {
  try {
    const { channelName } = req.params;
    const { type, payload } = req.body;
    const userId = req.user.sub;

    const message = {
      id: Date.now().toString(),
      channelName,
      type, // 'whiteboard' or 'chat'
      payload,
      userId,
      timestamp: new Date().toISOString()
    };

    // Store message in channel
    if (!channelMessages.has(channelName)) {
      channelMessages.set(channelName, []);
    }
    
    const messages = channelMessages.get(channelName);
    messages.push(message);
    
    // Keep only last 100 messages per channel
    if (messages.length > 100) {
      messages.splice(0, messages.length - 100);
    }

    console.log(`📨 Message sent to channel ${channelName}:`, { type, userId });

    res.json({
      success: true,
      message: 'Message sent successfully',
      messageId: message.id
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message'
    });
  }
});

// Get messages from a channel since a timestamp
router.get('/channels/:channelName/messages', verifyToken, async (req, res) => {
  try {
    const { channelName } = req.params;
    const { since } = req.query; // ISO timestamp
    const userId = req.user.sub;

    const messages = channelMessages.get(channelName) || [];
    
    // Filter messages since the given timestamp and exclude own messages
    const sinceDate = since ? new Date(since) : new Date(0);
    const filteredMessages = messages.filter(msg => 
      new Date(msg.timestamp) > sinceDate && msg.userId !== userId
    );

    res.json({
      success: true,
      messages: filteredMessages,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get messages',
      messages: []
    });
  }
});

// Clear messages for a channel (for whiteboard clear)
router.delete('/channels/:channelName/messages', verifyToken, async (req, res) => {
  try {
    const { channelName } = req.params;
    
    if (channelMessages.has(channelName)) {
      channelMessages.set(channelName, []);
    }

    res.json({
      success: true,
      message: 'Messages cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear messages'
    });
  }
});

// User-to-user messaging endpoints

// Get all conversations for the current user
router.get('/conversations', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    
    // Get all unique conversations where user is sender or receiver
    // Also include conversations with system messages that are visible to tutor only (if user is tutor)
    const user = await User.findOne({ auth0Id: userId });
    const isTutor = user && user.userType === 'tutor';
    
    let messageQuery = {
      $or: [{ senderId: userId }, { receiverId: userId }]
    };
    
    // If user is a tutor, also include system messages where they are the receiver
    // (potential student conversations)
    if (isTutor) {
      messageQuery = {
        $or: [
          { senderId: userId },
          { receiverId: userId },
          // Include system messages where tutor is receiver (potential student conversations)
          { receiverId: userId, isSystemMessage: true, visibleToTutorOnly: true }
        ]
      };
    }
    
    const messages = await Message.find(messageQuery).sort({ createdAt: -1 });

    // Group by conversation and get latest message
    const conversationMap = new Map();
    
    for (const message of messages) {
      // Skip system messages with senderId 'system' when determining otherUserId
      // For system messages, the otherUserId is the student (if tutor is viewing)
      // System messages have receiverId = tutorId, so the student is the other user in the conversation
      let otherUserId;
      if (message.isSystemMessage && message.senderId === 'system') {
        // For system messages, receiverId is always the tutor
        // The conversationId format is: sorted(studentId, tutorId) joined by '_'
        // Since we know receiverId (tutorId), we can extract the studentId
        // by removing the receiverId from the conversationId
        const receiverId = message.receiverId;
        const conversationId = message.conversationId;
        
        // Remove receiverId from conversationId to get studentId
        // Handle both cases: receiverId at start or end
        if (conversationId.startsWith(receiverId + '_')) {
          otherUserId = conversationId.substring(receiverId.length + 1);
        } else if (conversationId.endsWith('_' + receiverId)) {
          otherUserId = conversationId.substring(0, conversationId.length - receiverId.length - 1);
        } else {
          // Fallback: if receiverId is not at start or end, try splitting
          // This should not happen with our current ID format, but handle it anyway
          const parts = conversationId.split('_');
          const receiverIndex = parts.indexOf(receiverId);
          if (receiverIndex !== -1) {
            parts.splice(receiverIndex, 1);
            otherUserId = parts.join('_');
          } else {
            // Last resort: skip this message if we can't determine the student
            console.warn('Could not extract studentId from system message conversationId:', conversationId, 'receiverId:', receiverId);
            continue;
          }
        }
      } else {
        otherUserId = message.senderId === userId ? message.receiverId : message.senderId;
      }
      
      // Skip messages where otherUserId is 'system' or empty
      if (otherUserId === 'system' || !otherUserId) {
        continue;
      }
      
      const ids = [userId, otherUserId].sort();
      const conversationId = `${ids[0]}_${ids[1]}`;
      
      if (!conversationMap.has(conversationId)) {
        conversationMap.set(conversationId, {
          conversationId,
          otherUserId,
          lastMessage: message,
          unreadCount: 0
        });
      }
      
      // Count unread messages (skip system messages for unread count)
      if (!message.isSystemMessage && message.receiverId === userId && !message.read) {
        conversationMap.get(conversationId).unreadCount++;
      }
    }

    // Get user details for each conversation
    const conversations = await Promise.all(
      Array.from(conversationMap.values()).map(async (conv) => {
        // Try to find user by auth0Id
        let otherUser = await User.findOne({ auth0Id: conv.otherUserId });
        
        // If not found and otherUserId doesn't start with 'dev-user-', try with prefix
        if (!otherUser && !conv.otherUserId.startsWith('dev-user-')) {
          console.log(`⚠️ User not found for auth0Id: ${conv.otherUserId}, trying with dev-user- prefix`);
          otherUser = await User.findOne({ auth0Id: `dev-user-${conv.otherUserId}` });
          if (otherUser) {
            console.log(`✅ Found user with prefix: ${otherUser.auth0Id}`);
          }
        }
        
        // If still not found, try checking if it's an email and search by email
        if (!otherUser && conv.otherUserId.includes('@')) {
          console.log(`⚠️ Trying to find user by email: ${conv.otherUserId}`);
          otherUser = await User.findOne({ email: conv.otherUserId });
          if (otherUser) {
            console.log(`✅ Found user by email: ${otherUser.auth0Id}`);
          }
        }
        
        if (!otherUser) {
          console.error(`❌ User not found for: ${conv.otherUserId}`);
        }
        
        return {
          conversationId: conv.conversationId,
          otherUser: otherUser ? {
            id: otherUser._id.toString(),
            auth0Id: otherUser.auth0Id,
            name: otherUser.name,
            picture: otherUser.picture,
            userType: otherUser.userType
          } : {
            id: conv.otherUserId,
            auth0Id: conv.otherUserId,
            name: 'Unknown User',
            picture: null,
            userType: 'user'
          },
          lastMessage: {
            content: conv.lastMessage.content,
            senderId: conv.lastMessage.senderId,
            createdAt: conv.lastMessage.createdAt,
            type: conv.lastMessage.type || (conv.lastMessage.isSystemMessage ? 'system' : 'text'),
            isSystemMessage: conv.lastMessage.isSystemMessage || false
          },
          unreadCount: conv.unreadCount,
          updatedAt: conv.lastMessage.createdAt
        };
      })
    );

    // Deduplicate conversations by conversationId (keep the most recent one)
    // Use conversationId instead of otherUser.auth0Id to handle cases where otherUser might not be found
    const deduplicatedMap = new Map();
    for (const conv of conversations) {
      // Use conversationId as the key to ensure all conversations are included
      const existingConv = deduplicatedMap.get(conv.conversationId);
      if (!existingConv || new Date(conv.updatedAt) > new Date(existingConv.updatedAt)) {
        deduplicatedMap.set(conv.conversationId, conv);
      }
    }
    
    const deduplicatedConversations = Array.from(deduplicatedMap.values());
    
    // Log system message conversations for debugging
    const systemMessageConvs = deduplicatedConversations.filter(conv => {
      return conv.lastMessage && (conv.lastMessage.type === 'system' || conv.lastMessage.senderId === 'system');
    });
    if (systemMessageConvs.length > 0) {
      console.log('📋 Found system message conversations:', systemMessageConvs.length, systemMessageConvs.map(c => ({
        conversationId: c.conversationId,
        otherUser: c.otherUser?.name || 'Unknown',
        lastMessage: c.lastMessage?.content?.substring(0, 50)
      })));
    }
    
    // Sort by most recent
    deduplicatedConversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.json({
      success: true,
      conversations: deduplicatedConversations
    });
  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get conversations',
      conversations: []
    });
  }
});

// Get messages for a specific conversation
router.get('/conversations/:otherUserId/messages', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { otherUserId } = req.params;
    const { limit = 50, before } = req.query;
    
    console.log('📥 GET /conversations/:otherUserId/messages', { userId, otherUserId, limit, before });
    
    // Try to find messages with the exact conversationId first
    const ids = [userId, otherUserId].sort();
    const conversationId = `${ids[0]}_${ids[1]}`;
    
    console.log('🔍 Looking for messages with conversationId:', conversationId);
    
    // Get user info to check if they're a tutor or student
    const currentUser = await User.findOne({ auth0Id: userId });
    const isTutor = currentUser && currentUser.userType === 'tutor';
    const isStudent = currentUser && currentUser.userType === 'student';
    
    let query = { conversationId };
    
    // If user is a student, exclude system messages that are tutor-only
    if (isStudent) {
      query.$or = [
        { visibleToTutorOnly: { $ne: true } }, // Not tutor-only
        { visibleToTutorOnly: { $exists: false } } // Or doesn't have this field (old messages)
      ];
    }
    
    // If user is a tutor, show all messages including system messages
    // (tutors can see system messages in potential student conversations)
    
    if (before) {
      if (query.$or) {
        query.$and = [
          { $or: query.$or },
          { createdAt: { $lt: new Date(before) } }
        ];
        delete query.$or;
      } else {
        query.createdAt = { $lt: new Date(before) };
      }
    }

    let messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    console.log(`✅ Found ${messages.length} messages for conversationId: ${conversationId}`);
    
    // If no messages found, try alternative conversationId formats
    // This handles cases where messages might have been stored with different ID formats
    if (messages.length === 0) {
      console.log('⚠️ No messages found with primary conversationId, trying alternative formats...');
      
      // Try reverse order (in case IDs were stored in different order)
      const reverseIds = [otherUserId, userId].sort();
      const reverseConversationId = `${reverseIds[0]}_${reverseIds[1]}`;
      
      if (reverseConversationId !== conversationId) {
        console.log('🔍 Trying reverse conversationId:', reverseConversationId);
        let altQuery = { conversationId: reverseConversationId };
        if (before) {
          altQuery.createdAt = { $lt: new Date(before) };
        }
        messages = await Message.find(altQuery)
          .sort({ createdAt: -1 })
          .limit(parseInt(limit))
          .lean();
        console.log(`✅ Found ${messages.length} messages with reverse conversationId`);
      }
      
      // If still no messages, try finding by senderId/receiverId directly
      if (messages.length === 0) {
        console.log('🔍 Trying to find messages by senderId/receiverId directly...');
        let directQuery = {
          $or: [
            { senderId: userId, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: userId }
          ]
        };
        if (before) {
          directQuery.createdAt = { $lt: new Date(before) };
        }
        messages = await Message.find(directQuery)
          .sort({ createdAt: -1 })
          .limit(parseInt(limit))
          .lean();
        console.log(`✅ Found ${messages.length} messages by direct senderId/receiverId match`);
        
        if (messages.length > 0) {
          console.log('📋 Sample messages found:', messages.slice(0, 2).map(m => ({
            conversationId: m.conversationId,
            senderId: m.senderId,
            receiverId: m.receiverId
          })));
        }
      }
    }
    
    if (messages.length > 0) {
      console.log('📋 Sample messages:', messages.slice(0, 3).map(m => ({
        id: m._id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        receiverId: m.receiverId,
        content: m.content?.substring(0, 50),
        createdAt: m.createdAt
      })));
    }

    // Mark messages as read - use the conversationId from found messages if available
    // Otherwise use the calculated conversationId
    const actualConversationId = messages.length > 0 ? messages[0].conversationId : conversationId;
    
    const updateResult = await Message.updateMany(
      { 
        $or: [
          { conversationId: actualConversationId, receiverId: userId, read: false },
          { senderId: userId, receiverId: otherUserId, read: false },
          { senderId: otherUserId, receiverId: userId, read: false }
        ]
      },
      { read: true, readAt: new Date() }
    );
    
    if (updateResult.modifiedCount > 0) {
      console.log(`📖 Marked ${updateResult.modifiedCount} messages as read`);
    }

    // Map _id to id for frontend compatibility and filter invalid replyTo
    const formattedMessages = messages.map(msg => {
      const formatted = {
        ...msg,
        id: msg._id.toString(),
        _id: undefined // Remove _id to avoid confusion
      };
      
      // Only include replyTo if it's valid (has messageId)
      if (formatted.replyTo && (typeof formatted.replyTo !== 'object' || !formatted.replyTo.messageId)) {
        delete formatted.replyTo;
      }
      
      return formatted;
    });

    res.json({
      success: true,
      messages: formattedMessages.reverse() // Return in chronological order
    });
  } catch (error) {
    console.error('❌ Error getting messages:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to get messages',
      messages: []
    });
  }
});

// Upload file and send as message
router.post('/conversations/:receiverId/upload', verifyToken, upload.single('file'), async (req, res) => {
  try {
    const senderId = req.user.sub;
    const { receiverId } = req.params;
    const { messageType, caption } = req.body; // messageType: 'image', 'file', or 'voice'

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    console.log('📤 File upload request:', {
      senderId,
      receiverId,
      messageType,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });

    // Initialize GCS
    const { bucket } = initializeGCS();
    if (!bucket) {
      return res.status(500).json({
        success: false,
        message: 'File storage not configured'
      });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedFilename = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const gcsFilename = `messages/${messageType}s/${senderId}/${timestamp}_${sanitizedFilename}`;

    console.log('☁️ Uploading to GCS:', gcsFilename);

    // Upload to GCS
    const file = bucket.file(gcsFilename);
    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
      },
      public: true
    });

    // Get public URL
    const fileUrl = `https://storage.googleapis.com/${bucket.name}/${gcsFilename}`;
    console.log('✅ File uploaded successfully:', fileUrl);

    // Create message with file
    const ids = [senderId, receiverId].sort();
    const conversationId = `${ids[0]}_${ids[1]}`;

    const message = new Message({
      conversationId,
      senderId,
      receiverId,
      content: caption || '', // Optional caption
      type: messageType,
      fileUrl,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size
    });

    const savedMessage = await message.save();
    console.log('💾 Message with file saved:', savedMessage._id.toString());

    // Populate sender info
    const sender = await User.findOne({ auth0Id: senderId });

    const messageResponse = {
      id: savedMessage._id.toString(),
      conversationId: savedMessage.conversationId,
      senderId: savedMessage.senderId,
      receiverId: savedMessage.receiverId,
      content: savedMessage.content,
      type: savedMessage.type,
      fileUrl: savedMessage.fileUrl,
      fileName: savedMessage.fileName,
      fileType: savedMessage.fileType,
      fileSize: savedMessage.fileSize,
      read: savedMessage.read,
      createdAt: savedMessage.createdAt,
      sender: sender ? {
        id: sender._id.toString(),
        name: sender.name,
        picture: sender.picture
      } : null
    };

    // Emit via WebSocket to sender (confirmation)
    const senderSocketId = req.connectedUsers?.get(senderId);
    if (senderSocketId && req.io) {
      console.log('📤 Sending file upload confirmation to sender:', senderId);
      req.io.to(senderSocketId).emit('message_sent', messageResponse);
    }

    // Emit via WebSocket to receiver (real-time notification)
    const receiverSocketId = req.connectedUsers?.get(receiverId);
    if (receiverSocketId && req.io) {
      console.log('📤 Sending file message to receiver:', receiverId);
      req.io.to(receiverSocketId).emit('new_message', messageResponse);
    } else {
      console.log('📭 Receiver not online:', receiverId);
    }

    res.json({
      success: true,
      message: messageResponse
    });
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file'
    });
  }
});

// Send a message
router.post('/conversations/:receiverId/messages', verifyToken, async (req, res) => {
  try {
    const senderId = req.user.sub;
    const { receiverId } = req.params;
    const { content, type = 'text', replyTo } = req.body;

    console.log('📨 HTTP POST /conversations/:receiverId/messages', { senderId, receiverId, content, type, replyTo });

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    if (!receiverId) {
      console.error('❌ No receiverId in params');
      return res.status(400).json({
        success: false,
        message: 'Receiver ID is required'
      });
    }

    const ids = [senderId, receiverId].sort();
    const conversationId = `${ids[0]}_${ids[1]}`;

    console.log('📝 Creating message with conversationId:', conversationId);

    const messageData = {
      conversationId,
      senderId,
      receiverId,
      content: content.trim(),
      type
    };

    // Add replyTo if provided and valid (must have messageId)
    if (replyTo && typeof replyTo === 'object' && replyTo.messageId) {
      messageData.replyTo = replyTo;
      console.log('💬 Message is a reply to:', replyTo.messageId);
    } else if (replyTo) {
      console.log('⚠️ Invalid replyTo data (missing messageId):', replyTo);
      // Don't add invalid replyTo to messageData
    }

    const message = new Message(messageData);

    console.log('💾 Saving message to database...');
    const savedMessage = await message.save();
    console.log('✅ Message saved successfully:', savedMessage._id.toString());
    
    // Populate sender info for real-time response
    const sender = await User.findOne({ auth0Id: senderId });
    
    // If this is a tutor responding to a potential student conversation,
    // make the conversation visible to the student by removing visibleToTutorOnly flag
    // from all system messages in this conversation
    if (sender && sender.userType === 'tutor') {
      // Check if there are any system messages with visibleToTutorOnly in this conversation
      const systemMessages = await Message.find({
        conversationId,
        isSystemMessage: true,
        visibleToTutorOnly: true
      });
      
      if (systemMessages.length > 0) {
        // Make system messages visible to student (remove tutor-only restriction)
        await Message.updateMany(
          { conversationId, isSystemMessage: true, visibleToTutorOnly: true },
          { visibleToTutorOnly: false }
        );
        console.log('✅ Made potential student conversation visible to student');
      }
    }

    const messageResponse = {
      id: savedMessage._id.toString(),
      conversationId: savedMessage.conversationId,
      senderId: savedMessage.senderId,
      receiverId: savedMessage.receiverId,
      content: savedMessage.content,
      type: savedMessage.type,
      read: savedMessage.read,
      createdAt: savedMessage.createdAt,
      sender: sender ? {
        id: sender._id.toString(),
        name: sender.name,
        picture: sender.picture
      } : null
    };

    // Include replyTo in response only if it's valid (has messageId)
    if (savedMessage.replyTo && typeof savedMessage.replyTo === 'object' && savedMessage.replyTo.messageId) {
      messageResponse.replyTo = savedMessage.replyTo;
    }

    // Get receiver user to create notification
    const receiver = await User.findOne({ auth0Id: receiverId });
    
    // Create notification for receiver if they exist
    if (receiver) {
      try {
        const Notification = require('../models/Notification');
        await Notification.create({
          userId: receiver._id,
          type: 'message',
          title: 'New Message',
          message: sender ? `${sender.name} sent you a message` : 'You have a new message',
          data: {
            messageId: savedMessage._id.toString(),
            conversationId: savedMessage.conversationId,
            senderId: sender?._id?.toString(),
            senderName: sender?.name,
            content: savedMessage.content.substring(0, 100) // Preview first 100 chars
          }
        });
        console.log('✅ Notification created for message to receiver:', receiver._id);
      } catch (notifError) {
        console.error('❌ Error creating notification for message:', notifError);
      }
    }

    // Emit WebSocket message to receiver (for real-time message display)
    const receiverSocketId = req.connectedUsers?.get(receiverId);
    console.log('📤 Checking WebSocket for message:', {
      receiverId,
      receiverSocketId,
      hasIo: !!req.io,
      hasConnectedUsers: !!req.connectedUsers,
      connectedUsersCount: req.connectedUsers?.size || 0
    });
    
    if (receiverSocketId && req.io) {
      console.log('✅ Emitting new_message to receiver:', receiverId, 'socket:', receiverSocketId);
      req.io.to(receiverSocketId).emit('new_message', messageResponse);
    } else {
      console.log('⚠️ Receiver not online or WebSocket not available:', {
        receiverId,
        receiverSocketId,
        hasIo: !!req.io
      });
    }

    // Emit confirmation to sender
    const senderSocketId = req.connectedUsers?.get(senderId);
    if (senderSocketId && req.io) {
      console.log('✅ Emitting message_sent to sender:', senderId, 'socket:', senderSocketId);
      req.io.to(senderSocketId).emit('message_sent', messageResponse);
    }

    // Emit WebSocket notification to receiver (for notification dropdown - but user said messages shouldn't appear there)
    // Commenting this out since user said messages should not appear in notification dropdown
    // if (receiverSocketId && req.io) {
    //   req.io.to(receiverSocketId).emit('new_notification', {
    //     type: 'message',
    //     message: sender ? `${sender.name} sent you a message` : 'You have a new message'
    //   });
    // }

    res.json({
      success: true,
      message: messageResponse
    });
  } catch (error) {
    console.error('❌ Error sending message:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
});

// Mark messages as read
router.put('/conversations/:otherUserId/read', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { otherUserId } = req.params;
    const ids = [userId, otherUserId].sort();
    const conversationId = `${ids[0]}_${ids[1]}`;

    await Message.updateMany(
      { conversationId, receiverId: userId, read: false },
      { read: true, readAt: new Date() }
    );

    res.json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read'
    });
  }
});

// Create potential student conversation
router.post('/potential-student', verifyToken, async (req, res) => {
  try {
    const studentId = req.user.sub; // Current user (student)
    const { tutorId, triggerType } = req.body; // 'favorite' or 'book_lesson'

    console.log('📝 Creating potential student conversation:', { 
      studentId, 
      tutorId, 
      triggerType,
      timestamp: new Date().toISOString(),
      userAgent: req.headers['user-agent']?.substring(0, 50)
    });

    if (!tutorId || !triggerType) {
      return res.status(400).json({
        success: false,
        message: 'Tutor ID and trigger type are required'
      });
    }

    if (!['favorite', 'book_lesson'].includes(triggerType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid trigger type. Must be "favorite" or "book_lesson"'
      });
    }

    // Get student and tutor info
    const student = await User.findOne({ auth0Id: studentId });
    const tutor = await User.findOne({ auth0Id: tutorId });

    console.log('🔍 Looking for users:', { 
      studentId, 
      tutorId,
      studentFound: !!student,
      tutorFound: !!tutor 
    });

    if (!student) {
      console.error('❌ Student not found with auth0Id:', studentId);
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    if (!tutor) {
      console.error('❌ Tutor not found with auth0Id:', tutorId);
      // Try to find by _id as fallback
      const tutorById = await User.findById(tutorId);
      console.log('🔍 Trying to find tutor by _id:', { tutorId, found: !!tutorById });
      
      if (tutorById) {
        console.log('✅ Found tutor by _id, using auth0Id:', tutorById.auth0Id);
        // Re-call with correct auth0Id
        return res.status(400).json({
          success: false,
          message: 'Tutor not found by auth0Id. Please use auth0Id instead of _id.',
          correctId: tutorById.auth0Id
        });
      }
      
      return res.status(404).json({
        success: false,
        message: 'Tutor not found'
      });
    }

    // Check if user is a student
    if (student.userType !== 'student') {
      return res.status(400).json({
        success: false,
        message: 'Only students can create potential student conversations'
      });
    }

    // Check if tutor is actually a tutor
    if (tutor.userType !== 'tutor') {
      return res.status(400).json({
        success: false,
        message: 'Target user must be a tutor'
      });
    }

    // Create conversation ID
    const ids = [studentId, tutorId].sort();
    const conversationId = `${ids[0]}_${ids[1]}`;

    console.log('🔍 Checking for existing conversation:', {
      studentId,
      tutorId,
      conversationId,
      studentAuth0Id: student.auth0Id,
      tutorAuth0Id: tutor.auth0Id
    });

    // Check if ANY conversation already exists (system message or regular messages)
    // We don't want to spam the tutor with notifications every time the student clicks
    const existingMessage = await Message.findOne({ conversationId });
    
    console.log('🔍 Existing message found:', existingMessage ? {
      id: existingMessage._id,
      type: existingMessage.type,
      isSystemMessage: existingMessage.isSystemMessage,
      senderId: existingMessage.senderId,
      receiverId: existingMessage.receiverId
    } : 'None');
    
    if (existingMessage) {
      // Conversation already exists (either with system message or real messages)
      console.log('ℹ️ Conversation already exists, not creating duplicate potential student notification:', conversationId);
      return res.json({
        success: true,
        message: 'Conversation already exists',
        conversationId,
        alreadyExists: true
      });
    }

    // Create system message content
    // Get tutor's languages (from onboardingData or profile)
    const tutorLanguages = tutor.onboardingData?.languages || tutor.profile?.languages || [];
    const primaryLanguage = tutorLanguages.length > 0 ? tutorLanguages[0] : 'language';
    
    // Format language text (e.g., "Spanish" or "Spanish and French")
    let languageText = primaryLanguage;
    if (tutorLanguages.length > 1) {
      languageText = tutorLanguages.slice(0, -1).join(', ') + ' and ' + tutorLanguages[tutorLanguages.length - 1];
    }
    
    // Get student name
    const studentName = student.name || student.email?.split('@')[0] || 'a student';
    
    // Randomly select from different message templates for variation
    const messageTemplates = [
      `Student ${studentName} has shown interest in your ${languageText} lessons but hasn't finalized their booking yet.\n\nYou can start a conversation to answer any questions they may have about your methodology, class structure, or learning goals.`,
      
      `It looks like ${studentName} started booking a ${languageText} lesson with you but hasn't completed it yet.\n\nYou can reach out to see if they need any help or would like to know more about your classes, teaching style, or what to expect.`,
      
      `${studentName} has expressed interest in your ${languageText} lessons but hasn't finished the booking process.\n\nConsider sending a message to answer any questions they might have about your approach, availability, or course content.`,
      
      `${studentName} showed interest in your ${languageText} classes but didn't complete the booking.\n\nA quick message could make the difference — offer assistance or share a bit more about what makes your lessons unique.`
    ];
    
    // Randomly select a message template
    const randomIndex = Math.floor(Math.random() * messageTemplates.length);
    const systemMessageContent = `👋 ${messageTemplates[randomIndex]}`;

    // Create system message (senderId is 'system', but we'll use a special identifier)
    // For system messages, we'll use the tutorId as senderId but mark it as system
    const systemMessage = new Message({
      conversationId,
      senderId: 'system', // Special system sender
      receiverId: tutorId, // Only visible to tutor
      content: systemMessageContent,
      type: 'system',
      isSystemMessage: true,
      visibleToTutorOnly: true,
      triggerType,
      read: false
    });

    await systemMessage.save();
    console.log('✅ System message created:', {
      messageId: systemMessage._id.toString(),
      conversationId,
      studentName: student.name,
      tutorName: tutor.name,
      content: systemMessageContent.substring(0, 100) + '...'
    });

    // Create notification for tutor
    const Notification = require('../models/Notification');
    const notification = await Notification.create({
      userId: tutor._id,
      type: 'potential_student',
      title: 'Potential Student Interest',
      message: triggerType === 'favorite' 
        ? `${student.name} saved your profile`
        : `${student.name} clicked "Book lesson" on your profile`,
      data: {
        studentId: student._id.toString(),
        studentName: student.name,
        studentPicture: student.picture,
        conversationId,
        triggerType,
        messageId: systemMessage._id.toString()
      }
    });

    console.log('✅ Notification created for tutor:', {
      notificationId: notification._id.toString(),
      tutorId: tutor._id.toString(),
      tutorName: tutor.name,
      studentName: student.name,
      triggerType
    });

    // Emit WebSocket notification to tutor if online
    const tutorSocketId = req.connectedUsers?.get(tutorId);
    if (tutorSocketId && req.io) {
      console.log('📤 Emitting potential_student notification to tutor:', tutorId);
      req.io.to(tutorSocketId).emit('new_notification', {
        type: 'potential_student',
        title: 'Potential Student Interest',
        message: triggerType === 'favorite' 
          ? `${student.name} saved your profile`
          : `${student.name} clicked "Book lesson" on your profile`,
        data: {
          studentId: student._id.toString(),
          studentName: student.name,
          studentPicture: student.picture,
          conversationId,
          triggerType
        }
      });
    }

    res.json({
      success: true,
      message: 'Potential student conversation created',
      conversationId,
      systemMessage: {
        id: systemMessage._id.toString(),
        conversationId: systemMessage.conversationId,
        content: systemMessage.content,
        type: systemMessage.type,
        isSystemMessage: systemMessage.isSystemMessage,
        triggerType: systemMessage.triggerType,
        createdAt: systemMessage.createdAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating potential student conversation:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to create potential student conversation',
      error: error.message
    });
  }
});

module.exports = router;
