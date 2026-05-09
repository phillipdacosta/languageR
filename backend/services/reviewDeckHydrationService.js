/**
 * Review-deck hydration service.
 *
 * Centralized place to push corrections into a student's spaced-repetition
 * review deck. Used from two callers:
 *
 *   1. The post-lesson analysis pipeline (transcription.js → analyzeLesson):
 *      auto-adds AI-extracted corrected excerpts so the student doesn't
 *      have to manually save each one.
 *
 *   2. The tutor-note endpoint (routes/lessons.js): batch-inserts
 *      corrections that the tutor explicitly captured ("Student said X,
 *      should be Y") in the post-lesson modal.
 *
 * All inserts are idempotent — duplicates (same userId + original + corrected)
 * are silently skipped.
 */

const ReviewDeckItem = require('../models/ReviewDeckItem');

const VALID_ERROR_TYPES = new Set([
  'grammar', 'vocabulary', 'pronunciation', 'tense', 'preposition',
  'agreement', 'spelling', 'word_choice', 'other'
]);

function isUsable(original, corrected) {
  if (!original || !corrected) return false;
  const a = original.toString().trim();
  const b = corrected.toString().trim();
  if (a.length < 2 || b.length < 2) return false;
  if (a.toLowerCase() === b.toLowerCase()) return false;
  if (a.length > 600 || b.length > 600) return false; // sanity bound
  return true;
}

function normalizeErrorType(t) {
  if (!t) return 'other';
  const v = String(t).toLowerCase();
  return VALID_ERROR_TYPES.has(v) ? v : 'other';
}

/**
 * Add a batch of corrections to a user's review deck. Idempotent on
 * (userId, original, corrected). Returns { inserted, skipped }.
 *
 * @param {Object}   opts
 * @param {String|ObjectId} opts.userId       The student's User._id
 * @param {String}   opts.language            e.g. 'Spanish'
 * @param {Array}    opts.items               [{ original, corrected, explanation?, context?, errorType? }]
 * @param {String}   [opts.lessonId]
 * @param {String}   [opts.analysisId]
 * @param {String}   [opts.source='ai']       'ai' | 'tutor' | 'student'  (for logging only)
 * @param {Number}   [opts.maxPerCall=20]     Hard cap to keep one bad lesson from flooding the deck
 */
async function addCorrections(opts) {
  const {
    userId, language, items,
    lessonId = null, analysisId = null,
    source = 'ai', maxPerCall = 20
  } = opts;

  if (!userId || !language) return { inserted: 0, skipped: 0 };
  if (!Array.isArray(items) || items.length === 0) return { inserted: 0, skipped: 0 };

  // Filter & de-dup within the batch first.
  const seenInBatch = new Set();
  const cleaned = [];
  for (const raw of items) {
    if (cleaned.length >= maxPerCall) break;
    const original = (raw.original || '').toString().trim();
    const corrected = (raw.corrected || '').toString().trim();
    if (!isUsable(original, corrected)) continue;
    const key = `${original.toLowerCase()}→${corrected.toLowerCase()}`;
    if (seenInBatch.has(key)) continue;
    seenInBatch.add(key);
    cleaned.push({
      original, corrected,
      explanation: (raw.explanation || raw.keyCorrections?.join('; ') || '').toString().trim(),
      context: (raw.context || '').toString().trim(),
      errorType: normalizeErrorType(raw.errorType)
    });
  }

  if (cleaned.length === 0) return { inserted: 0, skipped: 0 };

  // De-dup against what's already in the user's deck.
  const existing = await ReviewDeckItem.find({
    userId,
    $or: cleaned.map(c => ({ original: c.original, corrected: c.corrected }))
  }).select('original corrected').lean();

  const existingKeys = new Set(existing.map(e => `${e.original.toLowerCase()}→${e.corrected.toLowerCase()}`));
  const toInsert = cleaned.filter(c => !existingKeys.has(`${c.original.toLowerCase()}→${c.corrected.toLowerCase()}`));

  if (toInsert.length === 0) {
    return { inserted: 0, skipped: cleaned.length };
  }

  const docs = toInsert.map(c => ({
    userId,
    language,
    original: c.original,
    corrected: c.corrected,
    explanation: c.explanation,
    context: c.context,
    errorType: c.errorType,
    lessonId,
    analysisId
  }));

  try {
    await ReviewDeckItem.insertMany(docs, { ordered: false });
    console.log(`📚 [ReviewDeck] +${docs.length} cards (source: ${source}, lesson: ${lessonId || 'n/a'})`);
    return { inserted: docs.length, skipped: cleaned.length - docs.length };
  } catch (err) {
    // ordered:false → insertMany continues past dup key errors.
    if (err && err.code === 11000) {
      const inserted = err.result?.nInserted || 0;
      return { inserted, skipped: cleaned.length - inserted };
    }
    throw err;
  }
}

/**
 * Convenience: hydrate a student's deck from a fresh LessonAnalysis.
 * Pulls the cleanest pairs from `correctedExcerpts[]` and writes them
 * with the analysis's lesson/analysis IDs attached.
 */
async function hydrateFromAnalysis({ analysis, userId, language }) {
  if (!analysis || !userId || !language) return { inserted: 0, skipped: 0 };

  const excerpts = Array.isArray(analysis.correctedExcerpts) ? analysis.correctedExcerpts : [];
  if (excerpts.length === 0) return { inserted: 0, skipped: 0 };

  const items = excerpts.map(e => ({
    original: e.original,
    corrected: e.corrected,
    context: e.context,
    explanation: Array.isArray(e.keyCorrections) ? e.keyCorrections.join('; ') : '',
    errorType: 'other' // We could infer from errorPatterns later.
  }));

  return addCorrections({
    userId,
    language,
    items,
    lessonId: analysis.lessonId,
    analysisId: analysis._id,
    source: 'ai'
  });
}

module.exports = {
  addCorrections,
  hydrateFromAnalysis
};
