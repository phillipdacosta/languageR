/**
 * Wallet API Routes
 * 
 * Endpoints:
 * - GET /api/wallet/balance - Get wallet balance
 * - POST /api/wallet/top-up - Initiate wallet top-up
 * - POST /api/wallet/confirm-top-up - Confirm top-up after Stripe payment
 * - GET /api/wallet/transactions - Get transaction history
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const walletService = require('../services/walletService');
const User = require('../models/User');

/**
 * GET /api/wallet/balance
 * Get wallet balance for current user
 */
router.get('/balance', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const balance = await walletService.getBalance(user._id);

    res.json({
      success: true,
      balance: balance.balance,
      reservedBalance: balance.reservedBalance,
      availableBalance: balance.availableBalance,
      currency: balance.currency
    });
  } catch (error) {
    console.error('❌ Error getting wallet balance:', error);
    res.status(500).json({ success: false, message: 'Failed to get wallet balance', error: error.message });
  }
});

/**
 * POST /api/wallet/top-up
 * Initiate wallet top-up (creates Stripe PaymentIntent)
 * Body: { amount: number, paymentMethodId?: string }
 */
router.post('/top-up', verifyToken, async (req, res) => {
  try {
    const { walletCredit, totalCharge, stripeFee, paymentMethodId, customerId: requestCustomerId, saveCard = false } = req.body;

    console.log('🔍 [TOP-UP] Received request body:', {
      walletCredit,
      totalCharge,
      stripeFee,
      types: {
        walletCredit: typeof walletCredit,
        totalCharge: typeof totalCharge,
        stripeFee: typeof stripeFee
      },
      validation: {
        walletCreditExists: !!walletCredit,
        walletCreditIsNumber: typeof walletCredit === 'number',
        walletCreditGTE1: walletCredit >= 1,
        totalChargeExists: !!totalCharge,
        totalChargeIsNumber: typeof totalCharge === 'number',
        totalChargeGTWallet: totalCharge > walletCredit
      }
    });

    // Validate inputs
    if (!walletCredit || typeof walletCredit !== 'number' || walletCredit < 1) {
      console.error('❌ [TOP-UP] Wallet credit validation failed:', { walletCredit, type: typeof walletCredit });
      return res.status(400).json({ success: false, message: 'Valid wallet credit amount required (minimum $1)' });
    }

    if (!totalCharge || typeof totalCharge !== 'number' || totalCharge <= walletCredit) {
      console.error('❌ [TOP-UP] Total charge validation failed:', { totalCharge, walletCredit, type: typeof totalCharge });
      return res.status(400).json({ success: false, message: 'Invalid total charge amount' });
    }

    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Try to get customer ID from: request body, user record, or payment method
    let customerId = requestCustomerId || user.stripeCustomerId;
    
    console.log(`🔍 Customer ID sources - Request: ${requestCustomerId}, User DB: ${user.stripeCustomerId}`);
    console.log(`💰 Top-up details - Wallet credit: $${walletCredit}, Total charge: $${totalCharge}, Fee: $${stripeFee}`);
    
    if (paymentMethodId && !customerId) {
      console.log('⚠️ No customer ID available, attempting to retrieve from payment method...');
      try {
        // Retrieve the payment method from Stripe to get the customer ID
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
        
        if (paymentMethod.customer) {
          customerId = paymentMethod.customer;
          console.log(`✅ Retrieved customer ID from payment method: ${customerId}`);
          
          // Update user record with the customer ID for future use
          user.stripeCustomerId = customerId;
          await user.save();
          console.log('✅ Updated user record with customer ID');
        } else {
          console.error('❌ Payment method exists but has no customer attached');
          return res.status(400).json({ 
            success: false, 
            message: 'Payment method is not attached to a customer. Please try adding the card again.' 
          });
        }
      } catch (error) {
        console.error('❌ Failed to retrieve payment method from Stripe:', error);
        return res.status(400).json({ 
          success: false, 
          message: 'Could not verify payment method. Please try adding the card again.',
          error: error.message
        });
      }
    }

    console.log(`💳 Initiating payment - Method: ${paymentMethodId ? 'new card' : 'no card'}, Customer: ${customerId || 'none'}, SaveCard: ${saveCard}`);

    // If user wants to save the card, ensure we have a customer and attach the payment method
    if (saveCard && paymentMethodId) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      
      // Create customer if doesn't exist
      if (!customerId) {
        console.log('📝 [TOP-UP] Creating Stripe customer for user...');
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name,
          metadata: {
            userId: user._id.toString(),
            auth0Id: user.auth0Id
          }
        });
        customerId = customer.id;
        user.stripeCustomerId = customerId;
        await user.save();
        console.log(`✅ [TOP-UP] Created Stripe customer: ${customerId}`);
      }
      
      // Attach payment method to customer BEFORE creating PaymentIntent
      try {
        console.log('📎 [TOP-UP] Attaching payment method to customer BEFORE payment...');
        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: customerId
        });
        console.log('✅ [TOP-UP] Payment method attached successfully');
      } catch (attachError) {
        // If already attached, that's fine
        if (attachError.code !== 'resource_missing') {
          console.log('ℹ️  [TOP-UP] Payment method may already be attached:', attachError.message);
        }
      }
    }

    const result = await walletService.initiateTopUp({
      userId: user._id,
      walletCredit, // Amount to credit to wallet
      totalCharge, // Amount to charge customer (including fee)
      stripeFee, // Fee amount for records
      paymentMethodId, // Pass saved payment method if provided
      customerId: customerId, // Include customer ID (either from user record or retrieved from payment method)
      saveCard, // Whether to save the card for future use
      metadata: {
        userEmail: user.email,
        userName: user.name,
        walletCredit,
        stripeFee,
        saveCard
      }
    });

    res.json({
      success: true,
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      amount: result.amount // This will be totalCharge
    });
  } catch (error) {
    console.error('❌ Error initiating wallet top-up:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/wallet/confirm-top-up
 * Confirm wallet top-up after Stripe payment succeeds
 * Body: { paymentIntentId: string }
 */
router.post('/confirm-top-up', verifyToken, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ success: false, message: 'Payment Intent ID required' });
    }

    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Verify payment with Stripe
    const stripeService = require('../services/stripeService');
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const paymentIntent = await stripeService.getPaymentIntent(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment not completed', 
        status: paymentIntent.status 
      });
    }

    const totalCharged = paymentIntent.amount / 100; // Convert from cents - this is what we charged
    const walletCredit = parseFloat(paymentIntent.metadata.walletCredit || totalCharged); // Get requested wallet credit from metadata
    const expectedStripeFee = parseFloat(paymentIntent.metadata.expectedStripeFee || 0);

    // Get ACTUAL Stripe fee from balance transaction
    let actualStripeFee = expectedStripeFee; // Fallback to expected
    if (paymentIntent.charges?.data[0]?.balance_transaction) {
      const balanceTransaction = await stripe.balanceTransactions.retrieve(
        paymentIntent.charges.data[0].balance_transaction
      );
      actualStripeFee = balanceTransaction.fee / 100; // Convert from cents to dollars
    }

    console.log(`💵 Wallet top-up confirmation:`);
    console.log(`   - Total charged: $${totalCharged}`);
    console.log(`   - Wallet credit: $${walletCredit}`);
    console.log(`   - Expected fee: $${expectedStripeFee}`);
    console.log(`   - Actual fee: $${actualStripeFee.toFixed(2)}`);

    const wallet = await walletService.confirmTopUp({
      userId: user._id,
      paymentIntentId,
      amount: walletCredit, // Credit exact wallet amount (no bonus)
      stripeFee: actualStripeFee
    });

    // Check if user requested to save the card
    const saveCard = paymentIntent.metadata.saveCard === 'true';
    
    console.log('💾 [CONFIRM-TOP-UP] Save card check:', {
      saveCard,
      metadataSaveCard: paymentIntent.metadata.saveCard,
      paymentMethod: paymentIntent.payment_method
    });
    
    if (saveCard && paymentIntent.payment_method) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const paymentMethod = await stripe.paymentMethods.retrieve(paymentIntent.payment_method);
        
        console.log('💳 [CONFIRM-TOP-UP] Retrieved payment method:', {
          id: paymentMethod.id,
          brand: paymentMethod.card.brand,
          last4: paymentMethod.card.last4,
          country: paymentMethod.card.country
        });
        
        // Check if this payment method is already saved
        const existingCard = user.savedPaymentMethods.find(
          pm => pm.stripePaymentMethodId === paymentIntent.payment_method
        );
        
        console.log('🔍 [CONFIRM-TOP-UP] Existing card check:', {
          found: !!existingCard,
          currentlySavedCards: user.savedPaymentMethods.length
        });
        
        if (!existingCard) {
          // Payment method should already be attached during top-up initiation
          // Just save to user record
          const newCard = {
            stripePaymentMethodId: paymentIntent.payment_method,
            brand: paymentMethod.card.brand,
            last4: paymentMethod.card.last4,
            expiryMonth: paymentMethod.card.exp_month,
            expiryYear: paymentMethod.card.exp_year,
            country: paymentMethod.card.country,
            isDefault: user.savedPaymentMethods.length === 0, // First card is default
            createdAt: new Date()
          };
          
          user.savedPaymentMethods.push(newCard);
          
          await user.save();
          console.log(`✅ [CONFIRM-TOP-UP] Saved card ${paymentMethod.card.brand} ****${paymentMethod.card.last4} for user. Total cards: ${user.savedPaymentMethods.length}`);
        } else {
          console.log(`ℹ️  [CONFIRM-TOP-UP] Card already saved for user`);
        }
      } catch (error) {
        console.error('❌ [CONFIRM-TOP-UP] Error saving card:', error);
        // Don't fail the whole request if card saving fails
      }
    } else {
      console.log('ℹ️  [CONFIRM-TOP-UP] Not saving card (saveCard:', saveCard, ', paymentMethod:', !!paymentIntent.payment_method, ')');
    }

    res.json({
      success: true,
      message: `Successfully added $${walletCredit.toFixed(2)} to wallet`,
      balance: wallet.balance,
      availableBalance: wallet.availableBalance,
      actualFee: actualStripeFee
    });
  } catch (error) {
    console.error('❌ Error confirming wallet top-up:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/wallet/transactions
 * Get wallet transaction history
 * Query: ?limit=50
 */
router.get('/transactions', verifyToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;

    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const transactions = await walletService.getTransactionHistory(user._id, limit);

    res.json({
      success: true,
      transactions
    });
  } catch (error) {
    console.error('❌ Error getting transaction history:', error);
    res.status(500).json({ success: false, message: 'Failed to get transactions', error: error.message });
  }
});

/**
 * POST /api/wallet/top-up-with-saved-card
 * Process wallet top-up with a saved card (no client secret needed)
 * Body: { amount: number, paymentMethodId: string }
 */
router.post('/top-up-with-saved-card', verifyToken, async (req, res) => {
  try {
    const { walletCredit, totalCharge, stripeFee: expectedStripeFee, paymentMethodId } = req.body;

    // Validate inputs
    if (!walletCredit || typeof walletCredit !== 'number' || walletCredit < 1) {
      return res.status(400).json({ success: false, message: 'Valid wallet credit amount required (minimum $1)' });
    }

    if (!totalCharge || typeof totalCharge !== 'number' || totalCharge <= walletCredit) {
      return res.status(400).json({ success: false, message: 'Invalid total charge amount' });
    }

    if (!paymentMethodId) {
      return res.status(400).json({ success: false, message: 'Payment method ID required' });
    }

    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.stripeCustomerId) {
      return res.status(400).json({ success: false, message: 'No Stripe customer ID found' });
    }

    console.log(`💳 Processing top-up with saved card - Wallet: $${walletCredit}, Total charge: $${totalCharge}, Expected fee: $${expectedStripeFee}`);

    // Create and confirm payment intent with saved payment method
    // Charge the exact amount based on card country
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const Payment = require('../models/Payment');
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(totalCharge * 100), // Convert to cents - charge exact amount including fee
      currency: 'usd',
      customer: user.stripeCustomerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      description: `Wallet top-up for ${user.email} ($${walletCredit} + $${expectedStripeFee} fee)`,
      metadata: {
        userId: user._id.toString(),
        type: 'wallet_top_up',
        walletCredit: walletCredit.toString(),
        expectedStripeFee: expectedStripeFee.toString()
      }
    });

    if (paymentIntent.status === 'succeeded') {
      // Get receipt URL and ACTUAL Stripe fee from the charge
      let receiptUrl = null;
      let actualStripeFee = expectedStripeFee; // Fallback to expected fee
      
      if (paymentIntent.charges && paymentIntent.charges.data.length > 0) {
        const charge = paymentIntent.charges.data[0];
        receiptUrl = charge.receipt_url;
        
        // Get the ACTUAL Stripe fee from balance_transaction
        if (charge.balance_transaction) {
          const balanceTransaction = await stripe.balanceTransactions.retrieve(charge.balance_transaction);
          actualStripeFee = balanceTransaction.fee / 100; // Convert from cents to dollars
        }
        
        console.log(`🧾 Receipt URL: ${receiptUrl}`);
        console.log(`💰 Actual Stripe fee: $${actualStripeFee.toFixed(2)} (expected: $${expectedStripeFee.toFixed(2)})`);
      }

      // Credit wallet with the requested amount (exact, no bonus/refund needed)
      await walletService.confirmTopUp({
        userId: user._id,
        paymentIntentId: paymentIntent.id,
        amount: walletCredit, // Credit exact wallet amount requested
        stripeFee: actualStripeFee // Actual fee charged (should match expected)
      });

      // Update the Payment record with receipt URL
      if (receiptUrl) {
        await Payment.findOneAndUpdate(
          { stripePaymentIntentId: paymentIntent.id },
          { receiptUrl: receiptUrl }
        );
        console.log(`✅ Receipt URL saved to Payment record`);
      }

      console.log(`✅ Wallet top-up successful - Charged $${totalCharge}, Credited $${walletCredit} to user ${user.email}`);

      res.json({
        success: true,
        message: 'Wallet top-up successful',
        newBalance: await walletService.getBalance(user._id)
      });
    } else {
      console.error(`❌ Payment intent not succeeded: ${paymentIntent.status}`);
      res.status(400).json({
        success: false,
        message: 'Payment failed. Please try again or use a different card.'
      });
    }
  } catch (error) {
    console.error('❌ Error processing top-up with saved card:', error);
    
    // Handle Stripe-specific errors
    if (error.type === 'StripeCardError') {
      return res.status(400).json({
        success: false,
        message: error.message || 'Card declined. Please try another card.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to process payment',
      error: error.message
    });
  }
});

module.exports = router;

