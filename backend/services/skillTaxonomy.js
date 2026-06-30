/**
 * Skill taxonomy + canonicalizer.
 *
 * Loads per-language skill definitions, validates them at startup, and
 * provides:
 *
 *   - getSkill(skillId)               — lookup a skill object
 *   - listSkillsForLanguage(lang)     — all skills for a language + universals
 *   - canonicalize(rawIssue, lang)    — free-text → skillId (deterministic)
 *   - displayNameFor(skillId, locale) — render label
 *
 * Canonicalization is deterministic-first:
 *   1. Exact alias match (case + punctuation normalized)
 *   2. Token-overlap match against aliases + displayName.en
 *   3. Fallback to `<lang>.unknown.<slug>` — preserves the raw label
 *      so we never lose data, and curates itself: we can periodically
 *      review the `unknown.*` IDs and promote frequent ones into the
 *      taxonomy.
 *
 * NOTE: this module never throws on unrecognized input — production
 * pipelines must keep flowing. Validation throws ONLY at startup if a
 * taxonomy file is malformed; that's a deploy-time problem, not runtime.
 */

const path = require('path');
const fs = require('fs');
const { validateSkillEntry, validateReferences } = require('./skills/taxonomyShape');

// ── Language code → taxonomy file ──────────────────────────────────
// Languages without a dedicated file fall through to UNIVERSAL only +
// `<lang>.unknown.*` bucketing. Add a new file under skills/data/ and
// register it here to enable a language.
const TAXONOMY_FILES = Object.freeze({
  en: './skills/data/en',
  es: './skills/data/es',
  de: './skills/data/de',
  fr: './skills/data/fr',
  it: './skills/data/it',
  pt: './skills/data/pt',
  ru: './skills/data/ru',
  zh: './skills/data/zh',
  ja: './skills/data/ja',
  ko: './skills/data/ko',
  ar: './skills/data/ar',
  hi: './skills/data/hi',
  nl: './skills/data/nl',
  pl: './skills/data/pl',
  tr: './skills/data/tr',
  sv: './skills/data/sv',
  no: './skills/data/no',
  da: './skills/data/da',
  fi: './skills/data/fi',
  el: './skills/data/el',
  cs: './skills/data/cs',
  ro: './skills/data/ro',
  uk: './skills/data/uk',
  vi: './skills/data/vi',
  th: './skills/data/th',
  id: './skills/data/id',
  ms: './skills/data/ms',
  he: './skills/data/he',
  fa: './skills/data/fa'
});

const UNIVERSAL_FILE = './skills/data/universal';

// ── Language label → taxonomy prefix ───────────────────────────────
// The app stores languages as full English names ("German", "Spanish"),
// but every skillId is namespaced by ISO code ("de.*", "es.*"). Without
// this mapping, canonicalize() would search a non-existent "<fullword>"
// prefix and EVERY struggle would fall through to `<lang>.unknown.*`,
// leaving the language taxonomies dormant. Map names → ISO; pass unknown
// labels through unchanged so they still bucket safely (no regression).
const LANG_PREFIX_ALIASES = Object.freeze({
  english: 'en', en: 'en', eng: 'en',
  spanish: 'es', es: 'es', espanol: 'es', castellano: 'es',
  german: 'de', de: 'de', deu: 'de', ger: 'de', deutsch: 'de',
  french: 'fr', fr: 'fr', francais: 'fr',
  italian: 'it', it: 'it', italiano: 'it',
  portuguese: 'pt', pt: 'pt', portugues: 'pt',
  russian: 'ru', ru: 'ru',
  chinese: 'zh', zh: 'zh', mandarin: 'zh',
  japanese: 'ja', ja: 'ja',
  korean: 'ko', ko: 'ko',
  arabic: 'ar', ar: 'ar',
  hindi: 'hi', hi: 'hi',
  dutch: 'nl', nl: 'nl', nederlands: 'nl',
  polish: 'pl', pl: 'pl', polski: 'pl',
  turkish: 'tr', tr: 'tr', turkce: 'tr',
  swedish: 'sv', sv: 'sv', svenska: 'sv',
  norwegian: 'no', no: 'no', norsk: 'no',
  danish: 'da', da: 'da', dansk: 'da',
  finnish: 'fi', fi: 'fi', suomi: 'fi',
  greek: 'el', el: 'el', ellinika: 'el',
  czech: 'cs', cs: 'cs', cestina: 'cs',
  romanian: 'ro', ro: 'ro', romana: 'ro',
  ukrainian: 'uk', uk: 'uk',
  vietnamese: 'vi', vi: 'vi',
  thai: 'th', th: 'th',
  indonesian: 'id', id: 'id',
  malay: 'ms', ms: 'ms',
  hebrew: 'he', he: 'he', ivrit: 'he',
  persian: 'fa', fa: 'fa', farsi: 'fa'
});

function normalizeLangPrefix(lang) {
  if (typeof lang !== 'string') return 'universal';
  const raw = lang.trim().toLowerCase();
  if (!raw) return 'universal';
  if (LANG_PREFIX_ALIASES[raw]) return LANG_PREFIX_ALIASES[raw];
  // Strip accents and retry (e.g. "Español" → "espanol").
  const stripped = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  if (LANG_PREFIX_ALIASES[stripped]) return LANG_PREFIX_ALIASES[stripped];
  // Unrecognized → keep as-is so it still buckets as `<lang>.unknown.*`.
  return raw;
}

// ── Internal indexes (built once at module load) ───────────────────
// allSkillsById: Map<skillId, skillObject>
// aliasIndex: Map<langPrefix, Map<normalizedAlias, skillId>>
//   - langPrefix is the language code (es, en, ...) OR 'universal'
//   - normalizedAlias is lowercase + punctuation-stripped
// tokenIndex: Map<langPrefix, Array<{ skillId, tokens: Set<string> }>>
//   - used for fuzzy token-overlap matching when exact alias fails
const allSkillsById = new Map();
const aliasIndex = new Map();
const tokenIndex = new Map();

function normalizeText(s) {
  if (typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents for matching
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(s) {
  const norm = normalizeText(s);
  if (!norm) return new Set();
  // Filter stop words so "verb conjugation" and "the verb conjugation" match.
  const STOP = new Set([
    'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'and', 'or', 'is', 'are',
    'be', 'with', 'for', 'by', 'as', 'vs', 'using', 'use', 'usage', 'errors', 'error'
  ]);
  return new Set(norm.split(' ').filter(t => t.length > 1 && !STOP.has(t)));
}

function langPrefixForSkill(skillId) {
  return skillId.split('.')[0]; // 'es', 'en', 'universal'
}

function registerSkill(skill, fileLabel) {
  validateSkillEntry(skill, fileLabel);
  if (allSkillsById.has(skill.id)) {
    throw new Error(`[skillTaxonomy] Duplicate skill id "${skill.id}" (already loaded from another file)`);
  }
  allSkillsById.set(skill.id, Object.freeze({ ...skill }));

  const prefix = langPrefixForSkill(skill.id);
  if (!aliasIndex.has(prefix)) aliasIndex.set(prefix, new Map());
  if (!tokenIndex.has(prefix)) tokenIndex.set(prefix, []);

  const langAliases = aliasIndex.get(prefix);
  const langTokens = tokenIndex.get(prefix);

  // Index displayName.en + every alias.
  const aliasSet = new Set();
  aliasSet.add(skill.displayName.en);
  for (const alias of skill.aliases) aliasSet.add(alias);

  for (const alias of aliasSet) {
    const norm = normalizeText(alias);
    if (!norm) continue;
    // First-write-wins: if two skills share an alias, the first registered
    // owns it. We surface this as a startup warning rather than throw,
    // since a near-synonym overlap can be intentional during taxonomy growth.
    if (!langAliases.has(norm)) {
      langAliases.set(norm, skill.id);
    } else if (langAliases.get(norm) !== skill.id) {
      // eslint-disable-next-line no-console
      console.warn(`[skillTaxonomy] Alias "${alias}" already mapped to ${langAliases.get(norm)}; ignoring for ${skill.id}`);
    }
    langTokens.push({ skillId: skill.id, tokens: tokensOf(alias) });
  }
}

function loadFile(modulePath, fileLabel) {
  let mod;
  try {
    mod = require(modulePath);
  } catch (err) {
    throw new Error(`[skillTaxonomy] Failed to load ${fileLabel}: ${err.message}`);
  }
  if (!Array.isArray(mod)) {
    throw new Error(`[skillTaxonomy] ${fileLabel} must export an array of skill entries`);
  }
  for (const entry of mod) {
    registerSkill(entry, fileLabel);
  }
}

function loadAllTaxonomies() {
  // Universal first so language-specific files can reference them in prereqs.
  loadFile(UNIVERSAL_FILE, 'universal');
  for (const [lang, modulePath] of Object.entries(TAXONOMY_FILES)) {
    loadFile(modulePath, lang);
  }

  // Validate cross-file references — every prerequisite must resolve.
  const unknown = validateReferences(allSkillsById);
  if (unknown.length > 0) {
    const sample = unknown.slice(0, 5).map(u => `${u.skill} → ${u.missingPrereq}`).join('; ');
    throw new Error(`[skillTaxonomy] ${unknown.length} unknown prerequisite reference(s) — first: ${sample}`);
  }

  // eslint-disable-next-line no-console
  console.log(`[skillTaxonomy] Loaded ${allSkillsById.size} skills across ${TAXONOMY_FILES ? Object.keys(TAXONOMY_FILES).length : 0} languages + universal`);
}

// Eager load — fail fast at boot if a taxonomy file is malformed.
loadAllTaxonomies();

// ── Public API ─────────────────────────────────────────────────────

/**
 * Look up a skill by id. Returns null when not found.
 * Unknown buckets (`<lang>.unknown.*`) are NOT pre-registered, but the
 * canonicalizer can mint them on demand — the skill object returned by
 * `canonicalize` for an unknown bucket is synthesized lazily and not
 * stored here (keeps the static taxonomy free of low-signal entries).
 */
function getSkill(skillId) {
  if (!skillId) return null;
  if (allSkillsById.has(skillId)) return allSkillsById.get(skillId);
  // Synthesize unknown-bucket skills so downstream code can always get a
  // valid skill object back. These never enter the alias index.
  if (skillId.startsWith('universal.unknown.') || /^[a-z]{2,3}\.unknown\./.test(skillId)) {
    const display = skillId.split('.').pop().replace(/_/g, ' ');
    return Object.freeze({
      id: skillId,
      displayName: { en: display },
      category: 'grammar', // best-effort default; safe fallback
      cefr: null,
      prerequisites: [],
      aliases: [],
      impactWeight: 0.8, // lower than baseline — we don't know enough to weight it
      goalTags: ['other'],
      _synthetic: true
    });
  }
  return null;
}

/**
 * All skills for a language, including universals. Useful for scoring
 * "in scope of this language" decisions.
 */
function listSkillsForLanguage(lang) {
  const prefix = normalizeLangPrefix(lang);
  const out = [];
  for (const skill of allSkillsById.values()) {
    const p = langPrefixForSkill(skill.id);
    if (p === prefix || p === 'universal') out.push(skill);
  }
  return out;
}

/**
 * Slugify a free-text issue into a safe `unknown` skill id segment.
 * Stable: same input → same id.
 */
function slugifyForUnknown(rawIssue) {
  const norm = normalizeText(rawIssue);
  if (!norm) return 'unspecified';
  return norm.replace(/\s+/g, '_').slice(0, 60) || 'unspecified';
}

/**
 * Canonicalize a free-text issue from a lesson analysis into a skillId.
 * Returns: { skillId, confidence: 'exact'|'token'|'fallback', synthetic: bool }
 *
 * Deterministic; safe to call thousands of times per request. Never throws.
 */
function canonicalize(rawIssue, lang) {
  const fallbackPrefix = normalizeLangPrefix(lang);
  const fallback = () => ({
    skillId: `${fallbackPrefix}.unknown.${slugifyForUnknown(rawIssue)}`,
    confidence: 'fallback',
    synthetic: true
  });

  if (typeof rawIssue !== 'string' || rawIssue.trim().length === 0) {
    return fallback();
  }
  const norm = normalizeText(rawIssue);
  if (!norm) return fallback();

  // Stage 1: exact alias match. Look in target language first, then universal.
  const search = [fallbackPrefix, 'universal'].filter((p, i, a) => p && a.indexOf(p) === i);
  for (const prefix of search) {
    const langAliases = aliasIndex.get(prefix);
    if (langAliases && langAliases.has(norm)) {
      return {
        skillId: langAliases.get(norm),
        confidence: 'exact',
        synthetic: false
      };
    }
  }

  // Stage 2: token-overlap match (Jaccard-like). Pick the skill whose
  // aliases share the largest fraction of the input tokens, with a
  // minimum overlap floor to avoid spurious matches.
  const inputTokens = tokensOf(rawIssue);
  if (inputTokens.size === 0) return fallback();

  let best = null;
  let bestScore = 0;
  const MIN_OVERLAP_RATIO = 0.5;
  const MIN_TOKENS_MATCHED = 1;
  for (const prefix of search) {
    const list = tokenIndex.get(prefix);
    if (!list) continue;
    for (const candidate of list) {
      if (candidate.tokens.size === 0) continue;
      let matched = 0;
      for (const t of inputTokens) {
        if (candidate.tokens.has(t)) matched++;
      }
      if (matched < MIN_TOKENS_MATCHED) continue;
      // Score = matched / min(input, candidate), so partial inputs can
      // still hit a precise alias.
      const denom = Math.min(inputTokens.size, candidate.tokens.size);
      const score = matched / denom;
      if (score >= MIN_OVERLAP_RATIO && score > bestScore) {
        bestScore = score;
        best = candidate.skillId;
      }
    }
    if (best) break; // language match beats universal match
  }

  if (best) {
    return { skillId: best, confidence: 'token', synthetic: false };
  }

  return fallback();
}

/**
 * Humanize a raw skillId into a readable label. Used for synthesized
 * `<lang>.unknown.<name>` skills that have no taxonomy entry — turns
 * "english.unknown.word_choice_errors" into "Word choice errors" so the
 * focus line never surfaces a raw dotted id to the student/tutor.
 */
function humanizeSkillId(skillId) {
  if (typeof skillId !== 'string' || !skillId) return skillId;
  const lastSegment = skillId.split('.').pop() || skillId;
  const words = lastSegment.replace(/_/g, ' ').trim();
  if (!words) return skillId;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Render the display label for a skillId in the given locale, falling
 * back to English, then to a humanized form of the raw id.
 */
function displayNameFor(skillId, locale = 'en') {
  const skill = getSkill(skillId);
  if (!skill) return humanizeSkillId(skillId);
  if (skill.displayName?.[locale]) return skill.displayName[locale];
  if (skill.displayName?.en) return skill.displayName.en;
  return humanizeSkillId(skillId);
}

/**
 * Debug introspection — useful for scripts / admin endpoints.
 * Returns { totalSkills, byLanguage: { es: N, en: N, universal: N } }
 */
function stats() {
  const byLanguage = {};
  for (const skill of allSkillsById.values()) {
    const p = langPrefixForSkill(skill.id);
    byLanguage[p] = (byLanguage[p] || 0) + 1;
  }
  return { totalSkills: allSkillsById.size, byLanguage };
}

module.exports = {
  getSkill,
  listSkillsForLanguage,
  canonicalize,
  displayNameFor,
  stats,
  // Exported for tests
  _normalizeText: normalizeText,
  _tokensOf: tokensOf,
  _normalizeLangPrefix: normalizeLangPrefix
};
