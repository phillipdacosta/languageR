/**
 * Standalone, no-DB test for errorPatternEngine.
 *
 * Validates the properties that matter for "what to work on next":
 *   1. Subjunctive (1–2 char morphological fix) is KEPT, not discarded.
 *   2. Related mistakes cluster under one canonical skill.
 *   3. Recurring + high-impact issues rank above one-off polish.
 *   4. ASR-suspect corrections are down-weighted, not deleted.
 *   5. Works for a language without a dedicated taxonomy (unknown-bucket
 *      fallback) — i.e. it's language-agnostic.
 *   6. classifyTranscriptionRisk treats grammatical small edits as real.
 *
 * Run: node backend/test-error-pattern-engine.js
 */

const assert = require('assert');
const engine = require('./services/errorPatternEngine');
const complexity = require('./services/complexityAnalyzer');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('\n=== classifyTranscriptionRisk ===');

check('subjunctive es→sea (grammatical, clean) is treated as REAL', () => {
  const r = engine.classifyTranscriptionRisk({
    type: 'mood',
    editDistance: 2,
    hasLowConfidenceWord: false,
    isPhoneticallySimilar: false,
    correctedAppearsOften: false
  });
  assert.strictEqual(r.isLikelyTranscriptionError, false, `risk=${r.risk}`);
});

check('gender agreement bonito→bonita (1 char, grammatical) is REAL', () => {
  const r = engine.classifyTranscriptionRisk({
    type: 'agreement',
    editDistance: 1,
    isPhoneticallySimilar: true // looks alike, but it IS the contrast
  });
  assert.strictEqual(r.isLikelyTranscriptionError, false, `risk=${r.risk}`);
});

check('non-grammatical lexical lookalike on low-confidence span is ASR noise', () => {
  const r = engine.classifyTranscriptionRisk({
    type: 'word_choice',
    editDistance: 1,
    hasLowConfidenceWord: true,
    isPhoneticallySimilar: true
  });
  assert.strictEqual(r.isLikelyTranscriptionError, true, `risk=${r.risk}`);
});

console.log('\n=== buildErrorPatterns: Spanish subjunctive + clustering + ranking ===');

const esResult = engine.buildErrorPatterns({
  language: 'es',
  nativeLanguage: 'en',
  durationMinutes: 30,
  goalType: 'conversational',
  transcriptLower: [
    'no creo que es una buena idea',
    'no pienso que tiene razon',
    'la casa es muy bonito',
    'mis amigos son muy simpatico',
    'fui al supermercado y me gusta mucho',
    'eh, este, pues, no se'
  ].join(' '),
  corrections: [
    // Subjunctive: two instances, both clean grammatical fixes → should cluster + rank high
    { original: 'no creo que es', corrected: 'no creo que sea', type: 'mood', severity: 'error', reason: 'subjunctive required after no creo que', transcriptionRisk: 0.0, isLikelyTranscriptionError: false },
    { original: 'no pienso que tiene', corrected: 'no pienso que tenga', type: 'mood', severity: 'error', reason: 'subjunctive mood needed', transcriptionRisk: 0.0, isLikelyTranscriptionError: false },
    // Gender agreement: two instances → cluster
    { original: 'es muy bonito', corrected: 'es muy bonita', type: 'agreement', severity: 'error', reason: 'gender agreement with casa (feminine)', transcriptionRisk: 0.2, isLikelyTranscriptionError: false },
    { original: 'muy simpatico', corrected: 'muy simpaticos', type: 'agreement', severity: 'error', reason: 'number agreement, plural amigos', transcriptionRisk: 0.2, isLikelyTranscriptionError: false },
    // One-off filler note (low impact) — should rank below recurring grammar
    { original: 'eh este pues', corrected: 'eh este pues', type: 'word_choice', severity: 'error', reason: 'filler words / muletillas', transcriptionRisk: 0.1, isLikelyTranscriptionError: false }
  ],
  llmErrorPatterns: [
    {
      pattern: 'Present subjunctive',
      practiceNeeded: 'Practica el subjuntivo después de expresiones de duda.',
      examples: [{ original: 'no creo que es', corrected: 'no creo que sea', explanation: 'Usa subjuntivo tras "no creo que".' }]
    }
  ]
});

check('subjunctive survived and is reported', () => {
  const hasSubj = esResult.errorPatterns.some(p => p.skillId === 'es.grammar.mood.subjunctive_present');
  assert.ok(hasSubj, 'subjunctive pattern missing from output');
});

check('subjunctive examples clustered (frequency >= 2)', () => {
  const subj = esResult.errorPatterns.find(p => p.skillId === 'es.grammar.mood.subjunctive_present');
  assert.ok(subj.frequency >= 2, `expected >=2, got ${subj.frequency}`);
});

check('subjunctive borrowed the LLM localized practice text', () => {
  const subj = esResult.errorPatterns.find(p => p.skillId === 'es.grammar.mood.subjunctive_present');
  assert.ok(/subjuntivo/i.test(subj.practiceNeeded), `got: ${subj.practiceNeeded}`);
});

check('subjunctive (high impact, recurring) ranks #1 above filler', () => {
  const subjRank = esResult.topErrors.find(e => e.skillId === 'es.grammar.mood.subjunctive_present')?.rank;
  assert.strictEqual(subjRank, 1, `subjunctive rank was ${subjRank}`);
});

check('every reported example is grounded in the transcript', () => {
  const norm = engine._internal.normalizeQuote(
    'no creo que es una buena idea no pienso que tiene razon la casa es muy bonito mis amigos son muy simpatico fui al supermercado y me gusta mucho eh este pues no se'
  );
  for (const p of esResult.errorPatterns) {
    for (const ex of p.examples) {
      assert.ok(norm.includes(engine._internal.normalizeQuote(ex.original)), `ungrounded example: "${ex.original}"`);
    }
  }
});

check('verifiedErrorCount counts grounded scorable instances', () => {
  assert.ok(esResult.verifiedErrorCount >= 4, `got ${esResult.verifiedErrorCount}`);
});

console.log('\n=== ASR down-weight (not delete) ===');

const asrResult = engine.buildErrorPatterns({
  language: 'es',
  durationMinutes: 20,
  transcriptLower: 'yo apretas el boton y luego come la comida rapidamente todos los dias',
  corrections: [
    // A clearly ASR-suspect lexical lookalike, flagged high risk
    { original: 'yo apretas', corrected: 'yo aprietas', type: 'word_choice', severity: 'error', reason: 'likely transcription artifact', transcriptionRisk: 0.8, isLikelyTranscriptionError: true },
    // A genuine recurring conjugation error, clean
    { original: 'luego come la comida', corrected: 'luego como la comida', type: 'agreement', severity: 'error', reason: 'subject-verb agreement, first person', transcriptionRisk: 0.1, isLikelyTranscriptionError: false }
  ]
});

check('ASR-suspect item is kept but flagged', () => {
  const asr = asrResult.errorPatterns.find(p => p.isLikelyTranscriptionError);
  assert.ok(asr, 'ASR-suspect cluster was deleted (should be kept, down-weighted)');
});

check('clean grammar error outranks ASR-suspect item', () => {
  const clean = asrResult.topErrors.find(e => !e.isLikelyTranscriptionError);
  const asr = asrResult.topErrors.find(e => e.isLikelyTranscriptionError);
  assert.ok(clean.rank < asr.rank, `clean rank ${clean.rank} should beat asr rank ${asr.rank}`);
});

console.log('\n=== Language-agnostic: language with no taxonomy file (e.g. Japanese) ===');

const jaResult = engine.buildErrorPatterns({
  language: 'ja',
  nativeLanguage: 'en',
  durationMinutes: 25,
  transcriptLower: 'watashi wa gakkou ni ikimasu kinou tabemasu',
  corrections: [
    { original: 'kinou tabemasu', corrected: 'kinou tabemashita', type: 'tense', severity: 'error', reason: 'past tense needed with kinou (yesterday)', transcriptionRisk: 0.1, isLikelyTranscriptionError: false },
    { original: 'gakkou ni ikimasu', corrected: 'gakkou e ikimasu', type: 'preposition', severity: 'error', reason: 'particle choice for direction', transcriptionRisk: 0.1, isLikelyTranscriptionError: false }
  ]
});

check('unknown-language corrections still produce ranked patterns', () => {
  assert.ok(jaResult.errorPatterns.length >= 2, `got ${jaResult.errorPatterns.length}`);
});

check('unknown-language patterns get stable unknown-bucket skillIds', () => {
  assert.ok(jaResult.errorPatterns.every(p => /^ja\./.test(p.skillId)), JSON.stringify(jaResult.errorPatterns.map(p => p.skillId)));
});

console.log('\n=== Full-transcript recurrence counting (no AI cost) ===');

const recurReptText = Array(4).fill('no creo que es buena idea para mi').join(' ');
const recurResult = engine.buildErrorPatterns({
  language: 'es',
  durationMinutes: 60,
  // sampled slice the LLM saw shows it once; full transcript has it 4×
  transcriptLower: 'no creo que es buena idea para mi',
  fullTranscriptLower: recurReptText,
  corrections: [
    { original: 'no creo que es', corrected: 'no creo que sea', type: 'mood', severity: 'error', reason: 'subjunctive after no creo que', transcriptionRisk: 0.0, isLikelyTranscriptionError: false }
  ]
});

check('frequency reflects FULL-transcript recurrence, not the sampled slice', () => {
  const subj = recurResult.errorPatterns.find(p => p.skillId === 'es.grammar.mood.subjunctive_present');
  assert.ok(subj && subj.frequency >= 3, `expected >=3 from 4 repetitions, got ${subj && subj.frequency}`);
});

console.log('\n=== Localized fallback practice text ===');
check('fallback practice is localized to native language (es)', () => {
  const r = engine.buildErrorPatterns({
    language: 'es',
    nativeLanguage: 'es',
    transcriptLower: 'la casa es muy bonito y el coche es rojo grande',
    corrections: [
      { original: 'es muy bonito', corrected: 'es muy bonita', type: 'agreement', severity: 'error', reason: '', transcriptionRisk: 0.1, isLikelyTranscriptionError: false }
    ]
    // no llmErrorPatterns → forces fallback practice text
  });
  const p = r.errorPatterns[0];
  assert.ok(/[áéíóúñ]|frase|practica|repasa/i.test(p.practiceNeeded), `not localized: ${p.practiceNeeded}`);
});

console.log('\n=== Complexity detector: overuse of simple structures ===');

const simpleSegments = [];
for (let i = 0; i < 20; i++) {
  simpleSegments.push({ text: 'me gusta el cafe' });        // 4 words
  simpleSegments.push({ text: 'voy a casa' });               // 3 words
}
check('flags simple-structure overuse for B1 with enough speech', () => {
  const c = complexity.analyzeComplexity({
    studentSegments: simpleSegments,
    proficiencyLevel: 'B1',
    complexSentencesUsed: 0,
    nativeLanguage: 'es'
  });
  assert.ok(c.signal, `expected a signal, reason=${c.reason}`);
  assert.strictEqual(c.signal.skillId, 'universal.discourse.sentence_complexity');
});

check('does NOT nag advanced (C2) speakers', () => {
  const c = complexity.analyzeComplexity({
    studentSegments: simpleSegments,
    proficiencyLevel: 'C2',
    complexSentencesUsed: 0
  });
  assert.strictEqual(c.signal, null, `should skip C2, got reason=${c.reason}`);
});

check('does NOT flag when there is little speech', () => {
  const c = complexity.analyzeComplexity({
    studentSegments: [{ text: 'hola que tal' }],
    proficiencyLevel: 'A2'
  });
  assert.strictEqual(c.signal, null);
});

check('complexity signal merges into ranked output via extraSignals', () => {
  const c = complexity.analyzeComplexity({ studentSegments: simpleSegments, proficiencyLevel: 'B1', nativeLanguage: 'en' });
  const r = engine.buildErrorPatterns({
    language: 'es',
    nativeLanguage: 'en',
    transcriptLower: simpleSegments.map(s => s.text).join(' '),
    corrections: [],
    extraSignals: c.signal ? [c.signal] : []
  });
  assert.ok(r.topErrors.some(e => e.skillId === 'universal.discourse.sentence_complexity'), 'complexity signal not surfaced');
  assert.strictEqual(r.verifiedErrorCount, 0, 'complexity must not count as a grammar error');
});

console.log('\n=== Empty input safety ===');
check('no corrections → empty, no throw', () => {
  const r = engine.buildErrorPatterns({ language: 'es', corrections: [] });
  assert.deepStrictEqual(r.errorPatterns, []);
  assert.strictEqual(r.verifiedErrorCount, 0);
});

console.log(`\n${process.exitCode ? '❌ FAILURES' : `✅ All ${passed} checks passed`}\n`);
