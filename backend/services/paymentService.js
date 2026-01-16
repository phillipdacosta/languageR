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
        stripeFee: 0, // Wallet portion has no Stripe fees
        stripeNetAmount: walletAmount, // Full amount since no fees
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
        
        // Check tutor's payout method
        const hasStripeConnect = tutor.stripeConnectAccountId && tutor.stripeConnectOnboarded;
        
        console.log(`💳 [HYBRID] Processing card portion for tutor with payout: ${tutor.payoutProvider}`, {
          hasStripeConnect,
          paymentMethodAmount
        });

        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const paymentIntentParams = {
          amount: Math.round(paymentMethodAmount * 100),
          currency: 'usd',
          customer: stripeCustomerId,
          payment_method: stripePaymentMethodId,
          capture_method: 'manual', // Hold funds, capture when lesson starts
          confirm: true,
          off_session: true,
          metadata: {
            lessonId: lessonId.toString(),
            studentId: lesson.studentId._id.toString(),
            tutorId: tutor._id.toString(),
            paymentType: 'lesson_booking',
            isHybridPayment: true,
            tutorPayoutProvider: tutor.payoutProvider || 'none'
          }
        };

        // Only use Stripe Connect transfer for Stripe tutors
        if (hasStripeConnect) {
          paymentIntentParams.application_fee_amount = Math.round((paymentMethodAmount * (this.PLATFORM_FEE_PERCENTAGE / 100)) * 100);
          paymentIntentParams.transfer_data = {
            destination: tutor.stripeConnectAccountId
          };
          console.log(`💸 [HYBRID] Using Stripe Connect transfer for tutor ${tutor._id}`);
        } else {
          console.log(`💰 [HYBRID] Collecting to platform for ${tutor.payoutProvider} tutor ${tutor._id}`);
        }

        const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

        if (paymentIntent.status !== 'requires_capture') {
          throw new Error(`Payment authorization failed: ${paymentIntent.status}`);
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
          stripeFee: 0, // Will be calculated when captured
          stripeNetAmount: paymentMethodAmount, // Will be updated after capture
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
        stripeFee: 0, // Wallet payments have no Stripe processing fees
        stripeNetAmount: amount, // Full amount since no fees
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

      // Get tutor info
      const tutor = lesson.tutorId;
      
      // Check tutor's payout method
      const hasStripeConnect = tutor.stripeConnectAccountId && tutor.stripeConnectOnboarded;
      const hasPayPal = tutor.payoutProvider === 'paypal' && !!tutor.payoutDetails?.paypalEmail;
      const hasManual = tutor.payoutProvider === 'manual';

      console.log(`💳 Processing saved-card payment for tutor with payout: ${tutor.payoutProvider}`, {
        hasStripeConnect,
        hasPayPal,
        hasManual
      });

      // Create PaymentIntent with saved card
      // Note: We call Stripe directly here instead of using stripeService.createPaymentIntent
      // because we need to pass additional params (confirm, off_session, etc.)
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const paymentIntentParams = {
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: stripePaymentMethodId,
        capture_method: 'manual', // Hold funds, capture when lesson starts
        confirm: true, // Automatically confirm the payment
        off_session: true, // Payment is made while customer is not present
        metadata: {
          lessonId: lessonId.toString(),
          studentId: lesson.studentId._id.toString(),
          tutorId: tutor._id.toString(),
          paymentType: 'lesson_booking',
          tutorPayoutProvider: tutor.payoutProvider || 'none'
        }
      };

      // Only use Stripe Connect transfer for Stripe tutors
      if (hasStripeConnect) {
        paymentIntentParams.application_fee_amount = Math.round(platformFee * 100); // Platform fee in cents
        paymentIntentParams.transfer_data = {
          destination: tutor.stripeConnectAccountId
        };
        console.log(`💸 Using Stripe Connect transfer for tutor ${tutor._id}`);
      } else {
        // For PayPal/Manual tutors, collect full amount to platform
        // Payout will be handled separately in completeLessonPayment()
        console.log(`💰 Collecting to platform for ${tutor.payoutProvider} tutor ${tutor._id}`);
      }

      const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

      if (paymentIntent.status !== 'requires_capture') {
        throw new Error(`Payment authorization failed: ${paymentIntent.status}`);
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
        stripeFee: 0, // Will be calculated when captured
        stripeNetAmount: amount, // Will be updated after capture
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
      // Verify Stripe PaymentIntent exists and is ready for capture
      if (!stripePaymentIntentId) {
        throw new Error('Stripe PaymentIntent ID required for card payments');
      }

      const paymentIntent = await stripeService.getPaymentIntent(stripePaymentIntentId);
      
      if (paymentIntent.status !== 'requires_capture') {
        throw new Error(`Payment authorization failed: ${paymentIntent.status}`);
      }

      // Extract Stripe fees (will be $0 until captured - fees are calculated at capture time)
      const charges = paymentIntent.charges?.data || [];
      const stripeFee = 0; // Stripe doesn't calculate fees until capture - will be updated in deductLessonFunds()
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
        status: 'authorized', // Funds reserved, will be captured when lesson starts
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
    lesson.billingStatus = 'authorized'; // Funds reserved, not yet captured
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

    if (payment.status !== 'authorized') {
      throw new Error(`Payment not in valid state for capture: ${payment.status}`);
    }

    // Check if already captured
    if (payment.chargedAt) {
      console.log(`ℹ️  Funds already captured for lesson ${lessonId} at ${payment.chargedAt}`);
      return { payment, lesson };
    }

    const amount = lesson.price;

    // 🔍 Check for hybrid payment - find any related card payment for this lesson
    const hybridCardPayment = await Payment.findOne({
      lessonId,
      status: 'authorized',
      paymentMethod: { $in: ['saved-card', 'card', 'apple_pay', 'google_pay'] },
      'metadata.isHybridPayment': true
    });

    if (hybridCardPayment) {
      console.log(`🔀 [HYBRID] Found hybrid card payment: ${hybridCardPayment._id}`);
    }

    // Handle wallet payments
    if (payment.paymentMethod === 'wallet') {
      await walletService.deductFunds({
        userId: lesson.studentId._id,
        lessonId,
        amount: payment.amount, // Use actual payment amount, not lesson price
        paymentId: payment._id
      });
      console.log(`💸 Deducted $${payment.amount} from wallet at lesson start (lesson ${lessonId})`);
      
      // Mark wallet payment as succeeded
      payment.status = 'succeeded';
      payment.chargedAt = new Date();
      payment.stripeFee = 0; // Wallet payments have no Stripe fees
      payment.stripeNetAmount = payment.amount; // Full amount since no fees
      await payment.save();
      console.log(`✅ [WALLET] Wallet payment captured: $${payment.amount} (no Stripe fees)`);
    } 
    // Handle Stripe card payments - CAPTURE the authorized payment
    else if (payment.stripePaymentIntentId) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      
      try {
        console.log(`💳 [CAPTURE] Attempting to capture PaymentIntent ${payment.stripePaymentIntentId}...`);
        
        // Capture the previously authorized payment
        // CRITICAL: Expand charges.data.balance_transaction to get full fee info
        const capturedIntent = await stripe.paymentIntents.capture(payment.stripePaymentIntentId, {
          expand: ['charges.data.balance_transaction']
        });
        
        console.log(`💳 [CAPTURE] Stripe response status: ${capturedIntent.status}`);
        console.log(`💳 [CAPTURE] Charges in response: ${capturedIntent.charges?.data?.length || 0}`);
        
        if (capturedIntent.status !== 'succeeded') {
          throw new Error(`Payment capture failed: Stripe returned status '${capturedIntent.status}' instead of 'succeeded'`);
        }

        // Extract actual Stripe fees after capture
        const charges = capturedIntent.charges?.data || [];
        if (charges.length > 0) {
          const charge = charges[0];
          payment.stripeChargeId = charge.id;
          
          // Store the receipt URL for customer-facing receipts
          payment.receiptUrl = charge.receipt_url || null;
          console.log(`🧾 [CAPTURE] Receipt URL: ${payment.receiptUrl || 'N/A'}`);
          
          // Get Stripe processing fee from balance_transaction
          if (charge.balance_transaction) {
            const balanceTx = typeof charge.balance_transaction === 'string' 
              ? await stripe.balanceTransactions.retrieve(charge.balance_transaction)
              : charge.balance_transaction;
            
            console.log(`💰 [CAPTURE] Balance transaction retrieved:`, {
              id: balanceTx.id,
              fee: balanceTx.fee,
              net: balanceTx.net,
              available_on: balanceTx.available_on
            });
            
            // Stripe processing fee (2.9% + $0.30)
            payment.stripeFee = (balanceTx.fee || 0) / 100;
            console.log(`💰 [CAPTURE] Stripe processing fee: $${payment.stripeFee.toFixed(2)}`);
            
            if (payment.stripeFee === 0) {
              console.error(`❌ [CAPTURE] WARNING: Stripe fee is $0.00 - this is unexpected for card payments!`);
              console.error(`❌ [CAPTURE] Balance transaction details:`, JSON.stringify(balanceTx, null, 2));
            }
          } else {
            console.error(`❌ [CAPTURE] CRITICAL: No balance_transaction found for charge ${charge.id}`);
            console.error(`❌ [CAPTURE] Charge object:`, JSON.stringify(charge, null, 2));
            payment.stripeFee = 0;
          }
          
          payment.stripeNetAmount = capturedIntent.amount_received / 100;
        } else {
          console.error(`❌ [CAPTURE] CRITICAL: No charges found in captured PaymentIntent ${payment.stripePaymentIntentId}`);
        }

        // ✅ ONLY UPDATE DATABASE AFTER STRIPE CONFIRMS SUCCESS
        payment.status = 'succeeded'; // Mark as succeeded now that it's captured
        payment.chargedAt = new Date();
        await payment.save();
        
        console.log(`✅ [CAPTURE] Successfully captured and saved $${amount} for lesson ${lessonId}`);
      } catch (captureError) {
        console.error(`❌ [CAPTURE] Failed to capture Stripe payment for lesson ${lessonId}:`, captureError.message);
        console.error(`❌ [CAPTURE] PaymentIntent ID: ${payment.stripePaymentIntentId}`);
        console.error(`❌ [CAPTURE] Full error:`, captureError);
        
        // ⚠️ DO NOT update database if Stripe capture failed
        throw new Error(`Payment capture failed: ${captureError.message}`);
      }
    }

    // 🔀 HYBRID PAYMENT: Also capture the card portion if exists
    if (hybridCardPayment && hybridCardPayment.stripePaymentIntentId) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      
      try {
        console.log(`💳 [HYBRID] Capturing hybrid card payment: ${hybridCardPayment.stripePaymentIntentId}...`);
        
        const capturedIntent = await stripe.paymentIntents.capture(hybridCardPayment.stripePaymentIntentId);
        
        if (capturedIntent.status !== 'succeeded') {
          throw new Error(`Hybrid card capture failed: ${capturedIntent.status}`);
        }

        // Extract Stripe fees for hybrid card payment
        const charges = capturedIntent.charges?.data || [];
        if (charges.length > 0) {
          const charge = charges[0];
          hybridCardPayment.stripeChargeId = charge.id;
          hybridCardPayment.receiptUrl = charge.receipt_url || null;
          
          if (charge.balance_transaction) {
            const balanceTx = typeof charge.balance_transaction === 'string' 
              ? await stripe.balanceTransactions.retrieve(charge.balance_transaction)
              : charge.balance_transaction;
            
            hybridCardPayment.stripeFee = (balanceTx.fee || 0) / 100;
            console.log(`💰 [HYBRID] Stripe fee for card portion: $${hybridCardPayment.stripeFee.toFixed(2)}`);
          }
          
          hybridCardPayment.stripeNetAmount = capturedIntent.amount_received / 100;
        }

        hybridCardPayment.status = 'succeeded';
        hybridCardPayment.chargedAt = new Date();
        await hybridCardPayment.save();
        
        console.log(`✅ [HYBRID] Hybrid card payment captured: $${hybridCardPayment.amount}`);
      } catch (hybridError) {
        console.error(`❌ [HYBRID] Failed to capture hybrid card payment:`, hybridError.message);
        // Don't throw - let main payment succeed even if hybrid portion fails
        hybridCardPayment.status = 'failed';
        hybridCardPayment.errorMessage = `Hybrid capture failed: ${hybridError.message}`;
        await hybridCardPayment.save();
      }
    }

    // Update lesson billing status
    lesson.billingStatus = 'charged';
    await lesson.save();

    console.log(`✅ Funds captured for lesson ${lessonId} at START (Preply model)`);

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

    // Early return if revenue already recognized (prevents duplicate processing)
    if (payment.revenueRecognized) {
      console.log(`ℹ️  Revenue already recognized for lesson ${lessonId} - skipping payment completion`);
      return { payment, lesson };
    }

    // FAILSAFE: If payment is still 'authorized' (not captured during call), capture it now
    // BUT ONLY if the lesson actually happened (both users joined)
    if (payment.status === 'authorized' && !payment.chargedAt) {
      // Check if lesson actually happened - if no one joined, don't capture
      if (!lesson.actualCallStartTime) {
        console.warn(`⚠️  Payment authorized but lesson never started (no one joined) - not capturing payment for lesson ${lessonId}`);
        // Don't throw - just return without processing
        return { payment, lesson };
      }

      console.warn(`⚠️  Payment was not captured during call - capturing now as failsafe`);
      try {
        await this.deductLessonFunds(lessonId);
        // Reload payment after capture
        await payment.reload();
        console.log(`✅ Failsafe capture successful for lesson ${lessonId}`);
      } catch (captureError) {
        console.error(`❌ Failsafe capture failed:`, captureError.message);
        // Don't throw - return without processing to prevent notification for uncaptured payments
        console.warn(`⚠️  Cannot complete lesson payment - capture failed. Payment remains authorized.`);
        return { payment, lesson };
      }
    }

    // At this point, payment should be 'succeeded' or we return early
    if (payment.status !== 'succeeded') {
      console.warn(`⚠️  Payment not in valid state for completion: ${payment.status} - skipping`);
      return { payment, lesson };
    }

    // Use actual price if available (for office hours per-minute billing)
    const finalAmount = lesson.actualPrice || lesson.price;
    const platformFee = finalAmount * (this.PLATFORM_FEE_PERCENTAGE / 100);
    const tutorPayout = finalAmount - platformFee;

    // Step 1: Wallet deduction - SKIP (already deducted at lesson start or by failsafe above)
    // This section is now redundant but kept for backwards compatibility
    if (payment.paymentMethod === 'wallet' && !payment.chargedAt) {
      console.warn(`⚠️  Wallet funds were not deducted - this should not happen`);
      await walletService.deductFunds({
        userId: lesson.studentId._id,
        lessonId,
        amount: finalAmount,
        paymentId: payment._id
      });
      payment.chargedAt = new Date();
    }

    // Step 2: Transfer to tutor based on their payout provider
    let transferSucceeded = false;
    const payoutProvider = lesson.tutorId.payoutProvider || 'stripe'; // Default to Stripe for existing tutors

    console.log(`💸 Processing payout via ${payoutProvider} for tutor ${lesson.tutorId._id}`);

    switch (payoutProvider) {
      case 'stripe':
        // Stripe Connect payout - immediate transfer
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

            console.log(`💸 [STRIPE CONNECT] Transferred $${tutorPayout} to tutor ${lesson.tutorId._id} immediately`);

            // Send notification to tutor about Stripe transfer
            try {
              const Notification = require('../models/Notification');
              const lessonDate = new Date(lesson.startTime).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              });

              const notification = new Notification({
                userId: lesson.tutorId._id,
                type: 'payment_received',
                title: '💸 Stripe Transfer Completed',
                message: `Your payout of <strong>$${tutorPayout.toFixed(2)}</strong> for the lesson on <strong>${lessonDate}</strong> has been transferred to your Stripe account`,
                data: {
                  lessonId: lessonId.toString(),
                  paymentId: payment._id.toString(),
                  amount: tutorPayout,
                  transferId: transfer.id,
                  lessonDate
                }
              });
              await notification.save();
              
              // Emit WebSocket notification if io is available
              if (io) {
                const tutorSocketId = io.connectedUsers?.get(lesson.tutorId.auth0Id);
                if (tutorSocketId) {
                  io.to(tutorSocketId).emit('payment_received', {
                    notification,
                    amount: tutorPayout,
                    transferId: transfer.id
                  });
                }
              }
              
              console.log(`📬 Stripe transfer notification sent to tutor`);
            } catch (notifError) {
              console.error(`⚠️  Failed to send Stripe transfer notification:`, notifError.message);
            }
          } catch (error) {
            console.error(`❌ Stripe transfer failed:`, error.message);
            payment.transferStatus = 'failed';
            payment.errorMessage = error.message;
          }
        } else {
          console.log(`⚠️  Tutor not onboarded to Stripe Connect - marking as pending`);
          payment.transferStatus = 'pending';
        }
        break;

      case 'paypal':
        // PayPal Payouts - DELAYED via Stripe Payout
        // Step 1: Create Stripe Payout to move funds from platform Stripe balance to bank
        // Step 2: When payout arrives in bank (1-2 days), send PayPal payout (handled by cron job)
        try {
          const paypalEmail = lesson.tutorId.payoutDetails?.paypalEmail;
          if (!paypalEmail) {
            console.error(`❌ Tutor has no PayPal email configured`);
            payment.transferStatus = 'pending';
            payment.errorMessage = 'PayPal email not configured';
            break;
          }

          // Create Stripe payout to move tutor's share from Stripe balance to platform bank
          console.log(`🏦 [PAYPAL FLOW] Creating Stripe payout for $${tutorPayout} to move to bank...`);
          
          const stripePayout = await stripeService.createPayout({
            amount: tutorPayout,
            metadata: {
              lessonId: lessonId.toString(),
              tutorId: lesson.tutorId._id.toString(),
              paymentId: payment._id.toString(),
              purpose: 'paypal_tutor_payout',
              paypalEmail: paypalEmail
            }
          });

          payment.stripePayoutId = stripePayout.id;
          payment.stripePayoutAmount = tutorPayout;
          payment.stripePayoutStatus = stripePayout.status; // 'pending', 'in_transit', or 'paid'
          payment.stripePayoutCreatedAt = new Date();
          payment.transferStatus = 'awaiting_funds'; // New status: waiting for Stripe payout to clear
          payment.errorMessage = 'Stripe payout created, awaiting bank transfer (1-2 business days)';

          console.log(`✅ [PAYPAL FLOW] Stripe payout ${stripePayout.id} created (status: ${stripePayout.status})`);
          console.log(`📅 PayPal payout to ${paypalEmail} will be sent once funds arrive in bank`);
        } catch (error) {
          console.error(`❌ [PAYPAL FLOW] Stripe payout creation failed:`, error.message);
          
          // Check if it's a missing bank account error
          if (error.message && error.message.includes('external accounts')) {
            payment.transferStatus = 'failed';
            payment.errorMessage = `Payout failed: Stripe Connect account needs bank details. Please complete your payout setup.`;
            
            // Create alert for admin to follow up with tutor
            await alertService.createAlert({
              type: 'INCOMPLETE_STRIPE_SETUP',
              severity: 'MEDIUM',
              title: `Tutor needs to complete Stripe Connect setup`,
              description: `Tutor ${lesson.tutorId.email} (${lesson.tutorId.name}) attempted payout but has no bank account configured in Stripe Connect.`,
              userId: lesson.tutorId._id,
              metadata: {
                tutorEmail: lesson.tutorId.email,
                amount: tutorPayout,
                lessonId: lesson._id.toString()
              }
            });
          } else {
            payment.transferStatus = 'failed';
            payment.errorMessage = `Stripe payout failed: ${error.message}`;
          }
        }
        break;

      case 'manual':
        // Manual payout - just mark as pending for admin to process
        console.log(`📋 Manual payout requested for tutor ${lesson.tutorId._id}: $${tutorPayout}`);
        payment.transferStatus = 'pending';
        payment.errorMessage = 'Awaiting manual bank transfer';
        break;

      default:
        console.warn(`⚠️  Unknown payout provider: ${payoutProvider}`);
        payment.transferStatus = 'pending';
        payment.errorMessage = 'Unknown payout provider';
    }

    // 🔔 Send notification to tutor when they earn money (ONLY if payment succeeded and revenue not already recognized)
    // This prevents duplicate notifications if completeLessonPayment is called multiple times
    if (payment.status === 'succeeded' && !payment.revenueRecognized) {
      try {
        const studentName = lesson.studentId.firstName 
          ? `${lesson.studentId.firstName} ${(lesson.studentId.lastName || '').charAt(0)}.`
          : lesson.studentId.name || 'a student';
        
        const lessonDate = new Date(lesson.startTime).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });

        // Check if notification already exists for this payment to prevent duplicates
        const existingNotification = await Notification.findOne({
          userId: lesson.tutorId._id,
          type: 'payment_received',
          'data.paymentId': payment._id.toString()
        });

        if (!existingNotification) {
          // Customize message based on transfer status
          let notificationMessage;
          if (payment.transferStatus === 'succeeded') {
            notificationMessage = `You earned <strong>$${tutorPayout.toFixed(2)}</strong> from your lesson on <strong>${lessonDate}</strong> with ${studentName}`;
          } else if (payment.transferStatus === 'awaiting_funds') {
            notificationMessage = `You earned <strong>$${tutorPayout.toFixed(2)}</strong> from your lesson on <strong>${lessonDate}</strong> with ${studentName}. Payout will be sent within 2-3 business days.`;
          } else {
            notificationMessage = `You earned <strong>$${tutorPayout.toFixed(2)}</strong> from your lesson on <strong>${lessonDate}</strong> with ${studentName}`;
          }

          // Create notification in database
          const notification = new Notification({
            userId: lesson.tutorId._id,
            type: 'payment_received',
            title: '💰 Payment Received',
            message: notificationMessage,
            data: {
              lessonId: lessonId.toString(),
              paymentId: payment._id.toString(),
              amount: tutorPayout,
              studentName,
              lessonDate,
              transferStatus: payment.transferStatus || 'pending',
              payoutProvider: payoutProvider
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
        } else {
          console.log(`ℹ️  Payment notification already exists for payment ${payment._id} - skipping duplicate`);
        }
      } catch (notificationError) {
        console.error(`❌ Error sending payment notification:`, notificationError);
        // Don't throw - notification failure shouldn't fail the payment
      }
    } else {
      console.log(`ℹ️  Skipping payment notification - payment status: ${payment.status}, revenueRecognized: ${payment.revenueRecognized}`);
    }

    // Step 3: Update payment record
    payment.tutorPayout = tutorPayout;
    payment.platformFee = platformFee;
    payment.revenueRecognized = true; // NEW: Mark revenue as recognized
    payment.revenueRecognizedAt = new Date(); // NEW: Timestamp when revenue recognized
    await payment.save();

    // 🔀 HYBRID PAYMENT: Also mark hybrid card payment revenue as recognized
    const hybridCardPayment = await Payment.findOne({
      lessonId,
      paymentMethod: { $in: ['saved-card', 'card', 'apple_pay', 'google_pay'] },
      'metadata.isHybridPayment': true
    });

    if (hybridCardPayment && !hybridCardPayment.revenueRecognized) {
      const hybridPlatformFee = hybridCardPayment.amount * (this.PLATFORM_FEE_PERCENTAGE / 100);
      const hybridTutorPayout = hybridCardPayment.amount - hybridPlatformFee;
      
      hybridCardPayment.platformFee = hybridPlatformFee;
      hybridCardPayment.tutorPayout = hybridTutorPayout;
      hybridCardPayment.revenueRecognized = true;
      hybridCardPayment.revenueRecognizedAt = new Date();
      await hybridCardPayment.save();
      
      console.log(`✅ [HYBRID] Hybrid card payment revenue recognized: $${hybridPlatformFee} platform fee, Stripe fee: $${hybridCardPayment.stripeFee}`);
    }

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
      .populate({
        path: 'lessonId',
        select: 'subject startTime endTime cancelReason tutorId',
        populate: {
          path: 'tutorId',
          select: 'name firstName lastName picture'
        }
      })
      .sort({ createdAt: -1 })
      .limit(limit);

    return payments;
  }
}

module.exports = new PaymentService();

