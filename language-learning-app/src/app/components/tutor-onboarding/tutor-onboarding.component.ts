import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, LoadingController, AlertController, ToastController, ModalController } from '@ionic/angular';
import { Router } from '@angular/router';
import { UserService } from '../../services/user.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { SharedModule } from '../../shared/shared.module';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PayoutSelectionModalComponent } from '../payout-selection-modal/payout-selection-modal.component';
import { FileUploadService } from '../../services/file-upload.service';
import { ImageCropperComponent } from '../image-cropper/image-cropper.component';

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
  imports: [CommonModule, FormsModule, IonicModule, SharedModule]
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
      id: 'credentials',
      title: 'Upload Credentials',
      description: 'Verify your identity and teaching qualifications',
      completed: false,
      icon: 'shield-checkmark',
      action: 'upload-credentials'
    },
    {
      id: 'stripe',
      title: 'Connect Bank Account',
      description: 'Set up payments to receive earnings',
      completed: false,
      icon: 'card',
      action: 'stripe-onboard'
    },
    {
      id: 'tos',
      title: 'Terms & Agreement',
      description: 'Review and accept the terms of service',
      completed: false,
      icon: 'document-text',
      action: 'accept-tos'
    }
  ];

  // Credential upload state
  uploadedCertifications: any[] = [];
  uploadedAdditionalDocs: any[] = [];
  governmentIdStatus: string = 'not_uploaded';
  governmentIdStatusLabel: string = 'Not Uploaded';
  certificationNameInput: string = '';
  isUploadingCredential: boolean = false;

  // Video player modal
  isVideoPlayerModalOpen = false;
  isVideoPlaying = false;
  videoPlayerData: { videoUrl: string; safeVideoUrl: any; videoType: string } | null = null;

  // Payment setup flow state
  paymentSetupStep: 'tax-status' | 'bank-account' | 'setup-method' = 'tax-status';
  isUSPersonForTax: boolean | null = null;
  hasUSBankAccount: boolean | null = null;
  determinedPayoutMethod: 'stripe' | 'paypal' | null = null;
  paypalEmail = '';
  paypalEmailError = '';

  // TOS state
  tosChecked = false;
  tosAcceptedAt: Date | null = null;
  isAcceptingTos = false;

  constructor(
    private userService: UserService,
    private router: Router,
    private http: HttpClient,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private toastController: ToastController,
    private sanitizer: DomSanitizer,
    private modalController: ModalController,
    private fileUploadService: FileUploadService
  ) {}

  async ngOnInit() {
    // Subscribe to approval status from service
    this.approvalStatus$.subscribe(status => {
      if (status) {
        this.approvalStatus = status;
        this.updateStepsFromStatus(status);
      }
    });

    // Subscribe to user data changes (e.g. from WebSocket-triggered refreshes)
    // This keeps credential lists in sync when admin approves/rejects
    this.userService.currentUser$.subscribe(user => {
      if (user && this.currentUser) {
        this.currentUser = user;
        const creds = user.tutorCredentials;
        this.uploadedCertifications = creds?.teachingCertifications || [];
        this.uploadedAdditionalDocs = creds?.additionalDocuments || [];
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
    this.steps[2].completed = status.credentialsApproved;
    this.steps[3].completed = status.stripeComplete;
    this.steps[4].completed = status.tosComplete;
    
    // Update credential display state
    this.governmentIdStatus = status.governmentIdApproved ? 'approved' 
      : status.governmentIdRejected ? 'rejected'
      : status.governmentIdUploaded ? 'pending' 
      : 'not_uploaded';
    this.governmentIdStatusLabel = this.governmentIdStatus === 'approved' ? 'Approved'
      : this.governmentIdStatus === 'rejected' ? 'Rejected'
      : this.governmentIdStatus === 'pending' ? 'Pending Review'
      : 'Not Uploaded';
    
    console.log('📊 [TUTOR-APPROVAL] Updated steps from status:', {
      photo: status.photoComplete,
      video: status.videoApproved,
      credentials: status.credentialsApproved,
      stripe: status.stripeComplete
    });
  }

  async loadOnboardingStatus(autoAdvanceStep = true) {
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

      // Load existing tax info if available
      if (user.isUSPersonForTax !== null && user.isUSPersonForTax !== undefined) {
        this.isUSPersonForTax = user.isUSPersonForTax;
        console.log('📋 [TUTOR-APPROVAL] Loaded isUSPersonForTax:', this.isUSPersonForTax);
      }
      if (user.hasUSBankAccount !== null && user.hasUSBankAccount !== undefined) {
        this.hasUSBankAccount = user.hasUSBankAccount;
        console.log('📋 [TUTOR-APPROVAL] Loaded hasUSBankAccount:', this.hasUSBankAccount);
      }
      
      // If tax info is already complete, skip to the appropriate step
      if (this.isUSPersonForTax !== null) {
        if (this.isUSPersonForTax === false) {
          // Non-US person - skip to setup
          this.determinedPayoutMethod = 'paypal';
          this.paymentSetupStep = 'setup-method';
        } else if (this.hasUSBankAccount !== null) {
          // US person with bank status known
          this.determinedPayoutMethod = this.hasUSBankAccount ? 'stripe' : 'paypal';
          this.paymentSetupStep = 'setup-method';
        } else {
          // US person but bank status unknown
          this.paymentSetupStep = 'bank-account';
        }
      }

      // Load credential data
      const creds = user.tutorCredentials;
      this.uploadedCertifications = creds?.teachingCertifications || [];
      this.uploadedAdditionalDocs = creds?.additionalDocuments || [];
      
      console.log('📄 [TUTOR-APPROVAL] Credentials loaded:', {
        governmentId: creds?.governmentId?.status,
        certifications: this.uploadedCertifications.length,
        additionalDocs: this.uploadedAdditionalDocs.length
      });

      // Load TOS acceptance state
      if (user.tosAcceptedAt) {
        this.tosAcceptedAt = new Date(user.tosAcceptedAt);
        this.tosChecked = true;
      }

      // Update step 4 title/description based on payout provider
      if (user.payoutProvider === 'paypal') {
        this.steps[3].title = 'PayPal Connected';
        this.steps[3].description = 'Receive earnings via PayPal';
      } else if (user.payoutProvider === 'manual') {
        this.steps[3].title = 'Manual Payout Setup';
        this.steps[3].description = 'Earnings will be processed manually';
      } else if (user.stripeConnectOnboarded) {
        this.steps[3].title = 'Stripe Connected';
        this.steps[3].description = 'Receive earnings via Stripe';
      } else {
        this.steps[3].title = 'Connect Bank Account';
        this.steps[3].description = 'Set up payments to receive earnings';
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

      // Only auto-advance to first incomplete step on initial load
      // Don't change step when refreshing after an upload (user should stay on current step)
      if (autoAdvanceStep) {
        this.currentStepIndex = this.steps.findIndex(step => !step.completed);
        if (this.currentStepIndex === -1) {
          this.currentStepIndex = this.steps.length - 1; // All complete
        }
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

  // Payment setup flow methods
  setUSPersonStatus(isUSPerson: boolean) {
    this.isUSPersonForTax = isUSPerson;
  }

  setUSBankStatus(hasUSBank: boolean) {
    this.hasUSBankAccount = hasUSBank;
  }

  nextPaymentStep() {
    if (this.paymentSetupStep === 'tax-status') {
      if (this.isUSPersonForTax === false) {
        // Non-US Person → PayPal
        this.determinedPayoutMethod = 'paypal';
        this.paymentSetupStep = 'setup-method';
      } else {
        // US Person → Ask about bank account
        this.paymentSetupStep = 'bank-account';
      }
    } else if (this.paymentSetupStep === 'bank-account') {
      // Determine payout method based on answers
      if (this.hasUSBankAccount) {
        // US Person + US Bank → Stripe
        this.determinedPayoutMethod = 'stripe';
      } else {
        // US Person + No US Bank → PayPal
        this.determinedPayoutMethod = 'paypal';
      }
      this.paymentSetupStep = 'setup-method';
    }
  }

  previousPaymentStep() {
    if (this.paymentSetupStep === 'bank-account') {
      this.paymentSetupStep = 'tax-status';
    } else if (this.paymentSetupStep === 'setup-method') {
      if (this.isUSPersonForTax) {
        this.paymentSetupStep = 'bank-account';
      } else {
        this.paymentSetupStep = 'tax-status';
      }
    }
  }

  editTaxInfo() {
    this.paymentSetupStep = 'tax-status';
    this.determinedPayoutMethod = null;
  }

  validatePayPalEmail() {
    this.paypalEmailError = '';
    
    if (!this.paypalEmail.trim()) {
      return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.paypalEmail.trim())) {
      this.paypalEmailError = 'Please enter a valid email address';
    }
  }

  canSetupPayment(): boolean {
    if (this.determinedPayoutMethod === 'paypal') {
      return this.paypalEmail.trim().length > 0 && !this.paypalEmailError;
    }
    return this.determinedPayoutMethod !== null;
  }

  async setupPaymentMethod() {
    if (!this.canSetupPayment()) {
      return;
    }

    if (this.determinedPayoutMethod === 'stripe') {
      await this.setupStripeConnect(this.isUSPersonForTax, this.hasUSBankAccount);
    } else if (this.determinedPayoutMethod === 'paypal') {
      await this.setupPayPal(this.paypalEmail, this.isUSPersonForTax, this.hasUSBankAccount);
    }
  }

  async handleStepAction() {
    const step = this.currentStep;

    switch (step.action) {
      case 'upload-photo':
        this.triggerPictureUpload();
        break;
      case 'upload-video':
        this.router.navigate(['/tabs/profile'], { queryParams: { action: 'upload-video' } });
        break;
      case 'stripe-onboard':
        await this.startStripeOnboarding();
        break;
      case 'accept-tos':
        await this.acceptTos();
        break;
    }
  }

  async acceptTos() {
    if (!this.tosChecked || this.isAcceptingTos) return;

    this.isAcceptingTos = true;
    const loading = await this.loadingController.create({
      message: 'Saving...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      const result = await firstValueFrom(this.userService.acceptTos('1.0'));
      if (result?.success) {
        this.tosAcceptedAt = new Date(result.tosAcceptedAt);
        this.showToast('Terms accepted successfully!', 'success');
        await this.loadOnboardingStatus(false);
      } else {
        this.showToast('Failed to accept terms', 'danger');
      }
    } catch (error: any) {
      console.error('Error accepting TOS:', error);
      this.showToast(error.error?.message || 'Failed to accept terms', 'danger');
    } finally {
      this.isAcceptingTos = false;
      await loading.dismiss();
    }
  }

  /**
   * Trigger file picker for profile picture upload
   */
  triggerPictureUpload() {
    const fileInput = document.getElementById('tutor-onboarding-photo-input') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    } else {
      console.error('❌ File input element not found in DOM');
    }
  }

  /**
   * Handle profile picture file selection
   */
  async onPictureSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate image
    const validation = this.fileUploadService.validateImage(file);
    if (!validation.valid) {
      const alert = await this.alertController.create({
        header: 'Invalid Image',
        message: validation.error,
        buttons: ['OK']
      });
      await alert.present();
      // Reset file input
      event.target.value = '';
      return;
    }

    // Open cropper modal
    const modal = await this.modalController.create({
      component: ImageCropperComponent,
      componentProps: {
        imageChangedEvent: event
      },
      cssClass: 'image-cropper-modal'
    });

    await modal.present();

    const { data, role } = await modal.onWillDismiss();

    if (role === 'crop' && data) {
      // Convert blob to file
      const croppedFile = new File([data], file.name, { type: 'image/png' });
      await this.uploadProfilePicture(croppedFile, event);
    } else {
      // Reset file input if cancelled
      event.target.value = '';
    }
  }

  /**
   * Upload profile picture to server
   */
  async uploadProfilePicture(file: File, event: any) {
    const loading = await this.loadingController.create({
      message: 'Uploading image...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Upload image using FileUploadService (handles headers correctly)
      const uploadResult = await firstValueFrom(this.fileUploadService.uploadImage(file));
      
      if (uploadResult?.success && uploadResult?.imageUrl) {
        // Update user picture in database
        const updateResult = await firstValueFrom(this.userService.updatePicture(uploadResult.imageUrl));
        
        if (updateResult?.success) {
          // Refresh onboarding status to update the photo step
          await this.loadOnboardingStatus();
          this.showToast('Profile photo uploaded successfully!', 'success');
        } else {
          this.showToast('Failed to update profile picture', 'danger');
        }
      } else {
        this.showToast('Failed to upload image', 'danger');
      }
    } catch (error: any) {
      console.error('Error uploading profile picture:', error);
      this.showToast(error.error?.message || 'Failed to upload photo', 'danger');
    } finally {
      await loading.dismiss();
      // Reset file input
      event.target.value = '';
    }
  }

  // ============================================================
  // CREDENTIAL UPLOAD METHODS
  // ============================================================

  triggerCredentialUpload(type: 'governmentId' | 'certification' | 'additionalDocument') {
    const inputId = type === 'governmentId' ? 'gov-id-input' 
      : type === 'certification' ? 'cert-input'
      : 'additional-doc-input';
    const fileInput = document.getElementById(inputId) as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  async onCredentialSelected(event: any, credentialType: 'governmentId' | 'teachingCertification' | 'additionalDocument') {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      this.showToast('File is too large. Maximum size is 10MB.', 'danger');
      event.target.value = '';
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      this.showToast('Invalid file type. Please upload a JPG, PNG, or PDF.', 'danger');
      event.target.value = '';
      return;
    }

    this.isUploadingCredential = true;
    const loading = await this.loadingController.create({
      message: 'Uploading document...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      const metadata: any = {};
      if (credentialType === 'teachingCertification') {
        metadata.certificationName = this.certificationNameInput || '';
      }

      const result = await firstValueFrom(
        this.userService.uploadCredential(file, credentialType, metadata)
      );

      if (result?.success) {
        this.showToast('Document uploaded successfully!', 'success');
        this.certificationNameInput = ''; // Reset
        // Refresh data but stay on credentials step (don't auto-advance)
        await this.loadOnboardingStatus(false);
      } else {
        this.showToast('Failed to upload document', 'danger');
      }
    } catch (error: any) {
      console.error('❌ Error uploading credential:', error);
      this.showToast(error.error?.message || 'Failed to upload document', 'danger');
    } finally {
      this.isUploadingCredential = false;
      await loading.dismiss();
      event.target.value = '';
    }
  }

  async onCertificationSelected(event: any) {
    await this.onCredentialSelected(event, 'teachingCertification');
  }

  async onAdditionalDocSelected(event: any) {
    await this.onCredentialSelected(event, 'additionalDocument');
  }

  async removeCredential(credentialType: 'governmentId' | 'teachingCertification' | 'additionalDocument', credentialId?: string) {
    const alert = await this.alertController.create({
      header: 'Remove Document',
      message: 'Are you sure you want to remove this document?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: async () => {
            try {
              const result = await firstValueFrom(
                this.userService.deleteCredential(credentialType, credentialId)
              );
              if (result?.success) {
                this.showToast('Document removed', 'medium');
                await this.loadOnboardingStatus();
              }
            } catch (error: any) {
              console.error('❌ Error removing credential:', error);
              this.showToast(error.error?.message || 'Failed to remove document', 'danger');
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async removeCertification(index: number) {
    const cert = this.uploadedCertifications[index];
    if (cert?._id) {
      await this.removeCredential('teachingCertification', cert._id);
    }
  }

  async removeAdditionalDoc(index: number) {
    const doc = this.uploadedAdditionalDocs[index];
    if (doc?._id) {
      await this.removeCredential('additionalDocument', doc._id);
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

    console.log('🏦 [PAYMENT-SETUP] User selected:', data.provider, 'Tax info:', {
      isUSPersonForTax: data.isUSPersonForTax,
      hasUSBankAccount: data.hasUSBankAccount
    });

    // Handle based on selected provider - pass tax info along
    switch (data.provider) {
      case 'stripe':
        await this.setupStripeConnect(data.isUSPersonForTax, data.hasUSBankAccount);
        break;
      case 'paypal':
        await this.setupPayPal(data.paypalEmail, data.isUSPersonForTax, data.hasUSBankAccount);
        break;
      case 'manual':
        await this.setupManualPayout(data.isUSPersonForTax, data.hasUSBankAccount);
        break;
    }
  }

  private async setupStripeConnect(isUSPersonForTax?: boolean | null, hasUSBankAccount?: boolean | null) {
    const loading = await this.loadingController.create({
      message: 'Setting up Stripe...'
    });
    await loading.present();

    try {
      console.log('🏦 [STRIPE] Making API request to:', `${environment.apiUrl}/payments/stripe-connect/onboard`);
      
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/payments/stripe-connect/onboard`,
          { isUSPersonForTax, hasUSBankAccount },
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
  }

  onVideoReady(event: Event) {
    const video = event.target as HTMLVideoElement;
    if (video) {
      video.muted = false;
      video.play().catch(() => {});
    }
  }

  private async setupPayPal(paypalEmail: string, isUSPersonForTax?: boolean | null, hasUSBankAccount?: boolean | null) {
    const loading = await this.loadingController.create({
      message: 'Setting up PayPal...'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/payments/setup-paypal`,
          { paypalEmail, isUSPersonForTax, hasUSBankAccount },
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

  private async setupManualPayout(isUSPersonForTax?: boolean | null, hasUSBankAccount?: boolean | null) {
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
                  { isUSPersonForTax, hasUSBankAccount },
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
