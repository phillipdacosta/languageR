import { api } from './api';

export type SubscriptionTier = 'free' | 'premium';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export type SubscriptionSummary = {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  renewsAt: string | null;
  canceledAt: string | null;
  trialEndsAt: string | null;
  source: 'stripe' | 'apple_iap' | 'google_iap' | 'comp' | null;
};

export type ClientEntitlements = {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  features: {
    adaptivePlanAi: boolean;
    goalChangeCooldownDays: number;
    materialRecommendationsPostLesson: boolean;
    dailyMicroTaskLimit: number | null;
  };
};

export type SubscriptionMeResponse = {
  success: boolean;
  subscription: SubscriptionSummary;
  entitlements: ClientEntitlements;
};

export type CheckoutUrlResponse = {
  success: boolean;
  url: string;
};

/**
 * Read the current user's subscription summary + entitlements.
 */
export async function getMySubscription(): Promise<SubscriptionMeResponse> {
  return api.get<SubscriptionMeResponse>('/subscription/me');
}

/**
 * Open a Stripe Checkout Session and return the URL to launch.
 * Mobile callers should hand the URL to expo-web-browser.openBrowserAsync.
 */
export async function startCheckout(opts?: {
  successPath?: string;
  cancelPath?: string;
}): Promise<CheckoutUrlResponse> {
  return api.post<CheckoutUrlResponse>('/subscription/checkout', opts || {});
}

/**
 * Open the Stripe Customer Portal so the user can cancel / update payment.
 */
export async function openPortal(opts?: {
  returnPath?: string;
}): Promise<CheckoutUrlResponse> {
  return api.post<CheckoutUrlResponse>('/subscription/portal', opts || {});
}
