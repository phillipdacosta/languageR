import { Injectable } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { map, take, switchMap, catchError, filter } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';
import { LoadingService } from '../services/loading.service';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class OnboardingGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private userService: UserService,
    private router: Router,
    private loadingService: LoadingService
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> {
    // Show loading immediately to prevent any flash
    this.loadingService.show();
    
    // Add a small delay to ensure loading overlay is rendered
    return new Observable(observer => {
      setTimeout(() => {
        combineLatest([
          this.authService.isAuthenticated$,
          this.authService.isLoading$
        ]).pipe(
          // Wait until loading is complete
          filter(([isAuthenticated, isLoading]) => !isLoading),
          take(1),
          switchMap(([isAuthenticated, isLoading]) => {
            if (!isAuthenticated) {
              this.loadingService.hide();
              this.router.navigate(['/login']);
              observer.next(false);
              observer.complete();
              return of(false);
            }

            // Check if user has completed onboarding
            return this.checkOnboardingStatus();
          })
        ).subscribe({
          next: (result) => {
            observer.next(result);
            observer.complete();
          },
          error: (error) => {
            console.error('🚀 OnboardingGuard: Error in guard:', error);
            this.loadingService.hide();
            this.router.navigate(['/login']);
            observer.next(false);
            observer.complete();
          }
        });
      }, 50); // Small delay to ensure loading overlay is rendered
    });
  }

  private checkOnboardingStatus(): Observable<boolean> {
    return this.authService.user$.pipe(
      take(1),
      switchMap(user => {
        if (!user || !user.email) {
          this.loadingService.hide();
          this.router.navigate(['/onboarding']);
          return of(false);
        }

        // Check database for user's onboarding status
        return this.checkUserOnboardingStatus(user.email);
      }),
      catchError(error => {
        console.error('OnboardingGuard: error checking onboarding status:', error);
        // On error, redirect to onboarding to be safe
        this.loadingService.hide();
        this.router.navigate(['/onboarding']);
        return of(false);
      })
    );
  }

  private checkUserOnboardingStatus(email: string): Observable<boolean> {
    return new Observable(observer => {
      
      // Make API call to check user's onboarding status
      fetch(`${environment.backendUrl}/api/users/check-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email })
      })
      .then(response => response.json())
      .then(result => {
        if (result.exists) {
          // User exists, check if onboarding is completed
          fetch(`${environment.backendUrl}/api/users/by-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email })
          })
          .then(response => response.json())
          .then(userResult => {
            if (userResult.user && userResult.user.onboardingCompleted) {
              this.loadingService.hide();
              observer.next(true);
              observer.complete();
            } else {
              this.loadingService.hide();
              
              // Route to appropriate onboarding based on user type
              const userType = userResult.user?.userType || 'student';
              const onboardingRoute = userType === 'tutor' ? '/tutor-onboarding' : '/onboarding';
              this.router.navigate([onboardingRoute]);
              observer.next(false);
              observer.complete();
            }
          })
          .catch(error => {
            console.error('OnboardingGuard: error getting user data:', error);
            this.loadingService.hide();
            this.router.navigate(['/onboarding']);
            observer.next(false);
            observer.complete();
          });
        } else {
          this.loadingService.hide();
          
          // Route to appropriate onboarding based on user type from localStorage
          const userType = localStorage.getItem('selectedUserType') || 'student';
          const onboardingRoute = userType === 'tutor' ? '/tutor-onboarding' : '/onboarding';
          this.router.navigate([onboardingRoute]);
          observer.next(false);
          observer.complete();
        }
      })
      .catch(error => {
        console.error('OnboardingGuard: error checking user existence:', error);
        this.loadingService.hide();
        this.router.navigate(['/onboarding']);
        observer.next(false);
        observer.complete();
      });
    });
  }

}
