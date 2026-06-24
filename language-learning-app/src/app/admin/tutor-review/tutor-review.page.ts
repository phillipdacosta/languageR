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
import { LocaleDisplayService, TEACHABLE_ENGLISH_NAME_TO_ISO639 } from '../../services/locale-display.service';
import { LanguageService } from '../../services/language.service';

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
  private credentialUploadSubscription?: Subscription;
  private photoUploadSubscription?: Subscription;
  
  // Track which specific tutors have new submissions (by tutor ID)
  tutorsWithUpdates = new Set<string>();
  
  // New submissions notification
  newUpdatesCount = 0;
  showNewUpdatesAlert = false;
  
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
    private webSocketService: WebSocketService,
    private localeDisplay: LocaleDisplayService,
    private languageService: LanguageService
  ) {}

  async ngOnInit() {
    // Wait for user to be loaded before fetching data
    await firstValueFrom(
      this.userService.currentUser$.pipe(
        filter(user => !!user)
      )
    );
    await this.loadAllTutors();
    
    this.videoUploadSubscription = this.webSocketService.tutorVideoUploaded$.subscribe((data: any) => {
      this.handleReviewUpdate(data.tutorId, `${data.tutorName} uploaded a new video`);
    });

    this.credentialUploadSubscription = this.webSocketService.tutorCredentialUploaded$.subscribe((data: any) => {
      const credLabel = data.credentialType === 'governmentId' ? 'government ID' :
        data.credentialType === 'teachingCertification' ? 'teaching certification' : 'document';
      this.handleReviewUpdate(data.tutorId, `${data.tutorName} uploaded a ${credLabel}`);
    });

    this.photoUploadSubscription = this.webSocketService.tutorPhotoUploaded$.subscribe((data: any) => {
      this.handleReviewUpdate(data.tutorId, `${data.tutorName} uploaded a new profile photo`);
    });
  }

  private handleReviewUpdate(tutorId: string, toastMessage: string) {
    this.tutorsWithUpdates.add(tutorId);
    this.newUpdatesCount++;
    this.showNewUpdatesAlert = true;
    this.showToast(toastMessage, 'primary');
  }

  ngOnDestroy() {
    // Clean up subscriptions
    if (this.videoUploadSubscription) {
      this.videoUploadSubscription.unsubscribe();
    }
    if (this.credentialUploadSubscription) {
      this.credentialUploadSubscription.unsubscribe();
    }
    if (this.photoUploadSubscription) {
      this.photoUploadSubscription.unsubscribe();
    }
  }

  // Manual refresh triggered by admin
  async refreshTutorList() {
    this.showNewUpdatesAlert = false;
    this.newUpdatesCount = 0;
    this.tutorsWithUpdates.clear();
    await this.loadAllTutors();
    this.showToast('Review queue refreshed', 'success');
  }

  dismissNewUpdatesAlert() {
    this.showNewUpdatesAlert = false;
  }

  // Refresh a single tutor's video data
  async refreshSingleTutor(tutorId: string) {
    try {
      const loading = await this.loadingController.create({
        message: 'Refreshing...',
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
        tutor._displayPhotoUrl = tutor.onboardingData?.pendingPhoto || tutor.picture || '';
        tutor._pendingPhotoUrl = tutor.onboardingData?.pendingPhoto || '';
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
        this.enrichTutorData();
        this.updateDisplayedTutors();
      }

      // Remove from updates tracking
      this.tutorsWithUpdates.delete(tutorId);
      this.newUpdatesCount = Math.max(0, this.newUpdatesCount - 1);

      await loading.dismiss();
      this.showToast('Tutor refreshed successfully', 'success');
    } catch (error) {
      console.error('Error refreshing tutor:', error);
      this.showToast('Failed to refresh tutor', 'danger');
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
      tutor._displayPhotoUrl = tutor.onboardingData?.pendingPhoto || tutor.picture || '';
      tutor._pendingPhotoUrl = tutor.onboardingData?.pendingPhoto || '';
      tutor._hasPendingPhoto = !!(tutor.onboardingData?.pendingPhoto && tutor.onboardingData.pendingPhoto !== '');
      tutor._photoTimeAgo = this.calculatePhotoTimeAgo(tutor);
      tutor._needsPhotoReview = tutor.pendingReviewItems?.includes('photo') ?? (
        tutor._hasPendingPhoto ||
        (
          tutor.tutorOnboarding?.photoUploaded === true &&
          tutor.tutorOnboarding?.photoApproved !== true &&
          tutor.tutorOnboarding?.photoRejected !== true
        )
      );

      // Video URLs - prioritize pending video over approved video
      const hasPendingVideo = tutor.onboardingData?.pendingVideo && tutor.onboardingData.pendingVideo !== '';
      const hasApprovedVideo = tutor.onboardingData?.introductionVideo && tutor.onboardingData.introductionVideo !== '';

      tutor._needsVideoReview = tutor.pendingReviewItems?.includes('video') ?? (
        !!hasPendingVideo ||
        (
          !!hasApprovedVideo &&
          tutor.tutorOnboarding?.videoApproved !== true &&
          tutor.tutorOnboarding?.videoRejected !== true
        )
      );
      tutor._needsCredentialReview = tutor.pendingReviewItems?.includes('credentials') ?? false;
      tutor._hasVideoContent = !!(hasPendingVideo || hasApprovedVideo);
      
      tutor._videoUrl = hasPendingVideo ? tutor.onboardingData.pendingVideo : 
                        (hasApprovedVideo ? tutor.onboardingData.introductionVideo : '');
      
      // Thumbnail - ONLY use pending thumbnail if there's a pending video
      // This prevents showing old thumbnail when new video has no thumbnail
      const hasPendingThumbnail = tutor.onboardingData?.pendingVideoThumbnail && tutor.onboardingData.pendingVideoThumbnail !== '';
      const hasApprovedThumbnail = tutor.onboardingData?.videoThumbnail && tutor.onboardingData.videoThumbnail !== '';
      
      if (hasPendingVideo) {
        // If there's a pending video, use its thumbnail (or empty string if none)
        // The video-thumbnail component will auto-fetch external thumbnails if empty
        tutor._thumbnailUrl = hasPendingThumbnail ? tutor.onboardingData.pendingVideoThumbnail : '';
      } else {
        // If no pending video, use approved video thumbnail
        tutor._thumbnailUrl = hasApprovedThumbnail ? tutor.onboardingData.videoThumbnail : '';
      }
      
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

      // Credential status enrichment
      const creds = tutor.tutorCredentials;
      tutor._hasGovernmentId = !!creds?.governmentId?.url;
      tutor._governmentIdStatus = creds?.governmentId?.status || 'not_uploaded';
      tutor._hasCertifications = (creds?.teachingCertifications?.length || 0) > 0;
      tutor._hasAdditionalDocs = (creds?.additionalDocuments?.length || 0) > 0;
      tutor._hasAnyCredentials = !!(
        creds?.governmentId?.url ||
        creds?.teachingCertifications?.length ||
        creds?.additionalDocuments?.length
      );
      tutor._hasPendingCredentials = tutor._needsCredentialReview;
      tutor._credentialsAllApproved =
        creds?.governmentId?.status === 'approved' &&
        creds?.teachingCertifications?.some((c: any) => c.status === 'approved');

      if (creds?.governmentId?.status) {
        creds.governmentId._badgeColor = this.credentialBadgeColor(creds.governmentId.status);
      }
      creds?.teachingCertifications?.forEach((cert: any) => {
        cert._badgeColor = this.credentialBadgeColor(cert.status);
      });
      creds?.additionalDocuments?.forEach((doc: any) => {
        doc._badgeColor = this.credentialBadgeColor(doc.status);
      });

      // Approved vs pending breakdown
      tutor._photoIsApproved = tutor.tutorOnboarding?.photoApproved === true && !tutor._hasPendingPhoto;
      tutor._photoIsRejected = tutor.tutorOnboarding?.photoRejected === true;
      tutor._videoIsApproved = tutor.tutorOnboarding?.videoApproved === true && !tutor._needsVideoReview;
      tutor._videoIsRejected = tutor.tutorOnboarding?.videoRejected === true;

      tutor._approvedPhotoUrl = tutor._photoIsApproved ? (tutor.picture || '') : '';
      if (!tutor._approvedPhotoUrl && tutor._hasPendingPhoto && tutor.picture) {
        const pendingUrl = tutor.onboardingData?.pendingPhoto || '';
        const liveUrl = tutor.picture || '';
        if (liveUrl && liveUrl !== pendingUrl && liveUrl.includes('storage.googleapis.com')) {
          tutor._approvedPhotoUrl = liveUrl;
        }
      }
      tutor._showApprovedPhoto = !!tutor._approvedPhotoUrl;

      tutor._approvedVideoUrl = hasApprovedVideo ? tutor.onboardingData.introductionVideo : '';
      tutor._approvedVideoThumbnail = hasApprovedThumbnail ? tutor.onboardingData.videoThumbnail : '';
      tutor._approvedVideoType = this.detectVideoType(tutor._approvedVideoUrl);
      tutor._approvedVideoIsExternal =
        tutor._approvedVideoUrl.includes('vimeo.com') ||
        tutor._approvedVideoUrl.includes('youtube.com') ||
        tutor._approvedVideoUrl.includes('youtu.be');

      tutor._pendingVideoUrl = hasPendingVideo ? tutor.onboardingData.pendingVideo : '';
      tutor._pendingVideoThumbnail = hasPendingThumbnail ? tutor.onboardingData.pendingVideoThumbnail : '';
      tutor._pendingVideoType = this.detectVideoType(tutor._pendingVideoUrl);
      tutor._pendingVideoIsExternal =
        tutor._pendingVideoUrl.includes('vimeo.com') ||
        tutor._pendingVideoUrl.includes('youtube.com') ||
        tutor._pendingVideoUrl.includes('youtu.be');

      tutor._approvedCredentials = this.buildApprovedCredentials(tutor);
      tutor._pendingCredentials = this.buildPendingCredentials(tutor);

      tutor._reviewChecklist = this.buildReviewChecklist(tutor);
      tutor._hasActionItems =
        tutor._needsPhotoReview ||
        tutor._needsVideoReview ||
        tutor._pendingCredentials.length > 0;
      tutor._hasApprovedItems =
        tutor._showApprovedPhoto ||
        tutor._videoIsApproved ||
        tutor._approvedCredentials.length > 0;

      this.enrichTutorLanguages(tutor);
      
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

  private buildReviewChecklist(tutor: any): Array<{
    key: string;
    label: string;
    status: string;
    statusLabel: string;
    icon: string;
  }> {
    const photoStatus = tutor._needsPhotoReview
      ? 'pending'
      : tutor._photoIsRejected
        ? 'rejected'
        : tutor._photoIsApproved || tutor.tutorOnboarding?.photoUploaded
          ? 'approved'
          : 'missing';

    const videoStatus = tutor._needsVideoReview
      ? 'pending'
      : tutor._videoIsRejected
        ? 'rejected'
        : tutor._videoIsApproved
          ? 'approved'
          : tutor._hasVideoContent
            ? 'pending'
            : 'missing';

    let credStatus = 'missing';
    if (tutor._needsCredentialReview) {
      credStatus = 'pending';
    } else if (tutor._hasAnyCredentials) {
      const hasApproved =
        tutor.tutorCredentials?.governmentId?.status === 'approved' ||
        tutor.tutorCredentials?.teachingCertifications?.some((c: any) => c.status === 'approved') ||
        tutor.tutorCredentials?.additionalDocuments?.some((d: any) => d.status === 'approved');
      credStatus = hasApproved ? 'approved' : 'missing';
    }

    const labelMap: Record<string, string> = {
      approved: 'Approved',
      pending: 'Needs review',
      rejected: 'Rejected',
      missing: 'Not submitted',
    };

    const iconMap: Record<string, string> = {
      approved: 'checkmark-circle',
      pending: 'time-outline',
      rejected: 'close-circle',
      missing: 'ellipse-outline',
    };

    return [
      { key: 'photo', label: 'Photo', status: photoStatus, statusLabel: labelMap[photoStatus], icon: iconMap[photoStatus] },
      { key: 'video', label: 'Video', status: videoStatus, statusLabel: labelMap[videoStatus], icon: iconMap[videoStatus] },
      { key: 'credentials', label: 'Credentials', status: credStatus, statusLabel: labelMap[credStatus], icon: iconMap[credStatus] },
    ];
  }

  private buildApprovedCredentials(tutor: any): any[] {
    const items: any[] = [];
    const creds = tutor.tutorCredentials;
    if (!creds) return items;

    if (creds.governmentId?.url && creds.governmentId.status === 'approved') {
      items.push({
        type: 'governmentId',
        id: null,
        label: 'Government ID',
        fileName: creds.governmentId.fileName,
        icon: 'id-card',
      });
    }
    creds.teachingCertifications?.forEach((cert: any) => {
      if (cert.status === 'approved') {
        items.push({
          type: 'teachingCertification',
          id: cert._id,
          label: cert.certificationName || 'Teaching Certification',
          fileName: cert.fileName,
          icon: 'ribbon',
        });
      }
    });
    creds.additionalDocuments?.forEach((doc: any) => {
      if (doc.status === 'approved') {
        items.push({
          type: 'additionalDocument',
          id: doc._id,
          label: doc.label || doc.documentType || 'Additional Document',
          fileName: doc.fileName,
          icon: 'document-attach',
        });
      }
    });
    return items;
  }

  private enrichTutorLanguages(tutor: any): void {
    const profile = tutor.languageProfile;
    if (profile) {
      tutor._primaryLanguageLabel = profile.communicatesBestIn || '';
      tutor._teachingLanguagesText = profile.teaches || '';
      tutor._spokenLanguagesText = profile.alsoSpeaks || '';
      tutor._hasLanguageInfo = profile.hasLanguageInfo === true;
      return;
    }

    const ui = this.languageService.getCurrentLanguage();
    const nativeCode = (tutor.nativeLanguage || '').trim();
    tutor._primaryLanguageLabel = nativeCode
      ? this.localeDisplay.languageName(nativeCode, ui)
      : '';

    const teaching = tutor.onboardingData?.languages || [];
    tutor._teachingLanguageLabels = teaching.map((name: string) => {
      const iso = TEACHABLE_ENGLISH_NAME_TO_ISO639[name];
      return iso ? this.localeDisplay.languageName(iso, ui) : name;
    });
    tutor._teachingLanguagesText = tutor._teachingLanguageLabels.join(', ');

    const spoken = tutor.spokenLanguages || [];
    tutor._spokenLanguagesText = spoken
      .map((entry: { code: string; level: string }) =>
        `${this.localeDisplay.languageName(entry.code, ui)} (${entry.level})`)
      .join(', ');

    tutor._hasLanguageInfo =
      !!tutor._primaryLanguageLabel ||
      !!tutor._teachingLanguagesText ||
      !!tutor._spokenLanguagesText;
  }

  private buildPendingCredentials(tutor: any): any[] {
    const items: any[] = [];
    const creds = tutor.tutorCredentials;
    if (!creds) return items;

    if (creds.governmentId?.url && creds.governmentId.status === 'pending') {
      items.push({
        type: 'governmentId',
        id: null,
        label: 'Government ID',
        fileName: creds.governmentId.fileName,
        icon: 'id-card',
        badgeColor: creds.governmentId._badgeColor,
      });
    }
    creds.teachingCertifications?.forEach((cert: any) => {
      if (cert.status === 'pending') {
        items.push({
          type: 'teachingCertification',
          id: cert._id,
          label: cert.certificationName || 'Teaching Certification',
          fileName: cert.fileName,
          icon: 'ribbon',
          badgeColor: cert._badgeColor,
        });
      }
    });
    creds.additionalDocuments?.forEach((doc: any) => {
      if (doc.status === 'pending') {
        items.push({
          type: 'additionalDocument',
          id: doc._id,
          label: doc.label || doc.documentType || 'Additional Document',
          fileName: doc.fileName,
          icon: 'document-attach',
          badgeColor: doc._badgeColor,
        });
      }
    });
    return items;
  }

  calculateTimeAgo(tutor: any): string {
    const uploadedAt = tutor.tutorOnboarding?.videoUploadedAt;

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

  calculatePhotoTimeAgo(tutor: any): string {
    const uploadedAt = tutor.tutorOnboarding?.photoUploadedAt;
    if (!uploadedAt) return '';
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
    if (this.showNewUpdatesAlert) {
      const alert = await this.alertController.create({
        header: 'Data Out of Date',
        message: `There ${this.newUpdatesCount === 1 ? 'is 1 new submission' : `are ${this.newUpdatesCount} new submissions`} since you last refreshed. Please refresh the list first.`,
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
    if (this.showNewUpdatesAlert) {
      const alert = await this.alertController.create({
        header: 'Data Out of Date',
        message: `There ${this.newUpdatesCount === 1 ? 'is 1 new submission' : `are ${this.newUpdatesCount} new submissions`} since you last refreshed. Please refresh the list first.`,
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

  // Video approval methods (moved from payment-review)
  async approveVideo(tutor: any) {
    const alert = await this.alertController.create({
      header: 'Approve Video',
      message: `Approve introduction video for ${tutor.name || tutor.email}?`,
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
        await this.loadAllTutors();
      }
    } catch (error: any) {
      await loading.dismiss();
      this.showToast(error.error?.message || 'Operation failed', 'danger');
    }
  }

  async approvePhoto(tutor: any) {
    const alert = await this.alertController.create({
      header: 'Approve Photo',
      message: `Approve profile photo for ${tutor.name || tutor.email}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Approve',
          handler: async () => {
            await this.submitPhotoApproval(tutor._id, true, null);
          }
        }
      ]
    });
    await alert.present();
  }

  async rejectPhoto(tutor: any) {
    const alert = await this.alertController.create({
      header: 'Reject Photo',
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
              await this.submitPhotoApproval(tutor._id, false, data.reason);
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async submitPhotoApproval(tutorId: string, approved: boolean, rejectionReason: string | null) {
    const loading = await this.loadingController.create({
      message: approved ? 'Approving...' : 'Rejecting...'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/admin/approve-photo/${tutorId}`,
          { approved, rejectionReason },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      await loading.dismiss();

      if (response.success) {
        this.showToast(approved ? 'Photo approved!' : 'Photo rejected', 'success');
        await this.loadAllTutors();
      }
    } catch (error: any) {
      await loading.dismiss();
      this.showToast(error.error?.message || 'Operation failed', 'danger');
    }
  }

  async showToast(message: string, color: string) {
    const toast = await this.toastController.create({ message, duration: 3000, color, position: 'top' });
    await toast.present();
  }

  playTutorVideo(tutor: any, source: 'approved' | 'pending') {
    const videoUrl = source === 'approved' ? tutor._approvedVideoUrl : tutor._pendingVideoUrl;
    const thumbnailUrl = source === 'approved' ? tutor._approvedVideoThumbnail : tutor._pendingVideoThumbnail;
    const videoType = source === 'approved' ? tutor._approvedVideoType : tutor._pendingVideoType;
    const isExternal = source === 'approved' ? tutor._approvedVideoIsExternal : tutor._pendingVideoIsExternal;

    this.selectedTutor = {
      ...tutor,
      _modalVideoUrl: videoUrl,
      _modalThumbnailUrl: thumbnailUrl,
      _modalVideoType: videoType,
      _modalIsExternal: isExternal,
    };
    this.isVideoModalOpen = true;
  }

  closeVideoModal() {
    this.isVideoModalOpen = false;
    this.selectedTutor = null;
  }

  onVideoReady(event: Event) {
    const video = event.target as HTMLVideoElement;
    if (video) {
      video.muted = false;
      video.play().catch(() => {});
    }
  }

  // ============================================================
  // CREDENTIAL REVIEW METHODS
  // ============================================================

  credentialBadgeColor(status: string): string {
    if (status === 'approved') return 'success';
    if (status === 'rejected') return 'danger';
    return 'warning';
  }

  hasPendingCredentials(tutor: any): boolean {
    const creds = tutor.tutorCredentials;
    if (!creds) return false;
    
    if (creds.governmentId?.status === 'pending') return true;
    if (creds.teachingCertifications?.some((c: any) => c.status === 'pending')) return true;
    if (creds.additionalDocuments?.some((d: any) => d.status === 'pending')) return true;
    return false;
  }

  hasAnyCredentials(tutor: any): boolean {
    const creds = tutor.tutorCredentials;
    if (!creds) return false;
    
    return !!(creds.governmentId?.url || 
      creds.teachingCertifications?.length || 
      creds.additionalDocuments?.length);
  }

  async reviewCredential(tutor: any, credentialType: string, credentialId: string | null, approved: boolean) {
    if (!approved) {
      // Ask for rejection reason
      const alert = await this.alertController.create({
        header: 'Reject Document',
        message: 'Provide a reason for rejection:',
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
                await this.submitCredentialReview(tutor._id, credentialType, credentialId, false, data.reason);
              }
            }
          }
        ]
      });
      await alert.present();
      return;
    }

    // Approve directly
    const alert = await this.alertController.create({
      header: 'Approve Document',
      message: `Approve this ${credentialType === 'governmentId' ? 'government ID' : 'document'}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Approve',
          handler: async () => {
            await this.submitCredentialReview(tutor._id, credentialType, credentialId, true, null);
          }
        }
      ]
    });
    await alert.present();
  }

  async submitCredentialReview(
    tutorId: string, 
    credentialType: string, 
    credentialId: string | null, 
    approved: boolean, 
    rejectionReason: string | null
  ) {
    const loading = await this.loadingController.create({
      message: approved ? 'Approving...' : 'Rejecting...'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/admin/review-credential/${tutorId}`,
          { credentialType, credentialId, approved, rejectionReason },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      await loading.dismiss();

      if (response.success) {
        this.showToast(
          approved ? 'Credential approved!' : 'Credential rejected',
          approved ? 'success' : 'warning'
        );
        // Refresh tutor list
        await this.loadAllTutors();
      }
    } catch (error: any) {
      await loading.dismiss();
      this.showToast(error.error?.message || 'Failed to review credential', 'danger');
    }
  }

  async viewCredential(tutorId: string, credentialType: string, credentialId?: string) {
    try {
      // Build the URL path based on credential type
      let urlPath = `${environment.backendUrl}/api/admin/credential-url/${tutorId}/${credentialType}`;
      if (credentialId) {
        urlPath += `/${credentialId}`;
      }

      const headers = this.userService.getAuthHeadersSync();
      const response = await firstValueFrom(
        this.http.get<{ success: boolean; url: string }>(urlPath, { headers })
      );

      if (response?.url) {
        window.open(response.url, '_blank');
      } else {
        this.showToast('Could not load document', 'danger');
      }
    } catch (error: any) {
      console.error('❌ Error fetching credential URL:', error);
      this.showToast('Failed to load document', 'danger');
    }
  }
}


