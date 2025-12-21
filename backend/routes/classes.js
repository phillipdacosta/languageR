const express = require('express');
const router = express.Router();
const ClassModel = require('../models/Class');
const User = require('../models/User');
const Lesson = require('../models/Lesson');
const Notification = require('../models/Notification');
const { verifyToken, uploadImage, uploadImageToGCS } = require('../middleware/videoUploadMiddleware');
const { RtcRole, RtcTokenBuilder } = require('agora-token');

const AGORA_APP_ID = process.env.AGORA_APP_ID;
const AGORA_APP_CERT = process.env.AGORA_APP_CERT;

// POST /api/classes/upload-thumbnail - Upload class thumbnail image
router.post('/upload-thumbnail', verifyToken, uploadImage.single('thumbnail'), uploadImageToGCS);

// Time windows for joining classes (same as lessons)
const JOIN_EARLY_MINUTES = 15; // Can join 15 minutes early
const END_GRACE_MINUTES = 5;   // Can join up to 5 minutes after end
const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour token validity

function addMinutes(date, minutes) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function nextOccurrence(start, i, type) {
  const d = new Date(start);
  if (type === 'daily') d.setDate(d.getDate() + i);
  else if (type === 'weekly') d.setDate(d.getDate() + 7 * i);
  else if (type === 'monthly') d.setMonth(d.getMonth() + i);
  return d;
}

// Format user name as "FirstName L." (e.g., "Phillip D.")
function formatDisplayName(user) {
  if (!user) return 'User';
  
  const firstName = user.firstName;
  const lastName = user.lastName;
  const fullName = user.name;
  
  if (firstName && lastName) {
    const lastInitial = lastName.charAt(0).toUpperCase();
    return `${firstName} ${lastInitial}.`;
  }
  
  if (fullName) {
    const parts = fullName.trim().split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) {
      const first = parts[0];
      const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
      return `${first} ${lastInitial}.`;
    }
    return fullName;
  }
  
  return 'User';
}

// POST /api/classes - create class (supports simple recurrence by count)
router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, description, capacity, level, duration, isPublic, price, useSuggestedPricing, suggestedPrice, startTime, endTime, recurrence, invitedStudentIds, thumbnail } = req.body;

    if (!name || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: 'name, startTime and endTime are required' });
    }
    
    // Require thumbnail for public classes
    if (isPublic && !thumbnail) {
      return res.status(400).json({ success: false, message: 'Thumbnail is required for public classes' });
    }

    const tutor = await User.findOne({ auth0Id: req.user.sub });
    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });
    if (tutor.userType !== 'tutor') return res.status(403).json({ success: false, message: 'Only tutors can create classes' });

    const recType = recurrence?.type || 'none';
    const count = Math.max(1, Math.min(100, parseInt(recurrence?.count || 1)));

    // Prepare invited students array
    const invitedStudents = [];
    if (Array.isArray(invitedStudentIds) && invitedStudentIds.length > 0) {
      for (const studentId of invitedStudentIds) {
        invitedStudents.push({
          studentId,
          status: 'pending',
          invitedAt: new Date()
        });
      }
    }

    const created = [];
    for (let i = 0; i < count; i++) {
      const s = i === 0 || recType === 'none' ? new Date(startTime) : nextOccurrence(startTime, i, recType);
      const durationMin = Math.max(15, Math.round((new Date(endTime) - new Date(startTime)) / 60000));
      const e = addMinutes(s, durationMin);

      const cls = new ClassModel({
        tutorId: tutor._id,
        name,
        description: description || '',
        capacity: capacity || 1,
        level: level || 'any',
        duration: duration || 60,
        isPublic: !!isPublic,
        thumbnail: thumbnail || null,
        price: price || 0,
        useSuggestedPricing: useSuggestedPricing !== undefined ? useSuggestedPricing : true,
        suggestedPrice: suggestedPrice || 0,
        startTime: s,
        endTime: e,
        recurrence: { type: recType, count },
        invitedStudents: invitedStudents
      });
      await cls.save();
      created.push(cls);
    }

    // Update tutor availability by appending blocks that represent the class time as unavailable
    const availability = Array.isArray(tutor.availability) ? tutor.availability.slice() : [];
    created.forEach(c => {
      const d = new Date(c.startTime);
      const day = d.getDay();
      const pad = (n) => n.toString().padStart(2, '0');
      const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const de = new Date(c.endTime);
      const timeStrEnd = `${pad(de.getHours())}:${pad(de.getMinutes())}`;
      availability.push({
        id: `${c._id}`,
        absoluteStart: c.startTime,
        absoluteEnd: c.endTime,
        day,
        startTime: timeStr,
        endTime: timeStrEnd,
        type: 'class',
        title: `Class: ${c.name}`,
        color: '#8b5cf6'
      });
    });
    tutor.availability = availability;
    await tutor.save();

    // Send notifications to invited students
    if (invitedStudents.length > 0) {
      const tutorName = tutor.name || 'Your tutor';
      
      for (const invitedStudent of invitedStudents) {
        try {
          const student = await User.findById(invitedStudent.studentId);
          if (!student) continue;

          // Format date and time for each class occurrence
          for (const cls of created) {
            const classDate = new Date(cls.startTime);
            const formattedDate = classDate.toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            });
            const formattedTime = classDate.toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit', 
              hour12: true 
            });
            const durationMin = Math.round((new Date(cls.endTime) - new Date(cls.startTime)) / 60000);

            // Create database notification
            const notification = await Notification.create({
              userId: student._id,
              type: 'class_invitation',
              title: 'Group Class Invitation',
              message: `<strong>${tutorName}</strong> invited you to a <strong>${cls.name}</strong> group class set for <strong>${formattedDate} at ${formattedTime}</strong>`,
              relatedUserPicture: tutor.picture || null,
              data: {
                classId: cls._id,
                tutorId: tutor._id,
                tutorName: tutorName,
                tutorPicture: tutor.picture || null,
                className: cls.name,
                classDescription: cls.description || '',
                date: formattedDate,
                time: formattedTime,
                startTime: cls.startTime,
                endTime: cls.endTime,
                duration: durationMin,
                capacity: cls.capacity,
                price: cls.price,
                currentStudents: 0 // Will be updated when students accept
              }
            });
            console.log('✅ Database notification created for student:', {
              studentEmail: student.email,
              notificationId: notification._id,
              notificationType: notification.type,
              className: cls.name
            });

            // Send WebSocket notification if student is connected (using same pattern as lessons)
            if (req.io && req.connectedUsers) {
              const studentSocketId = req.connectedUsers.get(student.auth0Id);
              
              console.log('📧 Sending class invitation notification:', {
                studentAuth0Id: student.auth0Id,
                studentEmail: student.email,
                socketId: studentSocketId,
                hasSocket: !!studentSocketId,
                className: cls.name,
                totalConnectedUsers: req.connectedUsers.size
              });
              
              if (studentSocketId) {
                const wsNotification = {
                  type: 'class_invitation',
                  title: 'Group Class Invitation',
                  message: `${tutorName} invited you to a ${cls.name} group class set for ${formattedDate} at ${formattedTime}`,
                  classId: cls._id.toString(),
                  tutorId: tutor._id.toString(),
                  tutorName: tutorName,
                  tutorPicture: tutor.picture || null,
                  className: cls.name,
                  classDescription: cls.description || '',
                  date: formattedDate,
                  time: formattedTime,
                  startTime: cls.startTime,
                  endTime: cls.endTime,
                  duration: durationMin,
                  capacity: cls.capacity,
                  price: cls.price,
                  currentStudents: cls.confirmedStudents.length
                };
                req.io.to(studentSocketId).emit('new_notification', wsNotification);
                console.log('✅ WebSocket notification sent to student:', {
                  studentEmail: student.email,
                  socketId: studentSocketId,
                  notificationType: wsNotification.type
                });
              } else {
                console.log('⚠️ Student not connected to WebSocket:', {
                  studentAuth0Id: student.auth0Id,
                  studentEmail: student.email,
                  connectedUsers: Array.from(req.connectedUsers.keys())
                });
              }
            } else {
              console.error('❌ Socket.io or connectedUsers not available on request');
            }
          }
        } catch (error) {
          console.error(`Error sending notification to student ${invitedStudent.studentId}:`, error);
        }
      }
    }

    res.json({ success: true, classes: created });
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/classes/:classId/accept - Accept a class invitation
router.post('/:classId/accept', verifyToken, async (req, res) => {
  try {
    const { classId } = req.params;
    
    const student = await User.findOne({ auth0Id: req.user.sub });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const cls = await ClassModel.findById(classId).populate('tutorId', 'name email picture');
    if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });

    // Find the student's invitation
    const invitation = cls.invitedStudents.find(inv => inv.studentId.toString() === student._id.toString());
    
    if (!invitation) {
      return res.status(404).json({ success: false, message: 'You were not invited to this class' });
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Invitation already responded to' });
    }

    // Check if class is full
    if (cls.confirmedStudents.length >= cls.capacity) {
      return res.status(400).json({ success: false, message: 'Class is already full' });
    }

    // Check for scheduling conflicts with other classes
    const conflictingClasses = await ClassModel.find({
      confirmedStudents: student._id,
      _id: { $ne: cls._id }, // Exclude current class
      $or: [
        // Check if another class starts during this class
        { 
          startTime: { $gte: cls.startTime, $lt: cls.endTime }
        },
        // Check if another class ends during this class
        { 
          endTime: { $gt: cls.startTime, $lte: cls.endTime }
        },
        // Check if another class completely overlaps this class
        { 
          startTime: { $lte: cls.startTime },
          endTime: { $gte: cls.endTime }
        }
      ]
    }).select('name startTime endTime');

    if (conflictingClasses.length > 0) {
      const conflictClass = conflictingClasses[0];
      const conflictDate = new Date(conflictClass.startTime).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      return res.status(409).json({ 
        success: false, 
        message: `You already have a class "${conflictClass.name}" scheduled at ${conflictDate}. Please decline that class first or choose a different time.`,
        conflict: {
          type: 'class',
          name: conflictClass.name,
          startTime: conflictClass.startTime,
          endTime: conflictClass.endTime
        }
      });
    }

    // Check for scheduling conflicts with lessons
    const conflictingLessons = await Lesson.find({
      studentId: student._id,
      status: { $nin: ['cancelled', 'completed'] }, // Only check active/scheduled lessons
      $or: [
        // Check if a lesson starts during this class
        { 
          startTime: { $gte: cls.startTime, $lt: cls.endTime }
        },
        // Check if a lesson ends during this class
        { 
          endTime: { $gt: cls.startTime, $lte: cls.endTime }
        },
        // Check if a lesson completely overlaps this class
        { 
          startTime: { $lte: cls.startTime },
          endTime: { $gte: cls.endTime }
        }
      ]
    }).populate('tutorId', 'name firstName lastName').select('subject startTime endTime tutorId');

    if (conflictingLessons.length > 0) {
      const conflictLesson = conflictingLessons[0];
      const conflictDate = new Date(conflictLesson.startTime).toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      
      // Format tutor name as "FirstName LastInitial."
      let tutorName = 'a tutor';
      if (conflictLesson.tutorId) {
        if (conflictLesson.tutorId.firstName && conflictLesson.tutorId.lastName) {
          const lastInitial = conflictLesson.tutorId.lastName.charAt(0).toUpperCase();
          tutorName = `${conflictLesson.tutorId.firstName} ${lastInitial}.`;
        } else if (conflictLesson.tutorId.name) {
          // Fallback to parsing name field
          const names = conflictLesson.tutorId.name.trim().split(' ');
          if (names.length >= 2) {
            const lastName = names[names.length - 1];
            const lastInitial = lastName.charAt(0).toUpperCase();
            tutorName = `${names[0]} ${lastInitial}.`;
          } else {
            tutorName = conflictLesson.tutorId.name;
          }
        }
      }
      
      return res.status(409).json({ 
        success: false, 
        message: `You already have a lesson with ${tutorName} scheduled at ${conflictDate}. Please reschedule that lesson first.`,
        conflict: {
          type: 'lesson',
          subject: conflictLesson.subject,
          tutorName: tutorName,
          startTime: conflictLesson.startTime,
          endTime: conflictLesson.endTime
        }
      });
    }

    // Update invitation status
    invitation.status = 'accepted';
    invitation.respondedAt = new Date();
    
    // Add to confirmed students
    cls.confirmedStudents.push(student._id);
    
    await cls.save();

    // Notify tutor that student accepted
    if (cls.tutorId) {
      const formattedDate = new Date(cls.startTime).toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      const formattedTime = new Date(cls.startTime).toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      });

      const studentDisplayName = formatDisplayName(student);
      
      await Notification.create({
        userId: cls.tutorId._id,
        type: 'class_accepted',
        title: 'Class Invitation Accepted',
        message: `<strong>${studentDisplayName}</strong> accepted your invitation to <strong>${cls.name}</strong> on <strong>${formattedDate}</strong>`,
        relatedUserPicture: student.picture || null,
        data: {
          classId: cls._id,
          studentId: student._id,
          studentName: studentDisplayName,
          className: cls.name,
          date: formattedDate,
          time: formattedTime
        }
      });

      // Send WebSocket notification (using same pattern as lessons)
      if (req.io && req.connectedUsers) {
        const tutorSocketId = req.connectedUsers.get(cls.tutorId.auth0Id);
        if (tutorSocketId) {
          req.io.to(tutorSocketId).emit('new_notification', {
            type: 'class_accepted',
            message: `<strong>${studentDisplayName}</strong> accepted your invitation to <strong>${cls.name}</strong> on <strong>${formattedDate}</strong>`
          });
          console.log('✅ WebSocket notification sent to tutor about class acceptance');
        }
      }
    }

    res.json({ success: true, class: cls });
  } catch (error) {
    console.error('Error accepting class invitation:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/classes/:classId/decline - Decline a class invitation
router.post('/:classId/decline', verifyToken, async (req, res) => {
  try {
    const { classId } = req.params;
    
    const student = await User.findOne({ auth0Id: req.user.sub });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const cls = await ClassModel.findById(classId).populate('tutorId', 'name email picture');
    if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });

    // Find the student's invitation
    const invitation = cls.invitedStudents.find(inv => inv.studentId.toString() === student._id.toString());
    
    if (!invitation) {
      return res.status(404).json({ success: false, message: 'You were not invited to this class' });
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Invitation already responded to' });
    }

    // Update invitation status
    invitation.status = 'declined';
    invitation.respondedAt = new Date();
    
    await cls.save();

    res.json({ success: true, message: 'Invitation declined' });
  } catch (error) {
    console.error('Error declining class invitation:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/classes/invitations/pending - Get pending class invitations for current user
router.get('/invitations/pending', verifyToken, async (req, res) => {
  try {
    const student = await User.findOne({ auth0Id: req.user.sub });
    if (!student) return res.status(404).json({ success: false, message: 'User not found' });

    // Find all classes where this student has a pending invitation
    // Show classes that haven't ended yet (including cancelled ones to show the status)
    const classes = await ClassModel.find({
      'invitedStudents': {
        $elemMatch: {
          studentId: student._id,
          status: 'pending'
        }
      },
      endTime: { $gte: new Date() } // Show classes that haven't ended yet
    })
    .populate('tutorId', 'name email picture')
    .sort({ startTime: 1 });

    res.json({ success: true, classes });
  } catch (error) {
    console.error('Error fetching pending invitations:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/classes/student/accepted - Get accepted classes for current student
router.get('/student/accepted', verifyToken, async (req, res) => {
  try {
    const student = await User.findOne({ auth0Id: req.user.sub });
    if (!student) return res.status(404).json({ success: false, message: 'User not found' });

    // Find all classes where this student is in confirmedStudents (meaning they accepted the invitation)
    const classes = await ClassModel.find({
      confirmedStudents: student._id,
      endTime: { $gte: new Date() } // Show classes that haven't ended yet
    })
    .populate('tutorId', 'name email picture firstName lastName')
    .populate('confirmedStudents', 'name email picture firstName lastName') // Populate all confirmed students
    .sort({ startTime: 1 });

    res.json({ success: true, classes });
  } catch (error) {
    console.error('Error fetching accepted classes:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/classes/:classId/invite - Invite students to a class
router.post('/:classId/invite', verifyToken, async (req, res) => {
  try {
    const { classId } = req.params;
    const { studentIds } = req.body;
    
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Student IDs array is required' });
    }
    
    const tutor = await User.findOne({ auth0Id: req.user.sub });
    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });
    
    const cls = await ClassModel.findById(classId);
    if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });
    
    // Verify tutor owns this class
    if (cls.tutorId.toString() !== tutor._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    
    let newInvitationsCount = 0;
    const tutorName = tutor.name || 'Your tutor';
    
    // Add new invitations
    for (const studentId of studentIds) {
      // Check if student already invited
      const existingInvitation = cls.invitedStudents.find(
        inv => inv.studentId.toString() === studentId
      );
      
      if (!existingInvitation) {
        // Add new invitation
        cls.invitedStudents.push({
          studentId,
          status: 'pending',
          invitedAt: new Date()
        });
        newInvitationsCount++;
        
        // Send notification to student
        try {
          const student = await User.findById(studentId);
          if (student) {
            const startDate = new Date(cls.startTime);
            const endDate = new Date(cls.endTime);
            
            const formattedDate = startDate.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            });
            
            const formattedStartTime = startDate.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            });
            
            const formattedEndTime = endDate.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            });
            
            await Notification.create({
              userId: student._id,
              type: 'class_invitation',
              title: `Class Invitation: ${cls.name}`,
              message: `<strong>${tutorName}</strong> invited you to join <strong>"${cls.name}"</strong> on <strong>${formattedDate}</strong> from <strong>${formattedStartTime} to ${formattedEndTime}</strong>.`,
              relatedUserPicture: tutor.picture || null,
              relatedId: cls._id,
              relatedModel: 'Class',
              metadata: {
                classId: cls._id,
                className: cls.name,
                tutorId: tutor._id,
                tutorName: tutorName,
                startTime: cls.startTime,
                endTime: cls.endTime
              }
            });
            
            console.log(`📧 Sent class invitation notification to ${student.name || student.email}`);
          }
        } catch (notifError) {
          console.error(`Failed to send notification to student ${studentId}:`, notifError);
          // Continue even if notification fails
        }
      }
    }
    
    await cls.save();
    
    res.json({
      success: true,
      message: `Successfully invited ${newInvitationsCount} student${newInvitationsCount !== 1 ? 's' : ''}`,
      newInvitationsCount,
      class: cls
    });
  } catch (error) {
    console.error('Error inviting students to class:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/classes/:classId - Get a single class by ID
router.get('/:classId', verifyToken, async (req, res) => {
  try {
    const { classId } = req.params;
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    
    const cls = await ClassModel.findById(classId)
      .populate('tutorId', 'name email picture firstName lastName')
      .populate('confirmedStudents', 'name email picture firstName lastName')
      .populate('invitedStudents.studentId', 'name email picture firstName lastName');
    
    if (!cls) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    // For public classes, allow anyone to view
    // For private classes, verify user has access (tutor, confirmed student, or invited student)
    const isTutor = cls.tutorId._id.toString() === user._id.toString();
    const isConfirmedStudent = cls.confirmedStudents.some(s => s._id.toString() === user._id.toString());
    const isInvitedStudent = cls.invitedStudents.some(inv => inv.studentId._id.toString() === user._id.toString());
    
    if (!cls.isPublic && !isTutor && !isConfirmedStudent && !isInvitedStudent) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this class' });
    }
    
    // Format the response to include stats and user status
    const classObj = cls.toObject();
    
    // Calculate available spots
    classObj.availableSpots = classObj.capacity - (classObj.confirmedStudents?.length || 0);
    classObj.isFull = classObj.availableSpots <= 0;
    
    // Check if current user is already enrolled
    classObj.isEnrolled = classObj.confirmedStudents?.some(
      s => s._id.toString() === user._id.toString()
    ) || false;
    
    // Check if current user has been invited
    const invitation = classObj.invitedStudents?.find(
      inv => inv.studentId._id.toString() === user._id.toString()
    );
    
    classObj.hasInvitation = !!invitation;
    classObj.invitationStatus = invitation?.status || null;
    
    res.json({ success: true, class: classObj });
  } catch (error) {
    console.error('Error fetching class:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/classes/tutor/:tutorId - Get all classes for a tutor with confirmed student details
router.get('/tutor/:tutorId', verifyToken, async (req, res) => {
  try {
    const { tutorId } = req.params;
    
    console.log(`📚 [GET /api/classes/tutor/:tutorId] Fetching classes for tutor: ${tutorId}`);
    
    const tutor = await User.findById(tutorId);
    if (!tutor) {
      console.log(`❌ [GET /api/classes/tutor/:tutorId] Tutor not found: ${tutorId}`);
      return res.status(404).json({ success: false, message: 'Tutor not found' });
    }

    console.log(`✅ [GET /api/classes/tutor/:tutorId] Tutor found: ${tutor.name} (${tutor._id})`);

    // Find all classes for this tutor
    // Show classes that haven't ended yet (not just future classes)
    const classes = await ClassModel.find({
      tutorId: tutor._id,
      endTime: { $gte: new Date() } // Show classes that haven't ended yet
    })
    .populate('tutorId', 'name email picture')
    .populate('confirmedStudents', 'name email picture firstName lastName') // Populate confirmed students with details
    .populate('invitedStudents.studentId', 'name email picture firstName lastName') // Populate invited students
    .sort({ startTime: 1 });

    console.log(`📊 [GET /api/classes/tutor/:tutorId] Found ${classes.length} classes:`);
    classes.forEach((cls, index) => {
      console.log(`  ${index + 1}. ${cls.name} - ${cls.startTime} to ${cls.endTime}`);
    });

    // Format the response to include attendance info
    const formattedClasses = classes.map(cls => {
      const classObj = cls.toObject();
      
      // Get confirmed students details
      classObj.attendees = classObj.confirmedStudents || [];
      
      // Get invitation stats
      const invitationStats = {
        total: classObj.invitedStudents?.length || 0,
        accepted: classObj.invitedStudents?.filter(inv => inv.status === 'accepted').length || 0,
        pending: classObj.invitedStudents?.filter(inv => inv.status === 'pending').length || 0,
        declined: classObj.invitedStudents?.filter(inv => inv.status === 'declined').length || 0
      };
      
      classObj.invitationStats = invitationStats;
      
      return classObj;
    });

    res.json({ success: true, classes: formattedClasses });
  } catch (error) {
    console.error('Error fetching tutor classes:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/classes/:classId/join - Join a class (for video call)
router.post('/:classId/join', verifyToken, async (req, res) => {
  console.log('🚀🚀🚀 CLASS JOIN ENDPOINT CALLED 🚀🚀🚀');
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
    const userIdStr = userId.toString();

    console.log('📅 User attempting to join class:', { userId, classId: req.params.classId });

    const cls = await ClassModel.findById(req.params.classId)
      .populate('tutorId', 'name email picture firstName lastName auth0Id')
      .populate('confirmedStudents', 'name email picture firstName lastName auth0Id');

    if (!cls) {
      console.log('❌ Class not found:', req.params.classId);
      return res.status(404).json({ 
        success: false, 
        message: 'Class not available' 
      });
    }

    // Verify user is part of this class (either tutor or confirmed student)
    const isTutor = cls.tutorId._id.toString() === userIdStr;
    const isConfirmedStudent = cls.confirmedStudents.some(student => 
      student._id.toString() === userIdStr
    );

    console.log('📅 Authorization check:', {
      userIdStr,
      tutorId: cls.tutorId._id.toString(),
      confirmedStudentIds: cls.confirmedStudents.map(s => s._id.toString()),
      isTutor,
      isConfirmedStudent
    });

    if (!isTutor && !isConfirmedStudent) {
      console.log('❌ User not authorized to join class');
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to join this class. You must be invited and accept the invitation first.' 
      });
    }

    const now = new Date();
    const start = new Date(cls.startTime);
    const end = new Date(cls.endTime);

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
        message: 'Class window has ended' 
      });
    }

    // Determine Agora role - all participants can publish
    const agoraRole = RtcRole.PUBLISHER;

    // Generate channel name for this class
    const channelName = `class_${cls._id}`;
    
    // Use a stable string user account for Web SDK tokens
    const uidAccount = userId.toString();
    const tokenExpiry = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;

    console.log('📅 Token generation parameters:', {
      appId: AGORA_APP_ID,
      channelName,
      uidAccount,
      agoraRole,
      tokenExpiry,
      currentTime: Math.floor(Date.now() / 1000)
    });

    // Generate Agora token
    let token;
    
    // For development, prefer temp token; for production, use certificate
    // DISABLED: Temp token limits concurrent users to 2. For classes, we need unlimited users.
    // Force use of certificate-based tokens for all class joins.
    const TEMP_TOKEN = null; // Explicitly disabled for classes
    const isDevelopment = process.env.NODE_ENV === 'development';
    const hasValidTempToken = false; // Always false for classes to support unlimited users
    
    console.log('🔍 DEBUG Token generation:', {
      isDevelopment,
      hasTempToken: !!TEMP_TOKEN,
      hasValidTempToken,
      tempTokenLength: TEMP_TOKEN ? TEMP_TOKEN.length : 0,
      channelName,
      NODE_ENV: process.env.NODE_ENV
    });
    
    if (isDevelopment && hasValidTempToken) {
      console.log('⚠️ WARNING: Using TEMP TOKEN - This limits concurrent users to 2!');
      console.log('🔧 DEV: Using temporary token from environment for channel:', channelName);
      console.log('❌ This will cause issues with 3+ users in classes!');
      // For dev with temp token, use fixed channel name
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
      console.log('✅ Generated certificate-based token for class channel:', channelName);
      console.log('📝 Token generation method: CERTIFICATE (unlimited users supported)');
    } else {
      console.warn('⚠️ No valid token method available; proceeding with null token');
      token = null;
    }

    console.log('📅 Generated Agora token for class:', { 
      classId: cls._id, 
      channelName, 
      userId, 
      role: isTutor ? 'tutor' : 'student',
      token: token ? `${token.substring(0, 20)}...` : 'null',
      appId: AGORA_APP_ID,
      certExists: !!AGORA_APP_CERT && AGORA_APP_CERT !== 'your-agora-app-certificate-here'
    });

    // Emit WebSocket event for class presence to all other participants
    console.log('📡 Attempting to emit class presence event...');
    console.log('📡 req.io exists:', !!req.io);
    console.log('📡 req.connectedUsers exists:', !!req.connectedUsers);
    
    if (req.io && req.connectedUsers) {
      // Get all other participants (tutor + all confirmed students except current user)
      const allParticipants = [cls.tutorId, ...cls.confirmedStudents];
      const otherParticipants = allParticipants.filter(p => 
        p._id.toString() !== userIdStr
      );

      console.log('📡 Total participants:', allParticipants.length);
      console.log('📡 Other participants to notify:', otherParticipants.length);

      for (const participant of otherParticipants) {
        const participantAuth0Id = participant.auth0Id;
        if (!participantAuth0Id) {
          console.log('⚠️ Participant missing auth0Id:', participant._id);
          continue;
        }

        const participantSocketId = req.connectedUsers.get(participantAuth0Id);
        
        if (participantSocketId) {
          const presenceEvent = {
            classId: cls._id.toString(),
            participantId: userId.toString(),
            participantRole: isTutor ? 'tutor' : 'student',
            participantName: formatDisplayName(user),
            participantPicture: user.picture,
            joinedAt: now.toISOString()
          };
          console.log('📡 Emitting class_participant_joined event to:', participantAuth0Id);
          
          req.io.to(participantSocketId).emit('class_participant_joined', presenceEvent);
          
          console.log('✅ Successfully emitted class_participant_joined to:', participantAuth0Id);
        } else {
          console.log('⚠️ Participant not connected:', participantAuth0Id);
        }
      }
    } else {
      console.log('⚠️ req.io or req.connectedUsers is missing');
    }

    res.json({
      success: true,
      agora: {
        appId: AGORA_APP_ID,
        channelName: isDevelopment && TEMP_TOKEN ? 'languageRoom' : channelName,
        token,
        uid: uidAccount
      },
      class: {
        id: cls._id,
        name: cls.name,
        description: cls.description,
        startTime: cls.startTime,
        endTime: cls.endTime,
        tutor: cls.tutorId,
        students: cls.confirmedStudents,
        capacity: cls.capacity
      },
      userRole: isTutor ? 'tutor' : 'student',
      serverTime: now.toISOString()
    });
  } catch (error) {
    console.error('❌ Error joining class:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to join class',
      error: error.message 
    });
  }
});

// POST /api/classes/:classId/leave - Mark participant leaving the class
router.post('/:classId/leave', verifyToken, async (req, res) => {
  console.log('🚪🚪🚪 CLASS LEAVE ENDPOINT CALLED 🚪🚪🚪');
  console.log('🚪 Request params:', req.params);
  console.log('🚪 Request user:', req.user);
  
  try {
    const user = await User.findOne({ auth0Id: req.user.sub }).select('name email picture auth0Id');
    if (!user) {
      console.log('❌ User not found for auth0Id:', req.user.sub);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const userId = user._id;
    const userIdStr = userId.toString();
    
    const cls = await ClassModel.findById(req.params.classId)
      .populate('tutorId', 'name email picture firstName lastName auth0Id')
      .populate('confirmedStudents', 'name email picture firstName lastName auth0Id');
    
    if (!cls) {
      console.log('❌ Class not found:', req.params.classId);
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    
    // Determine if user is tutor or confirmed student
    const isTutor = cls.tutorId._id.toString() === userIdStr;
    const isConfirmedStudent = cls.confirmedStudents.some(student => 
      student._id.toString() === userIdStr
    );
    
    if (!isTutor && !isConfirmedStudent) {
      return res.status(403).json({ success: false, message: 'User is not a participant in this class' });
    }
    
    console.log('🚪 User leaving class:', { userId, classId: cls._id, role: isTutor ? 'tutor' : 'student' });

    // Emit WebSocket event for class presence left to all other participants
    console.log('🚪 Attempting to emit class presence left event...');
    console.log('🚪 req.io exists:', !!req.io);
    console.log('🚪 req.connectedUsers exists:', !!req.connectedUsers);
    
    if (req.io && req.connectedUsers) {
      // Get all other participants (tutor + all confirmed students except current user)
      const allParticipants = [cls.tutorId, ...cls.confirmedStudents];
      const otherParticipants = allParticipants.filter(p => 
        p._id.toString() !== userIdStr
      );

      console.log('🚪 Total participants:', allParticipants.length);
      console.log('🚪 Other participants to notify:', otherParticipants.length);

      for (const participant of otherParticipants) {
        const participantAuth0Id = participant.auth0Id;
        if (!participantAuth0Id) {
          console.log('⚠️ Participant missing auth0Id:', participant._id);
          continue;
        }

        const participantSocketId = req.connectedUsers.get(participantAuth0Id);
        
        if (participantSocketId) {
          const leaveEvent = {
            classId: cls._id.toString(),
            participantId: userId.toString(),
            participantRole: isTutor ? 'tutor' : 'student',
            participantName: formatDisplayName(user),
            leftAt: new Date().toISOString()
          };
          console.log('🚪 Emitting class_participant_left event to:', participantAuth0Id);
          
          req.io.to(participantSocketId).emit('class_participant_left', leaveEvent);
          
          console.log('✅ Successfully emitted class_participant_left to:', participantAuth0Id);
        } else {
          console.log('⚠️ Participant not connected:', participantAuth0Id);
        }
      }
    } else {
      console.log('⚠️ req.io or req.connectedUsers is missing');
    }

    res.json({ success: true, message: 'Left class recorded' });
  } catch (error) {
    console.error('❌ Error leaving class:', error);
    res.status(500).json({ success: false, message: 'Failed to record leave' });
  }
});

// DELETE /api/classes/:classId/student/:studentId - Remove a student from a class
router.delete('/:classId/student/:studentId', verifyToken, async (req, res) => {
  try {
    const { classId, studentId } = req.params;
    
    const tutor = await User.findOne({ auth0Id: req.user.sub });
    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });
    
    const cls = await ClassModel.findById(classId);
    if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });
    
    // Verify tutor owns this class
    if (cls.tutorId.toString() !== tutor._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    
    // Find the student
    const student = await User.findById(studentId);
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    
    // Find the invitation
    const invitationIndex = cls.invitedStudents.findIndex(
      inv => inv.studentId.toString() === studentId
    );
    
    if (invitationIndex === -1) {
      return res.status(404).json({ success: false, message: 'Student is not invited to this class' });
    }
    
    const invitation = cls.invitedStudents[invitationIndex];
    const wasAccepted = invitation.status === 'accepted';
    
    // Remove from invitedStudents array
    cls.invitedStudents.splice(invitationIndex, 1);
    
    // If they had accepted, also remove from confirmedStudents
    if (wasAccepted) {
      cls.confirmedStudents = cls.confirmedStudents.filter(
        id => id.toString() !== studentId
      );
    }
    
    await cls.save();
    
    // Send notification to student
    try {
      const tutorDisplayName = formatDisplayName(tutor);
      const startDate = new Date(cls.startTime);
      
      const formattedDate = startDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      const formattedStartTime = startDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      
      const notificationMessage = wasAccepted 
        ? `<strong>${tutorDisplayName}</strong> removed you from <strong>"${cls.name}"</strong> on <strong>${formattedDate} at ${formattedStartTime}</strong>.`
        : `<strong>${tutorDisplayName}</strong> cancelled your invitation to <strong>"${cls.name}"</strong> on <strong>${formattedDate} at ${formattedStartTime}</strong>.`;
      
      await Notification.create({
        userId: student._id,
        type: wasAccepted ? 'class_removed' : 'invitation_cancelled',
        title: wasAccepted ? 'Removed from Class' : 'Class Invitation Cancelled',
        message: notificationMessage,
        relatedUserPicture: tutor.picture || null,
        relatedId: cls._id,
        relatedModel: 'Class',
        metadata: {
          classId: cls._id,
          className: cls.name,
          tutorId: tutor._id,
          tutorName: tutorDisplayName,
          startTime: cls.startTime,
          wasAccepted
        }
      });
      
      console.log(`📧 Sent removal notification to ${student.name || student.email}`);
    } catch (notifError) {
      console.error(`Failed to send notification to student ${studentId}:`, notifError);
      // Continue even if notification fails
    }
    
    const actionText = wasAccepted ? 'removed from' : 'uninvited from';
    res.json({
      success: true,
      message: `${student.name || student.email} has been ${actionText} the class`,
      class: cls
    });
  } catch (error) {
    console.error('Error removing student from class:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/classes/public/all - Get all public classes for explore page
router.get('/public/all', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Find all public classes that haven't ended yet
    const classes = await ClassModel.find({
      isPublic: true,
      endTime: { $gte: new Date() } // Only show classes that haven't ended
    })
    .populate('tutorId', 'name email picture firstName lastName')
    .populate('confirmedStudents', 'name email picture firstName lastName')
    .sort({ startTime: 1 });

    // Format the response to include stats
    const formattedClasses = classes.map(cls => {
      const classObj = cls.toObject();
      
      // Calculate available spots
      classObj.availableSpots = classObj.capacity - (classObj.confirmedStudents?.length || 0);
      classObj.isFull = classObj.availableSpots <= 0;
      
      // Check if current user is already enrolled (accepted invitation)
      classObj.isEnrolled = classObj.confirmedStudents?.some(
        s => s._id.toString() === user._id.toString()
      ) || false;
      
      // Check if current user has been invited (any status)
      const invitation = classObj.invitedStudents?.find(
        inv => inv.studentId.toString() === user._id.toString()
      );
      
      classObj.hasInvitation = !!invitation;
      classObj.invitationStatus = invitation?.status || null; // 'pending', 'accepted', 'declined', or null
      
      return classObj;
    });

    res.json({ success: true, classes: formattedClasses });
  } catch (error) {
    console.error('Error fetching public classes:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Update class data (e.g., whiteboard room UUID)
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const classObj = await ClassModel.findById(req.params.id);
    
    if (!classObj) {
      return res.status(404).json({ 
        success: false, 
        message: 'Class not found' 
      });
    }

    // Only tutor or confirmed students can update class
    const isTutor = classObj.tutorId.toString() === user._id.toString();
    const isStudent = classObj.confirmedStudents.some(
      s => s.toString() === user._id.toString()
    );
    
    if (!isTutor && !isStudent) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to update this class' 
      });
    }

    // Update allowed fields
    const allowedFields = ['whiteboardRoomUUID', 'whiteboardCreatedAt', 'startTime', 'endTime'];
    const updates = {};
    
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    // Apply updates
    Object.assign(classObj, updates);
    await classObj.save();

    console.log(`✅ Class ${classObj._id} updated by ${user.email}`);
    
    res.json({ 
      success: true, 
      class: classObj 
    });
  } catch (error) {
    console.error('❌ Error updating class:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update class' 
    });
  }
});

// DELETE /api/classes/:classId - Cancel a class (tutor only)
router.delete('/:classId', verifyToken, async (req, res) => {
  try {
    const { classId } = req.params;
    
    const tutor = await User.findOne({ auth0Id: req.user.sub });
    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });
    
    const cls = await ClassModel.findById(classId)
      .populate('tutorId', 'name email firstName lastName auth0Id')
      .populate('confirmedStudents', 'name email firstName lastName auth0Id');
      
    if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });
    
    // Verify tutor owns this class
    if (cls.tutorId._id.toString() !== tutor._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    
    // Check if class is already cancelled
    if (cls.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Class is already cancelled' });
    }
    
    // Cancel the class
    cls.status = 'cancelled';
    cls.cancelledAt = new Date();
    cls.cancelReason = 'tutor_cancelled';
    await cls.save();
    
    console.log(`🔴 [CLASS-CANCEL] Class "${cls.name}" (${cls._id}) cancelled by tutor ${tutor.name}`);
    
    // Remove the availability block from tutor's calendar
    const classIdStr = cls._id.toString();
    const initialAvailabilityLength = tutor.availability.length;
    
    tutor.availability = tutor.availability.filter(
      slot => !(slot.id === classIdStr && slot.type === 'class')
    );
    
    const removedCount = initialAvailabilityLength - tutor.availability.length;
    
    if (removedCount > 0) {
      await tutor.save();
      console.log(`✅ [CLASS-CANCEL] Removed ${removedCount} availability block(s) for class "${cls.name}" from tutor ${tutor.name}'s calendar`);
    } else {
      console.log(`⚠️ [CLASS-CANCEL] No availability block found for class "${cls.name}" in tutor ${tutor.name}'s calendar`);
    }
    
    // Format date/time for notifications
    const startTime = new Date(cls.startTime);
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
    
    const tutorName = tutor.firstName && tutor.lastName 
      ? `${tutor.firstName} ${tutor.lastName.charAt(0)}.`
      : tutor.name;
    
    // Notify all confirmed students
    for (const student of cls.confirmedStudents) {
      try {
        const notification = await Notification.create({
          userId: student._id,
          type: 'class_cancelled',
          title: 'Class Cancelled',
          message: `<strong>${tutorName}</strong> cancelled the class <strong>"${cls.name}"</strong> scheduled for <strong>${formattedDate} at ${formattedTime}</strong>. You have not been charged.`,
          relatedUserPicture: tutor.picture || null,
          relatedItemId: cls._id,
          relatedItemType: 'Class',
          metadata: {
            className: cls.name,
            tutorName: tutorName,
            startTime: cls.startTime,
            cancelReason: 'tutor_cancelled'
          }
        });
        console.log(`📧 [CLASS-CANCEL] Notified student ${student.name} about cancellation`);
        
        // Emit WebSocket event to student if connected
        if (req.io && req.connectedUsers && student.auth0Id) {
          const studentSocketId = req.connectedUsers.get(student.auth0Id);
          if (studentSocketId) {
            req.io.to(studentSocketId).emit('new_notification', {
              type: 'class_cancelled',
              title: 'Class Cancelled',
              message: `${tutorName} cancelled the class "${cls.name}" scheduled for ${formattedDate} at ${formattedTime}. You have not been charged.`,
              data: {
                classId: cls._id.toString(),
                className: cls.name,
                tutorName: tutorName,
                startTime: cls.startTime
              }
            });
            console.log(`🔔 [CLASS-CANCEL] WebSocket notification sent to student ${student.name}`);
          }
        }
      } catch (error) {
        console.error(`❌ [CLASS-CANCEL] Error notifying student ${student.name}:`, error);
      }
    }
    
    // Notify invited students who haven't responded yet
    const invitedButNotConfirmed = cls.invitedStudents.filter(
      inv => inv.status === 'pending' && !cls.confirmedStudents.some(cs => cs._id.toString() === inv.studentId.toString())
    );
    
    for (const invitation of invitedButNotConfirmed) {
      try {
        const student = await User.findById(invitation.studentId);
        if (student) {
          const notification = await Notification.create({
            userId: student._id,
            type: 'class_invitation_cancelled',
            title: 'Class Invitation Cancelled',
            message: `<strong>${tutorName}</strong> cancelled the class <strong>"${cls.name}"</strong> scheduled for <strong>${formattedDate} at ${formattedTime}</strong>.`,
            relatedUserPicture: tutor.picture || null,
            relatedItemId: cls._id,
            relatedItemType: 'Class',
            metadata: {
              className: cls.name,
              tutorName: tutorName,
              startTime: cls.startTime,
              cancelReason: 'tutor_cancelled'
            }
          });
          console.log(`📧 [CLASS-CANCEL] Notified invited student ${student.name} about cancellation`);
          
          // Emit WebSocket event to invited student if connected
          if (req.io && req.connectedUsers && student.auth0Id) {
            const studentSocketId = req.connectedUsers.get(student.auth0Id);
            if (studentSocketId) {
              req.io.to(studentSocketId).emit('new_notification', {
                type: 'class_invitation_cancelled',
                title: 'Class Invitation Cancelled',
                message: `${tutorName} cancelled the class "${cls.name}" scheduled for ${formattedDate} at ${formattedTime}.`,
                data: {
                  classId: cls._id.toString(),
                  className: cls.name,
                  tutorName: tutorName,
                  startTime: cls.startTime
                }
              });
              console.log(`🔔 [CLASS-CANCEL] WebSocket notification sent to invited student ${student.name}`);
            }
          }
        }
      } catch (error) {
        console.error(`❌ [CLASS-CANCEL] Error notifying invited student:`, error);
      }
    }
    
    res.json({
      success: true,
      message: 'Class cancelled successfully',
      class: cls
    });
  } catch (error) {
    console.error('❌ [CLASS-CANCEL] Error cancelling class:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// TEST ENDPOINT - Manually trigger auto-cancel for a specific class (DEV ONLY)
router.post('/:classId/test-auto-cancel', verifyToken, async (req, res) => {
  try {
    const { classId } = req.params;
    
    const tutor = await User.findOne({ auth0Id: req.user.sub });
    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });
    
    const cls = await ClassModel.findById(classId)
      .populate('tutorId', 'name email firstName lastName auth0Id')
      .populate('confirmedStudents', 'name email firstName lastName auth0Id');
      
    if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });
    
    // Verify tutor owns this class
    if (cls.tutorId._id.toString() !== tutor._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    
    console.log('🧪 [TEST] Manually triggering auto-cancel for class:', cls.name);
    
    // Cancel the class (simulate auto-cancel)
    cls.status = 'cancelled';
    cls.cancelledAt = new Date();
    cls.cancelReason = 'minimum_not_met';
    await cls.save();
    
    console.log('🧪 [TEST] Class status updated to cancelled');
    
    // Remove availability block
    const classIdStr = cls._id.toString();
    const initialAvailabilityLength = tutor.availability.length;
    
    tutor.availability = tutor.availability.filter(
      slot => !(slot.id === classIdStr && slot.type === 'class')
    );
    
    const removedCount = initialAvailabilityLength - tutor.availability.length;
    
    if (removedCount > 0) {
      tutor.markModified('availability');
      await tutor.save();
      console.log(`🧪 [TEST] Removed ${removedCount} availability block(s)`);
    }
    
    // Send notifications (same as auto-cancel)
    const { autoCancelClasses } = require('../jobs/autoCancelClasses');
    const { createCancellationNotifications } = autoCancelClasses;
    
    // Format date/time for notifications
    const startTime = new Date(cls.startTime);
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
    
    const tutorName = tutor.firstName && tutor.lastName 
      ? `${tutor.firstName} ${tutor.lastName.charAt(0)}.`
      : tutor.name;
    
    // Notify tutor
    const notification = await Notification.create({
      userId: tutor._id,
      type: 'class_auto_cancelled',
      title: 'Class Auto-Cancelled (TEST)',
      message: `Your class <strong>"${cls.name}"</strong> scheduled for <strong>${formattedDate} at ${formattedTime}</strong> has been automatically cancelled (TEST MODE).`,
      relatedItemId: cls._id,
      relatedItemType: 'Class',
      metadata: {
        className: cls.name,
        startTime: cls.startTime,
        minStudents: cls.minStudents,
        confirmedCount: cls.confirmedStudents.length,
        cancelReason: 'minimum_not_met',
        isTest: true
      }
    });
    
    console.log('🧪 [TEST] Notification created for tutor');
    
    // Emit WebSocket event to tutor if connected
    if (req.io && req.connectedUsers && cls.tutorId.auth0Id) {
      const tutorSocketId = req.connectedUsers.get(cls.tutorId.auth0Id);
      if (tutorSocketId) {
        req.io.to(tutorSocketId).emit('new_notification', {
          type: 'class_auto_cancelled',
          title: 'Class Auto-Cancelled (TEST)',
          message: `Your class "${cls.name}" scheduled for ${formattedDate} at ${formattedTime} has been automatically cancelled (TEST MODE).`,
          data: {
            classId: cls._id.toString(),
            className: cls.name,
            startTime: cls.startTime,
            minStudents: cls.minStudents,
            confirmedCount: cls.confirmedStudents.length,
            isTest: true
          }
        });
        console.log('🧪 [TEST] WebSocket notification sent to tutor');
      } else {
        console.log('🧪 [TEST] Tutor not connected to WebSocket');
      }
    }
    
    // Notify all confirmed students
    for (const student of cls.confirmedStudents) {
      try {
        const studentNotification = await Notification.create({
          userId: student._id,
          type: 'class_auto_cancelled',
          title: 'Class Cancelled (TEST)',
          message: `The class <strong>"${cls.name}"</strong> with <strong>${tutorName}</strong> scheduled for <strong>${formattedDate} at ${formattedTime}</strong> has been cancelled (TEST MODE).`,
          relatedItemId: cls._id,
          relatedItemType: 'Class',
          metadata: {
            className: cls.name,
            tutorName: tutorName,
            startTime: cls.startTime,
            cancelReason: 'minimum_not_met',
            isTest: true
          }
        });
        
        // Emit WebSocket event to student if connected
        if (req.io && req.connectedUsers && student.auth0Id) {
          const studentSocketId = req.connectedUsers.get(student.auth0Id);
          if (studentSocketId) {
            req.io.to(studentSocketId).emit('new_notification', {
              type: 'class_auto_cancelled',
              title: 'Class Cancelled (TEST)',
              message: `The class "${cls.name}" with ${tutorName} scheduled for ${formattedDate} at ${formattedTime} has been cancelled (TEST MODE).`,
              data: {
                classId: cls._id.toString(),
                className: cls.name,
                tutorName: tutorName,
                startTime: cls.startTime,
                isTest: true
              }
            });
            console.log(`🧪 [TEST] WebSocket notification sent to student ${student.name}`);
          }
        }
      } catch (error) {
        console.error(`🧪 [TEST] Error notifying student ${student.name}:`, error);
      }
    }
    
    res.json({
      success: true,
      message: `Class "${cls.name}" cancelled successfully (TEST MODE)`,
      class: cls
    });
  } catch (error) {
    console.error('🧪 [TEST] Error in manual auto-cancel:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;


