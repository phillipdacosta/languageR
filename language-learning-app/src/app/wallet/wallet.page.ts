import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { AlertController, LoadingController, ToastController, ModalController } from '@ionic/angular';
import { WalletService, WalletBalance, WalletTransaction, PaymentHistory } from '../services/wallet.service';
import { UserService } from '../services/user.service';
import { environment } from '../../environments/environment';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { WalletTopupModalComponent } from '../components/wallet-topup-modal/wallet-topup-modal.component';
import { HttpClient } from '@angular/common/http';
import { getGlobalHour12 } from '../shared/timezone.utils';

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
  get timePipeFormat(): string { return getGlobalHour12() ? 'h:mm a' : 'HH:mm'; }
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
    private toastController: ToastController,
    private modalController: ModalController,
    private http: HttpClient
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
    // Stripe publishable key from environment
    const stripeKey = environment.stripePublishableKey;
    
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
    const modal = await this.modalController.create({
      component: WalletTopupModalComponent,
      cssClass: 'wallet-topup-modal',
      backdropDismiss: true
    });

    await modal.present();

    const { data, role } = await modal.onWillDismiss();

    console.log('💰 Wallet Page - Modal dismissed with role:', role, 'data:', data);

    // Handle saved card flow (modal dismissed with 'confirm')
    if (role === 'confirm' && data?.selectedCard) {
      console.log('💳 Using saved card flow');
      await this.processTopUpWithSavedCard(data.amount, data.totalCharge, data.stripeFee, data.selectedCard.stripePaymentMethodId);
    }
    // Handle new card success (payment completed in modal)
    else if (role === 'success' && data?.success) {
      console.log('✅ New card payment completed successfully in modal');
      this.showToast(`Successfully added $${data.amount.toFixed(2)} to your wallet!`, 'success');
      await this.loadWalletData();
    }
  }

  async processTopUpWithSavedCard(walletCredit: number, totalCharge: number, stripeFee: number, paymentMethodId: string) {
    const loading = await this.loadingController.create({
      message: 'Processing payment...'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/wallet/top-up-with-saved-card`, {
          walletCredit, // Amount to credit to wallet
          totalCharge, // Amount to charge customer (including fee)
          stripeFee, // Fee breakdown for records
          paymentMethodId
        }, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      await loading.dismiss();

      if (response.success) {
        this.showToast(`Successfully added $${walletCredit.toFixed(2)} to your wallet!`, 'success');
        await this.loadWalletData();
      } else {
        this.showToast('Payment failed. Please try again.', 'danger');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('Error processing payment with saved card:', error);
      this.showToast(error.error?.message || 'Payment failed. Please try again.', 'danger');
    }
  }

  async initiateTopUp(walletCredit: number, totalCharge: number, stripeFee: number) {
    const loading = await this.loadingController.create({
      message: 'Setting up payment...'
    });
    await loading.present();

    try {
      // Pass totalCharge to backend to create PaymentIntent for correct amount
      this.http.post<any>(`${environment.apiUrl}/wallet/top-up`, {
        walletCredit, // Amount to credit to wallet
        totalCharge, // Amount to charge customer (including fee)
        stripeFee // Fee breakdown for records
      }, {
        headers: this.userService.getAuthHeadersSync()
      })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: async (response) => {
            await loading.dismiss();
            
            if (response.success) {
              this.topUpAmount = walletCredit; // Store wallet credit amount
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
      minute: '2-digit',
      hour12: getGlobalHour12()
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
    if (payment.paymentType === 'class_booking') {
      const className = (payment as any).classId?.name;
      const tutorName = this.getTutorName(payment);
      if (className) {
        return `${className}`;
      }
      return `Class with ${tutorName}`;
    }
    if (payment.paymentType === 'lesson_booking' || payment.paymentType === 'office_hours') {
      const lessonType = payment.paymentType === 'office_hours' ? 'Office Hours' : 'Lesson';
      const tutorName = this.getTutorName(payment);
      return `${lessonType} with ${tutorName}`;
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

  // NEW: Get text for payment status
  getPaymentStatusText(payment: PaymentHistory): string {
    // For cancelled payments, check if it's a no-show scenario
    if (payment.status === 'cancelled' && payment.lessonId?.cancelReason) {
      const cancelReason = payment.lessonId.cancelReason;
      if (cancelReason.toLowerCase().includes('no-show')) {
        return `Returned $${this.formatAmount(payment.amount).replace('$', '')} - ${cancelReason}`;
      }
      return `Cancelled - ${cancelReason}`;
    }
    
    // Default status text
    switch (payment.status) {
      case 'succeeded': return 'Succeeded';
      case 'failed': return 'Failed';
      case 'cancelled': return 'Returned';
      case 'refunded': return 'Returned';
      case 'partially_refunded': return 'Partially Returned';
      case 'pending': return 'Pending';
      case 'processing': return 'Processing';
      case 'authorized': return 'Authorized';
      default: return payment.status;
    }
  }

  // Check if payment is a refund or cancellation (credit back to wallet)
  isRefundOrCancelled(status: string): boolean {
    return status === 'refunded' || status === 'cancelled' || status === 'partially_refunded';
  }

  // Get payment amount display with correct sign
  getPaymentAmountDisplay(payment: PaymentHistory): string {
    const amount = this.formatAmount(payment.amount);
    if (this.isRefundOrCancelled(payment.status)) {
      return `+${amount}`; // Credit back to wallet
    }
    return `-${amount}`; // Debit from wallet
  }

  openPaymentReceipt(payment: PaymentHistory): void {
    if (payment.receiptUrl) {
      console.log('🧾 Opening Stripe receipt for student:', payment.receiptUrl);
      window.open(payment.receiptUrl, '_blank');
    } else {
      console.log('ℹ️ No receipt available for this payment');
    }
  }

  getTutorName(payment: PaymentHistory): string {
    // Check lesson first, then class
    const tutor = payment.lessonId?.tutorId || (payment as any).classId?.tutorId;
    if (!tutor) return 'Tutor';
    
    if (tutor.firstName && tutor.lastName) {
      return `${tutor.firstName} ${tutor.lastName.charAt(0)}.`;
    }
    if (tutor.name) {
      // Try to format name if it's a full name
      const parts = tutor.name.trim().split(' ');
      if (parts.length >= 2) {
        return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
      }
      return tutor.name;
    }
    return 'Tutor';
  }

  // Get tutor picture from lesson or class
  getTutorPicture(payment: PaymentHistory): string | null {
    // Check lesson tutor first
    const lessonTutor = payment.lessonId?.tutorId;
    if (lessonTutor?.picture) return lessonTutor.picture;
    if (lessonTutor?.profilePicture) return lessonTutor.profilePicture;
    
    // Check class tutor
    const classTutor = (payment as any).classId?.tutorId;
    if (classTutor?.picture) return classTutor.picture;
    if (classTutor?.profilePicture) return classTutor.profilePicture;
    
    return null;
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

  goToHome() {
    this.router.navigate(['/tabs/home']);
  }
}
