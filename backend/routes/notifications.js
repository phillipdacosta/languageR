const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const User = require('../models/User');
const { verifyToken } = require('../middleware/videoUploadMiddleware');

// Get all notifications for current user
router.get('/', verifyToken, async (req, res) => {
  try {
    const { limit = 50, before } = req.query; // Add pagination support
    
    console.log('📬 Fetching notifications for user:', req.user?.sub, { limit, before });
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      console.error('❌ User not found for auth0Id:', req.user?.sub);
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    console.log('📬 Found user:', user._id, 'Fetching notifications...');
    
    // Build query with optional 'before' filter
    const query = { userId: user._id };
    
    if (before) {
      // Find the notification with this ID to get its createdAt timestamp
      const beforeNotification = await Notification.findById(before).lean();
      
      if (beforeNotification) {
        console.log(`📅 Loading notifications before: ${before} (timestamp: ${beforeNotification.createdAt})`);
        query.createdAt = { $lt: beforeNotification.createdAt };
      } else {
        console.warn(`⚠️ Before notification not found: ${before}, loading from beginning`);
      }
    }
    
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    console.log('📬 Found', notifications.length, 'notifications for user:', user._id);

    res.json({
      success: true,
      notifications
    });
  } catch (error) {
    console.error('❌ Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
});

// Mark notification as read
router.patch('/:id/read', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: user._id },
      { read: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      notification
    });
  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
});

// Mark all notifications as read
router.patch('/read-all', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    await Notification.updateMany(
      { userId: user._id, read: false },
      { read: true, readAt: new Date() }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('❌ Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read'
    });
  }
});

// Get unread count
router.get('/unread-count', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const count = await Notification.countDocuments({ 
      userId: user._id, 
      read: false 
    });

    res.json({
      success: true,
      count
    });
  } catch (error) {
    console.error('❌ Error getting unread count:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count'
    });
  }
});

module.exports = router;

