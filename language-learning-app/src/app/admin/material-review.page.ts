import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController, ToastController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../services/user.service';
import { environment } from '../../environments/environment';
import { firstValueFrom } from 'rxjs';

interface ReviewMaterial {
  _id: string;
  title: string;
  materialType: string;
  videoUrl?: string;
  audioUrl?: string;
  pricingType: string;
  price: number;
  status: string;
  thumbnailUrl?: string;
  reviewStatus: string;
  reviewNote?: string;
  channelVerified: boolean;
  contentAttested: boolean;
  contentAttestedAt?: string;
  reviewedBy?: { name: string; email: string };
  reviewedAt?: string;
  createdAt: string;
  tutorId: {
    _id: string;
    name: string;
    email: string;
    picture?: string;
    linkedChannels?: {
      youtubeChannelUrl?: string;
      vimeoChannelUrl?: string;
      soundcloudProfileUrl?: string;
    };
  };
}

@Component({
  selector: 'app-material-review',
  templateUrl: './material-review.page.html',
  styleUrls: ['./material-review.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class MaterialReviewPage implements OnInit {
  materials: ReviewMaterial[] = [];
  loading = true;
  error: string | null = null;
  statusFilter = 'pending_review';

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.loadMaterials();
  }

  async loadMaterials() {
    this.loading = true;
    this.error = null;
    try {
      const headers = this.userService.getAuthHeadersSync();
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; materials: ReviewMaterial[] }>(
          `${environment.apiUrl}/admin/material-review?reviewStatus=${this.statusFilter}`,
          { headers }
        )
      );
      if (res.success) {
        this.materials = res.materials;
      }
    } catch (err: any) {
      this.error = err?.error?.message || 'Failed to load materials';
    } finally {
      this.loading = false;
    }
  }

  async changeFilter(status: string) {
    this.statusFilter = status;
    await this.loadMaterials();
  }

  getMaterialTypeLabel(type: string): string {
    const map: Record<string, string> = {
      video_quiz: 'Video Quiz',
      reading: 'Reading',
      listening: 'Listening'
    };
    return map[type] || type;
  }

  getStatusColor(status: string): string {
    const map: Record<string, string> = {
      pending_review: 'warning',
      approved: 'success',
      rejected: 'danger',
      auto_approved: 'medium'
    };
    return map[status] || 'medium';
  }

  hasLinkedChannel(material: ReviewMaterial): boolean {
    const ch = material.tutorId?.linkedChannels;
    return !!(ch?.youtubeChannelUrl || ch?.vimeoChannelUrl || ch?.soundcloudProfileUrl);
  }

  getRelevantChannel(material: ReviewMaterial): string {
    const ch = material.tutorId?.linkedChannels;
    if (!ch) return 'None';
    if (material.materialType === 'video_quiz') {
      if (material.videoUrl?.includes('youtube') && ch.youtubeChannelUrl) return ch.youtubeChannelUrl;
      if (material.videoUrl?.includes('vimeo') && ch.vimeoChannelUrl) return ch.vimeoChannelUrl;
    }
    if (material.materialType === 'listening' && ch.soundcloudProfileUrl) return ch.soundcloudProfileUrl;
    return 'No matching channel';
  }

  async reviewMaterial(material: ReviewMaterial) {
    const alert = await this.alertCtrl.create({
      header: 'Review Material',
      subHeader: material.title,
      message: `Type: ${this.getMaterialTypeLabel(material.materialType)} | ${material.pricingType === 'paid' ? '$' + material.price : 'Free'}`,
      inputs: [
        { name: 'note', type: 'textarea', placeholder: 'Reason (required for rejection)...' }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Reject',
          cssClass: 'alert-button-danger',
          handler: (data) => {
            if (!data.note || !data.note.trim()) {
              this.showToast('A reason is required when rejecting a material');
              return false;
            }
            this.updateReview(material._id, 'rejected', data.note);
            return true;
          }
        },
        {
          text: 'Approve',
          handler: (data) => this.updateReview(material._id, 'approved', data.note)
        }
      ]
    });
    await alert.present();
  }

  private async showToast(message: string) {
    const toast = await this.toastCtrl.create({ message, duration: 3000, position: 'top', color: 'warning' });
    await toast.present();
  }

  async updateReview(materialId: string, reviewStatus: string, reviewNote?: string) {
    try {
      const headers = this.userService.getAuthHeadersSync();
      const body: any = { reviewStatus };
      if (reviewNote) body.reviewNote = reviewNote;

      const res = await firstValueFrom(
        this.http.put<{ success: boolean; material: ReviewMaterial }>(
          `${environment.apiUrl}/admin/material-review/${materialId}`,
          body,
          { headers }
        )
      );

      if (res.success) {
        const idx = this.materials.findIndex(m => m._id === materialId);
        if (idx !== -1) {
          if (this.statusFilter !== 'all' && res.material.reviewStatus !== this.statusFilter) {
            this.materials.splice(idx, 1);
          } else {
            this.materials[idx] = res.material;
          }
        }
        const toast = await this.toastCtrl.create({
          message: `Material ${reviewStatus}`,
          duration: 3000,
          position: 'bottom'
        });
        await toast.present();
      }
    } catch (err: any) {
      const toast = await this.toastCtrl.create({
        message: err?.error?.message || 'Failed to update review',
        duration: 4000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }
}
