import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../services/user.service';
import { environment } from '../../environments/environment';
import { firstValueFrom } from 'rxjs';

interface PlatformRevenue {
  period: {
    start: string;
    end: string;
    days: number;
  };
  summary: {
    totalLessons: number;
    totalGrossRevenue: number;
    totalPlatformFee: number;
    totalStripeFees: number;
    totalNetPlatformRevenue: number;
    totalTutorPayouts: number;
    avgLessonPrice: number;
    avgPlatformFeePerLesson: number;
    avgNetRevenuePerLesson: number;
    platformFeePercentage: number;
    effectiveFeeAfterStripe: number;
  };
  pending: {
    pendingLessons: number;
    totalPendingRevenue: number;
    totalPendingStripeFees: number;
    totalPendingNetRevenue: number;
    nextProcessingTime?: string | null;
  };
  byPaymentMethod: {
    [key: string]: {
      count: number;
      total: number;
      platformFee: number;
    };
  };
  timeline: Array<{
    date: string;
    grossRevenue: number;
    platformFee: number;
    stripeFee: number;
    netRevenue: number;
  }>;
  payments: Array<any>;
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalPayments: number;
    paymentsPerPage: number;
    hasMore: boolean;
  };
  withdrawalInfo?: {
    currentStripeBalance: number;
    stripePendingBalance: number;
    totalOwedToTutors: number;
    breakdown: {
      tutorsPending: number;
      tutorsAvailable: number;
      tutorsCount: number;
    };
    safeToWithdraw: number;
    recognizedRevenue: number;
    discrepancy: number;
    warning: string | null;
  };
}

@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class AdminPage implements OnInit {
  loading = true;
  loadingMore = false;  // NEW: Loading state for pagination
  error: string | null = null;
  revenueData: PlatformRevenue | null = null;
  allPayments: Array<any> = [];  // NEW: Accumulated payments for infinite scroll
  currentPage = 1;  // NEW: Current page number
  
  // Date range filters
  dateRange: 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom' = 'month';  // Added 'custom'
  customStartDate: string = '';
  customEndDate: string = '';
  
  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  async ngOnInit() {
    await this.loadRevenueData();
  }

  async loadRevenueData(resetPage = true) {
    if (resetPage) {
      this.loading = true;
      this.currentPage = 1;
      this.allPayments = [];
    } else {
      this.loadingMore = true;
    }
    
    this.error = null;

    try {
      const { startDate, endDate } = this.getDateRange();
      
      const params: any = {
        page: this.currentPage.toString(),
        limit: '50'
      };
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      
      const queryString = new URLSearchParams(params).toString();
      const url = `${environment.apiUrl}/admin/platform-revenue${queryString ? '?' + queryString : ''}`;
      
      console.log('📊 Fetching revenue data:', url);
      
      const response = await firstValueFrom(
        this.http.get<{ success: boolean; } & PlatformRevenue>(url, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success) {
        if (resetPage) {
          // First page load - replace all data
          this.revenueData = response;
          this.allPayments = response.payments || [];
        } else {
          // Load more - append payments
          this.allPayments = [...this.allPayments, ...(response.payments || [])];
          if (this.revenueData) {
            this.revenueData.payments = this.allPayments;
            this.revenueData.pagination = response.pagination;
          }
        }
        console.log(`✅ Revenue data loaded: ${this.allPayments.length} total payments`);
      }
    } catch (error: any) {
      console.error('❌ Error loading revenue data:', error);
      this.error = error.error?.message || 'Failed to load revenue data. Make sure you have admin access.';
    } finally {
      this.loading = false;
      this.loadingMore = false;
    }
  }

  // NEW: Load more payments (infinite scroll)
  async loadMore(event?: any) {
    if (!this.revenueData?.pagination?.hasMore || this.loadingMore) {
      event?.target?.complete();
      return;
    }

    this.currentPage++;
    await this.loadRevenueData(false);
    event?.target?.complete();
  }

  getDateRange(): { startDate?: string; endDate?: string } {
    const now = new Date();
    let startDate: Date | undefined;
    let endDate: Date = now;
    
    // NEW: Handle custom date range
    if (this.dateRange === 'custom') {
      if (this.customStartDate && this.customEndDate) {
        // Parse the date strings and set to start/end of day in local time
        const start = new Date(this.customStartDate + 'T00:00:00');
        const end = new Date(this.customEndDate + 'T23:59:59');
        
        return {
          startDate: start.toISOString(),
          endDate: end.toISOString()
        };
      }
      // If custom is selected but dates not set, default to month
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else {
      switch (this.dateRange) {
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'quarter':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        case 'all':
          return {};
        default:
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
    }
    
    return {
      startDate: startDate?.toISOString(),
      endDate: endDate.toISOString()
    };
  }

  async changeDateRange(range: 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom') {
    this.dateRange = range;
    if (range !== 'custom') {
      // For non-custom ranges, reload immediately
      await this.loadRevenueData();
    }
    // For custom, wait for user to set dates
  }

  // NEW: Apply custom date range
  async applyCustomDateRange() {
    if (this.customStartDate && this.customEndDate) {
      await this.loadRevenueData();
    }
  }

  formatCurrency(amount: number): string {
    return `$${amount.toFixed(2)}`;
  }

  formatPercent(percent: number): string {
    return `${percent.toFixed(2)}%`;
  }

  formatProcessingTime(isoTime: string): string {
    const processingDate = new Date(isoTime);
    const now = new Date();
    const diffMs = processingDate.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    // Format the date in local time
    const localTime = processingDate.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    // Add relative time if it's within the next 24 hours
    if (diffMs > 0 && diffHours < 24) {
      if (diffHours > 0) {
        return `${localTime} (in ${diffHours}h ${diffMinutes}m)`;
      } else if (diffMinutes > 0) {
        return `${localTime} (in ${diffMinutes} minutes)`;
      } else {
        return `${localTime} (soon)`;
      }
    }
    
    return localTime;
  }

  getPaymentMethodName(method: string): string {
    const names: { [key: string]: string } = {
      'wallet': 'Wallet',
      'card': 'Card',
      'saved-card': 'Saved Card',
      'apple_pay': 'Apple Pay',
      'google_pay': 'Google Pay'
    };
    return names[method] || method;
  }

  getPaymentStatusText(status: string): string {
    const statuses: { [key: string]: string } = {
      'pending': 'Pending',
      'processing': 'Processing',
      'authorized': 'Authorized',
      'succeeded': 'Succeeded',
      'failed': 'Failed',
      'refunded': 'Refunded',
      'partially_refunded': 'Partial Refund',
      'cancelled': 'Cancelled'
    };
    return statuses[status] || status;
  }

  getPaymentStatusColor(status: string): string {
    const colors: { [key: string]: string } = {
      'pending': 'warning',
      'processing': 'warning',
      'authorized': 'warning',
      'succeeded': 'success',
      'failed': 'danger',
      'refunded': 'danger',
      'partially_refunded': 'warning',
      'cancelled': 'medium'
    };
    return colors[status] || 'medium';
  }

  getTransferStatusText(status: string): string {
    const statuses: { [key: string]: string } = {
      'pending': 'Pending',
      'on_hold': 'On Hold (24h)',
      'available': 'Available',
      'pending_withdrawal': 'Withdrawing',
      'withdrawn': 'Withdrawn',
      'awaiting_funds': 'Awaiting',
      'succeeded': 'Succeeded',
      'failed': 'Failed',
      'acknowledged': 'Acknowledged',
      'payout_paused': 'Paused'
    };
    return statuses[status] || status || 'N/A';
  }

  getTransferStatusColor(status: string): string {
    const colors: { [key: string]: string } = {
      'pending': 'warning',
      'on_hold': 'warning',
      'available': 'success',
      'pending_withdrawal': 'primary',
      'withdrawn': 'success',
      'awaiting_funds': 'warning',
      'succeeded': 'success',
      'failed': 'danger',
      'acknowledged': 'success',
      'payout_paused': 'danger'
    };
    return colors[status] || 'medium';
  }

  isPastReleaseDate(releaseDate: string): boolean {
    if (!releaseDate) return false;
    return new Date(releaseDate) <= new Date();
  }

  getProcessingTime(releaseDate: string): string {
    if (!releaseDate) return 'Unknown';
    
    const releaseDateObj = new Date(releaseDate);
    const now = new Date();
    
    // If release date hasn't passed, show when it will be released + processed
    if (releaseDateObj > now) {
      const diffMs = releaseDateObj.getTime() - now.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      
      // The releaseEarnings cron runs every 15 minutes
      // So add up to 15 minutes after the release date
      const maxProcessingTime = new Date(releaseDateObj.getTime() + 15 * 60 * 1000);
      
      if (diffHours > 0) {
        return `in ${diffHours}h ${diffMinutes}m`;
      } else if (diffMinutes > 0) {
        return `in ${diffMinutes}m`;
      } else {
        return 'within 15 min';
      }
    }
    
    // If release date has passed, calculate next cron run (every 15 min)
    const minutesSinceRelease = Math.floor((now.getTime() - releaseDateObj.getTime()) / (1000 * 60));
    const minutesUntilNextRun = 15 - (minutesSinceRelease % 15);
    
    if (minutesUntilNextRun < 15) {
      return `~${minutesUntilNextRun} min`;
    }
    
    return 'soon';
  }

  exportToCSV() {
    if (!this.revenueData || !this.revenueData.payments) return;
    
    const headers = [
      'Date', 'Student', 'Tutor', 'Subject', 'Payment Method',
      'Gross Amount', 'Platform Fee', 'Stripe Fee', 'Net Platform Revenue', 'Tutor Payout'
    ];
    
    const rows = this.revenueData.payments.map(p => [
      new Date(p.date).toLocaleDateString(),
      p.studentName,
      p.tutorName,
      p.subject || 'N/A',
      p.paymentMethod,
      p.grossAmount,
      p.platformFee,
      p.stripeFee,
      p.netPlatformRevenue,
      p.tutorPayout
    ]);
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `platform-revenue-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }
}



