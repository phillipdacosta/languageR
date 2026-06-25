/**
 * Re-transcribe the most recent uploaded audio chunk for a lesson with RAW Whisper
 * output so we can see EXACTLY what Whisper returned and what the no_speech_prob
 * filter (threshold 0.6, >70% kill switch) would do to it.
 *
 * Read-only: downloads from GCS + calls Whisper. Writes nothing to the DB.
 *
 * Usage: node diagnose-whisper-chunk.js <lessonId> [student|tutor]
 */
const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });
const OpenAI = require('openai');

const LessonTranscript = require('./models/LessonTranscript');
const { downloadAudio } = require('./services/cloudStorageService');

const NO_SPEECH_THRESHOLD = 0.6;

(async () => {
  const lessonId = process.argv[2];
  const wantSpeaker = process.argv[3] || 'student';
  if (!lessonId) {
    console.error('Usage: node diagnose-whisper-chunk.js <lessonId> [student|tutor]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB connected\n');

  const transcript = await LessonTranscript.findOne({ lessonId }).lean();
  if (!transcript) { console.error('❌ No transcript'); process.exit(0); }

  const chunks = (transcript.audioChunks || []).filter(c => (c.speaker || 'student') === wantSpeaker);
  if (chunks.length === 0) { console.error(`❌ No ${wantSpeaker} audio chunks`); process.exit(0); }

  // Newest chunk by uploadedAt
  chunks.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const chunk = chunks[0];
  console.log(`🎯 Lesson transcript.language: ${transcript.language}`);
  console.log(`🎯 Using ${wantSpeaker} chunk #${chunk.chunkIndex} ` +
    `(${chunk.sizeBytes} bytes, uploaded ${new Date(chunk.uploadedAt).toISOString()})`);
  console.log(`   gcsPath: ${chunk.gcsPath}\n`);

  console.log('⬇️  Downloading from GCS...');
  const buffer = await downloadAudio(chunk.gcsPath);
  console.log(`   ${buffer.length} bytes downloaded\n`);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const isWebM = buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3;
  const fileName = isWebM ? 'audio.webm' : 'audio.mp3';
  const fileType = isWebM ? 'audio/webm' : 'audio/mpeg';
  console.log(`📝 Detected container: ${fileType}\n`);

  const file = await OpenAI.toFile(buffer, fileName, { type: fileType });
  console.log('🎙️ Calling Whisper (verbose_json, no language hint)...\n');
  const t = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment']
  });

  const segs = t.segments || [];
  console.log('═'.repeat(64));
  console.log(`🌍 Detected language: ${t.language}`);
  console.log(`⏱️  Duration: ${t.duration}s`);
  console.log(`📝 RAW TEXT: "${t.text || '(empty)'}"`);
  console.log(`🔢 Raw segment count: ${segs.length}`);
  console.log('═'.repeat(64));

  if (segs.length === 0) {
    console.log('\n⚠️ Whisper returned ZERO segments. The audio decoded but Whisper');
    console.log('   heard no transcribable speech (too quiet / wrong track / silence).');
  } else {
    let high = 0;
    segs.forEach(s => {
      const nsp = s.no_speech_prob != null ? s.no_speech_prob : 0;
      const flagged = nsp > NO_SPEECH_THRESHOLD;
      if (flagged) high++;
      console.log(`  [${s.start?.toFixed(1)}-${s.end?.toFixed(1)}s] ` +
        `no_speech=${nsp.toFixed(3)}${flagged ? ' ❌DROP' : ' ✅keep'} ` +
        `avg_logprob=${s.avg_logprob?.toFixed(2)} "${(s.text || '').trim()}"`);
    });
    const ratio = high / segs.length;
    console.log('\n' + '─'.repeat(64));
    console.log(`🔇 no_speech>0.6: ${high}/${segs.length} (${(ratio * 100).toFixed(0)}%)`);
    if (ratio > 0.7) {
      console.log('   ⚠️ >70% flagged → filter ZEROES the whole chunk → 0 segments saved.');
    } else {
      console.log(`   → filter keeps ${segs.length - high} segment(s).`);
    }
  }

  await mongoose.connection.close();
  process.exit(0);
})().catch(err => { console.error('❌', err); process.exit(1); });
