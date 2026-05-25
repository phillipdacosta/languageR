import { Injectable, Injector } from '@angular/core';
import { AuthService as Auth0Service } from '@auth0/auth0-angular';
import { Observable, BehaviorSubject, combineLatest, race, timer } from 'rxjs';
import { map, take, filter, tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { environment } from '../../environments/environment';
import { LoadingService } from './loading.service';
import { LanguageService } from './language.service';
import { UserService } from './user.service';

export interface User {
  sub: string;
  name: string;
  email: string;
  picture?: string;
  email_verified?: boolean;
  userType?: string;
  spokenLanguages?: { code: string; level: string }[];
  onboardingData?: {
    languages?: string[];
    goals?: string[];
    experienceLevel?: string;
    preferredSchedule?: string;
    experience?: string;
    schedule?: string;
    bio?: string;
    hourlyRate?: number;
    introductionVideo?: string;
    completedAt?: string;
  };
  [key: string]: any;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private userSubject = new BehaviorSubject<User | null>(null);
  private isLoadingSubject = new BehaviorSubject<boolean>(true);
  private auth0Domain = environment.auth0.domain;
  private clientId = environment.auth0.clientId;
  private sessionRecoveryInProgress = false;
  private lastSessionRecoveryAt = 0;
  private static readonly SESSION_RECOVERY_COOLDOWN_MS = 5000;
  private static readonly AUTH_BOOTSTRAP_TIMEOUT_MS = 15000;

  constructor(
    private auth0: Auth0Service,
    private router: Router,
    private loadingService: LoadingService,
    private languageService: LanguageService,
    private injector: Injector,
  ) {
    this.initializeAuth();
  }

  private initializeAuth(): void {
    combineLatest([
      this.auth0.isAuthenticated$,
      this.auth0.user$,
      this.auth0.isLoading$
    ]).pipe(
      map(([isAuthenticated, user, isLoading]) => {
        this.isLoadingSubject.next(isLoading);

        if (isAuthenticated && user) {
          this.userSubject.next(user as User);
        } else {
          this.userSubject.next(null);
        }

        return { isAuthenticated, user, isLoading };
      })
    ).subscribe();

    // Auth0 startup failures (corrupt cache, expired refresh token, etc.)
    this.auth0.error$.subscribe(err => {
      console.error('[AuthService] Auth0 SDK error:', err);
      if (this.isSessionFatalAuth0Error(err)) {
        this.recoverSession('auth0_sdk_error');
      }
    });

    // If bootstrap never completes, invalidate the stale local session instead
    // of forcing isLoading false and leaving the app in a broken state.
    race(
      this.auth0.isLoading$.pipe(
        filter(loading => !loading),
        take(1),
        map(() => 'ready' as const)
      ),
      timer(AuthService.AUTH_BOOTSTRAP_TIMEOUT_MS).pipe(map(() => 'timeout' as const))
    ).subscribe(result => {
      if (result === 'timeout' && this.isLoadingSubject.value) {
        console.warn('[AuthService] Auth0 bootstrap timed out — recovering session');
        this.recoverSession('auth_bootstrap_timeout');
      }
    });
  }

  /**
   * Check if user is authenticated
   */
  get isAuthenticated$(): Observable<boolean> {
    return this.auth0.isAuthenticated$;
  }

  /**
   * Get current user
   */
  get user$(): Observable<User | null> {
    return this.userSubject.asObservable();
  }

  /**
   * Get loading state
   */
  get isLoading$(): Observable<boolean> {
    return this.isLoadingSubject.asObservable();
  }

  /**
   * Get access token (cached when still valid).
   */
  getAccessToken(): Observable<string> {
    return this.auth0.getAccessTokenSilently();
  }

  /**
   * Force a network token refresh. Used when the cached ID token expired.
   */
  refreshAccessToken(): Observable<string> {
    return this.auth0.getAccessTokenSilently({ cacheMode: 'off' });
  }

  /**
   * Clear a dead Auth0 session locally and route to login.
   * Used on 401s, SDK bootstrap failures, and corrupt cache recovery.
   */
  recoverSession(reason: string): void {
    const now = Date.now();
    if (this.sessionRecoveryInProgress) {
      return;
    }
    if (now - this.lastSessionRecoveryAt < AuthService.SESSION_RECOVERY_COOLDOWN_MS) {
      return;
    }
    if (this.isPublicAuthRoute()) {
      return;
    }

    this.sessionRecoveryInProgress = true;
    this.lastSessionRecoveryAt = now;
    console.warn('[AuthService] Recovering session:', reason);

    const preserved = AuthService.captureLanguagePreferences();
    this.userSubject.next(null);
    this.isLoadingSubject.next(false);
    this.loadingService.hide();

    try {
      this.injector.get(UserService).clearCurrentUser();
    } catch {
      // UserService unavailable during very early bootstrap — safe to ignore.
    }

    try {
      localStorage.removeItem('currentUserEmail');
    } catch {
      // ignore
    }

    this.auth0.logout({ openUrl: false }).pipe(take(1)).subscribe({
      next: () => {
        AuthService.restoreLanguagePreferences(preserved);
        this.sessionRecoveryInProgress = false;
        this.router.navigate(['/login'], {
          replaceUrl: true,
          queryParams: { session: 'expired' },
        });
      },
      error: () => {
        AuthService.restoreLanguagePreferences(preserved);
        this.sessionRecoveryInProgress = false;
        this.router.navigate(['/login'], { replaceUrl: true });
      },
    });
  }

  private isPublicAuthRoute(): boolean {
    const url = this.router.url || '';
    return /^\/(login|callback|terms|privacy)(\/|\?|$)/.test(url);
  }

  /** Only treat errors that mean the stored session is unusable — not transient silent-auth noise. */
  private isSessionFatalAuth0Error(err: unknown): boolean {
    const code = String((err as { error?: string })?.error || '').toLowerCase();
    const message = String((err as { message?: string })?.message || err || '').toLowerCase();
    const combined = `${code} ${message}`;
    return (
      combined.includes('login_required') ||
      combined.includes('invalid_grant') ||
      combined.includes('missing_refresh_token') ||
      combined.includes('consent_required') ||
      combined.includes('refresh token') ||
      combined.includes('session expired')
    );
  }

  /**
   * Get ID token claims (includes user profile with picture)
   */
  async getIdTokenClaims(): Promise<any> {
    return this.auth0.idTokenClaims$.pipe(take(1)).toPromise();
  }

  /**
   * Get authorization headers for API requests
   */
  getAuthHeaders(): { [key: string]: string } {
    // This will be used by HTTP interceptor, but we can provide a fallback
    return {};
  }

  /**
   * Login with redirect.
   *
   * Supports an optional Auth0 social `connection` (e.g. `google-oauth2`,
   * `apple`) so callers can deep-link into a specific identity provider
   * without a stop on the Universal Login chooser. `loginHint` is forwarded
   * to Auth0 to pre-fill the email field on the hosted page when the user
   * typed one before clicking Sign in. `screenHint: 'signup'` flips the
   * hosted page into the sign-up tab — used by the "Create an account"
   * link on the login page.
   *
   * `ui_locales` is always set from the active Barnabi interface language
   * (`LanguageService`, same source as `localStorage.userLanguage`) so
   * Auth0 Universal Login (and IdPs that honor OIDC `ui_locales`, e.g.
   * Google) match the language the user already sees on our login page.
   */
  loginWithRedirect(opts?: { connection?: string; loginHint?: string; screenHint?: 'login' | 'signup'; prompt?: 'login' | 'select_account' | 'consent' | 'none' }): void {
    const authorizationParams: { [k: string]: string } = {};
    if (opts?.connection) authorizationParams['connection'] = opts.connection;
    if (opts?.loginHint) authorizationParams['login_hint'] = opts.loginHint;
    if (opts?.screenHint) authorizationParams['screen_hint'] = opts.screenHint;
    // `prompt` overrides Auth0's silent SSO. After `/v2/logout` the upstream
    // IdP (Google, etc.) and Auth0 SSO may still be alive, so the next
    // /authorize call would otherwise auto-sign the user back in with the
    // same account — they never see the chooser. The login page passes
    // `prompt: 'login'` (or `'select_account'` for Google) for all explicit
    // sign-in actions to restore the account-picker behavior.
    if (opts?.prompt) authorizationParams['prompt'] = opts.prompt;

    const lang = this.languageService.getCurrentLanguage();
    if (lang && this.languageService.isSupported(lang)) {
      authorizationParams['ui_locales'] =
        lang === 'en' ? 'en' : `${lang} en`;
    }

    const redirectOpts = Object.keys(authorizationParams).length > 0
      ? { authorizationParams }
      : undefined;

    console.log('🔐 AuthService.loginWithRedirect with opts:', redirectOpts);

    // The @auth0/auth0-angular SDK wraps the underlying SPA-JS call in an
    // Observable. We MUST subscribe — otherwise any rejection from the
    // SPA-JS call (e.g. an invalid `connection` slug, missing config) is
    // swallowed as an unhandled-promise warning and the user sees nothing
    // happen. Subscribing lets us surface errors and confirm the redirect
    // actually fired.
    const redirect$ = Capacitor.isNativePlatform()
      ? this.auth0.loginWithRedirect({
          ...(redirectOpts || {}),
          async openUrl(url: string) {
            await Browser.open({ url, windowName: '_self' });
          }
        })
      : (redirectOpts ? this.auth0.loginWithRedirect(redirectOpts) : this.auth0.loginWithRedirect());

    redirect$.subscribe({
      next: () => console.log('✅ AuthService.loginWithRedirect: redirect dispatched'),
      error: (err: any) => {
        console.error('❌ AuthService.loginWithRedirect FAILED:', err);
        alert(`Sign-in failed: ${err?.message || err}\n\nIf this mentions "connection", check the connection slug in Auth0.`);
      },
    });
  }

  /**
   * Login with popup
   */
  loginWithPopup(): Observable<any> {
    return this.auth0.loginWithPopup();
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    try {
      // Clear local authentication state first
      console.log('🚀 AuthService: Clearing local authentication state...');
      this.userSubject.next(null);
      this.isLoadingSubject.next(false);
      
      // Hide loading when logging out
      this.loadingService.hide();

      // Preserve user-facing language preferences (both the active locale
      // and any unsynced explicit picker choice) before nuking storage.
      const preserved = AuthService.captureLanguagePreferences();
      console.log('🌐 Preserving language preferences:', preserved);

      localStorage.clear();
      sessionStorage.clear();

      AuthService.restoreLanguagePreferences(preserved);
      
      // Clear Auth0 related localStorage items
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('auth0')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      console.log('🚀 AuthService: Performing Auth0 logout...');
      
      if (Capacitor.isNativePlatform()) {
        const returnTo = 'com.languageapp.learning://login';
        const logoutUrl = `https://${this.auth0Domain}/v2/logout?client_id=${this.clientId}&returnTo=${encodeURIComponent(returnTo)}`;
        await Browser.open({ url: logoutUrl });
        setTimeout(async () => {
          await Browser.close();
          this.router.navigate(['/login'], { replaceUrl: true });
        }, 1000);
      } else {
        const logoutUrl = `https://${this.auth0Domain}/v2/logout?client_id=${this.clientId}&returnTo=${encodeURIComponent(window.location.origin + '/login')}`;
        window.location.href = logoutUrl;
      }
      
    } catch (error) {
      console.error('Error during logout:', error);
      // Even if logout fails, clear local state and redirect
      this.loadingService.hide();
      this.router.navigate(['/login']);
    }
  }

  /**
   * Handle authentication callback
   */
  handleAuthCallback(url?: string): Observable<any> {
    return this.auth0.handleRedirectCallback(url);
  }

  /**
   * Get user profile
   */
  getUserProfile(): Observable<User | null> {
    return this.auth0.user$ as Observable<User | null>;
  }

  /**
   * Check if user has specific role
   */
  hasRole(role: string): Observable<boolean> {
    return this.user$.pipe(
      map(user => {
        if (!user) return false;
        const roles = user['https://your-app.com/roles'] || [];
        return roles.includes(role);
      })
    );
  }

  /**
   * Get user's preferred language
   */
  getUserLanguage(): Observable<string> {
    return this.user$.pipe(
      map(user => {
        if (!user) return 'en';
        return user['https://your-app.com/language'] || 'en';
      })
    );
  }

  /**
   * Update user metadata
   */
  updateUserMetadata(metadata: any): Observable<any> {
    return this.auth0.getAccessTokenSilently().pipe(
      tap(token => {
        // You would typically make an API call here to update user metadata
        console.log('Update user metadata:', metadata, 'with token:', token);
      })
    );
  }

  /**
   * Clear Auth0 state (useful for debugging or forced logout)
   */
  clearAuth0State(): void {
    console.log('🔧 AuthService: clearAuth0State() called');
    console.log('🔧 AuthService: localStorage BEFORE clear:', Object.keys(localStorage));
    
    // Preserve critical items before clearing localStorage
    const selectedUserType = localStorage.getItem('selectedUserType');
    const returnUrl = localStorage.getItem('returnUrl');
    const preservedLanguage = AuthService.captureLanguagePreferences();
    
    console.log('🔧 AuthService: selectedUserType to preserve:', selectedUserType);
    console.log('🔧 AuthService: returnUrl to preserve:', returnUrl);
    console.log('🔧 AuthService: language preferences to preserve:', preservedLanguage);
    
    // Clear local state
    this.userSubject.next(null);
    this.isLoadingSubject.next(false);
    
    // Clear all storage
    localStorage.clear();
    sessionStorage.clear();
    console.log('🔧 AuthService: localStorage AFTER clear:', Object.keys(localStorage));
    
    // Restore preserved items
    if (selectedUserType) {
      localStorage.setItem('selectedUserType', selectedUserType);
      console.log('✅ AuthService: Preserved selectedUserType:', selectedUserType);
    }
    
    if (returnUrl) {
      localStorage.setItem('returnUrl', returnUrl);
      console.log('✅ AuthService: Preserved returnUrl:', returnUrl);
    }

    AuthService.restoreLanguagePreferences(preservedLanguage);
    console.log('🔧 AuthService: localStorage AFTER restore:', Object.keys(localStorage));
    
    // Clear Auth0 specific items
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('auth0')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    
    try {
      if (Capacitor.isNativePlatform()) {
        this.router.navigate(['/login'], { replaceUrl: true });
      } else {
        this.auth0.logout({
          logoutParams: {
            returnTo: window.location.origin
          }
        });
      }
    } catch (error) {
      console.log('Auth0 service logout failed, continuing with local clear');
    }
    
    console.log('Auth0 state cleared');
  }

  /**
   * Get Auth0 logout URL for manual logout
   */
  getLogoutUrl(): string {
    return `https://${this.auth0Domain}/v2/logout?client_id=${this.clientId}&returnTo=${encodeURIComponent(window.location.origin + '/login')}`;
  }

  /**
   * Snapshot the language-preference keys we must keep across a
   * `localStorage.clear()` (logout / clearAuth0State / force / nuclear).
   * Without this the durable `userLanguagePicked` marker — which lets us
   * sync a fresh picker choice up to the backend after the next sign-in
   * — gets wiped, and the user's UI language silently reverts to the
   * server-stored default on every logout/login cycle.
   */
  private static captureLanguagePreferences(): Record<string, string> {
    const snapshot: Record<string, string> = {};
    if (typeof localStorage === 'undefined') return snapshot;
    for (const key of LanguageService.PRESERVE_THROUGH_CLEAR_KEYS) {
      const value = localStorage.getItem(key);
      if (value != null) snapshot[key] = value;
    }
    return snapshot;
  }

  /** Counterpart to `captureLanguagePreferences`. */
  private static restoreLanguagePreferences(snapshot: Record<string, string>): void {
    if (typeof localStorage === 'undefined') return;
    for (const [key, value] of Object.entries(snapshot)) {
      localStorage.setItem(key, value);
    }
  }

  /**
   * Force logout (clears everything locally and redirects)
   */
  forceLogout(): void {
    console.log('🚀 AuthService: Force logout - clearing all state...');

    const preserved = AuthService.captureLanguagePreferences();

    this.userSubject.next(null);
    this.isLoadingSubject.next(false);
    this.loadingService.hide();

    localStorage.clear();
    sessionStorage.clear();

    AuthService.restoreLanguagePreferences(preserved);

    this.router.navigate(['/login']);
  }

  /**
   * Nuclear logout - completely clears everything and reloads
   */
  nuclearLogout(): void {
    console.log('🚀 AuthService: Nuclear logout - clearing everything and reloading...');

    const preserved = AuthService.captureLanguagePreferences();

    this.userSubject.next(null);
    this.isLoadingSubject.next(false);
    this.loadingService.hide();

    localStorage.clear();
    sessionStorage.clear();

    AuthService.restoreLanguagePreferences(preserved);
    
    // Clear all cookies
    document.cookie.split(";").forEach(function(c) { 
      document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
    });
    
    if (Capacitor.isNativePlatform()) {
      this.router.navigate(['/login'], { replaceUrl: true });
    } else {
      window.location.href = '/login';
    }
  }
}