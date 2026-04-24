import { Component, Input, OnInit } from '@angular/core';
import { ModalController, LoadingController, ToastController, AlertController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TutorAvailabilityViewerComponent } from '../tutor-availability-viewer/tutor-availability-viewer.component';
import { AvailabilitySetupComponent } from '../availability-setup/availability-setup.component';
import { UserService } from '../../services/user.service';
import { formatTimeInTz, formatDateInTz, utcToWallClock } from '../../shared/timezone.utils';
import { detectUserTimezone } from '../../shared/timezone.constants';
import { LessonService, Lesson } from '../../services/lesson.service';
import { ClassService } from '../../services/class.service';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';
import { firstValueFrom } from 'rxjs';
import { timeout, observeOn } from 'rxjs/operators';
import { asyncScheduler } from 'rxjs';

@Component({
  selector: 'app-reschedule-lesson-modal',
  templateUrl: './reschedule-lesson-modal.component.html',
  styleUrls: ['./reschedule-lesson-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TutorAvailabilityViewerComponent, AvailabilitySetupComponent],
  animations: [
    trigger('slideInOut', [
      transition('void => forward', [
        style({ opacity: 0, transform: 'translateX(30px)' }),
        animate('350ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 1, transform: 'translateX(0)' }))
      ]),
      transition('void => backward', [
        style({ opacity: 0, transform: 'translateX(-30px)' }),
        animate('350ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 1, transform: 'translateX(0)' }))
      ]),
      transition('forward => void', [
        animate('350ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 0, transform: 'translateX(-30px)' }))
      ]),
      transition('backward => void', [
        animate('350ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 0, transform: 'translateX(30px)' }))
      ])
    ])
  ]
})
export class RescheduleLessonModalComponent implements OnInit {
  @Input() lessonId!: string;
  @Input() lesson!: Lesson;
  @Input() participantId!: string;
  @Input() participantName!: string;
  @Input() participantAvatar?: string;
  @Input() currentUserId!: string;
  @Input() isTutor!: boolean;
  @Input() showBackButton?: boolean = false; // Show back button if opened from proposal modal

  tutorId: string = '';
  studentId: string = '';
  studentBusySlots: Set<string> = new Set();
  refreshTrigger = 0;
  isLoadingMutualAvailability = true;
  
  // Confirmation state
  showConfirmation = false;
  selectedDate: string | null = null;
  selectedTime: string | null = null;
  selectedDateFormatted: string = '';
  selectedTimeFormatted: string = '';
  
  // Formatted participant name (First L.)
  formattedParticipantName: string = '';
  
  // Original lesson time display
  originalLessonTime: string = '';
  
  // Animation direction for transitions
  animationDirection: 'forward' | 'backward' = 'forward';

  // View: calendar (pick slot) or availability-setup (add new availability) — tutor only
  rescheduleView: 'calendar' | 'availability-setup' = 'calendar';

  /** null = not yet loaded, true/false once the viewer emits availabilityLoaded. */
  tutorHasAvailability: boolean | null = null;
  tutorBlocked = false;

  /** Hub class row: no single-student mutual busy-slot fetch (see tab1 `isClass` merge). */
  isClassLesson = false;

  /**
   * Set when the student's lessons could not be loaded. We still let the tutor
   * pick a slot (so they're not stuck when the endpoint is down), but we warn
   * them before submitting so they know student-side conflicts weren't checked.
   */
  studentAvailabilityFailed = false;

  /**
   * Timezone used to key busy slots. Must match the timezone the availability
   * viewer uses to render its grid (`selectedTimezone`), otherwise busy keys
   * won't collide with viewer slot keys after DST transitions or across zones.
   * The viewer defaults to `detectUserTimezone()`, so we do the same.
   */
  private viewerTz: string = '';

  constructor(
    private modalController: ModalController,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private alertController: AlertController,
    private userService: UserService,
    private lessonService: LessonService,
    private classService: ClassService
  ) {}

  private get userTz(): string | undefined {
    return this.userService.getCurrentUserValue()?.profile?.timezone || undefined;
  }

  async ngOnInit() {
    this.isClassLesson = !!(this.lesson as any)?.isClass;
    this.viewerTz = detectUserTimezone();

    if (this.isTutor) {
      this.tutorId = this.currentUserId;
      this.studentId = this.isClassLesson ? '' : this.participantId;
    } else {
      this.tutorId = this.participantId;
      this.studentId = this.currentUserId;
    }

    let participantObject: any = this.participantName;

    if (typeof this.participantName === 'string') {
      const otherParticipant = this.isTutor ? this.lesson.studentId : this.lesson.tutorId;

      if (otherParticipant && typeof otherParticipant === 'object') {
        participantObject = otherParticipant;
      } else {
        participantObject = this.participantName;
      }
    }

    if (this.isClassLesson && this.isTutor && typeof this.participantName === 'string') {
      this.formattedParticipantName = String(this.participantName).trim() || 'Class';
    } else {
      this.formattedParticipantName = this.formatStudentDisplayName(participantObject);
    }

    this.formatOriginalLessonTime();

    console.log('📅 Reschedule modal initialized:', {
      tutorId: this.tutorId,
      studentId: this.studentId,
      lessonToReschedule: this.lessonId,
      isClassLesson: this.isClassLesson,
      participantNameInput: this.participantName,
      participantObject,
      formattedName: this.formattedParticipantName
    });

    if (this.isClassLesson) {
      this.isLoadingMutualAvailability = false;
      this.studentBusySlots = new Set();
    } else {
      setTimeout(() => {
        this.loadStudentLessonsDeferred();
      }, 50);
    }
  }

  // Separate method called after initialization to avoid blocking modal render
  private loadStudentLessonsDeferred() {
    try {
      this.loadStudentLessons();
    } catch (error) {
      console.error('❌ Error loading student lessons:', error);
      this.isLoadingMutualAvailability = false;
      
      this.toastController.create({
        message: 'Error loading reschedule options. Please try again.',
        duration: 3000,
        color: 'danger'
      }).then(toast => toast.present());
    }
  }
  
  // Format student display name as "First L." (same logic as tab1.page.ts)
  formatStudentDisplayName(studentOrName: any): string {
    // Handle if it's a student object with firstName and lastName
    if (typeof studentOrName === 'object' && studentOrName) {
      const firstName = studentOrName.firstName;
      const lastName = studentOrName.lastName;
      
      if (firstName && lastName) {
        return `${this.capitalize(firstName)} ${lastName.charAt(0).toUpperCase()}.`;
      } else if (firstName) {
        return this.capitalize(firstName);
      }
      
      // Fall back to name field if firstName/lastName not available
      const rawName = studentOrName.name || studentOrName.email;
      if (!rawName) return 'Student';
      return this.formatStudentDisplayName(rawName); // Recursively handle the string
    }
    
    // Handle if it's just a string name
    const rawName = studentOrName;
    if (!rawName || typeof rawName !== 'string') {
      return 'Student';
    }

    const name = rawName.trim();

    // If it's an email, use the part before @ as a fallback
    if (name.includes('@')) {
      const base = name.split('@')[0];
      if (!base) return 'Student';
      const parts = base.split(/[.\s_]+/).filter(Boolean);
      const first = parts[0];
      const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : '';
      return lastInitial
        ? `${this.capitalize(first)} ${lastInitial.toUpperCase()}.`
        : this.capitalize(first);
    }

    const parts = name.split(' ').filter(Boolean);
    if (parts.length === 1) {
      return this.capitalize(parts[0]);
    }

    const first = this.capitalize(parts[0]);
    const last = parts[parts.length - 1];
    const lastInitial = last ? last[0].toUpperCase() : '';
    return lastInitial ? `${first} ${lastInitial}.` : first;
  }

  private capitalize(value: string): string {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }


  async loadStudentLessons(isRetry = false) {
    if (!this.studentId) {
      this.isLoadingMutualAvailability = false;
      this.studentBusySlots = new Set();
      return;
    }

    if (isRetry) {
      this.studentAvailabilityFailed = false;
      this.isLoadingMutualAvailability = true;
    }

    const loading = await this.loadingController.create({
      message: 'Finding available times...'
    });
    await loading.present();

    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), 10000)
      );

      const apiPromise = firstValueFrom(
        this.lessonService.getLessonsByStudent(this.studentId, false).pipe(
          observeOn(asyncScheduler),
          timeout(10000)
        )
      );

      const response: any = await Promise.race([apiPromise, timeoutPromise]);

      if (response?.success && Array.isArray(response.lessons)) {
        this.buildStudentBusySlots(response.lessons);
        this.studentAvailabilityFailed = false;
        this.refreshTrigger++;
      } else {
        throw new Error('Unexpected response shape');
      }

      await loading.dismiss();
      this.isLoadingMutualAvailability = false;
    } catch (error: any) {
      console.error('Error loading student lessons:', error);
      await loading.dismiss();
      this.isLoadingMutualAvailability = false;
      this.studentAvailabilityFailed = true;
      this.studentBusySlots = new Set();

      const toast = await this.toastController.create({
        message:
          error?.message === 'Request timeout'
            ? 'Timed out checking student availability. You can retry or continue.'
            : "Couldn't verify student availability. You can retry or continue.",
        duration: 3500,
        color: 'warning'
      });
      await toast.present();
    }
  }

  retryStudentAvailability() {
    this.loadStudentLessons(true);
  }

  /**
   * Build the set of 30-minute slot keys that are busy for the student.
   *
   * Keys are written in the viewer's display timezone (`this.viewerTz`) so
   * they collide with the `${dateKey}-${timeSlot}` keys the availability
   * viewer checks. Converting via `utcToWallClock` keeps us DST-correct
   * regardless of the browser's local zone.
   *
   * We intentionally DO NOT emit day-based (`${dayOfWeek}-${time}`) keys —
   * those would over-block every future occurrence of the same weekday/time.
   * All repeating student lessons already appear as discrete rows in the
   * response, so date-specific keys are sufficient and precise.
   */
  buildStudentBusySlots(lessons: Lesson[]) {
    const busySlots = new Set<string>();
    const now = new Date();
    const futureLimit = new Date(now);
    futureLimit.setDate(futureLimit.getDate() + 60);

    const BLOCKING_STATUSES = new Set([
      'scheduled',
      'confirmed',
      'in_progress',
      'pending_reschedule'
    ]);

    for (const lesson of lessons) {
      if (lesson._id === this.lessonId) continue;
      if (!BLOCKING_STATUSES.has(lesson.status as string)) continue;

      const startTime = new Date(lesson.startTime);
      const endTime = new Date(lesson.endTime);
      if (!(startTime instanceof Date) || isNaN(startTime.getTime())) continue;
      if (!(endTime instanceof Date) || isNaN(endTime.getTime())) continue;
      if (endTime <= now) continue;
      if (startTime > futureLimit) continue;

      // Iterate in UTC (30-min steps) and translate each step into the
      // viewer's local wall-clock to produce the slot key.
      let cursor = new Date(startTime);
      while (cursor < endTime) {
        const wall = utcToWallClock(cursor, this.viewerTz);
        busySlots.add(`${wall.date}-${wall.time}`);
        cursor = new Date(cursor.getTime() + 30 * 60 * 1000);
      }
    }

    this.studentBusySlots = busySlots;
  }

  onTimeSlotSelected(event: any) {
    if (!event.selectedDate || !event.selectedTime) {
      return;
    }

    // Combine selected date and time to check if it's valid
    // IMPORTANT: Parse date components to avoid timezone issues
    const [hours, minutes] = event.selectedTime.split(':').map(Number);
    const [year, month, day] = event.selectedDate.split('-').map(Number);
    const selectedDateTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
    
    // Get original lesson time
    const originalDateTime = new Date(this.lesson.startTime);
    
    // Prevent selecting a time in the past OR before the original lesson time
    const now = new Date();
    if (selectedDateTime < now) {
      this.toastController.create({
        message: 'Cannot select a time in the past',
        duration: 3000,
        color: 'danger',
        position: 'top'
      }).then(toast => toast.present());
      return;
    }
    
    if (selectedDateTime < originalDateTime) {
      this.toastController.create({
        message: 'Cannot reschedule to a time before the original lesson',
        duration: 3000,
        color: 'danger',
        position: 'top'
      }).then(toast => toast.present());
      return;
    }

    // Store selected date and time
    this.selectedDate = event.selectedDate;
    this.selectedTime = event.selectedTime;
    
    // Format for display - Airbnb style (e.g. "Thursday, February 12, 2026")
    this.selectedDateFormatted = formatDateInTz(selectedDateTime, this.userTz, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    this.selectedTimeFormatted = formatTimeInTz(selectedDateTime, this.userTz);
    
    // Trigger smooth transition to confirmation screen (forward)
    this.animationDirection = 'forward';
    this.showConfirmation = true;
  }

  goBack() {
    // Trigger smooth transition back to calendar (backward - reverse direction)
    this.animationDirection = 'backward';
    this.showConfirmation = false;
    setTimeout(() => {
      this.selectedDate = null;
      this.selectedTime = null;
    }, 350); // Wait for animation to complete
  }

  async onRescheduleClick() {
    const header = this.isClassLesson ? 'Reschedule class' : 'Reschedule Lesson';
    const subject = this.isClassLesson ? 'this class' : 'this lesson';
    const warnUnverified =
      !this.isClassLesson && this.studentAvailabilityFailed
        ? " We couldn't verify the student's calendar, so this slot may conflict with another lesson."
        : '';
    const alert = await this.alertController.create({
      header,
      message: `Are you sure you want to reschedule ${subject} to ${this.selectedDateFormatted} at ${this.selectedTimeFormatted}?${warnUnverified}`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'alert-cancel-button'
        },
        {
          text: 'Reschedule',
          role: 'confirm',
          cssClass: 'alert-confirm-button',
          handler: () => {
            this.confirmReschedule();
          }
        }
      ]
    });
    await alert.present();
  }

  async confirmReschedule() {
    if (!this.selectedDate || !this.selectedTime) {
      return;
    }

    const loading = await this.loadingController.create({
      message: this.isClassLesson ? 'Updating class…' : 'Proposing new time...'
    });
    await loading.present();

    try {
      // Combine selected date and time into ISO string
      // IMPORTANT: Parse date components to avoid timezone issues
      const [hours, minutes] = this.selectedTime.split(':').map(Number);
      const [year, month, day] = this.selectedDate.split('-').map(Number);
      
      // Create date in LOCAL timezone (not UTC)
      const newStartTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
      
      // Calculate end time (assuming same duration as original)
      const originalDuration = new Date(this.lesson.endTime).getTime() - new Date(this.lesson.startTime).getTime();
      const newEndTime = new Date(newStartTime.getTime() + originalDuration);

      console.log('📅 Reschedule submit:', {
        isClassLesson: this.isClassLesson,
        selectedDate: this.selectedDate,
        selectedTime: this.selectedTime,
        newStartTime: newStartTime.toString(),
        newStartTimeISO: newStartTime.toISOString()
      });

      let response: any;

      if (this.isClassLesson) {
        if (!this.isTutor) {
          await loading.dismiss();
          const toast = await this.toastController.create({
            message: 'Only the tutor can reschedule this class.',
            duration: 3000,
            color: 'warning',
            position: 'bottom'
          });
          await toast.present();
          return;
        }

        const apiPromise = firstValueFrom(
          this.classService
            .updateClass(this.lessonId, {
              startTime: newStartTime.toISOString(),
              endTime: newEndTime.toISOString()
            })
            .pipe(observeOn(asyncScheduler), timeout(15000))
        );

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), 15000)
        );

        response = await Promise.race([apiPromise, timeoutPromise]);
      } else {
        const apiPromise = firstValueFrom(
          this.lessonService
            .proposeReschedule(this.lessonId, newStartTime.toISOString(), newEndTime.toISOString())
            .pipe(observeOn(asyncScheduler), timeout(15000))
        );

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), 15000)
        );

        response = await Promise.race([apiPromise, timeoutPromise]);
      }

      await loading.dismiss();

      if (response?.success) {
        const toast = await this.toastController.create({
          message: this.isClassLesson
            ? 'Class time updated.'
            : 'New time proposed! Waiting for confirmation.',
          duration: 3000,
          color: 'success'
        });
        await toast.present();

        this.modalController.dismiss({
          rescheduled: true,
          proposed: !this.isClassLesson,
          selectedDate: this.selectedDate,
          selectedTime: this.selectedTime
        });
      } else {
        throw new Error('Reschedule failed');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('Error rescheduling lesson:', error);
      
      const errorMessage = error?.message === 'Request timeout'
        ? 'Request timed out. Please try again.'
        : (error?.error?.message || error?.message || 'Failed to reschedule lesson. Please try again.');
      
      const toast = await this.toastController.create({
        message: errorMessage,
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
    }
  }

  dismiss() {
    this.modalController.dismiss();
  }

  goBackToProposal() {
    // Dismiss with a flag to re-open the proposal modal
    this.modalController.dismiss({ goBackToProposal: true });
  }

  showAddAvailability(): void {
    this.rescheduleView = 'availability-setup';
  }

  goBackToCalendar(): void {
    this.rescheduleView = 'calendar';
    this.refreshTrigger++;
  }

  onAvailabilitySaved(): void {
    this.goBackToCalendar();
  }

  onAvailabilityLoaded(ev: { hasAvailability: boolean; tutorBlocked: boolean }): void {
    this.tutorHasAvailability = ev.hasAvailability;
    this.tutorBlocked = ev.tutorBlocked;
  }

  /**
   * Format the original lesson time for display in the banner
   */
  private formatOriginalLessonTime(): void {
    if (!this.lesson?.startTime) {
      this.originalLessonTime = '';
      return;
    }

    const startDate = new Date(this.lesson.startTime);
    
    // Format: "Monday, December 23 at 10:30 AM"
    const formattedDate = formatDateInTz(startDate, this.userTz, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: undefined
    });
    const formattedTime = formatTimeInTz(startDate, this.userTz);
    
    this.originalLessonTime = `${formattedDate} at ${formattedTime}`;
  }
}

