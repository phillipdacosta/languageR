import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, ChangeDetectorRef } from '@angular/core';
import '@dotlottie/player-component';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserService, OnboardingData, TutorOnboardingData, User } from '../services/user.service';
import { LanguageService, LanguageOption, SupportedLanguage } from '../services/language.service';
import { TranslateService } from '@ngx-translate/core';
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
export class OnboardingPage implements OnInit, OnDestroy, AfterViewChecked {
  user$: Observable<any>;
  currentStep = 1;
  totalSteps = 5; // Students: Name + Native Language + Languages + Goals + Experience/Schedule
  currentUser: User | null = null;

  // Language selection pre-step
  preStepPhase: 'language' | 'welcome' | 'done' = 'language';
  welcomeRevealed: boolean = false;
  availableInterfaceLanguages: LanguageOption[] = [];
  selectedInterfaceLanguage: SupportedLanguage = 'en';
  selectedLanguageFlag = '🇬🇧';

  // Rotating heading animation
  headingTexts = [
    'Choose your language',
    'Elige tu idioma',
    'Choisissez votre langue',
    'Escolha seu idioma',
    'Wählen Sie Ihre Sprache',
    'Scegli la tua lingua',
    'Выберите ваш язык',
    '选择你的语言',
    '言語を選択してください',
    '언어를 선택하세요',
    'اختر لغتك',
    'अपनी भाषा चुनें',
    'Kies je taal',
    'Wybierz swój język',
    'Dilinizi seçin',
    'Välj ditt språk',
    'Velg ditt språk',
    'Vælg dit sprog',
    'Valitse kielesi',
    'Επιλέξτε τη γλώσσα σας',
    'Vyberte svůj jazyk',
    'Alegeți limba dvs.',
    'Виберіть вашу мову',
    'Chọn ngôn ngữ của bạn',
    'เลือกภาษาของคุณ',
    'Pilih bahasa Anda',
    'Pilih bahasa anda',
    'בחר את השפה שלך',
    'زبان خود را انتخاب کنید'
  ];
  activeHeadingIndex = 0;
  private headingInterval: any;

  // Preview & Welcome state
  showPreview = false;
  showWelcome = false;
  isSubmitting = false;
  hasReachedPreview = false;

  // ViewChild references for autofocus
  @ViewChild('firstNameInput') firstNameInput?: ElementRef<HTMLInputElement>;
  
  private lastFocusedStep = 0;

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
    'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
    'Russian', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Hindi',
    'Dutch', 'Polish', 'Turkish', 'Swedish', 'Norwegian', 'Danish',
    'Finnish', 'Greek', 'Czech', 'Romanian', 'Ukrainian', 'Vietnamese',
    'Thai', 'Indonesian', 'Malay', 'Hebrew', 'Persian'
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
    { key: 'ONBOARDING.STUDENT.GOAL_TRAVEL', value: 'Travel and tourism' },
    { key: 'ONBOARDING.STUDENT.GOAL_BUSINESS', value: 'Business communication' },
    { key: 'ONBOARDING.STUDENT.GOAL_ACADEMIC', value: 'Academic studies' },
    { key: 'ONBOARDING.STUDENT.GOAL_CULTURE', value: 'Cultural understanding' },
    { key: 'ONBOARDING.STUDENT.GOAL_PERSONAL', value: 'Personal interest' },
    { key: 'ONBOARDING.STUDENT.GOAL_CAREER', value: 'Career advancement' },
    { key: 'ONBOARDING.STUDENT.GOAL_FRIENDS', value: 'Make new friends' }
  ];

  experienceLevels = [
    { key: 'ONBOARDING.STUDENT.LEVEL_BEGINNER', value: 'Beginner' },
    { key: 'ONBOARDING.STUDENT.LEVEL_INTERMEDIATE', value: 'Intermediate' },
    { key: 'ONBOARDING.STUDENT.LEVEL_ADVANCED', value: 'Advanced' }
  ];

  scheduleOptions = [
    { key: 'ONBOARDING.STUDENT.SCHEDULE_DAILY', value: 'Daily (30+ minutes)' },
    { key: 'ONBOARDING.STUDENT.SCHEDULE_3_4', value: '3-4 times per week' },
    { key: 'ONBOARDING.STUDENT.SCHEDULE_WEEKENDS', value: 'Weekends only' },
    { key: 'ONBOARDING.STUDENT.SCHEDULE_FLEXIBLE', value: 'Flexible schedule' }
  ];

  translatedGoalsList = '';
  translatedExperienceLevel = '';
  translatedSchedule = '';

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
    private languageService: LanguageService,
    private router: Router,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private modalController: ModalController,
    private onboardingGuard: OnboardingGuard,
    private cdr: ChangeDetectorRef,
    private translateService: TranslateService
  ) {
    this.user$ = this.authService.user$;
    this.availableInterfaceLanguages = this.languageService.supportedLanguages;
    this.selectedInterfaceLanguage = this.languageService.getCurrentLanguage();
  }

  ngOnDestroy() {
    this.stopHeadingRotation();
  }

  private startHeadingRotation() {
    this.stopHeadingRotation();
    this.headingInterval = setInterval(() => {
      this.activeHeadingIndex = (this.activeHeadingIndex + 1) % this.headingTexts.length;
      this.cdr.detectChanges();
    }, 2400);
  }

  private stopHeadingRotation() {
    if (this.headingInterval) {
      clearInterval(this.headingInterval);
      this.headingInterval = null;
    }
  }

  ngOnInit() {
    this.startHeadingRotation();

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

  ngAfterViewChecked() {
    // Focus first input and scroll sidebar when step changes
    if (this.currentStep !== this.lastFocusedStep) {
      this.lastFocusedStep = this.currentStep;
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
    if (this.currentStep === 1 && this.firstNameInput?.nativeElement) {
      this.firstNameInput.nativeElement.focus();
    }
  }

  selectInterfaceLanguage(lang: SupportedLanguage) {
    this.selectedInterfaceLanguage = lang;
    this.selectedLanguageFlag = this.languageService.getLanguageOption(lang)?.flag || '🇬🇧';
    this.languageService.setLanguage(lang);
  }

  confirmLanguageSelection() {
    this.stopHeadingRotation();
    this.preStepPhase = 'welcome';
    this.welcomeRevealed = false;
    setTimeout(() => { this.welcomeRevealed = true; this.cdr.detectChanges(); }, 3800);
  }

  goBackToLanguageSelect() {
    this.preStepPhase = 'language';
    this.welcomeRevealed = false;
    this.startHeadingRotation();
  }

  startOnboarding() {
    const srcTitle = document.querySelector('.welcome-title') as HTMLElement;
    const srcRect = srcTitle?.getBoundingClientRect();

    if (!srcTitle || !srcRect) {
      this.preStepPhase = 'done';
      return;
    }

    const srcText = srcTitle.textContent?.trim() || '';
    const srcStyles = window.getComputedStyle(srcTitle);

    const clone = document.createElement('div');
    clone.textContent = srcText;
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${srcRect.left}px`,
      top: `${srcRect.top}px`,
      width: `${srcRect.width}px`,
      height: `${srcRect.height}px`,
      zIndex: '10000',
      pointerEvents: 'none',
      fontFamily: srcStyles.fontFamily,
      fontSize: srcStyles.fontSize,
      fontWeight: '700',
      color: '#222222',
      letterSpacing: '-0.5px',
      lineHeight: '1.2',
      whiteSpace: 'nowrap',
      transition: 'left 0.5s cubic-bezier(0.32, 0.72, 0, 1), top 0.5s cubic-bezier(0.32, 0.72, 0, 1), width 0.5s cubic-bezier(0.32, 0.72, 0, 1), height 0.5s cubic-bezier(0.32, 0.72, 0, 1), font-size 0.5s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease',
    });
    document.body.appendChild(clone);

    this.preStepPhase = 'done';
    this.cdr.detectChanges();

    let landed = false;
    const flyToDestination = (dest: HTMLElement) => {
      if (landed) return;
      landed = true;
      dest.style.transition = 'none';
      dest.style.opacity = '0';
      const destRect = dest.getBoundingClientRect();
      const destStyles = window.getComputedStyle(dest);
      const destText = dest.textContent?.trim() || '';

      requestAnimationFrame(() => {
        clone.textContent = destText;
        clone.style.left = `${destRect.left}px`;
        clone.style.top = `${destRect.top}px`;
        clone.style.width = 'auto';
        clone.style.height = `${destRect.height}px`;
        clone.style.fontSize = destStyles.fontSize;
      });

      setTimeout(() => {
        const finalRect = dest.getBoundingClientRect();
        clone.style.transition = 'none';
        clone.style.left = `${finalRect.left}px`;
        clone.style.top = `${finalRect.top}px`;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            dest.style.opacity = '1';
            if (clone.parentNode) clone.remove();
            setTimeout(() => { dest.style.transition = ''; dest.style.opacity = ''; }, 50);
          });
        });
      }, 550);
    };

    const destSelector = '.onboarding-header h1';
    const checkDest = () => {
      const dest = document.querySelector(destSelector) as HTMLElement;
      if (dest) flyToDestination(dest);
    };

    requestAnimationFrame(() => requestAnimationFrame(checkDest));

    const container = document.querySelector('.onboarding-container');
    if (container) {
      const observer = new MutationObserver(() => {
        const dest = document.querySelector(destSelector) as HTMLElement;
        if (dest) {
          observer.disconnect();
          flyToDestination(dest);
        }
      });
      observer.observe(container, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        if (!landed) {
          clone.style.opacity = '0';
          clone.style.transition = 'opacity 0.3s ease';
          setTimeout(() => { if (clone.parentNode) clone.remove(); }, 350);
        }
      }, 5000);
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
    }
  }

  previousStep() {
    if (this.currentStep === 1) {
      this.preStepPhase = 'welcome';
    } else {
      this.currentStep--;
    }
  }

  goToLanguageSelect() {
    this.preStepPhase = 'language';
    this.startHeadingRotation();
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

  toggleGoal(value: string) {
    const index = this.learningGoals.indexOf(value);
    if (index > -1) {
      this.learningGoals.splice(index, 1);
    } else {
      this.learningGoals.push(value);
    }
    this.translatedGoalsList = this.learningGoals
      .map(v => {
        const goal = this.availableGoals.find(g => g.value === v);
        return goal ? this.translateService.instant(goal.key) : v;
      })
      .join(', ');
  }

  setExperienceLevel(value: string) {
    this.experienceLevel = value;
    const level = this.experienceLevels.find(l => l.value === value);
    this.translatedExperienceLevel = level ? this.translateService.instant(level.key) : value;
  }

  setPreferredSchedule(value: string) {
    this.preferredSchedule = value;
    const sched = this.scheduleOptions.find(s => s.value === value);
    this.translatedSchedule = sched ? this.translateService.instant(sched.key) : value;
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
        const onboardingData: OnboardingData & { userType: string; picture?: string; nativeLanguage?: string; interfaceLanguage?: string } = {
          userType: 'student',
          firstName: this.formatName(this.firstName),
          lastName: this.formatName(this.lastName),
          nativeLanguage: this.nativeLanguage,
          interfaceLanguage: this.selectedInterfaceLanguage,
          languages: this.selectedLanguages,
          goals: this.learningGoals,
          experienceLevel: this.experienceLevel,
          preferredSchedule: this.preferredSchedule,
          picture: auth0User.picture
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

      this.isSubmitting = false;

      // Show the welcome/congrats page
      this.showWelcome = true;

      // Auto-redirect after 4 seconds
      setTimeout(() => {
        this.navigateToHome();
      }, 4000);
    } catch (error: any) {
      console.error('❌ Error completing onboarding:', error);
      this.isSubmitting = false;
      
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
          text: this.translateService.instant('ONBOARDING.ALERTS.RELOGIN'),
          handler: () => {
            this.authService.logout();
            this.router.navigate(['/login']);
          }
        },
        {
          text: this.translateService.instant('ONBOARDING.ALERTS.RETRY'),
          role: 'cancel'
        }
      ] : [this.translateService.instant('ONBOARDING.ALERTS.OK')];
      
      const alert = await this.alertController.create({
        header: this.translateService.instant('ONBOARDING.ALERTS.SETUP_ERROR'),
        message: errorMessage,
        buttons: buttons
      });
      await alert.present();
    }
  }

  private async showError(message: string, redirectToLogin: boolean = false) {
    const alert = await this.alertController.create({
      header: this.translateService.instant('ONBOARDING.ALERTS.ERROR'),
      message: message,
      buttons: redirectToLogin ? [
        {
          text: this.translateService.instant('ONBOARDING.ALERTS.GO_TO_LOGIN'),
          handler: () => {
            this.authService.logout();
            this.router.navigate(['/login']);
          }
        }
      ] : [this.translateService.instant('ONBOARDING.ALERTS.OK')]
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

  navigateToHome() {
    const returnUrl = localStorage.getItem('returnUrl');
    if (returnUrl) {
      console.log('🔄 Onboarding complete, returning to saved URL:', returnUrl);
      localStorage.removeItem('returnUrl');
      localStorage.setItem('justCompletedLogin', returnUrl);
      this.router.navigateByUrl(returnUrl, { replaceUrl: true });
    } else {
      this.router.navigate(['/tabs/home'], { replaceUrl: true });
    }
  }

  async handleLogout() {
    const alert = await this.alertController.create({
      header: this.translateService.instant('ONBOARDING.ALERTS.LOGOUT'),
      message: this.translateService.instant('ONBOARDING.ALERTS.LOGOUT_CONFIRM'),
      buttons: [
        {
          text: this.translateService.instant('ONBOARDING.ALERTS.CANCEL'),
          role: 'cancel'
        },
        {
          text: this.translateService.instant('ONBOARDING.ALERTS.LOGOUT'),
          handler: async () => {
            await this.authService.logout();
          }
        }
      ]
    });
    await alert.present();
  }
}
