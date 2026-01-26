/**
 * Stripe Connect supported countries list
 * Source: https://stripe.com/global
 * Last updated: January 2026
 * 
 * Note: This list includes only countries with FULL Stripe Connect support
 * (not "Extended network" or "Preview" countries)
 */

// Countries where Stripe Connect is fully supported
const STRIPE_CONNECT_COUNTRIES = [
  // North America
  'United States',
  'Canada',
  'Mexico',
  
  // Europe
  'Austria',
  'Belgium',
  'Bulgaria',
  'Croatia',
  'Cyprus',
  'Czech Republic',
  'Denmark',
  'Estonia',
  'Finland',
  'France',
  'Germany',
  'Greece',
  'Hungary',
  'Ireland',
  'Italy',
  'Latvia',
  'Lithuania',
  'Luxembourg',
  'Malta',
  'Netherlands',
  'Norway',
  'Poland',
  'Portugal',
  'Romania',
  'Slovakia',
  'Slovenia',
  'Spain',
  'Sweden',
  'Switzerland',
  'United Kingdom',
  'Liechtenstein',
  'Gibraltar',
  
  // Asia Pacific
  'Australia',
  'New Zealand',
  'Japan',
  'Singapore',
  'Hong Kong',
  'Malaysia',
  'Thailand',
  
  // South America
  'Brazil',
  
  // Middle East & Africa (only countries with full support, not extended network)
  'United Arab Emirates'
];

/**
 * Check if Stripe Connect is available in a country
 * @param {string} country - Country name
 * @returns {boolean} - True if Stripe Connect is available
 */
function isStripeAvailable(country) {
  if (!country) return false;
  
  // Normalize country name (case-insensitive, trim whitespace)
  const normalizedCountry = country.trim();
  
  return STRIPE_CONNECT_COUNTRIES.some(
    supportedCountry => supportedCountry.toLowerCase() === normalizedCountry.toLowerCase()
  );
}

/**
 * Get recommended payout provider based on country
 * @param {string} residenceCountry - Country of residence
 * @returns {string} - Recommended provider: 'stripe', 'paypal', or 'manual'
 */
function getRecommendedPayoutProvider(residenceCountry) {
  if (isStripeAvailable(residenceCountry)) {
    return 'stripe';
  }
  
  // For countries without Stripe Connect, recommend PayPal or manual
  // PayPal is available in 200+ countries
  return 'paypal';
}

module.exports = {
  STRIPE_CONNECT_COUNTRIES,
  isStripeAvailable,
  getRecommendedPayoutProvider
};

