import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { WalletService, WalletBalance, WalletTransaction, PaymentHistory } from '../services/wallet.service';
import { UserService } from '../services/user.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

// Import Stripe
declare var Stripe: any;

@Component({
  selector: 'app-wallet',
  templateUrl: './wallet.page.html',
  styleUrls: ['./wallet.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, RouterModule]
})
export class WalletPage implements OnInit, OnDestroy {
  balance: WalletBalance | null = null;
  transactions: WalletTransaction[] = [];
  paymentHistory: PaymentHistory[] = []; // NEW: All payment methods
  loading = true;
  currentUser: any = null;
  
  // Tab management
  selectedTab: 'wallet' | 'payments' = 'wallet';
  
  // Stripe
  stripe: any;
  cardElement: any;
  stripeElements: any;
  
  // Top-up flow
  showTopUpForm = false;
  topUpAmount: number | null = null;
  currentPaymentIntentId: string | null = null;
  processingPayment = false;

  private destroy$ = new Subject<void>();

  constructor(
    private walletService: WalletService,
    private userService: UserService,
    private router: Router,
    private location: Location,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController
  ) {}

  async ngOnInit() {
    // Double-check user is a student (guard should have caught this, but safety first)
    this.userService.currentUser$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      this.currentUser = user;
      if (user && user.userType !== 'student') {
        console.log('⚠️ Non-student attempted to access wallet page, redirecting');
        this.router.navigate(['/tabs/home']);
      }
    });

    await this.initializeStripe();
    await this.loadWalletData();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    
    if (this.cardElement) {
      this.cardElement.destroy();
    }
  }

  async initializeStripe() {
    // Stripe publishable key
    const stripeKey = 'pk_test_51SkSi9BKUCCLlfbERkY1hkCVT1cdSlKyTyRN6VkxAwcaT81mV8eXlllJc2vvuRJf8vGRKwaqtGnNbP5LgycSZZ6L00f2UHYKbP';
    
    if (typeof Stripe === 'undefined') {
      console.error('Stripe.js not loaded');
      return;
    }

    this.stripe = Stripe(stripeKey);
    this.stripeElements = this.stripe.elements();
  }

  async loadWalletData() {
    this.loading = true;

    try {
      // Load balance
      this.walletService.getBalance()
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (response) => {
            if (response.success) {
              this.balance = {
                balance: response.balance,
                reservedBalance: response.reservedBalance,
                availableBalance: response.availableBalance,
                currency: response.currency
              };
            }
          },
          error: (error) => {
            console.error('Error loading balance:', error);
            this.showToast('Failed to load balance', 'danger');
          }
        });

      // Load wallet transactions (for reserved/released funds)
      this.walletService.getTransactions(20)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (response) => {
            if (response.success) {
              this.transactions = response.transactions;
            }
          },
          error: (error) => {
            console.error('Error loading transactions:', error);
          }
        });

      // Load full payment history (all payment methods)
      this.walletService.getPaymentHistory(50)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (response) => {
            console.log('💳 [WALLET] Payment history response:', response);
            if (response.success) {
              this.paymentHistory = response.payments;
              console.log('💳 [WALLET] Payment history count:', this.paymentHistory.length);
              console.log('💳 [WALLET] Payment history:', this.paymentHistory);
            }
          },
          error: (error) => {
            console.error('❌ [WALLET] Error loading payment history:', error);
          },
          complete: () => {
            this.loading = false;
          }
        });
    } catch (error) {
      console.error('Error loading wallet data:', error);
      this.loading = false;
    }
  }

  async showTopUpDialog() {
    const alert = await this.alertController.create({
      header: 'Top Up Wallet',
      message: 'How much would you like to add?',
      inputs: [
        {
          name: 'amount',
          type: 'number',
          placeholder: 'Amount (USD)',
          min: 1,
          max: 500,
          value: 50
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Continue',
          handler: async (data) => {
            const amount = parseFloat(data.amount);
            if (!amount || amount < 1 || amount > 500) {
              this.showToast('Please enter a valid amount ($1-$500)', 'warning');
              return false;
            }
            await this.initiateTopUp(amount);
            return true;
          }
        }
      ]
    });

    await alert.present();
  }

  async initiateTopUp(amount: number) {
    const loading = await this.loadingController.create({
      message: 'Setting up payment...'
    });
    await loading.present();

    try {
      this.walletService.initiateTopUp(amount)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: async (response) => {
            await loading.dismiss();
            
            if (response.success) {
              this.topUpAmount = amount;
              this.currentPaymentIntentId = response.paymentIntentId;
              this.showTopUpForm = true;

              // Mount card element
              setTimeout(() => {
                this.mountCardElement(response.clientSecret);
              }, 300);
            } else {
              this.showToast('Failed to initiate top-up', 'danger');
            }
          },
          error: async (error) => {
            await loading.dismiss();
            console.error('Error initiating top-up:', error);
            this.showToast(error.error?.message || 'Failed to initiate top-up', 'danger');
          }
        });
    } catch (error) {
      await loading.dismiss();
      console.error('Error:', error);
      this.showToast('An error occurred', 'danger');
    }
  }

  mountCardElement(clientSecret: string) {
    const cardElementContainer = document.getElementById('card-element');
    
    if (!cardElementContainer || !this.stripeElements) {
      console.error('Card element container or Stripe elements not found');
      return;
    }

    // Create card element
    this.cardElement = this.stripeElements.create('card', {
      style: {
        base: {
          fontSize: '16px',
          color: '#32325d',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          '::placeholder': {
            color: '#aab7c4'
          }
        },
        invalid: {
          color: '#fa755a',
          iconColor: '#fa755a'
        }
      }
    });

    // Mount to DOM
    this.cardElement.mount('#card-element');

    // Store client secret for later
    (this.cardElement as any).clientSecret = clientSecret;
  }

  async submitPayment() {
    if (!this.cardElement || !this.currentPaymentIntentId) {
      this.showToast('Payment form not ready', 'danger');
      return;
    }

    this.processingPayment = true;
    const loading = await this.loadingController.create({
      message: 'Processing payment...'
    });
    await loading.present();

    try {
      const clientSecret = (this.cardElement as any).clientSecret;
      
      const { error, paymentIntent } = await this.stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: this.cardElement
        }
      });

      if (error) {
        await loading.dismiss();
        this.processingPayment = false;
        this.showToast(error.message || 'Payment failed', 'danger');
        return;
      }

      if (paymentIntent.status === 'succeeded') {
        // Confirm top-up on backend
        this.walletService.confirmTopUp(paymentIntent.id)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: async (response) => {
              await loading.dismiss();
              this.processingPayment = false;

              if (response.success) {
                this.showToast(`✅ ${response.message}`, 'success');
                
                // Reset form
                this.cancelTopUp();
                
                // Reload wallet data
                await this.loadWalletData();
              } else {
                this.showToast('Failed to confirm top-up', 'danger');
              }
            },
            error: async (error) => {
              await loading.dismiss();
              this.processingPayment = false;
              console.error('Error confirming top-up:', error);
              this.showToast('Failed to confirm payment', 'danger');
            }
          });
      }
    } catch (error) {
      await loading.dismiss();
      this.processingPayment = false;
      console.error('Payment error:', error);
      this.showToast('Payment failed', 'danger');
    }
  }

  cancelTopUp() {
    if (this.cardElement) {
      this.cardElement.unmount();
      this.cardElement.destroy();
      this.cardElement = null;
    }
    
    this.showTopUpForm = false;
    this.topUpAmount = null;
    this.currentPaymentIntentId = null;
  }

  formatAmount(amount: number): string {
    return this.walletService.formatAmount(amount);
  }

  formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getTransactionIcon(type: string): string {
    switch (type) {
      case 'top_up': return 'arrow-down-circle';
      case 'deduction': return 'arrow-up-circle';
      case 'refund': return 'refresh-circle';
      case 'reservation': return 'lock-closed';
      case 'release': return 'lock-open';
      default: return 'swap-horizontal';
    }
  }

  getTransactionColor(type: string): string {
    switch (type) {
      case 'top_up':
      case 'refund':
      case 'release':
        return 'success';
      case 'deduction':
      case 'reservation':
        return 'danger';
      default:
        return 'medium';
    }
  }

  // NEW: Get icon for payment method
  getPaymentMethodIcon(paymentMethod: string): string {
    switch (paymentMethod) {
      case 'wallet': return 'wallet';
      case 'card': return 'card';
      case 'apple_pay': return 'logo-apple';
      case 'google_pay': return 'logo-google';
      default: return 'cash';
    }
  }

  // NEW: Get display name for payment method
  getPaymentMethodName(paymentMethod: string): string {
    switch (paymentMethod) {
      case 'wallet': return 'Wallet';
      case 'card': return 'Card';
      case 'apple_pay': return 'Apple Pay';
      case 'google_pay': return 'Google Pay';
      default: return 'Payment';
    }
  }

  // NEW: Get description for payment
  getPaymentDescription(payment: PaymentHistory): string {
    if (payment.paymentType === 'wallet_top_up') {
      return 'Wallet Top-Up';
    }
    if (payment.paymentType === 'lesson_booking' || payment.paymentType === 'office_hours') {
      const lessonType = payment.paymentType === 'office_hours' ? 'Office Hours' : 'Lesson';
      const tutor = payment.lessonId?.tutorId?.firstName || 'Tutor';
      return `${lessonType} with ${tutor}`;
    }
    return 'Payment';
  }

  // NEW: Get color for payment status
  getPaymentStatusColor(status: string): string {
    switch (status) {
      case 'succeeded': return 'success';
      case 'failed':
      case 'cancelled': return 'danger';
      case 'refunded':
      case 'partially_refunded': return 'warning';
      case 'pending':
      case 'processing': return 'medium';
      default: return 'medium';
    }
  }

  async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      color,
      position: 'top'
    });
    await toast.present();
  }

  switchTab(tab: 'wallet' | 'payments') {
    this.selectedTab = tab;
  }

  goBack() {
    this.location.back();
  }
}
