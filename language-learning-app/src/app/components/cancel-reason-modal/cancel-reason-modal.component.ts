import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { UserService } from '../../services/user.service';
import { formatTimeInTz, formatDateInTz, isSameDayInTimezone } from '../../shared/timezone.utils';

export interface CancellationReason {
  id: string;
  label: string;
  icon: string;
  requiresNote?: boolean;
}

@Component({
  selector: 'app-cancel-reason-modal',
  templateUrl: './cancel-reason-modal.component.html',
  styleUrls: ['./cancel-reason-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class CancelReasonModalComponent implements OnInit {
  @Input() participantName?: string;
  @Input() participantAvatar?: string;
  @Input() userRole: 'student' | 'tutor' = 'student';
  @Input() lessonStartTime?: Date;
  @Input() lessonSubject?: string;
  @Input() lessonDuration?: number; // in minutes

  selectedReason: CancellationReason | null = null;
  otherReasonText: string = '';
  isWithin12Hours: boolean = false;
  formattedDateTime: string = '';
  formattedDuration: string = '';
  
  // Pre-written cancellation reasons
  studentReasons: CancellationReason[] = [
    { id: 'schedule_conflict', label: 'Schedule conflict / I\'m busy', icon: 'calendar-outline' },
    { id: 'not_prepared', label: 'I\'m not prepared for this lesson', icon: 'book-outline' },
    { id: 'technical_issues', label: 'Technical issues / internet problems', icon: 'wifi-outline' },
    { id: 'found_different_tutor', label: 'I found a different tutor', icon: 'person-outline' },
    { id: 'other', label: 'Other reason', icon: 'ellipsis-horizontal-outline', requiresNote: true }
  ];

  tutorReasons: CancellationReason[] = [
    { id: 'schedule_conflict', label: 'Schedule conflict / I\'m busy', icon: 'calendar-outline' },
    { id: 'technical_issues', label: 'Technical issues / internet problems', icon: 'wifi-outline' },
    { id: 'other', label: 'Other reason', icon: 'ellipsis-horizontal-outline', requiresNote: true }
  ];

  reasons: CancellationReason[] = [];

  constructor(
    private modalController: ModalController,
    private userService: UserService
  ) {}

  private get userTz(): string | undefined {
    return this.userService.getCurrentUserValue()?.profile?.timezone || undefined;
  }

  ngOnInit() {
    // Select reasons based on user role
    this.reasons = this.userRole === 'tutor' ? this.tutorReasons : this.studentReasons;
    
    // Check if cancellation is within 12 hours and format date/time
    if (this.lessonStartTime) {
      const now = new Date();
      const lessonTime = new Date(this.lessonStartTime);
      const hoursUntilLesson = (lessonTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      this.isWithin12Hours = hoursUntilLesson < 12 && hoursUntilLesson > 0;
      
      // Format date and time for display
      this.formattedDateTime = this.formatLessonDateTime(lessonTime);
    }
    
    // Format duration
    if (this.lessonDuration) {
      this.formattedDuration = this.formatDuration(this.lessonDuration);
    }
  }
  
  private formatLessonDateTime(date: Date): string {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    let dayLabel: string;
    if (this.userTz) {
      if (isSameDayInTimezone(date, today, this.userTz)) {
        dayLabel = 'Today';
      } else if (isSameDayInTimezone(date, tomorrow, this.userTz)) {
        dayLabel = 'Tomorrow';
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
        dayLabel = 'Today';
      } else if (date.toDateString() === tomorrow.toDateString()) {
        dayLabel = 'Tomorrow';
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
    
    return `${dayLabel} at ${timeStr}`;
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
    // Clear other reason text if not selecting "other"
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

  confirm() {
    if (!this.canConfirm()) return;
    
    const reasonText = this.selectedReason?.id === 'other' 
      ? this.otherReasonText.trim() 
      : this.selectedReason?.label;
    
    this.modalController.dismiss({
      cancelled: false,
      reason: {
        id: this.selectedReason!.id,
        label: reasonText,
        originalLabel: this.selectedReason!.label
      }
    });
  }
}

