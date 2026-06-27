/**
 * Preserve a lesson's audio so it survives the 48h cleanup cron and can be used
 * as a permanent offline test fixture for the bleed-filter / voiceprint work.
 *
 * The cleanup cron (audioBackupService.cleanupExpiredAudio) deletes GCS objects
 * whose *object metadata* `deleteAt` is in the past — it does NOT read the DB.
 * So we push `deleteAt` far into the future on each audio object (student
 * chunks + the tutor reference track), and also bump the DB copies for
 * consistency.
 *
 * Usage:  node scripts/preserveLessonAudio.js <lessonId>
 * Read/write: updates GCS object metadata + the transcript's audioChunks.deleteAt.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config.env') });

const mongoose = require('mongoose');
const { Storage } = require('@google-cloud/storage');
const LessonTranscript = require('../models/LessonTranscript');

const FAR_FUTURE = new Date('2099-01-01T00:00:00Z');

// Mirror audioBackupService storage config so paths/creds resolve identically.
let _storage;
function getStorage() {
  if (_storage) return _storage;
  const cfg = { projectId: process.env.GOOGLE_CLOUD_PROJECT_ID };
  if (process.env.GOOGLE_CLOUD_KEY_FILE) cfg.keyFilename = process.env.GOOGLE_CLOUD_KEY_FILE;
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) cfg.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) cfg.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  else cfg.keyFilename = path.join(__dirname, '../config/gcs-key.json');
  _storage = new Storage(cfg);
  return _storage;
}

function parseGcs(gcsPath) {
  const m = (gcsPath || '').match(/^gs:\/\/([^/]+)\/(.+)$/);
  return m ? { bucketName: m[1], filePath: m[2] } : null;
}

async function preserveObject(gcsPath) {
  const parsed = parseGcs(gcsPath);
  if (!parsed) {
    console.log(`   ⚠️  unparseable path: ${gcsPath}`);
    return false;
  }
  const file = getStorage().bucket(parsed.bucketName).file(parsed.filePath);
  const [exists] = await file.exists();
  if (!exists) {
    console.log(`   ⚠️  already gone from GCS: ${gcsPath}`);
    return false;
  }
  const [md] = await file.getMetadata();
  const meta = { ...(md.metadata || {}) };
  const prev = meta.deleteAt || '(none)';
  meta.deleteAt = FAR_FUTURE.toISOString();
  meta.preservedFixture = 'true';
  await file.setMetadata({ metadata: meta });
  console.log(`   🔒 preserved: ${gcsPath}  (was deleteAt=${prev})`);
  return true;
}

(async () => {
  const lessonId = process.argv[2];
  if (!lessonId) {
    console.error('Usage: node scripts/preserveLessonAudio.js <lessonId>');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB Connected\n');

  const transcript = await LessonTranscript.findOne({ lessonId });
  if (!transcript) {
    console.log('❌ No transcript found for lesson', lessonId);
    await mongoose.connection.close();
    return;
  }

  // Gather every audio object tied to this lesson.
  const paths = new Set();
  (transcript.audioChunks || []).forEach(c => c.gcsPath && paths.add(c.gcsPath));
  if (transcript.tutorReferenceMeta?.gcsPath) paths.add(transcript.tutorReferenceMeta.gcsPath);
  (transcript.segments || []).forEach(s => s.audioGcsPath && paths.add(s.audioGcsPath));

  console.log(`Found ${paths.size} audio object(s) for lesson ${lessonId}:`);
  let preserved = 0;
  for (const p of paths) {
    if (await preserveObject(p)) preserved++;
  }

  // Bump DB deleteAt for consistency (not used by the cron, but keeps state sane).
  let dbBumped = 0;
  (transcript.audioChunks || []).forEach(c => {
    if (c.deleteAt) { c.deleteAt = FAR_FUTURE; dbBumped++; }
  });
  if (dbBumped > 0) {
    transcript.markModified('audioChunks');
    await transcript.save();
  }

  console.log(`\n✅ Done. Preserved ${preserved}/${paths.size} GCS objects, bumped ${dbBumped} DB deleteAt field(s).`);
  if (preserved === 0) {
    console.log('   (If everything was already gone, the 48h window has passed — capture a fresh fixture instead.)');
  }

  await mongoose.connection.close();
})().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
