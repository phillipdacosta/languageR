const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');

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

module.exports = router;
