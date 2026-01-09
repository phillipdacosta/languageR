import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, LoadingController, AlertController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../../services/user.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';

interface PayoutOption {
  available: boolean;
  recommended: boolean;
  label: string;
  description: string;
}

interface PayoutOptions {
  stripe: PayoutOption;
  paypal: PayoutOption;
  manual: PayoutOption;
}

@Component({
  selector: 'app-payout-selection-modal',
  templateUrl: './payout-selection-modal.component.html',
  styleUrls: ['./payout-selection-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class PayoutSelectionModalComponent implements OnInit {
  loading = true;
  residenceCountry = '';
  options: PayoutOptions | null = null;
  selectedProvider: 'stripe' | 'paypal' | 'manual' | null = null;
  paypalEmail = '';
  paypalEmailError = '';

  constructor(
    private modalController: ModalController,
    private http: HttpClient,
    private userService: UserService,
    private loadingController: LoadingController,
    private alertController: AlertController
  ) {}

  async ngOnInit() {
    await this.loadPayoutOptions();
  }

  async loadPayoutOptions() {
    try {
      const response = await firstValueFrom(
        this.http.get<any>(
          `${environment.apiUrl}/payments/payout-options`,
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      if (response.success) {
        this.residenceCountry = response.residenceCountry;
        this.options = response.options;
        
        // Auto-select recommended option
        if (this.options) {
          if (this.options.stripe && this.options.stripe.recommended) {
            this.selectedProvider = 'stripe';
          } else if (this.options.paypal && this.options.paypal.recommended) {
            this.selectedProvider = 'paypal';
          }
        }
      }
    } catch (error) {
      console.error('Error loading payout options:', error);
    } finally {
      this.loading = false;
    }
  }

  selectProvider(provider: 'stripe' | 'paypal' | 'manual') {
    if (!this.options) return;
    
    const option = this.options[provider];
    if (!option.available) return;
    
    this.selectedProvider = provider;
    this.paypalEmailError = ''; // Clear error when switching providers
  }

  validatePayPalEmail() {
    this.paypalEmailError = '';
    
    if (!this.paypalEmail.trim()) {
      return;
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.paypalEmail.trim())) {
      this.paypalEmailError = 'Please enter a valid email address';
    }
  }

  canContinue(): boolean {
    if (!this.selectedProvider || this.loading) {
      return false;
    }
    
    if (this.selectedProvider === 'paypal') {
      return this.paypalEmail.trim().length > 0 && !this.paypalEmailError;
    }
    
    return true;
  }

  getProviderLabel(): string {
    switch (this.selectedProvider) {
      case 'stripe': return 'Stripe';
      case 'paypal': return 'PayPal';
      case 'manual': return 'Manual Transfer';
      default: return '';
    }
  }

  dismiss() {
    this.modalController.dismiss();
  }

  async continue() {
    if (!this.canContinue()) {
      console.log('❌ [PAYOUT-MODAL] Cannot continue, validation failed');
      return;
    }

    console.log('✅ [PAYOUT-MODAL] Continue clicked, selectedProvider:', this.selectedProvider);

    // Final validation for PayPal
    if (this.selectedProvider === 'paypal') {
      console.log('💳 [PAYOUT-MODAL] PayPal selected, email:', this.paypalEmail);
      this.validatePayPalEmail();
      
      if (this.paypalEmailError) {
        console.log('❌ [PAYOUT-MODAL] Email validation failed:', this.paypalEmailError);
        return;
      }
      
      console.log('✅ [PAYOUT-MODAL] Email validated, showing confirmation alert');
      // Confirm PayPal email
      const alert = await this.alertController.create({
        header: 'Confirm PayPal Email',
        message: `You will receive payments to:\n\n${this.paypalEmail.trim()}\n\nMake sure this email is linked to your PayPal account.`,
        cssClass: 'paypal-confirm-alert',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              console.log('❌ [PAYOUT-MODAL] User cancelled confirmation');
            }
          },
          {
            text: 'Confirm',
            handler: () => {
              console.log('✅ [PAYOUT-MODAL] User confirmed, dismissing with data:', {
                provider: this.selectedProvider,
                paypalEmail: this.paypalEmail.trim()
              });
              this.modalController.dismiss({
                provider: this.selectedProvider,
                paypalEmail: this.paypalEmail.trim()
              });
            }
          }
        ]
      });
      await alert.present();
      return;
    }

    // For Stripe and Manual, continue directly
    console.log('✅ [PAYOUT-MODAL] Dismissing with provider:', this.selectedProvider);
    this.modalController.dismiss({
      provider: this.selectedProvider,
      paypalEmail: null
    });
  }

  getProviderIcon(provider: string): string {
    switch (provider) {
      case 'stripe': return 'card';
      case 'paypal': return 'logo-paypal';
      case 'manual': return 'business';
      default: return 'cash';
    }
  }
}

