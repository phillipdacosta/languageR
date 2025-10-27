import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-auth-debug',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Auth Debug</ion-title>
        <ion-buttons slot="start">
          <ion-button (click)="goBack()">
            <ion-icon name="arrow-back"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="debug-container">
        <h2>Authentication Debug Information</h2>
        
        <ion-card>
          <ion-card-header>
            <ion-card-title>Auth State</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <p><strong>Is Authenticated:</strong> {{ isAuthenticated$ | async }}</p>
            <p><strong>Is Loading:</strong> {{ isLoading$ | async }}</p>
            <p><strong>User:</strong> {{ (user$ | async)?.name || 'Not logged in' }}</p>
          </ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header>
            <ion-card-title>Local Storage</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <p><strong>Onboarding Completed:</strong> {{ getOnboardingStatus() }}</p>
            <p><strong>Auth0 Keys:</strong></p>
            <ul>
              <li *ngFor="let key of getAuth0Keys()">{{ key }}</li>
            </ul>
          </ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header>
            <ion-card-title>Actions</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <ion-button expand="block" color="warning" (click)="clearAuth0State()">
              Clear Auth0 State
            </ion-button>
            <ion-button expand="block" color="danger" (click)="clearAllState()">
              Clear All State
            </ion-button>
            <ion-button expand="block" color="primary" (click)="goToLogin()">
              Go to Login
            </ion-button>
          </ion-card-content>
        </ion-card>
      </div>
    </ion-content>
  `,
  standalone: false,
})
export class AuthDebugPage implements OnInit {
  isAuthenticated$: Observable<boolean>;
  isLoading$: Observable<boolean>;
  user$: Observable<any>;

  constructor(
    private authService: AuthService,
    private router: Router
  ) {
    this.isAuthenticated$ = this.authService.isAuthenticated$;
    this.isLoading$ = this.authService.isLoading$;
    this.user$ = this.authService.user$;
  }

  ngOnInit() {}

  goBack() {
    this.router.navigate(['/tabs']);
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }

  getOnboardingStatus(): string {
    return localStorage.getItem('onboarding_completed') || 'Not completed';
  }

  getAuth0Keys(): string[] {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('auth0')) {
        keys.push(key);
      }
    }
    return keys;
  }

  clearAuth0State() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('auth0')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    console.log('Cleared Auth0 state:', keysToRemove);
  }

  clearAllState() {
    localStorage.clear();
    console.log('Cleared all localStorage');
  }
}

