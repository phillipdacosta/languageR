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

    // Check for time slot conflicts with existing lessons for this tutor
    const requestedStart = new Date(startTime);
    const requestedEnd = new Date(endTime);

    console.log('🔍 Checking for conflicts:', {
      tutorId,
      requestedStart: requestedStart.toISOString(),
      requestedEnd: requestedEnd.toISOString()
    });

    // First, let's see all existing lessons for this tutor
    const allTutorLessons = await Lesson.find({ tutorId: tutorId });
    console.log('📚 All lessons for tutor:', allTutorLessons.map(l => ({
      id: l._id,
      start: l.startTime,
      end: l.endTime,
      status: l.status
    })));

    // Find any existing lessons for this tutor that overlap with the requested time
    // Overlap occurs when: existingStart < requestedEnd AND existingEnd > requestedStart
    const conflictingLesson = await Lesson.findOne({
      tutorId: tutorId,
      status: { $in: ['scheduled', 'in_progress'] }, // Only check active lessons
      // Existing lesson starts before requested end and ends after requested start
      startTime: { $lt: requestedEnd },
      endTime: { $gt: requestedStart }
    });

    console.log('🔍 Conflict query result:', conflictingLesson ? {
      id: conflictingLesson._id,
      start: conflictingLesson.startTime,
      end: conflictingLesson.endTime,
      status: conflictingLesson.status
    } : 'No conflicts found');

    if (conflictingLesson) {
      console.log('⚠️ Time slot conflict detected:', {
        tutorId,
        requestedTime: { start: requestedStart, end: requestedEnd },
        conflictingLesson: {
          id: conflictingLesson._id,
          start: conflictingLesson.startTime,
          end: conflictingLesson.endTime
        }
      });

      return res.status(409).json({ 
        success: false, 
        message: 'This time slot is no longer available. It may have been booked by another student. Please select a different time.',
        code: 'TIME_SLOT_CONFLICT',
        conflict: {
          startTime: conflictingLesson.startTime,
          endTime: conflictingLesson.endTime
        }
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

// Get lessons by tutor ID (public endpoint for availability checking)
// IMPORTANT: This must come BEFORE /:id route to avoid route conflicts
router.get('/by-tutor/:tutorId', async (req, res) => {
  try {
    const { tutorId } = req.params;
    const { all } = req.query; // Query param to get all lessons (including past)
    
    if (!tutorId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Tutor ID is required' 
      });
    }

    console.log('📅 Fetching lessons for tutor:', tutorId, 'all:', all);

    // Build query - if 'all' is true, get all lessons; otherwise only active ones
    const query = { tutorId: tutorId };
    if (!all || all !== 'true') {
      query.status = { $in: ['scheduled', 'in_progress'] };
    }

    // Find lessons for this tutor
    const lessons = await Lesson.find(query)
    .populate('studentId', 'name email picture')
    .sort({ startTime: 1 });

    console.log(`📅 Found ${lessons.length} lessons for tutor ${tutorId}`);

    res.json({ 
      success: true, 
      lessons: lessons.map(lesson => ({
        _id: lesson._id,
        tutorId: lesson.tutorId,
        studentId: lesson.studentId,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
        status: lesson.status,
        subject: lesson.subject,
        notes: lesson.notes,
        price: lesson.price,
        duration: lesson.duration,
        bookingData: lesson.bookingData
      }))
    });
  } catch (error) {
    console.error('❌ Error fetching lessons by tutor:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch lessons' 
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

    // Convert participants Map to plain object for JSON serialization
    let participantsObj = {};
    if (lesson.participants && lesson.participants instanceof Map) {
      lesson.participants.forEach((value, key) => {
        participantsObj[key] = {
          joinedAt: value.joinedAt,
          leftAt: value.leftAt,
          joinCount: value.joinCount
        };
      });
    } else if (lesson.participants && typeof lesson.participants === 'object') {
      participantsObj = lesson.participants;
    }

    const lessonObj = lesson.toObject();
    lessonObj.participants = participantsObj;

    res.json({ 
      success: true, 
      lesson: lessonObj
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
router.get('/:id/status', verifyToken, async (req, res) => {
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

    // Determine per-user join state if authenticated
    let userJoinedBefore = false;
    let userLeftAfterJoin = false;
    try {
      const user = await User.findOne({ auth0Id: req.user.sub });
      if (user && lesson.participants) {
        const p = lesson.participants.get(user._id.toString());
        userJoinedBefore = !!(p && p.joinCount > 0);
        userLeftAfterJoin = !!(p && p.joinedAt && p.leftAt && p.leftAt >= p.joinedAt);
      }
    } catch (_) {}

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
      },
      participant: {
        joinedBefore: userJoinedBefore,
        leftAfterJoin: userLeftAfterJoin
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
  console.log('🚀🚀🚀 LESSON JOIN ENDPOINT CALLED 🚀🚀🚀');
  console.log('🚀 Request params:', req.params);
  console.log('🚀 Request body:', req.body);
  console.log('🚀 Request user:', req.user);
  
  try {
    // Get user ID from auth token
    const user = await User.findOne({ auth0Id: req.user.sub }).select('name email picture');
    if (!user) {
      console.log('❌ User not found for auth0Id:', req.user.sub);
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    const userId = user._id;
    const userRole = req.body.role; // 'tutor' or 'student'

    console.log('📅 User attempting to join lesson:', { userId, lessonId: req.params.id, role: userRole });

    const lesson = await Lesson.findById(req.params.id)
      .populate('tutorId', 'name email picture')
      .populate('studentId', 'name email picture');

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
    
    // For development, prefer temp token; for production, use certificate
    const TEMP_TOKEN = process.env.AGORA_TEMP_TOKEN;
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    console.log('🔍 DEBUG Token generation:', {
      isDevelopment,
      hasTempToken: !!TEMP_TOKEN,
      tempTokenLength: TEMP_TOKEN ? TEMP_TOKEN.length : 0,
      channelName,
      NODE_ENV: process.env.NODE_ENV
    });
    
    if (isDevelopment && TEMP_TOKEN) {
      console.log('🔧 DEV: Using temporary token from environment for channel:', channelName);
      token = TEMP_TOKEN;
    } else if (AGORA_APP_CERT && AGORA_APP_CERT !== 'your-agora-app-certificate-here') {
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
      console.warn('⚠️ No valid token method available; proceeding with null token');
      token = null;
    }

    // Update lesson status to in_progress if this is the first join
    if (lesson.status === 'scheduled') {
      lesson.status = 'in_progress';
    }

    // Record participant join
    if (!lesson.participants) lesson.participants = new Map();
    const key = userId.toString();
    const prev = lesson.participants.get(key) || { joinCount: 0 };
    prev.joinedAt = now;
    prev.leftAt = null;
    prev.joinCount = (prev.joinCount || 0) + 1;
    lesson.participants.set(key, prev);
    
    await lesson.save();

    console.log('📅 Generated Agora token for lesson:', { 
      lessonId: lesson._id, 
      channelName, 
      userId, 
      role: isTutor ? 'tutor' : 'student',
      token: token ? `${token.substring(0, 20)}...` : 'null',
      appId: AGORA_APP_ID,
      certExists: !!AGORA_APP_CERT && AGORA_APP_CERT !== 'your-agora-app-certificate-here'
    });

    // Emit WebSocket event for lesson presence
    console.log('📡 Attempting to emit lesson presence event...');
    console.log('📡 req.io exists:', !!req.io);
    console.log('📡 req.connectedUsers exists:', !!req.connectedUsers);
    
    if (req.io && req.connectedUsers) {
      // Get the other participant's User document to get their auth0Id
      const otherUserMongoId = isTutor ? lesson.studentId._id : lesson.tutorId._id;
      console.log('📡 Looking for other participant with MongoDB ID:', otherUserMongoId);
      
      const otherUser = await User.findById(otherUserMongoId).select('auth0Id name picture');
      console.log('📡 Found other user:', otherUser ? { auth0Id: otherUser.auth0Id, name: otherUser.name } : 'NOT FOUND');
      
      if (otherUser && otherUser.auth0Id) {
        const otherUserAuth0Id = otherUser.auth0Id;
        console.log('📡 Looking for socket connection for auth0Id:', otherUserAuth0Id);
        console.log('📡 All connected users:', Array.from(req.connectedUsers.entries()));
        
        const otherUserSocketId = req.connectedUsers.get(otherUserAuth0Id);
        
        if (otherUserSocketId) {
          const presenceEvent = {
            lessonId: lesson._id.toString(),
            participantId: userId.toString(),
            participantRole: isTutor ? 'tutor' : 'student',
            participantName: user.name,
            participantPicture: user.picture,
            joinedAt: now.toISOString()
          };
          console.log('📡 Emitting lesson_participant_joined event:', JSON.stringify(presenceEvent, null, 2));
          console.log('📡 Emitting to socket:', otherUserSocketId);
          console.log('📡 Using req.io.to().emit() method');
          
          // Try multiple emission methods to ensure it works
          req.io.to(otherUserSocketId).emit('lesson_participant_joined', presenceEvent);
          req.io.to(`user:${otherUserAuth0Id}`).emit('lesson_participant_joined', presenceEvent);
          
          console.log('✅ Successfully emitted lesson_participant_joined to socket:', otherUserSocketId, 'for user:', otherUserAuth0Id);
          console.log('✅ Also emitted to room: user:' + otherUserAuth0Id);
        } else {
          console.log('⚠️ Other participant not connected. Auth0Id:', otherUserAuth0Id);
          console.log('⚠️ Available connected users:', Array.from(req.connectedUsers.keys()));
        }
      } else {
        console.log('⚠️ Could not find other participant user document or auth0Id');
      }
    } else {
      console.log('⚠️ req.io or req.connectedUsers is missing');
    }

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

    // Mark participant left time
    try {
      if (!lesson.participants) lesson.participants = new Map();
      const key = userId.toString();
      const prev = lesson.participants.get(key) || { joinCount: 0 };
      prev.leftAt = new Date();
      lesson.participants.set(key, prev);
    } catch (_) {}

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

// Mark participant leaving the lesson (without completing it)
router.post('/:id/leave', verifyToken, async (req, res) => {
  console.log('🚪🚪🚪 LESSON LEAVE ENDPOINT CALLED 🚪🚪🚪');
  console.log('🚪 Request params:', req.params);
  console.log('🚪 Request user:', req.user);
  
  try {
    const user = await User.findOne({ auth0Id: req.user.sub }).select('name email picture auth0Id');
    if (!user) {
      console.log('❌ User not found for auth0Id:', req.user.sub);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const userId = user._id;
    const lesson = await Lesson.findById(req.params.id)
      .populate('tutorId', 'name email picture auth0Id')
      .populate('studentId', 'name email picture auth0Id');
    if (!lesson) {
      console.log('❌ Lesson not found:', req.params.id);
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }
    
    // Determine if user is tutor or student
    const isTutor = lesson.tutorId._id.toString() === userId.toString();
    const isStudent = lesson.studentId._id.toString() === userId.toString();
    
    if (!isTutor && !isStudent) {
      return res.status(403).json({ success: false, message: 'User is not a participant in this lesson' });
    }
    
    console.log('🚪 User leaving lesson:', { userId, lessonId: lesson._id, role: isTutor ? 'tutor' : 'student' });

    if (!lesson.participants) lesson.participants = new Map();
    const key = user._id.toString();
    const prev = lesson.participants.get(key) || { joinCount: 0 };
    prev.leftAt = new Date();
    lesson.participants.set(key, prev);
    await lesson.save();

    // Emit WebSocket event for lesson presence left
    console.log('🚪 Attempting to emit lesson presence left event...');
    console.log('🚪 req.io exists:', !!req.io);
    console.log('🚪 req.connectedUsers exists:', !!req.connectedUsers);
    
    if (req.io && req.connectedUsers) {
      // Get the other participant's User document to get their auth0Id
      const otherUserMongoId = isTutor ? lesson.studentId._id : lesson.tutorId._id;
      console.log('🚪 Looking for other participant with MongoDB ID:', otherUserMongoId);
      
      const otherUser = await User.findById(otherUserMongoId).select('auth0Id name picture');
      console.log('🚪 Found other user:', otherUser ? { auth0Id: otherUser.auth0Id, name: otherUser.name } : 'NOT FOUND');
      
      if (otherUser && otherUser.auth0Id) {
        const otherUserAuth0Id = otherUser.auth0Id;
        console.log('🚪 Looking for socket connection for auth0Id:', otherUserAuth0Id);
        console.log('🚪 All connected users:', Array.from(req.connectedUsers.entries()));
        
        const otherUserSocketId = req.connectedUsers.get(otherUserAuth0Id);
        
        if (otherUserSocketId) {
          const leaveEvent = {
            lessonId: lesson._id.toString(),
            participantId: userId.toString(),
            participantRole: isTutor ? 'tutor' : 'student',
            participantName: user.name,
            leftAt: new Date().toISOString()
          };
          console.log('🚪 Emitting lesson_participant_left event:', JSON.stringify(leaveEvent, null, 2));
          console.log('🚪 Emitting to socket:', otherUserSocketId);
          
          // Try multiple emission methods to ensure it works
          req.io.to(otherUserSocketId).emit('lesson_participant_left', leaveEvent);
          req.io.to(`user:${otherUserAuth0Id}`).emit('lesson_participant_left', leaveEvent);
          
          console.log('✅ Successfully emitted lesson_participant_left to socket:', otherUserSocketId, 'for user:', otherUserAuth0Id);
          console.log('✅ Also emitted to room: user:' + otherUserAuth0Id);
        } else {
          console.log('⚠️ Other participant not connected. Auth0Id:', otherUserAuth0Id);
          console.log('⚠️ Available connected users:', Array.from(req.connectedUsers.keys()));
        }
      } else {
        console.log('⚠️ Could not find other participant user document or auth0Id');
      }
    } else {
      console.log('⚠️ req.io or req.connectedUsers is missing');
    }

    res.json({ success: true, message: 'Left lesson recorded' });
  } catch (error) {
    console.error('❌ Error leaving lesson:', error);
    res.status(500).json({ success: false, message: 'Failed to record leave' });
  }
});

// Special endpoint for navigator.sendBeacon (doesn't support custom headers)
router.post('/:id/leave-beacon', async (req, res) => {
  console.log('🚪🚪🚪 LESSON LEAVE BEACON ENDPOINT CALLED 🚪🚪🚪');
  console.log('🚪 Request params:', req.params);
  console.log('🚪 Request body:', req.body);
  
  try {
    // Extract auth token from form data
    const authToken = req.body.authToken;
    if (!authToken) {
      console.log('❌ No auth token in beacon request');
      return res.status(401).json({ success: false, message: 'No auth token' });
    }
    
    // Manually verify the token (same logic as verifyToken middleware)
    let userInfo;
    const token = authToken.replace('Bearer ', '');
    
    if (token.startsWith('dev-token-')) {
      console.log('🚪 Processing dev token from beacon');
      const emailPart = token.replace('dev-token-', '');
      const parts = emailPart.split('-');
      if (parts.length >= 2) {
        const domainParts = parts.slice(-2);
        const usernameParts = parts.slice(0, -2);
        const username = usernameParts.join('.');
        const domain = domainParts.join('.');
        const email = `${username}@${domain}`;
        userInfo = {
          sub: `dev-user-${email}`,
          email: email,
          name: username
        };
      }
    }
    
    if (!userInfo) {
      console.log('❌ Invalid token in beacon request');
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    // Find user and lesson (same logic as regular leave endpoint)
    const user = await User.findOne({ auth0Id: userInfo.sub }).select('name email picture auth0Id');
    if (!user) {
      console.log('❌ User not found for auth0Id:', userInfo.sub);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const userId = user._id;
    const lesson = await Lesson.findById(req.params.id)
      .populate('tutorId', 'name email picture auth0Id')
      .populate('studentId', 'name email picture auth0Id');
    
    if (!lesson) {
      console.log('❌ Lesson not found:', req.params.id);
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }
    
    // Determine if user is tutor or student
    const isTutor = lesson.tutorId._id.toString() === userId.toString();
    const isStudent = lesson.studentId._id.toString() === userId.toString();
    
    if (!isTutor && !isStudent) {
      return res.status(403).json({ success: false, message: 'User is not a participant in this lesson' });
    }
    
    console.log('🚪 User leaving lesson via beacon:', { userId, lessonId: lesson._id, role: isTutor ? 'tutor' : 'student' });
    
    // Update participants data
    if (!lesson.participants) lesson.participants = new Map();
    const key = user._id.toString();
    const prev = lesson.participants.get(key) || { joinCount: 0 };
    prev.leftAt = new Date();
    lesson.participants.set(key, prev);
    await lesson.save();
    
    // Emit WebSocket event (same as regular leave endpoint)
    if (req.io && req.connectedUsers) {
      const otherUserMongoId = isTutor ? lesson.studentId._id : lesson.tutorId._id;
      const otherUser = await User.findById(otherUserMongoId).select('auth0Id name picture');
      
      if (otherUser && otherUser.auth0Id) {
        const otherUserAuth0Id = otherUser.auth0Id;
        const otherUserSocketId = req.connectedUsers.get(otherUserAuth0Id);
        
        if (otherUserSocketId) {
          const leaveEvent = {
            lessonId: lesson._id.toString(),
            participantId: userId.toString(),
            participantRole: isTutor ? 'tutor' : 'student',
            participantName: user.name,
            leftAt: new Date().toISOString()
          };
          
          console.log('🚪 Emitting lesson_participant_left event from beacon:', JSON.stringify(leaveEvent, null, 2));
          req.io.to(otherUserSocketId).emit('lesson_participant_left', leaveEvent);
          req.io.to(`user:${otherUserAuth0Id}`).emit('lesson_participant_left', leaveEvent);
          console.log('✅ Successfully emitted lesson_participant_left from beacon');
        } else {
          console.log('⚠️ Other participant not connected for beacon leave');
        }
      }
    }
    
    res.json({ success: true, message: 'Left lesson recorded via beacon' });
  } catch (error) {
    console.error('❌ Error in beacon leave endpoint:', error);
    res.status(500).json({ success: false, message: 'Failed to record leave via beacon' });
  }
});

module.exports = router;