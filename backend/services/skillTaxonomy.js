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
  es: './skills/data/es',
  en: './skills/data/en'
  // Add fr, de, it, pt, etc. as their taxonomy files come online.
});

const UNIVERSAL_FILE = './skills/data/universal';

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
  const prefix = (lang || '').toLowerCase();
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
  const fallbackPrefix = (lang || '').toLowerCase() || 'universal';
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
 * Render the display label for a skillId in the given locale, falling
 * back to English then to the raw id.
 */
function displayNameFor(skillId, locale = 'en') {
  const skill = getSkill(skillId);
  if (!skill) return skillId;
  if (skill.displayName?.[locale]) return skill.displayName[locale];
  if (skill.displayName?.en) return skill.displayName.en;
  return skillId;
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
  _tokensOf: tokensOf
};
