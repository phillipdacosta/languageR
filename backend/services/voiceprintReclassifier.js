/**
 * Voiceprint reclassifier (Phase 1 production logic).
 *
 * Given a lesson transcript, decides for each STUDENT segment that overlaps
 * tutor speech whether it's really the student (keep) or tutor bleed (drop), by
 * comparing each segment's audio to an enrolled student voiceprint vs. the
 * tutor's. This replaces the blunt time-overlap filter that dropped ALL
 * overlapping student segments (destroying genuine repeat-after-me speech).
 *
 * Fail-soft: returns { available:false } whenever anything is missing (sidecar
 * down, no clean audio to enroll, no sliceable segment audio), so callers fall
 * back to the existing heuristics. Never throws into the analysis pipeline.
 *
 * No per-request API cost — the sidecar is self-hosted CPU compute.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);

const { downloadAudioChunk } = require('./audioBackupService');
const vp = require('./voiceprintClient');

const TOLERANCE_SEC = 0.3;
const MIN_ENROLL_SEC = 1.0;
const MAX_ENROLL_CLIPS = 8;

function overlapsTutor(s, e, iv, tol = TOLERANCE_SEC) {
  return iv.some(x => x.endSec >= s - tol && x.startSec <= e + tol);
}

async function sliceClip(srcBuf, offsetSec, durSec, tmpDir, id) {
  const inPath = path.join(tmpDir, `in-${id}.webm`);
  const outPath = path.join(tmpDir, `clip-${id}.wav`);
  fs.writeFileSync(inPath, srcBuf);
  try {
    await execFileP('ffmpeg', [
      '-y', '-ss', String(Math.max(0, offsetSec)), '-i', inPath,
      '-t', String(Math.max(0.05, durSec)), '-ac', '1', '-ar', '16000', '-f', 'wav', outPath,
    ]);
    return fs.readFileSync(outPath);
  } finally {
    for (const p of [inPath, outPath]) { try { fs.unlinkSync(p); } catch (_) {} }
  }
}

/**
 * @returns {Promise<{available:boolean, reason?:string, decisions?:Array<{segIndex:number,label:string,studentScore:number,tutorScore:number,text:string}>, stats?:object}>}
 */
async function reclassifyOverlaps(transcript, tutorIntervals) {
  if (!vp.isEnabled()) return { available: false, reason: 'sidecar_disabled' };
  if (!tutorIntervals || tutorIntervals.length === 0) return { available: false, reason: 'no_tutor_intervals' };

  const startMs = transcript.startTime ? transcript.startTime.getTime() : 0;
  const segs = transcript.segments || [];
  const enriched = [];
  segs.forEach((s, segIndex) => {
    if (s.speaker !== 'student' || !s.duration || s.duration <= 0 || !s.timestamp || !s.audioGcsPath) return;
    const start = (s.timestamp.getTime() - startMs) / 1000;
    enriched.push({ seg: s, segIndex, start, end: start + s.duration, overlap: overlapsTutor(start, start + s.duration, tutorIntervals) });
  });

  const clean = enriched.filter(x => !x.overlap);
  const overlapping = enriched.filter(x => x.overlap);
  if (overlapping.length === 0) return { available: false, reason: 'no_overlapping_segments' };
  if (clean.length === 0) return { available: false, reason: 'no_clean_enrollment_audio' };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-'));
  const blobCache = new Map();
  const getBlob = async (gcsPath) => {
    if (!blobCache.has(gcsPath)) blobCache.set(gcsPath, await downloadAudioChunk(gcsPath));
    return blobCache.get(gcsPath);
  };

  try {
    // Enroll student voiceprint from the longest clean clips.
    const enrollClips = clean.filter(x => x.seg.duration >= MIN_ENROLL_SEC)
      .sort((a, b) => b.seg.duration - a.seg.duration).slice(0, MAX_ENROLL_CLIPS);
    const studentEmbeds = [];
    for (const x of enrollClips) {
      const clip = await sliceClip(await getBlob(x.seg.audioGcsPath), x.start, x.seg.duration, tmpDir, `enr-${studentEmbeds.length}`);
      const emb = await vp.embed(clip, 'audio/wav');
      if (emb) studentEmbeds.push(emb);
    }
    const studentRef = vp.poolEmbeddings(studentEmbeds);
    if (!studentRef) return { available: false, reason: 'enrollment_failed' };

    // Tutor voiceprint from the clean reference track (optional).
    let tutorRef = null;
    if (transcript.tutorReferenceMeta?.gcsPath) {
      try { tutorRef = await vp.embed(await getBlob(transcript.tutorReferenceMeta.gcsPath), 'audio/webm'); } catch (_) {}
    }

    const decisions = [];
    let keep = 0, dropTutor = 0, uncertain = 0;
    for (const x of overlapping) {
      let res = null;
      try {
        const clip = await sliceClip(await getBlob(x.seg.audioGcsPath), x.start, x.seg.duration, tmpDir, `ov-${decisions.length}`);
        res = await vp.classify(clip, studentRef, tutorRef, 'audio/wav');
      } catch (_) {}
      const label = res?.label || 'uncertain';
      if (label === 'student') keep++; else if (label === 'tutor') dropTutor++; else uncertain++;
      decisions.push({ segIndex: x.segIndex, label, studentScore: res?.studentScore ?? null, tutorScore: res?.tutorScore ?? null, text: (x.seg.text || '').trim() });
    }

    return {
      available: true,
      decisions,
      stats: { enrolled: studentEmbeds.length, tutorRef: !!tutorRef, overlapping: overlapping.length, keep, dropTutor, uncertain },
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { reclassifyOverlaps };
