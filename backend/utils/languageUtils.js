/**
 * Language utilities for normalizing language codes
 */

// Comprehensive language name to ISO-639-1 code mapping
const LANGUAGE_MAP = {
  'Spanish': 'es',
  'spanish': 'es',
  'spanish lesson': 'es',
  'French': 'fr',
  'french': 'fr',
  'french lesson': 'fr',
  'German': 'de',
  'german': 'de',
  'german lesson': 'de',
  'Italian': 'it',
  'italian': 'it',
  'italian lesson': 'it',
  'Portuguese': 'pt',
  'portuguese': 'pt',
  'portuguese lesson': 'pt',
  'English': 'en',
  'english': 'en',
  'english lesson': 'en',
  'Chinese': 'zh',
  'chinese': 'zh',
  'chinese lesson': 'zh',
  'Japanese': 'ja',
  'japanese': 'ja',
  'japanese lesson': 'ja',
  'Korean': 'ko',
  'korean': 'ko',
  'korean lesson': 'ko',
  'Russian': 'ru',
  'russian': 'ru',
  'russian lesson': 'ru',
  'Arabic': 'ar',
  'arabic': 'ar',
  'arabic lesson': 'ar',
  'Hindi': 'hi',
  'hindi': 'hi',
  'hindi lesson': 'hi',
  'Turkish': 'tr',
  'turkish': 'tr',
  'turkish lesson': 'tr',
  'Dutch': 'nl',
  'dutch': 'nl',
  'dutch lesson': 'nl',
  'Swedish': 'sv',
  'swedish': 'sv',
  'swedish lesson': 'sv',
  'Polish': 'pl',
  'polish': 'pl',
  'polish lesson': 'pl',
  // Also handle ISO codes directly (in case they're already normalized)
  'es': 'es',
  'fr': 'fr',
  'de': 'de',
  'it': 'it',
  'pt': 'pt',
  'en': 'en',
  'zh': 'zh',
  'ja': 'ja',
  'ko': 'ko',
  'ru': 'ru',
  'ar': 'ar',
  'hi': 'hi',
  'tr': 'tr',
  'nl': 'nl',
  'sv': 'sv',
  'pl': 'pl'
};

// Valid ISO-639-1 codes
const VALID_ISO_CODES = [
  'es', 'fr', 'de', 'it', 'pt', 'en', 'zh', 'ja', 'ko', 'ru', 'ar',
  'hi', 'tr', 'nl', 'sv', 'pl'
];

/**
 * Normalize language name to ISO-639-1 code
 * @param {string} language - Language name (e.g., "Spanish", "spanish", "es")
 * @returns {string} ISO-639-1 code (e.g., "es")
 * @throws {Error} If language cannot be normalized
 */
function normalizeLanguageCode(language) {
  if (!language) {
    throw new Error('Language is required');
  }
  
  // Convert to lowercase for case-insensitive lookup
  const lookupKey = language.toLowerCase().trim();
  const normalized = LANGUAGE_MAP[lookupKey];
  
  if (!normalized) {
    // If not in map, check if it's already a valid ISO code
    if (VALID_ISO_CODES.includes(lookupKey)) {
      return lookupKey;
    }
    
    throw new Error(`Unsupported language: "${language}". Must be a supported language name or ISO-639-1 code.`);
  }
  
  // Validate that the normalized code is valid
  if (!VALID_ISO_CODES.includes(normalized)) {
    throw new Error(`Invalid ISO code mapping for "${language}": ${normalized}`);
  }
  
  return normalized;
}

/**
 * Check if a language code is valid
 * @param {string} code - ISO-639-1 code
 * @returns {boolean}
 */
function isValidLanguageCode(code) {
  return VALID_ISO_CODES.includes(code?.toLowerCase());
}

module.exports = {
  LANGUAGE_MAP,
  VALID_ISO_CODES,
  normalizeLanguageCode,
  isValidLanguageCode
};

