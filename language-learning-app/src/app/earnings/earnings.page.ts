import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { IonicModule, AlertController, ToastController, ModalController, ViewWillEnter } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../services/user.service';
import { WebSocketService } from '../services/websocket.service';
import { environment } from '../../environments/environment';
import { firstValueFrom, filter, takeUntil } from 'rxjs';
import { Subject, Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';

interface PaymentBreakdown {
  id: string;
  studentName: string;
  studentPicture?: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  amount?: number;
  tutorPayout: number;
  platformFee: number;
  refundAmount?: number;
  refundReason?: string;
  status: 'paid' | 'pending' | 'in_progress' | 'processing' | 'scheduled' | 'cancelled' | 'refunded' | 'partially_refunded' | 'class_scheduled' | 'succeeded';
  lessonStatus: string;
  classStatus?: string;
  lessonId: string;
  classId?: string;
  className?: string;
  isClassPayment?: boolean;
  cancelReason?: string;
}

interface TutorBalance {
  available: number;
  pending: number;
  lifetime: number;
  withdrawn: number;
  lastWithdrawal: Date | null;
}

interface WithdrawalHistory {
  id: string;
  amount: number;
  netAmount: number;
  method: string;
  status: string;
  fees: {
    paypal: number;
    stripe: number;
    platform: number;
    total: number;
  };
  requestedAt: Date;
  completedAt?: Date;
}

@Component({
  selector: 'app-earnings',
  templateUrl: './earnings.page.html',
  styleUrls: ['./earnings.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule]
})
export class EarningsPage implements OnInit, OnDestroy, ViewWillEnter {
  loading: boolean = true;
  
  // NEW: Withdrawal system balance
  balance: TutorBalance = {
    available: 0,
    pending: 0,
    lifetime: 0,
    withdrawn: 0,
    lastWithdrawal: null
  };
  
  // OLD: Legacy earnings (will be deprecated)
  totalEarnings: number = 0;
  pendingEarnings: number = 0;
  
  recentPayments: PaymentBreakdown[] = [];
  withdrawalHistory: WithdrawalHistory[] = [];
  
  error: string | null = null;
  payoutProvider: string = 'none';
  payoutMethodConfigured: boolean = false;
  paypalEmail: string = '';
  stripeConnectAccountId: string = '';
  
  // Withdrawal modal state
  isWithdrawalModalOpen: boolean = false;
  withdrawalAmount: number = 0;
  selectedWithdrawalMethod: 'stripe_connect' | 'paypal' | null = null;
  withdrawing: boolean = false;
  
  // Wallet visibility (tied to profile setting)
  showWalletBalance = false; // Hide by default
  walletTemporarilyVisible = false; // For mobile tap-to-reveal
  
  private subscriptions: Subscription[] = [];
  private destroy$ = new Subject<void>();

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private router: Router,
    private location: Location,
    private websocketService: WebSocketService,
    private alertController: AlertController,
    private toastController: ToastController,
    private modalController: ModalController
  ) {
    // Subscribe to currentUser$ observable to get updates automatically when profile changes
    this.userService.currentUser$
      .pipe(
        filter(user => user !== null),
        takeUntil(this.destroy$)
      )
      .subscribe(user => {
        if (user?.profile) {
          this.showWalletBalance = user.profile.showWalletBalance || false;
          console.log('💰 [EARNINGS] Wallet balance setting updated:', this.showWalletBalance);
        }
      });
  }

  async ngOnInit() {
    // Load wallet visibility setting from user profile
    await this.loadWalletVisibilitySetting();
    
    await Promise.all([
      this.loadBalance(),
      this.loadEarnings(),
      this.loadWithdrawalHistory()
    ]);
    this.setupWebSocketListeners();
  }

  /**
   * Ionic lifecycle hook - called every time the page is about to enter
   * This ensures data is refreshed when navigating back to the page
   */
  async ionViewWillEnter() {
    console.log('💰 [EARNINGS] Page entering - refreshing data...');
    await Promise.all([
      this.loadBalance(),
      this.loadEarnings(),
      this.loadWithdrawalHistory()
    ]);
  }
  
  // Load wallet visibility setting from user profile
  async loadWalletVisibilitySetting() {
    try {
      const user = await firstValueFrom(this.userService.getCurrentUser(true));
      if (user?.profile) {
        this.showWalletBalance = user.profile.showWalletBalance || false;
        console.log('💰 Loaded wallet balance setting:', this.showWalletBalance);
      }
    } catch (error) {
      console.error('❌ Error loading wallet visibility setting:', error);
      // Default to hidden if error
      this.showWalletBalance = false;
    }
  }
  
  // Toggle wallet visibility temporarily (for mobile tap-to-reveal)
  toggleWalletVisibility(event: Event, type: 'available' | 'pending' | 'lifetime'): void {
    // Only allow toggle on mobile/touch devices (non-hover devices)
    const isTouchDevice = !window.matchMedia('(hover: hover)').matches;
    if (!isTouchDevice) {
      return; // Exit early on desktop - let hover handle it
    }
    
    event.stopPropagation(); // Prevent navigation if parent is clickable
    
    if (!this.showWalletBalance) {
      this.walletTemporarilyVisible = !this.walletTemporarilyVisible;
      
      // Auto-hide after 3 seconds
      if (this.walletTemporarilyVisible) {
        setTimeout(() => {
          this.walletTemporarilyVisible = false;
        }, 3000);
      }
    }
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.destroy$.next();
    this.destroy$.complete();
  }

  onImageError(event: any) {
    console.error('❌ Student avatar failed to load:', event.target?.src);
    // Hide the broken image by setting display to none
    event.target.style.display = 'none';
    // The *ngIf will show the fallback icon automatically
  }

  setupWebSocketListeners() {
    // Listen for lesson status changes
    const lessonStatusSub = this.websocketService.lessonStatusChanged$.subscribe((data: any) => {
      console.log('📡 Lesson status changed:', data);
      // Reload earnings when a lesson status changes
      this.loadEarnings();
    });

    // Listen for payment updates
    const paymentUpdateSub = this.websocketService.paymentStatusChanged$.subscribe((data: any) => {
      console.log('📡 Payment status changed:', data);
      // Reload earnings when payment status changes
      this.loadEarnings();
    });

    this.subscriptions.push(lessonStatusSub, paymentUpdateSub);
  }

  async loadEarnings() {
    this.loading = true;
    this.error = null;

    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/payments/tutor/earnings`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success) {
        this.totalEarnings = response.totalEarnings || 0;
        this.pendingEarnings = response.pendingEarnings || 0;
        this.recentPayments = response.recentPayments || [];
        this.payoutProvider = response.payoutProvider || 'none';
        this.paypalEmail = response.paypalEmail || '';
        this.stripeConnectAccountId = response.stripeConnectAccountId || '';
        console.log(`💰 Loaded ${this.recentPayments.length} payments`);
      }
    } catch (error: any) {
      console.error('❌ Error loading earnings:', error);
      this.error = 'Failed to load earnings. Please try again.';
    } finally {
      this.loading = false;
    }
  }

  getTransferredLabel(): string {
    switch(this.payoutProvider) {
      case 'stripe':
        return 'In your Stripe account';
      case 'paypal':
        return 'In your PayPal account';
      case 'manual':
        return 'Paid out';
      default:
        return 'Successfully transferred';
    }
  }

  goToHome() {
    this.router.navigate(['/tabs/home']);
  }

  goBack() {
    this.location.back();
  }

  viewLesson(lessonId: string) {
    this.router.navigate(['/lesson-analysis', lessonId]);
  }

  getStatusColor(status: string): string {
    switch(status) {
      case 'paid':
        return 'success';
      case 'succeeded': // Available for withdrawal
        return 'success';
      case 'in_progress':
        return 'primary';
      case 'processing':
        return 'warning';
      case 'pending':
      case 'scheduled':
      case 'class_scheduled':
        return 'medium';
      case 'cancelled':
      case 'refunded':
        return 'danger';
      case 'partially_refunded':
        return 'warning';
      default:
        return 'warning';
    }
  }

  getStatusIcon(status: string): string {
    switch(status) {
      case 'paid':
        return 'checkmark-circle';
      case 'in_progress':
        return 'videocam';
      case 'processing':
        return 'hourglass';
      case 'scheduled':
        return 'calendar';
      case 'class_scheduled':
        return 'people'; // Group icon for class
      case 'cancelled':
      case 'refunded':
        return 'close-circle';
      case 'partially_refunded':
        return 'alert-circle';
      default:
        return 'time';
    }
  }

  getStatusText(status: string): string {
    switch(status) {
      case 'paid':
        return 'Transferred';
      case 'in_progress':
        return 'In Progress';
      case 'processing':
        return 'Processing Payment';
      case 'scheduled':
      case 'class_scheduled':
        return 'Scheduled';
      case 'cancelled':
        return 'Cancelled';
      case 'refunded':
        return 'Payment Cancelled';
      case 'partially_refunded':
        return 'Payment Reduced';
      case 'succeeded':
        return 'Available'; // Changed from default "Pending Transfer"
      default:
        return 'Pending Transfer';
    }
  }

  getStatusNote(payment: PaymentBreakdown): string | null {
    if (payment.status === 'refunded') {
      return payment.refundReason || 'Payment cancelled after investigation';
    }
    if (payment.status === 'partially_refunded') {
      return payment.refundReason || `Payment reduced after investigation. $${(payment.refundAmount || 0).toFixed(2)} refunded to student.`;
    }
    if (payment.status === 'cancelled') {
      return payment.cancelReason || (payment.isClassPayment ? 'Class was cancelled' : 'Lesson was cancelled');
    }
    if (payment.status === 'processing' || payment.lessonStatus === 'ended_early') {
      return 'Payment amount will be sent after the 24 hour hold period';
    }
    if (payment.status === 'in_progress') {
      return payment.isClassPayment ? 'Class currently in progress' : 'Lesson currently in progress';
    }
    if (payment.status === 'scheduled' || payment.status === 'class_scheduled') {
      return '';
    }
    return null;
  }

  // ============================================================
  // NEW: WITHDRAWAL SYSTEM METHODS
  // ============================================================

  async loadBalance() {
    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/withdrawals/balance`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success) {
        this.balance = response.balance;
        this.payoutMethodConfigured = 
          response.payoutMethods?.stripeConnect?.configured || 
          response.payoutMethods?.paypal?.configured || 
          false;
        
        // Set payout provider
        if (response.payoutMethods?.stripeConnect?.configured) {
          this.payoutProvider = 'stripe';
          this.stripeConnectAccountId = response.payoutMethods.stripeConnect.accountId || '';
        } else if (response.payoutMethods?.paypal?.configured) {
          this.payoutProvider = 'paypal';
          this.paypalEmail = response.payoutMethods.paypal.email || '';
        } else {
          this.payoutProvider = 'none';
        }
        
        console.log('💰 Balance loaded:', this.balance);
        console.log('💳 Payout provider:', this.payoutProvider);
        console.log('✅ Payout configured:', this.payoutMethodConfigured);
      }
    } catch (error: any) {
      console.error('❌ Error loading balance:', error);
    }
  }

  async loadWithdrawalHistory() {
    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/withdrawals/history?limit=10`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success) {
        this.withdrawalHistory = response.withdrawals || [];
        console.log(`📜 Loaded ${this.withdrawalHistory.length} withdrawals`);
      }
    } catch (error: any) {
      console.error('❌ Error loading withdrawal history:', error);
    }
  }

  async requestWithdrawal() {
    console.log('🔵 requestWithdrawal called');
    console.log('Balance available:', this.balance.available);
    console.log('Payout method configured:', this.payoutMethodConfigured);
    
    if (!this.payoutMethodConfigured) {
      const alert = await this.alertController.create({
        header: 'Payout Method Required',
        message: 'Please set up your payout method (Stripe or PayPal) in settings before requesting a withdrawal.',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    if (this.balance.available <= 0) {
      const alert = await this.alertController.create({
        header: 'No Available Balance',
        message: 'You have no funds available for withdrawal at this time.',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    // Set default values and open modal
    this.withdrawalAmount = this.balance.available;
    
    // Auto-select the configured payout method
    if (this.payoutProvider === 'stripe') {
      this.selectedWithdrawalMethod = 'stripe_connect';
    } else if (this.payoutProvider === 'paypal') {
      this.selectedWithdrawalMethod = 'paypal';
    }
    
    console.log('🟢 Opening modal, isWithdrawalModalOpen =', true);
    this.isWithdrawalModalOpen = true;
    console.log('Modal state after set:', this.isWithdrawalModalOpen);
  }

  closeWithdrawalModal() {
    this.isWithdrawalModalOpen = false;
  }

  selectWithdrawalMethod(method: 'stripe_connect' | 'paypal') {
    this.selectedWithdrawalMethod = method;
  }

  setMaxWithdrawalAmount() {
    this.withdrawalAmount = this.balance.available;
  }

  canWithdraw(): boolean {
    if (!this.selectedWithdrawalMethod) {
      return false;
    }
    
    // Stripe has no minimum withdrawal amount
    const minAmount = this.selectedWithdrawalMethod === 'stripe_connect' ? 0.01 : 10;
    
    return this.withdrawalAmount >= minAmount && 
           this.withdrawalAmount <= this.balance.available;
  }

  calculatePayPalFee(amount: number): number {
    if (this.selectedWithdrawalMethod !== 'paypal') {
      return 0;
    }
    // PayPal charges $0.25 or 2% (whichever is higher), max $20
    let fee = Math.max(0.25, amount * 0.02);
    fee = Math.min(fee, 20);
    return Math.round(fee * 100) / 100;
  }

  calculateStripeFee(amount: number): number {
    // Stripe Connect transfers are FREE - no withdrawal fee
    return 0;
  }

  getWithdrawalFee(): number {
    if (this.selectedWithdrawalMethod === 'paypal') {
      return this.calculatePayPalFee(this.withdrawalAmount);
    } else if (this.selectedWithdrawalMethod === 'stripe_connect') {
      return this.calculateStripeFee(this.withdrawalAmount);
    }
    return 0;
  }

  getNetAmount(): number {
    const fee = this.getWithdrawalFee();
    return this.withdrawalAmount - fee;
  }

  async showPayPalFeeInfo() {
    const alert = await this.alertController.create({
      header: 'PayPal Fee Information',
      message: 'PayPal charges a 2% fee (minimum $0.25, maximum $20) for instant payouts to your PayPal account. <strong>This fee is charged by PayPal, not by us.</strong> We do not receive any portion of this fee.',
      buttons: ['Got it']
    });
    await alert.present();
  }

  async confirmWithdrawal() {
    if (!this.canWithdraw()) {
      return;
    }

    // Show confirmation alert
    const alert = await this.alertController.create({
      header: 'Confirm Withdrawal',
      message: `Are you sure you want to withdraw $${this.withdrawalAmount.toFixed(2)}? This will be sent to your ${this.selectedWithdrawalMethod === 'stripe_connect' ? 'Stripe Connect' : 'PayPal'} account.`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'secondary'
        },
        {
          text: 'Confirm',
          handler: async () => {
            this.isWithdrawalModalOpen = false;
            await this.processWithdrawal(this.withdrawalAmount, this.selectedWithdrawalMethod!);
          }
        }
      ]
    });

    await alert.present();
  }

  async processWithdrawal(amount: number, method: string) {
    // Stripe has no minimum withdrawal amount, PayPal requires $10
    const minAmount = method === 'stripe_connect' ? 0.01 : 10;
    if (amount < minAmount) {
      const toast = await this.toastController.create({
        message: method === 'stripe_connect' 
          ? 'Please enter a valid withdrawal amount'
          : 'Minimum withdrawal amount is $10',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
      return;
    }

    if (amount > this.balance.available) {
      const toast = await this.toastController.create({
        message: 'Insufficient balance',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
      return;
    }

    this.withdrawing = true;

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/withdrawals/request`, {
          amount,
          method
        }, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success) {
        const toast = await this.toastController.create({
          message: `Withdrawal of $${amount.toFixed(2)} requested successfully! Processing within 1-2 business days.`,
          duration: 4000,
          color: 'success'
        });
        await toast.present();

        // Reload data
        await Promise.all([
          this.loadBalance(),
          this.loadWithdrawalHistory()
        ]);
      }
    } catch (error: any) {
      console.error('❌ Error requesting withdrawal:', error);
      
      const toast = await this.toastController.create({
        message: error.error?.message || 'Failed to request withdrawal. Please try again.',
        duration: 4000,
        color: 'danger'
      });
      await toast.present();
    } finally {
      this.withdrawing = false;
    }
  }

  getWithdrawalStatusColor(status: string): string {
    switch(status) {
      case 'completed':
        return 'success';
      case 'processing':
        return 'primary';
      case 'pending':
        return 'warning';
      case 'failed':
      case 'cancelled':
        return 'danger';
      default:
        return 'medium';
    }
  }

  getWithdrawalStatusText(status: string): string {
    switch(status) {
      case 'completed':
        return 'Completed';
      case 'processing':
        return 'Processing';
      case 'pending':
        return 'Pending';
      case 'failed':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  }

  getWithdrawalMethodLabel(method: string): string {
    switch(method) {
      case 'stripe_connect':
        return 'Stripe';
      case 'paypal':
        return 'PayPal';
      default:
        return method;
    }
  }
}


