import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';

export type SupportedLanguage = 'en' | 'es' | 'fr' | 'pt' | 'de';

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

  public readonly supportedLanguages: LanguageOption[] = [
    { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧' },
    { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
    { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷' },
    { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' }
  ];

  constructor(
    private translate: TranslateService,
    private http: HttpClient
  ) {
    // Set default language
    this.translate.setDefaultLang('en');
    
    // Manually set up translation loader for version 17.x
    this.setupTranslations();
  }

  /**
   * Set up translations manually for ngx-translate v17
   */
  private setupTranslations(): void {
    this.supportedLanguages.forEach(lang => {
      this.http.get<any>(`./assets/i18n/${lang.code}.json`).subscribe(
        translations => {
          this.translate.setTranslation(lang.code, translations);
        },
        error => {
          console.warn(`Failed to load translations for ${lang.code}:`, error);
        }
      );
    });
  }

  /**
   * Initialize language with smart detection priority:
   * 1. User profile language (if provided)
   * 2. localStorage (previous selection)
   * 3. Browser language
   * 4. Default to English
   */
  public initializeLanguage(userProfileLanguage?: string): void {
    let languageToUse: SupportedLanguage;

    if (userProfileLanguage && this.isSupported(userProfileLanguage)) {
      // Use user profile language
      console.log('🌐 Using language from user profile:', userProfileLanguage);
      languageToUse = userProfileLanguage as SupportedLanguage;
    } else {
      // Check localStorage
      const savedLang = localStorage.getItem('userLanguage');
      if (savedLang && this.isSupported(savedLang)) {
        console.log('🌐 Using language from localStorage:', savedLang);
        languageToUse = savedLang as SupportedLanguage;
      } else {
        // Check browser language
        const browserLang = this.translate.getBrowserLang();
        console.log('🌐 Using browser/default language:', browserLang || 'en');
        languageToUse = (browserLang && this.isSupported(browserLang) ? browserLang : 'en') as SupportedLanguage;
      }
    }

    this.setLanguage(languageToUse);
  }

  /**
   * Set the current interface language
   */
  public setLanguage(lang: SupportedLanguage): void {
    if (!this.isSupported(lang)) {
      console.warn(`Language ${lang} is not supported. Falling back to English.`);
      lang = 'en';
    }

    console.log('🌐 Setting language to:', lang);
    this.translate.use(lang);
    this.currentLanguageSubject.next(lang);
    
    // Save to localStorage for persistence
    localStorage.setItem('userLanguage', lang);
    
    // Update HTML lang attribute for accessibility
    document.documentElement.lang = lang;
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











