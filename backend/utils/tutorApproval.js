/**
 * Centralized "is this tutor fully approved?" gate.
 *
 * A tutor's profile must stay hidden from search until **every** required step
 * is complete *and* every admin-reviewed step is approved.
 *
 * Required steps:
 *   - photo:           custom profile picture uploaded (`user.picture`)
 *   - video:           introduction video uploaded AND admin-approved
 *                      (`tutorOnboarding.videoApproved === true`)
 *   - payout:          Stripe Connect / PayPal / Manual payout configured
 *   - identity:        Stripe Identity verified (`stripeIdentityVerified`) OR
 *                      manually-uploaded gov ID approved by admin
 *   - qualifications:  at least one teaching certification approved by admin
 *   - tos:             Independent-Contractor Agreement / TOS accepted
 *                      (`tosAcceptedAt` set)
 *
 * Pure / synchronous: it inspects the in-memory user document only and never
 * mutates it. Use `applyApprovalIfReady(user)` to flip `tutorApproved` once
 * everything is satisfied.
 */

function evaluateTutorApproval(user) {
  if (!user || user.userType !== 'tutor') {
    return {
      photoComplete: false,
      videoApproved: false,
      payoutComplete: false,
      identitySatisfied: false,
      qualificationsApproved: false,
      tosComplete: false,
      isFullyApproved: false,
    };
  }

  const photoComplete = !!user.picture;

  const videoApproved = user.tutorOnboarding?.videoApproved === true;

  const hasStripe = user.stripeConnectOnboarded === true;
  const hasPayPal =
    user.payoutProvider === 'paypal' && !!user.payoutDetails?.paypalEmail;
  const hasManual = user.payoutProvider === 'manual';
  const payoutComplete = hasStripe || hasPayPal || hasManual;

  const creds = user.tutorCredentials || {};
  const stripeIdentityVerified = user.stripeIdentityVerified === true;
  const govIdApproved = creds.governmentId?.status === 'approved';
  const identitySatisfied = stripeIdentityVerified || govIdApproved;

  const qualificationsApproved = !!(
    creds.teachingCertifications?.length &&
    creds.teachingCertifications.some((c) => c.status === 'approved')
  );

  const tosComplete = !!user.tosAcceptedAt;

  const isFullyApproved =
    photoComplete &&
    videoApproved &&
    payoutComplete &&
    identitySatisfied &&
    qualificationsApproved &&
    tosComplete;

  return {
    photoComplete,
    videoApproved,
    payoutComplete,
    identitySatisfied,
    qualificationsApproved,
    tosComplete,
    isFullyApproved,
  };
}

/**
 * Mutates `user`: flips `tutorApproved=true` and sets `tutorOnboarding.completedAt`
 * IFF every gate passes. Returns the snapshot used.
 *
 * Never demotes an already-approved tutor — if `evaluateTutorApproval` returns
 * `false` the user is left untouched. Use this everywhere a step transitions
 * to "complete" (admin approval, payout setup, photo upload, TOS acceptance, etc.).
 */
function applyApprovalIfReady(user) {
  const snapshot = evaluateTutorApproval(user);
  if (!snapshot.isFullyApproved) return snapshot;

  if (user.tutorApproved !== true) {
    user.tutorApproved = true;
    user.tutorOnboarding = user.tutorOnboarding || {};
    user.tutorOnboarding.completedAt =
      user.tutorOnboarding.completedAt || new Date();
    console.log(
      `🎉 Tutor ${user.email} is now FULLY APPROVED (all gates satisfied)`
    );
  }

  return snapshot;
}

module.exports = {
  evaluateTutorApproval,
  applyApprovalIfReady,
};
