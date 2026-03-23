import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, ChangeDetectorRef } from '@angular/core';
import '@dotlottie/player-component';
import { Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AuthService, User } from '../services/auth.service';
import { UserService, TutorOnboardingData } from '../services/user.service';
import { LanguageService, LanguageOption, SupportedLanguage } from '../services/language.service';
import { TranslateService } from '@ngx-translate/core';
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
export class TutorOnboardingPage implements OnInit, OnDestroy, AfterViewChecked {
  user$: Observable<User | null>;
  currentStep = 1;
  totalSteps = 9; // Name + Residence + Native Language + Languages + Experience + Schedule + Bio + Rate + Video

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
  translatedExperience = '';
  translatedSchedule = '';
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
    'Russian', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Hindi',
    'Dutch', 'Polish', 'Turkish', 'Swedish', 'Norwegian', 'Danish',
    'Finnish', 'Greek', 'Czech', 'Romanian', 'Ukrainian', 'Vietnamese',
    'Thai', 'Indonesian', 'Malay', 'Hebrew', 'Persian'
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
    { key: 'ONBOARDING.TUTOR_OB.EXP_NEW', value: 'New to teaching (0-1 years)' },
    { key: 'ONBOARDING.TUTOR_OB.EXP_SOME', value: 'Some experience (1-3 years)' },
    { key: 'ONBOARDING.TUTOR_OB.EXP_EXPERIENCED', value: 'Experienced (3-5 years)' },
    { key: 'ONBOARDING.TUTOR_OB.EXP_VERY', value: 'Very experienced (5+ years)' },
    { key: 'ONBOARDING.TUTOR_OB.EXP_NATIVE', value: 'Native speaker with teaching experience' }
  ];

  scheduleOptions = [
    { key: 'ONBOARDING.TUTOR_OB.SCHED_WEEKDAYS', value: 'Weekdays only' },
    { key: 'ONBOARDING.TUTOR_OB.SCHED_WEEKENDS', value: 'Weekends only' },
    { key: 'ONBOARDING.TUTOR_OB.SCHED_EVENINGS', value: 'Evenings only' },
    { key: 'ONBOARDING.TUTOR_OB.SCHED_FLEXIBLE', value: 'Flexible schedule' },
    { key: 'ONBOARDING.TUTOR_OB.SCHED_FULLTIME', value: 'Full-time availability' }
  ];

  constructor(
    private authService: AuthService,
    private userService: UserService,
    private languageService: LanguageService,
    private router: Router,
    private sanitizer: DomSanitizer,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private modalController: ModalController,
    private toastController: ToastController,
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
    if (this.currentStep === 1 && this.firstNameInput?.nativeElement) {
      this.firstNameInput.nativeElement.focus();
    } else if (this.currentStep === 7 && this.summaryInput?.nativeElement) {
      this.summaryInput.nativeElement.focus();
    } else if (this.currentStep === 7 && this.bioInput?.nativeElement && !this.summaryInput?.nativeElement) {
      this.bioInput.nativeElement.focus();
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
    if (this.canProceed() && this.currentStep < this.totalSteps) {
      this.currentStep++;
    }
  }

  prevStep() {
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

  setExperience(value: string) {
    this.selectedExperience = value;
    const exp = this.experienceLevels.find(e => e.value === value);
    this.translatedExperience = exp ? this.translateService.instant(exp.key) : value;
  }

  setSchedule(value: string) {
    this.selectedSchedule = value;
    const sched = this.scheduleOptions.find(s => s.value === value);
    this.translatedSchedule = sched ? this.translateService.instant(sched.key) : value;
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

  onVideoReady(event: Event) {
    const video = event.target as HTMLVideoElement;
    if (video) {
      video.muted = false;
      video.play().catch(() => {});
    }
  }

  previewNativeLanguageName: string = '';
  previewSelectedLanguages: string = '';

  showPreviewPage() {
    const nativeLang = this.nativeLanguageOptions.find(l => l.code === this.nativeLanguage);
    this.previewNativeLanguageName = nativeLang ? nativeLang.name : this.nativeLanguage;
    this.previewSelectedLanguages = this.selectedLanguages.join(', ');
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
      const onboardingData: TutorOnboardingData & { nativeLanguage?: string; residenceCountry?: string; interfaceLanguage?: string } = {
        firstName: this.formatName(this.firstName),
        lastName: this.formatName(this.lastName),
        country: this.country,
        residenceCountry: this.residenceCountry,
        nativeLanguage: this.nativeLanguage,
        interfaceLanguage: this.selectedInterfaceLanguage,
        languages: this.selectedLanguages,
        experience: this.selectedExperience,
        schedule: this.selectedSchedule,
        summary: this.formatText(this.profileSummary),
        bio: this.formatText(this.profileBio),
        hourlyRate: this.hourlyRate,
        introductionVideo: this.introductionVideo,
        videoThumbnail: this.thumbnailUrl,
        videoType: this.videoType
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
    } catch (error) {
      console.error('Error completing tutor onboarding:', error);
      this.isSubmitting = false;
      
      const alert = await this.alertController.create({
        header: this.translateService.instant('ONBOARDING.ALERTS.ERROR'),
        message: this.translateService.instant('ONBOARDING.ALERTS.SETUP_FAILED'),
        buttons: [this.translateService.instant('ONBOARDING.ALERTS.OK')]
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