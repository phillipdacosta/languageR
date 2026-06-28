/**
 * Production token-level language classifier (Phase A).
 *
 * WHY THIS EXISTS
 * Document-level detectors (franc/CLD3) and the current English-veto heuristic
 * cannot credit target-language words embedded in code-switched student speech
 * ("Okay. Das Wasser. So what is..."), and they mislabel plain English as the
 * target language. Validated on synthetic Tatoeba data AND a hand-labeled real
 * lesson, a multilingual LLM doing TOKEN-level labeling reached ~100% target-
 * credit precision vs ~54% for the heuristic. This service wraps that approach
 * for production.
 *
 * DESIGN
 *  - Labels existing token IDs; never rewrites/translates text.
 *  - Batches all student utterances into a few calls (token-budgeted) so a
 *    lesson costs ~1–3 cheap gpt-4o-mini calls total, not one-per-utterance.
 *  - Conservative: anything not confidently target → not credited.
 *  - FAIL-SOFT: any error returns null so the caller falls back to the existing
 *    heuristic. This must never break analysis.
 *
 * Returns, per student segment index, the set of token labels and a derived
 * confirmedTargetWords count (label === 'target').
 */

const OpenAI = require('openai');

const LANG_NAME = {
  en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', ru: 'Russian', sv: 'Swedish',
  da: 'Danish', no: 'Norwegian', fi: 'Finnish', tr: 'Turkish', ja: 'Japanese',
  zh: 'Chinese', ko: 'Korean', ar: 'Arabic'
};

const MODEL = process.env.LANG_CLASSIFIER_MODEL || 'gpt-4o-mini';
// Keep each batch small enough to stay well within context and return reliably.
const MAX_UTTERANCES_PER_BATCH = 40;

let _client = null;
function client() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

const BATCH_SCHEMA = {
  name: 'batch_token_language_classification',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      utterances: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            uid: { type: 'integer' },
            classifications: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  tokenIds: { type: 'array', items: { type: 'integer' } },
                  label: {
                    type: 'string',
                    enum: ['target', 'native', 'other', 'shared', 'ambiguous', 'non_lexical']
                  }
                },
                required: ['tokenIds', 'label']
              }
            }
          },
          required: ['uid', 'classifications']
        }
      }
    },
    required: ['utterances']
  }
};

function systemPrompt(nativeName, targetName) {
  return `You are a precise token-level language identification system for a language-tutoring app. For each STUDENT utterance you label every token as one of:
- "target": clearly produced in ${targetName} (the language being learned)
- "native": clearly produced in ${nativeName} (the student's native language)
- "other": clearly another language
- "shared": discourse markers / words used across both languages or not attributable to one (e.g. "okay", "hmm"), proper nouns, and bare digits
- "ambiguous": insufficient evidence, a homograph, or valid in multiple languages (e.g. bare "die")
- "non_lexical": filler, hesitation, laughter, partial word, vocalization, transcription noise (e.g. "um", "uh")

Rules:
- Reference ONLY the provided token IDs. NEVER rewrite, translate, normalize, or invent tokens.
- Every token must receive exactly one label. Group contiguous same-label tokens into one classification span.
- Be CONSERVATIVE: false "target" credit is worse than undercounting. When unsure between target and native/shared, choose "ambiguous".
- A speech-recognition typo of a ${targetName} word (e.g. a garbled but clearly ${targetName}-shaped word in ${targetName} context) is still "target".
- Use the tutor's preceding line (when provided) only as context to disambiguate short answers; the tutor's words are NOT student production.
- Return labels only — never probabilities.`;
}

function tokenizeWords(text) {
  return (text || '').split(/\s+/).filter(Boolean);
}

async function classifyBatch(batch, nativeName, targetName) {
  const input = batch.map(u => ({
    uid: u.uid,
    tutorContext: u.tutorContext || null,
    tokens: u.tokens.map(t => ({ id: t.id, text: t.text }))
  }));

  const resp = await client().chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt(nativeName, targetName) },
      { role: 'user', content: JSON.stringify({ utterances: input }) }
    ],
    response_format: { type: 'json_schema', json_schema: BATCH_SCHEMA }
  });

  return JSON.parse(resp.choices[0].message.content);
}

/**
 * Classify all student segments of a lesson at the token level.
 *
 * @param {Object} args
 * @param {Array}  args.studentSegments  segments [{ text, ... }] in order
 * @param {Array}  [args.allSegments]    full transcript (for tutor context lookup)
 * @param {string} args.targetIso        ISO-639-1 of the target language
 * @param {string} args.nativeIso        ISO-639-1 of the student's native language
 * @returns {Promise<null | {
 *   perSegment: Array<{ index, words, targetWords, labels: string[] }>,
 *   confirmedTargetWords: number,
 *   model: string
 * }>}  null on any failure (caller falls back to heuristic).
 */
async function classifyLessonSegments({ studentSegments, allSegments = null, targetIso, nativeIso }) {
  try {
    if (!Array.isArray(studentSegments) || studentSegments.length === 0) return null;
    const targetName = LANG_NAME[targetIso] || targetIso;
    const nativeName = LANG_NAME[nativeIso] || nativeIso || 'the native language';

    // Build per-utterance token lists with stable IDs + tutor context.
    const utterances = studentSegments.map((seg, idx) => {
      const tokens = tokenizeWords(seg.text).map((w, i) => ({ id: i, text: w }));
      let tutorContext = null;
      if (allSegments) {
        const segPos = allSegments.indexOf(seg);
        for (let j = segPos - 1; j >= 0 && j >= segPos - 4; j--) {
          if (allSegments[j] && allSegments[j].speaker === 'tutor' && allSegments[j].text) {
            tutorContext = allSegments[j].text;
            break;
          }
        }
      }
      return { uid: idx, tokens, tutorContext };
    });

    // Batch to keep each call bounded.
    const results = new Map(); // uid -> Map(tokenId -> label)
    for (let i = 0; i < utterances.length; i += MAX_UTTERANCES_PER_BATCH) {
      const batch = utterances.slice(i, i + MAX_UTTERANCES_PER_BATCH);
      const parsed = await classifyBatch(batch, nativeName, targetName);
      for (const u of (parsed.utterances || [])) {
        const m = new Map();
        for (const span of (u.classifications || [])) {
          for (const id of (span.tokenIds || [])) m.set(id, span.label);
        }
        results.set(u.uid, m);
      }
    }

    // Reduce to per-segment counts. Tokens the model omitted → ambiguous (no credit).
    let confirmedTargetWords = 0;
    const perSegment = utterances.map(u => {
      const labelMap = results.get(u.uid) || new Map();
      const labels = u.tokens.map(t => labelMap.get(t.id) || 'ambiguous');
      const targetWords = labels.filter(l => l === 'target').length;
      confirmedTargetWords += targetWords;
      return { index: u.uid, words: u.tokens.length, targetWords, labels };
    });

    return { perSegment, confirmedTargetWords, model: MODEL };
  } catch (err) {
    console.warn(`⚠️ languageClassifierService failed (fail-soft, falling back): ${err.message}`);
    return null;
  }
}

module.exports = { classifyLessonSegments };
