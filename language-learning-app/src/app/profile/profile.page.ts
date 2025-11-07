import { Component, OnInit } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { UserService, User } from '../services/user.service';
import { ThemeService } from '../services/theme.service';
import { FileUploadService } from '../services/file-upload.service';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { LoadingController, AlertController } from '@ionic/angular';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false,
})
export class ProfilePage implements OnInit {
  user$: Observable<any>;
  isAuthenticated$: Observable<boolean>;
  currentUser: User | null = null;
  tutorIntroductionVideo = '';
  isDarkMode$: Observable<boolean>;

  constructor(
    private authService: AuthService,
    private userService: UserService,
    private themeService: ThemeService,
    private fileUploadService: FileUploadService,
    private loadingController: LoadingController,
    private alertController: AlertController
  ) {
    this.user$ = this.authService.user$;
    this.isAuthenticated$ = this.authService.isAuthenticated$;
    this.isDarkMode$ = this.themeService.darkMode$;
  }

  ngOnInit() {
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
      
      if (user?.userType === 'tutor' && (user.onboardingData as any)?.introductionVideo) {
        this.tutorIntroductionVideo = (user.onboardingData as any).introductionVideo;
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

  async logout() {
    await this.authService.logout();
  }

  getUserInitials(user: User | null): string {
    if (!user || !user.name) return '?';
    return user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }

  // Tutor-specific methods
  isTutor(): boolean {
    return this.currentUser?.userType === 'tutor';
  }

  onVideoUploaded(videoUrl: string) {
    this.tutorIntroductionVideo = videoUrl;
    this.updateTutorVideo();
  }

  onVideoRemoved() {
    this.tutorIntroductionVideo = '';
    this.updateTutorVideo();
  }

  private async updateTutorVideo() {
    const loading = await this.loadingController.create({
      message: 'Updating video...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      await this.userService.updateTutorVideo(this.tutorIntroductionVideo).pipe(take(1)).toPromise();
      
      const alert = await this.alertController.create({
        header: 'Success',
        message: 'Introduction video updated successfully!',
        buttons: ['OK']
      });
      await alert.present();
      
    } catch (error) {
      console.error('Error updating tutor video:', error);
      
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
      return;
    }

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
   * Trigger file input click
   */
  triggerPictureUpload() {
    const fileInput = document.getElementById('profile-picture-input') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

}
