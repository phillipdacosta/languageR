#!/usr/bin/env node
/**
 * Synthetic code-switch evaluation generator.
 *
 * WHY: We need to measure target-credit precision of our language classifier
 * across language pairs, but we cannot realistically recruit tutors/students
 * for every pair to hand-label data. Instead we build labeled test utterances
 * from public, language-tagged sentences (Tatoeba): each sentence's language is
 * already known, so when we splice a native + target sentence together we get
 * PERFECT token-level ground truth for free, for any pair.
 *
 * IMPORTANT LIMITATION (be honest about it): spliced text has clean boundaries,
 * no disfluencies, and NO ASR errors. So results here OVERESTIMATE real-world
 * accuracy and are best used to (a) catch gross failures (English credited as
 * target) and (b) compare classifiers relatively. Calibrate the synthetic→real
 * gap against the hand-labeled lesson fixtures (see dumpLessonForLabeling.js).
 *
 * Usage:
 *   node scripts/langeval/genCodeSwitchEval.js --native en --target de
 *   node scripts/langeval/genCodeSwitchEval.js --native en --target de --count 120
 *
 * Output: scripts/langeval/fixtures/synth-<native>-<target>.json
 * Raw Tatoeba samples are cached under scripts/langeval/data/ (gitignored).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ISO1_TO_ISO3 = {
  en: 'eng', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', nl: 'nld',
  pl: 'pol', ru: 'rus', sv: 'swe', da: 'dan', no: 'nob', fi: 'fin', tr: 'tur'
};

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (flag, def) => {
    const i = a.indexOf(flag);
    return i >= 0 && a[i + 1] ? a[i + 1] : def;
  };
  return {
    native: get('--native', 'en'),
    target: get('--target', 'de'),
    count: parseInt(get('--count', '100'), 10),
    sampleLines: parseInt(get('--sampleLines', '20000'), 10)
  };
}

const DATA_DIR = path.join(__dirname, 'data');
const FIX_DIR = path.join(__dirname, 'fixtures');

/** Download (cached) a capped slice of a Tatoeba per-language sentence dump. */
function loadSentences(iso1, sampleLines) {
  const iso3 = ISO1_TO_ISO3[iso1];
  if (!iso3) throw new Error(`Unsupported language for Tatoeba fetch: ${iso1}`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const cache = path.join(DATA_DIR, `${iso3}_sample.tsv`);
  if (!fs.existsSync(cache) || fs.statSync(cache).size === 0) {
    const url = `https://downloads.tatoeba.org/exports/per_language/${iso3}/${iso3}_sentences.tsv.bz2`;
    console.log(`⬇️  Fetching ${iso1} (${iso3}) sample from Tatoeba (first ${sampleLines} lines)…`);
    // Stream → decompress → cap. `head` closing the pipe stops the download
    // early (SIGPIPE), so we never pull the full multi-hundred-MB dump.
    execSync(`curl -sL "${url}" | bunzip2 2>/dev/null | head -n ${sampleLines} > "${cache}"`, {
      shell: '/bin/bash',
      stdio: 'inherit'
    });
  }
  const lines = fs.readFileSync(cache, 'utf8').split('\n').filter(Boolean);
  return lines.map(l => l.split('\t')[2]).filter(Boolean);
}

/** Keep short, clean, conversational sentences that resemble spoken utterances. */
function pickUtterances(sentences, n) {
  const seen = new Set();
  const out = [];
  for (const s of sentences) {
    const t = s.trim();
    const words = t.split(/\s+/);
    if (words.length < 2 || words.length > 8) continue;
    if (/\d/.test(t)) continue;                 // drop dates/numbers (less utterance-like)
    if (/[«»"“”()\[\]<>@#_/\\]/.test(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

/** Split into whitespace tokens, preserving original text (design rule: never
 *  rewrite tokens). Punctuation stays attached; gold labels are by source. */
function tokenize(text, gold, startId) {
  return text.split(/\s+/).filter(Boolean).map((w, i) => ({
    id: startId + i,
    text: w,
    gold
  }));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Hand-authored precision-critical cases (mirror the product's real examples).
 *  These are the ones false-credit hurts most: homographs, one-word answers,
 *  shared discourse markers, mixed sentences. */
function hardCases(native, target) {
  if (native === 'en' && target === 'de') {
    const C = [];
    const mk = (category, note, parts) => {
      // parts: [ [text, gold], ... ]  → one case with concatenated tokens
      let id = 0;
      const tokens = [];
      const texts = [];
      for (const [text, gold] of parts) {
        tokens.push(...tokenize(text, gold, id));
        id += text.split(/\s+/).filter(Boolean).length;
        texts.push(text);
      }
      C.push({ category, note, text: texts.join(' '), tokens });
    };
    mk('hard', 'clean target sentence', [['Mir geht es gut.', 'target']]);
    mk('hard', 'plain english franc-misreads as german', [["So that's, I don't know, I don't understand.", 'native']]);
    mk('hard', 'mixed: shared marker + target NP + english tail', [
      ['Okay.', 'shared'], ['Das Wasser. Die Toilette.', 'target'], ['So what is this?', 'native']
    ]);
    mk('hard', 'bare homograph — must NOT credit target', [['die', 'ambiguous']]);
    mk('hard', 'homograph inside target NP — credit target', [['die Toilette', 'target']]);
    mk('hard', 'one-word target answer', [['Gut.', 'target']]);
    mk('hard', 'english with homograph "name"', [['My name is Philip.', 'native']]);
    mk('hard', 'target greeting with proper noun', [['Hallo, mein Name ist Anna.', 'target']]);
    mk('hard', 'non-lexical fillers + target word', [['Uh,', 'non_lexical'], ['um,', 'non_lexical'], ['ja.', 'target']]);
    mk('hard', 'target question', [['Wie alt bist du?', 'target']]);
    mk('hard', 'shared "okay" alone', [['Okay.', 'shared']]);
    mk('hard', 'english filler + english', [['So,', 'native'], ["I think that's good.", 'native']]);
    return C;
  }
  return [];
}

function main() {
  const { native, target, count, sampleLines } = parseArgs();
  console.log(`\n🧪 Generating synthetic code-switch eval: native=${native} target=${target} count=${count}`);

  const nativeSents = pickUtterances(loadSentences(native, sampleLines), count * 3);
  const targetSents = pickUtterances(loadSentences(target, sampleLines), count * 3);
  console.log(`   Loaded utterances: native=${nativeSents.length} target=${targetSents.length}`);

  const cases = [];

  // Monolingual target / native (baseline: must label whole utterance correctly)
  const nMono = Math.floor(count * 0.3);
  for (let i = 0; i < nMono && i < targetSents.length; i++) {
    cases.push({ category: 'mono_target', text: targetSents[i], tokens: tokenize(targetSents[i], 'target', 0) });
  }
  for (let i = 0; i < nMono && i < nativeSents.length; i++) {
    cases.push({ category: 'mono_native', text: nativeSents[i], tokens: tokenize(nativeSents[i], 'native', 0) });
  }

  // Spliced code-switch (the hard, realistic case): native + target in one turn,
  // random order. Token labels come from each source → perfect ground truth.
  const nSplice = count - cases.length - hardCases(native, target).length;
  for (let i = 0; i < nSplice; i++) {
    const tIdx = (i + nMono) % targetSents.length;
    const nIdx = (i + nMono) % nativeSents.length;
    const targetFrag = targetSents[tIdx];
    const nativeFrag = nativeSents[nIdx];
    const order = shuffle([
      { text: nativeFrag, gold: 'native' },
      { text: targetFrag, gold: 'target' }
    ]);
    let id = 0;
    const tokens = [];
    for (const part of order) {
      tokens.push(...tokenize(part.text, part.gold, id));
      id += part.text.split(/\s+/).filter(Boolean).length;
    }
    cases.push({ category: 'splice', text: order.map(o => o.text).join(' '), tokens });
  }

  // Precision-critical hand-authored cases
  cases.push(...hardCases(native, target));

  // Assign global case ids
  cases.forEach((c, i) => { c.id = i; });

  const out = {
    pair: `${native}-${target}`,
    native,
    target,
    generatedAt: new Date().toISOString(),
    note: 'Synthetic (Tatoeba splice). Overestimates real accuracy: no ASR errors/disfluencies. Use for gross-error detection + relative classifier comparison.',
    counts: cases.reduce((m, c) => { m[c.category] = (m[c.category] || 0) + 1; return m; }, {}),
    cases
  };

  fs.mkdirSync(FIX_DIR, { recursive: true });
  const outPath = path.join(FIX_DIR, `synth-${native}-${target}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ Wrote ${cases.length} cases → ${path.relative(process.cwd(), outPath)}`);
  console.log(`   Breakdown: ${JSON.stringify(out.counts)}`);
}

main();
