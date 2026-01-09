import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController, AlertController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../../services/user.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';

// Declare Stripe
declare var Stripe: any;

@Component({
  selector: 'app-card-management-modal',
  templateUrl: './card-management-modal.component.html',
  styleUrls: ['./card-management-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class CardManagementModalComponent implements OnInit {
  @ViewChild('cardElement', { read: ElementRef }) cardElementRef!: ElementRef;
  
  savedCards: any[] = [];
  isAddingNewCard = false;
  isSaving = false;
  setAsDefault = false;
  
  // Stripe
  stripe: any;
  cardElement: any;
  stripeElements: any;

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
  }

  async initializeStripe() {
    try {
      const publishableKey = environment.stripePublishableKey;
      
      if (!publishableKey) {
        console.error('❌ Stripe publishable key not configured');
        return;
      }

      this.stripe = Stripe(publishableKey);
      console.log('✅ Stripe initialized in modal');
    } catch (error) {
      console.error('❌ Error initializing Stripe:', error);
    }
  }

  async loadSavedCards() {
    try {
      const response = await firstValueFrom(
        this.http.get<any>(
          `${environment.apiUrl}/payments/payment-methods`,
          { headers: this.userService.getAuthHeadersSync() }
        )
      );
      
      if (response.success) {
        this.savedCards = response.paymentMethods || [];
        console.log(`💳 Loaded ${this.savedCards.length} saved cards in modal`);
      }
    } catch (error) {
      console.error('❌ Error loading saved cards:', error);
    }
  }

  showAddCardForm() {
    this.isAddingNewCard = true;
    
    // Mount card element after view updates
    setTimeout(() => {
      this.mountCardElement();
    }, 100);
  }

  cancelAddCard() {
    this.isAddingNewCard = false;
    
    // Unmount and clean up card element
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

  private mountCardElement() {
    if (!this.stripe) {
      console.error('❌ Stripe not initialized');
      return;
    }

    setTimeout(() => {
      const cardElementContainer = document.getElementById('modal-card-element');
      if (cardElementContainer) {
        // Clear the container first
        cardElementContainer.innerHTML = '';
        
        // Unmount existing card element if it exists
        if (this.cardElement) {
          try {
            this.cardElement.unmount();
            this.cardElement.destroy();
          } catch (e) {
            console.log('Card element already unmounted');
          }
          this.cardElement = null;
        }
        
        // Create fresh elements instance if needed
        if (!this.stripeElements) {
          this.stripeElements = this.stripe.elements();
        }
        
        // Create and mount new card element
        this.cardElement = this.stripeElements.create('card', {
          style: {
            base: {
              fontSize: '16px',
              color: '#424770',
              '::placeholder': {
                color: '#aab7c4',
              },
            },
          },
        });
        this.cardElement.mount('#modal-card-element');
        console.log('✅ Stripe card element mounted in modal');
      }
    }, 100);
  }

  async saveNewCard() {
    if (!this.stripe || !this.cardElement) {
      const toast = await this.toastController.create({
        message: 'Payment system not initialized. Please try again.',
        duration: 3000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
      return;
    }

    this.isSaving = true;

    try {
      // Create payment method
      const { paymentMethod, error } = await this.stripe.createPaymentMethod({
        type: 'card',
        card: this.cardElement,
      });

      if (error) {
        throw new Error(error.message || 'Failed to create payment method');
      }

      // Save to backend
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/payments/save-payment-method`,
          { 
            paymentMethodId: paymentMethod.id,
            setAsDefault: this.setAsDefault || this.savedCards.length === 0
          },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      if (response.success) {
        // Refresh user data to get updated stripeCustomerId
        if (response.stripeCustomerId) {
          console.log('✅ Customer ID received from backend:', response.stripeCustomerId);
          // Force refresh user data
          await firstValueFrom(this.userService.getCurrentUser(true));
        }
        
        const toast = await this.toastController.create({
          message: 'Card saved successfully!',
          duration: 2000,
          color: 'success',
          position: 'top'
        });
        await toast.present();

        // Reload cards to get the newly added card
        await this.loadSavedCards();
        this.cancelAddCard();
        this.setAsDefault = false;
        
        // If this was set as default (or is the first card), automatically select it
        if (this.setAsDefault || this.savedCards.length === 1) {
          // Find the newly added card (should be marked as default)
          const newDefaultCard = this.savedCards.find(card => card.isDefault);
          if (newDefaultCard) {
            // Dismiss modal with the selected card
            await this.modalController.dismiss({
              selectedCard: newDefaultCard
            }, 'card-selected');
            return; // Exit early
          }
        }
        
        // Otherwise, just dismiss with cardsUpdated flag
        await this.modalController.dismiss({
          cardsUpdated: true
        });
      }
    } catch (error: any) {
      console.error('Error saving card:', error);
      const toast = await this.toastController.create({
        message: error.message || 'Failed to save card. Please try again.',
        duration: 3000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    } finally {
      this.isSaving = false;
    }
  }

  async setDefaultCard(paymentMethodId: string) {
    try {
      const response = await firstValueFrom(
        this.http.put<any>(
          `${environment.apiUrl}/payments/payment-method/${paymentMethodId}/default`,
          {},
          { headers: this.userService.getAuthHeadersSync() }
        )
      );
      
      if (response.success) {
        await this.loadSavedCards();
        
        const toast = await this.toastController.create({
          message: 'Default card updated',
          duration: 2000,
          color: 'success',
          position: 'top'
        });
        await toast.present();
      }
    } catch (error) {
      console.error('Error setting default card:', error);
      const toast = await this.toastController.create({
        message: 'Failed to set default card. Please try again.',
        duration: 3000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    }
  }

  async removeCard(paymentMethodId: string) {
    const alert = await this.alertController.create({
      header: 'Remove Card',
      message: 'Are you sure you want to remove this card?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Remove',
          role: 'destructive',
          handler: async () => {
            try {
              const response = await firstValueFrom(
                this.http.delete<any>(
                  `${environment.apiUrl}/payments/payment-method/${paymentMethodId}`,
                  { headers: this.userService.getAuthHeadersSync() }
                )
              );
              
              if (response.success) {
                await this.loadSavedCards();
                
                const toast = await this.toastController.create({
                  message: 'Card removed successfully',
                  duration: 2000,
                  color: 'success',
                  position: 'top'
                });
                await toast.present();
              }
            } catch (error) {
              console.error('Error removing card:', error);
              const toast = await this.toastController.create({
                message: 'Failed to remove card. Please try again.',
                duration: 3000,
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

  async selectCard(card: any) {
    // Close modal and return selected card
    await this.modalController.dismiss({
      selectedCard: card
    }, 'card-selected'); // Add role parameter
  }

  dismiss() {
    this.modalController.dismiss();
  }
}

