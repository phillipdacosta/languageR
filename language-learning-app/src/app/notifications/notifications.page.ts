import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ModalController } from '@ionic/angular';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subject, takeUntil, firstValueFrom } from 'rxjs';
import { NotificationService, Notification } from '../services/notification.service';
import { WebSocketService } from '../services/websocket.service';
import { PlatformService } from '../services/platform.service';
import { ClassInvitationModalComponent } from '../components/class-invitation-modal/class-invitation-modal.component';

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: false
})
export class NotificationsPage implements OnDestroy {
  notifications: Notification[] = [];
  isLoading = false;
  searchTerm: string = '';
  activeFilters: string[] = ['all'];
  filters = [
    { value: 'all', label: 'All' },
    { value: 'lessons', label: 'Lessons' },
    { value: 'payment', label: 'Payment' },
    { value: 'progress', label: 'Progress' }
  ];
  private destroy$ = new Subject<void>();

  constructor(
    private notificationService: NotificationService,
    private websocketService: WebSocketService,
    private router: Router,
    private platformService: PlatformService,
    private modalController: ModalController,
    private sanitizer: DomSanitizer
  ) {
    this.websocketService.newNotification$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadNotifications();
      });
  }

  ionViewWillEnter() {
    this.loadNotifications();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadNotifications() {
    this.isLoading = true;
    this.notificationService.getNotifications().subscribe({
      next: response => {
        if (response.success && response.notifications) {
          this.notifications = response.notifications;
        }
        this.isLoading = false;
      },
      error: error => {
        console.error('❌ Error loading notifications:', error);
        this.isLoading = false;
      }
    });
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
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);

    // For today's notifications, show relative time
    if (this.isToday(createdAt)) {
      if (diffMinutes < 1) {
        return 'Just now';
      }
      if (diffMinutes < 60) {
        return `${diffMinutes}m`;
      }
      if (diffHours < 24) {
        return `${diffHours}h`;
      }
    }

    // For yesterday, show time
    if (this.isYesterday(createdAt)) {
      return date.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit'
      });
    }

    // For older notifications, show date and time
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  onNotificationClick(notification: Notification) {
    if (!notification.read) {
      this.notificationService.markAsRead(notification._id).subscribe({
        next: response => {
          if (response.success) {
            notification.read = true;
            notification.readAt = new Date();
            
            // Refresh unread count and trigger re-sort
            this.notificationService.refreshUnreadCount();
            
            // Force change detection to re-sort the list
            // The filtered notifications will automatically move read items to bottom
            this.notifications = [...this.notifications];
          }
        },
        error: error => {
          console.error('Error marking notification as read:', error);
        }
      });
    }

    if (notification.type === 'lesson_created' && notification.data?.lessonId) {
      const shouldReturnToNotifications = this.platformService.isMobile() || this.platformService.isSmallScreen();
      this.router.navigate(
        ['/tabs/tutor-calendar/event', notification.data.lessonId],
        shouldReturnToNotifications ? { queryParams: { from: 'notifications' } } : undefined
      );
    } else if (notification.type === 'lesson_analysis_ready' && notification.data?.lessonId) {
      // Navigate to lesson analysis page
      this.router.navigate(['/lesson-analysis', notification.data.lessonId]);
    } else if (notification.type === 'class_invitation' && notification.data?.classId) {
      // Open class invitation modal
      this.openClassInvitation(notification.data.classId, notification);
    } else if (notification.type === 'message' && notification.data?.conversationId) {
      this.router.navigate(['/tabs/messages', notification.data.conversationId]);
    }
  }

  async openClassInvitation(classId: string, notification?: Notification) {
    const modal = await this.modalController.create({
      component: ClassInvitationModalComponent,
      componentProps: {
        classId,
        notification: notification ? { data: notification.data } : undefined
      },
      cssClass: 'class-invitation-modal'
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data?.accepted || data?.declined) {
      // Reload notifications to reflect the change
      this.loadNotifications();
    }
  }

  trackByNotificationId(_: number, notification: Notification) {
    return notification._id;
  }

  getNotificationIcon(type: string): string {
    const iconMap: { [key: string]: string } = {
      'lesson_created': 'videocam',
      'lesson_analysis_ready': 'analytics',
      'class_invitation': 'people',
      'message': 'chatbubbles',
      'lesson_reminder': 'videocam',
      'lesson_cancelled': 'close-circle',
      'lesson_rescheduled': 'videocam',
      'office_hours_booking': 'videocam',
      'office_hours_starting': 'videocam'
    };
    return iconMap[type] || 'notifications';
  }

  getNotificationIconClass(type: string): string {
    if (type === 'lesson_created' || type === 'lesson_reminder') {
      return 'lesson-icon';
    } else if (type === 'class_invitation') {
      return 'class-invitation-icon';
    } else if (type === 'lesson_analysis_ready') {
      return 'analysis-icon';
    }
    return '';
  }

  getFilteredNotifications(): Notification[] {
    let filtered = this.notifications;
    
    // Filter by type (if any filters are selected)
    if (this.activeFilters.length > 0) {
      // If "all" is selected, show everything
      if (this.activeFilters.includes('all')) {
        // Don't filter by type, show all notifications
      } else {
        filtered = filtered.filter(n => 
          this.activeFilters.some(filter => this.matchesFilter(n.type, filter))
        );
      }
    }
    
    // Filter by search term
    if (this.searchTerm && this.searchTerm.trim()) {
      const searchLower = this.searchTerm.toLowerCase().trim();
      filtered = filtered.filter(n => 
        n.message.toLowerCase().includes(searchLower) ||
        n.title?.toLowerCase().includes(searchLower)
      );
    }
    
    // Sort: unread first, then by date (most recent first)
    return filtered.sort((a, b) => {
      if (a.read !== b.read) {
        return a.read ? 1 : -1; // Unread first
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  matchesFilter(notificationType: string, filter: string): boolean {
    const filterMap: { [key: string]: string[] } = {
      'all': [], // Not used in filtering logic, but kept for clarity
      'lessons': [
        // Individual lesson types
        'lesson_created', 'lesson_reminder', 'lesson_cancelled', 'lesson_rescheduled', 
        'office_hours_booking', 'office_hours_starting', 'lesson_analysis_ready',
        // Class types
        'class_invitation', 'class_accepted', 'class_cancelled', 'class_auto_cancelled', 'class_removed'
      ],
      'payment': ['payment_received', 'payment_failed', 'payment_refunded', 'payout_processed', 'payout_failed', 'subscription_renewed', 'subscription_cancelled'],
      'progress': ['progress_milestone', 'lesson_analysis_ready']
    };
    
    return filterMap[filter]?.includes(notificationType) || false;
  }

  toggleFilter(filter: string): void {
    const index = this.activeFilters.indexOf(filter);
    if (index > -1) {
      // Remove filter if already selected
      this.activeFilters.splice(index, 1);
    } else {
      // Add filter if not selected
      this.activeFilters.push(filter);
    }
  }

  isFilterActive(filter: string): boolean {
    return this.activeFilters.includes(filter);
  }

  isToday(date: Date | string): boolean {
    const notificationDate = new Date(date);
    const today = new Date();
    return notificationDate.toDateString() === today.toDateString();
  }

  isYesterday(date: Date | string): boolean {
    const notificationDate = new Date(date);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return notificationDate.toDateString() === yesterday.toDateString();
  }

  getTodayNotifications(): Notification[] {
    return this.getFilteredNotifications().filter(n => this.isToday(n.createdAt));
  }

  getYesterdayNotifications(): Notification[] {
    return this.getFilteredNotifications().filter(n => this.isYesterday(n.createdAt));
  }

  getLaterNotifications(): Notification[] {
    return this.getFilteredNotifications().filter(n => 
      !this.isToday(n.createdAt) && !this.isYesterday(n.createdAt)
    );
  }

  getNotificationTitle(notification: Notification): string {
    if (notification.title) {
      return notification.title;
    }
    
    // Generate title from type
    const titleMap: { [key: string]: string } = {
      'lesson_created': 'New Lesson Scheduled',
      'lesson_analysis_ready': 'Lesson Analysis Ready',
      'class_invitation': 'Class Invitation',
      'message': 'New Message',
      'lesson_reminder': 'Lesson Reminder',
      'lesson_cancelled': 'Lesson Cancelled',
      'lesson_rescheduled': 'Lesson Rescheduled',
      'office_hours_booking': 'Office Hours Booking',
      'office_hours_starting': 'Office Hours Starting'
    };
    
    return titleMap[notification.type] || 'Notification';
  }

  onSearchInput(event: any) {
    this.searchTerm = event.detail.value || '';
  }

  sanitizeMessage(message: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(message);
  }

  markAllAsRead() {
    const unreadNotifications = this.getUnreadNotifications();
    if (unreadNotifications.length === 0) {
      return;
    }

    // Use the service's markAllAsRead method
    firstValueFrom(this.notificationService.markAllAsRead())
      .then(() => {
        // Update local state
        unreadNotifications.forEach(n => {
          n.read = true;
          n.readAt = new Date();
        });
        
        console.log('✅ All notifications marked as read');
      })
      .catch(error => {
        console.error('Error marking all notifications as read:', error);
      });
  }
}

