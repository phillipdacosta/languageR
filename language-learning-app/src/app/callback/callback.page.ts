import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
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
    private loadingController: LoadingController
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
        console.log('🔍 User is already authenticated, checking database for user data');
        const currentUser = await this.authService.getUserProfile().pipe(take(1)).toPromise();
        console.log('🔍 Current Auth0 user in callback:', currentUser);
        await this.checkUserInDatabase();
        return;
      }
      
      // Check if we have query parameters
      if (!window.location.search && !window.location.hash) {
        console.log('No query parameters or hash found, redirecting to login');
        this.router.navigate(['/login']);
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
        this.router.navigate(['/login']);
        return;
      }
      
      if (!code || !state) {
        console.log('No auth code or state found, redirecting to login');
        this.router.navigate(['/login']);
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
        this.router.navigate(['/login']);
      } else if (error instanceof Error && error.message && error.message.includes('no query params')) {
        console.log('No query params error - redirecting to login');
        this.router.navigate(['/login']);
      } else {
        // Other errors - redirect to login
        this.router.navigate(['/login']);
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
      console.log('🔍 CALLBACK: User authenticated, redirecting to tabs (OnboardingGuard will handle routing)');
      
      // Simply redirect to tabs and let OnboardingGuard handle the routing logic
      // This prevents any flash of the wrong page
      this.router.navigate(['/tabs']);
    } catch (error) {
      console.error('❌ Error in callback:', error);
      // On error, redirect to login
      this.router.navigate(['/login']);
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
      console.log('🔍 CALLBACK: Initializing user, redirecting to tabs (OnboardingGuard will handle routing)');
      
      // Get Auth0 user data and initialize in database
      const auth0User = await this.authService.getUserProfile().pipe(take(1)).toPromise();
      
      if (auth0User) {
        // Initialize user in database (this will be handled by OnboardingGuard if needed)
        try {
          await this.userService.initializeUser(auth0User).toPromise();
          console.log('User initialized in database');
        } catch (error) {
          console.log('User initialization failed, but continuing with OnboardingGuard');
        }
      }
      
      // Simply redirect to tabs and let OnboardingGuard handle the routing logic
      this.router.navigate(['/tabs']);
    } catch (error) {
      console.error('❌ Error in callback:', error);
      // On error, redirect to login
      this.router.navigate(['/login']);
    }
  }
}
