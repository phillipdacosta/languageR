import { Component, OnInit, OnDestroy, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, CUSTOM_ELEMENTS_SCHEMA, ChangeDetectorRef } from '@angular/core';
import '@dotlottie/player-component';
import { CommonModule, Location } from '@angular/common';
import { IonicModule, AlertController, ToastController, ModalController, NavController, ViewWillEnter, InfiniteScrollCustomEvent } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../services/user.service';
import { WebSocketService } from '../services/websocket.service';
import { environment } from '../../environments/environment';
import { firstValueFrom, filter, takeUntil } from 'rxjs';
import { Subject, Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { formatDateInTz, formatTimeInTz } from '../shared/timezone.utils';

// Register Chart.js components
Chart.register(...registerables);

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
  stripeFee: number;
  refundAmount?: number;
  refundReason?: string;
  status: 'paid' | 'pending' | 'in_progress' | 'processing' | 'scheduled' | 'cancelled' | 'refunded' | 'partially_refunded' | 'class_scheduled' | 'succeeded';
  lessonStatus: string;
  classStatus?: string;
  lessonId: string;
  classId?: string;
  className?: string;
  isClassPayment?: boolean;
  isMaterialPurchase?: boolean;
  materialId?: string;
  materialTitle?: string;
  materialType?: string;
  paymentType?: string;
  transferStatus?: string;
  cancelReason?: string;
  formattedDate?: string;
  formattedTime?: string;
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
  imports: [CommonModule, IonicModule, RouterModule, FormsModule, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class EarningsPage implements OnInit, OnDestroy, AfterViewInit, ViewWillEnter {
  // Inline mode: when embedded inside another page (e.g., home page)
  @Input() inline: boolean = false;
  @Output() goBackEvent = new EventEmitter<void>();
  @Output() balanceChanged = new EventEmitter<{ available: number; pending: number }>();

  // Earnings chart
  @ViewChild('earningsChartCanvas') earningsChartCanvas!: ElementRef<HTMLCanvasElement>;
  private earningsChart: Chart | null = null;
  chartPeriod: '1m' | '6m' | 'all' = '1m';
  chartPeriodLabel: string = '';
  chartTotal: string = '$0.00';
  chartHasData: boolean = false;
  private userJoinDate: Date = new Date();

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
  filteredPayments: PaymentBreakdown[] = [];
  displayedPayments: PaymentBreakdown[] = [];
  displayLimit: number = 20;
  allTransactionsLoaded: boolean = false;
  withdrawalHistory: WithdrawalHistory[] = [];
  
  // Filters
  selectedDateRange: 'all' | 'today' | 'week' | 'month' | 'year' | 'custom' = 'all';
  selectedStudent: string = 'all';
  selectedStatus: string = 'all';
  customStartDate: string = '';
  customEndDate: string = '';
  
  // Filter options
  uniqueStudents: Array<{ id: string; name: string; picture?: string }> = [];
  uniqueStatuses: string[] = [];
  
  error: string | null = null;
  payoutProvider: string = 'none';
  payoutMethodConfigured: boolean = false;
  paypalEmail: string = '';
  stripeConnectAccountId: string = '';
  
  // Filters modal state
  isFiltersModalOpen: boolean = false;
  activeFilterCount: number = 0;
  dateRangeLabel: string = '';
  studentFilterLabel: string = '';
  statusFilterLabel: string = '';

  // Withdrawal modal state
  isWithdrawalModalOpen: boolean = false;
  withdrawalAmount: number = 0;
  selectedWithdrawalMethod: 'stripe_connect' | 'paypal' | null = null;
  withdrawing: boolean = false;

  // Withdrawal success animation state
  withdrawalSuccess: boolean = false;
  withdrawalSuccessRevealed: boolean = false;
  withdrawalSuccessAmount: string = '';
  withdrawalSuccessMethod: string = '';
  withdrawalModalDismissing: boolean = false;
  
  // Wallet visibility (tied to profile setting)
  showWalletBalance = false; // Hide by default
  walletTemporarilyVisible = false; // For mobile tap-to-reveal

  userTz: string = '';
  
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
    private modalController: ModalController,
    private navCtrl: NavController,
    private translateService: TranslateService,
    private cdr: ChangeDetectorRef
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
          this.userTz = user.profile.timezone || '';
        }
      });
  }

  async ngOnInit() {
    // Load wallet visibility setting from user profile
    await this.loadWalletVisibilitySetting();

    // Load user join date for earnings chart
    try {
      const user = await firstValueFrom(this.userService.getCurrentUser(true));
      if (user?.createdAt) {
        this.userJoinDate = new Date(user.createdAt);
      }
      if (user?.profile?.timezone) {
        this.userTz = user.profile.timezone;
      }
    } catch (e) {
      // fallback: userJoinDate stays as now
    }
    
    // Load ALL data before revealing the UI (prevents $0.00 flash)
    this.loading = true;
    try {
      await Promise.all([
        this.loadBalance(),
        this.loadEarnings(),
        this.loadWithdrawalHistory()
      ]);
    } finally {
      this.loading = false;
    }
    // Create chart after all data (balance + payments) is loaded
    setTimeout(() => this.createEarningsChart(), 50);
    this.setupWebSocketListeners();
  }

  ngAfterViewInit() {
    // Chart will be created after data loads (if not already)
    setTimeout(() => this.createEarningsChart(), 150);
  }

  /**
   * Ionic lifecycle hook - called every time the page is about to enter
   * This ensures data is refreshed when navigating back to the page
   */
  async ionViewWillEnter() {
    console.log('💰 [EARNINGS] Page entering - refreshing data...');
    // Load ALL data before revealing the UI (prevents $0.00 flash)
    this.loading = true;
    try {
      await Promise.all([
        this.loadBalance(),
        this.loadEarnings(),
        this.loadWithdrawalHistory()
      ]);
    } finally {
      this.loading = false;
    }
    // Create chart with fresh data (balance + payments)
    setTimeout(() => this.createEarningsChart(), 50);
  }
  
  // Load wallet visibility setting from user profile
  async loadWalletVisibilitySetting() {
    try {
      const user = await firstValueFrom(this.userService.getCurrentUser(true));
      if (user?.profile) {
        this.showWalletBalance = user.profile.showWalletBalance || false;
        if (user.profile.timezone) {
          this.userTz = user.profile.timezone;
        }
      }
    } catch (error) {
      console.error('❌ Error loading wallet visibility setting:', error);
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
    if (this.earningsChart) {
      this.earningsChart.destroy();
      this.earningsChart = null;
    }
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
    this.error = null;

    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/payments/tutor/earnings?limit=0`, {
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
        
        this.computePaymentDisplayDates();
        this.extractFilterOptions();
        this.applyFilters();
        this.updateFilterState();
      }
    } catch (error: any) {
      console.error('❌ Error loading earnings:', error);
      this.error = this.translateService.instant('EARNINGS.ERROR_LOAD');
    }
  }

  private computePaymentDisplayDates() {
    const tz = this.userTz || undefined;
    for (const p of this.recentPayments) {
      p.formattedDate = p.date ? formatDateInTz(p.date, tz, { month: 'short', day: 'numeric', year: undefined }) : '';
      p.formattedTime = p.startTime
        ? formatTimeInTz(p.startTime, tz)
        : (p.paymentType === 'tip' && p.date ? formatTimeInTz(p.date, tz) : '');
    }
  }

  getTransferredLabel(): string {
    switch(this.payoutProvider) {
      case 'stripe':
        return this.translateService.instant('EARNINGS.TRANSFER_STRIPE');
      case 'paypal':
        return this.translateService.instant('EARNINGS.TRANSFER_PAYPAL');
      case 'manual':
        return this.translateService.instant('EARNINGS.TRANSFER_MANUAL');
      default:
        return this.translateService.instant('EARNINGS.TRANSFER_DEFAULT');
    }
  }

  goToHome() {
    this.router.navigate(['/tabs/home']);
  }

  goBack() {
    if (this.inline) {
      this.goBackEvent.emit();
    } else {
      this.navCtrl.back();
    }
  }

  viewLesson(lessonId: string) {
    this.router.navigate(['/lesson-analysis', lessonId]);
  }

  viewEvent(lessonId?: string, classId?: string) {
    // The event-details page handles both lessons and classes via the same route
    // It will try to load a lesson first, then fall back to class if not found
    const eventId = lessonId || classId;
    if (eventId) {
      this.router.navigate(['/event', eventId]);
    }
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
        return this.translateService.instant('EARNINGS.STATUS_TRANSFERRED');
      case 'in_progress':
        return this.translateService.instant('EARNINGS.STATUS_IN_PROGRESS');
      case 'processing':
        return this.translateService.instant('EARNINGS.STATUS_PROCESSING');
      case 'scheduled':
      case 'class_scheduled':
        return this.translateService.instant('EARNINGS.STATUS_SCHEDULED');
      case 'cancelled':
        return this.translateService.instant('EARNINGS.STATUS_CANCELLED');
      case 'refunded':
        return this.translateService.instant('EARNINGS.STATUS_REFUNDED');
      case 'partially_refunded':
        return this.translateService.instant('EARNINGS.STATUS_REDUCED');
      case 'succeeded':
        return this.translateService.instant('EARNINGS.STATUS_AVAILABLE');
      default:
        return this.translateService.instant('EARNINGS.STATUS_PENDING');
    }
  }

  private readonly backendReasonMap: Record<string, string> = {
    'No-show by both parties': 'EARNINGS.REASON_NO_SHOW_BOTH',
    'No-show by both parties - payment auto-released': 'EARNINGS.REASON_NO_SHOW_BOTH_RELEASED',
    'Student no-show (tutor waited)': 'EARNINGS.REASON_STUDENT_NO_SHOW',
    'Student no-show (tutor waited) - 50% fee charged': 'EARNINGS.REASON_STUDENT_NO_SHOW_FEE',
    'Tutor no-show (student waited)': 'EARNINGS.REASON_TUTOR_NO_SHOW',
    'no_show': 'EARNINGS.REASON_NO_SHOW',
    'no_show_both_parties': 'EARNINGS.REASON_NO_SHOW_BOTH',
    'class_no_show': 'EARNINGS.REASON_CLASS_NO_SHOW',
    'minimum_not_met': 'EARNINGS.REASON_MINIMUM_NOT_MET',
    'class_cancelled_minimum_not_met': 'EARNINGS.REASON_CLASS_MIN_NOT_MET',
    'tutor_cancelled': 'EARNINGS.REASON_TUTOR_CANCELLED',
    'student_cancelled': 'EARNINGS.REASON_STUDENT_CANCELLED',
    'class_cancelled_by_tutor': 'EARNINGS.REASON_CLASS_CANCELLED_TUTOR',
    'payment_failed': 'EARNINGS.REASON_PAYMENT_FAILED',
    'schedule_conflict': 'EARNINGS.REASON_SCHEDULE_CONFLICT',
    'not_prepared': 'EARNINGS.REASON_NOT_PREPARED',
    'technical_issues': 'EARNINGS.REASON_TECHNICAL_ISSUES',
    'found_different_tutor': 'EARNINGS.REASON_FOUND_DIFFERENT_TUTOR',
  };

  translateBackendReason(reason: string | undefined | null): string | null {
    if (!reason) return null;
    const key = this.backendReasonMap[reason];
    if (key) return this.translateService.instant(key);
    if (reason.startsWith('Admin investigation:')) {
      const note = reason.replace('Admin investigation:', '').trim();
      return this.translateService.instant('EARNINGS.REASON_ADMIN_INVESTIGATION', { note });
    }
    return reason;
  }

  getStatusNote(payment: PaymentBreakdown): string | null {
    if (payment.status === 'refunded') {
      return this.translateBackendReason(payment.refundReason) || this.translateService.instant('EARNINGS.NOTE_REFUNDED');
    }
    if (payment.status === 'partially_refunded') {
      return this.translateBackendReason(payment.refundReason) || this.translateService.instant('EARNINGS.NOTE_REDUCED', { amount: (payment.refundAmount || 0).toFixed(2) });
    }
    if (payment.status === 'cancelled') {
      return this.translateBackendReason(payment.cancelReason) || (payment.isClassPayment
        ? this.translateService.instant('EARNINGS.NOTE_CLASS_CANCELLED')
        : this.translateService.instant('EARNINGS.NOTE_LESSON_CANCELLED'));
    }
    if (payment.cancelReason && payment.lessonStatus === 'cancelled') {
      return this.translateBackendReason(payment.cancelReason);
    }
    if (payment.status === 'processing' || payment.lessonStatus === 'ended_early') {
      return this.translateService.instant('EARNINGS.NOTE_PROCESSING_HOLD');
    }
    if (payment.status === 'in_progress') {
      return payment.isClassPayment
        ? this.translateService.instant('EARNINGS.NOTE_CLASS_IN_PROGRESS')
        : this.translateService.instant('EARNINGS.NOTE_LESSON_IN_PROGRESS');
    }
    if (payment.status === 'scheduled' || payment.status === 'class_scheduled') {
      return '';
    }
    if (payment.paymentType === 'tip' && payment.stripeFee > 0) {
      return this.translateService.instant('EARNINGS.NOTE_CARD_FEE', { amount: payment.stripeFee.toFixed(2) });
    }
    return null;
  }

  // ============================================================
  // EARNINGS CHART METHODS
  // ============================================================

  setChartPeriod(period: '1m' | '6m' | 'all') {
    this.chartPeriod = period;
    this.createEarningsChart();
  }

  /**
   * Builds weekly earnings data starting from the user's join date.
   * Each bucket represents one week (Mon-Sun).
   */
  private getChartData(): {
    labels: string[];
    data: number[];
    total: number;
    buckets: { start: Date; end: Date; label: string; value: number; isPartial: boolean }[];
    now: Date;
  } {
    const now = new Date();
    const weekMs = 7 * 24 * 60 * 60 * 1000;

    // Determine the effective start date based on period
    let periodStart: Date;
    switch (this.chartPeriod) {
      case '1m':
        periodStart = new Date(now.getTime() - 4 * weekMs);
        this.chartPeriodLabel = this.translateService.instant('EARNINGS.CHART_PERIOD_1M');
        break;
      case '6m':
        periodStart = new Date(now.getTime() - 26 * weekMs);
        this.chartPeriodLabel = this.translateService.instant('EARNINGS.CHART_PERIOD_6M');
        break;
      case 'all':
      default:
        periodStart = new Date(this.userJoinDate);
        this.chartPeriodLabel = this.translateService.instant('EARNINGS.CHART_PERIOD_ALL');
        break;
    }

    // For fixed-range periods (1m, 6m), always show the full range so there are
    // enough data points for smooth curves. Only "All Time" starts from the join date.
    const chartStart = this.chartPeriod === 'all'
      ? new Date(Math.max(this.userJoinDate.getTime(), periodStart.getTime()))
      : periodStart;

    // Align to the Monday of the starting week
    const startDay = chartStart.getDay(); // 0=Sun, 1=Mon, ...
    const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
    const firstMonday = new Date(chartStart);
    firstMonday.setDate(chartStart.getDate() + mondayOffset);
    firstMonday.setHours(0, 0, 0, 0);

    // Build weekly buckets from firstMonday to now
    const buckets: { start: Date; end: Date; label: string; value: number; isPartial: boolean }[] = [];
    let current = new Date(firstMonday);
    const dateFmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

    while (current <= now) {
      const weekEnd = new Date(current.getTime() + weekMs - 1);
      const isPartial = weekEnd > now;
      const label = formatDateInTz(current, this.userTz || undefined, { month: 'short', day: 'numeric', year: undefined });
      buckets.push({
        start: new Date(current),
        end: weekEnd,
        label: label.toUpperCase(),
        value: 0,
        isPartial
      });
      current = new Date(current.getTime() + weekMs);
    }

    // Filter to only fully-confirmed earnings (not pending/on_hold).
    const confirmedTransferStatuses = ['available', 'pending_withdrawal', 'withdrawn', 'succeeded'];
    const apiSupportsTransferStatus = this.recentPayments.some(p => !!p.transferStatus);

    const validPayments = apiSupportsTransferStatus
      ? this.recentPayments.filter(p =>
          p.transferStatus != null && confirmedTransferStatuses.includes(p.transferStatus))
      : this.recentPayments.filter(p =>
          p.status === 'paid' || p.status === 'succeeded');

    // Fill buckets
    let total = 0;
    validPayments.forEach(p => {
      const paymentDate = new Date(p.date);
      const earned = p.tutorPayout || 0;

      for (const bucket of buckets) {
        if (paymentDate >= bucket.start && paymentDate <= bucket.end) {
          bucket.value += earned;
          break;
        }
      }
      if (paymentDate >= firstMonday && paymentDate <= now) {
        total += earned;
      }
    });

    const labels = buckets.map(b => b.label);
    const data = buckets.map(b => b.value);
    return { labels, data, total, buckets, now };
  }

  createEarningsChart() {
    if (!this.earningsChartCanvas) return;

    const ctx = this.earningsChartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    // Cleanup existing chart
    if (this.earningsChart) {
      this.earningsChart.destroy();
    }

    const { labels, data, total, buckets, now } = this.getChartData();
    this.chartTotal = `$${total.toFixed(2)}`;
    this.chartHasData = data.some(v => v > 0);

    const upperLabels = labels.map(l => l.toUpperCase());

    // Create gradient fill (light blue fading to transparent)
    const fillGradient = ctx.createLinearGradient(0, 0, 0, 280);
    fillGradient.addColorStop(0, 'rgba(110, 172, 217, 0.20)');
    fillGradient.addColorStop(0.6, 'rgba(110, 172, 217, 0.06)');
    fillGradient.addColorStop(1, 'rgba(110, 172, 217, 0.0)');

    const maxLabels = data.length <= 6 ? data.length : this.chartPeriod === '1m' ? 5 : this.chartPeriod === '6m' ? 8 : 10;

    // Find indices of peak values (top 3) for showing point dots
    const sortedIndices = data
      .map((val, idx) => ({ val, idx }))
      .sort((a, b) => b.val - a.val)
      .slice(0, 3)
      .map(item => item.idx);

    const lastIdx = data.length - 1;
    const hasPartialWeek = buckets.length > 0 && buckets[lastIdx]?.isPartial;

    // Always show partial-week point; show top-3 peaks for complete weeks
    const pointRadii = data.map((_, idx) => {
      if (hasPartialWeek && idx === lastIdx) return 5;
      return sortedIndices.includes(idx) ? 5 : 0;
    });
    const pointHoverRadii = data.map(() => 6);

    // Partial-week point uses a lighter, semi-transparent style
    const pointBgColors = data.map((_, idx) =>
      hasPartialWeek && idx === lastIdx ? 'rgba(110, 172, 217, 0.45)' : '#6eacd9'
    );
    const pointBorderColors = data.map((_, idx) =>
      hasPartialWeek && idx === lastIdx ? 'rgba(110, 172, 217, 0.6)' : '#ffffff'
    );

    const dateFmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels: upperLabels,
        datasets: [{
          label: this.translateService.instant('EARNINGS.CHART_LABEL'),
          data: data,
          borderColor: '#6eacd9',
          backgroundColor: fillGradient,
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointRadius: pointRadii,
          pointHoverRadius: pointHoverRadii,
          pointBackgroundColor: pointBgColors,
          pointBorderColor: pointBorderColors,
          pointBorderWidth: 2.5,
          pointHoverBackgroundColor: '#5a9ac8',
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 3,
          segment: {
            borderDash: (segCtx: any) => {
              if (hasPartialWeek && segCtx.p1DataIndex === lastIdx) return [6, 4];
              return undefined as any;
            }
          }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 1000,
          easing: 'easeOutQuart',
        },
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(34, 34, 34, 0.95)',
            padding: { top: 10, bottom: 10, left: 14, right: 14 },
            cornerRadius: 10,
            titleFont: {
              size: 12,
              weight: 'normal',
              family: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
            },
            titleColor: 'rgba(255, 255, 255, 0.7)',
            bodyFont: {
              size: 16,
              weight: 'bold',
              family: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
            },
            bodyColor: '#ffffff',
            displayColors: false,
            callbacks: {
              title: (tooltipItems) => {
                const idx = tooltipItems[0].dataIndex;
                const bucket = buckets[idx];
                if (!bucket) return '';
                const tz = this.userTz || undefined;
                const startStr = formatDateInTz(bucket.start, tz, { month: 'short', day: 'numeric', year: undefined }).toUpperCase();
                const endDate = bucket.isPartial ? now : bucket.end;
                const endStr = formatDateInTz(endDate, tz, { month: 'short', day: 'numeric', year: undefined }).toUpperCase();
                return `${startStr} – ${endStr}`;
              },
              label: (context) => {
                const idx = context.dataIndex;
                const amount = `$${(context.raw as number).toFixed(2)}`;
                return buckets[idx]?.isPartial ? `${amount} (so far)` : amount;
              }
            }
          }
        },
        scales: {
          y: {
            display: false,
            beginAtZero: true,
            grid: {
              color: 'rgba(0, 0, 0, 0.03)',
              drawTicks: false
            },
            border: {
              display: false
            }
          },
          x: {
            ticks: {
              font: {
                size: 11,
                weight: 'normal',
                family: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
              },
              color: '#b0b0b0',
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: maxLabels,
              padding: 8
            },
            grid: {
              display: false
            },
            border: {
              display: false
            }
          }
        },
        layout: {
          padding: {
            top: 12,
            right: 8,
            bottom: 0,
            left: 8
          }
        }
      }
    };

    this.earningsChart = new Chart(ctx, config);
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
    console.log('Balance available (cached):', this.balance.available);
    console.log('Payout method configured:', this.payoutMethodConfigured);
    
    // Always refresh balance before checking — handles stale data from
    // long-lived tabs or laptop sleep/wake where pending funds became available.
    await this.loadBalance();
    console.log('Balance available (refreshed):', this.balance.available);
    
    if (!this.payoutMethodConfigured) {
      const alert = await this.alertController.create({
        header: this.translateService.instant('EARNINGS.WITHDRAW_METHOD_REQUIRED_TITLE'),
        message: this.translateService.instant('EARNINGS.WITHDRAW_METHOD_REQUIRED_MSG'),
        buttons: [this.translateService.instant('EARNINGS.OK')]
      });
      await alert.present();
      return;
    }

    if (this.balance.available <= 0) {
      const alert = await this.alertController.create({
        header: this.translateService.instant('EARNINGS.WITHDRAW_NO_BALANCE_TITLE'),
        message: this.translateService.instant('EARNINGS.WITHDRAW_NO_BALANCE_MSG'),
        buttons: [this.translateService.instant('EARNINGS.OK')]
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

  onWithdrawalModalDismissed() {
    this.withdrawalSuccess = false;
    this.withdrawalSuccessRevealed = false;
    this.withdrawalSuccessAmount = '';
    this.withdrawalSuccessMethod = '';
    this.withdrawalModalDismissing = false;
  }

  selectWithdrawalMethod(method: 'stripe_connect' | 'paypal') {
    this.selectedWithdrawalMethod = method;
  }

  setMaxWithdrawalAmount() {
    this.withdrawalAmount = this.balance.available;
  }

  // Getter/setter for formatted withdrawal amount input
  get formattedWithdrawalAmount(): string {
    return this.formatCurrency(this.withdrawalAmount);
  }

  set formattedWithdrawalAmount(value: string) {
    // Remove any non-numeric characters except decimal point
    const cleaned = value.replace(/[^0-9.]/g, '');
    const numValue = parseFloat(cleaned);
    if (!isNaN(numValue)) {
      this.withdrawalAmount = numValue;
    } else if (cleaned === '' || cleaned === '.') {
      this.withdrawalAmount = 0;
    }
  }

  onWithdrawalKeydown(event: KeyboardEvent) {
    const allowed = [
      'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Home', 'End'
    ];
    if (allowed.includes(event.key)) return;
    if ((event.metaKey || event.ctrlKey) && ['a', 'c', 'v', 'x', 'z'].includes(event.key)) return;
    if (event.key === '.' && !(event.target as HTMLInputElement).value.includes('.')) return;
    if (event.key >= '0' && event.key <= '9') return;
    event.preventDefault();
  }

  onWithdrawalAmountBlur() {
    this.withdrawalAmount = parseFloat(this.formatCurrency(this.withdrawalAmount));
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

  /**
   * Format amount to always show 2 decimal places (e.g., 0 -> "0.00", 10 -> "10.00")
   */
  formatCurrency(amount: number | null | undefined): string {
    if (amount == null || isNaN(amount)) {
      return '0.00';
    }
    return amount.toFixed(2);
  }

  async showPayPalFeeInfo() {
    const alert = await this.alertController.create({
      header: this.translateService.instant('EARNINGS.WITHDRAW_PAYPAL_FEE_TITLE'),
      message: this.translateService.instant('EARNINGS.WITHDRAW_PAYPAL_FEE_MSG'),
      buttons: [this.translateService.instant('EARNINGS.GOT_IT')]
    });
    await alert.present();
  }

  async confirmWithdrawal() {
    if (!this.canWithdraw()) {
      return;
    }

    // Show confirmation alert
    const methodLabel = this.selectedWithdrawalMethod === 'stripe_connect' ? 'Stripe Connect' : 'PayPal';
    const alert = await this.alertController.create({
      header: this.translateService.instant('EARNINGS.WITHDRAW_CONFIRM_TITLE'),
      message: this.translateService.instant('EARNINGS.WITHDRAW_CONFIRM_MSG', { amount: this.withdrawalAmount.toFixed(2), method: methodLabel }),
      buttons: [
        {
          text: this.translateService.instant('EARNINGS.WITHDRAW_CANCEL'),
          role: 'cancel',
          cssClass: 'secondary'
        },
        {
          text: this.translateService.instant('EARNINGS.WITHDRAW_CONFIRM_BTN'),
          handler: async () => {
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
          ? this.translateService.instant('EARNINGS.WITHDRAW_MIN_STRIPE_ERROR')
          : this.translateService.instant('EARNINGS.WITHDRAW_MIN_PAYPAL_ERROR'),
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
      return;
    }

    if (amount > this.balance.available) {
      const toast = await this.toastController.create({
        message: this.translateService.instant('EARNINGS.WITHDRAW_INSUFFICIENT'),
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
        const methodLabel = method === 'stripe_connect' ? 'Stripe Connect' : 'PayPal';

        this.withdrawalSuccessAmount = '$' + amount.toFixed(2);
        this.withdrawalSuccessMethod = methodLabel;
        this.withdrawalSuccess = true;
        this.withdrawalSuccessRevealed = false;
        this.cdr.detectChanges();

        setTimeout(() => {
          this.withdrawalSuccessRevealed = true;
          this.cdr.detectChanges();
        }, 2400);

        await Promise.all([
          this.loadBalance(),
          this.loadWithdrawalHistory()
        ]);

        this.balanceChanged.emit({
          available: this.balance.available,
          pending: this.balance.pending
        });
      }
    } catch (error: any) {
      console.error('❌ Error requesting withdrawal:', error);
      
      const toast = await this.toastController.create({
        message: error.error?.message || this.translateService.instant('EARNINGS.WITHDRAW_ERROR'),
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
        return this.translateService.instant('EARNINGS.WITHDRAW_STATUS_COMPLETED');
      case 'processing':
        return this.translateService.instant('EARNINGS.WITHDRAW_STATUS_PROCESSING');
      case 'pending':
        return this.translateService.instant('EARNINGS.WITHDRAW_STATUS_PENDING');
      case 'failed':
        return this.translateService.instant('EARNINGS.WITHDRAW_STATUS_FAILED');
      case 'cancelled':
        return this.translateService.instant('EARNINGS.WITHDRAW_STATUS_CANCELLED');
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

  // Filter methods
  extractFilterOptions() {
    // Extract unique students
    const studentMap = new Map<string, { id: string; name: string; picture?: string }>();
    const statusSet = new Set<string>();

    this.recentPayments.forEach(payment => {
      // Add student (use studentName as the key since it's unique per student)
      if (payment.studentName) {
        if (!studentMap.has(payment.studentName)) {
          studentMap.set(payment.studentName, {
            id: payment.studentName,
            name: payment.studentName,
            picture: payment.studentPicture
          });
        }
      }

      // Add status
      if (payment.status) {
        statusSet.add(payment.status);
      }
    });

    this.uniqueStudents = Array.from(studentMap.values()).sort((a, b) => 
      a.name.localeCompare(b.name)
    );
    this.uniqueStatuses = Array.from(statusSet).sort();
  }

  applyFilters() {
    let filtered = [...this.recentPayments];

    // Date filter
    if (this.selectedDateRange !== 'all') {
      const now = new Date();
      let startDate: Date;

      switch (this.selectedDateRange) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'year':
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
        case 'custom':
          if (this.customStartDate && this.customEndDate) {
            const start = new Date(this.customStartDate);
            const end = new Date(this.customEndDate);
            end.setHours(23, 59, 59, 999); // End of day
            filtered = filtered.filter(payment => {
              const paymentDate = new Date(payment.date);
              return paymentDate >= start && paymentDate <= end;
            });
          }
          break;
        default:
          break;
      }

      if (this.selectedDateRange !== 'custom' && startDate!) {
        filtered = filtered.filter(payment => {
          const paymentDate = new Date(payment.date);
          return paymentDate >= startDate!;
        });
      }
    }

    // Student filter
    if (this.selectedStudent !== 'all') {
      filtered = filtered.filter(payment => {
        return payment.studentName === this.selectedStudent;
      });
    }

    // Status filter
    if (this.selectedStatus !== 'all') {
      filtered = filtered.filter(payment => payment.status === this.selectedStatus);
    }

    this.filteredPayments = filtered;
    this.displayLimit = 20;
    this.updateDisplayedPayments();
  }

  updateDisplayedPayments() {
    this.displayedPayments = this.filteredPayments.slice(0, this.displayLimit);
    this.allTransactionsLoaded = this.displayedPayments.length >= this.filteredPayments.length;
  }

  loadMoreTransactions(event: InfiniteScrollCustomEvent) {
    this.displayLimit += 20;
    this.updateDisplayedPayments();
    event.target.complete();
    if (this.allTransactionsLoaded) {
      event.target.disabled = true;
    }
  }

  onFilterChange() {
    this.applyFilters();
    this.updateFilterState();
  }

  // Filters modal
  openFiltersModal() {
    this.isFiltersModalOpen = true;
  }

  closeFiltersModal() {
    this.isFiltersModalOpen = false;
  }

  updateFilterState() {
    // Count active filters
    let count = 0;
    if (this.selectedDateRange !== 'all') count++;
    if (this.selectedStudent !== 'all') count++;
    if (this.selectedStatus !== 'all') count++;
    this.activeFilterCount = count;

    // Compute date range label
    switch (this.selectedDateRange) {
      case 'today': this.dateRangeLabel = this.translateService.instant('EARNINGS.FILTER_TODAY'); break;
      case 'week': this.dateRangeLabel = this.translateService.instant('EARNINGS.FILTER_LAST_7_DAYS'); break;
      case 'month': this.dateRangeLabel = this.translateService.instant('EARNINGS.FILTER_THIS_MONTH'); break;
      case 'year': this.dateRangeLabel = this.translateService.instant('EARNINGS.FILTER_THIS_YEAR'); break;
      case 'custom':
        if (this.customStartDate && this.customEndDate) {
          this.dateRangeLabel = `${this.customStartDate} – ${this.customEndDate}`;
        } else {
          this.dateRangeLabel = this.translateService.instant('EARNINGS.FILTER_CUSTOM_RANGE');
        }
        break;
      default: this.dateRangeLabel = ''; break;
    }

    // Student label
    if (this.selectedStudent !== 'all') {
      const s = this.uniqueStudents.find(s => s.name === this.selectedStudent);
      this.studentFilterLabel = s?.name || this.selectedStudent;
    } else {
      this.studentFilterLabel = '';
    }

    // Status label
    this.statusFilterLabel = this.selectedStatus !== 'all'
      ? this.getStatusText(this.selectedStatus)
      : '';
  }

  clearFilters() {
    this.selectedDateRange = 'all';
    this.selectedStudent = 'all';
    this.selectedStatus = 'all';
    this.customStartDate = '';
    this.customEndDate = '';
    this.applyFilters();
    this.updateFilterState();
  }

  hasActiveFilters(): boolean {
    return this.selectedDateRange !== 'all' || 
           this.selectedStudent !== 'all' || 
           this.selectedStatus !== 'all';
  }
}


