/**
 * Payment Service - Orchestrates payment flows
 * 
 * Handles:
 * - Lesson bookings (wallet or card)
 * - Office hours per-minute billing
 * - Lesson completion and tutor payouts
 * - Refunds (wallet preferred, card fallback)
 * - Platform fee calculation and revenue recognition
 */

const Payment = require('../models/Payment');
const Lesson = require('../models/Lesson');
const User = require('../models/User');
const Notification = require('../models/Notification'); // NEW
const walletService = require('./walletService');
const stripeService = require('./stripeService');

class PaymentService {
  // Platform fee: 20% of lesson price
  PLATFORM_FEE_PERCENTAGE = 20;

  /**
   * Book a lesson with wallet or card payment, or hybrid (wallet + card)
   * @param {Object} params
   * @param {string} params.userId - Student's MongoDB ID
   * @param {string} params.lessonId - Lesson's MongoDB ID
   * @param {string} params.paymentMethod - 'wallet', 'card', 'saved-card', 'apple_pay', 'google_pay'
   * @param {string} params.stripePaymentIntentId - Required for card/Apple Pay payments
   * @param {number} params.walletAmount - Amount to deduct from wallet (0 for no wallet)
   * @param {number} params.paymentMethodAmount - Amount to charge to payment method
   * @param {boolean} params.isHybridPayment - True if using both wallet and payment method
   * @returns {Promise<Object>} Payment and Lesson objects
   */
  async bookLesson({ 
    userId, 
    lessonId, 
    paymentMethod, 
    stripePaymentIntentId = null, 
    stripePaymentMethodId = null, 
    stripeCustomerId = null,
    walletAmount = 0,
    paymentMethodAmount = 0,
    isHybridPayment = false
  }) {
    const lesson = await Lesson.findById(lessonId).populate('tutorId studentId');
    
    if (!lesson) {
      throw new Error('Lesson not found');
    }

    if (lesson.studentId._id.toString() !== userId.toString()) {
      throw new Error('Unauthorized: You are not the student for this lesson');
    }

    const amount = lesson.price;
    const platformFee = amount * (this.PLATFORM_FEE_PERCENTAGE / 100);
    const tutorPayout = amount - platformFee;

    let payment;
    const payments = []; // For hybrid payments, we might create multiple payment records

    // HYBRID PAYMENT: Wallet + Payment Method
    if (isHybridPayment && walletAmount > 0 && paymentMethodAmount > 0) {
      console.log(`🔀 Hybrid payment detected: $${walletAmount} from wallet + $${paymentMethodAmount} from ${paymentMethod}`);
      
      // Step 1: Reserve wallet funds
      await walletService.reserveFunds({ userId, lessonId, amount: walletAmount });

      // Step 2: Create wallet payment record
      const walletPayment = await Payment.create({
        userId,
        studentId: lesson.studentId._id,
        tutorId: lesson.tutorId._id,
        lessonId,
        amount: walletAmount,
        paymentMethod: 'wallet',
        paymentType: 'lesson_booking',
        status: 'authorized',
        platformFee: walletAmount * (this.PLATFORM_FEE_PERCENTAGE / 100),
        platformFeePercentage: this.PLATFORM_FEE_PERCENTAGE,
        tutorPayout: walletAmount - (walletAmount * (this.PLATFORM_FEE_PERCENTAGE / 100)),
        metadata: {
          lessonPrice: lesson.price,
          lessonDuration: lesson.duration,
          isTrialLesson: lesson.isTrialLesson,
          isHybridPayment: true,
          hybridPartner: paymentMethod
        }
      });
      payments.push(walletPayment);

      // Step 3: Handle payment method (saved-card, card, apple_pay, google_pay)
      if (paymentMethod === 'saved-card') {
        if (!stripePaymentMethodId || !stripeCustomerId) {
          throw new Error('Stripe Payment Method ID and Customer ID required for saved card payments');
        }

        const tutor = lesson.tutorId;
        if (!tutor.stripeConnectAccountId) {
          throw new Error('Tutor has not connected their Stripe account');
        }

        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(paymentMethodAmount * 100),
          currency: 'usd',
          customer: stripeCustomerId,
          payment_method: stripePaymentMethodId,
          confirm: true,
          off_session: true,
          application_fee_amount: Math.round((paymentMethodAmount * (this.PLATFORM_FEE_PERCENTAGE / 100)) * 100),
          transfer_data: {
            destination: tutor.stripeConnectAccountId
          },
          metadata: {
            lessonId: lessonId.toString(),
            studentId: lesson.studentId._id.toString(),
            tutorId: tutor._id.toString(),
            paymentType: 'lesson_booking',
            isHybridPayment: true
          }
        });

        if (paymentIntent.status !== 'succeeded') {
          throw new Error(`Payment failed: ${paymentIntent.status}`);
        }

        const cardPayment = await Payment.create({
          userId,
          studentId: lesson.studentId._id,
          tutorId: tutor._id,
          lessonId,
          amount: paymentMethodAmount,
          paymentMethod: 'saved-card',
          paymentType: 'lesson_booking',
          status: 'authorized',
          stripePaymentIntentId: paymentIntent.id,
          platformFee: paymentMethodAmount * (this.PLATFORM_FEE_PERCENTAGE / 100),
          platformFeePercentage: this.PLATFORM_FEE_PERCENTAGE,
          tutorPayout: paymentMethodAmount - (paymentMethodAmount * (this.PLATFORM_FEE_PERCENTAGE / 100)),
          metadata: {
            lessonPrice: lesson.price,
            lessonDuration: lesson.duration,
            isTrialLesson: lesson.isTrialLesson,
            stripePaymentMethodId,
            stripeCustomerId,
            isHybridPayment: true,
            hybridPartner: 'wallet'
          }
        });
        payments.push(cardPayment);
      }

      // Use the wallet payment as the primary payment record
      payment = walletPayment;
      
      console.log(`✅ Hybrid payment completed: Wallet $${walletAmount} + ${paymentMethod} $${paymentMethodAmount}`);
    } else if (paymentMethod === 'wallet') {
      // Reserve funds from wallet (don't deduct yet)
      await walletService.reserveFunds({ userId, lessonId, amount });

      // Create payment record
      payment = await Payment.create({
        userId,
        studentId: lesson.studentId._id,
        tutorId: lesson.tutorId._id,
        lessonId,
        amount,
        paymentMethod: 'wallet',
        paymentType: 'lesson_booking',
        status: 'authorized', // Funds reserved, will be marked 'succeeded' when lesson completes
        platformFee,
        platformFeePercentage: this.PLATFORM_FEE_PERCENTAGE,
        tutorPayout,
        metadata: {
          lessonPrice: lesson.price,
          lessonDuration: lesson.duration,
          isTrialLesson: lesson.isTrialLesson
        }
      });

      console.log(`💼 Lesson booked with wallet: ${lessonId} for user ${userId} - payment authorized`);
    } else if (paymentMethod === 'saved-card') {
      // Handle saved card payment
      if (!stripePaymentMethodId || !stripeCustomerId) {
        throw new Error('Stripe Payment Method ID and Customer ID required for saved card payments');
      }

      // Get tutor's Stripe Connect account ID
      const tutor = lesson.tutorId;
      if (!tutor.stripeConnectAccountId) {
        throw new Error('Tutor has not connected their Stripe account');
      }

      // Create PaymentIntent with saved card and Stripe Connect
      // Note: We call Stripe directly here instead of using stripeService.createPaymentIntent
      // because we need to pass additional params (confirm, off_session, application_fee_amount, transfer_data)
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: stripePaymentMethodId,
        confirm: true, // Automatically confirm the payment
        off_session: true, // Payment is made while customer is not present
        application_fee_amount: Math.round(platformFee * 100), // Platform fee in cents
        transfer_data: {
          destination: tutor.stripeConnectAccountId
        },
        metadata: {
          lessonId: lessonId.toString(),
          studentId: lesson.studentId._id.toString(),
          tutorId: tutor._id.toString(),
          paymentType: 'lesson_booking'
        }
      });

      if (paymentIntent.status !== 'succeeded') {
        throw new Error(`Payment failed: ${paymentIntent.status}`);
      }

      // Create payment record
      payment = await Payment.create({
        userId,
        studentId: lesson.studentId._id,
        tutorId: tutor._id,
        lessonId,
        amount,
        paymentMethod: 'saved-card',
        paymentType: 'lesson_booking',
        status: 'authorized', // Will be marked 'succeeded' when lesson completes
        stripePaymentIntentId: paymentIntent.id,
        platformFee,
        platformFeePercentage: this.PLATFORM_FEE_PERCENTAGE,
        tutorPayout,
        metadata: {
          lessonPrice: lesson.price,
          lessonDuration: lesson.duration,
          isTrialLesson: lesson.isTrialLesson,
          stripePaymentMethodId,
          stripeCustomerId
        }
      });

      console.log(`💼 Lesson booked with saved card: ${lessonId} for user ${userId} - payment authorized`);
    } else if (paymentMethod === 'card' || paymentMethod === 'apple_pay') {
      // Verify Stripe PaymentIntent exists and succeeded
      if (!stripePaymentIntentId) {
        throw new Error('Stripe PaymentIntent ID required for card payments');
      }

      const paymentIntent = await stripeService.getPaymentIntent(stripePaymentIntentId);
      
      if (paymentIntent.status !== 'succeeded') {
        throw new Error(`Payment failed: ${paymentIntent.status}`);
      }

      // Extract Stripe fees
      const charges = paymentIntent.charges?.data || [];
      const stripeFee = charges.length > 0 ? (charges[0].application_fee_amount || 0) / 100 : 0;
      const stripeNetAmount = paymentIntent.amount_received / 100;

      // Create payment record
      payment = await Payment.create({
        userId,
        studentId: lesson.studentId._id,
        tutorId: lesson.tutorId._id,
        lessonId,
        amount,
        paymentMethod,
        paymentType: 'lesson_booking',
        status: 'authorized', // Funds reserved, will be marked 'succeeded' when lesson completes
        stripePaymentIntentId,
        stripeChargeId: charges[0]?.id || null,
        stripeFee,
        stripeNetAmount,
        platformFee,
        platformFeePercentage: this.PLATFORM_FEE_PERCENTAGE,
        tutorPayout,
        metadata: {
          lessonPrice: lesson.price,
          lessonDuration: lesson.duration,
          isTrialLesson: lesson.isTrialLesson
        }
      });

      console.log(`💳 Lesson booked with ${paymentMethod}: ${lessonId} for user ${userId} - payment authorized`);
    } else {
      throw new Error(`Invalid payment method: ${paymentMethod}`);
    }

    // Link payment to lesson
    lesson.paymentId = payment._id;
    lesson.paymentMethod = paymentMethod;
    lesson.billingStatus = 'authorized'; // Funds reserved, not yet charged
    lesson.platformFee = platformFee;
    lesson.tutorPayout = tutorPayout;
    await lesson.save();

    console.log(`✅ Lesson ${lessonId} payment authorized: $${amount} (platform fee: $${platformFee}, tutor: $${tutorPayout})`);

    return { payment, lesson };
  }

  /**
   * Deduct funds when lesson STARTS (Preply model)
   * Called when lesson transitions to 'in_progress' status
   * @param {string} lessonId - Lesson's MongoDB ID
   * @returns {Promise<Object>} Updated payment and lesson
   */
  async deductLessonFunds(lessonId) {
    const lesson = await Lesson.findById(lessonId)
      .populate('tutorId studentId paymentId');

    if (!lesson) {
      throw new Error('Lesson not found');
    }

    const payment = lesson.paymentId;

    if (!payment) {
      console.warn(`⚠️  No payment found for lesson ${lessonId} - might be unpaid test lesson`);
      return { payment: null, lesson };
    }

    if (payment.status !== 'succeeded') {
      throw new Error(`Payment not in valid state for deduction: ${payment.status}`);
    }

    // Check if already deducted
    if (payment.chargedAt) {
      console.log(`ℹ️  Funds already deducted for lesson ${lessonId} at ${payment.chargedAt}`);
      return { payment, lesson };
    }

    const amount = lesson.price;

    // Deduct from wallet (if wallet payment)
    if (payment.paymentMethod === 'wallet') {
      await walletService.deductFunds({
        userId: lesson.studentId._id,
        lessonId,
        amount,
        paymentId: payment._id
      });
      console.log(`💸 Deducted $${amount} from wallet at lesson start (lesson ${lessonId})`);
    }

    // Update payment record
    payment.chargedAt = new Date();
    await payment.save();

    // Update lesson billing status
    lesson.billingStatus = 'charged';
    await lesson.save();

    console.log(`✅ Funds deducted for lesson ${lessonId} at START (Preply model)`);

    return { payment, lesson };
  }

  /**
   * Complete lesson payment (called when lesson ends)
   * Transfers to tutor and recognizes platform revenue
   * Note: Wallet deduction now happens at lesson START, not end
   * @param {string} lessonId - Lesson's MongoDB ID
   * @param {Object} io - Socket.io instance for real-time notifications (optional)
   * @returns {Promise<Object>} Updated payment and lesson
   */
  async completeLessonPayment(lessonId, io = null) {
    const lesson = await Lesson.findById(lessonId)
      .populate('tutorId studentId paymentId');

    if (!lesson) {
      throw new Error('Lesson not found');
    }

    const payment = lesson.paymentId;

    if (!payment) {
      console.warn(`⚠️  No payment found for lesson ${lessonId} - might be unpaid test lesson`);
      return { payment: null, lesson };
    }

    if (payment.status !== 'succeeded') {
      throw new Error(`Payment not in valid state for completion: ${payment.status}`);
    }

    // Use actual price if available (for office hours per-minute billing)
    const finalAmount = lesson.actualPrice || lesson.price;
    const platformFee = finalAmount * (this.PLATFORM_FEE_PERCENTAGE / 100);
    const tutorPayout = finalAmount - platformFee;

    // Step 1: Wallet deduction - SKIP (already deducted at lesson start)
    // Funds were deducted when lesson started (deductLessonFunds method)
    if (payment.paymentMethod === 'wallet' && !payment.chargedAt) {
      console.warn(`⚠️  Wallet funds were not deducted at start - deducting now as fallback`);
      await walletService.deductFunds({
        userId: lesson.studentId._id,
        lessonId,
        amount: finalAmount,
        paymentId: payment._id
      });
      payment.chargedAt = new Date();
    }

    // Step 2: Transfer to tutor via Stripe Connect (if onboarded)
    let transferSucceeded = false;
    if (lesson.tutorId.stripeConnectAccountId && lesson.tutorId.stripeConnectOnboarded) {
      try {
        const transfer = await stripeService.createTransfer({
          amount: tutorPayout,
          destination: lesson.tutorId.stripeConnectAccountId,
          metadata: {
            lessonId: lessonId.toString(),
            tutorId: lesson.tutorId._id.toString(),
            studentId: lesson.studentId._id.toString(),
            paymentId: payment._id.toString()
          }
        });

        payment.stripeTransferId = transfer.id;
        payment.stripeTransferAmount = tutorPayout;
        payment.transferredAt = new Date();
        payment.transferStatus = 'succeeded';
        transferSucceeded = true;

        console.log(`💸 Transferred $${tutorPayout} to tutor ${lesson.tutorId._id} (Stripe Connect)`);
      } catch (error) {
        console.error(`❌ Transfer to tutor failed:`, error.message);
        payment.transferStatus = 'failed';
        payment.errorMessage = error.message;
      }
    } else {
      console.log(`⚠️  Tutor not onboarded to Stripe Connect - skipping payout for lesson ${lessonId}`);
      payment.transferStatus = 'pending';
    }

    // 🔔 NEW: Send notification to tutor when they earn money (regardless of transfer status)
    try {
      const studentName = lesson.studentId.firstName 
        ? `${lesson.studentId.firstName} ${(lesson.studentId.lastName || '').charAt(0)}.`
        : lesson.studentId.name || 'a student';
      
      const lessonDate = new Date(lesson.startTime).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });

      // Create notification in database
      const notification = new Notification({
        userId: lesson.tutorId._id,
        type: 'payment_received',
        title: '💰 Payment Received',
        message: `You earned $${tutorPayout.toFixed(2)} from your lesson on ${lessonDate} with ${studentName}`,
        data: {
          lessonId: lessonId.toString(),
          paymentId: payment._id.toString(),
          amount: tutorPayout,
          studentName,
          lessonDate,
          transferStatus: payment.transferStatus || 'pending'
        }
      });
      await notification.save();
      console.log(`📬 Payment notification created for tutor: ${notification._id}`);

      // Send real-time WebSocket notification if io instance provided
      if (io) {
        const { getUserSocketId } = require('../socket/socketManager');
        const tutorSocketId = await getUserSocketId(lesson.tutorId.auth0Id);
        
        if (tutorSocketId) {
          io.to(tutorSocketId).emit('payment_received', {
            notificationId: notification._id.toString(),
            title: notification.title,
            message: notification.message,
            amount: tutorPayout,
            lessonId: lessonId.toString(),
            studentName,
            lessonDate,
            transferStatus: payment.transferStatus || 'pending'
          });
          console.log(`🔔 Real-time payment notification sent to tutor via WebSocket`);
        } else {
          console.log(`ℹ️  Tutor not online - notification saved for later`);
        }
      }
    } catch (notificationError) {
      console.error(`❌ Error sending payment notification:`, notificationError);
      // Don't throw - notification failure shouldn't fail the payment
    }

    // Step 3: Update payment record
    payment.tutorPayout = tutorPayout;
    payment.platformFee = platformFee;
    payment.revenueRecognized = true; // NEW: Mark revenue as recognized
    payment.revenueRecognizedAt = new Date(); // NEW: Timestamp when revenue recognized
    await payment.save();

    // Step 4: Mark lesson billing complete and recognize revenue
    lesson.billingStatus = 'charged';
    lesson.revenueRecognized = true;
    lesson.revenueRecognizedAt = new Date();
    lesson.platformFee = platformFee;
    lesson.tutorPayout = tutorPayout;
    await lesson.save();

    console.log(`✅ Lesson payment completed: ${lessonId} ($${finalAmount}: platform $${platformFee}, tutor $${tutorPayout})`);

    return { payment, lesson };
  }

  /**
   * Refund a lesson (wallet preferred, card fallback)
   * @param {Object} params
   * @param {string} params.lessonId - Lesson's MongoDB ID
   * @param {string} params.refundMethod - 'wallet' or 'card' (null = auto-choose)
   * @param {string} params.reason - Reason for refund
   * @param {number} params.refundAmount - Amount to refund (null = full refund)
   * @returns {Promise<Object>} Updated payment and lesson
   */
  async refundLesson({ lessonId, refundMethod = null, reason, refundAmount = null }) {
    const lesson = await Lesson.findById(lessonId)
      .populate('tutorId studentId paymentId');

    if (!lesson) {
      throw new Error('Lesson not found');
    }

    const payment = lesson.paymentId;

    if (!payment) {
      throw new Error('No payment found for this lesson');
    }

    if (payment.status === 'refunded') {
      throw new Error('Lesson already refunded');
    }

    const amountToRefund = refundAmount || lesson.actualPrice || lesson.price;

    // Auto-choose refund method: prefer wallet, fallback to original method
    const finalRefundMethod = refundMethod || (payment.paymentMethod === 'wallet' ? 'wallet' : 'card');

    if (finalRefundMethod === 'wallet') {
      // Refund to wallet (preferred method)
      await walletService.refund({
        userId: lesson.studentId._id,
        lessonId,
        amount: amountToRefund,
        reason,
        paymentId: payment._id
      });

      payment.status = 'refunded';
      payment.refundAmount = amountToRefund;
      payment.refundedAt = new Date();
      payment.refundReason = reason;
      payment.refundMethod = 'wallet';

      console.log(`💰 Refunded $${amountToRefund} to wallet for lesson ${lessonId}`);
    } else if (finalRefundMethod === 'card' && payment.stripePaymentIntentId) {
      // Card refund via Stripe (fees are NOT refunded)
      const refund = await stripeService.createRefund({
        paymentIntentId: payment.stripePaymentIntentId,
        amount: amountToRefund,
        reason: 'requested_by_customer'
      });

      payment.status = 'refunded';
      payment.refundAmount = amountToRefund;
      payment.refundedAt = new Date();
      payment.refundReason = reason;
      payment.refundMethod = 'card';
      payment.stripeRefundId = refund.id;

      console.log(`💳 Refunded $${amountToRefund} to card for lesson ${lessonId} (Stripe fees NOT refunded)`);
    } else {
      throw new Error('Cannot process refund: invalid refund method or missing payment details');
    }

    await payment.save();

    // Update lesson
    lesson.billingStatus = 'refunded';
    lesson.revenueRecognized = false; // Reverse revenue recognition
    await lesson.save();

    console.log(`✅ Lesson refunded: ${lessonId} ($${amountToRefund})`);

    return { payment, lesson };
  }

  /**
   * Cancel a lesson before completion (release reserved funds)
   * @param {string} lessonId
   * @returns {Promise<Object>} Updated lesson
   */
  async cancelLesson(lessonId) {
    const lesson = await Lesson.findById(lessonId).populate('paymentId studentId');

    if (!lesson) {
      throw new Error('Lesson not found');
    }

    const payment = lesson.paymentId;

    if (payment && payment.paymentMethod === 'wallet' && payment.status === 'succeeded') {
      // Release reserved funds
      const amount = lesson.price;
      await walletService.releaseReservation({
        userId: lesson.studentId._id,
        lessonId,
        amount
      });

      payment.status = 'cancelled';
      await payment.save();

      console.log(`🔓 Released $${amount} for cancelled lesson ${lessonId}`);
    }

    lesson.status = 'cancelled';
    lesson.billingStatus = 'refunded';
    await lesson.save();

    return lesson;
  }

  /**
   * Get payment details for a lesson
   * @param {string} lessonId
   * @returns {Promise<Object>} Payment details
   */
  async getPaymentDetails(lessonId) {
    const payment = await Payment.findOne({ lessonId }).populate('userId lessonId');
    
    if (!payment) {
      throw new Error('Payment not found for this lesson');
    }

    return payment;
  }

  /**
   * Get payment history for a user
   * @param {string} userId
   * @param {number} limit
   * @returns {Promise<Array>} Payment history
   */
  async getPaymentHistory(userId, limit = 50) {
    const payments = await Payment.find({ userId })
      .populate('lessonId')
      .sort({ createdAt: -1 })
      .limit(limit);

    return payments;
  }
}

module.exports = new PaymentService();

