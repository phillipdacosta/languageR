const mongoose = require('mongoose');
const Withdrawal = require('../models/Withdrawal');
const Payment = require('../models/Payment');
const User = require('../models/User');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
  async requestWithdrawal({ tutorId, amount, method }) {
    console.log(`\n💰 [WITHDRAWAL] Request initiated: tutorId=${tutorId}, amount=$${amount}, method=${method}`);
    
    // Get tutor
    const tutor = await User.findById(tutorId);
    if (!tutor || tutor.userType !== 'tutor') {
      throw new Error('Invalid tutor');
    }
    
    // Ensure withdrawalSettings exists with updated defaults
    // Also migrate existing users from $20 to $10 minimum
    if (!tutor.withdrawalSettings || !tutor.withdrawalSettings.minimumAmount) {
      tutor.withdrawalSettings = {
        minimumAmount: 10,
        autoWithdraw: false,
        autoWithdrawThreshold: 100
      };
      await tutor.save();
      console.log('✅ Updated withdrawal settings to new defaults');
    } else if (tutor.withdrawalSettings.minimumAmount === 20) {
      // Migrate existing users from $20 to $10
      tutor.withdrawalSettings.minimumAmount = 10;
      await tutor.save();
      console.log('✅ Migrated withdrawal minimum from $20 to $10');
    }
    
    // Validation checks
    if (amount < tutor.withdrawalSettings.minimumAmount) {
      throw new Error(`Minimum withdrawal is $${tutor.withdrawalSettings.minimumAmount}`);
    }
    
    if (amount > tutor.tutorEarnings.availableBalance) {
      throw new Error(`Insufficient balance. Available: $${tutor.tutorEarnings.availableBalance.toFixed(2)}`);
    }
    
    // Verify method is configured
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
    let remaining = amount;
    const paymentsToInclude = [];
    
    for (const payment of availablePayments) {
      if (remaining <= 0) break;
      paymentsToInclude.push(payment._id);
      remaining -= payment.tutorPayout;
    }
    
    if (paymentsToInclude.length === 0) {
      throw new Error('Unable to allocate payments for withdrawal');
    }
    
    // Calculate fees
    let platformFee = 0; // We don't charge additional withdrawal fee
    let paypalFee = 0;
    let stripeFee = 0;
    
    if (method === 'paypal') {
      // PayPal charges $0.25 or 2% (whichever is higher), max $20
      paypalFee = Math.max(0.25, amount * 0.02);
      paypalFee = Math.min(paypalFee, 20);
      paypalFee = Math.round(paypalFee * 100) / 100; // Round to 2 decimals
      console.log(`💸 PayPal fee calculated: $${paypalFee}`);
    }
    
    const netAmount = amount - platformFee - paypalFee - stripeFee;
    
    console.log(`📝 Withdrawal breakdown: Amount=$${amount}, Fees=$${platformFee + paypalFee + stripeFee}, Net=$${netAmount}`);
    
    // Create withdrawal request
    const withdrawal = new Withdrawal({
      tutorId,
      amount,
      method,
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
    
    // Update payment statuses (reserve them for this withdrawal)
    await Payment.updateMany(
      { _id: { $in: paymentsToInclude } },
      { 
        transferStatus: 'pending_withdrawal',
        withdrawalId: withdrawal._id
      }
    );
    console.log(`🔒 Reserved ${paymentsToInclude.length} payments for withdrawal`);
    
    // Reserve the balance (deduct from available)
    tutor.tutorEarnings.availableBalance -= amount;
    await tutor.save();
    console.log(`💼 Updated tutor balance: Available=$${tutor.tutorEarnings.availableBalance.toFixed(2)}`);
    
    console.log(`✅ [WITHDRAWAL] Request completed: ${withdrawal._id}\n`);
    
    return withdrawal;
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
      
      // Update tutor stats
      const tutor = await User.findById(withdrawal.tutorId);
      tutor.tutorEarnings.totalWithdrawn += withdrawal.amount;
      tutor.tutorEarnings.lastWithdrawal = new Date();
      await tutor.save();
      console.log(`💼 Updated tutor stats: totalWithdrawn=$${tutor.tutorEarnings.totalWithdrawn.toFixed(2)}`);
      
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
      
      // Return funds to available balance (rollback)
      const tutor = await User.findById(withdrawal.tutorId);
      tutor.tutorEarnings.availableBalance += withdrawal.amount;
      await tutor.save();
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
      await withdrawal.save();
      
      console.log(`✅ [STRIPE] Transfer created: ${transfer.id}`);
      console.log(`💸 Transfer amount: $${(transfer.amount / 100).toFixed(2)}`);
      
    } catch (error) {
      console.error(`❌ [STRIPE] Transfer failed:`, error.message);
      throw new Error(`Stripe transfer failed: ${error.message}`);
    }
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
      await withdrawal.save();
      
      console.log(`✅ [PAYPAL] Payout created: Batch=${result.batchId}`);
      console.log(`💸 Payout amount: $${withdrawal.netAmount.toFixed(2)} (after $${withdrawal.paypalFee.toFixed(2)} fee)`);
      
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

