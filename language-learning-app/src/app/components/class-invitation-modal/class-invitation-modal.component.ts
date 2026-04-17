import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { ClassService, ClassInvitation } from '../../services/class.service';
import { UserService } from '../../services/user.service';
import { formatTimeInTz, formatDateInTz } from '../../shared/timezone.utils';
import { environment } from '../../../environments/environment';

declare var Stripe: any;

interface SavedCard {
  id?: string;
  stripePaymentMethodId: string;
  brand: string;
  last4: string;
  expiryMonth: number;
  expiryYear: number;
  isDefault: boolean;
}

@Component({
  selector: 'app-class-invitation-modal',
  templateUrl: './class-invitation-modal.component.html',
  styleUrls: ['./class-invitation-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class ClassInvitationModalComponent implements OnInit, OnDestroy {
  @Input() classId!: string;
  @Input() notification?: any;
  
  classData: ClassInvitation | null = null;
  loading = true;
  processing = false;
  sanitizedDescription: SafeHtml = '';
  
  // Multi-step flow
  currentStep: 'details' | 'card-entry' = 'details';
  
  // Payment method selection
  savedCards: SavedCard[] = [];
  selectedCard: SavedCard | null = null;
  loadingPaymentMethods = false;
  selectedPaymentMethod: 'wallet' | 'saved-card' | 'new-card' | null = null;
  
  // Wallet
  walletBalance = 0;
  loadingWallet = false;
  
  // Stripe for new card entry
  stripe: any;
  cardElement: any;
  stripeElements: any;
  saveCardForFuture = true;
  validatingCard = false;

  constructor(
    private modalCtrl: ModalController,
    private classService: ClassService,
    private toastController: ToastController,
    private sanitizer: DomSanitizer,
    private http: HttpClient,
    private userService: UserService
  ) {}

  private get userTz(): string | undefined {
    return this.userService.getCurrentUserValue()?.profile?.timezone || undefined;
  }

  ngOnInit() {
    // Initialize Stripe
    if (typeof window !== 'undefined' && (window as any).Stripe) {
      this.stripe = Stripe(environment.stripePublishableKey);
    }
    
    if (this.notification?.data) {
      this.classData = {
        _id: this.notification.data.classId,
        tutorId: {
          _id: this.notification.data.tutorId,
          name: this.notification.data.tutorName,
          email: '',
          picture: this.notification.data.tutorPicture || ''
        },
        name: this.notification.data.className,
        description: this.notification.data.classDescription || '',
        capacity: this.notification.data.capacity || 1,
        price: this.notification.data.price || 0,
        startTime: this.notification.data.startTime,
        endTime: this.notification.data.endTime,
        invitedStudents: [],
        confirmedStudents: []
      } as ClassInvitation;
      this.updateSanitizedDescription();
      this.loading = false;
      if (this.classData.price > 0) {
        this.loadPaymentMethods();
      }
    } else if (this.classId) {
      this.loadClassDetails();
    } else {
      console.error('No classId or notification data provided');
      this.loading = false;
    }
  }

  ngOnDestroy() {
    this.cleanupStripeElements();
  }

  private cleanupStripeElements() {
    if (this.cardElement) {
      try {
        this.cardElement.unmount();
        this.cardElement.destroy();
      } catch (e) {
        console.warn('Error cleaning up card element:', e);
      }
      this.cardElement = null;
    }
    this.stripeElements = null;
  }

  loadClassDetails() {
    this.loading = true;
    this.classService.getClass(this.classId).subscribe({
      next: (response) => {
        if (response.success && response.class) {
          const c = response.class as any;
          this.classData = c as ClassInvitation;
          const hasPendingInvite = c.hasInvitation && c.invitationStatus === 'pending';
          if (!hasPendingInvite) {
            this.modalCtrl.dismiss({ expired: true, classId: this.classId });
          } else {
            this.updateSanitizedDescription();
            if (this.classData.price > 0) {
              this.loadPaymentMethods();
            }
          }
        } else {
          this.modalCtrl.dismiss({ expired: true, classId: this.classId });
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading class details:', error);
        this.loading = false;
      }
    });
  }

  private updateSanitizedDescription() {
    if (this.classData?.description) {
      this.sanitizedDescription = this.sanitizer.bypassSecurityTrustHtml(this.classData.description);
    } else {
      this.sanitizedDescription = '';
    }
  }

  get formattedDate(): string {
    if (!this.classData) return '';
    const date = new Date(this.classData.startTime);
    return formatDateInTz(date, this.userTz, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  get formattedTime(): string {
    if (!this.classData) return '';
    const date = new Date(this.classData.startTime);
    return formatTimeInTz(date, this.userTz);
  }

  get duration(): number {
    if (!this.classData) return 0;
    const start = new Date(this.classData.startTime);
    const end = new Date(this.classData.endTime);
    return Math.round((end.getTime() - start.getTime()) / 60000);
  }

  get spotsLeft(): number {
    if (!this.classData) return 0;
    return this.classData.capacity - this.classData.confirmedStudents.length;
  }

  get spotsText(): string {
    const spots = this.spotsLeft;
    if (spots === 0) return 'Class is full';
    if (spots === 1) return '1 spot left';
    return `${spots} spots left`;
  }

  get isClassExpired(): boolean {
    if (!this.classData) return false;
    const now = new Date();
    const classStartTime = new Date(this.classData.startTime);
    return classStartTime <= now;
  }

  get isClassCancelled(): boolean {
    if (!this.classData) return false;
    return (this.classData as any).status === 'cancelled';
  }

  get canAcceptInvitation(): boolean {
    if (!this.classData) return false;
    if (this.isClassExpired) return false;
    if (this.isClassCancelled) return false;
    if (this.spotsLeft === 0) return false;
    if (this.classData.price > 0 && !this.selectedPaymentMethod) return false;
    return true;
  }

  formatTutorName(tutor: any): string {
    if (!tutor) return 'Unknown';
    
    if (tutor.firstName && tutor.lastName) {
      return `${tutor.firstName} ${tutor.lastName.charAt(0).toUpperCase()}.`;
    }
    
    const name = tutor.name || tutor.email || '';
    if (!name) return 'Unknown';
    
    if (name.includes('@')) {
      const base = name.split('@')[0];
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
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }

  // Payment method methods
  async loadPaymentMethods() {
    if (!this.classData || this.classData.price <= 0) return;
    
    this.loadingPaymentMethods = true;
    this.loadingWallet = true;
    
    try {
      const headers = this.userService.getAuthHeadersSync();
      
      // Load saved cards
      const cardsResponse = await this.http.get<any>(
        `${environment.apiUrl}/payments/payment-methods`,
        { headers }
      ).toPromise();
      
      if (cardsResponse?.success && cardsResponse?.paymentMethods) {
        this.savedCards = cardsResponse.paymentMethods
          .filter((pm: any) => pm.type === 'card')
          .map((pm: any) => ({
            id: pm.id || pm.stripePaymentMethodId,
            stripePaymentMethodId: pm.stripePaymentMethodId,
            brand: pm.brand,
            last4: pm.last4,
            expiryMonth: pm.expiryMonth,
            expiryYear: pm.expiryYear,
            isDefault: pm.isDefault
          }));
        
        this.selectedCard = this.savedCards.find(c => c.isDefault) || this.savedCards[0] || null;
        if (this.selectedCard) {
          this.selectedPaymentMethod = 'saved-card';
        }
      }
      
      // Load wallet balance
      try {
        const walletResponse = await this.http.get<any>(
          `${environment.apiUrl}/wallet/balance`,
          { headers }
        ).toPromise();
        
        if (walletResponse?.success) {
          this.walletBalance = walletResponse.balance?.available || 0;
          if (this.canUseWallet && !this.selectedCard) {
            this.selectedPaymentMethod = 'wallet';
          }
        }
      } catch (walletError) {
        console.log('Wallet not available:', walletError);
        this.walletBalance = 0;
      }
      
      // If no cards and can't use wallet, default to new card
      if (this.savedCards.length === 0 && !this.canUseWallet) {
        this.selectedPaymentMethod = 'new-card';
      }
    } catch (error) {
      console.error('Error loading payment methods:', error);
    } finally {
      this.loadingPaymentMethods = false;
      this.loadingWallet = false;
    }
  }

  get canUseWallet(): boolean {
    if (!this.classData) return false;
    return this.walletBalance >= this.classData.price;
  }

  get formattedWalletBalance(): string {
    return this.walletBalance.toFixed(2);
  }

  selectPaymentMethod(method: 'wallet' | 'saved-card' | 'new-card', card?: SavedCard) {
    this.selectedPaymentMethod = method;
    if (method === 'saved-card' && card) {
      this.selectedCard = card;
    } else if (method !== 'saved-card') {
      this.selectedCard = null;
    }
  }

  selectCard(card: SavedCard) {
    this.selectedPaymentMethod = 'saved-card';
    this.selectedCard = card;
  }

  // Multi-step navigation
  goToCardEntry() {
    this.currentStep = 'card-entry';
    setTimeout(() => {
      this.mountCardElement();
    }, 300);
  }

  goBack() {
    if (this.currentStep === 'card-entry') {
      this.currentStep = 'details';
      this.cleanupStripeElements();
      // Reset to saved card if available, otherwise stay on new-card
      if (this.savedCards.length > 0) {
        this.selectedPaymentMethod = 'saved-card';
        this.selectedCard = this.savedCards.find(c => c.isDefault) || this.savedCards[0];
      }
    } else {
      this.close();
    }
  }

  mountCardElement() {
    const cardElementContainer = document.getElementById('card-element-class');
    
    if (!cardElementContainer || !this.stripe) {
      console.error('Card element container or Stripe not found');
      return;
    }

    this.cleanupStripeElements();

    this.stripeElements = this.stripe.elements();

    this.cardElement = this.stripeElements.create('card', {
      style: {
        base: {
          fontSize: '16px',
          color: '#1c1c1e',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          '::placeholder': {
            color: '#8e8e93'
          }
        },
        invalid: {
          color: '#ff3b30'
        }
      }
    });

    this.cardElement.mount('#card-element-class');
  }

  async acceptInvitation() {
    if (!this.classData) return;
    
    // Check if class has already started (frontend validation)
    const now = new Date();
    const classStartTime = new Date(this.classData.startTime);
    if (classStartTime <= now) {
      const toast = await this.toastController.create({
        message: 'This class has already started. You can no longer join.',
        duration: 4000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
      this.modalCtrl.dismiss({ expired: true });
      return;
    }
    
    // Check if class is cancelled (if status is available)
    if ((this.classData as any).status === 'cancelled') {
      const toast = await this.toastController.create({
        message: 'This class has been cancelled.',
        duration: 4000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
      this.modalCtrl.dismiss({ expired: true });
      return;
    }
    
    // For free classes, skip payment
    if (this.classData.price === 0) {
      this.processAcceptance();
      return;
    }
    
    // If new card selected and on details step, go to card entry
    if (this.selectedPaymentMethod === 'new-card' && this.currentStep === 'details') {
      this.goToCardEntry();
      return;
    }
    
    // If on card entry step, validate card first
    if (this.currentStep === 'card-entry') {
      await this.validateAndAccept();
      return;
    }
    
    // Validate payment method selection
    if (!this.selectedPaymentMethod) {
      const toast = await this.toastController.create({
        message: 'Please select a payment method',
        duration: 2500,
        color: 'warning',
        position: 'top'
      });
      await toast.present();
      return;
    }
    
    if (this.selectedPaymentMethod === 'wallet' && !this.canUseWallet) {
      const toast = await this.toastController.create({
        message: 'Insufficient wallet balance',
        duration: 2500,
        color: 'warning',
        position: 'top'
      });
      await toast.present();
      return;
    }
    
    if (this.selectedPaymentMethod === 'saved-card' && !this.selectedCard) {
      const toast = await this.toastController.create({
        message: 'Please select a card',
        duration: 2500,
        color: 'warning',
        position: 'top'
      });
      await toast.present();
      return;
    }
    
    this.processAcceptance();
  }

  async validateAndAccept() {
    if (!this.stripe || !this.cardElement) {
      return;
    }

    this.validatingCard = true;

    try {
      // Create PaymentMethod from card
      const { error, paymentMethod } = await this.stripe.createPaymentMethod({
        type: 'card',
        card: this.cardElement
      });

      if (error) {
        console.error('Card validation error:', error);
        const toast = await this.toastController.create({
          message: error.message || 'Invalid card details',
          duration: 3000,
          color: 'danger',
          position: 'top'
        });
        await toast.present();
        this.validatingCard = false;
        return;
      }

      // Save card if checkbox is checked
      if (this.saveCardForFuture) {
        try {
          await this.http.post<any>(
            `${environment.apiUrl}/payments/save-payment-method`,
            { paymentMethodId: paymentMethod.id },
            { headers: this.userService.getAuthHeadersSync() }
          ).toPromise();
        } catch (saveError) {
          console.warn('Failed to save card:', saveError);
        }
      }

      // Set the new card as selected
      this.selectedCard = {
        stripePaymentMethodId: paymentMethod.id,
        brand: paymentMethod.card.brand,
        last4: paymentMethod.card.last4,
        expiryMonth: paymentMethod.card.exp_month,
        expiryYear: paymentMethod.card.exp_year,
        isDefault: false
      };
      this.selectedPaymentMethod = 'saved-card';

      // Now process the acceptance
      this.validatingCard = false;
      this.processAcceptance();

    } catch (error: any) {
      console.error('Error creating payment method:', error);
      const toast = await this.toastController.create({
        message: 'Failed to validate card',
        duration: 3000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
      this.validatingCard = false;
    }
  }

  private processAcceptance() {
    this.processing = true;
    const paymentMethodId = this.selectedPaymentMethod === 'saved-card' 
      ? this.selectedCard?.stripePaymentMethodId 
      : undefined;
    const useWallet = this.selectedPaymentMethod === 'wallet';
    
    this.classService.acceptInvitation(this.classData!._id, paymentMethodId, useWallet).subscribe({
      next: async (response) => {
        const toast = await this.toastController.create({
          message: 'Class invitation accepted! Added to your calendar.',
          duration: 2000,
          color: 'success',
          position: 'top'
        });
        await toast.present();
        
        this.modalCtrl.dismiss({ accepted: true });
      },
      error: async (error) => {
        console.error('Error accepting invitation:', error);
        
        const isConflict = error.status === 409;
        const message = error.error?.message || 'Failed to accept invitation';
        
        const toast = await this.toastController.create({
          message,
          duration: isConflict ? 5000 : 2500,
          color: isConflict ? 'warning' : 'danger',
          position: 'top',
          buttons: isConflict ? [{ text: 'OK', role: 'cancel' }] : undefined
        });
        await toast.present();
        this.processing = false;
      }
    });
  }

  async declineInvitation() {
    if (!this.classData) return;
    
    this.processing = true;
    this.classService.declineInvitation(this.classData._id).subscribe({
      next: async (response) => {
        const toast = await this.toastController.create({
          message: 'Class invitation declined',
          duration: 2000,
          color: 'medium',
          position: 'top'
        });
        await toast.present();
        
        this.modalCtrl.dismiss({ declined: true });
      },
      error: async (error) => {
        console.error('Error declining invitation:', error);
        const toast = await this.toastController.create({
          message: 'Failed to decline invitation',
          duration: 2500,
          color: 'danger',
          position: 'top'
        });
        await toast.present();
        this.processing = false;
      }
    });
  }

  close() {
    this.cleanupStripeElements();
    this.modalCtrl.dismiss();
  }

  formatCardBrand(brand: string): string {
    if (!brand) return 'Card';
    return brand.charAt(0).toUpperCase() + brand.slice(1);
  }
}
