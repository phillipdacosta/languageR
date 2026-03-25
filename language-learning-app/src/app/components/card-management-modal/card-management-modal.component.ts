import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController, AlertController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../../services/user.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';

declare var Stripe: any;

@Component({
  selector: 'app-card-management-modal',
  templateUrl: './card-management-modal.component.html',
  styleUrls: ['./card-management-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class CardManagementModalComponent implements OnInit, OnDestroy {
  @Input() purchaseMode = false;
  @Input() purchaseAmount: number = 0;
  @Input() purchaseTitle: string = '';

  savedCards: any[] = [];
  isAddingNewCard = false;
  isSaving = false;
  isLoading = true;
  selectedCardId: string | null = null;
  cardholderName = '';
  cardsChanged = false;

  // Stripe
  private stripe: any;
  private stripeElements: any;
  private cardNumberElement: any;
  private cardExpiryElement: any;
  private cardCvcElement: any;

  constructor(
    private modalController: ModalController,
    private toastController: ToastController,
    private alertController: AlertController,
    private http: HttpClient,
    private userService: UserService
  ) {}

  async ngOnInit() {
    await this.initializeStripe();
    await this.loadSavedCards();
    this.isLoading = false;
  }

  ngOnDestroy() {
    this.unmountStripeElements();
  }

  // ── Stripe Setup ──

  private async initializeStripe(): Promise<void> {
    try {
      const publishableKey = environment.stripePublishableKey;
      if (!publishableKey) {
        console.error('❌ Stripe publishable key not configured');
        return;
      }
      this.stripe = Stripe(publishableKey);
      this.stripeElements = this.stripe.elements();
      console.log('✅ Stripe initialized in card-management modal');
    } catch (error) {
      console.error('❌ Error initializing Stripe:', error);
    }
  }

  private mountStripeElements(retryCount = 0): void {
    if (!this.stripe || !this.stripeElements) {
      console.error('❌ Stripe not initialized');
      return;
    }

    const numberEl = document.getElementById('modal-card-number-element');
    const expiryEl = document.getElementById('modal-card-expiry-element');
    const cvcEl = document.getElementById('modal-card-cvc-element');

    if (!numberEl || !expiryEl || !cvcEl) {
      if (retryCount < 5) {
        setTimeout(() => this.mountStripeElements(retryCount + 1), 200 * (retryCount + 1));
        return;
      }
      console.error('❌ Stripe containers not found after retries');
      return;
    }

    this.unmountStripeElements();

    const style = {
      base: {
        fontSize: '15px',
        color: '#1c1c1e',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
        '::placeholder': { color: '#8e8e93' },
      },
      invalid: { color: '#ff3b30' },
    };

    try {
      this.cardNumberElement = this.stripeElements.create('cardNumber', { style, placeholder: '0000 0000 0000 0000' });
      this.cardExpiryElement = this.stripeElements.create('cardExpiry', { style, placeholder: 'MM/YY' });
      this.cardCvcElement = this.stripeElements.create('cardCvc', { style, placeholder: 'CVC' });

      this.cardNumberElement.mount('#modal-card-number-element');
      this.cardExpiryElement.mount('#modal-card-expiry-element');
      this.cardCvcElement.mount('#modal-card-cvc-element');

      console.log('✅ Stripe elements mounted in modal');
    } catch (error) {
      console.error('❌ Error mounting Stripe elements:', error);
    }
  }

  private unmountStripeElements(): void {
    try {
      if (this.cardNumberElement) { this.cardNumberElement.unmount(); this.cardNumberElement.destroy(); this.cardNumberElement = null; }
      if (this.cardExpiryElement) { this.cardExpiryElement.unmount(); this.cardExpiryElement.destroy(); this.cardExpiryElement = null; }
      if (this.cardCvcElement) { this.cardCvcElement.unmount(); this.cardCvcElement.destroy(); this.cardCvcElement = null; }
    } catch (_) {
      // Already unmounted
    }
  }

  // ── Data Loading ──

  private async loadSavedCards(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/payments/payment-methods`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success && response.paymentMethods) {
        this.savedCards = response.paymentMethods.filter((pm: any) => pm.type === 'card');

        const defaultCard = this.savedCards.find((c: any) => c.isDefault);
        if (defaultCard) {
          this.selectedCardId = defaultCard.stripePaymentMethodId;
        }

        if (this.savedCards.length === 0) {
          this.isAddingNewCard = true;
          setTimeout(() => this.mountStripeElements(), 300);
        }
      }
    } catch (error) {
      console.error('Error loading saved cards:', error);
      this.isAddingNewCard = true;
      setTimeout(() => this.mountStripeElements(), 300);
    }
  }

  // ── Card Actions ──

  selectCard(card: any): void {
    this.selectedCardId = card.stripePaymentMethodId;
  }

  showAddCardForm(): void {
    this.isAddingNewCard = true;
    setTimeout(() => this.mountStripeElements(), 300);
  }

  cancelAddCard(): void {
    this.isAddingNewCard = false;
    this.unmountStripeElements();
    this.cardholderName = '';
  }

  isCardExpired(card: any): boolean {
    if (!card.expiryMonth || !card.expiryYear) return false;
    const now = new Date();
    const year = parseInt(card.expiryYear, 10);
    const month = parseInt(card.expiryMonth, 10);
    if (year < now.getFullYear()) return true;
    if (year === now.getFullYear() && month < now.getMonth() + 1) return true;
    return false;
  }

  async setCardAsDefault(card: any, event: Event): Promise<void> {
    event.stopPropagation();
    try {
      const response = await firstValueFrom(
        this.http.put<any>(
          `${environment.apiUrl}/payments/payment-method/${card.stripePaymentMethodId}/default`,
          {},
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      if (response.success) {
        this.savedCards.forEach(c => c.isDefault = false);
        card.isDefault = true;
        this.selectedCardId = card.stripePaymentMethodId;

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

  async deleteCard(card: any, event: Event): Promise<void> {
    event.stopPropagation();

    const alert = await this.alertController.create({
      header: 'Delete Card',
      message: `Are you sure you want to delete the card ending in ${card.last4}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            try {
              const response = await firstValueFrom(
                this.http.delete<any>(
                  `${environment.apiUrl}/payments/payment-method/${card.stripePaymentMethodId}`,
                  { headers: this.userService.getAuthHeadersSync() }
                )
              );

              if (response.success) {
                this.cardsChanged = true;
                this.savedCards = this.savedCards.filter(c => c.stripePaymentMethodId !== card.stripePaymentMethodId);

                if (this.selectedCardId === card.stripePaymentMethodId) {
                  if (this.savedCards.length > 0) {
                    const fallback = this.savedCards.find(c => c.isDefault) || this.savedCards[0];
                    this.selectedCardId = fallback.stripePaymentMethodId;
                  } else {
                    this.selectedCardId = null;
                    this.isAddingNewCard = true;
                    setTimeout(() => this.mountStripeElements(), 300);
                  }
                }

                const toast = await this.toastController.create({
                  message: 'Card deleted',
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

  // ── Save New Card ──

  async saveNewCard(): Promise<void> {
    if (!this.stripe || !this.cardNumberElement || this.isSaving) return;

    this.isSaving = true;

    try {
      const { paymentMethod, error } = await this.stripe.createPaymentMethod({
        type: 'card',
        card: this.cardNumberElement,
        billing_details: {
          name: this.cardholderName || undefined,
        },
      });

      if (error) {
        const toast = await this.toastController.create({
          message: error.message || 'Invalid card information',
          duration: 3000,
          color: 'danger',
          position: 'top'
        });
        await toast.present();
        this.isSaving = false;
        return;
      }

      // Save to backend
      const saveResponse = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/payments/save-payment-method`,
          {
            paymentMethodId: paymentMethod.id,
            setAsDefault: this.savedCards.length === 0
          },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      if (saveResponse.success) {
        this.cardsChanged = true;

        // Reload cards
        await this.loadSavedCards();

        this.isAddingNewCard = false;
        this.cardholderName = '';
        this.unmountStripeElements();

        const toast = await this.toastController.create({
          message: 'Card saved successfully',
          duration: 2000,
          color: 'success',
          position: 'top'
        });
        await toast.present();
      }
    } catch (error: any) {
      console.error('Error saving card:', error);
      const message = error.error?.message || error.error?.error || 'Failed to save card';
      const toast = await this.toastController.create({
        message,
        duration: 3000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    } finally {
      this.isSaving = false;
    }
  }

  // ── Purchase / Dismiss ──

  async confirmPurchase(): Promise<void> {
    const card = this.savedCards.find(c => c.stripePaymentMethodId === this.selectedCardId) || this.savedCards[0];
    if (!card) return;

    const alert = await this.alertController.create({
      header: 'Confirm Payment',
      message: `You will be charged <strong>$${this.purchaseAmount.toFixed(2)}</strong> on your ${card.brand || 'card'} ending in ${card.last4}.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          handler: () => {
            this.modalController.dismiss({
              confirmed: true,
              cardsUpdated: this.cardsChanged,
              selectedCard: card
            });
          }
        }
      ]
    });
    await alert.present();
  }

  dismiss(): void {
    const hasCards = this.savedCards.length > 0;
    this.modalController.dismiss({
      confirmed: false,
      cardsUpdated: this.cardsChanged,
      selectedCard: hasCards ? this.savedCards.find(c => c.stripePaymentMethodId === this.selectedCardId) || this.savedCards[0] : null
    });
  }
}





