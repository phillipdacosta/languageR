const express = require('express');
const router = express.Router();
const Lesson = require('../models/Lesson');
const User = require('../models/User');
const { RtcRole, RtcTokenBuilder } = require('agora-token');
const { verifyToken } = require('../middleware/videoUploadMiddleware');

const AGORA_APP_ID = process.env.AGORA_APP_ID;
const AGORA_APP_CERT = process.env.AGORA_APP_CERT;

// Time windows for joining lessons
const JOIN_EARLY_MINUTES = 15; // Can join 15 minutes early
const END_GRACE_MINUTES = 5;   // Can join up to 5 minutes after end
const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour token validity

// Create lesson (called after checkout/booking)
router.post('/', verifyToken, async (req, res) => {
  try {
    const { 
      tutorId, 
      studentId, 
      startTime, 
      endTime, 
      subject, 
      price, 
      duration,
      bookingData 
    } = req.body;

    console.log('📅 Creating lesson:', { tutorId, studentId, startTime, endTime, user: req.user });

    // Validate required fields
    if (!tutorId || !studentId || !startTime || !endTime || !price) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }

    // Verify tutor and student exist
    const [tutor, student] = await Promise.all([
      User.findById(tutorId),
      User.findById(studentId)
    ]);

    if (!tutor || !student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Tutor or student not found' 
      });
    }

    const lesson = await Lesson.create({
      tutorId,
      studentId,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      subject: subject || 'Language Lesson',
      price,
      duration: duration || 60,
      bookingData,
      channelName: `lesson_${new Date().getTime()}_${Math.random().toString(36).substr(2, 9)}`
    });

    // Populate tutor and student details
    await lesson.populate([
      { path: 'tutorId', select: 'name email picture' },
      { path: 'studentId', select: 'name email picture' }
    ]);

    console.log('📅 Lesson created successfully:', lesson._id);

    res.json({ 
      success: true, 
      lesson 
    });
  } catch (error) {
    console.error('❌ Error creating lesson:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create lesson',
      error: error.message 
    });
  }
});

// Get lessons for a user (student or tutor)
router.get('/my-lessons', verifyToken, async (req, res) => {
  try {
    // Get user ID from auth token
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    const userId = user._id;

    console.log('📅 Fetching lessons for user:', userId);

    // Find lessons where user is either tutor or student
    const lessons = await Lesson.find({
      $or: [
        { tutorId: userId },
        { studentId: userId }
      ]
    })
    .populate('tutorId', 'name email picture')
    .populate('studentId', 'name email picture')
    .sort({ startTime: 1 });

    res.json({ 
      success: true, 
      lessons 
    });
  } catch (error) {
    console.error('❌ Error fetching lessons:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch lessons' 
    });
  }
});

// Get lesson details
router.get('/:id', async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id)
      .populate('tutorId', 'name email picture')
      .populate('studentId', 'name email picture');

    if (!lesson) {
      return res.status(404).json({ 
        success: false, 
        message: 'Lesson not found' 
      });
    }

    res.json({ 
      success: true, 
      lesson 
    });
  } catch (error) {
    console.error('❌ Error fetching lesson:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch lesson' 
    });
  }
});

// Check if user can join lesson (without generating token)
router.get('/:id/status', async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    
    if (!lesson || (lesson.status !== 'scheduled' && lesson.status !== 'in_progress')) {
      return res.status(404).json({ 
        success: false, 
        message: 'Lesson not available' 
      });
    }

    const now = new Date();
    const start = new Date(lesson.startTime);
    const end = new Date(lesson.endTime);

    const earliestJoin = new Date(start.getTime() - JOIN_EARLY_MINUTES * 60000);
    const latestJoin = new Date(end.getTime() + END_GRACE_MINUTES * 60000);

    const canJoin = now >= earliestJoin && now <= latestJoin;
    const timeUntilStart = Math.max(0, Math.ceil((start.getTime() - now.getTime()) / 1000));
    const timeUntilJoin = Math.max(0, Math.ceil((earliestJoin.getTime() - now.getTime()) / 1000));

    res.json({
      success: true,
      canJoin,
      timeUntilStart,
      timeUntilJoin,
      serverTime: now.toISOString(),
      lesson: {
        id: lesson._id,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
        status: lesson.status
      }
    });
  } catch (error) {
    console.error('❌ Error checking lesson status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to check lesson status' 
    });
  }
});

// Secure join: returns Agora params only within time window
router.post('/:id/join', verifyToken, async (req, res) => {
  try {
    // Get user ID from auth token
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    const userId = user._id;
    const userRole = req.body.role; // 'tutor' or 'student'

    console.log('📅 User attempting to join lesson:', { userId, lessonId: req.params.id, role: userRole });

    const lesson = await Lesson.findById(req.params.id)
      .populate('tutorId', 'name email')
      .populate('studentId', 'name email');

    if (!lesson || (lesson.status !== 'scheduled' && lesson.status !== 'in_progress')) {
      return res.status(404).json({ 
        success: false, 
        message: 'Lesson not available' 
      });
    }

    // Verify user is part of this lesson
    const userIdStr = userId.toString();
    const isTutor = lesson.tutorId._id.toString() === userIdStr;
    const isStudent = lesson.studentId._id.toString() === userIdStr;

    console.log('📅 Authorization check:', {
      userIdStr,
      tutorId: lesson.tutorId._id.toString(),
      studentId: lesson.studentId._id.toString(),
      isTutor,
      isStudent
    });

    if (!isTutor && !isStudent) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to join this lesson' 
      });
    }

    const now = new Date();
    const start = new Date(lesson.startTime);
    const end = new Date(lesson.endTime);

    const earliestJoin = new Date(start.getTime() - JOIN_EARLY_MINUTES * 60000);
    const latestJoin = new Date(end.getTime() + END_GRACE_MINUTES * 60000);

    if (now < earliestJoin) {
      const minutesUntilJoin = Math.ceil((earliestJoin.getTime() - now.getTime()) / 60000);
      return res.status(403).json({ 
        success: false, 
        message: `Too early to join. Please wait ${minutesUntilJoin} more minutes.` 
      });
    }

    if (now > latestJoin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Lesson window has ended' 
      });
    }

    // Determine Agora role
    const agoraRole = isTutor ? RtcRole.PUBLISHER : RtcRole.PUBLISHER; // Both can publish for interactive lessons

    // Calculate token expiry (clamp to remaining lesson window)
    // Use a fixed TTL to avoid edge cases where lesson window math yields short/expired tokens
    const expireTs = TOKEN_TTL_SECONDS; // 1 hour
    
    // HARDCODED: Use fixed channel name for Agora temp tokens
    const channelName = 'languageRoom';
    // Use a stable string user account for Web SDK tokens
    const uidAccount = userId.toString();
    const tokenExpiry = Math.floor(Date.now() / 1000) + expireTs;

    console.log('📅 Token generation parameters:', {
      appId: AGORA_APP_ID,
      channelName,
      uidAccount,
      agoraRole,
      expireTs,
      tokenExpiry,
      currentTime: Math.floor(Date.now() / 1000)
    });

    // Generate Agora token
    let token;
    
    // Prefer certificate-based generation for reliability
    if (AGORA_APP_CERT && AGORA_APP_CERT !== 'your-agora-app-certificate-here') {
      token = RtcTokenBuilder.buildTokenWithUserAccount(
        AGORA_APP_ID,
        AGORA_APP_CERT,
        channelName,
        uidAccount,
        agoraRole,
        tokenExpiry
      );
      console.log('✅ Generated certificate-based token for channel:', channelName);
    } else {
      // Fallback to temp token if certificate is not available
      const TEMP_TOKEN = process.env.AGORA_TEMP_TOKEN;
      if (TEMP_TOKEN) {
        console.log('⚠️ Using temporary token from environment for channel:', channelName);
        token = TEMP_TOKEN;
      } else {
        console.warn('⚠️ No certificate and no AGORA_TEMP_TOKEN; proceeding with null token');
        token = null;
      }
    }

    // Update lesson status to in_progress if this is the first join
    if (lesson.status === 'scheduled') {
      lesson.status = 'in_progress';
      await lesson.save();
    }

    console.log('📅 Generated Agora token for lesson:', { 
      lessonId: lesson._id, 
      channelName, 
      userId, 
      role: isTutor ? 'tutor' : 'student',
      token: token ? `${token.substring(0, 20)}...` : 'null',
      appId: AGORA_APP_ID,
      certExists: !!AGORA_APP_CERT && AGORA_APP_CERT !== 'your-agora-app-certificate-here'
    });

    res.json({
      success: true,
      agora: {
        appId: AGORA_APP_ID,
        channelName,
        token,
        uid: uidAccount
      },
      lesson: {
        id: lesson._id,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
        tutor: lesson.tutorId,
        student: lesson.studentId,
        subject: lesson.subject
      },
      userRole: isTutor ? 'tutor' : 'student',
      serverTime: now.toISOString()
    });
  } catch (error) {
    console.error('❌ Error joining lesson:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to join lesson',
      error: error.message 
    });
  }
});

// End lesson (mark as completed)
router.post('/:id/end', verifyToken, async (req, res) => {
  try {
    // Get user ID from auth token
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    const userId = user._id;
    
    const lesson = await Lesson.findById(req.params.id);
    
    if (!lesson) {
      return res.status(404).json({ 
        success: false, 
        message: 'Lesson not found' 
      });
    }

    // Only tutor or student can end the lesson
    const isTutor = lesson.tutorId.toString() === userId;
    const isStudent = lesson.studentId.toString() === userId;

    if (!isTutor && !isStudent) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to end this lesson' 
      });
    }

    lesson.status = 'completed';
    await lesson.save();

    console.log('📅 Lesson ended:', lesson._id);

    res.json({ 
      success: true, 
      message: 'Lesson completed' 
    });
  } catch (error) {
    console.error('❌ Error ending lesson:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to end lesson' 
    });
  }
});

module.exports = router;