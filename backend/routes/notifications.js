const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const User = require('../models/User');
const { verifyToken } = require('../middleware/videoUploadMiddleware');

// Get all notifications for current user
router.get('/', verifyToken, async (req, res) => {
  try {
    console\.log\([\s\S]*?\);'📬 Fetching notifications for user:', req.user?.sub);
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      console.error('❌ User not found for auth0Id:', req.user?.sub);
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    console\.log\([\s\S]*?\);'📬 Found user:', user._id, 'Fetching notifications...');
    const notifications = await Notification.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(50);

    console\.log\([\s\S]*?\);'📬 Found', notifications.length, 'notifications for user:', user._id);

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

