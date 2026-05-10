import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { LoadingController, ToastController } from '@ionic/angular';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';
import { take } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-callback',
  template: `
    <ion-content class="ion-padding">
      <div class="callback-container">
        <ion-spinner name="crescent"></ion-spinner>
        <p>Completing sign in...</p>
      </div>
    </ion-content>
  `,
  styles: [`
    .callback-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100%;
      text-align: center;
    }
    
    ion-spinner {
      margin-bottom: 1rem;
    }
    
    p {
      color: var(--ion-color-medium);
      font-size: 1.1rem;
    }
  `],
  standalone: false,
})
export class CallbackPage implements OnInit {
  constructor(
    private authService: AuthService,
    private userService: UserService,
    private router: Router,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private location: Location
  ) {}

  /**
   * If the user clicked "Create an account" but Auth0 matched them to an
   * existing record, surface a friendly toast so the experience is
   * "Welcome back" instead of silently landing them on /tabs.
   */
  private async maybeShowSignupExistsToast(userExists: boolean) {
    const intent = localStorage.getItem('loginIntent');
    localStorage.removeItem('loginIntent');
    if (intent !== 'signup' || !userExists) return;

    const toast = await this.toastController.create({
      message: 'Looks like you already have an account — we signed you in.',
      duration: 3500,
      position: 'top',
      color: 'primary',
    });
    await toast.present();
  }

  ngOnInit() {
    // Add a small delay to ensure the page is fully loaded
    setTimeout(() => {
      this.handleAuthCallback();
    }, 100);
  }

  private async handleAuthCallback() {
    try {
      console.log('Callback page loaded');
      console.log('Full URL:', window.location.href);
      console.log('Search params:', window.location.search);
      console.log('Hash:', window.location.hash);
      
      // Check if user is already authenticated
      const isAuthenticated = await this.authService.isAuthenticated$.pipe(take(1)).toPromise();
      console.log('🔍 User already authenticated:', isAuthenticated);
      
      if (isAuthenticated) {
        console.log('========================================');
        console.log('🟢 CALLBACK: isAuthenticated=true branch');
        console.log('🟢 CALLBACK: window.location.search =', window.location.search);
        console.log('========================================');

        const hasFreshOAuthCode = (() => {
          const params = new URLSearchParams(window.location.search);
          return params.has('code') && params.has('state');
        })();

        console.log('🟢 CALLBACK: hasFreshOAuthCode =', hasFreshOAuthCode);

        if (hasFreshOAuthCode) {
          console.log('🟢🟢🟢 CALLBACK: Running initializeUserAndCheckOnboarding (full DB flow)');
          await this.initializeUserAndCheckOnboarding();
          console.log('🟢🟢🟢 CALLBACK: initializeUserAndCheckOnboarding RETURNED');
        } else {
          console.log('🟡 CALLBACK: No fresh OAuth params → bail to /tabs');
          localStorage.removeItem('loginIntent');
          await this.router.navigate(['/tabs'], { replaceUrl: true });
        }
        return;
      }
      
      // Check if we have query parameters
      if (!window.location.search && !window.location.hash) {
        console.log('No query parameters or hash found, redirecting to login');
        this.router.navigate(['/login'], { replaceUrl: true });
        return;
      }
      
      // Check if we're in a callback scenario
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');
      const error = urlParams.get('error');
      const errorDescription = urlParams.get('error_description');

      console.log('Callback received - code:', !!code, 'state:', !!state, 'error:', error);
      console.log('State value:', state);
      console.log('Code value:', code);

      // Check for Auth0 errors first
      if (error) {
        console.error('❌ Auth0 error in callback:', error);
        console.error('❌ Auth0 error_description:', errorDescription);

        // Surface the failure so it's not invisible. Most useful when
        // diagnosing connection/config issues like "connection X disabled
        // for client" or invalid scope.
        const toast = await this.toastController.create({
          message: `Sign-in failed: ${errorDescription || error}`,
          duration: 8000,
          position: 'top',
          color: 'danger',
          buttons: [{ text: 'Dismiss', role: 'cancel' }],
        });
        await toast.present();

        this.router.navigate(['/login'], { replaceUrl: true });
        return;
      }
      
      if (!code || !state) {
        console.log('No auth code or state found, redirecting to login');
        this.router.navigate(['/login'], { replaceUrl: true });
        return;
      }
      
      // Wait a bit for Auth0 service to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.authService.handleAuthCallback().toPromise();
      
      // Wait a bit for the authentication state to be fully processed
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Initialize user in database and check onboarding status
      await this.initializeUserAndCheckOnboarding();
    } catch (error) {
      console.error('Auth callback error:', error);
      
      // Handle specific Auth0 errors
      if (error instanceof Error && error.message && error.message.includes('Invalid state')) {
        console.log('Invalid state error - clearing state and redirecting to login');
        // Clear Auth0 state and redirect to login
        this.clearAuth0State();
        this.router.navigate(['/login'], { replaceUrl: true });
      } else if (error instanceof Error && error.message && error.message.includes('no query params')) {
        console.log('No query params error - redirecting to login');
        this.router.navigate(['/login'], { replaceUrl: true });
      } else {
        // Other errors - redirect to login
        this.router.navigate(['/login'], { replaceUrl: true });
      }
    }
  }

  private clearAuth0State() {
    // Clear Auth0 related localStorage items
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('auth0')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }

  private async checkUserInDatabase() {
    try {
      console.log('🔍 CALLBACK: checkUserInDatabase() called');
      console.log('🔍 CALLBACK: localStorage contents:', Object.keys(localStorage));
      
      // Check for return URL FIRST (for bookmarked/shared pages or unauthenticated actions)
      const returnUrl = localStorage.getItem('returnUrl');
      console.log('🔍 CALLBACK: returnUrl from localStorage:', returnUrl);
      
      if (returnUrl) {
        console.log('🔄 CALLBACK: Found return URL, will redirect to:', returnUrl);
        localStorage.removeItem('returnUrl');
        console.log('🔄 CALLBACK: Removed returnUrl from localStorage');
        
        // Get the current user to check onboarding status before redirecting
        const auth0User = await this.authService.getUserProfile().pipe(take(1)).toPromise();
        console.log('🔍 CALLBACK: Got auth0User:', auth0User?.email);
        
        if (auth0User && auth0User.email) {
          const userExists = await this.checkUserExistsByEmail(auth0User.email);
          console.log('🔍 CALLBACK: User exists in database?', userExists);
          console.log('🔍 CALLBACK: userExists value:', userExists, 'type:', typeof userExists);
          
          // If user doesn't exist, create them now with Auth0 profile data (including picture)
          if (!userExists) {
            console.log('📝 CALLBACK checkUserInDatabase: About to initialize NEW user with auth0User:', {
              email: auth0User.email,
              name: auth0User.name,
              picture: auth0User.picture
            });
            try {
              const createdUser = await this.userService.initializeUser(auth0User).toPromise();
              console.log('✅ CALLBACK checkUserInDatabase: User initialized:', {
                id: createdUser?.id,
                email: createdUser?.email,
                picture: createdUser?.picture
              });
            } catch (error) {
              console.error('❌ CALLBACK checkUserInDatabase: User initialization ERROR:', error);
            }
          }
          
          if (userExists) {
            // Existing user with returnUrl - go directly there, bypassing onboarding check
            console.log('✅ CALLBACK: userExists=true, treating as existing user, navigating to returnUrl:', returnUrl);

            await this.maybeShowSignupExistsToast(true);

            // Set flag so the destination page knows user just logged in
            // and can set up back button interception
            localStorage.setItem('justCompletedLogin', returnUrl);
            console.log('✅ CALLBACK: Set justCompletedLogin flag to:', returnUrl);
            
            // Simply navigate to returnUrl with replaceUrl to replace /callback
            await this.router.navigateByUrl(returnUrl, { replaceUrl: true });
            console.log('✅ CALLBACK: Navigated to returnUrl (replaced /callback):', returnUrl);
            return;
          } else {
            // New user with returnUrl - need role selection first, then onboarding
            console.log('⚠️ CALLBACK checkUserInDatabase: NEW user with returnUrl, going to role-select first');
            localStorage.removeItem('loginIntent');
            localStorage.setItem('returnUrl', returnUrl);
            await this.router.navigate(['/role-select'], { replaceUrl: true });
            return;
          }
        }
      }

      // No returnUrl - simply redirect to tabs and let OnboardingGuard handle routing
      console.log('🔍 CALLBACK: No returnUrl, redirecting to tabs (OnboardingGuard will handle routing)');
      await this.maybeShowSignupExistsToast(true);
      await this.router.navigate(['/tabs'], { replaceUrl: true });
    } catch (error) {
      console.error('❌ CALLBACK: Error in checkUserInDatabase:', error);
      // On error, redirect to login
      this.router.navigate(['/login'], { replaceUrl: true });
    }
  }

  private async checkUserExistsByEmail(email: string): Promise<boolean> {
    try {
      const url = `${environment.backendUrl}/api/users/check-email`;
      console.log('🌐 checkUserExistsByEmail: POST', url, 'body:', { email });
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      console.log('🌐 checkUserExistsByEmail: HTTP', response.status, response.statusText);

      if (!response.ok) {
        const text = await response.text().catch(() => '(no body)');
        console.log('❌ checkUserExistsByEmail: API call failed:', response.status, text);
        return false;
      }

      const result = await response.json();
      console.log('🌐 checkUserExistsByEmail: response body:', result);
      return result.exists || false;
    } catch (error) {
      console.error('❌ checkUserExistsByEmail: NETWORK ERROR:', error);
      return false;
    }
  }

  private async getUserByEmail(email: string): Promise<any> {
    try {
      // Make a direct API call to get user by email
      const response = await fetch(`${environment.backendUrl}/api/users/by-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email })
      });
      
      if (!response.ok) {
        console.log('❌ API call failed:', response.status);
        return null;
      }
      
      const result = await response.json();
      console.log('🔍 User data result:', result);
      return result.user || null;
    } catch (error) {
      console.error('❌ Error getting user by email:', error);
      return null;
    }
  }

  private async initializeUserAndCheckOnboarding() {
    try {
      console.log('╔══════════════════════════════════════════════════╗');
      console.log('║ initializeUserAndCheckOnboarding() ENTERED       ║');
      console.log('╚══════════════════════════════════════════════════╝');
      console.log('🔍 localStorage contents:', Object.keys(localStorage));

      // Get Auth0 user data and initialize in database
      const auth0User = await this.authService.getUserProfile().pipe(take(1)).toPromise();
      console.log('╔══════════════════════════════════════════════════╗');
      console.log('║ AUTH0 USER PROFILE                               ║');
      console.log('╚══════════════════════════════════════════════════╝');
      console.log('  email:        ', auth0User?.email);
      console.log('  email_verified:', (auth0User as any)?.email_verified);
      console.log('  sub:          ', auth0User?.sub);
      console.log('  name:         ', auth0User?.name);
      console.log('  has picture:  ', !!auth0User?.picture);
      console.log('  FULL OBJECT:  ', JSON.stringify(auth0User, null, 2));

      if (!auth0User) {
        console.warn('⚠️ CALLBACK: No auth0User! Falling through to /tabs.');
      } else if (!auth0User.email) {
        console.warn('⚠️ CALLBACK: auth0User has NO EMAIL! Provider did not return email.');
        console.warn('   For Facebook: enable the Email permission in Auth0 → Authentication → Social → Facebook → Permissions');
        console.warn('   And ensure the user granted email permission at the Facebook OAuth dialog.');
      }

      if (auth0User && auth0User.email) {
        console.log('╔══════════════════════════════════════════════════╗');
        console.log('║ DB CHECK                                         ║');
        console.log('╚══════════════════════════════════════════════════╝');
        console.log('  Calling /api/users/check-email with email:', auth0User.email);
        const userExists = await this.checkUserExistsByEmail(auth0User.email);
        console.log('  → userExists =', userExists, '(type:', typeof userExists, ')');
        
        if (!userExists) {
          // New user - initialize in database
          try {
            console.log('📝 CALLBACK: About to initialize user with auth0User:', {
              email: auth0User.email,
              name: auth0User.name,
              picture: auth0User.picture
            });
            const createdUser = await this.userService.initializeUser(auth0User).toPromise();
            console.log('✅ CALLBACK: User initialized in database:', {
              id: createdUser?.id,
              email: createdUser?.email,
              picture: createdUser?.picture
            });
          } catch (error) {
            console.error('❌ CALLBACK: User initialization ERROR:', error);
            console.log('⚠️ CALLBACK: User initialization failed, continuing to onboarding');
          }
        } else {
          console.log('✅ CALLBACK: User already exists in database');
        }
        
        // Check for return URL FIRST (for bookmarked/shared pages or unauthenticated actions)
        const returnUrl = localStorage.getItem('returnUrl');
        console.log('🔍 CALLBACK: returnUrl from localStorage:', returnUrl);
        
        if (returnUrl) {
          console.log('🔄 CALLBACK: Found return URL:', returnUrl);
          console.log('🔍 CALLBACK: userExists value:', userExists, 'type:', typeof userExists);
          localStorage.removeItem('returnUrl');
          console.log('🔄 CALLBACK: Removed returnUrl from localStorage');
          
          if (userExists) {
            // Existing user with returnUrl - go directly there, bypassing onboarding check
            console.log('✅ CALLBACK: userExists=true, treating as existing user, navigating to returnUrl:', returnUrl);

            await this.maybeShowSignupExistsToast(true);

            // Set flag so the destination page knows user just logged in
            // and can set up back button interception
            localStorage.setItem('justCompletedLogin', returnUrl);
            console.log('✅ CALLBACK: Set justCompletedLogin flag to:', returnUrl);
            
            // Simply navigate to returnUrl with replaceUrl to replace /callback
            await this.router.navigateByUrl(returnUrl, { replaceUrl: true });
            console.log('✅ CALLBACK: Navigated to returnUrl (replaced /callback):', returnUrl);
            return;
          } else {
            // New user with returnUrl - need role selection first, then onboarding
            console.log('⚠️ CALLBACK: NEW user with returnUrl, going to role-select first');
            localStorage.removeItem('loginIntent');
            if (returnUrl) {
              localStorage.setItem('returnUrl', returnUrl); // Put it back
            }
            await this.router.navigate(['/role-select'], { replaceUrl: true });
            return;
          }
        }

        // No returnUrl path: surface the toast for existing users (true)
        // or clear the intent for new users (false).
        await this.maybeShowSignupExistsToast(userExists);
      }

      // No returnUrl - simply redirect to tabs and let OnboardingGuard handle the routing logic
      console.log('🔍 CALLBACK: No returnUrl, redirecting to tabs (OnboardingGuard will handle routing)');
      await this.router.navigate(['/tabs'], { replaceUrl: true });
    } catch (error) {
      console.error('❌ CALLBACK: Error in initializeUserAndCheckOnboarding:', error);
      // On error, redirect to login
      this.router.navigate(['/login'], { replaceUrl: true });
    }
  }
}
