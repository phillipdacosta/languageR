import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { LoadingController } from '@ionic/angular';
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
    private location: Location
  ) {}

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
        console.log('🔍 CALLBACK: User already authenticated');
        
        // If user is already authenticated but we're not in an actual callback flow,
        // don't do anything - they might be navigating from another page
        const hasCallbackParams = window.location.search || window.location.hash;
        if (!hasCallbackParams) {
          console.log('🔍 CALLBACK: No callback params, user is just navigating. Exiting without redirect.');
          return;
        }
        
        console.log('🔍 CALLBACK: Has callback params, checking database for user data');
        const currentUser = await this.authService.getUserProfile().pipe(take(1)).toPromise();
        console.log('🔍 Current Auth0 user in callback:', currentUser);
        await this.checkUserInDatabase();
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
      
      console.log('Callback received - code:', !!code, 'state:', !!state, 'error:', error);
      console.log('State value:', state);
      console.log('Code value:', code);
      
      // Check for Auth0 errors first
      if (error) {
        console.error('Auth0 error in callback:', error);
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
            
            // Set flag so the destination page knows user just logged in
            // and can set up back button interception
            localStorage.setItem('justCompletedLogin', returnUrl);
            console.log('✅ CALLBACK: Set justCompletedLogin flag to:', returnUrl);
            
            // Simply navigate to returnUrl with replaceUrl to replace /callback
            await this.router.navigateByUrl(returnUrl, { replaceUrl: true });
            console.log('✅ CALLBACK: Navigated to returnUrl (replaced /callback):', returnUrl);
            return;
          } else {
            // New user with returnUrl - need onboarding first, but keep returnUrl for after
            console.log('⚠️ CALLBACK: userExists=false, treating as NEW user with returnUrl, going to onboarding (will redirect after)');
            localStorage.setItem('returnUrl', returnUrl); // Put it back (returnUrl is guaranteed non-null here due to outer check)
            await this.router.navigate(['/onboarding'], { replaceUrl: true });
            return;
          }
        }
      }
      
      // No returnUrl - simply redirect to tabs and let OnboardingGuard handle routing
      console.log('🔍 CALLBACK: No returnUrl, redirecting to tabs (OnboardingGuard will handle routing)');
      await this.router.navigate(['/tabs'], { replaceUrl: true });
    } catch (error) {
      console.error('❌ CALLBACK: Error in checkUserInDatabase:', error);
      // On error, redirect to login
      this.router.navigate(['/login'], { replaceUrl: true });
    }
  }

  private async checkUserExistsByEmail(email: string): Promise<boolean> {
    try {
      // Make a direct API call to check if user exists by email
      const response = await fetch(`${environment.backendUrl}/api/users/check-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email })
      });
      
      if (!response.ok) {
        console.log('❌ API call failed:', response.status);
        return false;
      }
      
      const result = await response.json();
      console.log('🔍 Email check result:', result);
      return result.exists || false;
    } catch (error) {
      console.error('❌ Error checking user by email:', error);
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
      console.log('🔍 CALLBACK: initializeUserAndCheckOnboarding() called');
      console.log('🔍 CALLBACK: localStorage contents:', Object.keys(localStorage));
      
      // Get Auth0 user data and initialize in database
      const auth0User = await this.authService.getUserProfile().pipe(take(1)).toPromise();
      console.log('🔍 CALLBACK: Got auth0User:', auth0User?.email);
      console.log('🖼️ CALLBACK: auth0User FULL DATA:', JSON.stringify(auth0User, null, 2));
      console.log('🖼️ CALLBACK: auth0User.picture:', auth0User?.picture);
      
      if (auth0User && auth0User.email) {
        // Check if user already exists
        const userExists = await this.checkUserExistsByEmail(auth0User.email);
        console.log('🔍 CALLBACK: User exists in database?', userExists);
        
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
            
            // Set flag so the destination page knows user just logged in
            // and can set up back button interception
            localStorage.setItem('justCompletedLogin', returnUrl);
            console.log('✅ CALLBACK: Set justCompletedLogin flag to:', returnUrl);
            
            // Simply navigate to returnUrl with replaceUrl to replace /callback
            await this.router.navigateByUrl(returnUrl, { replaceUrl: true });
            console.log('✅ CALLBACK: Navigated to returnUrl (replaced /callback):', returnUrl);
            return;
          } else {
            // New user with returnUrl - need onboarding first, but keep returnUrl for after
            console.log('⚠️ CALLBACK: userExists=false, treating as NEW user with returnUrl, going to onboarding (will redirect after)');
            if (returnUrl) {
              localStorage.setItem('returnUrl', returnUrl); // Put it back
            }
            await this.router.navigate(['/onboarding'], { replaceUrl: true });
            return;
          }
        }
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
