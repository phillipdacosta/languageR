/**
 * Migration Script: Add nativeLanguage field to existing users
 * 
 * This script sets the nativeLanguage field for all users who don't have it yet.
 * Default is 'en' (English) for backward compatibility.
 * 
 * Usage: node scripts/migrate-add-native-language.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../config.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

async function migrateNativeLanguage() {
  try {
    console.log('🔄 Starting native language migration...');
    console.log('📊 Connecting to MongoDB...');
    
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('✅ Connected to MongoDB');
    
    // Find all users without nativeLanguage field
    const usersWithoutNativeLanguage = await User.find({
      $or: [
        { nativeLanguage: { $exists: false } },
        { nativeLanguage: null },
        { nativeLanguage: '' }
      ]
    });
    
    console.log(`📊 Found ${usersWithoutNativeLanguage.length} users without nativeLanguage field`);
    
    if (usersWithoutNativeLanguage.length === 0) {
      console.log('✅ All users already have nativeLanguage field set');
      process.exit(0);
    }
    
    // Set nativeLanguage to 'en' (English) as default
    const result = await User.updateMany(
      {
        $or: [
          { nativeLanguage: { $exists: false } },
          { nativeLanguage: null },
          { nativeLanguage: '' }
        ]
      },
      {
        $set: { nativeLanguage: 'en' }
      }
    );
    
    console.log('✅ Migration complete!');
    console.log(`📊 Updated ${result.modifiedCount} users`);
    console.log(`📊 Matched ${result.matchedCount} users`);
    
    // Verify migration
    const verification = await User.find({
      $or: [
        { nativeLanguage: { $exists: false } },
        { nativeLanguage: null },
        { nativeLanguage: '' }
      ]
    });
    
    if (verification.length === 0) {
      console.log('✅ Verification passed: All users now have nativeLanguage field');
    } else {
      console.warn(`⚠️  Warning: ${verification.length} users still don't have nativeLanguage field`);
    }
    
    // Show sample of updated users
    const sampleUsers = await User.find({ nativeLanguage: 'en' }).limit(5);
    console.log('\n📋 Sample of updated users:');
    sampleUsers.forEach(user => {
      console.log(`   - ${user.email}: nativeLanguage = '${user.nativeLanguage}'`);
    });
    
    console.log('\n🎉 Migration successful!');
    console.log('ℹ️  All existing users now have nativeLanguage = "en" (English)');
    console.log('ℹ️  New users will be prompted to select their native language during onboarding');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateNativeLanguage();




