import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, User } from '../services/auth.service';
import { UserService, TutorOnboardingData } from '../services/user.service';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { LoadingController, AlertController } from '@ionic/angular';

@Component({
  selector: 'app-tutor-onboarding',
  templateUrl: './tutor-onboarding.page.html',
  styleUrls: ['./tutor-onboarding.page.scss'],
  standalone: false,
})
export class TutorOnboardingPage implements OnInit {
  user$: Observable<User | null>;
  currentStep = 1;
  totalSteps = 4;

  // Tutor onboarding data
  selectedLanguages: string[] = [];
  selectedExperience = '';
  selectedSchedule = '';
  profileBio = '';
  hourlyRate = 25;

  // Available options
  availableLanguages = [
    'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 
    'Chinese', 'Japanese', 'Korean', 'Arabic', 'Russian', 'Dutch', 'Swedish'
  ];

  experienceLevels = [
    'New to teaching (0-1 years)',
    'Some experience (1-3 years)',
    'Experienced (3-5 years)',
    'Very experienced (5+ years)',
    'Native speaker with teaching experience'
  ];

  scheduleOptions = [
    'Weekdays only',
    'Weekends only',
    'Evenings only',
    'Flexible schedule',
    'Full-time availability'
  ];

  constructor(
    private authService: AuthService,
    private userService: UserService,
    private router: Router,
    private loadingController: LoadingController,
    private alertController: AlertController
  ) {
    this.user$ = this.authService.user$;
  }

  ngOnInit() {
    // Check if user is authenticated
    this.authService.isAuthenticated$.subscribe(isAuthenticated => {
      if (!isAuthenticated) {
        this.router.navigate(['/login']);
      }
    });
  }

  nextStep() {
    if (this.canProceed() && this.currentStep < this.totalSteps) {
      this.currentStep++;
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
    }
  }

  toggleLanguage(language: string) {
    const index = this.selectedLanguages.indexOf(language);
    if (index > -1) {
      this.selectedLanguages.splice(index, 1);
    } else {
      this.selectedLanguages.push(language);
    }
  }

  setExperience(experience: string) {
    this.selectedExperience = experience;
  }

  setSchedule(schedule: string) {
    this.selectedSchedule = schedule;
  }

  async completeOnboarding() {
    const loading = await this.loadingController.create({
      message: 'Completing setup...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // First, ensure user exists in database
      console.log('🔍 Creating/updating tutor in database...');
      console.log('🔍 localStorage selectedUserType:', localStorage.getItem('selectedUserType'));
      const auth0User = await this.authService.getUserProfile().pipe(take(1)).toPromise();
      
      if (!auth0User) {
        throw new Error('No Auth0 user data available');
      }

      console.log('🔍 Auth0User data:', auth0User);

      // Create or update user in database
      console.log('🔍 About to call initializeUser...');
      const user = await this.userService.initializeUser(auth0User).toPromise();
      console.log('🔍 Tutor created/updated in database:', user);
      console.log('🔍 Tutor userType:', user?.userType);

      // Prepare tutor onboarding data
      const onboardingData: TutorOnboardingData = {
        languages: this.selectedLanguages,
        experience: this.selectedExperience,
        schedule: this.selectedSchedule,
        bio: this.profileBio,
        hourlyRate: this.hourlyRate
      };

      console.log('Saving tutor onboarding data to database:', onboardingData);

      // Complete onboarding
      const updatedUser = await this.userService.completeTutorOnboarding(onboardingData).toPromise();
      
      console.log('Tutor onboarding completed successfully:', updatedUser);

      // Store in localStorage as backup
      localStorage.setItem('onboarding_completed', 'true');
      localStorage.setItem('onboarding_data', JSON.stringify({
        ...onboardingData,
        completedAt: new Date().toISOString()
      }));

      await loading.dismiss();

      // Navigate to main app
      this.router.navigate(['/tabs']);
    } catch (error) {
      console.error('Error completing tutor onboarding:', error);
      await loading.dismiss();
      
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to complete setup. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  getProgressPercentage(): number {
    return (this.currentStep / this.totalSteps) * 100;
  }

  canProceed(): boolean {
    switch (this.currentStep) {
      case 1:
        return this.selectedLanguages.length > 0;
      case 2:
        return this.selectedExperience !== '';
      case 3:
        return this.selectedSchedule !== '';
      case 4:
        return true; // Bio and rate are optional
      default:
        return false;
    }
  }
}