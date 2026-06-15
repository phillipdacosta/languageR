/**
 * Error Pattern Engine — turns a lesson's raw corrections into the
 * student-facing "what to work on next" output.
 *
 * Design goals (language-agnostic, by construction):
 *   1. GROUNDED   — every reported pattern/example traces back to text the
 *                   student actually said. We never invent counts or quotes.
 *   2. CLUSTERED  — related mistakes are merged by canonical skillId
 *                   (via skillTaxonomy), so "es→sea" and "vaya→va" both roll
 *                   up under the subjunctive skill instead of 5 lookalike rows.
 *   3. RANKED     — clusters are ordered by the principled, bounded
 *                   `struggleScorer` (taxonomy impact × recurrence × ASR risk),
 *                   not a raw "impact + occurrences" sum that lets a filler
 *                   word spammed 12× outrank a structural gap.
 *   4. HONEST     — transcription-risk is a *down-weight*, not a silent delete.
 *                   A 1–2 character morphological fix (es→sea, los→las) is the
 *                   grammatical contrast itself, so it is NOT treated as ASR
 *                   noise the way the old edit-distance heuristic did.
 *
 * This module is PURE: no I/O, no DB, no network. It only reads the
 * taxonomy/scorer (themselves pure, loaded at boot). That makes it cheap
 * to unit test across many languages.
 */

const taxonomy = require('./skillTaxonomy');
const scorer = require('./struggleScorer');

// Stage-1 correction `type`s that are inherently grammatical. For these,
// a tiny edit distance is the *signal* (a one-letter change can flip mood,
// gender, number, person, or tense), so we must NOT treat small edits as
// transcription noise on their own.
const GRAMMATICAL_TYPES = new Set([
  'grammar',
  'tense',
  'mood',
  'agreement',
  'preposition',
  'pronoun',
  'word_order'
]);

// How many worked examples to surface per pattern. Frequency may exceed
// this (we still report the true count); we just don't dump 12 quotes.
const MAX_EXAMPLES_PER_PATTERN = 5;

// A cluster is considered "likely transcription noise" only when the most
// confident piece of evidence in it is still risky. One clean instance is
// enough to believe the pattern is real.
const CLUSTER_ASR_RISK_THRESHOLD = 0.6;

// Generic, category-keyed practice text used only when the LLM did not
// supply a localized recommendation for a grounded cluster (rare — the LLM
// covers the common case in the student's native language). Localized for the
// major feedback languages; English is the guaranteed fallback for the rest
// (those can be filled via the existing translation pipeline).
const PRACTICE_I18N = Object.freeze({
  en: {
    grammar: 'Review this structure, then write or say 3–4 fresh sentences that use it correctly.',
    vocabulary: 'List the correct words/phrases and use each one in your own sentence.',
    pronunciation: 'Practice the sound on its own, then inside full sentences.',
    fluency: 'Record yourself speaking for 1–2 minutes and aim to reduce pauses and fillers.',
    pragmatics: 'Say the same idea in both a formal and an informal register.',
    discourse: 'Practice linking ideas with connectors to build longer, smoother turns.'
  },
  es: {
    grammar: 'Repasa esta estructura y luego escribe o di 3–4 frases nuevas usándola correctamente.',
    vocabulary: 'Haz una lista de las palabras/expresiones correctas y usa cada una en una frase.',
    pronunciation: 'Practica el sonido por separado y luego dentro de frases completas.',
    fluency: 'Grábate hablando 1–2 minutos e intenta reducir las pausas y muletillas.',
    pragmatics: 'Di la misma idea en registro formal e informal.',
    discourse: 'Practica enlazar ideas con conectores para hacer turnos más largos y fluidos.'
  },
  fr: {
    grammar: 'Révise cette structure, puis écris ou dis 3–4 nouvelles phrases en l’utilisant correctement.',
    vocabulary: 'Liste les mots/expressions corrects et emploie chacun dans une phrase.',
    pronunciation: 'Entraîne-toi sur le son seul, puis dans des phrases complètes.',
    fluency: 'Enregistre-toi pendant 1–2 minutes et réduis les pauses et les hésitations.',
    pragmatics: 'Dis la même idée à un registre formel puis informel.',
    discourse: 'Entraîne-toi à relier les idées avec des connecteurs pour des tours plus longs.'
  },
  de: {
    grammar: 'Wiederhole diese Struktur und bilde dann 3–4 neue korrekte Sätze.',
    vocabulary: 'Liste die richtigen Wörter/Wendungen auf und nutze jede in einem Satz.',
    pronunciation: 'Übe den Laut einzeln und dann in ganzen Sätzen.',
    fluency: 'Nimm dich 1–2 Minuten auf und reduziere Pausen und Füllwörter.',
    pragmatics: 'Sage dieselbe Idee einmal formell und einmal informell.',
    discourse: 'Übe, Ideen mit Konnektoren zu verbinden, für längere, flüssigere Redebeiträge.'
  },
  it: {
    grammar: 'Ripassa questa struttura, poi scrivi o dì 3–4 frasi nuove usandola correttamente.',
    vocabulary: 'Elenca le parole/espressioni corrette e usa ciascuna in una frase.',
    pronunciation: 'Esercitati sul suono da solo, poi in frasi complete.',
    fluency: 'Registrati mentre parli per 1–2 minuti e riduci pause e intercalari.',
    pragmatics: 'Di’ la stessa idea in registro formale e informale.',
    discourse: 'Allenati a collegare le idee con i connettivi per turni più lunghi e fluidi.'
  },
  pt: {
    grammar: 'Revise esta estrutura e depois escreva ou diga 3–4 frases novas usando-a corretamente.',
    vocabulary: 'Liste as palavras/expressões corretas e use cada uma numa frase.',
    pronunciation: 'Pratique o som isoladamente e depois em frases completas.',
    fluency: 'Grave-se a falar 1–2 minutos e tente reduzir pausas e bordões.',
    pragmatics: 'Diga a mesma ideia em registo formal e informal.',
    discourse: 'Pratique ligar ideias com conectores para turnos mais longos e fluidos.'
  }
});

function fallbackPractice(category, nativeLanguage) {
  const table = PRACTICE_I18N[nativeLanguage] || PRACTICE_I18N.en;
  return table[category] || table.grammar;
}

/** Count non-overlapping occurrences of a normalized phrase in normalized text. */
function countOccurrencesNorm(haystackNorm, needleNorm) {
  if (!haystackNorm || !needleNorm) return 0;
  const esc = needleNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = haystackNorm.match(new RegExp(esc, 'g'));
  return matches ? matches.length : 0;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function titleCase(s) {
  return String(s || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Normalize a quote for de-duplication: lowercase, strip accents and
 * punctuation, collapse whitespace. Language-agnostic.
 */
function normalizeQuote(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classify how likely a single correction is a speech-to-text artifact
 * rather than a real learner error. Returns a *risk score* in [0,1] plus
 * a boolean and the reasons (for observability).
 *
 * Crucially this is corroboration-based and category-aware:
 *   - Low ASR confidence on the span            → strong signal (+0.6)
 *   - The "corrected" form recurs in transcript  → strong signal (+0.5)
 *   - Phonetic lookalike AND non-grammatical type→ strong signal (+0.5)
 *   - Phonetic lookalike but grammatical type     → weak signal  (+0.2)
 *   - Tiny edit (≤2) but ONLY when non-grammatical→ weak signal  (+0.2)
 *
 * A clean grammatical fix (e.g. subjunctive es→sea) with normal confidence
 * scores ~0 and is therefore treated as a REAL error — the exact case the
 * previous edit-distance heuristic wrongly discarded.
 *
 * @param {Object} s
 * @param {string} s.type                     correction type
 * @param {number} [s.editDistance]           Levenshtein(original, corrected)
 * @param {boolean} [s.hasLowConfidenceWord]  span touches a low-confidence ASR segment
 * @param {boolean} [s.isPhoneticallySimilar] changed tokens sound alike
 * @param {boolean} [s.correctedAppearsOften] corrected form recurs in transcript
 */
function classifyTranscriptionRisk(s = {}) {
  const grammatical = GRAMMATICAL_TYPES.has(s.type);
  const reasons = [];
  let risk = 0;

  if (s.hasLowConfidenceWord) {
    risk += 0.6;
    reasons.push('low_asr_confidence');
  }
  if (s.correctedAppearsOften) {
    risk += 0.5;
    reasons.push('corrected_form_recurs');
  }
  if (s.isPhoneticallySimilar) {
    if (grammatical) {
      risk += 0.2;
      reasons.push('phonetic_but_grammatical');
    } else {
      risk += 0.5;
      reasons.push('phonetic_lexical');
    }
  }
  if (typeof s.editDistance === 'number' && s.editDistance <= 2 && !grammatical) {
    risk += 0.2;
    reasons.push('tiny_edit_non_grammatical');
  }

  risk = clamp01(risk);
  return { risk, isLikelyTranscriptionError: risk >= CLUSTER_ASR_RISK_THRESHOLD, reasons };
}

/**
 * Best free-text label to canonicalize a correction into a skill. We
 * prefer the human-readable reason (richer tokens → better taxonomy hit),
 * but always append the structural `type` so a bare reason still lands in
 * the right grammar/agreement/tense neighborhood.
 */
function labelForCorrection(c) {
  const parts = [];
  if (c.reason && typeof c.reason === 'string') parts.push(c.reason);
  if (c.type && typeof c.type === 'string') parts.push(c.type.replace(/_/g, ' '));
  return parts.join(' ').trim() || (c.type || 'grammar');
}

/**
 * Build a single evidence unit (one grounded mistake instance) in a shape
 * the clusterer understands.
 */
function makeUnit({ original, corrected, explanation, type, severity, transcriptionRisk, isLikelyTranscriptionError, source, label }) {
  return {
    original: String(original || '').trim(),
    corrected: String(corrected || '').trim(),
    explanation: String(explanation || '').trim(),
    type: type || null,
    severity: severity || 'error',
    transcriptionRisk: clamp01(typeof transcriptionRisk === 'number' ? transcriptionRisk : 0),
    isLikelyTranscriptionError: !!isLikelyTranscriptionError,
    source: source || 'correction',
    label: label || null
  };
}

/**
 * Derive display impact / severity / teaching priority for a cluster.
 * Decoupled from the (compressed) ranking score so labels stay intuitive:
 * recurrence and pedagogical weight drive the label, ranking drives order.
 */
function deriveLabels({ frequency, impactWeight, isLikelyTranscriptionError }) {
  let impact;
  if (frequency >= 3 || impactWeight >= 1.3) impact = 'high';
  else if (frequency >= 2 || impactWeight >= 1.0) impact = 'medium';
  else impact = 'low';

  let teachingPriority;
  if (frequency >= 3 && impactWeight >= 1.2) teachingPriority = 'critical';
  else if (frequency >= 2 || impactWeight >= 1.1) teachingPriority = 'important';
  else teachingPriority = 'optional';

  // ASR-suspect clusters survived ranking but should never shout.
  if (isLikelyTranscriptionError) {
    impact = impact === 'high' ? 'medium' : 'low';
    teachingPriority = 'optional';
  }

  return { impact, severity: impact, teachingPriority };
}

/**
 * Index LLM-provided patterns by canonical skillId so we can borrow their
 * (nicely localized) names + practice text for matching grounded clusters.
 */
function indexLlmText(llmErrorPatterns, language) {
  const bySkill = new Map();
  for (const p of llmErrorPatterns || []) {
    if (!p || typeof p.pattern !== 'string') continue;
    const { skillId } = taxonomy.canonicalize(p.pattern, language);
    if (!bySkill.has(skillId)) {
      bySkill.set(skillId, {
        pattern: p.pattern,
        practiceNeeded: typeof p.practiceNeeded === 'string' ? p.practiceNeeded : null,
        explanations: new Map() // normalizedOriginal -> explanation
      });
    }
    const entry = bySkill.get(skillId);
    for (const ex of p.examples || []) {
      if (ex && ex.original && ex.explanation) {
        entry.explanations.set(normalizeQuote(ex.original), ex.explanation);
      }
    }
  }
  return bySkill;
}

/**
 * Main entry point. Produces grounded, clustered, ranked errorPatterns +
 * topErrors plus a verified error count, all consistent with each other.
 *
 * @param {Object} params
 * @param {Array}  params.corrections        Stage-1 verified corrections (grounded).
 *        Each: { original, corrected, type, reason, severity,
 *                transcriptionRisk?, isLikelyTranscriptionError? }
 * @param {Array}  [params.llmErrorPatterns] Stage-2 errorPatterns (text + extra recall).
 * @param {Array}  [params.llmTopErrors]     Stage-2 topErrors (extra recall).
 * @param {string} [params.transcriptLower]  lowercased student transcript (possibly sampled), for grounding LLM quotes.
 * @param {string} [params.fullTranscriptLower] lowercased FULL student transcript, for true recurrence counts on long lessons (no extra AI cost). Falls back to transcriptLower.
 * @param {Array}  [params.extraSignals]    non-correction struggles to rank alongside errors (e.g. complexity). Each: { skillId, frequency?, impact?, examples?, practiceNeeded? }.
 * @param {string} params.language           target language code.
 * @param {string} [params.nativeLanguage]   student's native language, for display labels.
 * @param {number} [params.durationMinutes]  lesson length (caps how many patterns we surface).
 * @param {string} [params.goalType]         student's learning goal (goal-alignment in ranking).
 * @returns {{ errorPatterns: Array, topErrors: Array, verifiedErrorCount: number, clusters: Array }}
 */
function buildErrorPatterns({
  corrections = [],
  llmErrorPatterns = [],
  llmTopErrors = [],
  transcriptLower = '',
  fullTranscriptLower = '',
  extraSignals = [],
  language,
  nativeLanguage = 'en',
  durationMinutes = 25,
  goalType = null
} = {}) {
  const units = [];
  // Normalized full transcript used to count true recurrence. Using the FULL
  // transcript (not the sampled slice sent to the LLM) fixes undercounting on
  // long lessons, and it's pure string matching — zero added analysis cost.
  const recurrenceHaystack = normalizeQuote(fullTranscriptLower || transcriptLower || '');

  // ── Source A: Stage-1 verified corrections (already grounded) ──────
  for (const c of corrections) {
    if (!c || !c.original || !c.corrected) continue;
    units.push(makeUnit({
      original: c.original,
      corrected: c.corrected,
      explanation: c.reason,
      type: c.type,
      severity: c.severity || 'error',
      transcriptionRisk: c.transcriptionRisk,
      isLikelyTranscriptionError: c.isLikelyTranscriptionError,
      source: 'correction',
      label: labelForCorrection(c)
    }));
  }

  // ── Source B: LLM examples, but ONLY if grounded in the transcript ──
  // This recovers real errors Stage-1 may have missed (e.g. a subtle
  // subjunctive) without trusting ungrounded fabrications.
  const groundedFromLlm = (examplesOwner, label, fallbackType) => {
    for (const ex of examplesOwner || []) {
      if (!ex || !ex.original || !ex.corrected) continue;
      const norm = normalizeQuote(ex.original);
      if (!norm) continue;
      // Require the quote to actually appear in what the student said (check
      // the FULL transcript so we don't reject real errors outside the sample).
      if (recurrenceHaystack && !recurrenceHaystack.includes(norm)) continue;
      units.push(makeUnit({
        original: ex.original,
        corrected: ex.corrected,
        explanation: ex.explanation,
        type: fallbackType,
        severity: 'error',
        transcriptionRisk: ex.isLikelyTranscriptionError ? 0.6 : 0.15,
        isLikelyTranscriptionError: !!ex.isLikelyTranscriptionError,
        source: 'llm',
        label
      }));
    }
  };
  for (const p of llmErrorPatterns || []) {
    if (p && Array.isArray(p.examples)) groundedFromLlm(p.examples, p.pattern || 'grammar', 'grammar');
  }
  for (const e of llmTopErrors || []) {
    if (e && Array.isArray(e.examples)) groundedFromLlm(e.examples, e.issue || 'grammar', 'grammar');
  }

  // ── Cluster by canonical skillId ───────────────────────────────────
  const clusters = new Map(); // skillId -> cluster
  for (const u of units) {
    const { skillId } = taxonomy.canonicalize(u.label, language);
    if (!clusters.has(skillId)) {
      clusters.set(skillId, {
        skillId,
        units: [],
        examplesByNormOriginal: new Map()
      });
    }
    const cl = clusters.get(skillId);
    cl.units.push(u);
    // De-dupe examples by normalized original; prefer a clean (low-risk)
    // instance's explanation, and keep the first occurrence otherwise.
    const key = normalizeQuote(u.original);
    const existing = cl.examplesByNormOriginal.get(key);
    if (!existing || (existing.transcriptionRisk > u.transcriptionRisk)) {
      cl.examplesByNormOriginal.set(key, u);
    }
  }

  const llmTextBySkill = indexLlmText(llmErrorPatterns, language);

  // ── Score + shape each cluster ─────────────────────────────────────
  const shaped = [];
  for (const cl of clusters.values()) {
    const skill = taxonomy.getSkill(cl.skillId);
    const impactWeight = skill?.impactWeight ?? 0.8;
    const category = skill?.category || 'grammar';

    const distinctExamples = Array.from(cl.examplesByNormOriginal.values());
    if (distinctExamples.length === 0) continue;

    // Frequency = true recurrence across the FULL transcript. Each distinct
    // error phrase contributes how many times it actually recurs (clamped, and
    // only counted >1 when the phrase is long enough to count safely), so a
    // pattern repeated across a long lesson ranks above a one-off — without any
    // extra AI cost (pure string matching).
    let frequency = 0;
    for (const ex of distinctExamples) {
      const norm = normalizeQuote(ex.original);
      const tokenCount = norm ? norm.split(' ').length : 0;
      const safeToCount = recurrenceHaystack && (tokenCount >= 2 || norm.length >= 6);
      const occ = safeToCount ? countOccurrencesNorm(recurrenceHaystack, norm) : 0;
      frequency += Math.min(10, Math.max(1, occ));
    }
    if (frequency < distinctExamples.length) frequency = distinctExamples.length;

    // Cluster ASR risk = the most confident (lowest-risk) instance. One
    // clean instance makes the whole pattern believable.
    const minRisk = Math.min(...cl.units.map(u => u.transcriptionRisk));
    const isLikelyTranscriptionError = minRisk >= CLUSTER_ASR_RISK_THRESHOLD;

    // Count of genuine, scorable error instances (not ASR-suspect).
    const realErrorInstances = cl.units.filter(
      u => u.severity === 'error' && u.transcriptionRisk < CLUSTER_ASR_RISK_THRESHOLD
    ).length;

    // Rank with the shared, bounded scorer. lessonsAgo=0 (this lesson),
    // belief=null (lesson-local view; the rolling aggregator folds in
    // mastery beliefs downstream).
    const declaredImpact = frequency >= 3 ? 'high' : frequency >= 2 ? 'medium' : 'low';
    const { score, factors } = scorer.scoreStruggle(
      {
        skillId: cl.skillId,
        occurrences: frequency,
        impact: declaredImpact,
        isLikelyTranscriptionError,
        lessonsAgo: 0
      },
      { language, goalType, belief: null }
    );

    const labels = deriveLabels({ frequency, impactWeight, isLikelyTranscriptionError });

    // Display name + practice text: borrow the LLM's localized text when it
    // canonicalizes to this same skill; otherwise fall back deterministically.
    const llmText = llmTextBySkill.get(cl.skillId);
    const displayName =
      (llmText && llmText.pattern) ||
      taxonomy.displayNameFor(cl.skillId, nativeLanguage) ||
      titleCase(cl.skillId.split('.').pop().replace(/_/g, ' '));

    const examples = distinctExamples
      .slice() // sort cleanest first so the best quote leads
      .sort((a, b) => a.transcriptionRisk - b.transcriptionRisk)
      .slice(0, MAX_EXAMPLES_PER_PATTERN)
      .map(u => ({
        original: u.original,
        corrected: u.corrected,
        explanation:
          u.explanation ||
          (llmText && llmText.explanations.get(normalizeQuote(u.original))) ||
          ''
      }));

    const practiceNeeded =
      (llmText && llmText.practiceNeeded) ||
      fallbackPractice(category, nativeLanguage);

    shaped.push({
      skillId: cl.skillId,
      displayName,
      category,
      frequency,
      realErrorInstances,
      isLikelyTranscriptionError,
      score,
      factors,
      labels,
      examples,
      practiceNeeded
    });
  }

  // Verified error count = grounded, scorable GRAMMAR instances across all
  // clusters (NOT just capped top-N, and BEFORE non-error extra signals are
  // merged), so scores/level reflect everything real and only real errors.
  const verifiedErrorCount = shaped.reduce((sum, c) => sum + c.realErrorInstances, 0);

  // ── Merge non-correction "extra signals" (e.g. sentence complexity) ──
  // These are ranked alongside grammar errors but never affect the verified
  // error count (they are opportunities, not mistakes).
  for (const sig of extraSignals || []) {
    if (!sig || !sig.skillId) continue;
    if (shaped.some(c => c.skillId === sig.skillId)) continue; // already covered by a grammar cluster
    const skill = taxonomy.getSkill(sig.skillId);
    const impactWeight = skill?.impactWeight ?? 0.8;
    const category = skill?.category || 'discourse';
    const frequency = Math.max(1, Number(sig.frequency) || 1);
    const { score, factors } = scorer.scoreStruggle(
      { skillId: sig.skillId, occurrences: frequency, impact: sig.impact || 'medium', isLikelyTranscriptionError: false, lessonsAgo: 0 },
      { language, goalType, belief: null }
    );
    const labels = deriveLabels({ frequency, impactWeight, isLikelyTranscriptionError: false });
    const displayName =
      taxonomy.displayNameFor(sig.skillId, nativeLanguage) ||
      titleCase(sig.skillId.split('.').pop().replace(/_/g, ' '));
    const examples = (sig.examples || []).slice(0, MAX_EXAMPLES_PER_PATTERN).map(e => ({
      original: e.original || '',
      corrected: e.corrected || '',
      explanation: e.explanation || ''
    }));
    shaped.push({
      skillId: sig.skillId,
      displayName,
      category,
      frequency,
      realErrorInstances: 0,
      isLikelyTranscriptionError: false,
      score,
      factors,
      labels,
      examples,
      practiceNeeded: sig.practiceNeeded || fallbackPractice(category, nativeLanguage)
    });
  }

  // ── Rank + cap ─────────────────────────────────────────────────────
  shaped.sort((a, b) => b.score - a.score);
  const maxErrors = durationMinutes <= 25 ? 8 : 12;
  const top = shaped.slice(0, maxErrors);

  const errorPatterns = top.map(c => ({
    pattern: c.displayName,
    skillId: c.skillId,
    frequency: c.frequency,
    severity: c.labels.severity,
    isLikelyTranscriptionError: c.isLikelyTranscriptionError,
    examples: c.examples,
    practiceNeeded: c.practiceNeeded
  }));

  const topErrors = top.map((c, i) => ({
    rank: i + 1,
    issue: c.displayName,
    skillId: c.skillId,
    impact: c.labels.impact,
    occurrences: c.frequency,
    teachingPriority: c.labels.teachingPriority,
    isLikelyTranscriptionError: c.isLikelyTranscriptionError,
    examples: c.examples
  }));

  return { errorPatterns, topErrors, verifiedErrorCount, clusters: shaped };
}

module.exports = {
  buildErrorPatterns,
  classifyTranscriptionRisk,
  // Exposed for tests / introspection
  _internal: {
    normalizeQuote,
    labelForCorrection,
    deriveLabels,
    GRAMMATICAL_TYPES,
    CLUSTER_ASR_RISK_THRESHOLD
  }
};
