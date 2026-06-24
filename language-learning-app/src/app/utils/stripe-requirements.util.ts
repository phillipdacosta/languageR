import { TranslateService } from '@ngx-translate/core';

/** Map a Stripe Connect requirement field name to an i18n label key. */
export function mapStripeRequirementToLabelKey(requirement: string): string {
  const field = (requirement || '').trim().toLowerCase();
  if (!field) {
    return 'TUTOR_APPROVAL.STRIPE_REQ_GENERIC';
  }

  if (
    field.includes('relationship.representative') ||
    field.includes('representative') ||
    (/^person[._]/.test(field) && field.includes('verification'))
  ) {
    return 'TUTOR_APPROVAL.STRIPE_REQ_REPRESENTATIVE';
  }

  if (field.includes('verification.document') || field.includes('verification.additional_document')) {
    return 'TUTOR_APPROVAL.STRIPE_REQ_IDENTITY';
  }

  if (field.includes('external_account') || field.includes('bank_account')) {
    return 'TUTOR_APPROVAL.STRIPE_REQ_BANK';
  }

  if (field.startsWith('individual.address') || field.includes('.address.')) {
    return 'TUTOR_APPROVAL.STRIPE_REQ_ADDRESS';
  }

  if (
    field.includes('individual.dob') ||
    field.includes('individual.first_name') ||
    field.includes('individual.last_name') ||
    field.includes('individual.email') ||
    field.includes('individual.phone') ||
    field.includes('individual.id_number') ||
    field.includes('individual.ssn')
  ) {
    return 'TUTOR_APPROVAL.STRIPE_REQ_PERSONAL_INFO';
  }

  if (field.includes('business_profile') || field.includes('company.')) {
    return 'TUTOR_APPROVAL.STRIPE_REQ_BUSINESS';
  }

  if (field.includes('tos_acceptance')) {
    return 'TUTOR_APPROVAL.STRIPE_REQ_TOS';
  }

  return 'TUTOR_APPROVAL.STRIPE_REQ_GENERIC';
}

/** Deduplicate requirement labels while preserving first-seen order. */
export function uniqueStripeRequirementLabelKeys(requirements: string[] | null | undefined): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const requirement of requirements || []) {
    const key = mapStripeRequirementToLabelKey(requirement);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/** Build tutor-facing copy from Stripe requirement field names. */
export function buildStripeActionDetailText(
  translate: TranslateService,
  requirements: string[] | null | undefined
): string {
  const labelKeys = uniqueStripeRequirementLabelKeys(requirements);
  if (labelKeys.length === 0) {
    return translate.instant('TUTOR_APPROVAL.STRIPE_ACTION_DESC');
  }

  const labels = labelKeys.map((key) => translate.instant(key));
  if (labels.length === 1) {
    return translate.instant('TUTOR_APPROVAL.STRIPE_ACTION_DESC_ONE', { step: labels[0] });
  }

  return translate.instant('TUTOR_APPROVAL.STRIPE_ACTION_DESC_MANY', {
    steps: labels.join(translate.instant('TUTOR_APPROVAL.STRIPE_REQ_LIST_SEPARATOR')),
  });
}
