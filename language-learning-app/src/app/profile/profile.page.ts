import { Component, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../services/auth.service';
import { UserService, User } from '../services/user.service';
import { ThemeService } from '../services/theme.service';
import { LanguageService, LanguageOption, SupportedLanguage } from '../services/language.service';
import { WebSocketService } from '../services/websocket.service';
import { FileUploadService } from '../services/file-upload.service';
import { Observable, firstValueFrom, Subject } from 'rxjs';
import { take, takeUntil } from 'rxjs/operators';
import { LoadingController, AlertController, ModalController, ToastController, Platform } from '@ionic/angular';
import { VideoUploadComponent } from '../components/video-upload/video-upload.component';
import { TimezoneSelectorComponent } from '../components/timezone-selector/timezone-selector.component';
import { PayoutSelectionModalComponent } from '../components/payout-selection-modal/payout-selection-modal.component';
import { detectUserTimezone } from '../shared/timezone.constants';
import { getTimezoneLabel } from '../shared/timezone.utils';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false,
})
export class ProfilePage implements OnInit {
  @ViewChild(VideoUploadComponent) videoUploadComponent?: VideoUploadComponent;
  
  user$: Observable<any>;
  isAuthenticated$: Observable<boolean>;
  currentUser: User | null = null;
  viewingUser: any = null; // User being viewed (if different from current user)
  isViewingOtherUser = false;
  tutorIntroductionVideo = '';
  tutorVideoThumbnail = '';
  tutorVideoType: 'upload' | 'youtube' | 'vimeo' = 'upload';
  isVideoApproved = false; // Track if tutor's video is approved
  hasPendingVideo = false; // Track if tutor has a pending video under review
  isDarkMode$: Observable<boolean>;
  remindersEnabled: boolean = true; // Default to enabled
  showWalletBalance: boolean = false; // Default to hidden
  aiAnalysisEnabled: boolean = true; // Default to enabled
  
  // Video player modal state
  isVideoPlayerModalOpen = false;
  videoPlayerData: {
    videoUrl: string;
    safeVideoUrl?: SafeResourceUrl;
    videoType: 'upload' | 'youtube' | 'vimeo';
  } | null = null;
  
  // Language support
  availableLanguages: LanguageOption[] = [];
  selectedInterfaceLanguage: SupportedLanguage = 'en';

  // Stripe Connect (for tutors)
  stripeConnectOnboarded = false;
  isLoadingStripeConnect = false;
  private approvalStatusSubscription?: any;
  private destroy$ = new Subject<void>();

  // Payout options (for tutors)
  payoutOptions: any = null;
  hasPayoutSetup: boolean | undefined = undefined; // undefined = loading, false = not setup, true = setup
  payoutProvider: string = 'none'; // Current payout provider: 'stripe', 'paypal', 'manual', 'none'

  // Earnings (for tutors)
  totalEarnings = 0;
  pendingEarnings = 0;
  recentPayments: any[] = [];
  loadingEarnings = false;

  constructor(
    private authService: AuthService,
    private userService: UserService,
    private themeService: ThemeService,
    private languageService: LanguageService,
    private fileUploadService: FileUploadService,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private toastController: ToastController,
    private route: ActivatedRoute,
    private router: Router,
    private modalController: ModalController,
    private sanitizer: DomSanitizer,
    private http: HttpClient,
    private platform: Platform,
    private websocketService: WebSocketService
  ) {
    this.user$ = this.authService.user$;
    this.isAuthenticated$ = this.authService.isAuthenticated$;
    this.isDarkMode$ = this.themeService.darkMode$;
    this.availableLanguages = this.languageService.supportedLanguages;
  }

  ngOnInit() {
    // For tutors, immediately get cached payout status (prevents flashing)
    if (this.isTutor()) {
      const cachedStatus = this.userService.getPayoutStatus();
      // Only use cached data if it's actually been loaded (has options)
      if (cachedStatus.options) {
        this.payoutProvider = cachedStatus.provider;
        this.hasPayoutSetup = cachedStatus.hasPayoutSetup;
        this.payoutOptions = cachedStatus.options;
        console.log('💰 [PROFILE] Using cached payout status from ngOnInit:', {
          provider: this.payoutProvider,
          hasPayoutSetup: this.hasPayoutSetup
        });
      }
    }
    
    // Subscribe to approval status from UserService
    this.approvalStatusSubscription = this.userService.tutorApprovalStatus$.subscribe(status => {
      if (status) {
        // Note: stripeComplete now includes PayPal and Manual methods too (confusingly named)
        // But we should NOT overwrite hasPayoutSetup here - let checkPayoutStatus() handle it
        // to avoid confusion between payout providers
        this.stripeConnectOnboarded = status.stripeComplete;
        console.log(`💰 [PROFILE] Payment status from service: ${this.stripeConnectOnboarded}`);
      }
    });
    
    // Subscribe to payout status updates from UserService
    this.userService.payoutStatus$.subscribe(payoutStatus => {
      if (this.isTutor()) {
        this.payoutProvider = payoutStatus.provider;
        this.hasPayoutSetup = payoutStatus.hasPayoutSetup;
        this.payoutOptions = payoutStatus.options;
        
        if (this.payoutProvider === 'stripe') {
          this.stripeConnectOnboarded = this.hasPayoutSetup;
        }
        
        console.log('💰 [PROFILE] Payout status updated from service:', payoutStatus);
      }
    });
    
    // Subscribe to video approval WebSocket notifications
    this.websocketService.tutorVideoApproved$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(async (data: any) => {
      console.log('🎉 [PROFILE] Video approved notification received:', data);
      
      // Reload user data to get updated video
      await this.userService.getCurrentUser(true).pipe(take(1)).toPromise();
      
      // Clear pending video flag
      this.hasPendingVideo = false;
      
      // Show success toast
      const toast = await this.toastController.create({
        message: '✅ Your new video has been approved!',
        duration: 4000,
        color: 'success',
        position: 'top'
      });
      await toast.present();
    });
    
    // Check if viewing another user's profile
    this.route.queryParams.subscribe(params => {
      const userId = params['userId'];
      
      // Check if returning from Stripe Connect
      if (params['stripe_success'] === 'true') {
        this.handleStripeConnectReturn(true);
      } else if (params['stripe_refresh'] === 'true') {
        this.handleStripeConnectReturn(false);
      }
      
      if (userId) {
        // Viewing another user's profile
        this.isViewingOtherUser = true;
        this.loadOtherUserProfile(userId);
      } else {
        // Viewing own profile
        this.isViewingOtherUser = false;
        this.loadCurrentUserProfile();
      }
    });
  }

  loadCurrentUserProfile() {
    // Get current user data from database
    this.userService.getCurrentUser().subscribe(user => {
      console.log('👤 ProfilePage: Loaded currentUser:', {
        id: user?.id,
        name: user?.name,
        email: user?.email,
        picture: user?.picture,
        hasPicture: !!user?.picture
      });
      this.currentUser = user;
      
      // Set current interface language
      this.selectedInterfaceLanguage = user?.interfaceLanguage || this.languageService.getCurrentLanguage();
      
      // Load Stripe Connect status for tutors
      if (this.isTutor()) {
        this.checkPayoutStatus();
        this.loadEarnings();
      }
      
      // Load settings from user profile (database)
      this.remindersEnabled = user?.profile?.remindersEnabled !== false; // Default true
      this.showWalletBalance = user?.profile?.showWalletBalance || false; // Default false
      this.aiAnalysisEnabled = user?.profile?.aiAnalysisEnabled !== false; // Default true
      
      // If user doesn't have a picture but Auth0 user does, reload after a short delay
      // This ensures the picture sync from Auth0 has completed
      if (!user?.picture && user?.email) {
        console.log('🔄 ProfilePage: User has no picture, reloading after sync delay...');
        setTimeout(() => {
          this.userService.getCurrentUser().subscribe((updatedUser: any) => {
            console.log('👤 ProfilePage: Reloaded user after sync:', {
              picture: updatedUser?.picture,
              hasPicture: !!updatedUser?.picture
            });
            this.currentUser = updatedUser;
          });
        }, 1000);
      }
      
      if (user?.userType === 'tutor') {
        console.log('📹 Full onboardingData from DB:', user.onboardingData);
        
        // Check if video is approved
        this.isVideoApproved = (user as any).tutorOnboarding?.videoApproved === true;
        console.log('✅ Video approval status:', this.isVideoApproved);
        
        // Check if there's a pending video under review
        this.hasPendingVideo = !!((user as any).onboardingData?.pendingVideo);
        console.log('⏳ Has pending video:', this.hasPendingVideo);
        
        // Prioritize pending video if it exists (for display to tutor themselves)
        const onboardingData = user.onboardingData as any;
        const hasPendingVideo = !!(onboardingData?.pendingVideo);
        const hasApprovedVideo = !!(onboardingData?.introductionVideo);
        
        if (hasPendingVideo) {
          // Show pending video if it exists
          this.tutorIntroductionVideo = onboardingData.pendingVideo;
          this.tutorVideoThumbnail = onboardingData.pendingVideoThumbnail || '';
          this.tutorVideoType = onboardingData.pendingVideoType || 'upload';
          console.log('📹 Loaded PENDING video data from DB:', {
            video: this.tutorIntroductionVideo,
            thumbnail: this.tutorVideoThumbnail,
            type: this.tutorVideoType,
            hasVideo: !!this.tutorIntroductionVideo,
            hasThumbnail: !!this.tutorVideoThumbnail
          });
        } else if (hasApprovedVideo) {
          // Show approved video if no pending video
          this.tutorIntroductionVideo = onboardingData.introductionVideo;
          this.tutorVideoThumbnail = onboardingData.videoThumbnail || '';
          this.tutorVideoType = onboardingData.videoType || 'upload';
          console.log('📹 Loaded APPROVED video data from DB:', {
            video: this.tutorIntroductionVideo,
            thumbnail: this.tutorVideoThumbnail,
            type: this.tutorVideoType,
            hasVideo: !!this.tutorIntroductionVideo,
            hasThumbnail: !!this.tutorVideoThumbnail
          });
        } else {
          console.log('📹 No introduction video in onboardingData');
        }
      }
    });
    
    // Subscribe to currentUser$ to get updates when picture changes
    this.userService.currentUser$.subscribe((updatedUser: any) => {
      if (updatedUser && updatedUser['id'] === this.currentUser?.['id']) {
        console.log('🔄 ProfilePage: Received currentUser$ update:', {
          picture: updatedUser?.picture,
          hasPicture: !!updatedUser?.picture
        });
        this.currentUser = updatedUser;
      }
    });

    // Ensure the toggle reflects the current theme state
    console.log('🎨 Profile page: Current dark mode state:', this.themeService.isDarkMode());
  }

  // Ionic lifecycle hook - called when leaving the page
  ionViewWillLeave() {
    console.log('📹 ProfilePage ionViewWillLeave - stopping video');
    
    // Stop video playback when leaving the page
    if (this.videoUploadComponent) {
      this.videoUploadComponent.stopVideo();
    }
  }

  loadOtherUserProfile(userId: string) {
    this.userService.getUserPublic(userId).subscribe({
      next: (response) => {
        if (response.tutor) {
          this.viewingUser = {
            ...response.tutor,
            userType: 'tutor'
          };
        } else if (response.student) {
          this.viewingUser = {
            ...response.student,
            userType: 'student'
          };
        }
      },
      error: (error) => {
        console.error('Error loading user profile:', error);
        // Navigate back or show error
        this.router.navigate(['/tabs/profile']);
      }
    });
  }

  async logout() {
    await this.authService.logout();
  }

  getUserInitials(user: User | null | any): string {
    if (!user || !user.name) return '?';
    return user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
  }

  // User type methods
  isTutor(): boolean {
    const user = this.isViewingOtherUser ? this.viewingUser : this.currentUser;
    return user?.userType === 'tutor';
  }

  isStudent(): boolean {
    const user = this.isViewingOtherUser ? this.viewingUser : this.currentUser;
    return user?.userType === 'student';
  }

  getDisplayUser(): any {
    return this.isViewingOtherUser ? this.viewingUser : this.currentUser;
  }

  onVideoUploaded(data: { url: string; thumbnail: string; type: 'upload' | 'youtube' | 'vimeo' }) {
    console.log('📹 Video uploaded event received:', {
      url: data.url,
      thumbnail: data.thumbnail,
      type: data.type,
      hasThumbnail: !!data.thumbnail
    });
    this.tutorIntroductionVideo = data.url;
    this.tutorVideoThumbnail = data.thumbnail;
    this.tutorVideoType = data.type;
    this.updateTutorVideo(data.url, data.thumbnail, data.type);
    
    // Immediately show pending banner (since new video is now pending approval)
    this.hasPendingVideo = true;
  }

  onVideoRemoved() {
    this.tutorIntroductionVideo = '';
    this.tutorVideoThumbnail = '';
    this.tutorVideoType = 'upload';
    this.updateTutorVideo('', '', 'upload');
  }

  openVideoPlayerModal() {
    if (!this.tutorIntroductionVideo) return;
    
    let videoUrl = this.tutorIntroductionVideo;
    
    // Add autoplay parameter for external videos
    if (this.tutorVideoType === 'youtube' || this.tutorVideoType === 'vimeo') {
      const separator = videoUrl.includes('?') ? '&' : '?';
      if (!videoUrl.includes('autoplay=')) {
        videoUrl = videoUrl + separator + 'autoplay=1';
      }
    }
    
    this.videoPlayerData = {
      videoUrl: videoUrl,
      safeVideoUrl: this.sanitizer.bypassSecurityTrustResourceUrl(videoUrl),
      videoType: this.tutorVideoType
    };
    this.isVideoPlayerModalOpen = true;
  }

  onVideoPlayerModalDismiss() {
    this.isVideoPlayerModalOpen = false;
    this.videoPlayerData = null;
  }

  private async updateTutorVideo(
    videoUrl: string, 
    thumbnailUrl?: string, 
    videoType?: 'upload' | 'youtube' | 'vimeo'
  ) {
    const loading = await this.loadingController.create({
      message: 'Updating video...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      const result = await this.userService.updateTutorVideo(videoUrl, thumbnailUrl, videoType)
        .pipe(take(1))
        .toPromise();
      
      console.log('📹 Backend response after update:', result);
      
      await loading.dismiss();
      
      // If video was previously approved, inform that new video is under review
      const message = this.isVideoApproved 
        ? 'Video updated! The new video has been sent for admin review. Your profile will remain active during the review process.'
        : 'Introduction video updated successfully!';
      
      const alert = await this.alertController.create({
        header: 'Success',
        message: message,
        buttons: ['OK']
      });
      await alert.present();
      
      // Update local approval status
      this.isVideoApproved = false;
      
      // Refresh user data to get updated tutorOnboarding status
      this.userService.getCurrentUser(true).subscribe();
      
    } catch (error) {
      console.error('Error updating tutor video:', error);
      
      // Clear the video data on failure
      this.tutorIntroductionVideo = '';
      this.tutorVideoThumbnail = '';
      this.tutorVideoType = 'upload';
      
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to update video. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      await loading.dismiss();
    }
  }

  /**
   * Toggle dark mode
   */
  toggleDarkMode(event: any): void {
    console.log('🔄 Dark mode toggle clicked, current state:', this.themeService.isDarkMode());
    this.themeService.toggleDarkMode();
    console.log('✅ Dark mode toggled, new state:', this.themeService.isDarkMode());
  }
  
  /**
   * Toggle reminders on/off
   */
  toggleReminders(event: any): void {
    this.remindersEnabled = event.detail.checked;
    
    // Save to database
    this.userService.updateRemindersEnabled(this.remindersEnabled).subscribe({
      next: (user) => {
        console.log('🔔 Reminders setting saved to database:', this.remindersEnabled);
        // Reload page to apply changes
        window.location.reload();
      },
      error: (error) => {
        console.error('❌ Error saving reminders setting:', error);
        // Revert on error
        this.remindersEnabled = !this.remindersEnabled;
      }
    });
  }
  
  /**
   * Toggle show wallet balance on/off
   */
  toggleShowWalletBalance(event: any): void {
    this.showWalletBalance = event.detail.checked;
    
    // Save to database
    this.userService.updateShowWalletBalance(this.showWalletBalance).subscribe({
      next: (user) => {
        console.log('💰 Show wallet balance setting saved to database:', this.showWalletBalance);
        // Update the current user to ensure cache is updated
        this.currentUser = user;
      },
      error: (error) => {
        console.error('❌ Error saving wallet balance setting:', error);
        // Revert on error
        this.showWalletBalance = !this.showWalletBalance;
      }
    });
  }

  /**
   * Toggle AI analysis on/off
   */
  toggleAIAnalysis(event: any): void {
    this.aiAnalysisEnabled = event.detail.checked;
    
    // Save to database
    this.userService.updateAIAnalysisEnabled(this.aiAnalysisEnabled).subscribe({
      next: (user) => {
        console.log('🤖 AI analysis setting saved to database:', this.aiAnalysisEnabled);
        // Update the current user to ensure cache is updated
        this.currentUser = user;
      },
      error: (error) => {
        console.error('❌ Error saving AI analysis setting:', error);
        // Revert on error
        this.aiAnalysisEnabled = !this.aiAnalysisEnabled;
      }
    });
  }

  /**
   * Handle interface language change
   */
  async onInterfaceLanguageChange(event: any) {
    const newLanguage = event.detail.value as SupportedLanguage;
    console.log('🌐 Interface language changed to:', newLanguage);

    // Update UI immediately
    this.languageService.setLanguage(newLanguage);

    // Save to backend
    this.userService.updateInterfaceLanguage(newLanguage).subscribe({
      next: async (updatedUser) => {
        console.log('✅ Interface language saved to backend');
        // const toast = await this.toastController.create({
        //   message: this.languageService.instant('PROFILE.INTERFACE_LANGUAGE') + ' updated',
        //   duration: 2000,
        //   position: 'bottom',
        //   color: 'success'
        // });
        // await toast.present();
      },
      error: async (error) => {
        console.error('❌ Error saving interface language:', error);
        const toast = await this.toastController.create({
          message: 'Error updating language preference',
          duration: 3000,
          position: 'bottom',
          color: 'danger'
        });
        await toast.present();
      }
    });
  }

  /**
   * Handle profile picture upload
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

    // Create preview - read file as data URL
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      const imageDataUrl = e.target.result;
      
      // Show confirmation with inline preview
      const alert = await this.alertController.create({
        header: 'Upload Profile Picture?',
        message: 'Do you want to upload this image as your profile picture?',
        cssClass: 'profile-picture-confirm-alert',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              event.target.value = '';
            }
          },
          {
            text: 'Upload',
            handler: async () => {
              await this.uploadProfilePicture(file, event);
            }
          }
        ]
      });
      
      await alert.present();
      
      // After alert is presented, inject the image into the alert
      setTimeout(() => {
        const alertElement = document.querySelector('ion-alert.profile-picture-confirm-alert');
        if (alertElement) {
          const messageElement = alertElement.querySelector('.alert-message');
          if (messageElement) {
            const imgElement = document.createElement('img');
            imgElement.src = imageDataUrl;
            imgElement.style.cssText = 'width: 150px; height: 150px; border-radius: 16px; object-fit: cover; display: block; margin: 16px auto; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
            messageElement.insertBefore(imgElement, messageElement.firstChild);
          }
        }
      }, 100);
    };
    
    reader.readAsDataURL(file);
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
      // Upload image
      const uploadResult = await this.fileUploadService.uploadImage(file).pipe(take(1)).toPromise();
      
      if (uploadResult?.success && uploadResult?.imageUrl) {
        // Update user picture in database
        const updateResult = await this.userService.updatePicture(uploadResult.imageUrl).pipe(take(1)).toPromise();
        
        if (updateResult?.success) {
          // Update current user with new picture immediately
          if (this.currentUser) {
            this.currentUser.picture = uploadResult.imageUrl;
          }
          
          // Also reload from server to ensure consistency
          this.userService.getCurrentUser().subscribe(user => {
            this.currentUser = user;
          });

          const alert = await this.alertController.create({
            header: 'Success',
            message: 'Profile picture updated successfully!',
            buttons: ['OK']
          });
          await alert.present();
        } else {
          throw new Error('Failed to update profile picture');
        }
      } else {
        throw new Error('Failed to upload image');
      }
    } catch (error) {
      console.error('Error uploading profile picture:', error);
      
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to upload profile picture. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      await loading.dismiss();
      // Reset file input
      event.target.value = '';
    }
  }

  /**
   * Check if user has a custom uploaded picture (vs Auth0/Google picture)
   */
  hasCustomPicture(): boolean {
    const picture = this.getDisplayUser()?.picture;
    if (!picture) return false;
    
    // Check if it's a custom picture (uploaded to GCS)
    // Custom pictures will be in storage.googleapis.com with our bucket
    return picture.includes('storage.googleapis.com') && picture.includes('profile-pictures');
  }

  /**
   * Trigger file input click
   */
  triggerPictureUpload() {
    console.log('🖼️ triggerPictureUpload called');
    const fileInput = document.getElementById('profile-picture-input') as HTMLInputElement;
    console.log('🖼️ File input element:', fileInput);
    if (fileInput) {
      console.log('🖼️ Clicking file input');
      fileInput.click();
    } else {
      console.error('❌ File input element not found in DOM');
    }
  }

  /**
   * Remove profile picture
   */
  async removePicture() {
    // Show confirmation alert
    const alert = await this.alertController.create({
      header: 'Remove Picture',
      message: 'Are you sure you want to remove your profile picture?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Remove',
          role: 'destructive',
          handler: async () => {
            const loading = await this.loadingController.create({
              message: 'Removing picture...',
              spinner: 'crescent'
            });
            await loading.present();

            try {
              const result = await this.userService.removePicture().pipe(take(1)).toPromise();
              
              if (result?.success) {
                // Update current user with restored picture (or undefined if no Auth0 picture)
                if (this.currentUser) {
                  this.currentUser.picture = result.picture;
                }

                // Also reload from server to ensure consistency
                this.userService.getCurrentUser().subscribe(user => {
                  this.currentUser = user;
                });

                const successAlert = await this.alertController.create({
                  header: 'Success',
                  message: result.message || 'Profile picture removed successfully!',
                  buttons: ['OK']
                });
                await successAlert.present();
              } else {
                throw new Error('Failed to remove profile picture');
              }
            } catch (error) {
              console.error('Error removing profile picture:', error);
              
              const errorAlert = await this.alertController.create({
                header: 'Error',
                message: 'Failed to remove profile picture. Please try again.',
                buttons: ['OK']
              });
              await errorAlert.present();
            } finally {
              await loading.dismiss();
            }
          }
        }
      ]
    });

    await alert.present();
  }

  /**
   * Open timezone selector modal
   */
  async openTimezoneSelector() {
    const modal = await this.modalController.create({
      component: TimezoneSelectorComponent,
      componentProps: {
        selectedTimezone: this.currentUser?.profile?.timezone || detectUserTimezone()
      }
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    
    if (data && data.timezone) {
      await this.updateTimezone(data.timezone);
    }
  }

  /**
   * Update user's timezone
   */
  private async updateTimezone(timezone: string) {
    const loading = await this.loadingController.create({
      message: 'Updating timezone...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      await this.userService.updateProfile({ timezone })
        .pipe(take(1))
        .toPromise();
      
      // Update current user
      if (this.currentUser) {
        if (!this.currentUser.profile) {
          this.currentUser.profile = { bio: '', timezone: '', preferredLanguage: '' };
        }
        this.currentUser.profile.timezone = timezone;
      }
      
      const alert = await this.alertController.create({
        header: 'Success',
        message: 'Timezone updated successfully!',
        buttons: ['OK']
      });
      await alert.present();
      
    } catch (error) {
      console.error('Error updating timezone:', error);
      
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to update timezone. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      await loading.dismiss();
    }
  }

  /**
   * Get formatted timezone label
   */
  getTimezoneLabel(): string {
    const timezone = this.currentUser?.profile?.timezone;
    if (!timezone) {
      return 'Auto-detected';
    }
    return getTimezoneLabel(timezone);
  }

  // Handle return from Stripe Connect onboarding
  async handleStripeConnectReturn(success: boolean) {
    if (success) {
      // Show success message
      const toast = await this.toastController.create({
        message: '✅ Payout setup complete! Your earnings will be transferred to your bank.',
        duration: 5000,
        color: 'success',
        position: 'top'
      });
      await toast.present();
    }
    
    // Refresh payout status in UserService (will update profile via subscription)
    setTimeout(() => {
      this.userService.loadPayoutStatus();
      this.loadEarnings(); // Also refresh earnings
    }, 1000);
    
    // Clean up URL
    this.router.navigate(['/tabs/profile'], { replaceUrl: true });
  }

  // Load earnings summary and recent payments
  async loadEarnings() {
    if (!this.isTutor()) return;

    this.loadingEarnings = true;

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
        console.log(`💰 Loaded earnings: Total $${this.totalEarnings}, Pending $${this.pendingEarnings}`);
      }
    } catch (error) {
      console.error('❌ Error loading earnings:', error);
    } finally {
      this.loadingEarnings = false;
    }
  }

  // Check Stripe Connect status for tutors
  async checkStripeConnectStatus() {
    if (!this.isTutor()) return;

    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/payments/stripe-connect/status`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success) {
        this.stripeConnectOnboarded = response.onboarded;
        console.log(`💰 Stripe Connect status: ${this.stripeConnectOnboarded ? 'Onboarded' : 'Not onboarded'}`);
      }
    } catch (error) {
      console.error('❌ Error checking Stripe Connect status:', error);
    }
  }

  // Check overall payout status (Stripe, PayPal, or Manual)
  // Uses cached data from UserService, or loads it if not yet cached
  async checkPayoutStatus() {
    if (!this.isTutor()) return;

    try {
      // Get cached payout status from UserService
      let payoutStatus = this.userService.getPayoutStatus();
      
      console.log('💰 [PROFILE] Initial cached payout status:', JSON.stringify(payoutStatus, null, 2));
      
      // If payout status hasn't been loaded yet (provider is 'none' and no options), load it now
      if (payoutStatus.provider === 'none' && !payoutStatus.options) {
        console.log('💰 [PROFILE] Payout status not cached yet, loading now...');
        await this.userService.loadPayoutStatus();
        payoutStatus = this.userService.getPayoutStatus();
        console.log('💰 [PROFILE] Loaded payout status:', JSON.stringify(payoutStatus, null, 2));
      }
      
      console.log('💰 [PROFILE] Setting local properties:', {
        payoutProvider: payoutStatus.provider,
        hasPayoutSetup: payoutStatus.hasPayoutSetup,
        hasOptions: !!payoutStatus.options
      });
      
      this.payoutProvider = payoutStatus.provider;
      this.hasPayoutSetup = payoutStatus.hasPayoutSetup;
      this.payoutOptions = payoutStatus.options;
      
      console.log('💰 [PROFILE] Local properties set:', {
        'this.payoutProvider': this.payoutProvider,
        'this.hasPayoutSetup': this.hasPayoutSetup,
        'this.payoutOptions': !!this.payoutOptions
      });
      
      // Set stripeConnectOnboarded for legacy compatibility
      if (this.payoutProvider === 'stripe') {
        this.stripeConnectOnboarded = this.hasPayoutSetup;
      }

      console.log(`💰 [PROFILE] Final payout status: provider=${this.payoutProvider}, setup=${this.hasPayoutSetup}`);
    } catch (error) {
      console.error('❌ Error checking payout status:', error);
    }
  }

  // Get payout provider display name
  getPayoutProviderName(): string {
    switch (this.payoutProvider) {
      case 'stripe': return 'Stripe';
      case 'paypal': return 'PayPal';
      case 'manual': return 'Manual Transfer';
      default: return '';
    }
  }

  // Get payout setup instructions based on what's available
  getPayoutSetupText(): string {
    if (!this.payoutOptions) return 'Set up payouts to receive earnings from your lessons.';
    
    const { stripe, paypal, manual } = this.payoutOptions;
    
    if (stripe.available && stripe.recommended) {
      return 'Set up payouts to receive earnings from your lessons via Stripe.';
    } else if (paypal.available && paypal.recommended) {
      return 'Set up payouts to receive earnings from your lessons via PayPal.';
    } else if (manual.available) {
      return 'Set up manual payouts to receive earnings from your lessons.';
    } else {
      return 'Set up payouts to receive earnings from your lessons.';
    }
  }

  // Get payout setup title
  getPayoutSetupTitle(): string {
    if (!this.payoutOptions) return 'Connect Bank Account';
    
    const { stripe, paypal } = this.payoutOptions;
    
    if (stripe.available && stripe.recommended) {
      return 'Connect Bank Account';
    } else if (paypal.available && paypal.recommended) {
      return 'Connect PayPal Account';
    } else {
      return 'Set Up Payouts';
    }
  }

  // Start Stripe Connect onboarding OR open payout selection modal
  async startStripeConnectOnboarding() {
    this.isLoadingStripeConnect = true;

    try {
      // First, check what payout options are available
      if (!this.payoutOptions) {
        const optionsResponse = await firstValueFrom(
          this.http.get<any>(`${environment.apiUrl}/payments/payout-options`, {
            headers: this.userService.getAuthHeadersSync()
          })
        );

        if (optionsResponse.success) {
          this.payoutOptions = optionsResponse.options;
        }
      }

      // If Stripe is available, go directly to Stripe
      if (this.payoutOptions?.stripe?.available) {
        await this.setupStripeConnect();
      } else {
        // Otherwise, open the payout selection modal
        this.isLoadingStripeConnect = false;
        await this.openPayoutSelectionModal();
      }
    } catch (error: any) {
      console.error('❌ Error starting payout setup:', error);
      this.isLoadingStripeConnect = false;
      
      const errorMessage = error.error?.message || error.message || 'Failed to start payout setup';
      
      const alert = await this.alertController.create({
        header: 'Setup Error',
        message: errorMessage,
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  // Open payout selection modal (PayPal, Manual, etc.)
  async openPayoutSelectionModal() {
    const modal = await this.modalController.create({
      component: PayoutSelectionModalComponent,
      cssClass: 'payout-selection-modal'
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (!data) {
      console.log('🏦 [PROFILE] User cancelled payout selection');
      return;
    }

    console.log('🏦 [PROFILE] User selected:', data.provider);

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

  // Setup Stripe Connect
  private async setupStripeConnect() {
    const loading = await this.loadingController.create({
      message: 'Setting up Stripe...'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/payments/stripe-connect/onboard`,
          {},
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      await loading.dismiss();

      if (response.success && (response.url || response.onboardingUrl)) {
        const redirectUrl = response.url || response.onboardingUrl;
        // On mobile, open in same window (_self) to keep it within the app
        // On desktop, open in new tab (_blank)
        const target = this.platform.is('mobile') || this.platform.is('mobileweb') ? '_self' : '_blank';
        window.open(redirectUrl, target);
        
        const toast = await this.toastController.create({
          message: 'Complete the setup in the new window. Refresh this page when done.',
          duration: 5000,
          color: 'primary',
          position: 'top'
        });
        await toast.present();
      } else {
        this.showToast('Failed to start Stripe onboarding', 'danger');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('❌ Error starting Stripe Connect:', error);
      
      const errorMessage = error.error?.message || error.message || 'Failed to start Stripe onboarding';
      this.showToast(errorMessage, 'danger');
    } finally {
      this.isLoadingStripeConnect = false;
    }
  }

  // Setup PayPal
  private async setupPayPal(email: string) {
    console.log('💳 [PROFILE] Setting up PayPal with email:', email);
    
    const loading = await this.loadingController.create({
      message: 'Connecting PayPal...'
    });
    await loading.present();

    try {
      console.log('💳 [PROFILE] Sending POST to /payments/setup-paypal...');
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/payments/setup-paypal`,
          { paypalEmail: email },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      console.log('💳 [PROFILE] Response from backend:', response);
      await loading.dismiss();

      if (response.success) {
        this.showToast('✅ PayPal connected successfully!', 'success');
        
        console.log('💳 [PROFILE] Forcing user data refresh...');
        // Force refresh user data from backend
        const freshUser = await firstValueFrom(this.userService.getCurrentUser(true));
        console.log('💳 [PROFILE] Fresh user data:', {
          payoutProvider: (freshUser as any)?.payoutProvider,
          paypalEmail: (freshUser as any)?.payoutDetails?.paypalEmail
        });
        
        console.log('💳 [PROFILE] Reloading payout status in UserService...');
        // Reload payout status in UserService (will update profile via subscription)
        await this.userService.loadPayoutStatus();
        
        console.log('💳 [PROFILE] Final state:', {
          payoutProvider: this.payoutProvider,
          hasPayoutSetup: this.hasPayoutSetup
        });
      } else {
        console.error('💳 [PROFILE] Backend returned error:', response.message);
        this.showToast(response.message || 'Failed to connect PayPal', 'danger');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('❌ [PROFILE] Error setting up PayPal:', error);
      console.error('❌ [PROFILE] Error details:', error.error);
      this.showToast(error.error?.message || 'Failed to connect PayPal', 'danger');
    }
  }

  // Setup Manual Payout
  private async setupManualPayout() {
    const alert = await this.alertController.create({
      header: 'Manual Payout',
      message: 'Your earnings will be processed manually by our team. We\'ll contact you via email for payout details.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Confirm',
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
                this.showToast('✅ Manual payout setup complete!', 'success');
                
                // Force refresh user data from backend
                await firstValueFrom(this.userService.getCurrentUser(true));
                
                // Reload payout status in UserService (will update profile via subscription)
                await this.userService.loadPayoutStatus();
              } else {
                this.showToast(response.message || 'Failed to setup manual payout', 'danger');
              }
            } catch (error: any) {
              await loading.dismiss();
              console.error('❌ Error setting up manual payout:', error);
              this.showToast(error.error?.message || 'Failed to setup manual payout', 'danger');
            }
          }
        }
      ]
    });

    await alert.present();
  }

  // Helper to show toast
  private async showToast(message: string, color: string = 'dark') {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      color,
      position: 'top'
    });
    await toast.present();
  }

  // Original Stripe-only onboarding (kept for backward compatibility, now calls new method)
  async startOriginalStripeOnboarding() {
    this.isLoadingStripeConnect = true;

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/payments/stripe-connect/onboard`, {}, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success && response.onboardingUrl) {
        // On mobile, open in same window (_self) to keep it within the app
        // On desktop, open in new tab (_blank)
        const target = this.platform.is('mobile') || this.platform.is('mobileweb') ? '_self' : '_blank';
        window.open(response.onboardingUrl, target);
        
        const toast = await this.toastController.create({
          message: 'Complete the setup in the new window. Refresh this page when done.',
          duration: 5000,
          color: 'primary',
          position: 'top'
        });
        await toast.present();
      }
    } catch (error: any) {
      console.error('❌ Error starting Stripe Connect onboarding:', error);
      
      // Show helpful error message
      const errorMessage = error.error?.message || error.message || 'Failed to start payout setup';
      
      const alert = await this.alertController.create({
        header: 'Setup Not Available',
        message: errorMessage.includes('signed up for Connect') 
          ? 'Stripe Connect needs to be enabled in the platform settings. Please contact support.'
          : errorMessage,
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      this.isLoadingStripeConnect = false;
    }
  }

  // NEW: Edit existing Stripe Connect account
  async editStripeConnectAccount() {
    this.isLoadingStripeConnect = true;

    try {
      // Generate a Stripe dashboard login link
      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/payments/stripe-connect/dashboard`, {}, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success && response.dashboardUrl) {
        // On mobile, open in same window (_self) to keep it within the app
        // On desktop, open in new tab (_blank)
        const target = this.platform.is('mobile') || this.platform.is('mobileweb') ? '_self' : '_blank';
        window.open(response.dashboardUrl, target);
        
        const toast = await this.toastController.create({
          message: 'Opening Stripe Express Dashboard...',
          duration: 3000,
          color: 'primary',
          position: 'top'
        });
        await toast.present();
      }
    } catch (error: any) {
      console.error('❌ Error opening Stripe dashboard:', error);
      
      // Fallback: restart onboarding
      const alert = await this.alertController.create({
        header: 'Update Payout Settings',
        message: 'Would you like to update your payout information?',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel'
          },
          {
            text: 'Update',
            handler: () => {
              this.startStripeConnectOnboarding();
            }
          }
        ]
      });
      await alert.present();
    } finally {
      this.isLoadingStripeConnect = false;
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    
    if (this.approvalStatusSubscription) {
      this.approvalStatusSubscription.unsubscribe();
    }
  }

}
