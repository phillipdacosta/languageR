import { Injectable } from '@angular/core';
import { BehaviorSubject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

export interface ReminderEvent {
  id: string;
  title: string;
  startTime: Date;
  type: 'lesson' | 'class' | 'office-hours';
  lessonId?: string;
  classId?: string;
  studentName?: string;
  studentAvatar?: string;
  thumbnail?: string;
  meetingLink?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ReminderService {
  private reminders$ = new BehaviorSubject<ReminderEvent[]>([]);
  private trackedEvents: Map<string, ReminderEvent> = new Map();
  private dismissedReminders: Set<string> = new Set(); // Track dismissed reminder IDs
  private reminderMinutes = 15; // Default 15 minutes before
  private checkInterval: any;
  private destroy$ = new Subject<void>();
  private readonly DISMISSED_KEY = 'dismissed_reminders';

  constructor() {
    // Load dismissed reminders from localStorage
    this.loadDismissedReminders();
    
    // Check for reminders every minute
    this.checkInterval = interval(60000).subscribe(() => {
      this.checkForReminders();
    });
  }

  // Get current reminders to display
  getReminders() {
    return this.reminders$.asObservable();
  }

  // Add events to track
  trackEvents(events: ReminderEvent[]) {
    console.log('🔔 [REMINDER-SERVICE] trackEvents called with', events.length, 'events');
    
    // Clear old events and add new ones
    this.trackedEvents.clear();
    
    // Clean up dismissed reminders that are no longer in the tracked events
    // This prevents localStorage from growing with old dismissed reminder IDs
    const currentEventIds = new Set(events.map(e => e.id));
    const dismissedToKeep = new Set<string>();
    
    this.dismissedReminders.forEach(dismissedId => {
      if (currentEventIds.has(dismissedId)) {
        dismissedToKeep.add(dismissedId);
      }
    });
    
    // Only keep dismissed reminders that are still in the current event list
    if (dismissedToKeep.size !== this.dismissedReminders.size) {
      this.dismissedReminders = dismissedToKeep;
      this.saveDismissedReminders();
      console.log('🔔 [REMINDER-SERVICE] Cleaned up old dismissed reminders. Remaining:', Array.from(this.dismissedReminders));
    }
    
    events.forEach(event => {
      this.trackedEvents.set(event.id, event);
      console.log('🔔 [REMINDER-SERVICE] Tracking:', event.title, 'at', event.startTime.toLocaleString());
    });
    
    // Immediately check for reminders
    this.checkForReminders();
  }

  // Check which events should show reminders now
  private checkForReminders() {
    const now = new Date();
    const remindersToShow: ReminderEvent[] = [];

    console.log('🔔 [REMINDER-SERVICE] checkForReminders at', now.toLocaleString());
    console.log('🔔 [REMINDER-SERVICE] Checking', this.trackedEvents.size, 'tracked events');
    console.log('🔔 [REMINDER-SERVICE] Dismissed reminders:', Array.from(this.dismissedReminders));

    this.trackedEvents.forEach((event) => {
      const eventTime = new Date(event.startTime);
      const timeDiff = eventTime.getTime() - now.getTime();
      const minutesUntil = Math.floor(timeDiff / 60000);

      console.log('🔔 [REMINDER-SERVICE] Event:', event.title, 'in', minutesUntil, 'mins', 'dismissed:', this.dismissedReminders.has(event.id));

      // Show reminder if event is within reminder window AND not dismissed
      // The reminder stays visible until manually dismissed, even if lesson has started
      if (minutesUntil <= this.reminderMinutes && !this.dismissedReminders.has(event.id)) {
        console.log('✅ [REMINDER-SERVICE] SHOWING REMINDER for:', event.title);
        remindersToShow.push(event);
      }
    });

    console.log('🔔 [REMINDER-SERVICE] Showing', remindersToShow.length, 'reminders');
    this.reminders$.next(remindersToShow);
  }

  // Dismiss a specific reminder
  dismissReminder(eventId: string) {
    console.log('🔔 [REMINDER-SERVICE] Dismissing reminder:', eventId);
    this.dismissedReminders.add(eventId);
    this.saveDismissedReminders();
    this.trackedEvents.delete(eventId);
    this.checkForReminders();
  }

  // Dismiss all reminders
  dismissAll() {
    const currentReminders = this.reminders$.value;
    currentReminders.forEach(reminder => {
      this.dismissedReminders.add(reminder.id);
      this.trackedEvents.delete(reminder.id);
    });
    this.saveDismissedReminders();
    this.reminders$.next([]);
  }
  
  // Load dismissed reminders from localStorage
  private loadDismissedReminders() {
    try {
      const stored = localStorage.getItem(this.DISMISSED_KEY);
      if (stored) {
        const dismissed = JSON.parse(stored);
        this.dismissedReminders = new Set(dismissed);
        console.log('🔔 [REMINDER-SERVICE] Loaded dismissed reminders from storage:', Array.from(this.dismissedReminders));
      }
    } catch (error) {
      console.error('Error loading dismissed reminders:', error);
    }
  }
  
  // Save dismissed reminders to localStorage
  private saveDismissedReminders() {
    try {
      const dismissed = Array.from(this.dismissedReminders);
      localStorage.setItem(this.DISMISSED_KEY, JSON.stringify(dismissed));
      console.log('🔔 [REMINDER-SERVICE] Saved dismissed reminders to storage:', dismissed);
    } catch (error) {
      console.error('Error saving dismissed reminders:', error);
    }
  }

  // Calculate time until event (for display)
  getTimeUntilEvent(startTime: Date): string {
    const now = new Date();
    const diff = new Date(startTime).getTime() - now.getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 0) {
      // Event has started - show elapsed time
      const minutesAgo = Math.abs(minutes);
      if (minutesAgo === 0) {
        return 'Starting now';
      } else if (minutesAgo === 1) {
        return '1 min ago';
      } else if (minutesAgo < 60) {
        return `${minutesAgo} mins ago`;
      } else {
        const hoursAgo = Math.floor(minutesAgo / 60);
        const remainingMins = minutesAgo % 60;
        if (remainingMins === 0) {
          return hoursAgo === 1 ? '1 hour ago' : `${hoursAgo} hours ago`;
        }
        return hoursAgo === 1 
          ? `1 hour ${remainingMins} mins ago`
          : `${hoursAgo} hours ${remainingMins} mins ago`;
      }
    } else if (minutes === 0) {
      return 'Starting now';
    } else if (minutes === 1) {
      return 'In 1 min';
    } else if (minutes < 60) {
      return `In ${minutes} mins`;
    } else {
      const hours = Math.floor(minutes / 60);
      const remainingMins = minutes % 60;
      if (remainingMins === 0) {
        return `In ${hours}h`;
      }
      return `In ${hours}h ${remainingMins}m`;
    }
  }

  ngOnDestroy() {
    if (this.checkInterval) {
      this.checkInterval.unsubscribe();
    }
    this.destroy$.next();
    this.destroy$.complete();
  }
}

