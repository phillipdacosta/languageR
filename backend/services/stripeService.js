/**
 * Stripe Service - Handles all Stripe API interactions
 * 
 * Features:
 * - Payment Intent creation (for direct payments and wallet top-ups)
 * - Stripe Connect account management (for tutor payouts)
 * - Transfers to tutors via Stripe Connect
 * - Refunds (card refunds, not wallet)
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// Check if Stripe is properly configured
const isStripeConfigured = !!process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('placeholder');

if (!isStripeConfigured) {
  console.warn('⚠️  WARNING: STRIPE_SECRET_KEY not configured. Payment features will be disabled.');
  console.warn('⚠️  Add STRIPE_SECRET_KEY to your .env file to enable payments.');
}

class StripeService {
  /**
   * Create a PaymentIntent for direct payment or wallet top-up
   * @param {Object} params
   * @param {number} params.amount - Amount in dollars (will be converted to cents)
   * @param {string} params.currency - Currency code (default: 'usd')
   * @param {Object} params.metadata - Additional metadata
   * @param {string} params.customerId - Stripe Customer ID (optional)
   * @param {string} params.payment_method - Stripe Payment Method ID (optional, for saved cards)
   * @returns {Promise<Object>} Payment Intent object
   */
  async createPaymentIntent({ amount, currency = 'usd', metadata = {}, customerId = null, payment_method = null }) {
    if (!isStripeConfigured) {
      throw new Error('Stripe is not configured. Please add STRIPE_SECRET_KEY to .env file.');
    }
    
    try {
      const params = {
        amount: Math.round(amount * 100), // Convert dollars to cents
        currency,
        metadata,
        // Use manual capture for lesson bookings, automatic for wallet top-ups
        capture_method: metadata.type === 'lesson_booking' ? 'manual' : 'automatic',
        payment_method_types: ['card'] // Can add 'apple_pay', 'google_pay', etc.
      };

      if (customerId) {
        params.customer = customerId;
      }

      if (payment_method) {
        params.payment_method = payment_method;
      }

      const paymentIntent = await stripe.paymentIntents.create(params);
      
      console.log(`💳 Created PaymentIntent: ${paymentIntent.id} for $${amount} (capture: ${params.capture_method})`);
      
      return paymentIntent;
    } catch (error) {
      console.error('❌ Stripe PaymentIntent creation failed:', error.message);
      throw new Error(`Payment Intent creation failed: ${error.message}`);
    }
  }

  /**
   * Retrieve a PaymentIntent
   * @param {string} paymentIntentId
   * @returns {Promise<Object>} Payment Intent object
   */
  async getPaymentIntent(paymentIntentId) {
    try {
      return await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
      console.error('❌ Failed to retrieve PaymentIntent:', error.message);
      throw new Error(`Failed to retrieve payment: ${error.message}`);
    }
  }

  /**
   * Create or get Stripe Customer for a user
   * @param {Object} params
   * @param {string} params.email - User email
   * @param {string} params.name - User name
   * @param {Object} params.metadata - Additional metadata
   * @returns {Promise<Object>} Stripe Customer object
   */
  async createCustomer({ email, name, metadata = {} }) {
    try {
      const customer = await stripe.customers.create({
        email,
        name,
        metadata
      });
      
      console.log(`👤 Created Stripe Customer: ${customer.id} for ${email}`);
      
      return customer;
    } catch (error) {
      console.error('❌ Stripe Customer creation failed:', error.message);
      throw new Error(`Customer creation failed: ${error.message}`);
    }
  }

  /**
   * Create Stripe Connect account for tutor
   * @param {Object} params
   * @param {string} params.email - Tutor email
   * @param {string} params.country - Country code (default: 'US')
   * @param {Object} params.metadata - Additional metadata
   * @returns {Promise<Object>} Stripe Connect Account object
   */
  async createConnectAccount({ email, country = 'US', metadata = {} }) {
    try {
      const account = await stripe.accounts.create({
        type: 'express', // Express accounts for easier onboarding
        country,
        email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        metadata
      });
      
      console.log(`🔗 Created Stripe Connect Account: ${account.id} for ${email}`);
      
      return account;
    } catch (error) {
      console.error('❌ Stripe Connect account creation failed:', error.message);
      throw new Error(`Connect account creation failed: ${error.message}`);
    }
  }

  /**
   * Create Account Link for Stripe Connect onboarding
   * @param {Object} params
   * @param {string} params.accountId - Stripe Connect Account ID
   * @param {string} params.refreshUrl - URL to redirect if link expires
   * @param {string} params.returnUrl - URL to redirect after onboarding
   * @returns {Promise<Object>} Account Link object with URL
   */
  async createAccountLink({ accountId, refreshUrl, returnUrl }) {
    try {
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding'
      });
      
      console.log(`🔗 Created Account Link for: ${accountId}`);
      
      return accountLink;
    } catch (error) {
      console.error('❌ Account Link creation failed:', error.message);
      throw new Error(`Account link creation failed: ${error.message}`);
    }
  }

  /**
   * Get Stripe Connect account details
   * @param {string} accountId - Stripe Connect Account ID
   * @returns {Promise<Object>} Account object
   */
  async getAccount(accountId) {
    try {
      return await stripe.accounts.retrieve(accountId);
    } catch (error) {
      console.error('❌ Failed to retrieve account:', error.message);
      throw new Error(`Failed to retrieve account: ${error.message}`);
    }
  }

  /**
   * Create login link for Stripe Express Dashboard
   * @param {string} accountId - Stripe Connect Account ID
   * @returns {Promise<Object>} Login link object
   */
  async createLoginLink(accountId) {
    if (!isStripeConfigured) {
      throw new Error('Stripe is not configured. Please add STRIPE_SECRET_KEY to .env file.');
    }
    
    try {
      const loginLink = await stripe.accounts.createLoginLink(accountId);
      console.log(`🔗 Created login link for Stripe Express Dashboard: ${accountId}`);
      return loginLink;
    } catch (error) {
      console.error('❌ Login link creation failed:', error.message);
      throw new Error(`Login link creation failed: ${error.message}`);
    }
  }

  /**
   * Transfer funds to tutor via Stripe Connect
   * @param {Object} params
   * @param {number} params.amount - Amount in dollars
   * @param {string} params.destination - Stripe Connect Account ID
   * @param {Object} params.metadata - Additional metadata
   * @returns {Promise<Object>} Transfer object
   */
  async createTransfer({ amount, destination, metadata = {} }) {
    try {
      const transfer = await stripe.transfers.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        destination,
        metadata
      });
      
      console.log(`💸 Created transfer: ${transfer.id} for $${amount} to ${destination}`);
      
      return transfer;
    } catch (error) {
      console.error('❌ Transfer creation failed:', error.message);
      throw new Error(`Transfer failed: ${error.message}`);
    }
  }

  /**
   * Create a refund for a PaymentIntent
   * @param {Object} params
   * @param {string} params.paymentIntentId - PaymentIntent ID to refund
   * @param {number} params.amount - Amount to refund in dollars (optional, full refund if not specified)
   * @param {string} params.reason - Reason for refund
   * @returns {Promise<Object>} Refund object
   */
  async createRefund({ paymentIntentId, amount = null, reason = 'requested_by_customer' }) {
    try {
      const refundParams = {
        payment_intent: paymentIntentId,
        reason
      };

      if (amount) {
        refundParams.amount = Math.round(amount * 100); // Convert to cents
      }

      const refund = await stripe.refunds.create(refundParams);
      
      console.log(`💰 Created refund: ${refund.id} for PaymentIntent: ${paymentIntentId}`);
      
      return refund;
    } catch (error) {
      console.error('❌ Refund creation failed:', error.message);
      throw new Error(`Refund failed: ${error.message}`);
    }
  }

  /**
   * Get balance (platform balance from Stripe)
   * @returns {Promise<Object>} Balance object
   */
  async getBalance() {
    try {
      return await stripe.balance.retrieve();
    } catch (error) {
      console.error('❌ Failed to retrieve balance:', error.message);
      throw new Error(`Failed to retrieve balance: ${error.message}`);
    }
  }
  
  /**
   * Create a payout from platform balance to bank account
   * Used to move tutor earnings from Stripe balance to platform bank,
   * which can then be used to fund PayPal payouts
   * @param {Object} params
   * @param {number} params.amount - Amount in dollars
   * @param {Object} params.metadata - Additional metadata
   * @returns {Promise<Object>} Payout object
   */
  async createPayout({ amount, metadata = {} }) {
    try {
      const payout = await stripe.payouts.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        metadata,
        method: 'standard' // standard = 1-2 business days, instant = immediate but has fees
      });
      
      console.log(`💰 Created Stripe payout: ${payout.id} for $${amount} (status: ${payout.status})`);
      
      return payout;
    } catch (error) {
      console.error('❌ Payout creation failed:', error.message);
      throw new Error(`Payout failed: ${error.message}`);
    }
  }

  /**
   * Get payout details
   * @param {string} payoutId - Stripe Payout ID
   * @returns {Promise<Object>} Payout object
   */
  async getPayout(payoutId) {
    try {
      const payout = await stripe.payouts.retrieve(payoutId);
      return payout;
    } catch (error) {
      console.error('❌ Failed to retrieve payout:', error.message);
      throw new Error(`Failed to retrieve payout: ${error.message}`);
    }
  }
  
  /**
   * Attach a payment method to a customer
   * @param {string} paymentMethodId - Stripe Payment Method ID
   * @param {string} customerId - Stripe Customer ID
   * @returns {Promise<Object>} Payment Method object
   */
  async attachPaymentMethod(paymentMethodId, customerId) {
    try {
      const paymentMethod = await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId
      });
      console.log(`✅ Attached payment method ${paymentMethodId} to customer ${customerId}`);
      return paymentMethod;
    } catch (error) {
      console.error('❌ Error attaching payment method:', error);
      throw error;
    }
  }
  
  /**
   * Detach a payment method from a customer
   * @param {string} paymentMethodId - Stripe Payment Method ID
   * @returns {Promise<Object>} Payment Method object
   */
  async detachPaymentMethod(paymentMethodId) {
    try {
      const paymentMethod = await stripe.paymentMethods.detach(paymentMethodId);
      console.log(`✅ Detached payment method ${paymentMethodId}`);
      return paymentMethod;
    } catch (error) {
      console.error('❌ Error detaching payment method:', error);
      throw error;
    }
  }
  
  /**
   * Get payment method details
   * @param {string} paymentMethodId - Stripe Payment Method ID
   * @returns {Promise<Object>} Payment Method object
   */
  async getPaymentMethod(paymentMethodId) {
    try {
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
      return paymentMethod;
    } catch (error) {
      console.error('❌ Error retrieving payment method:', error);
      throw error;
    }
  }
}

module.exports = new StripeService();

