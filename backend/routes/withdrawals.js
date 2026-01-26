const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const withdrawalService = require('../services/withdrawalService');
const User = require('../models/User');
const Payment = require('../models/Payment');

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
    
    // Use database values (authoritative source)
    // Note: calculated values don't work correctly with partial withdrawals
    // because payments get marked as 'withdrawn' even when partial amount remains
    const availableBalance = user.tutorEarnings.availableBalance || 0;
    const pendingBalance = user.tutorEarnings.pendingBalance || 0;
    
    console.log(`💰 Balance for tutor ${user._id}: Available=$${availableBalance.toFixed(2)}, Pending=$${pendingBalance.toFixed(2)}`);
    
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

