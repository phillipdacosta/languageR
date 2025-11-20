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
  private onboardingStatusCache: Map<string, { result: boolean; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 60000; // 1 minute cache

  constructor(
    private authService: AuthService,
    private userService: UserService,
    private router: Router,
    private loadingService: LoadingService
  ) {}

  /**
   * Clear the onboarding status cache for a user
   * Call this after user completes onboarding
   */
  clearCache(email?: string): void {
    if (email) {
      this.onboardingStatusCache.delete(email);
      console.log('🔍 OnboardingGuard: Cleared cache for', email);
    } else {
      this.onboardingStatusCache.clear();
      console.log('🔍 OnboardingGuard: Cleared all cache');
    }
  }

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
      // Check cache first
      const cached = this.onboardingStatusCache.get(email);
      const now = Date.now();
      
      if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
        console.log('🔍 OnboardingGuard: Using cached result for', email);
        this.loadingService.hide();
        observer.next(cached.result);
        observer.complete();
        return;
      }
      
      // Make ONLY ONE API call to get user by email (more efficient)
      fetch(`${environment.backendUrl}/api/users/by-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email })
      })
      .then(response => {
        // Handle rate limiting with exponential backoff
        if (response.status === 429) {
          return response.json().then(errorData => {
            const retryAfter = errorData.retryAfter || 60;
            console.warn(`⏳ OnboardingGuard: Rate limited. Will allow access. Retry after ${retryAfter}s`);
            
            // On rate limit, cache a "true" result temporarily to prevent redirect loops
            // This allows the user to proceed rather than getting stuck
            this.onboardingStatusCache.set(email, {
              result: true,
              timestamp: Date.now()
            });
            
            this.loadingService.hide();
            observer.next(true);
            observer.complete();
            return;
          });
        }
        
        if (response.status === 404) {
          // User doesn't exist - cache as not onboarded
          this.onboardingStatusCache.set(email, {
            result: false,
            timestamp: Date.now()
          });
          
          this.loadingService.hide();
          
          // Route to appropriate onboarding based on user type from localStorage
          const userType = localStorage.getItem('selectedUserType') || 'student';
          const onboardingRoute = userType === 'tutor' ? '/tutor-onboarding' : '/onboarding';
          this.router.navigate([onboardingRoute]);
          observer.next(false);
          observer.complete();
          return;
        }
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return response.json();
      })
      .then(userResult => {
        // Skip if already handled (rate limit case)
        if (!userResult) return;
        
        const onboardingCompleted = userResult.user && userResult.user.onboardingCompleted;
        
        // Cache the result
        this.onboardingStatusCache.set(email, {
          result: onboardingCompleted,
          timestamp: Date.now()
        });
        
        if (onboardingCompleted) {
          this.loadingService.hide();
          observer.next(true);
          observer.complete();
        } else {
          console.log('⚠️ OnboardingGuard: User has NOT completed onboarding, redirecting');
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
        console.error('OnboardingGuard: error checking user existence:', error);
        
        // On network error, check if we have a cached result we can use
        const staleCache = this.onboardingStatusCache.get(email);
        if (staleCache) {
          console.log('🔍 OnboardingGuard: Using stale cache due to error');
          this.loadingService.hide();
          observer.next(staleCache.result);
          observer.complete();
          return;
        }
        
        // If no cache, redirect to onboarding as fallback
        this.loadingService.hide();
        this.router.navigate(['/onboarding']);
        observer.next(false);
        observer.complete();
      });
    });
  }

}
