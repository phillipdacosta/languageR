/**
 * Payment API Routes
 * 
 * Endpoints:
 * - POST /api/payments/book-lesson - Book a lesson with wallet or card
 * - POST /api/payments/create-payment-intent - Create Stripe PaymentIntent for direct payment
 * - POST /api/payments/complete-lesson - Complete lesson payment (internal/webhook)
 * - POST /api/payments/refund-lesson - Refund a lesson
 * - GET /api/payments/history - Get payment history
 * - GET /api/payments/lesson/:lessonId - Get payment details for a lesson
 * - POST /api/payments/stripe-connect/onboard - Start Stripe Connect onboarding for tutor
 * - GET /api/payments/stripe-connect/status - Check Stripe Connect onboarding status
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const paymentService = require('../services/paymentService');
const stripeService = require('../services/stripeService');
const User = require('../models/User');
const Lesson = require('../models/Lesson');
const Notification = require('../models/Notification');
const Message = require('../models/Message');
const { generateTrialLessonMessage } = require('../utils/systemMessages');
const { formatNameWithInitial } = require('../utils/nameFormatter');
const TutorFeedback = require('../models/TutorFeedback');

// Use shared name formatter
const formatDisplayName = formatNameWithInitial;

/**
 * POST /api/payments/create-payment-intent
 * Create Stripe PaymentIntent for direct payment
 * Body: { amount: number, lessonId: string }
 */
router.post('/create-payment-intent', verifyToken, async (req, res) => {
  try {
    const { amount, lessonId } = req.body;

    if (!amount || typeof amount !== 'number') {
      return res.status(400).json({ success: false, message: 'Valid amount required' });
    }

    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const paymentIntent = await stripeService.createPaymentIntent({
      amount,
      metadata: {
        userId: user._id.toString(),
        lessonId: lessonId || '',
        userEmail: user.email,
        type: 'lesson_booking'
      },
      customerId: user.stripeCustomerId || undefined
    });

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (error) {
    console.error('❌ Error creating payment intent:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/payments/book-lesson-with-payment
 * Book a lesson and process payment in one transaction
 * Body: { lessonData: LessonCreateRequest, paymentMethod: 'wallet'|'card', stripePaymentIntentId?: string }
 */
router.post('/book-lesson-with-payment', verifyToken, async (req, res) => {
  try {
    const { 
      lessonData, 
      paymentMethod, 
      stripePaymentIntentId, 
      stripePaymentMethodId, 
      stripeCustomerId
    } = req.body;
    
    // Parse payment amounts as numbers and hybrid flag as boolean
    const walletAmount = parseFloat(req.body.walletAmount) || 0;
    const paymentMethodAmount = parseFloat(req.body.paymentMethodAmount) || 0;
    const isHybridPayment = req.body.isHybridPayment === true || req.body.isHybridPayment === 'true';
    
    console.log('💳 [ROUTE DEBUG] Parsed payment params:', {
      walletAmount,
      paymentMethodAmount,
      isHybridPayment,
      rawWalletAmount: req.body.walletAmount,
      rawPaymentMethodAmount: req.body.paymentMethodAmount,
      rawIsHybridPayment: req.body.isHybridPayment
    });

    if (!lessonData || !paymentMethod) {
      return res.status(400).json({ 
        success: false, 
        message: 'lessonData and paymentMethod are required' 
      });
    }

    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Validate tutor has payout setup (Stripe, PayPal, or Manual)
    const tutor = await User.findById(lessonData.tutorId);
    if (!tutor) {
      return res.status(404).json({ success: false, message: 'Tutor not found' });
    }

    // Check if tutor has ANY valid payout method configured
    const hasStripe = tutor.stripeConnectOnboarded === true;
    const hasPayPal = tutor.payoutProvider === 'paypal' && !!tutor.payoutDetails?.paypalEmail;
    const hasManual = tutor.payoutProvider === 'manual';
    const hasPayoutSetup = hasStripe || hasPayPal || hasManual;

    if (!hasPayoutSetup) {
      console.log(`❌ Tutor ${tutor._id} has no payout setup:`, {
        stripeConnectOnboarded: tutor.stripeConnectOnboarded,
        payoutProvider: tutor.payoutProvider,
        paypalEmail: tutor.payoutDetails?.paypalEmail
      });
      return res.status(403).json({ 
        success: false, 
        message: 'This tutor has not yet completed payment setup and cannot accept bookings. Please choose another tutor.',
        code: 'TUTOR_NOT_ONBOARDED'
      });
    }
    
    console.log(`✅ Tutor ${tutor._id} has valid payout setup:`, {
      payoutProvider: tutor.payoutProvider,
      hasStripe,
      hasPayPal,
      hasManual
    });

    // ==========================================
    // VALIDATION CHECKS - Must all pass before creating lesson
    // ==========================================

    // 0. CHECK: Tutor has no REQUIRED pending feedback (block new bookings)
    const pendingFeedbackCount = await TutorFeedback.countDocuments({
      tutorId: tutor._id,
      status: 'pending',
      required: { $ne: false }
    });

    if (pendingFeedbackCount > 0) {
      console.log(`🚫 Blocking payment booking - tutor ${tutor.email} has ${pendingFeedbackCount} pending feedback`);
      return res.status(403).json({
        success: false,
        message: 'Tutor not accepting bookings at this time.',
        code: 'PENDING_FEEDBACK',
        pendingCount: pendingFeedbackCount
      });
    }
    
    const lessonStartTime = new Date(lessonData.startTime);
    const lessonEndTime = new Date(lessonData.endTime);
    const now = new Date();

    // 1. CHECK: Lesson start time must be in the future
    // Allow 2 minute buffer for processing time
    const minStartTime = new Date(now.getTime() - 2 * 60 * 1000);
    if (lessonStartTime < minStartTime) {
      console.log('❌ Booking rejected: Lesson time is in the past', {
        lessonStart: lessonStartTime,
        now: now,
        diff: (now - lessonStartTime) / 1000 / 60, // minutes
      });
      return res.status(400).json({
        success: false,
        message: 'Cannot book a lesson in the past. Please select a future time slot.',
        code: 'LESSON_TIME_PAST'
      });
    }

    // 2. CHECK: Tutor is approved and active
    if (!tutor.tutorApproved) {
      console.log('❌ Booking rejected: Tutor not approved', { tutorId: tutor._id });
      return res.status(403).json({
        success: false,
        message: 'This tutor is not currently accepting bookings.',
        code: 'TUTOR_NOT_APPROVED'
      });
    }

    // 3. CHECK: Timeslot is still in tutor's availability
    // NOTE: Availability blocks are stored in the TUTOR'S local timezone
    // The lesson times from frontend are in UTC, so we need to handle this carefully
    
    // Get tutor's timezone (default to America/New_York if not set)
    const tutorTimezone = tutor.timezone || 'America/New_York';
    
    // Convert lesson start time to tutor's local timezone for comparison
    const lessonInTutorTz = new Date(lessonStartTime.toLocaleString('en-US', { timeZone: tutorTimezone }));
    const lessonEndInTutorTz = new Date(lessonEndTime.toLocaleString('en-US', { timeZone: tutorTimezone }));
    
    // Get day of week in tutor's timezone (as string like 'Wednesday')
    const dayOfWeekString = lessonStartTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: tutorTimezone });
    
    // Also get day as number (0=Sunday, 1=Monday, ..., 6=Saturday) for comparison
    // Availability blocks may store day as number OR string depending on how they were created
    const dayOfWeekNumber = lessonInTutorTz.getDay(); // 0-6, Sunday=0
    
    // Map to handle both formats - availability may use 0-6 (Sun-Sat) or 1-7 (Mon-Sun) or strings
    const dayNameToNumber = {
      'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 
      'Thursday': 4, 'Friday': 5, 'Saturday': 6
    };
    
    // Get hours and minutes in tutor's local time
    const localStartHours = lessonInTutorTz.getHours();
    const localStartMinutes = lessonInTutorTz.getMinutes();
    const localEndHours = lessonEndInTutorTz.getHours();
    const localEndMinutes = lessonEndInTutorTz.getMinutes();
    
    const requestedStartMinutes = localStartHours * 60 + localStartMinutes;
    const requestedEndMinutes = localEndHours * 60 + localEndMinutes;
    
    const availabilityBlocks = tutor.availability || [];
    
    // Helper to check if a block's day matches
    const blockDayMatches = (blockDay) => {
      // Handle both string and number formats
      if (typeof blockDay === 'string') {
        return blockDay === dayOfWeekString;
      }
      // If number, check both 0-6 format and 1-7 format
      // 0-6 format: Sunday=0, Monday=1, etc.
      // 1-7 format: Monday=1, Tuesday=2, ..., Sunday=7
      return blockDay === dayOfWeekNumber || blockDay === (dayOfWeekNumber === 0 ? 7 : dayOfWeekNumber);
    };
    
    console.log('🔍 Availability check:', {
      tutorTimezone,
      lessonStartUTC: lessonStartTime.toISOString(),
      lessonStartLocal: `${localStartHours}:${localStartMinutes.toString().padStart(2, '0')}`,
      dayOfWeekString,
      dayOfWeekNumber,
      requestedStartMinutes,
      requestedEndMinutes,
      availabilityBlocksCount: availabilityBlocks.length,
      allAvailableDays: [...new Set(availabilityBlocks.filter(b => b.type === 'available').map(b => b.day))],
      matchingDayBlocks: availabilityBlocks.filter(b => blockDayMatches(b.day)).map(b => ({
        day: b.day,
        type: b.type,
        start: `${b.startHour}:${(b.startMinute || 0).toString().padStart(2, '0')}`,
        end: `${b.endHour}:${(b.endMinute || 0).toString().padStart(2, '0')}`,
        startMinutes: (b.startHour || 0) * 60 + (b.startMinute || 0),
        endMinutes: (b.endHour || 24) * 60 + (b.endMinute || 0)
      }))
    });
    
    const matchingBlocks = availabilityBlocks.filter(block => {
      if (block.type !== 'available') return false;
      if (!blockDayMatches(block.day)) return false;
      
      const blockStart = (block.startHour || 0) * 60 + (block.startMinute || 0);
      const blockEnd = (block.endHour || 24) * 60 + (block.endMinute || 0);
      
      const matches = requestedStartMinutes >= blockStart && requestedEndMinutes <= blockEnd;
      console.log(`  Block day=${block.day} ${blockStart}-${blockEnd}: requested ${requestedStartMinutes}-${requestedEndMinutes} = ${matches ? '✅ MATCH' : '❌ NO MATCH'}`);
      
      return matches;
    });

    if (matchingBlocks.length === 0) {
      console.log('❌ Booking rejected: Timeslot no longer available', {
        tutorId: tutor._id,
        requestedTime: { start: lessonStartTime, end: lessonEndTime },
        dayOfWeek,
        requestedStartMinutes,
        requestedEndMinutes
      });
      return res.status(409).json({
        success: false,
        message: 'This time slot is no longer available. The tutor may have updated their schedule. Please refresh and select a different time.',
        code: 'SLOT_NOT_AVAILABLE'
      });
    }

    // 4. CHECK: No conflicting lessons for the tutor at this time
    const tutorConflict = await Lesson.findOne({
      tutorId: tutor._id,
      status: { $in: ['scheduled', 'in_progress'] },
      $or: [
        // New lesson starts during existing lesson
        { startTime: { $lte: lessonStartTime }, endTime: { $gt: lessonStartTime } },
        // New lesson ends during existing lesson
        { startTime: { $lt: lessonEndTime }, endTime: { $gte: lessonEndTime } },
        // New lesson completely overlaps existing lesson
        { startTime: { $gte: lessonStartTime }, endTime: { $lte: lessonEndTime } }
      ]
    });

    if (tutorConflict) {
      console.log('❌ Booking rejected: Tutor has conflicting lesson', {
        tutorId: tutor._id,
        conflictingLessonId: tutorConflict._id,
        requestedTime: { start: lessonStartTime, end: lessonEndTime },
        conflictTime: { start: tutorConflict.startTime, end: tutorConflict.endTime }
      });
      return res.status(409).json({
        success: false,
        message: 'This time slot has just been booked by someone else. Please refresh and select a different time.',
        code: 'TUTOR_TIME_CONFLICT'
      });
    }

    // 5. CHECK: No conflicting lessons for the student at this time
    const studentConflict = await Lesson.findOne({
      studentId: user._id,
      status: { $in: ['scheduled', 'in_progress'] },
      $or: [
        { startTime: { $lte: lessonStartTime }, endTime: { $gt: lessonStartTime } },
        { startTime: { $lt: lessonEndTime }, endTime: { $gte: lessonEndTime } },
        { startTime: { $gte: lessonStartTime }, endTime: { $lte: lessonEndTime } }
      ]
    });

    if (studentConflict) {
      console.log('❌ Booking rejected: Student has conflicting lesson', {
        studentId: user._id,
        conflictingLessonId: studentConflict._id,
        requestedTime: { start: lessonStartTime, end: lessonEndTime },
        conflictTime: { start: studentConflict.startTime, end: studentConflict.endTime }
      });
      return res.status(409).json({
        success: false,
        message: 'You already have a lesson scheduled at this time. Please select a different time.',
        code: 'STUDENT_TIME_CONFLICT'
      });
    }

    // 6. CHECK: Lesson duration is valid
    const durationMinutes = (lessonEndTime - lessonStartTime) / (1000 * 60);
    const allowedDurations = [25, 50];
    if (!allowedDurations.includes(durationMinutes)) {
      console.log('❌ Booking rejected: Invalid lesson duration', { durationMinutes });
      return res.status(400).json({
        success: false,
        message: 'Invalid lesson duration. Lessons must be 25 or 50 minutes.',
        code: 'INVALID_DURATION'
      });
    }

    // 7. CHECK: Price is valid (must be non-negative)
    if (lessonData.price < 0) {
      console.log('❌ Booking rejected: Invalid price', { price: lessonData.price });
      return res.status(400).json({
        success: false,
        message: 'Invalid lesson price.',
        code: 'INVALID_PRICE'
      });
    }

    console.log('✅ All booking validations passed');
    // ==========================================
    // END VALIDATION CHECKS
    // ==========================================

    // Check if this is a trial lesson (first lesson between student and tutor)
    const previousLessons = await Lesson.countDocuments({
      tutorId: tutor._id,
      studentId: user._id,
      isOfficeHours: { $ne: true }, // Exclude office hours
      status: { $in: ['scheduled', 'in_progress', 'completed'] }
    });
    
    const isTrialLesson = previousLessons === 0;
    
    // Calculate expected price with trial discount (30% off for first lesson)
    const TRIAL_DISCOUNT_PERCENT = 30;
    const tutorHourlyRate = tutor.hourlyRate || tutor.onboardingData?.hourlyRate || 20;
    const STANDARD_LESSON_DURATION = 50;
    const basePrice = Math.round((tutorHourlyRate * (lessonData.duration / STANDARD_LESSON_DURATION)) * 100) / 100;
    
    let expectedPrice = basePrice;
    let discountAmount = 0;
    
    if (isTrialLesson) {
      discountAmount = Math.round(basePrice * (TRIAL_DISCOUNT_PERCENT / 100) * 100) / 100;
      expectedPrice = Math.round((basePrice - discountAmount) * 100) / 100;
    }
    
    console.log('🎓 Trial lesson check during booking:', {
      tutorId: tutor._id,
      studentId: user._id,
      previousScheduledLessons: previousLessons,
      isTrialLesson,
      tutorHourlyRate,
      basePrice,
      discountAmount,
      expectedPrice,
      clientPrice: lessonData.price
    });
    
    // Validate client price matches expected price (with small tolerance for rounding)
    const priceDifference = Math.abs(lessonData.price - expectedPrice);
    if (priceDifference > 0.02) {
      console.log('⚠️ Price mismatch detected, using server-calculated price:', {
        clientPrice: lessonData.price,
        expectedPrice,
        difference: priceDifference
      });
      // Override with server-calculated price for security
      lessonData.price = expectedPrice;
    }

    // Generate a unique channel name for Agora
    const channelName = `lesson_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Create the lesson first with all required fields
    const lesson = new Lesson({
      ...lessonData,
      channelName,
      status: 'scheduled',
      billingStatus: 'pending',
      isTrialLesson, // Add trial lesson flag
      discountAmount: isTrialLesson ? discountAmount : 0,
      discountPercent: isTrialLesson ? TRIAL_DISCOUNT_PERCENT : 0,
      originalPrice: basePrice // Store original price before discount
    });

    await lesson.save();
    console.log(`✅ Created lesson ${lesson._id} with channel ${channelName}`);

    // Now book the payment for this lesson
    try {
      const result = await paymentService.bookLesson({
        userId: user._id,
        lessonId: lesson._id,
        paymentMethod,
        stripePaymentIntentId,
        stripePaymentMethodId,
        stripeCustomerId,
        walletAmount,
        paymentMethodAmount,
        isHybridPayment
      });

      // Populate lesson data for response
      const populatedLesson = await Lesson.findById(lesson._id)
        .populate('tutorId', 'name firstName lastName email picture interfaceLanguage onboardingData auth0Id')
        .populate('studentId', 'name firstName lastName email picture auth0Id');

      const student = populatedLesson.studentId;
      const tutor = populatedLesson.tutorId;

      // Format date and time for notifications
      const lessonDate = new Date(populatedLesson.startTime);
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
      if (populatedLesson.bookingData?.selectedLanguage) {
        language = populatedLesson.bookingData.selectedLanguage;
      } else if (populatedLesson.subject && populatedLesson.subject !== 'Language Lesson') {
        language = populatedLesson.subject.replace(/\s+Lesson$/i, '').trim();
      } else if (tutor.onboardingData?.languages && tutor.onboardingData.languages.length > 0) {
        language = tutor.onboardingData.languages[0];
      }

      // Format names for notifications
      const studentDisplayName = formatDisplayName(student);
      const tutorDisplayName = formatDisplayName(tutor);
      
      // Check if this is a trial lesson
      const isTrialLesson = populatedLesson.isTrialLesson || false;
      const lessonTypePrefix = isTrialLesson ? 'trial ' : '';

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
              lessonId: populatedLesson._id,
              studentId: student._id,
              studentName: studentDisplayName,
              language: language,
              date: formattedDate,
              time: formattedTime,
              startTime: populatedLesson.startTime,
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
            lessonId: populatedLesson._id,
            tutorId: tutor._id,
            tutorName: tutorDisplayName,
            language: language,
            date: formattedDate,
            time: formattedTime,
            startTime: populatedLesson.startTime,
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
      if (isTrialLesson) {
        try {
          // Get tutor's interface language preference
          const tutorLanguage = tutor.interfaceLanguage || 'en';
          
          // Generate the multilingual system message
          const systemMessageContent = generateTrialLessonMessage({
            studentName: studentDisplayName,
            studentId: student._id.toString(),
            startTime: lessonDate,
            duration: populatedLesson.duration,
            tutorLanguage
          });
          
          // Create conversation ID between tutor and student using auth0Ids
          const ids = [student.auth0Id, tutor.auth0Id].sort();
          const conversationId = `${ids[0]}_${ids[1]}`;
          
          // Create the system message
          const systemMessage = new Message({
            conversationId,
            senderId: 'system',
            receiverId: tutor.auth0Id,
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
            message: `<strong>${studentDisplayName}</strong> booked a <strong>trial lesson</strong> on <strong>${new Date(populatedLesson.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${new Date(populatedLesson.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</strong>. Check your messages for preparation tips.`,
            relatedUserPicture: student.picture || null,
            data: {
              lessonId: populatedLesson._id.toString(),
              studentId: student._id.toString(),
              studentName: studentDisplayName,
              studentPicture: student.picture,
              conversationId,
              messageId: systemMessage._id.toString(),
              startTime: populatedLesson.startTime
            }
          });
          
          console.log('✅ Trial lesson notification created:', trialNotification._id);
          
          // Emit websocket notification to tutor if connected
          if (req.io && req.connectedUsers) {
            const tutorSocketId = req.connectedUsers.get(tutor.auth0Id);
            if (tutorSocketId) {
              req.io.to(tutorSocketId).emit('new_notification', {
                type: 'lesson_created',
                title: 'Trial Lesson Tips',
                message: `${studentDisplayName} booked a trial lesson for ${new Date(populatedLesson.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${new Date(populatedLesson.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. Check your messages for preparation tips.`,
                data: {
                  lessonId: populatedLesson._id.toString(),
                  studentId: student._id.toString(),
                  studentName: studentDisplayName,
                  studentPicture: student.picture,
                  conversationId,
                  messageId: systemMessage._id.toString(),
                  startTime: populatedLesson.startTime
                }
              });
              console.log('📤 Emitted trial lesson notification to tutor');
            }
          }
        } catch (trialError) {
          console.error('❌ Error creating trial lesson system message:', trialError);
        }
      }

      res.json({
        success: true,
        message: 'Lesson booked successfully with payment',
        payment: result.payment,
        lesson: populatedLesson
      });
    } catch (paymentError) {
      // If payment fails, cancel the lesson
      console.error('❌ Payment failed, cancelling lesson:', paymentError);
      lesson.status = 'cancelled';
      lesson.cancelReason = 'payment_failed';
      await lesson.save();
      
      throw new Error(`Payment failed: ${paymentError.message}`);
    }
  } catch (error) {
    console.error('❌ Error booking lesson with payment:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/payments/book-lesson
 * Book a lesson with wallet or card payment
 * Body: { lessonId: string, paymentMethod: 'wallet'|'card'|'apple_pay', stripePaymentIntentId?: string }
 */
router.post('/book-lesson', verifyToken, async (req, res) => {
  try {
    const { lessonId, paymentMethod, stripePaymentIntentId } = req.body;

    if (!lessonId || !paymentMethod) {
      return res.status(400).json({ 
        success: false, 
        message: 'lessonId and paymentMethod are required' 
      });
    }

    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const result = await paymentService.bookLesson({
      userId: user._id,
      lessonId,
      paymentMethod,
      stripePaymentIntentId
    });

    res.json({
      success: true,
      message: 'Lesson booked successfully',
      payment: result.payment,
      lesson: result.lesson
    });
  } catch (error) {
    console.error('❌ Error booking lesson:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/payments/complete-lesson
 * Complete lesson payment after lesson ends
 * Body: { lessonId: string }
 * Note: This should be called internally when lesson completes
 */
router.post('/complete-lesson', verifyToken, async (req, res) => {
  try {
    const { lessonId } = req.body;

    if (!lessonId) {
      return res.status(400).json({ success: false, message: 'lessonId required' });
    }

    const user = await User.findOne({ auth0Id: req.user.sub });
    const lesson = await Lesson.findById(lessonId);

    // Verify user is participant
    if (!lesson || (!lesson.tutorId.equals(user._id) && !lesson.studentId.equals(user._id))) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const result = await paymentService.completeLessonPayment(lessonId);

    res.json({
      success: true,
      message: 'Lesson payment completed',
      payment: result.payment,
      lesson: result.lesson
    });
  } catch (error) {
    console.error('❌ Error completing lesson payment:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/payments/refund-lesson
 * Refund a lesson
 * Body: { lessonId: string, reason: string, refundMethod?: 'wallet'|'card' }
 */
router.post('/refund-lesson', verifyToken, async (req, res) => {
  try {
    const { lessonId, reason, refundMethod } = req.body;

    if (!lessonId || !reason) {
      return res.status(400).json({ success: false, message: 'lessonId and reason required' });
    }

    const user = await User.findOne({ auth0Id: req.user.sub });
    const lesson = await Lesson.findById(lessonId);

    // Only tutor or student can request refund
    if (!lesson || (!lesson.tutorId.equals(user._id) && !lesson.studentId.equals(user._id))) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const result = await paymentService.refundLesson({
      lessonId,
      refundMethod,
      reason
    });

    res.json({
      success: true,
      message: 'Lesson refunded successfully',
      payment: result.payment,
      lesson: result.lesson
    });
  } catch (error) {
    console.error('❌ Error refunding lesson:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/payments/history
 * Get payment history for current user
 * Query: ?limit=50
 */
router.get('/history', verifyToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const payments = await paymentService.getPaymentHistory(user._id, limit);

    res.json({
      success: true,
      payments
    });
  } catch (error) {
    console.error('❌ Error getting payment history:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/payments/lesson/:lessonId
 * Get payment details for a specific lesson
 */
router.get('/lesson/:lessonId', verifyToken, async (req, res) => {
  try {
    const { lessonId } = req.params;
    const user = await User.findOne({ auth0Id: req.user.sub });
    const lesson = await Lesson.findById(lessonId);

    // Verify user is participant
    if (!lesson || (!lesson.tutorId.equals(user._id) && !lesson.studentId.equals(user._id))) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const payment = await paymentService.getPaymentDetails(lessonId);

    res.json({
      success: true,
      payment
    });
  } catch (error) {
    console.error('❌ Error getting payment details:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/payments/stripe-connect/onboard
 * Start Stripe Connect onboarding for tutor
 */
router.post('/stripe-connect/onboard', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can onboard to Stripe Connect' });
    }

    const { isUSPersonForTax, hasUSBankAccount } = req.body;

    // Save tax classification info if provided
    if (isUSPersonForTax !== undefined) {
      user.isUSPersonForTax = isUSPersonForTax;
      user.taxInfoCompletedAt = new Date();
      console.log(`📋 Tax info saved for ${user.email}: isUSPerson=${isUSPersonForTax}`);
    }
    if (hasUSBankAccount !== undefined) {
      user.hasUSBankAccount = hasUSBankAccount;
      console.log(`📋 Bank info saved for ${user.email}: hasUSBank=${hasUSBankAccount}`);
    }
    await user.save();

    // Create Stripe Connect account if doesn't exist
    if (!user.stripeConnectAccountId) {
      const account = await stripeService.createConnectAccount({
        email: user.email,
        metadata: {
          userId: user._id.toString(),
          userName: user.name
        }
      });

      user.stripeConnectAccountId = account.id;
      await user.save();
    }

    // Create account link for onboarding
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:8100';
    const accountLink = await stripeService.createAccountLink({
      accountId: user.stripeConnectAccountId,
      refreshUrl: `${baseUrl}/tabs/profile?stripe_refresh=true`,
      returnUrl: `${baseUrl}/tabs/profile?stripe_success=true`
    });

    res.json({
      success: true,
      onboardingUrl: accountLink.url
    });
  } catch (error) {
    console.error('❌ Error starting Stripe Connect onboarding:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/payments/stripe-connect/dashboard
 * Generate Stripe Express Dashboard login link for tutors
 */
router.post('/stripe-connect/dashboard', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can access payout dashboard' });
    }

    if (!user.stripeConnectAccountId) {
      return res.status(400).json({ success: false, message: 'No Stripe Connect account found. Please complete onboarding first.' });
    }

    // Generate login link for Stripe Express Dashboard
    const loginLink = await stripeService.createLoginLink(user.stripeConnectAccountId);

    res.json({
      success: true,
      dashboardUrl: loginLink.url
    });
  } catch (error) {
    console.error('❌ Error creating Stripe dashboard link:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/payments/tutor/retry-pending-transfers
 * Retry pending transfers for a tutor who has completed Stripe Connect onboarding
 */
router.post('/tutor/retry-pending-transfers', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can retry transfers' });
    }

    if (!user.stripeConnectAccountId || !user.stripeConnectOnboarded) {
      return res.status(400).json({ 
        success: false, 
        message: 'Stripe Connect onboarding must be completed first' 
      });
    }

    const Payment = require('../models/Payment');
    const stripeService = require('../services/stripeService');

    // Find all payments where:
    // - tutorId matches current user
    // - transferStatus is 'pending' or null
    // - payment status is 'succeeded'
    const pendingPayments = await Payment.find({
      tutorId: user._id,
      status: 'succeeded',
      $or: [
        { transferStatus: 'pending' },
        { transferStatus: null }
      ]
    }).populate('lessonId');

    console.log(`🔄 Found ${pendingPayments.length} pending transfers for tutor ${user._id}`);

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (const payment of pendingPayments) {
      try {
        // Create the Stripe transfer
        const transfer = await stripeService.createTransfer({
          amount: payment.tutorPayout,
          destination: user.stripeConnectAccountId,
          metadata: {
            lessonId: payment.lessonId?._id.toString() || 'unknown',
            tutorId: user._id.toString(),
            paymentId: payment._id.toString(),
            retried: true
          }
        });

        // Update payment record
        payment.stripeTransferId = transfer.id;
        payment.stripeTransferAmount = payment.tutorPayout;
        payment.transferredAt = new Date();
        payment.transferStatus = 'succeeded';
        await payment.save();

        // Emit WebSocket event for real-time update
        if (global.io) {
          const tutorSocketRoom = `user:${user._id}`;
          global.io.to(tutorSocketRoom).emit('payment_status_changed', {
            paymentId: payment._id.toString(),
            lessonId: payment.lessonId?._id?.toString() || null,
            status: 'paid', // Frontend uses 'paid' status for transferred payments
            transferStatus: 'succeeded',
            updatedAt: new Date()
          });
          console.log(`📡 Emitted payment_status_changed to ${tutorSocketRoom}`);
        }

        successCount++;
        console.log(`✅ Transferred $${payment.tutorPayout} to tutor (payment ${payment._id})`);
      } catch (error) {
        failCount++;
        errors.push({
          paymentId: payment._id,
          error: error.message
        });
        console.error(`❌ Failed to transfer payment ${payment._id}:`, error.message);
        
        // Mark as failed
        payment.transferStatus = 'failed';
        await payment.save();
      }
    }

    res.json({
      success: true,
      message: `Processed ${pendingPayments.length} pending transfers`,
      results: {
        total: pendingPayments.length,
        succeeded: successCount,
        failed: failCount
      },
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('❌ Error retrying pending transfers:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/payments/platform/earnings
 * Get platform earnings summary (admin/dev only)
 */
router.get('/platform/earnings', verifyToken, async (req, res) => {
  try {
    const Payment = require('../models/Payment');
    
    // Get all completed payments
    const payments = await Payment.find({ 
      status: 'succeeded',
      revenueRecognized: true 
    })
      .populate('lessonId', 'startTime')
      .populate('tutorId', 'name firstName lastName')
      .populate('studentId', 'name firstName lastName')
      .sort({ createdAt: -1 });

    let totalPlatformFees = 0;
    let totalTutorPayouts = 0;
    let totalRevenue = 0;

    const earningsSummary = payments.map(payment => {
      const platformFee = payment.platformFee || 0;
      const tutorPayout = payment.tutorPayout || 0;
      const revenue = payment.amount || 0;

      totalPlatformFees += platformFee;
      totalTutorPayouts += tutorPayout;
      totalRevenue += revenue;

      return {
        id: payment._id,
        lessonDate: payment.lessonId?.startTime || payment.createdAt,
        tutor: payment.tutorId ? `${payment.tutorId.firstName || payment.tutorId.name} ${(payment.tutorId.lastName || '').charAt(0)}.` : 'N/A',
        student: payment.studentId ? `${payment.studentId.firstName || payment.studentId.name} ${(payment.studentId.lastName || '').charAt(0)}.` : 'N/A',
        lessonPrice: revenue,
        platformFee,
        tutorPayout,
        paymentMethod: payment.paymentMethod,
        transferStatus: payment.transferStatus
      };
    });

    res.json({
      success: true,
      summary: {
        totalRevenue,
        totalPlatformFees,
        totalTutorPayouts,
        lessonsCompleted: payments.length
      },
      recentEarnings: earningsSummary.slice(0, 20) // Last 20 transactions
    });
  } catch (error) {
    console.error('❌ Error fetching platform earnings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/payments/tutor/earnings
 * Get earnings summary and recent payments for tutor
 */
router.get('/tutor/earnings', verifyToken, async (req, res) => {
  try {
    let user = await User.findOne({ auth0Id: req.user.sub });
    
    // Fallback: Try finding by email if auth0Id doesn't match
    if (!user && req.user.email) {
      console.log('🔍 User not found by auth0Id, trying email:', req.user.email);
      user = await User.findOne({ email: req.user.email });
      if (user) {
        console.log('✅ Found user by email, updating auth0Id');
        user.auth0Id = req.user.sub;
        await user.save();
      }
    }
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can view earnings' });
    }

    const Payment = require('../models/Payment');
    const Lesson = require('../models/Lesson');

    console.log(`💰 Fetching earnings for tutor ${user._id}...`);
    
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    // Build query
    const query = { 
      tutorId: user._id,
      transferStatus: { $ne: 'acknowledged' } // Exclude dismissed payments
    };
    
    // Status filter
    if (req.query.status && req.query.status !== 'all') {
      // We'll filter by status after mapping, since it's computed
    }

    // Get payments with pagination
    let payments = await Payment.find(query)
      .populate('lessonId', 'startTime endTime duration status cancelReason')
      .populate('classId', 'startTime endTime name status')
      .populate('studentId', 'name firstName lastName picture')
      .sort({ createdAt: -1 }) // Sort by booking date
      .skip(skip)
      .limit(limit);

    console.log(`💰 Found ${payments.length} payments for tutor ${user._id} (page ${page})`);

    // Calculate totals (always calculate from ALL payments, not just current page)
    const allPayments = await Payment.find({
      tutorId: user._id,
      transferStatus: { $ne: 'acknowledged' }
    }).populate('lessonId', 'status').populate('classId', 'status');
    
    let totalEarnings = 0; // Earnings that have been successfully transferred
    let pendingEarnings = 0; // Earnings that are pending transfer
    
    allPayments.forEach(payment => {
      const tutorPayout = payment.tutorPayout || 0;
      const lessonStatus = payment.lessonId?.status;
      const classStatus = payment.classId?.status;
      const isClassPayment = payment.paymentType === 'class_booking' || !!payment.classId;
      
      // Include in calculations if:
      // 1. Revenue is recognized (completed/ended lessons/classes), OR
      // 2. Lesson/class is scheduled (future that student paid for)
      const shouldCount = payment.revenueRecognized || 
                          lessonStatus === 'scheduled' || 
                          lessonStatus === 'in_progress' ||
                          (isClassPayment && classStatus === 'scheduled');
      
      if (shouldCount) {
        if (payment.transferStatus === 'succeeded' || payment.transferStatus === 'withdrawn') {
          totalEarnings += tutorPayout;
        } else if (payment.transferStatus === 'available') {
          // Available for withdrawal - counts as pending (not yet withdrawn)
          pendingEarnings += tutorPayout;
        } else if (payment.transferStatus === 'on_hold') {
          // On hold during 24hr period - counts as pending
          pendingEarnings += tutorPayout;
        } else if (lessonStatus === 'scheduled' || lessonStatus === 'in_progress') {
          // Scheduled/in-progress lessons - counts as pending (not yet available)
          pendingEarnings += tutorPayout;
        } else if (isClassPayment && classStatus === 'scheduled') {
          // Scheduled classes - counts as pending (not yet available)
          pendingEarnings += tutorPayout;
        } else if (payment.revenueRecognized) {
          // Completed but not yet available - counts as pending
          pendingEarnings += tutorPayout;
        }
      }
    });

    const recentPayments = payments.map(payment => {
      const tutorPayout = payment.tutorPayout || 0;
      const lessonStatus = payment.lessonId?.status || 'unknown';
      const classStatus = payment.classId?.status;
      const isClassPayment = payment.paymentType === 'class_booking' || !!payment.classId;
      
      // Determine payment status
      let paymentStatus = 'pending';
      
      // Check lesson/class cancellation FIRST (no-show, student/tutor cancelled)
      if (lessonStatus === 'cancelled' || classStatus === 'cancelled') {
        // Then check if it's an admin refund vs automatic cancellation
        if (payment.status === 'refunded' && payment.refundReason && payment.refundReason.includes('investigation')) {
          paymentStatus = 'refunded';
        } else if (payment.status === 'partially_refunded' && payment.refundReason && payment.refundReason.includes('investigation')) {
          paymentStatus = 'partially_refunded';
        } else {
          // Regular cancellation (no-show, etc.)
          paymentStatus = 'cancelled';
        }
      } else if (payment.status === 'refunded') {
        paymentStatus = 'refunded';
      } else if (payment.status === 'partially_refunded') {
        paymentStatus = 'partially_refunded';
      } else if (payment.transferStatus === 'succeeded' || payment.transferStatus === 'withdrawn') {
        paymentStatus = 'paid';
      } else if (payment.transferStatus === 'available') {
        // NEW: Available for withdrawal (released from 24hr hold)
        paymentStatus = 'succeeded'; // Frontend will show as "Available"
      } else if (isClassPayment && classStatus === 'scheduled') {
        // Class is scheduled but hasn't happened yet
        paymentStatus = 'class_scheduled';
      } else if (payment.transferStatus === 'on_hold') {
        // On hold during 24hr period (class/lesson has completed)
        paymentStatus = 'pending';
      } else if (payment.revenueRecognized && lessonStatus === 'completed') {
        paymentStatus = 'pending';
      } else if (lessonStatus === 'in_progress' || classStatus === 'in_progress') {
        paymentStatus = 'in_progress';
      } else if (lessonStatus === 'ended_early' && payment.revenueRecognized) {
        paymentStatus = 'processing';
      } else if (lessonStatus === 'scheduled') {
        paymentStatus = 'scheduled';
      }

      const studentName = payment.studentId 
        ? `${payment.studentId.firstName || payment.studentId.name || 'Student'} ${(payment.studentId.lastName || '').charAt(0)}.`
        : 'Student';
      
      const studentPicture = payment.studentId?.picture || null;

      // Use class times as fallback when lessonId is not present
      const startTime = payment.lessonId?.startTime || payment.classId?.startTime || null;
      const endTime = payment.lessonId?.endTime || payment.classId?.endTime || null;

      return {
        id: payment._id,
        studentName,
        studentPicture,
        date: startTime || payment.createdAt,
        startTime,
        endTime,
        amount: payment.amount || 0,
        tutorPayout,
        platformFee: payment.platformFee || 0,
        refundAmount: payment.refundAmount || 0,
        refundReason: payment.refundReason || null,
        status: paymentStatus,
        lessonStatus: lessonStatus,
        classStatus: classStatus || null,
        cancelReason: payment.lessonId?.cancelReason || null,
        lessonId: payment.lessonId?._id || null,
        classId: payment.classId?._id || null,
        className: payment.classId?.name || null,
        isClassPayment,
        paymentType: payment.paymentType || 'lesson_booking',
        receiptUrl: payment.receiptUrl || null,
        stripeChargeId: payment.stripeChargeId || null,
        paypalTransactionId: payment.paypalTransactionId || null
      };
    });
    
    // Apply filters
    let filteredPayments = recentPayments;
    
    // Status filter
    if (req.query.status && req.query.status !== 'all') {
      filteredPayments = filteredPayments.filter(p => p.status === req.query.status);
    }
    
    // Date range filter
    if (req.query.dateFrom) {
      const dateFrom = new Date(req.query.dateFrom);
      filteredPayments = filteredPayments.filter(p => new Date(p.date) >= dateFrom);
    }
    if (req.query.dateTo) {
      const dateTo = new Date(req.query.dateTo);
      dateTo.setHours(23, 59, 59, 999); // End of day
      filteredPayments = filteredPayments.filter(p => new Date(p.date) <= dateTo);
    }
    
    // Student search filter
    if (req.query.studentSearch) {
      const searchTerm = req.query.studentSearch.toString().toLowerCase();
      filteredPayments = filteredPayments.filter(p => 
        p.studentName.toLowerCase().includes(searchTerm)
      );
    }

    console.log(`💰 Tutor earnings - Total: $${totalEarnings}, Pending: $${pendingEarnings}, Returned: ${filteredPayments.length} payments`);

    res.json({
      success: true,
      totalEarnings,
      pendingEarnings,
      recentPayments: filteredPayments,
      page,
      hasMore: payments.length === limit, // If we got full page, there might be more
      payoutProvider: user.payoutProvider || 'unknown',
      payoutDetails: user.payoutDetails
    });
  } catch (error) {
    console.error('❌ Error fetching tutor earnings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/payments/payout-options
 * Get recommended payout provider based on tutor's residence country
 */
router.get('/payout-options', verifyToken, async (req, res) => {
  try {
    // Try to find user by auth0Id first, then by email as fallback
    let user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user && req.user.email) {
      console.log('🔍 [PAYOUT-OPTIONS] User not found by auth0Id, trying email:', req.user.email);
      user = await User.findOne({ email: req.user.email });
      
      // If found by email, update the auth0Id to match the current token
      if (user) {
        console.log('🔍 [PAYOUT-OPTIONS] Found user by email, updating auth0Id');
        user.auth0Id = req.user.sub;
        await user.save();
      }
    }
    
    if (!user) {
      console.log('❌ [PAYOUT-OPTIONS] User not found by auth0Id or email');
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can check payout options' });
    }

    // 🔄 MIGRATION: Fix users who have Stripe connected but payoutProvider = 'none'
    // This happened to users who onboarded before we implemented the payoutProvider field
    if (user.stripeConnectOnboarded === true && user.payoutProvider === 'none') {
      console.log(`🔄 [MIGRATION] Fixing payoutProvider for ${user.email} - has Stripe but provider is 'none'`);
      user.payoutProvider = 'stripe';
      await user.save();
      console.log(`✅ [MIGRATION] Set payoutProvider to 'stripe' for ${user.email}`);
    }

    const { isStripeAvailable, getRecommendedPayoutProvider } = require('../utils/stripeCountries');
    
    const residenceCountry = user.residenceCountry || user.country || '';
    const stripeAvailable = isStripeAvailable(residenceCountry);
    const recommendedProvider = getRecommendedPayoutProvider(residenceCountry);
    
    res.json({
      success: true,
      residenceCountry,
      options: {
        stripe: {
          available: stripeAvailable,
          recommended: recommendedProvider === 'stripe',
          label: 'Stripe Connect',
          description: 'Direct bank transfers (fastest payouts)'
        },
        paypal: {
          available: true, // PayPal available in 200+ countries
          recommended: recommendedProvider === 'paypal',
          label: 'PayPal',
          description: 'Receive payments via PayPal account'
        },
        manual: {
          available: true, // Always available as fallback
          recommended: false,
          label: 'Manual Bank Transfer',
          description: 'Request withdrawals via bank transfer (slower)'
        }
      },
      currentProvider: user.payoutProvider || 'none',
      currentPaypalEmail: user.payoutDetails?.paypalEmail || null,
      // Tax classification info
      isUSPersonForTax: user.isUSPersonForTax,
      hasUSBankAccount: user.hasUSBankAccount,
      taxInfoCompletedAt: user.taxInfoCompletedAt
    });
  } catch (error) {
    console.error('❌ Error checking payout options:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/payments/stripe-connect/status
 * Check Stripe Connect onboarding status
 */
router.get('/stripe-connect/status', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.stripeConnectAccountId) {
      return res.json({
        success: true,
        onboarded: false,
        accountId: null
      });
    }

    const account = await stripeService.getAccount(user.stripeConnectAccountId);

    const onboarded = account.charges_enabled && account.payouts_enabled;
    const wasJustOnboarded = onboarded && !user.stripeConnectOnboarded;

    // Update user if onboarding completed
    if (wasJustOnboarded) {
      user.stripeConnectOnboarded = true;
      user.stripeConnectOnboardedAt = new Date();
      user.stripePayoutsEnabled = true; // Enable payouts (required for withdrawals)
      user.payoutProvider = 'stripe'; // Set payout provider when Stripe is connected
      
      // Check if all tutor approval steps are now complete
      user.tutorOnboarding = user.tutorOnboarding || {};
      const photoComplete = user.tutorOnboarding.photoUploaded || !!user.picture;
      const videoApproved = user.tutorOnboarding.videoApproved === true;
      const stripeComplete = true; // We just completed it
      
      if (photoComplete && videoApproved && stripeComplete && !user.tutorApproved) {
        user.tutorApproved = true;
        user.tutorOnboarding.stripeConnected = true;
        user.tutorOnboarding.completedAt = new Date();
        console.log(`🎉 Tutor ${user.email} is now FULLY APPROVED (all steps complete)`);
      }
      
      await user.save();
      console.log(`✅ Tutor ${user.email} completed Stripe Connect onboarding`);

      // 🔄 AUTO-RETRY: Automatically retry any pending transfers from before onboarding
      try {
        const Payment = require('../models/Payment');
        const pendingPayments = await Payment.find({
          tutorId: user._id,
          status: 'succeeded',
          $or: [
            { transferStatus: 'pending' },
            { transferStatus: null },
            { transferStatus: 'failed' } // Also retry previously failed transfers
          ]
        });

        if (pendingPayments.length > 0) {
          console.log(`🔄 Auto-retrying ${pendingPayments.length} pending transfers for newly onboarded tutor...`);
          
          for (const payment of pendingPayments) {
            try {
              const transfer = await stripeService.createTransfer({
                amount: payment.tutorPayout,
                destination: user.stripeConnectAccountId,
                metadata: {
                  lessonId: payment.lessonId?.toString() || 'unknown',
                  tutorId: user._id.toString(),
                  paymentId: payment._id.toString(),
                  autoRetry: true
                }
              });

              payment.stripeTransferId = transfer.id;
              payment.stripeTransferAmount = payment.tutorPayout;
              payment.transferredAt = new Date();
              payment.transferStatus = 'succeeded';
              await payment.save();

              // Emit WebSocket event for real-time update
              if (global.io) {
                const tutorSocketRoom = `user:${user._id}`;
                global.io.to(tutorSocketRoom).emit('payment_status_changed', {
                  paymentId: payment._id.toString(),
                  lessonId: payment.lessonId?.toString() || null,
                  status: 'paid', // Frontend uses 'paid' status for transferred payments
                  transferStatus: 'succeeded',
                  updatedAt: new Date()
                });
                console.log(`📡 Emitted payment_status_changed to ${tutorSocketRoom}`);
              }

              console.log(`✅ Auto-transferred $${payment.tutorPayout} (${transfer.id})`);
            } catch (transferError) {
              console.error(`❌ Auto-transfer failed for payment ${payment._id}:`, transferError.message);
              payment.transferStatus = 'failed';
              await payment.save();
            }
          }
        }
      } catch (retryError) {
        console.error('❌ Error during auto-retry of pending transfers:', retryError);
        // Don't fail the whole request if retry fails
      }
    }

    // Always sync stripePayoutsEnabled with Stripe's current status
    if (user.stripePayoutsEnabled !== account.payouts_enabled) {
      user.stripePayoutsEnabled = account.payouts_enabled;
      await user.save();
      console.log(`🔄 Synced stripePayoutsEnabled to ${account.payouts_enabled} for ${user.email}`);
    }

    res.json({
      success: true,
      onboarded,
      accountId: user.stripeConnectAccountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted
    });
  } catch (error) {
    console.error('❌ Error checking Stripe Connect status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/payments/save-payment-method
 * Save a payment method for future use
 * Body: { paymentMethodId: string, setAsDefault?: boolean }
 */
router.post('/save-payment-method', verifyToken, async (req, res) => {
  try {
    const { paymentMethodId, setAsDefault = true } = req.body;
    
    console.log('💳 [SAVE CARD] Request received:', { paymentMethodId, setAsDefault, userId: req.user.sub });
    
    if (!paymentMethodId) {
      return res.status(400).json({ success: false, message: 'Payment method ID required' });
    }
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      console.error('❌ [SAVE CARD] User not found:', req.user.sub);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    console.log('👤 [SAVE CARD] User found:', {
      email: user.email,
      existingCustomerId: user.stripeCustomerId,
      existingSavedCards: user.savedPaymentMethods?.length || 0
    });
    
    // Ensure user has a Stripe customer ID
    if (!user.stripeCustomerId) {
      console.log('🆕 [SAVE CARD] Creating new Stripe customer...');
      const customer = await stripeService.createCustomer({
        email: user.email,
        name: user.name,
        metadata: {
          userId: user._id.toString(),
          auth0Id: user.auth0Id
        }
      });
      user.stripeCustomerId = customer.id;
      console.log('✅ [SAVE CARD] Stripe customer created:', customer.id);
    } else {
      console.log('✅ [SAVE CARD] Using existing Stripe customer:', user.stripeCustomerId);
    }
    
    // Attach payment method to customer in Stripe
    console.log('🔗 [SAVE CARD] Attaching payment method to customer...');
    await stripeService.attachPaymentMethod(paymentMethodId, user.stripeCustomerId);
    console.log('✅ [SAVE CARD] Payment method attached');
    
    // Get payment method details from Stripe
    const paymentMethod = await stripeService.getPaymentMethod(paymentMethodId);
    console.log('💳 [SAVE CARD] Payment method details:', {
      brand: paymentMethod.card.brand,
      last4: paymentMethod.card.last4,
      exp: `${paymentMethod.card.exp_month}/${paymentMethod.card.exp_year}`
    });
    
    // Check if this card (by last4 and brand) already exists
    const existingIndex = user.savedPaymentMethods.findIndex(
      pm => pm.last4 === paymentMethod.card.last4 && pm.brand === paymentMethod.card.brand
    );
    
    if (existingIndex !== -1) {
      console.log(`♻️ [SAVE CARD] Updating existing card (${paymentMethod.card.brand} ****${paymentMethod.card.last4})`);
      
      // Update existing card details (in case of re-authorization)
      user.savedPaymentMethods[existingIndex].stripePaymentMethodId = paymentMethodId;
      user.savedPaymentMethods[existingIndex].expiryMonth = paymentMethod.card.exp_month;
      user.savedPaymentMethods[existingIndex].expiryYear = paymentMethod.card.exp_year;
      
      // Update default status if requested
      if (setAsDefault) {
        user.savedPaymentMethods.forEach((pm, idx) => {
          pm.isDefault = idx === existingIndex;
        });
      }
    } else {
      console.log(`➕ [SAVE CARD] Adding new card (${paymentMethod.card.brand} ****${paymentMethod.card.last4})`);
      
      // Add new payment method
      user.savedPaymentMethods.push({
        stripePaymentMethodId: paymentMethodId,
        brand: paymentMethod.card.brand,
        last4: paymentMethod.card.last4,
        expiryMonth: paymentMethod.card.exp_month,
        expiryYear: paymentMethod.card.exp_year,
        country: paymentMethod.card.country, // Store card country for fee calculation
        isDefault: setAsDefault,
        createdAt: new Date()
      });
      
      // If setting as default, unset other defaults
      if (setAsDefault) {
        user.savedPaymentMethods.forEach((pm, idx) => {
          if (idx !== user.savedPaymentMethods.length - 1) {
            pm.isDefault = false;
          }
        });
      }
    }
    
    console.log('💾 [SAVE CARD] Saving user to database...');
    await user.save();
    console.log('✅ [SAVE CARD] User saved successfully');
    console.log('📊 [SAVE CARD] Final state:', {
      stripeCustomerId: user.stripeCustomerId,
      totalCards: user.savedPaymentMethods.length,
      cards: user.savedPaymentMethods.map(pm => `${pm.brand} ****${pm.last4} (default: ${pm.isDefault})`)
    });
    
    res.json({
      success: true,
      message: 'Payment method saved',
      paymentMethods: user.savedPaymentMethods,
      stripeCustomerId: user.stripeCustomerId // Return customer ID for immediate use
    });
  } catch (error) {
    console.error('❌ [SAVE CARD] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/payments/payment-methods
 * Get user's saved payment methods
 */
router.get('/payment-methods', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Map payment methods to include type and id fields
    const paymentMethods = (user.savedPaymentMethods || []).map(pm => ({
      id: pm._id.toString(),
      type: 'card', // All saved payment methods are cards
      stripePaymentMethodId: pm.stripePaymentMethodId,
      brand: pm.brand,
      last4: pm.last4,
      expiryMonth: pm.expiryMonth,
      expiryYear: pm.expiryYear,
      country: pm.country, // Include card country for fee calculation
      isDefault: pm.isDefault,
      createdAt: pm.createdAt
    }));
    
    console.log('📤 Returning payment methods:', paymentMethods.length, 'cards');
    
    res.json({
      success: true,
      paymentMethods
    });
  } catch (error) {
    console.error('❌ Error getting payment methods:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/payments/payment-method/:paymentMethodId
 * Remove a saved payment method
 */
router.delete('/payment-method/:paymentMethodId', verifyToken, async (req, res) => {
  try {
    const { paymentMethodId } = req.params;
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Remove from user's saved methods
    const removedMethod = user.savedPaymentMethods.find(
      pm => pm.stripePaymentMethodId === paymentMethodId
    );
    
    user.savedPaymentMethods = user.savedPaymentMethods.filter(
      pm => pm.stripePaymentMethodId !== paymentMethodId
    );
    
    // If removed method was default and there are other methods, set first as default
    if (removedMethod?.isDefault && user.savedPaymentMethods.length > 0) {
      user.savedPaymentMethods[0].isDefault = true;
    }
    
    await user.save();
    
    // Detach from Stripe (optional - keeps history)
    try {
      await stripeService.detachPaymentMethod(paymentMethodId);
    } catch (stripeError) {
      console.warn('Could not detach payment method from Stripe:', stripeError.message);
    }
    
    res.json({
      success: true,
      message: 'Payment method removed',
      paymentMethods: user.savedPaymentMethods
    });
  } catch (error) {
    console.error('❌ Error removing payment method:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/payments/payment-method/:paymentMethodId/default
 * Set a payment method as default
 */
router.put('/payment-method/:paymentMethodId/default', verifyToken, async (req, res) => {
  try {
    const { paymentMethodId } = req.params;
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Set all to non-default, then set the selected one as default
    user.savedPaymentMethods.forEach(pm => {
      pm.isDefault = pm.stripePaymentMethodId === paymentMethodId;
    });
    
    await user.save();
    
    res.json({
      success: true,
      message: 'Default payment method updated',
      paymentMethods: user.savedPaymentMethods
    });
  } catch (error) {
    console.error('❌ Error setting default payment method:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/payments/setup-paypal
 * Setup PayPal as payout method
 */
router.post('/setup-paypal', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can setup payout methods' });
    }

    const { paypalEmail, isUSPersonForTax, hasUSBankAccount } = req.body;
    
    if (!paypalEmail || !paypalEmail.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid PayPal email required' });
    }

    // Save tax classification info if provided
    if (isUSPersonForTax !== undefined) {
      user.isUSPersonForTax = isUSPersonForTax;
      user.taxInfoCompletedAt = new Date();
      console.log(`📋 Tax info saved for ${user.email}: isUSPerson=${isUSPersonForTax}`);
    }
    if (hasUSBankAccount !== undefined) {
      user.hasUSBankAccount = hasUSBankAccount;
      console.log(`📋 Bank info saved for ${user.email}: hasUSBank=${hasUSBankAccount}`);
    }

    // Update payout provider
    user.payoutProvider = 'paypal';
    user.payoutDetails = user.payoutDetails || {};
    user.payoutDetails.paypalEmail = paypalEmail;
    
    // Mark payout setup as complete for onboarding
    user.tutorOnboarding = user.tutorOnboarding || {};
    user.tutorOnboarding.stripeConnected = true; // Use same flag for any payout method
    
    // Check if all onboarding steps complete
    const photoComplete = user.tutorOnboarding.photoUploaded || !!user.picture;
    const videoApproved = user.tutorOnboarding.videoApproved === true;
    const payoutComplete = true; // Just completed
    
    if (photoComplete && videoApproved && payoutComplete && !user.tutorApproved) {
      user.tutorApproved = true;
      user.tutorOnboarding.completedAt = new Date();
      console.log(`🎉 Tutor ${user.email} is now FULLY APPROVED (PayPal setup)`);
    }
    
    await user.save();
    
    console.log(`✅ PayPal setup complete for tutor ${user.email}: ${paypalEmail}`);
    
    res.json({
      success: true,
      message: 'PayPal setup complete',
      payoutProvider: 'paypal'
    });
  } catch (error) {
    console.error('❌ Error setting up PayPal:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/payments/setup-manual
 * Setup manual bank transfer as payout method
 */
router.post('/setup-manual', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can setup payout methods' });
    }

    const { isUSPersonForTax, hasUSBankAccount } = req.body;

    // Save tax classification info if provided
    if (isUSPersonForTax !== undefined) {
      user.isUSPersonForTax = isUSPersonForTax;
      user.taxInfoCompletedAt = new Date();
      console.log(`📋 Tax info saved for ${user.email}: isUSPerson=${isUSPersonForTax}`);
    }
    if (hasUSBankAccount !== undefined) {
      user.hasUSBankAccount = hasUSBankAccount;
      console.log(`📋 Bank info saved for ${user.email}: hasUSBank=${hasUSBankAccount}`);
    }

    // Update payout provider
    user.payoutProvider = 'manual';
    
    // Mark payout setup as complete for onboarding
    user.tutorOnboarding = user.tutorOnboarding || {};
    user.tutorOnboarding.stripeConnected = true; // Use same flag for any payout method
    
    // Check if all onboarding steps complete
    const photoComplete = user.tutorOnboarding.photoUploaded || !!user.picture;
    const videoApproved = user.tutorOnboarding.videoApproved === true;
    const payoutComplete = true; // Just completed
    
    if (photoComplete && videoApproved && payoutComplete && !user.tutorApproved) {
      user.tutorApproved = true;
      user.tutorOnboarding.completedAt = new Date();
      console.log(`🎉 Tutor ${user.email} is now FULLY APPROVED (Manual payout setup)`);
    }
    
    await user.save();
    
    console.log(`✅ Manual payout setup complete for tutor ${user.email}`);
    
    res.json({
      success: true,
      message: 'Manual payout method configured',
      payoutProvider: 'manual'
    });
  } catch (error) {
    console.error('❌ Error setting up manual payout:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/payments/deduplicate-cards
 * Remove duplicate saved cards (keeps most recent for each unique last4+brand combo)
 */
router.post('/deduplicate-cards', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const originalCount = user.savedPaymentMethods.length;
    
    // Group by last4+brand
    const uniqueCards = new Map();
    user.savedPaymentMethods.forEach(card => {
      const key = `${card.brand}-${card.last4}`;
      const existing = uniqueCards.get(key);
      
      // Keep the most recent one (by createdAt) or the default one
      if (!existing || card.isDefault || (card.createdAt > existing.createdAt)) {
        uniqueCards.set(key, card);
      }
    });
    
    // Replace with deduplicated cards
    user.savedPaymentMethods = Array.from(uniqueCards.values());
    
    // Ensure at least one card is default if cards exist
    if (user.savedPaymentMethods.length > 0) {
      const hasDefault = user.savedPaymentMethods.some(pm => pm.isDefault);
      if (!hasDefault) {
        user.savedPaymentMethods[0].isDefault = true;
      }
    }
    
    await user.save();
    
    const removedCount = originalCount - user.savedPaymentMethods.length;
    
    res.json({
      success: true,
      message: `Removed ${removedCount} duplicate card(s)`,
      originalCount,
      newCount: user.savedPaymentMethods.length,
      paymentMethods: user.savedPaymentMethods
    });
  } catch (error) {
    console.error('❌ Error deduplicating cards:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

