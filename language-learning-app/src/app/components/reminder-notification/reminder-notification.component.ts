import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ReminderService, ReminderEvent } from '../../services/reminder.service';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-reminder-notification',
  templateUrl: './reminder-notification.component.html',
  styleUrls: ['./reminder-notification.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class ReminderNotificationComponent implements OnInit, OnDestroy {
  reminders: ReminderEvent[] = [];
  isHidden: boolean = false; // Track if reminder card is temporarily hidden
  private destroy$ = new Subject<void>();
  private timeUpdateInterval: any;

  constructor(
    private reminderService: ReminderService,
    private router: Router
  ) {}

  ngOnInit() {
    // Subscribe to reminders
    this.reminderService.getReminders()
      .pipe(takeUntil(this.destroy$))
      .subscribe(reminders => {
        this.reminders = reminders;
        // Show the card again if new reminders come in
        if (reminders.length > 0) {
          this.isHidden = false;
        }
      });
    
    // Update time displays every minute
    this.timeUpdateInterval = setInterval(() => {
      // Force update to refresh "In X mins" text
      this.reminders = [...this.reminders];
    }, 60000);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
    }
  }

  getTimeUntil(startTime: Date): string {
    return this.reminderService.getTimeUntilEvent(startTime);
  }

  dismissReminder(eventId: string, event: Event) {
    event.stopPropagation();
    this.reminderService.dismissReminder(eventId);
  }

  dismissAll(event: Event) {
    event.stopPropagation();
    this.reminderService.dismissAll();
  }

  hideCard(event: Event) {
    event.stopPropagation();
    // Temporarily hide the card without dismissing reminders
    this.isHidden = true;
  }

  async joinLesson(reminder: ReminderEvent, event: Event) {
    event.stopPropagation();
    
    console.log('🔔 [REMINDER] Join clicked for:', reminder);
    
    if (reminder.type === 'lesson' && reminder.lessonId) {
      console.log('🔔 [REMINDER] Navigating to pre-call for lesson:', reminder.lessonId);
      // Navigate to pre-call page with query params (not path params)
      await this.router.navigate(['/pre-call'], {
        queryParams: {
          lessonId: reminder.lessonId,
          role: 'tutor', // Will be determined by pre-call page based on user
          lessonMode: 'true'
        }
      });
      this.reminderService.dismissReminder(reminder.id);
    } else if (reminder.type === 'class' && reminder.classId) {
      console.log('🔔 [REMINDER] Navigating to class pre-call:', reminder.classId);
      // Navigate to class pre-call page
      await this.router.navigate(['/class-pre-call'], {
        queryParams: {
          classId: reminder.classId
        }
      });
      this.reminderService.dismissReminder(reminder.id);
    } else if (reminder.meetingLink) {
      console.log('🔔 [REMINDER] Opening meeting link:', reminder.meetingLink);
      // Open meeting link in new window
      window.open(reminder.meetingLink, '_blank');
      this.reminderService.dismissReminder(reminder.id);
    }
  }

  getEventIcon(type: string): string {
    switch (type) {
      case 'class':
        return 'people';
      case 'office-hours':
        return 'time';
      default:
        return 'videocam';
    }
  }
}
