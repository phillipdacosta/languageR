import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { LessonService } from '../../services/lesson.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-office-hours-booking',
  templateUrl: './office-hours-booking.component.html',
  styleUrls: ['./office-hours-booking.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class OfficeHoursBookingComponent implements OnInit {
  @Input() tutorId!: string;
  @Input() tutorName: string = 'Tutor';
  @Input() tutorPicture?: string;
  @Input() hourlyRate: number = 25;

  selectedDuration: number = 7;
  bookingType: 'instant' | 'scheduled' = 'instant';
  scheduledTime?: string; // For scheduled bookings
  notes: string = '';
  isLoading = false;
  showConfirmation = false; // For price confirmation step

  durationOptions = [
    { value: 7, label: '7 minutes', price: 0 },
    { value: 15, label: '15 minutes', price: 0 },
    { value: 30, label: '30 minutes', price: 0 }
  ];

  constructor(
    private modalController: ModalController,
    private lessonService: LessonService,
    private toastController: ToastController,
    private router: Router
  ) {}

  ngOnInit() {
    // Calculate prices based on hourly rate
    this.durationOptions = this.durationOptions.map(opt => ({
      ...opt,
      price: Math.round((this.hourlyRate / 50) * opt.value * 100) / 100
    }));
  }

  get perMinuteRate(): number {
    return Math.round((this.hourlyRate / 50) * 100) / 100;
  }

  get selectedPrice(): number {
    const option = this.durationOptions.find(opt => opt.value === this.selectedDuration);
    return option?.price || 0;
  }

  get minScheduledTime(): string {
    // Can schedule starting 5 minutes from now
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    return now.toISOString().slice(0, 16);
  }

  get maxScheduledTime(): string {
    // Can schedule up to 24 hours from now
    const future = new Date();
    future.setHours(future.getHours() + 24);
    return future.toISOString().slice(0, 16);
  }

  dismiss() {
    this.modalController.dismiss();
  }

  // Show price confirmation before booking
  proceedToConfirmation() {
    if (this.bookingType === 'scheduled' && !this.scheduledTime) {
      this.toastController.create({
        message: 'Please select a time',
        duration: 2000,
        color: 'warning'
      }).then(toast => toast.present());
      return;
    }
    this.showConfirmation = true;
  }

  // Go back to selection from confirmation
  backToSelection() {
    this.showConfirmation = false;
  }

  async bookSession() {
    if (this.bookingType === 'scheduled' && !this.scheduledTime) {
      const toast = await this.toastController.create({
        message: 'Please select a time',
        duration: 2000,
        color: 'warning'
      });
      toast.present();
      return;
    }

    this.isLoading = true;

    try {
      let startTime: string | undefined;
      
      if (this.bookingType === 'scheduled' && this.scheduledTime) {
        startTime = new Date(this.scheduledTime).toISOString();
      }
      // For instant bookings, startTime is undefined (backend will set to "now")

      const response = await this.lessonService.createOfficeHoursBooking({
        tutorId: this.tutorId,
        duration: this.selectedDuration,
        startTime: startTime,
        instant: this.bookingType === 'instant'
      }).toPromise();

      if (response?.success && response.lesson) {
        const toast = await this.toastController.create({
          message: this.bookingType === 'instant' 
            ? '✨ Session booked! Tutor has been notified.' 
            : '✨ Session scheduled!',
          duration: 3000,
          color: 'success',
          icon: 'checkmark-circle'
        });
        toast.present();

        // Close modal with success
        await this.modalController.dismiss({ success: true, lesson: response.lesson });

        // For instant bookings, navigate to pre-call waiting room
        if (this.bookingType === 'instant') {
          // Wait a moment for modal to close
          setTimeout(() => {
            this.router.navigate(['/pre-call'], {
              queryParams: {
                lessonId: response.lesson._id,
                role: 'student',
                lessonMode: 'true',
                officeHours: 'true',
                waitingForTutor: 'true' // Flag to show waiting state
              }
            });
          }, 500);
        }
      }
    } catch (error: any) {
      console.error('Error booking office hours:', error);
      const toast = await this.toastController.create({
        message: error?.error?.message || 'Failed to book session. Please try again.',
        duration: 3000,
        color: 'danger'
      });
      toast.present();
    } finally {
      this.isLoading = false;
    }
  }

  getEstimatedStartTime(): string {
    if (this.bookingType === 'instant') {
      const now = new Date();
      now.setMinutes(now.getMinutes() + 2); // Adding 2 min buffer
      return now.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
    }
    return '';
  }
}
