const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });
const LessonTranscript = require('./models/LessonTranscript');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const transcript = await LessonTranscript.findOne({ 
    lessonId: new mongoose.Types.ObjectId('693af1457bdc33b8eba10a0c') 
  });
  
  if (!transcript) {
    console.log('❌ No transcript found');
    process.exit(1);
  }
  
  console.log('✅ Transcript found');
  console.log('Segments:', transcript.segments.length);
  
  const withAudio = transcript.segments.filter(s => s.audioGcsPath || s.audioBase64);
  console.log('Segments with audio:', withAudio.length);
  
  if (withAudio.length > 0) {
    console.log('\nFirst segment with audio:');
    console.log('- Text:', withAudio[0].text);
    console.log('- Has GCS path:', !!withAudio[0].audioGcsPath);
    console.log('- GCS path:', withAudio[0].audioGcsPath);
    console.log('- Has base64:', !!withAudio[0].audioBase64);
  }
  
  process.exit(0);
}
check();
