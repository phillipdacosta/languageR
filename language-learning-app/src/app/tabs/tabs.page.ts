import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { PlatformService } from '../services/platform.service';
import { AuthService, User } from '../services/auth.service';
import { Observable, Subject, BehaviorSubject, takeUntil, interval, switchMap } from 'rxjs';
import { UserService } from '../services/user.service';
import { MessagingService } from '../services/messaging.service';

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
  // Unread messages count
  unreadCount$ = new BehaviorSubject<number>(0);

  constructor(
    private router: Router,
    public platformService: PlatformService,
    private authService: AuthService,
    private userService: UserService,
    private messagingService: MessagingService
  ) {
    this.user$ = this.authService.user$;
    console.log('user$', this.user$);
    this.user$.subscribe(user => {
      console.log('user', user);
      if (user?.email) {
        this.userService.getCurrentUser()
        .pipe(takeUntil(this.destroy$))
        .subscribe((user: any) => {
          console.log('Database user data:', user);
          this.currentUser = user;
          console.log('Current user:', this.currentUser);
          
          // Load unread count once user is authenticated (important for page refresh)
          console.log('📬 TabsPage: User authenticated, loading initial unread count');
          this.loadUnreadCount();
        });
      }
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
    
    // Subscribe to the centralized unread count observable
    console.log('📬 TabsPage: Subscribing to messagingService.unreadCount$');
    this.messagingService.unreadCount$.pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (count) => {
        console.log('📬 TabsPage: Received unread count update:', count);
        console.log('📬 TabsPage: Setting local unreadCount$ to:', count);
        this.unreadCount$.next(count);
      }
    });
    
    // Note: loadUnreadCount() is now called in the user$ subscription in the constructor
    // This ensures the user is authenticated before making API calls
    
    console.log('Platform detected:', this.currentPlatform);
    console.log('Platform config:', this.platformConfig);
    console.log('Show tabs:', this.showTabs);
    console.log('Is web:', this.isWeb());
    console.log('Is mobile viewport:', this.isMobileViewport());
  }

  private loadUnreadCount() {
    console.log('📬 TabsPage: loadUnreadCount() called');
    // Fetch conversations which will automatically update the unread count via the service
    this.messagingService.getConversations().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        console.log('📬 TabsPage: Initial conversations loaded, count:', response.conversations?.length);
      },
      error: (error) => {
        console.error('❌ TabsPage: Error loading conversations for unread count:', error);
      }
    });
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
    const currentUrl = this.router.url;
    
    // Special handling for calendar tab - should highlight for all calendar-related routes
    if (route === '/tabs/tutor-calendar') {
      return currentUrl === '/tabs/tutor-calendar' ||
             currentUrl.startsWith('/tabs/tutor-calendar/') ||
             currentUrl === '/tabs/availability-setup' ||
             currentUrl.startsWith('/tabs/availability-setup');
    }
    
    return currentUrl === route;
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
