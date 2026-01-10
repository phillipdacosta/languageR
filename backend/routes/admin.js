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
async function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  
  try {
    // Query database to check if user is admin
    const user = await User.findOne({ 
      $or: [
        { auth0Id: req.user.sub },
        { email: req.user.email }
      ]
    });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if user is admin (database field OR environment variable)
    if (!user.isAdmin && req.user.email !== process.env.ADMIN_EMAIL) {
      console.log('❌ Admin access denied for:', req.user.email, 'isAdmin:', user.isAdmin);
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    console.log('✅ Admin access granted for:', req.user.email);
    next();
  } catch (error) {
    console.error('❌ Error in requireAdmin middleware:', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * GET /api/admin/pending-tutors
 * Get all tutors pending video approval OR already approved tutors OR rejected
 * Query params: ?status=pending|approved|rejected
 */
router.get('/pending-tutors', verifyToken, requireAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'pending'; // Default to pending
    
    let tutors;
    
    if (status === 'approved') {
      // Get tutors with approved videos (and no pending video awaiting re-review)
      tutors = await User.find({
        userType: 'tutor',
        'tutorOnboarding.videoApproved': true,
        'onboardingData.introductionVideo': { $exists: true, $ne: null, $ne: '' }
      }).select('name firstName lastName email picture onboardingData tutorOnboarding stripeConnectOnboarded payoutProvider payoutDetails residenceCountry');
      
      // Filter out tutors with pending videos (do this in JavaScript for clarity)
      tutors = tutors.filter(tutor => {
        const pendingVideo = tutor.onboardingData?.pendingVideo;
        return !pendingVideo || pendingVideo === '' || pendingVideo === null;
      });
    } else if (status === 'rejected') {
      // Get tutors with rejected videos
      tutors = await User.find({
        userType: 'tutor',
        'tutorOnboarding.videoRejected': true,
        $or: [
          { 'onboardingData.introductionVideo': { $exists: true, $ne: null, $ne: '' } },
          { 'onboardingData.pendingVideo': { $exists: true, $ne: null, $ne: '' } }
        ]
      }).select('name firstName lastName email picture onboardingData tutorOnboarding stripeConnectOnboarded payoutProvider payoutDetails residenceCountry');
    } else {
      // Get ALL tutors with videos
      const allTutors = await User.find({
        userType: 'tutor',
        $or: [
          { 'onboardingData.introductionVideo': { $exists: true, $ne: null, $ne: '' } },
          { 'onboardingData.pendingVideo': { $exists: true, $ne: null, $ne: '' } }
        ]
      }).select('name firstName lastName email picture onboardingData tutorOnboarding stripeConnectOnboarded payoutProvider payoutDetails residenceCountry createdAt');
      
      console.log('📋 Sample tutor data from query:', allTutors[0] ? {
        email: allTutors[0].email,
        hasTutorOnboarding: !!allTutors[0].tutorOnboarding,
        tutorOnboarding: allTutors[0].tutorOnboarding,
        hasCreatedAt: !!allTutors[0].createdAt,
        createdAt: allTutors[0].createdAt
      } : 'No tutors found');
      
      // Filter to only pending (not approved OR has pending video)
      tutors = allTutors.filter(tutor => {
        const videoApproved = tutor.tutorOnboarding?.videoApproved === true;
        const videoRejected = tutor.tutorOnboarding?.videoRejected === true;
        const pendingVideo = tutor.onboardingData?.pendingVideo;
        const hasPendingVideo = pendingVideo && pendingVideo !== '' && pendingVideo !== null;
        
        // Exclude rejected videos from pending tab
        if (videoRejected) return false;
        
        // Include if:
        // 1. Video not approved yet (new tutor)
        // 2. OR has a pending video (existing tutor uploading new video)
        return !videoApproved || hasPendingVideo;
      });
    }
    
    // Sort by upload date
    tutors.sort((a, b) => {
      const dateA = a.tutorOnboarding?.videoUploadedAt || new Date(0);
      const dateB = b.tutorOnboarding?.videoUploadedAt || new Date(0);
      return dateB - dateA;
    });

    // Fix: Set videoUploadedAt for tutors who are missing it (one-time migration)
    let migrationCount = 0;
    const tutorsToUpdate = [];
    
    for (const tutor of tutors) {
      console.log(`🔍 Checking tutor ${tutor.email}:`, {
        hasVideoUploadedAt: !!tutor.tutorOnboarding?.videoUploadedAt,
        videoUploadedAt: tutor.tutorOnboarding?.videoUploadedAt,
        createdAt: tutor.createdAt
      });
      
      if (!tutor.tutorOnboarding?.videoUploadedAt) {
        console.log(`⏰ Setting videoUploadedAt for tutor ${tutor.email} (was missing)`);
        if (!tutor.tutorOnboarding) {
          tutor.tutorOnboarding = {};
        }
        // Use createdAt as fallback, or current time
        tutor.tutorOnboarding.videoUploadedAt = tutor.createdAt || new Date();
        await tutor.save();
        tutorsToUpdate.push(tutor._id);
        migrationCount++;
        console.log(`✅ Set videoUploadedAt to:`, tutor.tutorOnboarding.videoUploadedAt);
      }
    }
    
    if (migrationCount > 0) {
      console.log(`✅ Migration complete: Set videoUploadedAt for ${migrationCount} tutor(s)`);
      
      // Re-fetch the tutors list to get fresh timestamps
      // Just re-query using the same criteria as before
      if (status === 'approved') {
        tutors = await User.find({
          userType: 'tutor',
          'tutorOnboarding.videoApproved': true,
          'onboardingData.introductionVideo': { $exists: true, $ne: null, $ne: '' }
        }).select('name firstName lastName email picture onboardingData tutorOnboarding stripeConnectOnboarded payoutProvider payoutDetails residenceCountry createdAt');
        
        tutors = tutors.filter(tutor => {
          const pendingVideo = tutor.onboardingData?.pendingVideo;
          return !pendingVideo || pendingVideo === '' || pendingVideo === null;
        });
      } else if (status === 'rejected') {
        tutors = await User.find({
          userType: 'tutor',
          'tutorOnboarding.videoRejected': true,
          $or: [
            { 'onboardingData.introductionVideo': { $exists: true, $ne: null, $ne: '' } },
            { 'onboardingData.pendingVideo': { $exists: true, $ne: null, $ne: '' } }
          ]
        }).select('name firstName lastName email picture onboardingData tutorOnboarding stripeConnectOnboarded payoutProvider payoutDetails residenceCountry createdAt');
      } else {
        // Pending status - re-fetch all and filter
        const allTutors = await User.find({
          userType: 'tutor',
          $or: [
            { 'onboardingData.introductionVideo': { $exists: true, $ne: null, $ne: '' } },
            { 'onboardingData.pendingVideo': { $exists: true, $ne: null, $ne: '' } }
          ]
        }).select('name firstName lastName email picture onboardingData tutorOnboarding stripeConnectOnboarded payoutProvider payoutDetails residenceCountry createdAt');
        
        tutors = allTutors.filter(tutor => {
          const videoApproved = tutor.tutorOnboarding?.videoApproved === true;
          const videoRejected = tutor.tutorOnboarding?.videoRejected === true;
          const pendingVideo = tutor.onboardingData?.pendingVideo;
          const hasPendingVideo = pendingVideo && pendingVideo !== '' && pendingVideo !== null;
          if (videoRejected) return false;
          return !videoApproved || hasPendingVideo;
        });
      }
      
      console.log(`🔄 Re-fetched ${tutors.length} tutors after migration`);
    }

    console.log(`📊 Fetched ${tutors.length} tutors with status: ${status}`);

    res.json({
      success: true,
      tutors: tutors,
      status: status
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
    tutor.tutorOnboarding.videoRejected = false;
    tutor.tutorOnboarding.rejectionReason = null;
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
 * POST /api/admin/reject-tutor/:userId
 * Reject a tutor's introduction video
 */
router.post('/reject-tutor/:userId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const tutor = await User.findById(userId);

    if (!tutor || tutor.userType !== 'tutor') {
      return res.status(404).json({ success: false, message: 'Tutor not found' });
    }

    // Mark video as rejected
    tutor.tutorOnboarding.videoApproved = false;
    tutor.tutorOnboarding.videoRejected = true;
    tutor.tutorOnboarding.rejectionReason = reason || 'Video did not meet requirements';
    tutor.tutorOnboarding.videoRejectedAt = new Date();
    
    // Clear pending video if exists
    if (tutor.onboardingData?.pendingVideo) {
      tutor.onboardingData.pendingVideo = null;
      tutor.onboardingData.pendingVideoThumbnail = null;
      tutor.onboardingData.pendingVideoType = null;
    }

    await tutor.save();

    // Create database notification for tutor
    try {
      const notification = new Notification({
        userId: tutor._id,
        type: 'tutor_video_rejected',
        title: '❌ Video Rejected',
        message: `Your introduction video was rejected. Reason: ${reason || 'Video did not meet requirements'}`,
        data: {
          reason: reason,
          rejectedAt: new Date()
        },
        read: false
      });
      await notification.save();
      console.log(`📝 Database notification created for tutor ${tutor._id}`);
    } catch (notifError) {
      console.error('⚠️ Failed to create database notification:', notifError);
    }

    // Send rejection notification
    try {
      if (req.io) {
        req.io.to(`user:${tutor.auth0Id}`).emit('tutor_video_rejected', {
          message: reason || 'Your video was rejected',
          approved: false,
          reason: reason,
          timestamp: new Date()
        });
        console.log(`📬 Video rejection notification sent to tutor room: user:${tutor.auth0Id}`);
        
        // Also try via MongoDB ID
        if (global.userSockets && global.userSockets[tutor._id.toString()]) {
          const socketId = global.userSockets[tutor._id.toString()];
          req.io.to(socketId).emit('tutor_video_rejected', {
            message: reason || 'Your video was rejected',
            approved: false,
            reason: reason,
            timestamp: new Date()
          });
        }
        
        // Also emit new_notification for the notification bell
        req.io.to(`user:${tutor.auth0Id}`).emit('new_notification', {
          type: 'tutor_video_rejected',
          title: '❌ Video Rejected',
          message: reason || 'Your video was rejected',
          timestamp: new Date(),
          urgent: true
        });
      }
    } catch (socketError) {
      console.warn('⚠️ Could not send WebSocket notification:', socketError.message);
    }

    res.json({
      success: true,
      message: 'Video rejected (see notification for details)',
      reason: reason
    });
  } catch (error) {
    console.error('Error rejecting tutor:', error);
    res.status(500).json({ success: false, message: 'Failed to reject tutor' });
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
