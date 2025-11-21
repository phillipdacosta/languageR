const mongoose = require('mongoose');
const User = require('./models/User');

async function dumpAvailability() {
  try {
    await mongoose.connect('mongodb://localhost:27017/language-learning-app');
    console.log('✅ Connected to MongoDB');

    // Find user with availability
    const user = await User.findOne({ 
      email: 'travelbuggler@gmail.com' 
    });
    
    if (!user) {
      console.log('❌ User not found');
      process.exit(1);
    }

    console.log(`\n👤 User: ${user.email}`);
    console.log(`📅 Availability blocks: ${user.availability.length}\n`);

    // Day names for reference
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Find blocks for Nov 24, 2025 (Monday, day=1)
    const nov24 = new Date('2025-11-24T00:00:00');
    const nov24DayOfWeek = nov24.getDay(); // Should be 1 (Monday)
    
    console.log(`🔍 Searching for Monday, Nov 24, 2025:`);
    console.log(`   JavaScript getDay() = ${nov24DayOfWeek} (${dayNames[nov24DayOfWeek]})\n`);
    
    // Find blocks with day=1 (should be Monday)
    const day1Blocks = user.availability.filter(b => b.day === 1);
    console.log(`📊 Blocks with day=1: ${day1Blocks.length}`);
    if (day1Blocks.length > 0) {
      console.log('   First 5 blocks:');
      day1Blocks.slice(0, 5).forEach(b => {
        console.log(`   - ${b.startTime} to ${b.endTime} (type: ${b.type})`);
        if (b.absoluteStart) {
          const date = new Date(b.absoluteStart);
          console.log(`     Absolute date: ${date.toLocaleDateString()} ${date.toLocaleDateString('en-US', { weekday: 'long' })}`);
        }
      });
    }
    
    // Find blocks with absoluteStart = Nov 24
    console.log('\n📊 Blocks with absoluteStart = Nov 24, 2025:');
    const nov24Blocks = user.availability.filter(b => {
      if (!b.absoluteStart) return false;
      const blockDate = new Date(b.absoluteStart);
      return blockDate.toDateString() === nov24.toDateString();
    });
    
    console.log(`   Found ${nov24Blocks.length} blocks`);
    nov24Blocks.forEach(b => {
      console.log(`   - day=${b.day}, ${b.startTime} to ${b.endTime} (type: ${b.type})`);
    });
    
    // Show distribution by day
    console.log('\n📊 Distribution by day field:');
    const byDay = {};
    user.availability.forEach(b => {
      byDay[b.day] = (byDay[b.day] || 0) + 1;
    });
    Object.keys(byDay).sort((a, b) => Number(a) - Number(b)).forEach(day => {
      console.log(`   day=${day} (${dayNames[day]}): ${byDay[day]} blocks`);
    });

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

dumpAvailability();

