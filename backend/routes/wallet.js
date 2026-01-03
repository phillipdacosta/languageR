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
    const { amount, paymentMethodId, customerId: requestCustomerId } = req.body; // Extract customerId from request

    if (!amount || typeof amount !== 'number' || amount < 1) {
      return res.status(400).json({ success: false, message: 'Valid amount required (minimum $1)' });
    }

    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Try to get customer ID from: request body, user record, or payment method
    let customerId = requestCustomerId || user.stripeCustomerId;
    
    console.log(`🔍 Customer ID sources - Request: ${requestCustomerId}, User DB: ${user.stripeCustomerId}`);
    
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

    console.log(`💳 Initiating payment - Method: ${paymentMethodId ? 'saved card' : 'new card'}, Customer: ${customerId || 'none'}`);

    const result = await walletService.initiateTopUp({
      userId: user._id,
      amount,
      paymentMethodId, // Pass saved payment method if provided
      customerId: customerId, // Include customer ID (either from user record or retrieved from payment method)
      metadata: {
        userEmail: user.email,
        userName: user.name
      }
    });

    res.json({
      success: true,
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      amount: result.amount
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

    // Verify payment with Stripe (this should be called from webhook ideally)
    const stripeService = require('../services/stripeService');
    const paymentIntent = await stripeService.getPaymentIntent(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment not completed', 
        status: paymentIntent.status 
      });
    }

    const amount = paymentIntent.amount / 100; // Convert from cents
    const stripeFee = (paymentIntent.charges?.data[0]?.application_fee_amount || 0) / 100;

    const wallet = await walletService.confirmTopUp({
      userId: user._id,
      paymentIntentId,
      amount,
      stripeFee
    });

    res.json({
      success: true,
      message: `Successfully added $${amount} to wallet`,
      balance: wallet.balance,
      availableBalance: wallet.availableBalance
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

module.exports = router;

