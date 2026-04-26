const Class = require('../models/Class');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { archiveClassConversation } = require('../services/classConversation');
const { emitClassStateChanged, REASONS: CLASS_STATE_REASONS } = require('../services/classStateBroadcaster');

/**
 * Auto-cancel classes that don't meet minimum student requirements.
 * Runs ~1 hour before class start time. Window width matches the cron
 * interval (every 10 minutes) so each class is evaluated exactly once.
 * @param {Object} io - Socket.IO server instance
 * @param {Map} connectedUsers - Map of connected users (auth0Id -> socketId)
 */
async function autoCancelClasses(io = null, connectedUsers = null) {
  console.log('🔍 [AUTO-CANCEL] Checking for classes to auto-cancel...');

  const now = new Date();
  const fiftyFiveMinutesFromNow = new Date(now.getTime() + 55 * 60 * 1000); // 55 min
  const sixtyFiveMinutesFromNow = new Date(now.getTime() + 65 * 60 * 1000); // 65 min

  try {
    // Find all scheduled classes that start between 55-65 minutes from now
    // (cancel at ~1 hour before start). We evaluate both strict-minimum and
    // flexibleMinimum classes here — the cancel decision is per-class below.
    const classes = await Class.find({
      startTime: {
        $gte: fiftyFiveMinutesFromNow,
        $lt: sixtyFiveMinutesFromNow
      },
      status: 'scheduled'
    }).populate('tutorId', 'name email firstName lastName auth0Id')
      .populate('confirmedStudents', 'name email firstName lastName auth0Id');

    console.log(`📊 [AUTO-CANCEL] Found ${classes.length} scheduled classes in the next 55-65 minutes (~1 hour window)`);

    let cancelledCount = 0;

    for (const classItem of classes) {
      const confirmedCount = classItem.confirmedStudents.length;
      const minRequired = classItem.minStudents;
      const isFlexible = !!classItem.flexibleMinimum;

      // Decision:
      // - flexibleMinimum: cancel only if literally 0 students enrolled
      //   (≥1-student floor — never let a tutor sit in an empty room)
      // - strict minimum: cancel if confirmed < minStudents
      const shouldCancel = isFlexible
        ? confirmedCount === 0
        : confirmedCount < minRequired;
      const cancelReason = isFlexible ? 'no_students_enrolled' : 'minimum_not_met';

      console.log(`🔍 [AUTO-CANCEL] Class "${classItem.name}" (${classItem._id}): ${confirmedCount}/${minRequired} students, flexible=${isFlexible}, shouldCancel=${shouldCancel}`);

      if (shouldCancel) {
        const reasonLog = isFlexible
          ? 'no students enrolled (flexibleMinimum=true ≥1 floor)'
          : `only ${confirmedCount}/${minRequired} students enrolled`;
        console.log(`❌ [AUTO-CANCEL] Cancelling class "${classItem.name}" — ${reasonLog}`);

        // Cancel the class
        classItem.status = 'cancelled';
        classItem.cancelledAt = new Date();
        classItem.cancelReason = cancelReason;
        
        // 💳 RELEASE ALL AUTHORIZED PAYMENTS: Cancel all payment holds
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const Payment = require('../models/Payment');
        let releasedCount = 0;
        
        for (const studentPayment of classItem.studentPayments || []) {
          if (studentPayment.paymentStatus === 'authorized') {
            try {
              // Cancel the authorization (release the hold)
              const cancelledIntent = await stripe.paymentIntents.cancel(
                studentPayment.stripePaymentIntentId
              );
              
              if (cancelledIntent.status === 'canceled') {
                studentPayment.paymentStatus = 'cancelled';
                studentPayment.cancelledAt = new Date();
                
                // Update Payment model
                const payment = await Payment.findById(studentPayment.paymentId);
                if (payment) {
                  payment.status = 'cancelled';
                  payment.metadata = payment.metadata || {};
                  payment.metadata.cancelReason = 'class_cancelled_minimum_not_met';
                  payment.metadata.cancelledAt = new Date();
                  await payment.save();
                }
                
                releasedCount++;
              }
            } catch (stripeError) {
              console.error(`❌ Failed to cancel payment authorization:`, stripeError.message);
              // Continue with cancellation even if payment release fails
            }
          }
        }
        
        if (releasedCount > 0) {
          console.log(`💳 Released ${releasedCount} payment authorization(s) for auto-cancelled class "${classItem.name}"`);
        }
        
        await classItem.save();

        emitClassStateChanged(io, classItem._id, {
          reason: CLASS_STATE_REASONS.classAutoCancelled,
        }).catch(() => {});

        // Archive the class group chat (freeze membership, post system message).
        try {
          const archiveReason = isFlexible
            ? `"${classItem.name}" was cancelled automatically because no students enrolled.`
            : `"${classItem.name}" was cancelled automatically because the minimum of ${minRequired} student(s) was not met.`;
          await archiveClassConversation(classItem._id, {
            reason: archiveReason
          });
        } catch (archiveErr) {
          console.error('⚠️ Failed to archive class conversation on auto-cancel:', archiveErr);
        }

        cancelledCount++;

        // Remove the availability block from tutor's calendar
        await removeClassAvailability(classItem);

        // Create notifications and emit WebSocket events for tutor and all invited/confirmed students
        await createCancellationNotifications(classItem, io, connectedUsers, { isFlexible });
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
 * @param {Object} [opts]
 * @param {boolean} [opts.isFlexible=false] - True when cancelled under the
 *   flexibleMinimum ≥1-student floor (0 enrolled). Tweaks tutor copy + cancel
 *   reason; student copy stays generic ("insufficient enrollment").
 */
async function createCancellationNotifications(classItem, io, connectedUsers, opts = {}) {
  const isFlexible = !!opts.isFlexible;
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

  // Import name formatter
  const { formatNameWithInitial } = require('../utils/nameFormatter');
  const tutorName = formatNameWithInitial(tutor);

  const tutorCancelReason = isFlexible ? 'no_students_enrolled' : 'minimum_not_met';
  const tutorMessage = isFlexible
    ? `Your class <strong>"${classItem.name}"</strong> scheduled for <strong>${formattedDate} at ${formattedTime}</strong> has been automatically <strong>cancelled</strong> because no students enrolled.`
    : `Your class <strong>"${classItem.name}"</strong> scheduled for <strong>${formattedDate} at ${formattedTime}</strong> has been automatically <strong>cancelled</strong> because the minimum student requirement (${classItem.minStudents} students) was not met.`;

  // Notify tutor
  try {
    const notification = await Notification.create({
      userId: tutor._id,
      type: 'class_auto_cancelled',
      title: 'Class Auto-Cancelled',
      message: tutorMessage,
      data: {
        classId: classItem._id.toString(),
        className: classItem.name,
        startTime: classItem.startTime,
        minStudents: classItem.minStudents,
        confirmedCount: confirmedStudents.length,
        cancelReason: tutorCancelReason
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
          message: tutorMessage,
          data: {
            classId: classItem._id.toString(),
            className: classItem.name,
            startTime: classItem.startTime,
            minStudents: classItem.minStudents,
            confirmedCount: confirmedStudents.length,
            cancelReason: tutorCancelReason
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
        message: `The class <strong>"${classItem.name}"</strong> with <strong>${tutorName}</strong> scheduled for <strong>${formattedDate} at ${formattedTime}</strong> has been <strong>cancelled</strong> due to insufficient enrollment. You have not been charged.`,
        data: {
          classId: classItem._id.toString(),
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
            message: `The class <strong>"${classItem.name}"</strong> with <strong>${tutorName}</strong> scheduled for <strong>${formattedDate} at ${formattedTime}</strong> has been <strong>cancelled</strong> due to insufficient enrollment. You have not been charged.`,
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
          data: {
            classId: classItem._id.toString(),
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

