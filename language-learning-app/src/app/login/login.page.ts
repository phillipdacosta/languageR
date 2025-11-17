import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationStart } from '@angular/router';
import { Location } from '@angular/common';
import { LoadingController, AlertController } from '@ionic/angular';
import { AuthService } from '../services/auth.service';
import { LoadingService } from '../services/loading.service';
import { take } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false,
})
export class LoginPage implements OnInit, OnDestroy {
  isLoading = false;
  selectedUserType: 'student' | 'tutor' | null = null;
  private routerSubscription?: Subscription;

  constructor(
    private authService: AuthService,
    private router: Router,
    private location: Location,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private loadingService: LoadingService
  ) {
    // Log all navigation attempts to debug race conditions
    this.routerSubscription = this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        console.log('🔀 NAVIGATION DETECTED:', event.url);
      }
    });
  }

  ngOnInit() {
    // Hide loading when login page loads (user has been logged out)
    console.log('🚀 LoginPage: ngOnInit() called');
    console.log('🚀 LoginPage: localStorage contents:', Object.keys(localStorage));
    console.log('🚀 LoginPage: returnUrl in localStorage:', localStorage.getItem('returnUrl'));
    this.loadingService.hide();
    
    // Check if user is already authenticated (use take(1) to prevent multiple redirects)
    this.authService.isAuthenticated$.pipe(take(1)).subscribe(async isAuthenticated => {
      console.log('🚀 LoginPage: isAuthenticated?', isAuthenticated);
      if (isAuthenticated) {
        // Check for return URL (for users already logged in trying to access protected actions)
        const returnUrl = localStorage.getItem('returnUrl');
        if (returnUrl) {
          console.log('🔄 LoginPage: User already authenticated, redirecting to returnUrl:', returnUrl);
          
          // Check if user needs onboarding first
          const auth0User = await this.authService.getUserProfile().pipe(take(1)).toPromise();
          console.log('🔍 LoginPage: Got auth0User:', auth0User?.email);
          
          if (auth0User && auth0User.email) {
            // Check if user exists in database
            const userExists = await this.checkUserExistsByEmail(auth0User.email);
            console.log('🔍 LoginPage: User exists in database?', userExists);
            
            if (!userExists) {
              // New user - send to onboarding first, keep returnUrl for after
              console.log('⚠️ LoginPage: New user with returnUrl, going to onboarding first');
              // returnUrl stays in localStorage for onboarding to use
              await this.router.navigate(['/onboarding'], { replaceUrl: true });
              return;
            }
          }
          
          // Existing user - go directly to returnUrl
          localStorage.removeItem('returnUrl');
          console.log('🔄 LoginPage: Removed returnUrl from localStorage');
          
          // Set flag so the destination page knows to override back button
          localStorage.setItem('justCompletedLogin', returnUrl);
          console.log('🔄 LoginPage: Set justCompletedLogin flag to:', returnUrl);
          
          console.log('🔄 LoginPage: About to replace login with /tabs/home and navigate');
          
          // Replace the login page with /tabs/home in history
          this.location.replaceState('/tabs/home');
          
          // Then navigate to the target (adds to history)
          // Result: [/tabs/home, /tutor/123]
          const navigationResult = await this.router.navigateByUrl(returnUrl);
          console.log('🔄 LoginPage: Navigation result:', navigationResult);
          console.log('🔄 LoginPage: Current URL after navigation:', this.router.url);
        } else {
          console.log('🔄 LoginPage: User already authenticated, redirecting to tabs');
          await this.router.navigate(['/tabs'], { replaceUrl: true });
        }
      } else {
        console.log('🚀 LoginPage: User NOT authenticated, showing login UI');
      }
    });
  }

  selectUserType(userType: 'student' | 'tutor') {
    console.log('🚀 LoginPage: Selected user type:', userType);
    this.selectedUserType = userType;
    
    // Store user type in localStorage for the callback to use
    localStorage.setItem('selectedUserType', userType);
    console.log('🚀 LoginPage: Stored userType in localStorage:', localStorage.getItem('selectedUserType'));
  }

  goBackToTypeSelection() {
    console.log('🚀 LoginPage: Going back to user type selection');
    this.selectedUserType = null;
    localStorage.removeItem('selectedUserType');
  }

  async login() {
    if (!this.selectedUserType) {
      console.error('No user type selected');
      return;
    }

    console.log('🚀 LoginPage: login() called');
    console.log('🚀 LoginPage: returnUrl BEFORE clearAuth0State:', localStorage.getItem('returnUrl'));

    this.isLoading = true;
    const loading = await this.loadingController.create({
      message: `Signing you in as ${this.selectedUserType}...`,
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Clear any existing Auth0 state first
      console.log('🚀 LoginPage: About to call clearAuth0State()');
      this.authService.clearAuth0State();
      console.log('🚀 LoginPage: returnUrl AFTER clearAuth0State:', localStorage.getItem('returnUrl'));
      
      // Wait a moment for state to clear
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Use redirect instead of popup to avoid COOP issues
      console.log('🚀 LoginPage: About to call loginWithRedirect()');
      this.authService.loginWithRedirect();
    } catch (error) {
      console.error('Login error:', error);
      await this.showErrorAlert('Login failed. Please try again.');
      this.isLoading = false;
      await loading.dismiss();
    }
  }



  private async showErrorAlert(message: string) {
    const alert = await this.alertController.create({
      header: 'Error',
      message: message,
      buttons: ['OK']
    });
    await alert.present();
  }

  clearAuthAndReload() {
    // Clear all authentication data using AuthService
    this.authService.clearAuth0State();
    
    // Reload the page to start fresh
    window.location.reload();
  }

  forceLogout() {
    // Use the force logout method from AuthService
    this.authService.forceLogout();
  }

  nuclearLogout() {
    // Use the nuclear logout method from AuthService
    this.authService.nuclearLogout();
  }

  ngOnDestroy() {
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
  }

  private async checkUserExistsByEmail(email: string): Promise<boolean> {
    try {
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
      console.log('🔍 LoginPage: Email check result:', result);
      return result.exists || false;
    } catch (error) {
      console.error('❌ Error checking user by email:', error);
      return false;
    }
  }

}
