/**
 * Phase 1 voiceprint EVAL HARNESS (offline, read-only on the DB).
 *
 * Replays a stored lesson and, for every student segment the blunt time-overlap
 * filter WOULD drop, asks the voiceprint sidecar "is this the student or the
 * tutor?" — then reports keep/drop vs. the old filter. This is how we tune the
 * voiceprint approach against preserved fixtures with NO live lessons.
 *
 * Per-segment audio is sliced deterministically: each segment references its
 * source blob (audioGcsPath) and its within-blob offset is (timestamp - startTime).
 *
 * Requires:
 *   • VOICEPRINT_SIDECAR_URL (e.g. http://localhost:8077) with the sidecar running
 *   • ffmpeg on PATH
 *
 * Usage:  node scripts/voiceprintEval.js <lessonId>
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config.env') });

const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);

const mongoose = require('mongoose');
const LessonTranscript = require('../models/LessonTranscript');
const { downloadAudioChunk } = require('../services/audioBackupService');
const vp = require('../services/voiceprintClient');

const TOLERANCE_SEC = 0.3;
const MIN_ENROLL_SEC = 1.0;   // only enroll the student from clips >= 1s
const MAX_ENROLL_CLIPS = 8;

function overlapsTutor(s, e, iv, tol = TOLERANCE_SEC) {
  return iv.some(x => x.endSec >= s - tol && x.startSec <= e + tol);
}

// Slice [offsetSec, offsetSec+durSec] out of an in-memory audio blob → wav buffer.
async function sliceClip(srcBuf, srcExt, offsetSec, durSec, tmpDir, id) {
  const inPath = path.join(tmpDir, `in-${id}.${srcExt}`);
  const outPath = path.join(tmpDir, `clip-${id}.wav`);
  fs.writeFileSync(inPath, srcBuf);
  await execFileP('ffmpeg', [
    '-y', '-ss', String(Math.max(0, offsetSec)), '-i', inPath,
    '-t', String(Math.max(0.05, durSec)), '-ac', '1', '-ar', '16000', '-f', 'wav', outPath,
  ]);
  const buf = fs.readFileSync(outPath);
  fs.unlinkSync(inPath); fs.unlinkSync(outPath);
  return buf;
}

(async () => {
  const lessonId = process.argv[2];
  if (!lessonId) { console.error('Usage: node scripts/voiceprintEval.js <lessonId>'); process.exit(1); }

  if (!vp.isEnabled()) {
    console.error('❌ VOICEPRINT_SIDECAR_URL is not set. Start the sidecar and set the URL:');
    console.error('   cd backend/audio-sidecar && uvicorn app:app --port 8077');
    console.error('   export VOICEPRINT_SIDECAR_URL=http://localhost:8077');
    process.exit(1);
  }
  const h = await vp.health();
  if (!h) { console.error('❌ Sidecar not reachable at', process.env.VOICEPRINT_SIDECAR_URL); process.exit(1); }
  console.log('✅ Sidecar healthy:', JSON.stringify(h));

  await mongoose.connect(process.env.MONGODB_URI);
  const t = await LessonTranscript.findOne({ lessonId });
  if (!t) { console.log('❌ No transcript for', lessonId); await mongoose.connection.close(); return; }

  const startMs = t.startTime ? t.startTime.getTime() : 0;
  const iv = (t.tutorSpeechIntervals || []).map(v => ({ startSec: v.startSec, endSec: v.endSec }));
  const stu = t.segments.filter(s => s.speaker === 'student' && s.duration > 0 && s.timestamp && s.audioGcsPath);

  // Partition student segments into clean (enrollment) vs overlapping (to judge).
  const tagged = stu.map(s => {
    const start = (s.timestamp.getTime() - startMs) / 1000;
    return { s, start, end: start + s.duration, overlap: overlapsTutor(start, start + s.duration, iv) };
  });
  const clean = tagged.filter(x => !x.overlap);
  const overlapping = tagged.filter(x => x.overlap);
  console.log(`Student segments: ${stu.length} (clean=${clean.length}, overlapping=${overlapping.length})`);
  if (clean.length === 0) { console.log('❌ No clean student audio to enroll a voiceprint. Aborting.'); await mongoose.connection.close(); return; }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpeval-'));
  const blobCache = new Map();
  const getBlob = async (gcsPath) => {
    if (!blobCache.has(gcsPath)) blobCache.set(gcsPath, await downloadAudioChunk(gcsPath));
    return blobCache.get(gcsPath);
  };

  // 1) Enroll student voiceprint from the longest clean clips.
  const enrollClips = clean.filter(x => x.s.duration >= MIN_ENROLL_SEC)
    .sort((a, b) => b.s.duration - a.s.duration).slice(0, MAX_ENROLL_CLIPS);
  const studentEmbeds = [];
  for (const x of enrollClips) {
    const buf = await getBlob(x.s.audioGcsPath);
    const clip = await sliceClip(buf, 'webm', x.start, x.s.duration, tmpDir, `enr-${studentEmbeds.length}`);
    const emb = await vp.embed(clip, 'audio/wav');
    if (emb) studentEmbeds.push(emb);
  }
  const studentRef = vp.poolEmbeddings(studentEmbeds);
  console.log(`Enrolled student voiceprint from ${studentEmbeds.length} clean clip(s).`);
  if (!studentRef) { console.log('❌ Failed to build student voiceprint.'); await mongoose.connection.close(); return; }

  // 2) Build tutor voiceprint from the clean tutor reference track (if present).
  let tutorRef = null;
  if (t.tutorReferenceMeta?.gcsPath) {
    try {
      const tutBuf = await downloadAudioChunk(t.tutorReferenceMeta.gcsPath);
      const tutPath = path.join(tmpDir, 'tutor.webm');
      fs.writeFileSync(tutPath, tutBuf);
      tutorRef = await vp.embed(tutBuf, 'audio/webm');
      fs.unlinkSync(tutPath);
    } catch (e) { console.warn('⚠️ tutor reference embed failed:', e.message); }
  }
  console.log(`Tutor voiceprint: ${tutorRef ? 'built' : 'unavailable (student-only thresholding)'}`);

  // 3) Classify each overlapping student segment.
  let keep = 0, drop = 0, uncertain = 0;
  const rows = [];
  for (const x of overlapping) {
    let res = null;
    try {
      const buf = await getBlob(x.s.audioGcsPath);
      const clip = await sliceClip(buf, 'webm', x.start, x.s.duration, tmpDir, `ov-${rows.length}`);
      res = await vp.classify(clip, studentRef, tutorRef, 'audio/wav');
    } catch (e) { /* fall through to uncertain */ }
    const label = res?.label || 'uncertain';
    if (label === 'student') keep++; else if (label === 'tutor') drop++; else uncertain++;
    rows.push({ label, ss: res?.studentScore, ts: res?.tutorScore, text: (x.s.text || '').trim() });
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\n──────────────── VOICEPRINT vs TIME-OVERLAP ────────────────');
  console.log(`Time-overlap filter would DROP all ${overlapping.length} overlapping segments.`);
  console.log(`Voiceprint: KEEP(student)=${keep}  DROP(tutor)=${drop}  UNCERTAIN=${uncertain}`);
  console.log('────────────────────────────────────────────────────────────');
  rows.forEach((r, i) => {
    const sc = `s=${r.ss != null ? r.ss.toFixed(2) : '—'} t=${r.ts != null ? r.ts.toFixed(2) : '—'}`;
    console.log(`  ${String(i + 1).padStart(2)} | ${r.label.padEnd(9)} | ${sc.padEnd(18)} | "${r.text}"`);
  });
  console.log('\nKEEP(student) segments are genuine repeat-after-me the old filter destroyed.');

  await mongoose.connection.close();
})().catch(err => { console.error('❌ Error:', err); process.exit(1); });
