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

// Helper function to format names as "FirstName LastInitial."
const formatDisplayName = (user) => {
  if (!user) return 'Unknown User';
  
  const firstName = user.firstName || user.onboardingData?.firstName || user.name?.split(' ')[0] || '';
  const lastName = user.lastName || user.onboardingData?.lastName || '';
  
  if (firstName && lastName) {
    return `${firstName} ${lastName.charAt(0).toUpperCase()}.`;
  }
  
  if (firstName) {
    return firstName;
  }
  
  if (user.email) {
    return user.email.split('@')[0];
  }
  
  return 'Unknown User';
};

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
      stripeCustomerId,
      walletAmount = 0,
      paymentMethodAmount = 0,
      isHybridPayment = false
    } = req.body;

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

    // Check if this is a trial lesson (first lesson between student and tutor)
    const previousLessons = await Lesson.countDocuments({
      tutorId: tutor._id,
      studentId: user._id,
      isOfficeHours: { $ne: true }, // Exclude office hours
      status: { $in: ['scheduled', 'in_progress', 'completed'] }
    });
    
    const isTrialLesson = previousLessons === 0;
    
    console.log('🎓 Trial lesson check during booking:', {
      tutorId: tutor._id,
      studentId: user._id,
      previousScheduledLessons: previousLessons,
      isTrialLesson
    });

    // Generate a unique channel name for Agora
    const channelName = `lesson_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Create the lesson first with all required fields
    const lesson = new Lesson({
      ...lessonData,
      channelName,
      status: 'scheduled',
      billingStatus: 'pending',
      isTrialLesson // Add trial lesson flag
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
                message: `${studentDisplayName} booked a trial lesson on ${new Date(populatedLesson.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${new Date(populatedLesson.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. Check your messages for preparation tips.`,
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
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can view earnings' });
    }

    const Payment = require('../models/Payment');
    const Lesson = require('../models/Lesson');

    console.log(`💰 Fetching earnings for tutor ${user._id}...`);

    // Get ALL payments for this tutor (including in-progress and ended early)
    // Exclude 'acknowledged' status (dismissed failed payouts that shouldn't count)
    const payments = await Payment.find({ 
      tutorId: user._id,
      transferStatus: { $ne: 'acknowledged' } // Exclude dismissed payments
    })
      .populate('lessonId', 'startTime endTime duration status')
      .populate('studentId', 'name firstName lastName')
      .sort({ createdAt: -1 }) // Sort by booking date
      .limit(20);

    console.log(`💰 Found ${payments.length} payments for tutor ${user._id}`);

    // Calculate totals (only count completed lessons for totals)
    let totalEarnings = 0; // Earnings that have been successfully transferred
    let pendingEarnings = 0; // Earnings that are pending transfer

    const recentPayments = payments.map(payment => {
      const tutorPayout = payment.tutorPayout || 0;
      const lessonStatus = payment.lessonId?.status || 'unknown';
      
      console.log(`💰 Payment ${payment._id}: payout=$${tutorPayout}, transferStatus=${payment.transferStatus}, revenueRecognized=${payment.revenueRecognized}, lessonStatus=${lessonStatus}`);
      
      // Only count completed lessons in the totals
      if (payment.revenueRecognized) {
        if (payment.transferStatus === 'succeeded') {
          totalEarnings += tutorPayout;
        } else {
          pendingEarnings += tutorPayout;
        }
      }

      const studentName = payment.studentId 
        ? `${payment.studentId.firstName || payment.studentId.name || 'Student'} ${(payment.studentId.lastName || '').charAt(0)}.`
        : 'Student';

      // Determine payment status based on lesson status
      let paymentStatus = 'pending';
      if (lessonStatus === 'completed' && payment.transferStatus === 'succeeded') {
        paymentStatus = 'paid';
      } else if (lessonStatus === 'completed' && payment.revenueRecognized) {
        paymentStatus = 'pending';
      } else if (lessonStatus === 'in_progress') {
        paymentStatus = 'in_progress';
      } else if (lessonStatus === 'ended_early') {
        paymentStatus = 'processing';
      } else if (lessonStatus === 'scheduled') {
        paymentStatus = 'scheduled';
      }

      return {
        id: payment._id,
        studentName,
        date: payment.lessonId?.startTime || payment.createdAt,
        tutorPayout,
        platformFee: payment.platformFee || 0,
        status: paymentStatus,
        lessonStatus: lessonStatus,
        lessonId: payment.lessonId?._id
      };
    });

    console.log(`💰 Tutor earnings - Total: $${totalEarnings}, Pending: $${pendingEarnings}`);

    res.json({
      success: true,
      totalEarnings,
      pendingEarnings,
      recentPayments,
      payoutProvider: user.payoutProvider || 'unknown', // Add payout provider for frontend label
      payoutDetails: user.payoutDetails // In case frontend needs it
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
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can check payout options' });
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
      currentProvider: user.payoutProvider || 'none'
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
    
    res.json({
      success: true,
      paymentMethods: user.savedPaymentMethods || []
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

    const { paypalEmail } = req.body;
    
    if (!paypalEmail || !paypalEmail.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid PayPal email required' });
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

