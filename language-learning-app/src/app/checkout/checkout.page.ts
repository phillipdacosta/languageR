import { Component, Input, OnInit, Output, EventEmitter, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, LoadingController, ToastController, AlertController, ModalController } from '@ionic/angular';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { UserService } from '../services/user.service';
import { LessonService, LessonCreateRequest } from '../services/lesson.service';
import { ClassService } from '../services/class.service';
import { AuthService } from '@auth0/auth0-angular';
import { WalletService, WalletBalance } from '../services/wallet.service';
import { firstValueFrom, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { HttpErrorResponse, HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { CardManagementModalComponent } from '../components/card-management-modal/card-management-modal.component';

// Import Stripe
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
  @Input() embedded = false; // When true, render without back button and emit events instead of navigating
  @Output() bookingComplete = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
  
  tutor: any = null;
  tutorDisplayName: string = '';
  currentUser: any = null;
  isBooking = false;
  returnTo: string | null = null; // Track where to return after booking

  // Cached computed values to avoid repeated calculations
  private _cachedStartDate: Date | null = null;
  private _cachedTimeRange: string = '';
  private _cachedDateWeekday: string = '';
  private _cachedDateMonthShort: string = '';
  private _cachedDateDayNumber: string = '';

  // Wallet & Payment
  walletBalance: WalletBalance | null = null;
  selectedPaymentMethod: 'wallet' | 'saved-card' | 'apple' | 'google' = 'wallet';
  savedCards: any[] = [];
  defaultCard: any = null;
  selectedSavedCard: string | null = null;
  saveCardForFuture = true; // Checkbox to save new card
  isApplePayAvailable = false;
  isGooglePayAvailable = false;
  
  // Stripe
  stripe: any;
  cardElement: any;
  stripeElements: any;
  currentPaymentIntentId: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute, 
    private router: Router,
    private userService: UserService,
    private lessonService: LessonService,
    private classService: ClassService,
    private auth: AuthService,
    private walletService: WalletService,
    private http: HttpClient,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private alertController: AlertController,
    private modalController: ModalController
  ) {}

  async ngOnInit() {
    // If inputs weren't provided, read from query params (for standalone page mode)
    if (!this.tutorId) {
      const qp = this.route.snapshot.queryParamMap;
      this.tutorId = qp.get('tutorId') || '';
      this.dateIso = qp.get('date') || '';
      this.time = qp.get('time') || '';
      this.lessonMinutes = parseInt(qp.get('duration') || '25', 10);
    }
    
    // Compute date/time values once
    this.computeDateTimeValues();
    
    // Read returnTo parameter to know where to navigate after booking
    const qp = this.route.snapshot.queryParamMap;
    this.returnTo = qp.get('returnTo');
    
    // Check payment method availability
    this.checkApplePayAvailability();
    this.checkGooglePayAvailability();
    
    // Initialize Stripe
    this.initializeStripe();

    // Load data sequentially: tutor first (needed for price calculation), then wallet
    await this.loadData();
    await this.loadWalletBalance();
    await this.loadSavedCards();
    
    // Auto-deduplicate cards on load
    await this.deduplicateCardsIfNeeded();
  }
  
  private async deduplicateCardsIfNeeded() {
    // Only run if we have duplicates
    const uniqueCount = new Set(this.savedCards.map(c => `${c.brand}-${c.last4}`)).size;
    if (this.savedCards.length > uniqueCount) {
      console.log(`🧹 Detected ${this.savedCards.length - uniqueCount} duplicate cards, cleaning up...`);
      try {
        const response = await firstValueFrom(
          this.http.post<any>(
            `${environment.apiUrl}/payments/deduplicate-cards`,
            {},
            { headers: this.userService.getAuthHeadersSync() }
          )
        );
        
        if (response.success && response.removedCount > 0) {
          console.log(`✅ Removed ${response.removedCount} duplicate card(s)`);
          // Reload saved cards
          await this.loadSavedCards();
        }
      } catch (error) {
        console.warn('Could not deduplicate cards:', error);
      }
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    
    // Clean up Stripe card element
    if (this.cardElement) {
      try {
        this.cardElement.unmount();
        this.cardElement.destroy();
      } catch (e) {
        console.log('Card element already cleaned up');
      }
      this.cardElement = null;
    }
  }

  private async initializeStripe() {
    try {
      // Get publishable key from environment
      const publishableKey = environment.stripePublishableKey;
      
      if (!publishableKey) {
        console.error('❌ Stripe publishable key not configured');
        return;
      }

      this.stripe = Stripe(publishableKey);
      console.log('✅ Stripe initialized for checkout');
    } catch (error) {
      console.error('❌ Error initializing Stripe:', error);
    }
  }

  private async loadWalletBalance() {
    try {
      console.log('💰 [CHECKOUT] Starting wallet balance load...');
      
      // Force a fresh balance fetch from the API first
      const balanceResponse = await firstValueFrom(this.walletService.getBalance()) as any;
      console.log('💰 [CHECKOUT] Balance response received:', balanceResponse);
      
      if (balanceResponse && balanceResponse.success) {
        // The API returns: {success, balance, availableBalance, reservedBalance, currency}
        // We need to construct a WalletBalance object from this
        this.walletBalance = {
          balance: balanceResponse.balance || 0,
          availableBalance: balanceResponse.availableBalance || 0,
          reservedBalance: balanceResponse.reservedBalance || 0,
          currency: balanceResponse.currency || 'USD'
        };
        
        console.log(`💰 [CHECKOUT] Wallet balance set:`, this.walletBalance);
        console.log(`💰 [CHECKOUT] Available: $${this.walletBalance?.availableBalance || 0}, Total: $${this.total}`);
        
        // Auto-select payment method based on balance
        if (this.walletBalance && this.walletBalance.availableBalance >= this.total) {
          this.selectedPaymentMethod = 'wallet';
          console.log(`✅ [CHECKOUT] Auto-selected WALLET`);
        } else if (this.defaultCard) {
          this.selectedPaymentMethod = 'saved-card';
          this.selectedSavedCard = this.defaultCard.stripePaymentMethodId;
          console.log(`💳 [CHECKOUT] Auto-selected DEFAULT CARD (insufficient wallet funds)`);
        }
      } else {
        console.warn('⚠️ [CHECKOUT] No wallet balance in response');
        // Auto-select default card if available
        if (this.defaultCard) {
          this.selectedPaymentMethod = 'saved-card';
          this.selectedSavedCard = this.defaultCard.stripePaymentMethodId;
        }
      }
      
      // Also subscribe to future updates
      this.walletService.balance$
        .pipe(takeUntil(this.destroy$))
        .subscribe(balance => {
          if (balance) {
            this.walletBalance = balance;
            console.log(`💰 [CHECKOUT] Wallet balance updated from subscription: $${balance.availableBalance}`);
          }
        });
    } catch (error) {
      console.error('❌ [CHECKOUT] Error loading wallet balance:', error);
      // Auto-select default card if available
      if (this.defaultCard) {
        this.selectedPaymentMethod = 'saved-card';
        this.selectedSavedCard = this.defaultCard.stripePaymentMethodId;
      }
    }
  }

  selectPaymentMethod(method: 'wallet' | 'saved-card' | 'apple' | 'google', savedCardId?: string) {
    this.selectedPaymentMethod = method;
    this.selectedSavedCard = savedCardId || null;
    console.log(`💳 Payment method selected: ${method}`, savedCardId ? `(card: ${savedCardId})` : '');
  }
  
  onSavedCardChange() {
    if (this.selectedSavedCard) {
      this.selectPaymentMethod('saved-card', this.selectedSavedCard);
    }
  }
  
  private async loadSavedCards() {
    try {
      const response = await firstValueFrom(
        this.http.get<any>(
          `${environment.apiUrl}/payments/payment-methods`,
          { headers: this.userService.getAuthHeadersSync() }
        )
      );
      
      if (response.success) {
        // Deduplicate cards by payment method ID (in case of duplicates in DB)
        const uniqueCards = new Map();
        (response.paymentMethods || []).forEach((card: any) => {
          if (!uniqueCards.has(card.stripePaymentMethodId)) {
            uniqueCards.set(card.stripePaymentMethodId, card);
          }
        });
        
        this.savedCards = Array.from(uniqueCards.values());
        console.log(`💳 Loaded ${this.savedCards.length} unique saved cards (${response.paymentMethods?.length || 0} total in DB)`);
        
        // Set default card
        this.defaultCard = this.savedCards.find(card => card.isDefault) || null;
        
        // Auto-select default saved card if available and wallet has insufficient funds
        if (this.defaultCard && !this.canUseWallet) {
          this.selectedPaymentMethod = 'saved-card';
          this.selectedSavedCard = this.defaultCard.stripePaymentMethodId;
          console.log(`✅ Auto-selected default saved card ending in ${this.defaultCard.last4}`);
        }
      }
    } catch (error) {
      console.error('❌ Error loading saved cards:', error);
      // Not a critical error, continue without saved cards
    }
  }

  get canUseWallet(): boolean {
    return !!(this.walletBalance && this.walletBalance.availableBalance >= this.total);
  }

  get hasValidPaymentMethod(): boolean {
    if (this.selectedPaymentMethod === 'wallet' && this.canUseWallet) {
      return true;
    }
    if (this.selectedPaymentMethod === 'saved-card' && this.defaultCard) {
      return true;
    }
    if (this.selectedPaymentMethod === 'apple' && this.isApplePayAvailable) {
      return true;
    }
    if (this.selectedPaymentMethod === 'google' && this.isGooglePayAvailable) {
      return true;
    }
    return false;
  }

  // Computed properties to avoid function calls in HTML
  get formattedAvailableBalance(): string {
    return (this.walletBalance?.availableBalance || 0).toFixed(2);
  }

  async openCardManagementModal() {
    const modal = await this.modalController.create({
      component: CardManagementModalComponent,
      cssClass: 'card-management-modal',
      breakpoints: [0, 0.5, 0.75, 0.95],
      initialBreakpoint: 0.75
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    
    // If a card was selected, update payment method
    if (data && data.selectedCard) {
      this.defaultCard = data.selectedCard;
      this.selectedPaymentMethod = 'saved-card';
      this.selectedSavedCard = data.selectedCard.stripePaymentMethodId;
      console.log('✅ Card selected from modal:', data.selectedCard);
    }
    
    // Reload saved cards to get latest
    await this.loadSavedCards();
  }

  private async loadData() {
    try {
      // Load tutor data
      if (this.tutorId) {
        const tutorRes = await firstValueFrom(this.userService.getTutorPublic(this.tutorId));
        this.tutor = tutorRes?.tutor || null;
        
        // Update tutor display name
        if (this.tutor) {
          this.tutorDisplayName = this.formatTutorDisplayName(this.tutor.name || this.tutor.firstName || '');
        }
      }

      // Load current user data
      const userRes = await firstValueFrom(this.userService.getCurrentUser());
      this.currentUser = userRes;
      
      console.log('✅ Checkout data loaded:', { tutor: this.tutor, tutorDisplayName: this.tutorDisplayName, currentUser: this.currentUser });
    } catch (error) {
      console.error('Error loading checkout data:', error);
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

    // Validate payment method selection
    if (this.selectedPaymentMethod === 'wallet' && !this.canUseWallet) {
      const toast = await this.toastController.create({
        message: 'Insufficient wallet balance. Please select a different payment method or top up your wallet.',
        duration: 4000,
        color: 'warning',
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
        message: 'Validating lesson time...',
        spinner: 'crescent'
      });
      await loading.present();

      // Calculate start and end times
      const startTime = this.parseStartDate();
      if (!startTime) {
        throw new Error('Invalid lesson time');
      }
      
      const endTime = new Date(startTime.getTime() + this.lessonMinutes * 60000);
      const now = new Date();

      // Debug logging
      console.log('🕐 Booking validation:');
      console.log('  Start time:', startTime.toLocaleString());
      console.log('  Current time:', now.toLocaleString());
      console.log('  Start time ISO:', startTime.toISOString());
      console.log('  Current time ISO:', now.toISOString());
      console.log('  Time difference (minutes):', (startTime.getTime() - now.getTime()) / 60000);

      // CRITICAL CHECK 1: Verify lesson hasn't already started or passed
      if (startTime <= now) {
        if (loading) await loading.dismiss();
        this.isBooking = false;
        
        const alert = await this.alertController.create({
          header: 'Lesson Time Has Passed',
          message: `This lesson time has already started or passed. Current time: ${now.toLocaleTimeString()}, Lesson time: ${startTime.toLocaleTimeString()}. Please select a different time slot.`,
          buttons: [
            {
              text: 'OK',
              handler: () => {
                // Navigate back to tutor page to select new time
                if (this.tutorId) {
                  this.router.navigate(['/tutor', this.tutorId], {
                    queryParams: { refreshAvailability: 'true' }
                  });
                }
              }
            }
          ]
        });
        await alert.present();
        return;
      }

      // CRITICAL CHECK 2: Verify lesson starts at least 5 minutes in the future
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60000);
      if (startTime < fiveMinutesFromNow) {
        if (loading) await loading.dismiss();
        this.isBooking = false;
        
        const alert = await this.alertController.create({
          header: 'Lesson Time Too Soon',
          message: 'Lessons must be booked at least 5 minutes in advance. Please select a later time slot.',
          buttons: ['OK']
        });
        await alert.present();
        return;
      }

      // Update loading message
      loading.message = 'Checking availability...';

      // CRITICAL CHECK 3: Verify tutor availability hasn't changed
      try {
        const tutorResponse = await firstValueFrom(this.userService.getTutorPublic(this.tutorId));
        const freshTutor = tutorResponse?.tutor as any; // Cast to any to access dynamic properties
        
        if (!freshTutor) {
          throw new Error('Tutor not found');
        }

        // Debug logging for tutor status
        console.log('👨‍🏫 Tutor validation:');
        console.log('  tutorApproved:', freshTutor.tutorApproved);
        console.log('  stripeConnectOnboarded:', freshTutor.stripeConnectOnboarded);

        // Check if tutor is still accepting bookings
        // Only validate if these fields are present (they might not be in public endpoint)
        const tutorApproved = freshTutor.tutorApproved ?? this.tutor?.tutorApproved ?? true;
        const stripeOnboarded = freshTutor.stripeConnectOnboarded ?? this.tutor?.stripeConnectOnboarded ?? true;
        
        console.log('  Using tutorApproved:', tutorApproved);
        console.log('  Using stripeOnboarded:', stripeOnboarded);

        if (tutorApproved === false || stripeOnboarded === false) {
          console.error('❌ Tutor not accepting bookings:', {
            tutorApproved,
            stripeOnboarded
          });
          throw new Error('TUTOR_NOT_ACCEPTING_BOOKINGS');
        }

        // Verify the specific time slot is still available
        const dayOfWeek = startTime.toLocaleDateString('en-US', { weekday: 'long' });
        const timeSlot = this.time; // e.g., "09:30"
        
        console.log('📅 Checking availability for:', { dayOfWeek, timeSlot });
        
        const availability = freshTutor.onboardingData?.availability || freshTutor.availability;
        console.log('  Availability data:', availability);
        
        if (availability && availability[dayOfWeek]) {
          const isStillAvailable = availability[dayOfWeek].some((slot: any) => {
            return slot.startTime === timeSlot && slot.available === true;
          });

          console.log('  Slot still available:', isStillAvailable);

          if (!isStillAvailable) {
            throw new Error('TIME_SLOT_NO_LONGER_AVAILABLE');
          }
        } else {
          console.log('  ⚠️ No availability data found for', dayOfWeek, '- assuming available');
        }
      } catch (error: any) {
        if (loading) await loading.dismiss();
        this.isBooking = false;

        if (error.message === 'TUTOR_NOT_ACCEPTING_BOOKINGS') {
          const alert = await this.alertController.create({
            header: 'Tutor Not Available',
            message: 'This tutor is not currently accepting bookings. Please choose another tutor.',
            buttons: ['OK']
          });
          await alert.present();
          return;
        }

        if (error.message === 'TIME_SLOT_NO_LONGER_AVAILABLE') {
          const alert = await this.alertController.create({
            header: 'Time Slot No Longer Available',
            message: 'This time slot has been booked by another student or is no longer available. Please select a different time.',
            buttons: [
              {
                text: 'View Updated Schedule',
                handler: () => {
                  this.router.navigate(['/tutor', this.tutorId], {
                    queryParams: { refreshAvailability: 'true' }
                  });
                }
              }
            ]
          });
          await alert.present();
          return;
        }

        // For other errors, continue but log them
        console.warn('Could not verify tutor availability:', error);
      }

      // CHECK 4: Check for scheduling conflicts with existing lessons/classes
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
        message: this.selectedPaymentMethod === 'wallet' ? 'Processing payment...' : 'Processing card payment...',
        spinner: 'crescent'
      });
      await bookingLoading.present();

      // STEP 1: PROCESS PAYMENT
      let paymentMethodId: string | null = null;
      let paymentIntentId: string | null = null;

      if (this.selectedPaymentMethod === 'saved-card') {
        // Use saved card - book lesson directly with saved payment method
        if (!this.selectedSavedCard && !this.defaultCard) {
          throw new Error('No saved card selected');
        }
        
        const cardToUse = this.selectedSavedCard || this.defaultCard?.stripePaymentMethodId;
        
        // Try to get customer ID from multiple sources
        let customerId = this.currentUser?.stripeCustomerId;
        
        console.log(`💳 Using saved card for lesson payment: ${cardToUse}`);
        console.log(`👤 Customer ID:`, customerId);
        console.log(`👤 Current user:`, this.currentUser);
        
        // If no customer ID found, try to fetch user data again
        if (!customerId) {
          console.log('⚠️ No customer ID found, fetching fresh user data...');
          try {
            const freshUser = await firstValueFrom(this.userService.getCurrentUser(true));
            customerId = (freshUser as any)?.stripeCustomerId;
            console.log(`👤 Fresh user data:`, freshUser);
            console.log(`👤 Fresh customer ID:`, customerId);
            
            // Update current user reference
            if (customerId) {
              this.currentUser = freshUser;
            }
          } catch (error) {
            console.error('Failed to fetch fresh user data:', error);
          }
        }
        
        // If still no customer ID, this is a data issue - we need to re-sync with Stripe
        if (!customerId) {
          const alert = await this.alertController.create({
            header: 'Card Issue',
            message: 'There was an issue with your saved card. Please remove it and add it again, or use a different payment method.',
            buttons: [
              {
                text: 'Manage Cards',
                handler: () => {
                  this.openCardManagementModal();
                }
              },
              {
                text: 'Cancel',
                role: 'cancel'
              }
            ]
          });
          await alert.present();
          throw new Error('Customer ID not found. Please try re-adding your card.');
        }
        
        // Book the lesson directly with saved card payment
        paymentMethodId = cardToUse;
        
        // STEP 2 will create the lesson with this payment method
        console.log('✅ Will book lesson with saved card:', cardToUse);
        
      } else if (this.selectedPaymentMethod === 'wallet') {
        // Wallet payment - just verify balance again
        console.log('💰 Using wallet payment...');
        if (!this.canUseWallet) {
          throw new Error('Insufficient wallet balance');
        }
      } else {
        throw new Error('Invalid payment method selected');
      }

      // STEP 2: BOOK LESSON WITH PAYMENT
      bookingLoading.message = 'Booking your lesson...';

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

      console.log('📅 Creating lesson booking with payment:', {
        ...lessonData,
        paymentMethod: this.selectedPaymentMethod,
        paymentIntentId
      });

      // Call the new payment booking endpoint
      const bookingPayload: any = {
        lessonData,
        paymentMethod: this.selectedPaymentMethod,
        stripePaymentIntentId: paymentIntentId,
        // Payment split info
        totalAmount: this.total,
        walletAmount: this.walletAmountToUse,
        paymentMethodAmount: this.remainingAmountToPay,
        isHybridPayment: this.isHybridPayment
      };
      
      // If using saved card, include the payment method ID
      if (this.selectedPaymentMethod === 'saved-card' && paymentMethodId) {
        bookingPayload.stripePaymentMethodId = paymentMethodId;
        bookingPayload.stripeCustomerId = this.currentUser?.stripeCustomerId;
      }
      
      console.log('📤 Sending booking payload:', bookingPayload);

      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/payments/book-lesson-with-payment`,
          bookingPayload,
          { headers: this.userService.getAuthHeadersSync() }
        )
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
                price: lessonData.price,
                paymentMethod: this.selectedPaymentMethod,
                walletAmount: this.walletAmountToUse,
                paymentMethodAmount: this.remainingAmountToPay
              }
            }
          });
        }
      } else {
        throw new Error(response.message || 'Failed to book lesson');
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
      
      // Check if tutor is not onboarded (403 Forbidden)
      if (error instanceof HttpErrorResponse && error.status === 403 && errorCode === 'TUTOR_NOT_ONBOARDED') {
        this.isBooking = false;
        
        const alert = await this.alertController.create({
          header: 'Tutor Not Available',
          message: 'This tutor has not yet completed payment setup and cannot accept bookings. Please choose another tutor.',
          buttons: ['OK']
        });
        
        await alert.present();
        
        // Navigate back to explore page
        setTimeout(() => {
          this.router.navigate(['/tabs/explore']);
        }, 500);
        return;
      }
      
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
    return this._cachedDateMonthShort.toUpperCase();
  }

  get dateDayNumber(): string {
    return this._cachedDateDayNumber;
  }

  // Compute all date/time values once to avoid repeated calculations
  private computeDateTimeValues() {
    // Parse start date once
    if (this.dateIso && this.time) {
      const datePart = this.dateIso.split('T')[0]; // "2026-01-02"
      const localDateTimeString = `${datePart}T${this.time}:00`; // "2026-01-02T13:00:00"
      this._cachedStartDate = new Date(localDateTimeString);
      
      // Compute time range
      const end = new Date(this._cachedStartDate.getTime() + this.lessonMinutes * 60000);
      this._cachedTimeRange = `${this.format12h(this._cachedStartDate)} – ${this.format12h(end)}`;
      
      // Compute date parts
      this._cachedDateWeekday = this._cachedStartDate.toLocaleDateString(undefined, { weekday: 'long' });
      this._cachedDateMonthShort = this._cachedStartDate.toLocaleDateString(undefined, { month: 'short' });
      this._cachedDateDayNumber = this._cachedStartDate.getDate().toString();
      
      console.log('🕐 Date/time computed once:', {
        dateIso: this.dateIso,
        time: this.time,
        startDate: this._cachedStartDate.toLocaleString(),
        timeRange: this._cachedTimeRange
      });
    } else {
      this._cachedStartDate = null;
      this._cachedTimeRange = '';
      this._cachedDateWeekday = '';
      this._cachedDateMonthShort = '';
      this._cachedDateDayNumber = '';
    }
  }

  get dateWeekday(): string {
    return this._cachedDateWeekday;
  }

  get pricePerLesson(): number {
    const rate = this.tutor?.hourlyRate ?? this.tutor?.onboardingData?.hourlyRate ?? 20;
    // Rate is for standard 50-minute lesson, not hourly (60 min)
    const STANDARD_LESSON_DURATION = 50;
    return Math.round((rate * (this.lessonMinutes / STANDARD_LESSON_DURATION)) * 100) / 100;
  }

  get processingFee(): number { return 0; }
  get discount(): number { return 0; }
  get total(): number { 
    return Math.max(this.pricePerLesson + this.processingFee - this.discount, 0);
  }

  // Payment breakdown: wallet + payment method
  get walletAmountToUse(): number {
    if (!this.walletBalance) return 0;
    const available = this.walletBalance.availableBalance || 0;
    // Use wallet balance up to the total amount
    return Math.min(available, this.total);
  }

  get remainingAmountToPay(): number {
    return Math.max(this.total - this.walletAmountToUse, 0);
  }

  get isHybridPayment(): boolean {
    // Hybrid payment when we have some wallet balance but not enough for full amount
    return this.walletAmountToUse > 0 && this.remainingAmountToPay > 0;
  }

  get canPayWithWalletOnly(): boolean {
    return this.walletAmountToUse >= this.total;
  }

  private parseStartDate(): Date | null {
    // Return cached value instead of recalculating
    return this._cachedStartDate;
  }

  private format12h(d: Date): string {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  get timeRange(): string {
    return this._cachedTimeRange;
  }

  // Helper: Format tutor display name (First name + Last initial)
  private formatTutorDisplayName(name: string): string {
    // Prefer firstName + lastName if available
    if (this.tutor?.firstName && this.tutor?.lastName) {
      return `${this.tutor.firstName} ${this.tutor.lastName.charAt(0).toUpperCase()}.`;
    }
    
    if (!name) return 'Tutor';
    
    // If it's an email, extract first part
    if (name.includes('@')) {
      const emailPart = name.split('@')[0];
      const nameParts = emailPart.split(/[._]/);
      if (nameParts.length > 1) {
        return `${nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1)} ${nameParts[1].charAt(0).toUpperCase()}.`;
      }
      return emailPart.charAt(0).toUpperCase() + emailPart.slice(1);
    }
    
    // Regular name format
    const parts = name.split(' ');
    if (parts.length > 1) {
      return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
    }
    return name;
  }

  // DEPRECATED: Use tutorDisplayName property instead
  getTutorDisplayName(): string {
    return this.tutorDisplayName;
  }

  // Check Apple Pay availability
  checkApplePayAvailability() {
    // Temporarily enable for testing (remove this in production)
    this.isApplePayAvailable = true;
    
    /* Production code:
    if (window && (window as any).ApplePaySession) {
      this.isApplePayAvailable = (window as any).ApplePaySession.canMakePayments();
    } else {
      this.isApplePayAvailable = false;
    }
    */
    
    console.log('🍎 Apple Pay available:', this.isApplePayAvailable);
  }

  // Check Google Pay availability
  checkGooglePayAvailability() {
    // Temporarily enable for testing (remove this in production)
    this.isGooglePayAvailable = true;
    
    /* Production code:
    const isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
    const isAndroid = /Android/.test(navigator.userAgent);
    this.isGooglePayAvailable = isChrome || isAndroid;
    */
    
    console.log('💳 Google Pay available:', this.isGooglePayAvailable);
  }
}
