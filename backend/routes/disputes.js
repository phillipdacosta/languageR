const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const Lesson = require('../models/Lesson');
const User = require('../models/User');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const { formatNameWithInitial } = require('../utils/nameFormatter');

/**
 * POST /api/disputes/create
 * Create a dispute for a payment cancellation/reduction
 */
router.post('/create', verifyToken, async (req, res) => {
  try {
    const { notificationId, lessonId, message, originalAmount, reason } = req.body;
    const userId = req.user.userId;

    console.log(`🔔 User ${userId} creating dispute for lesson ${lessonId}`);

    // Validate required fields
    if (!lessonId || !message || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Lesson ID and message are required'
      });
    }

    // Get lesson details
    const lesson = await Lesson.findById(lessonId)
      .populate('studentId', 'name firstName lastName email picture')
      .populate('tutorId', 'name firstName lastName email picture');

    if (!lesson) {
      return res.status(404).json({
        success: false,
        error: 'Lesson not found'
      });
    }

    // Verify the user is the tutor for this lesson
    if (lesson.tutorId._id.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You are not authorized to dispute this payment'
      });
    }

    // Block disputes on resolved investigations — admin decision is final
    if (lesson.investigationResolvedAt) {
      return res.status(400).json({
        success: false,
        error: 'This investigation has been resolved. The admin decision is final and cannot be disputed further.'
      });
    }

    // Block duplicate disputes
    if (lesson.disputeSubmitted) {
      return res.status(400).json({
        success: false,
        error: 'A dispute has already been submitted for this lesson.'
      });
    }

    // Create the dispute record (we'll store it in lesson for now)
    lesson.disputeSubmitted = true;
    lesson.disputeSubmittedAt = new Date();
    lesson.disputeMessage = message;
    lesson.disputeStatus = 'pending';
    await lesson.save();

    console.log(`✅ Dispute created for lesson ${lessonId}`);

    // Create notification for admin
    const admins = await User.find({ userType: 'admin' });
    
    for (const admin of admins) {
      await Notification.create({
        userId: admin._id,
        type: 'dispute_submitted',
        title: '⚠️ Payment Dispute Submitted',
        message: `<strong>${formatNameWithInitial(lesson.tutorId)}</strong> has <strong>disputed</strong> the payment cancellation for their lesson with <strong>${formatNameWithInitial(lesson.studentId)}</strong>.`,
        link: `/admin/reported-lessons`,
        data: {
          lessonId: lesson._id,
          tutorId: lesson.tutorId._id,
          studentId: lesson.studentId._id,
          disputeMessage: message,
          originalAmount: originalAmount,
          adminReason: reason
        }
      });
    }

    // Update the original notification to mark it as disputed
    if (notificationId) {
      await Notification.findByIdAndUpdate(notificationId, {
        'data.disputed': true,
        'data.disputedAt': new Date()
      });
    }

    res.json({
      success: true,
      message: 'Dispute submitted successfully. Our team will review it within 24-48 hours.',
      dispute: {
        lessonId: lesson._id,
        status: 'pending',
        submittedAt: lesson.disputeSubmittedAt
      }
    });

  } catch (error) {
    console.error('❌ Error creating dispute:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to submit dispute'
    });
  }
});

/**
 * GET /api/disputes - Get all disputes (admin only)
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    if (user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const disputes = await Lesson.find({ disputeSubmitted: true })
      .populate('studentId', 'name email picture')
      .populate('tutorId', 'name email picture')
      .sort({ disputeSubmittedAt: -1 });

    res.json({
      success: true,
      disputes
    });

  } catch (error) {
    console.error('❌ Error fetching disputes:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch disputes'
    });
  }
});

module.exports = router;

