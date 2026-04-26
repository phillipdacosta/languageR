import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, ToastController, LoadingController } from '@ionic/angular';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LessonService } from '../../services/lesson.service';
import { UserService } from '../../services/user.service';
import { formatTimeInTz, formatDateInTz, isSameDayInTimezone } from '../../shared/timezone.utils';
import { CancelReasonModalComponent } from '../cancel-reason-modal/cancel-reason-modal.component';
import { ConfirmActionModalComponent } from '../confirm-action-modal/confirm-action-modal.component';
import { RescheduleLessonModalComponent } from '../reschedule-lesson-modal/reschedule-lesson-modal.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

interface EventDetails {
  id?: string;
  title?: string;
  subtitle?: string;
  start: Date;
  end: Date;
  durationMinutes: number;
  location?: string;
  avatarUrl?: string;
  isTrialLesson?: boolean;
  isClass?: boolean;
  isOfficeHours?: boolean;
  isCancelled?: boolean;
  isLesson?: boolean;
  isGoogleCalendar?: boolean;
  attendees?: any[];
  capacity?: number;
  thumbnail?: string;
  color?: string;
  meta?: string;
  // Lesson-specific
  studentName?: string;
  studentDisplayName?: string;
  subject?: string;
  lessonId?: string;
  // Class-specific
  classId?: string;
  className?: string;
}

interface MenuPosition {
  top?: number;
  bottom?: number;
  left: number;
  showBelow: boolean;
  arrowOffset: number;
  maxHeight: number;
}

@Component({
  selector: 'app-event-details-modal',
  templateUrl: './event-details-modal.component.html',
  styleUrls: ['./event-details-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule, CancelReasonModalComponent, ConfirmActionModalComponent, RescheduleLessonModalComponent]
})
export class EventDetailsModalComponent implements OnInit, OnDestroy {
  @Input() event!: EventDetails;
  @Input() clickEvent?: any; // The click event to position the menu
  /** Mobile: half-height panel from bottom instead of anchored popover */
  @Input() bottomSheet = false;
  @Output() lessonCancelled = new EventEmitter<string>(); // Emit when lesson is cancelled
  
  position: MenuPosition | null = null;
  canJoin = false;
  joinLabel = 'Join';
  isLessonInProgress = false;
  canCancel = false;
  footerShowsJoin = false;
  isClosing = false;

  constructor(
    private modalController: ModalController,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private router: Router,
    private lessonService: LessonService,
    private userService: UserService,
    private translate: TranslateService
  ) {}

  private get userTz(): string | undefined {
    return this.userService.getCurrentUserValue()?.profile?.timezone || undefined;
  }

  ngOnInit() {
    if (!this.bottomSheet) {
      this.calculatePosition();
    }
    this.updateJoinButton();
    this.updateCancelButton();
    this.updateFooterPrimary();

    if (this.bottomSheet && (this.event.lessonId || this.event.classId)) {
      import('../../tutor-calendar/event-details/event-details.page').catch(() => {});
    }
  }

  private updateFooterPrimary(): void {
    this.footerShowsJoin = !!(
      this.canJoin &&
      (this.event.lessonId || this.event.classId) &&
      !this.event.isCancelled
    );
  }
  
  private updateCancelButton() {
    // Can cancel if:
    // 1. It's a lesson or class
    // 2. It's not already cancelled
    // 3. The start time hasn't passed yet
    if (!this.event.lessonId && !this.event.classId) {
      this.canCancel = false;
      return;
    }
    
    if (this.event.isCancelled) {
      this.canCancel = false;
      return;
    }
    
    const now = new Date();
    const start = new Date(this.event.start);
    this.canCancel = start > now;
  }

  private updateJoinButton() {
    if (!this.event.lessonId && !this.event.classId) {
      return;
    }

    // Create a lesson-like object for the join logic
    const lessonLike = {
      _id: this.event.id,
      startTime: this.event.start,
      endTime: this.event.end,
      status: this.getLessonStatus(),
      tutorId: null, // Will be determined in join method
      studentId: null,
      isClass: this.event.isClass
    } as any;

    this.isLessonInProgress = this.checkIfLessonInProgress();
    this.canJoin = this.isLessonInProgress || this.lessonService.canJoinLesson(lessonLike);
    
    if (this.isLessonInProgress) {
      this.joinLabel = 'Join Now';
    } else if (this.canJoin) {
      this.joinLabel = 'Join';
    } else {
      const secs = this.lessonService.getTimeUntilJoin(lessonLike);
      this.joinLabel = this.translate.instant('HOME.JOIN_IN_TIME', {
        time: this.lessonService.formatTimeUntil(secs),
      });
    }
  }

  private checkIfLessonInProgress(): boolean {
    if (!this.event.start || !this.event.end) return false;
    const now = new Date();
    const start = new Date(this.event.start);
    const end = new Date(this.event.end);
    return start <= now && end > now;
  }

  private getLessonStatus(): string {
    const now = new Date();
    if (this.event.start <= now && this.event.end > now) {
      return 'in_progress';
    }
    if (this.event.start > now) {
      return 'scheduled';
    }
    return 'completed';
  }

  formatStudentName(name: string): string {
    if (!name) return '';
    const parts = name.trim().split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts[parts.length - 1];
      const lastInitial = last.charAt(0).toUpperCase();
      return `${first} ${lastInitial}.`;
    }
    return name;
  }

  /** After cancel flow dismisses, load lesson and open the same reschedule modal as event details. */
  private async presentLessonRescheduleById(lessonId: string): Promise<void> {
    const now = new Date();
    if (this.event.start <= now) {
      const toast = await this.toastController.create({
        message: 'This lesson has already started and cannot be rescheduled.',
        duration: 3000,
        position: 'bottom',
        color: 'medium',
      });
      await toast.present();
      return;
    }

    const cu = await this.userService.getCurrentUser().toPromise();
    const uid = (cu as any)?.id ?? (cu as any)?._id;
    if (!cu || !uid) return;

    const res = await firstValueFrom(this.lessonService.getLesson(lessonId));
    if (!res?.success || !res.lesson) {
      const toast = await this.toastController.create({
        message: 'Could not load lesson to reschedule.',
        duration: 2500,
        position: 'bottom',
        color: 'danger',
      });
      await toast.present();
      return;
    }

    const lesson: any = res.lesson;
    const tutorRaw = lesson.tutorId;
    const tid = typeof tutorRaw === 'object' ? tutorRaw?._id ?? tutorRaw?.id : tutorRaw;
    const isTutor = String(tid) === String(uid);

    const otherParticipant = isTutor ? lesson.studentId : lesson.tutorId;
    let participantId: string | null = null;
    if (otherParticipant && typeof otherParticipant === 'object') {
      participantId = (otherParticipant as any)?._id ?? (otherParticipant as any)?.id ?? null;
    } else if (typeof otherParticipant === 'string') {
      participantId = otherParticipant;
    }

    if (!participantId) {
      const toast = await this.toastController.create({
        message: 'Could not find participant information',
        duration: 2000,
        color: 'danger',
        position: 'bottom',
      });
      await toast.present();
      return;
    }

    const participantNameForModal = otherParticipant || this.formatStudentName(
      this.event.studentDisplayName || this.event.studentName || ''
    ) || 'Student';
    const participantAvatar =
      (isTutor ? (lesson.studentId as any)?.picture : (lesson.tutorId as any)?.picture) ||
      this.event.avatarUrl ||
      undefined;

    const m = await this.modalController.create({
      component: RescheduleLessonModalComponent,
      componentProps: {
        lessonId,
        lesson,
        participantId,
        participantName: participantNameForModal,
        participantAvatar,
        currentUserId: String(uid),
        isTutor,
        showBackButton: false,
      },
      cssClass: 'reschedule-lesson-modal',
    });
    await m.present();
  }

  ngOnDestroy() {
    // Cleanup
  }

  @HostListener('window:resize')
  onResize() {
    if (!this.bottomSheet) {
      this.calculatePosition();
    }
  }

  private calculatePosition() {
    if (!this.clickEvent) {
      // Fallback: center on screen
      this.position = {
        left: window.innerWidth / 2 - 210,
        showBelow: true,
        arrowOffset: 210,
        maxHeight: 700
      };
      return;
    }

    const target = this.clickEvent.target?.closest('.calendar-event') || this.clickEvent.target;
    if (!target) {
      this.position = {
        left: window.innerWidth / 2 - 210,
        showBelow: true,
        arrowOffset: 210,
        maxHeight: 700
      };
      return;
    }

    const rect = target.getBoundingClientRect();
    const screenHeight = window.innerHeight;
    const screenWidth = window.innerWidth;
    const menuWidth = 420;
    const menuBaseHeight = 700;
    const paddingFromEdge = 20;
    const gapFromEvent = 8;

    // Calculate available space
    const spaceAbove = rect.top - paddingFromEdge;
    const spaceBelow = screenHeight - rect.bottom - paddingFromEdge;
    const spaceRight = screenWidth - rect.right;
    const spaceLeft = rect.left;

    // Determine if menu should show above or below
    const showBelow = spaceBelow >= 200 || (spaceBelow >= spaceAbove && spaceBelow >= 150);

    // Calculate menu height - use more of available space, allow up to 90vh
    const availableHeight = showBelow ? spaceBelow - gapFromEvent : spaceAbove - gapFromEvent;
    const maxAllowedHeight = Math.min(menuBaseHeight, window.innerHeight * 0.9);
    const menuHeight = Math.min(maxAllowedHeight, Math.max(500, availableHeight - 20));

    // Calculate vertical position
    let menuTop: number | undefined;
    let menuBottom: number | undefined;

    if (showBelow) {
      menuTop = rect.bottom + gapFromEvent;
      const maxTop = screenHeight - menuHeight - paddingFromEdge;
      if (menuTop !== undefined && menuTop > maxTop) {
        menuTop = maxTop;
      }
    } else {
      menuBottom = screenHeight - rect.top + gapFromEvent;
    }

    // Calculate horizontal position - prefer right side, fallback to left
    let menuLeft: number;
    let arrowOffset: number;

    if (spaceRight >= menuWidth + 20) {
      // Show to the right
      menuLeft = rect.right + gapFromEvent;
      arrowOffset = Math.min(20, rect.height / 2);
    } else if (spaceLeft >= menuWidth + 20) {
      // Show to the left
      menuLeft = rect.left - menuWidth - gapFromEvent;
      arrowOffset = menuWidth - Math.min(20, rect.height / 2);
    } else {
      // Center horizontally, show below/above
      menuLeft = Math.max(paddingFromEdge, Math.min(screenWidth - menuWidth - paddingFromEdge, rect.left + (rect.width / 2) - (menuWidth / 2)));
      arrowOffset = Math.min(menuWidth / 2, rect.width / 2);
    }

    this.position = {
      top: menuTop,
      bottom: menuBottom,
      left: menuLeft,
      showBelow,
      arrowOffset,
      maxHeight: menuHeight
    };
  }

  close() {
    if (this.isClosing) return;
    if (!this.bottomSheet) {
      this.modalController.dismiss();
      return;
    }
    this.isClosing = true;
    setTimeout(() => this.modalController.dismiss(), 300);
  }

  formatTime(date: Date): string {
    return formatTimeInTz(new Date(date), this.userTz);
  }

  formatDate(date: Date): string {
    const d = new Date(date);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (this.userTz) {
      if (isSameDayInTimezone(d, today, this.userTz)) {
        return 'Today';
      } else if (isSameDayInTimezone(d, tomorrow, this.userTz)) {
        return 'Tomorrow';
      }
    } else {
      if (d.toDateString() === today.toDateString()) {
        return 'Today';
      } else if (d.toDateString() === tomorrow.toDateString()) {
        return 'Tomorrow';
      }
    }
    return formatDateInTz(d, this.userTz, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  formatDuration(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} minutes`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    }
    return `${hours} hour${hours > 1 ? 's' : ''} ${mins} minute${mins > 1 ? 's' : ''}`;
  }

  openFullDetails() {
    const lessonId = this.event.lessonId;
    const classId = this.event.classId;
    this.modalController.dismiss();

    if (lessonId) {
      this.router.navigate(['/tabs/lessons', lessonId]);
    } else if (classId) {
      this.router.navigate(['/tabs/tutor-calendar/class', classId]);
    }
  }

  async joinLesson() {
    if (!this.event.lessonId && !this.event.classId) return;
    
    const currentUser = await this.userService.getCurrentUser().toPromise();
    if (!currentUser) return;

    const currentUserId = (currentUser as any)?._id || (currentUser as any)?.id;
    const isClass = this.event.isClass || false;
    
    const lessonId = this.event.lessonId || this.event.classId;
    
    this.close();
    
    // Navigate to pre-call page
    // SECURITY: role is determined from lesson data + auth, not passed in URL
    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: lessonId,
        lessonMode: 'true',
        isClass: isClass ? 'true' : 'false'
      }
    });
  }

  async cancelLesson() {
    if (!this.event.lessonId || this.event.isCancelled) return;
    
    const currentUser = await this.userService.getCurrentUser().toPromise();
    if (!currentUser) return;

    const isTutor = (currentUser as any)?.userType === 'tutor';
    
    // Get participant name (for tutor, this is the student)
    const participantName = this.formatStudentName(this.event.studentDisplayName || this.event.studentName || '');
    const participantAvatar = this.event.avatarUrl;
    const lessonId = this.event.lessonId;
    const lessonStartTime = this.event.start;
    const lessonSubject = this.event.subject || this.event.title;
    const lessonDuration = this.event.durationMinutes;
    
    // Close this event details modal FIRST to avoid visual clutter
    await this.modalController.dismiss();
    
    // Small delay to ensure modal is fully closed
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // STEP 1: Show the cancellation reason modal
    const reasonModal = await this.modalController.create({
      component: CancelReasonModalComponent,
      componentProps: {
        participantName: participantName,
        participantAvatar: participantAvatar || undefined,
        userRole: isTutor ? 'tutor' : 'student',
        lessonStartTime: lessonStartTime,
        lessonSubject: lessonSubject,
        lessonDuration: lessonDuration
      },
      cssClass: 'cancel-reason-modal'
    });
    
    await reasonModal.present();
    const reasonResult = await reasonModal.onDidDismiss();

    if (reasonResult.data?.rescheduleInstead) {
      await this.presentLessonRescheduleById(lessonId!);
      return;
    }

    // If user cancelled or didn't select a reason, stop here
    if (reasonResult.data?.cancelled || !reasonResult.data?.reason) {
      return;
    }

    const selectedReason = reasonResult.data.reason;

    // STEP 2: Show confirmation modal
    const confirmModal = await this.modalController.create({
      component: ConfirmActionModalComponent,
      componentProps: {
        title: 'Cancel Lesson',
        message: `Reason: ${selectedReason.label}`,
        notificationMessage: `${participantName || 'The other participant'} will be notified and this action cannot be undone.`,
        confirmText: 'Cancel Lesson',
        cancelText: 'Reschedule instead?',
        secondaryDismissReschedules: true,
        confirmColor: 'danger',
        icon: 'close-circle',
        iconColor: 'danger',
        participantName: participantName,
        participantAvatar: participantAvatar || undefined
      },
      cssClass: 'confirm-action-modal'
    });

    await confirmModal.present();
    const confirmResult = await confirmModal.onDidDismiss();

    if (confirmResult.data?.rescheduleInstead) {
      await this.presentLessonRescheduleById(lessonId!);
      return;
    }

    if (!confirmResult.data?.confirmed) {
      return;
    }
    
    // STEP 3: Proceed with cancellation
    const loading = await this.loadingController.create({
      message: 'Cancelling lesson...',
      spinner: 'crescent'
    });
    await loading.present();
    
    try {
      const response = await this.lessonService.cancelLesson(
        lessonId!,
        selectedReason.id,
        selectedReason.label
      ).toPromise();
      
      await loading.dismiss();
      
      if (response?.success) {
        const toast = await this.toastController.create({
          message: 'Lesson cancelled successfully',
          duration: 3000,
          position: 'bottom',
          color: 'success'
        });
        await toast.present();
        
        // Dispatch custom event to notify calendar to refresh
        // (EventEmitter won't work since modal was already dismissed)
        window.dispatchEvent(new CustomEvent('lesson-cancelled', { 
          detail: { lessonId: lessonId } 
        }));
      } else {
        throw new Error(response?.message || 'Failed to cancel lesson');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('❌ Error cancelling lesson:', error);
      
      const toast = await this.toastController.create({
        message: error?.error?.message || 'Failed to cancel lesson. Please try again.',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    }
  }
}

