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
const { formatNameWithInitial } = require('../utils/nameFormatter');

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

    // DEBUG: Log all payment parameters
    console.log('💳 [PAYMENT DEBUG] Payment parameters received:', {
      paymentMethod,
      isHybridPayment,
      walletAmount,
      paymentMethodAmount,
      amount,
      walletAmountType: typeof walletAmount,
      paymentMethodAmountType: typeof paymentMethodAmount,
      isHybridPaymentType: typeof isHybridPayment,
      hybridCheck: isHybridPayment && walletAmount > 0 && paymentMethodAmount > 0
    });

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
        if (!stripePaymentMethodId) {
          throw new Error('Stripe Payment Method ID required for saved card payments');
        }
        
        // If customer ID is missing, create one
        let customerIdToUse = stripeCustomerId;
        if (!customerIdToUse) {
          console.log('💳 [HYBRID] No Stripe customer ID found, creating one...');
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          const student = await User.findById(userId);
          
          const customer = await stripe.customers.create({
            email: student.email,
            name: student.name || `${student.firstName} ${student.lastName}`,
            metadata: {
              userId: userId.toString()
            }
          });
          
          // Update user with new customer ID
          student.stripeCustomerId = customer.id;
          await student.save();
          customerIdToUse = customer.id;
          console.log('✅ [HYBRID] Created Stripe customer:', customerIdToUse);
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
          customer: customerIdToUse,
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

        // NEW ARCHITECTURE: Always collect full amount to platform for hybrid payments too
        // Tutor payout will be handled separately in completeLessonPayment()
        console.log(`💰 [HYBRID - SEPARATE CHARGES] Collecting full card amount to platform`);
        console.log(`💰 [HYBRID - SEPARATE CHARGES] Will transfer to tutor after lesson completes`);

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
      if (!stripePaymentMethodId) {
        throw new Error('Stripe Payment Method ID required for saved card payments');
      }

      // If customer ID is missing, create one
      let customerIdToUse = stripeCustomerId;
      if (!customerIdToUse) {
        console.log('💳 No Stripe customer ID found, creating one...');
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const student = await User.findById(userId);
        
        const customer = await stripe.customers.create({
          email: student.email,
          name: student.name || `${student.firstName} ${student.lastName}`,
          metadata: {
            userId: userId.toString()
          }
        });
        
        // Update user with new customer ID
        student.stripeCustomerId = customer.id;
        await student.save();
        customerIdToUse = customer.id;
        console.log('✅ Created Stripe customer:', customerIdToUse);
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
        customer: customerIdToUse,
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

      // NEW ARCHITECTURE: Always collect full amount to platform
      // Tutor payout (via Stripe Transfer or PayPal) will be handled separately in completeLessonPayment()
      // This gives us clear fund separation: Stripe balance = platform revenue only
      console.log(`💰 [SEPARATE CHARGES] Collecting full amount to platform for ${tutor.payoutProvider} tutor`);
      console.log(`💰 [SEPARATE CHARGES] Will transfer $${tutorPayout.toFixed(2)} to tutor after lesson completes`);

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
        const capturedIntent = await stripe.paymentIntents.capture(payment.stripePaymentIntentId);
        
        console.log(`💳 [CAPTURE] Stripe response status: ${capturedIntent.status}`);
        
        if (capturedIntent.status !== 'succeeded') {
          throw new Error(`Payment capture failed: Stripe returned status '${capturedIntent.status}' instead of 'succeeded'`);
        }

        // Extract actual Stripe fees after capture
        // NOTE: Expand doesn't work reliably with capture(), so we retrieve the charge separately
        if (capturedIntent.latest_charge) {
          const chargeId = typeof capturedIntent.latest_charge === 'string' 
            ? capturedIntent.latest_charge 
            : capturedIntent.latest_charge.id;
            
          console.log(`💳 [CAPTURE] Retrieving charge ${chargeId} with balance_transaction...`);
          
          // Retrieve the charge with expanded balance_transaction to get fees
          const charge = await stripe.charges.retrieve(chargeId, {
            expand: ['balance_transaction']
          });
          
          payment.stripeChargeId = charge.id;
          
          // Store the receipt URL for customer-facing receipts
          payment.receiptUrl = charge.receipt_url || null;
          console.log(`🧾 [CAPTURE] Receipt URL: ${payment.receiptUrl || 'N/A'}`);
          
          // Get Stripe processing fee from balance_transaction
          if (charge.balance_transaction && typeof charge.balance_transaction === 'object') {
            const balanceTx = charge.balance_transaction;
            
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
          console.error(`❌ [CAPTURE] CRITICAL: No latest_charge found in PaymentIntent ${payment.stripePaymentIntentId}`);
          payment.stripeFee = 0;
        }

        // ✅ ONLY UPDATE DATABASE AFTER STRIPE CONFIRMS SUCCESS
        payment.status = 'succeeded'; // Mark as succeeded now that it's captured
        payment.chargedAt = new Date();
        await payment.save();
        
        console.log(`✅ [CAPTURE] Successfully captured and saved $${amount} for lesson ${lessonId}`);
      } catch (captureError) {
        // Check if error is "already captured" - this means it actually succeeded
        if (captureError.message?.includes('already been captured') || 
            captureError.code === 'payment_intent_unexpected_state') {
          console.log(`✅ [CAPTURE] Payment was already captured (likely race condition) - treating as success`);
          
          // Retrieve the actual payment status from Stripe to confirm
          const existingIntent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
          if (existingIntent.status === 'succeeded') {
            payment.status = 'succeeded';
            payment.chargedAt = new Date();
            
            // Get charge details if available
            if (existingIntent.latest_charge) {
              const chargeId = typeof existingIntent.latest_charge === 'string' 
                ? existingIntent.latest_charge 
                : existingIntent.latest_charge.id;
              payment.stripeChargeId = chargeId;
            }
            
            await payment.save();
            console.log(`✅ [CAPTURE] Confirmed payment succeeded via Stripe retrieve`);
          } else {
            console.error(`❌ [CAPTURE] Stripe shows status: ${existingIntent.status}`);
            throw new Error(`Payment capture failed: ${captureError.message}`);
          }
        } else {
          console.error(`❌ [CAPTURE] Failed to capture Stripe payment for lesson ${lessonId}:`, captureError.message);
          console.error(`❌ [CAPTURE] PaymentIntent ID: ${payment.stripePaymentIntentId}`);
          console.error(`❌ [CAPTURE] Full error:`, captureError);
          
          // ⚠️ DO NOT update database if Stripe capture failed
          throw new Error(`Payment capture failed: ${captureError.message}`);
        }
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
        // NOTE: Retrieve charge separately to get balance_transaction
        if (capturedIntent.latest_charge) {
          const chargeId = typeof capturedIntent.latest_charge === 'string' 
            ? capturedIntent.latest_charge 
            : capturedIntent.latest_charge.id;
            
          console.log(`💳 [HYBRID] Retrieving charge ${chargeId} with balance_transaction...`);
          
          const charge = await stripe.charges.retrieve(chargeId, {
            expand: ['balance_transaction']
          });
          
          hybridCardPayment.stripeChargeId = charge.id;
          hybridCardPayment.receiptUrl = charge.receipt_url || null;
          
          if (charge.balance_transaction && typeof charge.balance_transaction === 'object') {
            const balanceTx = charge.balance_transaction;
            
            hybridCardPayment.stripeFee = (balanceTx.fee || 0) / 100;
            console.log(`💰 [HYBRID] Stripe fee for card portion: $${hybridCardPayment.stripeFee.toFixed(2)}`);
          } else {
            console.error(`❌ [HYBRID] No balance_transaction found for charge ${charge.id}`);
            hybridCardPayment.stripeFee = 0;
          }
          
          hybridCardPayment.stripeNetAmount = capturedIntent.amount_received / 100;
        } else {
          console.error(`❌ [HYBRID] No latest_charge found`);
          hybridCardPayment.stripeFee = 0;
        }

        hybridCardPayment.status = 'succeeded';
        hybridCardPayment.chargedAt = new Date();
        await hybridCardPayment.save();
        
        console.log(`✅ [HYBRID] Hybrid card payment captured: $${hybridCardPayment.amount}`);
      } catch (hybridError) {
        // Check if error is "already captured" - this means it actually succeeded
        if (hybridError.message?.includes('already been captured') || 
            hybridError.code === 'payment_intent_unexpected_state') {
          console.log(`✅ [HYBRID] Payment was already captured (likely race condition) - treating as success`);
          
          // Retrieve the actual payment status from Stripe to confirm
          try {
            const existingIntent = await stripe.paymentIntents.retrieve(hybridCardPayment.stripePaymentIntentId);
            if (existingIntent.status === 'succeeded') {
              hybridCardPayment.status = 'succeeded';
              hybridCardPayment.chargedAt = new Date();
              
              // Get charge details if available
              if (existingIntent.latest_charge) {
                const chargeId = typeof existingIntent.latest_charge === 'string' 
                  ? existingIntent.latest_charge 
                  : existingIntent.latest_charge.id;
                hybridCardPayment.stripeChargeId = chargeId;
              }
              
              await hybridCardPayment.save();
              console.log(`✅ [HYBRID] Confirmed payment succeeded via Stripe retrieve`);
            } else {
              console.error(`❌ [HYBRID] Stripe shows status: ${existingIntent.status}`);
              hybridCardPayment.status = 'failed';
              hybridCardPayment.errorMessage = `Hybrid capture failed: ${hybridError.message}`;
              await hybridCardPayment.save();
            }
          } catch (retrieveError) {
            console.error(`❌ [HYBRID] Error retrieving payment status:`, retrieveError.message);
            // If we can't verify, still mark as failed to be safe
            hybridCardPayment.status = 'failed';
            hybridCardPayment.errorMessage = `Hybrid capture failed: ${hybridError.message}`;
            await hybridCardPayment.save();
          }
        } else {
          console.error(`❌ [HYBRID] Failed to capture hybrid card payment:`, hybridError.message);
          // Don't throw - let main payment succeed even if hybrid portion fails
          hybridCardPayment.status = 'failed';
          hybridCardPayment.errorMessage = `Hybrid capture failed: ${hybridError.message}`;
          await hybridCardPayment.save();
        }
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

    // ===================================================================
    // NEW WITHDRAWAL SYSTEM: NO IMMEDIATE TRANSFERS
    // All funds stay in platform Stripe account
    // Tutor earnings tracked in database (tutorEarnings.pendingBalance)
    // Earnings released to availableBalance after 24hr hold period
    // Tutor requests withdrawal when ready → funds transferred from platform
    // ===================================================================
    
    console.log(`\n💰 [NEW SYSTEM] Processing tutor earnings (no immediate transfer)`);
    console.log(`   Lesson: ${lessonId}`);
    console.log(`   Tutor: ${lesson.tutorId._id} (${lesson.tutorId.name})`);
    console.log(`   Amount: $${finalAmount.toFixed(2)}`);
    console.log(`   Platform Fee (${this.PLATFORM_FEE_PERCENTAGE}%): $${platformFee.toFixed(2)}`);
    console.log(`   Tutor Payout: $${tutorPayout.toFixed(2)}`);
    
    // Calculate earnings release date (1 hour hold after lesson end)
    const releaseDate = new Date(lesson.endTime);
    releaseDate.setHours(releaseDate.getHours() + 1);
    
    console.log(`   Release Date: ${releaseDate.toISOString()}`);
    
    // ─── Step 1: Save payment FIRST so reconciliation always sees it ───
    // This prevents a race condition where the tutor balance is incremented
    // but the payment hasn't been saved yet with revenueRecognized/transferStatus,
    // causing the reconciliation to overwrite lifetimeEarnings downward.
    const wasAlreadyRecognized = payment.revenueRecognized;
    payment.tutorPayout = tutorPayout;
    payment.platformFee = platformFee;
    payment.transferStatus = 'on_hold';
    payment.earningsReleaseDate = releaseDate;
    payment.revenueRecognized = true;
    payment.revenueRecognizedAt = new Date();
    await payment.save();
    console.log(`💾 Payment saved: transferStatus=on_hold, revenueRecognized=true`);
    
    // ─── Step 2: Increment tutor balance (safe now — payment is persisted) ───
    const tutor = await User.findById(lesson.tutorId._id);
    if (!tutor.tutorEarnings) {
      tutor.tutorEarnings = {
        availableBalance: 0,
        pendingBalance: 0,
        lifetimeEarnings: 0,
        lastWithdrawal: null,
        totalWithdrawn: 0
      };
    }
    
    tutor.tutorEarnings.pendingBalance += tutorPayout;
    tutor.tutorEarnings.lifetimeEarnings += tutorPayout;
    await tutor.save();
    
    console.log(`💼 Updated tutor balance:`);
    console.log(`   Pending: $${tutor.tutorEarnings.pendingBalance.toFixed(2)}`);
    console.log(`   Available: $${tutor.tutorEarnings.availableBalance.toFixed(2)}`);
    console.log(`   Lifetime: $${tutor.tutorEarnings.lifetimeEarnings.toFixed(2)}`);
    console.log(`\n✅ [NEW SYSTEM] Earnings will be available for withdrawal after ${releaseDate.toLocaleString()}\n`);

    // 🔔 Send notification to tutor when they earn money (NEW SYSTEM - pending balance)
    // This prevents duplicate notifications if completeLessonPayment is called multiple times
    if (payment.status === 'succeeded' && !wasAlreadyRecognized) {
      try {
        const studentName = formatNameWithInitial(lesson.studentId);
        
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
          // Earnings are on 1-hour hold before becoming available for withdrawal
          const minutesUntilRelease = Math.max(1, Math.round((releaseDate - new Date()) / (1000 * 60)));
          const timeLabel = minutesUntilRelease >= 60 
            ? `${Math.round(minutesUntilRelease / 60)} hour${Math.round(minutesUntilRelease / 60) !== 1 ? 's' : ''}`
            : `${minutesUntilRelease} minute${minutesUntilRelease !== 1 ? 's' : ''}`;
          const notificationMessage = `You earned <strong>$${tutorPayout.toFixed(2)}</strong> from your lesson on <strong>${lessonDate}</strong> with ${studentName}. Funds will be available for withdrawal in ~${timeLabel}.`;

          // Create notification in database
          const notification = new Notification({
            userId: lesson.tutorId._id,
            type: 'payment_received',
            title: '💰 Earnings Pending',
            message: notificationMessage,
            data: {
              lessonId: lessonId.toString(),
              paymentId: payment._id.toString(),
              amount: tutorPayout,
              studentName,
              lessonDate,
              transferStatus: 'on_hold',
              earningsReleaseDate: releaseDate.toISOString(),
              hoursUntilRelease
            }
          });
          await notification.save();
          console.log(`📬 Earnings notification created for tutor: ${notification._id}`);

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
                transferStatus: 'on_hold',
                earningsReleaseDate: releaseDate.toISOString()
              });
              console.log(`🔔 Real-time earnings notification sent to tutor via WebSocket`);
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

    // (Payment already saved in Step 1 above with revenueRecognized + transferStatus)

    // ===================================================================
    // 💸 AUTOMATIC PLATFORM PROFIT PAYOUT TO BANK
    // This creates COMPLETE SEPARATION:
    // - Platform profit → Your bank account (immediate)
    // - Tutor funds → Stay in Stripe (for withdrawal)
    // Result: Stripe balance = ONLY tutor liabilities!
    // ===================================================================
    
    // Calculate net platform profit (platform fee minus Stripe fees)
    const stripeFee = payment.stripeFee || 0;
    const netPlatformProfit = platformFee - stripeFee;
    
    // Only auto-payout for card payments (wallet payments have no Stripe fees to account for)
    const shouldAutoPayout = process.env.AUTO_PAYOUT_PLATFORM_PROFIT === 'true' && netPlatformProfit > 0;
    
    if (shouldAutoPayout) {
      try {
        console.log(`\n💸 [AUTO-PAYOUT] Transferring platform profit to bank...`);
        console.log(`   Platform Fee: $${platformFee.toFixed(2)}`);
        console.log(`   Stripe Fee: $${stripeFee.toFixed(2)}`);
        console.log(`   Net Profit: $${netPlatformProfit.toFixed(2)}`);
        
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        
        // Create immediate payout to your connected bank account
        const payout = await stripe.payouts.create({
          amount: Math.round(netPlatformProfit * 100), // Convert to cents
          currency: 'usd',
          description: `Platform profit from lesson ${lessonId}`,
          metadata: {
            lessonId: lessonId.toString(),
            paymentId: payment._id.toString(),
            platformFee: platformFee.toFixed(2),
            stripeFee: stripeFee.toFixed(2),
            netProfit: netPlatformProfit.toFixed(2),
            type: 'platform_profit'
          }
        });
        
        // Record the payout in payment metadata
        payment.platformProfitPayoutId = payout.id;
        payment.platformProfitPaidOut = true;
        payment.platformProfitPayoutAt = new Date();
        await payment.save();
        
        console.log(`✅ [AUTO-PAYOUT] Platform profit transferred to bank: $${netPlatformProfit.toFixed(2)}`);
        console.log(`   Payout ID: ${payout.id}`);
        console.log(`   Estimated arrival: ${payout.arrival_date ? new Date(payout.arrival_date * 1000).toLocaleDateString() : 'N/A'}`);
        console.log(`\n💎 RESULT: Stripe balance now contains ONLY tutor funds!`);
      } catch (payoutError) {
        // Log error but don't fail the lesson completion
        console.error(`❌ [AUTO-PAYOUT] Failed to payout platform profit:`, payoutError.message);
        console.error(`   This is non-critical - profit remains in Stripe and can be manually paid out`);
        
        // Store error info for debugging
        payment.platformProfitPayoutError = payoutError.message;
        await payment.save();
      }
    } else if (!shouldAutoPayout && netPlatformProfit > 0) {
      console.log(`ℹ️  [AUTO-PAYOUT] Disabled (AUTO_PAYOUT_PLATFORM_PROFIT=${process.env.AUTO_PAYOUT_PLATFORM_PROFIT})`);
      console.log(`   Platform profit $${netPlatformProfit.toFixed(2)} remains in Stripe`);
    }

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
          select: 'name firstName lastName picture profilePicture'
        }
      })
      .populate({
        path: 'classId',
        select: 'name startTime endTime status tutorId',
        populate: {
          path: 'tutorId',
          select: 'name firstName lastName picture profilePicture'
        }
      })
      .sort({ createdAt: -1 })
      .limit(limit);

    return payments;
  }
}

module.exports = new PaymentService();

