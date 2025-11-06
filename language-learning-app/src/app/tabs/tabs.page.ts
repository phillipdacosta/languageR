import { Component, OnInit, OnDestroy, HostListener, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
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
export class TabsPage implements OnInit, OnDestroy, AfterViewInit {

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
  // Notification dropdown state
  isNotificationDropdownOpen = false;
  // Dropdown positioning
  dropdownTop = 60;
  dropdownRight = 20;
  @ViewChild('notificationBtn', { read: ElementRef }) notificationBtn!: ElementRef;

  constructor(
    private router: Router,
    public platformService: PlatformService,
    private authService: AuthService,
    private userService: UserService,
    private messagingService: MessagingService
  ) {
    this.user$ = this.authService.user$;
    this.user$.subscribe(user => {
      if (user?.email) {
        this.userService.getCurrentUser()
        .pipe(takeUntil(this.destroy$))
        .subscribe((user: any) => {
          this.currentUser = user;
          
          // Load unread count once user is authenticated (important for page refresh)
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
    };
    window.addEventListener('resize', this.resizeListener);
    
    // Ensure currentUser is loaded
    this.loadCurrentUser();
    
    // Subscribe to the centralized unread count observable
    this.messagingService.unreadCount$.pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (count) => {
        this.unreadCount$.next(count);
      }
    });
    
    // Note: loadUnreadCount() is now called in the user$ subscription in the constructor
    // This ensures the user is authenticated before making API calls
  }

  private loadUnreadCount() {
    // Fetch conversations which will automatically update the unread count via the service
    this.messagingService.getConversations().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
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
        this.currentUser = user;
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
    this.router.navigate(['/tabs/tutor-search']);
  }

  // Navigation methods for desktop web
  navigateTo(route: string) {
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
    if (!user || !user.name) return '?';
    return user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }

  onImageError(event: any) {
    
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

  ngAfterViewInit() {
    // ViewChild is available after view init
  }

  toggleNotificationDropdown() {
    this.isNotificationDropdownOpen = !this.isNotificationDropdownOpen;
    
    if (this.isNotificationDropdownOpen && this.notificationBtn) {
      // Calculate position based on button location
      setTimeout(() => {
        const buttonRect = this.notificationBtn.nativeElement.getBoundingClientRect();
        const toolbarHeight = 60; // Height of the toolbar
        const dropdownWidth = 400;
        const spacing = 8; // Space between button and dropdown
        
        // Position dropdown below the button, aligned to the right
        this.dropdownTop = buttonRect.bottom + spacing;
        this.dropdownRight = window.innerWidth - buttonRect.right;
      }, 0);
    }
  }

  closeNotificationDropdown() {
    this.isNotificationDropdownOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    // Close dropdown if clicking outside of it (only on desktop)
    if (this.isNotificationDropdownOpen && this.isWeb() && !this.showTabs) {
      const target = event.target as HTMLElement;
      const dropdown = document.querySelector('.notification-dropdown');
      const container = document.querySelector('.notification-container');
      
      // Check if click is outside both dropdown and container
      if (dropdown && container && !dropdown.contains(target) && !container.contains(target)) {
        this.closeNotificationDropdown();
      }
    }
  }
}
