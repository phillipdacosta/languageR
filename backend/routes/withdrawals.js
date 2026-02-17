const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const withdrawalService = require('../services/withdrawalService');
const User = require('../models/User');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');

/**
 * GET /api/withdrawals/balance
 * Get tutor's current earnings balance
 */
router.get('/balance', verifyToken, async (req, res) => {
  try {
    // Find user by auth0Id, fallback to email for dev tokens
    let user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user && req.user.email) {
      user = await User.findOne({ email: req.user.email });
      if (user) {
        console.log('🔍 [withdrawals/balance] Found user by email, updating auth0Id');
        user.auth0Id = req.user.sub;
        await user.save();
      }
    }
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    if (user.userType !== 'tutor') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only tutors can access earnings balance' 
      });
    }
    
    // Ensure tutorEarnings exists (migration support)
    if (!user.tutorEarnings) {
      user.tutorEarnings = {
        availableBalance: 0,
        pendingBalance: 0,
        lifetimeEarnings: 0,
        lastWithdrawal: null,
        totalWithdrawn: 0
      };
      await user.save();
    }
    
    // Migrate existing users from $20 to $10 minimum withdrawal
    let needsSave = false;
    if (!user.withdrawalSettings) {
      user.withdrawalSettings = {
        minimumAmount: 10,
        autoWithdraw: false,
        autoWithdrawThreshold: 100
      };
      needsSave = true;
    } else if (user.withdrawalSettings.minimumAmount === 20) {
      user.withdrawalSettings.minimumAmount = 10;
      needsSave = true;
      console.log(`✅ Migrated tutor ${user._id} withdrawal minimum from $20 to $10`);
    } else if (!user.withdrawalSettings.minimumAmount) {
      user.withdrawalSettings.minimumAmount = 10;
      needsSave = true;
    }
    
    if (needsSave) {
      await user.save();
    }
    
    // ── Balance Reconciliation ─────────────────────────────────────────
    // Recalculate balances from actual payment records (source of truth)
    // to detect and fix any drift caused by bugs, race conditions, or 
    // the lifetimeEarnings tracking change (was release-time, now earn-time).
    try {
      const mongoose = require('mongoose');
      const tutorObjectId = new mongoose.Types.ObjectId(user._id);

      // Aggregate earned payments by transferStatus
      const aggregation = await Payment.aggregate([
        { 
          $match: { 
            tutorId: tutorObjectId,
            status: { $in: ['succeeded'] },
            revenueRecognized: true
          } 
        },
        { 
          $group: { 
            _id: '$transferStatus', 
            total: { $sum: '$tutorPayout' } 
          } 
        }
      ]);

      // Also include tip payments (they may have revenueRecognized: true already)
      const tipAgg = await Payment.aggregate([
        {
          $match: {
            tutorId: tutorObjectId,
            paymentType: 'tip',
            status: 'succeeded'
          }
        },
        {
          $group: {
            _id: '$transferStatus',
            total: { $sum: '$tutorPayout' }
          }
        }
      ]);

      // Build status-to-total map (merge regular + tip, avoiding double counting)
      const statusTotals = {};
      // Regular payments (non-tip)
      for (const row of aggregation) {
        statusTotals[row._id || 'null'] = (statusTotals[row._id || 'null'] || 0) + row.total;
      }
      // Tip payments that might not be in the regular aggregation
      // (tips have paymentType='tip' and may already be in the aggregation if revenueRecognized)
      // To avoid double counting, only add tip totals for statuses not already counted
      const tipPaymentIds = await Payment.find({
        tutorId: user._id,
        paymentType: 'tip',
        status: 'succeeded'
      }).select('_id');
      
      const regularPaymentIds = await Payment.find({
        tutorId: user._id,
        status: 'succeeded',
        revenueRecognized: true,
        paymentType: { $ne: 'tip' }
      }).select('_id');

      // Just re-aggregate ALL earned payments (tips + regular) in one query
      const fullAgg = await Payment.aggregate([
        {
          $match: {
            tutorId: tutorObjectId,
            status: 'succeeded',
            $or: [
              { revenueRecognized: true },
              { paymentType: 'tip' }
            ]
          }
        },
        {
          $group: {
            _id: '$transferStatus',
            total: { $sum: '$tutorPayout' }
          }
        }
      ]);

      const totals = {};
      for (const row of fullAgg) {
        totals[row._id || 'null'] = row.total;
      }

      const calcPending = Math.round((totals['on_hold'] || 0) * 100) / 100;
      const calcAvailable = Math.round((totals['available'] || 0) * 100) / 100;
      const calcPendingWithdrawal = Math.round((totals['pending_withdrawal'] || 0) * 100) / 100;
      const calcWithdrawn = Math.round((totals['withdrawn'] || 0) * 100) / 100;
      const calcSucceeded = Math.round((totals['succeeded'] || 0) * 100) / 100; // legacy
      const calcLifetime = Math.round((calcPending + calcAvailable + calcPendingWithdrawal + calcWithdrawn + calcSucceeded) * 100) / 100;

      const currentPending = Math.round((user.tutorEarnings.pendingBalance || 0) * 100) / 100;
      const currentAvailable = Math.round((user.tutorEarnings.availableBalance || 0) * 100) / 100;
      const currentLifetime = Math.round((user.tutorEarnings.lifetimeEarnings || 0) * 100) / 100;

      let needsReconciliation = false;

      if (Math.abs(currentPending - calcPending) > 0.01) {
        console.warn(`⚠️ [RECONCILE] pendingBalance drift: DB=$${currentPending} vs Calculated=$${calcPending}`);
        needsReconciliation = true;
      }
      if (Math.abs(currentLifetime - calcLifetime) > 0.01) {
        console.warn(`⚠️ [RECONCILE] lifetimeEarnings drift: DB=$${currentLifetime} vs Calculated=$${calcLifetime}`);
        needsReconciliation = true;
      }
      // For available balance, account for pending_withdrawal deductions
      // available in DB should equal calcAvailable (payments marked 'available')
      // but pending_withdrawal amounts have already been deducted from availableBalance
      const effectiveAvailable = Math.round((calcAvailable) * 100) / 100;
      if (Math.abs(currentAvailable - effectiveAvailable) > 0.01) {
        console.warn(`⚠️ [RECONCILE] availableBalance drift: DB=$${currentAvailable} vs Calculated=$${effectiveAvailable}`);
        needsReconciliation = true;
      }

      if (needsReconciliation) {
        console.log(`🔧 [RECONCILE] Fixing balances for tutor ${user._id}...`);
        user.tutorEarnings.pendingBalance = calcPending;
        user.tutorEarnings.availableBalance = effectiveAvailable;
        user.tutorEarnings.lifetimeEarnings = calcLifetime;
        await user.save();
        console.log(`✅ [RECONCILE] Fixed: Pending=$${calcPending}, Available=$${effectiveAvailable}, Lifetime=$${calcLifetime}`);
      }
    } catch (reconcileError) {
      console.error('⚠️ [RECONCILE] Reconciliation failed (non-critical):', reconcileError.message);
      // Don't fail the balance request — just log the error
    }
    // ────────────────────────────────────────────────────────────────────

    // Use reconciled values from the user model
    const availableBalance = user.tutorEarnings.availableBalance || 0;
    const pendingBalance = user.tutorEarnings.pendingBalance || 0;
    
    console.log(`💰 Balance for tutor ${user._id}: Available=$${availableBalance.toFixed(2)}, Pending=$${pendingBalance.toFixed(2)}, Lifetime=$${(user.tutorEarnings.lifetimeEarnings || 0).toFixed(2)}`);
    
    res.json({
      success: true,
      balance: {
        available: availableBalance,
        pending: pendingBalance,
        lifetime: user.tutorEarnings.lifetimeEarnings,
        withdrawn: user.tutorEarnings.totalWithdrawn,
        lastWithdrawal: user.tutorEarnings.lastWithdrawal
      },
      settings: user.withdrawalSettings || {
        minimumAmount: 10,
        autoWithdraw: false,
        autoWithdrawThreshold: 100
      },
      payoutMethods: {
        stripeConnect: {
          configured: user.stripeConnectOnboarded && user.stripePayoutsEnabled,
          accountId: user.stripeConnectAccountId || null
        },
        paypal: {
          configured: !!user.payoutDetails?.paypalEmail,
          email: user.payoutDetails?.paypalEmail || null
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting balance:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve balance',
      error: error.message 
    });
  }
});

/**
 * POST /api/withdrawals/request
 * Request a withdrawal
 */
router.post('/request', verifyToken, async (req, res) => {
  try {
    const { amount, method } = req.body;
    
    // Validation
    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid amount' 
      });
    }
    
    if (!method || !['stripe_connect', 'paypal'].includes(method)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid withdrawal method. Must be "stripe_connect" or "paypal"' 
      });
    }
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    if (user.userType !== 'tutor') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only tutors can request withdrawals' 
      });
    }
    
    // Request withdrawal through service
    const withdrawal = await withdrawalService.requestWithdrawal({
      tutorId: user._id,
      amount,
      method
    });
    
    console.log(`✅ Withdrawal request created: ${withdrawal._id}`);

    // Create notification for the tutor
    const payoutMethodLabel = method === 'stripe_connect' ? 'bank account' : 'PayPal';
    const withdrawalNotification = new Notification({
      userId: user._id,
      type: 'withdrawal_initiated',
      title: '💸 Withdrawal initiated',
      message: `You withdrew $${amount.toFixed(2)} to your ${payoutMethodLabel}.`,
      data: {
        withdrawalId: withdrawal._id,
        amount: amount,
        method: method
      },
      read: false
    });
    await withdrawalNotification.save();

    // Send real-time notification via WebSocket
    if (req.io && req.connectedUsers) {
      const socketId = req.connectedUsers.get(user.auth0Id);
      if (socketId) {
        req.io.to(socketId).emit('new_notification', {
          notification: withdrawalNotification,
          message: withdrawalNotification.message
        });
      }
    }
    
    // Process immediately in background (don't block response)
    console.log(`🚀 Processing withdrawal ${withdrawal._id} immediately...`);
    withdrawalService.processWithdrawal(withdrawal._id)
      .then(() => {
        console.log(`✅ Withdrawal ${withdrawal._id} processed successfully`);
      })
      .catch(error => {
        console.error(`❌ Withdrawal ${withdrawal._id} processing failed:`, error.message);
        // Cron job will retry failed withdrawals
      });
    
    res.json({
      success: true,
      withdrawal: {
        id: withdrawal._id,
        amount: withdrawal.amount,
        netAmount: withdrawal.netAmount,
        method: withdrawal.method,
        status: 'processing', // User sees "processing" immediately
        fees: {
          platform: withdrawal.platformFee,
          stripe: withdrawal.stripeFee,
          paypal: withdrawal.paypalFee,
          total: withdrawal.platformFee + withdrawal.stripeFee + withdrawal.paypalFee
        },
        requestedAt: withdrawal.requestedAt,
        estimatedCompletion: method === 'paypal' ? 'Within 30 seconds' : '2-7 business days'
      },
      message: `Withdrawal of $${amount.toFixed(2)} is being processed.`
    });
    
  } catch (error) {
    console.error('❌ Error requesting withdrawal:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
});

/**
 * GET /api/withdrawals/history
 * Get tutor's withdrawal history
 */
router.get('/history', verifyToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
    // Find user by auth0Id, fallback to email for dev tokens
    let user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user && req.user.email) {
      user = await User.findOne({ email: req.user.email });
      if (user) {
        console.log('🔍 [withdrawals/history] Found user by email, updating auth0Id');
        user.auth0Id = req.user.sub;
        await user.save();
      }
    }
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    if (user.userType !== 'tutor') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only tutors can access withdrawal history' 
      });
    }
    
    const history = await withdrawalService.getWithdrawalHistory(user._id, limit);
    
    res.json({ 
      success: true, 
      withdrawals: history,
      count: history.length
    });
    
  } catch (error) {
    console.error('❌ Error getting withdrawal history:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve withdrawal history',
      error: error.message 
    });
  }
});

/**
 * GET /api/withdrawals/:id
 * Get details of a specific withdrawal
 */
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    const Withdrawal = require('../models/Withdrawal');
    const withdrawal = await Withdrawal.findById(id)
      .populate('paymentIds', 'lessonId tutorPayout createdAt');
    
    if (!withdrawal) {
      return res.status(404).json({ 
        success: false, 
        message: 'Withdrawal not found' 
      });
    }
    
    // Verify ownership
    if (withdrawal.tutorId.toString() !== user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }
    
    res.json({ 
      success: true, 
      withdrawal 
    });
    
  } catch (error) {
    console.error('❌ Error getting withdrawal details:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve withdrawal details',
      error: error.message 
    });
  }
});

/**
 * POST /api/withdrawals/:id/cancel
 * Cancel a pending withdrawal (admin or owner only)
 */
router.post('/:id/cancel', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    const Withdrawal = require('../models/Withdrawal');
    const withdrawal = await Withdrawal.findById(id);
    
    if (!withdrawal) {
      return res.status(404).json({ 
        success: false, 
        message: 'Withdrawal not found' 
      });
    }
    
    // Verify ownership (or admin)
    if (withdrawal.tutorId.toString() !== user._id.toString() && !user.isAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }
    
    // Can only cancel pending withdrawals
    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot cancel withdrawal in status: ${withdrawal.status}` 
      });
    }
    
    // Cancel withdrawal
    withdrawal.status = 'cancelled';
    await withdrawal.save();
    
    // Return funds to available balance
    const tutor = await User.findById(withdrawal.tutorId);
    tutor.tutorEarnings.availableBalance += withdrawal.amount;
    await tutor.save();
    
    // Reset payment statuses
    await Payment.updateMany(
      { _id: { $in: withdrawal.paymentIds } },
      { 
        transferStatus: 'available',
        withdrawalId: null
      }
    );
    
    console.log(`✅ Withdrawal ${id} cancelled successfully`);
    
    res.json({ 
      success: true, 
      message: 'Withdrawal cancelled successfully',
      withdrawal
    });
    
  } catch (error) {
    console.error('❌ Error cancelling withdrawal:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to cancel withdrawal',
      error: error.message 
    });
  }
});

/**
 * POST /api/withdrawals/sync-balance
 * Sync tutor's balance with actual payment records (admin or self)
 */
router.post('/sync-balance', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }
    
    if (user.userType !== 'tutor') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only tutors can sync balance' 
      });
    }
    
    const balances = await withdrawalService.syncTutorBalance(user._id);
    
    res.json({ 
      success: true, 
      message: 'Balance synced successfully',
      balances
    });
    
  } catch (error) {
    console.error('❌ Error syncing balance:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to sync balance',
      error: error.message 
    });
  }
});

module.exports = router;

