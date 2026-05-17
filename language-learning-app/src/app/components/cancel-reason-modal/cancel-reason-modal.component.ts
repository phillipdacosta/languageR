import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
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
export class CancelReasonModalComponent implements OnInit {
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

  selectedReason: CancellationReason | null = null;
  otherReasonText: string = '';
  isWithin12Hours: boolean = false;
  formattedDateTime: string = '';

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
  }

  formattedDuration = '';

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
    this.selectedReason = reason;
    if (reason.id !== 'other') {
      this.otherReasonText = '';
    }
  }

  isSelected(reason: CancellationReason): boolean {
    return this.selectedReason?.id === reason.id;
  }

  canConfirm(): boolean {
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
    if (!this.canConfirm()) return;

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
