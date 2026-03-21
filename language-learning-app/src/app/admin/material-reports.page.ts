import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController, ToastController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../services/user.service';
import { environment } from '../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { getGlobalHour12 } from '../shared/timezone.utils';

interface MaterialReport {
  _id: string;
  materialId: {
    _id: string;
    title: string;
    materialType: string;
    videoUrl?: string;
    status: string;
    thumbnailUrl?: string;
  };
  studentId: {
    _id: string;
    name: string;
    email: string;
    picture?: string;
  };
  tutorId: {
    _id: string;
    name: string;
    email: string;
    picture?: string;
  };
  reason: string;
  details: string;
  status: string;
  hasPurchased: boolean;
  hasCompletedQuiz: boolean;
  purchaseId?: {
    _id: string;
    amount: number;
    stripePaymentIntentId: string;
    status: string;
  };
  refundIssued: boolean;
  refundAmount?: number;
  resolution?: string;
  resolvedAt?: string;
  resolvedBy?: { name: string; email: string };
  createdAt: string;
}

@Component({
  selector: 'app-material-reports',
  templateUrl: './material-reports.page.html',
  styleUrls: ['./material-reports.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class MaterialReportsPage implements OnInit {
  reports: MaterialReport[] = [];
  filteredReports: MaterialReport[] = [];
  loading = true;
  error: string | null = null;
  statusFilter = 'open';

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.loadReports();
  }

  async loadReports() {
    this.loading = true;
    this.error = null;
    try {
      const headers = this.userService.getAuthHeadersSync();
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; reports: MaterialReport[] }>(
          `${environment.apiUrl}/admin/material-reports?status=${this.statusFilter}`,
          { headers }
        )
      );
      if (res.success) {
        this.reports = res.reports;
        this.filteredReports = res.reports;
      }
    } catch (err: any) {
      this.error = err?.error?.message || 'Failed to load reports';
    } finally {
      this.loading = false;
    }
  }

  async changeFilter(status: string) {
    this.statusFilter = status;
    await this.loadReports();
  }

  getReasonLabel(reason: string): string {
    const map: Record<string, string> = {
      video_unavailable: 'Video / Audio Unavailable',
      audio_unavailable: 'Audio Unavailable',
      content_missing: 'Content Missing',
      incorrect_content: 'Incorrect Content',
      copyright_infringement: 'Copyright Infringement',
      other: 'Other'
    };
    return map[reason] || reason;
  }

  getStatusColor(status: string): string {
    const map: Record<string, string> = {
      open: 'warning',
      under_review: 'primary',
      resolved: 'success',
      dismissed: 'medium'
    };
    return map[status] || 'medium';
  }

  getMaterialTypeLabel(type: string | undefined): string {
    const map: Record<string, string> = {
      video_quiz: 'Video Quiz',
      reading: 'Reading',
      listening: 'Listening'
    };
    return map[type || ''] || type || 'Unknown';
  }

  async reviewReport(report: MaterialReport) {
    const buttons: any[] = [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Mark Under Review',
        handler: () => this.updateReport(report._id, 'under_review')
      },
      {
        text: 'Dismiss',
        handler: () => this.updateReport(report._id, 'dismissed', 'Report dismissed by admin')
      }
    ];

    if (report.hasPurchased && report.purchaseId?.status === 'completed') {
      buttons.push({
        text: 'Resolve & Refund',
        cssClass: 'alert-button-danger',
        handler: () => this.confirmRefund(report)
      });
    }

    buttons.push({
      text: 'Resolve (No Refund)',
      handler: async () => {
        const resAlert = await this.alertCtrl.create({
          header: 'Resolution Note',
          inputs: [{ name: 'resolution', type: 'textarea', placeholder: 'Resolution details...' }],
          buttons: [
            { text: 'Cancel', role: 'cancel' },
            { text: 'Resolve', handler: (data: any) => this.updateReport(report._id, 'resolved', data.resolution) }
          ]
        });
        await resAlert.present();
      }
    });

    const alert = await this.alertCtrl.create({
      header: 'Review Report',
      subHeader: `${report.studentId.name} reported "${this.getReasonLabel(report.reason)}"`,
      message: report.details || 'No additional details provided.',
      buttons
    });
    await alert.present();
  }

  async confirmRefund(report: MaterialReport) {
    const amount = report.purchaseId?.amount || 0;
    const alert = await this.alertCtrl.create({
      header: 'Confirm Refund',
      message: `Refund $${amount.toFixed(2)} to ${report.studentId.name}? This will reverse the Stripe charge.`,
      inputs: [{ name: 'resolution', type: 'textarea', placeholder: 'Reason for refund...' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Issue Refund',
          cssClass: 'alert-button-danger',
          handler: (data: any) => this.updateReport(report._id, 'resolved', data.resolution || 'Refund issued', true)
        }
      ]
    });
    await alert.present();
  }

  async updateReport(reportId: string, status: string, resolution?: string, issueRefund = false) {
    try {
      const headers = this.userService.getAuthHeadersSync();
      const body: any = { status };
      if (resolution) body.resolution = resolution;
      if (issueRefund) body.issueRefund = true;

      const res = await firstValueFrom(
        this.http.put<{ success: boolean; report: MaterialReport }>(
          `${environment.apiUrl}/admin/material-reports/${reportId}`,
          body,
          { headers }
        )
      );

      if (res.success) {
        const idx = this.reports.findIndex(r => r._id === reportId);
        if (idx !== -1) this.reports[idx] = res.report;
        this.filteredReports = [...this.reports];
        const msg = issueRefund ? 'Report resolved and refund issued' : `Report updated to ${status}`;
        const toast = await this.toastCtrl.create({ message: msg, duration: 3000, position: 'bottom' });
        await toast.present();
      }
    } catch (err: any) {
      const toast = await this.toastCtrl.create({
        message: err?.error?.message || 'Failed to update report',
        duration: 4000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: getGlobalHour12()
    });
  }
}
