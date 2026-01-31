import { Injectable } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { UserService } from '../services/user.service';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class StudentOnlyGuard implements CanActivate {
  constructor(
    private userService: UserService,
    private router: Router
  ) {}

  async canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Promise<boolean> {
    try {
      const user = await firstValueFrom(this.userService.currentUser$);
      
      if (!user) {
        console.log('🚫 StudentOnlyGuard: No user found, redirecting to home');
        this.router.navigate(['/tabs/home']);
        return false;
      }

      if (user.userType !== 'student') {
        console.log('🚫 StudentOnlyGuard: User is not a student, redirecting to home');
        this.router.navigate(['/tabs/home']);
        return false;
      }

      console.log('✅ StudentOnlyGuard: Student access granted');
      return true;
    } catch (error) {
      console.error('❌ StudentOnlyGuard: Error checking user type:', error);
      this.router.navigate(['/tabs/home']);
      return false;
    }
  }
}









