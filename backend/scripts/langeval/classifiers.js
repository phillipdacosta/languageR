/**
 * Language classifiers under test, behind one interface so the scorer can
 * compare them apples-to-apples on the same fixtures.
 *
 * Interface:
 *   classify(caseObj, ctx) => Map<tokenId, label>
 *     caseObj.tokens: [{ id, text, gold }]
 *     ctx: { native, target }  (ISO-639-1)
 *     label ∈ target|native|other|shared|ambiguous|non_lexical
 *
 * Both current classifiers are UTTERANCE-LEVEL (one label for the whole turn),
 * which is exactly the limitation we want to expose on mixed/code-switched
 * cases — they physically cannot credit "Das Wasser" inside an English turn.
 */

const path = require('path');
const franc = require(path.join(__dirname, '../../node_modules/franc'));

const ISO1_TO_ISO3 = {
  en: 'eng', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', nl: 'nld',
  pl: 'pol', ru: 'rus', sv: 'swe', da: 'dan', no: 'nob', fi: 'fin', tr: 'tur'
};
const ISO3_TO_ISO1 = Object.fromEntries(Object.entries(ISO1_TO_ISO3).map(([a, b]) => [b, a]));

// Mirror of EN_COMMON_WORDS in backend/routes/transcription.js
const EN_COMMON_WORDS = new Set([
  'the','a','an','and','or','but','so','if','of','to','in','on','at','for','with',
  'i','you','he','she','it','we','they','me','him','her','us','them','my','your',
  'this','that','these','those','here','there','is','am','are','was','were','be',
  'been','do','dont','does','did','have','has','had','will','would','can','could',
  'should','not','no','yes','yeah','okay','ok','know','think','dont','im','its',
  'thats','what','when','where','why','how','who','just','really','very','well',
  'right','good','great','sorry','please','thank','thanks','about','because','want',
  'understand','mean','means','see','say','said','one','two','get','got','go',
  'going','let','back','up','out','oh','um','uh','hello','hi','like','dont','cant',
  'wont','didnt','isnt','arent','wasnt','ive','youre','were','okay','alright'
]);
const EN_VETO_FRACTION = 0.6;

function detect(text, whitelist3) {
  const cleaned = (text || '').trim();
  if (cleaned.length < 12) return null;
  try {
    const opts = whitelist3 && whitelist3.length ? { only: whitelist3 } : {};
    const code = franc(cleaned, opts);
    if (!code || code === 'und') return null;
    return ISO3_TO_ISO1[code] || null;
  } catch (e) {
    return null;
  }
}

function labelFromIso(iso, target) {
  if (!iso) return 'ambiguous';
  if (iso === target) return 'target';
  return iso === 'en' ? 'native' : 'other';
}

function assignAll(tokens, label) {
  const m = new Map();
  for (const t of tokens) m.set(t.id, label);
  return m;
}

/** Pure document-level franc, constrained to {target, native}. null → ambiguous.
 *  This is the "standard language ID" baseline the design says NOT to rely on. */
function francDoc(caseObj, ctx) {
  const wl = [...new Set([ISO1_TO_ISO3[ctx.target], ISO1_TO_ISO3[ctx.native]].filter(Boolean))];
  const iso = detect(caseObj.text, wl);
  return assignAll(caseObj.tokens, labelFromIso(iso, ctx.target));
}

/** Current production logic (text-only replica of resolveSegLang): franc +
 *  English-common-word veto + lenient default-to-target when no signal. */
function enVeto(caseObj, ctx) {
  const text = caseObj.text;
  const wl = [...new Set([ISO1_TO_ISO3[ctx.target], ISO1_TO_ISO3[ctx.native]].filter(Boolean))];
  const constrained = detect(text, wl);

  const vetoToks = text.toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const enHits = vetoToks.filter(t => EN_COMMON_WORDS.has(t)).length;
  const enDominated = ctx.target !== 'en'
    && vetoToks.length >= 3
    && (enHits / vetoToks.length) >= EN_VETO_FRACTION;

  let label;
  if (enDominated) {
    label = 'native';
  } else if (constrained && constrained !== ctx.target) {
    label = labelFromIso(constrained, ctx.target);
  } else if (constrained === ctx.target && detect(text, null) === ctx.target) {
    label = 'target';
  } else {
    // Production falls back to Whisper's per-chunk guess, then defaults to
    // target. No Whisper signal offline → mirror the lenient default-to-target.
    label = 'target';
  }
  return assignAll(caseObj.tokens, label);
}

module.exports = {
  classifiers: {
    'franc-doc': francDoc,
    'en-veto (prod)': enVeto
  },
  _internal: { detect, ISO1_TO_ISO3, EN_COMMON_WORDS }
};
