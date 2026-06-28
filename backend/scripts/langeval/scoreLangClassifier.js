#!/usr/bin/env node
/**
 * Precision scorer for language classifiers.
 *
 * The metric that matters is TARGET-CREDIT PRECISION — of all the words a
 * classifier credits as target language, how many were genuinely target. False
 * target credit is what fabricates a CEFR level, so we optimize precision even
 * at the cost of recall.
 *
 *   targetCreditPrecision = (gold==target & pred==target) / (pred==target)
 *   targetRecall          = (gold==target & pred==target) / (gold==target)
 *
 * non_lexical tokens are excluded from all counts.
 *
 * Usage:
 *   node scripts/langeval/scoreLangClassifier.js                       # synth en-de
 *   node scripts/langeval/scoreLangClassifier.js --fixture fixtures/synth-en-de.json
 *   node scripts/langeval/scoreLangClassifier.js --fixture fixtures/lesson-XXXX.labeled.json
 *   node scripts/langeval/scoreLangClassifier.js --examples            # show false-credit examples
 */

const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '../../node_modules/dotenv')).config({ path: path.join(__dirname, '../../config.env') });
const { classifiers } = require('./classifiers');

function arg(flag, def) {
  const a = process.argv.slice(2);
  const i = a.indexOf(flag);
  return i >= 0 && a[i + 1] && !a[i + 1].startsWith('--') ? a[i + 1] : def;
}
const hasFlag = (flag) => process.argv.slice(2).includes(flag);

function loadFixture(p) {
  const abs = path.isAbsolute(p) ? p : path.join(__dirname, p);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function pct(n, d) { return d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`; }

async function scoreClassifier(fix, name, fn, showExamples) {
  const ctx = { native: fix.native, target: fix.target };
  let creditedTotal = 0;        // pred == target (lexical)
  let creditedGenuine = 0;      // pred == target & gold == target
  let goldTarget = 0;           // gold == target (lexical)
  const falseCreditByGold = {}; // gold label -> count, among pred==target
  const examples = [];

  const byCat = {}; // category -> { creditedTotal, creditedGenuine, goldTarget }

  for (const c of fix.cases) {
    if (c.excludeFromEval) continue;
    const preds = await fn(c, ctx);
    const cat = c.category || 'uncat';
    byCat[cat] = byCat[cat] || { creditedTotal: 0, creditedGenuine: 0, goldTarget: 0 };
    for (const tok of c.tokens) {
      if (tok.gold === 'non_lexical') continue;
      const pred = preds.get(tok.id) || 'ambiguous';
      if (tok.gold === 'target') { goldTarget++; byCat[cat].goldTarget++; }
      if (pred === 'target') {
        creditedTotal++; byCat[cat].creditedTotal++;
        if (tok.gold === 'target') { creditedGenuine++; byCat[cat].creditedGenuine++; }
        else {
          falseCreditByGold[tok.gold] = (falseCreditByGold[tok.gold] || 0) + 1;
          if (showExamples && examples.length < 25) {
            examples.push({ caseId: c.id, gold: tok.gold, token: tok.text, text: c.text });
          }
        }
      }
    }
  }

  console.log(`\n── ${name} ───────────────────────────────`);
  console.log(`   target-credit PRECISION : ${pct(creditedGenuine, creditedTotal)}  (${creditedGenuine}/${creditedTotal} credited words genuine)`);
  console.log(`   target recall           : ${pct(creditedGenuine, goldTarget)}  (${creditedGenuine}/${goldTarget} genuine words caught)`);
  const falseTotal = creditedTotal - creditedGenuine;
  if (falseTotal > 0) {
    console.log(`   FALSE credit (${falseTotal} words) by true label: ${JSON.stringify(falseCreditByGold)}`);
  } else {
    console.log(`   FALSE credit            : 0 ✅`);
  }
  console.log(`   by category (precision): ` + Object.entries(byCat)
    .map(([k, v]) => `${k}=${pct(v.creditedGenuine, v.creditedTotal)}`).join('  '));

  if (showExamples && examples.length) {
    console.log(`   false-credit examples:`);
    for (const e of examples) {
      console.log(`     [${e.gold}] "${e.token}"  ⟵  "${e.text}"`);
    }
  }
  return { precision: creditedTotal ? creditedGenuine / creditedTotal : 1, falseTotal };
}

async function main() {
  const fixturePath = arg('--fixture', 'fixtures/synth-en-de.json');
  const showExamples = hasFlag('--examples');
  const useLLM = hasFlag('--llm');
  let fix;
  try {
    fix = loadFixture(fixturePath);
  } catch (e) {
    console.error(`❌ Could not load fixture "${fixturePath}". Generate one first:\n   node scripts/langeval/genCodeSwitchEval.js --native en --target de`);
    process.exit(1);
  }

  console.log(`\n📊 Scoring fixture: ${fix.pair}  (${fix.cases.length} cases)`);
  if (fix.note) console.log(`   ${fix.note}`);

  // The LLM classifier costs an API call per case (cached after first run), so
  // it's opt-in via --llm.
  const toRun = { ...classifiers };
  if (useLLM) {
    const { classifyLLM } = require('./llmClassifier');
    toRun['llm-token (gpt-4o-mini)'] = classifyLLM;
    console.log('   (LLM classifier enabled — first run hits the API, then cached)');
  }

  const results = [];
  for (const [name, fn] of Object.entries(toRun)) {
    results.push({ name, ...(await scoreClassifier(fix, name, fn, showExamples)) });
  }

  console.log(`\n══ SUMMARY (target-credit precision — higher is safer) ══`);
  results
    .sort((a, b) => b.precision - a.precision)
    .forEach(r => console.log(`   ${(r.precision * 100).toFixed(1).padStart(5)}%   ${r.name}   (${r.falseTotal} false-credited)`));
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
