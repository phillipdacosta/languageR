const express = require('express');
const router = express.Router();
const multer = require('multer');
const Lesson = require('../models/Lesson');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Message = require('../models/Message');
const LessonAnalysis = require('../models/LessonAnalysis');
const Payment = require('../models/Payment');
const walletService = require('../services/walletService');
const stripeService = require('../services/stripeService');
const { RtcRole, RtcTokenBuilder } = require('agora-token');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const { generateTrialLessonMessage } = require('../utils/systemMessages');

// Helper function to get socket ID by auth0Id
async function getUserSocketId(auth0Id) {
  // Return the room name format that matches socket.join in server.js
  // Users are joined to rooms with format: user:${auth0Id}
  return `user:${auth0Id}`;
}


// Configure multer for beacon endpoint (parses FormData)
const beaconUpload = multer();

// Helper function to format names as "FirstName LastInitial."
const formatDisplayName = (user) => {
  if (!user) return 'Unknown User';
  
  const firstName = user.firstName || user.onboardingData?.firstName;
  const lastName = user.lastName || user.onboardingData?.lastName;
  const fullName = user.name;
  
  if (firstName && lastName) {
    const lastInitial = lastName.charAt(0).toUpperCase();
    return `${firstName} ${lastInitial}.`;
  }
  
  if (fullName) {
    const parts = fullName.trim().split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts[parts.length - 1];
      const lastInitial = last.charAt(0).toUpperCase();
      return `${first} ${lastInitial}.`;
    }
    return fullName;
  }
  
  if (user.email) {
    return user.email.split('@')[0];
  }
  
  return 'Unknown User';
};

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
      description,
      price, 
      duration,
      bookingData 
    } = req.body;

    console.log('📅 Creating lesson:', { tutorId, studentId, startTime, endTime, duration, user: req.user });

    // Validate required fields
    if (!tutorId || !studentId || !startTime || !endTime || !price) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }

    // Validate lesson duration
    const allowedDurations = [25, 50];
    if (duration && !allowedDurations.includes(duration)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lesson duration. Must be 25 or 50 minutes.'
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
    
    // Calculate buffer time based on lesson duration
    const lessonDuration = duration || 60;
    const bufferMinutes = lessonDuration === 25 ? 5 : lessonDuration === 50 ? 10 : 10;
    
    // Extend end time to include buffer for conflict checking
    const requestedEndWithBuffer = new Date(requestedEnd);
    requestedEndWithBuffer.setMinutes(requestedEndWithBuffer.getMinutes() + bufferMinutes);
    
    const now = new Date();

    console.log('⏰ Lesson timing:', {
      duration: lessonDuration,
      buffer: bufferMinutes,
      start: requestedStart.toISOString(),
      end: requestedEnd.toISOString(),
      endWithBuffer: requestedEndWithBuffer.toISOString()
    });

    // Validate that the lesson is not in the past
    if (requestedStart < now) {
      console.log('⚠️ Attempt to book lesson in the past:', {
        requestedStart: requestedStart.toISOString(),
        now: now.toISOString()
      });
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot book lessons in the past. Please select a future time slot.' 
      });
    }

    console.log('🔍 Checking for conflicts (including buffer):', {
      tutorId,
      requestedStart: requestedStart.toISOString(),
      requestedEnd: requestedEnd.toISOString(),
      requestedEndWithBuffer: requestedEndWithBuffer.toISOString()
    });

    // First, let's see all existing lessons for this tutor
    const allTutorLessons = await Lesson.find({ tutorId: tutorId });
    console.log('📚 All lessons for tutor:', allTutorLessons.map(l => ({
      id: l._id,
      start: l.startTime,
      end: l.endTime,
      duration: l.duration,
      status: l.status
    })));

    // Find any existing lessons for this tutor that overlap with the requested time (including buffer)
    // We need to check if any existing lesson (with its buffer) conflicts with the new lesson (with its buffer)
    const existingLessons = await Lesson.find({
      tutorId: tutorId,
      status: { $in: ['scheduled', 'in_progress', 'pending_reschedule'] }
    });

    let conflictingLesson = null;
    for (const lesson of existingLessons) {
      const existingStart = new Date(lesson.startTime);
      const existingEnd = new Date(lesson.endTime);
      const existingDuration = lesson.duration || 60;
      const existingBuffer = existingDuration === 25 ? 5 : existingDuration === 50 ? 10 : 10;
      const existingEndWithBuffer = new Date(existingEnd);
      existingEndWithBuffer.setMinutes(existingEndWithBuffer.getMinutes() + existingBuffer);

      // Check for overlap: existing lesson (with buffer) overlaps with new lesson (with buffer)
      // Overlap if: existingStart < requestedEndWithBuffer AND existingEndWithBuffer > requestedStart
      if (existingStart < requestedEndWithBuffer && existingEndWithBuffer > requestedStart) {
        conflictingLesson = lesson;
        console.log('⚠️ Conflict detected with existing lesson:', {
          existingId: lesson._id,
          existingStart: existingStart.toISOString(),
          existingEnd: existingEnd.toISOString(),
          existingEndWithBuffer: existingEndWithBuffer.toISOString(),
          existingDuration,
          existingBuffer
        });
        break;
      }
    }

    console.log('🔍 Conflict query result:', conflictingLesson ? {
      id: conflictingLesson._id,
      start: conflictingLesson.startTime,
      end: conflictingLesson.endTime,
      status: conflictingLesson.status
    } : 'No conflicts found');

    if (conflictingLesson) {
      console.log('⚠️ Time slot conflict detected (including buffer times):', {
        tutorId,
        requestedTime: { start: requestedStart, end: requestedEnd, endWithBuffer: requestedEndWithBuffer },
        conflictingLesson: {
          id: conflictingLesson._id,
          start: conflictingLesson.startTime,
          end: conflictingLesson.endTime,
          duration: conflictingLesson.duration
        }
      });

      return res.status(409).json({ 
        success: false, 
        message: `This time slot is no longer available. Please note that ${lessonDuration}-minute lessons require a ${bufferMinutes}-minute buffer. Please select a different time.`,
        code: 'TIME_SLOT_CONFLICT',
        conflict: {
          startTime: conflictingLesson.startTime,
          endTime: conflictingLesson.endTime
        }
      });
    }

    // Validate that the time slot is still in the tutor's availability
    console.log('🔍 Validating availability for time slot:', {
      tutorId,
      requestedStart: requestedStart.toISOString(),
      requestedEnd: requestedEnd.toISOString()
    });
    
    // Helper function to convert time string (HH:mm) to minutes
    const timeToMinutes = (timeStr) => {
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours * 60 + minutes;
    };
    
    // Get the day of week (0=Sunday, 1=Monday, etc.)
    const dayOfWeek = requestedStart.getDay();
    const requestedStartMinutes = requestedStart.getHours() * 60 + requestedStart.getMinutes();
    const requestedEndMinutes = requestedEnd.getHours() * 60 + requestedEnd.getMinutes();
    
    // Find matching availability blocks
    const availabilityBlocks = tutor.availability || [];
    const matchingBlocks = availabilityBlocks.filter(block => {
      // Must be an 'available' block
      if (block.type !== 'available') return false;
      
      // Must match the day of week
      if (block.day !== dayOfWeek) return false;
      
      // If block has absoluteStart, check if it matches the requested date
      if (block.absoluteStart) {
        const blockDate = new Date(block.absoluteStart);
        blockDate.setHours(0, 0, 0, 0);
        const requestedDate = new Date(requestedStart);
        requestedDate.setHours(0, 0, 0, 0);
        
        // If dates don't match, skip this block
        if (blockDate.getTime() !== requestedDate.getTime()) {
          return false;
        }
      } else if (block.id && typeof block.id === 'string') {
        // If no absoluteStart, try parsing from id (format: YYYY-MM-DD-...)
        const idParts = block.id.split('-');
        if (idParts.length >= 3) {
          const blockDateStr = `${idParts[0]}-${idParts[1]}-${idParts[2]}`;
          const blockDate = new Date(blockDateStr + 'T00:00:00');
          const requestedDate = new Date(requestedStart);
          requestedDate.setHours(0, 0, 0, 0);
          
          if (blockDate.getTime() !== requestedDate.getTime()) {
            return false;
          }
        }
      }
      
      // Check if requested time falls within this block's time range
      const blockStartMinutes = timeToMinutes(block.startTime);
      const blockEndMinutes = timeToMinutes(block.endTime);
      
      // Requested time must be completely within the available block
      return requestedStartMinutes >= blockStartMinutes && requestedEndMinutes <= blockEndMinutes;
    });
    
    console.log('📊 Availability check:', {
      dayOfWeek,
      requestedStartMinutes,
      requestedEndMinutes,
      totalBlocks: availabilityBlocks.length,
      matchingBlocks: matchingBlocks.length
    });
    
    if (matchingBlocks.length === 0) {
      console.log('⚠️ Time slot not available:', {
        tutorId,
        requestedTime: { start: requestedStart, end: requestedEnd },
        dayOfWeek,
        availableBlocksForDay: availabilityBlocks.filter(b => b.day === dayOfWeek).length
      });
      
      return res.status(409).json({
        success: false,
        message: 'This time slot is no longer available. The tutor may have updated their schedule. Please refresh the page and select a different time.',
        code: 'SLOT_NO_LONGER_AVAILABLE'
      });
    }
    
    // Check if this is the first SCHEDULED lesson between this student and tutor
    // (Exclude office hours from trial eligibility - they're a different product)
    const previousLessons = await Lesson.countDocuments({
      tutorId: tutorId,
      studentId: studentId,
      isOfficeHours: { $ne: true }, // Exclude office hours
      status: { $in: ['scheduled', 'in_progress', 'completed'] }
    });
    
    const isTrialLesson = previousLessons === 0;
    
    console.log('🎓 Trial lesson check:', {
      tutorId,
      studentId,
      previousScheduledLessons: previousLessons,
      isTrialLesson,
      note: 'Office hours sessions excluded from trial eligibility'
    });

    const lesson = await Lesson.create({
      tutorId,
      studentId,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      subject: subject || 'Language Lesson',
      description: description || '',
      price,
      duration: duration || 60,
      isTrialLesson,
      bookingData,
      channelName: `lesson_${new Date().getTime()}_${Math.random().toString(36).substr(2, 9)}`
    });

    // Populate tutor and student details
    await lesson.populate([
      { path: 'tutorId', select: 'name email picture' },
      { path: 'studentId', select: 'name email picture' }
    ]);

    console.log('📅 Lesson created successfully:', lesson._id);

    // Format date and time for notifications
    const lessonDate = new Date(lesson.startTime);
    const formattedDate = lessonDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const formattedTime = lessonDate.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });

    // Get language from bookingData, subject, or tutor's languages
    let language = 'language';
    if (lesson.bookingData?.selectedLanguage) {
      language = lesson.bookingData.selectedLanguage;
    } else if (lesson.subject && lesson.subject !== 'Language Lesson') {
      // Extract language from subject (e.g., "Spanish Lesson" -> "Spanish")
      language = lesson.subject.replace(/\s+Lesson$/i, '').trim();
    } else if (tutor.onboardingData?.languages && tutor.onboardingData.languages.length > 0) {
      language = tutor.onboardingData.languages[0];
    }

    // Format names for notifications
    const studentDisplayName = formatDisplayName(student);
    const tutorDisplayName = formatDisplayName(tutor);
    
    // Add trial lesson prefix to messages if applicable
    const lessonTypePrefix = isTrialLesson ? 'trial ' : '';
    const lessonTypeLabel = isTrialLesson ? 'Trial Lesson' : 'Lesson';

    // Create notification for tutor (skip for trial lessons - they get a special system message instead)
    if (!isTrialLesson) {
      try {
        await Notification.create({
          userId: tutor._id,
          type: 'lesson_created',
          title: 'New Lesson Scheduled',
          message: `<strong>${studentDisplayName}</strong> set up a <strong>${language}</strong> lesson with you for <strong>${formattedDate} at ${formattedTime}</strong>`,
          relatedUserPicture: student.picture || null,
          data: {
            lessonId: lesson._id,
            studentId: student._id,
            studentName: studentDisplayName,
            language: language,
            date: formattedDate,
            time: formattedTime,
            startTime: lesson.startTime,
            isTrialLesson: false
          }
        });
        console.log('✅ Notification created for tutor:', tutor._id);
      } catch (notifError) {
        console.error('❌ Error creating notification for tutor:', notifError);
      }
    }

    // Create notification for student
    try {
      await Notification.create({
        userId: student._id,
        type: 'lesson_created',
        title: isTrialLesson ? 'Trial Lesson Scheduled' : 'Lesson Scheduled',
        message: `You set up a <strong>${language}</strong> ${lessonTypePrefix}lesson with <strong>${tutorDisplayName}</strong> for <strong>${formattedDate} at ${formattedTime}</strong>`,
        relatedUserPicture: tutor.picture || null,
        data: {
          lessonId: lesson._id,
          tutorId: tutor._id,
          tutorName: tutorDisplayName,
          language: language,
          date: formattedDate,
          time: formattedTime,
          startTime: lesson.startTime,
          isTrialLesson: isTrialLesson
        }
      });
      console.log('✅ Notification created for student:', student._id);
    } catch (notifError) {
      console.error('❌ Error creating notification for student:', notifError);
    }

    // Emit WebSocket notifications if users are connected
    if (req.io && req.connectedUsers) {
      const tutorSocketId = req.connectedUsers.get(tutor.auth0Id);
      const studentSocketId = req.connectedUsers.get(student.auth0Id);

      if (tutorSocketId) {
        req.io.to(tutorSocketId).emit('new_notification', {
          type: 'lesson_created',
          message: `<strong>${studentDisplayName}</strong> set up a <strong>${language}</strong> ${lessonTypePrefix}lesson with you for <strong>${formattedDate} at ${formattedTime}</strong>`,
          isTrialLesson: isTrialLesson
        });
      }

      if (studentSocketId) {
        req.io.to(studentSocketId).emit('new_notification', {
          type: 'lesson_created',
          message: `You set up a <strong>${language}</strong> ${lessonTypePrefix}lesson with <strong>${tutorDisplayName}</strong> for <strong>${formattedDate} at ${formattedTime}</strong>`,
          isTrialLesson: isTrialLesson
        });
      }
    }

    // Send system message to tutor if this is a trial lesson
    console.log('🔍 [TRIAL LESSON] Checking isTrialLesson:', isTrialLesson);
    if (isTrialLesson) {
      console.log('🔍 [TRIAL LESSON] Starting system message creation...');
      try {
        // Get tutor's interface language preference
        const tutorLanguage = tutor.interfaceLanguage || 'en';
        console.log('🔍 [TRIAL LESSON] Tutor language:', tutorLanguage);
        
        // Generate the multilingual system message
        const systemMessageContent = generateTrialLessonMessage({
          studentName: studentDisplayName,
          studentId: student._id.toString(),
          startTime: lessonDate,
          duration: lesson.duration,
          tutorLanguage
        });
        
        console.log('🔍 [TRIAL LESSON] Message generated, length:', systemMessageContent.length);
        
        // Create conversation ID between tutor and student using auth0Ids (NOT MongoDB ObjectIds)
        const ids = [student.auth0Id, tutor.auth0Id].sort();
        const conversationId = `${ids[0]}_${ids[1]}`;
        console.log('🔍 [TRIAL LESSON] ConversationId:', conversationId);
        
        // Create the system message
        const systemMessage = new Message({
          conversationId,
          senderId: 'system',
          receiverId: tutor.auth0Id, // Use auth0Id, not MongoDB ObjectId
          content: systemMessageContent,
          type: 'system',
          isSystemMessage: true,
          visibleToTutorOnly: true,
          triggerType: 'book_lesson',
          read: false
        });
        
        await systemMessage.save();
        
        console.log('✅ System message sent to tutor about trial lesson:', {
          messageId: systemMessage._id.toString(),
          tutorAuth0Id: tutor.auth0Id,
          studentAuth0Id: student.auth0Id,
          conversationId,
          language: tutorLanguage
        });
        
        // Create notification for tutor about the trial lesson message
        const trialNotification = await Notification.create({
          userId: tutor._id,
          type: 'lesson_created',
          title: 'Trial Lesson Tips',
          message: `<strong>${studentDisplayName}</strong> booked a <strong>trial lesson</strong> on <strong>${new Date(lesson.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${new Date(lesson.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</strong>. Check your messages for preparation tips.`,
          relatedUserPicture: student.picture || null,
          data: {
            lessonId: lesson._id.toString(),
            studentId: student._id.toString(),
            studentName: studentDisplayName,
            studentPicture: student.picture,
            conversationId,
            messageId: systemMessage._id.toString(),
            startTime: lesson.startTime
          }
        });
        
        console.log('✅ Trial lesson notification created:', trialNotification._id);
        
        // Emit websocket notification to tutor if connected
        if (req.io && req.connectedUsers) {
          const tutorSocketId = req.connectedUsers.get(tutor.auth0Id);
          if (tutorSocketId) {
            console.log('📤 Emitting trial lesson notification to tutor');
            
            // Emit notification event
            req.io.to(tutorSocketId).emit('new_notification', {
              type: 'lesson_created',
              title: 'Trial Lesson Tips',
              message: `${studentDisplayName} booked a trial lesson on ${new Date(lesson.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${new Date(lesson.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. Check your messages for preparation tips.`,
              data: {
                lessonId: lesson._id.toString(),
                studentId: student._id.toString(),
                studentName: studentDisplayName,
                studentPicture: student.picture,
                conversationId,
                startTime: lesson.startTime
              }
            });
            
            // Also emit new_message event to update Messages tab unread count and dropdown
            req.io.to(tutorSocketId).emit('new_message', {
              id: systemMessage._id.toString(),
              conversationId,
              senderId: 'system',
              receiverId: tutor.auth0Id,
              content: systemMessageContent, // Send full content, not truncated
              type: 'system',
              isSystemMessage: true,
              read: false,
              createdAt: systemMessage.createdAt
            });
          }
        }
      } catch (systemMsgError) {
        console.error('❌ Error creating trial lesson system message:', systemMsgError);
        console.error('❌ Error stack:', systemMsgError.stack);
        // Don't fail the lesson creation if system message fails
      }
    } else {
      console.log('ℹ️ [TRIAL LESSON] Not a trial lesson, skipping system message');
    }

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

// Create office hours instant booking
router.post('/office-hours', verifyToken, async (req, res) => {
  try {
    const { tutorId, duration, startTime, instant } = req.body;
    const studentId = req.user.sub; // Current user is the student

    console.log('⚡ Creating office hours booking:', { tutorId, studentId, duration, startTime, instant });

    // Validate required fields
    if (!tutorId || !duration) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields (tutorId, duration)' 
      });
    }

    // Validate duration (7, 15, or 30 minutes for office hours)
    const allowedDurations = [7, 15, 30];
    if (!allowedDurations.includes(duration)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid office hours duration. Must be 7, 15, or 30 minutes.'
      });
    }

    // Verify tutor exists and has office hours enabled
    const tutor = await User.findById(tutorId);
    if (!tutor) {
      return res.status(404).json({ 
        success: false, 
        message: 'Tutor not found' 
      });
    }

    if (!tutor.profile?.officeHoursEnabled) {
      return res.status(400).json({ 
        success: false, 
        message: 'This tutor does not have office hours enabled' 
      });
    }

    // For instant bookings, verify tutor is actively available (recent heartbeat)
    if (instant) {
      const lastActive = tutor.profile?.officeHoursLastActive;
      const activeThreshold = 60 * 1000; // 60 seconds
      const now = new Date();
      
      if (!lastActive || (now - new Date(lastActive)) > activeThreshold) {
        return res.status(400).json({ 
          success: false, 
          message: 'Tutor is not actively available right now. Please try again later or schedule a session.',
          code: 'TUTOR_NOT_ACTIVE'
        });
      }
    }

    // Verify student exists
    const student = await User.findOne({ auth0Id: studentId });
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    // Determine start and end times
    let lessonStartTime, lessonEndTime;
    
    if (instant) {
      // For instant bookings, start in 2 minutes (give tutor time to prepare)
      lessonStartTime = new Date();
      lessonStartTime.setMinutes(lessonStartTime.getMinutes() + 2);
      lessonEndTime = new Date(lessonStartTime);
      lessonEndTime.setMinutes(lessonEndTime.getMinutes() + duration);
    } else if (startTime) {
      // For scheduled office hours
      lessonStartTime = new Date(startTime);
      lessonEndTime = new Date(lessonStartTime);
      lessonEndTime.setMinutes(lessonEndTime.getMinutes() + duration);
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Start time required for scheduled bookings' 
      });
    }

    // Validate that the lesson is not in the past
    const now = new Date();
    if (lessonStartTime < now) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot book sessions in the past' 
      });
    }

    // Check for conflicts with existing lessons
    const existingLessons = await Lesson.find({
      tutorId: tutorId,
      status: { $in: ['scheduled', 'in_progress', 'pending_reschedule'] },
      startTime: { $lt: lessonEndTime },
      endTime: { $gt: lessonStartTime }
    });

    if (existingLessons.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Tutor is busy at this time. Please choose another slot.',
        code: 'TIME_CONFLICT'
      });
    }

    // Calculate price based on tutor's hourly rate
    const standardRate = tutor.onboardingData?.hourlyRate || 25;
    const standardDuration = 50; // Standard lesson duration
    const price = Math.round((standardRate / standardDuration) * duration * 100) / 100;

    // Create the lesson
    const lesson = new Lesson({
      tutorId: tutor._id,
      studentId: student._id,
      startTime: lessonStartTime,
      endTime: lessonEndTime,
      subject: 'Office Hours',
      price: price,
      duration: duration,
      status: 'scheduled',
      isTrialLesson: false, // Office hours are never trials
      isOfficeHours: true,
      officeHoursType: instant ? 'quick' : 'scheduled',
      bookingType: instant ? 'instant' : 'office_hours',
      channelName: `lesson_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });

    await lesson.save();
    console.log('✅ Office hours session created:', lesson._id);

    // Populate tutor and student details for response
    await lesson.populate('tutorId studentId');

    // Create notification for tutor
    const tutorDisplayName = formatDisplayName(student);
    const formattedTime = lessonStartTime.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });
    const formattedDate = lessonStartTime.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
    const timeUntilStart = Math.round((lessonStartTime - new Date()) / 60000); // minutes

    const notification = new Notification({
      userId: tutor._id,
      type: instant ? 'office_hours_booking' : 'lesson_created',
      title: instant ? '⚡ New Office Hours Session!' : 'Office Hours Scheduled',
      message: instant 
        ? `${tutorDisplayName} just booked a ${duration}-minute session starting ${timeUntilStart < 5 ? 'NOW' : `in ${timeUntilStart} minutes`}!`
        : `${tutorDisplayName} scheduled a ${duration}-minute office hours session for ${formattedDate} at ${formattedTime}`,
      data: {
        lessonId: lesson._id,
        studentName: tutorDisplayName,
        startTime: lessonStartTime,
        duration: duration,
        urgent: instant || timeUntilStart < 10
      },
      read: false
    });

    await notification.save();
    console.log('📬 Notification created for tutor:', notification._id);

    // Send real-time notification via socket if tutor is online
    if (req.io) {
      const tutorAuth0Id = tutor.auth0Id;
      const tutorSocketId = req.connectedUsers?.get(tutorAuth0Id);
      
      if (tutorSocketId) {
        req.io.to(tutorSocketId).emit('office_hours_booking', {
          type: 'office_hours_booking',
          message: notification.message,
          lessonId: lesson._id.toString(),
          data: {
            lessonId: lesson._id.toString(),
            studentName: student.firstName || student.name || 'Student',
            duration: duration
          },
          urgent: instant || timeUntilStart < 10,
          notificationId: notification._id
        });
        console.log('🔔 Real-time notification sent to tutor, lessonId:', lesson._id.toString());
      }
    }

    res.json({ 
      success: true, 
      lesson,
      message: instant ? 'Session starting soon! Tutor has been notified.' : 'Office hours scheduled successfully'
    });
  } catch (error) {
    console.error('❌ Error creating office hours booking:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create office hours booking',
      error: error.message 
    });
  }
});

// Get lessons by tutor ID (protected - contains sensitive student data)
// IMPORTANT: This must come BEFORE /:id route to avoid route conflicts
router.get('/by-tutor/:tutorId', verifyToken, async (req, res) => {
  try {
    const startTime = Date.now();
    const { tutorId } = req.params;
    const { all, startDate, endDate } = req.query; // Add date range parameters
    
    console.log(`⏱️ [Lessons By Tutor] Request started for tutorId: ${tutorId}`);
    
    if (!tutorId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Tutor ID is required' 
      });
    }

    console.log('📅 Fetching lessons for tutor:', tutorId, 'all:', all, 'dateRange:', startDate, '-', endDate);

    // Build query - if 'all' is true, get all lessons; otherwise only active ones
    const query = { tutorId: tutorId };
    
    // Add date range filter if provided
    if (startDate || endDate) {
      query.startTime = {};
      if (startDate) {
        query.startTime.$gte = new Date(startDate);
      }
      if (endDate) {
        query.startTime.$lte = new Date(endDate);
      }
      console.log('📅 ✅ Date range filter applied:', query.startTime);
      console.log('📅 ✅ Final query:', JSON.stringify(query));
    } else if (!all || all !== 'true') {
      // Only filter by status if no date range provided
      // Include pending_reschedule so the original slot stays blocked until confirmed
      query.status = { $in: ['scheduled', 'in_progress', 'pending_reschedule'] };
      console.log('📅 ⚠️ No date range, filtering by status:', query.status);
    } else {
      console.log('📅 ⚠️ No date range AND all=true, will fetch ALL lessons');
    }

    // Find lessons for this tutor
    const dbStartTime = Date.now();
    const lessons = await Lesson.find(query)
    .populate('studentId', 'name email picture firstName lastName')
    .sort({ startTime: 1 });
    const dbDuration = Date.now() - dbStartTime;
    console.log(`⏱️ [Lessons By Tutor] DB query took: ${dbDuration}ms`);

    console.log(`📅 Found ${lessons.length} lessons for tutor ${tutorId}`);
    
    // Debug: Log isTrialLesson values
    lessons.forEach(lesson => {
      if (lesson.startTime && new Date(lesson.startTime).getHours() === 12) {
        console.log('🔍 12PM Lesson:', {
          id: lesson._id,
          isTrialLesson: lesson.isTrialLesson,
          hasField: lesson.hasOwnProperty('isTrialLesson'),
          rawValue: lesson.toObject().isTrialLesson
        });
      }
    });

    const totalDuration = Date.now() - startTime;
    console.log(`⏱️ [Lessons By Tutor] Total request time: ${totalDuration}ms`);

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
        isTrialLesson: lesson.isTrialLesson,
        bookingData: lesson.bookingData,
        rescheduleProposal: lesson.rescheduleProposal // ADDED: Include reschedule proposal
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
    .populate('tutorId', 'name email picture firstName lastName')
    .populate('studentId', 'name email picture firstName lastName')
    .sort({ startTime: 1 });

    // Load LessonAnalysis for each completed lesson to check if analysis exists
    const LessonAnalysis = require('../models/LessonAnalysis');
    const lessonIds = lessons.map(l => l._id);
    const analyses = await LessonAnalysis.find({ 
      lessonId: { $in: lessonIds },
      status: { $in: ['completed', 'generating'] }
    }).select('lessonId status');
    
    // Create a map of lessonId -> analysis status
    const analysisMap = new Map();
    analyses.forEach(analysis => {
      analysisMap.set(analysis.lessonId.toString(), analysis.status);
    });
    
    // Attach analysis status to each lesson
    const lessonsWithAnalysis = lessons.map(lesson => {
      const lessonObj = lesson.toObject();
      const analysisStatus = analysisMap.get(lesson._id.toString());
      
      if (analysisStatus) {
        lessonObj.aiAnalysis = {
          status: analysisStatus,
          hasAnalysis: analysisStatus === 'completed'
        };
      } else {
        lessonObj.aiAnalysis = {
          status: 'unavailable',
          hasAnalysis: false
        };
      }
      
      return lessonObj;
    });

    res.json({ 
      success: true, 
      lessons: lessonsWithAnalysis 
    });
  } catch (error) {
    console.error('❌ Error fetching lessons:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch lessons' 
    });
  }
});

// Get lessons by student ID (for checking availability conflicts)
// IMPORTANT: This must come BEFORE the /:id route to avoid conflicts
router.get('/student/:studentId', verifyToken, async (req, res) => {
  try {
    const { studentId } = req.params;
    const all = req.query.all === 'true';

    console.log('📅 Fetching lessons for student:', studentId);

    // Build query to find lessons where user is the student
    const query = { studentId };
    
    if (!all) {
      // By default, only return future lessons
      query.startTime = { $gte: new Date() };
    }

    const lessons = await Lesson.find(query)
      .populate('tutorId', 'name email picture firstName lastName')
      .populate('studentId', 'name email picture firstName lastName')
      .sort({ startTime: 1 });

    console.log(`✅ Found ${lessons.length} lessons for student ${studentId}`);

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
        channelName: lesson.channelName,
        price: lesson.price,
        duration: lesson.duration,
        isTrialLesson: lesson.isTrialLesson,
        bookingData: lesson.bookingData,
        createdAt: lesson.createdAt,
        updatedAt: lesson.updatedAt
      }))
    });
  } catch (error) {
    console.error('❌ Error fetching lessons by student:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch lessons' 
    });
  }
});

// Get lesson details (protected - contains sensitive data)
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id)
      .populate('tutorId', 'name email picture firstName lastName profile')
      .populate('studentId', 'name email picture firstName lastName profile');

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
    
    if (!lesson || (lesson.status !== 'scheduled' && lesson.status !== 'confirmed' && lesson.status !== 'in_progress')) {
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
      .populate('tutorId', 'name email picture firstName lastName')
      .populate('studentId', 'name email picture firstName lastName');

    if (!lesson || (lesson.status !== 'scheduled' && lesson.status !== 'confirmed' && lesson.status !== 'in_progress')) {
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
    if (lesson.status === 'scheduled' || lesson.status === 'confirmed') {
      lesson.status = 'in_progress';
      console.log(`✅ Updated lesson status to in_progress`);
    }

    // Record participant join FIRST (before checking for start time)
    if (!lesson.participants) lesson.participants = new Map();
    const key = userId.toString();
    const prev = lesson.participants.get(key) || { joinCount: 0 };
    prev.joinedAt = now;
    prev.leftAt = null;
    prev.joinCount = (prev.joinCount || 0) + 1;
    lesson.participants.set(key, prev);
    
    // Count active participants (joined but not left)
    const activeParticipants = Array.from(lesson.participants.values())
      .filter(p => p.joinedAt && !p.leftAt).length;
    
    console.log(`👥 Active participants count: ${activeParticipants}`);

    // Record actual call start time ONLY when BOTH participants are present
    // This ensures billing only starts when both users are actually in the call
    // Add a 4-second grace period after second participant joins
    if (!lesson.actualCallStartTime && activeParticipants >= 2) {
      const startTimeWithDelay = new Date(now.getTime() + 4000); // 4 seconds delay
      lesson.actualCallStartTime = startTimeWithDelay;
      lesson.billingStatus = 'authorized';
      console.log(`⏱️ ✅ Recorded actualCallStartTime (BOTH participants present + 4s grace period): ${startTimeWithDelay}`);
      console.log(`⏱️ This is when billing starts - both tutor and student are in the call`);
    } else if (!lesson.actualCallStartTime) {
      console.log(`⏱️ ⏳ Waiting for second participant before recording start time (current: ${activeParticipants})`);
    }
    
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
            participantName: formatDisplayName(user),
            participantPicture: user.picture,
            joinedAt: now.toISOString()
          };
          console.log('📡 Emitting lesson_participant_joined event:', JSON.stringify(presenceEvent, null, 2));
          console.log('📡 Emitting to socket:', otherUserSocketId);
          console.log('📡 Using req.io.to().emit() method');
          
          // Emit to socket ID only (room emission causes duplicates)
          req.io.to(otherUserSocketId).emit('lesson_participant_joined', presenceEvent);
          
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

// Update lesson data (e.g., whiteboard room UUID)
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const lesson = await Lesson.findById(req.params.id);
    
    if (!lesson) {
      return res.status(404).json({ 
        success: false, 
        message: 'Lesson not found' 
      });
    }

    // Only tutor or student can update lesson
    const isTutor = lesson.tutorId.toString() === user._id.toString();
    const isStudent = lesson.studentId.toString() === user._id.toString();
    
    if (!isTutor && !isStudent) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to update this lesson' 
      });
    }

    // Update allowed fields
    const allowedFields = ['whiteboardRoomUUID', 'whiteboardCreatedAt'];
    const updates = {};
    
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    // Apply updates
    Object.assign(lesson, updates);
    await lesson.save();

    console.log(`✅ Lesson ${lesson._id} updated by ${user.email}`);
    
    res.json({ 
      success: true, 
      lesson 
    });
  } catch (error) {
    console.error('❌ Error updating lesson:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update lesson' 
    });
  }
});

// Update lesson status (PATCH)
router.patch('/:id/status', verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const lesson = await Lesson.findById(req.params.id);
    
    if (!lesson) {
      return res.status(404).json({ 
        success: false, 
        message: 'Lesson not found' 
      });
    }

    // Only tutor or student can update status
    const isTutor = lesson.tutorId.toString() === user._id.toString();
    const isStudent = lesson.studentId.toString() === user._id.toString();

    if (!isTutor && !isStudent) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to update this lesson' 
      });
    }

    // Update status
    lesson.status = status;
    await lesson.save();

    console.log(`✅ Lesson ${lesson._id} status updated to: ${status}`);

    // If lesson is confirmed (tutor accepted office hours), notify student
    if (status === 'confirmed' && req.io && lesson.isOfficeHours) {
      console.log('✅ Office hours accepted, preparing to notify student...');
      
      // Populate tutor and student to get auth0Ids
      await lesson.populate([
        { path: 'tutorId', select: 'auth0Id name firstName lastName picture' },
        { path: 'studentId', select: 'auth0Id name firstName lastName' }
      ]);

      const studentAuth0Id = lesson.studentId?.auth0Id;
      const studentMongoId = lesson.studentId?._id;
      const tutorName = lesson.tutorId?.name || lesson.tutorId?.firstName || 'Tutor';
      const tutorPicture = lesson.tutorId?.picture || null;
      const studentSocketId = req.connectedUsers?.get(studentAuth0Id);
      
      console.log('🔍 Student notification info:', {
        studentAuth0Id,
        studentSocketId,
        tutorName,
        lessonId: lesson._id.toString()
      });

      // Create persistent database notification
      try {
        await Notification.create({
          userId: studentMongoId,
          type: 'office_hours_accepted',
          title: 'Tutor Ready!',
          message: `<strong>${tutorName}</strong> is ready for your session! Join now.`,
          relatedUserPicture: tutorPicture,
          data: {
            lessonId: lesson._id,
            tutorName: tutorName
          }
        });
        console.log(`📬 Created persistent notification for student ${studentAuth0Id}`);
      } catch (notifError) {
        console.error('❌ Error creating acceptance notification:', notifError);
      }

      // Send real-time WebSocket event to navigate student to pre-call
      if (studentSocketId) {
        console.log(`🔔 Emitting office_hours_accepted event to student ${studentAuth0Id}`);
        req.io.to(studentSocketId).emit('office_hours_accepted', {
          lessonId: lesson._id.toString(),
          tutorName: tutorName,
          message: `${tutorName} is ready for your session!`
        });
        console.log('✅ office_hours_accepted event emitted successfully');
      } else {
        console.log(`⚠️ Student ${studentAuth0Id} not connected to WebSocket`);
      }
    }

    // If lesson is cancelled, emit WebSocket event to notify the other participant
    if (status === 'cancelled' && req.io) {
      console.log('🚫 Lesson cancelled, preparing to notify participants...');
      
      // Populate tutor and student to get auth0Ids
      await lesson.populate([
        { path: 'tutorId', select: 'auth0Id name firstName lastName picture' },
        { path: 'studentId', select: 'auth0Id name firstName lastName picture' }
      ]);

      const tutorAuth0Id = lesson.tutorId?.auth0Id;
      const studentAuth0Id = lesson.studentId?.auth0Id;
      const cancellerAuth0Id = user.auth0Id;
      
      console.log('🔍 Cancellation details:', {
        tutorAuth0Id,
        studentAuth0Id,
        cancellerAuth0Id,
        lessonId: lesson._id.toString()
      });
      
      // Get tutor and student MongoDB IDs
      const tutorMongoId = lesson.tutorId?._id;
      const studentMongoId = lesson.studentId?._id;

      // Determine who to notify (the other participant)
      const recipientAuth0Id = cancellerAuth0Id === tutorAuth0Id ? studentAuth0Id : tutorAuth0Id;
      const recipientMongoId = cancellerAuth0Id === tutorAuth0Id ? studentMongoId : tutorMongoId;
      const recipientSocketId = req.connectedUsers?.get(recipientAuth0Id);
      const cancellerPicture = user.picture || null;
      
      console.log('🔍 Recipient info:', {
        recipientAuth0Id,
        recipientSocketId,
        totalConnectedUsers: req.connectedUsers?.size,
        allConnectedUsers: Array.from(req.connectedUsers?.keys() || [])
      });

      // Format lesson date/time for notification message
      const startTime = new Date(lesson.startTime);
      const formattedDate = startTime.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric' 
      });
      const formattedTime = startTime.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      });

      // Create persistent database notification
      try {
        const cancellerName = user.name || 'Participant';
        const notificationMessage = isTutor 
          ? `Your session scheduled for <strong>${formattedDate} at ${formattedTime}</strong> has been cancelled. You have not been charged.`
          : `The student cancelled the session scheduled for <strong>${formattedDate} at ${formattedTime}</strong>.`;

        await Notification.create({
          userId: recipientMongoId,
          type: 'lesson_cancelled',
          title: 'Session Cancelled',
          message: notificationMessage,
          relatedUserPicture: cancellerPicture,
          data: {
            lessonId: lesson._id,
            cancelledBy: isTutor ? 'tutor' : 'student',
            cancellerName: cancellerName,
            startTime: lesson.startTime,
            endTime: lesson.endTime
          }
        });
        console.log(`📬 Created persistent notification for ${recipientAuth0Id}`);
      } catch (notifError) {
        console.error('❌ Error creating cancellation notification:', notifError);
      }

      // Send real-time WebSocket event (for immediate notification in pre-call/video-call)
      if (recipientSocketId) {
        console.log(`🔔 Emitting lesson_cancelled event to ${recipientAuth0Id} via socket ${recipientSocketId}`);
        req.io.to(recipientSocketId).emit('lesson_cancelled', {
          lessonId: lesson._id.toString(),
          cancelledBy: isTutor ? 'tutor' : 'student',
          cancellerName: user.name || 'Participant',
          reason: 'The lesson has been cancelled'
        });
        console.log('✅ lesson_cancelled event emitted successfully');
      } else {
        console.log(`⚠️ Recipient ${recipientAuth0Id} not connected to WebSocket`);
        console.log('⚠️ This means the student will only see the database notification later');
      }
    }

    res.json({ 
      success: true, 
      message: `Lesson ${status}`,
      lesson 
    });
  } catch (error) {
    console.error('Error updating lesson status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update lesson status' 
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
      .populate('tutorId', 'name email picture firstName lastName auth0Id')
      .populate('studentId', 'name email picture firstName lastName auth0Id');
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
            participantName: formatDisplayName(user),
            leftAt: new Date().toISOString()
          };
          console.log('🚪 Emitting lesson_participant_left event:', JSON.stringify(leaveEvent, null, 2));
          console.log('🚪 Emitting to socket:', otherUserSocketId);
          
          // Emit to socket ID only (room emission causes duplicates)
          req.io.to(otherUserSocketId).emit('lesson_participant_left', leaveEvent);
          
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
// Use multer to parse FormData (sendBeacon sends multipart/form-data)
router.post('/:id/leave-beacon', beaconUpload.none(), async (req, res) => {
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
      .populate('tutorId', 'name email picture firstName lastName auth0Id')
      .populate('studentId', 'name email picture firstName lastName auth0Id');
    
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
            participantName: formatDisplayName(user),
            leftAt: new Date().toISOString()
          };
          
          console.log('🚪 Emitting lesson_participant_left event from beacon:', JSON.stringify(leaveEvent, null, 2));
          req.io.to(otherUserSocketId).emit('lesson_participant_left', leaveEvent);
          console.log('✅ Successfully emitted lesson_participant_left from beacon');
        } else {
          console.log('⚠️ Other participant not connected for beacon leave');
        }
      }
    }
    
    // 🚨 DO NOT finalize the lesson here when user closes browser!
    // The lesson should continue and be finalized by:
    // 1. The other participant explicitly clicking "End Call", OR
    // 2. The autoFinalizeLessons cron job after the scheduled end time
    // Simply marking the leave time is sufficient for tracking purposes
    console.log('✅ Browser close recorded - lesson will continue until explicit end or scheduled completion');

    res.json({ success: true, message: 'Left lesson recorded (browser close)' });
  } catch (error) {
    console.error('❌ Error in beacon leave endpoint:', error);
    res.status(500).json({ success: false, message: 'Failed to record leave via beacon' });
  }
});

// POST /api/lessons/:id/call-start - Record when the call actually starts (both parties connected)
router.post('/:id/call-start', verifyToken, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    // Only record if not already started
    if (!lesson.actualCallStartTime) {
      lesson.actualCallStartTime = new Date();
      lesson.status = 'in_progress';
      await lesson.save();
      console.log(`⏱️ Call started for lesson ${lesson._id}`);

      // 💰 DEDUCT FUNDS: Charge the student when lesson starts (Preply model)
      if (lesson.paymentId) {
        try {
          const paymentService = require('../services/paymentService');
          await paymentService.deductLessonFunds(lesson._id);
          console.log(`✅ Funds deducted for lesson ${lesson._id} at START`);
        } catch (paymentError) {
          console.error(`❌ Failed to deduct funds at lesson start:`, paymentError.message);
          // Note: We still allow lesson to continue even if deduction fails
          // Funds will be deducted as fallback at lesson end
        }
      }
    }

    res.json({ 
      success: true, 
      actualCallStartTime: lesson.actualCallStartTime 
    });
  } catch (error) {
    console.error('Error recording call start:', error);
    res.status(500).json({ success: false, message: 'Failed to record call start' });
  }
});

// POST /api/lessons/:id/call-end - Record when the call ends and calculate actual billing
router.post('/:id/call-end', verifyToken, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id)
      .populate('tutorId', 'name firstName lastName email auth0Id picture')
      .populate('studentId', 'name firstName lastName email auth0Id picture');
      
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    // Get current user to determine who ended the lesson
    const user = await User.findOne({ auth0Id: req.user.sub });
    const userId = user?._id;
    const userRole = userId && userId.toString() === lesson.tutorId._id.toString() ? 'tutor' : 'student';

    // Only calculate if call was started and not already ended
    if (lesson.actualCallStartTime && !lesson.actualCallEndTime) {
      const now = new Date();
      lesson.actualCallEndTime = now;
      
      // Calculate actual duration in minutes
      const durationMs = now - new Date(lesson.actualCallStartTime);
      const actualMinutes = Math.ceil(durationMs / (1000 * 60)); // Round up to nearest minute
      lesson.actualDurationMinutes = actualMinutes;
      
      // Calculate actual price (for per-minute billing)
      if (lesson.isOfficeHours) {
        // Get tutor's rate
        const tutor = await User.findById(lesson.tutorId);
        const standardRate = tutor?.onboardingData?.hourlyRate || 25;
        const standardDuration = 50; // Standard lesson duration
        const perMinuteRate = standardRate / standardDuration;
        
        // Calculate actual price based on actual time used (no cap)
        // This ensures tutors are paid fairly for all time worked
        const calculatedPrice = Math.round(perMinuteRate * actualMinutes * 100) / 100;
        lesson.actualPrice = calculatedPrice;
        lesson.billingStatus = 'charged';
        
        // Log if student stayed longer than booked duration
        const bookedMinutes = lesson.duration || 7;
        if (actualMinutes > bookedMinutes) {
          console.log(`💰 Office hours billing: ${actualMinutes} minutes (${actualMinutes - bookedMinutes} min over) = $${lesson.actualPrice} (booked: ${bookedMinutes} min for $${lesson.price})`);
        } else {
          console.log(`💰 Office hours billing: ${actualMinutes} minutes = $${lesson.actualPrice} (booked: ${bookedMinutes} min for $${lesson.price})`);
        }
      } else {
        // For regular lessons, use the full price
        lesson.actualPrice = lesson.price;
        lesson.billingStatus = 'charged';
      }
      
      // Mark lesson as completed (prevents rejoining)
      lesson.status = 'completed';
      
      await lesson.save();
      console.log(`⏱️ Call ended for lesson ${lesson._id}: ${lesson.actualDurationMinutes} minutes`);
      console.log(`✅ Lesson marked as completed by ${userRole}`);
      
      // 💰 COMPLETE PAYMENT: Deduct from wallet and payout to tutor
      if (lesson.paymentId) {
        try {
          const paymentService = require('../services/paymentService');
          await paymentService.completeLessonPayment(lesson._id, req.io); // Pass io for notifications
          console.log(`✅ Payment completed for lesson ${lesson._id}`);
        } catch (paymentError) {
          console.error(`❌ Payment completion failed for lesson ${lesson._id}:`, paymentError.message);
          // Don't fail the whole request if payment fails
        }
      }
      
      // Notify the OTHER participant via WebSocket that lesson was ended
      const otherParticipant = userRole === 'tutor' ? lesson.studentId : lesson.tutorId;
      const otherSocketId = await getUserSocketId(otherParticipant.auth0Id);
      const endedByName = formatDisplayName(userRole === 'tutor' ? lesson.tutorId : lesson.studentId);
      
      if (otherSocketId && req.io) {
        console.log(`📡 Notifying ${userRole === 'tutor' ? 'student' : 'tutor'} that lesson was ended early...`);
        req.io.to(otherSocketId).emit('lesson_ended_by_participant', {
          lessonId: lesson._id.toString(),
          endedBy: userRole,
          endedByName,
          message: `${endedByName} has ended the lesson early.`,
          actualDuration: lesson.actualDurationMinutes,
          scheduledDuration: lesson.duration
        });
      }
      
      // Auto-trigger AI analysis generation OR request tutor feedback
      setTimeout(async () => {
        try {
          const lessonForAnalysis = await Lesson.findById(lesson._id)
            .populate('tutorId', 'name firstName lastName email auth0Id picture profile')
            .populate('studentId', 'name firstName lastName email auth0Id picture profile');
          
          if (!lessonForAnalysis) return;
          
          /* 
          TEMPORARILY DISABLED: Tutor Feedback Flow (AI opt-out)
          TODO: Re-enable if we want to support AI-disabled mode
          
          // Check if student has AI analysis enabled
          const studentProfile = lessonForAnalysis.studentId?.profile;
          const aiAnalysisEnabled = studentProfile?.aiAnalysisEnabled !== false; // Default to true
          
          console.log(`🤖 AI Analysis Enabled for lesson ${lessonForAnalysis._id}: ${aiAnalysisEnabled}`);
          
          if (!aiAnalysisEnabled) {
            // AI disabled - require manual tutor feedback
            console.log('📝 AI disabled - Creating tutor feedback requirement...');
            
            const TutorFeedback = require('../models/TutorFeedback');
            const feedbackExists = await TutorFeedback.findOne({ lessonId: lessonForAnalysis._id });
            
            if (!feedbackExists) {
              await TutorFeedback.create({
                lessonId: lessonForAnalysis._id,
                tutorId: lessonForAnalysis.tutorId._id,
                studentId: lessonForAnalysis.studentId._id,
                status: 'pending'
              });
              
              // Get dynamic feedback message
              const feedbackMessages = [
                { title: '📝 Lesson Feedback Needed', message: 'Do it while it\'s fresh in your mind!' },
                { title: '✍️ Share Your Insights', message: 'Your student is waiting for your feedback!' },
                { title: '💭 Time to Reflect', message: 'Quick! Share what went well in the lesson.' },
                { title: '📊 Feedback Time', message: 'Help your student improve with your feedback!' }
              ];
              const randomMsg = feedbackMessages[Math.floor(Math.random() * feedbackMessages.length)];
              
              console.log('📝 Creating notification for tutor:', lessonForAnalysis.tutorId.email);
              console.log('   Tutor ID:', lessonForAnalysis.tutorId._id);
              console.log('   Student:', formatDisplayName(lessonForAnalysis.studentId));
              
              try {
                // Create notification for tutor
                const notification = await Notification.create({
                  userId: lessonForAnalysis.tutorId._id,
                  type: 'feedback_required',
                  title: randomMsg.title,
                  message: randomMsg.message,
                  data: {
                    lessonId: lessonForAnalysis._id,
                    studentName: formatDisplayName(lessonForAnalysis.studentId),
                    studentAuth0Id: lessonForAnalysis.studentId.auth0Id
                  }
                });
                console.log('✅ Notification created:', notification._id);
              } catch (notifError) {
                console.error('❌ Error creating notification:', notifError);
              }
              
              try {
                // Emit WebSocket event
                if (req.io) {
                  const socketRoom = `user:${lessonForAnalysis.tutorId.auth0Id}`;
                  console.log('📡 Emitting feedback_required to room:', socketRoom);
                  req.io.to(socketRoom).emit('feedback_required', {
                    lessonId: lessonForAnalysis._id.toString(),
                    studentName: formatDisplayName(lessonForAnalysis.studentId),
                    title: randomMsg.title,
                    message: randomMsg.message
                  });
                  console.log('✅ WebSocket event emitted');
                } else {
                  console.warn('⚠️ req.io is not available - WebSocket event not sent');
                }
              } catch (socketError) {
                console.error('❌ Error emitting WebSocket event:', socketError);
              }
              
              console.log(`📢 Feedback request process completed for tutor: ${lessonForAnalysis.tutorId.email}`);
            }
            
            return; // Skip AI analysis generation
          }
          */
          
          // AI is always enabled - generate analysis for all completed lessons
          console.log(`🤖 Generating AI analysis for lesson ${lessonForAnalysis._id}`);
          
          const actualDuration = lessonForAnalysis.actualDurationMinutes || lessonForAnalysis.duration;
          const scheduledDuration = lessonForAnalysis.duration;
          const endedEarly = actualDuration < scheduledDuration;
          
          // Check if analysis already exists
          const existingAnalysis = await LessonAnalysis.findOne({ lessonId: lessonForAnalysis._id });
          
          if (!existingAnalysis) {
            // Create a new LessonAnalysis document
            await LessonAnalysis.create({
              lessonId: lessonForAnalysis._id,
              tutorId: lessonForAnalysis.tutorId._id,
              studentId: lessonForAnalysis.studentId._id,
              summary: endedEarly 
                ? `This ${actualDuration}-minute lesson ended earlier than the scheduled ${scheduledDuration} minutes. The student made good initial progress on the topic.`
                : `This ${actualDuration}-minute lesson covered the planned material effectively. The student demonstrated engagement throughout the session.`,
              strengths: [
                'Good pronunciation and accent work',
                'Active participation in conversation',
                'Quick to grasp new vocabulary'
              ],
              areasForImprovement: [
                'Grammar structures in complex sentences',
                'Verb conjugation in past tense',
                'Building confidence in spontaneous speaking'
              ],
              recommendations: [
                'Practice daily with language exchange partners',
                'Focus on past tense exercises before next lesson',
                'Watch movies/shows in target language with subtitles'
              ],
              status: 'completed',
              generatedAt: new Date()
            });
            
            console.log(`✅ Created LessonAnalysis document for lesson ${lessonForAnalysis._id}`);
          } else {
            console.log(`ℹ️ LessonAnalysis already exists for lesson ${lessonForAnalysis._id}`);
          }

          // Create notification for the student that analysis is ready
          await Notification.create({
            userId: lessonForAnalysis.studentId._id,
            type: 'lesson_analysis_ready',
            title: 'Lesson Analysis Ready',
            message: `Your analysis for the lesson with <strong>${formatDisplayName(lessonForAnalysis.tutorId)}</strong> is now available.`,
            relatedUserPicture: lessonForAnalysis.tutorId.picture || null,
            data: {
              lessonId: lessonForAnalysis._id,
              tutorName: formatDisplayName(lessonForAnalysis.tutorId),
              lessonDate: lessonForAnalysis.startTime
            }
          });

          console.log(`✅ AI analysis auto-generated for lesson ${lessonForAnalysis._id}`);
        } catch (error) {
          console.error(`❌ Error auto-generating AI analysis:`, error);
        }
      }, 3000); // Generate analysis 3 seconds after call ends
    }

    res.json({ 
      success: true,
      message: 'Call ended and lesson completed',
      actualCallEndTime: lesson.actualCallEndTime,
      actualDurationMinutes: lesson.actualDurationMinutes,
      actualPrice: lesson.actualPrice,
      status: lesson.status
    });
  } catch (error) {
    console.error('Error recording call end:', error);
    res.status(500).json({ success: false, message: 'Failed to record call end' });
  }
});

// GET /api/lessons/:id/billing - Get billing summary for a lesson
router.get('/:id/billing', verifyToken, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    res.json({
      success: true,
      billing: {
        estimatedPrice: lesson.price,
        actualPrice: lesson.actualPrice,
        estimatedDuration: lesson.duration,
        actualDuration: lesson.actualDurationMinutes,
        status: lesson.billingStatus,
        callStartTime: lesson.actualCallStartTime,
        callEndTime: lesson.actualCallEndTime,
        isOfficeHours: lesson.isOfficeHours
      }
    });
  } catch (error) {
    console.error('Error getting billing summary:', error);
    res.status(500).json({ success: false, message: 'Failed to get billing summary' });
  }
});

// POST /api/lessons/:id/generate-analysis - Generate AI analysis for a completed lesson
router.post('/:id/generate-analysis', verifyToken, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id)
      .populate('tutorId', 'name firstName lastName')
      .populate('studentId', 'name firstName lastName');
    
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    // Verify the requester is either the tutor or student
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user || (!user._id.equals(lesson.tutorId._id) && !user._id.equals(lesson.studentId._id))) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Check if lesson is completed or ended early
    if (lesson.status !== 'completed' && !lesson.actualCallEndTime) {
      return res.status(400).json({ 
        success: false, 
        message: 'Analysis can only be generated for completed lessons' 
      });
    }

    // Mark analysis as generating
    lesson.aiAnalysis = lesson.aiAnalysis || {};
    lesson.aiAnalysis.status = 'generating';
    await lesson.save();

    // In a real implementation, this would call an AI service (OpenAI, etc.)
    // For now, we'll generate a mock analysis based on lesson duration
    setTimeout(async () => {
      try {
        const actualDuration = lesson.actualDurationMinutes || lesson.duration;
        const scheduledDuration = lesson.duration;
        const endedEarly = actualDuration < scheduledDuration;
        
        // Generate mock analysis
        const analysis = {
          summary: endedEarly 
            ? `This ${actualDuration}-minute lesson ended earlier than the scheduled ${scheduledDuration} minutes. The student made good initial progress on the topic.`
            : `This ${actualDuration}-minute lesson covered the planned material effectively. The student demonstrated engagement throughout the session.`,
          strengths: [
            'Good pronunciation and accent work',
            'Active participation in conversation',
            'Quick to grasp new vocabulary'
          ],
          areasForImprovement: [
            'Grammar structures in complex sentences',
            'Verb conjugation in past tense',
            'Building confidence in spontaneous speaking'
          ],
          recommendations: [
            'Practice daily with language exchange partners',
            'Focus on past tense exercises before next lesson',
            'Watch movies/shows in target language with subtitles'
          ],
          generatedAt: new Date(),
          status: 'completed'
        };

        // Update lesson with analysis
        const updatedLesson = await Lesson.findById(lesson._id);
        updatedLesson.aiAnalysis = analysis;
        await updatedLesson.save();

        // Create notification for the student that analysis is ready
        await Notification.create({
          userId: lesson.studentId._id,
          type: 'lesson_analysis_ready',
          title: 'Lesson Analysis Ready',
          message: `Your analysis for the lesson with <strong>${formatDisplayName(lesson.tutorId)}</strong> is now available.`,
          relatedUserPicture: lesson.tutorId.picture || null,
          data: {
            lessonId: lesson._id,
            tutorName: formatDisplayName(lesson.tutorId),
            lessonDate: lesson.startTime
          }
        });

        console.log(`✅ AI analysis generated for lesson ${lesson._id}`);
      } catch (error) {
        console.error(`❌ Error generating AI analysis for lesson ${lesson._id}:`, error);
        // Mark as failed
        const failedLesson = await Lesson.findById(lesson._id);
        if (failedLesson) {
          failedLesson.aiAnalysis = failedLesson.aiAnalysis || {};
          failedLesson.aiAnalysis.status = 'failed';
          await failedLesson.save();
        }
      }
    }, 2000); // Simulate AI processing delay (2 seconds)

    res.json({ 
      success: true, 
      message: 'Analysis generation started',
      status: 'generating'
    });
  } catch (error) {
    console.error('Error starting analysis generation:', error);
    res.status(500).json({ success: false, message: 'Failed to start analysis generation' });
  }
});

// POST /api/lessons/:id/tutor-note - Add tutor's supplementary note to lesson
router.post('/:id/tutor-note', verifyToken, async (req, res) => {
  try {
    const { text, quickImpression, homework } = req.body;
    const lessonId = req.params.id;
    
    // Verify user is a tutor
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user || user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can add notes' });
    }
    
    // Verify lesson exists and user is the tutor
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }
    
    if (!lesson.tutorId.equals(user._id)) {
      return res.status(403).json({ success: false, message: 'Only the lesson tutor can add notes' });
    }
    
    const LessonAnalysis = require('../models/LessonAnalysis');
    
    // Find or create LessonAnalysis document
    let analysis = await LessonAnalysis.findOne({ lessonId });
    
    if (!analysis) {
      // Create placeholder analysis (AI will fill it in later)
      analysis = new LessonAnalysis({
        lessonId,
        studentId: lesson.studentId,
        tutorId: lesson.tutorId,
        language: lesson.language || lesson.subject,
        lessonDate: lesson.startTime,
        status: 'pending', // Use 'pending' instead of 'generating'
        transcriptId: null,   // Will be added when transcription completes
        // Add required fields with placeholder values
        studentSummary: 'Analysis pending - tutor note added',
        overallAssessment: {
          proficiencyLevel: 'B1', // Placeholder
          confidence: 0,
          summary: 'Tutor feedback provided. AI analysis will be generated when lesson transcription is available.'
        },
        strengths: [],
        areasForImprovement: [],
        grammarAnalysis: {
          mistakeTypes: [],
          suggestions: [],
          accuracyScore: 0
        },
        vocabularyAnalysis: {
          uniqueWordCount: 0,
          vocabularyRange: 'moderate',
          suggestedWords: [],
          advancedWordsUsed: []
        },
        fluencyAnalysis: {
          speakingSpeed: 'moderate',
          pauseFrequency: 'moderate',
          fillerWords: {
            count: 0,
            examples: []
          },
          overallFluencyScore: 0
        },
        topicsDiscussed: [],
        conversationQuality: 'intermediate',
        recommendedFocus: [],
        suggestedExercises: [],
        homeworkSuggestions: [],
        tutorNote: {
          text,
          quickImpression,
          homework,
          addedAt: new Date(),
          addedBy: user._id
        }
      });
    } else {
      // Update existing analysis with tutor note
      analysis.tutorNote = {
        text,
        quickImpression,
        homework,
        addedAt: new Date(),
        addedBy: user._id
      };
    }
    
    await analysis.save();
    
    console.log(`✅ Tutor note saved for lesson ${lessonId}`);
    
    // Populate lesson with student details for notification
    // Re-fetch lesson with populated studentId to ensure we have all fields
    const populatedLesson = await Lesson.findById(lessonId)
      .populate('studentId', 'name firstName lastName picture onboardingData');
    
    if (!populatedLesson || !populatedLesson.studentId) {
      console.warn('⚠️ Could not populate lesson or student for notification');
      return res.json({ success: true, message: 'Note saved successfully (notification skipped)' });
    }
    
    // Format student name as "FirstName L."
    const student = populatedLesson.studentId;
    const studentFirstName = student.firstName || student.onboardingData?.firstName || (student.name ? student.name.split(' ')[0] : 'Student');
    const studentLastName = student.lastName || student.onboardingData?.lastName || (student.name && student.name.split(' ').length > 1 ? student.name.split(' ')[1] : null);
    const studentDisplayName = studentLastName 
      ? `${studentFirstName} ${studentLastName.charAt(0)}.` 
      : studentFirstName;
    
    // Format lesson date and time
    const lessonDate = new Date(populatedLesson.startTime);
    const dateStr = lessonDate.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
    const timeStr = lessonDate.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    
    // Choose dynamic emoji based on quickImpression
    let emoji = '📝';
    if (quickImpression) {
      if (quickImpression.includes('Excellent')) emoji = '⭐';
      else if (quickImpression.includes('Good Progress')) emoji = '✅';
      else if (quickImpression.includes('Needs Focus')) emoji = '🎯';
      else if (quickImpression.includes('Keep Practicing')) emoji = '💪';
    }
    
    // Create notification for the tutor
    try {
      const notification = await Notification.create({
        userId: user._id,
        type: 'tutor_note_saved',
        title: `${emoji} Feedback Saved`,
        message: `You provided feedback for ${studentDisplayName} for your ${dateStr} at ${timeStr} lesson.`,
        relatedUserPicture: student.picture || null,
        data: {
          lessonId: populatedLesson._id,
          studentName: studentDisplayName,
          lessonDate: populatedLesson.startTime,
          quickImpression,
          hasText: !!text,
          hasHomework: !!homework
        },
        read: false
      });
      
      console.log(`📬 Notification created for tutor: ${notification._id}`);
      
      // Send real-time notification via WebSocket
      if (req.io) {
        const tutorSocketRoom = `user:${user.auth0Id}`;
        req.io.to(tutorSocketRoom).emit('new_notification', notification);
        console.log(`📤 Sent tutor note notification to ${tutorSocketRoom}`);
      }
    } catch (notifError) {
      console.error('⚠️ Error creating tutor notification (non-critical):', notifError);
      // Don't fail the request if notification fails
    }
    
    res.json({ success: true, message: 'Note saved successfully' });
    
  } catch (error) {
    console.error('❌ Error saving tutor note:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ success: false, message: 'Failed to save note' });
  }
});

// GET /api/lessons/:id/analysis - Get AI analysis for a lesson
router.get('/:id/analysis', verifyToken, async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id)
      .populate('tutorId', 'name firstName lastName picture')
      .populate('studentId', 'name firstName lastName picture');
    
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    // Verify the requester is either the tutor or student
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user || (!user._id.equals(lesson.tutorId._id) && !user._id.equals(lesson.studentId._id))) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (!lesson.aiAnalysis || !lesson.aiAnalysis.status) {
      return res.status(404).json({ 
        success: false, 
        message: 'No analysis available for this lesson',
        canGenerate: lesson.status === 'completed' || !!lesson.actualCallEndTime
      });
    }

    res.json({ 
      success: true, 
      analysis: lesson.aiAnalysis,
      lesson: {
        _id: lesson._id,
        subject: lesson.subject,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
        duration: lesson.duration,
        actualDurationMinutes: lesson.actualDurationMinutes,
        tutor: {
          _id: lesson.tutorId._id,
          name: formatDisplayName(lesson.tutorId),
          picture: lesson.tutorId.picture
        },
        student: {
          _id: lesson.studentId._id,
          name: formatDisplayName(lesson.studentId),
          picture: lesson.studentId.picture
        }
      }
    });
  } catch (error) {
    console.error('Error getting analysis:', error);
    res.status(500).json({ success: false, message: 'Failed to get analysis' });
  }
});

// Cancel a lesson (DELETE /:id/cancel)
router.delete('/:id/cancel', verifyToken, async (req, res) => {
  try {
    const { id: lessonId } = req.params;
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    
    const lesson = await Lesson.findById(lessonId)
      .populate('tutorId', 'name email firstName lastName auth0Id')
      .populate('studentId', 'name email firstName lastName auth0Id');
      
    if (!lesson) return res.status(404).json({ success: false, message: 'Lesson not found' });
    
    // Verify user is either the tutor or student
    const isTutor = lesson.tutorId._id.toString() === user._id.toString();
    const isStudent = lesson.studentId._id.toString() === user._id.toString();
    
    if (!isTutor && !isStudent) {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this lesson' });
    }
    
    // Check if lesson is already cancelled
    if (lesson.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Lesson is already cancelled' });
    }
    
    // Check if lesson has already started or ended
    const now = new Date();
    const lessonStart = new Date(lesson.startTime);
    if (lessonStart <= now) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot cancel a lesson that has already started or ended' 
      });
    }
    
    // Cancel the lesson
    lesson.status = 'cancelled';
    lesson.cancelledAt = new Date();
    lesson.cancelReason = isTutor ? 'tutor_cancelled' : 'student_cancelled';
    lesson.cancelledBy = user._id;
    await lesson.save();
    
    // Release reserved funds if payment was made with wallet
    if (lesson.paymentId) {
      try {
        const payment = await Payment.findById(lesson.paymentId);
        if (payment) {
          // If wallet payment or hybrid payment with wallet component
          const walletPayments = await Payment.find({ 
            lessonId: lesson._id, 
            paymentMethod: 'wallet',
            status: 'authorized' 
          });
          
          for (const walletPayment of walletPayments) {
            await walletService.releaseReservedFunds({
              userId: lesson.studentId._id,
              lessonId: lesson._id,
              amount: walletPayment.amount,
              reason: lesson.cancelReason
            });
            
            // Update payment status to cancelled
            walletPayment.status = 'cancelled';
            await walletPayment.save();
            
            console.log(`💰 Released $${walletPayment.amount} reserved wallet funds for cancelled lesson ${lesson._id}`);
          }
          
          // If there was a card payment, we should refund it via Stripe
          const cardPayments = await Payment.find({
            lessonId: lesson._id,
            paymentMethod: { $in: ['card', 'saved-card', 'apple_pay', 'google_pay'] },
            status: 'authorized'
          });
          
          for (const cardPayment of cardPayments) {
            if (cardPayment.stripePaymentIntentId) {
              try {
                const refund = await stripeService.createRefund({
                  paymentIntentId: cardPayment.stripePaymentIntentId,
                  reason: 'requested_by_customer'
                });
                
                cardPayment.status = 'refunded';
                cardPayment.refundAmount = cardPayment.amount;
                cardPayment.refundedAt = new Date();
                cardPayment.refundReason = lesson.cancelReason;
                cardPayment.stripeRefundId = refund.id;
                await cardPayment.save();
                
                console.log(`💳 Refunded $${cardPayment.amount} to card for cancelled lesson ${lesson._id}`);
              } catch (refundError) {
                console.error(`❌ Failed to refund card payment:`, refundError);
                // Continue with cancellation even if refund fails
              }
            }
          }
        }
      } catch (paymentError) {
        console.error(`❌ Error processing refunds for cancelled lesson:`, paymentError);
        // Continue with cancellation even if refund processing fails
      }
    }
    
    const cancelledByName = user.firstName && user.lastName 
      ? `${user.firstName} ${user.lastName.charAt(0)}.`
      : user.name;
    
    console.log(`🔴 [LESSON-CANCEL] Lesson ${lesson._id} cancelled by ${isTutor ? 'tutor' : 'student'} ${cancelledByName}`);
    
    // NOTE: Lessons don't create availability blocks like classes do.
    // The tutor-availability-viewer component queries lessons directly from the database
    // and filters out cancelled lessons, so the time slot will automatically become available.
    
    // Format date/time for notifications
    const startTime = new Date(lesson.startTime);
    const formattedDate = startTime.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    const formattedTime = startTime.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit' 
    });
    
    // Notify the other participant
    const otherParticipant = isTutor ? lesson.studentId : lesson.tutorId;
    const otherParticipantName = otherParticipant.firstName && otherParticipant.lastName
      ? `${otherParticipant.firstName} ${otherParticipant.lastName.charAt(0)}.`
      : otherParticipant.name;
    
    try {
      const notification = await Notification.create({
        userId: otherParticipant._id,
        type: 'lesson_cancelled',
        title: 'Lesson Cancelled',
        message: `<strong>${cancelledByName}</strong> cancelled the <strong>${lesson.subject || 'lesson'}</strong> scheduled for <strong>${formattedDate} at ${formattedTime}</strong>.`,
        relatedUserPicture: user.picture || null,
        relatedItemId: lesson._id,
        relatedItemType: 'Lesson',
        metadata: {
          lessonSubject: lesson.subject,
          cancelledByName: cancelledByName,
          startTime: lesson.startTime,
          cancelReason: lesson.cancelReason,
          cancelledByType: isTutor ? 'tutor' : 'student'
        }
      });
      console.log(`📧 [LESSON-CANCEL] Notified ${isTutor ? 'student' : 'tutor'} ${otherParticipantName} about cancellation`);
      
      // Emit WebSocket event to the other participant if connected
      if (req.io && req.connectedUsers && otherParticipant.auth0Id) {
        const otherSocketId = req.connectedUsers.get(otherParticipant.auth0Id);
        if (otherSocketId) {
          req.io.to(otherSocketId).emit('new_notification', {
            type: 'lesson_cancelled',
            title: 'Lesson Cancelled',
            message: `${cancelledByName} cancelled the ${lesson.subject || 'lesson'} scheduled for ${formattedDate} at ${formattedTime}.`,
            data: {
              lessonId: lesson._id.toString(),
              lessonSubject: lesson.subject,
              cancelledByName: cancelledByName,
              startTime: lesson.startTime,
              cancelledByType: isTutor ? 'tutor' : 'student'
            }
          });
          console.log(`🔔 [LESSON-CANCEL] WebSocket notification sent to ${isTutor ? 'student' : 'tutor'} ${otherParticipantName}`);
        }
      }
    } catch (error) {
      console.error(`❌ [LESSON-CANCEL] Error notifying ${isTutor ? 'student' : 'tutor'}:`, error);
    }
    
    res.json({
      success: true,
      message: 'Lesson cancelled successfully',
      lesson: lesson
    });
  } catch (error) {
    console.error('❌ [LESSON-CANCEL] Error cancelling lesson:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/lessons/:id/propose-reschedule - Propose a new time for a lesson
router.post('/:id/propose-reschedule', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { proposedStartTime, proposedEndTime } = req.body;
    const proposerId = req.user.sub;

    console.log('📅 Reschedule proposal for lesson:', id, 'by', proposerId);

    const lesson = await Lesson.findById(id).populate('tutorId studentId');
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    // Verify proposer is part of the lesson
    const proposerUser = await User.findOne({ auth0Id: proposerId });
    if (!proposerUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isProposerTutor = lesson.tutorId._id.toString() === proposerUser._id.toString();
    const isProposerStudent = lesson.studentId._id.toString() === proposerUser._id.toString();

    if (!isProposerTutor && !isProposerStudent) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Update lesson with reschedule proposal
    lesson.rescheduleProposal = {
      proposedBy: proposerUser._id,
      proposedStartTime: new Date(proposedStartTime),
      proposedEndTime: new Date(proposedEndTime),
      proposedAt: new Date(),
      status: 'pending'
    };
    lesson.status = 'pending_reschedule';
    await lesson.save();

    // Determine the other participant
    const otherParticipant = isProposerTutor ? lesson.studentId : lesson.tutorId;
    const proposerName = `${proposerUser.firstName || proposerUser.name} ${proposerUser.lastName || ''}`.trim();

    // Create notification for the other participant
    const notification = new Notification({
      userId: otherParticipant._id,
      type: 'reschedule_proposed',
      title: 'New Time Proposed',
      message: `<strong>${proposerName}</strong> proposed a new time for your lesson for <strong>${new Date(proposedStartTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${new Date(proposedStartTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</strong>`,
      relatedLesson: lesson._id,
      relatedUser: proposerUser._id,
      relatedUserPicture: proposerUser.picture
    });
    await notification.save();

    // Send WebSocket notification
    if (req.io && req.connectedUsers) {
      // Notify the recipient (other participant)
      const otherSocketId = req.connectedUsers.get(otherParticipant.auth0Id);
      if (otherSocketId) {
        console.log('📤 [RESCHEDULE-PROPOSE] Emitting to recipient:', otherSocketId, 'for user:', otherParticipant.auth0Id);
        
        req.io.to(otherSocketId).emit('new_notification', {
          notification: {
            ...notification.toObject(),
            user: otherParticipant
          }
        });

        // Emit reschedule_proposed event for real-time UI update
        req.io.to(otherSocketId).emit('reschedule_proposed', {
          lessonId: lesson._id,
          proposal: lesson.rescheduleProposal,
          proposerName
        });
        
        console.log(`🔔 [RESCHEDULE-PROPOSE] WebSocket notification sent to ${isProposerTutor ? 'student' : 'tutor'}`);
      } else {
        console.warn('⚠️ [RESCHEDULE-PROPOSE] No socket connection found for recipient:', otherParticipant.auth0Id);
      }

      // Also notify the proposer to update their UI (lesson status changed)
      const proposerSocketId = req.connectedUsers.get(proposerId);
      if (proposerSocketId) {
        console.log('📤 [RESCHEDULE-PROPOSE] Emitting to proposer:', proposerSocketId, 'for user:', proposerId);
        
        // Emit lesson_updated event for the proposer to refresh their lesson list
        req.io.to(proposerSocketId).emit('lesson_updated', {
          lessonId: lesson._id,
          status: 'pending_reschedule',
          rescheduleProposal: lesson.rescheduleProposal
        });
        
        console.log(`🔔 [RESCHEDULE-PROPOSE] Lesson update sent to proposer`);
      } else {
        console.warn('⚠️ [RESCHEDULE-PROPOSE] No socket connection found for proposer:', proposerId);
      }
    } else {
      console.warn('⚠️ [RESCHEDULE-PROPOSE] req.io or req.connectedUsers not available');
    }

    res.json({ 
      success: true, 
      lesson: lesson,
      message: 'Reschedule proposal sent'
    });

  } catch (error) {
    console.error('Error proposing reschedule:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/lessons/:id/respond-reschedule - Accept or reject reschedule proposal
router.post('/:id/respond-reschedule', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { accept } = req.body;
    const responderId = req.user.sub;

    console.log('📅 Reschedule response for lesson:', id, 'accept:', accept);

    const lesson = await Lesson.findById(id).populate('tutorId studentId rescheduleProposal.proposedBy');
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    if (!lesson.rescheduleProposal || lesson.rescheduleProposal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'No pending reschedule proposal' });
    }

    // Verify responder is the other participant
    const responderUser = await User.findOne({ auth0Id: responderId });
    if (!responderUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const proposer = lesson.rescheduleProposal.proposedBy;
    if (proposer._id.toString() === responderUser._id.toString()) {
      return res.status(403).json({ success: false, message: 'Cannot respond to your own proposal' });
    }

    const responderName = `${responderUser.firstName || responderUser.name} ${responderUser.lastName || ''}`.trim();

    if (accept) {
      // Accept: Update lesson times
      lesson.startTime = lesson.rescheduleProposal.proposedStartTime;
      lesson.endTime = lesson.rescheduleProposal.proposedEndTime;
      lesson.rescheduleProposal.status = 'accepted';
      lesson.status = 'scheduled';
      await lesson.save();

      // Notify proposer
      const notification = new Notification({
        userId: proposer._id,
        type: 'reschedule_accepted',
        title: 'Reschedule Accepted',
        message: `<strong>${responderName}</strong> accepted your proposed time for <strong>${new Date(lesson.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${new Date(lesson.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</strong>`,
        relatedLesson: lesson._id,
        relatedUser: responderUser._id,
        relatedUserPicture: responderUser.picture
      });
      await notification.save();

      // Send WebSocket notification to BOTH proposer AND responder
      if (req.io && req.connectedUsers) {
        // Send to proposer
        const proposerSocketId = req.connectedUsers.get(proposer.auth0Id);
        if (proposerSocketId) {
          req.io.to(proposerSocketId).emit('new_notification', {
            notification: {
              ...notification.toObject(),
              user: proposer
            }
          });

          req.io.to(proposerSocketId).emit('reschedule_accepted', {
            lessonId: lesson._id,
            newStartTime: lesson.startTime,
            newEndTime: lesson.endTime
          });
          
          console.log('🔔 [RESCHEDULE-ACCEPT] WebSocket notification sent to proposer');
        }
        
        // ALSO send to responder (the person who accepted)
        const responderSocketId = req.connectedUsers.get(responderUser.auth0Id);
        if (responderSocketId) {
          req.io.to(responderSocketId).emit('reschedule_accepted', {
            lessonId: lesson._id,
            newStartTime: lesson.startTime,
            newEndTime: lesson.endTime
          });
          
          console.log('🔔 [RESCHEDULE-ACCEPT] WebSocket notification sent to responder (acceptor)');
        }
      }

      res.json({ 
        success: true, 
        lesson: lesson,
        message: 'Reschedule accepted'
      });

    } else {
      // Reject: Clear proposal
      lesson.rescheduleProposal.status = 'rejected';
      lesson.status = 'scheduled'; // Back to scheduled
      await lesson.save();

      // Notify proposer
      const notification = new Notification({
        userId: proposer._id,
        type: 'reschedule_rejected',
        title: 'Reschedule Declined',
        message: `<strong>${responderName}</strong> declined your proposed time change`,
        relatedLesson: lesson._id,
        relatedUser: responderUser._id,
        relatedUserPicture: responderUser.picture
      });
      await notification.save();

      // Send WebSocket notification to BOTH proposer AND responder
      if (req.io && req.connectedUsers) {
        // Send to proposer
        const proposerSocketId = req.connectedUsers.get(proposer.auth0Id);
        if (proposerSocketId) {
          req.io.to(proposerSocketId).emit('new_notification', {
            notification: {
              ...notification.toObject(),
              user: proposer
            }
          });

          req.io.to(proposerSocketId).emit('reschedule_rejected', {
            lessonId: lesson._id
          });
          
          console.log('🔔 [RESCHEDULE-REJECT] WebSocket notification sent to proposer');
        }
        
        // ALSO send to responder (the person who rejected)
        const responderSocketId = req.connectedUsers.get(responderUser.auth0Id);
        if (responderSocketId) {
          req.io.to(responderSocketId).emit('reschedule_rejected', {
            lessonId: lesson._id
          });
          
          console.log('🔔 [RESCHEDULE-REJECT] WebSocket notification sent to responder (rejecter)');
        }
      }

      res.json({ 
        success: true, 
        lesson: lesson,
        message: 'Reschedule rejected'
      });
    }

  } catch (error) {
    console.error('Error responding to reschedule:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;