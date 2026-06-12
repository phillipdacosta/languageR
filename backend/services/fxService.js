/**
 * FX Service - USD -> EUR/GBP conversion for local-currency charging.
 *
 * Pricing is anchored in USD. When we charge a student in their local currency
 * we convert the USD amount using a daily reference rate plus a small buffer so
 * Stripe's settlement/conversion spread never makes the platform lose money.
 *
 * Rates are cached in-memory (TTL) and persisted to disk so a cold start or a
 * temporary FX-API outage still has a last-known rate. If no rate is available
 * at all, callers should fall back to charging in USD.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const FX_API_URL = 'https://open.er-api.com/v6/latest/USD';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const CACHE_FILE = path.join(__dirname, '..', 'data', 'fx-rates.json');

// Buffer added on top of the mid-market rate (covers Stripe's conversion spread).
const FX_BUFFER = parseFloat(process.env.FX_BUFFER || '0.03');

// Conservative hardcoded fallback (only used if API + disk cache both fail on a
// fresh process). Intentionally generous so we never undercharge.
const FALLBACK_RATES = { eur: 0.95, gbp: 0.82 };

const SUPPORTED = ['eur', 'gbp'];

let memory = null; // { rates: {eur, gbp}, fetchedAt: number }

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function readDiskCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.rates) return parsed;
  } catch (_) { /* no cache yet */ }
  return null;
}

function writeDiskCache(data) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.error('⚠️ [FX] Failed to persist rate cache:', err.message);
  }
}

async function fetchFreshRates() {
  const res = await axios.get(FX_API_URL, { timeout: 8000 });
  const data = res.data;
  if (!data || data.result !== 'success' || !data.rates) {
    throw new Error('Unexpected FX API response');
  }
  const rates = {
    eur: data.rates.EUR,
    gbp: data.rates.GBP
  };
  if (!rates.eur || !rates.gbp) throw new Error('FX API missing EUR/GBP');
  return rates;
}

/**
 * Return current USD-based rates, preferring fresh -> memory -> disk -> fallback.
 * Never throws; returns an object with a `source` field for observability.
 */
async function getRates() {
  // Fresh in-memory cache
  if (memory && (Date.now() - memory.fetchedAt) < CACHE_TTL_MS) {
    return { rates: memory.rates, source: 'memory' };
  }

  // Try the live API
  try {
    const rates = await fetchFreshRates();
    memory = { rates, fetchedAt: Date.now() };
    writeDiskCache(memory);
    return { rates, source: 'api' };
  } catch (err) {
    console.error('⚠️ [FX] Live rate fetch failed:', err.message);
  }

  // Stale in-memory
  if (memory && memory.rates) return { rates: memory.rates, source: 'memory-stale' };

  // Disk cache (survives restarts)
  const disk = readDiskCache();
  if (disk && disk.rates) {
    memory = disk;
    return { rates: disk.rates, source: 'disk' };
  }

  // Last resort
  return { rates: FALLBACK_RATES, source: 'fallback' };
}

/**
 * Get the buffered display/charge rate for a single currency.
 * @returns {Promise<{ currency:string, rate:number|null, buffer:number }>}
 */
async function getBufferedRate(currency) {
  const code = (currency || 'usd').toLowerCase();
  if (code === 'usd') return { currency: 'usd', rate: 1, buffer: 0 };
  if (!SUPPORTED.includes(code)) return { currency: 'usd', rate: 1, buffer: 0 };

  const { rates } = await getRates();
  const base = rates[code];
  if (!base) return { currency: 'usd', rate: null, buffer: 0 };

  const buffered = base * (1 + FX_BUFFER);
  return { currency: code, rate: round2(buffered * 1e6) / 1e6, buffer: FX_BUFFER };
}

/**
 * Convert a USD amount to the target currency using the buffered daily rate.
 * Returns null if conversion isn't possible (caller should charge USD).
 *
 * @param {Number} usdAmount
 * @param {String} toCurrency - 'usd' | 'eur' | 'gbp'
 * @returns {Promise<null|{ currency, amount, baseRate, bufferedRate, buffer }>}
 */
async function convert(usdAmount, toCurrency) {
  const code = (toCurrency || 'usd').toLowerCase();
  const amountUsd = Number(usdAmount) || 0;

  if (code === 'usd') {
    return { currency: 'usd', amount: round2(amountUsd), baseRate: 1, bufferedRate: 1, buffer: 0 };
  }
  if (!SUPPORTED.includes(code)) return null;

  const { rates, source } = await getRates();
  const baseRate = rates[code];
  if (!baseRate) return null;

  const bufferedRate = baseRate * (1 + FX_BUFFER);
  const amount = round2(amountUsd * bufferedRate);

  console.log(
    `💱 [FX] ${amountUsd.toFixed(2)} USD -> ${amount.toFixed(2)} ${code.toUpperCase()} ` +
    `(base ${baseRate}, +${(FX_BUFFER * 100).toFixed(1)}% buffer, source: ${source})`
  );

  return { currency: code, amount, baseRate, bufferedRate, buffer: FX_BUFFER };
}

module.exports = {
  SUPPORTED,
  FX_BUFFER,
  getRates,
  getBufferedRate,
  convert
};
