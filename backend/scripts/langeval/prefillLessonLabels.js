#!/usr/bin/env node
/**
 * Pre-fill gold labels on a lesson fixture (draft — NOT ground truth until
 * human review). Preserves labels already set. Flags cases that need human eyes.
 *
 * Usage:
 *   node scripts/langeval/prefillLessonLabels.js fixtures/lesson-6a404088....labeled.json
 */

const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '../../node_modules/dotenv')).config({
  path: path.join(__dirname, '../../config.env')
});

const FIXTURE = process.argv[2]
  || 'fixtures/lesson-6a404088ee0e5c866b0a51d0.labeled.json';

const GERMAN_HINT = /\b(Wie|Ich|Das|Die|Der|Mir|Gut|bin|bist|du|alt|Wasser|Toilette|Haus|Restaurant|Wetze|Toilette|geht|es|gut)\b/i;
const HOMOGRAPH = /^(die|so|das|name|okay|ok|restaurant)$/i;
const DIGIT = /^\d/;
const FILLER = /^(um|uh|oh|hmm|yeah|anyway)\.?[,]?$/i;

function normTok(t) {
  return (t || '').toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
}

function heuristicFill(caseObj) {
  const labels = new Map();
  const hasGerman = GERMAN_HINT.test(caseObj.text);
  for (const tok of caseObj.tokens) {
    const bare = normTok(tok.text);
    if (!bare) {
      labels.set(tok.id, 'non_lexical');
    } else if (FILLER.test(tok.text.trim())) {
      labels.set(tok.id, 'non_lexical');
    } else if (/^okay\.?$/i.test(tok.text.trim())) {
      labels.set(tok.id, 'shared');
    } else if (DIGIT.test(tok.text)) {
      labels.set(tok.id, 'shared');
    } else if (hasGerman && /^(ich|bin|wie|alt|bist|du|das|wasser|toilette|haus|wetze)$/i.test(bare)) {
      labels.set(tok.id, 'target');
    } else if (hasGerman && /^die$/i.test(bare)) {
      // bare "die" in mixed context → ambiguous until human confirms NP
      labels.set(tok.id, caseObj.tokens.length <= 2 ? 'ambiguous' : 'target');
    } else if (hasGerman && /^restaurant$/i.test(bare)) {
      labels.set(tok.id, 'shared'); // cognate
    } else if (hasGerman && /^so$/i.test(bare)) {
      labels.set(tok.id, 'native'); // English "So what is..."
    } else if (hasGerman && /^(what|is|no)$/i.test(bare)) {
      labels.set(tok.id, 'native');
    } else {
      labels.set(tok.id, 'native');
    }
  }
  return labels;
}

function reviewReasons(caseObj, labels) {
  const reasons = [];
  const vals = [...labels.values()];
  const lexical = caseObj.tokens.filter(t => labels.get(t.id) !== 'non_lexical');
  const hasTarget = vals.includes('target');
  const hasNative = vals.includes('native');
  const hasAmb = vals.includes('ambiguous');
  const hasShared = vals.includes('shared');

  if (hasTarget && hasNative) reasons.push('mixed_target_and_native');
  if (hasAmb) reasons.push('contains_ambiguous_token');
  if (caseObj.tokens.some(t => DIGIT.test(t.text))) reasons.push('contains_digit');
  if (lexical.length <= 3 && hasTarget) reasons.push('short_utterance_with_target');
  if (caseObj.tokens.some(t => HOMOGRAPH.test(normTok(t.text)))) reasons.push('homograph_token');
  if (GERMAN_HINT.test(caseObj.text) && caseObj.detectedLanguage === 'en') {
    reasons.push('german_in_text_but_whisper_said_en');
  }
  // Likely ASR garbage — transcript doesn't parse as coherent English/German
  if (/struggles|recommending any of my/i.test(caseObj.text)) {
    reasons.push('likely_asr_hallucination');
  }
  if (/Wetze/i.test(caseObj.text)) {
    reasons.push('asr_mistranscription_wetze_vs_wetter');
  }
  if (caseObj.text.includes('name') && hasNative) {
    reasons.push('homograph_name');
  }
  // Cognate repeated — was second "Restaurant" German echo or English?
  if ((caseObj.text.match(/Restaurant/gi) || []).length > 1) {
    reasons.push('cognate_restaurant_repeated');
  }
  if (reasons.length === 0 && !hasTarget) {
    // Pure English — low priority; only flag if prefill source was heuristic
    return { needsReview: false, reasons: ['auto_native_ok'] };
  }
  return { needsReview: reasons.some(r => r !== 'auto_native_ok'), reasons };
}

async function main() {
  const abs = path.isAbsolute(FIXTURE) ? FIXTURE : path.join(__dirname, FIXTURE);
  const fix = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const { classifyLLM } = require('./llmClassifier');
  const ctx = { native: fix.native, target: fix.target };

  let llmCalls = 0;
  let heuristicCalls = 0;
  const reviewList = [];

  for (const c of fix.cases) {
    const todos = c.tokens.filter(t => t.gold === 'TODO' || !t.gold);
    if (todos.length === 0) {
      // Already labeled — still compute review from existing gold
      const existing = new Map(c.tokens.map(t => [t.id, t.gold]));
      const rev = reviewReasons(c, existing);
      if (rev.needsReview) reviewList.push({ id: c.id, text: c.text, reasons: rev.reasons, source: 'human_partial' });
      continue;
    }

    const needsLLM = GERMAN_HINT.test(c.text) || c.tokens.length <= 4;
    let labels;
    if (needsLLM) {
      labels = await classifyLLM(c, ctx);
      llmCalls++;
      c._prefillSource = 'llm';
    } else {
      labels = heuristicFill(c);
      heuristicCalls++;
      c._prefillSource = 'heuristic';
    }

    for (const tok of c.tokens) {
      if (tok.gold === 'TODO' || !tok.gold) {
        tok.gold = labels.get(tok.id) || 'ambiguous';
        tok._prefill = true;
      }
    }

    const rev = reviewReasons(c, new Map(c.tokens.map(t => [t.id, t.gold])));
    c.needsReview = rev.needsReview;
    c.reviewReasons = rev.reasons;
    if (rev.needsReview) {
      reviewList.push({ id: c.id, text: c.text, reasons: rev.reasons, source: c._prefillSource });
    }
  }

  fix.note = 'DRAFT labels — pre-filled for review. Cases with needsReview:true require human confirmation before use as ground truth.';
  fix.prefilledAt = new Date().toISOString();
  fix.reviewSummary = {
    totalCases: fix.cases.length,
    needsReview: reviewList.length,
    llmCalls,
    heuristicCalls
  };

  fs.writeFileSync(abs, JSON.stringify(fix, null, 2));

  const summaryPath = abs.replace('.labeled.json', '.REVIEW.md');
  const md = [
    `# Label review: lesson ${fix.lessonId}`,
    '',
    `Pre-filled ${fix.cases.length} cases (${llmCalls} via LLM, ${heuristicCalls} via heuristic).`,
    `**${reviewList.length} cases need your review** before this fixture is ground truth.`,
    '',
    '## How to review',
    'Open the `.labeled.json` file. For each case below, confirm or fix `gold` on each token.',
    'When done, remove `needsReview` / `_prefill` fields and run:',
    '```',
    `node scripts/langeval/scoreLangClassifier.js --fixture ${path.relative(path.join(__dirname, '..'), abs)} --llm`,
    '```',
    '',
    '## Cases needing review',
    ''
  ];
  for (const r of reviewList.sort((a, b) => a.id - b.id)) {
    md.push(`### Case ${r.id} (${r.source})`);
    md.push(`> ${r.text}`);
    md.push(`Reasons: ${r.reasons.join(', ')}`);
    md.push('');
  }
  if (reviewList.length === 0) md.push('_None — all cases auto-labeled as plain English._');
  fs.writeFileSync(summaryPath, md.join('\n'));

  console.log(`✅ Pre-filled → ${path.relative(process.cwd(), abs)}`);
  console.log(`   LLM: ${llmCalls}  heuristic: ${heuristicCalls}`);
  console.log(`   ${reviewList.length} cases need review → ${path.relative(process.cwd(), summaryPath)}`);
  console.log('\nReview these case IDs:');
  reviewList.forEach(r => console.log(`   [${r.id}] ${r.reasons[0]} — "${r.text.substring(0, 70)}${r.text.length > 70 ? '…' : ''}"`));
}

main().catch(e => { console.error(e); process.exit(1); });
