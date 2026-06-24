/** ISO 639-1 → English display name for admin surfaces */
const ISO_LANGUAGE_LABELS = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ar: 'Arabic',
  hi: 'Hindi',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  sv: 'Swedish',
  no: 'Norwegian',
  da: 'Danish',
  fi: 'Finnish',
  el: 'Greek',
  cs: 'Czech',
  ro: 'Romanian',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  ms: 'Malay',
  he: 'Hebrew',
  fa: 'Persian',
};

function languageLabel(code) {
  if (!code || typeof code !== 'string') return '';
  const normalized = code.trim().toLowerCase();
  if (!normalized) return '';
  return ISO_LANGUAGE_LABELS[normalized] || normalized.toUpperCase();
}

function buildTutorLanguageProfile(user) {
  const nativeCode = user?.nativeLanguage || '';
  const communicatesBestIn = languageLabel(nativeCode);

  const teachingLanguages = user?.onboardingData?.languages || [];
  const teaches = Array.isArray(teachingLanguages)
    ? teachingLanguages.filter(Boolean).join(', ')
    : '';

  const spokenEntries = user?.spokenLanguages || [];
  const alsoSpeaks = Array.isArray(spokenEntries)
    ? spokenEntries
        .filter((entry) => entry?.code)
        .map((entry) => `${languageLabel(entry.code)} (${entry.level || '?'})`)
        .join(', ')
    : '';

  return {
    communicatesBestIn,
    communicatesBestInCode: nativeCode,
    teaches,
    alsoSpeaks,
    hasLanguageInfo: !!(communicatesBestIn || teaches || alsoSpeaks),
  };
}

module.exports = {
  languageLabel,
  buildTutorLanguageProfile,
};
