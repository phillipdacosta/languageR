import { Component, OnInit } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { UserService, User } from '../services/user.service';
import { ThemeService } from '../services/theme.service';
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
      this.currentUser = user;
      if (user?.userType === 'tutor' && (user.onboardingData as any)?.introductionVideo) {
        this.tutorIntroductionVideo = (user.onboardingData as any).introductionVideo;
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

}
