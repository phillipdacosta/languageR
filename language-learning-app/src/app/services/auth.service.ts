import { Injectable } from '@angular/core';
import { AuthService as Auth0Service } from '@auth0/auth0-angular';
import { Observable, BehaviorSubject, combineLatest, from, of } from 'rxjs';
import { map, tap, take, catchError, switchMap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { environment } from '../../environments/environment';
import { LoadingService } from './loading.service';

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

  constructor(
    private auth0: Auth0Service,
    private router: Router,
    private loadingService: LoadingService
  ) {
    this.initializeAuth();
  }

  private initializeAuth(): void {
    // Combine Auth0 observables
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
   * Get access token
   */
  getAccessToken(): Observable<string> {
    return this.auth0.getAccessTokenSilently();
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
   */
  loginWithRedirect(opts?: { connection?: string; loginHint?: string; screenHint?: 'login' | 'signup' }): void {
    const authorizationParams: { [k: string]: string } = {};
    if (opts?.connection) authorizationParams['connection'] = opts.connection;
    if (opts?.loginHint) authorizationParams['login_hint'] = opts.loginHint;
    if (opts?.screenHint) authorizationParams['screen_hint'] = opts.screenHint;
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
      
      // Preserve user preferences before clearing localStorage
      const userLanguage = localStorage.getItem('userLanguage');
      console.log('🌐 Preserving language preference:', userLanguage);
      
      // Clear localStorage
      localStorage.clear();
      sessionStorage.clear();
      
      // Restore preserved language preference
      if (userLanguage) {
        localStorage.setItem('userLanguage', userLanguage);
        console.log('✅ Restored language preference:', userLanguage);
      }
      
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
    
    console.log('🔧 AuthService: selectedUserType to preserve:', selectedUserType);
    console.log('🔧 AuthService: returnUrl to preserve:', returnUrl);
    
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
   * Force logout (clears everything locally and redirects)
   */
  forceLogout(): void {
    console.log('🚀 AuthService: Force logout - clearing all state...');
    
    // Preserve user preferences
    const userLanguage = localStorage.getItem('userLanguage');
    
    // Clear local state
    this.userSubject.next(null);
    this.isLoadingSubject.next(false);
    
    // Hide loading
    this.loadingService.hide();
    
    // Clear all storage
    localStorage.clear();
    sessionStorage.clear();
    
    // Restore language preference
    if (userLanguage) {
      localStorage.setItem('userLanguage', userLanguage);
    }
    
    // Redirect to login
    this.router.navigate(['/login']);
  }

  /**
   * Nuclear logout - completely clears everything and reloads
   */
  nuclearLogout(): void {
    console.log('🚀 AuthService: Nuclear logout - clearing everything and reloading...');
    
    // Preserve user preferences
    const userLanguage = localStorage.getItem('userLanguage');
    
    // Clear local state
    this.userSubject.next(null);
    this.isLoadingSubject.next(false);
    
    // Hide loading
    this.loadingService.hide();
    
    // Clear all storage
    localStorage.clear();
    sessionStorage.clear();
    
    // Restore language preference
    if (userLanguage) {
      localStorage.setItem('userLanguage', userLanguage);
    }
    
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