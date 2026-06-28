/**
 * Phase-A primary classifier: token-level language identification via a
 * multilingual LLM. This is the design's recommended PRIMARY classifier for our
 * scale — franc/CLD3/document-level ID fail on short code-switched utterances,
 * and an LLM handles short, context-dependent, multilingual text without any
 * per-language dictionaries.
 *
 * Key constraints (mirrors the design spec):
 *  - References existing token IDs; never rewrites/translates token text.
 *  - Every lexical token gets exactly one label.
 *  - Labels, not self-reported probabilities. "ambiguous" is allowed/encouraged.
 *  - Conservative: false target credit is worse than undercounting.
 *
 * Results are cached on disk (keyed by native|target|text) so re-runs are free.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OpenAI = require(path.join(__dirname, '../../node_modules/openai'));

const LANG_NAME = {
  en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', ru: 'Russian', sv: 'Swedish'
};

const CACHE_PATH = path.join(__dirname, 'data', 'llmcache.json');
let _cache = null;
function loadCache() {
  if (_cache) return _cache;
  try { _cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); }
  catch (e) { _cache = {}; }
  return _cache;
}
function saveCache() {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(_cache, null, 0));
}

let _client = null;
function client() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

const SCHEMA = {
  name: 'token_language_classification',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tokenIds: { type: 'array', items: { type: 'integer' } },
            label: { type: 'string', enum: ['target', 'native', 'other', 'shared', 'ambiguous', 'non_lexical'] },
            reason: { type: 'string' }
          },
          required: ['tokenIds', 'label', 'reason']
        }
      }
    },
    required: ['classifications']
  }
};

const SYSTEM = `You are a precise token-level language identification system for a language-tutoring app. You label each token of a STUDENT's utterance as one of:
- "target": clearly produced in the target language
- "native": clearly produced in the student's native language
- "other": clearly another language
- "shared": discourse markers / words used across both languages or not meaningfully attributable to one (e.g. "okay", "hmm", proper nouns)
- "ambiguous": insufficient evidence, homograph, or valid in multiple languages (e.g. bare "die")
- "non_lexical": filler, hesitation, laughter, partial word, vocalization, transcription noise

Rules:
- Reference ONLY the provided token IDs. NEVER rewrite, translate, normalize, or invent tokens.
- Every lexical token must receive exactly one label. Group contiguous same-label tokens into one classification span.
- Be CONSERVATIVE: false "target" credit is worse than undercounting. When in doubt between target and native/shared, prefer "ambiguous".
- Use the tutor's preceding question only as context to disambiguate (e.g. a one-word answer to a target-language question). The tutor's words are NOT student production.
- Return labels only — no probabilities.`;

async function classifyLLM(caseObj, ctx) {
  const key = crypto.createHash('sha1')
    .update(`${ctx.native}|${ctx.target}|${caseObj.text}`)
    .digest('hex');
  const cache = loadCache();
  if (cache[key]) return new Map(cache[key]);

  const input = {
    nativeLanguage: LANG_NAME[ctx.native] || ctx.native,
    targetLanguage: LANG_NAME[ctx.target] || ctx.target,
    tutorContext: caseObj.tutorContext || null,
    tokens: caseObj.tokens.map(t => ({ id: t.id, text: t.text }))
  };

  let parsed;
  try {
    const resp = await client().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(input) }
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA }
    });
    parsed = JSON.parse(resp.choices[0].message.content);
  } catch (e) {
    // Fail-soft: unknown → ambiguous (no credit), never crash the eval.
    const m = new Map();
    caseObj.tokens.forEach(t => m.set(t.id, 'ambiguous'));
    return m;
  }

  const m = new Map();
  for (const span of (parsed.classifications || [])) {
    for (const id of (span.tokenIds || [])) m.set(id, span.label);
  }
  // Any token the model failed to label → ambiguous (conservative, no credit).
  caseObj.tokens.forEach(t => { if (!m.has(t.id)) m.set(t.id, 'ambiguous'); });

  cache[key] = [...m.entries()];
  saveCache();
  return m;
}

module.exports = { classifyLLM };
