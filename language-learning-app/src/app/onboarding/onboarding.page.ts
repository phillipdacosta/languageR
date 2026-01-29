import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserService, OnboardingData, TutorOnboardingData, User } from '../services/user.service';
import { OnboardingGuard } from '../guards/onboarding.guard';
import { Observable } from 'rxjs';
import { take, timeout, retry, catchError } from 'rxjs/operators';
import { LoadingController, AlertController, ModalController } from '@ionic/angular';
import { CountrySelectModalComponent } from '../components/country-select-modal/country-select-modal.component';

@Component({
  selector: 'app-onboarding',
  templateUrl: './onboarding.page.html',
  styleUrls: ['./onboarding.page.scss'],
  standalone: false,
})
export class OnboardingPage implements OnInit {
  user$: Observable<any>;
  currentStep = 1;
  totalSteps = 5; // Students: Name + Native Language + Languages + Goals + Experience/Schedule
  currentUser: User | null = null;

  // Onboarding data
  firstName = '';
  lastName = '';

  /**
   * Capitalizes a name properly (title case)
   * "JASON DERULA" -> "Jason Derula"
   * "jason derula" -> "Jason Derula"
   * "jAsOn DeRuLa" -> "Jason Derula"
   */
  private formatName(name: string): string {
    if (!name) return '';
    return name
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .trim();
  }
  nativeLanguage = 'en'; // Default to English
  selectedLanguages: string[] = [];
  learningGoals: string[] = [];
  experienceLevel = '';
  preferredSchedule = '';

  // Tutor-specific data
  tutorCountry = '';
  tutorExperience = '';
  tutorSchedule = '';
  tutorBio = '';
  tutorHourlyRate = 25;

  // Available options
  availableLanguages = [
    'Spanish', 'French', 'German', 'Italian', 'Portuguese', 
    'Chinese', 'Japanese', 'Korean', 'Arabic', 'Russian'
  ];

  // Native language options with ISO codes
  nativeLanguageOptions = [
    { code: 'en', name: 'English', native: 'English' },
    { code: 'es', name: 'Spanish', native: 'Español' },
    { code: 'fr', name: 'French', native: 'Français' },
    { code: 'de', name: 'German', native: 'Deutsch' },
    { code: 'it', name: 'Italian', native: 'Italiano' },
    { code: 'pt', name: 'Portuguese', native: 'Português' },
    { code: 'ru', name: 'Russian', native: 'Русский' },
    { code: 'zh', name: 'Chinese', native: '中文' },
    { code: 'ja', name: 'Japanese', native: '日本語' },
    { code: 'ko', name: 'Korean', native: '한국어' },
    { code: 'ar', name: 'Arabic', native: 'العربية' },
    { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
    { code: 'nl', name: 'Dutch', native: 'Nederlands' },
    { code: 'pl', name: 'Polish', native: 'Polski' },
    { code: 'tr', name: 'Turkish', native: 'Türkçe' },
    { code: 'sv', name: 'Swedish', native: 'Svenska' },
    { code: 'no', name: 'Norwegian', native: 'Norsk' },
    { code: 'da', name: 'Danish', native: 'Dansk' },
    { code: 'fi', name: 'Finnish', native: 'Suomi' },
    { code: 'el', name: 'Greek', native: 'Ελληνικά' },
    { code: 'cs', name: 'Czech', native: 'Čeština' },
    { code: 'ro', name: 'Romanian', native: 'Română' },
    { code: 'uk', name: 'Ukrainian', native: 'Українська' },
    { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
    { code: 'th', name: 'Thai', native: 'ไทย' },
    { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
    { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
    { code: 'he', name: 'Hebrew', native: 'עברית' },
    { code: 'fa', name: 'Persian', native: 'فارسی' }
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

  // Tutor-specific options - comprehensive list with flags
  tutorCountryOptions = [
    { name: 'Afghanistan', flag: '🇦🇫' },
    { name: 'Albania', flag: '🇦🇱' },
    { name: 'Algeria', flag: '🇩🇿' },
    { name: 'Argentina', flag: '🇦🇷' },
    { name: 'Armenia', flag: '🇦🇲' },
    { name: 'Australia', flag: '🇦🇺' },
    { name: 'Austria', flag: '🇦🇹' },
    { name: 'Azerbaijan', flag: '🇦🇿' },
    { name: 'Bahrain', flag: '🇧🇭' },
    { name: 'Bangladesh', flag: '🇧🇩' },
    { name: 'Belarus', flag: '🇧🇾' },
    { name: 'Belgium', flag: '🇧🇪' },
    { name: 'Bolivia', flag: '🇧🇴' },
    { name: 'Bosnia and Herzegovina', flag: '🇧🇦' },
    { name: 'Brazil', flag: '🇧🇷' },
    { name: 'Bulgaria', flag: '🇧🇬' },
    { name: 'Cambodia', flag: '🇰🇭' },
    { name: 'Canada', flag: '🇨🇦' },
    { name: 'Chile', flag: '🇨🇱' },
    { name: 'China', flag: '🇨🇳' },
    { name: 'Colombia', flag: '🇨🇴' },
    { name: 'Costa Rica', flag: '🇨🇷' },
    { name: 'Croatia', flag: '🇭🇷' },
    { name: 'Cuba', flag: '🇨🇺' },
    { name: 'Czech Republic', flag: '🇨🇿' },
    { name: 'Denmark', flag: '🇩🇰' },
    { name: 'Dominican Republic', flag: '🇩🇴' },
    { name: 'Ecuador', flag: '🇪🇨' },
    { name: 'Egypt', flag: '🇪🇬' },
    { name: 'El Salvador', flag: '🇸🇻' },
    { name: 'Estonia', flag: '🇪🇪' },
    { name: 'Ethiopia', flag: '🇪🇹' },
    { name: 'Finland', flag: '🇫🇮' },
    { name: 'France', flag: '🇫🇷' },
    { name: 'Georgia', flag: '🇬🇪' },
    { name: 'Germany', flag: '🇩🇪' },
    { name: 'Ghana', flag: '🇬🇭' },
    { name: 'Greece', flag: '🇬🇷' },
    { name: 'Guatemala', flag: '🇬🇹' },
    { name: 'Honduras', flag: '🇭🇳' },
    { name: 'Hong Kong', flag: '🇭🇰' },
    { name: 'Hungary', flag: '🇭🇺' },
    { name: 'Iceland', flag: '🇮🇸' },
    { name: 'India', flag: '🇮🇳' },
    { name: 'Indonesia', flag: '🇮🇩' },
    { name: 'Iran', flag: '🇮🇷' },
    { name: 'Iraq', flag: '🇮🇶' },
    { name: 'Ireland', flag: '🇮🇪' },
    { name: 'Israel', flag: '🇮🇱' },
    { name: 'Italy', flag: '🇮🇹' },
    { name: 'Jamaica', flag: '🇯🇲' },
    { name: 'Japan', flag: '🇯🇵' },
    { name: 'Jordan', flag: '🇯🇴' },
    { name: 'Kazakhstan', flag: '🇰🇿' },
    { name: 'Kenya', flag: '🇰🇪' },
    { name: 'Kuwait', flag: '🇰🇼' },
    { name: 'Latvia', flag: '🇱🇻' },
    { name: 'Lebanon', flag: '🇱🇧' },
    { name: 'Libya', flag: '🇱🇾' },
    { name: 'Lithuania', flag: '🇱🇹' },
    { name: 'Luxembourg', flag: '🇱🇺' },
    { name: 'Malaysia', flag: '🇲🇾' },
    { name: 'Mexico', flag: '🇲🇽' },
    { name: 'Morocco', flag: '🇲🇦' },
    { name: 'Netherlands', flag: '🇳🇱' },
    { name: 'New Zealand', flag: '🇳🇿' },
    { name: 'Nicaragua', flag: '🇳🇮' },
    { name: 'Nigeria', flag: '🇳🇬' },
    { name: 'North Korea', flag: '🇰🇵' },
    { name: 'Norway', flag: '🇳🇴' },
    { name: 'Oman', flag: '🇴🇲' },
    { name: 'Pakistan', flag: '🇵🇰' },
    { name: 'Palestine', flag: '🇵🇸' },
    { name: 'Panama', flag: '🇵🇦' },
    { name: 'Paraguay', flag: '🇵🇾' },
    { name: 'Peru', flag: '🇵🇪' },
    { name: 'Philippines', flag: '🇵🇭' },
    { name: 'Poland', flag: '🇵🇱' },
    { name: 'Portugal', flag: '🇵🇹' },
    { name: 'Puerto Rico', flag: '🇵🇷' },
    { name: 'Qatar', flag: '🇶🇦' },
    { name: 'Romania', flag: '🇷🇴' },
    { name: 'Russia', flag: '🇷🇺' },
    { name: 'Saudi Arabia', flag: '🇸🇦' },
    { name: 'Serbia', flag: '🇷🇸' },
    { name: 'Singapore', flag: '🇸🇬' },
    { name: 'Slovakia', flag: '🇸🇰' },
    { name: 'Slovenia', flag: '🇸🇮' },
    { name: 'South Africa', flag: '🇿🇦' },
    { name: 'South Korea', flag: '🇰🇷' },
    { name: 'Spain', flag: '🇪🇸' },
    { name: 'Sri Lanka', flag: '🇱🇰' },
    { name: 'Sweden', flag: '🇸🇪' },
    { name: 'Switzerland', flag: '🇨🇭' },
    { name: 'Syria', flag: '🇸🇾' },
    { name: 'Taiwan', flag: '🇹🇼' },
    { name: 'Thailand', flag: '🇹🇭' },
    { name: 'Tunisia', flag: '🇹🇳' },
    { name: 'Turkey', flag: '🇹🇷' },
    { name: 'Ukraine', flag: '🇺🇦' },
    { name: 'United Arab Emirates', flag: '🇦🇪' },
    { name: 'United Kingdom', flag: '🇬🇧' },
    { name: 'United States', flag: '🇺🇸' },
    { name: 'Uruguay', flag: '🇺🇾' },
    { name: 'Uzbekistan', flag: '🇺🇿' },
    { name: 'Venezuela', flag: '🇻🇪' },
    { name: 'Vietnam', flag: '🇻🇳' },
    { name: 'Yemen', flag: '🇾🇪' },
    { name: 'Other', flag: '🌍' }
  ];

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
    private alertController: AlertController,
    private modalController: ModalController,
    private onboardingGuard: OnboardingGuard
  ) {
    this.user$ = this.authService.user$;
  }

  ngOnInit() {
    // Check if user is authenticated
    this.authService.isAuthenticated$.pipe(take(1)).subscribe(isAuthenticated => {
      if (!isAuthenticated) {
        console.error('User not authenticated, redirecting to login');
        this.router.navigate(['/login']);
        return;
      }

      // Verify we have a valid user profile and check onboarding status
      this.authService.getUserProfile().pipe(take(1)).subscribe(
        user => {
          if (!user || !user.email) {
            console.error('No valid user profile, redirecting to login');
            this.router.navigate(['/login']);
            return;
          }
          
          console.log('✅ User authenticated:', user.email);
          
          // Safety check: Check if user has already completed onboarding
          this.userService.getCurrentUser().pipe(take(1)).subscribe({
            next: (dbUser) => {
              if (dbUser?.onboardingCompleted) {
                console.log('✅ Onboarding already completed, redirecting to home');
                this.router.navigate(['/tabs/home'], { replaceUrl: true });
                return;
              }
              console.log('📝 User needs to complete onboarding');
            },
            error: (error) => {
              // User doesn't exist in DB yet - that's okay, let them onboard
              console.log('User not in database yet, proceeding with onboarding');
            }
          });
        },
        error => {
          console.error('Error getting user profile:', error);
          this.showError('Authentication failed. Please log in again.', true);
        }
      );
    });

    // Get userType from localStorage (set during user type selection)
    const selectedUserType = localStorage.getItem('selectedUserType');
    console.log('🔍 Selected user type from localStorage:', selectedUserType);
    
    if (selectedUserType === 'tutor') {
      this.totalSteps = 3; // Tutors: Name + Languages + Tutor Profile (country, experience, schedule, bio, rate, video)
    }
  }

  nextStep() {
    // Validate current step before proceeding
    if (this.currentStep === 1) {
      if (!this.firstName.trim() || !this.lastName.trim()) {
        alert('Please enter your first and last name');
        return;
      }
    }
    
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

  setNativeLanguage(code: string) {
    this.nativeLanguage = code;
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
  setTutorCountry(country: string) {
    this.tutorCountry = country;
  }

  // Open country selection modal
  async openCountryModal() {
    const modal = await this.modalController.create({
      component: CountrySelectModalComponent,
      componentProps: {
        countries: this.tutorCountryOptions,
        selectedCountry: this.tutorCountry
      },
      cssClass: 'modern-modal',
      showBackdrop: true,
      backdropDismiss: true
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data && data.selectedCountry) {
      this.tutorCountry = data.selectedCountry;
    }
  }

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

  // Helper method to check if user is a tutor (from localStorage)
  isTutorOnboarding(): boolean {
    return localStorage.getItem('selectedUserType') === 'tutor';
  }

  async completeOnboarding() {
    const loading = await this.loadingController.create({
      message: 'Completing setup...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Get userType from localStorage (set during user type selection)
      const userType = localStorage.getItem('selectedUserType') || 'student';
      console.log('💾 Completing onboarding for userType:', userType);
      
      // Get Auth0 user with timeout and retry
      const auth0User = await this.authService.getUserProfile().pipe(
        take(1),
        timeout(10000), // 10 second timeout
        retry(2), // Retry twice if fails
        catchError(error => {
          console.error('❌ Error getting Auth0 user profile:', error);
          throw new Error('Unable to verify authentication. Please check your internet connection and try again.');
        })
      ).toPromise();
      
      if (!auth0User || !auth0User.email) {
        throw new Error('Authentication required. Please log in again.');
      }

      console.log('✅ Auth0 user authenticated:', auth0User.email);

      // Prepare onboarding data for API based on user type
      // The backend will create the user if they don't exist
      let updatedUser;
      
      if (userType === 'tutor') {
        // Tutor onboarding
        const tutorData: TutorOnboardingData & { userType: string } = {
          userType: 'tutor',
          firstName: this.formatName(this.firstName),
          lastName: this.formatName(this.lastName),
          country: this.tutorCountry,
          languages: this.selectedLanguages,
          experience: this.tutorExperience,
          schedule: this.tutorSchedule,
          bio: this.tutorBio,
          hourlyRate: this.tutorHourlyRate
        };

        console.log('💾 Saving tutor onboarding data (user will be created if needed)');
        updatedUser = await this.userService.completeTutorOnboarding(tutorData).pipe(
          timeout(10000),
          retry(2),
          catchError(error => {
            console.error('❌ Error saving tutor onboarding:', error);
            throw new Error('Unable to save your information. Please try again.');
          })
        ).toPromise();
      } else {
        // Student onboarding
        const onboardingData: OnboardingData & { userType: string; picture?: string; nativeLanguage?: string } = {
          userType: 'student',
          firstName: this.formatName(this.firstName),
          lastName: this.formatName(this.lastName),
          nativeLanguage: this.nativeLanguage, // NEW: Native language for analysis feedback
          languages: this.selectedLanguages,
          goals: this.learningGoals,
          experienceLevel: this.experienceLevel,
          preferredSchedule: this.preferredSchedule,
          picture: auth0User.picture // Include picture from Auth0 user profile
        };

        console.log('💾 Saving student onboarding data (user will be created if needed)');
        console.log('🖼️ Student onboarding picture:', auth0User.picture);
        updatedUser = await this.userService.completeOnboarding(onboardingData).pipe(
          timeout(10000),
          retry(2),
          catchError(error => {
            console.error('❌ Error saving student onboarding:', error);
            throw new Error('Unable to save your information. Please try again.');
          })
        ).toPromise();
      }
      
      console.log('✅ Onboarding completed successfully');

      // Clear the onboarding guard cache so it doesn't use stale data
      // auth0User is already available from above
      if (auth0User?.email) {
        this.onboardingGuard.clearCache(auth0User.email);
      }

      // Force refresh the current user in UserService to reflect onboarding completion
      // This updates the currentUser$ observable that the home page subscribes to
      console.log('🔄 Force refreshing user in UserService');
      await this.userService.getCurrentUser(true).pipe(take(1)).toPromise();

      // Store in localStorage as backup
      localStorage.setItem('onboarding_completed', 'true');
      
      const backupData = userType === 'tutor' ? {
        languages: this.selectedLanguages,
        experience: this.tutorExperience,
        schedule: this.tutorSchedule,
        bio: this.tutorBio,
        hourlyRate: this.tutorHourlyRate,
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

      // Check for return URL (for users who clicked a shared link before signing up)
      const returnUrl = localStorage.getItem('returnUrl');
      if (returnUrl) {
        console.log('🔄 Onboarding complete, returning to saved URL:', returnUrl);
        localStorage.removeItem('returnUrl');
        
        // Set flag so the destination page knows to override back button
        localStorage.setItem('justCompletedLogin', returnUrl);
        console.log('🔄 Onboarding: Set justCompletedLogin flag to:', returnUrl);
        
        this.router.navigateByUrl(returnUrl, { replaceUrl: true });
      } else {
        // Default: Navigate to main app
        this.router.navigate(['/tabs/home'], { replaceUrl: true });
      }
    } catch (error: any) {
      console.error('❌ Error completing onboarding:', error);
      await loading.dismiss();
      
      // Determine error message
      let errorMessage = 'Failed to complete setup. Please try again.';
      let showReloginButton = false;
      
      if (error.message) {
        errorMessage = error.message;
      }
      
      if (error.message?.includes('Authentication') || error.message?.includes('log in')) {
        showReloginButton = true;
      }
      
      const buttons: any[] = showReloginButton ? [
        {
          text: 'Re-login',
          handler: () => {
            this.authService.logout();
            this.router.navigate(['/login']);
          }
        },
        {
          text: 'Retry',
          role: 'cancel'
        }
      ] : ['OK'];
      
      const alert = await this.alertController.create({
        header: 'Setup Error',
        message: errorMessage,
        buttons: buttons
      });
      await alert.present();
    }
  }

  private async showError(message: string, redirectToLogin: boolean = false) {
    const alert = await this.alertController.create({
      header: 'Error',
      message: message,
      buttons: redirectToLogin ? [
        {
          text: 'Go to Login',
          handler: () => {
            this.authService.logout();
            this.router.navigate(['/login']);
          }
        }
      ] : ['OK']
    });
    await alert.present();
  }
  logout() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
  async skipOnboarding() {
    // Mark onboarding as completed without data
    localStorage.setItem('onboarding_completed', 'true');
    
    // Clear the onboarding guard cache and refresh user
    try {
      const auth0User = await this.authService.getUserProfile().pipe(take(1)).toPromise();
      if (auth0User?.email) {
        this.onboardingGuard.clearCache(auth0User.email);
      }
      
      // Force refresh the current user
      await this.userService.getCurrentUser(true).pipe(take(1)).toPromise();
    } catch (error) {
      console.error('Error clearing cache on skip:', error);
    }
    
    this.router.navigate(['/tabs/home'], { replaceUrl: true });
  }

  getProgressPercentage(): number {
    return (this.currentStep / this.totalSteps) * 100;
  }

  canProceed(): boolean {
    switch (this.currentStep) {
      case 1:
        return this.firstName.trim() !== '' && this.lastName.trim() !== ''; // Name step
      case 2:
        return this.nativeLanguage !== ''; // Native language step
      case 3:
        return this.selectedLanguages.length > 0; // Learning languages step
      case 4:
        return this.learningGoals.length > 0; // Goals step
      case 5:
        return this.experienceLevel !== '' && this.preferredSchedule !== ''; // Experience/Schedule step
      default:
        return false;
    }
  }
}
