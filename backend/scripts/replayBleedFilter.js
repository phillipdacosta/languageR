/**
 * Offline replay / eval harness for the mic-bleed time-overlap filter.
 *
 * Re-runs the TIME-OVERLAP bleed filter (the part OVERLAP_FILTER_MODE controls)
 * against a stored transcript WITHOUT calling GPT, touching the learning plan,
 * or overwriting the analysis. It reports, per mode, how much genuine student
 * speech the filter keeps vs. drops — so we can tune the filter (and later the
 * voiceprint reclassifier) against real lessons instead of waiting for live
 * calls.
 *
 * The overlap + energy-guard logic here mirrors backend/routes/transcription.js
 * (segmentOverlapsTutor + tutorTrackHasSpeechEnergy, ~lines 2104-2162).
 *
 * Usage:
 *   node scripts/replayBleedFilter.js <lessonId>                 # read-only report
 *   node scripts/replayBleedFilter.js <lessonId> --reset-flags   # clear persisted
 *        excludedByTutorOverlap flags so a fresh analyzeLesson run in shadow/off
 *        mode isn't poisoned by stale legacy exclusions (WRITES to the transcript)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config.env') });

const mongoose = require('mongoose');
const LessonTranscript = require('../models/LessonTranscript');
const LessonAnalysis = require('../models/LessonAnalysis');

const TOLERANCE_SEC = 0.3;

function countWords(t) {
  return t ? t.trim().split(/\s+/).filter(Boolean).length : 0;
}

function segmentOverlapsTutor(segStart, segEnd, tutorIntervals, tol = TOLERANCE_SEC) {
  if (!tutorIntervals || tutorIntervals.length === 0) return false;
  const lo = segStart - tol;
  const hi = segEnd + tol;
  return tutorIntervals.some(iv => iv.endSec >= lo && iv.startSec <= hi);
}

(async () => {
  const lessonId = process.argv[2];
  const resetFlags = process.argv.includes('--reset-flags');
  if (!lessonId) {
    console.error('Usage: node scripts/replayBleedFilter.js <lessonId> [--reset-flags]');
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

  if (resetFlags) {
    let cleared = 0;
    transcript.segments.forEach(s => {
      if (s.excludedByTutorOverlap) { s.excludedByTutorOverlap = false; cleared++; }
    });
    transcript.markModified('segments');
    await transcript.save();
    console.log(`♻️  Cleared excludedByTutorOverlap on ${cleared} segment(s). Re-run analyzeLesson to reprocess cleanly.\n`);
  }

  const segs = transcript.segments || [];
  const studentSegs = segs.filter(s => s.speaker === 'student');
  const tutorIntervals = (transcript.tutorSpeechIntervals || []).map(iv => ({ startSec: iv.startSec, endSec: iv.endSec }));
  const transcriptStartMs = transcript.startTime ? transcript.startTime.getTime() : 0;

  // Energy guard — same condition as production.
  const tm = transcript.tutorReferenceMeta || {};
  const rms = typeof tm.rmsLevelDb === 'number' ? tm.rmsLevelDb : null;
  const silence = typeof tm.silenceRatio === 'number' ? tm.silenceRatio : null;
  const energyOk = rms === null || (rms > -50 && (silence === null || silence < 0.97));

  // Fresh time-overlap computation (ignores persisted flags).
  let rawStudentWords = 0;
  let overlapSegs = 0;
  let overlapWords = 0;
  let undetermined = 0; // missing duration/timestamp — production leaves these as-is
  studentSegs.forEach(seg => {
    const w = countWords(seg.text);
    rawStudentWords += w;
    if (!seg.duration || seg.duration <= 0 || !seg.timestamp) { undetermined++; return; }
    const start = (seg.timestamp.getTime() - transcriptStartMs) / 1000;
    const end = start + seg.duration;
    if (segmentOverlapsTutor(start, end, tutorIntervals)) {
      overlapSegs++;
      overlapWords += w;
    }
  });

  const persistedExcluded = studentSegs.filter(s => s.excludedByTutorOverlap).length;
  // The time-overlap filter only fires when intervals exist AND energy passes.
  const overlapFilterActive = tutorIntervals.length > 0 && energyOk;

  const fmt = (kept, dropped, words) =>
    `kept ${kept}/${studentSegs.length} segs, ${words} student words  (dropped ${dropped} segs / ${overlapWords} words by time-overlap)`;

  console.log('────────────────────────────────────────────────────────');
  console.log(`Lesson:                ${lessonId}`);
  console.log(`Total segments:        ${segs.length}`);
  console.log(`Student segments:      ${studentSegs.length}  (raw words: ${rawStudentWords})`);
  console.log(`Tutor VAD intervals:   ${tutorIntervals.length}`);
  console.log(`Tutor track RMS/sil:   ${rms}dB / ${silence}`);
  console.log(`Energy guard:          ${energyOk ? 'PASS (intervals trusted)' : 'FAIL (intervals ignored → no exclusion)'}`);
  console.log(`Time-overlap filter:   ${overlapFilterActive ? 'ACTIVE' : 'INACTIVE (no intervals or energy fail)'}`);
  console.log(`Segments w/o bounds:   ${undetermined} (left untouched by overlap filter)`);
  console.log(`Persisted excl. flags: ${persistedExcluded} (time-overlap + text-dedup combined)`);
  console.log('────────────────────────────────────────────────────────');
  console.log('Mode comparison (TIME-OVERLAP filter only; text-dedup unchanged):');
  if (!overlapFilterActive) {
    console.log('  legacy / shadow / off  →  identical: filter inactive, all student words kept.');
  } else {
    const keptLegacy = studentSegs.length - overlapSegs;
    console.log(`  legacy  →  ${fmt(keptLegacy, overlapSegs, rawStudentWords - overlapWords)}`);
    console.log(`  shadow  →  ${fmt(studentSegs.length, 0, rawStudentWords)}  [logs would-drop=${overlapSegs}]`);
    console.log(`  off     →  ${fmt(studentSegs.length, 0, rawStudentWords)}`);
  }
  console.log('────────────────────────────────────────────────────────');
  console.log('NOTE: This harness evaluates the blunt time-overlap filter only.');
  console.log('      Phase 1 voiceprint /verify will slot in here — instead of');
  console.log('      dropping every overlapping segment, score each against the');
  console.log('      student voiceprint and keep genuine repeat-after-me speech.');
  console.log('────────────────────────────────────────────────────────');

  const analysis = await LessonAnalysis.findOne({ lessonId }).sort({ createdAt: -1 });
  if (analysis) {
    console.log(`Latest analysis:       status=${analysis.status || 'n/a'}  gradeMode=${analysis.gradeMode || 'n/a'}  level=${analysis.cefrLevel || analysis.progressionMetrics?.currentLevel || 'n/a'}`);
  } else {
    console.log('Latest analysis:       (none)');
  }

  await mongoose.connection.close();
})().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
