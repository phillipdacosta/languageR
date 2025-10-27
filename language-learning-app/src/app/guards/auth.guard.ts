import { Injectable } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Observable, combineLatest } from 'rxjs';
import { map, take, filter } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> {
    return combineLatest([
      this.authService.isAuthenticated$,
      this.authService.isLoading$
    ]).pipe(
      // Wait until loading is complete
      filter(([isAuthenticated, isLoading]) => !isLoading),
      take(1),
      map(([isAuthenticated, isLoading]) => {
        console.log('AuthGuard: isAuthenticated =', isAuthenticated, 'isLoading =', isLoading, 'for route:', state.url);
        if (isAuthenticated) {
          return true;
        } else {
          // Redirect to login page
          console.log('AuthGuard: redirecting to login');
          this.router.navigate(['/login']);
          return false;
        }
      })
    );
  }
}
