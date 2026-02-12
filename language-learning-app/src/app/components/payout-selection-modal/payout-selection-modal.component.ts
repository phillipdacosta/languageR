import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, LoadingController, AlertController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../../services/user.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { trigger, transition, style, animate, query, group } from '@angular/animations';

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

const STEP_ORDER: WizardStep[] = ['tax-status', 'bank-account', 'payment-method'];

@Component({
  selector: 'app-payout-selection-modal',
  templateUrl: './payout-selection-modal.component.html',
  styleUrls: ['./payout-selection-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  animations: [
    trigger('stepSlide', [
      // Forward: new enters from right, old exits left
      transition(':increment', [
        query(':enter, :leave', [
          style({ position: 'absolute', width: '100%', top: 0, left: 0 })
        ], { optional: true }),
        group([
          query(':leave', [
            animate('420ms cubic-bezier(0.32, 0.72, 0, 1)',
              style({ transform: 'translateX(-30px)', opacity: 0 }))
          ], { optional: true }),
          query(':enter', [
            style({ transform: 'translateX(30px)', opacity: 0 }),
            animate('420ms cubic-bezier(0.32, 0.72, 0, 1)',
              style({ transform: 'translateX(0)', opacity: 1 }))
          ], { optional: true })
        ])
      ]),
      // Backward: new enters from left, old exits right
      transition(':decrement', [
        query(':enter, :leave', [
          style({ position: 'absolute', width: '100%', top: 0, left: 0 })
        ], { optional: true }),
        group([
          query(':leave', [
            animate('420ms cubic-bezier(0.32, 0.72, 0, 1)',
              style({ transform: 'translateX(30px)', opacity: 0 }))
          ], { optional: true }),
          query(':enter', [
            style({ transform: 'translateX(-30px)', opacity: 0 }),
            animate('420ms cubic-bezier(0.32, 0.72, 0, 1)',
              style({ transform: 'translateX(0)', opacity: 1 }))
          ], { optional: true })
        ])
      ])
    ]),
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(8px)' }),
        animate('350ms 100ms cubic-bezier(0.32, 0.72, 0, 1)',
          style({ opacity: 1, transform: 'translateY(0)' }))
      ])
    ])
  ]
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

  // Animation tracking
  stepIndex = 0;

  // Determined payout method based on tax questions
  determinedPayoutMethod: 'stripe' | 'paypal' | null = null;

  // Pre-computed properties (avoid method calls in template)
  paymentStepTitle = 'Select Payment Method';
  paymentStepDescription = 'Choose how you\'d like to receive your earnings';
  providerLabel = '';
  canContinuePayment = false;

  // Progress tracking
  progressPercent = 33;
  progressStepLabel = 'Step 1 of 3';

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
            this.determinedPayoutMethod = 'paypal';
            this.selectedProvider = 'paypal';
            this.currentStep = 'payment-method';
            this.stepIndex = 2;
          } else if (this.hasUSBankAccount !== null) {
            this.determinedPayoutMethod = this.hasUSBankAccount ? 'stripe' : 'paypal';
            this.selectedProvider = this.determinedPayoutMethod;
            this.currentStep = 'payment-method';
            this.stepIndex = 2;
          } else {
            this.currentStep = 'bank-account';
            this.stepIndex = 1;
          }
        }

        // If user already has a payout provider set, load existing PayPal email
        if (this.currentProvider === 'paypal' && response.currentPaypalEmail) {
          this.paypalEmail = response.currentPaypalEmail;
        }

        this.updateComputedProperties();
      }
    } catch (error) {
      console.error('Error loading payout options:', error);
    } finally {
      this.loading = false;
    }
  }

  // Update pre-computed template properties
  private updateComputedProperties() {
    // Payment step title
    if (this.determinedPayoutMethod === 'stripe') {
      this.paymentStepTitle = 'Set Up Stripe Connect';
      this.paymentStepDescription = 'Connect your US bank account to receive fast, low-fee payouts via Stripe.';
    } else if (this.determinedPayoutMethod === 'paypal') {
      this.paymentStepTitle = 'Set Up PayPal';
      this.paymentStepDescription = 'Link your PayPal account to receive international payouts.';
    } else {
      this.paymentStepTitle = 'Select Payment Method';
      this.paymentStepDescription = 'Choose how you\'d like to receive your earnings.';
    }

    // Provider label
    switch (this.selectedProvider) {
      case 'stripe': this.providerLabel = 'Stripe'; break;
      case 'paypal': this.providerLabel = 'PayPal'; break;
      case 'manual': this.providerLabel = 'Manual Transfer'; break;
      default: this.providerLabel = '';
    }

    // Can continue
    this.canContinuePayment = this.computeCanContinue();

    // Progress
    this.updateProgress();
  }

  private updateProgress() {
    const idx = STEP_ORDER.indexOf(this.currentStep);
    const totalSteps = this.isUSPersonForTax === false ? 2 : 3;

    if (this.currentStep === 'tax-status') {
      this.progressPercent = 33;
      this.progressStepLabel = `Step 1 of ${totalSteps}`;
    } else if (this.currentStep === 'bank-account') {
      this.progressPercent = 66;
      this.progressStepLabel = `Step 2 of ${totalSteps}`;
    } else {
      this.progressPercent = 100;
      this.progressStepLabel = `Step ${totalSteps} of ${totalSteps}`;
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
        this.determinedPayoutMethod = 'paypal';
        this.selectedProvider = 'paypal';
        this.currentStep = 'payment-method';
        this.stepIndex = 2;
      } else {
        this.currentStep = 'bank-account';
        this.stepIndex = 1;
      }
    } else if (this.currentStep === 'bank-account') {
      if (this.hasUSBankAccount) {
        this.determinedPayoutMethod = 'stripe';
        this.selectedProvider = 'stripe';
      } else {
        this.determinedPayoutMethod = 'paypal';
        this.selectedProvider = 'paypal';
      }
      this.currentStep = 'payment-method';
      this.stepIndex = 2;
    }
    this.updateComputedProperties();
  }

  previousStep() {
    if (this.currentStep === 'bank-account') {
      this.currentStep = 'tax-status';
      this.stepIndex = 0;
    } else if (this.currentStep === 'payment-method') {
      if (this.isUSPersonForTax) {
        this.currentStep = 'bank-account';
        this.stepIndex = 1;
      } else {
        this.currentStep = 'tax-status';
        this.stepIndex = 0;
      }
    }
    this.updateComputedProperties();
  }

  editTaxInfo() {
    this.currentStep = 'tax-status';
    this.stepIndex = 0;
    this.determinedPayoutMethod = null;
    this.selectedProvider = null;
    this.updateComputedProperties();
  }

  selectProvider(provider: 'stripe' | 'paypal' | 'manual') {
    if (!this.options) return;

    const option = this.options[provider];
    if (!option.available) return;

    this.selectedProvider = provider;
    this.paypalEmailError = '';
    this.updateComputedProperties();
  }

  validatePayPalEmail() {
    this.paypalEmailError = '';

    if (!this.paypalEmail.trim()) {
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.paypalEmail.trim())) {
      this.paypalEmailError = 'Please enter a valid email address';
    }
    this.updateComputedProperties();
  }

  private computeCanContinue(): boolean {
    if (!this.selectedProvider || this.loading) {
      return false;
    }

    if (this.selectedProvider === 'paypal') {
      return this.paypalEmail.trim().length > 0 && !this.paypalEmailError;
    }

    return true;
  }

  dismiss() {
    this.modalController.dismiss();
  }

  async continue() {
    if (!this.computeCanContinue()) {
      return;
    }

    // Final validation for PayPal
    if (this.selectedProvider === 'paypal') {
      this.validatePayPalEmail();

      if (this.paypalEmailError) {
        return;
      }

      const alert = await this.alertController.create({
        header: 'Confirm PayPal Email',
        message: `You will receive payments to:\n\n${this.paypalEmail.trim()}\n\nMake sure this email is linked to your PayPal account.`,
        cssClass: 'paypal-confirm-alert',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel'
          },
          {
            text: 'Confirm',
            handler: () => {
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
