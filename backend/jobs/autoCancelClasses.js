const Class = require('../models/Class');
const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Auto-cancel classes that don't meet minimum student requirements
 * Runs 15 minutes before class start time
 * @param {Object} io - Socket.IO server instance
 * @param {Map} connectedUsers - Map of connected users (auth0Id -> socketId)
 */
async function autoCancelClasses(io = null, connectedUsers = null) {
  console.log('🔍 [AUTO-CANCEL] Checking for classes to auto-cancel...');
  
  const now = new Date();
  const tenMinutesFromNow = new Date(now.getTime() + 10 * 60 * 1000); // 10 min
  const twentyMinutesFromNow = new Date(now.getTime() + 20 * 60 * 1000);  // 20 min
  
  try {
    // Find all scheduled classes that:
    // 1. Start between 10-20 minutes from now (cancel at ~15 minute mark)
    // 2. Are scheduled (not already cancelled/completed)
    // 3. Have flexibleMinimum = false
    // 4. Don't have enough confirmed students
    const classes = await Class.find({
      startTime: {
        $gte: tenMinutesFromNow,
        $lt: twentyMinutesFromNow
      },
      status: 'scheduled',
      flexibleMinimum: false
    }).populate('tutorId', 'name email firstName lastName auth0Id')
      .populate('confirmedStudents', 'name email firstName lastName auth0Id');
    
    console.log(`📊 [AUTO-CANCEL] Found ${classes.length} scheduled classes in the next 10-20 minutes (~15 min window)`);
    
    let cancelledCount = 0;
    
    for (const classItem of classes) {
      const confirmedCount = classItem.confirmedStudents.length;
      const minRequired = classItem.minStudents;
      
      console.log(`🔍 [AUTO-CANCEL] Class "${classItem.name}" (${classItem._id}): ${confirmedCount}/${minRequired} students`);
      
      if (confirmedCount < minRequired) {
        console.log(`❌ [AUTO-CANCEL] Cancelling class "${classItem.name}" - only ${confirmedCount}/${minRequired} students enrolled`);
        
        // Cancel the class
        classItem.status = 'cancelled';
        classItem.cancelledAt = new Date();
        classItem.cancelReason = 'minimum_not_met';
        await classItem.save();
        
        cancelledCount++;
        
        // Remove the availability block from tutor's calendar
        await removeClassAvailability(classItem);
        
        // Create notifications and emit WebSocket events for tutor and all invited/confirmed students
        await createCancellationNotifications(classItem, io, connectedUsers);
      }
    }
    
    console.log(`✅ [AUTO-CANCEL] Auto-cancelled ${cancelledCount} classes`);
    return { success: true, cancelledCount };
    
  } catch (error) {
    console.error('❌ [AUTO-CANCEL] Error in auto-cancel job:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove class availability block from tutor's calendar
 * @param {Object} classItem - The cancelled class
 */
async function removeClassAvailability(classItem) {
  try {
    // classItem.tutorId might be populated (an object) or just an ID
    // Handle both cases
    const tutorId = classItem.tutorId._id || classItem.tutorId;
    const tutor = await User.findById(tutorId);
    
    if (!tutor) {
      console.error(`❌ [AUTO-CANCEL] Tutor not found for class ${classItem._id}`);
      return;
    }
    
    console.log(`🔍 [AUTO-CANCEL] Found tutor ${tutor.name} (${tutor._id}), checking ${tutor.availability?.length || 0} availability slots`);
    
    // Ensure availability is an array
    if (!Array.isArray(tutor.availability)) {
      console.log(`⚠️ [AUTO-CANCEL] Tutor availability is not an array, initializing as empty array`);
      tutor.availability = [];
    }
    
    // Remove the availability block that matches this class
    const classIdStr = classItem._id.toString();
    const initialAvailabilityLength = tutor.availability.length;
    
    // Log all class-type blocks before filtering
    const classBlocks = tutor.availability.filter(slot => slot.type === 'class');
    console.log(`🔍 [AUTO-CANCEL] Found ${classBlocks.length} class-type blocks before removal`);
    classBlocks.forEach(block => {
      console.log(`   - Class block ID: "${block.id}", Title: "${block.title}", Match: ${block.id === classIdStr}`);
    });
    
    // Log all blocks to see what we're working with
    console.log(`🔍 [AUTO-CANCEL] All availability blocks for tutor:`);
    tutor.availability.forEach((slot, index) => {
      console.log(`   [${index}] Type: ${slot.type}, ID: "${slot.id}", Title: "${slot.title || 'N/A'}"`);
    });
    
    // Filter out the class block - using explicit comparison
    tutor.availability = tutor.availability.filter(slot => {
      const isMatch = (slot.id === classIdStr && slot.type === 'class');
      if (isMatch) {
        console.log(`   ✅ MATCH FOUND - Removing block with ID: ${slot.id}`);
      }
      return !isMatch;
    });
    
    const removedCount = initialAvailabilityLength - tutor.availability.length;
    
    if (removedCount > 0) {
      // Mark the field as modified to ensure Mongoose saves it
      tutor.markModified('availability');
      await tutor.save();
      console.log(`✅ [AUTO-CANCEL] Removed ${removedCount} availability block(s) for class "${classItem.name}" (ID: ${classIdStr}) from tutor ${tutor.name}'s calendar`);
      console.log(`✅ [AUTO-CANCEL] Tutor availability after removal: ${tutor.availability.length} blocks`);
    } else {
      console.log(`⚠️ [AUTO-CANCEL] No availability block found for class "${classItem.name}" (ID: ${classIdStr}) in tutor ${tutor.name}'s calendar`);
      console.log(`⚠️ [AUTO-CANCEL] This might mean the block was already removed or never created`);
      console.log(`⚠️ [AUTO-CANCEL] Debug info:`);
      console.log(`   - Looking for ID: "${classIdStr}"`);
      console.log(`   - Total blocks: ${tutor.availability.length}`);
      console.log(`   - Class blocks: ${classBlocks.length}`);
    }
  } catch (error) {
    console.error(`❌ [AUTO-CANCEL] Error removing class availability:`, error);
    console.error(`❌ [AUTO-CANCEL] Stack trace:`, error.stack);
  }
}

/**
 * Create notifications for all participants when a class is auto-cancelled
 * @param {Object} classItem - The cancelled class
 * @param {Object} io - Socket.IO server instance
 * @param {Map} connectedUsers - Map of connected users (auth0Id -> socketId)
 */
async function createCancellationNotifications(classItem, io, connectedUsers) {
  const tutor = classItem.tutorId;
  const confirmedStudents = classItem.confirmedStudents;
  const allInvitedStudentIds = classItem.invitedStudents.map(inv => inv.studentId);
  
  // Format date/time for notification
  const startTime = new Date(classItem.startTime);
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
  try {
    const notification = await Notification.create({
      userId: tutor._id,
      type: 'class_auto_cancelled',
      title: 'Class Auto-Cancelled',
      message: `Your class <strong>"${classItem.name}"</strong> scheduled for <strong>${formattedDate} at ${formattedTime}</strong> has been automatically <strong>cancelled</strong> because the minimum student requirement (${classItem.minStudents} students) was not met.`,
      relatedItemId: classItem._id,
      relatedItemType: 'Class',
      metadata: {
        className: classItem.name,
        startTime: classItem.startTime,
        minStudents: classItem.minStudents,
        confirmedCount: confirmedStudents.length,
        cancelReason: 'minimum_not_met'
      }
    });
    console.log(`📧 [AUTO-CANCEL] Notified tutor ${tutorName} about cancellation`);
    
    // Emit WebSocket event to tutor if connected
    if (io && connectedUsers && tutor.auth0Id) {
      const tutorSocketId = connectedUsers.get(tutor.auth0Id);
      if (tutorSocketId) {
        io.to(tutorSocketId).emit('new_notification', {
          type: 'class_auto_cancelled',
          title: 'Class Auto-Cancelled',
          message: `Your class <strong>"${classItem.name}"</strong> scheduled for <strong>${formattedDate} at ${formattedTime}</strong> has been automatically <strong>cancelled</strong> because the minimum student requirement (${classItem.minStudents} students) was not met.`,
          data: {
            classId: classItem._id.toString(),
            className: classItem.name,
            startTime: classItem.startTime,
            minStudents: classItem.minStudents,
            confirmedCount: confirmedStudents.length
          }
        });
        console.log(`🔔 [AUTO-CANCEL] WebSocket notification sent to tutor ${tutorName}`);
      } else {
        console.log(`⚠️ [AUTO-CANCEL] Tutor ${tutorName} not connected to WebSocket`);
      }
    }
  } catch (error) {
    console.error(`❌ [AUTO-CANCEL] Error notifying tutor:`, error);
  }
  
  // Notify all confirmed students
  for (const student of confirmedStudents) {
    try {
      const notification = await Notification.create({
        userId: student._id,
        type: 'class_auto_cancelled',
        title: 'Class Cancelled',
        message: `The class <strong>"${classItem.name}"</strong> with ${tutorName} scheduled for <strong>${formattedDate} at ${formattedTime}</strong> has been <strong>cancelled</strong> due to insufficient enrollment. You have not been charged.`,
        relatedItemId: classItem._id,
        relatedItemType: 'Class',
        metadata: {
          className: classItem.name,
          tutorName: tutorName,
          startTime: classItem.startTime,
          cancelReason: 'minimum_not_met'
        }
      });
      console.log(`📧 [AUTO-CANCEL] Notified student ${student.name} about cancellation`);
      
      // Emit WebSocket event to student if connected
      if (io && connectedUsers && student.auth0Id) {
        const studentSocketId = connectedUsers.get(student.auth0Id);
        if (studentSocketId) {
          io.to(studentSocketId).emit('new_notification', {
            type: 'class_auto_cancelled',
            title: 'Class Cancelled',
            message: `The class <strong>"${classItem.name}"</strong> with ${tutorName} scheduled for <strong>${formattedDate} at ${formattedTime}</strong> has been <strong>cancelled</strong> due to insufficient enrollment. You have not been charged.`,
            data: {
              classId: classItem._id.toString(),
              className: classItem.name,
              tutorName: tutorName,
              startTime: classItem.startTime
            }
          });
          console.log(`🔔 [AUTO-CANCEL] WebSocket notification sent to student ${student.name}`);
        } else {
          console.log(`⚠️ [AUTO-CANCEL] Student ${student.name} not connected to WebSocket`);
        }
      }
    } catch (error) {
      console.error(`❌ [AUTO-CANCEL] Error notifying student ${student.name}:`, error);
    }
  }
  
  // Notify invited students who haven't responded yet
  const invitedButNotConfirmed = classItem.invitedStudents.filter(
    inv => inv.status === 'pending' && !confirmedStudents.some(cs => cs._id.toString() === inv.studentId.toString())
  );
  
  for (const invitation of invitedButNotConfirmed) {
    try {
      const student = await User.findById(invitation.studentId);
      if (student) {
        const notification = await Notification.create({
          userId: student._id,
          type: 'class_invitation_cancelled',
          title: 'Class Invitation Cancelled',
          message: `The class <strong>"${classItem.name}"</strong> with ${tutorName} scheduled for <strong>${formattedDate} at ${formattedTime}</strong> has been <strong>cancelled</strong> due to insufficient enrollment.`,
          relatedItemId: classItem._id,
          relatedItemType: 'Class',
          metadata: {
            className: classItem.name,
            tutorName: tutorName,
            startTime: classItem.startTime,
            cancelReason: 'minimum_not_met'
          }
        });
        console.log(`📧 [AUTO-CANCEL] Notified invited student ${student.name} about cancellation`);
        
        // Emit WebSocket event to invited student if connected
        if (io && connectedUsers && student.auth0Id) {
          const studentSocketId = connectedUsers.get(student.auth0Id);
          if (studentSocketId) {
            io.to(studentSocketId).emit('new_notification', {
              type: 'class_invitation_cancelled',
              title: 'Class Invitation Cancelled',
              message: `The class <strong>"${classItem.name}"</strong> with ${tutorName} scheduled for <strong>${formattedDate} at ${formattedTime}</strong> has been <strong>cancelled</strong> due to insufficient enrollment.`,
              data: {
                classId: classItem._id.toString(),
                className: classItem.name,
                tutorName: tutorName,
                startTime: classItem.startTime
              }
            });
            console.log(`🔔 [AUTO-CANCEL] WebSocket notification sent to invited student ${student.name}`);
          } else {
            console.log(`⚠️ [AUTO-CANCEL] Invited student ${student.name} not connected to WebSocket`);
          }
        }
      }
    } catch (error) {
      console.error(`❌ [AUTO-CANCEL] Error notifying invited student:`, error);
    }
  }
}

module.exports = { autoCancelClasses };

