import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ThemeService implements OnDestroy {
  private darkModeSubject = new BehaviorSubject<boolean>(false);
  public darkMode$: Observable<boolean> = this.darkModeSubject.asObservable();

  private readonly DARK_MODE_KEY = 'darkMode';
  private mediaQuery: MediaQueryList | null = null;
  private mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

  constructor() {
    this.resolveInitialTheme();

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(() => this.applyDarkMode(this.darkModeSubject.value), 0);
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          this.applyDarkMode(this.darkModeSubject.value);
        });
      }

      this.listenForOsThemeChanges();
    }
  }

  ngOnDestroy(): void {
    if (this.mediaQuery && this.mediaListener) {
      this.mediaQuery.removeEventListener('change', this.mediaListener);
    }
  }

  public initializeTheme(): void {
    this.resolveInitialTheme();
    this.applyDarkMode(this.darkModeSubject.value);
  }

  public forceApplyTheme(): void {
    this.applyDarkMode(this.darkModeSubject.value);
  }

  /**
   * Determine initial theme: saved preference wins, otherwise follow OS.
   */
  private resolveInitialTheme(): void {
    if (typeof localStorage === 'undefined') return;

    const saved = localStorage.getItem(this.DARK_MODE_KEY);

    if (saved !== null) {
      this.darkModeSubject.next(saved === 'true');
    } else if (typeof window !== 'undefined' && window.matchMedia) {
      const osDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.darkModeSubject.next(osDark);
    }
  }

  /**
   * React to OS dark mode changes in real time.
   * Always syncs — OS toggle acts as a master switch and updates the in-app setting.
   */
  private listenForOsThemeChanges(): void {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.mediaListener = (e: MediaQueryListEvent) => {
      this.setDarkMode(e.matches);
    };
    this.mediaQuery.addEventListener('change', this.mediaListener);
  }

  toggleDarkMode(): void {
    this.setDarkMode(!this.darkModeSubject.value);
  }

  setDarkMode(isDark: boolean): void {
    this.darkModeSubject.next(isDark);

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.DARK_MODE_KEY, isDark.toString());
    }

    this.applyDarkMode(isDark);
  }

  isDarkMode(): boolean {
    return this.darkModeSubject.value;
  }

  private applyDarkMode(isDark: boolean): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const html = document.documentElement;
    if (!html) {
      setTimeout(() => this.applyDarkMode(isDark), 10);
      return;
    }

    if (isDark) {
      html.classList.add('ion-palette-dark');
    } else {
      html.classList.remove('ion-palette-dark');
    }

    if (window.getComputedStyle) {
      window.getComputedStyle(html).getPropertyValue('color');
    }
  }
}
