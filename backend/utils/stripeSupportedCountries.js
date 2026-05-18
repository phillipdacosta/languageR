/**
 * Countries where Stripe Connect Express is available.
 * Source: https://stripe.com/global (verified May 2026).
 *
 * The `residenceCountry` stored on User is the canonical English country name
 * (e.g. "Spain", "United States"), so we map name -> ISO 3166-1 alpha-2 here.
 *
 * Single source of truth; mirrored in
 * language-learning-app/src/app/data/stripe-supported-countries.ts.
 */

const STRIPE_CONNECT_COUNTRIES = Object.freeze([
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'AT', name: 'Austria' },
  { code: 'AU', name: 'Australia' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'DE', name: 'Germany' },
  { code: 'DK', name: 'Denmark' },
  { code: 'EE', name: 'Estonia' },
  { code: 'ES', name: 'Spain' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'GR', name: 'Greece' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'HR', name: 'Croatia' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IN', name: 'India' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'LV', name: 'Latvia' },
  { code: 'MT', name: 'Malta' },
  { code: 'MX', name: 'Mexico' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NO', name: 'Norway' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'RO', name: 'Romania' },
  { code: 'SE', name: 'Sweden' },
  { code: 'SG', name: 'Singapore' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'US', name: 'United States' },
]);

const NAME_TO_CODE = new Map(
  STRIPE_CONNECT_COUNTRIES.map(c => [c.name.toLowerCase(), c.code])
);

/** True if `residenceCountry` (English name) maps to a Stripe Connect country. */
function isStripeSupportedCountry(countryName) {
  if (!countryName) return false;
  return NAME_TO_CODE.has(String(countryName).trim().toLowerCase());
}

/** Map a `residenceCountry` English name to ISO 3166-1 alpha-2 (or null). */
function getStripeCountryCode(countryName) {
  if (!countryName) return null;
  return NAME_TO_CODE.get(String(countryName).trim().toLowerCase()) || null;
}

module.exports = {
  STRIPE_CONNECT_COUNTRIES,
  isStripeSupportedCountry,
  getStripeCountryCode,
};
