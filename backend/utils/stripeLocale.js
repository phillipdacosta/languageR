/**
 * Map Barnabi interface language codes to Stripe Connect UI locale values.
 * Note: hosted Account Links (v1/account_links) do not accept a locale parameter;
 * Stripe uses the browser default with an in-flow language picker. This mapping is
 * reserved for embedded Connect onboarding (loadConnectAndInitialize locale).
 */
const BARNABI_TO_STRIPE_LOCALE = {
  en: 'en',
  es: 'es',
  fr: 'fr',
  pt: 'pt',
  de: 'de',
  it: 'it',
  ru: 'ru',
  zh: 'zh',
  ja: 'ja',
  ko: 'ko',
  nl: 'nl',
  pl: 'pl',
  tr: 'tr',
  sv: 'sv',
  no: 'nb',
  da: 'da',
  fi: 'fi',
  el: 'el',
  cs: 'cs',
  ro: 'ro',
  vi: 'vi',
  th: 'th',
  id: 'id',
  ms: 'ms',
  // Stripe Connect onboarding has no dedicated locale — fall back to browser/default.
  ar: 'auto',
  he: 'auto',
  fa: 'auto',
  hi: 'auto',
  uk: 'auto',
};

const STRIPE_SUPPORTED_LOCALES = new Set([
  'auto', 'bg', 'cs', 'da', 'de', 'el', 'en', 'en-GB', 'es', 'es-419', 'et', 'fi', 'fil',
  'fr', 'fr-CA', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'mt', 'nb', 'nl',
  'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'vi', 'zh', 'zh-HK', 'zh-TW',
]);

function resolveStripeLocale(interfaceLocale) {
  if (!interfaceLocale || typeof interfaceLocale !== 'string') {
    return 'auto';
  }
  const normalized = interfaceLocale.trim().toLowerCase().split(/[-_]/)[0];
  const mapped = BARNABI_TO_STRIPE_LOCALE[normalized] || normalized;
  if (STRIPE_SUPPORTED_LOCALES.has(mapped)) {
    return mapped;
  }
  return 'auto';
}

module.exports = { resolveStripeLocale };
