const mongoose = require('mongoose');
const Withdrawal = require('../models/Withdrawal');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Notification = require('../models/Notification');

// Common currency symbols for human-readable payout messages.
const CURRENCY_SYMBOLS = { usd: '$', eur: '€', gbp: '£', cad: 'CA$', aud: 'A$' };

/**
 * Format an amount with its currency symbol (falls back to the upper-cased code).
 * @param {Number} amount
 * @param {String} currency - ISO currency code (e.g. 'eur')
 */
function formatMoney(amount, currency) {
  const code = (currency || 'usd').toLowerCase();
  const value = Number(amount || 0).toFixed(2);
  const symbol = CURRENCY_SYMBOLS[code];
  return symbol ? `${symbol}${value}` : `${value} ${code.toUpperCase()}`;
}

// Lazy-load Stripe to ensure environment variables are loaded first
let stripe;
function getStripeClient() {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

/**
 * Withdrawal Service
 * Handles tutor withdrawal requests from internal balance to external payment methods
 * 
 * Flow:
 * 1. Tutor requests withdrawal
 * 2. System validates balance and method
 * 3. System reserves balance and creates withdrawal record
 * 4. Cron job processes withdrawal (transfers funds from platform Stripe to tutor)
 * 5. System marks withdrawal complete and updates balances
 */

class WithdrawalService {
  
  /**
   * Request a withdrawal
   * @param {String} tutorId - Tutor's MongoDB ID
   * @param {Number} amount - Amount to withdraw
   * @param {String} method - 'stripe_connect' or 'paypal'
   * @returns {Object} Withdrawal record
   */
  async requestWithdrawal({ tutorId, amount, method, idempotencyKey }) {
    console.log(`\n💰 [WITHDRAWAL] Request initiated: tutorId=${tutorId}, amount=$${amount}, method=${method}`);
    
    // Get tutor for pre-flight validation (method config, minimum amounts)
    const tutor = await User.findById(tutorId);
    if (!tutor || tutor.userType !== 'tutor') {
      throw new Error('Invalid tutor');
    }
    
    // Ensure withdrawalSettings exists with updated defaults
    if (!tutor.withdrawalSettings || !tutor.withdrawalSettings.minimumAmount) {
      tutor.withdrawalSettings = {
        minimumAmount: 10,
        autoWithdraw: false,
        autoWithdrawThreshold: 100
      };
      await tutor.save();
      console.log('✅ Updated withdrawal settings to new defaults');
    } else if (tutor.withdrawalSettings.minimumAmount === 20) {
      tutor.withdrawalSettings.minimumAmount = 10;
      await tutor.save();
      console.log('✅ Migrated withdrawal minimum from $20 to $10');
    }
    
    // Pre-flight validation (non-atomic, but these are config checks that don't race)
    if (method === 'paypal' && amount < tutor.withdrawalSettings.minimumAmount) {
      throw new Error(`Minimum withdrawal is $${tutor.withdrawalSettings.minimumAmount}`);
    }
    if (method === 'stripe_connect' && amount < 0.01) {
      throw new Error('Withdrawal amount must be at least $0.01');
    }
    if (method === 'stripe_connect') {
      if (!tutor.stripeConnectOnboarded || !tutor.stripePayoutsEnabled) {
        throw new Error('Stripe Connect not fully configured. Please complete onboarding.');
      }
    } else if (method === 'paypal') {
      if (!tutor.payoutDetails?.paypalEmail) {
        throw new Error('PayPal email not configured. Please add your PayPal email in settings.');
      }
    } else {
      throw new Error('Invalid withdrawal method');
    }
    
    // ── ATOMIC balance deduction ──
    // Uses findOneAndUpdate with $gte guard so two concurrent requests
    // cannot both pass — only the first one to decrement wins.
    const roundedAmount = Math.round(amount * 100) / 100;
    const updatedTutor = await User.findOneAndUpdate(
      {
        _id: tutorId,
        'tutorEarnings.availableBalance': { $gte: roundedAmount }
      },
      {
        $inc: { 'tutorEarnings.availableBalance': -roundedAmount }
      },
      { new: true }
    );
    
    if (!updatedTutor) {
      // Re-read to give an accurate error message
      const freshTutor = await User.findById(tutorId);
      const currentBalance = freshTutor?.tutorEarnings?.availableBalance ?? 0;
      throw new Error(`Insufficient balance. Available: $${currentBalance.toFixed(2)}`);
    }
    
    console.log(`🔒 Atomically deducted $${roundedAmount} — new balance: $${updatedTutor.tutorEarnings.availableBalance.toFixed(2)}`);
    
    // Everything below happens after the balance is reserved.
    // If anything fails, we roll back the atomic deduction.
    try {
      // Find available payments to include in this withdrawal
      const availablePayments = await Payment.find({
        tutorId: new mongoose.Types.ObjectId(tutorId),
        transferStatus: 'available',
        tutorPayout: { $gt: 0 }
      }).sort({ earningsReleaseDate: 1 });
      
      console.log(`📊 Found ${availablePayments.length} available payments totaling $${availablePayments.reduce((sum, p) => sum + p.tutorPayout, 0).toFixed(2)}`);
      
      if (availablePayments.length === 0) {
        throw new Error('No available earnings to withdraw');
      }
      
      // Select payments to include (up to requested amount)
      let remaining = roundedAmount;
      const paymentsToInclude = [];
      let paymentToSplit = null;
      let splitAmount = 0;
      
      for (const payment of availablePayments) {
        if (remaining <= 0) break;
        
        if (payment.tutorPayout <= remaining) {
          paymentsToInclude.push(payment._id);
          remaining -= payment.tutorPayout;
          console.log(`  ✅ Including full payment ${payment._id}: $${payment.tutorPayout}`);
        } else {
          paymentToSplit = payment;
          splitAmount = remaining;
          paymentsToInclude.push(payment._id);
          console.log(`  ✂️  Splitting payment ${payment._id}: taking $${splitAmount} of $${payment.tutorPayout}`);
          remaining = 0;
          break;
        }
      }
      
      if (paymentsToInclude.length === 0) {
        throw new Error('Unable to allocate payments for withdrawal');
      }
      
      // Calculate fees
      let platformFee = 0;
      let paypalFee = 0;
      let stripeFee = 0;
      
      if (method === 'paypal') {
        paypalFee = Math.max(0.25, roundedAmount * 0.02);
        paypalFee = Math.min(paypalFee, 20);
        paypalFee = Math.round(paypalFee * 100) / 100;
        console.log(`💸 PayPal fee calculated: $${paypalFee}`);
      }
      
      const netAmount = roundedAmount - platformFee - paypalFee - stripeFee;
      
      console.log(`📝 Withdrawal breakdown: Amount=$${roundedAmount}, Fees=$${platformFee + paypalFee + stripeFee}, Net=$${netAmount}`);
      
      // If we need to split a payment, create the remainder payment first
      if (paymentToSplit && splitAmount < paymentToSplit.tutorPayout) {
        const remainderAmount = paymentToSplit.tutorPayout - splitAmount;
        console.log(`✂️  Creating remainder payment: $${remainderAmount.toFixed(2)}`);
        
        const remainderPayment = new Payment({
          lessonId: paymentToSplit.lessonId,
          studentId: paymentToSplit.studentId,
          userId: paymentToSplit.userId,
          tutorId: paymentToSplit.tutorId,
          amount: remainderAmount,
          platformFee: 0,
          tutorPayout: remainderAmount,
          paymentType: paymentToSplit.paymentType,
          paymentMethod: paymentToSplit.paymentMethod,
          paymentIntentId: `${paymentToSplit.paymentIntentId}_split_${Date.now()}`,
          status: 'succeeded',
          transferStatus: 'available',
          revenueRecognized: true,
          earningsReleaseDate: paymentToSplit.earningsReleaseDate,
          metadata: {
            ...paymentToSplit.metadata,
            splitFrom: paymentToSplit._id.toString(),
            splitReason: 'Partial withdrawal - remainder after withdrawal',
            splitDate: new Date()
          }
        });
        
        await remainderPayment.save();
        console.log(`✅ Created remainder payment ${remainderPayment._id}: $${remainderAmount.toFixed(2)}`);
        
        paymentToSplit.tutorPayout = splitAmount;
        paymentToSplit.amount = splitAmount;
        paymentToSplit.metadata = {
          ...paymentToSplit.metadata,
          splitInto: remainderPayment._id.toString(),
          splitReason: 'Partial withdrawal - withdrawn portion',
          splitDate: new Date()
        };
        await paymentToSplit.save();
        console.log(`✅ Updated original payment ${paymentToSplit._id}: now $${splitAmount.toFixed(2)}`);
      }
      
      // Create withdrawal request
      const withdrawal = new Withdrawal({
        tutorId,
        amount: roundedAmount,
        method,
        idempotencyKey: idempotencyKey || undefined,
        paymentIds: paymentsToInclude,
        platformFee,
        stripeFee,
        paypalFee,
        netAmount,
        status: 'pending',
        requestedAt: new Date()
      });
      
      await withdrawal.save();
      console.log(`✅ Withdrawal record created: ${withdrawal._id}`);
      
      // Reserve payments for this withdrawal
      await Payment.updateMany(
        { _id: { $in: paymentsToInclude } },
        { 
          transferStatus: 'pending_withdrawal',
          withdrawalId: withdrawal._id
        }
      );
      console.log(`🔒 Reserved ${paymentsToInclude.length} payments for withdrawal`);
      
      console.log(`💼 Tutor balance after withdrawal: Available=$${updatedTutor.tutorEarnings.availableBalance.toFixed(2)}`);
      console.log(`✅ [WITHDRAWAL] Request completed: ${withdrawal._id}\n`);
      
      return withdrawal;
      
    } catch (error) {
      // Roll back the atomic balance deduction
      console.error(`❌ [WITHDRAWAL] Post-deduction failure, rolling back $${roundedAmount}: ${error.message}`);
      await User.findOneAndUpdate(
        { _id: tutorId },
        { $inc: { 'tutorEarnings.availableBalance': roundedAmount } }
      );
      console.log(`🔄 Rolled back $${roundedAmount} to available balance`);
      throw error;
    }
  }
  
  /**
   * Process a pending withdrawal (called by cron job)
   * @param {String} withdrawalId - Withdrawal MongoDB ID
   * @returns {Object} Updated withdrawal record
   */
  async processWithdrawal(withdrawalId) {
    console.log(`\n🔄 [WITHDRAWAL] Processing: ${withdrawalId}`);
    
    const withdrawal = await Withdrawal.findById(withdrawalId)
      .populate('tutorId', 'name stripeConnectAccountId payoutDetails');
    
    if (!withdrawal) {
      throw new Error('Withdrawal not found');
    }
    
    if (withdrawal.status !== 'pending') {
      console.log(`⚠️ Withdrawal ${withdrawalId} is not pending (status: ${withdrawal.status})`);
      return withdrawal;
    }
    
    // Mark as processing
    withdrawal.status = 'processing';
    withdrawal.processedAt = new Date();
    await withdrawal.save();
    console.log(`📝 Status updated to 'processing'`);
    
    try {
      // Execute transfer based on method
      if (withdrawal.method === 'stripe_connect') {
        await this.processStripeWithdrawal(withdrawal);
      } else if (withdrawal.method === 'paypal') {
        await this.processPayPalWithdrawal(withdrawal);
      } else {
        throw new Error(`Unknown withdrawal method: ${withdrawal.method}`);
      }
      
      // Mark as completed
      withdrawal.status = 'completed';
      withdrawal.completedAt = new Date();
      await withdrawal.save();
      console.log(`✅ Withdrawal completed successfully`);
      
      // Update payment statuses
      await Payment.updateMany(
        { _id: { $in: withdrawal.paymentIds } },
        { 
          transferStatus: 'withdrawn',
          transferredAt: new Date()
        }
      );
      console.log(`📝 Updated ${withdrawal.paymentIds.length} payments to 'withdrawn'`);
      
      // Atomic tutor stats update
      const tutor = await User.findOneAndUpdate(
        { _id: withdrawal.tutorId },
        {
          $inc: { 'tutorEarnings.totalWithdrawn': withdrawal.amount },
          $set: { 'tutorEarnings.lastWithdrawal': new Date() }
        },
        { new: true }
      );
      console.log(`💼 Updated tutor stats: totalWithdrawn=$${tutor.tutorEarnings.totalWithdrawn.toFixed(2)}`);
      
      // Create notification for tutor
      try {
        const methodName = withdrawal.method === 'stripe_connect' ? 'Stripe' : 'PayPal';

        // When funds converted to another currency, show the tutor the real
        // amount that landed in their account instead of the USD figure.
        const converted = withdrawal.settledCurrency
          && withdrawal.settledCurrency !== (withdrawal.sourceCurrency || 'usd');
        const settledText = converted && withdrawal.settledNetAmount != null
          ? `${formatMoney(withdrawal.settledNetAmount, withdrawal.settledCurrency)} `
            + `(from $${withdrawal.netAmount.toFixed(2)})`
          : `$${withdrawal.netAmount.toFixed(2)}`;

        const notification = new Notification({
          userId: withdrawal.tutorId,
          type: 'withdrawal_completed',
          title: 'Withdrawal Completed',
          message: `Your withdrawal of ${settledText} to ${methodName} has been processed successfully.`,
          data: {
            withdrawalId: withdrawal._id.toString(),
            amount: withdrawal.amount,
            netAmount: withdrawal.netAmount,
            settledCurrency: withdrawal.settledCurrency || null,
            settledNetAmount: withdrawal.settledNetAmount,
            method: withdrawal.method
          },
          link: '/tabs/home/earnings'
        });
        await notification.save();
        console.log(`📬 Withdrawal notification sent to tutor`);
      } catch (notifError) {
        console.error(`⚠️ Failed to create withdrawal notification:`, notifError.message);
        // Don't fail the withdrawal if notification fails
      }
      
      console.log(`✅ [WITHDRAWAL] Completed: ${withdrawal._id}\n`);
      return withdrawal;
      
    } catch (error) {
      console.error(`❌ [WITHDRAWAL] Failed: ${error.message}`);
      
      // Mark as failed
      withdrawal.status = 'failed';
      withdrawal.failedAt = new Date();
      withdrawal.errorMessage = error.message;
      withdrawal.retryCount += 1;
      await withdrawal.save();
      
      // Atomic rollback of funds to available balance
      const tutor = await User.findOneAndUpdate(
        { _id: withdrawal.tutorId },
        { $inc: { 'tutorEarnings.availableBalance': withdrawal.amount } },
        { new: true }
      );
      console.log(`🔄 Rolled back balance: Available=$${tutor.tutorEarnings.availableBalance.toFixed(2)}`);
      
      // Reset payment statuses
      await Payment.updateMany(
        { _id: { $in: withdrawal.paymentIds } },
        { 
          transferStatus: 'available',
          withdrawalId: null
        }
      );
      console.log(`🔄 Reset ${withdrawal.paymentIds.length} payments to 'available'`);
      
      throw error;
    }
  }
  
  /**
   * Process withdrawal via Stripe Connect
   * Transfers funds from platform Stripe account to tutor's connected account
   */
  async processStripeWithdrawal(withdrawal) {
    console.log(`💳 [STRIPE] Initiating transfer to: ${withdrawal.tutorId.stripeConnectAccountId}`);
    
    try {
      const stripe = getStripeClient();
      
      // Create transfer from platform account to tutor's connected account
      const transfer = await stripe.transfers.create({
        amount: Math.round(withdrawal.netAmount * 100), // Convert to cents
        currency: 'usd',
        destination: withdrawal.tutorId.stripeConnectAccountId,
        description: `Withdrawal: ${withdrawal._id}`,
        metadata: {
          withdrawalId: withdrawal._id.toString(),
          tutorId: withdrawal.tutorId._id.toString(),
          type: 'tutor_withdrawal',
          paymentCount: withdrawal.paymentIds.length
        }
      });
      
      withdrawal.stripeTransferId = transfer.id;
      withdrawal.sourceCurrency = transfer.currency || 'usd';
      await withdrawal.save();
      
      console.log(`✅ [STRIPE] Transfer created: ${transfer.id}`);
      console.log(`💸 Transfer amount: $${(transfer.amount / 100).toFixed(2)}`);

      // Capture what actually landed in the tutor's account (handles FX when the
      // connected account settles in a non-USD currency). Best-effort: never let
      // a settlement-lookup failure break an otherwise-successful transfer.
      try {
        await this.captureStripeSettlement(
          withdrawal,
          transfer,
          withdrawal.tutorId.stripeConnectAccountId
        );
      } catch (settleErr) {
        console.error(`⚠️ [STRIPE] Could not capture settlement details:`, settleErr.message);
      }
      
    } catch (error) {
      console.error(`❌ [STRIPE] Transfer failed:`, error.message);
      throw new Error(`Stripe transfer failed: ${error.message}`);
    }
  }

  /**
   * Capture the real settled amount/currency/FX for a Stripe transfer.
   *
   * When the platform sends USD to a connected account whose default currency
   * differs (e.g. EUR), Stripe creates a destination payment on the connected
   * account in that currency and may deduct a conversion/cross-border fee. The
   * authoritative numbers live on the destination payment's balance transaction,
   * which belongs to the connected account (so it must be read with the
   * `stripeAccount` header).
   *
   * @param {Object} withdrawal - Withdrawal mongoose document (will be saved)
   * @param {Object} transfer - Stripe transfer object from transfers.create
   * @param {String} connectedAccountId - Tutor's Stripe connected account ID
   */
  async captureStripeSettlement(withdrawal, transfer, connectedAccountId) {
    const stripe = getStripeClient();

    // The transfer's destination payment may be returned as an ID or expanded.
    let destinationPaymentId = transfer.destination_payment;
    if (destinationPaymentId && typeof destinationPaymentId === 'object') {
      destinationPaymentId = destinationPaymentId.id;
    }

    // Re-fetch the transfer with the destination payment + its balance
    // transaction expanded if we don't already have it.
    if (!destinationPaymentId) {
      const fullTransfer = await stripe.transfers.retrieve(transfer.id, {
        expand: ['destination_payment']
      });
      destinationPaymentId = typeof fullTransfer.destination_payment === 'object'
        ? fullTransfer.destination_payment?.id
        : fullTransfer.destination_payment;
    }

    if (!destinationPaymentId || !connectedAccountId) {
      console.log(`ℹ️ [STRIPE] No destination payment to inspect for transfer ${transfer.id}`);
      return;
    }

    // The destination payment + its balance transaction live on the connected
    // account, so read them with the connected account context.
    const destinationPayment = await stripe.charges.retrieve(
      destinationPaymentId,
      { expand: ['balance_transaction'] },
      { stripeAccount: connectedAccountId }
    );

    const settledCurrency = (destinationPayment.currency || '').toLowerCase();
    const grossSettled = (destinationPayment.amount || 0) / 100;

    let settledFee = 0;
    let settledNet = grossSettled;
    let exchangeRate = null;

    const bt = destinationPayment.balance_transaction;
    if (bt && typeof bt === 'object') {
      settledFee = (bt.fee || 0) / 100;
      settledNet = (bt.net || destinationPayment.amount || 0) / 100;
      exchangeRate = bt.exchange_rate || null;
    }

    // Derive FX rate from amounts when Stripe doesn't surface one directly.
    if (!exchangeRate && withdrawal.netAmount > 0 && grossSettled > 0) {
      exchangeRate = Math.round((grossSettled / withdrawal.netAmount) * 1e6) / 1e6;
    }

    withdrawal.settledCurrency = settledCurrency || null;
    withdrawal.settledAmount = grossSettled || null;
    withdrawal.settledFee = settledFee;
    withdrawal.settledNetAmount = settledNet;
    withdrawal.exchangeRate = exchangeRate;
    withdrawal.settlementCapturedAt = new Date();
    await withdrawal.save();

    const converted = settledCurrency && settledCurrency !== (withdrawal.sourceCurrency || 'usd');
    console.log(
      `🧾 [STRIPE] Settlement captured: sent $${withdrawal.netAmount.toFixed(2)} ` +
      `→ ${converted ? 'converted ' : ''}${grossSettled.toFixed(2)} ${settledCurrency.toUpperCase()} ` +
      `(fee ${settledFee.toFixed(2)}, net ${settledNet.toFixed(2)}${exchangeRate ? `, rate ${exchangeRate}` : ''})`
    );
  }
  
  /**
   * Process withdrawal via PayPal Payouts
   * Sends funds from platform to tutor's PayPal account
   */
  async processPayPalWithdrawal(withdrawal) {
    console.log(`💰 [PAYPAL] Initiating payout to: ${withdrawal.tutorId.payoutDetails.paypalEmail}`);
    
    // Import PayPal service
    const paypalService = require('./paypalService');
    
    try {
      const result = await paypalService.sendPayout({
        tutorId: withdrawal.tutorId._id,
        paypalEmail: withdrawal.tutorId.payoutDetails.paypalEmail,
        amount: withdrawal.netAmount,
        note: `Withdrawal of $${withdrawal.amount.toFixed(2)} (fee: $${withdrawal.paypalFee.toFixed(2)})`
      });
      
      withdrawal.paypalBatchId = result.batchId;
      withdrawal.paypalPayoutItemId = result.payoutItemId;

      // Estimate PayPal sender fee (charged to the platform by PayPal)
      // Standard PayPal Payouts pricing: 2% of payout amount, min $0.25, max $20
      let senderFee = Math.max(0.25, withdrawal.netAmount * 0.02);
      senderFee = Math.min(senderFee, 20);
      senderFee = Math.round(senderFee * 100) / 100;
      withdrawal.paypalSenderFee = senderFee;

      await withdrawal.save();
      
      console.log(`✅ [PAYPAL] Payout created: Batch=${result.batchId}`);
      console.log(`💸 Payout amount: $${withdrawal.netAmount.toFixed(2)} (tutor fee: $${withdrawal.paypalFee.toFixed(2)}, platform sender fee: $${senderFee.toFixed(2)})`);
      
    } catch (error) {
      console.error(`❌ [PAYPAL] Payout failed:`, error.message);
      throw new Error(`PayPal payout failed: ${error.message}`);
    }
  }
  
  /**
   * Get tutor's withdrawal history
   * @param {String} tutorId - Tutor's MongoDB ID
   * @param {Number} limit - Max number of records to return
   * @returns {Array} Withdrawal records
   */
  async getWithdrawalHistory(tutorId, limit = 20) {
    return await Withdrawal.find({ tutorId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
  
  /**
   * Calculate available balance from payments (for verification)
   * @param {String} tutorId - Tutor's MongoDB ID
   * @returns {Number} Total available balance
   */
  async calculateAvailableBalance(tutorId) {
    const result = await Payment.aggregate([
      {
        $match: {
          tutorId: new mongoose.Types.ObjectId(tutorId),
          transferStatus: 'available'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$tutorPayout' }
        }
      }
    ]);
    
    return result[0]?.total || 0;
  }
  
  /**
   * Calculate pending balance (on hold) from payments
   * @param {String} tutorId - Tutor's MongoDB ID
   * @returns {Number} Total pending balance
   */
  async calculatePendingBalance(tutorId) {
    const result = await Payment.aggregate([
      {
        $match: {
          tutorId: new mongoose.Types.ObjectId(tutorId),
          transferStatus: 'on_hold',
          tutorPayout: { $gt: 0 } // Only count payments where tutorPayout > 0
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$tutorPayout' }
        }
      }
    ]);
    
    return result[0]?.total || 0;
  }
  
  /**
   * Sync tutor's balance with actual payment records (for data integrity)
   * @param {String} tutorId - Tutor's MongoDB ID
   * @returns {Object} Updated balances
   */
  async syncTutorBalance(tutorId) {
    console.log(`\n🔄 [SYNC] Syncing balance for tutor ${tutorId}`);
    
    const tutor = await User.findById(tutorId);
    if (!tutor) throw new Error('Tutor not found');
    
    const availableBalance = await this.calculateAvailableBalance(tutorId);
    const pendingBalance = await this.calculatePendingBalance(tutorId);
    
    const oldAvailable = tutor.tutorEarnings.availableBalance;
    const oldPending = tutor.tutorEarnings.pendingBalance;
    
    tutor.tutorEarnings.availableBalance = availableBalance;
    tutor.tutorEarnings.pendingBalance = pendingBalance;
    await tutor.save();
    
    console.log(`📊 Balance sync complete:`);
    console.log(`   Available: $${oldAvailable.toFixed(2)} → $${availableBalance.toFixed(2)}`);
    console.log(`   Pending: $${oldPending.toFixed(2)} → $${pendingBalance.toFixed(2)}`);
    
    return {
      availableBalance,
      pendingBalance,
      lifetimeEarnings: tutor.tutorEarnings.lifetimeEarnings,
      totalWithdrawn: tutor.tutorEarnings.totalWithdrawn
    };
  }
}

module.exports = new WithdrawalService();

