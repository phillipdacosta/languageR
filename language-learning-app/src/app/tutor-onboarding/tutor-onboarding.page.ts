import { Component, OnInit, ViewChild, ElementRef, AfterViewChecked, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AuthService, User } from '../services/auth.service';
import { UserService, TutorOnboardingData } from '../services/user.service';
import { OnboardingGuard } from '../guards/onboarding.guard';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { LoadingController, AlertController, ModalController, ToastController } from '@ionic/angular';
import { CountrySelectModalComponent } from '../components/country-select-modal/country-select-modal.component';

@Component({
  selector: 'app-tutor-onboarding',
  templateUrl: './tutor-onboarding.page.html',
  styleUrls: ['./tutor-onboarding.page.scss'],
  standalone: false,
})
export class TutorOnboardingPage implements OnInit, AfterViewChecked {
  user$: Observable<User | null>;
  currentStep = 1;
  totalSteps = 9; // Name + Residence + Native Language + Languages + Experience + Schedule + Bio + Rate + Video

  // Preview & Welcome state
  showPreview = false;
  showWelcome = false;
  isSubmitting = false;
  hasReachedPreview = false; // True once the user has visited the preview page at least once

  // Tutor onboarding data
  firstName = '';
  lastName = '';
  country = ''; // Nationality / Where are you from?

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

  /**
   * Formats text to ensure proper capitalization on a per-word basis:
   * - Normalizes each word that has abnormal capitalization
   * - Preserves legitimate acronyms (CERF, TEFL, CELTA, TESOL, etc.)
   * - Preserves normal words (all lowercase or proper title case)
   * - Ensures first letter of the entire text is uppercase
   * 
   * Examples:
   * "THE BEST language tutor in the WOrLD!" -> "The best language tutor in the world!"
   * "i have a cerf certificate" -> "I have a CERF certificate"
   * "MY BIO IS IN CAPS" -> "My bio is in caps"
   * "MMfsjkg kfjdgn" -> "Mmfsjkg kfjdgn"
   */
  private formatText(text: string): string {
    if (!text) return '';
    
    const trimmed = text.trim();
    if (!trimmed) return '';

    // Map of legitimate acronyms: lookup key (uppercase) -> display form
    const acronymMap: Record<string, string> = {
      'CERF': 'CERF', 'TEFL': 'TEFL', 'CELTA': 'CELTA', 'TESOL': 'TESOL',
      'TOEFL': 'TOEFL', 'IELTS': 'IELTS', 'ESL': 'ESL', 'EFL': 'EFL',
      'BA': 'BA', 'BS': 'BS', 'MA': 'MA', 'MS': 'MS', 'PHD': 'PhD',
      'MBA': 'MBA', 'USA': 'USA', 'UK': 'UK', 'EU': 'EU', 'UN': 'UN',
      'NATO': 'NATO', 'NASA': 'NASA', 'DELF': 'DELF', 'DALF': 'DALF',
      'HSK': 'HSK', 'JLPT': 'JLPT', 'DELE': 'DELE', 'CILS': 'CILS',
      'TEF': 'TEF', 'TCF': 'TCF', 'CPE': 'CPE', 'CAE': 'CAE', 'FCE': 'FCE'
    };

    // Process each alphabetical word, preserving all non-alpha characters in place
    const result = trimmed.replace(/[a-zA-Z]+/g, (word) => {
      // Check if word is a known acronym (case-insensitive)
      const upperWord = word.toUpperCase();
      if (acronymMap[upperWord]) {
        return acronymMap[upperWord];
      }

      // Single letter: keep as-is (handles "I", "a", etc.)
      if (word.length === 1) {
        return word;
      }

      // Check if word already has "normal" capitalization
      const isAllLower = word === word.toLowerCase();
      const isTitleCase = word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase();

      if (isAllLower || isTitleCase) {
        return word; // Normal casing — leave it alone
      }

      // Abnormal casing detected (ALL CAPS, rAnDoM caps, MMfsjkg, WOrLD, etc.)
      // Normalize to lowercase — first-letter capitalization handled below
      return word.toLowerCase();
    });

    // Ensure first letter of the entire text is uppercase
    return result.charAt(0).toUpperCase() + result.slice(1);
  }

  /**
   * Format first name on blur (title case)
   */
  formatFirstNameOnBlur() {
    if (this.firstName) {
      this.firstName = this.formatName(this.firstName);
    }
  }

  /**
   * Format last name on blur (title case)
   */
  formatLastNameOnBlur() {
    if (this.lastName) {
      this.lastName = this.formatName(this.lastName);
    }
  }

  /**
   * Format summary text on blur
   */
  formatSummaryOnBlur() {
    if (this.profileSummary) {
      this.profileSummary = this.formatText(this.profileSummary);
    }
  }

  /**
   * Format bio text on blur
   */
  formatBioOnBlur() {
    if (this.profileBio) {
      this.profileBio = this.formatText(this.profileBio);
    }
  }
  residenceCountry = ''; // Where do you currently reside? (for payout purposes)
  nativeLanguage = 'en'; // Default to English
  selectedLanguages: string[] = [];
  selectedExperience = '';
  selectedSchedule = '';
  profileSummary = '';
  profileBio = '';
  hourlyRate = 25;
  introductionVideo = ''; // Introduction video URL
  thumbnailUrl = ''; // Custom thumbnail URL for the video
  videoType: 'upload' | 'youtube' | 'vimeo' = 'upload'; // Video type
  hasVideoLinkPending = false; // True when user has entered a link but not clicked "Add Video"

  // Video player modal state
  isVideoPlayerModalOpen = false;
  videoPlayerData: {
    videoUrl: string;
    safeVideoUrl?: SafeResourceUrl;
    videoType: 'upload' | 'youtube' | 'vimeo';
  } | null = null;

  // ViewChild references for autofocus
  @ViewChild('firstNameInput') firstNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('summaryInput') summaryInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('bioInput') bioInput?: ElementRef<HTMLTextAreaElement>;
  
  private previousStep = 0;

  // Available options
  availableLanguages = [
    'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 
    'Chinese', 'Japanese', 'Korean', 'Arabic', 'Russian', 'Dutch', 'Swedish'
  ];

  // Native language options with ISO codes (same as student onboarding)
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
    private sanitizer: DomSanitizer,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private modalController: ModalController,
    private toastController: ToastController,
    private onboardingGuard: OnboardingGuard,
    private cdr: ChangeDetectorRef
  ) {
    this.user$ = this.authService.user$;
  }

  ngOnInit() {
    // Check if user is authenticated
    this.authService.isAuthenticated$.pipe(take(1)).subscribe(isAuthenticated => {
      if (!isAuthenticated) {
        this.router.navigate(['/login']);
        return;
      }

      // Safety check: Check if user has already completed onboarding
      this.authService.getUserProfile().pipe(take(1)).subscribe(user => {
        if (!user || !user.email) {
          this.router.navigate(['/login']);
          return;
        }
        
        console.log('✅ Tutor authenticated:', user.email);
        
        // Check database for onboarding status
        this.userService.getCurrentUser().pipe(take(1)).subscribe({
          next: (dbUser) => {
            if (dbUser?.onboardingCompleted) {
              console.log('✅ Tutor onboarding already completed, redirecting to home');
              this.router.navigate(['/tabs/home'], { replaceUrl: true });
              return;
            }
            console.log('📝 Tutor needs to complete onboarding');
          },
          error: (error) => {
            // User doesn't exist in DB yet - that's okay, let them onboard
            console.log('Tutor not in database yet, proceeding with onboarding');
          }
        });
      });
    });
  }

  ngAfterViewChecked() {
    // Focus first input and scroll sidebar when step changes
    if (this.currentStep !== this.previousStep) {
      this.previousStep = this.currentStep;
      setTimeout(() => {
        this.focusFirstInput();
        this.scrollCurrentStepIntoView();
      }, 100);
    }
  }

  private scrollCurrentStepIntoView() {
    const currentStepEl = document.querySelector('.step-item.current');
    if (currentStepEl) {
      currentStepEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  private focusFirstInput() {
    // Focus the first input/textarea based on current step
    if (this.currentStep === 1 && this.firstNameInput?.nativeElement) {
      this.firstNameInput.nativeElement.focus();
    } else if (this.currentStep === 7 && this.summaryInput?.nativeElement) {
      this.summaryInput.nativeElement.focus();
    } else if (this.currentStep === 7 && this.bioInput?.nativeElement && !this.summaryInput?.nativeElement) {
      this.bioInput.nativeElement.focus();
    }
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

  setNativeLanguage(code: string) {
    this.nativeLanguage = code;
  }

  toggleLanguage(language: string) {
    // Only allow selecting one language at a time
    if (this.selectedLanguages.includes(language)) {
      // Deselect if clicking the same language
      this.selectedLanguages = [];
    } else {
      // Replace with new selection
      this.selectedLanguages = [language];
    }
  }

  setExperience(experience: string) {
    this.selectedExperience = experience;
  }

  setSchedule(schedule: string) {
    this.selectedSchedule = schedule;
  }

  // Open country selection modal (for nationality)
  async openCountryModal() {
    console.log('🔵 Opening country modal (nationality), countryOptions:', this.countryOptions?.length);
    
    const modal = await this.modalController.create({
      component: CountrySelectModalComponent,
      componentProps: {
        countries: this.countryOptions,
        selectedCountry: this.country,
        modalType: 'origin' // Specify this is for country of origin
      },
      cssClass: 'modern-modal',
      showBackdrop: true,
      backdropDismiss: true
    });

    console.log('🔵 Modal created, presenting...');
    await modal.present();
    console.log('🔵 Modal presented');

    const { data } = await modal.onWillDismiss();
    if (data && data.selectedCountry) {
      this.country = data.selectedCountry;
    }
  }

  // Open country selection modal (for residence)
  async openResidenceCountryModal() {
    console.log('🔵 Opening residence country modal, countryOptions:', this.countryOptions?.length);
    
    const modal = await this.modalController.create({
      component: CountrySelectModalComponent,
      componentProps: {
        countries: this.countryOptions,
        selectedCountry: this.residenceCountry,
        modalType: 'residence' // Specify this is for country of residence
      },
      cssClass: 'modern-modal',
      showBackdrop: true,
      backdropDismiss: true
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data && data.selectedCountry) {
      this.residenceCountry = data.selectedCountry;
    }
  }

  onVideoUploaded(data: { url: string; thumbnail: string; type: 'upload' | 'youtube' | 'vimeo' }) {
    console.log('✅ Video uploaded in tutor-onboarding:', data);
    console.log('🖼️ Thumbnail to save:', data.thumbnail);
    
    // Store locally - will be saved when user completes onboarding
    this.introductionVideo = data.url;
    this.thumbnailUrl = data.thumbnail;
    this.videoType = data.type;
  }

  onVideoRemoved() {
    console.log('🗑️ Video removed in tutor-onboarding');
    
    // Clear local properties
    this.introductionVideo = '';
    this.thumbnailUrl = '';
    this.videoType = 'upload';
  }

  onVideoPendingStateChanged(isPending: boolean) {
    this.hasVideoLinkPending = isPending;
  }

  openVideoPlayerModal() {
    if (!this.introductionVideo) return;
    
    let videoUrl = this.introductionVideo;
    
    // Add autoplay parameter for external videos
    if (this.videoType === 'youtube' || this.videoType === 'vimeo') {
      const separator = videoUrl.includes('?') ? '&' : '?';
      if (!videoUrl.includes('autoplay=')) {
        videoUrl = videoUrl + separator + 'autoplay=1';
      }
    }
    
    this.videoPlayerData = {
      videoUrl: videoUrl,
      safeVideoUrl: this.sanitizer.bypassSecurityTrustResourceUrl(videoUrl),
      videoType: this.videoType
    };
    this.isVideoPlayerModalOpen = true;
  }

  onVideoPlayerModalDismiss() {
    this.isVideoPlayerModalOpen = false;
    this.videoPlayerData = null;
  }

  showPreviewPage() {
    this.showPreview = true;
    this.hasReachedPreview = true;
    // Scroll to top when preview page is shown
    setTimeout(() => {
      const previewContainer = document.querySelector('.preview-container');
      if (previewContainer) {
        previewContainer.scrollTop = 0;
      }
      window.scrollTo(0, 0);
    }, 0);
  }

  goBackToEdit(step?: number) {
    this.showPreview = false;
    if (step) {
      this.currentStep = step;
    }
  }

  getNativeLanguageName(): string {
    const lang = this.nativeLanguageOptions.find(l => l.code === this.nativeLanguage);
    return lang ? lang.name : this.nativeLanguage;
  }

  async completeOnboarding() {
    this.isSubmitting = true;

    try {
      console.log('🔍 Creating/updating tutor in database...');
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
      const onboardingData: TutorOnboardingData & { nativeLanguage?: string; residenceCountry?: string } = {
        firstName: this.formatName(this.firstName),
        lastName: this.formatName(this.lastName),
        country: this.country,
        residenceCountry: this.residenceCountry, // NEW: For payout method selection
        nativeLanguage: this.nativeLanguage, // NEW: Native language for analysis feedback
        languages: this.selectedLanguages,
        experience: this.selectedExperience,
        schedule: this.selectedSchedule,
        summary: this.formatText(this.profileSummary),
        bio: this.formatText(this.profileBio),
        hourlyRate: this.hourlyRate,
        introductionVideo: this.introductionVideo, // Include introduction video
        videoThumbnail: this.thumbnailUrl, // Include custom thumbnail
        videoType: this.videoType // Include video type
      };

      console.log('Saving tutor onboarding data to database:', onboardingData);

      // Complete onboarding
      const updatedUser = await this.userService.completeTutorOnboarding(onboardingData).toPromise();
      
      console.log('Tutor onboarding completed successfully:', updatedUser);

      // Submit tutor for review (this sets tutorOnboarding.videoUploaded flag)
      console.log('📝 Submitting tutor for review...');
      try {
        await this.userService.submitTutorForReview().toPromise();
        console.log('✅ Tutor submitted for review successfully');
      } catch (reviewError) {
        console.error('⚠️ Error submitting for review:', reviewError);
        // Don't fail the whole onboarding if this fails
      }

      // Store in localStorage as backup
      localStorage.setItem('onboarding_completed', 'true');
      localStorage.setItem('onboarding_data', JSON.stringify({
        ...onboardingData,
        completedAt: new Date().toISOString()
      }));

      // Clear the onboarding guard cache so navigation works immediately
      console.log('🔍 Clearing onboarding guard cache for', auth0User.email);
      this.onboardingGuard.clearCache(auth0User.email);

      // Force refresh the current user in UserService to reflect onboarding completion
      // This updates the currentUser$ observable that the home page subscribes to
      console.log('🔄 Force refreshing user in UserService');
      await this.userService.getCurrentUser(true).pipe(take(1)).toPromise();

      this.isSubmitting = false;

      // Show the welcome/congrats page
      this.showWelcome = true;

      // Auto-redirect after 4 seconds
      setTimeout(() => {
        this.navigateToHome();
      }, 4000);
    } catch (error) {
      console.error('Error completing tutor onboarding:', error);
      this.isSubmitting = false;
      
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to complete setup. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  navigateToHome() {
    const returnUrl = localStorage.getItem('returnUrl');
    if (returnUrl) {
      console.log('🔄 Tutor onboarding complete, returning to saved URL:', returnUrl);
      localStorage.removeItem('returnUrl');
      this.router.navigateByUrl(returnUrl, { replaceUrl: true });
    } else {
      this.router.navigate(['/tabs/home'], { replaceUrl: true });
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
        return this.residenceCountry !== ''; // Residence country step
      case 3:
        return this.nativeLanguage !== ''; // Native language step
      case 4:
        return this.selectedLanguages.length > 0;
      case 5:
        return this.selectedExperience !== '';
      case 6:
        return this.selectedSchedule !== '';
      case 7:
        return this.profileBio.length > 0; // Bio step
      case 8:
        return this.hourlyRate > 0; // Hourly rate step
      case 9:
        return !this.hasVideoLinkPending; // Video is optional, but block if user has an unsubmitted link
      default:
        return false;
    }
  }

  private async showToast(message: string, color: string = 'success') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'top',
      color
    });
    await toast.present();
  }

  async handleLogout() {
    const alert = await this.alertController.create({
      header: 'Logout',
      message: 'Are you sure you want to logout?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Logout',
          handler: async () => {
            await this.authService.logout();
          }
        }
      ]
    });
    await alert.present();
  }
}