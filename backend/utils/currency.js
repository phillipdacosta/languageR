/**
 * Currency utilities for local-currency charging.
 *
 * The platform's internal ledger is always USD. These helpers decide which
 * presentment currency a student should be charged in (USD/EUR/GBP) based on
 * their residence country. Everything outside the Eurozone / UK falls back to
 * USD so we never charge a currency we don't explicitly support.
 */

// Currencies we are willing to charge students in.
const SUPPORTED = ['usd', 'eur', 'gbp'];

// Display symbols for supported currencies.
const SYMBOLS = { usd: '$', eur: '€', gbp: '£' };

// Eurozone member states (ISO-3166 alpha-2). Charged in EUR.
const EUROZONE = [
  'AT', 'BE', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES', 'HR'
];

// Country -> currency overrides outside the Eurozone.
const COUNTRY_TO_CURRENCY = {
  GB: 'gbp', UK: 'gbp'
};
EUROZONE.forEach((code) => { COUNTRY_TO_CURRENCY[code] = 'eur'; });

/**
 * Normalize a free-text country value to an ISO alpha-2 code where possible.
 * Profiles may store either a code ("DE") or a name ("Germany").
 */
const COUNTRY_NAME_TO_CODE = {
  'united kingdom': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB',
  'great britain': 'GB',
  germany: 'DE', france: 'FR', spain: 'ES', italy: 'IT', ireland: 'IE',
  netherlands: 'NL', belgium: 'BE', austria: 'AT', portugal: 'PT',
  greece: 'GR', finland: 'FI', 'united states': 'US', usa: 'US',
  'united states of america': 'US'
};

function toCountryCode(country) {
  if (!country || typeof country !== 'string') return '';
  const trimmed = country.trim();
  if (!trimmed) return '';
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return COUNTRY_NAME_TO_CODE[trimmed.toLowerCase()] || '';
}

/**
 * Map a country to a supported charge currency.
 * @param {String} country - ISO code or country name
 * @returns {'usd'|'eur'|'gbp'}
 */
function currencyForCountry(country) {
  const code = toCountryCode(country);
  return COUNTRY_TO_CURRENCY[code] || 'usd';
}

/**
 * Determine the currency a student should be charged in.
 * Prefers residence country (where they bank/live), then nationality.
 * @param {Object} user - User document (needs residenceCountry / country)
 * @returns {'usd'|'eur'|'gbp'}
 */
function getChargeCurrency(user) {
  if (!user) return 'usd';
  return currencyForCountry(user.residenceCountry || user.country || '');
}

/**
 * Format an amount with its currency symbol (server-side, for messages/logs).
 */
function formatMoney(amount, currency = 'usd') {
  const code = (currency || 'usd').toLowerCase();
  const symbol = SYMBOLS[code];
  const value = Number(amount || 0).toFixed(2);
  return symbol ? `${symbol}${value}` : `${value} ${code.toUpperCase()}`;
}

module.exports = {
  SUPPORTED,
  SYMBOLS,
  COUNTRY_TO_CURRENCY,
  toCountryCode,
  currencyForCountry,
  getChargeCurrency,
  formatMoney
};
