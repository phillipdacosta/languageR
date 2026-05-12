/**
 * Maps ngx-translate / app language codes to BCP 47 locales for Ionic
 * `ion-datetime` (month names, weekday labels, Clear/Today, etc.).
 */
export function translateLangToDatetimeLocale(lang: string | undefined): string {
  const raw = (lang || 'en').trim().replace('_', '-');
  if (raw.length >= 5 && raw.includes('-')) {
    return raw;
  }
  const primary = raw.split('-')[0].toLowerCase();
  const map: Record<string, string> = {
    en: 'en-US',
    es: 'es-ES',
    pt: 'pt-BR',
    zh: 'zh-CN',
    ja: 'ja-JP',
    ko: 'ko-KR',
    ar: 'ar-SA',
    he: 'he-IL',
    fa: 'fa-IR',
    hi: 'hi-IN',
    vi: 'vi-VN',
    th: 'th-TH',
    uk: 'uk-UA',
    el: 'el-GR',
    cs: 'cs-CZ',
    da: 'da-DK',
    fi: 'fi-FI',
    no: 'nb-NO',
    sv: 'sv-SE',
    nl: 'nl-NL',
    pl: 'pl-PL',
    ro: 'ro-RO',
    ru: 'ru-RU',
    tr: 'tr-TR',
    id: 'id-ID',
    ms: 'ms-MY',
    de: 'de-DE',
    fr: 'fr-FR',
    it: 'it-IT',
  };
  return map[primary] || `${primary}-${primary.toUpperCase()}`;
}
