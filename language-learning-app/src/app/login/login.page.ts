import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LoadingController, AlertController } from '@ionic/angular';
import { AuthService } from '../services/auth.service';
import { LoadingService } from '../services/loading.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false,
})
export class LoginPage implements OnInit {
  isLoading = false;
  selectedUserType: 'student' | 'tutor' | null = null;

  constructor(
    private authService: AuthService,
    private router: Router,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private loadingService: LoadingService
  ) {}

  ngOnInit() {
    // Hide loading when login page loads (user has been logged out)
    console.log('🚀 LoginPage: Hiding loading on login page load');
    this.loadingService.hide();
    
    // Check if user is already authenticated
    this.authService.isAuthenticated$.subscribe(isAuthenticated => {
      if (isAuthenticated) {
        this.router.navigate(['/tabs']);
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

    this.isLoading = true;
    const loading = await this.loadingController.create({
      message: `Signing you in as ${this.selectedUserType}...`,
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Clear any existing Auth0 state first
      this.authService.clearAuth0State();
      
      // Wait a moment for state to clear
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Use redirect instead of popup to avoid COOP issues
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

}
