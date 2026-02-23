import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ModalController } from '@ionic/angular';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subject, takeUntil, firstValueFrom } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { NotificationService, Notification } from '../services/notification.service';
import { UserService } from '../services/user.service';
import { WebSocketService } from '../services/websocket.service';
import { formatTimeInTz, formatDateInTz } from '../shared/timezone.utils';
import { PlatformService } from '../services/platform.service';
import { ClassInvitationModalComponent } from '../components/class-invitation-modal/class-invitation-modal.component';
import { PaymentDisputeModalComponent } from '../components/payment-dispute-modal/payment-dispute-modal.component';

// 🚀 PERFORMANCE FIX: Type for cached, formatted notifications
interface FormattedNotification extends Notification {
  formattedTime: string;
  sanitizedMessage: SafeHtml;
}

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: false
})
export class NotificationsPage implements OnDestroy {
  notifications: Notification[] = [];
  // 🚀 PERFORMANCE FIX: Cache formatted AND grouped notifications
  todayNotifications: FormattedNotification[] = [];
  yesterdayNotifications: FormattedNotification[] = [];
  laterNotifications: FormattedNotification[] = [];
  unreadNotifications: FormattedNotification[] = [];
  
  isLoading = false;
  searchTerm: string = '';
  activeFilters: string[] = ['all'];
  filters: { value: string; label: string }[] = [];
  private destroy$ = new Subject<void>();
  currentUser: any = null;

  // Lazy loading properties
  isLoadingMore = false;
  hasMoreNotifications = true;
  private readonly NOTIFICATION_PAGE_SIZE = 50;
  private oldestNotificationId: string | null = null;

  constructor(
    private notificationService: NotificationService,
    private userService: UserService,
    private websocketService: WebSocketService,
    private router: Router,
    private platformService: PlatformService,
    private modalController: ModalController,
    private sanitizer: DomSanitizer,
    private translateService: TranslateService
  ) {
    this.filters = [
      { value: 'all', label: this.translateService.instant('NOTIFICATIONS.FILTER_ALL') },
      { value: 'lessons', label: this.translateService.instant('NOTIFICATIONS.FILTER_LESSONS') },
      { value: 'payment', label: this.translateService.instant('NOTIFICATIONS.FILTER_PAYMENT') },
      { value: 'progress', label: this.translateService.instant('NOTIFICATIONS.FILTER_PROGRESS') }
    ];
    this.websocketService.newNotification$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadNotifications();
      });

    this.userService.currentUser$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      this.currentUser = user ?? null;
    });
    this.userService.getCurrentUser().pipe(takeUntil(this.destroy$)).subscribe();
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
    this.hasMoreNotifications = true; // Reset for initial load
    this.oldestNotificationId = null;
    
    
    this.notificationService.getNotifications(this.NOTIFICATION_PAGE_SIZE).subscribe({
      next: response => {
        if (response.success && response.notifications) {
          this.notifications = response.notifications;
          
          // 🚀 PERFORMANCE FIX: Pre-compute formatted values AND group notifications
          this.groupAndFormatNotifications();
          
          // Track oldest notification and check if there are more
          if (this.notifications.length > 0) {
            this.oldestNotificationId = this.notifications[this.notifications.length - 1]._id;
            this.hasMoreNotifications = this.notifications.length >= this.NOTIFICATION_PAGE_SIZE;
            
          } else {
            this.oldestNotificationId = null;
            this.hasMoreNotifications = false;
          }
        }
        this.isLoading = false;
      },
      error: error => {
        console.error('❌ Error loading notifications:', error);
        this.isLoading = false;
      }
    });
  }
  
  loadMoreNotifications(event?: any) {
    if (this.isLoadingMore || !this.hasMoreNotifications) {
      if (event) event.target.complete();
      return;
    }
    
    this.isLoadingMore = true;
    
    this.notificationService.getNotifications(this.NOTIFICATION_PAGE_SIZE, this.oldestNotificationId || undefined).subscribe({
      next: response => {
        if (response.success && response.notifications) {
          const olderNotifications = response.notifications;
          
          if (olderNotifications.length > 0) {
            // Append older notifications
            this.notifications = [...this.notifications, ...olderNotifications];
            
            // Update oldest notification ID
            this.oldestNotificationId = olderNotifications[olderNotifications.length - 1]._id;
            
            // Check if there are more notifications
            this.hasMoreNotifications = olderNotifications.length >= this.NOTIFICATION_PAGE_SIZE;
            
          } else {
            this.hasMoreNotifications = false;
          }
        }
        
        this.isLoadingMore = false;
        if (event) event.target.complete();
      },
      error: error => {
        console.error('❌ Error loading more notifications:', error);
        this.isLoadingMore = false;
        this.hasMoreNotifications = false;
        if (event) event.target.complete();
      }
    });
  }

  getReadNotifications(): Notification[] {
    return this.notifications.filter(n => n.read);
  }

  private get userTz(): string | undefined {
    return this.currentUser?.profile?.timezone || undefined;
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
      return formatTimeInTz(date, this.userTz);
    }

    // For older notifications, show date and time
    return formatDateInTz(date, this.userTz, { month: 'short', day: 'numeric', year: undefined }) + ' ' + formatTimeInTz(date, this.userTz);
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
      // Navigate to lessons page with lesson ID to scroll to
      this.router.navigate(['/tabs/lessons'], { 
        queryParams: { 
          scrollToLesson: notification.data.lessonId 
        } 
      });
    } else if (notification.type === 'lesson_analysis_ready' && notification.data?.lessonId) {
      // Navigate to lesson analysis page
      this.router.navigate(['/lesson-analysis', notification.data.lessonId]);
    } else if (notification.type === 'class_invitation' && notification.data?.classId) {
      // Open class invitation modal
      this.openClassInvitation(notification.data.classId, notification);
    } else if (notification.type === 'message' && notification.data?.conversationId) {
      this.router.navigate(['/tabs/messages', notification.data.conversationId]);
    } else if (notification.type === 'payment_received' && notification.data?.lessonId) {
      // Navigate to earnings page with lesson ID to scroll to
      this.router.navigate(['/tabs/home/earnings'], { 
        queryParams: { 
          scrollToLesson: notification.data.lessonId 
        } 
      });
    } else if (notification.type === 'tutor_video_approved' && notification.data?.actionRoute) {
      // Navigate to the action route (e.g., tutor calendar for availability)
      this.router.navigate([notification.data.actionRoute]);
    } else if (notification.type === 'lesson_completed' && notification.data?.lessonId) {
      // Student notification - Navigate to post-lesson page or lesson analysis
      if (notification.data?.action === 'view_analysis') {
        this.router.navigate(['/post-lesson-student', notification.data.lessonId]);
      } else {
        this.router.navigate(['/lesson-analysis', notification.data.lessonId]);
      }
    } else if (notification.type === 'feedback_reminder' && notification.data?.lessonId) {
      // Tutor notification - Navigate to post-lesson tutor page to add note
      this.router.navigate(['/post-lesson-tutor', notification.data.lessonId]);
    }
  }

  navigateToTutorCalendar() {
    this.router.navigate(['/tabs/availability-setup']);
  }

  navigateToProgress() {
    this.router.navigate(['/tabs/progress']);
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
      'lesson_completed': 'checkmark-circle',
      'feedback_reminder': 'create',
      'class_invitation': 'people',
      'class_cancelled': 'videocam',
      'class_auto_cancelled': 'videocam',
      'class_invitation_cancelled': 'videocam',
      'invitation_cancelled': 'videocam',
      'class_removed': 'videocam',
      'message': 'chatbubbles',
      'lesson_reminder': 'videocam',
      'lesson_cancelled': 'close-circle',
      'lesson_rescheduled': 'videocam',
      'office_hours_booking': 'videocam',
      'office_hours_starting': 'videocam',
      'payment_received': 'cash',
      'tutor_video_approved': 'checkmark-circle',
      'tutor_video_rejected': 'close-circle',
      'credential_approved': 'shield-checkmark',
      'credential_rejected': 'shield'
    };
    return iconMap[type] || 'notifications';
  }

  getNotificationIconClass(type: string): string {
    if (type === 'lesson_created' || type === 'lesson_reminder' || type === 'lesson_rescheduled' || type === 'office_hours_booking' || type === 'office_hours_starting' || type === 'class_cancelled' || type === 'class_auto_cancelled' || type === 'class_invitation_cancelled' || type === 'invitation_cancelled' || type === 'class_removed') {
      return 'lesson-icon';
    } else if (type === 'class_invitation') {
      return 'class-invitation-icon';
    } else if (type === 'lesson_analysis_ready') {
      return 'analysis-icon';
    } else if (type === 'payment_received') {
      return 'payment-icon';
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
    if (!type) return '';
    
    const contextualIcons: { [key: string]: string } = {
      'lesson_created': 'videocam',
      'lesson_reminder': 'alarm',
      'lesson_cancelled': 'close-circle',
      'lesson_rescheduled': 'calendar',
      'class_invitation': 'people',
      'class_cancelled': 'videocam',
      'class_auto_cancelled': 'videocam',
      'class_invitation_cancelled': 'videocam',
      'invitation_cancelled': 'videocam',
      'class_removed': 'videocam',
      'office_hours_booking': 'briefcase',
      'office_hours_starting': 'play',
      'payment_received': 'cash',
      'lesson_analysis_ready': 'bar-chart',
      'message': 'chatbubble-ellipses'
    };
    
    return contextualIcons[type] || '';
  }

  // NEW: Get CSS class for contextual icon
  getContextualIconClass(type: string): string {
    if (type === 'payment_received') {
      return 'contextual-icon money-icon';
    } else if (type === 'lesson_created' || type === 'lesson_reminder' || type === 'class_invitation' || type === 'class_cancelled' || type === 'class_auto_cancelled' || type === 'class_invitation_cancelled' || type === 'invitation_cancelled' || type === 'class_removed') {
      return 'contextual-icon lesson-icon';
    } else if (type === 'lesson_analysis_ready') {
      return 'contextual-icon analysis-icon';
    } else if (type === 'message') {
      return 'contextual-icon message-icon';
    }
    return 'contextual-icon';
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
    
    // Re-group notifications when filters change
    this.groupAndFormatNotifications();
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

  private getTranslatedMessage(n: Notification): string {
    const d = n.data || {};
    const t = (key: string, params?: any) => this.translateService.instant(key, params);
    const lang = this.translateService.currentLang || 'en';
    const tz = this.userTz || Intl.DateTimeFormat().resolvedOptions().timeZone;

    const fmtDate = (raw: string | Date | undefined): string => {
      if (!raw) return '';
      const date = new Date(raw);
      if (isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', timeZone: tz }).format(date);
    };

    const fmtTime = (raw: string | Date | undefined): string => {
      if (!raw) return '';
      const date = new Date(raw);
      if (isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(date);
    };

    const fmtMoney = (val: any): string => {
      const num = parseFloat(val);
      return isNaN(num) ? '0.00' : num.toFixed(2);
    };

    try {
      switch (n.type) {
        case 'lesson_created': {
          if (d.conversationId) {
            return t('NOTIFICATIONS.MSG.LESSON_CREATED_TRIAL_TIPS', {
              studentName: d.studentName, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
            });
          }
          if (d.tutorName || d.tutorId) {
            const key = d.isTrialLesson ? 'NOTIFICATIONS.MSG.LESSON_CREATED_STUDENT_TRIAL' : 'NOTIFICATIONS.MSG.LESSON_CREATED_STUDENT';
            return t(key, { language: d.language, tutorName: d.tutorName, date: fmtDate(d.startTime), time: fmtTime(d.startTime) });
          }
          return t('NOTIFICATIONS.MSG.LESSON_CREATED_TUTOR', {
            studentName: d.studentName, language: d.language, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
          });
        }

        case 'lesson_cancelled': {
          let msg: string;
          if (d.cancelledByName || d.cancellerName) {
            msg = t('NOTIFICATIONS.MSG.LESSON_CANCELLED_BY', {
              cancellerName: d.cancelledByName || d.cancellerName,
              subject: d.lessonSubject || t('NOTIFICATIONS.MSG.LESSON_GENERIC'),
              date: fmtDate(d.startTime), time: fmtTime(d.startTime)
            });
          } else {
            msg = t('NOTIFICATIONS.MSG.LESSON_CANCELLED_AUTO', { date: fmtDate(d.startTime), time: fmtTime(d.startTime) });
          }
          const reasonText = d.cancelReasonText || d.cancelReason;
          if (reasonText && reasonText !== 'tutor_cancelled' && reasonText !== 'student_cancelled' && reasonText !== 'other') {
            msg += t('NOTIFICATIONS.MSG.LESSON_CANCELLED_REASON', { reason: reasonText });
          }
          return msg;
        }

        case 'lesson_rescheduled':
        case 'reschedule_proposed':
          return t('NOTIFICATIONS.MSG.RESCHEDULE_PROPOSED', {
            proposerName: d.proposerName || d.rescheduledByName || '', date: fmtDate(d.startTime || d.newStartTime), time: fmtTime(d.startTime || d.newStartTime)
          });

        case 'reschedule_accepted':
          return t('NOTIFICATIONS.MSG.RESCHEDULE_ACCEPTED');

        case 'reschedule_rejected':
          return t('NOTIFICATIONS.MSG.RESCHEDULE_REJECTED');

        case 'lesson_reminder':
          return t('NOTIFICATIONS.MSG.LESSON_REMINDER');

        case 'lesson_completed':
          return t('NOTIFICATIONS.MSG.LESSON_COMPLETED', { tutorName: d.tutorName || '' });

        case 'lesson_analysis_ready':
          return t('NOTIFICATIONS.MSG.LESSON_ANALYSIS_READY', { tutorName: d.tutorName || '' });

        case 'class_invitation':
          if (d.endTime) {
            return t('NOTIFICATIONS.MSG.CLASS_INVITATION_JOIN', {
              tutorName: d.tutorName, className: d.className, date: fmtDate(d.startTime), startTime: fmtTime(d.startTime), endTime: fmtTime(d.endTime)
            });
          }
          return t('NOTIFICATIONS.MSG.CLASS_INVITATION', {
            tutorName: d.tutorName, className: d.className, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
          });

        case 'class_accepted':
          return t('NOTIFICATIONS.MSG.CLASS_ACCEPTED', {
            studentName: d.studentName, className: d.className, date: fmtDate(d.startTime || d.date)
          });

        case 'class_removed':
          return t('NOTIFICATIONS.MSG.CLASS_REMOVED', {
            tutorName: d.tutorName, className: d.className, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
          });

        case 'invitation_cancelled':
          return t('NOTIFICATIONS.MSG.INVITATION_CANCELLED', {
            tutorName: d.tutorName, className: d.className, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
          });

        case 'class_auto_cancelled':
          if (d.minStudents) {
            return t('NOTIFICATIONS.MSG.CLASS_AUTO_CANCELLED_TUTOR', {
              className: d.className, date: fmtDate(d.startTime), time: fmtTime(d.startTime), minStudents: d.minStudents
            });
          }
          return t('NOTIFICATIONS.MSG.CLASS_AUTO_CANCELLED_STUDENT', {
            className: d.className, tutorName: d.tutorName, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
          });

        case 'class_invitation_cancelled':
          return t('NOTIFICATIONS.MSG.CLASS_INVITATION_CANCELLED', {
            className: d.className, tutorName: d.tutorName, date: fmtDate(d.startTime), time: fmtTime(d.startTime)
          });

        case 'potential_student':
          if (d.triggerType === 'book_clicked') {
            return t('NOTIFICATIONS.MSG.POTENTIAL_STUDENT_BOOK', { studentName: d.studentName });
          }
          return t('NOTIFICATIONS.MSG.POTENTIAL_STUDENT_SAVED', { studentName: d.studentName });

        case 'message':
          if (d.tutorName) return t('NOTIFICATIONS.MSG.TUTOR_NOTE');
          return n.message;

        case 'payment_received':
          if (d.paypalEmail) {
            return t('NOTIFICATIONS.MSG.PAYMENT_PAYPAL', { amount: fmtMoney(d.amount), date: fmtDate(d.lessonDate), email: d.paypalEmail });
          }
          if (d.paymentCount) {
            const lessonText = d.paymentCount === 1 ? t('NOTIFICATIONS.MSG.LESSON_SINGULAR') : t('NOTIFICATIONS.MSG.LESSON_PLURAL');
            return t('NOTIFICATIONS.MSG.PAYMENT_AVAILABLE', { amount: fmtMoney(d.amount), count: d.paymentCount, lessonText });
          }
          return t('NOTIFICATIONS.MSG.PAYMENT_EARNED', { amount: fmtMoney(d.amount), studentName: d.studentName || '', date: fmtDate(d.lessonDate || d.startTime) });

        case 'lesson_refunded':
          return t('NOTIFICATIONS.MSG.LESSON_REFUNDED', { tutorName: d.tutorName || '' });

        case 'lesson_partial_refund':
          return t('NOTIFICATIONS.MSG.PARTIAL_REFUND', { amount: fmtMoney(d.amount), tutorName: d.tutorName || '' });

        case 'payment_cancelled':
          return t('NOTIFICATIONS.MSG.PAYMENT_CANCELLED', { studentName: d.studentName || '' });

        case 'payment_reduced':
          return t('NOTIFICATIONS.MSG.PAYMENT_REDUCED', { studentName: d.studentName || '', amount: fmtMoney(d.adjustedAmount || d.amount) });

        case 'investigation_resolved':
          return t('NOTIFICATIONS.MSG.INVESTIGATION_RESOLVED', { studentName: d.studentName || '' });

        case 'dispute_submitted':
          return t('NOTIFICATIONS.MSG.DISPUTE_SUBMITTED', { tutorName: d.tutorName || '', studentName: d.studentName || '' });

        case 'tip_received':
          if (d.stripeFee && d.stripeFee > 0) {
            return t('NOTIFICATIONS.MSG.TIP_RECEIVED_WITH_FEE', {
              netAmount: fmtMoney(d.tutorReceived || d.amount), studentName: d.from || '', date: fmtDate(d.lessonDate),
              grossAmount: fmtMoney(d.amount), fee: fmtMoney(d.stripeFee)
            });
          }
          return t('NOTIFICATIONS.MSG.TIP_RECEIVED', { amount: fmtMoney(d.amount), studentName: d.from || '', date: fmtDate(d.lessonDate) });

        case 'tip_sent':
          return t('NOTIFICATIONS.MSG.TIP_SENT', { amount: fmtMoney(d.amount), tutorName: d.to || '', date: fmtDate(d.lessonDate) });

        case 'withdrawal_initiated':
          return t('NOTIFICATIONS.MSG.WITHDRAWAL_INITIATED', { amount: fmtMoney(d.amount), method: d.method || '' });

        case 'tutor_video_approved':
          return d.isFirstTimeApproval ? t('NOTIFICATIONS.MSG.VIDEO_APPROVED_FIRST') : t('NOTIFICATIONS.MSG.VIDEO_APPROVED');

        case 'tutor_video_rejected':
          return t('NOTIFICATIONS.MSG.VIDEO_REJECTED');

        case 'feedback_required':
          return t('NOTIFICATIONS.MSG.FEEDBACK_REQUIRED', { studentName: d.studentName || '' });

        case 'feedback_received':
          return t('NOTIFICATIONS.MSG.FEEDBACK_RECEIVED', { tutorName: d.tutorName || '' });

        case 'feedback_reminder':
          return t('NOTIFICATIONS.MSG.FEEDBACK_REMINDER', { studentName: d.studentName || '' });

        case 'progress_milestone':
          if (d.milestone === 'first' || d.milestoneNumber === undefined) {
            return t('NOTIFICATIONS.MSG.PROGRESS_MILESTONE_FIRST', { language: d.language || '' });
          }
          return t('NOTIFICATIONS.MSG.PROGRESS_MILESTONE', { language: d.language || '', number: d.milestoneNumber, total: d.totalLessons });

        case 'credential_approved':
          return t('NOTIFICATIONS.MSG.CREDENTIAL_APPROVED');

        case 'credential_rejected':
          return t('NOTIFICATIONS.MSG.CREDENTIAL_REJECTED');

        case 'office_hours_booking':
          return t('NOTIFICATIONS.MSG.OFFICE_HOURS_BOOKING');

        case 'office_hours_starting':
          return t('NOTIFICATIONS.MSG.OFFICE_HOURS_STARTING');

        default:
          return n.message;
      }
    } catch {
      return n.message;
    }
  }

  private groupAndFormatNotifications() {
    const formatted = this.notifications.map(n => ({
      ...n,
      formattedTime: this.formatNotificationTime(n.createdAt),
      sanitizedMessage: this.sanitizer.bypassSecurityTrustHtml(this.getTranslatedMessage(n))
    }));
    
    // Apply filters once
    const filtered = this.applyFiltersToArray(formatted);
    
    // Group into today/yesterday/later
    this.todayNotifications = filtered.filter(n => this.isToday(n.createdAt));
    this.yesterdayNotifications = filtered.filter(n => this.isYesterday(n.createdAt));
    this.laterNotifications = filtered.filter(n => 
      !this.isToday(n.createdAt) && !this.isYesterday(n.createdAt)
    );
    this.unreadNotifications = filtered.filter(n => !n.read);
  }
  
  private applyFiltersToArray(notifications: any[]): any[] {
    let filtered = [...notifications];
    
    // Filter by search term
    if (this.searchTerm && this.searchTerm.trim() !== '') {
      const search = this.searchTerm.toLowerCase();
      filtered = filtered.filter(n => 
        n.message?.toLowerCase().includes(search) ||
        n.title?.toLowerCase().includes(search)
      );
    }
    
    // Filter by type
    if (this.activeFilters && !this.activeFilters.includes('all')) {
      filtered = filtered.filter(n => {
        if (this.activeFilters.includes('lessons')) {
          return n.type && (
            n.type.includes('lesson') || 
            n.type.includes('class') ||
            n.type.includes('office_hours')
          );
        }
        if (this.activeFilters.includes('payment')) {
          return n.type && n.type.includes('payment');
        }
        if (this.activeFilters.includes('progress')) {
          return n.type && (n.type.includes('analysis') || n.type.includes('progress'));
        }
        return true;
      });
    }
    
    return filtered;
  }

  getTodayNotifications(): FormattedNotification[] {
    // Use cached version
    return this.todayNotifications;
  }

  getYesterdayNotifications(): FormattedNotification[] {
    // Use cached version
    return this.yesterdayNotifications;
  }

  getLaterNotifications(): FormattedNotification[] {
    // Use cached version
    return this.laterNotifications;
  }
  
  getUnreadNotifications(): FormattedNotification[] {
    // Use cached version
    return this.unreadNotifications;
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
    // Re-group notifications when search changes
    this.groupAndFormatNotifications();
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
    }
  }
}

