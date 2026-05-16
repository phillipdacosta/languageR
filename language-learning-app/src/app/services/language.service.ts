import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, forkJoin, of } from 'rxjs';
import { catchError, filter, take } from 'rxjs/operators';
import { SIGNUP_LANGUAGE_COMPLETED_LS_KEY } from '../signup-language/language-select-flow.storage';

export type SupportedLanguage =
  | 'en' | 'es' | 'fr' | 'pt' | 'de'
  | 'it' | 'ru' | 'zh' | 'ja' | 'ko'
  | 'ar' | 'hi' | 'nl' | 'pl' | 'tr'
  | 'sv' | 'no' | 'da' | 'fi' | 'el'
  | 'cs' | 'ro' | 'uk' | 'vi' | 'th'
  | 'id' | 'ms' | 'he' | 'fa';

export interface LanguageOption {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  flag: string;
}

@Injectable({
  providedIn: 'root'
})
export class LanguageService {
  private currentLanguageSubject = new BehaviorSubject<SupportedLanguage>('en');
  public currentLanguage$: Observable<SupportedLanguage> = this.currentLanguageSubject.asObservable();

  /**
   * All locale JSON is loaded and applied before any `translate.use()` call.
   * Otherwise ngx-translate v17 uses TranslateNoOpLoader with `{}`, which can
   * overwrite real strings and force English fallback for nested keys.
   */
  private readonly translationsBootstrapped = new BehaviorSubject<boolean>(false);

  private static readonly RTL_LANGUAGES: ReadonlySet<SupportedLanguage> = new Set<SupportedLanguage>([
    'ar', 'he', 'fa',
  ]);

  /**
   * Durable record of the language code the user explicitly picked
   * (via `setLanguage(..., { source: 'user' })`). The value is the
   * code itself (e.g. `'de'`), not a boolean, so that even after a
   * logout/clear cycle we still know *what* the user wanted. Cleared
   * by `consumePendingPick()` once the backend has confirmed the value.
   *
   * Listed in `LanguageService.PRESERVE_THROUGH_CLEAR_KEYS` so the auth
   * service preserves it through `localStorage.clear()` in logout flows.
   */
  public static readonly USER_PICK_KEY = 'userLanguagePicked';

  /** localStorage key for the active interface language (set by every setLanguage). */
  public static readonly USER_LANGUAGE_KEY = 'userLanguage';

  /** Keys that must survive `localStorage.clear()` during logout/auth reset. */
  public static readonly PRESERVE_THROUGH_CLEAR_KEYS: readonly string[] = [
    LanguageService.USER_LANGUAGE_KEY,
    LanguageService.USER_PICK_KEY,
  ];

  public readonly supportedLanguages: LanguageOption[] = [
    { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧' },
    { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
    { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷' },
    { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
    { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
    { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
    { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
    { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
    { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
    { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱' },
    { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
    { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
    { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪' },
    { code: 'no', name: 'Norwegian', nativeName: 'Norsk', flag: '🇳🇴' },
    { code: 'da', name: 'Danish', nativeName: 'Dansk', flag: '🇩🇰' },
    { code: 'fi', name: 'Finnish', nativeName: 'Suomi', flag: '🇫🇮' },
    { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷' },
    { code: 'cs', name: 'Czech', nativeName: 'Čeština', flag: '🇨🇿' },
    { code: 'ro', name: 'Romanian', nativeName: 'Română', flag: '🇷🇴' },
    { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦' },
    { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
    { code: 'th', name: 'Thai', nativeName: 'ไทย', flag: '🇹🇭' },
    { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: '🇮🇩' },
    { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', flag: '🇲🇾' },
    { code: 'he', name: 'Hebrew', nativeName: 'עברית', flag: '🇮🇱' },
    { code: 'fa', name: 'Persian', nativeName: 'فارسی', flag: '🇮🇷' }
  ];

  constructor(
    private translate: TranslateService,
    private http: HttpClient
  ) {
    this.bootstrapAllTranslations();
  }

  /**
   * Load every supported locale once, then register fallback. Must finish
   * before `translate.use()` so the noop loader never clobbers real bundles.
   */
  private bootstrapAllTranslations(): void {
    const requests = this.supportedLanguages.map((lang) =>
      this.http.get<Record<string, unknown>>(`./assets/i18n/${lang.code}.json`).pipe(
        catchError((err) => {
          console.warn(`Failed to load translations for ${lang.code}:`, err);
          return of({} as Record<string, unknown>);
        })
      )
    );

    forkJoin(requests).subscribe((bundles) => {
      bundles.forEach((data, i) => {
        const code = this.supportedLanguages[i].code;
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
          this.translate.setTranslation(code, data as never, false);
        }
      });
      this.translate.setFallbackLang('en');
      this.translationsBootstrapped.next(true);
    });
  }

  private runWhenTranslationsReady(fn: () => void): void {
    if (this.translationsBootstrapped.value) {
      fn();
      return;
    }
    this.translationsBootstrapped
      .pipe(filter((ready) => ready === true), take(1))
      .subscribe(() => fn());
  }

  /** Emits once when all locale JSON bundles are registered with ngx-translate. */
  public whenTranslationsReady(): Observable<boolean> {
    return this.translationsBootstrapped.pipe(filter((ready) => ready === true), take(1));
  }

  public areTranslationsReady(): boolean {
    return this.translationsBootstrapped.value;
  }

  /**
   * Initialize language with smart detection priority:
   * 1. User profile language (if provided)
   * 2. localStorage (previous selection)
   * 3. Browser languages (navigator.languages → navigator.language)
   * 4. Default to English
   *
   * After a confident pick (any of the above paths), marks the initial
   * interface-language selection as complete so the standalone
   * /signup-language picker is auto-skipped on future visits. Users can
   * still change language via existing switchers in onboarding etc.
   *
   * Calls setLanguage with source: 'auto' so USER_PICK_KEY is NOT
   * touched — auto-detected/persisted application must not masquerade
   * as an explicit user pick and force-overwrite the server's saved
   * preference on the next sync. Browser auto-detect still propagates
   * to a brand-new user's server record via `initializeUser`, which
   * forwards `localStorage.userLanguage` in the POST /api/users payload.
   */
  public initializeLanguage(userProfileLanguage?: string): void {
    this.runWhenTranslationsReady(() => {
      let languageToUse: SupportedLanguage;

      if (userProfileLanguage && this.isSupported(userProfileLanguage)) {
        console.log('🌐 Using language from user profile:', userProfileLanguage);
        languageToUse = userProfileLanguage as SupportedLanguage;
      } else {
        const savedLang = localStorage.getItem(LanguageService.USER_LANGUAGE_KEY);
        if (savedLang && this.isSupported(savedLang)) {
          console.log('🌐 Using language from localStorage:', savedLang);
          languageToUse = savedLang as SupportedLanguage;
        } else {
          const detected = this.detectBrowserLanguage();
          console.log('🌐 Using browser/default language:', detected ?? 'en');
          languageToUse = detected ?? 'en';
        }
      }

      this.setLanguage(languageToUse, { source: 'auto' });

      try {
        localStorage.setItem(SIGNUP_LANGUAGE_COMPLETED_LS_KEY, '1');
      } catch {
        /* localStorage may be unavailable (private mode); silently ignore */
      }
    });
  }

  /**
   * Scan navigator.languages (plural) for the first supported language code,
   * falling back to navigator.language and ngx-translate's helper. Region
   * subtags are ignored — `pt-BR` and `pt-PT` both match `pt.json`.
   */
  private detectBrowserLanguage(): SupportedLanguage | null {
    const candidates: string[] = [];
    if (typeof navigator !== 'undefined') {
      if (Array.isArray((navigator as any).languages)) {
        candidates.push(...(navigator.languages as readonly string[]));
      }
      if (navigator.language) candidates.push(navigator.language);
    }
    const fallback = this.translate.getBrowserLang();
    if (fallback) candidates.push(fallback);

    for (const tag of candidates) {
      if (!tag) continue;
      const base = tag.toLowerCase().split('-')[0];
      if (this.isSupported(base)) {
        return base as SupportedLanguage;
      }
    }
    return null;
  }

  /**
   * Set the current interface language.
   *
   * `source` distinguishes user-initiated picks from automatic application:
   * - 'user' (default) — the user explicitly chose this language (picker,
   *   profile settings). Writes USER_PICK_KEY = lang so AppComponent will
   *   push this choice to the backend on the next sync, surviving any
   *   localStorage.clear() in the auth flow (the auth service preserves
   *   the key explicitly).
   * - 'auto' — applied from a persisted source (server profile, localStorage,
   *   browser detect). Does NOT touch USER_PICK_KEY.
   */
  public setLanguage(
    lang: SupportedLanguage,
    options: { source?: 'user' | 'auto' } = {}
  ): void {
    this.runWhenTranslationsReady(() => {
      const source = options.source ?? 'user';

      if (!this.isSupported(lang)) {
        console.warn(`Language ${lang} is not supported. Falling back to English.`);
        lang = 'en';
      }

      console.log('🌐 Setting language to:', lang, `(source: ${source})`);
      // Update subject before `translate.use()` so synchronous `onLangChange`
      // subscribers (and Intl formatters reading `getCurrentLanguage()`) see
      // the new code immediately — `translate.use` may emit during its call.
      this.currentLanguageSubject.next(lang);
      this.translate.use(lang);

      localStorage.setItem(LanguageService.USER_LANGUAGE_KEY, lang);
      if (source === 'user') {
        localStorage.setItem(LanguageService.USER_PICK_KEY, lang);
      }

      if (typeof document !== 'undefined') {
        document.documentElement.lang = lang;
        document.documentElement.dir = LanguageService.RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
      }
    });
  }

  /**
   * Return the durable explicit-pick value (if any). The user picked this
   * language via the picker / profile UI; the backend may or may not have
   * been synced. Returns `null` if no pick is recorded or the recorded
   * value is no longer supported.
   */
  public getPendingPick(): SupportedLanguage | null {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(LanguageService.USER_PICK_KEY);
    if (!value || !this.isSupported(value)) return null;
    return value as SupportedLanguage;
  }

  /**
   * Clear the durable explicit-pick value. Call after the backend has been
   * told about (or already matches) the local pick.
   */
  public consumePendingPick(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(LanguageService.USER_PICK_KEY);
  }

  /**
   * Get the current language
   */
  public getCurrentLanguage(): SupportedLanguage {
    return this.currentLanguageSubject.value;
  }

  /**
   * Check if a language code is supported
   */
  public isSupported(lang: string): boolean {
    return this.supportedLanguages.some(l => l.code === lang);
  }

  /**
   * Get language option by code
   */
  public getLanguageOption(code: string): LanguageOption | undefined {
    return this.supportedLanguages.find(l => l.code === code);
  }

  /**
   * Get instant translation (synchronous)
   * Use this in TypeScript code when you need immediate translation
   */
  public instant(key: string, params?: any): string {
    return this.translate.instant(key, params);
  }

  /**
   * Get translation as observable
   * Use this when you want to react to language changes
   */
  public get(key: string, params?: any): Observable<string> {
    return this.translate.get(key, params);
  }
}

















