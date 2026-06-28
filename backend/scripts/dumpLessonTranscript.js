#!/usr/bin/env node
/**
 * Debug tool: dump a lesson's FULL transcript to downloadable files and show
 * the production token-level language labels (target/native/shared/…) for
 * every student utterance — so we can read what was actually captured and
 * verify the "native vs mixed vs target" classifier on real data.
 *
 * Usage:
 *   node scripts/dumpLessonTranscript.js <lessonId|transcriptId> [--native en] [--target de] [--no-llm]
 *
 * Outputs (in scripts/transcript-dumps/):
 *   <id>-transcript.txt  — full chronological transcript (both speakers), readable
 *   <id>-labeled.md      — every student utterance with per-token language labels
 *   <id>.json            — structured data (segments + labels) for tooling
 *
 * The classifier uses the SAME service production runs
 * (services/languageClassifierService). Requires OPENAI_API_KEY unless --no-llm.
 */

const path = require('path');
require(path.join(__dirname, '../node_modules/dotenv')).config({ path: path.join(__dirname, '../config.env') });
const fs = require('fs');
const mongoose = require(path.join(__dirname, '../node_modules/mongoose'));
const LessonTranscript = require(path.join(__dirname, '../models/LessonTranscript'));
const languageClassifierService = require(path.join(__dirname, '../services/languageClassifierService'));

function arg(flag, def) {
  const a = process.argv.slice(2);
  const i = a.indexOf(flag);
  return i >= 0 && a[i + 1] ? a[i + 1] : def;
}
function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

const NAME_TO_ISO = {
  english: 'en', german: 'de', spanish: 'es', french: 'fr', italian: 'it',
  portuguese: 'pt', dutch: 'nl', polish: 'pl', russian: 'ru', swedish: 'sv',
  danish: 'da', norwegian: 'no', finnish: 'fi', turkish: 'tr', japanese: 'ja',
  chinese: 'zh', korean: 'ko', arabic: 'ar'
};

function fmtClock(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

async function main() {
  const id = process.argv[2];
  if (!id || id.startsWith('--')) {
    console.error('Usage: node scripts/dumpLessonTranscript.js <lessonId|transcriptId> [--native en] [--target de] [--no-llm]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  // Accept either a lessonId or the transcript _id.
  let t = await LessonTranscript.findOne({ lessonId: id });
  if (!t && mongoose.isValidObjectId(id)) t = await LessonTranscript.findById(id);
  if (!t) { console.error(`No transcript found for ${id}`); await mongoose.connection.close(); process.exit(1); }

  const target = arg('--target', NAME_TO_ISO[(t.language || '').toLowerCase()] || 'de');
  const native = arg('--native', 'en');
  const useLLM = !hasFlag('--no-llm');

  const startMs = t.startTime ? new Date(t.startTime).getTime() : 0;

  // Chronological order across BOTH speakers. timestamp is the source of truth;
  // fall back to original array order for any segment missing one.
  const segments = (t.segments || [])
    .map((s, originalIdx) => ({ s, originalIdx }))
    .sort((a, b) => {
      const ta = a.s.timestamp ? new Date(a.s.timestamp).getTime() : null;
      const tb = b.s.timestamp ? new Date(b.s.timestamp).getTime() : null;
      if (ta == null && tb == null) return a.originalIdx - b.originalIdx;
      if (ta == null) return 1;
      if (tb == null) return -1;
      if (ta !== tb) return ta - tb;
      return a.originalIdx - b.originalIdx;
    })
    .map(x => x.s);

  // ---- 1. Full chronological transcript (readable) -------------------------
  const lines = [];
  lines.push(`Lesson transcript dump`);
  lines.push(`  lessonId:      ${t.lessonId}`);
  lines.push(`  transcriptId:  ${t._id}`);
  lines.push(`  language:      ${t.language} (target=${target}, native=${native})`);
  lines.push(`  segments:      ${segments.length} total`);
  lines.push(`  generatedAt:   ${new Date().toISOString()}`);
  lines.push(`  legend:        [MIC-BLEED] = student segment dropped as tutor overlap`);
  lines.push('');
  lines.push('='.repeat(72));
  lines.push('');

  for (const s of segments) {
    const rel = (s.timestamp ? new Date(s.timestamp).getTime() : startMs) - startMs;
    const who = s.speaker === 'tutor' ? 'TUTOR  ' : 'STUDENT';
    const bleed = s.excludedByTutorOverlap ? ' [MIC-BLEED]' : '';
    const detected = s.detectedLanguage ? ` (${s.detectedLanguage})` : '';
    lines.push(`[${fmtClock(rel)}] ${who}${detected}${bleed}: ${(s.text || '').trim()}`);
  }

  // ---- 2. Token-level labels for student utterances ------------------------
  // Classify ALL student segments (including mic-bleed) so the dump shows the
  // classifier verdict for everything; mic-bleed is flagged, not hidden.
  const studentSegs = segments.filter(s => s.speaker === 'student' && s.text && s.text.trim());

  let classification = null;
  if (useLLM && studentSegs.length > 0) {
    process.stdout.write(`🔎 Classifying ${studentSegs.length} student utterances with ${native}->${target} token classifier… `);
    classification = await languageClassifierService.classifyLessonSegments({
      studentSegments: studentSegs,
      allSegments: segments,
      targetIso: target,
      nativeIso: native
    });
    console.log(classification ? `done (model=${classification.model})` : 'FAILED (no labels — see warning above)');
  }

  const md = [];
  md.push(`# Labeled transcript — lesson ${t.lessonId}`);
  md.push('');
  md.push(`Target language: **${target}** · Native: **${native}** · Classifier: **${classification ? classification.model : (useLLM ? 'unavailable' : 'skipped (--no-llm)')}**`);
  md.push('');
  md.push('Each student token is labeled `target` / `native` / `other` / `shared` / `ambiguous` / `non_lexical`. Only `target` tokens earn target-language credit.');
  md.push('');

  const labelMark = {
    target: '✅target', native: '·native', other: '·other',
    shared: '·shared', ambiguous: '?ambig', non_lexical: '·filler'
  };

  let totalTargetWords = 0;
  const jsonStudent = [];

  studentSegs.forEach((seg, idx) => {
    const tokens = (seg.text || '').trim().split(/\s+/).filter(Boolean);
    const perSeg = classification ? classification.perSegment[idx] : null;
    const labels = perSeg ? perSeg.labels : tokens.map(() => 'unlabeled');
    const targetWords = perSeg ? perSeg.targetWords : 0;
    totalTargetWords += targetWords;

    const rel = (seg.timestamp ? new Date(seg.timestamp).getTime() : startMs) - startMs;
    const bleed = seg.excludedByTutorOverlap ? ' _(mic-bleed — excluded from credit)_' : '';
    md.push(`### [${fmtClock(rel)}] utterance ${idx + 1} — ${targetWords}/${tokens.length} target${bleed}`);
    md.push('');
    md.push('> ' + seg.text.trim());
    md.push('');
    const annotated = tokens.map((w, i) => `\`${w}\`${labelMark[labels[i]] || `·${labels[i]}`}`).join('  ');
    md.push(annotated);
    md.push('');

    jsonStudent.push({
      index: idx,
      relStartSec: Math.round(rel / 1000),
      text: seg.text.trim(),
      excludedByTutorOverlap: !!seg.excludedByTutorOverlap,
      detectedLanguage: seg.detectedLanguage || null,
      tokens: tokens.map((w, i) => ({ text: w, label: labels[i] })),
      targetWords
    });
  });

  md.unshift('');
  md.unshift(`**Total confirmed target words: ${totalTargetWords}** across ${studentSegs.length} student utterances.`);
  md.unshift('');

  // ---- Write outputs -------------------------------------------------------
  const dir = path.join(__dirname, 'transcript-dumps');
  fs.mkdirSync(dir, { recursive: true });
  const base = String(t.lessonId);

  const txtPath = path.join(dir, `${base}-transcript.txt`);
  const mdPath = path.join(dir, `${base}-labeled.md`);
  const jsonPath = path.join(dir, `${base}.json`);

  fs.writeFileSync(txtPath, lines.join('\n') + '\n');
  fs.writeFileSync(mdPath, md.join('\n') + '\n');
  fs.writeFileSync(jsonPath, JSON.stringify({
    lessonId: t.lessonId,
    transcriptId: String(t._id),
    language: t.language,
    target,
    native,
    classifierModel: classification ? classification.model : null,
    totalConfirmedTargetWords: totalTargetWords,
    generatedAt: new Date().toISOString(),
    segments: segments.map(s => ({
      relStartSec: Math.round(((s.timestamp ? new Date(s.timestamp).getTime() : startMs) - startMs) / 1000),
      speaker: s.speaker,
      text: (s.text || '').trim(),
      detectedLanguage: s.detectedLanguage || null,
      excludedByTutorOverlap: !!s.excludedByTutorOverlap
    })),
    studentLabeled: jsonStudent
  }, null, 2));

  console.log('');
  console.log(`✅ Full transcript:    ${path.relative(process.cwd(), txtPath)}`);
  console.log(`✅ Labeled (markdown): ${path.relative(process.cwd(), mdPath)}`);
  console.log(`✅ Structured JSON:    ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`   ${segments.length} segments · ${studentSegs.length} student utterances · ${totalTargetWords} confirmed target words`);

  await mongoose.connection.close();
}

main().catch(e => { console.error(e); process.exit(1); });
