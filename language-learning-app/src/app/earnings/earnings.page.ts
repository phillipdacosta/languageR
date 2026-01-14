import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, IonInfiniteScroll } from '@ionic/angular';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../services/user.service';
import { WebSocketService } from '../services/websocket.service';
import { environment } from '../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { Subscription } from 'rxjs';

interface PaymentBreakdown {
  id: string;
  studentName: string;
  studentPicture: string | null;
  date: Date;
  lessonTime: Date | null;
  lessonEndTime: Date | null;
  tutorPayout: number;
  platformFee: number;
  status: 'paid' | 'pending' | 'in_progress' | 'processing' | 'scheduled' | 'cancelled';
  lessonStatus: string;
  cancelReason: string | null;
  lessonId: string;
  receiptUrl: string | null;
  stripeChargeId: string | null;
  paypalTransactionId: string | null;
}

@Component({
  selector: 'app-earnings',
  templateUrl: './earnings.page.html',
  styleUrls: ['./earnings.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule]
})
export class EarningsPage implements OnInit, OnDestroy {
  loading: boolean = true;
  totalEarnings: number = 0;
  pendingEarnings: number = 0;
  recentPayments: PaymentBreakdown[] = [];
  error: string | null = null;
  payoutProvider: string = 'unknown';
  payoutHelpText: string = '';
  private subscriptions: Subscription[] = [];
  
  // Pagination
  currentPage: number = 1;
  pageSize: number = 20;
  hasMoreData: boolean = true;
  loadingMore: boolean = false;
  
  // Filters
  showFilters: boolean = false;
  filters = {
    status: 'all' as 'all' | 'paid' | 'pending' | 'cancelled' | 'in_progress',
    dateFrom: '',
    dateTo: '',
    studentSearch: ''
  };
  
  @ViewChild(IonInfiniteScroll) infiniteScroll?: IonInfiniteScroll;

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private websocketService: WebSocketService
  ) {}

  async ngOnInit() {
    await this.loadEarnings();
    this.setupWebSocketListeners();
    
    // Check for scrollToLesson query param
    this.route.queryParams.subscribe(params => {
      const lessonId = params['scrollToLesson'];
      if (lessonId) {
        // Wait a bit for the view to render
        setTimeout(() => {
          this.scrollToLesson(lessonId);
        }, 500);
      }
    });
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
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

  async loadEarnings(reset: boolean = true) {
    if (reset) {
      this.loading = true;
      this.currentPage = 1;
      this.recentPayments = [];
      this.hasMoreData = true;
    } else {
      this.loadingMore = true;
    }
    
    this.error = null;

    try {
      // Build query params
      const params: any = {
        page: this.currentPage,
        limit: this.pageSize
      };
      
      if (this.filters.status !== 'all') {
        params.status = this.filters.status;
      }
      if (this.filters.dateFrom) {
        params.dateFrom = this.filters.dateFrom;
      }
      if (this.filters.dateTo) {
        params.dateTo = this.filters.dateTo;
      }
      if (this.filters.studentSearch) {
        params.studentSearch = this.filters.studentSearch;
      }
      
      const queryString = new URLSearchParams(params).toString();
      
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/payments/tutor/earnings?${queryString}`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success) {
        // Only update totals on first load
        if (reset) {
          this.totalEarnings = response.totalEarnings || 0;
          this.pendingEarnings = response.pendingEarnings || 0;
          this.payoutProvider = response.payoutProvider || 'unknown';
          this.updatePayoutHelpText();
        }
        
        const newPayments = response.recentPayments || [];
        
        // Append or replace payments
        if (reset) {
          this.recentPayments = newPayments;
        } else {
          this.recentPayments = [...this.recentPayments, ...newPayments];
        }
        
        // Check if there's more data
        this.hasMoreData = newPayments.length === this.pageSize;
        
        console.log(`💰 Loaded ${newPayments.length} payments (page ${this.currentPage}), hasMore: ${this.hasMoreData}`);
      }
    } catch (error: any) {
      console.error('❌ Error loading earnings:', error);
      this.error = 'Failed to load earnings. Please try again.';
    } finally {
      this.loading = false;
      this.loadingMore = false;
    }
  }
  
  async loadMore(event: any) {
    if (!this.hasMoreData || this.loadingMore) {
      event.target.complete();
      return;
    }
    
    this.currentPage++;
    await this.loadEarnings(false);
    event.target.complete();
  }
  
  toggleFilters() {
    this.showFilters = !this.showFilters;
  }
  
  async applyFilters() {
    await this.loadEarnings(true);
  }
  
  async clearFilters() {
    this.filters = {
      status: 'all',
      dateFrom: '',
      dateTo: '',
      studentSearch: ''
    };
    await this.loadEarnings(true);
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

  updatePayoutHelpText(): void {
    switch(this.payoutProvider) {
      case 'stripe':
        this.payoutHelpText = 'Earnings are transferred to your Stripe account within 2-4 business days after lesson completion (7-14 days for new accounts establishing payout schedules).';
        break;
      case 'paypal':
        this.payoutHelpText = 'Earnings are transferred to your PayPal account within 1-2 business days after lesson completion.';
        break;
      case 'manual':
        this.payoutHelpText = 'Earnings are processed manually by our team. Transfer timing varies based on your payment arrangement. Contact support for specific details.';
        break;
      default:
        this.payoutHelpText = 'Set up your payout method in Settings to start receiving earnings from completed lessons.';
    }
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
      case 'cancelled':
        return 'danger';
      case 'in_progress':
        return 'primary';
      case 'processing':
        return 'warning';
      case 'scheduled':
        return 'medium';
      default:
        return 'warning';
    }
  }

  getStatusIcon(status: string): string {
    switch(status) {
      case 'paid':
        return 'checkmark-circle';
      case 'cancelled':
        return 'close-circle';
      case 'in_progress':
        return 'videocam';
      case 'processing':
        return 'hourglass';
      case 'scheduled':
        return 'calendar';
      default:
        return 'time';
    }
  }

  getStatusText(status: string): string {
    switch(status) {
      case 'paid':
        return 'Transferred';
      case 'cancelled':
        return 'Cancelled - No Payment';
      case 'in_progress':
        return 'In Progress';
      case 'processing':
        return 'Processing Payment';
      case 'scheduled':
        return 'Scheduled';
      default:
        return 'Pending Transfer';
    }
  }

  getStatusNote(payment: PaymentBreakdown): string | null {
    if (payment.status === 'cancelled' && payment.cancelReason) {
      return payment.cancelReason;
    }
    if (payment.status === 'processing' || payment.lessonStatus === 'ended_early') {
      return 'Payment amount will update momentarily';
    }
    if (payment.status === 'in_progress') {
      return 'Lesson currently in progress';
    }
    return null;
  }

  scrollToLesson(lessonId: string) {
    console.log('📍 Attempting to scroll to lesson:', lessonId);
    
    // Find the payment element by lesson ID
    const element = document.getElementById(`payment-${lessonId}`);
    
    if (element) {
      // Scroll into view with smooth animation
      element.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
      
      // Add highlight animation
      element.classList.add('highlight-payment');
      setTimeout(() => {
        element.classList.remove('highlight-payment');
      }, 2000);
      
      console.log('✅ Scrolled to lesson:', lessonId);
    } else {
      console.log('⚠️ Payment element not found for lesson:', lessonId);
    }
  }
}


