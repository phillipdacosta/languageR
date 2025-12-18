import { Component, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserService, User } from '../services/user.service';
import { ThemeService } from '../services/theme.service';
import { LanguageService, LanguageOption, SupportedLanguage } from '../services/language.service';
import { FileUploadService } from '../services/file-upload.service';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { LoadingController, AlertController, ModalController, ToastController } from '@ionic/angular';
import { VideoUploadComponent } from '../components/video-upload/video-upload.component';
import { TimezoneSelectorComponent } from '../components/timezone-selector/timezone-selector.component';
import { detectUserTimezone } from '../shared/timezone.constants';
import { getTimezoneLabel } from '../shared/timezone.utils';

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
  isDarkMode$: Observable<boolean>;
  remindersEnabled: boolean = true; // Default to enabled
  
  // Language support
  availableLanguages: LanguageOption[] = [];
  selectedInterfaceLanguage: SupportedLanguage = 'en';

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
    private modalController: ModalController
  ) {
    this.user$ = this.authService.user$;
    this.isAuthenticated$ = this.authService.isAuthenticated$;
    this.isDarkMode$ = this.themeService.darkMode$;
    this.availableLanguages = this.languageService.supportedLanguages;
  }

  ngOnInit() {
    // Check if viewing another user's profile
    this.route.queryParams.subscribe(params => {
      const userId = params['userId'];
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
      
      // Load reminders enabled setting from localStorage
      const storedRemindersEnabled = localStorage.getItem('reminders_enabled');
      this.remindersEnabled = storedRemindersEnabled !== null ? storedRemindersEnabled === 'true' : true;
      
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
        
        if ((user.onboardingData as any)?.introductionVideo) {
          this.tutorIntroductionVideo = (user.onboardingData as any).introductionVideo;
          this.tutorVideoThumbnail = (user.onboardingData as any)?.videoThumbnail || '';
          this.tutorVideoType = (user.onboardingData as any)?.videoType || 'upload';
          console.log('📹 Loaded video data from DB:', {
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
  }

  onVideoRemoved() {
    this.tutorIntroductionVideo = '';
    this.tutorVideoThumbnail = '';
    this.tutorVideoType = 'upload';
    this.updateTutorVideo('', '', 'upload');
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
      
      const alert = await this.alertController.create({
        header: 'Success',
        message: 'Introduction video updated successfully!',
        buttons: ['OK']
      });
      await alert.present();
      
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
    localStorage.setItem('reminders_enabled', String(this.remindersEnabled));
    console.log('🔔 Reminders toggled:', this.remindersEnabled);
    
    // Reload the page to apply changes
    window.location.reload();
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
            imgElement.style.cssText = 'width: 150px; height: 150px; border-radius: 50%; object-fit: cover; display: block; margin: 16px auto; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
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

}
