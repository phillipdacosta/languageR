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
    await this.getWallet(userId);

    const updated = await Wallet.findOneAndUpdate(
      { userId },
      {
        $inc: { balance: amount },
        $push: {
          transactions: {
            type: 'top_up',
            amount,
            balanceAfter: 0,
            stripePaymentIntentId: paymentIntentId,
            description: `Wallet top-up: $${this.formatAmount(amount)}`,
            createdAt: new Date(),
            metadata: { stripeFee }
          }
        }
      },
      { new: true }
    );

    // Fix balanceAfter on last transaction
    const lastTx = updated.transactions[updated.transactions.length - 1];
    if (lastTx) {
      lastTx.balanceAfter = updated.balance;
      await updated.save();
    }

    // Create Payment record for accounting
    await Payment.create({
      userId,
      amount,
      paymentMethod: 'card',
      paymentType: 'wallet_top_up',
      status: 'succeeded',
      stripePaymentIntentId: paymentIntentId,
      stripeFee,
      stripeNetAmount: amount - stripeFee,
      metadata: {
        type: 'wallet_top_up',
        balanceBefore: updated.balance - amount,
        balanceAfter: updated.balance
      }
    });

    console.log(`✅ Wallet top-up confirmed: $${amount} added to user ${userId} (new balance: $${updated.balance})`);

    return updated;
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
    // Ensure wallet exists first
    await this.getWallet(userId);

    // Atomic: only reserve if balance - reservedBalance >= amount
    // Since availableBalance is a virtual (balance - reservedBalance),
    // we use $inc on reservedBalance with a $expr guard.
    const updated = await Wallet.findOneAndUpdate(
      {
        userId,
        $expr: { $gte: [{ $subtract: ['$balance', '$reservedBalance'] }, amount] }
      },
      {
        $inc: { reservedBalance: amount },
        $push: {
          transactions: {
            type: 'reservation',
            amount: -amount,
            balanceAfter: 0, // Will be corrected below
            lessonId,
            description: `Reserved $${this.formatAmount(amount)} for lesson`,
            createdAt: new Date()
          }
        }
      },
      { new: true }
    );

    if (!updated) {
      const wallet = await this.getWallet(userId);
      throw new Error(`Insufficient wallet balance. Available: $${this.formatAmount(wallet.availableBalance)}, Required: $${this.formatAmount(amount)}`);
    }

    // Fix the balanceAfter on the last transaction
    const lastTx = updated.transactions[updated.transactions.length - 1];
    if (lastTx) {
      lastTx.balanceAfter = updated.balance;
      await updated.save();
    }

    console.log(`🔒 Reserved $${amount} from wallet for lesson ${lessonId} (user: ${userId})`);

    return updated;
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
    // Clamp to what's actually reserved
    const wallet = await this.getWallet(userId);
    if (wallet.reservedBalance < amount) {
      console.warn(`⚠️ Warning: Attempting to release $${this.formatAmount(amount)} but only $${this.formatAmount(wallet.reservedBalance)} is reserved`);
      amount = Math.min(amount, wallet.reservedBalance);
    }
    if (amount <= 0) return wallet;

    const updated = await Wallet.findOneAndUpdate(
      { userId, reservedBalance: { $gte: amount } },
      {
        $inc: { reservedBalance: -amount },
        $push: {
          transactions: {
            type: 'release',
            amount: amount,
            balanceAfter: 0,
            lessonId,
            description: `Released $${this.formatAmount(amount)} - ${reason}`,
            createdAt: new Date()
          }
        }
      },
      { new: true }
    );

    if (updated) {
      const lastTx = updated.transactions[updated.transactions.length - 1];
      if (lastTx) { lastTx.balanceAfter = updated.balance; await updated.save(); }
    }

    console.log(`🔓 Released $${this.formatAmount(amount)} from reserved funds for lesson ${lessonId} (user: ${userId}). Reason: ${reason}`);

    return updated || wallet;
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
    const updated = await Wallet.findOneAndUpdate(
      { userId, balance: { $gte: amount }, reservedBalance: { $gte: amount } },
      {
        $inc: { reservedBalance: -amount, balance: -amount },
        $push: {
          transactions: {
            type: 'deduction',
            amount: -amount,
            balanceAfter: 0,
            lessonId,
            paymentId,
            description: `Payment for lesson`,
            createdAt: new Date()
          }
        }
      },
      { new: true }
    );

    if (!updated) {
      const wallet = await this.getWallet(userId);
      throw new Error(`Cannot deduct $${this.formatAmount(amount)} — balance: $${this.formatAmount(wallet.balance)}, reserved: $${this.formatAmount(wallet.reservedBalance)}`);
    }

    const lastTx = updated.transactions[updated.transactions.length - 1];
    if (lastTx) { lastTx.balanceAfter = updated.balance; await updated.save(); }

    console.log(`💸 Deducted $${amount} from wallet for lesson ${lessonId} (user: ${userId}, new balance: $${updated.balance})`);

    return updated;
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
    await this.getWallet(userId);

    const updated = await Wallet.findOneAndUpdate(
      { userId },
      {
        $inc: { balance: amount },
        $push: {
          transactions: {
            type: 'refund',
            amount,
            balanceAfter: 0,
            lessonId,
            paymentId,
            description: reason || 'Lesson refund',
            createdAt: new Date()
          }
        }
      },
      { new: true }
    );

    const lastTx = updated.transactions[updated.transactions.length - 1];
    if (lastTx) { lastTx.balanceAfter = updated.balance; await updated.save(); }

    console.log(`💰 Refunded $${amount} to wallet for user ${userId} (reason: ${reason})`);

    return updated;
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
    const updated = await Wallet.findOneAndUpdate(
      { userId, reservedBalance: { $gte: amount } },
      {
        $inc: { reservedBalance: -amount },
        $push: {
          transactions: {
            type: 'release',
            amount,
            balanceAfter: 0,
            lessonId,
            description: `Cancelled lesson - funds released`,
            createdAt: new Date()
          }
        }
      },
      { new: true }
    );

    if (updated) {
      const lastTx = updated.transactions[updated.transactions.length - 1];
      if (lastTx) { lastTx.balanceAfter = updated.balance; await updated.save(); }
    } else {
      console.warn(`⚠️ Could not release $${amount} reservation for lesson ${lessonId} — insufficient reserved balance`);
      return await this.getWallet(userId);
    }

    console.log(`🔓 Released $${amount} reservation for lesson ${lessonId} (user: ${userId})`);

    return updated;
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

