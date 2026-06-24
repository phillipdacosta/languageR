import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, LoadingController, AlertController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../../services/user.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { trigger, transition, style, animate, query, group } from '@angular/animations';
import { TranslateModule } from '@ngx-translate/core';
import { StripeConnectCardComponent } from '../payout-connect/stripe-connect-card.component';
import { PaypalConnectCardComponent } from '../payout-connect/paypal-connect-card.component';
import { isStripeSupportedCountry } from '../../data/stripe-supported-countries';
import { COUNTRIES_ONBOARDING_LIST, CountryOnboardingRow } from '../../data/country-onboarding-list';
import { CountrySelectModalComponent } from '../country-select-modal/country-select-modal.component';

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

type WizardStep = 'tax-status' | 'bank-account' | 'country-change-confirm' | 'payment-method';

const STRIPE_RESIDENCE_COUNTRY_OPTIONS: CountryOnboardingRow[] = COUNTRIES_ONBOARDING_LIST.filter((c) =>
  isStripeSupportedCountry(c.name)
);

@Component({
  selector: 'app-payout-selection-modal',
  templateUrl: './payout-selection-modal.component.html',
  styleUrls: ['./payout-selection-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, TranslateModule, StripeConnectCardComponent, PaypalConnectCardComponent],
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
  paypalEmailErrorKey = '';
  currentProvider: string = 'none';
  wizardPaypalReasonKey = '';
  payoutMethodReasonParams: Record<string, string> = {};
  showStripeConnectCard = false;
  showPaypalConnectCard = false;
  showConnectCardTaxSummary = false;
  showModalBackButton = false;
  isCountryDrivenPayoutRouting = false;
  isChangingExistingPayout = false;
  isChangingPaypalEmail = false;
  paypalConnectCtaKey = 'TUTOR_APPROVAL.PAYPAL_CONNECT_CTA';
  /** Country saved on profile from onboarding — used for conflict messaging. */
  storedResidenceCountry = '';
  storedResidenceCountryFlag = '';
  countryChangeChoice: 'stripe' | 'keep' | null = null;
  selectedStripeResidenceCountry = '';
  selectedStripeResidenceCountryFlag = '';
  canContinueCountryChangeStep = false;
  showCountryChangeStep = false;

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
        this.storedResidenceCountry = (response.residenceCountry || '').trim();
        this.syncStoredResidenceDisplay();
        this.options = response.options;
        this.currentProvider = response.currentProvider || 'none';
        this.isChangingExistingPayout = this.currentProvider !== 'none';

        // Load existing tax info if available
        if (response.isUSPersonForTax !== null && response.isUSPersonForTax !== undefined) {
          this.isUSPersonForTax = response.isUSPersonForTax;
        }
        if (response.hasUSBankAccount !== null && response.hasUSBankAccount !== undefined) {
          this.hasUSBankAccount = response.hasUSBankAccount;
        }

        const residence = this.storedResidenceCountry;
        if (this.isChangingExistingPayout) {
          // Changing payout: walk through tax questions; country conflict handled after bank step.
          this.isCountryDrivenPayoutRouting = false;
          this.currentStep = 'tax-status';
          this.stepIndex = 0;
        } else if (residence) {
          // First-time setup with onboarding country on file — go straight to the right provider.
          this.isCountryDrivenPayoutRouting = true;
          this.applyCountryDrivenPayoutMethod();
          this.currentStep = 'payment-method';
          this.stepIndex = 0;
        } else if (this.isUSPersonForTax !== null) {
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
    this.syncEffectivePayoutSelection();
    this.canContinuePayment = this.computeCanContinue();
    this.syncConnectCardVisibility();
    this.syncPaypalReasonKey();
    this.isChangingPaypalEmail =
      this.isChangingExistingPayout &&
      this.currentProvider === 'paypal' &&
      this.currentStep === 'payment-method';
    this.paypalConnectCtaKey = this.isChangingPaypalEmail
      ? 'TUTOR_APPROVAL.PAYPAL_SAVE_EMAIL'
      : 'TUTOR_APPROVAL.PAYPAL_CONNECT_CTA';
    this.syncCountryChangeStepUi();

    // Progress
    this.updateProgress();
  }

  private syncCountryChangeStepUi(): void {
    if (this.countryChangeChoice === 'keep') {
      this.canContinueCountryChangeStep = true;
    } else if (this.countryChangeChoice === 'stripe') {
      this.canContinueCountryChangeStep = !!this.selectedStripeResidenceCountry.trim();
    } else {
      this.canContinueCountryChangeStep = false;
    }
  }

  private syncStoredResidenceDisplay(): void {
    const row = COUNTRIES_ONBOARDING_LIST.find((c) => c.name === this.storedResidenceCountry);
    this.storedResidenceCountryFlag = row?.flag || '';
  }

  private hasResidenceStripeConflict(): boolean {
    return (
      this.isUSPersonForTax === true &&
      this.hasUSBankAccount === true &&
      !!this.storedResidenceCountry &&
      !isStripeSupportedCountry(this.storedResidenceCountry)
    );
  }

  private goToPaymentMethodStep(): void {
    this.currentStep = 'payment-method';
    if (this.isUSPersonForTax === false) {
      this.stepIndex = 1;
    } else if (this.showCountryChangeStep) {
      this.stepIndex = 3;
    } else {
      this.stepIndex = 2;
    }
  }

  private applyCountryDrivenPayoutMethod(): void {
    const residence = (this.residenceCountry || '').trim();
    if (!residence) {
      return;
    }
    const method = isStripeSupportedCountry(residence) ? 'stripe' : 'paypal';
    this.determinedPayoutMethod = method;
    this.selectedProvider = method;
  }

  private resolveEffectivePayoutMethod(): 'stripe' | 'paypal' | 'manual' | null {
    const residence = (this.residenceCountry || '').trim();
    if (this.isCountryDrivenPayoutRouting && residence) {
      return isStripeSupportedCountry(residence) ? 'stripe' : 'paypal';
    }

    if (!this.options) {
      return null;
    }

    let preferred: 'stripe' | 'paypal' | null =
      this.determinedPayoutMethod || (this.selectedProvider === 'manual' ? null : this.selectedProvider);

    if (!preferred) {
      if (this.isUSPersonForTax === false) {
        preferred = 'paypal';
      } else if (this.hasUSBankAccount === true) {
        preferred = 'stripe';
      } else if (this.hasUSBankAccount === false) {
        preferred = 'paypal';
      }
    }

    if (preferred === 'stripe' && this.options.stripe.available) {
      return 'stripe';
    }
    if (preferred === 'paypal' && this.options.paypal.available) {
      return 'paypal';
    }
    if (this.options.stripe.available) {
      return 'stripe';
    }
    if (this.options.paypal.available) {
      return 'paypal';
    }
    if (this.options.manual.available) {
      return 'manual';
    }

    return null;
  }

  private syncEffectivePayoutSelection(): void {
    const method = this.resolveEffectivePayoutMethod();
    if (!method) {
      return;
    }

    this.selectedProvider = method;
    if (method === 'stripe' || method === 'paypal') {
      this.determinedPayoutMethod = method;
    }
  }

  private syncConnectCardVisibility(): void {
    const onPaymentStep = this.currentStep === 'payment-method' && !!this.options;
    const method = this.resolveEffectivePayoutMethod();
    this.showStripeConnectCard = onPaymentStep && method === 'stripe';
    this.showPaypalConnectCard = onPaymentStep && method === 'paypal';
    this.showConnectCardTaxSummary =
      this.isUSPersonForTax !== null && !this.isCountryDrivenPayoutRouting;
    this.showModalBackButton =
      this.currentStep !== 'tax-status' &&
      !(this.isCountryDrivenPayoutRouting && this.currentStep === 'payment-method');
  }

  private syncPaypalReasonKey(): void {
    const residence = (this.residenceCountry || this.storedResidenceCountry || '').trim();
    if (this.isCountryDrivenPayoutRouting && residence) {
      this.wizardPaypalReasonKey = 'TUTOR_APPROVAL.METHOD_REASON_PAYPAL_COUNTRY';
      this.payoutMethodReasonParams = { country: residence };
      return;
    }
    if (this.isUSPersonForTax === false) {
      this.wizardPaypalReasonKey = 'TUTOR_APPROVAL.METHOD_REASON_PAYPAL_INTL';
    } else if (
      this.determinedPayoutMethod === 'paypal' &&
      this.storedResidenceCountry &&
      !isStripeSupportedCountry(this.storedResidenceCountry)
    ) {
      this.wizardPaypalReasonKey = 'TUTOR_APPROVAL.METHOD_REASON_PAYPAL_COUNTRY';
      this.payoutMethodReasonParams = { country: this.storedResidenceCountry };
    } else if (this.hasUSBankAccount === false) {
      this.wizardPaypalReasonKey = 'TUTOR_APPROVAL.METHOD_REASON_PAYPAL_US';
    } else {
      this.wizardPaypalReasonKey = '';
    }
    this.payoutMethodReasonParams = {};
  }

  onPaypalEmailChange(value: string): void {
    this.paypalEmail = value;
    this.validatePayPalEmail();
  }

  private updateProgress() {
    if (this.isCountryDrivenPayoutRouting) {
      this.progressPercent = 100;
      this.progressStepLabel = 'Step 1 of 1';
      return;
    }

    const totalSteps = this.isUSPersonForTax === false ? 2 : this.showCountryChangeStep ? 4 : 3;
    const stepOrder: WizardStep[] =
      this.isUSPersonForTax === false
        ? ['tax-status', 'payment-method']
        : [
            'tax-status',
            'bank-account',
            ...(this.showCountryChangeStep ? (['country-change-confirm'] as WizardStep[]) : []),
            'payment-method',
          ];

    const idx = stepOrder.indexOf(this.currentStep);
    const stepNum = idx >= 0 ? idx + 1 : 1;
    this.progressPercent = Math.round((stepNum / totalSteps) * 100);
    this.progressStepLabel = `Step ${stepNum} of ${totalSteps}`;
  }

  // Step navigation
  setUSPersonStatus(isUSPerson: boolean) {
    this.isUSPersonForTax = isUSPerson;
  }

  setUSBankStatus(hasUSBank: boolean) {
    this.hasUSBankAccount = hasUSBank;
  }

  setCountryChangeChoice(choice: 'stripe' | 'keep') {
    this.countryChangeChoice = choice;
    if (choice === 'keep') {
      this.selectedStripeResidenceCountry = '';
      this.selectedStripeResidenceCountryFlag = '';
    }
    this.updateComputedProperties();
  }

  async openStripeResidenceCountryPicker() {
    this.countryChangeChoice = 'stripe';

    const modal = await this.modalController.create({
      component: CountrySelectModalComponent,
      componentProps: {
        countries: STRIPE_RESIDENCE_COUNTRY_OPTIONS,
        selectedCountry: this.selectedStripeResidenceCountry,
        modalType: 'residence',
      },
      cssClass: 'modern-modal',
      showBackdrop: true,
      backdropDismiss: true,
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.selectedCountry) {
      this.selectedStripeResidenceCountry = data.selectedCountry;
      const row = COUNTRIES_ONBOARDING_LIST.find((c) => c.name === data.selectedCountry);
      this.selectedStripeResidenceCountryFlag = row?.flag || '';
      this.updateComputedProperties();
    }
  }

  nextStep() {
    if (this.currentStep === 'tax-status') {
      if (this.isUSPersonForTax === false) {
        this.determinedPayoutMethod = 'paypal';
        this.selectedProvider = 'paypal';
        this.goToPaymentMethodStep();
      } else {
        this.currentStep = 'bank-account';
        this.stepIndex = 1;
      }
    } else if (this.currentStep === 'bank-account') {
      if (this.hasUSBankAccount && this.isUSPersonForTax) {
        if (this.hasResidenceStripeConflict()) {
          this.showCountryChangeStep = true;
          this.countryChangeChoice = null;
          this.selectedStripeResidenceCountry = '';
          this.selectedStripeResidenceCountryFlag = '';
          this.currentStep = 'country-change-confirm';
          this.stepIndex = 2;
        } else if (this.storedResidenceCountry && isStripeSupportedCountry(this.storedResidenceCountry)) {
          this.residenceCountry = this.storedResidenceCountry;
          this.determinedPayoutMethod = 'stripe';
          this.selectedProvider = 'stripe';
          this.goToPaymentMethodStep();
        } else {
          this.determinedPayoutMethod = 'stripe';
          this.selectedProvider = 'stripe';
          this.goToPaymentMethodStep();
        }
      } else {
        this.determinedPayoutMethod = 'paypal';
        this.selectedProvider = 'paypal';
        this.goToPaymentMethodStep();
      }
    } else if (this.currentStep === 'country-change-confirm') {
      if (this.countryChangeChoice === 'stripe' && this.selectedStripeResidenceCountry) {
        this.residenceCountry = this.selectedStripeResidenceCountry;
        this.determinedPayoutMethod = 'stripe';
        this.selectedProvider = 'stripe';
      } else {
        this.residenceCountry = this.storedResidenceCountry;
        this.determinedPayoutMethod = 'paypal';
        this.selectedProvider = 'paypal';
      }
      this.goToPaymentMethodStep();
    }
    this.updateComputedProperties();
  }

  previousStep() {
    if (this.currentStep === 'bank-account') {
      this.currentStep = 'tax-status';
      this.stepIndex = 0;
    } else if (this.currentStep === 'country-change-confirm') {
      this.currentStep = 'bank-account';
      this.stepIndex = 1;
    } else if (this.currentStep === 'payment-method') {
      if (this.isCountryDrivenPayoutRouting) {
        return;
      }
      if (this.showCountryChangeStep && this.hasResidenceStripeConflict()) {
        this.currentStep = 'country-change-confirm';
        this.stepIndex = 2;
      } else if (this.isUSPersonForTax === false) {
        this.currentStep = 'tax-status';
        this.stepIndex = 0;
      } else if (this.isUSPersonForTax) {
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
    this.paypalEmailErrorKey = '';
    this.updateComputedProperties();
  }

  validatePayPalEmail() {
    this.paypalEmailErrorKey = '';

    if (!this.paypalEmail.trim()) {
      this.updateComputedProperties();
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.paypalEmail.trim())) {
      this.paypalEmailErrorKey = 'TUTOR_APPROVAL.ERR_PAYPAL_EMAIL_INVALID';
    }
    this.updateComputedProperties();
  }

  private computeCanContinue(): boolean {
    if (!this.selectedProvider || this.loading) {
      return false;
    }

    if (this.selectedProvider === 'paypal') {
      return this.paypalEmail.trim().length > 0 && !this.paypalEmailErrorKey;
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

      if (this.paypalEmailErrorKey) {
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
                hasUSBankAccount: this.hasUSBankAccount,
                residenceCountry: this.residenceCountry.trim() || null,
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
      hasUSBankAccount: this.hasUSBankAccount,
      residenceCountry: this.residenceCountry.trim() || null,
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
