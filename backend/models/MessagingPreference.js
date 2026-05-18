const mongoose = require('mongoose');

/**
 * `MessagingPreference` — per-user inbox state for **1:1** conversations.
 *
 * 1:1 threads don't have a `Conversation` document (they're materialized on
 * the fly from the `Message` collection keyed by `conversationId =
 * sorted(userA, userB).join('_')`), so there's no membership row on which
 * to hang per-user "archived" / "hidden" flags. This collection fills that
 * gap.
 *
 * Semantics mirror the group equivalents (`Conversation.members[]`):
 *   • `archivedAt` — moved to Archived folder, still receives messages,
 *     reversible.
 *   • `hiddenAt`   — permanent soft-delete from this user's UI. The other
 *     party still sees their copy of the history; they're never notified.
 *     New messages from the other party DO NOT un-hide the thread.
 *
 * The `peerAuth0Id` is the *other* user's auth0Id from `ownerAuth0Id`'s
 * perspective. Lookup keys are deterministic (we don't store the sorted
 * pair) so the matching code in `routes/messaging.js` can do an indexed
 * findOne with `{ ownerAuth0Id, peerAuth0Id }`.
 */

const messagingPreferenceSchema = new mongoose.Schema({
  ownerAuth0Id: { type: String, required: true, index: true },
  peerAuth0Id: { type: String, required: true, index: true },
  archivedAt: { type: Date, default: null },
  hiddenAt: { type: Date, default: null }
}, { timestamps: true });

// One row per (owner, peer) pair. Compound unique guards against
// double-archive races and lets us upsert idempotently.
messagingPreferenceSchema.index(
  { ownerAuth0Id: 1, peerAuth0Id: 1 },
  { unique: true }
);

module.exports = mongoose.model('MessagingPreference', messagingPreferenceSchema);
