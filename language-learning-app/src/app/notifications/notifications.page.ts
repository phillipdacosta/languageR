import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { NotificationService, Notification } from '../services/notification.service';
import { WebSocketService } from '../services/websocket.service';
import { PlatformService } from '../services/platform.service';

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: false
})
export class NotificationsPage implements OnDestroy {
  notifications: Notification[] = [];
  isLoading = false;
  private destroy$ = new Subject<void>();

  constructor(
    private notificationService: NotificationService,
    private websocketService: WebSocketService,
    private router: Router,
    private platformService: PlatformService
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
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) {
      return 'Just now';
    }
    if (diffMinutes < 60) {
      return `${diffMinutes} min ago`;
    }
    if (diffHours < 24) {
      return `${diffHours} hr${diffHours > 1 ? 's' : ''} ago`;
    }
    if (diffDays === 1) {
      return 'Yesterday';
    }
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
            this.notificationService.getUnreadCount().subscribe({
              next: () => {},
              error: err => console.error('Error refreshing unread count:', err)
            });
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
    } else if (notification.type === 'message' && notification.data?.conversationId) {
      this.router.navigate(['/tabs/messages', notification.data.conversationId]);
    }
  }

  trackByNotificationId(_: number, notification: Notification) {
    return notification._id;
  }
}

