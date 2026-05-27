/**
 * Multi-signal fusion — pronunciation (Azure) + fluency (GPT) → skill evidence.
 *
 * Converts structured LessonAnalysis fields that are NOT free-text errors
 * into the same per-skill evidence shape used by struggleAggregator and
 * bayesianMastery. Keeps transcription/GPT errors as the primary signal;
 * these channels add weight when objective metrics agree.
 *
 * Pure functions — no DB.
 */

const taxonomy = require('./skillTaxonomy');

// ── Tunables ─────────────────────────────────────────────────────
const MISPRONUNCIATION_SCORE_THRESHOLD = 60; // Azure: below = needs work
const PRONUNCIATION_OVERALL_WEAK = 58;       // lesson-level overall score
const FLUENCY_OVERALL_WEAK = 55;
const FILLER_COUNT_MEDIUM = 4;
const FILLER_COUNT_HIGH = 10;
const MIN_PRONUNCIATION_SEGMENTS = 2;        // ignore noisy single-segment samples

/** Per-language pronunciation skill routing from phoneme/error hints. */
const PRONUNCIATION_ROUTES = Object.freeze({
  es: {
    rolled_r: 'es.pronunciation.rolled_r',
    stress: 'es.pronunciation.stress',
    vowel: 'es.pronunciation.vowel_clarity',
    default: 'es.pronunciation.vowel_clarity'
  },
  en: {
    th: 'en.pronunciation.th_sounds',
    stress: 'en.pronunciation.word_stress',
    vowel: 'en.pronunciation.vowel_clarity',
    default: 'en.pronunciation.word_stress'
  }
});

const FLUENCY_SKILLS = Object.freeze({
  filler: 'universal.fluency.filler_words',
  hesitation: 'universal.fluency.hesitation',
  speakingSpeed: 'universal.fluency.speaking_speed'
});

function langPrefix(language) {
  return (language || '').toLowerCase().split(/[-_]/)[0] || '';
}

function normalizeLabel(s) {
  return (s || '').toString().toLowerCase().trim();
}

function scoreToImpact(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'medium';
  if (score < 40) return 'high';
  if (score < 55) return 'medium';
  return 'low';
}

/**
 * Map one mispronunciation row to a taxonomy skillId.
 */
function skillForMispronunciation(entry, language) {
  const prefix = langPrefix(language);
  const routes = PRONUNCIATION_ROUTES[prefix];
  const word = (entry.word || '').toLowerCase();
  const blob = [
    entry.errorType,
    ...(entry.problematicPhonemes || []),
    word
  ].filter(Boolean).join(' ').toLowerCase();

  if (routes) {
    if (prefix === 'es') {
      if (/rr|trill|vibrant|erre|multiple.?r|tap/.test(blob) || /\brr/.test(word)) {
        return routes.rolled_r;
      }
      if (/stress|accent|tonic|syllable|acento/.test(blob)) return routes.stress;
      if (/vowel|voc|vocal/.test(blob)) return routes.vowel;
      // Spanish "r" between vowels is often rolled-r territory
      if (word.length <= 4 && /r/.test(word) && !/rr/.test(word)) return routes.rolled_r;
      return routes.default;
    }
    if (prefix === 'en') {
      if (/th|theta|eth|ð|θ|dental/.test(blob) || /^th/.test(word)) return routes.th;
      if (/stress|syllable|intonation/.test(blob)) return routes.stress;
      if (/vowel/.test(blob)) return routes.vowel;
      return routes.default;
    }
  }

  // Unknown language: try canonicalizing errorType, else skip (no guess).
  if (entry.errorType) {
    return taxonomy.canonicalize(entry.errorType, language).skillId;
  }
  return null;
}

/**
 * Build evidence entries from pronunciationAnalysis + fluencyAnalysis.
 * Returns Map<skillId, evidenceObject> compatible with struggleAggregator.fold().
 */
function extractPronunciationFluencyEvidence(analysis, language) {
  const out = new Map();
  if (!analysis) return out;

  const add = (skillId, ev) => {
    if (!skillId || skillId.includes('.unknown.')) return;
    const existing = out.get(skillId);
    if (!existing) {
      out.set(skillId, { ...ev, skillId });
      return;
    }
    existing.occurrences += ev.occurrences || 0;
    const rank = { low: 1, medium: 2, high: 3 };
    if (rank[ev.impact] > rank[existing.impact]) existing.impact = ev.impact;
    if (ev.examples?.length) {
      existing.examples = existing.examples || [];
      for (const ex of ev.examples) {
        if (existing.examples.length >= 3) break;
        if (!existing.examples.find(e => e.original === ex.original)) {
          existing.examples.push(ex);
        }
      }
    }
  };

  // ── Pronunciation: per-word mispronunciations ───────────────────
  const pron = analysis.pronunciationAnalysis;
  if (pron && Array.isArray(pron.mispronunciations)) {
    const bySkill = new Map();
    for (const m of pron.mispronunciations) {
      if (!m || typeof m.score !== 'number') continue;
      if (m.score >= MISPRONUNCIATION_SCORE_THRESHOLD) continue;
      const skillId = skillForMispronunciation(m, language);
      if (!skillId) continue;
      const bucket = bySkill.get(skillId) || { count: 0, worstScore: 100, words: [] };
      bucket.count += 1;
      bucket.worstScore = Math.min(bucket.worstScore, m.score);
      if (bucket.words.length < 3) bucket.words.push(m.word);
      bySkill.set(skillId, bucket);
    }
    for (const [skillId, bucket] of bySkill.entries()) {
      add(skillId, {
        occurrences: bucket.count,
        impact: scoreToImpact(bucket.worstScore),
        isLikelyTranscriptionError: false,
        examples: bucket.words.map(w => ({
          original: w,
          corrected: `(target pronunciation)`,
          explanation: 'Flagged by pronunciation assessment'
        })),
        sourceField: 'pronunciationAnalysis.mispronunciations',
        rawIssue: bucket.words.join(', ')
      });
    }

    // Lesson-level weak overall score (when we have enough segments).
    const segments = pron.segmentsAssessed || 0;
    if (segments >= MIN_PRONUNCIATION_SEGMENTS &&
        typeof pron.overallScore === 'number' &&
        pron.overallScore < PRONUNCIATION_OVERALL_WEAK) {
      const prefix = langPrefix(language);
      const routes = PRONUNCIATION_ROUTES[prefix];
      const dominant = bySkill.size > 0
        ? [...bySkill.entries()].sort((a, b) => b[1].count - a[1].count)[0][0]
        : (routes ? routes.default : null);
      if (dominant) {
        add(dominant, {
          occurrences: 1,
          impact: scoreToImpact(pron.overallScore),
          isLikelyTranscriptionError: false,
          sourceField: 'pronunciationAnalysis.overallScore',
          rawIssue: `Overall pronunciation ${pron.overallScore}/100`
        });
      }
    }
  }

  // ── Fluency: GPT + numeric scores ───────────────────────────────
  const flu = analysis.fluencyAnalysis;
  if (flu) {
    const fillerCount = flu.fillerWords?.count;
    if (typeof fillerCount === 'number' && fillerCount >= FILLER_COUNT_MEDIUM) {
      add(FLUENCY_SKILLS.filler, {
        occurrences: Math.min(fillerCount, 15),
        impact: fillerCount >= FILLER_COUNT_HIGH ? 'medium' : 'low',
        isLikelyTranscriptionError: false,
        examples: (flu.fillerWords.examples || []).slice(0, 2).map(w => ({
          original: w,
          corrected: '(reduce fillers)',
          explanation: 'Frequent filler words in this lesson'
        })),
        sourceField: 'fluencyAnalysis.fillerWords',
        rawIssue: `${fillerCount} filler words`
      });
    }

    const pause = normalizeLabel(flu.pauseFrequency);
    if (pause.includes('frequent') || pause === 'high') {
      add(FLUENCY_SKILLS.hesitation, {
        occurrences: 2,
        impact: 'medium',
        isLikelyTranscriptionError: false,
        sourceField: 'fluencyAnalysis.pauseFrequency',
        rawIssue: flu.pauseFrequency
      });
    } else if (pause.includes('occasional')) {
      add(FLUENCY_SKILLS.hesitation, {
        occurrences: 1,
        impact: 'low',
        isLikelyTranscriptionError: false,
        sourceField: 'fluencyAnalysis.pauseFrequency',
        rawIssue: flu.pauseFrequency
      });
    }

    const speed = normalizeLabel(flu.speakingSpeed);
    if (speed.includes('slow') || speed.includes('too slow')) {
      add(FLUENCY_SKILLS.speakingSpeed, {
        occurrences: 1,
        impact: 'medium',
        isLikelyTranscriptionError: false,
        sourceField: 'fluencyAnalysis.speakingSpeed',
        rawIssue: flu.speakingSpeed
      });
    } else if (speed.includes('fast') || speed.includes('too fast')) {
      add(FLUENCY_SKILLS.speakingSpeed, {
        occurrences: 1,
        impact: 'low',
        isLikelyTranscriptionError: false,
        sourceField: 'fluencyAnalysis.speakingSpeed',
        rawIssue: flu.speakingSpeed
      });
    }

    if (typeof flu.overallFluencyScore === 'number' && flu.overallFluencyScore < FLUENCY_OVERALL_WEAK) {
      // Only add if we didn't already flag hesitation/filler from explicit fields.
      if (!out.has(FLUENCY_SKILLS.hesitation) && !out.has(FLUENCY_SKILLS.filler)) {
        add(FLUENCY_SKILLS.hesitation, {
          occurrences: 1,
          impact: scoreToImpact(flu.overallFluencyScore),
          isLikelyTranscriptionError: false,
          sourceField: 'fluencyAnalysis.overallFluencyScore',
          rawIssue: `Fluency score ${flu.overallFluencyScore}/100`
        });
      }
    }
  }

  return out;
}

/**
 * Positive fluency/pronunciation signals for Bayesian success updates.
 * Returns [{ skillId, successWeight }].
 */
function extractPositiveSignals(analysis, language) {
  const signals = [];
  if (!analysis) return signals;

  const flu = analysis.fluencyAnalysis;
  if (flu) {
    const fillerCount = flu.fillerWords?.count;
    const fluencyScore = flu.overallFluencyScore;
    if (typeof fillerCount === 'number' && fillerCount <= 2 &&
        (typeof fluencyScore !== 'number' || fluencyScore >= 65)) {
      signals.push({ skillId: FLUENCY_SKILLS.filler, successWeight: 0.8 });
    }
    const pause = normalizeLabel(flu.pauseFrequency);
    if ((pause.includes('rare') || pause.includes('occasional')) &&
        (typeof fluencyScore !== 'number' || fluencyScore >= 70)) {
      signals.push({ skillId: FLUENCY_SKILLS.hesitation, successWeight: 0.6 });
    }
    const speed = normalizeLabel(flu.speakingSpeed);
    if ((speed.includes('natural') || speed.includes('moderate')) &&
        (typeof fluencyScore !== 'number' || fluencyScore >= 70)) {
      signals.push({ skillId: FLUENCY_SKILLS.speakingSpeed, successWeight: 0.5 });
    }
  }

  const pron = analysis.pronunciationAnalysis;
  if (pron &&
      typeof pron.overallScore === 'number' &&
      pron.overallScore >= 78 &&
      (pron.segmentsAssessed || 0) >= MIN_PRONUNCIATION_SEGMENTS &&
      (!pron.mispronunciations || pron.mispronunciations.length === 0)) {
    const prefix = langPrefix(language);
    const routes = PRONUNCIATION_ROUTES[prefix];
    if (routes?.default) {
      signals.push({ skillId: routes.default, successWeight: 0.7 });
    }
  }

  return signals;
}

/**
 * Merge fusion evidence into an existing evidence Map (mutates target).
 */
function mergeIntoEvidenceMap(target, fusionMap) {
  if (!target || !fusionMap) return target;
  for (const [skillId, ev] of fusionMap.entries()) {
    const existing = target.get(skillId);
    if (!existing) {
      target.set(skillId, { ...ev });
      continue;
    }
    existing.occurrences += ev.occurrences || 0;
    const rank = { low: 1, medium: 2, high: 3 };
    if (rank[ev.impact] > rank[existing.impact]) existing.impact = ev.impact;
    if (ev.sourceField && !existing.sourceField?.includes(ev.sourceField)) {
      existing.sourceField = existing.sourceField
        ? `${existing.sourceField}+${ev.sourceField}`
        : ev.sourceField;
    }
    if (ev.examples?.length) {
      existing.examples = existing.examples || [];
      for (const ex of ev.examples) {
        if (existing.examples.length >= 3) break;
        if (!existing.examples.find(e => e.original === ex.original)) {
          existing.examples.push(ex);
        }
      }
    }
  }
  return target;
}

module.exports = {
  extractPronunciationFluencyEvidence,
  extractPositiveSignals,
  mergeIntoEvidenceMap,
  // Exposed for tests
  skillForMispronunciation,
  MISPRONUNCIATION_SCORE_THRESHOLD,
  FLUENCY_SKILLS
};
