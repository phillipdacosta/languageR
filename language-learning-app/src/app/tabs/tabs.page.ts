import { Component, OnInit, OnDestroy, HostListener, ViewChild, ElementRef, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Location } from '@angular/common';
import { ModalController } from '@ionic/angular';
import { PlatformService } from '../services/platform.service';
import { AuthService, User } from '../services/auth.service';
import { Observable, Subject, BehaviorSubject, takeUntil, interval, switchMap, filter, take, combineLatest, of, observeOn, asyncScheduler, map } from 'rxjs';
import { UserService } from '../services/user.service';
import { MessagingService, Conversation } from '../services/messaging.service';
import { NotificationService, Notification } from '../services/notification.service';
import { WebSocketService } from '../services/websocket.service';
import { NotificationTranslationService } from '../services/notification-translation.service';
import { TranslateService } from '@ngx-translate/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { PaymentDisputeModalComponent } from '../components/payment-dispute-modal/payment-dispute-modal.component';
import { HomeInlineToolbarService } from '../services/home-inline-toolbar.service';

// 🚀 PERFORMANCE FIX: Type for formatted notifications with cached values
interface FormattedNotification extends Notification {
  formattedTime: string;
  sanitizedMessage: SafeHtml;
}

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: false,
})
export class TabsPage implements OnInit, OnDestroy, AfterViewInit {
  ionViewWillEnter() {
    console.log('📱 [TabsPage] ionViewWillEnter - ensuring WebSocket connection');
    // Ensure WebSocket is connected for real-time updates
    this.websocketService.ensureConnected();
    
    // Reload notification count when tabs page becomes active (important for page refresh)
    if (this.currentUser) {
      this.loadUnreadNotificationCount();
      // Also reload message count
      this.loadUnreadCount();
    }

  }

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
  // Unread notifications count (subscribed from service)
  unreadNotificationCount$: Observable<number>;
  // Notifications list (subscribed from service)
  notifications$: Observable<Notification[]>;
  // 🚀 PERFORMANCE FIX: Pre-formatted notifications with cached values
  formattedNotifications$!: Observable<FormattedNotification[]>;
  // Notification dropdown state
  isNotificationDropdownOpen = false;
  private notificationHoverTimer: any = null;
  private isHoveringNotificationDropdown = false;
  // Current route for tab highlighting
  currentRoute = '';

  get isHomePage(): boolean {
    return this.isCurrentRoute('/tabs/home');
  }

  /** True when home tab is showing inline My Materials (create-material) */
  homeMaterialsViewOpen = false;

  /** Dynamic back label for inline My Materials / create flow (from HomeInlineToolbarService) */
  homeMaterialsToolbarBackLabel = '';

  /** True when home tab is showing inline Explore Classes */
  homeExploreViewOpen = false;

  /** Dynamic back label for inline Explore (from HomeInlineToolbarService) */
  homeExploreToolbarBackLabel = '';

  /** Mobile toolbar left chrome — synced in updateMobileToolbarChrome() (not getters; avoids template “function” calls). */
  showMobileBarnabiInToolbar = false;
  showMobileBackInToolbar = true;
  showMobileHomeGreeting = false;

  // Track if a conversation is selected (for hiding tabs on mobile)
  hasSelectedConversation = false;
  
  /**
   * Remove tab bar from DOM (no animation). Profile uses CSS hide + bounce instead.
   */
  get shouldRemoveTabBarEntirely(): boolean {
    if (this.isCurrentRoute('/tabs/messages') && this.hasSelectedConversation) {
      return true;
    }

    if (this.isMobile() || this.isMobileViewport()) {
      const currentUrl = this.router.url;
      const normalizedUrl = currentUrl.split('?')[0].replace(/\/$/, '');
      if (normalizedUrl.includes('/schedule-class')) {
        return true;
      }
    }

    return false;
  }

  /** Mobile: slide tab bar off-screen on Profile (animated via CSS). */
  get hideMobileTabBarForProfile(): boolean {
    if (!this.showTabs || this.shouldRemoveTabBarEntirely) return false;
    return (this.isMobile() || this.isMobileViewport()) && this.isCurrentRoute('/tabs/profile');
  }

  /** One-shot bounce when leaving Profile on mobile (cleared after animation). */
  tabBarBounceAfterProfile = false;

  private previousNavUrl = '';

  private normalizeNavPath(url: string): string {
    return url.split('?')[0].replace(/\/$/, '');
  }
  
  // Computed property for calendar tab selection
  get isCalendarTabSelected(): boolean {
    return this.isCurrentRoute('/tabs/tutor-calendar');
  }
  
  // Computed property for messages tab selection
  get isMessagesTabSelected(): boolean {
    return this.isCurrentRoute('/tabs/messages');
  }

  get isTutorSearchTabSelected(): boolean {
    return this.isCurrentRoute('/tabs/tutor-search');
  }

  get isLessonsTabSelected(): boolean {
    return this.isCurrentRoute('/tabs/lessons');
  }

  // Dropdown positioning
  dropdownTop = 60;
  dropdownRight = 20;
  messagesDropdownTop = 60;
  messagesDropdownRight = 20;
  @ViewChild('notificationBtn', { read: ElementRef }) notificationBtn!: ElementRef;
  @ViewChild('messagesBtn', { read: ElementRef }) messagesBtn!: ElementRef;
  @ViewChild('navButtonsContainer', { read: ElementRef }) navButtonsContainer!: ElementRef;
  @ViewChild('homeBtn', { read: ElementRef }) homeBtn!: ElementRef;
  @ViewChild('tutorSearchBtn', { read: ElementRef }) tutorSearchBtn!: ElementRef;
  @ViewChild('calendarBtn', { read: ElementRef }) calendarBtn!: ElementRef;
  @ViewChild('lessonsBtn', { read: ElementRef }) lessonsBtn!: ElementRef;
  
  // Sliding pill indicator (desktop nav): position/size animate like the former underline
  underlineLeft = 0;
  underlineTop = 0;
  underlineWidth = 0;
  underlineHeight = 0;
  underlineSettling = false;
  private settleTimeout: any;
  // Note: notifications array removed - now using notifications$ observable from service
  isLoadingNotifications = false;
  // Messages dropdown state
  isMessagesDropdownOpen = false;
  conversations: Conversation[] = [];
  isLoadingConversations = false;
  private messagesHoverTimer: any = null;
  private messagesSubscription: any = null;
  private isHoveringMessagesDropdown = false;
  // Store reaction previews to persist across reloads
  private reactionPreviews: Map<string, { content: string; senderId: string; type: string }> = new Map();

  constructor(
    private router: Router,
    public platformService: PlatformService,
    private authService: AuthService,
    private userService: UserService,
    private messagingService: MessagingService,
    private notificationService: NotificationService,
    private websocketService: WebSocketService,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
    private modalController: ModalController,
    private notificationTranslation: NotificationTranslationService,
    private translateService: TranslateService,
    private homeInlineToolbar: HomeInlineToolbarService,
    private location: Location
  ) {
    // FIXED: Only assign observables in constructor, NO subscriptions
    this.user$ = this.authService.user$;
    this.isAuthenticated$ = this.authService.isAuthenticated$;
    this.unreadNotificationCount$ = this.notificationService.unreadCount$;
    this.notifications$ = this.notificationService.notifications$;
    
    // 🚀 PERFORMANCE FIX: Transform notifications to pre-compute formatted values
    this.formattedNotifications$ = this.notifications$.pipe(
      map(notifications => notifications.map(n => ({
        ...n,
        formattedTime: this.formatNotificationTime(n.createdAt),
        sanitizedMessage: this.sanitizer.bypassSecurityTrustHtml(this.notificationTranslation.getTranslatedMessage(n))
      })))
    );
    
    console.log('✅ TabsPage constructor completed (observables assigned, no subscriptions)');
  }

  private resizeListener: any;

  ngOnInit() {
    // Get platform information
    this.currentPlatform = this.platformService.getPlatform();
    this.platformConfig = this.platformService.getPlatformConfig();
    
    // Determine if we should show tabs based on platform AND viewport
    this.showTabs = this.shouldShowTabs();

    this.homeInlineToolbar.materialsViewOpen$
      .pipe(takeUntil(this.destroy$))
      .subscribe(open => {
        this.homeMaterialsViewOpen = open;
        this.updateMobileToolbarChrome();
      });

    this.homeInlineToolbar.materialsToolbarBackLabel$
      .pipe(takeUntil(this.destroy$))
      .subscribe(label => {
        this.homeMaterialsToolbarBackLabel = label;
        this.cdr.markForCheck();
      });

    this.homeInlineToolbar.exploreViewOpen$
      .pipe(takeUntil(this.destroy$))
      .subscribe(open => {
        this.homeExploreViewOpen = open;
        this.updateMobileToolbarChrome();
      });

    this.homeInlineToolbar.exploreToolbarBackLabel$
      .pipe(takeUntil(this.destroy$))
      .subscribe(label => {
        this.homeExploreToolbarBackLabel = label;
        this.cdr.markForCheck();
      });

    this.translateService.onLangChange.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.cdr.markForCheck();
    });

    // Add window resize listener for reactive viewport detection
    this.resizeListener = () => {
      this.showTabs = this.shouldShowTabs();
      this.updateMobileToolbarChrome();
      setTimeout(() => this.updateUnderline(), 50);
    };
    window.addEventListener('resize', this.resizeListener);
    
    // MOVED FROM CONSTRUCTOR: Subscribe to currentUser$ observable
    // Use asyncScheduler to prevent synchronous emission from blocking
    this.userService.currentUser$
      .pipe(
        observeOn(asyncScheduler), // Make emissions async to prevent freezing
        filter(user => user !== null),
        takeUntil(this.destroy$)
      )
      .subscribe((user: any) => {
        this.currentUser = user;
        this.updateMobileToolbarChrome();

        // Load counts when user is available
        this.loadUnreadCount();
        this.loadUnreadNotificationCount();
        
        // Preload conversations in background for faster dropdown
        this.refreshConversationsInBackground();

        setTimeout(() => this.updateUnderline(), 100);
      });
    
    // Connect to WebSocket
    this.websocketService.connect();
    
    // Fetch user once (will use cache if available, or fetch from API)
    this.userService.getCurrentUser()
      .pipe(take(1))
      .subscribe();
    
    this.previousNavUrl = this.normalizeNavPath(this.router.url);

    // Subscribe to router events to update tab highlighting on route changes
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((event: NavigationEnd) => {
      const to = this.normalizeNavPath(event.urlAfterRedirects || event.url);
      const from = this.previousNavUrl;
      const mobile = this.isMobile() || this.isMobileViewport();
      const wasProfile = from.includes('/tabs/profile');
      const nowProfile = to.includes('/tabs/profile');
      if (wasProfile && !nowProfile && mobile && this.showTabs && !this.shouldRemoveTabBarEntirely) {
        this.tabBarBounceAfterProfile = true;
        this.cdr.markForCheck();
        setTimeout(() => {
          this.tabBarBounceAfterProfile = false;
          this.cdr.markForCheck();
        }, 400);
      }
      this.previousNavUrl = to;

      // Update current route for tab highlighting
      this.currentRoute = event.url;
      this.updateMobileToolbarChrome();

      // Reload notification count when navigating away from notifications page
      // This ensures the red dot updates after marking notifications as read
      if (this.currentUser && !event.url.includes('/tabs/notifications')) {
        this.loadUnreadNotificationCount();
      }
      
      // Close dropdowns on navigation
      if (this.isMessagesDropdownOpen) {
        this.closeMessagesDropdown();
      }
      if (this.isNotificationDropdownOpen) {
        this.closeNotificationDropdown();
      }
      // Force change detection to update tab visibility (especially for messages route)
      this.cdr.markForCheck();
      setTimeout(() => this.cdr.detectChanges(), 0);
      setTimeout(() => {
        this.cdr.markForCheck();
        setTimeout(() => this.cdr.detectChanges(), 0);
      }, 100);
      
      // Update sliding underline position
      setTimeout(() => this.updateUnderline(), 50);

    });
    
    // Initialize current route
    this.currentRoute = this.router.url;
    this.updateMobileToolbarChrome();

    // Subscribe to the SHARED conversations from MessagingService (single source of truth)
    this.messagingService.conversations$.pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (conversations) => {
        this.conversations = conversations;
        // Process for reactions
        this.processConversationsForReactions();
        setTimeout(() => this.cdr.detectChanges(), 0);
      }
    });
    
    // Subscribe to the centralized unread count observable from MessagingService
    // This is the SINGLE source of truth for unread count
    this.messagingService.unreadCount$.pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (count) => {
        this.unreadCount$.next(count);
        setTimeout(() => this.cdr.detectChanges(), 0);
      }
    });
    
    // Subscribe to conversation selection state (for hiding tabs when viewing a conversation)
    this.messagingService.hasSelectedConversation$.pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (hasSelection) => {
        this.hasSelectedConversation = hasSelection;
        this.cdr.markForCheck();
        setTimeout(() => this.cdr.detectChanges(), 0);
      }
    });

    // NO WebSocket handling for unread counts in tabs page!
    // The messages.page.ts will handle ALL unread count updates via MessagingService
    // This ensures consistent behavior regardless of where messages are sent from
    
    // Load notifications when user is authenticated and currentUser is loaded
    this.user$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(user => {
      if (user?.email && this.currentUser) {
        // Small delay to ensure currentUser is set in UserService
        setTimeout(() => {
          this.loadNotifications();
          this.loadUnreadNotificationCount();
          // Preload conversations for instant dropdown display
          this.loadConversations();
          // Always subscribe to message updates for real-time conversation list
          this.subscribeToMessageUpdates();
        }, 500);
      }
    });

    // Listen for WebSocket notifications
    this.websocketService.connect();
    this.websocketService.newNotification$.pipe(
      takeUntil(this.destroy$)
    ).subscribe((notificationData) => {
      console.log('🔔 Received new notification via WebSocket:', notificationData);
      // Only reload if user is authenticated
      if (this.currentUser) {
        // Reload notifications when a new one arrives
        this.loadNotifications();
        // Also update unread count immediately
        this.loadUnreadNotificationCount();
      }
    });
    
    // Listen for WebSocket reconnection to re-establish message listeners
    this.websocketService.connection$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(isConnected => {
      console.log('📬 [TabsPage] WebSocket connection status changed:', isConnected);
      if (isConnected && this.currentUser) {
        // Re-subscribe to message updates when WebSocket reconnects
        console.log('📬 [TabsPage] WebSocket reconnected - re-subscribing to message updates');
        this.subscribeToMessageUpdates();
        // Also reload conversations to get accurate unread counts
        setTimeout(() => {
          this.loadConversations();
        }, 500);
      }
    });
    
    // Note: loadUnreadCount() is now called in the user$ subscription in the constructor
    // This ensures the user is authenticated before making API calls
    
    // Update browser tab title with unread count (notifications + messages)
    combineLatest([
      this.unreadNotificationCount$,
      this.unreadCount$
    ]).pipe(
      takeUntil(this.destroy$)
    ).subscribe(([notificationCount, messageCount]) => {
      const totalUnread = notificationCount + messageCount;
      this.updateBrowserTabTitle(totalUnread);
    });

    this.updateMobileToolbarChrome();
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

  ngOnDestroy() {
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
    }
    this.unsubscribeFromMessageUpdates();
    this.destroy$.next();
    this.destroy$.complete();
  }

  getUserInitial(): string {
    if (!this.currentUser) return '?';
    if (this.currentUser['firstName']) {
      return this.currentUser['firstName'].charAt(0).toUpperCase();
    }
    if (this.currentUser['name']) {
      return this.currentUser['name'].charAt(0).toUpperCase();
    }
    return '?';
  }

  // Determine if tabs should be shown
  shouldShowTabs(): boolean {
    // Force desktop navigation for larger screens (prevents Windows/Chrome from showing mobile tabs)
    // If screen is wide, we should use desktop nav regardless of platform detection
    const screenWidth = window.innerWidth;
    if (screenWidth >= 992) {
      return false; // Always use desktop nav on large screens
    }
    
    // Always show tabs on mobile platforms (iOS/Android)
    if (this.isMobile()) {
      return true;
    }
    
    // On web: only show tabs if it's a mobile viewport
    if (this.isWeb()) {
      return this.isMobileViewport();
    }
    
    // Default: if screen is narrow, show tabs; otherwise use desktop nav
    return screenWidth < 768;
  }

  // Check if current viewport is mobile-sized
  isMobileViewport(): boolean {
    return this.platformService.isSmallScreen();
  }

  openSearchTutors() {
    if (this.router.url === '/tabs/tutor-search') {
      this.router.navigateByUrl('/tabs/tutor-search', { replaceUrl: false });
    } else {
      this.router.navigate(['/tabs/tutor-search']);
    }
  }

  // Navigation methods for desktop web
  navigateTo(route: string) {
    if (route === '/tabs/tutor-calendar') {
      this.router.navigateByUrl('/tabs/tutor-calendar');
      return;
    }
    this.router.navigate([route]);
  }

  /** Mobile home only: drives gradient header (not used on Lessons / Messages / Calendar). */
  get showMobileBrandInToolbar(): boolean {
    return this.isHomePage && !this.homeMaterialsViewOpen && !this.homeExploreViewOpen;
  }

  /** Tutor on mobile: show "$" pill in toolbar on every tab */
  get isTutorMobile(): boolean {
    return !!this.currentUser && (this.currentUser as any).userType === 'tutor';
  }

  /** Sync Barnabi vs back + home gradient flags from route and inline panel state. */
  private updateMobileToolbarChrome(): void {
    const materialsOrExplore = this.homeMaterialsViewOpen || this.homeExploreViewOpen;
    let barnabi = false;
    if (!materialsOrExplore && this.isHomePage) {
      barnabi = true;
    } else if (!materialsOrExplore) {
      const path = this.router.url.split('?')[0].replace(/\/$/, '');
      if (path === '/tabs/lessons') {
        barnabi = true;
      } else if (this.isCurrentRoute('/tabs/messages')) {
        barnabi = true;
      } else if (this.isCalendarTabSelected) {
        barnabi = true;
      }
    }
    this.showMobileBarnabiInToolbar = barnabi;
    this.showMobileBackInToolbar = !barnabi;
    this.showMobileHomeGreeting =
      this.isHomePage && !materialsOrExplore && !!this.currentUser;
    this.cdr.markForCheck();
  }

  onToolbarEarningsTap(): void {
    if (!this.isHomePage) {
      this.homeInlineToolbar.pendingOpenEarnings = true;
      this.router.navigate(['/tabs/home']);
    } else {
      this.homeInlineToolbar.requestOpenEarnings();
    }
  }

  onMobileToolbarBack(): void {
    if (this.homeExploreViewOpen) {
      this.homeInlineToolbar.requestCloseExploreView();
    } else if (this.homeMaterialsViewOpen) {
      this.homeInlineToolbar.requestCloseMaterialsView();
    } else {
      this.location.back();
    }
  }

  isCurrentRoute(route: string): boolean {
    // Always get fresh URL to ensure accuracy, especially on mobile
    const currentUrl = this.router.url;
    // Remove query parameters and trailing slashes for comparison
    const normalizedUrl = currentUrl.split('?')[0].replace(/\/$/, '');
    
    // Special handling for calendar tab - should highlight for all calendar-related routes
    if (route === '/tabs/tutor-calendar') {
      const isCalendarRoute = normalizedUrl === '/tabs/tutor-calendar' ||
                              normalizedUrl.startsWith('/tabs/tutor-calendar/') ||
                              normalizedUrl === '/tabs/availability-setup' ||
                              normalizedUrl.startsWith('/tabs/availability-setup/');
      return isCalendarRoute;
    }
    
    const normalizedRoute = route.replace(/\/$/, '');
    return normalizedUrl === normalizedRoute || normalizedUrl.startsWith(normalizedRoute + '/');
  }

  // Update sliding underline position based on active route
  updateUnderline() {
    // Pill nav styling only applies from 992px up; keep indicator out of DOM when hidden
    if (this.showTabs || !this.navButtonsContainer || window.innerWidth < 992) {
      this.underlineWidth = 0;
      this.underlineHeight = 0;
      return;
    }

    let activeButton: ElementRef | null = null;

    // Find which button is active based on current route
    if (this.isCurrentRoute('/tabs/home') && this.homeBtn) {
      activeButton = this.homeBtn;
    } else if (this.isCurrentRoute('/tabs/tutor-search') && this.tutorSearchBtn) {
      activeButton = this.tutorSearchBtn;
    } else if (this.isCurrentRoute('/tabs/tutor-calendar') && this.calendarBtn) {
      activeButton = this.calendarBtn;
    } else if (this.isCurrentRoute('/tabs/messages') && this.messagesBtn) {
      activeButton = this.messagesBtn;
    } else if (this.isCurrentRoute('/tabs/lessons') && this.lessonsBtn) {
      activeButton = this.lessonsBtn;
    } else if (this.isCurrentRoute('/tabs/notifications') && this.notificationBtn) {
      activeButton = this.notificationBtn;
    }

    if (activeButton && activeButton.nativeElement) {
      const containerRect = this.navButtonsContainer.nativeElement.getBoundingClientRect();
      const buttonRect = activeButton.nativeElement.getBoundingClientRect();

      const newLeft = buttonRect.left - containerRect.left;
      const moved = newLeft !== this.underlineLeft || this.underlineWidth !== buttonRect.width;

      this.underlineLeft = newLeft;
      this.underlineTop = buttonRect.top - containerRect.top;
      this.underlineWidth = buttonRect.width;
      this.underlineHeight = buttonRect.height;

      if (moved) {
        this.underlineSettling = false;
        clearTimeout(this.settleTimeout);
        this.settleTimeout = setTimeout(() => {
          this.underlineSettling = true;
          this.settleTimeout = setTimeout(() => { this.underlineSettling = false; }, 400);
        }, 450);
      }
    } else {
      this.underlineWidth = 0;
      this.underlineHeight = 0;
    }
  }

  // Helper methods for template
  isWeb() {
    return this.platformService.isWeb();
  }

  // Getter for unread count (for debugging)
  get unreadMessageCount(): number {
    return this.unreadCount$.value;
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
    console.error('❌ Avatar image failed to load in tabs:', {
      src: event.target?.src,
      currentUserPicture: this.currentUser?.picture,
      errorType: event.type
    });
    
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

  onNotificationImageError(event: any, notification: any) {
    const img = event.target as HTMLImageElement;
    const originalSrc = img?.src;
    
    console.error('❌ Notification avatar image failed to load:', {
      src: originalSrc,
      notificationId: notification?._id,
      notificationType: notification?.type,
      relatedUserPicture: notification?.relatedUserPicture,
      errorType: event.type
    });
    
    // Hide the broken image
    if (img) {
      img.style.display = 'none';
      img.onerror = null; // Prevent infinite error loop
      
      // Find the parent container and show fallback
      const container = img.closest('.notification-item-left');
      if (container) {
        // Create or show fallback icon wrapper
        let fallback = container.querySelector('.notification-icon-wrapper.fallback') as HTMLElement;
        if (!fallback) {
          fallback = document.createElement('div');
          fallback.className = 'notification-icon-wrapper fallback';
          const icon = document.createElement('ion-icon');
          icon.name = 'person';
          icon.className = 'notification-item-icon';
          fallback.appendChild(icon);
          container.insertBefore(fallback, img);
        }
        fallback.style.display = 'flex';
      }
    }
    
    // Clear the relatedUserPicture to prevent retry attempts
    if (notification) {
      notification.relatedUserPicture = null;
    }
  }

  ngAfterViewInit() {
    // ViewChild is available after view init
    // Update underline position after view is initialized
    setTimeout(() => {
      this.updateUnderline();
    }, 100);
  }

  loadNotifications() {
    // Only load if user is authenticated
    if (!this.currentUser) {
      console.warn('⚠️ Cannot load notifications: user not loaded yet');
      return;
    }

    this.isLoadingNotifications = true;
    this.notificationService.getNotifications().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        if (response.success) {
          // Notifications are now automatically updated via the service's BehaviorSubject
          console.log('✅ Loaded', response.notifications.length, 'notifications');
        }
        this.isLoadingNotifications = false;
        // Load unread count from API for accuracy (single source of truth)
        this.loadUnreadNotificationCount();
      },
      error: (error) => {
        console.error('❌ Error loading notifications:', error);
        console.error('❌ Error status:', error.status);
        console.error('❌ Error message:', error.message);
        console.error('❌ Error URL:', error.url);
        this.isLoadingNotifications = false;
      }
    });
  }

  toggleNotificationDropdown() {
    if (this.isMobile() || this.isMobileViewport()) {
      this.router.navigate(['/tabs/notifications']);
      return;
    }
    this.isNotificationDropdownOpen = !this.isNotificationDropdownOpen;
    if (this.isNotificationDropdownOpen) {
      this.loadNotifications();
      this.calculateDropdownPosition();
    }
  }

  // Notification dropdown methods (hover-based like messages)
  onNotificationButtonClick() {
    // Clear hover timer to prevent dropdown from opening
    if (this.notificationHoverTimer) {
      clearTimeout(this.notificationHoverTimer);
      this.notificationHoverTimer = null;
    }

    // Toggle dropdown on click (navigation temporarily disabled)
    if (this.isNotificationDropdownOpen) {
      this.closeNotificationDropdown();
    } else {
      this.isNotificationDropdownOpen = true;
      this.loadNotifications();
      this.calculateDropdownPosition();
    }
  }
  
  onNotificationButtonMouseEnter() {
    if (this.isMobile() || this.isMobileViewport() || !this.isWeb() || this.showTabs) {
      return; // Only on desktop
    }
    
    // Don't show dropdown if notifications tab is already active
    if (this.isCurrentRoute('/tabs/notifications')) {
      return;
    }
    
    // Clear any existing timer
    if (this.notificationHoverTimer) {
      clearTimeout(this.notificationHoverTimer);
    }
    
    // Set timer for 600ms before opening (same as messages)
    this.notificationHoverTimer = setTimeout(() => {
      this.openNotificationDropdown();
    }, 600);
  }

  onNotificationButtonMouseLeave() {
    // Clear timer if user moves mouse away
    if (this.notificationHoverTimer) {
      clearTimeout(this.notificationHoverTimer);
      this.notificationHoverTimer = null;
    }
    
    // Use a small delay to allow mouse to move to dropdown
    // If mouse doesn't enter dropdown within 100ms, close it
    setTimeout(() => {
      if (this.isNotificationDropdownOpen && !this.isHoveringNotificationDropdown) {
        this.closeNotificationDropdown();
      }
    }, 100);
  }
  
  onNotificationDropdownMouseEnter() {
    this.isHoveringNotificationDropdown = true;
  }
  
  onNotificationDropdownMouseLeave() {
    this.isHoveringNotificationDropdown = false;
    // Close immediately when mouse leaves dropdown
    this.closeNotificationDropdown();
  }

  openNotificationDropdown() {
    if (this.isMobile() || this.isMobileViewport() || !this.isWeb() || this.showTabs) {
      return;
    }
    
    // Don't show dropdown if notifications tab is already active
    if (this.isCurrentRoute('/tabs/notifications')) {
      return;
    }
    
    this.isNotificationDropdownOpen = true;
    this.calculateDropdownPosition();
    
    // Always reload notifications when dropdown opens (updates the observable)
    this.loadNotifications();
  }
  
  navigateToNotifications() {
    this.closeNotificationDropdown();
    this.router.navigate(['/tabs/notifications']);
  }

  navigateToTutorCalendar() {
    this.closeNotificationDropdown();
    this.router.navigate(['/tabs/availability-setup']);
  }

  navigateToProgress() {
    this.closeNotificationDropdown();
    this.router.navigate(['/tabs/progress']);
  }

  private calculateDropdownPosition() {
    if (!this.notificationBtn) {
      return;
    }
    const buttonRect = this.notificationBtn.nativeElement.getBoundingClientRect();
    this.dropdownTop = buttonRect.bottom + window.scrollY + 12;
    this.dropdownRight = window.innerWidth - buttonRect.right - window.scrollX;
  }

  // Removed getUnreadNotifications() - use (notifications$ | async) with filter in template
  // Removed getReadNotifications() - use (notifications$ | async) with filter in template

  formatNotificationTime(createdAt: Date | string): string {
    const date = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    const t = (key: string, params?: any) => this.translateService.instant(key, params);

    if (diffMins < 1) return t('NOTIFICATIONS.TIME.JUST_NOW');
    if (diffMins === 1) return t('NOTIFICATIONS.TIME.MINUTE_AGO', { count: 1 });
    if (diffMins < 60) return t('NOTIFICATIONS.TIME.MINUTES_AGO', { count: diffMins });
    if (diffHours === 1) return t('NOTIFICATIONS.TIME.HOUR_AGO', { count: 1 });
    if (diffHours < 24) return t('NOTIFICATIONS.TIME.HOURS_AGO', { count: diffHours });
    if (diffDays === 1) return t('NOTIFICATIONS.TIME.DAY_AGO', { count: 1 });
    if (diffDays < 7) return t('NOTIFICATIONS.TIME.DAYS_AGO', { count: diffDays });
    const lang = this.translateService.currentLang || this.translateService.defaultLang || 'en';
    return date.toLocaleDateString(lang);
  }

  sanitizeNotificationMessage(message: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(message);
  }

  // 🚀 PERFORMANCE FIX: TrackBy functions to prevent unnecessary DOM re-rendering
  trackByNotificationId(index: number, notification: Notification): string {
    return notification._id || index.toString();
  }

  trackByConversationId(index: number, conversation: any): string {
    return conversation._id || conversation.id || index.toString();
  }

  getNotificationIcon(type: string): string {
    const iconMap: { [key: string]: string } = {
      'lesson_created': 'videocam',
      'lesson_reminder': 'videocam',
      'lesson_cancelled': 'close-circle',
      'lesson_rescheduled': 'videocam',
      'office_hours_booking': 'videocam',
      'office_hours_starting': 'videocam',
      'lesson_analysis_ready': 'analytics',
      'class_invitation': 'people',
      'class_accepted': 'people',
      'class_cancelled': 'videocam',
      'class_auto_cancelled': 'videocam',
      'class_removed': 'videocam',
      'class_invitation_cancelled': 'videocam',
      'invitation_cancelled': 'videocam',
      'message': 'chatbubbles',
      'progress_milestone': 'trophy',
      'credential_approved': 'shield-checkmark',
      'credential_rejected': 'shield'
    };
    return iconMap[type] || 'notifications';
  }

  getNotificationIconClass(type: string): string {
    if (['lesson_created', 'lesson_reminder', 'lesson_rescheduled', 'office_hours_booking', 'office_hours_starting', 'class_cancelled', 'class_auto_cancelled', 'class_removed', 'class_invitation_cancelled', 'invitation_cancelled'].includes(type)) {
      return 'lesson-icon';
    }
    if (type === 'lesson_analysis_ready') {
      return 'analysis-icon';
    }
    if (['class_invitation', 'class_accepted'].includes(type)) {
      return 'class-invitation-icon';
    }
    if (type === 'payment_received') {
      return 'payment-icon';
    }
    if (['payment_cancelled', 'payment_reduced'].includes(type)) {
      return 'payment-cancelled-icon';
    }
    return '';
  }

  // NEW: Check if notification is from system (app)
  isSystemNotification(type: string): boolean {
    const systemTypes = [
      'tutor_video_approved',
      'tutor_video_rejected',
      'lesson_analysis_ready',
      'credential_approved',
      'credential_rejected'
    ];
    return systemTypes.includes(type);
  }

  // NEW: Check if notification is money-related
  isMoneyNotification(type: string): boolean {
    const moneyTypes = [
      'payment_received'
    ];
    return moneyTypes.includes(type);
  }

  // NEW: Get contextual icon for right side
  getContextualIcon(type: string): string {
    const contextualIcons: { [key: string]: string } = {
      'lesson_created': 'videocam',
      'lesson_reminder': 'alarm',
      'lesson_cancelled': 'close-circle',
      'lesson_rescheduled': 'calendar',
      'class_invitation': 'people',
      'class_cancelled': 'videocam',
      'class_auto_cancelled': 'videocam',
      'class_removed': 'videocam',
      'class_invitation_cancelled': 'videocam',
      'invitation_cancelled': 'videocam',
      'office_hours_booking': 'briefcase',
      'office_hours_starting': 'play',
      'payment_received': 'cash',
      'message': 'chatbubble-ellipses'
    };
    return contextualIcons[type] || '';
  }

  // NEW: Get CSS class for contextual icon
  getContextualIconClass(type: string): string {
    if (type === 'payment_received') {
      return 'contextual-icon money-icon';
    } else if (type === 'lesson_created' || type === 'lesson_reminder' || type === 'class_invitation' || type === 'class_cancelled' || type === 'class_auto_cancelled' || type === 'class_removed' || type === 'class_invitation_cancelled' || type === 'invitation_cancelled') {
      return 'contextual-icon lesson-icon';
    } else if (type === 'message') {
      return 'contextual-icon message-icon';
    }
    return 'contextual-icon';
  }

  loadUnreadNotificationCount() {
    // Only load if user is authenticated
    if (!this.currentUser) {
      return;
    }

    // The service will automatically update its unreadCount$ observable
    this.notificationService.getUnreadCount().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        // Count is automatically updated via the service's BehaviorSubject
      },
      error: (error) => {
        // Only log errors if it's not a 404 (which means user might not be authenticated yet)
        if (error.status !== 404) {
          console.error('Error loading unread notification count:', error);
        }
      }
    });
  }

  private updateBrowserTabTitle(unreadCount: number) {
    const baseTitle = 'Barnabi'; // Base title for your app
    if (unreadCount > 0) {
      document.title = `${baseTitle} (${unreadCount})`;
    } else {
      document.title = baseTitle;
    }
  }

  onNotificationClick(notification: Notification) {
    // Mark as read if unread (but keep it visible and update in place)
    if (!notification.read) {
      notification.read = true;
      notification.readAt = new Date();
      
      this.notificationService.markAsRead(notification._id).pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: () => {
          // Don't reload - just update the unread count
          this.notificationService.refreshUnreadCount();
        },
        error: (error) => {
          console.error('Error marking notification as read:', error);
          // Revert on error
          notification.read = false;
          notification.readAt = null;
        }
      });
    }

    // Navigate based on notification type
    if (notification.type === 'lesson_created' && notification.data?.lessonId) {
      // Navigate to lessons page with lesson ID to scroll to
      this.router.navigate(['/tabs/lessons'], { 
        queryParams: { 
          scrollToLesson: notification.data.lessonId 
        } 
      });
      this.closeNotificationDropdown(); // Close for lessons
    } else if (notification.type === 'message') {
      this.router.navigate(['/tabs/messages']);
      this.closeNotificationDropdown(); // Close for messages
    } else if (notification.type === 'payment_received' && notification.data?.lessonId) {
      // Navigate to earnings page with lesson ID to scroll to
      this.router.navigate(['/tabs/home/earnings'], { 
        queryParams: { 
          scrollToLesson: notification.data.lessonId 
        } 
      });
      this.closeNotificationDropdown(); // Close for earnings
    } else if (notification.type === 'lesson_analysis_ready' && notification.data?.lessonId) {
      // Navigate to lesson analysis page
      this.router.navigate(['/lesson-analysis', notification.data.lessonId]);
      this.closeNotificationDropdown(); // Close for analysis
    } else if (notification.type === 'class_invitation' && notification.data?.classId) {
      // Note: Class invitation modal would need to be opened here if needed
      this.router.navigate(['/tabs/home']);
      this.closeNotificationDropdown(); // Close for home
    }
    // If no navigation happens, dropdown stays open (notification just gets marked as read)
  }

  closeNotificationDropdown() {
    this.isNotificationDropdownOpen = false;
    this.isHoveringNotificationDropdown = false;
    if (this.notificationHoverTimer) {
      clearTimeout(this.notificationHoverTimer);
      this.notificationHoverTimer = null;
    }
  }

  async openDisputeModal(notification: Notification, event: Event) {
    // Prevent the notification click from triggering
    event.stopPropagation();
    
    console.log('🔔 Opening dispute modal for notification:', notification);
    
    const modal = await this.modalController.create({
      component: PaymentDisputeModalComponent,
      componentProps: {
        notification: notification
      },
      cssClass: 'payment-dispute-modal'
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data?.disputed) {
      // Reload notifications to reflect any changes
      console.log('✅ Dispute submitted, reloading notifications');
      this.loadNotifications();
      this.loadUnreadNotificationCount();
    }
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
    
    // Close messages dropdown if clicking outside of it (only on desktop)
    if (this.isMessagesDropdownOpen && this.isWeb() && !this.showTabs) {
      const target = event.target as HTMLElement;
      const dropdown = document.querySelector('.messages-dropdown');
      const button = this.messagesBtn?.nativeElement;
      
      // Check if click is outside both dropdown and button
      if (dropdown && button && !dropdown.contains(target) && !button.contains(target)) {
        this.closeMessagesDropdown();
      }
    }
  }

  // Messages dropdown methods
  onMessagesButtonClick() {
    // Clear hover timer to prevent dropdown from opening
    if (this.messagesHoverTimer) {
      clearTimeout(this.messagesHoverTimer);
      this.messagesHoverTimer = null;
    }
    
    // Close dropdown if it's open
    if (this.isMessagesDropdownOpen) {
      this.closeMessagesDropdown();
    }
    
    // Navigate to messages page
    this.navigateTo('/tabs/messages');
  }
  
  onMessagesButtonMouseEnter() {
    if (this.isMobile() || this.isMobileViewport() || !this.isWeb() || this.showTabs) {
      return; // Only on desktop
    }
    
    // Don't show dropdown if messages tab is already active
    if (this.isCurrentRoute('/tabs/messages')) {
      return;
    }
    
    // Clear any existing timer
    if (this.messagesHoverTimer) {
      clearTimeout(this.messagesHoverTimer);
    }
    
    // Set timer for 1.5 seconds before opening
    this.messagesHoverTimer = setTimeout(() => {
      this.openMessagesDropdown();
    }, 600);
  }

  onMessagesButtonMouseLeave() {
    // Clear timer if user moves mouse away
    if (this.messagesHoverTimer) {
      clearTimeout(this.messagesHoverTimer);
      this.messagesHoverTimer = null;
    }
    
    // Use a small delay to allow mouse to move to dropdown
    // If mouse doesn't enter dropdown within 100ms, close it
    setTimeout(() => {
      if (this.isMessagesDropdownOpen && !this.isHoveringMessagesDropdown) {
        this.closeMessagesDropdown();
      }
    }, 100);
  }
  
  onMessagesDropdownMouseEnter() {
    this.isHoveringMessagesDropdown = true;
  }
  
  onMessagesDropdownMouseLeave() {
    this.isHoveringMessagesDropdown = false;
    // Close immediately when mouse leaves dropdown
    this.closeMessagesDropdown();
  }

  openMessagesDropdown() {
    if (this.isMobile() || this.isMobileViewport() || !this.isWeb() || this.showTabs) {
      return;
    }
    
    // Don't show dropdown if messages tab is already active
    if (this.isCurrentRoute('/tabs/messages')) {
      return;
    }
    
    this.isMessagesDropdownOpen = true;
    this.calculateMessagesDropdownPosition();
    
    // No need to load - conversations are shared via MessagingService.conversations$
    // The dropdown automatically shows the latest data from the shared observable
    setTimeout(() => this.cdr.detectChanges(), 0);
  }

  closeMessagesDropdown() {
    this.isMessagesDropdownOpen = false;
    this.isHoveringMessagesDropdown = false;
    if (this.messagesHoverTimer) {
      clearTimeout(this.messagesHoverTimer);
      this.messagesHoverTimer = null;
    }
    // Don't unsubscribe - keep WebSocket active for real-time updates
  }

  private subscribeToMessageUpdates() {
    // Unsubscribe from any existing subscription
    this.unsubscribeFromMessageUpdates();
    
    console.log('📬 [TabsPage] Subscribing to message updates via WebSocket');
    
    // Subscribe to new messages via WebSocket - always active for real-time updates
    this.messagesSubscription = this.websocketService.newMessage$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(message => {
      console.log('📬 [TabsPage] Received message via WebSocket:', {
        id: message.id,
        senderId: message.senderId,
        receiverId: message.receiverId,
        content: message.content?.slice(0, 30)
      });
      
      const currentUserId = this.currentUser?.['auth0Id'] || this.currentUser?.['id'];
      if (!currentUserId) {
        console.log('📬 [TabsPage] No currentUserId, ignoring message');
        return;
      }
      
      // Normalize user IDs for comparison
      const normalizeUserId = (id: string) => {
        if (!id) return '';
        return id.replace('dev-user-', '');
      };
      
      const normalizedCurrentUserId = normalizeUserId(currentUserId);
      const normalizedSenderId = normalizeUserId(message.senderId);
      const normalizedReceiverId = normalizeUserId(message.receiverId);
      
      // Check if this message is for the current user
      const participatesInMessage = normalizedSenderId === normalizedCurrentUserId || 
                                     normalizedReceiverId === normalizedCurrentUserId;
      
      console.log('📬 [TabsPage] Message participation check:', {
        participatesInMessage,
        normalizedCurrentUserId,
        normalizedSenderId,
        normalizedReceiverId
      });
      
      if (!participatesInMessage) {
        console.log('📬 [TabsPage] Message not for current user, ignoring');
        return; // Message not for current user
      }
      
      console.log('📬 [TabsPage] Updating conversation from message...');
      // Update conversations list in background (works whether dropdown is open or not)
      this.updateConversationFromMessage(message, normalizedCurrentUserId, normalizedSenderId);
    });
    
    // Subscribe to reaction updates via WebSocket
    this.websocketService.reactionUpdated$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(reactionData => {
      this.updateConversationFromReaction(reactionData);
    });
  }

  private unsubscribeFromMessageUpdates() {
    if (this.messagesSubscription) {
      this.messagesSubscription.unsubscribe();
      this.messagesSubscription = null;
    }
  }

  private updateConversationFromMessage(message: any, currentUserId: string, senderId: string) {
    // Find the conversation this message belongs to
    const conversationId = message.conversationId;
    const conversation = this.conversations.find(c => c.conversationId === conversationId);
    
    console.log('📬 [TabsPage] updateConversationFromMessage:', {
      conversationId,
      foundConversation: !!conversation,
      conversationsCount: this.conversations.length
    });
    
    if (conversation) {
      // Clear reaction preview since we have a new message
      this.reactionPreviews.delete(conversationId);
      
      // Update existing conversation
      conversation.lastMessage = {
        content: message.content || '',
        senderId: message.senderId,
        createdAt: message.createdAt,
        type: message.type || 'text',
        isSystemMessage: message.isSystemMessage || false
      };
      conversation.updatedAt = message.createdAt;
      
      // Update unread count if message is for current user
      const isMyMessage = senderId === currentUserId;
      console.log('📬 [TabsPage] Is my message?', isMyMessage);
      
      if (!isMyMessage && message.receiverId) {
        const normalizeUserId = (id: string) => id?.replace('dev-user-', '') || '';
        const normalizedReceiverId = normalizeUserId(message.receiverId);
        const normalizedCurrentUserId = normalizeUserId(currentUserId);
        
        if (normalizedReceiverId === normalizedCurrentUserId) {
          conversation.unreadCount = (conversation.unreadCount || 0) + 1;
          
          // Update global unread count
          const currentUnread = this.unreadCount$.value;
          const newUnread = currentUnread + 1;
          console.log('📬 [TabsPage] 🔴 Updating unread count:', currentUnread, '->', newUnread);
          this.unreadCount$.next(newUnread);
        }
      }
      
      // Move conversation to top (most recent first)
      this.conversations = this.conversations.filter(c => c.conversationId !== conversationId);
      this.conversations.unshift(conversation);
      
      console.log('📬 [TabsPage] Conversation updated, triggering change detection');
      setTimeout(() => this.cdr.detectChanges(), 0);
    } else {
      // New conversation - reload the list
      console.log('📬 New conversation detected, reloading conversations...');
      
      // IMMEDIATELY increment unread count for new conversation messages
      // (if the message is for the current user, not sent by them)
      const isMyMessage = senderId === currentUserId;
      if (!isMyMessage && message.receiverId) {
        const normalizeUserId = (id: string) => id?.replace('dev-user-', '') || '';
        const normalizedReceiverId = normalizeUserId(message.receiverId);
        const normalizedCurrentUserId = normalizeUserId(currentUserId);
        
        if (normalizedReceiverId === normalizedCurrentUserId) {
          const currentUnread = this.unreadCount$.value;
          const newUnread = currentUnread + 1;
          console.log('📬 [TabsPage] 🔴 New conversation - Updating unread count:', currentUnread, '->', newUnread);
          this.unreadCount$.next(newUnread);
          this.cdr.detectChanges();
        }
      }
      
      // Force reload even if currently loading by resetting the flag after a short delay
      if (this.isLoadingConversations) {
        setTimeout(() => {
          this.isLoadingConversations = false;
          this.loadConversations();
        }, 500);
      } else {
        this.loadConversations();
      }
    }
  }

  private updateConversationFromReaction(reactionData: any) {
    console.log('💬 [Tabs] Updating conversation from reaction:');
    console.log('💬 [Tabs] - messageId:', reactionData.messageId);
    console.log('💬 [Tabs] - conversationId:', reactionData.conversationId);
    console.log('💬 [Tabs] - isReaction:', reactionData.isReaction);
    console.log('💬 [Tabs] - emoji:', reactionData.emoji);
    console.log('💬 [Tabs] - reactorId:', reactionData.reactorId);
    console.log('💬 [Tabs] - reactorName:', reactionData.reactorName);
    
    const currentUserId = this.currentUser?.['auth0Id'] || this.currentUser?.['id'];
    console.log('💬 [Tabs] - currentUserId:', currentUserId);
    
    if (!currentUserId || !reactionData.emoji) {
      console.log('💬 [Tabs] Skipping reaction update - no user or emoji removed');
      console.log('💬 [Tabs] - Has currentUserId?', !!currentUserId);
      console.log('💬 [Tabs] - Has emoji?', !!reactionData.emoji);
      
      // If emoji is null, reaction was removed - clear the stored preview
      if (reactionData.conversationId) {
        this.reactionPreviews.delete(reactionData.conversationId);
        // Reload conversations to show the actual last message
        this.loadConversations();
      }
      
      return; // Ignore if reaction was removed or no user
    }
    
    // Find the conversation
    const conversationId = reactionData.conversationId;
    const conversation = this.conversations.find(c => c.conversationId === conversationId);
    
    if (conversation) {
      console.log('💬 [Tabs] Found conversation, updating preview');
      // Update conversation preview to show reaction
      // Format: "Phillip D. reacted with 👍"
      const reactionPreview = {
        content: `reacted with ${reactionData.emoji}`,
        senderId: reactionData.reactorId,
        type: 'reaction' as any
      };
      
      // Store reaction preview for persistence across reloads
      this.reactionPreviews.set(conversationId, reactionPreview);
      
      conversation.lastMessage = {
        ...conversation.lastMessage,
        ...reactionPreview,
        createdAt: new Date().toISOString(),
        isSystemMessage: false
      };
      conversation.updatedAt = new Date().toISOString();
      
      // DO NOT increment unread count for reactions
      // Users should see the reaction in preview, but it doesn't count as "unread"
      
      // Move conversation to top
      this.conversations = this.conversations.filter(c => c.conversationId !== conversationId);
      this.conversations.unshift(conversation);
      
      console.log('💬 [Tabs] Conversation updated:', conversation);
      setTimeout(() => this.cdr.detectChanges(), 0);
    } else {
      console.log('💬 [Tabs] Conversation not found for ID:', conversationId);
    }
  }

  private calculateMessagesDropdownPosition() {
    if (!this.messagesBtn) {
      return;
    }
    const buttonRect = this.messagesBtn.nativeElement.getBoundingClientRect();
    this.messagesDropdownTop = buttonRect.bottom + 8;
    this.messagesDropdownRight = window.innerWidth - buttonRect.right;
  }

  loadConversations() {
    if (this.isLoadingConversations) {
      return;
    }
    
    this.isLoadingConversations = true;
    this.messagingService.getConversations().subscribe({
      next: (response) => {
        // Sort conversations by updatedAt (most recent first)
        this.conversations = (response.conversations || []).sort((a, b) => {
          const dateA = new Date(a.updatedAt).getTime();
          const dateB = new Date(b.updatedAt).getTime();
          return dateB - dateA; // Descending order
        });
        
        // Process conversations to show reactions in preview if applicable
        this.processConversationsForReactions();
        
        this.isLoadingConversations = false;
        setTimeout(() => this.cdr.detectChanges(), 0);
      },
      error: (error) => {
        console.error('Error loading conversations:', error);
        this.isLoadingConversations = false;
        setTimeout(() => this.cdr.detectChanges(), 0);
      }
    });
  }

  private processConversationsForReactions() {
    // Merge stored reaction previews when loading conversations
    this.conversations.forEach(conversation => {
      const reactionPreview = this.reactionPreviews.get(conversation.conversationId);
      if (reactionPreview) {
        // Apply stored reaction preview
        conversation.lastMessage = {
          ...conversation.lastMessage,
          ...reactionPreview,
          createdAt: conversation.lastMessage?.createdAt || new Date().toISOString(),
          isSystemMessage: false
        };
      } else if (conversation.lastMessage && (conversation.lastMessage as any).reactions && (conversation.lastMessage as any).reactions.length > 0) {
        // Fallback: Check if lastMessage has reactions (if backend includes them)
        const reactions = (conversation.lastMessage as any).reactions;
        const mostRecentReaction = reactions[reactions.length - 1];
        
        console.log('💬 [Tabs] Found reactions on lastMessage:', {
          conversationId: conversation.conversationId,
          reactionsCount: reactions.length,
          mostRecent: mostRecentReaction
        });
        
        // Store it for future persistence
        const reactionPreview = {
          content: `reacted with ${mostRecentReaction.emoji}`,
          senderId: mostRecentReaction.userId,
          type: 'reaction' as any
        };
        this.reactionPreviews.set(conversation.conversationId, reactionPreview);
        
        // Update preview to show reaction
        conversation.lastMessage = {
          ...conversation.lastMessage,
          ...reactionPreview,
        };
      }
    });
  }

  refreshConversationsInBackground() {
    // Refresh without showing loader - update data silently
    this.messagingService.getConversations().subscribe({
      next: (response) => {
        // Sort conversations by updatedAt (most recent first)
        this.conversations = (response.conversations || []).sort((a, b) => {
          const dateA = new Date(a.updatedAt).getTime();
          const dateB = new Date(b.updatedAt).getTime();
          return dateB - dateA; // Descending order
        });
        
        // Process conversations to show reactions in preview if applicable
        this.processConversationsForReactions();
        
        setTimeout(() => this.cdr.detectChanges(), 0);
      },
      error: (error) => {
        console.error('Error refreshing conversations:', error);
        // Don't show error to user, just log it
      }
    });
  }

  onConversationClick(conversation: Conversation) {
    if (conversation.otherUser?.auth0Id) {
      this.router.navigate(['/tabs/messages'], {
        queryParams: { userId: conversation.otherUser.auth0Id }
      });
      this.closeMessagesDropdown();
    }
  }

  getConversationPreview(content: string): string {
    if (!content) return '';
    // Strip HTML tags for preview
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    const textContent = tempDiv.textContent || tempDiv.innerText || '';
    // Return first 50 characters
    return textContent.length > 50 ? textContent.substring(0, 50) + '...' : textContent;
  }

  getConversationPreviewFormatted(conversation: any): string {
    if (!conversation || !conversation.lastMessage) return '';
    
    const lastMessage = conversation.lastMessage;
    const currentUserId = this.currentUser?.['auth0Id'] || this.currentUser?.['id'];
    const isMyMessage = lastMessage.senderId === currentUserId;
    const prefix = isMyMessage ? 'You: ' : '';
    
    // Check if it's a reaction
    if (lastMessage.type === 'reaction') {
      // Format: "Name reacted with 👍" or "You reacted with 👍"
      if (isMyMessage) {
        return `You ${lastMessage.content}`;
      } else {
        const otherUserName = conversation.otherUser?.name || 'Someone';
        return `${otherUserName} ${lastMessage.content}`;
      }
    }
    
    // Check message type and format accordingly
    switch (lastMessage.type) {
      case 'voice':
        return `${prefix}🎤 Voice message`;
      
      case 'image':
        return `${prefix}📷 Image`;
      
      case 'file':
        return `${prefix}📎 ${lastMessage.fileName || 'File'}`;
      
      case 'system':
        // System messages - extract just the first line (title) and strip HTML
        const firstLine = lastMessage.content.split('\n')[0].trim();
        return this.getConversationPreview(firstLine);
      
      case 'text':
      default:
        // Regular text message
        return `${prefix}${this.getConversationPreview(lastMessage.content || '')}`;
    }
  }

  formatConversationTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
