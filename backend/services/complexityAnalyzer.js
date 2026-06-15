/**
 * Complexity analyzer — detects "overuse of simple structures when more
 * advanced language is expected".
 *
 * This is DETERMINISTIC and LANGUAGE-AGNOSTIC by design: it derives metrics
 * from the student's own segments (whitespace word counts, unique-token
 * ratio, utterance lengths) plus signals the lesson analysis ALREADY
 * produced (proficiency level, complexSentencesUsed). It makes NO extra
 * LLM/API calls, so it adds no analysis cost.
 *
 * It deliberately stays conservative — we never want to tell a fluent
 * speaker their language is "too simple". The signal only fires when the
 * student produced enough speech AND the structural evidence clearly points
 * to short, flat, low-subordination output.
 *
 * Output is shaped as an "extra signal" the errorPatternEngine can rank and
 * merge alongside grammar errors.
 */

// Minimum genuine speech before we'll judge complexity at all. Below this we
// simply don't have enough evidence (and short answers are fine early on).
const MIN_WORDS_TO_JUDGE = 60;

// A student already at C1/C2 is, by definition, not "overusing simple
// structures" in a way worth flagging — skip to avoid demoralizing nags.
const SKIP_LEVELS = new Set(['C1', 'C2']);

// Thresholds for the "simple structures" verdict. Tuned to be specific:
// all three must hold so we don't false-positive on naturally terse speech.
const MEAN_WORDS_PER_UTTERANCE_MAX = 8;   // mostly short utterances
const LONG_UTTERANCE_RATIO_MAX = 0.15;    // few utterances of 12+ words
const COMPLEX_SENTENCES_MAX = 1;          // analyst saw ~no complex sentences
const LONG_UTTERANCE_WORDS = 12;          // what counts as a "long" utterance

// Localized practice/recommendation text. The skill displayName is already
// localized via the taxonomy; this is the action sentence. English is the
// guaranteed fallback for languages not listed here (a known i18n follow-up).
const RECO_I18N = Object.freeze({
  en: 'Combine short sentences into longer ones using connectors (because, although, which, so that) and try a subordinate clause or two.',
  es: 'Une frases cortas en otras más largas con conectores (porque, aunque, que, para que) e intenta usar alguna oración subordinada.',
  fr: 'Reliez les phrases courtes avec des connecteurs (parce que, bien que, qui, pour que) et essayez quelques subordonnées.',
  de: 'Verbinde kurze Sätze mit Konnektoren (weil, obwohl, der/die/das, damit) und versuche ein paar Nebensätze.',
  it: 'Unisci le frasi brevi con connettivi (perché, anche se, che, affinché) e prova qualche frase subordinata.',
  pt: 'Junte frases curtas com conectores (porque, embora, que, para que) e tente usar orações subordinadas.'
});

function words(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Compute the raw complexity metrics from student segments. Always safe to
 * call — returns zeros for empty input. Exposed for tests/observability.
 */
function computeMetrics(studentSegments = []) {
  const utterances = (studentSegments || [])
    .map(s => words(s && s.text))
    .filter(w => w.length > 0);

  const totalWords = utterances.reduce((sum, w) => sum + w.length, 0);
  const utteranceCount = utterances.length;
  const meanWordsPerUtterance = utteranceCount ? totalWords / utteranceCount : 0;
  const longUtterances = utterances.filter(w => w.length >= LONG_UTTERANCE_WORDS).length;
  const longUtteranceRatio = utteranceCount ? longUtterances / utteranceCount : 0;

  const uniq = new Set();
  for (const w of utterances) {
    for (const tok of w) {
      uniq.add(tok.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
    }
  }
  uniq.delete('');
  const lexicalDiversity = totalWords ? uniq.size / totalWords : 0;

  return {
    totalWords,
    utteranceCount,
    meanWordsPerUtterance: Number(meanWordsPerUtterance.toFixed(2)),
    longUtteranceRatio: Number(longUtteranceRatio.toFixed(3)),
    lexicalDiversity: Number(lexicalDiversity.toFixed(3))
  };
}

/**
 * Pick a couple of short, representative utterances as grounded examples
 * (3..LONG_UTTERANCE_WORDS-1 words). These are real quotes from the student.
 */
function pickShortExamples(studentSegments = [], max = 2) {
  const candidates = (studentSegments || [])
    .map(s => (s && typeof s.text === 'string' ? s.text.trim() : ''))
    .filter(t => {
      const n = words(t).length;
      return n >= 3 && n < LONG_UTTERANCE_WORDS;
    });
  return candidates.slice(0, max).map(t => ({ original: t, corrected: '', explanation: '' }));
}

/**
 * Analyze complexity and, if warranted, return an "extra signal" for the
 * errorPatternEngine. Returns { metrics, signal } where `signal` is null
 * when no flag is warranted.
 *
 * @param {Object} params
 * @param {Array}  params.studentSegments
 * @param {string} [params.proficiencyLevel]  this lesson's CEFR level (A1..C2)
 * @param {number} [params.complexSentencesUsed] from progressionMetrics
 * @param {string} [params.nativeLanguage]    for the recommendation text
 */
function analyzeComplexity({
  studentSegments = [],
  proficiencyLevel = null,
  complexSentencesUsed = 0,
  nativeLanguage = 'en'
} = {}) {
  const metrics = computeMetrics(studentSegments);

  // Not enough evidence, or the speaker is already advanced → no flag.
  if (metrics.totalWords < MIN_WORDS_TO_JUDGE) {
    return { metrics, signal: null, reason: 'insufficient_speech' };
  }
  if (proficiencyLevel && SKIP_LEVELS.has(proficiencyLevel)) {
    return { metrics, signal: null, reason: 'advanced_speaker' };
  }

  const overuse =
    metrics.meanWordsPerUtterance < MEAN_WORDS_PER_UTTERANCE_MAX &&
    metrics.longUtteranceRatio < LONG_UTTERANCE_RATIO_MAX &&
    (Number(complexSentencesUsed) || 0) <= COMPLEX_SENTENCES_MAX;

  if (!overuse) {
    return { metrics, signal: null, reason: 'sufficient_complexity' };
  }

  const recommendation = RECO_I18N[nativeLanguage] || RECO_I18N.en;

  return {
    metrics,
    reason: 'simple_structure_overuse',
    recommendation,
    signal: {
      skillId: 'universal.discourse.sentence_complexity',
      // One lesson-level observation; recurrence across lessons is handled by
      // the rolling aggregator, not inflated here.
      frequency: 1,
      impact: 'medium',
      practiceNeeded: recommendation,
      examples: pickShortExamples(studentSegments, 2)
    }
  };
}

module.exports = {
  analyzeComplexity,
  computeMetrics,
  // tunables exposed for tests
  MIN_WORDS_TO_JUDGE,
  MEAN_WORDS_PER_UTTERANCE_MAX,
  LONG_UTTERANCE_RATIO_MAX
};
