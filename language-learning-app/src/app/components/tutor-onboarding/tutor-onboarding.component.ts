import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, LoadingController, AlertController, ToastController, ModalController } from '@ionic/angular';
import { Router } from '@angular/router';
import { UserService } from '../../services/user.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { SharedModule } from '../../shared/shared.module';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PayoutSelectionModalComponent } from '../payout-selection-modal/payout-selection-modal.component';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  icon: string;
  action?: string;
}

@Component({
  selector: 'app-tutor-onboarding',
  templateUrl: './tutor-onboarding.component.html',
  styleUrls: ['./tutor-onboarding.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, SharedModule]
})
export class TutorOnboardingComponent implements OnInit {
  currentUser: any = null;
  currentStepIndex = 0;
  loading = true;
  
  // Subscribe to approval status from UserService
  approvalStatus$ = this.userService.tutorApprovalStatus$;
  approvalStatus: any = null;

  steps: OnboardingStep[] = [
    {
      id: 'photo',
      title: 'Upload Profile Photo',
      description: 'Add a professional photo so students can recognize you',
      completed: false,
      icon: 'person-circle',
      action: 'upload-photo'
    },
    {
      id: 'video',
      title: 'Record Introduction Video',
      description: 'Create a short video introducing yourself and your teaching style',
      completed: false,
      icon: 'videocam',
      action: 'upload-video'
    },
    {
      id: 'stripe',
      title: 'Connect Bank Account',
      description: 'Set up payments to receive earnings',
      completed: false,
      icon: 'card',
      action: 'stripe-onboard'
    }
  ];

  // Video player modal
  isVideoPlayerModalOpen = false;
  isVideoPlaying = false;
  videoPlayerData: { videoUrl: string; safeVideoUrl: any; videoType: string } | null = null;

  constructor(
    private userService: UserService,
    private router: Router,
    private http: HttpClient,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private toastController: ToastController,
    private sanitizer: DomSanitizer,
    private modalController: ModalController
  ) {}

  async ngOnInit() {
    // Subscribe to approval status from service
    this.approvalStatus$.subscribe(status => {
      if (status) {
        this.approvalStatus = status;
        this.updateStepsFromStatus(status);
      }
    });
    
    await this.loadOnboardingStatus();
  }

  // Ionic lifecycle hook - refresh data when page becomes active
  ionViewWillEnter() {
    console.log('🔄 [TUTOR-APPROVAL] ionViewWillEnter - refreshing onboarding status');
    this.loadOnboardingStatus();
  }

  private updateStepsFromStatus(status: any) {
    this.steps[0].completed = status.photoComplete;
    this.steps[1].completed = status.videoApproved;
    this.steps[2].completed = status.stripeComplete;
    
    console.log('📊 [TUTOR-APPROVAL] Updated steps from status:', {
      photo: status.photoComplete,
      video: status.videoApproved,
      stripe: status.stripeComplete
    });
  }

  async loadOnboardingStatus() {
    this.loading = true;
    try {
      // Force refresh from server, not cache
      const user = await firstValueFrom(this.userService.getCurrentUser(true));
      this.currentUser = user;

      console.log('📹 [TUTOR-APPROVAL] Full onboardingData:', user.onboardingData);
      console.log('📹 [TUTOR-APPROVAL] tutorOnboarding:', user.tutorOnboarding);
      console.log('💰 [TUTOR-APPROVAL] payoutProvider:', user.payoutProvider);
      console.log('💰 [TUTOR-APPROVAL] payoutDetails:', user.payoutDetails);
      
      // For display purposes, use pendingVideo if available (new tutor), otherwise use approved video
      const videoUrl = user.onboardingData?.pendingVideo || user.onboardingData?.introductionVideo || '';
      const thumbnailUrl = user.onboardingData?.pendingVideoThumbnail || user.onboardingData?.videoThumbnail || '';
      
      console.log('📹 [TUTOR-APPROVAL] Video URL (pending or approved):', videoUrl);
      console.log('📹 [TUTOR-APPROVAL] Thumbnail URL:', thumbnailUrl);
      console.log('🖼️ [CUSTOM-THUMBNAIL-CHECK] videoThumbnail value:', thumbnailUrl);
      console.log('🖼️ [CUSTOM-THUMBNAIL-CHECK] Is GCS URL?', thumbnailUrl?.includes('storage.googleapis.com'));
      console.log('🖼️ [CUSTOM-THUMBNAIL-CHECK] Is Vimeo CDN?', thumbnailUrl?.includes('vimeocdn.com'));
      console.log('📹 [TUTOR-APPROVAL] Video approved:', user.tutorOnboarding?.videoApproved);
      console.log('📹 [TUTOR-APPROVAL] Video rejected:', user.tutorOnboarding?.videoRejected);

      // Update step 3 title/description based on payout provider
      if (user.payoutProvider === 'paypal') {
        this.steps[2].title = 'PayPal Connected';
        this.steps[2].description = 'Receive earnings via PayPal';
      } else if (user.payoutProvider === 'manual') {
        this.steps[2].title = 'Manual Payout Setup';
        this.steps[2].description = 'Earnings will be processed manually';
      } else if (user.stripeConnectOnboarded) {
        this.steps[2].title = 'Stripe Connected';
        this.steps[2].description = 'Receive earnings via Stripe';
      } else {
        this.steps[2].title = 'Connect Bank Account';
        this.steps[2].description = 'Set up payments to receive earnings';
      }

      // Auto-fetch Vimeo thumbnail if missing
      if (videoUrl && 
          !thumbnailUrl && 
          videoUrl.includes('vimeo.com')) {
        console.log('📹 [TUTOR-APPROVAL] Attempting to auto-fetch Vimeo thumbnail...');
        await this.fetchVimeoThumbnail(videoUrl);
      }

      // The UserService will automatically update tutorApprovalStatus$
      // which we're subscribed to in ngOnInit, so no need to manually set steps here

      // Set current step to first incomplete step
      this.currentStepIndex = this.steps.findIndex(step => !step.completed);
      if (this.currentStepIndex === -1) {
        this.currentStepIndex = this.steps.length - 1; // All complete
      }

      console.log('📋 [TUTOR-APPROVAL] Current step index:', this.currentStepIndex);

    } catch (error) {
      console.error('Error loading onboarding status:', error);
      this.showToast('Failed to load onboarding status', 'danger');
    } finally {
      this.loading = false;
    }
  }

  async fetchVimeoThumbnail(videoUrl: string) {
    try {
      // Extract Vimeo video ID from URL
      const videoId = videoUrl.split('/video/')[1]?.split('?')[0];
      if (!videoId) return;

      // Fetch thumbnail from Vimeo oEmbed API
      const response = await firstValueFrom(
        this.http.get<any>(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${videoId}`)
      );

      if (response.thumbnail_url) {
        console.log('📹 [TUTOR-APPROVAL] Vimeo thumbnail fetched:', response.thumbnail_url);
        // Update the currentUser object so it displays immediately
        if (this.currentUser.onboardingData) {
          this.currentUser.onboardingData.videoThumbnail = response.thumbnail_url;
        }
      }
    } catch (error) {
      console.error('📹 [TUTOR-APPROVAL] Error fetching Vimeo thumbnail:', error);
    }
  }

  get currentStep(): OnboardingStep {
    return this.steps[this.currentStepIndex];
  }

  get isFirstStep(): boolean {
    return this.currentStepIndex === 0;
  }

  get isLastStep(): boolean {
    return this.currentStepIndex === this.steps.length - 1;
  }

  get allStepsComplete(): boolean {
    return this.steps.every(step => step.completed);
  }

  get progressPercentage(): number {
    const completedCount = this.steps.filter(step => step.completed).length;
    return (completedCount / this.steps.length) * 100;
  }

  get completedStepsCount(): number {
    return this.steps.filter(step => step.completed).length;
  }

  previousStep() {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
    }
  }

  nextStep() {
    if (this.currentStepIndex < this.steps.length - 1) {
      this.currentStepIndex++;
    }
  }

  async handleStepAction() {
    const step = this.currentStep;

    switch (step.action) {
      case 'upload-photo':
        this.router.navigate(['/tabs/profile'], { queryParams: { action: 'upload-photo' } });
        break;
      case 'upload-video':
        this.router.navigate(['/tabs/profile'], { queryParams: { action: 'upload-video' } });
        break;
      case 'stripe-onboard':
        await this.startStripeOnboarding();
        break;
    }
  }

  async startStripeOnboarding() {
    console.log('🏦 [PAYMENT-SETUP] Starting payment setup...');
    
    // First, show payout selection modal
    const modal = await this.modalController.create({
      component: PayoutSelectionModalComponent,
      cssClass: 'payout-selection-modal'
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (!data) {
      console.log('🏦 [PAYMENT-SETUP] User cancelled payout selection');
      return;
    }

    console.log('🏦 [PAYMENT-SETUP] User selected:', data.provider);

    // Handle based on selected provider
    switch (data.provider) {
      case 'stripe':
        await this.setupStripeConnect();
        break;
      case 'paypal':
        await this.setupPayPal(data.paypalEmail);
        break;
      case 'manual':
        await this.setupManualPayout();
        break;
    }
  }

  private async setupStripeConnect() {
    const loading = await this.loadingController.create({
      message: 'Setting up Stripe...'
    });
    await loading.present();

    try {
      console.log('🏦 [STRIPE] Making API request to:', `${environment.apiUrl}/payments/stripe-connect/onboard`);
      
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/payments/stripe-connect/onboard`,
          {},
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      console.log('🏦 [STRIPE] Response:', response);
      await loading.dismiss();

      if (response.success && (response.url || response.onboardingUrl)) {
        const redirectUrl = response.url || response.onboardingUrl;
        console.log('🏦 [STRIPE] Redirecting to:', redirectUrl);
        window.location.href = redirectUrl; // Redirect to Stripe
      } else {
        console.error('🏦 [STRIPE] Invalid response:', response);
        this.showToast('Failed to start Stripe onboarding: ' + (response.message || 'No URL returned'), 'danger');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('🏦 [STRIPE] Error:', error);
      console.error('🏦 [STRIPE] Error details:', {
        status: error.status,
        statusText: error.statusText,
        message: error.error?.message,
        error: error.error
      });
      
      const errorMessage = error.error?.message || error.message || 'Failed to start Stripe onboarding';
      this.showToast(errorMessage, 'danger');
    }
  }

  async completeOnboarding() {
    const alert = await this.alertController.create({
      header: 'Complete Onboarding',
      message: 'Submit your profile for review? You\'ll be notified once your video is approved.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Submit',
          handler: async () => {
            await this.submitForReview();
          }
        }
      ]
    });
    await alert.present();
  }

  async submitForReview() {
    const loading = await this.loadingController.create({
      message: 'Submitting for review...'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/users/tutor/submit-for-review`,
          {},
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      await loading.dismiss();

      if (response.success) {
        const successAlert = await this.alertController.create({
          header: 'Submitted Successfully!',
          message: 'Your profile has been submitted for review. We\'ll notify you once it\'s approved.',
          buttons: [
            {
              text: 'OK',
              handler: () => {
                this.router.navigate(['/tabs/home']);
              }
            }
          ]
        });
        await successAlert.present();
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('Submit for review error:', error);
      this.showToast(error.error?.message || 'Failed to submit for review', 'danger');
    }
  }

  skipForNow() {
    this.router.navigate(['/tabs/home']);
  }

  async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      color,
      position: 'top'
    });
    await toast.present();
  }

  goToProfileUploadPhoto() {
    this.router.navigate(['/tabs/profile'], { queryParams: { action: 'upload-photo' } });
  }

  closeOnboarding() {
    this.router.navigate(['/tabs/home']);
  }

  getVideoType(videoUrl?: string): 'upload' | 'youtube' | 'vimeo' {
    if (!videoUrl) return 'upload';
    if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) return 'youtube';
    if (videoUrl.includes('vimeo.com')) return 'vimeo';
    return 'upload';
  }

  // Helper method to get the current video URL (pending or approved)
  getCurrentVideoUrl(): string {
    return this.currentUser?.onboardingData?.pendingVideo || 
           this.currentUser?.onboardingData?.introductionVideo || 
           '';
  }

  // Helper method to get the current thumbnail URL (pending or approved)
  getCurrentThumbnailUrl(): string {
    return this.currentUser?.onboardingData?.pendingVideoThumbnail || 
           this.currentUser?.onboardingData?.videoThumbnail || 
           '';
  }

  // Helper method to get the current video type (pending or approved)
  getCurrentVideoType(): 'upload' | 'youtube' | 'vimeo' {
    const videoUrl = this.getCurrentVideoUrl();
    return this.getVideoType(videoUrl);
  }

  async onVideoUploaded(videoData: { url: string; thumbnail: string; type: 'upload' | 'youtube' | 'vimeo' }) {
    console.log('📹 Video uploaded in tutor-approval flow:', videoData);
    console.log('🖼️ Thumbnail URL to save:', videoData.thumbnail);
    
    // Save the video and thumbnail to the database
    try {
      const result = await this.userService.updateTutorVideo(
        videoData.url, 
        videoData.thumbnail, 
        videoData.type
      ).toPromise();
      
      console.log('✅ Video and thumbnail saved to DB:', result);
      
      // Refresh user data to show updated video
      this.userService.getCurrentUser(true).subscribe(user => {
        if (user) {
          this.currentUser = user;
          this.loadOnboardingStatus();
          this.showToast('Video uploaded successfully!', 'success');
        }
      });
    } catch (error) {
      console.error('❌ Error saving video to DB:', error);
      this.showToast('Failed to save video. Please try again.', 'danger');
    }
  }

  async onVideoRemoved() {
    console.log('📹 Video removed in tutor-approval flow');
    
    // Remove video and thumbnail from the database
    try {
      const result = await this.userService.updateTutorVideo('', '', 'upload').toPromise();
      console.log('✅ Video removed from DB:', result);
      
      // Refresh user data
      this.userService.getCurrentUser(true).subscribe(user => {
        if (user) {
          this.currentUser = user;
          this.loadOnboardingStatus();
          this.showToast('Video removed', 'medium');
        }
      });
    } catch (error) {
      console.error('❌ Error removing video from DB:', error);
      this.showToast('Failed to remove video. Please try again.', 'danger');
    }
  }

  changeVideo() {
    // Simply call onVideoRemoved to clear the current video
    // The upload component will automatically show when no video exists
    this.onVideoRemoved();
  }

  openVideoPlayerModal() {
    const videoUrl = this.getCurrentVideoUrl();
    if (!videoUrl) return;
    
    const videoType = this.getVideoType(videoUrl);
    let displayUrl = videoUrl;
    
    // Add autoplay parameter for external videos
    if (videoType === 'youtube' || videoType === 'vimeo') {
      const separator = videoUrl.includes('?') ? '&' : '?';
      if (!videoUrl.includes('autoplay=')) {
        displayUrl = videoUrl + separator + 'autoplay=1';
      }
    }
    
    this.videoPlayerData = {
      videoUrl: displayUrl,
      safeVideoUrl: this.sanitizer.bypassSecurityTrustResourceUrl(displayUrl),
      videoType: videoType
    };
    this.isVideoPlaying = false; // Start with thumbnail showing
    this.isVideoPlayerModalOpen = true;
    console.log('🎬 Opening video player modal');
    
    // Auto-start video after brief thumbnail display (500ms)
    setTimeout(() => {
      this.startVideoPlayback();
    }, 500);
  }

  startVideoPlayback() {
    console.log('▶️ Starting video playback');
    this.isVideoPlaying = true;
  }

  onVideoPlayerModalDismiss() {
    this.isVideoPlayerModalOpen = false;
    this.isVideoPlaying = false;
    this.videoPlayerData = null;
    console.log('🎬 Closing video player modal');
  }

  private async setupPayPal(paypalEmail: string) {
    const loading = await this.loadingController.create({
      message: 'Setting up PayPal...'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/payments/setup-paypal`,
          { paypalEmail },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      await loading.dismiss();

      if (response.success) {
        this.showToast('PayPal setup complete! You can now receive payments.', 'success');
        await this.loadOnboardingStatus(); // Refresh status
      } else {
        this.showToast('Failed to setup PayPal: ' + (response.message || 'Unknown error'), 'danger');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('❌ PayPal setup error:', error);
      this.showToast('Failed to setup PayPal. Please try again.', 'danger');
    }
  }

  private async setupManualPayout() {
    const alert = await this.alertController.create({
      header: 'Manual Bank Transfer',
      message: 'Your payout method has been set to manual bank transfer. You\'ll be able to request withdrawals from your earnings page, and our team will process them manually.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Continue',
          handler: async () => {
            const loading = await this.loadingController.create({
              message: 'Setting up manual payout...'
            });
            await loading.present();

            try {
              const response = await firstValueFrom(
                this.http.post<any>(
                  `${environment.apiUrl}/payments/setup-manual`,
                  {},
                  { headers: this.userService.getAuthHeadersSync() }
                )
              );

              await loading.dismiss();

              if (response.success) {
                this.showToast('Manual payout method configured successfully!', 'success');
                await this.loadOnboardingStatus(); // Refresh status
              } else {
                this.showToast('Failed to setup manual payout: ' + (response.message || 'Unknown error'), 'danger');
              }
            } catch (error: any) {
              await loading.dismiss();
              console.error('❌ Manual payout setup error:', error);
              this.showToast('Failed to setup manual payout. Please try again.', 'danger');
            }
          }
        }
      ]
    });

    await alert.present();
  }
}
