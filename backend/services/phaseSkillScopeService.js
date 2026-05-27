/**
 * Phase skill scope — which taxonomy skills belong to a learning-plan phase.
 *
 * Phases are authored with free-text `focusAreas` / `suggestedTopics`.
 * The Bayesian promotion gate needs canonical `focusSkillIds[]`. This
 * module resolves and caches them on the phase document.
 *
 * Resolution order per text line:
 *   1. Use existing phase.focusSkillIds if non-empty (manual / cached)
 *   2. Canonicalize each focusArea + suggestedTopic string
 *   3. Drop synthetic `*.unknown.*` buckets unless nothing else matched
 *
 * Pure functions except `syncPhaseFocusSkillIds` which mutates the phase.
 */

const taxonomy = require('./skillTaxonomy');

const MAX_SKILLS_PER_PHASE = 12;

function isSyntheticUnknown(skillId) {
  return typeof skillId === 'string' && skillId.includes('.unknown.');
}

/**
 * Canonicalize a list of free-text labels into unique skillIds.
 */
function skillIdsFromLabels(labels, language) {
  const ids = new Set();
  for (const label of labels || []) {
    if (typeof label !== 'string' || !label.trim()) continue;
    const { skillId, confidence } = taxonomy.canonicalize(label, language);
    if (!skillId) continue;
    if (confidence === 'fallback' && isSyntheticUnknown(skillId)) continue;
    ids.add(skillId);
    if (ids.size >= MAX_SKILLS_PER_PHASE) break;
  }
  return [...ids];
}

/**
 * Collect labels from a phase object.
 */
function labelsFromPhase(phase) {
  const labels = [];
  (phase?.focusAreas || []).forEach(s => labels.push(s));
  (phase?.suggestedTopics || []).forEach(s => labels.push(s));
  if (phase?.title) labels.push(phase.title);
  if (phase?.description) {
    // First sentence only — avoids dumping whole paragraph into canonicalizer.
    const first = phase.description.split(/(?<=[.!?])\s+/)[0];
    if (first) labels.push(first);
  }
  return labels;
}

/**
 * Resolve skill IDs for a phase without mutating it.
 */
function resolvePhaseSkillIds(phase, language) {
  if (Array.isArray(phase?.focusSkillIds) && phase.focusSkillIds.length > 0) {
    return phase.focusSkillIds.filter(id => typeof id === 'string' && id.length > 0);
  }
  const fromLabels = skillIdsFromLabels(labelsFromPhase(phase), language);
  if (fromLabels.length > 0) return fromLabels;

  // Last resort: allow unknown buckets so the gate has *something* in scope.
  const fallback = new Set();
  for (const label of labelsFromPhase(phase)) {
    const { skillId } = taxonomy.canonicalize(label, language);
    if (skillId) fallback.add(skillId);
  }
  return [...fallback].slice(0, MAX_SKILLS_PER_PHASE);
}

/**
 * Write `phase.focusSkillIds` from focusAreas / topics (idempotent).
 */
function syncPhaseFocusSkillIds(phase, language) {
  if (!phase) return [];
  const resolved = resolvePhaseSkillIds(phase, language);
  phase.focusSkillIds = resolved;
  return resolved;
}

/**
 * Sync every phase on a plan (e.g. after chapter generation).
 */
function syncAllPhases(plan) {
  if (!plan?.phases || !plan.language) return;
  for (const phase of plan.phases) {
    syncPhaseFocusSkillIds(phase, plan.language);
  }
}

module.exports = {
  resolvePhaseSkillIds,
  syncPhaseFocusSkillIds,
  syncAllPhases,
  skillIdsFromLabels,
  MAX_SKILLS_PER_PHASE
};
