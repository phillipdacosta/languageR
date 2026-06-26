import { Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ModalController, IonContent } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { UserService } from '../../services/user.service';
import { formatTimeInTz, formatDateInTz, isSameDayInTimezone } from '../../shared/timezone.utils';

export interface CancellationReason {
  id: string;
  labelKey: string;
  icon: string;
  requiresNote?: boolean;
}

@Component({
  selector: 'app-cancel-reason-modal',
  templateUrl: './cancel-reason-modal.component.html',
  styleUrls: ['./cancel-reason-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, TranslateModule]
})
export class CancelReasonModalComponent implements OnInit, OnDestroy {
  @Input() participantName?: string;
  @Input() participantAvatar?: string;
  @Input() userRole: 'student' | 'tutor' = 'student';
  @Input() lessonStartTime?: Date;
  @Input() lessonSubject?: string;
  @Input() lessonDuration?: number; // in minutes
  @Input() entityType: 'lesson' | 'class' = 'lesson';
  @Input() className?: string;
  @Input() classThumbnailUrl?: string;

  get isClass(): boolean {
    return this.entityType === 'class';
  }

  get titleTextKey(): string {
    return this.isClass ? 'ALERTS.CANCEL_REASON.TITLE_CLASS' : 'ALERTS.CANCEL_REASON.TITLE_LESSON';
  }

  get lessonTitleText(): string {
    if (this.isClass) {
      return this.className || this.lessonSubject || this.t('ALERTS.CANCEL_REASON.GROUP_CLASS');
    }
    if (this.participantName) {
      return this.t('ALERTS.CANCEL_REASON.LESSON_WITH', { name: this.participantName });
    }
    return this.lessonSubject || this.t('ALERTS.CANCEL_REASON.LESSON_FALLBACK');
  }

  get secondaryFooterCtaLabelKey(): string {
    return 'ALERTS.CANCEL_REASON.RESCHEDULE_INSTEAD';
  }

  get infoText(): string {
    if (this.isClass) {
      return this.t('ALERTS.CANCEL_REASON.INFO_CLASS');
    }
    const name = this.participantName || this.t('ALERTS.CANCEL_REASON.INFO_LESSON_FALLBACK');
    return this.t('ALERTS.CANCEL_REASON.INFO_LESSON', { name });
  }

  get startedBlockedBodyKey(): string {
    return this.isClass
      ? 'ALERTS.CANCEL_REASON.STARTED_BODY_CLASS'
      : 'ALERTS.CANCEL_REASON.STARTED_BODY_LESSON';
  }

  selectedReason: CancellationReason | null = null;
  otherReasonText: string = '';
  isWithin12Hours: boolean = false;
  formattedDateTime: string = '';
  cancellationBlocked = false;
  private startTimeMonitorId: ReturnType<typeof setInterval> | null = null;
  private startTimeTimeoutId: ReturnType<typeof setTimeout> | null = null;

  studentReasons: CancellationReason[] = [
    { id: 'schedule_conflict', labelKey: 'ALERTS.CANCEL_REASON.REASON_SCHEDULE_STUDENT', icon: 'calendar-outline' },
    { id: 'not_prepared', labelKey: 'ALERTS.CANCEL_REASON.REASON_NOT_PREPARED', icon: 'book-outline' },
    { id: 'technical_issues', labelKey: 'ALERTS.CANCEL_REASON.REASON_TECHNICAL', icon: 'wifi-outline' },
    { id: 'found_different_tutor', labelKey: 'ALERTS.CANCEL_REASON.REASON_DIFFERENT_TUTOR', icon: 'person-outline' },
    { id: 'other', labelKey: 'ALERTS.CANCEL_REASON.REASON_OTHER', icon: 'ellipsis-horizontal-outline', requiresNote: true }
  ];

  tutorReasons: CancellationReason[] = [
    { id: 'schedule_conflict', labelKey: 'ALERTS.CANCEL_REASON.REASON_SCHEDULE_TUTOR', icon: 'calendar-outline' },
    { id: 'technical_issues', labelKey: 'ALERTS.CANCEL_REASON.REASON_TECHNICAL', icon: 'wifi-outline' },
    { id: 'other', labelKey: 'ALERTS.CANCEL_REASON.REASON_OTHER', icon: 'ellipsis-horizontal-outline', requiresNote: true }
  ];

  reasons: CancellationReason[] = [];

  @ViewChild('modalContent') modalContent?: IonContent;
  @ViewChild('infoTextSection') infoTextSection?: ElementRef<HTMLElement>;

  constructor(
    private modalController: ModalController,
    private userService: UserService,
    private translate: TranslateService
  ) {}

  private t(key: string, params?: Record<string, string>): string {
    return this.translate.instant(key, params);
  }

  private get userTz(): string | undefined {
    return this.userService.getCurrentUserValue()?.profile?.timezone || undefined;
  }

  ngOnInit() {
    if (this.entityType === 'class') {
      this.reasons = this.tutorReasons;
    } else {
      this.reasons = this.userRole === 'tutor' ? this.tutorReasons : this.studentReasons;
    }

    if (this.lessonStartTime) {
      const now = new Date();
      const lessonTime = new Date(this.lessonStartTime);
      const hoursUntilLesson = (lessonTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      this.isWithin12Hours = hoursUntilLesson < 12 && hoursUntilLesson > 0;
      this.formattedDateTime = this.formatLessonDateTime(lessonTime);
    }

    if (this.lessonDuration) {
      this.formattedDuration = this.formatDuration(this.lessonDuration);
    }

    this.startStartTimeMonitor();
  }

  ngOnDestroy(): void {
    this.clearStartTimeMonitor();
  }

  formattedDuration = '';

  private startStartTimeMonitor(): void {
    if (!this.lessonStartTime) return;

    this.updateCancellationBlockedState();
    if (this.cancellationBlocked) return;

    const msUntilStart = new Date(this.lessonStartTime).getTime() - Date.now();
    if (msUntilStart > 0) {
      this.startTimeTimeoutId = setTimeout(() => {
        this.updateCancellationBlockedState();
      }, msUntilStart);
    }

    this.startTimeMonitorId = setInterval(() => {
      this.updateCancellationBlockedState();
      if (this.cancellationBlocked) {
        this.clearStartTimeMonitor();
      }
    }, 1000);
  }

  private clearStartTimeMonitor(): void {
    if (this.startTimeTimeoutId) {
      clearTimeout(this.startTimeTimeoutId);
      this.startTimeTimeoutId = null;
    }
    if (this.startTimeMonitorId) {
      clearInterval(this.startTimeMonitorId);
      this.startTimeMonitorId = null;
    }
  }

  private updateCancellationBlockedState(): void {
    if (!this.lessonStartTime) return;
    this.cancellationBlocked = Date.now() >= new Date(this.lessonStartTime).getTime();
  }

  private formatLessonDateTime(date: Date): string {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dayLabel: string;
    if (this.userTz) {
      if (isSameDayInTimezone(date, today, this.userTz)) {
        dayLabel = this.t('HOME.TODAY');
      } else if (isSameDayInTimezone(date, tomorrow, this.userTz)) {
        dayLabel = this.t('HOME.TOMORROW');
      } else {
        dayLabel = formatDateInTz(date, this.userTz, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: undefined
        });
      }
    } else {
      if (date.toDateString() === today.toDateString()) {
        dayLabel = this.t('HOME.TODAY');
      } else if (date.toDateString() === tomorrow.toDateString()) {
        dayLabel = this.t('HOME.TOMORROW');
      } else {
        dayLabel = formatDateInTz(date, undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: undefined
        });
      }
    }

    const timeStr = formatTimeInTz(date, this.userTz);
    return `${dayLabel} · ${timeStr}`;
  }

  private formatDuration(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) {
      return `${hours} hr`;
    }
    return `${hours} hr ${mins} min`;
  }

  selectReason(reason: CancellationReason) {
    if (this.cancellationBlocked) return;
    this.selectedReason = reason;
    if (reason.id !== 'other') {
      this.otherReasonText = '';
      return;
    }
    this.scheduleScrollInfoTextIntoView();
  }

  private scheduleScrollInfoTextIntoView(): void {
    setTimeout(() => {
      requestAnimationFrame(() => {
        void this.scrollInfoTextIntoView();
      });
    }, 50);
  }

  private async scrollInfoTextIntoView(): Promise<void> {
    const content = this.modalContent;
    const el = this.infoTextSection?.nativeElement;
    if (!content || !el) return;

    const scrollEl = await content.getScrollElement();
    if (!scrollEl) return;

    const scrollRect = scrollEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const padding = 12;
    const targetScrollTop = scrollEl.scrollTop + (elRect.bottom - scrollRect.bottom) + padding;

    await content.scrollToPoint(0, Math.max(0, targetScrollTop), 400);
  }

  isSelected(reason: CancellationReason): boolean {
    return this.selectedReason?.id === reason.id;
  }

  canConfirm(): boolean {
    if (this.cancellationBlocked) return false;
    if (!this.selectedReason) return false;
    if (this.selectedReason.requiresNote && !this.otherReasonText.trim()) return false;
    return true;
  }

  dismiss() {
    this.modalController.dismiss({ cancelled: true });
  }

  rescheduleInstead() {
    this.modalController.dismiss({ rescheduleInstead: true });
  }

  onSecondaryFooterClick(): void {
    this.rescheduleInstead();
  }

  confirm() {
    this.updateCancellationBlockedState();
    if (this.cancellationBlocked || !this.canConfirm()) return;

    const reasonText = this.selectedReason?.id === 'other'
      ? this.otherReasonText.trim()
      : this.t(this.selectedReason!.labelKey);

    this.modalController.dismiss({
      cancelled: false,
      reason: {
        id: this.selectedReason!.id,
        label: reasonText,
        originalLabel: this.t(this.selectedReason!.labelKey)
      }
    });
  }
}
