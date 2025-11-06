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
    // Load dark mode preference from localStorage immediately
    this.loadDarkModePreferenceSync();
    
    // Apply to DOM when ready
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        // DOM already ready, apply immediately
        setTimeout(() => this.applyDarkMode(this.darkModeSubject.value), 0);
      } else {
        // Wait for DOM to be ready, then apply theme
        document.addEventListener('DOMContentLoaded', () => {
          this.applyDarkMode(this.darkModeSubject.value);
        });
      }
    }
  }

  /**
   * Initialize theme service manually (for debugging)
   */
  public initializeTheme(): void {
    this.loadDarkModePreference();
  }

  /**
   * Force apply current theme state to DOM
   */
  public forceApplyTheme(): void {
    const currentState = this.darkModeSubject.value;
    this.applyDarkMode(currentState);
  }

  /**
   * Load dark mode preference from localStorage synchronously (no DOM application)
   */
  private loadDarkModePreferenceSync(): void {
    if (typeof localStorage === 'undefined') {
      // localStorage not available (SSR or very early in initialization)
      return;
    }
    
    const saved = localStorage.getItem(this.DARK_MODE_KEY);
    const isDarkMode = saved === 'true';
    
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
    this.setDarkMode(!current);
  }

  /**
   * Set dark mode state
   */
  setDarkMode(isDark: boolean): void {
    this.darkModeSubject.next(isDark);
    
    // Save to localStorage for persistence
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.DARK_MODE_KEY, isDark.toString());
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
    } else {
      html.classList.remove('ion-palette-dark');
    }
    
    // Force a style recalculation to ensure changes take effect
    if (typeof window !== 'undefined' && window.getComputedStyle) {
      window.getComputedStyle(html).getPropertyValue('color');
    }
  }
}
