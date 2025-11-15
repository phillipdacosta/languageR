import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, User } from '../services/auth.service';
import { UserService, TutorOnboardingData } from '../services/user.service';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { LoadingController, AlertController, ModalController } from '@ionic/angular';
import { CountrySelectModalComponent } from './country-select-modal.component';

@Component({
  selector: 'app-tutor-onboarding',
  templateUrl: './tutor-onboarding.page.html',
  styleUrls: ['./tutor-onboarding.page.scss'],
  standalone: false,
})
export class TutorOnboardingPage implements OnInit {
  user$: Observable<User | null>;
  currentStep = 1;
  totalSteps = 5; // Name + Languages + Experience + Schedule + Profile

  // Tutor onboarding data
  firstName = '';
  lastName = '';
  country = '';
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

  // Comprehensive country list with flags
  countryOptions = [
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
    private alertController: AlertController,
    private modalController: ModalController
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

  // Get flag emoji for selected country
  getCountryFlag(countryName: string): string {
    const country = this.countryOptions.find(c => c.name === countryName);
    return country ? country.flag : '';
  }

  // Open country selection modal
  async openCountryModal() {
    const modal = await this.modalController.create({
      component: CountrySelectModalComponent,
      componentProps: {
        countries: this.countryOptions,
        selectedCountry: this.country
      },
      cssClass: 'country-select-modal',
      showBackdrop: true,
      backdropDismiss: true
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data && data.selectedCountry) {
      this.country = data.selectedCountry;
    }
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
        firstName: this.firstName,
        lastName: this.lastName,
        country: this.country,
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
        return this.firstName.trim() !== '' && this.lastName.trim() !== '' && this.country !== '';
      case 2:
        return this.selectedLanguages.length > 0;
      case 3:
        return this.selectedExperience !== '';
      case 4:
        return this.selectedSchedule !== '';
      case 5:
        return true; // Bio and rate are optional
      default:
        return false;
    }
  }
}