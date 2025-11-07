import { Component, OnInit, OnDestroy, HostListener, ViewChild, ElementRef, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { PlatformService } from '../services/platform.service';
import { AuthService, User } from '../services/auth.service';
import { Observable, Subject, BehaviorSubject, takeUntil, interval, switchMap } from 'rxjs';
import { UserService } from '../services/user.service';
import { MessagingService } from '../services/messaging.service';
import { NotificationService, Notification } from '../services/notification.service';
import { WebSocketService } from '../services/websocket.service';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: false,
})
export class TabsPage implements OnInit, OnDestroy, AfterViewInit {
  ionViewWillEnter() {
    // Reload notification count when tabs page becomes active (important for page refresh)
    if (this.currentUser) {
      this.loadUnreadNotificationCount();
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
  // Unread notifications count
  unreadNotificationCount$ = new BehaviorSubject<number>(0);
  // Notification dropdown state
  isNotificationDropdownOpen = false;
  // Dropdown positioning
  dropdownTop = 60;
  dropdownRight = 20;
  @ViewChild('notificationBtn', { read: ElementRef }) notificationBtn!: ElementRef;
  // Notifications
  notifications: Notification[] = [];
  isLoadingNotifications = false;

  constructor(
    private router: Router,
    public platformService: PlatformService,
    private authService: AuthService,
    private userService: UserService,
    private messagingService: MessagingService,
    private notificationService: NotificationService,
    private websocketService: WebSocketService,
    private cdr: ChangeDetectorRef
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
          // Also load notification count
          this.loadUnreadNotificationCount();
        });
      }
    });
    this.isAuthenticated$ = this.authService.isAuthenticated$;
    
    // Connect to WebSocket early to receive messages
    this.websocketService.connect();
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
        console.log('🔴 Unread count changed in tabs page:', count, 'Previous value:', this.unreadCount$.value);
        this.unreadCount$.next(count);
        // Force change detection to ensure UI updates
        this.cdr.detectChanges();
      }
    });

    // Listen for WebSocket messages to update unread count in real-time
    // This ensures the red dot appears even when not on the messages page
    this.websocketService.newMessage$.pipe(
      takeUntil(this.destroy$)
    ).subscribe((message) => {
      console.log('📨 Tabs page received WebSocket message:', {
        messageId: message.id,
        senderId: message.senderId,
        receiverId: message.receiverId,
        content: message.content?.substring(0, 50)
      });
      
      // When a new message arrives, reload conversations to update unread count
      // Only reload if user is authenticated and it's not our own message
      if (this.currentUser) {
        const currentUserId = this.currentUser['auth0Id'] || `dev-user-${this.currentUser.email}`;
        const isMyMessage = message.senderId === currentUserId || 
                           message.senderId === currentUserId.replace('dev-user-', '') ||
                           `dev-user-${message.senderId}` === currentUserId;
        
        console.log('📊 Message ownership check:', {
          currentUserId,
          messageSenderId: message.senderId,
          isMyMessage
        });
        
        // Only reload if it's an incoming message (not sent by us)
        if (!isMyMessage) {
          console.log('🔄 Reloading conversations to update unread count...');
          // Reload conversations to update unread count
          this.messagingService.getConversations().pipe(
            takeUntil(this.destroy$)
          ).subscribe({
            next: (response) => {
              if (response.success) {
                const totalUnread = response.conversations.reduce((sum, conv) => sum + conv.unreadCount, 0);
                console.log('✅ Updated unread count:', totalUnread, 'conversations:', response.conversations.length);
                console.log('🔴 Calling messagingService.updateUnreadCount with:', totalUnread);
                this.messagingService.updateUnreadCount(totalUnread);
                // Also directly update our observable to ensure it updates
                this.unreadCount$.next(totalUnread);
                console.log('🔴 Directly set unreadCount$ to:', totalUnread, 'Current value:', this.unreadCount$.value);
                // Force change detection
                this.cdr.detectChanges();
              }
            },
            error: (error) => {
              console.error('❌ Error reloading conversations for unread count:', error);
            }
          });
        } else {
          console.log('ℹ️ Message was sent by current user, skipping unread count update');
        }
      } else {
        console.log('⚠️ Current user not available, skipping unread count update');
      }
    });
    
    // Load notifications when user is authenticated and currentUser is loaded
    this.user$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(user => {
      if (user?.email && this.currentUser) {
        // Small delay to ensure currentUser is set in UserService
        setTimeout(() => {
          this.loadNotifications();
          this.loadUnreadNotificationCount();
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
          this.notifications = response.notifications;
          const unreadCount = this.getUnreadNotifications().length;
          this.unreadNotificationCount$.next(unreadCount);
          console.log('✅ Loaded', response.notifications.length, 'notifications');
          console.log('📊 Unread:', unreadCount, 'Read:', this.getReadNotifications().length);
        }
        this.isLoadingNotifications = false;
        // Also explicitly load unread count from API to ensure accuracy
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
    this.isNotificationDropdownOpen = !this.isNotificationDropdownOpen;
    
    if (this.isNotificationDropdownOpen && this.notificationBtn) {
      // Reload notifications when opening dropdown
      this.loadNotifications();
      
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

  getUnreadNotifications(): Notification[] {
    return this.notifications.filter(n => !n.read);
  }

  getReadNotifications(): Notification[] {
    return this.notifications.filter(n => n.read);
  }

  formatNotificationTime(createdAt: Date | string): string {
    const date = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  }

  loadUnreadNotificationCount() {
    // Only load if user is authenticated
    if (!this.currentUser) {
      return;
    }

    this.notificationService.getUnreadCount().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        if (response.success) {
          this.unreadNotificationCount$.next(response.count);
        }
      },
      error: (error) => {
        // Only log errors if it's not a 404 (which means user might not be authenticated yet)
        if (error.status !== 404) {
          console.error('Error loading unread notification count:', error);
        }
      }
    });
  }

  onNotificationClick(notification: Notification) {
    // Mark as read if unread (but keep it visible)
    if (!notification.read) {
      this.notificationService.markAsRead(notification._id).pipe(
        takeUntil(this.destroy$)
      ).subscribe({
        next: () => {
          notification.read = true;
          notification.readAt = new Date();
          // Update unread count
          this.loadUnreadNotificationCount();
          // Reload notifications to update the list
          this.loadNotifications();
        },
        error: (error) => {
          console.error('Error marking notification as read:', error);
        }
      });
    }

    // Navigate based on notification type
    if (notification.type === 'lesson_created' && notification.data?.lessonId) {
      this.router.navigate(['/tabs/tutor-calendar']);
      // Don't close dropdown - let user see the notification was marked as read
    } else if (notification.type === 'message') {
      this.router.navigate(['/tabs/messages']);
      // Don't close dropdown - let user see the notification was marked as read
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
