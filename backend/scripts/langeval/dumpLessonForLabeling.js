#!/usr/bin/env node
/**
 * Dump a real lesson's STUDENT utterances into the eval-fixture schema with
 * blank gold labels, ready for a human to fill in. This turns "I have no
 * labeled data" into "I label one lesson and get a precision number" — and
 * lets us measure the synthetic→real gap.
 *
 * Usage:
 *   node scripts/langeval/dumpLessonForLabeling.js <lessonId> [--native en] [--target de]
 *
 * Output: scripts/langeval/fixtures/lesson-<lessonId>.labeled.json
 *
 * Then edit the file: set each token's "gold" to one of
 *   target | native | other | shared | ambiguous | non_lexical
 * (every token is pre-filled "TODO"). Mic-bleed (excludedByTutorOverlap)
 * student segments are skipped. Finally score it:
 *   node scripts/langeval/scoreLangClassifier.js --fixture fixtures/lesson-<id>.labeled.json
 */

const path = require('path');
require(path.join(__dirname, '../../node_modules/dotenv')).config({ path: path.join(__dirname, '../../config.env') });
const fs = require('fs');
const mongoose = require(path.join(__dirname, '../../node_modules/mongoose'));
const LessonTranscript = require(path.join(__dirname, '../../models/LessonTranscript'));

function arg(flag, def) {
  const a = process.argv.slice(2);
  const i = a.indexOf(flag);
  return i >= 0 && a[i + 1] ? a[i + 1] : def;
}

const NAME_TO_ISO = { english: 'en', german: 'de', spanish: 'es', french: 'fr', italian: 'it', portuguese: 'pt', dutch: 'nl' };

async function main() {
  const lessonId = process.argv[2];
  if (!lessonId || lessonId.startsWith('--')) {
    console.error('Usage: node scripts/langeval/dumpLessonForLabeling.js <lessonId> [--native en] [--target de]');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const t = await LessonTranscript.findOne({ lessonId });
  if (!t) { console.error(`No transcript for lesson ${lessonId}`); process.exit(1); }

  const target = arg('--target', NAME_TO_ISO[(t.language || '').toLowerCase()] || 'de');
  const native = arg('--native', 'en');

  const studentSegs = t.segments.filter(s => s.speaker === 'student' && s.text && !s.excludedByTutorOverlap);
  const cases = studentSegs.map((s, idx) => ({
    id: idx,
    category: 'real',
    detectedLanguage: s.detectedLanguage || null,
    confidence: s.confidence ?? null,
    text: s.text.trim(),
    tokens: s.text.trim().split(/\s+/).filter(Boolean).map((w, i) => ({ id: i, text: w, gold: 'TODO' }))
  }));

  const out = {
    pair: `${native}-${target}`,
    native,
    target,
    lessonId,
    generatedAt: new Date().toISOString(),
    note: 'REAL lesson — set each token gold (target|native|other|shared|ambiguous|non_lexical), replacing "TODO".',
    cases
  };

  const dir = path.join(__dirname, 'fixtures');
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `lesson-${lessonId}.labeled.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`✅ Wrote ${cases.length} student utterances → ${path.relative(process.cwd(), outPath)}`);
  console.log(`   Edit the "gold" fields, then score it with scoreLangClassifier.js`);
  await mongoose.connection.close();
}

main().catch(e => { console.error(e); process.exit(1); });
