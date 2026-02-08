import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LoadingController, AlertController, ToastController, ModalController } from '@ionic/angular';
import { LessonAnalysis } from '../services/transcription.service';
import { UserService } from '../services/user.service';
import { LessonService } from '../services/lesson.service';
import { firstValueFrom } from 'rxjs';
import { CardManagementModalComponent } from '../components/card-management-modal/card-management-modal.component';

interface LessonInfo {
  _id: string;
  subject: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  actualDurationMinutes?: number;
  price?: number; // Changed from lessonCost
  tutor: {
    _id: string;
    name: string;
    picture?: string;
    firstName?: string;
  };
  student: {
    _id: string;
    name: string;
    picture?: string;
  };
}

@Component({
  selector: 'app-post-lesson-student',
  templateUrl: './post-lesson-student.page.html',
  styleUrls: ['./post-lesson-student.page.scss'],
  standalone: false
})
export class PostLessonStudentPage implements OnInit, OnDestroy {
  lessonId: string = '';
  lesson: LessonInfo | null = null;
  tutor: any = null;
  analysis: LessonAnalysis | null = null;
  analysisReady = false;
  
  // Trial lesson properties
  isTrialLesson = false;
  tutorFirstName = '';
  tutorDisplayName = 'Tutor';
  
  // AI analysis
  aiAnalysisEnabled = true;
  
  // Tip functionality
  showTipSection = false;
  selectedTipAmount: number | null = null;
  selectedTipPercentage: number | null = null;
  customTipAmount: number | null = null;
  tipSubmitted = false;
  submittingTip = false;
  tipAmount: number = 0;

  // Payment method selection for tips
  savedCards: any[] = [];
  selectedPaymentMethodId: string | null = null;
  loadingCards = false;
  hasLoadedCards = false;
  showCardPicker = false;

  // Wallet payment option for tips
  walletBalance: number = 0;
  selectedTipPaymentMethod: 'wallet' | 'card' = 'card'; // default to card

  // Card fee calculation — matches wallet-topup-modal logic
  // International cards: 4.4% + $0.30 | Domestic (US) cards: 2.9% + $0.30
  get isInternationalCard(): boolean {
    const card = this.savedCards.find(c => c.stripePaymentMethodId === this.selectedPaymentMethodId);
    return card?.country ? card.country !== 'US' : false;
  }

  get cardFeeRate(): number {
    return this.isInternationalCard ? 0.044 : 0.029;
  }

  get cardFeeLabel(): string {
    return this.isInternationalCard ? '4.4% + $0.30 (international card)' : '2.9% + $0.30';
  }

  get cardProcessingFee(): number {
    if (!this.tipAmount || this.tipAmount <= 0) return 0;
    const amountCents = Math.round(this.tipAmount * 100);
    const feeCents = Math.round(amountCents * this.cardFeeRate + 30);
    return feeCents / 100;
  }

  get tutorReceivesAfterFee(): number {
    return Math.max(0, this.tipAmount - this.cardProcessingFee);
  }
  
  // Polling
  private pollingInterval: any = null;
  pollCount = 0;
  maxPollAttempts = 60;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private userService: UserService,
    private lessonService: LessonService,
    private loadingCtrl: LoadingController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private modalCtrl: ModalController
  ) {}

  async ngOnInit() {
    this.lessonId = this.route.snapshot.paramMap.get('id') || '';
    console.log('🎓 POST-LESSON-STUDENT: Initializing with lessonId:', this.lessonId);
    
    // Wait for user to be loaded first
    await this.ensureUserLoaded();
    
    if (this.lessonId) {
      await this.loadLessonInfo();
      
      // Only poll for analysis if AI is enabled
      if (this.aiAnalysisEnabled && !this.isTrialLesson) {
        this.startAnalysisPolling();
      } else {
        console.log('⏭️ POST-LESSON-STUDENT: Skipping analysis polling (AI disabled or trial lesson)');
      }
    } else {
      console.error('❌ POST-LESSON-STUDENT: No lesson ID provided!');
    }
  }

  private async ensureUserLoaded(): Promise<void> {
    try {
      const user = await firstValueFrom(this.userService.getCurrentUser());
      console.log('✅ POST-LESSON-STUDENT: User loaded:', user);
      console.log('✅ POST-LESSON-STUDENT: Current user email:', user?.email);
    } catch (error) {
      console.error('❌ POST-LESSON-STUDENT: Error loading user:', error);
    }
  }

  ngOnDestroy() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }

  async loadLessonInfo() {
    console.log('📚 POST-LESSON-STUDENT: Loading lesson info for:', this.lessonId);
    try {
      const response: any = await firstValueFrom(
        this.lessonService.getLesson(this.lessonId)
      );
      
      console.log('📚 POST-LESSON-STUDENT: Raw response:', response);
      
      if (response?.lesson) {
        this.lesson = response.lesson;
        // Backend returns tutorId and studentId, not tutor and student
        this.tutor = response.lesson.tutorId || response.lesson.tutor;
        console.log('✅ POST-LESSON-STUDENT: Lesson info loaded:', this.lesson);
        console.log('✅ POST-LESSON-STUDENT: Tutor info:', this.tutor);
        
        // Set trial lesson flag and tutor name properties
        this.isTrialLesson = response.lesson.isTrial || response.lesson.isTrialLesson || false;
        this.updateTutorProperties();
        
        // Check if tip was already sent for this lesson
        if (response.lesson.tip && response.lesson.tip.amount) {
          this.tipSubmitted = true;
          console.log('💰 POST-LESSON-STUDENT: Tip already sent for this lesson:', response.lesson.tip.amount);
        }
        
        // Use the lesson snapshot of AI setting; fall back to live profile for legacy lessons
        const lesson = response.lesson;
        if (lesson.aiAnalysisEnabledAtTime !== null && lesson.aiAnalysisEnabledAtTime !== undefined) {
          this.aiAnalysisEnabled = lesson.aiAnalysisEnabledAtTime !== false;
          console.log('🤖 POST-LESSON-STUDENT: AI analysis (snapshot):', this.aiAnalysisEnabled);
        } else {
          const student = lesson.studentId;
          if (student && typeof student === 'object' && student.profile && student.profile.aiAnalysisEnabled === false) {
            this.aiAnalysisEnabled = false;
          } else {
            this.aiAnalysisEnabled = true;
          }
          console.log('🤖 POST-LESSON-STUDENT: AI analysis (live fallback):', this.aiAnalysisEnabled);
        }
      } else {
        console.warn('⚠️ POST-LESSON-STUDENT: Response missing lesson data');
      }
    } catch (error) {
      console.error('❌ POST-LESSON-STUDENT: Error loading lesson info:', error);
    }
  }

  private updateTutorProperties() {
    if (!this.tutor) {
      this.tutorFirstName = '';
      this.tutorDisplayName = 'Tutor';
      return;
    }
    
    this.tutorFirstName = this.tutor.firstName || this.tutor.name?.split(' ')[0] || '';
    
    const firstName = this.tutor.firstName || this.tutor.name?.split(' ')[0];
    const lastName = this.tutor.lastName || this.tutor.name?.split(' ')[1];
    
    if (firstName && lastName) {
      this.tutorDisplayName = `${firstName} ${lastName.charAt(0)}.`;
    } else {
      this.tutorDisplayName = this.tutor.name || 'Tutor';
    }
  }

  startAnalysisPolling() {
    // Initial load
    this.checkAnalysis();
    
    // Poll every 3 seconds
    this.pollingInterval = setInterval(() => {
      this.pollCount++;
      if (this.pollCount >= this.maxPollAttempts) {
        clearInterval(this.pollingInterval);
        console.log('⏰ Max poll attempts reached');
        return;
      }
      this.checkAnalysis();
    }, 3000);
  }

  async checkAnalysis() {
    try {
      const headers = this.userService.getAuthHeadersSync();
      console.log('🔑 POST-LESSON-STUDENT: Auth headers for analysis check:', headers);
      
      const response: any = await firstValueFrom(
        this.http.get(`${environment.apiUrl}/transcription/lesson/${this.lessonId}/analysis`, { headers })
      );
      
      if (response?.analysis?.status === 'completed') {
        this.analysis = response.analysis;
        this.analysisReady = true;
        
        // Stop polling
        if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
        }
        
        console.log('✅ Analysis ready:', this.analysis);
      }
    } catch (error: any) {
      // Analysis not ready yet - continue polling
      if (error.status !== 404) {
        console.error('Error checking analysis:', error);
      }
    }
  }

  toggleTipSection() {
    this.showTipSection = !this.showTipSection;
    // Load cards on first open
    if (this.showTipSection && !this.hasLoadedCards) {
      this.loadSavedCards();
    }
  }

  async loadSavedCards() {
    this.loadingCards = true;
    try {
      const headers = this.userService.getAuthHeadersSync();

      // Load cards and wallet balance in parallel
      const [cardsResponse, walletResponse]: any[] = await Promise.all([
        firstValueFrom(this.http.get(`${environment.apiUrl}/payments/payment-methods`, { headers })),
        firstValueFrom(this.http.get(`${environment.apiUrl}/wallet/balance`, { headers })).catch(() => null)
      ]);

      if (cardsResponse.success && cardsResponse.paymentMethods) {
        this.savedCards = cardsResponse.paymentMethods.filter((pm: any) => pm.type === 'card');
        // Auto-select default card
        const defaultCard = this.savedCards.find((c: any) => c.isDefault);
        if (defaultCard) {
          this.selectedPaymentMethodId = defaultCard.stripePaymentMethodId;
        } else if (this.savedCards.length > 0) {
          this.selectedPaymentMethodId = this.savedCards[0].stripePaymentMethodId;
        }
      }

      // Load wallet balance
      if (walletResponse?.success) {
        this.walletBalance = walletResponse.availableBalance || 0;
      }

      // Auto-select wallet if it has a balance, otherwise default to card
      if (this.walletBalance > 0) {
        this.selectedTipPaymentMethod = 'wallet';
      } else {
        this.selectedTipPaymentMethod = 'card';
      }

      this.hasLoadedCards = true;
    } catch (error) {
      console.error('Error loading saved cards:', error);
    } finally {
      this.loadingCards = false;
    }
  }

  selectPaymentMethod(card: any) {
    this.selectedPaymentMethodId = card.stripePaymentMethodId;
  }

  selectTipAmount(amount: number) {
    this.selectedTipAmount = amount;
    this.selectedTipPercentage = null;
    this.customTipAmount = null;
    this.updateTipAmount();
  }

  selectTipPercentage(percentage: number) {
    this.selectedTipPercentage = percentage;
    this.selectedTipAmount = null;
    this.customTipAmount = null;
    this.updateTipAmount();
  }

  onCustomTipInput() {
    this.selectedTipAmount = null;
    this.selectedTipPercentage = null;
    this.updateTipAmount();
  }

  private updateTipAmount() {
    this.tipAmount = this.getTipAmount();
  }

  calculatePercentageTip(percentage: number): number {
    if (!this.lesson?.price) return 0;
    // Don't round - show exact percentage amount with cents
    return Math.round((this.lesson.price * percentage / 100) * 100) / 100;
  }

  getTipAmount(): number {
    if (this.customTipAmount && this.customTipAmount > 0) {
      return this.customTipAmount;
    }
    if (this.selectedTipAmount) {
      return this.selectedTipAmount;
    }
    if (this.selectedTipPercentage) {
      return this.calculatePercentageTip(this.selectedTipPercentage);
    }
    return 0;
  }

  async submitTip() {
    const tipAmount = this.getTipAmount();
    if (tipAmount <= 0 || this.submittingTip) return;

    // Confirmation popup
    const confirm = await this.alertCtrl.create({
      header: 'Confirm tip',
      message: `Send a $${tipAmount.toFixed(2)} tip to ${this.tutorFirstName}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Send tip', role: 'confirm' }
      ]
    });
    await confirm.present();
    const { role } = await confirm.onDidDismiss();
    if (role !== 'confirm') return;

    this.submittingTip = true;

    try {
      const headers = this.userService.getAuthHeadersSync();
      const body: any = { amount: tipAmount };

      if (this.selectedTipPaymentMethod === 'wallet') {
        body.useWallet = true;
      } else if (this.selectedPaymentMethodId) {
        body.paymentMethodId = this.selectedPaymentMethodId;
      }
      const response: any = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/lessons/${this.lessonId}/tip`, body, { headers })
      );

      if (response.success) {
        this.tipSubmitted = true;
        this.showTipSection = false;
        
        const toast = await this.toastCtrl.create({
          message: `$${tipAmount.toFixed(2)} tip sent to ${this.tutorFirstName}!`,
          duration: 3000,
          color: 'success',
          position: 'top'
        });
        await toast.present();
      }
    } catch (error: any) {
      console.error('Error submitting tip:', error);
      
      const errorMessage = error.error?.error || 'Failed to send tip. Please try again.';
      const isNoPaymentMethod = errorMessage.toLowerCase().includes('payment method') 
        || errorMessage.toLowerCase().includes('no card');
      
      if (isNoPaymentMethod) {
        // Offer to add a card right here
        const alert = await this.alertCtrl.create({
          header: 'No payment method',
          message: 'You need a card on file to send a tip. Would you like to add one now?',
          buttons: [
            { text: 'Not now', role: 'cancel' },
            { 
              text: 'Add card', 
              handler: () => { this.openCardManagement(); }
            }
          ]
        });
        await alert.present();
      } else {
        const alert = await this.alertCtrl.create({
          header: 'Tip failed',
          message: errorMessage,
          buttons: ['OK']
        });
        await alert.present();
      }
    } finally {
      this.submittingTip = false;
    }
  }

  async leaveReview() {
    // Navigate to tutor profile with review section
    if (this.tutor) {
      await this.router.navigate(['/tabs/profile'], {
        queryParams: { userId: this.tutor._id, action: 'review' }
      });
    }
  }

  async bookAgain() {
    // Navigate to tutor profile to book
    if (this.tutor) {
      await this.router.navigate(['/tutor', this.tutor._id]);
    }
  }

  async goHome() {
    await this.router.navigate(['/tabs/home']);
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  async openCardManagement() {
    const modal = await this.modalCtrl.create({
      component: CardManagementModalComponent,
      cssClass: 'card-management-modal'
    });
    
    await modal.present();
    
    const { data } = await modal.onDidDismiss();
    // Always reload cards to stay in sync
    await this.loadSavedCards();

    // Only show toast if cards were actually added or deleted
    if (data?.cardsUpdated) {
      const toast = await this.toastCtrl.create({
        message: 'Card saved! You can now send your tip.',
        duration: 3000,
        color: 'success',
        position: 'top'
      });
      await toast.present();
    }
  }

  viewFullAnalysis() {
    this.router.navigate(['/lesson-analysis', this.lessonId]);
  }
}

