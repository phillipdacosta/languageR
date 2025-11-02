import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, LoadingController, ToastController } from '@ionic/angular';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { UserService } from '../services/user.service';
import { LessonService, LessonCreateRequest } from '../services/lesson.service';
import { AuthService } from '@auth0/auth0-angular';
import { firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-checkout',
  templateUrl: './checkout.page.html',
  styleUrls: ['./checkout.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterLink]
})
export class CheckoutPage {
  tutorId = '';
  dateIso = '';
  time = '';
  tutor: any = null;
  lessonMinutes = 60;
  currentUser: any = null;
  isBooking = false;

  constructor(
    private route: ActivatedRoute, 
    private router: Router,
    private userService: UserService,
    private lessonService: LessonService,
    private auth: AuthService,
    private loadingController: LoadingController,
    private toastController: ToastController
  ) {
    const qp = this.route.snapshot.queryParamMap;
    this.tutorId = qp.get('tutorId') || '';
    this.dateIso = qp.get('date') || '';
    this.time = qp.get('time') || '';
    
    // Load tutor and current user data
    this.loadData();
  }

  private async loadData() {
    try {
      // Load tutor data
      if (this.tutorId) {
        const tutorRes = await firstValueFrom(this.userService.getTutorPublic(this.tutorId));
        this.tutor = tutorRes?.tutor || null;
      }

      // Load current user data
      const userRes = await firstValueFrom(this.userService.getCurrentUser());
      this.currentUser = userRes;
    } catch (error) {
      console.error('Error loading checkout data:', error);
    }
  }

  async confirmBooking() {
    if (this.isBooking || !this.tutor || !this.currentUser) return;

    this.isBooking = true;
    const loading = await this.loadingController.create({
      message: 'Booking your lesson...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Calculate start and end times
      const startTime = this.parseStartDate();
      if (!startTime) {
        throw new Error('Invalid lesson time');
      }
      
      const endTime = new Date(startTime.getTime() + this.lessonMinutes * 60000);

      // Get the primary language from tutor (first language they teach)
      const tutorLanguages = this.tutor?.onboardingData?.languages || this.tutor?.languages || [];
      const primaryLanguage = tutorLanguages.length > 0 ? tutorLanguages[0] : 'Language';
      const subject = `${primaryLanguage} Lesson`;

      // Create lesson booking request
      const lessonData: LessonCreateRequest = {
        tutorId: this.tutorId,
        studentId: this.currentUser.id,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        subject: subject,
        price: this.total,
        duration: this.lessonMinutes,
        bookingData: {
          selectedDate: this.dateIso,
          selectedTime: this.time,
          timeRange: this.timeRange
        }
      };

      console.log('📅 Creating lesson booking:', lessonData);

      // Create the lesson
      const response = await firstValueFrom(this.lessonService.createLesson(lessonData));
      
      if (response.success) {
        // Show success message
        const toast = await this.toastController.create({
          message: 'Lesson booked successfully! You can join 15 minutes before the start time.',
          duration: 4000,
          color: 'success',
          position: 'top'
        });
        await toast.present();

        // Navigate to lessons page or home
        this.router.navigate(['/tabs/home'], { 
          queryParams: { bookingSuccess: true, lessonId: response.lesson._id } 
        });
      } else {
        throw new Error('Failed to create lesson');
      }
    } catch (error: any) {
      console.error('❌ Error booking lesson:', error);
      
      // Check if this is a time slot conflict (409 Conflict)
      const isConflict = error instanceof HttpErrorResponse && error.status === 409;
      const errorMessage = isConflict 
        ? (error.error?.message || 'This time slot is no longer available. It may have been booked by another student.')
        : (error.error?.message || error.message || 'Failed to book lesson. Please try again.');
      
      const toast = await this.toastController.create({
        message: errorMessage,
        duration: 5000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();

      // If it's a conflict, navigate back to tutor page to refresh availability
      if (isConflict && this.tutorId) {
        // Wait a moment for toast to appear, then navigate
        setTimeout(() => {
          this.router.navigate(['/tutor', this.tutorId], {
            queryParams: { 
              conflict: 'true',
              refreshAvailability: 'true'
            }
          });
        }, 1000);
      }
    } finally {
      this.isBooking = false;
      await loading.dismiss();
    }
  }

  get formattedDate(): string {
    if (!this.dateIso) return '';
    const d = new Date(this.dateIso);
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }

  get dateMonthShort(): string {
    if (!this.dateIso) return '';
    return new Date(this.dateIso).toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
  }

  get dateDayNumber(): string {
    if (!this.dateIso) return '';
    return String(new Date(this.dateIso).getDate());
  }

  get dateWeekday(): string {
    if (!this.dateIso) return '';
    return new Date(this.dateIso).toLocaleDateString(undefined, { weekday: 'long' });
  }

  get pricePerLesson(): number {
    const rate = this.tutor?.hourlyRate ?? this.tutor?.onboardingData?.hourlyRate ?? 20;
    // 50-minute lesson priced proportionally to hourlyRate
    return Math.round((rate * (this.lessonMinutes / 60)) * 100) / 100;
  }

  get processingFee(): number { return 0; }
  get discount(): number { return 0; }
  get total(): number { return Math.max(this.pricePerLesson + this.processingFee - this.discount, 0); }

  private parseStartDate(): Date | null {
    if (!this.dateIso || !this.time) return null;
    const [h, m] = this.time.split(':').map(Number);
    const d = new Date(this.dateIso);
    d.setHours(h, m, 0, 0);
    return d;
  }

  private format12h(d: Date): string {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  get timeRange(): string {
    const start = this.parseStartDate();
    if (!start) return '';
    const end = new Date(start.getTime() + this.lessonMinutes * 60000);
    return `${this.format12h(start)} – ${this.format12h(end)}`;
  }
}
