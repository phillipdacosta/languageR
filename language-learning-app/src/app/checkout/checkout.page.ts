import { Component, Input, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, LoadingController, ToastController, AlertController, ModalController } from '@ionic/angular';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { UserService } from '../services/user.service';
import { LessonService, LessonCreateRequest } from '../services/lesson.service';
import { ClassService } from '../services/class.service';
import { AuthService } from '@auth0/auth0-angular';
import { firstValueFrom } from 'rxjs';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { CardManagementModalComponent } from '../components/card-management-modal/card-management-modal.component';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-checkout',
  templateUrl: './checkout.page.html',
  styleUrls: ['./checkout.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterLink]
})
export class CheckoutPage implements OnInit {
  @Input() tutorId = '';
  @Input() dateIso = '';
  @Input() time = '';
  @Input() lessonMinutes = 25;
  @Input() embedded = false; // When true, render without back button and emit events instead of navigating
  @Output() bookingComplete = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
  
  tutor: any = null;
  currentUser: any = null;
  isBooking = false;
  returnTo: string | null = null; // Track where to return after booking
  previousLessonsWithTutor: number = 0; // Track lesson count with this tutor
  
  // Payment-related properties
  selectedPaymentMethod: string = 'saved-card';
  defaultCard: any = null;
  walletBalance: number = 0;
  isApplePayAvailable: boolean = false;
  isGooglePayAvailable: boolean = false;

  constructor(
    private route: ActivatedRoute, 
    private router: Router,
    private userService: UserService,
    private lessonService: LessonService,
    private classService: ClassService,
    private auth: AuthService,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private alertController: AlertController,
    private modalController: ModalController,
    private http: HttpClient
  ) {}

  ngOnInit() {
    // If inputs weren't provided, read from query params (for standalone page mode)
    if (!this.tutorId) {
      const qp = this.route.snapshot.queryParamMap;
      this.tutorId = qp.get('tutorId') || '';
      this.dateIso = qp.get('date') || '';
      this.time = qp.get('time') || '';
      this.lessonMinutes = parseInt(qp.get('duration') || '25', 10);
      
      // Read trial lesson status from query params (passed from tutor availability page)
      const isTrialParam = qp.get('isTrialLesson');
      if (isTrialParam === 'true') {
        this.previousLessonsWithTutor = 0; // Force trial lesson
      } else if (isTrialParam === 'false') {
        this.previousLessonsWithTutor = 1; // Force non-trial
      }
      // If not provided, will be checked later in loadData
    }
    
    // Read returnTo parameter to know where to navigate after booking
    const qp = this.route.snapshot.queryParamMap;
    this.returnTo = qp.get('returnTo');
    
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
      
      // Load saved cards
      await this.loadSavedCards();
      
      // Check if this is a trial lesson (first lesson with this tutor)
      await this.checkIfTrialLesson();
    } catch (error) {
      console.error('Error loading checkout data:', error);
    }
  }

  private async checkIfTrialLesson(): Promise<void> {
    // If trial lesson status was passed via query params, skip the check
    const qp = this.route.snapshot.queryParamMap;
    const isTrialParam = qp.get('isTrialLesson');
    if (isTrialParam === 'true' || isTrialParam === 'false') {
      console.log('📊 Trial lesson status from query params:', isTrialParam);
      return; // Already set in ngOnInit
    }
    
    // Otherwise, check via API (fallback for direct navigation)
    if (!this.tutorId || !this.currentUser) {
      this.previousLessonsWithTutor = 0;
      return;
    }

    try {
      // Fetch the student's lessons to count previous lessons with this tutor
      const response = await firstValueFrom(
        this.lessonService.getMyLessons()
      );

      if (response.success && response.lessons) {
        // Count completed or in-progress lessons with this tutor
        this.previousLessonsWithTutor = response.lessons.filter((lesson: any) => 
          lesson.tutorId?._id === this.tutorId && 
          (lesson.status === 'completed' || lesson.status === 'scheduled' || lesson.status === 'in-progress')
        ).length;
        
        console.log(`📊 Previous lessons with tutor: ${this.previousLessonsWithTutor}`);
      }
    } catch (error) {
      console.error('Error checking trial lesson status:', error);
      this.previousLessonsWithTutor = 0;
    }
  }

  /**
   * Check if the student has any lessons or classes scheduled that conflict with the proposed time
   * Returns conflict details if found, null if no conflict
   */
  private async checkSchedulingConflict(proposedStart: Date, proposedEnd: Date): Promise<{ message: string } | null> {
    try {
      // Get all user's lessons
      const lessonsResponse = await firstValueFrom(this.lessonService.getMyLessons());
      
      if (!lessonsResponse.success) {
        console.error('Failed to fetch lessons for conflict check');
        return null; // Allow booking if we can't check (fail open)
      }

      const allLessons = lessonsResponse.lessons || [];
      
      // Filter out cancelled and completed lessons
      const activeScheduledLessons = allLessons.filter((lesson: any) => 
        lesson.status !== 'cancelled' && lesson.status !== 'completed'
      );

      console.log(`🔍 Checking ${activeScheduledLessons.length} active lessons for conflicts`);
      console.log('🕐 Proposed time:', proposedStart.toISOString(), 'to', proposedEnd.toISOString());

      // Check each lesson for time overlap
      for (const lesson of activeScheduledLessons) {
        const lessonStart = new Date(lesson.startTime);
        const lessonEnd = new Date(lesson.endTime);

        // Check if times overlap
        // Two time ranges overlap if one starts before the other ends
        const hasOverlap = proposedStart < lessonEnd && proposedEnd > lessonStart;

        if (hasOverlap) {
          console.log('⚠️ CONFLICT FOUND with lesson:', {
            lessonId: lesson._id,
            subject: lesson.subject,
            start: lessonStart.toISOString(),
            end: lessonEnd.toISOString(),
            status: lesson.status
          });
          
          const timeStr = lessonStart.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit', 
            hour12: true 
          });
          
          return {
            message: `You already have a ${lesson.subject} lesson scheduled at ${timeStr}. Please choose a different time slot.`
          };
        }
      }

      // Also check for class conflicts (using pending invitations that are accepted)
      try {
        const classesResponse = await firstValueFrom(this.classService.getPendingInvitations());
        
        if (classesResponse.success && classesResponse.classes) {
          // Only check classes that have been accepted and are not cancelled
          const activeClasses = classesResponse.classes.filter((cls: any) => {
            const myInvitation = cls.invitedStudents?.find((inv: any) => inv.studentId === this.currentUser?.id);
            return myInvitation?.status === 'accepted' && cls.status !== 'cancelled';
          });

          console.log(`🔍 Checking ${activeClasses.length} active classes for conflicts`);

          for (const cls of activeClasses) {
            const classStart = new Date(cls.startTime);
            const classEnd = new Date(cls.endTime);

            const hasOverlap = proposedStart < classEnd && proposedEnd > classStart;

            if (hasOverlap) {
              console.log('⚠️ CONFLICT FOUND with class:', {
                classId: cls._id,
                className: cls.name,
                start: classStart.toISOString(),
                end: classEnd.toISOString()
              });
              
              const timeStr = classStart.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit', 
                hour12: true 
              });
              
              return {
                message: `You already have a class "${cls.name}" scheduled at ${timeStr}. Please choose a different time slot.`
              };
            }
          }
        }
      } catch (classError) {
        console.warn('Could not check class conflicts, continuing with lesson check only:', classError);
        // Don't fail the whole check if class checking fails
      }

      console.log('✅ No scheduling conflicts found');
      return null;

    } catch (error) {
      console.error('Error checking scheduling conflict:', error);
      return null; // Fail open - allow booking if check fails
    }
  }

  async confirmBooking() {
    if (this.isBooking || !this.tutor || !this.currentUser) return;

    // Double-check currentUser has an ID
    if (!this.currentUser.id) {
      console.error('❌ Current user missing ID:', this.currentUser);
      const toast = await this.toastController.create({
        message: 'User data not loaded. Please refresh the page and try again.',
        duration: 5000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
      return;
    }

    this.isBooking = true;
    let loading: HTMLIonLoadingElement | null = null;
    let bookingLoading: HTMLIonLoadingElement | null = null;
    
    try {
      loading = await this.loadingController.create({
        message: 'Checking availability...',
        spinner: 'crescent'
      });
      await loading.present();

      // Calculate start and end times
      const startTime = this.parseStartDate();
      if (!startTime) {
        throw new Error('Invalid lesson time');
      }
      
      const endTime = new Date(startTime.getTime() + this.lessonMinutes * 60000);

      // CHECK FOR SCHEDULING CONFLICTS
      console.log('🔍 Checking for scheduling conflicts...');
      const conflictDetails = await this.checkSchedulingConflict(startTime, endTime);
      
      if (conflictDetails) {
        if (loading) await loading.dismiss();
        this.isBooking = false;
        
        // Show conflict alert with details
        const alert = await this.alertController.create({
          header: 'Schedule Conflict',
          message: conflictDetails.message,
          buttons: ['OK']
        });
        await alert.present();
        return;
      }

      // Update loading message
      if (loading) await loading.dismiss();
      bookingLoading = await this.loadingController.create({
        message: 'Booking your lesson...',
        spinner: 'crescent'
      });
      await bookingLoading.present();

      // Get the primary language from tutor (first language they teach)
      const tutorLanguages = this.tutor?.onboardingData?.languages || this.tutor?.languages || [];
      const primaryLanguage = tutorLanguages.length > 0 ? tutorLanguages[0] : 'Language';
      const subject = `${primaryLanguage} Lesson`;

      // Validate we have required data
      if (!this.currentUser || !this.currentUser.id) {
        throw new Error('User data not loaded. Please refresh the page and try again.');
      }

      console.log('📊 Current user data:', {
        id: this.currentUser.id,
        email: this.currentUser.email,
        name: this.currentUser.name
      });

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

      // Book the lesson with payment (use the correct endpoint!)
      const bookingPayload = {
        lessonData: lessonData,
        paymentMethod: this.selectedPaymentMethod,
        stripePaymentMethodId: this.defaultCard?.stripePaymentMethodId,
        stripeCustomerId: this.currentUser.stripeCustomerId
      };

      console.log('💳 Booking with payment:', {
        paymentMethod: bookingPayload.paymentMethod,
        hasPaymentMethodId: !!bookingPayload.stripePaymentMethodId,
        paymentMethodId: bookingPayload.stripePaymentMethodId,
        hasCustomerId: !!bookingPayload.stripeCustomerId,
        customerId: bookingPayload.stripeCustomerId,
        currentUserData: {
          id: this.currentUser.id,
          email: this.currentUser.email,
          stripeCustomerId: this.currentUser.stripeCustomerId
        },
        defaultCardData: this.defaultCard
      });

      // Validate required fields for saved-card payment
      if (this.selectedPaymentMethod === 'saved-card') {
        if (!bookingPayload.stripePaymentMethodId) {
          throw new Error('No payment method selected. Please select a card.');
        }
        if (!bookingPayload.stripeCustomerId) {
          throw new Error('Stripe customer ID missing. Please try refreshing the page.');
        }
      }

      // Create the lesson with payment authorization
      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/payments/book-lesson-with-payment`, bookingPayload, {
          headers: this.userService.getAuthHeadersSync()
        })
      );
      
      if (response.success) {
        // DISMISS LOADING BEFORE SHOWING SUCCESS PAGE
        if (bookingLoading) await bookingLoading.dismiss();
        
        // If embedded, emit event instead of navigating
        if (this.embedded) {
          this.bookingComplete.emit();
        } else {
          // Prepare tutor name (First Name + Last Initial)
          const tutorFirstName = this.tutor?.firstName || this.tutor?.name?.split(' ')[0] || '';
          const tutorLastName = this.tutor?.lastName || this.tutor?.name?.split(' ')[1] || '';
          
          // Navigate to booking success page with lesson details
          this.router.navigate(['/booking-success'], {
            state: {
              lessonDetails: {
                ...response.lesson,
                tutor: {
                  firstName: tutorFirstName,
                  lastName: tutorLastName,
                  picture: this.tutor?.picture || this.tutor?.profilePicture,
                  profilePicture: this.tutor?.picture || this.tutor?.profilePicture
                },
                subject: lessonData.subject,
                startTime: lessonData.startTime,
                endTime: lessonData.endTime,
                duration: lessonData.duration,
                price: lessonData.price
              }
            }
          });
        }
      } else {
        throw new Error('Failed to create lesson');
      }
    } catch (error: any) {
      console.error('❌ Error booking lesson:', error);
      
      // Dismiss loading spinners
      try {
        if (loading) await loading.dismiss();
      } catch (dismissError) {
        // Loading might already be dismissed
      }
      try {
        if (bookingLoading) await bookingLoading.dismiss();
      } catch (dismissError) {
        // Loading might already be dismissed
      }
      
      // Check if this is a time slot conflict (409 Conflict)
      const isConflict = error instanceof HttpErrorResponse && error.status === 409;
      const errorCode = error.error?.code;
      
      // If the slot is no longer available, show a more prominent alert
      if (isConflict && errorCode === 'SLOT_NO_LONGER_AVAILABLE') {
        this.isBooking = false;
        
        const alert = await this.alertController.create({
          header: 'Time Slot No Longer Available',
          message: error.error?.message || 'The tutor has updated their availability. This time slot is no longer available.',
          buttons: [
            {
              text: 'View Updated Schedule',
              handler: () => {
                // Return true to dismiss the alert, then navigate
                return true;
              }
            }
          ]
        });
        
        await alert.present();
        const { role } = await alert.onDidDismiss();
        
        // Navigate back to tutor page with refresh trigger after alert dismisses
        if (this.tutor?.id) {
          this.router.navigate(['/tutor', this.tutor.id], {
            queryParams: { refreshAvailability: 'true' }
          });
        } else {
          // Navigate based on returnTo parameter
          const destination = this.returnTo === 'messages' 
            ? '/tabs/messages' 
            : '/tabs/home';
          this.router.navigate([destination]);
        }
        return;
      }
      
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
      // Try to dismiss both loaders, but catch if already dismissed
      try {
        if (loading) await loading.dismiss();
      } catch (e) {
        // Already dismissed, ignore
      }
      try {
        if (bookingLoading) await bookingLoading.dismiss();
      } catch (e) {
        // Already dismissed, ignore
      }
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
    // Rate is for standard 50-minute lesson, not hourly (60 min)
    const STANDARD_LESSON_DURATION = 50;
    const basePrice = Math.round((rate * (this.lessonMinutes / STANDARD_LESSON_DURATION)) * 100) / 100;
    
    // Trial lessons have no discount, just shorter duration (25 min by default)
    return basePrice;
  }

  get processingFee(): number { return 0; }
  get discount(): number { return 0; }
  get total(): number { 
    return Math.max(this.pricePerLesson + this.processingFee - this.discount, 0); 
  }

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

  // Computed properties for template
  get tutorDisplayName(): string {
    if (!this.tutor) return '';
    return this.tutor.firstName || this.tutor.name?.split(' ')[0] || 'Tutor';
  }

  get isTrialLesson(): boolean {
    // First lesson with this tutor = trial lesson
    return this.previousLessonsWithTutor === 0;
  }

  get isHybridPayment(): boolean {
    return this.walletBalance > 0 && this.walletAmountToUse > 0 && this.remainingAmountToPay > 0;
  }

  get walletAmountToUse(): number {
    if (!this.walletBalance || this.selectedPaymentMethod !== 'wallet') return 0;
    return Math.min(this.walletBalance, this.total);
  }

  get remainingAmountToPay(): number {
    return Math.max(this.total - this.walletAmountToUse, 0);
  }

  get canUseWallet(): boolean {
    return this.walletBalance >= this.total;
  }

  get formattedAvailableBalance(): string {
    return this.walletBalance.toFixed(2);
  }

  get hasValidPaymentMethod(): boolean {
    if (this.selectedPaymentMethod === 'wallet') {
      return this.canUseWallet;
    }
    if (this.selectedPaymentMethod === 'saved-card') {
      return !!this.defaultCard;
    }
    if (this.selectedPaymentMethod === 'apple') {
      return this.isApplePayAvailable;
    }
    if (this.selectedPaymentMethod === 'google') {
      return this.isGooglePayAvailable;
    }
    return false;
  }

  // Payment methods
  selectPaymentMethod(method: string, paymentMethodId?: string): void {
    this.selectedPaymentMethod = method;
    console.log('Selected payment method:', method, paymentMethodId);
  }

  async openCardManagementModal(): Promise<void> {
    const modal = await this.modalController.create({
      component: CardManagementModalComponent,
      cssClass: 'card-management-modal'
    });

    await modal.present();

    const { data, role } = await modal.onDidDismiss();
    
    if (role === 'card-selected' && data?.selectedCard) {
      // User selected a card
      this.defaultCard = data.selectedCard;
      this.selectPaymentMethod('saved-card', data.selectedCard.stripePaymentMethodId);
    } else if (data?.cardsUpdated) {
      // Cards were added/removed, reload the card list
      await this.loadSavedCards();
    }
  }

  private async loadSavedCards(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/payments/payment-methods`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );
      
      if (response.success && response.paymentMethods) {
        // Find the default card (or use the first one)
        const cards = response.paymentMethods.filter((pm: any) => pm.type === 'card');
        this.defaultCard = cards.find((card: any) => card.isDefault) || cards[0] || null;
        
        if (this.defaultCard) {
          console.log('✅ Loaded default card:', this.defaultCard);
          // Automatically select the default card as the payment method
          this.selectedPaymentMethod = 'saved-card';
          console.log('✅ Auto-selected saved-card as payment method');
        }
      }
    } catch (error) {
      console.error('Error loading saved cards:', error);
    }
  }
}
