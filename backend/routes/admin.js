/**
 * Admin API Routes
 * 
 * Endpoints for admin actions:
 * - GET /api/admin/pending-tutors - Get tutors pending video approval
 * - POST /api/admin/approve-tutor/:tutorId - Approve tutor video
 * - POST /api/admin/reject-tutor/:tutorId - Reject tutor video
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Notification = require('../models/Notification');
const { verifyToken } = require('../middleware/videoUploadMiddleware');

/**
 * Middleware to check if user is admin
 */
const isAdmin = async (req, res, next) => {
  try {
    console.log('🔐 [ADMIN] Checking admin access for:', req.user.sub);
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    console.log('🔐 [ADMIN] User lookup result:', {
      found: !!user,
      email: user?.email,
      isAdmin: user?.isAdmin
    });
    
    if (!user) {
      console.log('❌ [ADMIN] User not found in database');
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Check if user is admin (you can add a isAdmin field to User model)
    // For now, check against specific email or add isAdmin boolean field
    if (!user.isAdmin) {
      console.log('❌ [ADMIN] User is not an admin:', user.email);
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    
    console.log('✅ [ADMIN] Admin access granted');
    req.adminUser = user;
    next();
  } catch (error) {
    console.error('❌ Error checking admin status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/admin/pending-tutors
 * Get all tutors with videos pending approval
 */
router.get('/pending-tutors', verifyToken, isAdmin, async (req, res) => {
  try {
    console.log('📋 [ADMIN] Fetching pending tutors...');
    
    // First, get all tutors with videos
    const allTutorsWithVideos = await User.find({
      userType: 'tutor',
      'onboardingData.introductionVideo': { $exists: true, $ne: '' }
    })
    .select('name firstName lastName email picture onboardingData tutorOnboarding')
    .lean();
    
    console.log(`📋 [ADMIN] Found ${allTutorsWithVideos.length} tutors with videos`);
    
    // Filter in JavaScript for easier debugging
    const pendingTutors = allTutorsWithVideos.filter(tutor => {
      const videoApproved = tutor.tutorOnboarding?.videoApproved === true;
      const videoRejected = tutor.tutorOnboarding?.videoRejected === true;
      const isPending = !videoApproved && !videoRejected;
      
      console.log(`📋 [ADMIN] Tutor ${tutor.email}: approved=${videoApproved}, rejected=${videoRejected}, pending=${isPending}`);
      
      return isPending;
    });
    
    console.log(`📋 [ADMIN] Returning ${pendingTutors.length} pending tutors`);
    
    res.json({
      success: true,
      tutors: pendingTutors,
      count: pendingTutors.length
    });
  } catch (error) {
    console.error('❌ Error fetching pending tutors:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/admin/approve-tutor/:tutorId
 * Approve a tutor's video
 */
router.post('/approve-tutor/:tutorId', verifyToken, isAdmin, async (req, res) => {
  try {
    const { tutorId } = req.params;
    
    const tutor = await User.findById(tutorId);
    if (!tutor) {
      return res.status(404).json({ success: false, message: 'Tutor not found' });
    }
    
    if (tutor.userType !== 'tutor') {
      return res.status(400).json({ success: false, message: 'User is not a tutor' });
    }
    
    // Update tutor onboarding status
    tutor.tutorOnboarding = tutor.tutorOnboarding || {};
    tutor.tutorOnboarding.videoApproved = true;
    tutor.tutorOnboarding.videoRejected = false;
    tutor.tutorOnboarding.videoRejectionReason = null;
    tutor.tutorOnboarding.approvedBy = req.adminUser._id;
    tutor.tutorOnboarding.approvedAt = new Date();
    
    // Check if all onboarding steps are complete
    const photoComplete = tutor.tutorOnboarding.photoUploaded || !!tutor.picture;
    const videoComplete = tutor.tutorOnboarding.videoApproved;
    const stripeComplete = tutor.tutorOnboarding.stripeConnected || tutor.stripeConnectOnboarded;
    
    if (photoComplete && videoComplete && stripeComplete) {
      tutor.tutorApproved = true;
      tutor.tutorOnboarding.completedAt = new Date();
    }
    
    await tutor.save();
    
    // Create database notification for tutor
    try {
      const notification = await Notification.create({
        userId: tutor._id,
        type: 'tutor_video_approved',
        title: 'Video Approved! 🎉',
        message: tutor.tutorApproved 
          ? 'Your introduction video has been approved! You are now fully approved and can start accepting bookings.'
          : 'Your introduction video has been approved! Complete your payment setup to start accepting bookings.',
        data: {
          tutorApproved: tutor.tutorApproved,
          approvedAt: tutor.tutorOnboarding.approvedAt
        }
      });
      console.log('✅ Database notification created for tutor approval:', notification._id);
    } catch (notifError) {
      console.error('❌ Error creating approval notification:', notifError);
    }
    
    // Send WebSocket notification to tutor (using the same pattern as messaging)
    const tutorSocketId = req.connectedUsers?.get(tutor.auth0Id);
    console.log(`🔍 [WEBSOCKET] Checking notification for tutor ${tutor.email} (auth0Id: ${tutor.auth0Id})`);
    console.log(`🔍 [WEBSOCKET] Socket ID found:`, tutorSocketId);
    console.log(`🔍 [WEBSOCKET] Total connected users:`, req.connectedUsers?.size || 0);
    
    if (tutorSocketId && req.io) {
      console.log(`🎉 Sending approval notification to tutor ${tutor.email} (socket: ${tutorSocketId})`);
      
      const approvalMessage = tutor.tutorApproved 
        ? 'Your introduction video has been approved! You are now fully approved and can start accepting bookings.'
        : 'Your introduction video has been approved! Complete your payment setup to start accepting bookings.';
      
      // Emit old event for toast notification (backward compatibility)
      req.io.to(tutorSocketId).emit('tutor_video_approved', {
        message: approvalMessage,
        timestamp: new Date(),
        tutorApproved: tutor.tutorApproved
      });
      
      // Emit new_notification event for notification panel
      req.io.to(tutorSocketId).emit('new_notification', {
        type: 'tutor_video_approved',
        title: 'Video Approved! 🎉',
        message: approvalMessage,
        timestamp: new Date()
      });
      
      console.log(`✅ [WEBSOCKET] Notification emitted successfully`);
    } else {
      console.log(`⚠️ Tutor ${tutor.email} not connected via WebSocket or io not available`);
      console.log(`⚠️ [WEBSOCKET] Has socket:`, !!tutorSocketId, 'Has io:', !!req.io);
    }
    
    res.json({
      success: true,
      message: 'Tutor video approved',
      tutor: {
        id: tutor._id,
        name: tutor.name,
        tutorApproved: tutor.tutorApproved
      }
    });
  } catch (error) {
    console.error('❌ Error approving tutor:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/admin/reject-tutor/:tutorId
 * Reject a tutor's video with reason
 */
router.post('/reject-tutor/:tutorId', verifyToken, isAdmin, async (req, res) => {
  try {
    const { tutorId } = req.params;
    const { reason } = req.body;
    
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }
    
    const tutor = await User.findById(tutorId);
    if (!tutor) {
      return res.status(404).json({ success: false, message: 'Tutor not found' });
    }
    
    if (tutor.userType !== 'tutor') {
      return res.status(400).json({ success: false, message: 'User is not a tutor' });
    }
    
    // Update tutor onboarding status
    tutor.tutorOnboarding = tutor.tutorOnboarding || {};
    tutor.tutorOnboarding.videoApproved = false;
    tutor.tutorOnboarding.videoRejected = true;
    tutor.tutorOnboarding.videoRejectionReason = reason.trim();
    tutor.tutorApproved = false;
    
    await tutor.save();
    
    // Create database notification for tutor
    try {
      const notification = await Notification.create({
        userId: tutor._id,
        type: 'tutor_video_rejected',
        title: 'Video Rejected',
        message: `Your introduction video was rejected: ${reason.trim()}`,
        data: {
          reason: reason.trim(),
          rejectedAt: new Date()
        }
      });
      console.log('✅ Database notification created for tutor rejection:', notification._id);
    } catch (notifError) {
      console.error('❌ Error creating rejection notification:', notifError);
    }
    
    // Send WebSocket notification to tutor (using the same pattern as messaging)
    const tutorSocketId = req.connectedUsers?.get(tutor.auth0Id);
    console.log(`🔍 [WEBSOCKET] Checking rejection notification for tutor ${tutor.email} (auth0Id: ${tutor.auth0Id})`);
    console.log(`🔍 [WEBSOCKET] Socket ID found:`, tutorSocketId);
    
    if (tutorSocketId && req.io) {
      console.log(`❌ Sending rejection notification to tutor ${tutor.email} (socket: ${tutorSocketId})`);
      
      const rejectionMessage = `Your introduction video was rejected: ${reason.trim()}`;
      
      // Emit old event for toast notification (backward compatibility)
      req.io.to(tutorSocketId).emit('tutor_video_rejected', {
        message: rejectionMessage,
        reason: reason.trim(),
        timestamp: new Date()
      });
      
      // Emit new_notification event for notification panel
      req.io.to(tutorSocketId).emit('new_notification', {
        type: 'tutor_video_rejected',
        title: 'Video Rejected',
        message: rejectionMessage,
        timestamp: new Date()
      });
      
      console.log(`✅ [WEBSOCKET] Rejection notification emitted successfully`);
    } else {
      console.log(`⚠️ Tutor ${tutor.email} not connected via WebSocket or io not available`);
    }
    
    res.json({
      success: true,
      message: 'Tutor video rejected',
      tutor: {
        id: tutor._id,
        name: tutor.name
      }
    });
  } catch (error) {
    console.error('❌ Error rejecting tutor:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

