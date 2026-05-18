/**
 * Subscription service — owns the lifecycle of a student's premium plan.
 *
 * Responsibilities:
 *   - Create / fetch the Stripe Customer record for a user.
 *   - Open a Stripe Checkout Session for new premium upgrades.
 *   - Open a Customer Portal Session for managing/cancelling.
 *   - Reconcile webhook events into the local User.subscription field.
 *
 * Design notes:
 *   - Reads/writes to the local User.subscription field. Never expose the raw
 *     Stripe object to the client.
 *   - All Stripe writes are idempotent on retry — webhook handlers re-fetch
 *     the subscription before applying state.
 *   - The user-visible "premium = true/false" answer always comes from
 *     services/entitlementsService.js so the rest of the app stays gate-agnostic.
 */

const Stripe = require('stripe');
const User = require('../models/User');

const PREMIUM_TIER = 'premium';
const FREE_TIER = 'free';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY env var not set');
  }
  return Stripe(key);
}

function getPremiumPriceId() {
  const id = process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  if (!id) {
    throw new Error('STRIPE_PRICE_PREMIUM_MONTHLY env var not set (the Stripe Price id for the premium plan)');
  }
  return id;
}

function getReturnUrl(path) {
  const base = process.env.PUBLIC_APP_URL || 'http://localhost:8100';
  return `${base.replace(/\/$/, '')}${path}`;
}

/**
 * Get or create the Stripe customer for a user.
 * Stored on User.stripeCustomerId so we can re-use it across checkouts.
 */
async function ensureStripeCustomer(user) {
  if (!user) throw new Error('user is required');
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user.email || undefined,
    name: user.name || undefined,
    metadata: { userId: user._id.toString() }
  });

  user.stripeCustomerId = customer.id;
  await user.save();
  return customer.id;
}

/**
 * Create a Checkout Session for a premium subscription.
 * Returns { url } — caller redirects the browser to it.
 */
async function createCheckoutSession({ user, successPath = '/tabs/journey?upgrade=success', cancelPath = '/tabs/journey?upgrade=cancelled' }) {
  if (!user) throw new Error('user is required');
  if (user.userType !== 'student') {
    const err = new Error('Only students can subscribe');
    err.statusCode = 403;
    throw err;
  }

  const stripe = getStripe();
  const customerId = await ensureStripeCustomer(user);
  const priceId = getPremiumPriceId();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: getReturnUrl(successPath),
    cancel_url: getReturnUrl(cancelPath),
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { userId: user._id.toString() }
    },
    client_reference_id: user._id.toString()
  });

  return { url: session.url, sessionId: session.id };
}

/**
 * Create a Customer Portal session so the user can cancel/update payment.
 */
async function createPortalSession({ user, returnPath = '/tabs/journey' }) {
  if (!user) throw new Error('user is required');
  if (!user.stripeCustomerId) {
    const err = new Error('No Stripe customer on file');
    err.statusCode = 404;
    throw err;
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: getReturnUrl(returnPath)
  });

  return { url: session.url };
}

/**
 * Apply a Stripe Subscription object onto our local User.subscription.
 * Used by the webhook handler — also safe to call from the success-redirect
 * route as a defensive resync.
 */
async function syncSubscriptionFromStripe(stripeSubscription) {
  if (!stripeSubscription) return null;

  const userIdFromMetadata = stripeSubscription.metadata?.userId;
  let user = null;

  if (userIdFromMetadata) {
    user = await User.findById(userIdFromMetadata);
  }
  if (!user && stripeSubscription.customer) {
    user = await User.findOne({ stripeCustomerId: stripeSubscription.customer });
  }

  if (!user) {
    console.warn(`⚠️  [Subscription] No user matched Stripe subscription ${stripeSubscription.id}`);
    return null;
  }

  const status = stripeSubscription.status; // active, trialing, past_due, canceled, unpaid, incomplete, ...
  const isPremiumNow = ['active', 'trialing'].includes(status);

  user.subscription = user.subscription || {};
  user.subscription.tier = isPremiumNow ? PREMIUM_TIER : FREE_TIER;
  user.subscription.status = mapStripeStatus(status);
  user.subscription.source = 'stripe';
  user.subscription.externalId = stripeSubscription.id;
  user.subscription.startedAt = stripeSubscription.start_date
    ? new Date(stripeSubscription.start_date * 1000)
    : user.subscription.startedAt || new Date();
  user.subscription.renewsAt = stripeSubscription.current_period_end
    ? new Date(stripeSubscription.current_period_end * 1000)
    : null;
  user.subscription.canceledAt = stripeSubscription.canceled_at
    ? new Date(stripeSubscription.canceled_at * 1000)
    : null;
  user.subscription.trialEndsAt = stripeSubscription.trial_end
    ? new Date(stripeSubscription.trial_end * 1000)
    : null;

  await user.save();
  console.log(`✅ [Subscription] Synced user ${user._id} → tier=${user.subscription.tier} status=${user.subscription.status}`);
  return user;
}

/**
 * Map Stripe's many statuses onto our small enum.
 * Anything unrecognised falls back to 'canceled' to be safe.
 */
function mapStripeStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'active':       return 'active';
    case 'trialing':     return 'trialing';
    case 'past_due':     return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
    case 'unpaid':
      return 'canceled';
    default:
      return 'canceled';
  }
}

/**
 * Mark the local User.subscription back to free without contacting Stripe.
 * Used as a defensive cleanup if a webhook says the sub was deleted.
 */
async function markUserAsFree(userId) {
  const user = await User.findById(userId);
  if (!user) return null;
  user.subscription = user.subscription || {};
  user.subscription.tier = FREE_TIER;
  user.subscription.status = 'canceled';
  user.subscription.canceledAt = new Date();
  await user.save();
  return user;
}

/**
 * Read-only summary the client can render on an upgrade/manage page.
 */
function getClientSummary(user) {
  const sub = user?.subscription || {};
  return {
    tier: sub.tier || FREE_TIER,
    status: sub.status || 'active',
    renewsAt: sub.renewsAt || null,
    canceledAt: sub.canceledAt || null,
    trialEndsAt: sub.trialEndsAt || null,
    source: sub.source || null
  };
}

module.exports = {
  ensureStripeCustomer,
  createCheckoutSession,
  createPortalSession,
  syncSubscriptionFromStripe,
  markUserAsFree,
  getClientSummary
};
