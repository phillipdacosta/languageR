import { Component, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../services/user.service';
import { environment } from '../../environments/environment';
import { firstValueFrom } from 'rxjs';

interface PaymentBreakdown {
  id: string;
  studentName: string;
  date: Date;
  tutorPayout: number;
  platformFee: number;
  status: 'paid' | 'pending';
  lessonId: string;
}

@Component({
  selector: 'app-earnings',
  templateUrl: './earnings.page.html',
  styleUrls: ['./earnings.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule]
})
export class EarningsPage implements OnInit {
  loading: boolean = true;
  totalEarnings: number = 0;
  pendingEarnings: number = 0;
  recentPayments: PaymentBreakdown[] = [];
  error: string | null = null;
  payoutProvider: string = 'unknown';

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private router: Router,
    private location: Location
  ) {}

  async ngOnInit() {
    await this.loadEarnings();
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
    return status === 'paid' ? 'success' : 'warning';
  }

  getStatusIcon(status: string): string {
    return status === 'paid' ? 'checkmark-circle' : 'time';
  }

  getStatusText(status: string): string {
    return status === 'paid' ? 'Transferred' : 'Pending Transfer';
  }
}


