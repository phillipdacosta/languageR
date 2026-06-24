/**
 * Centralized "is this tutor fully approved?" gate.
 *
 * A tutor's profile must stay hidden from search until **every** required step
 * is complete *and* every admin-reviewed step is approved.
 *
 * Required steps:
 *   - photo:           custom profile picture uploaded AND admin-approved
 *                      (`tutorOnboarding.photoApproved === true`)
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

/** Custom GCS upload or non-Auth0-default picture — mirrors frontend checklist. */
function hasCustomProfilePhoto(user) {
  if (!user?.picture) return false;
  return (
    user.picture.includes('storage.googleapis.com') ||
    (user.auth0Picture && user.picture !== user.auth0Picture)
  );
}

function hasPendingProfilePhoto(user) {
  const pending = user?.onboardingData?.pendingPhoto;
  return !!(pending && String(pending).trim());
}

/** Admin-approved profile photo (grandfathers tutors who uploaded before photo review existed). */
function isPhotoApproved(user) {
  const onboarding = user?.tutorOnboarding || {};
  if (onboarding.photoApproved === true) return true;
  if (onboarding.photoRejected === true || hasPendingProfilePhoto(user)) return false;
  return hasCustomProfilePhoto(user);
}

function hasPhotoSubmission(user) {
  return hasPendingProfilePhoto(user) || hasCustomProfilePhoto(user);
}

function hasPendingPhotoReview(user) {
  if (hasPendingProfilePhoto(user)) return true;

  const onboarding = user?.tutorOnboarding || {};
  if (
    onboarding.photoUploaded === true &&
    onboarding.photoApproved !== true &&
    onboarding.photoRejected !== true
  ) {
    return hasCustomProfilePhoto(user) || hasPendingProfilePhoto(user);
  }

  return false;
}

function hasPendingVideoReview(user) {
  const pendingVideo = user?.onboardingData?.pendingVideo;
  if (pendingVideo && String(pendingVideo).trim()) return true;

  if (user?.tutorOnboarding?.videoRejected === true) return false;

  const introVideo = user?.onboardingData?.introductionVideo;
  if (introVideo && String(introVideo).trim() && user?.tutorOnboarding?.videoApproved !== true) {
    return true;
  }

  return false;
}

function hasPendingCredentialReview(user) {
  const creds = user?.tutorCredentials || {};
  if (creds.governmentId?.status === 'pending') return true;
  if (creds.teachingCertifications?.some((c) => c.status === 'pending')) return true;
  if (creds.additionalDocuments?.some((d) => d.status === 'pending')) return true;
  return false;
}

function tutorHasVideoRejected(user) {
  return user?.tutorOnboarding?.videoRejected === true;
}

function tutorNeedsAdminReview(user) {
  if (!user) return false;
  if (user.userType != null && user.userType !== 'tutor') return false;
  return (
    hasPendingPhotoReview(user) ||
    hasPendingVideoReview(user) ||
    hasPendingCredentialReview(user)
  );
}

function getTutorPendingReviewItems(user) {
  const items = [];
  if (hasPendingPhotoReview(user)) items.push('photo');
  if (hasPendingVideoReview(user)) items.push('video');
  if (hasPendingCredentialReview(user)) items.push('credentials');
  return items;
}

function getLatestReviewActivityAt(user) {
  const dates = [];

  if (user?.tutorOnboarding?.photoUploadedAt) {
    dates.push(new Date(user.tutorOnboarding.photoUploadedAt));
  }
  if (user?.tutorOnboarding?.videoUploadedAt) {
    dates.push(new Date(user.tutorOnboarding.videoUploadedAt));
  }

  const creds = user?.tutorCredentials || {};
  if (creds.governmentId?.uploadedAt) {
    dates.push(new Date(creds.governmentId.uploadedAt));
  }
  creds.teachingCertifications?.forEach((cert) => {
    if (cert.uploadedAt) dates.push(new Date(cert.uploadedAt));
  });
  creds.additionalDocuments?.forEach((doc) => {
    if (doc.uploadedAt) dates.push(new Date(doc.uploadedAt));
  });

  if (dates.length === 0) {
    return user?.createdAt ? new Date(user.createdAt) : new Date(0);
  }

  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

function evaluateTutorApproval(user) {
  if (!user || user.userType !== 'tutor') {
    return {
      photoComplete: false,
      photoApproved: false,
      videoApproved: false,
      payoutComplete: false,
      identitySatisfied: false,
      qualificationsApproved: false,
      tosComplete: false,
      isFullyApproved: false,
    };
  }

  const photoApproved = isPhotoApproved(user);
  const photoComplete = hasPhotoSubmission(user);

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
    photoApproved &&
    videoApproved &&
    payoutComplete &&
    identitySatisfied &&
    qualificationsApproved &&
    tosComplete;

  return {
    photoComplete,
    photoApproved,
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

/**
 * Tutors may only persist availability once every onboarding gate is satisfied
 * (same bar as search visibility / tutorApproved).
 */
function canTutorSetAvailability(user) {
  if (!user || user.userType !== 'tutor') return false;
  const snapshot = evaluateTutorApproval(user);
  return isPhotoApproved(user) && snapshot.isFullyApproved;
}

/** Which gates still block availability — for API error payloads. */
function getTutorAvailabilityBlockReasons(user) {
  const snapshot = evaluateTutorApproval(user);
  const missing = [];
  if (!isPhotoApproved(user)) missing.push('photo');
  if (!snapshot.videoApproved) missing.push('video');
  if (!snapshot.payoutComplete) missing.push('payout');
  if (!snapshot.identitySatisfied) missing.push('identity');
  if (!snapshot.qualificationsApproved) missing.push('qualifications');
  if (!snapshot.tosComplete) missing.push('tos');
  return missing;
}

module.exports = {
  evaluateTutorApproval,
  applyApprovalIfReady,
  hasCustomProfilePhoto,
  hasPendingProfilePhoto,
  hasPendingPhotoReview,
  hasPendingVideoReview,
  hasPendingCredentialReview,
  tutorHasVideoRejected,
  tutorNeedsAdminReview,
  getTutorPendingReviewItems,
  getLatestReviewActivityAt,
  isPhotoApproved,
  hasPhotoSubmission,
  canTutorSetAvailability,
  getTutorAvailabilityBlockReasons,
};
