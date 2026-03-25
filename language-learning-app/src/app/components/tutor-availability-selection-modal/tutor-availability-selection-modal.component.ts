import { Component, Input, OnInit } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TutorAvailabilityViewerComponent } from '../tutor-availability-viewer/tutor-availability-viewer.component';
import { CheckoutPage } from '../../checkout/checkout.page';
import { trigger, transition, style, animate } from '@angular/animations';

interface TutorInfo {
  id: string;
  _id?: string; // MongoDB ID alternative
  firstName: string;
  lastName: string;
  name?: string; // Fallback full name
  picture?: string;
  hourlyRate?: number; // Tutor's hourly rate
  onboardingData?: {
    hourlyRate?: number; // Alternative location for rate
  };
}

@Component({
  selector: 'app-tutor-availability-selection-modal',
  templateUrl: './tutor-availability-selection-modal.component.html',
  styleUrls: ['./tutor-availability-selection-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TutorAvailabilityViewerComponent, CheckoutPage],
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
export class TutorAvailabilitySelectionModalComponent implements OnInit {
  @Input() tutors!: TutorInfo[]; // Array of tutors with new availability
  @Input() title: string = 'Book a Lesson'; // Modal title

  // State management
  showTutorList = true; // Show tutor list if multiple tutors
  showCheckout = false; // Show embedded checkout
  selectedTutor: TutorInfo | null = null;
  selectedDate: string | null = null;
  selectedTime: string | null = null;
  selectedDateFormatted: string = '';
  selectedTimeFormatted: string = '';
  lessonDuration: number = 25;
  animationDirection: 'forward' | 'backward' = 'forward';

  constructor(
    private modalController: ModalController,
    private toastController: ToastController
  ) {}

  ngOnInit() {
    // If only one tutor, go directly to availability view
    if (this.tutors && this.tutors.length === 1) {
      this.selectedTutor = this.tutors[0];
      this.showTutorList = false;
    }
  }

  /**
   * Format tutor display name as "First L."
   */
  formatTutorName(tutor: TutorInfo): string {
    // Try firstName and lastName first
    if (tutor.firstName && tutor.lastName) {
      const firstName = this.capitalize(tutor.firstName);
      const lastInitial = tutor.lastName.charAt(0).toUpperCase();
      return `${firstName} ${lastInitial}.`;
    }
    
    // Try to parse from full name field
    if (tutor.name) {
      const parts = tutor.name.trim().split(' ').filter(Boolean);
      if (parts.length >= 2) {
        const firstName = this.capitalize(parts[0]);
        const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
        return `${firstName} ${lastInitial}.`;
      }
      return this.capitalize(tutor.name);
    }
    
    // Fallback
    return tutor.firstName ? this.capitalize(tutor.firstName) : 'Tutor';
  }

  private capitalize(value: string): string {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }
  
  /**
   * Get tutor ID (handles both id and _id fields)
   */
  getTutorId(tutor: TutorInfo): string {
    return (tutor.id || tutor._id) as string;
  }

  /**
   * Get tutor hourly rate with fallback
   */
  getTutorHourlyRate(tutor: TutorInfo): number {
    return tutor.hourlyRate || tutor.onboardingData?.hourlyRate || 25; // Default $25 if not found
  }

  /**
   * Select a tutor and navigate to their availability
   */
  selectTutor(tutor: TutorInfo) {
    this.selectedTutor = tutor;
    this.animationDirection = 'forward';
    this.showTutorList = false;
  }

  /**
   * Go back to tutor list
   */
  goBackToList() {
    this.animationDirection = 'backward';
    this.showTutorList = true;
    setTimeout(() => {
      this.selectedTutor = null;
    }, 350); // Wait for animation to complete
  }

  /**
   * Handle payment request from availability viewer's confirmation step
   */
  onPaymentRequested(event: { tutorId: string; date: string; time: string; duration: number; isTrialLesson: boolean; timezone: string }) {
    this.selectedDate = event.date;
    this.selectedTime = event.time;
    this.lessonDuration = event.duration;

    this.animationDirection = 'forward';
    this.showTutorList = false;
    this.showCheckout = true;
  }
  
  /**
   * Go back from checkout to availability
   */
  goBackToAvailability() {
    this.animationDirection = 'backward';
    this.showCheckout = false;
    setTimeout(() => {
      this.selectedDate = null;
      this.selectedTime = null;
    }, 350); // Wait for animation to complete
  }
  
  /**
   * Handle successful booking completion
   */
  async onBookingComplete() {
    console.log('🎉 [MODAL] Booking complete event received!');
    console.log('🎉 [MODAL] Tutor:', this.selectedTutor);
    console.log('🎉 [MODAL] Date:', this.selectedDate);
    console.log('🎉 [MODAL] Time:', this.selectedTime);
    
    // Show success message
    const toast = await this.toastController.create({
      message: 'Lesson booked successfully! 🎉',
      duration: 3000,
      color: 'success',
      position: 'top'
    });
    await toast.present();
    
    console.log('🎉 [MODAL] Dismissing modal with success data...');
    
    // Close modal with success flag
    await this.modalController.dismiss({
      success: true,
      booked: true,
      tutorId: this.selectedTutor ? this.getTutorId(this.selectedTutor) : undefined,
      tutorName: this.selectedTutor ? this.formatTutorName(this.selectedTutor) : undefined,
      selectedDate: this.selectedDate,
      selectedTime: this.selectedTime
    });
    
    console.log('🎉 [MODAL] Modal dismissed successfully');
  }
  
  /**
   * Handle checkout cancellation
   */
  onCheckoutCancelled() {
    // Go back to availability viewer
    this.goBackToAvailability();
  }

  /**
   * Dismiss modal
   */
  dismiss() {
    this.modalController.dismiss({ success: false });
  }
}
