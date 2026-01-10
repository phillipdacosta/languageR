import { Component, OnInit, OnDestroy, Pipe, PipeTransform } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, ToastController, LoadingController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../../services/user.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom, filter, Subscription } from 'rxjs';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SharedModule } from '../../shared/shared.module';
import { WebSocketService } from '../../services/websocket.service';

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
  imports: [CommonModule, IonicModule, FormsModule, SanitizeUrlPipe, SharedModule]
})
export class TutorReviewPage implements OnInit, OnDestroy {
  pendingTutors: any[] = [];
  approvedTutors: any[] = [];
  rejectedTutors: any[] = [];
  displayedTutors: any[] = [];
  loading = true;
  selectedTutor: any = null;
  isVideoModalOpen = false;
  selectedTab: 'pending' | 'approved' | 'rejected' = 'pending';
  private videoUploadSubscription?: Subscription;
  
  // Track which specific tutors have new videos (by tutor ID)
  tutorsWithUpdates = new Set<string>();
  
  // New videos notification
  newVideosCount = 0;
  showNewVideosAlert = false;
  
  // Cooling period in minutes (configurable)
  readonly COOLING_PERIOD_MINUTES = 30;
  
  // Expose Math to template
  Math = Math;
  
  get pendingCount(): number {
    return this.pendingTutors.length;
  }
  
  get approvedCount(): number {
    return this.approvedTutors.length;
  }

  get rejectedCount(): number {
    return this.rejectedTutors.length;
  }

  constructor(
    private http: HttpClient,
    private userService: UserService,
    private alertController: AlertController,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private webSocketService: WebSocketService
  ) {}

  async ngOnInit() {
    // Wait for user to be loaded before fetching data
    await firstValueFrom(
      this.userService.currentUser$.pipe(
        filter(user => !!user)
      )
    );
    await this.loadAllTutors();
    
    // Listen for new video uploads from tutors
    this.videoUploadSubscription = this.webSocketService.tutorVideoUploaded$.subscribe((data: any) => {
      console.log('📬 Admin received video upload notification:', data);
      
      // Track which specific tutor has an update
      this.tutorsWithUpdates.add(data.tutorId);
      
      // Show notification banner
      this.newVideosCount++;
      this.showNewVideosAlert = true;
      
      // Optional: Show subtle toast
      this.showToast(`${data.tutorName} uploaded a new video`, 'primary');
    });
  }

  ngOnDestroy() {
    // Clean up subscription
    if (this.videoUploadSubscription) {
      this.videoUploadSubscription.unsubscribe();
    }
  }

  // Manual refresh triggered by admin
  async refreshTutorList() {
    this.showNewVideosAlert = false;
    this.newVideosCount = 0;
    this.tutorsWithUpdates.clear(); // Clear all individual update flags
    await this.loadAllTutors();
    this.showToast('Tutor list refreshed', 'success');
  }

  dismissNewVideosAlert() {
    this.showNewVideosAlert = false;
  }

  // Refresh a single tutor's video data
  async refreshSingleTutor(tutorId: string) {
    try {
      const loading = await this.loadingController.create({
        message: 'Refreshing video...',
        duration: 3000
      });
      await loading.present();

      // Get authentication headers
      const headers = this.userService.getAuthHeadersSync();

      // Fetch fresh data for this specific tutor from all status endpoints
      const [pendingResponse, approvedResponse, rejectedResponse] = await Promise.all([
        this.http.get<any>(`${environment.apiUrl}/admin/pending-tutors?status=pending`, { headers }).toPromise(),
        this.http.get<any>(`${environment.apiUrl}/admin/pending-tutors?status=approved`, { headers }).toPromise(),
        this.http.get<any>(`${environment.apiUrl}/admin/pending-tutors?status=rejected`, { headers }).toPromise()
      ]);

      // Find the tutor in any of the responses
      const updatedTutor = 
        pendingResponse?.tutors?.find((t: any) => t._id === tutorId) ||
        approvedResponse?.tutors?.find((t: any) => t._id === tutorId) ||
        rejectedResponse?.tutors?.find((t: any) => t._id === tutorId);

      if (!updatedTutor) {
        await loading.dismiss();
        this.showToast('Tutor not found', 'warning');
        return;
      }

      // Enrich the updated tutor with computed properties
      const enrichTutor = (tutor: any) => {
        tutor._videoUrl = tutor.onboardingData?.pendingVideo || tutor.onboardingData?.introductionVideo || '';
        tutor._thumbnailUrl = tutor.onboardingData?.pendingVideoThumbnail || tutor.onboardingData?.videoThumbnail || '';
        tutor._videoType = this.detectVideoType(tutor._videoUrl);
        tutor._timeAgo = this.calculateTimeAgo(tutor);
        tutor._minutesSinceUpload = this.calculateMinutesSinceUpload(tutor);
        tutor._isInCoolingPeriod = tutor._minutesSinceUpload < this.COOLING_PERIOD_MINUTES;
        tutor._remainingCoolingMinutes = Math.max(0, this.COOLING_PERIOD_MINUTES - Math.floor(tutor._minutesSinceUpload));
        tutor._isExternalVideo = tutor._videoUrl.includes('vimeo.com') || 
                                 tutor._videoUrl.includes('youtube.com') || 
                                 tutor._videoUrl.includes('youtu.be');
        return tutor;
      };
      
      enrichTutor(updatedTutor);

      // Update the tutor in the appropriate list
      const updateList = (list: any[]) => {
        const index = list.findIndex(t => t._id === tutorId);
        if (index !== -1) {
          list[index] = updatedTutor;
          return true;
        }
        return false;
      };

      // Try to update in all lists (tutor might have moved between statuses)
      let updated = false;
      updated = updateList(this.pendingTutors) || updated;
      updated = updateList(this.approvedTutors) || updated;
      updated = updateList(this.rejectedTutors) || updated;

      // If tutor wasn't in any list, they might have moved to a different status
      // Reload all lists to catch status changes
      if (!updated) {
        await this.loadAllTutors();
      } else {
        this.updateDisplayedTutors();
      }

      // Remove from updates tracking
      this.tutorsWithUpdates.delete(tutorId);
      this.newVideosCount = Math.max(0, this.newVideosCount - 1);

      await loading.dismiss();
      this.showToast('Video refreshed successfully', 'success');
    } catch (error) {
      console.error('Error refreshing tutor:', error);
      this.showToast('Failed to refresh video', 'danger');
    }
  }

  // Check if a specific tutor has updates
  hasUpdates(tutorId: string): boolean {
    return this.tutorsWithUpdates.has(tutorId);
  }

  async loadAllTutors() {
    await Promise.all([
      this.loadPendingTutors(),
      this.loadApprovedTutors(),
      this.loadRejectedTutors()
    ]);
    this.enrichTutorData(); // Add computed properties
    this.updateDisplayedTutors();
  }

  // Enrich tutor data with computed properties to avoid function calls in template
  enrichTutorData() {
    const enrichTutor = (tutor: any) => {
      // Video URLs
      tutor._videoUrl = tutor.onboardingData?.pendingVideo || tutor.onboardingData?.introductionVideo || '';
      tutor._thumbnailUrl = tutor.onboardingData?.pendingVideoThumbnail || tutor.onboardingData?.videoThumbnail || '';
      tutor._videoType = this.detectVideoType(tutor._videoUrl);
      
      // Time calculations
      tutor._timeAgo = this.calculateTimeAgo(tutor);
      tutor._minutesSinceUpload = this.calculateMinutesSinceUpload(tutor);
      tutor._isInCoolingPeriod = tutor._minutesSinceUpload < this.COOLING_PERIOD_MINUTES;
      tutor._remainingCoolingMinutes = Math.max(0, this.COOLING_PERIOD_MINUTES - Math.floor(tutor._minutesSinceUpload));
      
      // Video type checks for modal
      tutor._isExternalVideo = tutor._videoUrl.includes('vimeo.com') || 
                               tutor._videoUrl.includes('youtube.com') || 
                               tutor._videoUrl.includes('youtu.be');
      
      return tutor;
    };
    
    this.pendingTutors = this.pendingTutors.map(enrichTutor);
    this.approvedTutors = this.approvedTutors.map(enrichTutor);
    this.rejectedTutors = this.rejectedTutors.map(enrichTutor);
  }

  detectVideoType(url: string): 'upload' | 'youtube' | 'vimeo' {
    if (!url) return 'upload';
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('vimeo.com')) return 'vimeo';
    return 'upload';
  }

  calculateTimeAgo(tutor: any): string {
    const uploadedAt = tutor.tutorOnboarding?.videoUploadedAt;
    
    console.log('⏰ calculateTimeAgo for tutor:', tutor.email, {
      uploadedAt: uploadedAt,
      tutorOnboarding: tutor.tutorOnboarding,
      hasTutorOnboarding: !!tutor.tutorOnboarding,
      hasUploadedAt: !!uploadedAt
    });
    
    if (!uploadedAt) {
      if (tutor.createdAt) {
        const createdDate = new Date(tutor.createdAt);
        const now = new Date();
        const diffMs = now.getTime() - createdDate.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        return `${diffDays} days ago (account created)`;
      }
      return 'Unknown (no timestamp)';
    }
    
    const uploadDate = new Date(uploadedAt);
    const now = new Date();
    const diffMs = now.getTime() - uploadDate.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }

  calculateMinutesSinceUpload(tutor: any): number {
    const uploadedAt = tutor.tutorOnboarding?.videoUploadedAt;
    if (!uploadedAt) return 9999; // Large number to bypass cooling period
    
    const uploadDate = new Date(uploadedAt);
    const now = new Date();
    const diffMs = now.getTime() - uploadDate.getTime();
    return diffMs / (1000 * 60);
  }

  onTabChange(event: any) {
    this.updateDisplayedTutors();
  }

  updateDisplayedTutors() {
    if (this.selectedTab === 'pending') {
      this.displayedTutors = this.pendingTutors;
    } else if (this.selectedTab === 'approved') {
      this.displayedTutors = this.approvedTutors;
    } else if (this.selectedTab === 'rejected') {
      this.displayedTutors = this.rejectedTutors;
    }
  }

  async loadPendingTutors() {
    try {
      console.log('🔍 Loading pending tutors...');
      const headers = this.userService.getAuthHeadersSync();
      
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/admin/pending-tutors?status=pending`, {
          headers: headers
        })
      );
      
      console.log('✅ Pending tutors response:', response);
      console.log('📊 Number of pending tutors:', response.tutors?.length);
      
      if (response.success) {
        this.pendingTutors = response.tutors;
        console.log('✅ Set pendingTutors array, length:', this.pendingTutors.length);
      }
    } catch (error: any) {
      console.error('❌ Error loading pending tutors:', error);
      console.error('❌ Error status:', error.status);
      console.error('❌ Error message:', error.error?.message || error.message);
      this.showToast(error.error?.message || 'Failed to load pending tutors', 'danger');
    } finally {
      this.loading = false;
    }
  }

  async loadApprovedTutors() {
    try {
      console.log('🔍 Loading approved tutors...');
      const headers = this.userService.getAuthHeadersSync();
      
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/admin/pending-tutors?status=approved`, {
          headers: headers
        })
      );
      
      console.log('✅ Approved tutors response:', response);
      console.log('📊 Number of approved tutors:', response.tutors?.length);
      
      if (response.success) {
        this.approvedTutors = response.tutors;
        console.log('✅ Set approvedTutors array, length:', this.approvedTutors.length);
      }
    } catch (error: any) {
      console.error('❌ Error loading approved tutors:', error);
      this.showToast(error.error?.message || 'Failed to load approved tutors', 'danger');
    }
  }

  async loadRejectedTutors() {
    try {
      console.log('🔍 Loading rejected tutors...');
      const headers = this.userService.getAuthHeadersSync();
      
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/admin/pending-tutors?status=rejected`, {
          headers: headers
        })
      );
      
      console.log('✅ Rejected tutors response:', response);
      console.log('📊 Number of rejected tutors:', response.tutors?.length);
      
      if (response.success) {
        this.rejectedTutors = response.tutors;
        console.log('✅ Set rejectedTutors array, length:', this.rejectedTutors.length);
      }
    } catch (error: any) {
      console.error('❌ Error loading rejected tutors:', error);
      this.showToast(error.error?.message || 'Failed to load rejected tutors', 'danger');
    }
  }

  async approveTutor(tutor: any) {
    // Prevent approving if there are new videos pending
    if (this.showNewVideosAlert) {
      const alert = await this.alertController.create({
        header: 'Data Out of Date',
        message: `There ${this.newVideosCount === 1 ? 'is 1 new video' : `are ${this.newVideosCount} new videos`} uploaded. Please refresh the list first to ensure you're reviewing the latest videos.`,
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel'
          },
          {
            text: 'Refresh Now',
            handler: () => {
              this.refreshTutorList();
            }
          }
        ]
      });
      await alert.present();
      return;
    }

    // Check cooling period
    if (tutor._isInCoolingPeriod) {
      const alert = await this.alertController.create({
        header: 'Cooling Period Active',
        message: `This video was uploaded ${tutor._timeAgo}. Please wait ${tutor._remainingCoolingMinutes} more minute(s) before approving to ensure the tutor is satisfied with their final version.`,
        buttons: [
          {
            text: 'Wait',
            role: 'cancel'
          },
          {
            text: 'Approve Anyway',
            role: 'destructive',
            handler: () => {
              this.performApproval(tutor);
            }
          }
        ]
      });
      await alert.present();
      return;
    }

    await this.performApproval(tutor);
  }

  private async performApproval(tutor: any) {
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
        await this.loadAllTutors();
      }
    } catch (error: any) {
      await loading.dismiss();
      this.showToast(error.error?.message || 'Failed to approve tutor', 'danger');
    }
  }

  // Removed old methods - now using computed properties
  // getMinutesSinceUpload(), getTimeAgo(), isInCoolingPeriod(), getVideoUrl(), getVideoThumbnail(), getVideoType()
  // These are now computed once in enrichTutorData() and stored as tutor properties

  async rejectTutor(tutor: any) {
    // Prevent rejecting if there are new videos pending
    if (this.showNewVideosAlert) {
      const alert = await this.alertController.create({
        header: 'Data Out of Date',
        message: `There ${this.newVideosCount === 1 ? 'is 1 new video' : `are ${this.newVideosCount} new videos`} uploaded. Please refresh the list first to ensure you're reviewing the latest videos.`,
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel'
          },
          {
            text: 'Refresh Now',
            handler: () => {
              this.refreshTutorList();
            }
          }
        ]
      });
      await alert.present();
      return;
    }

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
        await this.loadAllTutors();
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


