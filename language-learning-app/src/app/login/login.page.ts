import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationStart } from '@angular/router';
import { Location } from '@angular/common';
import { LoadingController, AlertController } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { AuthService } from '../services/auth.service';
import { LoadingService } from '../services/loading.service';
import { take } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Sign-in surface. The visual design is a two-column "Welcome back" page
 * (form on the left, illustrated hero on the right) but the underlying
 * authentication is unchanged: every button funnels into Auth0's hosted
 * Universal Login via redirect. The email field, when filled, is forwarded
 * as `login_hint` so Auth0 pre-fills it on the hosted page; the password
 * field is intentionally cosmetic — credentials are typed on the Auth0
 * page where they're handled securely. Social buttons (Google / Facebook)
 * deep-link straight to the matching Auth0 connection so users skip the
 * provider chooser. The "Create an account" link routes to onboarding,
 * which already owns role selection (student vs tutor) and signs the user
 * up via Auth0 with `screen_hint=signup`.
 */
@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false,
})
export class LoginPage implements OnInit, OnDestroy {
  /** Set true once Auth0 Facebook uses your own Meta app keys (email scope works). */
  facebookLoginEnabled = false;

  isLoading = false;
  email = '';

  private routerSubscription?: Subscription;

  constructor(
    private authService: AuthService,
    private router: Router,
    private location: Location,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private loadingService: LoadingService
  ) {
    this.routerSubscription = this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        console.log('🔀 NAVIGATION DETECTED:', event.url);
      }
    });
  }

  ngOnInit() {
    if (!Capacitor.isNativePlatform()) {
      this.loadingService.hide();
    }

    this.authService.isAuthenticated$.pipe(take(1)).subscribe(async isAuthenticated => {
      if (!isAuthenticated) return;

      const returnUrl = localStorage.getItem('returnUrl');
      if (!returnUrl) {
        await this.router.navigate(['/tabs'], { replaceUrl: true });
        return;
      }

      const auth0User = await this.authService.getUserProfile().pipe(take(1)).toPromise();
      if (auth0User?.email) {
        const userExists = await this.checkUserExistsByEmail(auth0User.email);
        if (!userExists) {
          await this.router.navigate(['/role-select'], { replaceUrl: true });
          return;
        }
      }

      localStorage.removeItem('returnUrl');
      localStorage.setItem('justCompletedLogin', returnUrl);
      this.location.replaceState('/tabs/home');
      await this.router.navigateByUrl(returnUrl);
    });
  }

  async signIn() {
    await this.startRedirect({
      loginHint: this.email?.trim() || undefined,
    });
  }

  async signInWithGoogle() {
    await this.startRedirect({ connection: 'google-oauth2' });
  }

  async signInWithFacebook() {
    await this.startRedirect({ connection: 'Facebook' });
  }

  async goToCreateAccount() {
    await this.startRedirect({
      screenHint: 'signup',
      loginHint: this.email?.trim() || undefined,
    });
  }

  goToForgotPassword() {
    // Auth0 hosts password reset; redirect into the hosted page so the
    // built-in "Forgot password?" link is available without us shipping
    // our own reset UI.
    this.startRedirect({ loginHint: this.email?.trim() || undefined });
  }

  /**
   * Single funnel for every redirect-based sign-in path on this page.
   * Shows the loading overlay, then hands off to the Auth0 SDK. We do NOT
   * call clearAuth0State() / auth0.logout() here — that triggers a
   * navigation to Auth0's logout endpoint which races with (and kills)
   * the subsequent loginWithRedirect, leaving the user bounced back to
   * /login. The Auth0 SDK handles existing sessions cleanly on its own.
   */
  private async startRedirect(opts: { connection?: string; loginHint?: string; screenHint?: 'login' | 'signup' } = {}) {
    this.isLoading = true;
    const loading = await this.loadingController.create({
      message: 'Signing you in…',
      spinner: 'crescent',
    });
    await loading.present();

    try {
      this.authService.loginWithRedirect(opts);
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
      buttons: ['OK'],
    });
    await alert.present();
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) return false;
      const result = await response.json();
      return result.exists || false;
    } catch (error) {
      console.error('❌ Error checking user by email:', error);
      return false;
    }
  }
}
