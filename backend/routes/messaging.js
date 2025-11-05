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
    const messages = await Message.find({
      $or: [{ senderId: userId }, { receiverId: userId }]
    }).sort({ createdAt: -1 });

    // Group by conversation and get latest message
    const conversationMap = new Map();
    
    for (const message of messages) {
      const otherUserId = message.senderId === userId ? message.receiverId : message.senderId;
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
      
      // Count unread messages
      if (message.receiverId === userId && !message.read) {
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
            type: conv.lastMessage.type
          },
          unreadCount: conv.unreadCount,
          updatedAt: conv.lastMessage.createdAt
        };
      })
    );

    // Deduplicate conversations by otherUser.auth0Id (keep the most recent one)
    const deduplicatedMap = new Map();
    for (const conv of conversations) {
      if (conv.otherUser && conv.otherUser.auth0Id) {
        const existingConv = deduplicatedMap.get(conv.otherUser.auth0Id);
        if (!existingConv || new Date(conv.updatedAt) > new Date(existingConv.updatedAt)) {
          deduplicatedMap.set(conv.otherUser.auth0Id, conv);
        }
      }
    }
    
    const deduplicatedConversations = Array.from(deduplicatedMap.values());
    
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
    
    const ids = [userId, otherUserId].sort();
    const conversationId = `${ids[0]}_${ids[1]}`;
    
    console.log('🔍 Looking for messages with conversationId:', conversationId);
    
    let query = { conversationId };
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    console.log(`✅ Found ${messages.length} messages for conversationId: ${conversationId}`);
    if (messages.length > 0) {
      console.log('📋 Sample messages:', messages.slice(0, 3).map(m => ({
        id: m._id,
        senderId: m.senderId,
        receiverId: m.receiverId,
        content: m.content?.substring(0, 50),
        createdAt: m.createdAt
      })));
    }

    // Mark messages as read
    const updateResult = await Message.updateMany(
      { conversationId, receiverId: userId, read: false },
      { read: true, readAt: new Date() }
    );
    
    if (updateResult.modifiedCount > 0) {
      console.log(`📖 Marked ${updateResult.modifiedCount} messages as read`);
    }

    res.json({
      success: true,
      messages: messages.reverse() // Return in chronological order
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
    const { content, type = 'text' } = req.body;

    console.log('📨 HTTP POST /conversations/:receiverId/messages', { senderId, receiverId, content, type });

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

    const message = new Message({
      conversationId,
      senderId,
      receiverId,
      content: content.trim(),
      type
    });

    console.log('💾 Saving message to database...');
    const savedMessage = await message.save();
    console.log('✅ Message saved successfully:', savedMessage._id.toString());

    // Populate sender info for real-time response
    const sender = await User.findOne({ auth0Id: senderId });

    res.json({
      success: true,
      message: {
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
      }
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

module.exports = router;
