import { Component, Input, OnInit, Output, EventEmitter, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
import { wallClockToUtc, formatTimeInTz } from '../shared/timezone.utils';
import { detectUserTimezone } from '../shared/timezone.constants';

// Declare Stripe
declare var Stripe: any;

@Component({
  selector: 'app-checkout',
  templateUrl: './checkout.page.html',
  styleUrls: ['./checkout.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterLink]
})
export class CheckoutPage implements OnInit, OnDestroy {
  @Input() tutorId = '';
  @Input() dateIso = '';
  @Input() time = '';
  @Input() lessonMinutes = 25;
  @Input() slotTimezone = ''; // IANA timezone the selected date/time is expressed in
  @Input() embedded = false; // When true, render without back button and emit events instead of navigating
  @Output() bookingComplete = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
  
  tutor: any = null;
  currentUser: any = null;
  isBooking = false;
  returnTo: string | null = null; // Track where to return after booking
  previousLessonsWithTutor: number = -1; // -1 = unknown (not yet checked), 0 = trial, 1+ = not trial
  
  // Payment-related properties
  selectedPaymentMethod: string = 'saved-card';
  defaultCard: any = null;
  walletBalance: number = 0;
  isApplePayAvailable: boolean = false;
  isGooglePayAvailable: boolean = false;
  
  // New tabbed payment UI properties
  selectedPaymentTab: 'card' | 'wallet' | 'apple' | 'google' = 'card';
  savedCards: any[] = [];
  selectedCardId: string = '';
  isAddingNewCard: boolean = false;
  
  // New card form fields
  cardholderName: string = '';
  billingAddress = {
    line1: '',
    line2: '',
    city: '',
    state: '',
    country: ''
  };
  saveCardForFuture: boolean = true;
  
  // Stripe elements
  stripe: any = null;
  stripeElements: any = null;
  cardNumberElement: any = null;
  cardExpiryElement: any = null;
  cardCvcElement: any = null;
  
  // Cached computed values (to avoid calling functions in templates)
  private _cachedTimeRange: string = '';
  private _cachedTimeRangeKey: string = '';

  private get userTz(): string | undefined {
    return this.currentUser?.profile?.timezone || undefined;
  }

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
    console.log('🔍 [CHECKOUT] ngOnInit - Inputs:', {
      tutorId: this.tutorId,
      dateIso: this.dateIso,
      time: this.time,
      lessonMinutes: this.lessonMinutes,
      embedded: this.embedded
    });
    
    // If inputs weren't provided, read from query params (for standalone page mode)
    if (!this.tutorId) {
      const qp = this.route.snapshot.queryParamMap;
      this.tutorId = qp.get('tutorId') || '';
      this.dateIso = qp.get('date') || '';
      this.time = qp.get('time') || '';
      this.lessonMinutes = parseInt(qp.get('duration') || '25', 10);
      this.slotTimezone = qp.get('timezone') || '';
      
      console.log('🔍 [CHECKOUT] Loaded from query params:', {
        tutorId: this.tutorId,
        dateIso: this.dateIso,
        time: this.time,
        lessonMinutes: this.lessonMinutes
      });
      
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
    
    // Initialize Stripe first, then load data
    this.initializeStripe().then(() => {
      // Load tutor and current user data after Stripe is ready
      this.loadData();
    });
  }

  ngOnDestroy() {
    // Clean up Stripe elements
    this.unmountStripeElements();
  }

  ionViewDidEnter() {
    // Mount Stripe elements if card form is showing and Stripe is initialized
    if (this.stripe && this.stripeElements && this.selectedPaymentTab === 'card' && (this.isAddingNewCard || this.savedCards.length === 0)) {
      setTimeout(() => this.mountStripeElements(), 200);
    }
  }

  private async initializeStripe() {
    try {
      const publishableKey = environment.stripePublishableKey;
      
      if (!publishableKey) {
        console.error('❌ Stripe publishable key not configured');
        return;
      }

      this.stripe = Stripe(publishableKey);
      this.stripeElements = this.stripe.elements();
      console.log('✅ Stripe initialized in checkout');
    } catch (error) {
      console.error('❌ Error initializing Stripe:', error);
    }
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
      
      // PREVENT TUTORS FROM BOOKING LESSONS
      if (this.currentUser?.userType === 'tutor') {
        const alert = await this.alertController.create({
          header: 'Not Available',
          message: 'Tutors cannot book lessons. Please switch to a student account to book lessons.',
          buttons: [{
            text: 'OK',
            handler: () => {
              this.router.navigate(['/tabs/home']);
            }
          }]
        });
        await alert.present();
        return;
      }
      
      // Load wallet balance
      await this.loadWalletBalance();
      
      // Load saved cards
      await this.loadSavedCards();
      
      // Check if this is a trial lesson (first lesson with this tutor)
      await this.checkIfTrialLesson();
    } catch (error) {
      console.error('Error loading checkout data:', error);
    }
  }

  private async loadWalletBalance(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/wallet/balance`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );
      
      if (response.success) {
        this.walletBalance = response.availableBalance || 0;
        console.log('💰 Wallet balance loaded:', this.walletBalance);
      }
    } catch (error) {
      console.error('Error loading wallet balance:', error);
      this.walletBalance = 0;
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
      this.previousLessonsWithTutor = 1; // Default to non-trial when we can't check
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
      this.previousLessonsWithTutor = 1; // Default to non-trial on error
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
          
          const timeStr = formatTimeInTz(lessonStart, this.userTz);
          
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
              
              const timeStr = formatTimeInTz(classStart, this.userTz);
              
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

    // Show confirmation dialog before proceeding
    const confirmed = await this.showBookingConfirmation();
    if (!confirmed) {
      return; // User cancelled
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

      // ==========================================
      // FRONTEND VALIDATION CHECKS
      // ==========================================
      
      // 1. CHECK: Lesson start time must be in the future
      const now = new Date();
      if (startTime <= now) {
        if (loading) await loading.dismiss();
        this.isBooking = false;
        const alert = await this.alertController.create({
          header: 'Invalid Time',
          message: 'This time slot has already passed. Please select a future time.',
          buttons: ['OK']
        });
        await alert.present();
        return;
      }

      // 2. CHECK: Lesson duration is valid
      if (![25, 50].includes(this.lessonMinutes)) {
        if (loading) await loading.dismiss();
        this.isBooking = false;
        const alert = await this.alertController.create({
          header: 'Invalid Duration',
          message: 'Invalid lesson duration. Please select 25 or 50 minutes.',
          buttons: ['OK']
        });
        await alert.present();
        return;
      }

      // 3. CHECK: Tutor is still available (basic check)
      if (!this.tutor.tutorApproved) {
        if (loading) await loading.dismiss();
        this.isBooking = false;
        const alert = await this.alertController.create({
          header: 'Tutor Unavailable',
          message: 'This tutor is not currently accepting bookings. Please select another tutor.',
          buttons: ['OK']
        });
        await alert.present();
        return;
      }

      console.log('✅ Frontend validations passed');

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
        _id: (this.currentUser as any)._id,
        email: this.currentUser.email,
        name: this.currentUser.name,
        auth0Id: (this.currentUser as any).auth0Id
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
      console.log('📅 CRITICAL - IDs being sent:', {
        tutorId: lessonData.tutorId,
        studentId: lessonData.studentId,
        tutorIdType: typeof lessonData.tutorId,
        studentIdType: typeof lessonData.studentId
      });

      // Determine the payment method ID to use
      let stripePaymentMethodId = this.defaultCard?.stripePaymentMethodId || this.selectedCardId;
      
      // If using new card form, create payment method first
      if (this.selectedPaymentMethod === 'new-card' || (this.selectedPaymentTab === 'card' && this.isAddingNewCard)) {
        const newPaymentMethodId = await this.createPaymentMethodFromForm();
        if (!newPaymentMethodId) {
          if (bookingLoading) await bookingLoading.dismiss();
          this.isBooking = false;
          return; // Error already shown by createPaymentMethodFromForm
        }
        stripePaymentMethodId = newPaymentMethodId;
      }

      // Determine if this is a hybrid payment (wallet + card)
      const isHybridWalletPayment = this.selectedPaymentMethod === 'wallet' && !this.canPayFullyWithWallet && this.walletBalance > 0;
      const walletAmountForPayment = this.selectedPaymentMethod === 'wallet' ? Math.min(this.walletBalance, this.total) : 0;
      const remainingAfterWallet = this.selectedPaymentMethod === 'wallet' ? Math.max(this.total - this.walletBalance, 0) : 0;

      // Book the lesson with payment (use the correct endpoint!)
      const bookingPayload: any = {
        lessonData: lessonData,
        paymentMethod: this.selectedPaymentMethod === 'new-card' ? 'saved-card' : this.selectedPaymentMethod,
        stripePaymentMethodId: stripePaymentMethodId,
        stripeCustomerId: this.currentUser.stripeCustomerId
      };
      
      // Add hybrid payment info if using wallet
      if (this.selectedPaymentMethod === 'wallet') {
        bookingPayload.walletAmount = walletAmountForPayment;
        bookingPayload.useWallet = true;
        
        if (isHybridWalletPayment) {
          // Hybrid: wallet + card
          bookingPayload.isHybridPayment = true;
          bookingPayload.paymentMethodAmount = remainingAfterWallet;
          bookingPayload.stripePaymentMethodId = this.defaultCard?.stripePaymentMethodId || this.selectedCardId;
          // Change paymentMethod to indicate card will be used for the remainder
          bookingPayload.paymentMethod = 'saved-card';
          console.log('💳 Hybrid payment setup:', {
            walletAmount: walletAmountForPayment,
            cardAmount: remainingAfterWallet,
            total: this.total,
            paymentMethodId: bookingPayload.stripePaymentMethodId
          });
        }
      }

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

      // Validate required fields for card payment
      if (this.selectedPaymentMethod === 'saved-card' || this.selectedPaymentMethod === 'new-card') {
        if (!bookingPayload.stripePaymentMethodId) {
          throw new Error('No payment method selected. Please select a card or enter card details.');
        }
        // Note: stripeCustomerId will be created by backend if it doesn't exist
        // We don't throw an error here anymore - let the backend handle it
      }

      console.log('🚀 [CHECKOUT] About to send booking request...');
      console.log('🚀 [CHECKOUT] Endpoint:', `${environment.apiUrl}/payments/book-lesson-with-payment`);
      console.log('🚀 [CHECKOUT] Full payload:', JSON.stringify(bookingPayload, null, 2));
      console.log('🚀 [CHECKOUT] Lesson details:', {
        tutorId: bookingPayload.lessonData.tutorId,
        studentId: bookingPayload.lessonData.studentId,
        startTime: bookingPayload.lessonData.startTime,
        endTime: bookingPayload.lessonData.endTime,
        duration: bookingPayload.lessonData.duration,
        price: bookingPayload.lessonData.price
      });

      // Create the lesson with payment authorization
      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/payments/book-lesson-with-payment`, bookingPayload, {
          headers: this.userService.getAuthHeadersSync()
        })
      );
      
      console.log('📨 [CHECKOUT] Backend response received:', JSON.stringify(response, null, 2));
      
      if (response.success) {
        // DISMISS LOADING BEFORE SHOWING SUCCESS PAGE
        if (bookingLoading) await bookingLoading.dismiss();
        
        console.log('✅ [CHECKOUT] Booking successful! Full response:', response);
        console.log('✅ [CHECKOUT] Lesson created:', {
          lessonId: response.lesson?._id || response.lesson?.id,
          tutorId: response.lesson?.tutorId,
          studentId: response.lesson?.studentId,
          startTime: response.lesson?.startTime,
          endTime: response.lesson?.endTime,
          status: response.lesson?.status
        });
        console.log('✅ [CHECKOUT] Embedded mode:', this.embedded);
        
        // If embedded, emit event instead of navigating
        if (this.embedded) {
          console.log('✅ [CHECKOUT] Emitting bookingComplete event...');
          this.bookingComplete.emit();
          console.log('✅ [CHECKOUT] bookingComplete event emitted');
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
      
      const errorCode = error.error?.code;
      const errorMessage = error.error?.message || error.message || 'Failed to book lesson. Please try again.';
      const isConflict = error instanceof HttpErrorResponse && error.status === 409;
      const isBadRequest = error instanceof HttpErrorResponse && error.status === 400;
      const isForbidden = error instanceof HttpErrorResponse && error.status === 403;
      
      // Handle specific error codes with appropriate UI
      if (errorCode === 'LESSON_TIME_PAST') {
        // Lesson time has passed
        this.isBooking = false;
        const alert = await this.alertController.create({
          header: 'Time Has Passed',
          message: 'This time slot has already passed. Please select a future time.',
          buttons: ['OK']
        });
        await alert.present();
        return;
      }
      
      if (errorCode === 'SLOT_NOT_AVAILABLE' || errorCode === 'SLOT_NO_LONGER_AVAILABLE') {
        // Timeslot no longer available
        this.isBooking = false;
        const alert = await this.alertController.create({
          header: 'Time Slot Unavailable',
          message: errorMessage,
          buttons: [
            {
              text: 'View Updated Schedule',
              handler: () => true
            }
          ]
        });
        await alert.present();
        await alert.onDidDismiss();
        
        // Navigate back to tutor page with refresh trigger
        if (this.tutor?.id || this.tutorId) {
          this.router.navigate(['/tutor', this.tutor?.id || this.tutorId], {
            queryParams: { refreshAvailability: 'true' }
          });
        }
        return;
      }
      
      if (errorCode === 'TUTOR_TIME_CONFLICT') {
        // Someone else booked this slot
        this.isBooking = false;
        const alert = await this.alertController.create({
          header: 'Slot Just Booked',
          message: 'This time slot was just booked by another student. Please select a different time.',
          buttons: [
            {
              text: 'Select New Time',
              handler: () => true
            }
          ]
        });
        await alert.present();
        await alert.onDidDismiss();
        
        if (this.tutor?.id || this.tutorId) {
          this.router.navigate(['/tutor', this.tutor?.id || this.tutorId], {
            queryParams: { refreshAvailability: 'true' }
          });
        }
        return;
      }
      
      if (errorCode === 'STUDENT_TIME_CONFLICT') {
        // Student has a conflicting lesson
        this.isBooking = false;
        const alert = await this.alertController.create({
          header: 'Schedule Conflict',
          message: errorMessage,
          buttons: ['OK']
        });
        await alert.present();
        return;
      }
      
      if (errorCode === 'PENDING_FEEDBACK') {
        // Tutor has pending feedback items
        this.isBooking = false;
        const alert = await this.alertController.create({
          header: 'Tutor Unavailable',
          message: 'Tutor not accepting bookings at this time. Please check back later or choose another tutor.',
          buttons: [
            {
              text: 'OK',
              handler: () => true
            }
          ]
        });
        await alert.present();
        await alert.onDidDismiss();
        
        // Navigate back to tutor page
        if (this.tutor?.id || this.tutorId) {
          this.router.navigate(['/tutor', this.tutor?.id || this.tutorId], {
            queryParams: { refreshAvailability: 'true' }
          });
        }
        return;
      }

      if (errorCode === 'TUTOR_NOT_APPROVED') {
        // Tutor not accepting bookings
        this.isBooking = false;
        const alert = await this.alertController.create({
          header: 'Tutor Unavailable',
          message: 'This tutor is not currently accepting bookings. Please select another tutor.',
          buttons: ['OK']
        });
        await alert.present();
        return;
      }
      
      if (errorCode === 'TUTOR_NOT_ONBOARDED') {
        // Tutor hasn't completed payment setup
        this.isBooking = false;
        const alert = await this.alertController.create({
          header: 'Payment Setup Incomplete',
          message: errorMessage,
          buttons: ['OK']
        });
        await alert.present();
        return;
      }
      
      // Generic error handling for other cases
      const toast = await this.toastController.create({
        message: errorMessage,
        duration: 5000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();

      // If it's any conflict, navigate back to tutor page to refresh availability
      if (isConflict && (this.tutorId || this.tutor?.id)) {
        setTimeout(() => {
          this.router.navigate(['/tutor', this.tutorId || this.tutor?.id], {
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

  private async showBookingConfirmation(): Promise<boolean> {
    const tutorName = this.tutorDisplayName || 'this tutor';
    const dateStr = this.formattedDate || this.dateIso;
    const timeStr = this.timeRange || this.time;
    const price = `$${this.total.toFixed(2)}`;
    
    const message = `Book a ${this.lessonMinutes}-minute lesson with ${tutorName} on ${dateStr} at ${timeStr} for ${price}?`;

    return new Promise(async (resolve) => {
      const alert = await this.alertController.create({
        header: 'Confirm Booking',
        message: message,
        cssClass: 'booking-confirmation-alert',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => resolve(false)
          },
          {
            text: 'Book',
            handler: () => resolve(true)
          }
        ]
      });

      await alert.present();
    });
  }

  private get slotStartUtc(): Date | null {
    return this.parseStartDate();
  }

  private get slotTz(): string {
    return this.slotTimezone || detectUserTimezone();
  }

  get formattedDate(): string {
    const d = this.slotStartUtc;
    if (!d) return '';
    return d.toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
      timeZone: this.slotTz
    });
  }

  get dateMonthShort(): string {
    const d = this.slotStartUtc;
    if (!d) return '';
    return d.toLocaleDateString('en-US', { month: 'short', timeZone: this.slotTz }).toUpperCase();
  }

  get dateDayNumber(): string {
    const d = this.slotStartUtc;
    if (!d) return '';
    return d.toLocaleDateString('en-US', { day: 'numeric', timeZone: this.slotTz });
  }

  get dateWeekday(): string {
    const d = this.slotStartUtc;
    if (!d) return '';
    return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: this.slotTz });
  }

  get pricePerLesson(): number {
    const rate = this.tutor?.hourlyRate ?? this.tutor?.onboardingData?.hourlyRate ?? 20;
    // Rate is for standard 50-minute lesson, not hourly (60 min)
    const STANDARD_LESSON_DURATION = 50;
    const basePrice = Math.round((rate * (this.lessonMinutes / STANDARD_LESSON_DURATION)) * 100) / 100;
    return basePrice;
  }

  get processingFee(): number { return 0; }
  
  // 30% discount for trial lessons (first lesson with this tutor)
  get discount(): number {
    if (this.isTrialLesson) {
      return Math.round(this.pricePerLesson * 0.30 * 100) / 100;
    }
    return 0;
  }
  
  get discountPercentage(): number {
    return this.isTrialLesson ? 30 : 0;
  }
  
  get total(): number { 
    return Math.max(this.pricePerLesson + this.processingFee - this.discount, 0); 
  }

  private parseStartDate(): Date | null {
    if (!this.dateIso || !this.time) {
      console.warn('🕐 [CHECKOUT] parseStartDate: missing dateIso or time', {
        dateIso: this.dateIso,
        time: this.time
      });
      return null;
    }

    try {
      const dateParts = this.dateIso.split('-');
      if (dateParts.length !== 3) return null;
      const [year, month, day] = dateParts.map(Number);

      const timeParts = this.time.split(':');
      if (timeParts.length < 2) return null;
      const [hours, minutes] = timeParts.map(Number);

      if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hours) || isNaN(minutes)) return null;

      // If a timezone was provided (from the availability viewer), convert wall-clock
      // time in that timezone to a proper UTC Date. Otherwise fall back to browser local.
      const tz = this.slotTimezone || detectUserTimezone();
      const utcDate = wallClockToUtc(this.dateIso, this.time, tz);

      console.log('🕐 [CHECKOUT] parseStartDate:', {
        dateIso: this.dateIso,
        time: this.time,
        timezone: tz,
        utcResult: utcDate.toISOString()
      });

      return utcDate;
    } catch (e) {
      console.error('🕐 [CHECKOUT] Error parsing start date:', e);
      return null;
    }
  }

  private format12h(d: Date): string {
    const tz = this.slotTimezone || detectUserTimezone();
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  }

  get timeRange(): string {
    // Cache key based on inputs
    const cacheKey = `${this.dateIso}-${this.time}-${this.lessonMinutes}`;
    
    // Return cached value if inputs haven't changed
    if (this._cachedTimeRangeKey === cacheKey && this._cachedTimeRange) {
      return this._cachedTimeRange;
    }
    
    const start = this.parseStartDate();
    if (!start) return '';
    const end = new Date(start.getTime() + this.lessonMinutes * 60000);
    
    // Cache the result
    this._cachedTimeRange = `${this.format12h(start)} – ${this.format12h(end)}`;
    this._cachedTimeRangeKey = cacheKey;
    
    return this._cachedTimeRange;
  }

  // Computed properties for template
  get tutorDisplayName(): string {
    if (!this.tutor) return '';
    
    // Try to get firstName and lastName
    const firstName = this.tutor.firstName || this.tutor.name?.split(' ')[0] || 'Tutor';
    const lastName = this.tutor.lastName || this.tutor.name?.split(' ')[1];
    
    // Return "FirstName L." format
    if (lastName) {
      return `${firstName} ${lastName.charAt(0)}.`;
    }
    
    return firstName;
  }

  get isTrialLesson(): boolean {
    // Only true when we've confirmed this is the first lesson (0), not when unknown (-1)
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
    // Allow wallet tab if user has ANY balance (hybrid payment will handle the rest)
    return this.walletBalance > 0;
  }
  
  get canPayFullyWithWallet(): boolean {
    return this.walletBalance >= this.total;
  }

  get formattedAvailableBalance(): string {
    return this.walletBalance.toFixed(2);
  }

  get hasValidPaymentMethod(): boolean {
    if (this.selectedPaymentMethod === 'wallet') {
      // Full wallet payment OR hybrid (wallet + saved card)
      return this.canPayFullyWithWallet || (this.walletBalance > 0 && (!!this.defaultCard || !!this.selectedCardId));
    }
    if (this.selectedPaymentMethod === 'saved-card') {
      return !!this.defaultCard || !!this.selectedCardId;
    }
    if (this.selectedPaymentMethod === 'new-card') {
      // New card form is valid if Stripe elements are mounted
      return !!this.cardNumberElement;
    }
    if (this.selectedPaymentMethod === 'apple') {
      return this.isApplePayAvailable;
    }
    if (this.selectedPaymentMethod === 'google') {
      return this.isGooglePayAvailable;
    }
    // For card tab with add new card form
    if (this.selectedPaymentTab === 'card' && this.isAddingNewCard) {
      return !!this.cardNumberElement;
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
        // Get all cards
        this.savedCards = response.paymentMethods.filter((pm: any) => pm.type === 'card');
        
        // Find the default card (or use the first one)
        this.defaultCard = this.savedCards.find((card: any) => card.isDefault) || this.savedCards[0] || null;
        
        if (this.defaultCard) {
          console.log('✅ Loaded default card:', this.defaultCard);
          // Automatically select the default card as the payment method
          this.selectedPaymentMethod = 'saved-card';
          this.selectedCardId = this.defaultCard.stripePaymentMethodId;
          console.log('✅ Auto-selected saved-card as payment method');
        } else if (this.savedCards.length === 0) {
          // No saved cards, show add card form
          this.isAddingNewCard = true;
          // Mount Stripe elements after view updates (increased timeout for reliability)
          setTimeout(() => this.mountStripeElements(), 300);
        }
      }
    } catch (error) {
      console.error('Error loading saved cards:', error);
      // Show add card form on error
      this.isAddingNewCard = true;
      setTimeout(() => this.mountStripeElements(), 300);
    }
  }

  // ================== NEW PAYMENT UI METHODS ==================

  selectPaymentTab(tab: 'card' | 'wallet' | 'apple' | 'google'): void {
    this.selectedPaymentTab = tab;
    
    // Update the underlying selectedPaymentMethod
    if (tab === 'card') {
      if (this.savedCards.length > 0 && this.selectedCardId) {
        this.selectedPaymentMethod = 'saved-card';
      } else {
        // Will use new card form
        this.selectedPaymentMethod = 'new-card';
        if (this.savedCards.length === 0) {
          this.isAddingNewCard = true;
          setTimeout(() => this.mountStripeElements(), 300);
        }
      }
    } else if (tab === 'wallet') {
      this.selectedPaymentMethod = 'wallet';
    } else if (tab === 'apple') {
      this.selectedPaymentMethod = 'apple';
    } else if (tab === 'google') {
      this.selectedPaymentMethod = 'google';
    }
    
    console.log('Selected payment tab:', tab, 'method:', this.selectedPaymentMethod);
  }

  selectSavedCard(card: any): void {
    this.selectedCardId = card.stripePaymentMethodId;
    this.defaultCard = card;
    this.selectedPaymentMethod = 'saved-card';
    console.log('Selected saved card:', card.last4);
  }

  showAddCardForm(): void {
    this.isAddingNewCard = true;
    this.selectedPaymentMethod = 'new-card';
    
    // Mount Stripe elements after view updates (increased timeout for reliability)
    setTimeout(() => this.mountStripeElements(), 300);
  }

  cancelAddCard(): void {
    this.isAddingNewCard = false;
    this.unmountStripeElements();
    
    // Go back to saved card selection
    if (this.savedCards.length > 0) {
      if (!this.selectedCardId && this.defaultCard) {
        this.selectedCardId = this.defaultCard.stripePaymentMethodId;
      }
      this.selectedPaymentMethod = 'saved-card';
    }
  }

  // Check if a card is expired
  isCardExpired(card: any): boolean {
    if (!card.expiryMonth || !card.expiryYear) return false;
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // getMonth() is 0-indexed
    
    // Card expires at the end of the expiry month
    const expiryYear = parseInt(card.expiryYear, 10);
    const expiryMonth = parseInt(card.expiryMonth, 10);
    
    if (expiryYear < currentYear) return true;
    if (expiryYear === currentYear && expiryMonth < currentMonth) return true;
    
    return false;
  }

  // Set a card as default
  async setCardAsDefault(card: any, event: Event): Promise<void> {
    event.stopPropagation(); // Prevent card selection
    
    try {
      const response = await this.http.put<any>(
        `${environment.apiUrl}/payments/payment-method/${card.stripePaymentMethodId}/default`,
        {},
        { headers: this.userService.getAuthHeadersSync() }
      ).toPromise();
      
      if (response.success) {
        // Update local state
        this.savedCards.forEach(c => c.isDefault = false);
        card.isDefault = true;
        this.defaultCard = card;
        
        // Show success toast
        const toast = await this.toastController.create({
          message: 'Card set as default',
          duration: 2000,
          color: 'success',
          position: 'top'
        });
        await toast.present();
      }
    } catch (error) {
      console.error('Error setting default card:', error);
      const toast = await this.toastController.create({
        message: 'Failed to set default card',
        duration: 2000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    }
  }

  // Delete a saved card
  async deleteCard(card: any, event: Event): Promise<void> {
    event.stopPropagation(); // Prevent card selection
    
    // Confirm deletion
    const alert = await this.alertController.create({
      header: 'Delete Card',
      message: `Are you sure you want to delete the card ending in ${card.last4}?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            try {
              const response = await this.http.delete<any>(
                `${environment.apiUrl}/payments/payment-method/${card.stripePaymentMethodId}`,
                { headers: this.userService.getAuthHeadersSync() }
              ).toPromise();
              
              if (response.success) {
                // Remove card from local state
                this.savedCards = this.savedCards.filter(c => c.stripePaymentMethodId !== card.stripePaymentMethodId);
                
                // If deleted card was selected, select another or show add form
                if (this.selectedCardId === card.stripePaymentMethodId) {
                  if (this.savedCards.length > 0) {
                    const newDefault = this.savedCards.find(c => c.isDefault) || this.savedCards[0];
                    this.selectSavedCard(newDefault);
                  } else {
                    this.isAddingNewCard = true;
                    this.selectedPaymentMethod = 'new-card';
                    setTimeout(() => this.mountStripeElements(), 300);
                  }
                }
                
                // Update default card reference
                this.defaultCard = this.savedCards.find(c => c.isDefault) || this.savedCards[0] || null;
                
                // Show success toast
                const toast = await this.toastController.create({
                  message: 'Card deleted successfully',
                  duration: 2000,
                  color: 'success',
                  position: 'top'
                });
                await toast.present();
              }
            } catch (error) {
              console.error('Error deleting card:', error);
              const toast = await this.toastController.create({
                message: 'Failed to delete card',
                duration: 2000,
                color: 'danger',
                position: 'top'
              });
              await toast.present();
            }
          }
        }
      ]
    });
    
    await alert.present();
  }

  private mountStripeElements(retryCount = 0): void {
    if (!this.stripe || !this.stripeElements) {
      console.error('❌ Stripe not initialized');
      return;
    }

    // Determine element IDs based on embedded mode
    // embedded = true uses no suffix, embedded = false (standalone page) uses -standalone suffix
    const suffix = this.embedded ? '' : '-standalone';
    const cardNumberId = `card-number-element${suffix}`;
    const cardExpiryId = `card-expiry-element${suffix}`;
    const cardCvcId = `card-cvc-element${suffix}`;

    console.log('🔍 Looking for Stripe element IDs (attempt ' + (retryCount + 1) + '):', { cardNumberId, cardExpiryId, cardCvcId, embedded: this.embedded });

    const cardNumberContainer = document.getElementById(cardNumberId);
    const cardExpiryContainer = document.getElementById(cardExpiryId);
    const cardCvcContainer = document.getElementById(cardCvcId);

    if (!cardNumberContainer || !cardExpiryContainer || !cardCvcContainer) {
      // Retry up to 5 times with increasing delays
      if (retryCount < 5) {
        console.log('⏳ Stripe containers not ready, retrying in ' + (200 * (retryCount + 1)) + 'ms...');
        setTimeout(() => this.mountStripeElements(retryCount + 1), 200 * (retryCount + 1));
        return;
      }
      console.error('❌ Stripe element containers not found after retries', {
        cardNumberId,
        cardNumber: !!cardNumberContainer,
        cardExpiryId,
        cardExpiry: !!cardExpiryContainer,
        cardCvcId,
        cardCvc: !!cardCvcContainer
      });
      return;
    }

    // Unmount existing elements first
    this.unmountStripeElements();

    const elementStyle = {
      base: {
        fontSize: '16px',
        color: '#1c1c1e',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
        '::placeholder': {
          color: '#8e8e93',
        },
      },
      invalid: {
        color: '#ff3b30',
      },
    };

    try {
      // Create and mount individual elements
      this.cardNumberElement = this.stripeElements.create('cardNumber', { 
        style: elementStyle, 
        placeholder: '0000 0000 0000 0000'
      });
      this.cardExpiryElement = this.stripeElements.create('cardExpiry', { 
        style: elementStyle, 
        placeholder: 'MM/YY' 
      });
      this.cardCvcElement = this.stripeElements.create('cardCvc', { 
        style: elementStyle, 
        placeholder: 'CVC' 
      });

      // Add event listeners for debugging
      this.cardNumberElement.on('ready', () => {
        console.log('✅ Card number element ready');
      });
      this.cardNumberElement.on('focus', () => {
        console.log('🎯 Card number focused');
      });
      this.cardNumberElement.on('change', (event: any) => {
        console.log('📝 Card number changed:', event);
      });

      this.cardNumberElement.mount(`#${cardNumberId}`);
      this.cardExpiryElement.mount(`#${cardExpiryId}`);
      this.cardCvcElement.mount(`#${cardCvcId}`);

      console.log('✅ Stripe elements mounted successfully to:', { cardNumberId, cardExpiryId, cardCvcId });
    } catch (error) {
      console.error('❌ Error mounting Stripe elements:', error);
    }
  }

  private unmountStripeElements(): void {
    try {
      if (this.cardNumberElement) {
        this.cardNumberElement.unmount();
        this.cardNumberElement.destroy();
        this.cardNumberElement = null;
      }
      if (this.cardExpiryElement) {
        this.cardExpiryElement.unmount();
        this.cardExpiryElement.destroy();
        this.cardExpiryElement = null;
      }
      if (this.cardCvcElement) {
        this.cardCvcElement.unmount();
        this.cardCvcElement.destroy();
        this.cardCvcElement = null;
      }
    } catch (e) {
      console.log('Stripe elements already unmounted');
    }
  }

  private async createPaymentMethodFromForm(): Promise<string | null> {
    if (!this.stripe || !this.cardNumberElement) {
      console.error('❌ Stripe not initialized or card element missing');
      return null;
    }

    try {
      const { paymentMethod, error } = await this.stripe.createPaymentMethod({
        type: 'card',
        card: this.cardNumberElement,
        billing_details: {
          name: this.cardholderName || undefined,
          address: {
            line1: this.billingAddress.line1 || undefined,
            line2: this.billingAddress.line2 || undefined,
            city: this.billingAddress.city || undefined,
            state: this.billingAddress.state || undefined,
            country: this.billingAddress.country || undefined,
          },
        },
      });

      if (error) {
        console.error('❌ Stripe error:', error.message);
        const toast = await this.toastController.create({
          message: error.message || 'Invalid card information',
          duration: 3000,
          color: 'danger',
          position: 'top'
        });
        await toast.present();
        return null;
      }

      console.log('✅ Payment method created:', paymentMethod.id);

      // Save card if checkbox is checked
      if (this.saveCardForFuture) {
        try {
          await firstValueFrom(
            this.http.post<any>(
              `${environment.apiUrl}/payments/save-payment-method`,
              { 
                paymentMethodId: paymentMethod.id,
                setAsDefault: this.savedCards.length === 0
              },
              { headers: this.userService.getAuthHeadersSync() }
            )
          );
          console.log('✅ Card saved for future use');
        } catch (saveError) {
          console.warn('Could not save card for future use:', saveError);
          // Continue with payment even if save fails
        }
      }

      return paymentMethod.id;
    } catch (error: any) {
      console.error('❌ Error creating payment method:', error);
      return null;
    }
  }
}
