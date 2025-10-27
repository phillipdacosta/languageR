import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserService, OnboardingData, TutorOnboardingData, User } from '../services/user.service';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { LoadingController, AlertController } from '@ionic/angular';

@Component({
  selector: 'app-onboarding',
  templateUrl: './onboarding.page.html',
  styleUrls: ['./onboarding.page.scss'],
  standalone: false,
})
export class OnboardingPage implements OnInit {
  user$: Observable<any>;
  currentStep = 1;
  totalSteps = 4;
  currentUser: User | null = null;

  // Onboarding data
  selectedLanguages: string[] = [];
  learningGoals: string[] = [];
  experienceLevel = '';
  preferredSchedule = '';

  // Tutor-specific data
  tutorExperience = '';
  tutorSchedule = '';
  tutorBio = '';
  tutorHourlyRate = 25;
  tutorIntroductionVideo = '';

  // Available options
  availableLanguages = [
    'Spanish', 'French', 'German', 'Italian', 'Portuguese', 
    'Chinese', 'Japanese', 'Korean', 'Arabic', 'Russian'
  ];

  availableGoals = [
    'Travel and tourism',
    'Business communication',
    'Academic studies',
    'Cultural understanding',
    'Personal interest',
    'Career advancement',
    'Make new friends'
  ];

  experienceLevels = ['Beginner', 'Intermediate', 'Advanced'];

  scheduleOptions = [
    'Daily (30+ minutes)',
    '3-4 times per week',
    'Weekends only',
    'Flexible schedule'
  ];

  // Tutor-specific options
  tutorExperienceOptions = [
    'Beginner (0-1 years)',
    'Intermediate (1-3 years)',
    'Advanced (3+ years)',
    'Native speaker'
  ];

  tutorScheduleOptions = [
    'Morning (6 AM - 12 PM)',
    'Afternoon (12 PM - 6 PM)',
    'Evening (6 PM - 12 AM)',
    'Flexible schedule'
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

    // Get current user from database to determine if they're a tutor
    this.userService.getCurrentUser().subscribe(user => {
      this.currentUser = user;
      if (user?.userType === 'tutor') {
        this.totalSteps = 5; // Add extra step for video upload
      }
    });
  }

  nextStep() {
    if (this.currentStep < this.totalSteps) {
      this.currentStep++;
    } else {
      this.completeOnboarding();
    }
  }

  previousStep() {
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

  toggleGoal(goal: string) {
    const index = this.learningGoals.indexOf(goal);
    if (index > -1) {
      this.learningGoals.splice(index, 1);
    } else {
      this.learningGoals.push(goal);
    }
  }

  setExperienceLevel(level: string) {
    this.experienceLevel = level;
  }

  setPreferredSchedule(schedule: string) {
    this.preferredSchedule = schedule;
  }

  // Tutor-specific methods
  setTutorExperience(experience: string) {
    this.tutorExperience = experience;
  }

  setTutorSchedule(schedule: string) {
    this.tutorSchedule = schedule;
  }

  setTutorBio(bio: string) {
    this.tutorBio = bio;
  }

  setTutorHourlyRate(rate: number) {
    this.tutorHourlyRate = rate;
  }

  onVideoUploaded(videoUrl: string) {
    this.tutorIntroductionVideo = videoUrl;
  }

  onVideoRemoved() {
    this.tutorIntroductionVideo = '';
  }

  async completeOnboarding() {
    const loading = await this.loadingController.create({
      message: 'Completing setup...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // First, ensure user exists in database
      console.log('🔍 Creating/updating user in database...');
      console.log('🔍 localStorage selectedUserType:', localStorage.getItem('selectedUserType'));
      const auth0User = await this.authService.getUserProfile().pipe(take(1)).toPromise();
      
      if (!auth0User) {
        throw new Error('No Auth0 user data available');
      }

      console.log('🔍 Auth0User data:', auth0User);

      // Create or update user in database
      const user = await this.userService.initializeUser(auth0User).toPromise();
      console.log('🔍 User created/updated in database:', user);
      console.log('🔍 User userType:', user?.userType);

      // Prepare onboarding data for API based on user type
      let updatedUser;
      
      if (user?.userType === 'tutor') {
        // Tutor onboarding
        const tutorData: TutorOnboardingData = {
          languages: this.selectedLanguages,
          experience: this.tutorExperience,
          schedule: this.tutorSchedule,
          bio: this.tutorBio,
          hourlyRate: this.tutorHourlyRate,
          introductionVideo: this.tutorIntroductionVideo
        };

        console.log('Saving tutor onboarding data to database:', tutorData);
        updatedUser = await this.userService.completeTutorOnboarding(tutorData).toPromise();
      } else {
        // Student onboarding
        const onboardingData: OnboardingData = {
          languages: this.selectedLanguages,
          goals: this.learningGoals,
          experienceLevel: this.experienceLevel,
          preferredSchedule: this.preferredSchedule
        };

        console.log('Saving student onboarding data to database:', onboardingData);
        updatedUser = await this.userService.completeOnboarding(onboardingData).toPromise();
      }
      
      console.log('Onboarding completed successfully:', updatedUser);

      // Store in localStorage as backup
      localStorage.setItem('onboarding_completed', 'true');
      
      const backupData = user?.['userType'] === 'tutor' ? {
        languages: this.selectedLanguages,
        experience: this.tutorExperience,
        schedule: this.tutorSchedule,
        bio: this.tutorBio,
        hourlyRate: this.tutorHourlyRate,
        introductionVideo: this.tutorIntroductionVideo,
        completedAt: new Date().toISOString()
      } : {
        languages: this.selectedLanguages,
        goals: this.learningGoals,
        experienceLevel: this.experienceLevel,
        preferredSchedule: this.preferredSchedule,
        completedAt: new Date().toISOString()
      };
      
      localStorage.setItem('onboarding_data', JSON.stringify(backupData));

      await loading.dismiss();

              // Navigate to main app
              this.router.navigate(['/tabs']);
    } catch (error) {
      console.error('Error completing onboarding:', error);
      await loading.dismiss();
      
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to complete setup. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }
  logout() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
  skipOnboarding() {
    // Mark onboarding as completed without data
    localStorage.setItem('onboarding_completed', 'true');
    this.router.navigate(['/tabs']);
  }

  getProgressPercentage(): number {
    return (this.currentStep / this.totalSteps) * 100;
  }

  canProceed(): boolean {
    switch (this.currentStep) {
      case 1:
        return true; // Welcome step, always can proceed
      case 2:
        return this.selectedLanguages.length > 0;
      case 3:
        return this.learningGoals.length > 0;
      case 4:
        return this.experienceLevel !== '' && this.preferredSchedule !== '';
      default:
        return false;
    }
  }
}
