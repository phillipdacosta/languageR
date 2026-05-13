import { Injectable } from '@angular/core';
import { SupportedLanguage } from './language.service';

/** `Intl.DisplayNames` exists at runtime in modern browsers; TS `lib` may omit it (e.g. es2018). */
type IntlDisplayNamesInstance = { of(code: string): string | undefined };
type IntlDisplayNamesCtor = new (
  locales: string | string[],
  options: { type: 'region' | 'language' }
) => IntlDisplayNamesInstance;

function createDisplayNames(locale: string, type: 'region' | 'language'): IntlDisplayNamesInstance | null {
  const Ctor = (Intl as unknown as { DisplayNames?: IntlDisplayNamesCtor }).DisplayNames;
  if (!Ctor) {
    return null;
  }
  try {
    return new Ctor([locale], { type });
  } catch {
    return null;
  }
}

/** English display names used in DB / selection → ISO 639-1 for Intl language names. */
export const TEACHABLE_ENGLISH_NAME_TO_ISO639: Readonly<Record<string, string>> = {
  English: 'en',
  Spanish: 'es',
  French: 'fr',
  German: 'de',
  Italian: 'it',
  Portuguese: 'pt',
  Russian: 'ru',
  Chinese: 'zh',
  Japanese: 'ja',
  Korean: 'ko',
  Arabic: 'ar',
  Hindi: 'hi',
  Dutch: 'nl',
  Polish: 'pl',
  Turkish: 'tr',
  Swedish: 'sv',
  Norwegian: 'no',
  Danish: 'da',
  Finnish: 'fi',
  Greek: 'el',
  Czech: 'cs',
  Romanian: 'ro',
  Ukrainian: 'uk',
  Vietnamese: 'vi',
  Thai: 'th',
  Indonesian: 'id',
  Malay: 'ms',
  Hebrew: 'he',
  Persian: 'fa',
};

@Injectable({
  providedIn: 'root',
})
export class LocaleDisplayService {
  /** BCP 47 tags that Intl handles better than bare 2-letter app codes. */
  private readonly uiLocaleByAppLang: Partial<Record<SupportedLanguage, string>> = {
    no: 'nb-NO',
    zh: 'zh-CN',
  };

  private resolveUiLocale(ui: SupportedLanguage): string {
    return this.uiLocaleByAppLang[ui] ?? ui;
  }

  /**
   * Localized region name (e.g. "España", "Estados Unidos") for ISO 3166-1 alpha-2.
   */
  regionName(regionCode: string, ui: SupportedLanguage): string {
    if (!regionCode) return '';
    const code = regionCode.trim().toUpperCase();
    const dn = createDisplayNames(this.resolveUiLocale(ui), 'region');
    if (dn) {
      return dn.of(code) ?? regionCode;
    }
    return regionCode;
  }

  /**
   * Localized language name in the UI language (e.g. Spanish UI → "inglés" for en).
   * `iso639` is a 2-letter ISO 639-1 code (matches app language codes).
   */
  languageName(iso639: string, ui: SupportedLanguage): string {
    if (!iso639) return '';
    let code = iso639.trim().toLowerCase();
    if (code === 'no') {
      code = 'nb';
    }
    const dn = createDisplayNames(this.resolveUiLocale(ui), 'language');
    if (dn) {
      return dn.of(code) ?? iso639;
    }
    return iso639;
  }

  localizedCountryRow(
    canonicalEnglishName: string,
    ui: SupportedLanguage,
    regionCodeLower: string | null,
    otherFallback: string
  ): string {
    if (canonicalEnglishName === 'Other') {
      return otherFallback;
    }
    if (regionCodeLower) {
      return this.regionName(regionCodeLower, ui);
    }
    return canonicalEnglishName;
  }
}
