#!/usr/bin/env node

/**
 * DEV TOOL: Re-trigger analysis for a lesson
 * Usage: node dev-reanalyze-lesson.js <lessonId>
 */

require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const LessonAnalysis = require('./models/LessonAnalysis');
const LessonTranscript = require('./models/LessonTranscript');

const lessonId = process.argv[2];

if (!lessonId) {
  console.error('❌ Usage: node dev-reanalyze-lesson.js <lessonId>');
  process.exit(1);
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🔗 Connected to MongoDB');

    // Delete existing analysis
    const deleteResult = await LessonAnalysis.deleteMany({ lessonId });
    console.log(`✅ Deleted ${deleteResult.deletedCount} analysis record(s)`);

    // Find transcript
    const transcript = await LessonTranscript.findOne({ lessonId });
    if (!transcript) {
      console.error('❌ No transcript found for lesson:', lessonId);
      process.exit(1);
    }

    // Reset transcript status
    transcript.status = 'processing';
    await transcript.save();
    console.log('✅ Reset transcript status to processing');
    console.log('📋 Transcript ID:', transcript._id);

    // Trigger re-analysis
    console.log('\n🔥 Triggering analysis...');
    const http = require('http');
    
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: `/api/transcription/${transcript._id}/complete`,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer dev-token-phillip-dacosta@gmail.com',
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✅ Analysis triggered successfully!');
          console.log('Response:', data);
          console.log('\n📊 Wait 15-20 seconds, then check your app for the updated analysis.');
        } else {
          console.error('❌ Error triggering analysis:', res.statusCode, data);
        }
        mongoose.connection.close();
        process.exit(res.statusCode === 200 ? 0 : 1);
      });
    });

    req.on('error', (error) => {
      console.error('❌ Request error:', error.message);
      mongoose.connection.close();
      process.exit(1);
    });

    req.end();

  } catch (error) {
    console.error('❌ Error:', error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
})();



