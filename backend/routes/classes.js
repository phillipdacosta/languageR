const express = require('express');
const router = express.Router();
const ClassModel = require('../models/Class');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { verifyToken } = require('../middleware/videoUploadMiddleware');

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
    const { name, description, capacity, isPublic, price, startTime, endTime, recurrence, invitedStudentIds } = req.body;

    if (!name || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: 'name, startTime and endTime are required' });
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
        isPublic: !!isPublic,
        price: price || 0,
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
              message: `${tutorName} invited you to a ${cls.name} group class set for ${formattedDate} at ${formattedTime}`,
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
        message: `${studentDisplayName} accepted your invitation to ${cls.name} on ${formattedDate} at ${formattedTime}`,
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
            message: `${studentDisplayName} accepted your invitation to ${cls.name}`
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
    const classes = await ClassModel.find({
      'invitedStudents': {
        $elemMatch: {
          studentId: student._id,
          status: 'pending'
        }
      },
      startTime: { $gte: new Date() } // Only future classes
    })
    .populate('tutorId', 'name email picture')
    .sort({ startTime: 1 });

    res.json({ success: true, classes });
  } catch (error) {
    console.error('Error fetching pending invitations:', error);
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
              message: `${tutorName} invited you to join "${cls.name}" on ${formattedDate} from ${formattedStartTime} to ${formattedEndTime}.`,
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

// GET /api/classes/tutor/:tutorId - Get all classes for a tutor with confirmed student details
router.get('/tutor/:tutorId', verifyToken, async (req, res) => {
  try {
    const { tutorId } = req.params;
    
    const tutor = await User.findById(tutorId);
    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });

    // Find all classes for this tutor
    const classes = await ClassModel.find({
      tutorId: tutor._id,
      startTime: { $gte: new Date() } // Only future classes
    })
    .populate('tutorId', 'name email picture')
    .populate('confirmedStudents', 'name email picture firstName lastName') // Populate confirmed students with details
    .populate('invitedStudents.studentId', 'name email picture firstName lastName') // Populate invited students
    .sort({ startTime: 1 });

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
        ? `${tutorDisplayName} removed you from "${cls.name}" on ${formattedDate} at ${formattedStartTime}.`
        : `${tutorDisplayName} cancelled your invitation to "${cls.name}" on ${formattedDate} at ${formattedStartTime}.`;
      
      await Notification.create({
        userId: student._id,
        type: wasAccepted ? 'class_removed' : 'invitation_cancelled',
        title: wasAccepted ? 'Removed from Class' : 'Class Invitation Cancelled',
        message: notificationMessage,
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

module.exports = router;


