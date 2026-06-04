/**
 * Migration Script: Add Tutor Earnings Tracking
 * 
 * This script migrates existing data to the new withdrawal system:
 * 1. Adds tutorEarnings fields to all tutors
 * 2. Updates existing payment statuses
 * 3. Marks past transfers as 'withdrawn' (grandfathered)
 * 
 * RUN THIS ONCE before deploying the new withdrawal system
 * 
 * Usage: node migrations/add-tutor-earnings.js
 */

require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const User = require('../models/User');
const Payment = require('../models/Payment');
const Lesson = require('../models/Lesson');

async function migrate() {
  console.log('\n========================================');
  console.log('🔄 MIGRATION: Add Tutor Earnings Tracking');
  console.log('========================================\n');
  
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/language-learning-app');
    console.log('✅ Connected to MongoDB\n');
    
    // ===================================================================
    // STEP 1: Initialize tutorEarnings for all tutors
    // ===================================================================
    console.log('STEP 1: Initializing tutorEarnings for all tutors...\n');
    
    const tutors = await User.find({ userType: 'tutor' });
    console.log(`Found ${tutors.length} tutors`);
    
    let tutorsUpdated = 0;
    for (const tutor of tutors) {
      if (!tutor.tutorEarnings) {
        tutor.tutorEarnings = {
          availableBalance: 0,
          pendingBalance: 0,
          lifetimeEarnings: 0,
          lastWithdrawal: null,
          totalWithdrawn: 0
        };
        tutorsUpdated++;
      }
      
      if (!tutor.withdrawalSettings) {
        tutor.withdrawalSettings = {
          minimumAmount: 20,
          autoWithdraw: false,
          autoWithdrawThreshold: 100
        };
      }
      
      await tutor.save();
    }
    
    console.log(`✅ Initialized tutorEarnings for ${tutorsUpdated} tutors\n`);
    
    // ===================================================================
    // STEP 2: Update existing payment statuses
    // ===================================================================
    console.log('STEP 2: Updating existing payment statuses...\n');
    
    // Legacy statuses that mean "already transferred"
    const legacyTransferredStatuses = ['succeeded', 'acknowledged'];
    
    // Mark all past completed transfers as 'withdrawn' (grandfathered)
    const result1 = await Payment.updateMany(
      { 
        transferStatus: { $in: legacyTransferredStatuses },
        tutorPayout: { $gt: 0 }
      },
      { 
        transferStatus: 'withdrawn',
        withdrawalId: null  // No withdrawal record for legacy transfers
      }
    );
    
    console.log(`✅ Marked ${result1.modifiedCount} past transfers as 'withdrawn'`);
    
    // Payments that are currently 'pending' or 'awaiting_funds' -> 'on_hold'
    // They'll be released after 1 hour from lesson end
    const pendingPayments = await Payment.find({ 
      transferStatus: { $in: ['pending', 'awaiting_funds', null] },
      status: 'succeeded',
      tutorPayout: { $gt: 0 }
    }).populate('lessonId');
    
    console.log(`Found ${pendingPayments.length} pending payments to migrate`);
    
    let pendingUpdated = 0;
    for (const payment of pendingPayments) {
      if (!payment.lessonId) {
        console.warn(`⚠️  Payment ${payment._id} has no associated lesson - skipping`);
        continue;
      }
      
      // Set release date to 1 hour after lesson end
      const releaseDate = new Date(payment.lessonId.endTime);
      releaseDate.setHours(releaseDate.getHours() + 1);
      
      // If release date is in the past, set it to now (will be released immediately by cron)
      if (releaseDate < new Date()) {
        releaseDate.setTime(new Date().getTime() + (5 * 60 * 1000)); // 5 minutes from now
      }
      
      payment.earningsReleaseDate = releaseDate;
      payment.transferStatus = 'on_hold';
      await payment.save();
      
      // Add to tutor's pending balance
      const tutor = await User.findById(payment.tutorId);
      if (tutor && tutor.tutorEarnings) {
        tutor.tutorEarnings.pendingBalance += payment.tutorPayout;
        await tutor.save();
      }
      
      pendingUpdated++;
    }
    
    console.log(`✅ Updated ${pendingUpdated} pending payments to 'on_hold'\n`);
    
    // ===================================================================
    // STEP 3: Handle failed transfers
    // ===================================================================
    console.log('STEP 3: Handling failed transfers...\n');
    
    const failedPayments = await Payment.find({ 
      transferStatus: 'failed',
      tutorPayout: { $gt: 0 }
    }).populate('lessonId');
    
    console.log(`Found ${failedPayments.length} failed transfers`);
    
    for (const payment of failedPayments) {
      // Set to on_hold with immediate release (will be picked up by next cron)
      const releaseDate = new Date();
      releaseDate.setMinutes(releaseDate.getMinutes() + 5); // 5 minutes from now
      
      payment.earningsReleaseDate = releaseDate;
      payment.transferStatus = 'on_hold';
      payment.errorMessage = null; // Clear error
      await payment.save();
      
      // Add to tutor's pending balance
      const tutor = await User.findById(payment.tutorId);
      if (tutor && tutor.tutorEarnings) {
        tutor.tutorEarnings.pendingBalance += payment.tutorPayout;
        await tutor.save();
      }
    }
    
    console.log(`✅ Migrated ${failedPayments.length} failed transfers to 'on_hold'\n`);
    
    // ===================================================================
    // STEP 4: Verify and report
    // ===================================================================
    console.log('STEP 4: Verification and summary...\n');
    
    const summary = await Payment.aggregate([
      { $match: { tutorPayout: { $gt: 0 } } },
      {
        $group: {
          _id: '$transferStatus',
          count: { $sum: 1 },
          totalAmount: { $sum: '$tutorPayout' }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    console.log('Payment Status Summary:');
    console.log('========================');
    for (const stat of summary) {
      console.log(`${stat._id}: ${stat.count} payments, $${stat.totalAmount.toFixed(2)}`);
    }
    
    // Tutor balance summary
    const tutorBalances = await User.aggregate([
      { $match: { userType: 'tutor' } },
      {
        $group: {
          _id: null,
          totalAvailable: { $sum: '$tutorEarnings.availableBalance' },
          totalPending: { $sum: '$tutorEarnings.pendingBalance' },
          totalLifetime: { $sum: '$tutorEarnings.lifetimeEarnings' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    if (tutorBalances.length > 0) {
      const balances = tutorBalances[0];
      console.log('\nTutor Balance Summary:');
      console.log('======================');
      console.log(`Total tutors: ${balances.count}`);
      console.log(`Available: $${balances.totalAvailable.toFixed(2)}`);
      console.log(`Pending: $${balances.totalPending.toFixed(2)}`);
      console.log(`Lifetime: $${balances.totalLifetime.toFixed(2)}`);
    }
    
    console.log('\n========================================');
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY');
    console.log('========================================\n');
    
    console.log('Next steps:');
    console.log('1. Deploy the updated backend code');
    console.log('2. The releaseEarnings cron job will automatically release pending earnings');
    console.log('3. Tutors can now request withdrawals via the API or frontend');
    console.log('4. Monitor logs for the first few days to ensure smooth operation\n');
    
  } catch (error) {
    console.error('\n❌ MIGRATION FAILED:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run migration
if (require.main === module) {
  migrate();
}

module.exports = { migrate };

