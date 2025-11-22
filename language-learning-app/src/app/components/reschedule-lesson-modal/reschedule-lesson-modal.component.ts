import { Component, Input, OnInit } from '@angular/core';
import { ModalController, LoadingController, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TutorAvailabilityViewerComponent } from '../tutor-availability-viewer/tutor-availability-viewer.component';
import { UserService } from '../../services/user.service';
import { LessonService, Lesson } from '../../services/lesson.service';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';

@Component({
  selector: 'app-reschedule-lesson-modal',
  templateUrl: './reschedule-lesson-modal.component.html',
  styleUrls: ['./reschedule-lesson-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TutorAvailabilityViewerComponent],
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
  
  // Animation direction for transitions
  animationDirection: 'forward' | 'backward' = 'forward';

  constructor(
    private modalController: ModalController,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private userService: UserService,
    private lessonService: LessonService
  ) {}

  async ngOnInit() {
    // Determine tutor and student IDs
    if (this.isTutor) {
      this.tutorId = this.currentUserId;
      this.studentId = this.participantId;
    } else {
      this.tutorId = this.participantId;
      this.studentId = this.currentUserId;
    }
    
    // Format participant name (First L.)
    // participantName can be either an object (with firstName/lastName) or a string
    // If it's an object, use it directly; if it's a string, try to get the object from the lesson
    let participantObject: any = this.participantName;
    
    // If participantName is a string, try to get the actual participant object from the lesson
    if (typeof this.participantName === 'string') {
      const isTutor = this.isTutor;
      const otherParticipant = isTutor ? this.lesson.studentId : this.lesson.tutorId;
      
      // If we have the participant object from the lesson, use that instead
      if (otherParticipant && typeof otherParticipant === 'object') {
        participantObject = otherParticipant;
      } else {
        // Fall back to the string name
        participantObject = this.participantName;
      }
    }
    
    this.formattedParticipantName = this.formatStudentDisplayName(participantObject);
    
    console.log('📅 Reschedule modal initialized:', {
      tutorId: this.tutorId,
      studentId: this.studentId,
      lessonToReschedule: this.lessonId,
      participantNameInput: this.participantName,
      participantObject: participantObject,
      formattedName: this.formattedParticipantName
    });

    // Load student's lessons to check for conflicts
    await this.loadStudentLessons();
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


  async loadStudentLessons() {
    const loading = await this.loadingController.create({
      message: 'Finding available times...'
    });
    await loading.present();

    try {
      // Load student's lessons using the dedicated endpoint
      console.log('📅 Loading lessons for student:', this.studentId);
      const response = await this.lessonService.getLessonsByStudent(this.studentId, false).toPromise();
      
      if (response?.success && response.lessons) {
        console.log('📅 Loaded', response.lessons.length, 'lessons for student');
        
        // Build busy slots from student's lessons (excluding the lesson we're rescheduling)
        this.buildStudentBusySlots(response.lessons);
        
        console.log('📅 Student busy slots calculated:', this.studentBusySlots.size, 'slots');
        console.log('📅 Sample busy slots:', Array.from(this.studentBusySlots).slice(0, 10));
      }
      
      await loading.dismiss();
      this.isLoadingMutualAvailability = false;
      
    } catch (error) {
      console.error('❌ Error loading student lessons:', error);
      await loading.dismiss();
      this.isLoadingMutualAvailability = false;
      
      const toast = await this.toastController.create({
        message: 'Could not check student availability. Showing all tutor slots.',
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
    }
  }

  buildStudentBusySlots(lessons: Lesson[]) {
    const busySlots = new Set<string>();
    const now = new Date();
    
    // Look ahead 60 days for potential reschedule dates
    const futureLimit = new Date(now);
    futureLimit.setDate(futureLimit.getDate() + 60);
    
    console.log('📅 Building busy slots from', lessons.length, 'lessons');
    console.log('📅 Date range:', now.toISOString(), 'to', futureLimit.toISOString());
    console.log('📅 Lesson being rescheduled (to skip):', this.lessonId);
    
    for (const lesson of lessons) {
      // Skip the lesson we're rescheduling
      if (lesson._id === this.lessonId) {
        console.log('⏭️ Skipping lesson being rescheduled:', lesson._id);
        continue;
      }
      
      // Only consider scheduled or in_progress lessons
      if (lesson.status !== 'scheduled' && lesson.status !== 'in_progress') {
        console.log('⏭️ Skipping lesson with status:', lesson.status);
        continue;
      }

      const startTime = new Date(lesson.startTime);
      const endTime = new Date(lesson.endTime);
      
      console.log('📅 Processing lesson:', {
        id: lesson._id,
        start: startTime.toISOString(),
        end: endTime.toISOString(),
        status: lesson.status
      });
      
      // Only consider future lessons within our date range
      if (endTime < now) {
        console.log('⏭️ Skipping past lesson:', lesson._id);
        continue;
      }
      
      if (startTime > futureLimit) {
        console.log('⏭️ Skipping lesson too far in future:', lesson._id);
        continue;
      }
      
      // Get the day of week for this lesson (0=Sun, 1=Mon, ..., 6=Sat)
      const dayOfWeek = startTime.getDay();
      
      // Generate 30-minute slots between start and end
      let currentTime = new Date(startTime);
      let slotCount = 0;
      while (currentTime < endTime) {
        const hours = currentTime.getHours().toString().padStart(2, '0');
        const minutes = currentTime.getMinutes().toString().padStart(2, '0');
        const timeSlot = `${hours}:${minutes}`;
        
        // Create key: "dayOfWeek-HH:MM" (e.g., "1-14:30" for Monday 2:30 PM)
        const key = `${dayOfWeek}-${timeSlot}`;
        busySlots.add(key);
        
        // Also add specific date-based key for more precise filtering
        const dateKey = this.getDateKey(currentTime);
        const dateSpecificKey = `${dateKey}-${timeSlot}`;
        busySlots.add(dateSpecificKey);
        
        slotCount++;
        
        // Move to next 30-minute slot
        currentTime.setMinutes(currentTime.getMinutes() + 30);
      }
      
      console.log('✅ Added', slotCount, 'busy slots for lesson', lesson._id);
    }
    
    this.studentBusySlots = busySlots;
    console.log('📅 Total busy slots:', busySlots.size);
  }

  private getDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  onTimeSlotSelected(event: any) {
    if (!event.selectedDate || !event.selectedTime) {
      return;
    }

    // Store selected date and time
    this.selectedDate = event.selectedDate;
    this.selectedTime = event.selectedTime;
    
    // Format for display
    const date = new Date(event.selectedDate);
    this.selectedDateFormatted = date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const [hours, minutes] = event.selectedTime.split(':').map(Number);
    const dateWithTime = new Date(date);
    dateWithTime.setHours(hours, minutes, 0, 0);
    this.selectedTimeFormatted = dateWithTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
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

  async confirmReschedule() {
    if (!this.selectedDate || !this.selectedTime) {
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Rescheduling lesson...'
    });
    await loading.present();

    try {
      // Combine selected date and time into ISO string
      const [hours, minutes] = this.selectedTime.split(':').map(Number);
      const newStartTime = new Date(this.selectedDate);
      newStartTime.setHours(hours, minutes, 0, 0);
      
      // Calculate end time (assuming same duration as original)
      const originalDuration = new Date(this.lesson.endTime).getTime() - new Date(this.lesson.startTime).getTime();
      const newEndTime = new Date(newStartTime.getTime() + originalDuration);

      // Call API to reschedule lesson
      const response = await this.lessonService.rescheduleLesson(
        this.lessonId,
        newStartTime.toISOString(),
        newEndTime.toISOString()
      ).toPromise();

      await loading.dismiss();

      if (response?.success) {
        const toast = await this.toastController.create({
          message: 'Lesson rescheduled successfully!',
          duration: 3000,
          color: 'success'
        });
        await toast.present();

        // Close modal and return success
        this.modalController.dismiss({ rescheduled: true, selectedDate: this.selectedDate, selectedTime: this.selectedTime });
      } else {
        throw new Error('Reschedule failed');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('Error rescheduling lesson:', error);
      
      const errorMessage = error?.error?.message || error?.message || 'Failed to reschedule lesson. Please try again.';
      
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
}

