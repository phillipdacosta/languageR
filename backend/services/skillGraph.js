/**
 * Skill prerequisite graph & upstream diagnosis.
 *
 * Builds a DAG from the taxonomy's `prerequisites` edges, then answers:
 *
 *   - getPrerequisites(skillId)       → direct prereqs
 *   - getAncestors(skillId)           → full upstream transitive closure
 *   - diagnoseRootBlocker(skillId, beliefs)
 *        → walks upstream until it finds the deepest unmastered prereq.
 *          If everything upstream is mastered, returns the skill itself
 *          (the struggle is real, not a symptom of a missing foundation).
 *
 * Cycle detection: prerequisites SHOULD be acyclic by definition, but
 * we guard against bugs at runtime — traversal stops at a visited node
 * and logs a warning. Never throws on a cycle; the system must remain
 * available.
 */

const taxonomy = require('./skillTaxonomy');
const bayes = require('./bayesianMastery');
const skillBeliefKey = require('./skillBeliefKey');

const MAX_TRAVERSAL_DEPTH = 8; // taxonomy depth is small; this is a defensive cap

/**
 * Direct prerequisites for a skill. Returns [] if skill is unknown.
 */
function getPrerequisites(skillId) {
  const skill = taxonomy.getSkill(skillId);
  if (!skill) return [];
  return [...skill.prerequisites];
}

/**
 * Full upstream transitive closure, breadth-first. Returns an array of
 * skill IDs sorted by depth (closest first). Excludes the input skillId.
 */
function getAncestors(skillId, maxDepth = MAX_TRAVERSAL_DEPTH) {
  const ancestors = [];
  const visited = new Set([skillId]);
  let frontier = getPrerequisites(skillId);
  let depth = 0;
  while (frontier.length > 0 && depth < maxDepth) {
    const next = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      ancestors.push({ id, depth: depth + 1 });
      const parents = getPrerequisites(id);
      for (const p of parents) {
        if (!visited.has(p)) next.push(p);
      }
    }
    frontier = next;
    depth++;
  }
  if (frontier.length > 0 && depth >= maxDepth) {
    // eslint-disable-next-line no-console
    console.warn(`[skillGraph] Traversal hit max depth ${maxDepth} starting at ${skillId} — possible cycle or unusually deep prereq chain`);
  }
  return ancestors;
}

/**
 * Read a belief out of a Map / plain object / Mongoose Map for a skillId.
 * Returns null when no belief is found (caller should treat as the prior).
 */
function readBelief(beliefs, skillId) {
  if (!beliefs) return null;
  return skillBeliefKey.getBelief(beliefs, skillId);
}

/**
 * Diagnose the root blocker for a struggling skill.
 *
 * Returns:
 *   {
 *     blockerSkillId,
 *     isUpstream,          // true if blockerSkillId !== skillId
 *     path: [skillId, ..., blockerSkillId],
 *     reason: 'upstream_unmastered' | 'no_upstream_blocker' | 'unknown_skill'
 *   }
 *
 * Algorithm: BFS upstream, return the FIRST node (closest to the
 * struggling skill) whose belief is confidently NOT mastered. We
 * favor the closest blocker rather than the deepest — a student stuck
 * on present-subjunctive whose verb-conjugation belief is weak should
 * be redirected to verb conjugation, not all the way back to "vowel
 * clarity." If the closest blocker is itself blocked by something
 * deeper, the NEXT diagnosis call will catch it.
 *
 * @param {String} skillId — the currently struggling skill
 * @param {Map|Object} beliefs — beliefs keyed by skillId
 * @param {Object} [opts]
 * @param {Number} [opts.threshold=0.7] — mastery threshold
 * @param {Number} [opts.confidence=0.6] — confidence to declare "not mastered"
 */
function diagnoseRootBlocker(skillId, beliefs, opts = {}) {
  const skill = taxonomy.getSkill(skillId);
  if (!skill) {
    return { blockerSkillId: skillId, isUpstream: false, path: [skillId], reason: 'unknown_skill' };
  }
  const threshold = opts.threshold ?? bayes.MASTERY_THRESHOLD;
  const confidence = opts.confidence ?? bayes.MASTERY_CONFIDENCE;

  // BFS upstream, keeping parent pointers for path reconstruction.
  const visited = new Set([skillId]);
  const parent = new Map();
  const queue = [];
  for (const p of getPrerequisites(skillId)) {
    parent.set(p, skillId);
    queue.push({ id: p, depth: 1 });
  }

  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    if (depth > MAX_TRAVERSAL_DEPTH) break;

    const belief = readBelief(beliefs, id);
    // "Confidently not mastered" — we need positive evidence the prereq
    // is shaky, not just absence of evidence. This prevents the system
    // from chasing prereqs the student has simply never touched.
    if (bayes.isUnmastered(belief, threshold, confidence)) {
      // Reconstruct path skillId → ... → blocker.
      const path = [id];
      let cur = id;
      while (parent.has(cur)) {
        cur = parent.get(cur);
        path.push(cur);
      }
      path.reverse(); // skillId first → blocker last
      return {
        blockerSkillId: id,
        isUpstream: true,
        path,
        reason: 'upstream_unmastered'
      };
    }

    for (const p of getPrerequisites(id)) {
      if (!visited.has(p) && !parent.has(p)) {
        parent.set(p, id);
        queue.push({ id: p, depth: depth + 1 });
      }
    }
  }

  return {
    blockerSkillId: skillId,
    isUpstream: false,
    path: [skillId],
    reason: 'no_upstream_blocker'
  };
}

/**
 * Has the student demonstrably mastered every direct prerequisite of
 * the given skill? Useful for "is the student ready to learn X?" checks.
 */
function hasMasteredPrereqs(skillId, beliefs, opts = {}) {
  const prereqs = getPrerequisites(skillId);
  if (prereqs.length === 0) return true;
  const threshold = opts.threshold ?? bayes.MASTERY_THRESHOLD;
  const confidence = opts.confidence ?? bayes.MASTERY_CONFIDENCE;
  for (const p of prereqs) {
    const belief = readBelief(beliefs, p);
    if (!bayes.isMastered(belief, threshold, confidence)) return false;
  }
  return true;
}

module.exports = {
  getPrerequisites,
  getAncestors,
  diagnoseRootBlocker,
  hasMasteredPrereqs,
  MAX_TRAVERSAL_DEPTH
};
