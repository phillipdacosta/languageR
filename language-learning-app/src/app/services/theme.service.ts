import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private darkModeSubject = new BehaviorSubject<boolean>(false);
  public darkMode$: Observable<boolean> = this.darkModeSubject.asObservable();

  private readonly DARK_MODE_KEY = 'darkMode';

  constructor() {
    console.log('🎨 ThemeService: Constructor called');
    
    // Load dark mode preference from localStorage immediately
    this.loadDarkModePreferenceSync();
    
    // Apply to DOM when ready
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        // DOM already ready, apply immediately
        console.log('🎨 ThemeService: DOM ready, applying theme immediately');
        setTimeout(() => this.applyDarkMode(this.darkModeSubject.value), 0);
      } else {
        // Wait for DOM to be ready, then apply theme
        console.log('🎨 ThemeService: DOM not ready, waiting for DOMContentLoaded');
        document.addEventListener('DOMContentLoaded', () => {
          console.log('🎨 ThemeService: DOMContentLoaded fired, applying theme');
          this.applyDarkMode(this.darkModeSubject.value);
        });
      }
    } else {
      console.log('🎨 ThemeService: Window/document not available');
    }
  }

  /**
   * Initialize theme service manually (for debugging)
   */
  public initializeTheme(): void {
    console.log('🎨 ThemeService: Manual initialization called');
    this.loadDarkModePreference();
  }

  /**
   * Force apply current theme state to DOM
   */
  public forceApplyTheme(): void {
    const currentState = this.darkModeSubject.value;
    console.log('🎨 ThemeService: Force applying current theme state:', currentState);
    this.applyDarkMode(currentState);
  }

  /**
   * Load dark mode preference from localStorage synchronously (no DOM application)
   */
  private loadDarkModePreferenceSync(): void {
    if (typeof localStorage === 'undefined') {
      // localStorage not available (SSR or very early in initialization)
      console.log('🌓 localStorage not available, skipping theme load');
      return;
    }
    
    const saved = localStorage.getItem(this.DARK_MODE_KEY);
    const isDarkMode = saved === 'true';
    
    console.log('🔍 Loading dark mode preference from localStorage:', { saved, isDarkMode });
    
    // Update the BehaviorSubject only
    this.darkModeSubject.next(isDarkMode);
  }

  /**
   * Load dark mode preference from localStorage and apply to DOM
   */
  private loadDarkModePreference(): void {
    this.loadDarkModePreferenceSync();
    this.applyDarkMode(this.darkModeSubject.value);
  }

  /**
   * Toggle dark mode
   */
  toggleDarkMode(): void {
    const current = this.darkModeSubject.value;
    console.log('🔄 Toggling dark mode from', current, 'to', !current);
    this.setDarkMode(!current);
  }

  /**
   * Set dark mode state
   */
  setDarkMode(isDark: boolean): void {
    console.log('🎨 Setting dark mode to:', isDark);
    this.darkModeSubject.next(isDark);
    
    // Save to localStorage for persistence
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.DARK_MODE_KEY, isDark.toString());
      console.log('💾 Saved to localStorage:', isDark);
    }
    
    // Apply or remove dark class from document body
    this.applyDarkMode(isDark);
  }

  /**
   * Get current dark mode state
   */
  isDarkMode(): boolean {
    return this.darkModeSubject.value;
  }

  /**
   * Apply dark mode by adding/removing '.ion-palette-dark' class to html element
   * According to Ionic docs: https://ionicframework.com/docs/theming/dark-mode
   * The '.ion-palette-dark' class MUST be added to the html element
   */
  private applyDarkMode(isDark: boolean): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      // document/window not available (SSR)
      return;
    }
    
    // Ensure we're in the browser environment
    const html = document.documentElement;
    
    if (!html) {
      console.warn('🌓 Dark mode: HTML element not found, will retry...');
      // Retry after a short delay if DOM not ready
      setTimeout(() => this.applyDarkMode(isDark), 10);
      return;
    }
    
    // Apply .ion-palette-dark to html element (required by Ionic dark.class.css)
    if (isDark) {
      html.classList.add('ion-palette-dark');
      console.log('✅ Added .ion-palette-dark class to HTML element');
    } else {
      html.classList.remove('ion-palette-dark');
      console.log('❌ Removed .ion-palette-dark class from HTML element');
    }
    
    console.log('🌓 Dark mode applied globally:', isDark);
    console.log('📋 HTML element classes:', html.classList.toString());
    console.log('🎨 HTML element computed background:', window.getComputedStyle ? window.getComputedStyle(html).backgroundColor : 'N/A');
    
    // Force a style recalculation to ensure changes take effect
    if (typeof window !== 'undefined' && window.getComputedStyle) {
      window.getComputedStyle(html).getPropertyValue('color');
    }
  }
}
