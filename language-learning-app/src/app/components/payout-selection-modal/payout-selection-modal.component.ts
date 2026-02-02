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

type WizardStep = 'tax-status' | 'bank-account' | 'payment-method';

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
  currentProvider: string = 'none';

  // Wizard state
  currentStep: WizardStep = 'tax-status';
  isUSPersonForTax: boolean | null = null;
  hasUSBankAccount: boolean | null = null;
  
  // Determined payout method based on tax questions
  determinedPayoutMethod: 'stripe' | 'paypal' | null = null;

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
        this.currentProvider = response.currentProvider || 'none';
        
        // Load existing tax info if available
        if (response.isUSPersonForTax !== null && response.isUSPersonForTax !== undefined) {
          this.isUSPersonForTax = response.isUSPersonForTax;
        }
        if (response.hasUSBankAccount !== null && response.hasUSBankAccount !== undefined) {
          this.hasUSBankAccount = response.hasUSBankAccount;
        }
        
        // If tax info is already complete, skip to payment method
        if (this.isUSPersonForTax !== null) {
          if (this.isUSPersonForTax === false) {
            // Non-US person - skip bank question, go to payment
            this.determinedPayoutMethod = 'paypal';
            this.selectedProvider = 'paypal';
            this.currentStep = 'payment-method';
          } else if (this.hasUSBankAccount !== null) {
            // US person with bank status known
            this.determinedPayoutMethod = this.hasUSBankAccount ? 'stripe' : 'paypal';
            this.selectedProvider = this.determinedPayoutMethod;
            this.currentStep = 'payment-method';
          } else {
            // US person but bank status unknown
            this.currentStep = 'bank-account';
          }
        }
        
        // If user already has a payout provider set, load existing PayPal email
        if (this.currentProvider === 'paypal' && response.currentPaypalEmail) {
          this.paypalEmail = response.currentPaypalEmail;
          console.log('💳 [PAYOUT-MODAL] Loaded existing PayPal email:', this.paypalEmail);
        }
      }
    } catch (error) {
      console.error('Error loading payout options:', error);
    } finally {
      this.loading = false;
    }
  }

  // Step navigation
  setUSPersonStatus(isUSPerson: boolean) {
    this.isUSPersonForTax = isUSPerson;
  }

  setUSBankStatus(hasUSBank: boolean) {
    this.hasUSBankAccount = hasUSBank;
  }

  nextStep() {
    if (this.currentStep === 'tax-status') {
      if (this.isUSPersonForTax === false) {
        // Non-US Person → PayPal
        this.determinedPayoutMethod = 'paypal';
        this.selectedProvider = 'paypal';
        this.currentStep = 'payment-method';
      } else {
        // US Person → Ask about bank account
        this.currentStep = 'bank-account';
      }
    } else if (this.currentStep === 'bank-account') {
      // Determine payout method based on answers
      if (this.hasUSBankAccount) {
        // US Person + US Bank → Stripe
        this.determinedPayoutMethod = 'stripe';
        this.selectedProvider = 'stripe';
      } else {
        // US Person + No US Bank → PayPal
        this.determinedPayoutMethod = 'paypal';
        this.selectedProvider = 'paypal';
      }
      this.currentStep = 'payment-method';
    }
  }

  previousStep() {
    if (this.currentStep === 'bank-account') {
      this.currentStep = 'tax-status';
    } else if (this.currentStep === 'payment-method') {
      if (this.isUSPersonForTax) {
        this.currentStep = 'bank-account';
      } else {
        this.currentStep = 'tax-status';
      }
    }
  }

  editTaxInfo() {
    this.currentStep = 'tax-status';
    this.determinedPayoutMethod = null;
    this.selectedProvider = null;
  }

  getPaymentStepTitle(): string {
    if (this.determinedPayoutMethod === 'stripe') {
      return 'Set Up Stripe Connect';
    } else if (this.determinedPayoutMethod === 'paypal') {
      return 'Set Up PayPal';
    }
    return 'Select Payment Method';
  }

  getPaymentStepDescription(): string {
    if (this.determinedPayoutMethod === 'stripe') {
      return 'Connect your US bank account to receive fast, low-fee payouts via Stripe.';
    } else if (this.determinedPayoutMethod === 'paypal') {
      return 'Link your PayPal account to receive international payouts.';
    }
    return 'Choose how you\'d like to receive your earnings';
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
                paypalEmail: this.paypalEmail.trim(),
                isUSPersonForTax: this.isUSPersonForTax,
                hasUSBankAccount: this.hasUSBankAccount
              });
              this.modalController.dismiss({
                provider: this.selectedProvider,
                paypalEmail: this.paypalEmail.trim(),
                isUSPersonForTax: this.isUSPersonForTax,
                hasUSBankAccount: this.hasUSBankAccount
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
      paypalEmail: null,
      isUSPersonForTax: this.isUSPersonForTax,
      hasUSBankAccount: this.hasUSBankAccount
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
