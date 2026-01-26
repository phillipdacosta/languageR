import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController, LoadingController, ToastController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../services/user.service';
import { environment } from '../../environments/environment';
import { firstValueFrom } from 'rxjs';

interface ReportedLesson {
  _id: string;
  subject: string;
  startTime: string;
  endTime: string;
  price: number;
  duration: number;
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
  issueType: string;
  issueDetails: string;
  issueReportedAt: string;
  issueReportedBy?: {
    name: string;
    email: string;
  };
  underInvestigation: boolean;
  payoutPaused: boolean;
  payoutPausedAt?: string;
  payoutPausedBy?: {
    name: string;
    email: string;
  };
  investigationResolvedAt?: string;
  investigationResolution?: string;
  investigationNotes?: string;
}

@Component({
  selector: 'app-reported-lessons',
  templateUrl: './reported-lessons.page.html',
  styleUrls: ['./reported-lessons.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class ReportedLessonsPage implements OnInit {
  lessons: ReportedLesson[] = [];
  isLoading = true;
  selectedStatus = 'pending';
  currentPage = 1;
  totalPages = 1;
  totalLessons = 0;

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController
  ) {}

  ngOnInit() {
    this.loadReportedLessons();
  }

  async loadReportedLessons() {
    this.isLoading = true;
    try {
      const response = await firstValueFrom(
        this.http.get<any>(
          `${environment.apiUrl}/admin/reported-lessons?status=${this.selectedStatus}&page=${this.currentPage}`,
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      if (response.success) {
        this.lessons = response.lessons;
        this.totalPages = response.pagination?.pages || 1;
        this.totalLessons = response.pagination?.total || 0;
      }
    } catch (error: any) {
      console.error('Error loading reported lessons:', error);
      await this.showToast('Failed to load reported lessons', 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  onStatusChange() {
    this.currentPage = 1;
    this.loadReportedLessons();
  }

  getIssueTypeLabel(type: string): string {
    const labels: { [key: string]: string } = {
      'tutor_no_show': 'Tutor No-Show',
      'ended_early': 'Ended Early',
      'poor_quality': 'Poor Quality',
      'inappropriate': 'Inappropriate Behavior',
      'technical': 'Technical Issues',
      'other': 'Other'
    };
    return labels[type] || type;
  }

  getIssueTypeColor(type: string): string {
    const colors: { [key: string]: string } = {
      'tutor_no_show': 'danger',
      'inappropriate': 'danger',
      'ended_early': 'warning',
      'poor_quality': 'medium',
      'technical': 'tertiary',
      'other': 'medium'
    };
    return colors[type] || 'medium';
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  async viewDetails(lesson: ReportedLesson) {
    const alert = await this.alertController.create({
      header: 'Issue Details',
      message: `
        <div class="issue-details">
          <p><strong>Lesson:</strong> ${lesson.subject}</p>
          <p><strong>Student:</strong> ${lesson.studentId.name} (${lesson.studentId.email})</p>
          <p><strong>Tutor:</strong> ${lesson.tutorId.name} (${lesson.tutorId.email})</p>
          <p><strong>Issue Type:</strong> ${this.getIssueTypeLabel(lesson.issueType)}</p>
          <p><strong>Reported:</strong> ${this.formatDate(lesson.issueReportedAt)}</p>
          <p><strong>Details:</strong></p>
          <p style="white-space: pre-wrap; background: #f3f4f6; padding: 8px; border-radius: 4px;">${lesson.issueDetails}</p>
          ${lesson.investigationNotes ? `<p><strong>Admin Notes:</strong></p><p style="white-space: pre-wrap; background: #fef3c7; padding: 8px; border-radius: 4px;">${lesson.investigationNotes}</p>` : ''}
        </div>
      `,
      buttons: [
        {
          text: 'Close',
          role: 'cancel'
        },
        {
          text: lesson.payoutPaused ? 'Resume Payout' : 'Pause Payout',
          handler: () => {
            if (lesson.payoutPaused) {
              this.resumePayout(lesson);
            } else {
              this.pausePayout(lesson);
            }
          }
        }
      ]
    });

    await alert.present();
  }

  async pausePayout(lesson: ReportedLesson) {
    const alert = await this.alertController.create({
      header: 'Pause Payout',
      message: 'Add investigation notes (optional):',
      inputs: [
        {
          name: 'notes',
          type: 'textarea',
          placeholder: 'Investigation notes...'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Pause',
          handler: async (data) => {
            await this.confirmPausePayout(lesson, data.notes);
          }
        }
      ]
    });

    await alert.present();
  }

  private async confirmPausePayout(lesson: ReportedLesson, notes?: string) {
    const loading = await this.loadingController.create({
      message: 'Pausing payout...'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/admin/lesson/${lesson._id}/pause-payout`,
          { notes },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      if (response.success) {
        await this.showToast('Payout paused successfully', 'success');
        await this.loadReportedLessons();
      }
    } catch (error: any) {
      console.error('Error pausing payout:', error);
      await this.showToast(error?.error?.error || 'Failed to pause payout', 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async resumePayout(lesson: ReportedLesson) {
    const alert = await this.alertController.create({
      header: 'Resume Payout',
      message: 'Select resolution and add notes:',
      inputs: [
        {
          name: 'resolution',
          type: 'radio',
          label: 'Approved - Issue not valid, pay tutor',
          value: 'approved',
          checked: true
        },
        {
          name: 'resolution',
          type: 'radio',
          label: 'Refunded - Issue valid, refund student',
          value: 'refunded'
        },
        {
          name: 'resolution',
          type: 'radio',
          label: 'Partial Refund',
          value: 'partial_refund'
        },
        {
          name: 'resolution',
          type: 'radio',
          label: 'No Action',
          value: 'no_action'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Next',
          handler: (resolution) => {
            this.addResolutionNotes(lesson, resolution);
          }
        }
      ]
    });

    await alert.present();
  }

  private async addResolutionNotes(lesson: ReportedLesson, resolution: string) {
    const alert = await this.alertController.create({
      header: 'Resolution Notes',
      inputs: [
        {
          name: 'notes',
          type: 'textarea',
          placeholder: 'Explain the resolution...'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Resume Payout',
          handler: async (data) => {
            await this.confirmResumePayout(lesson, resolution, data.notes);
          }
        }
      ]
    });

    await alert.present();
  }

  private async confirmResumePayout(lesson: ReportedLesson, resolution: string, notes?: string) {
    const loading = await this.loadingController.create({
      message: 'Resuming payout...'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/admin/lesson/${lesson._id}/resume-payout`,
          { resolution, notes },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      if (response.success) {
        await this.showToast('Payout resumed successfully', 'success');
        await this.loadReportedLessons();
      }
    } catch (error: any) {
      console.error('Error resuming payout:', error);
      await this.showToast(error?.error?.error || 'Failed to resume payout', 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  private async showToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  async doRefresh(event: any) {
    await this.loadReportedLessons();
    event.target.complete();
  }
}

