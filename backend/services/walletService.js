/**
 * Wallet Service - Manages internal wallet ledger
 * 
 * Wallet is a prepaid credit system:
 * - Funds are stored in Stripe platform balance
 * - Wallet is just an internal ledger
 * - Credits are not transferable, not withdrawable
 * - Can be used for lessons and office hours
 */

const Wallet = require('../models/Wallet');
const Payment = require('../models/Payment');
const stripeService = require('./stripeService');

class WalletService {
  /**
   * Format amount to always show 2 decimal places
   * @param {number} amount
   * @returns {string} Formatted amount string (e.g., "7.50")
   */
  formatAmount(amount) {
    return typeof amount === 'number' ? amount.toFixed(2) : parseFloat(amount || 0).toFixed(2);
  }

  /**
   * Get or create wallet for a user
   * @param {string} userId - MongoDB User ID
   * @returns {Promise<Object>} Wallet document
   */
  async getWallet(userId) {
    let wallet = await Wallet.findOne({ userId });
    
    if (!wallet) {
      wallet = await Wallet.create({
        userId,
        balance: 0,
        reservedBalance: 0,
        transactions: []
      });
      console.log(`✨ Created new wallet for user: ${userId}`);
    }
    
    return wallet;
  }

  /**
   * Get wallet balance
   * @param {string} userId
   * @returns {Promise<Object>} Balance info
   */
  async getBalance(userId) {
    const wallet = await this.getWallet(userId);
    
    return {
      balance: wallet.balance,
      reservedBalance: wallet.reservedBalance,
      availableBalance: wallet.availableBalance,
      currency: wallet.currency
    };
  }

  /**
   * Initiate wallet top-up (creates Stripe PaymentIntent)
   * @param {Object} params
   * @param {string} params.userId - MongoDB User ID
   * @param {number} params.amount - Amount in dollars
   * @param {string} params.paymentMethodId - Optional saved payment method ID
   * @param {string} params.customerId - Optional Stripe customer ID
   * @param {Object} params.metadata - Additional metadata
   * @returns {Promise<Object>} PaymentIntent client secret and details
   */
  async initiateTopUp({ userId, walletCredit, totalCharge, stripeFee, paymentMethodId = null, customerId = null, saveCard = false, metadata = {} }) {
    // Validate wallet credit (what they'll receive)
    if (walletCredit < 1) {
      throw new Error('Minimum wallet credit amount is $1');
    }

    if (walletCredit > 500) {
      throw new Error('Maximum wallet credit amount is $500');
    }

    // Validate total charge
    if (totalCharge <= walletCredit) {
      throw new Error('Total charge must be greater than wallet credit');
    }

    console.log(`💳 [WalletService] initiateTopUp called with:`, {
      userId,
      walletCredit,
      totalCharge,
      stripeFee,
      paymentMethodId,
      customerId,
      hasBothForSavedCard: !!(paymentMethodId && customerId)
    });

    // Build PaymentIntent options
    // Amount to charge is the TOTAL (including exact fee based on card country)
    const paymentIntentOptions = {
      amount: totalCharge, // Charge the exact total including fee
      currency: 'usd',
      metadata: {
        userId: userId.toString(),
        type: 'wallet_top_up',
        walletCredit: walletCredit.toString(),
        expectedStripeFee: stripeFee.toString(),
        saveCard: saveCard?.toString(), // Include saveCard flag in metadata
        ...metadata
      }
    };

    // If using saved payment method, include customer and payment method
    if (paymentMethodId && customerId) {
      paymentIntentOptions.customerId = customerId; // Changed from 'customer' to 'customerId'
      paymentIntentOptions.payment_method = paymentMethodId;
      console.log(`💳 Creating PaymentIntent with saved card for customer ${customerId}`);
    } else if (paymentMethodId && !customerId) {
      console.error(`❌ Payment method provided (${paymentMethodId}) but no customer ID!`);
      throw new Error('Cannot use saved payment method without customer ID');
    }

    // Create Stripe PaymentIntent for the exact total charge
    const paymentIntent = await stripeService.createPaymentIntent(paymentIntentOptions);

    console.log(`💳 Wallet top-up initiated: Charging $${this.formatAmount(totalCharge)} (Credit: $${this.formatAmount(walletCredit)}, Fee: $${this.formatAmount(stripeFee)}) for user ${userId}`);

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: totalCharge // Return total charge amount
    };
  }

  /**
   * Confirm wallet top-up after Stripe payment succeeds
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.paymentIntentId - Stripe PaymentIntent ID
   * @param {number} params.amount - Amount successfully charged
   * @param {number} params.stripeFee - Stripe processing fee
   * @returns {Promise<Object>} Updated wallet
   */
  async confirmTopUp({ userId, paymentIntentId, amount, stripeFee = 0 }) {
    const wallet = await this.getWallet(userId);

    // Add to balance
    const previousBalance = wallet.balance;
    wallet.balance += amount;

    // Record transaction
    wallet.transactions.push({
      type: 'top_up',
      amount,
      balanceAfter: wallet.balance,
      stripePaymentIntentId: paymentIntentId,
      description: `Wallet top-up: $${this.formatAmount(amount)}`,
      createdAt: new Date(),
      metadata: { stripeFee }
    });

    await wallet.save();

    // Create Payment record for accounting
    await Payment.create({
      userId,
      amount,
      paymentMethod: 'card', // Top-ups are always via card/Apple Pay
      paymentType: 'wallet_top_up',
      status: 'succeeded',
      stripePaymentIntentId: paymentIntentId,
      stripeFee,
      stripeNetAmount: amount - stripeFee,
      metadata: {
        type: 'wallet_top_up',
        balanceBefore: previousBalance,
        balanceAfter: wallet.balance
      }
    });

    console.log(`✅ Wallet top-up confirmed: $${amount} added to user ${userId} (new balance: $${wallet.balance})`);

    return wallet;
  }

  /**
   * Reserve funds for a lesson (don't charge yet, just lock the funds)
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.lessonId
   * @param {number} params.amount
   * @returns {Promise<Object>} Updated wallet
   */
  async reserveFunds({ userId, lessonId, amount }) {
    const wallet = await this.getWallet(userId);

    if (wallet.availableBalance < amount) {
      throw new Error(`Insufficient wallet balance. Available: $${this.formatAmount(wallet.availableBalance)}, Required: $${this.formatAmount(amount)}`);
    }

    // Reserve the funds
    wallet.reservedBalance += amount;

    // Record reservation transaction
    wallet.transactions.push({
      type: 'reservation',
      amount: -amount, // Negative to show it's locked
      balanceAfter: wallet.balance, // Balance doesn't change, just reserved
      lessonId,
      description: `Reserved $${this.formatAmount(amount)} for lesson`,
      createdAt: new Date()
    });

    await wallet.save();

    console.log(`🔒 Reserved $${amount} from wallet for lesson ${lessonId} (user: ${userId})`);

    return wallet;
  }

  /**
   * Release reserved funds when a lesson is cancelled
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.lessonId
   * @param {number} params.amount
   * @param {string} params.reason - Reason for release (e.g., 'lesson_cancelled')
   * @returns {Promise<Object>} Updated wallet
   */
  async releaseReservedFunds({ userId, lessonId, amount, reason = 'lesson_cancelled' }) {
    const wallet = await this.getWallet(userId);

    if (wallet.reservedBalance < amount) {
      console.warn(`⚠️ Warning: Attempting to release $${this.formatAmount(amount)} but only $${this.formatAmount(wallet.reservedBalance)} is reserved`);
      // Still proceed to release what we can
      amount = Math.min(amount, wallet.reservedBalance);
    }

    // Release the reserved funds back to available balance
    wallet.reservedBalance -= amount;

    // Record release transaction
    wallet.transactions.push({
      type: 'release',
      amount: amount, // Positive to show funds are released
      balanceAfter: wallet.balance, // Balance doesn't change, just unreserved
      lessonId,
      description: `Released $${this.formatAmount(amount)} - ${reason}`,
      createdAt: new Date()
    });

    await wallet.save();

    console.log(`🔓 Released $${this.formatAmount(amount)} from reserved funds for lesson ${lessonId} (user: ${userId}). Reason: ${reason}`);

    return wallet;
  }

  /**
   * Deduct funds when lesson completes
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.lessonId
   * @param {number} params.amount
   * @param {string} params.paymentId - Link to Payment record
   * @returns {Promise<Object>} Updated wallet
   */
  async deductFunds({ userId, lessonId, amount, paymentId = null }) {
    const wallet = await this.getWallet(userId);

    // Release reservation and deduct from balance
    wallet.reservedBalance -= amount;
    wallet.balance -= amount;

    // Record deduction transaction
    wallet.transactions.push({
      type: 'deduction',
      amount: -amount,
      balanceAfter: wallet.balance,
      lessonId,
      paymentId,
      description: `Payment for lesson`,
      createdAt: new Date()
    });

    await wallet.save();

    console.log(`💸 Deducted $${amount} from wallet for lesson ${lessonId} (user: ${userId}, new balance: $${wallet.balance})`);

    return wallet;
  }

  /**
   * Refund to wallet (preferred refund method)
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.lessonId
   * @param {number} params.amount
   * @param {string} params.reason
   * @param {string} params.paymentId
   * @returns {Promise<Object>} Updated wallet
   */
  async refund({ userId, lessonId, amount, reason, paymentId = null }) {
    const wallet = await this.getWallet(userId);

    // Add refund to balance
    wallet.balance += amount;

    // Record refund transaction
    wallet.transactions.push({
      type: 'refund',
      amount,
      balanceAfter: wallet.balance,
      lessonId,
      paymentId,
      description: reason || 'Lesson refund',
      createdAt: new Date()
    });

    await wallet.save();

    console.log(`💰 Refunded $${amount} to wallet for user ${userId} (reason: ${reason})`);

    return wallet;
  }

  /**
   * Release reserved funds (e.g., if booking cancelled before completion)
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.lessonId
   * @param {number} params.amount
   * @returns {Promise<Object>} Updated wallet
   */
  async releaseReservation({ userId, lessonId, amount }) {
    const wallet = await this.getWallet(userId);

    // Release the reservation
    wallet.reservedBalance -= amount;

    // Record release transaction
    wallet.transactions.push({
      type: 'release',
      amount, // Positive since it's being released back
      balanceAfter: wallet.balance,
      lessonId,
      description: `Cancelled lesson - funds released`,
      createdAt: new Date()
    });

    await wallet.save();

    console.log(`🔓 Released $${amount} reservation for lesson ${lessonId} (user: ${userId})`);

    return wallet;
  }

  /**
   * Get transaction history
   * @param {string} userId
   * @param {number} limit - Max number of transactions to return
   * @returns {Promise<Array>} Transaction history
   */
  async getTransactionHistory(userId, limit = 50) {
    const wallet = await this.getWallet(userId);

    // Return latest transactions first
    return wallet.transactions
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
}

module.exports = new WalletService();

