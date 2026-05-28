/**
 * Shape and validation for the skill taxonomy.
 *
 * Every entry in a language taxonomy file conforms to this shape.
 * The validation function is run once at module load so a malformed
 * entry fails fast rather than corrupting downstream priority scoring.
 *
 * Skill IDs are namespaced: `<langOrUniversal>.<category>.<dot.path>`
 *   - es.grammar.tense.subjunctive_present
 *   - en.vocab.false_friends.embarrassed
 *   - universal.fluency.filler_words
 *
 * Categories (canonical):
 *   - grammar:      morphology, syntax, agreement, tense, mood
 *   - vocabulary:   lexical choice, idiom, register, false friends
 *   - pronunciation: phoneme, prosody, stress
 *   - fluency:      pace, filler, self-correction, hesitation
 *   - pragmatics:   register, politeness, turn-taking
 *   - discourse:    cohesion, connectors, narrative structure
 *
 * impactWeight is a multiplicative factor used by the priority scorer.
 * 1.0 = baseline. Use ranges:
 *   - 0.6–0.9 for "polish" issues (filler words, optional politeness)
 *   - 1.0     for typical grammar / vocab errors
 *   - 1.2–1.5 for "high blast radius" (verb conjugation, tense, gender agreement)
 *   - 1.5–2.0 for foundational gaps a B1 student really shouldn't have
 *
 * goalTags drive goal-alignment in priority scoring. A travel learner
 * cares less about subjunctive than a relocation learner does.
 */

const CATEGORIES = Object.freeze([
  'grammar',
  'vocabulary',
  'pronunciation',
  'fluency',
  'pragmatics',
  'discourse'
]);

const CEFR_LEVELS = Object.freeze(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

const GOAL_TAGS = Object.freeze([
  'conversational',
  'exam_prep',
  'professional',
  'travel',
  'relocation',
  'other'
]);

/**
 * Validate a single skill entry. Throws if malformed.
 * Pure function — caller owns the I/O context for the error message.
 *
 * @param {Object} entry — a skill object as defined in a taxonomy file
 * @param {String} [contextLabel] — for error messages, e.g. file path
 */
function validateSkillEntry(entry, contextLabel = '<unknown>') {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`[skillTaxonomy:${contextLabel}] Entry is not an object: ${JSON.stringify(entry)}`);
  }
  if (typeof entry.id !== 'string' || entry.id.trim().length === 0) {
    throw new Error(`[skillTaxonomy:${contextLabel}] Missing 'id'`);
  }
  if (!/^[a-z0-9_]+(\.[a-z0-9_]+){2,}$/.test(entry.id)) {
    throw new Error(`[skillTaxonomy:${contextLabel}:${entry.id}] id must be dot-namespaced lower_snake (e.g. es.grammar.tense.subjunctive_present)`);
  }
  if (!entry.displayName || typeof entry.displayName !== 'object') {
    throw new Error(`[skillTaxonomy:${contextLabel}:${entry.id}] displayName must be a locale map`);
  }
  if (!entry.displayName.en || typeof entry.displayName.en !== 'string') {
    throw new Error(`[skillTaxonomy:${contextLabel}:${entry.id}] displayName.en is required`);
  }
  if (!CATEGORIES.includes(entry.category)) {
    throw new Error(`[skillTaxonomy:${contextLabel}:${entry.id}] category '${entry.category}' is not one of ${CATEGORIES.join(', ')}`);
  }
  if (entry.cefr !== null && entry.cefr !== undefined && !CEFR_LEVELS.includes(entry.cefr)) {
    throw new Error(`[skillTaxonomy:${contextLabel}:${entry.id}] cefr '${entry.cefr}' is not one of ${CEFR_LEVELS.join(', ')} (or null for universal)`);
  }
  if (!Array.isArray(entry.prerequisites)) {
    throw new Error(`[skillTaxonomy:${contextLabel}:${entry.id}] prerequisites must be an array (use [] for none)`);
  }
  if (entry.prerequisites.some(p => typeof p !== 'string')) {
    throw new Error(`[skillTaxonomy:${contextLabel}:${entry.id}] prerequisites must be string skill IDs`);
  }
  if (!Array.isArray(entry.aliases)) {
    throw new Error(`[skillTaxonomy:${contextLabel}:${entry.id}] aliases must be an array`);
  }
  if (entry.aliases.some(a => typeof a !== 'string')) {
    throw new Error(`[skillTaxonomy:${contextLabel}:${entry.id}] aliases must be strings`);
  }
  const w = entry.impactWeight;
  if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0 || w > 5) {
    throw new Error(`[skillTaxonomy:${contextLabel}:${entry.id}] impactWeight must be a number in (0, 5]`);
  }
  if (!Array.isArray(entry.goalTags)) {
    throw new Error(`[skillTaxonomy:${contextLabel}:${entry.id}] goalTags must be an array`);
  }
  for (const tag of entry.goalTags) {
    if (!GOAL_TAGS.includes(tag)) {
      throw new Error(`[skillTaxonomy:${contextLabel}:${entry.id}] goalTag '${tag}' is not in GOAL_TAGS`);
    }
  }
  return true;
}

/**
 * Validate that prerequisite IDs all resolve. Run AFTER loading every
 * skill so cross-file references can be checked. Returns the list of
 * unknown references so the caller can decide how to surface them
 * (we treat unknown prereqs as a hard error in production).
 */
function validateReferences(allSkillsById) {
  const unknown = [];
  for (const skill of allSkillsById.values()) {
    for (const prereq of skill.prerequisites) {
      if (!allSkillsById.has(prereq)) {
        unknown.push({ skill: skill.id, missingPrereq: prereq });
      }
    }
  }
  return unknown;
}

module.exports = {
  CATEGORIES,
  CEFR_LEVELS,
  GOAL_TAGS,
  validateSkillEntry,
  validateReferences
};
