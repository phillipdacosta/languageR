import { Params } from '@angular/router';
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
