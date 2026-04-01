const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const User = require('../models/User');
const Alert = require('../models/Alert');
const Payment = require('../models/Payment');
const Lesson = require('../models/Lesson');
const Notification = require('../models/Notification');
const MaterialReport = require('../models/MaterialReport');
const MaterialPurchase = require('../models/MaterialPurchase');
const TutorMaterial = require('../models/TutorMaterial');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const alertService = require('../services/alertService');
const walletService = require('../services/walletService');
const { formatNameWithInitial } = require('../utils/nameFormatter');
const { triggerManualRelease } = require('../jobs/releaseEarnings'); // Added manual trigger
const autoReleaseClassPayments = require('../jobs/autoReleaseClassPayments'); // Manual finalize classes
const { initializeGCS } = require('../config/gcs');

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
      }).select('name firstName lastName email picture onboardingData tutorOnboarding tutorCredentials tutorApproved stripeConnectOnboarded payoutProvider payoutDetails residenceCountry isUSPersonForTax hasUSBankAccount taxInfoCompletedAt');
      
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
      }).select('name firstName lastName email picture onboardingData tutorOnboarding tutorCredentials tutorApproved stripeConnectOnboarded payoutProvider payoutDetails residenceCountry isUSPersonForTax hasUSBankAccount taxInfoCompletedAt');
    } else {
      // Get ALL tutors with videos
      const allTutors = await User.find({
        userType: 'tutor',
        $or: [
          { 'onboardingData.introductionVideo': { $exists: true, $ne: null, $ne: '' } },
          { 'onboardingData.pendingVideo': { $exists: true, $ne: null, $ne: '' } }
        ]
      }).select('name firstName lastName email picture onboardingData tutorOnboarding tutorCredentials tutorApproved stripeConnectOnboarded payoutProvider payoutDetails residenceCountry isUSPersonForTax hasUSBankAccount taxInfoCompletedAt createdAt');
      
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
        const fallbackDate = tutor.createdAt || new Date();
        // Use updateOne instead of save() to avoid validation issues with partial select
        await User.updateOne(
          { _id: tutor._id },
          { $set: { 'tutorOnboarding.videoUploadedAt': fallbackDate } }
        );
        if (!tutor.tutorOnboarding) {
          tutor.tutorOnboarding = {};
        }
        tutor.tutorOnboarding.videoUploadedAt = fallbackDate;
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
        }).select('name firstName lastName email picture onboardingData tutorOnboarding tutorCredentials tutorApproved stripeConnectOnboarded payoutProvider payoutDetails residenceCountry createdAt');
        
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
        }).select('name firstName lastName email picture onboardingData tutorOnboarding tutorCredentials tutorApproved stripeConnectOnboarded payoutProvider payoutDetails residenceCountry createdAt');
      } else {
        // Pending status - re-fetch all and filter
        const allTutors = await User.find({
          userType: 'tutor',
          $or: [
            { 'onboardingData.introductionVideo': { $exists: true, $ne: null, $ne: '' } },
            { 'onboardingData.pendingVideo': { $exists: true, $ne: null, $ne: '' } }
          ]
        }).select('name firstName lastName email picture onboardingData tutorOnboarding tutorCredentials tutorApproved stripeConnectOnboarded payoutProvider payoutDetails residenceCountry createdAt');
        
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
      // Determine if this is a RE-APPROVAL (tutor changed video after being previously approved)
      // or a FIRST-TIME approval
      const isReApproval = !!tutor.onboardingData?.pendingVideo;
      const wasAlreadyApproved = tutor.tutorApproved === true;
      
      console.log('📹 Video approval type:', { isReApproval, wasAlreadyApproved });
      
      // If there's a pending video, move it to main video
      if (tutor.onboardingData?.pendingVideo) {
        console.log('📹 Moving pending video to approved:', {
          pendingVideo: tutor.onboardingData.pendingVideo,
          pendingThumbnail: tutor.onboardingData.pendingVideoThumbnail,
          pendingType: tutor.onboardingData.pendingVideoType
        });
        
        tutor.onboardingData.introductionVideo = tutor.onboardingData.pendingVideo;
        // Always use pending thumbnail (even if empty), don't fall back to old thumbnail
        tutor.onboardingData.videoThumbnail = tutor.onboardingData.pendingVideoThumbnail || '';
        tutor.onboardingData.videoType = tutor.onboardingData.pendingVideoType || 'upload';
        
        console.log('📹 New approved video:', {
          introductionVideo: tutor.onboardingData.introductionVideo,
          videoThumbnail: tutor.onboardingData.videoThumbnail,
          videoType: tutor.onboardingData.videoType
        });
        
        // Clear pending video fields
        tutor.onboardingData.pendingVideo = null;
        tutor.onboardingData.pendingVideoThumbnail = null;
        tutor.onboardingData.pendingVideoType = null;
      }

      tutor.tutorOnboarding.videoApproved = true;
      tutor.tutorOnboarding.videoApprovedAt = new Date();

      // Check if all onboarding steps are complete (including credentials)
      const photoComplete = !!tutor.picture;
      const videoApproved = true; // We just approved it
      const hasStripe = tutor.stripeConnectOnboarded === true;
      const hasPayPal = tutor.payoutProvider === 'paypal' && !!tutor.payoutDetails?.paypalEmail;
      const hasManual = tutor.payoutProvider === 'manual';
      const payoutComplete = hasStripe || hasPayPal || hasManual;
      const credentialsApproved = checkAllCredentialsApproved(tutor);

      if (photoComplete && videoApproved && payoutComplete && credentialsApproved) {
        tutor.tutorApproved = true;
        tutor.tutorOnboarding.completedAt = new Date();
        console.log(`🎉 Tutor ${tutor.email} is now FULLY APPROVED (video approved by admin)`);
      } else {
        console.log(`📋 Tutor ${tutor.email} video approved but not fully approved yet:`, {
          photoComplete, videoApproved, payoutComplete, credentialsApproved
        });
      }

    await tutor.save();

    // Determine notification message based on first-time vs re-approval
    // First-time: Full message with "Add availability" button
    // Re-approval: Simple message without button
    const isFirstTimeApproval = !isReApproval && !wasAlreadyApproved;
    
    const notificationTitle = '🎉 Video Approved!';
    const notificationMessage = isFirstTimeApproval 
      ? 'Your introduction video has been approved. You can now start tutoring! Your profile will now be discoverable to students. Be sure to add your availability!'
      : 'Your introduction video has been approved.';
    
    const notificationData = isFirstTimeApproval 
      ? {
          tutorApproved: tutor.tutorApproved,
          approvedAt: new Date(),
          hasActionButton: true,
          actionButtonText: 'Add Availability',
          actionRoute: '/tabs/availability-setup',
          isFirstTimeApproval: true
        }
      : {
          tutorApproved: tutor.tutorApproved,
          approvedAt: new Date(),
          isFirstTimeApproval: false
        };
    
    console.log(`📝 Notification type: ${isFirstTimeApproval ? 'FIRST-TIME' : 'RE-APPROVAL'}`);

    // Create database notification for tutor
    try {
      const notification = new Notification({
        userId: tutor._id,
        type: 'tutor_video_approved',
        title: notificationTitle,
        message: notificationMessage,
        data: notificationData,
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
          message: notificationMessage,
          approved: true,
          tutorApproved: tutor.tutorApproved,
          timestamp: new Date(),
          isFirstTimeApproval
        });
        console.log(`📬 Real-time video approval notification sent to tutor room: user:${tutor.auth0Id}`);
        
        // Also emit to MongoDB-based room (reaches all devices)
        req.io.to(`mongo:${tutor._id.toString()}`).emit('tutor_video_approved', {
          message: notificationMessage,
          approved: true,
          tutorApproved: tutor.tutorApproved,
          timestamp: new Date(),
          isFirstTimeApproval
        });
        
        // Also emit new_notification for the notification bell
        req.io.to(`user:${tutor.auth0Id}`).emit('new_notification', {
          type: 'tutor_video_approved',
          title: notificationTitle,
          message: notificationMessage,
          timestamp: new Date(),
          urgent: false,
          data: notificationData
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
          
          // Also emit to MongoDB-based room (reaches all devices)
          req.io.to(`mongo:${tutor._id.toString()}`).emit('tutor_video_rejected', {
            message: rejectionReason || 'Your video was rejected',
            approved: false,
            reason: rejectionReason,
            timestamp: new Date()
          });
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

    // Check if fully approved (including credentials)
    const photoComplete = !!tutor.picture;
    const hasStripe = tutor.stripeConnectOnboarded === true;
    const hasPayPal = tutor.payoutProvider === 'paypal' && !!tutor.payoutDetails?.paypalEmail;
    const hasManual = tutor.payoutProvider === 'manual';
    const payoutComplete = hasStripe || hasPayPal || hasManual;
    const credentialsApproved = checkAllCredentialsApproved(tutor);

    if (photoComplete && payoutComplete && credentialsApproved) {
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
        message: 'Your introduction video has been approved. You can now start tutoring! Your profile will now be discoverable to students. Be sure to add your availability!',
        data: {
          tutorApproved: tutor.tutorApproved,
          approvedAt: new Date(),
          hasActionButton: true,
          actionButtonText: 'Add Availability',
          actionRoute: '/tabs/availability-setup'
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
          message: 'Your introduction video has been approved. You can now start tutoring! Your profile will now be discoverable to students. Be sure to add your availability!',
          approved: true,
          tutorApproved: tutor.tutorApproved,
          timestamp: new Date()
        });
        console.log(`📬 Tutor approval notification sent to room: user:${tutor.auth0Id}`);
        
        // Also emit to MongoDB-based room (reaches all devices)
        req.io.to(`mongo:${tutor._id.toString()}`).emit('tutor_video_approved', {
          message: 'Your introduction video has been approved. You can now start tutoring! Your profile will now be discoverable to students. Be sure to add your availability!',
          approved: true,
          tutorApproved: tutor.tutorApproved,
          timestamp: new Date()
        });
        
        // Also emit new_notification for the notification bell
        req.io.to(`user:${tutor.auth0Id}`).emit('new_notification', {
          type: 'tutor_video_approved',
          title: '🎉 Video Approved!',
          message: 'Your introduction video has been approved. You can now start tutoring! Your profile will now be discoverable to students. Be sure to add your availability!',
          timestamp: new Date(),
          urgent: false,
          data: {
            hasActionButton: true,
            actionButtonText: 'Add Availability',
            actionRoute: '/tabs/availability-setup'
          }
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
        message: `Your introduction video was <strong>rejected</strong>. Reason: <strong>${reason || 'Video did not meet requirements'}</strong>`,
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
        
        // Also emit to MongoDB-based room (reaches all devices)
        req.io.to(`mongo:${tutor._id.toString()}`).emit('tutor_video_rejected', {
          message: reason || 'Your video was rejected',
          approved: false,
          reason: reason,
          timestamp: new Date()
        });
        
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

/**
 * GET /api/admin/platform-revenue
 * Get comprehensive platform revenue analytics
 * Query params:
 * - startDate: ISO date string (default: 30 days ago)
 * - endDate: ISO date string (default: now)
 * - groupBy: 'day' | 'week' | 'month' (default: 'day')
 */
router.get('/platform-revenue', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      groupBy = 'day',
      page = 1,        // NEW: pagination
      limit = 50       // NEW: default 50 payments per page
    } = req.query;
    
    // Date range (default: last 30 days)
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    console.log(`📊 Fetching platform revenue from ${start.toISOString()} to ${end.toISOString()}`);
    console.log(`📄 Pagination: page ${page}, limit ${limit}`);
    
    // Get all payments where revenue was recognized
    // UPDATED: Sort by most recent first (revenueRecognizedAt DESC)
    const payments = await Payment.find({
      revenueRecognized: true,
      revenueRecognizedAt: {
        $gte: start,
        $lte: end
      }
    })
    .populate('lessonId', 'subject startTime duration')
    .populate('studentId', 'name email')
    .populate('tutorId', 'name email')
    .sort({ revenueRecognizedAt: -1 });  // ✅ MOST RECENT FIRST
    
    console.log(`💰 Found ${payments.length} payments with recognized revenue`);
    
    // Calculate totals
    let totalGrossRevenue = 0; // Total lesson price
    let totalPlatformFee = 0; // Platform's 20% cut
    let totalStripeFees = 0; // Stripe processing fees
    let totalTutorPayouts = 0; // Amount paid to tutors
    let totalNetPlatformRevenue = 0; // Platform fee - Stripe fees
    let totalLessons = 0;
    
    const paymentsByMethod = {
      wallet: { count: 0, total: 0, platformFee: 0 },
      card: { count: 0, total: 0, platformFee: 0 },
      apple_pay: { count: 0, total: 0, platformFee: 0 },
      google_pay: { count: 0, total: 0, platformFee: 0 },
      'saved-card': { count: 0, total: 0, platformFee: 0 }
    };
    
    const revenueTimeline = [];
    const paymentDetails = [];
    
    payments.forEach(payment => {
      const grossAmount = payment.amount || 0;
      const platformFee = payment.platformFee || 0;
      const stripeFee = payment.stripeFee || 0;
      const tutorPayout = payment.tutorPayout || 0;
      const netRevenue = platformFee - stripeFee;
      
      totalGrossRevenue += grossAmount;
      totalPlatformFee += platformFee;
      totalStripeFees += stripeFee;
      totalTutorPayouts += tutorPayout;
      totalNetPlatformRevenue += netRevenue;
      totalLessons++;
      
      // Track by payment method
      if (paymentsByMethod[payment.paymentMethod]) {
        paymentsByMethod[payment.paymentMethod].count++;
        paymentsByMethod[payment.paymentMethod].total += grossAmount;
        paymentsByMethod[payment.paymentMethod].platformFee += platformFee;
      }
      
      // Timeline data
      revenueTimeline.push({
        date: payment.revenueRecognizedAt,
        grossRevenue: grossAmount,
        platformFee: platformFee,
        stripeFee: stripeFee,
        netRevenue: netRevenue,
        lessonId: payment.lessonId?._id,
        subject: payment.lessonId?.subject
      });
      
      // Payment details for export
      paymentDetails.push({
        paymentId: payment._id,
        date: payment.revenueRecognizedAt,
        studentName: payment.studentId?.name || 'Unknown',
        studentEmail: payment.studentId?.email,
        tutorName: payment.tutorId?.name || 'Unknown',
        tutorEmail: payment.tutorId?.email,
        lessonId: payment.lessonId?._id,
        subject: payment.lessonId?.subject,
        lessonDate: payment.lessonId?.startTime,
        duration: payment.lessonId?.duration,
        paymentMethod: payment.paymentMethod,
        paymentStatus: payment.status, // Source of truth
        transferStatus: payment.transferStatus, // Source of truth
        earningsReleaseDate: payment.earningsReleaseDate, // When earnings become available
        refundMethod: payment.refundMethod || null, // NEW: 'wallet' or 'card' (where refund was sent)
        refundAmount: payment.refundAmount || 0, // NEW: How much was refunded
        grossAmount: grossAmount.toFixed(2),
        platformFee: platformFee.toFixed(2),
        platformFeePercent: payment.platformFeePercentage || 20,
        stripeFee: stripeFee.toFixed(2),
        netPlatformRevenue: netRevenue.toFixed(2),
        tutorPayout: tutorPayout.toFixed(2),
        stripePaymentIntentId: payment.stripePaymentIntentId
      });
    });
    
    // NEW: Paginate payment details
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = pageNum * limitNum;
    const paginatedPayments = paymentDetails.slice(startIndex, endIndex);
    const totalPages = Math.ceil(paymentDetails.length / limitNum);
    const hasMore = endIndex < paymentDetails.length;
    
    console.log(`📄 Returning ${paginatedPayments.length} payments (page ${pageNum}/${totalPages})`);
    
    // Group timeline by period if requested
    let groupedTimeline = revenueTimeline;
    if (groupBy === 'week' || groupBy === 'month') {
      const grouped = {};
      revenueTimeline.forEach(item => {
        let key;
        const date = new Date(item.date);
        
        if (groupBy === 'week') {
          // Get week start (Sunday)
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          weekStart.setHours(0, 0, 0, 0);
          key = weekStart.toISOString().split('T')[0];
        } else if (groupBy === 'month') {
          // Get month start
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }
        
        if (!grouped[key]) {
          grouped[key] = {
            period: key,
            grossRevenue: 0,
            platformFee: 0,
            stripeFee: 0,
            netRevenue: 0,
            lessonCount: 0
          };
        }
        
        grouped[key].grossRevenue += item.grossRevenue;
        grouped[key].platformFee += item.platformFee;
        grouped[key].stripeFee += item.stripeFee;
        grouped[key].netRevenue += item.netRevenue;
        grouped[key].lessonCount++;
      });
      
      groupedTimeline = Object.values(grouped);
    }
    
    // Calculate averages
    const avgLessonPrice = totalLessons > 0 ? totalGrossRevenue / totalLessons : 0;
    const avgPlatformFeePerLesson = totalLessons > 0 ? totalPlatformFee / totalLessons : 0;
    const avgNetRevenuePerLesson = totalLessons > 0 ? totalNetPlatformRevenue / totalLessons : 0;
    
    // Get pending revenue (lessons completed but payment not yet recognized)
    // Exclude wallet top-ups and other non-lesson payments
    const pendingRevenue = await Payment.find({
      revenueRecognized: false,
      status: { $in: ['authorized', 'succeeded'] },
      paymentType: { $in: ['lesson_booking', 'class_booking'] } // Only lesson/class payments
    }).populate('lessonId', 'endTime');
    
    const totalPendingRevenue = pendingRevenue.reduce((sum, p) => sum + (p.platformFee || 0), 0);
    const totalPendingStripeFees = pendingRevenue.reduce((sum, p) => sum + (p.stripeFee || 0), 0);
    const totalPendingNetRevenue = totalPendingRevenue - totalPendingStripeFees;
    
    // Calculate next processing time (earliest lesson + 15 MINUTES for testing)
    // TODO: Change back to 24 hours for production
    let nextProcessingTime = null;
    if (pendingRevenue.length > 0) {
      const sortedByEndTime = pendingRevenue
        .filter(p => p.lessonId?.endTime)
        .sort((a, b) => new Date(a.lessonId.endTime).getTime() - new Date(b.lessonId.endTime).getTime());
      
      if (sortedByEndTime.length > 0) {
        const earliestLessonEnd = new Date(sortedByEndTime[0].lessonId.endTime);
        nextProcessingTime = new Date(earliestLessonEnd.getTime() + 15 * 60 * 1000); // +15 minutes (testing)
      }
    }
    
    // ============================================================
    // NEW: CALCULATE SAFE WITHDRAWAL AMOUNT
    // Shows how much platform owner can safely withdraw to bank
    // ============================================================
    console.log('\n💰 Calculating safe withdrawal amount...');
    
    // 1. Get current Stripe available balance
    let currentStripeBalance = 0;
    let stripePendingBalance = 0;
    try {
      const stripeBalance = await stripe.balance.retrieve();
      // Available balance (can withdraw now)
      if (stripeBalance.available && stripeBalance.available.length > 0) {
        currentStripeBalance = stripeBalance.available[0].amount / 100; // Convert cents to dollars
      }
      // Pending balance (funds being held by Stripe, not available yet)
      if (stripeBalance.pending && stripeBalance.pending.length > 0) {
        stripePendingBalance = stripeBalance.pending[0].amount / 100;
      }
      console.log(`   Stripe Available: $${currentStripeBalance.toFixed(2)}`);
      console.log(`   Stripe Pending: $${stripePendingBalance.toFixed(2)}`);
    } catch (stripeError) {
      console.error('⚠️  Error fetching Stripe balance:', stripeError.message);
      // Continue with 0 balance if Stripe API fails
    }
    
    // 2. Calculate total owed to ALL tutors (pending + available)
    // Also break down by payout method (Stripe vs PayPal)
    const allTutors = await User.find({ 
      userType: 'tutor',
      $or: [
        { 'tutorEarnings.pendingBalance': { $gt: 0 } },
        { 'tutorEarnings.availableBalance': { $gt: 0 } }
      ]
    }).select('tutorEarnings name email payoutProvider stripeConnectOnboarded');
    
    let totalTutorsPending = 0;
    let totalTutorsAvailable = 0;
    let tutorsWithBalances = 0;
    
    // Track by payout method
    let owedToStripeTutors = 0;
    let owedToPayPalTutors = 0;
    let stripeTutorsCount = 0;
    let paypalTutorsCount = 0;
    
    for (const tutor of allTutors) {
      const pending = tutor.tutorEarnings?.pendingBalance || 0;
      const available = tutor.tutorEarnings?.availableBalance || 0;
      const totalOwed = pending + available;
      
      if (pending > 0 || available > 0) {
        tutorsWithBalances++;
        totalTutorsPending += pending;
        totalTutorsAvailable += available;
        
        // Determine payout method
        const usesStripe = tutor.stripeConnectOnboarded === true;
        const usesPayPal = tutor.payoutProvider === 'paypal';
        
        if (usesStripe) {
          owedToStripeTutors += totalOwed;
          stripeTutorsCount++;
        } else if (usesPayPal) {
          owedToPayPalTutors += totalOwed;
          paypalTutorsCount++;
        } else {
          // Default to PayPal if no clear method (safer assumption)
          owedToPayPalTutors += totalOwed;
          paypalTutorsCount++;
        }
        
        console.log(`   Tutor: ${tutor.name || tutor.email} (${usesStripe ? 'Stripe' : usesPayPal ? 'PayPal' : 'Unknown'})`);
        console.log(`     Pending: $${pending.toFixed(2)}, Available: $${available.toFixed(2)}`);
      }
    }
    
    // 3. Track PayPal withdrawals (in-flight and historical)
    const Withdrawal = require('../models/Withdrawal');
    
    // Active withdrawals (pending/processing - already sent to PayPal)
    const activePayPalWithdrawals = await Withdrawal.find({
      method: 'paypal',
      status: { $in: ['pending', 'processing'] }
    }).select('amount netAmount');
    
    let paypalWithdrawalsInFlight = 0;
    activePayPalWithdrawals.forEach(w => {
      // Use netAmount (after fees) since that's what actually gets sent
      paypalWithdrawalsInFlight += w.netAmount || w.amount || 0;
    });
    
    // Historical: Total PayPal withdrawals ever sent (completed)
    const completedPayPalWithdrawals = await Withdrawal.aggregate([
      {
        $match: {
          method: 'paypal',
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalSent: { $sum: '$netAmount' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    const totalPayPalSent = completedPayPalWithdrawals[0]?.totalSent || 0;
    const paypalWithdrawalCount = completedPayPalWithdrawals[0]?.count || 0;
    
    // Total PayPal needed = Owed balances + Withdrawals in flight
    const totalPayPalNeeded = owedToPayPalTutors + paypalWithdrawalsInFlight;

    // 4. Aggregate payout costs (all-time) for true profit calculation
    const payoutCostAggregation = await Withdrawal.aggregate([
      {
        $match: {
          status: { $in: ['completed', 'processing'] }
        }
      },
      {
        $group: {
          _id: null,
          totalPayPalSenderFees: { $sum: { $ifNull: ['$paypalSenderFee', 0] } },
          totalPayPalTutorFees: { $sum: { $cond: [{ $eq: ['$method', 'paypal'] }, { $ifNull: ['$paypalFee', 0] }, 0] } },
          totalWithdrawalCount: { $sum: 1 },
          paypalWithdrawalCount: { $sum: { $cond: [{ $eq: ['$method', 'paypal'] }, 1, 0] } },
          stripeWithdrawalCount: { $sum: { $cond: [{ $eq: ['$method', 'stripe_connect'] }, 1, 0] } },
          totalAmountWithdrawn: { $sum: '$amount' },
          totalNetAmountSent: { $sum: '$netAmount' }
        }
      }
    ]);

    const payoutCosts = payoutCostAggregation[0] || {
      totalPayPalSenderFees: 0,
      totalPayPalTutorFees: 0,
      totalWithdrawalCount: 0,
      paypalWithdrawalCount: 0,
      stripeWithdrawalCount: 0,
      totalAmountWithdrawn: 0,
      totalNetAmountSent: 0
    };

    // True profit = Net platform revenue - PayPal sender fees + PayPal fees collected from tutors
    // PayPal fees collected from tutors offset the sender fees (what you keep from the fee spread)
    const totalPayPalSenderFees = payoutCosts.totalPayPalSenderFees;
    const totalPayPalTutorFees = payoutCosts.totalPayPalTutorFees;
    const paypalFeeProfit = totalPayPalTutorFees - totalPayPalSenderFees;
    const truePlatformProfit = totalNetPlatformRevenue - totalPayPalSenderFees;
    
    console.log(`\n   💳 Owed to Stripe Tutors: $${owedToStripeTutors.toFixed(2)} (${stripeTutorsCount} tutors)`);
    console.log(`   💰 Owed to PayPal Tutors: $${owedToPayPalTutors.toFixed(2)} (${paypalTutorsCount} tutors)`);
    if (paypalWithdrawalsInFlight > 0) {
      console.log(`   ⏳ PayPal Withdrawals in Flight: $${paypalWithdrawalsInFlight.toFixed(2)} (${activePayPalWithdrawals.length} withdrawal(s))`);
    }
    console.log(`   💰 TOTAL PayPal Needed: $${totalPayPalNeeded.toFixed(2)}`);
    console.log(`   📊 Historical: $${totalPayPalSent.toFixed(2)} sent via PayPal (${paypalWithdrawalCount} withdrawals)`);
    console.log(`   📊 PayPal sender fees (platform cost): $${totalPayPalSenderFees.toFixed(2)}`);
    console.log(`   📊 PayPal fees collected from tutors: $${totalPayPalTutorFees.toFixed(2)}`);
    console.log(`   📊 True platform profit: $${truePlatformProfit.toFixed(2)}`);
    
    const totalOwedToTutors = totalTutorsPending + totalTutorsAvailable;
    console.log(`\n   Total Tutors with Balances: ${tutorsWithBalances}`);
    console.log(`   Total Owed (Pending): $${totalTutorsPending.toFixed(2)}`);
    console.log(`   Total Owed (Available): $${totalTutorsAvailable.toFixed(2)}`);
    console.log(`   Total Owed to Tutors: $${totalOwedToTutors.toFixed(2)}`);
    
    // 3. Calculate safe withdrawal amount
    // Safe = Current Stripe Balance - Total Owed to Tutors
    const safeToWithdraw = Math.max(0, currentStripeBalance - totalOwedToTutors);
    
    console.log(`\n   ═══════════════════════════════════════`);
    console.log(`   Stripe Balance:       $${currentStripeBalance.toFixed(2)}`);
    console.log(`   Owed to Tutors:      -$${totalOwedToTutors.toFixed(2)}`);
    console.log(`   ═══════════════════════════════════════`);
    console.log(`   SAFE TO WITHDRAW:     $${safeToWithdraw.toFixed(2)} ✅`);
    console.log(`   ═══════════════════════════════════════\n`);
    
    // 4. Compare with recognized revenue (sanity check)
    const discrepancy = Math.abs(safeToWithdraw - totalNetPlatformRevenue);
    let warningMessage = null;
    
    if (discrepancy > 1) { // Allow $1 rounding difference
      if (safeToWithdraw < totalNetPlatformRevenue) {
        warningMessage = `Some revenue ($${(totalNetPlatformRevenue - safeToWithdraw).toFixed(2)}) is recognized but not yet in Stripe. This may be from pending captures or recent refunds.`;
        console.warn(`⚠️  ${warningMessage}`);
      } else {
        warningMessage = `Stripe balance is higher than recognized revenue by $${(safeToWithdraw - totalNetPlatformRevenue).toFixed(2)}. This may include pending payments or wallet top-ups.`;
        console.warn(`⚠️  ${warningMessage}`);
      }
    }
    
    res.json({
      success: true,
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
        days: Math.ceil((end - start) / (1000 * 60 * 60 * 24))
      },
      summary: {
        totalLessons,
        totalGrossRevenue: parseFloat(totalGrossRevenue.toFixed(2)),
        totalPlatformFee: parseFloat(totalPlatformFee.toFixed(2)),
        totalStripeFees: parseFloat(totalStripeFees.toFixed(2)),
        totalNetPlatformRevenue: parseFloat(totalNetPlatformRevenue.toFixed(2)),
        totalTutorPayouts: parseFloat(totalTutorPayouts.toFixed(2)),
        avgLessonPrice: parseFloat(avgLessonPrice.toFixed(2)),
        avgPlatformFeePerLesson: parseFloat(avgPlatformFeePerLesson.toFixed(2)),
        avgNetRevenuePerLesson: parseFloat(avgNetRevenuePerLesson.toFixed(2)),
        platformFeePercentage: 20, // Current platform fee
        effectiveFeeAfterStripe: totalGrossRevenue > 0 ? parseFloat(((totalNetPlatformRevenue / totalGrossRevenue) * 100).toFixed(2)) : 0
      },
      pending: {
        pendingLessons: pendingRevenue.length,
        totalPendingRevenue: parseFloat(totalPendingRevenue.toFixed(2)),
        totalPendingStripeFees: parseFloat(totalPendingStripeFees.toFixed(2)),
        totalPendingNetRevenue: parseFloat(totalPendingNetRevenue.toFixed(2)),
        nextProcessingTime: nextProcessingTime ? nextProcessingTime.toISOString() : null
      },
      byPaymentMethod: paymentsByMethod,
      timeline: groupedTimeline,
      payments: paginatedPayments, // ✅ PAGINATED PAYMENTS
      pagination: {  // ✅ NEW: Pagination metadata
        currentPage: pageNum,
        totalPages,
        totalPayments: paymentDetails.length,
        paymentsPerPage: limitNum,
        hasMore
      },
      withdrawalInfo: {
        currentStripeBalance: parseFloat(currentStripeBalance.toFixed(2)),
        stripePendingBalance: parseFloat(stripePendingBalance.toFixed(2)),
        totalOwedToTutors: parseFloat(totalOwedToTutors.toFixed(2)),
        breakdown: {
          tutorsPending: parseFloat(totalTutorsPending.toFixed(2)),
          tutorsAvailable: parseFloat(totalTutorsAvailable.toFixed(2)),
          tutorsCount: tutorsWithBalances
        },
        byPayoutMethod: {
          stripe: {
            owed: parseFloat(owedToStripeTutors.toFixed(2)),
            tutorsCount: stripeTutorsCount,
            note: 'Paid from your Stripe balance (automatic)'
          },
          paypal: {
            owed: parseFloat(owedToPayPalTutors.toFixed(2)),
            tutorsCount: paypalTutorsCount,
            note: 'Requires funds in your PayPal Business account',
            inFlight: parseFloat(paypalWithdrawalsInFlight.toFixed(2)),
            inFlightCount: activePayPalWithdrawals.length,
            totalNeeded: parseFloat(totalPayPalNeeded.toFixed(2)),
            historicalSent: parseFloat(totalPayPalSent.toFixed(2)),
            historicalCount: paypalWithdrawalCount
          }
        },
        safeToWithdraw: parseFloat(safeToWithdraw.toFixed(2)),
        recognizedRevenue: parseFloat(totalNetPlatformRevenue.toFixed(2)),
        discrepancy: parseFloat(discrepancy.toFixed(2)),
        warning: warningMessage
      },
      payoutCosts: {
        totalPayPalSenderFees: parseFloat(totalPayPalSenderFees.toFixed(2)),
        totalPayPalTutorFees: parseFloat(totalPayPalTutorFees.toFixed(2)),
        paypalFeeProfit: parseFloat(paypalFeeProfit.toFixed(2)),
        truePlatformProfit: parseFloat(truePlatformProfit.toFixed(2)),
        totalWithdrawals: payoutCosts.totalWithdrawalCount,
        paypalWithdrawals: payoutCosts.paypalWithdrawalCount,
        stripeWithdrawals: payoutCosts.stripeWithdrawalCount,
        totalAmountWithdrawn: parseFloat(payoutCosts.totalAmountWithdrawn.toFixed(2)),
        totalNetAmountSent: parseFloat(payoutCosts.totalNetAmountSent.toFixed(2))
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching platform revenue:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch platform revenue',
      error: error.message
    });
  }
});

// GET /api/admin/reported-lessons - Get lessons with reported issues
router.get('/reported-lessons', verifyToken, requireAdmin, async (req, res) => {
  try {
    const {
      status = 'pending', // 'pending', 'investigating', 'resolved', 'all'
      page = 1,
      limit = 20
    } = req.query;

    console.log(`🔍 Admin fetching reported lessons: status=${status}`);

    // Build query
    const query = { issueReported: true };
    
    if (status === 'pending') {
      query.underInvestigation = false;
    } else if (status === 'investigating') {
      query.underInvestigation = true;
      query.investigationResolvedAt = null;
    } else if (status === 'resolved') {
      query.investigationResolvedAt = { $ne: null };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const lessons = await Lesson.find(query)
      .populate('studentId', 'name email picture')
      .populate('tutorId', 'name email picture')
      .populate('issueReportedBy', 'name email')
      .populate('payoutPausedBy', 'name email')
      .sort({ issueReportedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Lesson.countDocuments(query);

    console.log(`✅ Found ${lessons.length} reported lessons (total: ${total})`);

    res.json({
      success: true,
      lessons,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('❌ Error fetching reported lessons:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch reported lessons'
    });
  }
});

// POST /api/admin/lesson/:id/pause-payout - Pause tutor payout for investigation
router.post('/lesson/:id/pause-payout', verifyToken, requireAdmin, async (req, res) => {
  try {
    const lessonId = req.params.id;
    const { notes } = req.body;
    const adminEmail = req.user.email;

    console.log(`⏸️  Admin pausing payout for lesson ${lessonId}`);

    const lesson = await Lesson.findById(lessonId)
      .populate('studentId tutorId');

    if (!lesson) {
      return res.status(404).json({ success: false, error: 'Lesson not found' });
    }

    const admin = await User.findOne({ email: adminEmail });

    lesson.payoutPaused = true;
    lesson.payoutPausedAt = new Date();
    lesson.payoutPausedBy = admin._id;
    lesson.underInvestigation = true;
    
    if (notes) {
      lesson.investigationNotes = notes;
    }

    await lesson.save();

    // 🔔 Notify tutor that payment is under review
    if (lesson.tutorId) {
      const studentDisplayName = formatNameWithInitial(lesson.studentId);
      await Notification.create({
        userId: lesson.tutorId._id,
        type: 'payout_paused',
        title: 'Payment Under Review',
        message: `Your payment for your lesson with <strong>${studentDisplayName}</strong> is <strong>under review</strong>. We'll notify you once the review is complete.`,
        link: `/tabs/home/earnings`,
        data: {
          lessonId: lesson._id,
          studentName: studentDisplayName
        }
      });

      // Real-time push via WebSocket
      if (global.io) {
        global.io.to(`user:${lesson.tutorId._id}`).emit('notification', {
          type: 'payout_paused',
          title: 'Payment Under Review',
          message: `Your payment for your lesson with ${studentDisplayName} is under review.`
        });
      }

      console.log(`🔔 Notified tutor ${lesson.tutorId.name} about paused payout`);
    }

    console.log(`✅ Payout paused for lesson ${lessonId}`);

    res.json({
      success: true,
      message: 'Payout paused successfully',
      lesson: {
        _id: lesson._id,
        payoutPaused: lesson.payoutPaused,
        underInvestigation: lesson.underInvestigation
      }
    });

  } catch (error) {
    console.error('❌ Error pausing payout:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to pause payout'
    });
  }
});

// POST /api/admin/lesson/:id/resume-payout - Resume tutor payout after investigation
router.post('/lesson/:id/resume-payout', verifyToken, requireAdmin, async (req, res) => {
  try {
    const lessonId = req.params.id;
    const { resolution, notes } = req.body;

    console.log(`▶️  Admin resuming payout for lesson ${lessonId}: resolution=${resolution}`);

    const lesson = await Lesson.findById(lessonId)
      .populate('studentId tutorId');

    if (!lesson) {
      return res.status(404).json({ success: false, error: 'Lesson not found' });
    }

    // Find the payment for this lesson
    const payment = await Payment.findOne({ lessonId: lesson._id });

    if (!payment) {
      console.warn(`⚠️  No payment found for lesson ${lessonId}`);
    }

    // Handle different resolutions
    if (resolution === 'refunded' && payment) {
      console.log(`💸 Processing full refund for lesson ${lessonId}`);
      
      try {
        // Refund to student's wallet
        await walletService.refund({
          userId: lesson.studentId._id,
          lessonId: lesson._id,
          amount: lesson.price,
          reason: `Admin investigation - ${notes || 'Issue validated'}`,
          paymentId: payment._id
        });

        // Cancel tutor payout - keep transferStatus but set payout to 0
        payment.tutorPayout = 0;
        payment.status = 'refunded';
        payment.refundAmount = lesson.price;
        payment.refundedAt = new Date();
        payment.refundReason = `Admin investigation: ${notes || 'Issue validated'}`;
        payment.refundMethod = 'wallet';
        // Keep transferStatus as is (likely 'on_hold') - don't change to 'refunded'
        await payment.save();

        console.log(`✅ Refunded $${lesson.price} to student ${lesson.studentId.name}`);
        
        const tutorDisplayName = formatNameWithInitial(lesson.tutorId);
        const studentDisplayName = formatNameWithInitial(lesson.studentId);
        
        // Send notification to student
        await Notification.create({
          userId: lesson.studentId._id,
          type: 'lesson_refunded',
          title: 'Lesson Refunded',
          message: `Your lesson with <strong>${tutorDisplayName}</strong> has been refunded to your wallet.`,
          link: `/wallet`,
          data: {
            lessonId: lesson._id,
            amount: lesson.price,
            reason: notes
          }
        });

        // Send notification to tutor
        await Notification.create({
          userId: lesson.tutorId._id,
          type: 'payment_cancelled',
          title: 'Payment Cancelled',
          message: `Payment for your lesson with <strong>${studentDisplayName}</strong> has been <strong>cancelled</strong> due to investigation findings.`,
          link: `/tabs/home/earnings`,
          data: {
            lessonId: lesson._id,
            studentId: lesson.studentId._id,
            studentName: studentDisplayName,
            tutorId: lesson.tutorId._id,
            tutorName: tutorDisplayName,
            scheduledAt: lesson.scheduledAt,
            amount: lesson.price,
            reason: notes,
            resolution: 'refunded',
            canDispute: true
          }
        });

      } catch (refundError) {
        console.error(`❌ Refund failed for lesson ${lessonId}:`, refundError);
        return res.status(500).json({
          success: false,
          error: `Failed to process refund: ${refundError.message}`
        });
      }

    } else if (resolution === 'partial_refund' && payment) {
      console.log(`💸 Processing partial refund for lesson ${lessonId}`);
      
      // Default to 50% refund if not specified
      const refundAmount = lesson.price * 0.5;
      const tutorAmount = lesson.price * 0.5;
      
      try {
        // Refund half to student's wallet
        await walletService.refund({
          userId: lesson.studentId._id,
          lessonId: lesson._id,
          amount: refundAmount,
          reason: `Admin investigation - Partial refund: ${notes || 'Partial resolution'}`,
          paymentId: payment._id
        });

        // Update payment to reflect partial refund
        payment.tutorPayout = tutorAmount;
        payment.status = 'partially_refunded';
        payment.refundAmount = refundAmount;
        payment.refundedAt = new Date();
        payment.refundReason = `Admin investigation: ${notes || 'Partial resolution'}`;
        payment.refundMethod = 'wallet';
        await payment.save();

        console.log(`✅ Partial refund: $${refundAmount} to student, $${tutorAmount} to tutor`);
        
        const tutorDisplayName = formatNameWithInitial(lesson.tutorId);
        const studentDisplayName = formatNameWithInitial(lesson.studentId);
        
        // Send notification to student
        await Notification.create({
          userId: lesson.studentId._id,
          type: 'lesson_partial_refund',
          title: 'Partial Refund Issued',
          message: `A partial refund of <strong>$${refundAmount.toFixed(2)}</strong> has been issued for your lesson with <strong>${tutorDisplayName}</strong>.`,
          link: `/wallet`,
          data: {
            lessonId: lesson._id,
            amount: refundAmount,
            reason: notes
          }
        });

        // Send notification to tutor
        await Notification.create({
          userId: lesson.tutorId._id,
          type: 'payment_reduced',
          title: 'Payment Adjusted',
          message: `Payment for your lesson with <strong>${studentDisplayName}</strong> has been adjusted to <strong>$${tutorAmount.toFixed(2)}</strong> due to investigation findings.`,
          link: `/tabs/home/earnings`,
          data: {
            lessonId: lesson._id,
            studentId: lesson.studentId._id,
            studentName: studentDisplayName,
            tutorId: lesson.tutorId._id,
            tutorName: tutorDisplayName,
            scheduledAt: lesson.scheduledAt,
            originalAmount: lesson.price,
            adjustedAmount: tutorAmount,
            refundedToStudent: refundAmount,
            reason: notes,
            resolution: 'partial_refund',
            canDispute: true
          }
        });

      } catch (refundError) {
        console.error(`❌ Partial refund failed for lesson ${lessonId}:`, refundError);
        return res.status(500).json({
          success: false,
          error: `Failed to process partial refund: ${refundError.message}`
        });
      }

    } else if (resolution === 'approved') {
      console.log(`✅ Issue not valid - tutor will be paid normally`);
      // Just unpause - tutor gets paid on next cron run
      
      const studentDisplayName = formatNameWithInitial(lesson.studentId);
      
      // Send notification to tutor
      if (lesson.tutorId) {
        await Notification.create({
          userId: lesson.tutorId._id,
          type: 'investigation_resolved',
          title: 'Investigation Resolved',
          message: `The reported issue for your lesson with <strong>${studentDisplayName}</strong> has been <strong>resolved in your favor</strong>. Payment will be released.`,
          link: `/tabs/home/earnings`,
          data: {
            lessonId: lesson._id,
            resolution: 'approved'
          }
        });
      }
    }

    // Update lesson investigation status
    lesson.payoutPaused = false;
    lesson.underInvestigation = false;
    lesson.investigationResolvedAt = new Date();
    lesson.investigationResolution = resolution || 'approved';
    
    if (notes) {
      lesson.investigationNotes = (lesson.investigationNotes || '') + '\n\nResolution: ' + notes;
    }

    await lesson.save();

    // Mark any existing dispute notifications as non-disputable (decision is final)
    await Notification.updateMany(
      { 
        'data.lessonId': lesson._id,
        type: { $in: ['payment_cancelled', 'payment_reduced'] }
      },
      { 
        $set: { 'data.canDispute': false }
      }
    );

    console.log(`✅ Investigation resolved for lesson ${lessonId}: ${resolution}`);

    res.json({
      success: true,
      message: 'Investigation resolved successfully',
      lesson: {
        _id: lesson._id,
        payoutPaused: lesson.payoutPaused,
        investigationResolution: lesson.investigationResolution
      }
    });

  } catch (error) {
    console.error('❌ Error resuming payout:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to resume payout'
    });
  }
});

/**
 * POST /api/admin/manual-release-earnings
 * Manually trigger the release earnings cron job (admin only)
 */
router.post('/manual-release-earnings', verifyToken, requireAdmin, async (req, res) => {
  try {
    console.log('🔧 [ADMIN] Manual release earnings triggered');
    
    const result = await triggerManualRelease();
    
    res.json({
      success: true,
      message: 'Release earnings job completed',
      result
    });
  } catch (error) {
    console.error('❌ [ADMIN] Error in manual release earnings:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to release earnings'
    });
  }
});

/**
 * POST /api/admin/finalize-classes
 * Manually trigger the finalize classes job to refund no-show classes (admin only)
 */
router.post('/finalize-classes', verifyToken, requireAdmin, async (req, res) => {
  try {
    console.log('🔧 [ADMIN] Manually triggering finalize classes job...');
    
    const result = await autoReleaseClassPayments();
    
    res.json({
      success: true,
      message: 'Finalize classes job completed',
      result
    });
  } catch (error) {
    console.error('❌ [ADMIN] Error in finalize classes:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to finalize classes'
    });
  }
});

// ============================================================
// CREDENTIAL REVIEW ROUTES
// ============================================================

/**
 * Helper: Check if all required credentials are approved
 */
function checkAllCredentialsApproved(tutor) {
  const creds = tutor.tutorCredentials;
  if (!creds) return false;
  
  // Government ID must be approved
  if (creds.governmentId?.status !== 'approved') return false;
  
  // At least one teaching certification must be approved
  if (!creds.teachingCertifications?.length || 
      !creds.teachingCertifications.some(c => c.status === 'approved')) return false;
  
  // Additional documents are optional — no requirement
  return true;
}

/**
 * POST /api/admin/review-credential/:userId
 * Review (approve/reject) a specific credential for a tutor
 * Body: { credentialType, credentialId (for arrays), approved, rejectionReason }
 */
router.post('/review-credential/:userId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { credentialType, credentialId, approved, rejectionReason } = req.body;

    if (!credentialType || !['governmentId', 'teachingCertification', 'additionalDocument'].includes(credentialType)) {
      return res.status(400).json({ success: false, message: 'Invalid credential type' });
    }

    const tutor = await User.findById(userId);
    if (!tutor || tutor.userType !== 'tutor') {
      return res.status(404).json({ success: false, message: 'Tutor not found' });
    }

    if (!tutor.tutorCredentials) {
      return res.status(404).json({ success: false, message: 'No credentials found for this tutor' });
    }

    // Get admin user for reviewedBy
    const adminUser = await User.findOne({ 
      $or: [
        { auth0Id: req.user.sub },
        { email: req.user.email }
      ]
    });

    const newStatus = approved ? 'approved' : 'rejected';
    let credentialName = '';

    if (credentialType === 'governmentId') {
      if (!tutor.tutorCredentials.governmentId?.url) {
        return res.status(404).json({ success: false, message: 'No government ID uploaded' });
      }
      tutor.tutorCredentials.governmentId.status = newStatus;
      tutor.tutorCredentials.governmentId.reviewedBy = adminUser?._id || null;
      tutor.tutorCredentials.governmentId.reviewedAt = new Date();
      tutor.tutorCredentials.governmentId.rejectionReason = approved ? null : (rejectionReason || 'Please re-upload');
      credentialName = 'Government ID';
    } else if (credentialType === 'teachingCertification') {
      if (!credentialId) {
        return res.status(400).json({ success: false, message: 'credentialId required for certifications' });
      }
      const cert = tutor.tutorCredentials.teachingCertifications.id(credentialId);
      if (!cert) {
        return res.status(404).json({ success: false, message: 'Certification not found' });
      }
      cert.status = newStatus;
      cert.reviewedBy = adminUser?._id || null;
      cert.reviewedAt = new Date();
      cert.rejectionReason = approved ? null : (rejectionReason || 'Please re-upload');
      credentialName = cert.certificationName || 'Teaching Certification';
    } else if (credentialType === 'additionalDocument') {
      if (!credentialId) {
        return res.status(400).json({ success: false, message: 'credentialId required for documents' });
      }
      const doc = tutor.tutorCredentials.additionalDocuments.id(credentialId);
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }
      doc.status = newStatus;
      doc.reviewedBy = adminUser?._id || null;
      doc.reviewedAt = new Date();
      doc.rejectionReason = approved ? null : (rejectionReason || 'Please re-upload');
      credentialName = doc.label || doc.documentType || 'Document';
    }

    // Check if ALL approval conditions are now met
    const photoComplete = !!tutor.picture;
    const videoApproved = tutor.tutorOnboarding?.videoApproved === true;
    const hasStripe = tutor.stripeConnectOnboarded === true;
    const hasPayPal = tutor.payoutProvider === 'paypal' && !!tutor.payoutDetails?.paypalEmail;
    const hasManual = tutor.payoutProvider === 'manual';
    const payoutComplete = hasStripe || hasPayPal || hasManual;
    const credentialsApproved = checkAllCredentialsApproved(tutor);

    const wasApproved = tutor.tutorApproved;

    if (photoComplete && videoApproved && payoutComplete && credentialsApproved) {
      tutor.tutorApproved = true;
      if (!tutor.tutorOnboarding) tutor.tutorOnboarding = {};
      tutor.tutorOnboarding.completedAt = new Date();
      console.log(`🎉 Tutor ${tutor.email} is now FULLY APPROVED (all credentials + video + photo + payout approved)`);
    }

    await tutor.save();

    // Build notification content
    const notifTitle = approved 
      ? `✅ ${credentialName} Approved!`
      : `❌ ${credentialName} Needs Attention`;
    const notifMessage = approved
      ? `Your ${credentialName.toLowerCase()} has been verified and approved.${tutor.tutorApproved && !wasApproved ? ' All requirements are met — your profile is now live!' : ''}`
      : `Your ${credentialName.toLowerCase()} was not accepted. Reason: ${rejectionReason || 'Please re-upload'}. Please upload a new document.`;

    // Save notification to database
    try {
      const notification = new Notification({
        userId: tutor._id,
        type: approved ? 'credential_approved' : 'credential_rejected',
        title: notifTitle,
        message: notifMessage,
        data: {
          credentialType,
          credentialId,
          approved,
          rejectionReason: approved ? null : rejectionReason,
          tutorApproved: tutor.tutorApproved
        },
        read: false
      });
      await notification.save();
      console.log(`📝 Credential review notification created for tutor ${tutor._id}`);
    } catch (notifError) {
      console.error('⚠️ Failed to create credential notification:', notifError);
    }

    // Send real-time WebSocket notification to tutor (separate try/catch so it fires even if DB notification fails)
    try {
      if (req.io) {
        const eventName = approved ? 'credential_approved' : 'credential_rejected';
        const socketPayload = {
          type: eventName,
          title: notifTitle,
          message: notifMessage,
          credentialType,
          credentialId,
          approved,
          tutorApproved: tutor.tutorApproved,
          timestamp: new Date()
        };

        // Method 1: Room-based notification (using auth0Id)
        req.io.to(`user:${tutor.auth0Id}`).emit(eventName, socketPayload);
        req.io.to(`user:${tutor.auth0Id}`).emit('new_notification', {
          ...socketPayload,
          urgent: false,
          data: { credentialType, credentialId, approved, tutorApproved: tutor.tutorApproved }
        });
        console.log(`📬 Real-time credential review notification sent to tutor room: user:${tutor.auth0Id}`);

        // Also emit to MongoDB-based room (reaches all devices)
        req.io.to(`mongo:${tutor._id.toString()}`).emit(eventName, socketPayload);
      }
    } catch (socketError) {
      console.warn('⚠️ Could not send WebSocket notification:', socketError.message);
    }

    console.log(`📋 [ADMIN] Credential reviewed for ${tutor.email}:`, {
      credentialType,
      credentialId,
      status: newStatus,
      tutorFullyApproved: tutor.tutorApproved
    });

    res.json({
      success: true,
      message: `${credentialName} ${approved ? 'approved' : 'rejected'}`,
      tutorCredentials: tutor.tutorCredentials,
      tutorApproved: tutor.tutorApproved
    });

  } catch (error) {
    console.error('❌ Error reviewing credential:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to review credential' });
  }
});

/**
 * GET /api/admin/credential-url/:userId/:credentialType/:credentialId
 * GET /api/admin/credential-url/:userId/:credentialType
 * Admin gets a signed URL to view a private credential document
 */
const handleAdminCredentialUrl = async (req, res) => {
  try {
    const { userId, credentialType, credentialId } = req.params;
    const tutor = await User.findById(userId);
    
    if (!tutor) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    let credentialUrl = null;

    if (credentialType === 'governmentId') {
      credentialUrl = tutor.tutorCredentials?.governmentId?.url;
    } else if (credentialType === 'teachingCertification' && credentialId) {
      const cert = tutor.tutorCredentials?.teachingCertifications?.id(credentialId);
      credentialUrl = cert?.url;
    } else if (credentialType === 'additionalDocument' && credentialId) {
      const doc = tutor.tutorCredentials?.additionalDocuments?.id(credentialId);
      credentialUrl = doc?.url;
    }

    if (!credentialUrl) {
      return res.status(404).json({ success: false, message: 'Credential not found' });
    }

    // Generate a signed URL since credentials are stored as private files
    const { bucket } = initializeGCS();
    if (!bucket) {
      return res.status(500).json({ success: false, message: 'Storage not configured' });
    }

    const gcsPath = credentialUrl.replace(`https://storage.googleapis.com/${bucket.name}/`, '');
    const [signedUrl] = await bucket.file(gcsPath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000 // 1 hour
    });

    res.json({ success: true, url: signedUrl });

  } catch (error) {
    console.error('❌ Error getting admin credential URL:', error);
    res.status(500).json({ success: false, message: 'Failed to get credential URL' });
  }
};
router.get('/credential-url/:userId/:credentialType/:credentialId', verifyToken, requireAdmin, handleAdminCredentialUrl);
router.get('/credential-url/:userId/:credentialType', verifyToken, requireAdmin, handleAdminCredentialUrl);

// ═══ Material Report Management ═══════════════════════════════════════

router.get('/material-reports', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;

    const reports = await MaterialReport.find(query)
      .populate('materialId', 'title materialType videoUrl status thumbnailUrl')
      .populate('studentId', 'name email picture')
      .populate('tutorId', 'name email picture')
      .populate('purchaseId', 'amount stripePaymentIntentId status')
      .populate('resolvedBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, reports });
  } catch (error) {
    console.error('Error fetching material reports:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.put('/material-reports/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const admin = await User.findOne({
      $or: [{ auth0Id: req.user.sub }, { email: req.user.email }]
    });

    const report = await MaterialReport.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    const { status, resolution, issueRefund } = req.body;

    if (issueRefund && report.hasPurchased && report.purchaseId) {
      const purchase = await MaterialPurchase.findById(report.purchaseId);
      if (purchase && purchase.status === 'completed' && purchase.stripePaymentIntentId) {
        const daysSincePurchase = (Date.now() - new Date(purchase.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSincePurchase > 90) {
          return res.status(400).json({ success: false, message: 'Refund window expired — purchase is older than 90 days' });
        }
        try {
          const stripeService = require('../services/stripeService');
          await stripeService.createRefund({
            paymentIntentId: purchase.stripePaymentIntentId,
            reason: 'requested_by_customer',
            reverseTransfer: true
          });

          purchase.status = 'refunded';
          purchase.refundedAt = new Date();
          purchase.refundReason = `Admin refund: ${resolution || 'Material report resolved'}`;
          await purchase.save();

          await Payment.findOneAndUpdate(
            { materialId: report.materialId, studentId: report.studentId, paymentType: 'material_purchase' },
            { status: 'refunded' }
          );

          report.refundIssued = true;
          report.refundAmount = purchase.amount;
        } catch (refundErr) {
          console.error('Refund failed:', refundErr);
          return res.status(500).json({ success: false, message: `Refund failed: ${refundErr.message}` });
        }
      }
    }

    if (status) report.status = status;
    if (resolution) report.resolution = resolution;
    if (status === 'resolved' || status === 'dismissed') {
      report.resolvedAt = new Date();
      report.resolvedBy = admin?._id;
    }

    await report.save();

    const updated = await MaterialReport.findById(report._id)
      .populate('materialId', 'title materialType videoUrl status thumbnailUrl')
      .populate('studentId', 'name email picture')
      .populate('tutorId', 'name email picture')
      .populate('purchaseId', 'amount stripePaymentIntentId status')
      .populate('resolvedBy', 'name email')
      .lean();

    res.json({ success: true, report: updated });
  } catch (error) {
    console.error('Error updating material report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ═══ Material Content Review Queue ═══════════════════════════════

router.get('/material-review', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { reviewStatus } = req.query;
    const query = {};
    if (reviewStatus && reviewStatus !== 'all') {
      query.reviewStatus = reviewStatus;
    } else {
      query.reviewStatus = { $in: ['pending_review', 'approved', 'rejected'] };
    }

    const materials = await TutorMaterial.find(query)
      .populate('tutorId', 'name email picture linkedChannels')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, materials });
  } catch (error) {
    console.error('Error fetching material review queue:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.put('/material-review/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const admin = await User.findOne({
      $or: [{ auth0Id: req.user.sub }, { email: req.user.email }]
    });

    const material = await TutorMaterial.findById(req.params.id);
    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    const { reviewStatus, reviewNote } = req.body;
    if (!['approved', 'rejected'].includes(reviewStatus)) {
      return res.status(400).json({ success: false, message: 'reviewStatus must be approved or rejected' });
    }
    if (reviewStatus === 'rejected' && (!reviewNote || !reviewNote.trim())) {
      return res.status(400).json({ success: false, message: 'A reason is required when rejecting a material' });
    }

    material.reviewStatus = reviewStatus;
    material.reviewNote = reviewNote || '';
    material.reviewedBy = admin?._id;
    material.reviewedAt = new Date();

    if (reviewStatus === 'rejected' && material.status === 'published') {
      material.status = 'archived';
    }

    await material.save();

    // Send notification to the tutor
    const tutorId = material.tutorId;
    if (tutorId) {
      const notifType = reviewStatus === 'rejected' ? 'material_rejected' : 'material_approved';
      const title = reviewStatus === 'rejected' ? 'Material Rejected' : 'Material Approved';
      const message = reviewStatus === 'rejected'
        ? `Your material <strong>"${material.title}"</strong> has been rejected.<br><br><strong>Reason:</strong> ${reviewNote.trim()}`
        : `Your material <strong>"${material.title}"</strong> has been approved and is now live.`;

      await Notification.create({
        userId: tutorId,
        type: notifType,
        title,
        message,
        data: {
          materialId: material._id,
          materialTitle: material.title,
          reviewNote: reviewNote || '',
          reviewStatus
        }
      });

      if (global.io) {
        global.io.to(`user:${tutorId}`).emit('notification', {
          type: notifType,
          title,
          message
        });
      }
    }

    const updated = await TutorMaterial.findById(material._id)
      .populate('tutorId', 'name email picture linkedChannels')
      .populate('reviewedBy', 'name email')
      .lean();

    res.json({ success: true, material: updated });
  } catch (error) {
    console.error('Error updating material review:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
