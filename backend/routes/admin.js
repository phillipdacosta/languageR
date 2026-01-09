const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const User = require('../models/User');
const Alert = require('../models/Alert');
const Payment = require('../models/Payment');
const Lesson = require('../models/Lesson');
const Notification = require('../models/Notification');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const alertService = require('../services/alertService');

// Admin middleware - check if user is admin
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  
  // Check if user is admin
  if (req.user.userType !== 'admin' && req.user.email !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  
  next();
}

/**
 * GET /api/admin/pending-tutors
 * Get all tutors pending video approval
 */
router.get('/pending-tutors', verifyToken, requireAdmin, async (req, res) => {
  try {
    const pendingTutors = await User.find({
      userType: 'tutor',
      $or: [
        // Video not yet approved (undefined, null, or false)
        { 
          'tutorOnboarding.videoApproved': { $ne: true },
          $or: [
            { 'onboardingData.introductionVideo': { $exists: true, $ne: null, $ne: '' } },
            { 'onboardingData.pendingVideo': { $exists: true, $ne: null, $ne: '' } }
          ]
        },
        // Has a new pending video awaiting approval (even if previous was approved)
        { 
          'onboardingData.pendingVideo': { 
            $exists: true, 
            $ne: null,
            $ne: '' 
          } 
        }
      ]
    })
    .select('name firstName lastName email picture onboardingData tutorOnboarding stripeConnectOnboarded payoutProvider payoutDetails residenceCountry')
    .sort({ 'tutorOnboarding.videoUploadedAt': -1 });

    res.json({
      success: true,
      tutors: pendingTutors
    });
  } catch (error) {
    console.error('Error fetching pending tutors:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending tutors'
    });
  }
});

/**
 * POST /api/admin/approve-video/:userId
 * Approve a tutor's introduction video
 */
router.post('/approve-video/:userId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { approved, rejectionReason } = req.body;

    const tutor = await User.findById(userId);

    if (!tutor || tutor.userType !== 'tutor') {
      return res.status(404).json({
        success: false,
        message: 'Tutor not found'
      });
    }

    if (approved) {
      // If there's a pending video, move it to main video
      if (tutor.onboardingData?.pendingVideo) {
        tutor.onboardingData.introductionVideo = tutor.onboardingData.pendingVideo;
        tutor.onboardingData.videoThumbnail = tutor.onboardingData.pendingVideoThumbnail || tutor.onboardingData.videoThumbnail;
        tutor.onboardingData.videoType = tutor.onboardingData.pendingVideoType || tutor.onboardingData.videoType;
        
        // Clear pending video fields
        tutor.onboardingData.pendingVideo = null;
        tutor.onboardingData.pendingVideoThumbnail = null;
        tutor.onboardingData.pendingVideoType = null;
      }

      tutor.tutorOnboarding.videoApproved = true;
      tutor.tutorOnboarding.videoApprovedAt = new Date();

      // Check if all onboarding steps are complete
      const photoComplete = !!tutor.picture;
      const videoApproved = true; // We just approved it
      const hasStripe = tutor.stripeConnectOnboarded === true;
      const hasPayPal = tutor.payoutProvider === 'paypal' && !!tutor.payoutDetails?.paypalEmail;
      const hasManual = tutor.payoutProvider === 'manual';
      const payoutComplete = hasStripe || hasPayPal || hasManual;

      if (photoComplete && videoApproved && payoutComplete) {
        tutor.tutorApproved = true;
        tutor.tutorOnboarding.completedAt = new Date();
        console.log(`🎉 Tutor ${tutor.email} is now FULLY APPROVED (video approved by admin)`);
      }

    await tutor.save();

    // Create database notification for tutor
    try {
      const notification = new Notification({
        userId: tutor._id,
        type: 'tutor_video_approved',
        title: '🎉 Video Approved!',
        message: 'Your introduction video has been approved. You can now start tutoring!',
        data: {
          tutorApproved: tutor.tutorApproved,
          approvedAt: new Date()
        },
        read: false
      });
      await notification.save();
      console.log(`📝 Database notification created for tutor ${tutor._id}`);
    } catch (notifError) {
      console.error('⚠️ Failed to create database notification:', notifError);
    }

    // Send real-time notification to tutor via WebSocket
    try {
      if (req.io) {
        // Method 1: Try room-based notification (using auth0Id)
        req.io.to(`user:${tutor.auth0Id}`).emit('tutor_video_approved', {
          message: 'Your introduction video has been approved!',
          approved: true,
          tutorApproved: tutor.tutorApproved,
          timestamp: new Date()
        });
        console.log(`📬 Real-time video approval notification sent to tutor room: user:${tutor.auth0Id}`);
        
        // Method 2: Also check MongoDB ID in global userSockets
        if (global.userSockets && global.userSockets[tutor._id.toString()]) {
          const socketId = global.userSockets[tutor._id.toString()];
          req.io.to(socketId).emit('tutor_video_approved', {
            message: 'Your introduction video has been approved!',
            approved: true,
            tutorApproved: tutor.tutorApproved,
            timestamp: new Date()
          });
          console.log(`📬 Also sent to socket ${socketId} via MongoDB ID`);
        }
        
        // Also emit new_notification for the notification bell
        req.io.to(`user:${tutor.auth0Id}`).emit('new_notification', {
          type: 'tutor_video_approved',
          title: '🎉 Video Approved!',
          message: 'Your introduction video has been approved!',
          timestamp: new Date(),
          urgent: false
        });
      }
    } catch (socketError) {
      console.warn('⚠️ Could not send WebSocket notification:', socketError.message);
      // Don't fail the approval if socket notification fails
    }

    res.json({
      success: true,
      message: 'Video approved successfully',
      tutorApproved: tutor.tutorApproved
    });
    } else {
      // Video rejected
      tutor.tutorOnboarding.videoApproved = false;
      tutor.tutorOnboarding.videoRejectionReason = rejectionReason || 'Video did not meet requirements';
      
      // Clear pending video
      if (tutor.onboardingData?.pendingVideo) {
        tutor.onboardingData.pendingVideo = null;
        tutor.onboardingData.pendingVideoThumbnail = null;
        tutor.onboardingData.pendingVideoType = null;
      }

      await tutor.save();

      // Send rejection notification
      try {
        if (req.io) {
          req.io.to(`user:${tutor.auth0Id}`).emit('tutor_video_rejected', {
            message: rejectionReason || 'Your video was rejected',
            approved: false,
            reason: rejectionReason,
            timestamp: new Date()
          });
          console.log(`📬 Video rejection notification sent to tutor room: user:${tutor.auth0Id}`);
          
          // Also try via MongoDB ID
          if (global.userSockets && global.userSockets[tutor._id.toString()]) {
            const socketId = global.userSockets[tutor._id.toString()];
            req.io.to(socketId).emit('tutor_video_rejected', {
              message: rejectionReason || 'Your video was rejected',
              approved: false,
              reason: rejectionReason,
              timestamp: new Date()
            });
          }
        }
      } catch (socketError) {
        console.warn('⚠️ Could not send WebSocket notification:', socketError.message);
      }

      res.json({
        success: true,
        message: 'Video rejected',
        reason: rejectionReason
      });
    }
  } catch (error) {
    console.error('Error approving video:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve video'
    });
  }
});

/**
 * POST /api/admin/approve-tutor/:userId
 * Alias for approve-video with approved: true (backwards compatibility)
 */
router.post('/approve-tutor/:userId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const tutor = await User.findById(userId);

    if (!tutor || tutor.userType !== 'tutor') {
      return res.status(404).json({ success: false, message: 'Tutor not found' });
    }

    // Approve video
    if (tutor.onboardingData?.pendingVideo) {
      tutor.onboardingData.introductionVideo = tutor.onboardingData.pendingVideo;
      tutor.onboardingData.videoThumbnail = tutor.onboardingData.pendingVideoThumbnail || tutor.onboardingData.videoThumbnail;
      tutor.onboardingData.videoType = tutor.onboardingData.pendingVideoType || tutor.onboardingData.videoType;
      tutor.onboardingData.pendingVideo = null;
      tutor.onboardingData.pendingVideoThumbnail = null;
      tutor.onboardingData.pendingVideoType = null;
    }

    tutor.tutorOnboarding.videoApproved = true;
    tutor.tutorOnboarding.videoApprovedAt = new Date();

    // Check if fully approved
    const photoComplete = !!tutor.picture;
    const hasStripe = tutor.stripeConnectOnboarded === true;
    const hasPayPal = tutor.payoutProvider === 'paypal' && !!tutor.payoutDetails?.paypalEmail;
    const hasManual = tutor.payoutProvider === 'manual';
    const payoutComplete = hasStripe || hasPayPal || hasManual;

    if (photoComplete && payoutComplete) {
      tutor.tutorApproved = true;
      tutor.tutorOnboarding.completedAt = new Date();
    }

    await tutor.save();

    // Create database notification for tutor
    try {
      const notification = new Notification({
        userId: tutor._id,
        type: 'tutor_video_approved',
        title: '🎉 Video Approved!',
        message: 'Your introduction video has been approved!',
        data: {
          tutorApproved: tutor.tutorApproved,
          approvedAt: new Date()
        },
        read: false
      });
      await notification.save();
      console.log(`📝 Database notification created for tutor ${tutor._id}`);
    } catch (notifError) {
      console.error('⚠️ Failed to create database notification:', notifError);
    }

    // Send websocket notification
    try {
      if (req.io) {
        req.io.to(`user:${tutor.auth0Id}`).emit('tutor_video_approved', {
          message: 'Your introduction video has been approved!',
          approved: true,
          tutorApproved: tutor.tutorApproved,
          timestamp: new Date()
        });
        console.log(`📬 Tutor approval notification sent to room: user:${tutor.auth0Id}`);
        
        // Also try via MongoDB ID
        if (global.userSockets && global.userSockets[tutor._id.toString()]) {
          const socketId = global.userSockets[tutor._id.toString()];
          req.io.to(socketId).emit('tutor_video_approved', {
            message: 'Your introduction video has been approved!',
            approved: true,
            tutorApproved: tutor.tutorApproved,
            timestamp: new Date()
          });
        }
        
        // Also emit new_notification for the notification bell
        req.io.to(`user:${tutor.auth0Id}`).emit('new_notification', {
          type: 'tutor_video_approved',
          title: '🎉 Video Approved!',
          message: 'Your introduction video has been approved!',
          timestamp: new Date(),
          urgent: false
        });
      }
    } catch (socketError) {
      console.warn('⚠️ Could not send WebSocket notification:', socketError.message);
    }

    res.json({ success: true, message: 'Tutor approved', tutorApproved: tutor.tutorApproved });
  } catch (error) {
    console.error('Error approving tutor:', error);
    res.status(500).json({ success: false, message: 'Failed to approve tutor' });
  }
});

/**
 * GET /api/admin/payment-health
 * Get payment system health status and issues
 */
router.get('/payment-health', verifyToken, requireAdmin, async (req, res) => {
  try {
    const issues = {
      outOfSyncPayments: [],
      stuckAuthorizations: [],
      pendingTransfers: [],
      failedPayouts: [],
      missingPayments: []
    };

    // 1. Find payments marked as "succeeded" in DB
    const succeededPayments = await Payment.find({ 
      status: 'succeeded',
      stripePaymentIntentId: { $ne: null }
    })
    .populate('lessonId', 'startTime subject tutorId studentId')
    .limit(100)
    .sort({ chargedAt: -1 });

    // Check each against Stripe (sample check - in production, do this in a background job)
    for (const payment of succeededPayments.slice(0, 10)) { // Check last 10 for performance
      try {
        const stripePI = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
        
        if (stripePI.status !== 'succeeded') {
          issues.outOfSyncPayments.push({
            paymentId: payment._id,
            lessonId: payment.lessonId?._id,
            dbStatus: payment.status,
            stripeStatus: stripePI.status,
            amount: payment.amount,
            chargedAt: payment.chargedAt,
            stripePaymentIntentId: payment.stripePaymentIntentId
          });
        }
      } catch (error) {
        console.error(`Error checking Stripe PI ${payment.stripePaymentIntentId}:`, error.message);
      }
    }

    // 2. Find stuck authorizations (> 7 days old)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const stuckAuths = await Payment.find({
      status: 'authorized',
      createdAt: { $lt: weekAgo }
    })
    .populate('lessonId', 'startTime subject tutorId studentId status')
    .limit(50);

    issues.stuckAuthorizations = stuckAuths.map(p => ({
      paymentId: p._id,
      lessonId: p.lessonId?._id,
      amount: p.amount,
      createdAt: p.createdAt,
      daysStuck: Math.floor((Date.now() - p.createdAt) / (1000 * 60 * 60 * 24)),
      lessonStatus: p.lessonId?.status,
      stripePaymentIntentId: p.stripePaymentIntentId
    }));

    // 3. Find payments with succeeded status but no transfer
    const pendingTransfers = await Payment.find({
      status: 'succeeded',
      revenueRecognized: true,
      transferStatus: { $in: ['pending', 'awaiting_funds', null] }
    })
    .populate('tutorId', 'name email payoutProvider')
    .populate('lessonId', 'startTime subject')
    .limit(50)
    .sort({ chargedAt: -1 });

    issues.pendingTransfers = pendingTransfers.map(p => ({
      paymentId: p._id,
      lessonId: p.lessonId?._id,
      tutorId: p.tutorId?._id,
      tutorName: p.tutorId?.name,
      tutorEmail: p.tutorId?.email,
      payoutProvider: p.tutorId?.payoutProvider,
      tutorPayout: p.tutorPayout,
      transferStatus: p.transferStatus,
      chargedAt: p.chargedAt,
      stripePayoutId: p.stripePayoutId,
      paypalBatchId: p.paypalBatchId
    }));

    // 4. Find failed payouts
    const failedPayouts = await Payment.find({
      transferStatus: 'failed'
    })
    .populate('tutorId', 'name email payoutProvider')
    .populate('lessonId', 'startTime subject')
    .limit(50)
    .sort({ updatedAt: -1 });

    issues.failedPayouts = failedPayouts.map(p => ({
      paymentId: p._id,
      lessonId: p.lessonId?._id,
      tutorId: p.tutorId?._id,
      tutorName: p.tutorId?.name,
      tutorEmail: p.tutorId?.email,
      payoutProvider: p.tutorId?.payoutProvider,
      tutorPayout: p.tutorPayout,
      errorMessage: p.errorMessage,
      updatedAt: p.updatedAt
    }));

    // 5. Find completed lessons without payments
    const lessonsWithoutPayments = await Lesson.find({
      status: 'completed',
      paymentId: null,
      actualCallStartTime: { $ne: null }, // Lesson actually happened
      price: { $gt: 0 }
    })
    .populate('tutorId', 'name email')
    .populate('studentId', 'name email')
    .limit(20)
    .sort({ endTime: -1 });

    issues.missingPayments = lessonsWithoutPayments.map(l => ({
      lessonId: l._id,
      tutorName: l.tutorId?.name,
      studentName: l.studentId?.name,
      subject: l.subject,
      startTime: l.startTime,
      endTime: l.endTime,
      price: l.price
    }));

    // 6. Get active alerts
    const activeAlerts = await alertService.getActiveAlerts({ limit: 50 });

    // 7. Get alert statistics
    const alertStats = await alertService.getAlertStats();

    res.json({
      success: true,
      issues,
      alerts: activeAlerts.map(a => ({
        _id: a._id,
        type: a.type,
        severity: a.severity,
        status: a.status,
        title: a.title,
        description: a.description,
        data: a.data,
        paymentId: a.paymentId,
        lessonId: a.lessonId,
        createdAt: a.createdAt
      })),
      stats: {
        outOfSync: issues.outOfSyncPayments.length,
        stuckAuths: issues.stuckAuthorizations.length,
        pendingTransfers: issues.pendingTransfers.length,
        failedPayouts: issues.failedPayouts.length,
        missingPayments: issues.missingPayments.length,
        activeAlerts: activeAlerts.filter(a => a.status === 'active').length,
        criticalAlerts: activeAlerts.filter(a => a.severity === 'CRITICAL').length
      },
      alertStats
    });
  } catch (error) {
    console.error('❌ Error fetching payment health:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment health'
    });
  }
});

/**
 * POST /api/admin/resolve-alert/:alertId
 * Resolve a payment alert
 */
router.post('/resolve-alert/:alertId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { alertId } = req.params;
    const { resolutionNotes } = req.body;
    const adminUser = req.user;

    const alert = await alertService.resolveAlert(alertId, {
      resolvedBy: adminUser._id,
      resolutionNotes
    });

    res.json({
      success: true,
      alert
    });
  } catch (error) {
    console.error('❌ Error resolving alert:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/admin/manual-capture/:paymentId
 * Manually capture a stuck payment
 */
router.post('/manual-capture/:paymentId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await Payment.findById(paymentId).populate('lessonId');

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    if (payment.status !== 'authorized') {
      return res.status(400).json({ 
        success: false, 
        message: `Payment status is ${payment.status}, cannot capture` 
      });
    }

    // Capture via Stripe
    const capturedIntent = await stripe.paymentIntents.capture(payment.stripePaymentIntentId);

    if (capturedIntent.status === 'succeeded') {
      payment.status = 'succeeded';
      payment.chargedAt = new Date();
      await payment.save();

      res.json({
        success: true,
        message: 'Payment captured successfully',
        payment
      });
    } else {
      res.status(400).json({
        success: false,
        message: `Capture failed: ${capturedIntent.status}`
      });
    }
  } catch (error) {
    console.error('❌ Error manual capture:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/admin/dismiss-failed-payout/:paymentId
 * Dismiss/acknowledge a failed payout (marks it as manually handled)
 */
router.post('/dismiss-failed-payout/:paymentId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { dismissalReason } = req.body;

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    // Mark as acknowledged (change transferStatus so it doesn't show in failed list)
    payment.transferStatus = 'acknowledged';
    payment.errorMessage = `DISMISSED: ${dismissalReason || 'Manually acknowledged by admin'}`;
    await payment.save();

    res.json({
      success: true,
      message: 'Failed payout dismissed',
      payment
    });
  } catch (error) {
    console.error('❌ Error dismissing failed payout:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/admin/sync-payment/:paymentId
 * Sync database with Stripe status (for when Stripe is correct but DB is wrong)
 */
router.post('/sync-payment/:paymentId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await Payment.findById(paymentId);

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    if (!payment.stripePaymentIntentId) {
      return res.status(400).json({ success: false, message: 'No Stripe PaymentIntent ID' });
    }

    // Get actual Stripe status
    const stripePI = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);

    // Update database to match Stripe
    const oldStatus = payment.status;
    payment.status = stripePI.status === 'succeeded' ? 'succeeded' : stripePI.status;
    
    if (stripePI.status === 'succeeded' && !payment.chargedAt) {
      // Find the charge time from Stripe
      const charges = stripePI.charges?.data || [];
      if (charges.length > 0) {
        payment.chargedAt = new Date(charges[0].created * 1000);
      } else {
        payment.chargedAt = new Date();
      }
    }

    await payment.save();

    res.json({
      success: true,
      message: `Database synced: ${oldStatus} → ${payment.status}`,
      payment
    });
  } catch (error) {
    console.error('❌ Error syncing payment:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
