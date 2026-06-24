import { Params } from '@angular/router';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { LanguageService } from '../services/language.service';

export type StripeConnectReturnContext = 'profile-payout' | 'tutor-approval-wizard';

export interface StripeConnectOnboardPayloadInput {
  returnContext?: StripeConnectReturnContext;
  tutorApprovalStepId?: string | null;
  interfaceLocale?: string;
  [key: string]: unknown;
}

export interface StripeConnectReturnState {
  success: boolean;
  refresh: boolean;
  returnContext: StripeConnectReturnContext;
  tutorApprovalStepId: string | null;
}

export interface StripeConnectStatusSnapshot {
  success?: boolean;
  onboarded?: boolean;
  detailsSubmitted?: boolean;
  accountDisabled?: boolean;
  stripePendingReview?: boolean;
  stripeActionRequired?: boolean;
  requirementsCurrentlyDue?: string[];
}

export type StripeReturnToastKind = 'connected' | 'pending_review' | 'action_required' | 'incomplete';

export function isStripeConnectActionRequired(status: StripeConnectStatusSnapshot | null | undefined): boolean {
  return status?.stripeActionRequired === true;
}

/** True when the tutor submitted Stripe Connect info but Stripe has not fully enabled the account. */
export function isStripeConnectPendingReview(status: StripeConnectStatusSnapshot | null | undefined): boolean {
  if (!status?.success) return false;
  if (status.stripePendingReview === true) return true;
  return !!(
    status.detailsSubmitted &&
    !status.onboarded &&
    !isStripeConnectActionRequired(status) &&
    !status.accountDisabled
  );
}

export function classifyStripeReturnStatus(
  status: StripeConnectStatusSnapshot | null | undefined
): StripeReturnToastKind {
  if (!status?.success) return 'incomplete';
  if (status.onboarded) return 'connected';
  if (isStripeConnectActionRequired(status)) return 'action_required';
  if (isStripeConnectPendingReview(status)) return 'pending_review';
  return 'incomplete';
}

export const STRIPE_RETURN_TOAST_KEYS: Record<StripeReturnToastKind, string> = {
  connected: 'TUTOR_APPROVAL.STRIPE_RETURN_CONNECTED',
  pending_review: 'TUTOR_APPROVAL.STRIPE_RETURN_PENDING_REVIEW',
  action_required: 'TUTOR_APPROVAL.STRIPE_RETURN_ACTION_REQUIRED',
  incomplete: 'TUTOR_APPROVAL.STRIPE_RETURN_INCOMPLETE',
};

const STRIPE_QUERY_KEYS = [
  'stripe_success',
  'stripe_refresh',
  'stripeReturnContext',
  'tutorApprovalStep',
] as const;

/** Payload for POST /payments/stripe-connect/onboard. */
export function buildStripeConnectOnboardPayload(
  input: StripeConnectOnboardPayloadInput = {}
): Record<string, unknown> {
  const {
    returnContext = 'profile-payout',
    tutorApprovalStepId = null,
    interfaceLocale = readInterfaceLocale(),
    ...extra
  } = input;

  const { pathname, search, origin } = window.location;

  const returnParams = new URLSearchParams(search);
  returnParams.set('stripe_success', 'true');
  returnParams.set('stripeReturnContext', returnContext);
  if (returnContext === 'profile-payout') {
    returnParams.set('section', 'payments');
  }
  if (returnContext === 'tutor-approval-wizard' && tutorApprovalStepId) {
    returnParams.set('tutorApprovalStep', tutorApprovalStepId);
  }

  const refreshParams = new URLSearchParams(search);
  refreshParams.set('stripe_refresh', 'true');
  refreshParams.set('stripeReturnContext', returnContext);
  if (returnContext === 'profile-payout') {
    refreshParams.set('section', 'payments');
  }

  return {
    frontendOrigin: origin,
    returnPath: `${pathname}?${returnParams.toString()}`,
    refreshPath: `${pathname}?${refreshParams.toString()}`,
    interfaceLocale,
    returnContext,
    tutorApprovalStepId,
    ...extra,
  };
}

export function buildStripeConnectPayloadForApprovalWizardStep(
  stepId: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return buildStripeConnectOnboardPayload({
    returnContext: 'tutor-approval-wizard',
    tutorApprovalStepId: stepId,
    ...extra,
  });
}

export function buildStripeConnectPayloadForProfilePayout(
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return buildStripeConnectOnboardPayload({
    returnContext: 'profile-payout',
    ...extra,
  });
}

export function parseStripeConnectReturnParams(params: Params): StripeConnectReturnState | null {
  const success = params['stripe_success'] === 'true';
  const refresh = params['stripe_refresh'] === 'true';
  if (!success && !refresh) {
    return null;
  }

  const rawContext = params['stripeReturnContext'];
  const returnContext: StripeConnectReturnContext =
    rawContext === 'tutor-approval-wizard' ? 'tutor-approval-wizard' : 'profile-payout';

  const tutorApprovalStepId =
    typeof params['tutorApprovalStep'] === 'string' && params['tutorApprovalStep'].trim()
      ? params['tutorApprovalStep'].trim()
      : null;

  return {
    success,
    refresh,
    returnContext,
    tutorApprovalStepId,
  };
}

export function stripStripeConnectQueryParams(params: Params): Record<string, string | null> {
  const next: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(params)) {
    if (STRIPE_QUERY_KEYS.includes(key as (typeof STRIPE_QUERY_KEYS)[number])) {
      continue;
    }
    next[key] = Array.isArray(value) ? value[0] ?? null : value ?? null;
  }
  return next;
}

function readInterfaceLocale(): string {
  try {
    return localStorage.getItem(LanguageService.USER_LANGUAGE_KEY) || 'en';
  } catch {
    return 'en';
  }
}

/** Open Stripe dashboard / onboarding — new tab on web, in-app browser on native. */
export async function openStripeExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
