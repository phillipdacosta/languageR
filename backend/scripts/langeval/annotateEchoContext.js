#!/usr/bin/env node
/**
 * Attach echo-detection context + ground-truth scaffolding to a labeled lesson
 * fixture, so we can MEASURE whether "repeat-after-me" detection works before
 * building any product behavior on it.
 *
 * For each student utterance it adds:
 *   - tutorPrev: the tutor's line immediately preceding it (the thing a
 *     repeat-after-me student would be echoing). Reconstructed from the
 *     transcript using the SAME ordering dumpLessonForLabeling.js used.
 *   - jaccardToTutorPrev: token-set similarity to that line (echo signal).
 *   - echoedAuto: candidate echo flag (jaccard >= threshold) — NOT ground truth.
 *   - echoed: ground-truth field. Pre-seeded from echoedAuto for TARGET-language
 *     utterances (the only ones that matter for the target echo ratio); set to
 *     null for non-target so they're ignored. USER CONFIRMS the target ones.
 *
 * Only TARGET-language utterances count toward the echo ratio (we care about
 * "how much of the student's target speech was echoed vs produced independently").
 *
 * Usage:
 *   node scripts/langeval/annotateEchoContext.js <lessonId> [--jaccard 0.5]
 */

const path = require('path');
require(path.join(__dirname, '../../node_modules/dotenv')).config({
  path: path.join(__dirname, '../../config.env')
});
const fs = require('fs');
const mongoose = require(path.join(__dirname, '../../node_modules/mongoose'));
const LessonTranscript = require(path.join(__dirname, '../../models/LessonTranscript'));

function arg(flag, def) {
  const a = process.argv.slice(2);
  const i = a.indexOf(flag);
  return i >= 0 && a[i + 1] ? a[i + 1] : def;
}

const tok = (t) => (t || '').toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

function jaccard(a, b) {
  const sa = new Set(tok(a));
  const sb = new Set(tok(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function isTargetCase(c) {
  return c.tokens.some(t => t.gold === 'target');
}

async function main() {
  const lessonId = process.argv[2];
  if (!lessonId || lessonId.startsWith('--')) {
    console.error('Usage: node scripts/langeval/annotateEchoContext.js <lessonId> [--jaccard 0.5]');
    process.exit(1);
  }
  const jThreshold = parseFloat(arg('--jaccard', '0.5'));

  const fixturePath = path.join(__dirname, 'fixtures', `lesson-${lessonId}.labeled.json`);
  if (!fs.existsSync(fixturePath)) {
    console.error(`No labeled fixture at ${fixturePath}. Run dumpLessonForLabeling.js + label it first.`);
    process.exit(1);
  }
  const fix = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  await mongoose.connect(process.env.MONGODB_URI);
  const t = await LessonTranscript.findOne({ lessonId });
  if (!t) { console.error(`No transcript for lesson ${lessonId}`); process.exit(1); }

  // Rebuild the student-segment order EXACTLY as the dump did, tracking the most
  // recent tutor line before each qualifying student segment.
  const tutorPrevByStudentIdx = [];
  let lastTutor = null;
  for (const s of t.segments) {
    if (s.speaker === 'tutor' && s.text) { lastTutor = s.text.trim(); continue; }
    if (s.speaker === 'student' && s.text && !s.excludedByTutorOverlap) {
      tutorPrevByStudentIdx.push(lastTutor);
    }
  }

  let targetCases = 0;
  const review = [];
  for (const c of fix.cases) {
    const tutorPrev = tutorPrevByStudentIdx[c.id] ?? null;
    c.tutorPrev = tutorPrev;
    c.jaccardToTutorPrev = +jaccard(c.text, tutorPrev).toFixed(3);
    c.echoedAuto = c.jaccardToTutorPrev >= jThreshold;
    if (isTargetCase(c)) {
      targetCases++;
      // Seed ground truth from auto-candidate; user confirms.
      if (c.echoed === undefined) c.echoed = c.echoedAuto;
      c.echoNeedsReview = true;
      review.push({ id: c.id, text: c.text, tutorPrev, j: c.jaccardToTutorPrev, echoedAuto: c.echoedAuto });
    } else {
      c.echoed = null; // not target → excluded from echo ratio
      c.echoNeedsReview = false;
    }
  }

  fix.echoAnnotation = {
    jaccardThreshold: jThreshold,
    targetCases,
    annotatedAt: new Date().toISOString(),
    note: 'echoed is GROUND TRUTH for target utterances (confirm echoNeedsReview cases). null = non-target, ignored in echo ratio.'
  };

  fs.writeFileSync(fixturePath, JSON.stringify(fix, null, 2));
  console.log(`✅ Annotated ${fix.cases.length} cases (${targetCases} target-language) → ${path.relative(process.cwd(), fixturePath)}`);
  console.log(`\nTARGET utterances — confirm echoed true/false (echoedAuto is a guess):`);
  for (const r of review) {
    console.log(`\n  [${r.id}] echoedAuto=${r.echoedAuto} jaccard=${r.j}`);
    console.log(`     student: "${r.text}"`);
    console.log(`     tutor  : "${r.tutorPrev || '(none)'}"`);
  }
  await mongoose.connection.close();
}

main().catch(e => { console.error(e); process.exit(1); });
