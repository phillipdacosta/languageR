import { Component, OnInit, Pipe, PipeTransform } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, ToastController, LoadingController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../../services/user.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom, filter } from 'rxjs';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Pipe({
  name: 'sanitizeUrl',
  standalone: true
})
export class SanitizeUrlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}
  
  transform(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
}

@Component({
  selector: 'app-tutor-review',
  templateUrl: './tutor-review.page.html',
  styleUrls: ['./tutor-review.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, SanitizeUrlPipe]
})
export class TutorReviewPage implements OnInit {
  pendingTutors: any[] = [];
  loading = true;
  selectedTutor: any = null;
  isVideoModalOpen = false;

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private alertController: AlertController,
    private toastController: ToastController,
    private loadingController: LoadingController
  ) {}

  async ngOnInit() {
    // Wait for user to be loaded before fetching data
    await firstValueFrom(
      this.userService.currentUser$.pipe(
        filter(user => !!user)
      )
    );
    await this.loadPendingTutors();
  }

  async loadPendingTutors() {
    this.loading = true;
    try {
      console.log('🔍 Loading pending tutors...');
      const headers = this.userService.getAuthHeadersSync();
      console.log('🔍 Auth headers:', headers);
      
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/admin/pending-tutors`, {
          headers: headers
        })
      );
      
      console.log('✅ Pending tutors response:', response);
      
      if (response.success) {
        this.pendingTutors = response.tutors;
      }
    } catch (error: any) {
      console.error('❌ Error loading pending tutors:', error);
      this.showToast(error.error?.message || 'Failed to load pending tutors', 'danger');
    } finally {
      this.loading = false;
    }
  }

  async approveTutor(tutor: any) {
    const loading = await this.loadingController.create({ message: 'Approving...' });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/admin/approve-tutor/${tutor._id}`, {}, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      await loading.dismiss();

      if (response.success) {
        this.showToast('Tutor approved!', 'success');
        await this.loadPendingTutors();
      }
    } catch (error: any) {
      await loading.dismiss();
      this.showToast(error.error?.message || 'Failed to approve tutor', 'danger');
    }
  }

  async rejectTutor(tutor: any) {
    const alert = await this.alertController.create({
      header: 'Reject Video',
      message: 'Please provide a reason for rejection:',
      inputs: [
        {
          name: 'reason',
          type: 'textarea',
          placeholder: 'Reason...'
        }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Reject',
          handler: async (data) => {
            if (!data.reason) {
              this.showToast('Please provide a reason', 'warning');
              return false;
            }
            await this.submitRejection(tutor, data.reason);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async submitRejection(tutor: any, reason: string) {
    const loading = await this.loadingController.create({ message: 'Rejecting...' });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/admin/reject-tutor/${tutor._id}`, { reason }, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      await loading.dismiss();

      if (response.success) {
        this.showToast('Tutor rejected', 'success');
        await this.loadPendingTutors();
      }
    } catch (error: any) {
      await loading.dismiss();
      this.showToast(error.error?.message || 'Failed to reject tutor', 'danger');
    }
  }

  async showToast(message: string, color: string) {
    const toast = await this.toastController.create({ message, duration: 3000, color, position: 'top' });
    await toast.present();
  }

  playTutorVideo(tutor: any) {
    console.log('🎬 Opening video modal for tutor:', tutor.name);
    this.selectedTutor = tutor;
    this.isVideoModalOpen = true;
  }

  closeVideoModal() {
    console.log('🎬 Closing video modal');
    this.isVideoModalOpen = false;
    this.selectedTutor = null;
  }
}

