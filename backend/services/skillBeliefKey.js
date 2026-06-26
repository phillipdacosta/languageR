'use strict';

/**
 * Mongoose `Map` keys cannot contain a literal "." (BSON restriction), but
 * every taxonomy skillId is dotted (e.g. "english.unknown.word_choice_errors").
 * Writing such an id straight into `plan.skillBeliefs.set(skillId, …)` throws
 * and — because callers swallow the error — silently freezes the whole
 * post-lesson plan update.
 *
 * This module is the single boundary that maps a dotted skillId to a
 * Map-safe key and back. Every read/write of `plan.skillBeliefs` MUST go
 * through these helpers so encoding stays symmetric.
 *
 * We substitute "." → ":" because skillIds never contain ":". Reads also
 * fall back to the raw (un-encoded) key so any legacy plain-object data
 * written before this fix is still found.
 */

const DOT = '.';
const ENCODED_DOT = ':';

function encodeBeliefKey(skillId) {
  if (typeof skillId !== 'string') return skillId;
  return skillId.split(DOT).join(ENCODED_DOT);
}

function decodeBeliefKey(key) {
  if (typeof key !== 'string') return key;
  return key.split(ENCODED_DOT).join(DOT);
}

function _isMap(store) {
  return store && typeof store.get === 'function' && typeof store.set === 'function';
}

/**
 * Read a belief for a dotted skillId from a Mongoose/native Map or plain
 * object. Tries the encoded key first, then the raw key (legacy data).
 */
function getBelief(store, skillId) {
  if (!store || skillId == null) return null;
  const encoded = encodeBeliefKey(skillId);
  if (_isMap(store)) {
    return store.get(encoded) || store.get(skillId) || null;
  }
  return store[encoded] || store[skillId] || null;
}

/**
 * Write a belief for a dotted skillId. Encodes the key so Mongoose Maps
 * accept it.
 */
function setBelief(store, skillId, value) {
  if (!store || skillId == null) return;
  const encoded = encodeBeliefKey(skillId);
  if (_isMap(store)) {
    store.set(encoded, value);
  } else {
    store[encoded] = value;
  }
}

/**
 * Iterate a belief store yielding [decodedSkillId, value] pairs so callers
 * always see the logical dotted skillId regardless of storage encoding.
 */
function* beliefEntries(store) {
  if (!store) return;
  const iter = typeof store.entries === 'function'
    ? store.entries()
    : Object.entries(store);
  for (const [key, value] of iter) {
    yield [decodeBeliefKey(key), value];
  }
}

module.exports = {
  encodeBeliefKey,
  decodeBeliefKey,
  getBelief,
  setBelief,
  beliefEntries
};
