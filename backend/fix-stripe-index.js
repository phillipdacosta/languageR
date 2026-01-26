/**
 * Fix MongoDB unique index on stripeConnectAccountId
 * Drop the old non-sparse index and let Mongoose recreate it as sparse
 */

require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');

async function fixStripeIndex() {
  try {
    console.log('🔧 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    
    // List current indexes
    console.log('\n📋 Current indexes:');
    const indexes = await usersCollection.indexes();
    indexes.forEach(index => {
      console.log(`  - ${index.name}:`, JSON.stringify(index.key), index.unique ? '(unique)' : '');
    });
    
    // Drop the problematic index
    console.log('\n🗑️  Dropping stripeConnectAccountId_1 index...');
    try {
      await usersCollection.dropIndex('stripeConnectAccountId_1');
      console.log('✅ Index dropped successfully');
    } catch (error) {
      if (error.code === 27 || error.message.includes('index not found')) {
        console.log('ℹ️  Index does not exist (already dropped)');
      } else {
        throw error;
      }
    }
    
    // Create new sparse unique index
    console.log('\n🔨 Creating new sparse unique index...');
    await usersCollection.createIndex(
      { stripeConnectAccountId: 1 },
      { unique: true, sparse: true }
    );
    console.log('✅ New sparse index created');
    
    // Verify new indexes
    console.log('\n📋 Updated indexes:');
    const newIndexes = await usersCollection.indexes();
    newIndexes.forEach(index => {
      console.log(`  - ${index.name}:`, JSON.stringify(index.key), 
        index.unique ? '(unique)' : '', 
        index.sparse ? '(sparse)' : '');
    });
    
    console.log('\n✅ Index fix complete!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error fixing index:', error);
    process.exit(1);
  }
}

fixStripeIndex();


