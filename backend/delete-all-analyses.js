require('dotenv').config({path: './config.env'});
const mongoose = require('mongoose');
const LessonAnalysis = require('./models/LessonAnalysis');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log('✅ Connected');
  const result = await LessonAnalysis.deleteMany({
    lessonId: { $in: ['692db4829a115761e478bce4', '692dac407394efaa631222ed'] }
  });
  console.log('🗑️  Deleted', result.deletedCount, 'analyses');
  await mongoose.connection.close();
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});



