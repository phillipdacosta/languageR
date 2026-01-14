import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../../services/user.service';

declare var Stripe: any;

interface SavedCard {
  id: string;
  stripePaymentMethodId: string;
  brand: string;
  last4: string;
  expiryMonth: string;
  expiryYear: string;
  isDefault: boolean;
  country?: string; // Card country code (e.g., "US", "CA", "GB")
}

@Component({
  selector: 'app-wallet-topup-modal',
  templateUrl: './wallet-topup-modal.component.html',
  styleUrls: ['./wallet-topup-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, HttpClientModule]
})
export class WalletTopupModalComponent implements OnInit, OnDestroy {
  amount: number = 50;
  savedCards: SavedCard[] = [];
  selectedCardId: string | null = null;
  showNewCardForm: boolean = false;
  loading: boolean = true;
  
  // Multi-step flow
  currentStep: 'selection' | 'card-entry' | 'confirmation' = 'selection';
  processingPayment: boolean = false;
  
  // Stripe Elements
  stripe: any;
  cardElement: any;
  stripeElements: any;
  
  // New card data
  newCardCountry: string | null = null;
  newCardBrand: string | null = null;
  newCardLast4: string | null = null;
  paymentMethodId: string | null = null;
  saveCardForFuture: boolean = true; // Default to checked

  constructor(
    private modalController: ModalController,
    private http: HttpClient,
    private userService: UserService
  ) {}

  // Get the selected card object
  get selectedCard(): SavedCard | undefined {
    return this.savedCards.find(card => card.id === this.selectedCardId);
  }

  // Determine if the selected card is international
  get isInternationalCard(): boolean {
    if (this.currentStep === 'card-entry') {
      // Don't know yet - user hasn't entered card
      return true; // Assume worst case for now
    }
    
    if (this.currentStep === 'confirmation' && this.newCardCountry) {
      // New card - use detected country
      return this.newCardCountry !== 'US';
    }
    
    if (this.showNewCardForm) {
      return true; // Default to international until we know
    }
    
    const card = this.selectedCard;
    return card?.country ? card.country !== 'US' : true;
  }

  // Calculate exact Stripe processing fee based on card country
  // We need to reverse-calculate so that after Stripe takes their fee, we net exactly the wallet amount
  get stripeFee(): number {
    if (!this.amount) return 0;
    
    // International cards: 4.4% + $0.30
    // Domestic cards: 2.9% + $0.30
    const feeRate = this.isInternationalCard ? 0.044 : 0.029;
    
    // Calculate total charge needed so that (totalCharge - stripeFee) = walletCredit
    // totalCharge = (walletCredit + fixedFee) / (1 - percentageFee)
    const totalCharge = (this.amount + 0.30) / (1 - feeRate);
    
    // The fee is the difference between total charge and wallet credit
    const fee = totalCharge - this.amount;
    
    return Math.round(fee * 100) / 100; // Round to 2 decimal places
  }

  // Get fee description for display
  get feeDescription(): string {
    if (this.currentStep === 'card-entry') {
      return 'Fee will be calculated after you enter your card details';
    }
    
    if (this.currentStep === 'confirmation' && this.newCardCountry) {
      return this.newCardCountry !== 'US' 
        ? `4.4% + $0.30 (international card from ${this.newCardCountry})`
        : `2.9% + $0.30 (domestic card from ${this.newCardCountry})`;
    }
    
    if (this.showNewCardForm) {
      return 'Fee will be calculated after you enter your card details';
    }
    
    const card = this.selectedCard;
    if (!card?.country) {
      return 'Fee varies by card type';
    }
    
    return this.isInternationalCard 
      ? '4.4% + $0.30 (international card)'
      : '2.9% + $0.30';
  }

  // Total amount customer will be charged
  get totalCharge(): number {
    const amount = Number(this.amount) || 0;
    const fee = this.stripeFee;
    const total = amount + fee;
    return Math.round(total * 100) / 100; // Round to 2 decimal places
  }

  async ngOnInit() {
    console.log('🔄 [WALLET-MODAL] ngOnInit - Initializing...');
    
    // Initialize Stripe
    if (typeof window !== 'undefined' && (window as any).Stripe) {
      this.stripe = Stripe(environment.stripePublishableKey);
      console.log('✅ [WALLET-MODAL] Stripe initialized');
    } else {
      console.error('❌ [WALLET-MODAL] Stripe.js not loaded');
    }
    
    await this.loadSavedCards();
    
    this.loading = false;
    console.log('✅ [WALLET-MODAL] Loading complete. Saved cards:', this.savedCards.length);
  }

  async ionViewWillEnter() {
    console.log('🔄 [WALLET-MODAL] ionViewWillEnter - Reloading cards...');
    await this.loadSavedCards();
  }

  private async loadSavedCards(): Promise<void> {
    try {
      console.log('📡 [WALLET-MODAL] Fetching payment methods from API...');
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/payments/payment-methods`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );
      
      console.log('📦 [WALLET-MODAL] API Response:', {
        success: response.success,
        paymentMethodsCount: response.paymentMethods?.length || 0,
        paymentMethods: response.paymentMethods
      });
      
      if (response.success && response.paymentMethods) {
        // Filter only card type payment methods
        this.savedCards = response.paymentMethods
          .filter((pm: any) => pm.type === 'card')
          .map((pm: any) => ({
            id: pm.id,
            stripePaymentMethodId: pm.stripePaymentMethodId,
            brand: pm.brand,
            last4: pm.last4,
            expiryMonth: pm.expiryMonth,
            expiryYear: pm.expiryYear,
            isDefault: pm.isDefault,
            country: pm.country // Include card country
          }));
        
        console.log('💳 [WALLET-MODAL] Mapped saved cards:', this.savedCards.length, 'cards');
        console.log('💳 [WALLET-MODAL] Card details:', this.savedCards.map(c => ({
          last4: c.last4,
          brand: c.brand,
          country: c.country,
          isDefault: c.isDefault
        })));
        
        // Auto-select default card if exists
        const defaultCard = this.savedCards.find(card => card.isDefault);
        if (defaultCard) {
          this.selectedCardId = defaultCard.id;
          this.showNewCardForm = false;
          console.log('✅ [WALLET-MODAL] Auto-selected default card:', defaultCard.brand, defaultCard.last4);
        } else if (this.savedCards.length > 0) {
          this.selectedCardId = this.savedCards[0].id;
          this.showNewCardForm = false;
          console.log('✅ [WALLET-MODAL] Auto-selected first card:', this.savedCards[0].brand, this.savedCards[0].last4);
        } else {
          // No saved cards - default to "Add new card"
          this.selectedCardId = null;
          this.showNewCardForm = true;
          console.log('ℹ️ [WALLET-MODAL] No saved cards - defaulting to "Add new card"');
        }

        console.log('✅ [WALLET-MODAL] Loaded saved cards:', this.savedCards);
      } else {
        console.warn('⚠️ [WALLET-MODAL] No payment methods in response or success=false');
      }
    } catch (error) {
      console.error('❌ [WALLET-MODAL] Error loading saved cards:', error);
    }
  }

  selectCard(cardId: string) {
    this.selectedCardId = cardId;
    this.showNewCardForm = false;
  }

  selectNewCard() {
    this.selectedCardId = null;
    this.showNewCardForm = true;
  }

  async deleteCard(card: SavedCard, event: Event) {
    event.stopPropagation(); // Prevent selecting the card when clicking delete
    
    if (!confirm(`Remove ${card.brand} ••••${card.last4}?`)) {
      return;
    }

    try {
      const response = await firstValueFrom(
        this.http.delete<any>(
          `${environment.apiUrl}/payments/payment-method/${card.stripePaymentMethodId}`,
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      if (response.success) {
        console.log('✅ Card deleted successfully');
        
        // Remove from local array
        this.savedCards = this.savedCards.filter(c => c.id !== card.id);
        
        // If deleted card was selected, select another
        if (this.selectedCardId === card.id) {
          if (this.savedCards.length > 0) {
            this.selectedCardId = this.savedCards[0].id;
          } else {
            this.selectedCardId = null;
            this.showNewCardForm = true;
          }
        }
      } else {
        alert('Failed to remove card. Please try again.');
      }
    } catch (error: any) {
      console.error('❌ Error deleting card:', error);
      alert(error.error?.message || 'Failed to remove card');
    }
  }

  cancel() {
    // Clean up Stripe elements before closing
    if (this.cardElement) {
      try {
        this.cardElement.unmount();
        this.cardElement.destroy();
      } catch (e) {
        console.warn('Error cleaning up on cancel:', e);
      }
    }
    this.modalController.dismiss(null, 'cancel');
  }

  continue() {
    if (!this.amount || this.amount < 1 || this.amount > 500) {
      return;
    }

    const selectedCard = this.savedCards.find(card => card.id === this.selectedCardId);
    
    console.log('💰 Continue button clicked:', {
      amount: this.amount,
      showNewCardForm: this.showNewCardForm,
      selectedCardId: this.selectedCardId,
      selectedCard: selectedCard,
      hasSelectedCard: !!selectedCard,
      willDismiss: !!selectedCard,
      willGoToCardEntry: this.showNewCardForm && !selectedCard
    });
    
    // If using saved card, proceed with payment immediately
    if (selectedCard) {
      console.log('✅ Saved card selected - dismissing modal');
      this.modalController.dismiss({ 
        amount: this.amount,
        totalCharge: this.totalCharge,
        stripeFee: this.stripeFee,
        isInternationalCard: this.isInternationalCard,
        cardCountry: selectedCard?.country,
        useNewCard: false,
        selectedCard: selectedCard
      }, 'confirm');
    } 
    // If using new card, go to card entry step
    else if (this.showNewCardForm) {
      console.log('✅ New card selected - going to card entry step');
      this.goToCardEntry();
    } else {
      console.warn('⚠️ Neither saved card nor new card selected!');
    }
  }

  async goToCardEntry() {
    console.log('🔄 Going to card entry step - NO backend call yet');
    this.currentStep = 'card-entry';
    
    // Mount Stripe card element
    setTimeout(() => {
      this.mountCardElement();
    }, 300);
  }

  mountCardElement() {
    const cardElementContainer = document.getElementById('card-element-wallet');
    
    if (!cardElementContainer || !this.stripe) {
      console.error('Card element container or Stripe not found');
      return;
    }

    // Clean up existing card element if it exists
    if (this.cardElement) {
      try {
        this.cardElement.unmount();
        this.cardElement.destroy();
      } catch (e) {
        console.warn('Error cleaning up old card element:', e);
      }
      this.cardElement = null;
    }

    // Clean up existing elements instance
    if (this.stripeElements) {
      this.stripeElements = null;
    }

    // Create fresh Stripe Elements instance
    this.stripeElements = this.stripe.elements();

    // Create and mount new card element
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

    this.cardElement.mount('#card-element-wallet');
    console.log('✅ Card element mounted');
  }

  goBack() {
    if (this.currentStep === 'confirmation') {
      // Go back to card entry from confirmation
      this.currentStep = 'card-entry';
      this.newCardCountry = null;
      this.newCardBrand = null;
      this.newCardLast4 = null;
      this.paymentMethodId = null;
      // Remount card element
      setTimeout(() => {
        this.mountCardElement();
      }, 100);
    } else if (this.currentStep === 'card-entry') {
      // Go back to selection - clean up card element
      this.currentStep = 'selection';
      if (this.cardElement) {
        try {
          this.cardElement.unmount();
          this.cardElement.destroy();
        } catch (e) {
          console.warn('Error unmounting card element:', e);
        }
        this.cardElement = null;
      }
      this.stripeElements = null;
    } else {
      // Cancel modal
      this.cancel();
    }
  }

  async proceedToConfirmation() {
    if (!this.stripe || !this.cardElement) {
      return;
    }

    this.processingPayment = true;

    try {
      // Create PaymentMethod (doesn't charge yet)
      const { error, paymentMethod } = await this.stripe.createPaymentMethod({
        type: 'card',
        card: this.cardElement
      });

      if (error) {
        console.error('Card validation error:', error);
        alert(error.message || 'Invalid card details');
        this.processingPayment = false;
        return;
      }

      // Get card details from Stripe
      this.newCardCountry = paymentMethod.card.country;
      this.newCardBrand = paymentMethod.card.brand;
      this.newCardLast4 = paymentMethod.card.last4;
      this.paymentMethodId = paymentMethod.id;

      console.log('✅ Card validated. Country:', this.newCardCountry, 'Brand:', this.newCardBrand);

      // Go to confirmation step
      this.currentStep = 'confirmation';
      this.processingPayment = false;

    } catch (error: any) {
      console.error('Error creating payment method:', error);
      alert('Failed to validate card');
      this.processingPayment = false;
    }
  }

  async confirmAndPay() {
    this.processingPayment = true;

    try {
      // Now create PaymentIntent with exact amount based on card country
      const walletCredit = Math.round(Number(this.amount) * 100) / 100;
      const stripeFee = Math.round(this.stripeFee * 100) / 100;
      const totalCharge = Math.round(this.totalCharge * 100) / 100;

      console.log('💳 Creating payment with exact fee:', {
        walletCredit,
        totalCharge,
        stripeFee,
        cardCountry: this.newCardCountry,
        saveCard: this.saveCardForFuture
      });

      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/wallet/top-up`, {
          walletCredit,
          totalCharge,
          stripeFee,
          paymentMethodId: this.paymentMethodId,
          saveCard: this.saveCardForFuture
        }, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success) {
        // Confirm payment
        const { error, paymentIntent } = await this.stripe.confirmCardPayment(
          response.clientSecret
        );

        if (error) {
          alert(error.message || 'Payment failed');
          this.processingPayment = false;
        } else if (paymentIntent.status === 'succeeded') {
          // Confirm on backend
          await firstValueFrom(
            this.http.post<any>(`${environment.apiUrl}/wallet/confirm-top-up`, {
              paymentIntentId: response.paymentIntentId
            }, {
              headers: this.userService.getAuthHeadersSync()
            })
          );

          this.modalController.dismiss({ 
            success: true,
            amount: this.amount
          }, 'success');
        }
      } else {
        alert('Payment failed');
        this.processingPayment = false;
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      alert(error.error?.message || 'Payment failed');
      this.processingPayment = false;
    }
  }

  ngOnDestroy() {
    // Clean up Stripe elements when component is destroyed
    if (this.cardElement) {
      try {
        this.cardElement.unmount();
        this.cardElement.destroy();
      } catch (e) {
        console.warn('Error cleaning up in ngOnDestroy:', e);
      }
    }
    console.log('🧹 WalletTopupModalComponent destroyed and cleaned up');
  }
}

