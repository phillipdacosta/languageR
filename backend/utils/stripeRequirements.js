/**
 * Collect outstanding Stripe Connect requirement field names for a connected account.
 * Merges currently_due + past_due (deduped, stable order).
 */
function collectStripeRequirements(account) {
  const currentlyDue = account?.requirements?.currently_due || [];
  const pastDue = account?.requirements?.past_due || [];
  return [...new Set([...currentlyDue, ...pastDue])];
}

function requirementsArraysEqual(a, b) {
  const left = Array.isArray(a) ? [...a].sort() : [];
  const right = Array.isArray(b) ? [...b].sort() : [];
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

module.exports = {
  collectStripeRequirements,
  requirementsArraysEqual,
};
