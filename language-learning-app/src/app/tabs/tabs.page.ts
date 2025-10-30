import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { PlatformService } from '../services/platform.service';
import { AuthService, User } from '../services/auth.service';
import { Observable, Subject, takeUntil   } from 'rxjs';
import { UserService } from '../services/user.service';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: false,
})
export class TabsPage implements OnInit, OnDestroy {

  // Platform detection properties
  private destroy$ = new Subject<void>();
  showTabs = true;
  platformConfig: any = {};
  currentPlatform = 'unknown';
  currentUser: User | null = null;
  // Authentication properties
  user$: Observable<User | null>;
  isAuthenticated$: Observable<boolean>;

  constructor(
    private router: Router,
    public platformService: PlatformService,
    private authService: AuthService,
    private userService: UserService
  ) {
    this.user$ = this.authService.user$;
    console.log('user$', this.user$);
    this.user$.subscribe(user => {
      console.log('user', user);
      this.userService.getCurrentUser()
      .pipe(takeUntil(this.destroy$))
      .subscribe((user: any) => {
        console.log('Database user data:', user);
        this.currentUser = user;
        console.log('Current user:', this.currentUser);
      });
    });
    this.isAuthenticated$ = this.authService.isAuthenticated$;
  }

  private resizeListener: any;

  ngOnInit() {
    // Get platform information
    this.currentPlatform = this.platformService.getPlatform();
    this.platformConfig = this.platformService.getPlatformConfig();
    
    // Determine if we should show tabs based on platform AND viewport
    this.showTabs = this.shouldShowTabs();
    
    // Add window resize listener for reactive viewport detection
    this.resizeListener = () => {
      this.showTabs = this.shouldShowTabs();
      console.log('Window resized - Show tabs:', this.showTabs);
    };
    window.addEventListener('resize', this.resizeListener);
    
    // Ensure currentUser is loaded
    this.loadCurrentUser();
    
    console.log('Platform detected:', this.currentPlatform);
    console.log('Platform config:', this.platformConfig);
    console.log('Show tabs:', this.showTabs);
    console.log('Is web:', this.isWeb());
    console.log('Is mobile viewport:', this.isMobileViewport());
  }

  private loadCurrentUser() {
    this.userService.getCurrentUser()
      .pipe(takeUntil(this.destroy$))
      .subscribe((user: any) => {
        console.log('TabsPage: Database user data:', user);
        this.currentUser = user;
        console.log('TabsPage: Current user loaded:', this.currentUser);
        console.log('TabsPage: User type:', this.currentUser?.userType);
      });
  }

  ngOnDestroy() {
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
    }
  }

  // Determine if tabs should be shown
  shouldShowTabs(): boolean {
    // Always show tabs on mobile platforms (iOS/Android)
    if (this.isMobile()) {
      return true;
    }
    
    // On web: only show tabs if it's a mobile viewport
    if (this.isWeb()) {
      return this.isMobileViewport();
    }
    
    // Default to showing tabs
    return true;
  }

  // Check if current viewport is mobile-sized
  isMobileViewport(): boolean {
    return this.platformService.isSmallScreen();
  }

  openSearchTutors() {
    console.log('openSearchTutors');
    this.router.navigate(['/tabs/tutor-search']);
  }

  // Navigation methods for desktop web
  navigateTo(route: string) {
    console.log('Navigating to:', route);
    this.router.navigate([route]);
  }

  isCurrentRoute(route: string): boolean {
    return this.router.url === route;
  }


  // Helper methods for template
  isWeb() {
    return this.platformService.isWeb();
  }

  isMobile() {
    return this.platformService.isMobile();
  }

  isIOS() {
    return this.platformService.isIOS();
  }

  isAndroid() {
    return this.platformService.isAndroid();
  }

  getPlatformClass() {
    return this.platformService.getPlatformClass();
  }

  // Authentication methods
  async logout() {
    await this.authService.logout();
  }

  getUserInitials(user: User | null): string {
    console.log('getUserInitials', user);
    if (!user || !user.name) return '?';
    return user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }

  onImageError(event: any) {
    console.log('Image failed to load:', event);
    console.log('Image src was:', event.target.src);
    
    // Hide the image and show initials instead
    const img = event.target;
    const avatar = img.closest('ion-avatar');
    if (avatar) {
      img.style.display = 'none';
      const initialsDiv = avatar.querySelector('.user-initials');
      if (initialsDiv) {
        initialsDiv.style.display = 'block';
      }
    }
  }
}
