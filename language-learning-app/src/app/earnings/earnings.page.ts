import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../services/user.service';
import { WebSocketService } from '../services/websocket.service';
import { environment } from '../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { Subscription } from 'rxjs';

interface PaymentBreakdown {
  id: string;
  studentName: string;
  date: Date;
  tutorPayout: number;
  platformFee: number;
  status: 'paid' | 'pending' | 'in_progress' | 'processing' | 'scheduled';
  lessonStatus: string;
  lessonId: string;
}

@Component({
  selector: 'app-earnings',
  templateUrl: './earnings.page.html',
  styleUrls: ['./earnings.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule]
})
export class EarningsPage implements OnInit, OnDestroy {
  loading: boolean = true;
  totalEarnings: number = 0;
  pendingEarnings: number = 0;
  recentPayments: PaymentBreakdown[] = [];
  error: string | null = null;
  payoutProvider: string = 'unknown';
  private subscriptions: Subscription[] = [];

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private router: Router,
    private location: Location,
    private websocketService: WebSocketService
  ) {}

  async ngOnInit() {
    await this.loadEarnings();
    this.setupWebSocketListeners();
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
        this.payoutProvider = response.payoutProvider || 'unknown';
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
    if (payment.status === 'processing' || payment.lessonStatus === 'ended_early') {
      return 'Payment amount will update momentarily';
    }
    if (payment.status === 'in_progress') {
      return 'Lesson currently in progress';
    }
    if (payment.status === 'scheduled') {
      return 'Payment will be authorized at lesson start';
    }
    return null;
  }
}


