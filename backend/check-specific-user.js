const mongoose = require('mongoose');
const User = require('./models/User');

async function checkUser() {
  try {
    await mongoose.connect('mongodb://localhost:27017/language-learning-app');
    console.log('✅ Connected to MongoDB');

    // Find by exact email
    const user = await User.findOne({ email: 'travelbuggler@gmail.com' });
    
    if (!user) {
      console.log('❌ User not found with email: travelbuggler@gmail.com');
      
      // Try finding similar emails
      const users = await User.find({ email: /travelbuggler/i }).select('email name userType');
      console.log('Found similar users:', users);
      process.exit(1);
    }

    console.log('\n👤 User:', user.email, '(', user.name, ')');
    console.log('📅 Total availability blocks:', user.availability.length);
    
    if (user.availability.length === 0) {
      console.log('⚠️ No availability blocks found!');
      process.exit(0);
    }

    // Day names (0=Sunday, 1=Monday, etc.)
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Group by day
    const byDay = {};
    user.availability.forEach(block => {
      if (!byDay[block.day]) {
        byDay[block.day] = [];
      }
      byDay[block.day].push(block);
    });

    console.log('\n📊 Availability by day of week:\n');
    Object.keys(byDay).sort((a, b) => Number(a) - Number(b)).forEach(day => {
      console.log(`${dayNames[day]} (day=${day}):`);
      byDay[day].forEach(block => {
        const info = [
          `  ${block.startTime} - ${block.endTime}`,
          `(${block.type})`
        ];
        
        if (block.absoluteStart) {
          const date = new Date(block.absoluteStart);
          info.push(`[${date.toLocaleDateString()}]`);
        }
        
        console.log(info.join(' '));
      });
      console.log('');
    });

    // Now check what Nov 24, 2025 (Monday) should show
    const nov24 = new Date('2025-11-24');
    const nov24DayOfWeek = nov24.getDay(); // Should be 1 (Monday)
    
    console.log(`\n🔍 Nov 24, 2025 analysis:`);
    console.log(`  Date.getDay() = ${nov24DayOfWeek} (${dayNames[nov24DayOfWeek]})`);
    
    const nov24Blocks = user.availability.filter(b => {
      // Match by day of week OR absolute date
      if (b.absoluteStart) {
        const blockDate = new Date(b.absoluteStart);
        return blockDate.toDateString() === nov24.toDateString();
      }
      return b.day === nov24DayOfWeek;
    });
    
    console.log(`  Matching blocks: ${nov24Blocks.length}`);
    nov24Blocks.forEach(b => {
      console.log(`    ${b.startTime} - ${b.endTime} (day=${b.day}, type=${b.type})`);
    });

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkUser();

