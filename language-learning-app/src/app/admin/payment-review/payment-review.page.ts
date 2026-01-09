import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController, ToastController, LoadingController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../../services/user.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom, filter, Subscription } from 'rxjs';
import { Router } from '@angular/router';
import { WebSocketService } from '../../services/websocket.service';

@Component({
  selector: 'app-payment-review',
  templateUrl: './payment-review.page.html',
  styleUrls: ['./payment-review.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class PaymentReviewPage implements OnInit {
  // Tab state
  selectedTab: 'tutors' | 'payments' = 'payments'; // Default to payments

  // Tutor review data
  pendingTutors: any[] = [];
  loadingTutors = false;

  // Payment health data
  paymentHealth: any = null;
  loadingPayments = false;
  
  // Expanded sections
  expandedSections: Set<string> = new Set();

  // Websocket subscription
  private alertSubscription?: Subscription;

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private alertController: AlertController,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private router: Router,
    private websocketService: WebSocketService
  ) {}

  async ngOnInit() {
    // Wait for user to be loaded
    await firstValueFrom(
      this.userService.currentUser$.pipe(
        filter(user => !!user)
      )
    );

    // Load initial data based on selected tab
    await this.loadTabData();

    // Subscribe to real-time alerts
    this.subscribeToAlerts();
  }

  ngOnDestroy() {
    if (this.alertSubscription) {
      this.alertSubscription.unsubscribe();
    }
  }

  // Subscribe to admin alerts via websocket
  subscribeToAlerts() {
    this.alertSubscription = this.websocketService.on('admin_alert').subscribe((data: any) => {
      console.log('🚨 [ADMIN] Real-time alert received:', data);
      this.showToast(`New ${data.severity} alert: ${data.title}`, 'warning', 5000);
      
      // Reload payment health if on payments tab
      if (this.selectedTab === 'payments') {
        this.loadPaymentHealth();
      }
    });
  }

  // Switch tabs
  switchTab(tab: 'tutors' | 'payments') {
    this.selectedTab = tab;
    this.loadTabData();
  }

  // Load data for the current tab
  async loadTabData() {
    if (this.selectedTab === 'tutors') {
      await this.loadPendingTutors();
    } else {
      await this.loadPaymentHealth();
    }
  }

  // TUTOR REVIEW FUNCTIONS
  async loadPendingTutors() {
    this.loadingTutors = true;
    try {
      const headers = this.userService.getAuthHeadersSync();
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/admin/pending-tutors`, { headers })
      );
      
      if (response.success) {
        this.pendingTutors = response.tutors;
      }
    } catch (error: any) {
      this.showToast('Failed to load pending tutors', 'danger');
    } finally {
      this.loadingTutors = false;
    }
  }

  async approveVideo(tutor: any) {
    const alert = await this.alertController.create({
      header: 'Approve Video',
      message: `Approve introduction video for ${tutor.name}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Approve',
          handler: async () => {
            await this.submitVideoApproval(tutor._id, true, null);
          }
        }
      ]
    });
    await alert.present();
  }

  async rejectVideo(tutor: any) {
    const alert = await this.alertController.create({
      header: 'Reject Video',
      message: 'Please provide a reason for rejection:',
      inputs: [
        {
          name: 'reason',
          type: 'textarea',
          placeholder: 'Rejection reason...'
        }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Reject',
          handler: async (data) => {
            if (data.reason) {
              await this.submitVideoApproval(tutor._id, false, data.reason);
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async submitVideoApproval(tutorId: string, approved: boolean, rejectionReason: string | null) {
    const loading = await this.loadingController.create({
      message: approved ? 'Approving...' : 'Rejecting...'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/admin/approve-video/${tutorId}`,
          { approved, rejectionReason },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      await loading.dismiss();

      if (response.success) {
        this.showToast(approved ? 'Video approved!' : 'Video rejected', 'success');
        await this.loadPendingTutors();
      }
    } catch (error) {
      await loading.dismiss();
      this.showToast('Operation failed', 'danger');
    }
  }

  // PAYMENT HEALTH FUNCTIONS
  async loadPaymentHealth() {
    this.loadingPayments = true;
    try {
      const headers = this.userService.getAuthHeadersSync();
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/admin/payment-health`, { headers })
      );
      
      if (response.success) {
        this.paymentHealth = response;
        console.log('💳 Payment health loaded:', response);
      }
    } catch (error: any) {
      console.error('❌ Error loading payment health:', error);
      this.showToast('Failed to load payment data', 'danger');
    } finally {
      this.loadingPayments = false;
    }
  }

  toggleSection(section: string) {
    if (this.expandedSections.has(section)) {
      this.expandedSections.delete(section);
    } else {
      this.expandedSections.add(section);
    }
  }

  isSectionExpanded(section: string): boolean {
    return this.expandedSections.has(section);
  }

  getSeverityColor(severity: string): string {
    switch (severity) {
      case 'CRITICAL': return 'danger';
      case 'HIGH': return 'warning';
      case 'MEDIUM': return 'primary';
      case 'LOW': return 'medium';
      default: return 'medium';
    }
  }

  getAlertIcon(type: string): string {
    switch (type) {
      case 'PAYMENT_OUT_OF_SYNC': return 'sync-outline';
      case 'STUCK_AUTHORIZATION': return 'time-outline';
      case 'FAILED_CAPTURE': return 'card-outline';
      case 'FAILED_PAYOUT': return 'cash-outline';
      case 'PAYMENT_DISPUTE': return 'warning-outline';
      case 'UNEXPECTED_REFUND': return 'return-up-back-outline';
      case 'MISSING_PAYMENT': return 'alert-circle-outline';
      default: return 'alert-outline';
    }
  }

  async resolveAlert(alert: any) {
    const alertDialog = await this.alertController.create({
      header: 'Resolve Alert',
      message: 'Add resolution notes:',
      inputs: [
        {
          name: 'notes',
          type: 'textarea',
          placeholder: 'What action did you take?'
        }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Mark Resolved',
          handler: async (data) => {
            await this.submitResolveAlert(alert._id, data.notes);
          }
        }
      ]
    });
    await alertDialog.present();
  }

  async submitResolveAlert(alertId: string, resolutionNotes: string) {
    const loading = await this.loadingController.create({ message: 'Resolving...' });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/admin/resolve-alert/${alertId}`,
          { resolutionNotes },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      await loading.dismiss();

      if (response.success) {
        this.showToast('Alert resolved', 'success');
        await this.loadPaymentHealth();
      }
    } catch (error) {
      await loading.dismiss();
      this.showToast('Failed to resolve alert', 'danger');
    }
  }

  async manualCapture(payment: any) {
    const alert = await this.alertController.create({
      header: 'Manual Capture',
      message: `Capture $${payment.amount} for payment ${payment.paymentId}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Capture',
          handler: async () => {
            const loading = await this.loadingController.create({ message: 'Capturing...' });
            await loading.present();

            try {
              const response = await firstValueFrom(
                this.http.post<any>(
                  `${environment.apiUrl}/admin/manual-capture/${payment.paymentId}`,
                  {},
                  { headers: this.userService.getAuthHeadersSync() }
                )
              );

              await loading.dismiss();

              if (response.success) {
                this.showToast('Payment captured!', 'success');
                await this.loadPaymentHealth();
              }
            } catch (error: any) {
              await loading.dismiss();
              this.showToast(error.error?.message || 'Capture failed', 'danger');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async syncPaymentStatus(payment: any) {
    const alert = await this.alertController.create({
      header: 'Sync Database',
      message: `Update database to match Stripe status for payment ${payment.paymentId}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Sync',
          handler: async () => {
            const loading = await this.loadingController.create({ message: 'Syncing...' });
            await loading.present();

            try {
              const response = await firstValueFrom(
                this.http.post<any>(
                  `${environment.apiUrl}/admin/sync-payment/${payment.paymentId}`,
                  {},
                  { headers: this.userService.getAuthHeadersSync() }
                )
              );

              await loading.dismiss();

              if (response.success) {
                this.showToast('Database synced!', 'success');
                await this.loadPaymentHealth();
              }
            } catch (error: any) {
              await loading.dismiss();
              this.showToast(error.error?.message || 'Sync failed', 'danger');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async dismissFailedPayout(payout: any) {
    const alert = await this.alertController.create({
      header: 'Dismiss Failed Payout',
      message: `Dismiss this failed payout to ${payout.tutorName}?`,
      inputs: [
        {
          name: 'reason',
          type: 'text',
          placeholder: 'Reason for dismissal (e.g., "No-show lesson", "Already handled")'
        }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Dismiss',
          handler: async (data) => {
            const loading = await this.loadingController.create({ message: 'Dismissing...' });
            await loading.present();

            try {
              const response = await firstValueFrom(
                this.http.post<any>(
                  `${environment.apiUrl}/admin/dismiss-failed-payout/${payout.paymentId}`,
                  { dismissalReason: data.reason || 'Manually dismissed' },
                  { headers: this.userService.getAuthHeadersSync() }
                )
              );

              await loading.dismiss();

              if (response.success) {
                this.showToast('Failed payout dismissed', 'success');
                await this.loadPaymentHealth();
              }
            } catch (error: any) {
              await loading.dismiss();
              this.showToast(error.error?.message || 'Dismiss failed', 'danger');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  formatDate(date: string): string {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString();
  }

  async showToast(message: string, color: string = 'dark', duration: number = 3000) {
    const toast = await this.toastController.create({
      message,
      duration,
      color,
      position: 'top'
    });
    await toast.present();
  }
}
