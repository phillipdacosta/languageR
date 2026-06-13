import { Component, OnInit, OnDestroy, ViewChild, ViewChildren, QueryList, ElementRef, AfterViewInit, AfterViewChecked, ChangeDetectorRef, HostBinding } from '@angular/core';
import { Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AuthService, User } from '../services/auth.service';
import { UserService, TutorOnboardingData } from '../services/user.service';
import { LanguageService, LanguageOption, SupportedLanguage } from '../services/language.service';
import { TranslateService } from '@ngx-translate/core';
import { OnboardingGuard } from '../guards/onboarding.guard';
import { Observable, Subscription } from 'rxjs';
import { take, filter } from 'rxjs/operators';
import { LoadingController, AlertController, ModalController, ToastController, IonRange } from '@ionic/angular';
import { CountrySelectModalComponent } from '../components/country-select-modal/country-select-modal.component';
import { LoadingService } from '../services/loading.service';
import { COUNTRIES_ONBOARDING_LIST } from '../data/country-onboarding-list';
import { TEACHABLE_LANGUAGE_EN_NAMES } from '../data/teachable-language-order';
import { FlagService } from '../services/flag.service';
import { LocaleDisplayService, TEACHABLE_ENGLISH_NAME_TO_ISO639 } from '../services/locale-display.service';
import { SIGNUP_INTERFACE_LANG_COMPLETED_KEY } from '../signup-language/language-select-flow.storage';
import { WizardGuidanceItem } from '../shared/models/wizard-step-guidance.model';
import { TUTOR_WIZARD_GUIDANCE } from '../shared/wizard-step-guidance.config';

export type TutorOnboardingNativeLangChip = { code: string; native: string; interfaceLabel: string };

@Component({
  selector: 'app-tutor-onboarding',
  templateUrl: './tutor-onboarding.page.html',
  styleUrls: ['./tutor-onboarding.page.scss'],
  standalone: false,
})
export class TutorOnboardingPage implements OnInit, OnDestroy, AfterViewInit, AfterViewChecked {
  @HostBinding('class.onboarding-page--wizard-main')
  get onboardingPageWizardMainActive(): boolean {
    return !this.showWelcome && this.preStepPhase === 'done';
  }

  user$: Observable<User | null>;
  currentStep = 1;
  totalSteps = 11; // Name + Origin + Residence + Native + Spoken Languages + Spoken Levels + Teaching Languages + Experience + Schedule + Bio + Rate

  tutorWizardGreetingKey = 'ONBOARDING.WELCOME_SCREEN.TUTOR_GREETING';
  tutorWizardTitleKey = 'ONBOARDING.TUTOR_OB.STEP1_TITLE';
  tutorWizardSubtitleKey = 'ONBOARDING.TUTOR_OB.STEP1_SUBTITLE';
  tutorWizardGuidanceItems: WizardGuidanceItem[] = TUTOR_WIZARD_GUIDANCE[1];
  tutorWizardProgressPercent = 0;

  // Language selection pre-step
  preStepPhase: 'language' | 'welcome' | 'done' = 'language';
  private preLanguageReturn: { phase: 'welcome' | 'done'; showPreview: boolean } = { phase: 'welcome', showPreview: false };
  welcomeRevealed: boolean = false;
  private welcomeCelebrationFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  availableInterfaceLanguages: LanguageOption[] = [];
  selectedInterfaceLanguage: SupportedLanguage = 'en';
  selectedLanguageFlag = '🇬🇧';
  selectedLanguageEnglishName = 'English';
  termsOfServiceHref = '/terms?lang=en';
  privacyPolicyHref = '/privacy?lang=en';

  // Rotating heading (language picker): multilingual lines from i18n.
  readonly headingRotationKeys: readonly string[] = [
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_01',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_02',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_03',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_04',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_05',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_06',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_07',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_08',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_09',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_10',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_11',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_12',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_13',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_14',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_15',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_16',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_17',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_18',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_19',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_20',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_21',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_22',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_23',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_24',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_25',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_26',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_27',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_28',
    'ONBOARDING.LANG_SELECT.HEADING_ROTATE_29',
  ];
  activeHeadingIndex = 0;
  private headingInterval: ReturnType<typeof setInterval> | null = null;
  private headingRotationStartTimeout: ReturnType<typeof setTimeout> | null = null;
  private headingRotationLoadSub: Subscription | null = null;
  private languageApplyDebounce: ReturnType<typeof setTimeout> | null = null;
  private static readonly LANGUAGE_APPLY_DEBOUNCE_MS = 800;

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

  /** CEFR levels the tutor can speak (additional languages, not the native one). */
  spokenLanguages: { code: string; level: string }[] = [];

  readonly cefrLevels: { value: string; label: string; desc: string }[] = [
    { value: 'A1', label: 'A1', desc: 'Beginner' },
    { value: 'A2', label: 'A2', desc: 'Elementary' },
    { value: 'B1', label: 'B1', desc: 'Intermediate' },
    { value: 'B2', label: 'B2', desc: 'Upper-intermediate' },
    { value: 'C1', label: 'C1', desc: 'Advanced' },
    { value: 'C2', label: 'C2', desc: 'Proficient' },
  ];

  toggleSpokenLanguage(code: string): void {
    const idx = this.spokenLanguages.findIndex(s => s.code === code);
    if (idx >= 0) {
      this.spokenLanguages.splice(idx, 1);
    } else {
      this.spokenLanguages = [...this.spokenLanguages, { code, level: 'B2' }];
    }
  }

  isSpokenLanguageSelected(code: string): boolean {
    return this.spokenLanguages.some(s => s.code === code);
  }

  getSpokenLanguageLevel(code: string): string {
    return this.spokenLanguages.find(s => s.code === code)?.level ?? '';
  }

  setSpokenLanguageLevel(code: string, level: string): void {
    const entry = this.spokenLanguages.find(s => s.code === code);
    if (entry) {
      entry.level = level;
      this.spokenLanguages = [...this.spokenLanguages];
    }
  }

  getSpokenLanguageDisplayName(code: string): string {
    return this.nativeLanguageOptions.find(l => l.code === code)?.interfaceLabel || code;
  }

  get spokenLanguageOptions() {
    return this.nativeLanguageOptions.filter(l => l.code !== this.nativeLanguage);
  }

  selectedLanguages: string[] = [];
  selectedExperience = '';
  selectedSchedule = '';
  translatedExperience = '';
  translatedSchedule = '';
  profileSummary = '';
  profileBio = '';
  hourlyRate = 25;
  // Defer mounting ion-range until the step's enter animation has settled so
  // the knob renders at its final position instead of sliding from 0.
  tutorRateRangeReady = false;
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
  @ViewChild('welcomeCelebrationVideo') welcomeCelebrationVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('firstNameInput') firstNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('summaryInput') summaryInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('countryOriginButton') countryOriginButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('countryResidenceButton') countryResidenceButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('wizardViewportScroll', { read: ElementRef }) wizardViewportScroll?: ElementRef<HTMLElement>;
  @ViewChild('tutorRateRange') tutorRateRange?: IonRange;

  @ViewChildren('tutorNativeChip') tutorNativeChips?: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChildren('tutorSpokenLangChip') tutorSpokenLangChips?: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChildren('tutorSpokenCefrChip') tutorSpokenCefrChips?: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChildren('tutorTeachableChip') tutorTeachableChips?: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChildren('tutorExpChip') tutorExpChips?: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChildren('tutorScheduleChip') tutorScheduleChips?: QueryList<ElementRef<HTMLButtonElement>>;
  
  private previousStep = 0;

  /** Canonical English teaching-language names (stored in DB). */
  teachableLanguageRows: { value: string; interfaceLabel: string }[] = [];

  // Native language options with ISO codes (same as student onboarding)
  nativeLanguageOptions: TutorOnboardingNativeLangChip[] = [
    { code: 'en', native: 'English', interfaceLabel: '' },
    { code: 'es', native: 'Español', interfaceLabel: '' },
    { code: 'fr', native: 'Français', interfaceLabel: '' },
    { code: 'de', native: 'Deutsch', interfaceLabel: '' },
    { code: 'it', native: 'Italiano', interfaceLabel: '' },
    { code: 'pt', native: 'Português', interfaceLabel: '' },
    { code: 'ru', native: 'Русский', interfaceLabel: '' },
    { code: 'zh', native: '中文', interfaceLabel: '' },
    { code: 'ja', native: '日本語', interfaceLabel: '' },
    { code: 'ko', native: '한국어', interfaceLabel: '' },
    // TEMP: RTL languages hidden from pickers (ar, he, fa)
    // { code: 'ar', native: 'العربية', interfaceLabel: '' },
    { code: 'hi', native: 'हिन्दी', interfaceLabel: '' },
    { code: 'nl', native: 'Nederlands', interfaceLabel: '' },
    { code: 'pl', native: 'Polski', interfaceLabel: '' },
    { code: 'tr', native: 'Türkçe', interfaceLabel: '' },
    { code: 'sv', native: 'Svenska', interfaceLabel: '' },
    { code: 'no', native: 'Norsk', interfaceLabel: '' },
    { code: 'da', native: 'Dansk', interfaceLabel: '' },
    { code: 'fi', native: 'Suomi', interfaceLabel: '' },
    { code: 'el', native: 'Ελληνικά', interfaceLabel: '' },
    { code: 'cs', native: 'Čeština', interfaceLabel: '' },
    { code: 'ro', native: 'Română', interfaceLabel: '' },
    { code: 'uk', native: 'Українська', interfaceLabel: '' },
    { code: 'vi', native: 'Tiếng Việt', interfaceLabel: '' },
    { code: 'th', native: 'ไทย', interfaceLabel: '' },
    { code: 'id', native: 'Bahasa Indonesia', interfaceLabel: '' },
    { code: 'ms', native: 'Bahasa Melayu', interfaceLabel: '' },
    // { code: 'he', native: 'עברית', interfaceLabel: '' },
    // { code: 'fa', native: 'فارسی', interfaceLabel: '' },
  ];

  countryOptions = [...COUNTRIES_ONBOARDING_LIST];

  countryDisplayLabel = '';
  residenceCountryDisplayLabel = '';

  private localeUiSub: Subscription | null = null;

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
    private translateService: TranslateService,
    private loadingService: LoadingService,
    private flagService: FlagService,
    private localeDisplay: LocaleDisplayService
  ) {
    this.user$ = this.authService.user$;
    // TEMP: RTL languages (ar, he, fa) hidden from interface language picker
    // this.availableInterfaceLanguages = this.languageService.supportedLanguages;
    this.availableInterfaceLanguages = this.languageService.supportedLanguages.filter(
      (l) => l.code !== 'ar' && l.code !== 'he' && l.code !== 'fa'
    );
    this.selectedInterfaceLanguage = this.languageService.getCurrentLanguage();
    this.refreshLanguageToolbarFlag();
    this.refreshPublicLegalLinks();
  }

  ngOnDestroy() {
    this.clearWelcomeCelebrationFallback();
    this.clearLanguageApplyDebounce();
    this.localeUiSub?.unsubscribe();
    this.localeUiSub = null;
    this.headingRotationLoadSub?.unsubscribe();
    this.headingRotationLoadSub = null;
    this.cancelHeadingRotationSchedule();
    this.stopHeadingRotation();
  }

  ngAfterViewInit() {
    if (this.preStepPhase === 'welcome') {
      this.playWelcomeCelebration();
    }
  }

  private clearLanguageApplyDebounce(): void {
    if (this.languageApplyDebounce != null) {
      clearTimeout(this.languageApplyDebounce);
      this.languageApplyDebounce = null;
    }
  }

  /** Country + language labels follow the active interface language (Intl). */
  private bindLocaleSensitiveUi(): void {
    const ui = this.languageService.getCurrentLanguage();
    const otherKey = 'ONBOARDING.COUNTRY_MODAL.OTHER';
    const otherT = this.translateService.instant(otherKey);
    const otherLbl = otherT !== otherKey ? otherT : 'Other';

    for (const row of this.nativeLanguageOptions) {
      row.interfaceLabel = this.localeDisplay.languageName(row.code, ui);
    }

    this.teachableLanguageRows = TEACHABLE_LANGUAGE_EN_NAMES.map((v) => ({
      value: v,
      interfaceLabel: this.localeDisplay.languageName(
        TEACHABLE_ENGLISH_NAME_TO_ISO639[v] ?? 'en',
        ui
      ),
    }));

    this.countryDisplayLabel = this.country
      ? this.localeDisplay.localizedCountryRow(
          this.country,
          ui,
          this.flagService.getCountryCodeFromCountryName(this.country),
          otherLbl
        )
      : '';
    this.residenceCountryDisplayLabel = this.residenceCountry
      ? this.localeDisplay.localizedCountryRow(
          this.residenceCountry,
          ui,
          this.flagService.getCountryCodeFromCountryName(this.residenceCountry),
          otherLbl
        )
      : '';
    this.refreshLanguageToolbarFlag();
  }

  private refreshLanguageToolbarFlag(): void {
    const option = this.languageService.getLanguageOption(this.selectedInterfaceLanguage);
    this.selectedLanguageFlag = option?.flag ?? '🇬🇧';
    this.selectedLanguageEnglishName = option?.name ?? 'English';
  }

  private refreshPublicLegalLinks(): void {
    const lang = encodeURIComponent(this.selectedInterfaceLanguage);
    this.termsOfServiceHref = `/terms?lang=${lang}`;
    this.privacyPolicyHref = `/privacy?lang=${lang}`;
  }

  private scheduleInterfaceLanguageApply(lang: SupportedLanguage): void {
    this.clearLanguageApplyDebounce();
    this.languageApplyDebounce = setTimeout(() => {
      this.languageApplyDebounce = null;
      this.languageService.setLanguage(lang);
      this.cdr.detectChanges();
    }, TutorOnboardingPage.LANGUAGE_APPLY_DEBOUNCE_MS);
  }

  /** After global loading overlay is gone (onboarding guard), document load, then 4s — begin rotating headings. */
  private scheduleHeadingRotationAfterLoad(): void {
    this.cancelHeadingRotationSchedule();
    this.stopHeadingRotation();
    this.headingRotationLoadSub?.unsubscribe();
    this.headingRotationLoadSub = null;

    const startAfterDelay = () => {
      this.headingRotationStartTimeout = setTimeout(() => {
        this.headingRotationStartTimeout = null;
        this.activeHeadingIndex = 0;
        this.startHeadingRotation();
      }, 4000);
    };

    const afterDocumentLoaded = () => {
      if (typeof document === 'undefined' || typeof window === 'undefined') {
        startAfterDelay();
        return;
      }
      if (document.readyState === 'complete') {
        startAfterDelay();
      } else {
        window.addEventListener('load', () => startAfterDelay(), { once: true });
      }
    };

    this.headingRotationLoadSub = this.loadingService.loading$
      .pipe(filter((isLoading) => !isLoading), take(1))
      .subscribe(() => {
        this.headingRotationLoadSub = null;
        afterDocumentLoaded();
      });
  }

  private cancelHeadingRotationSchedule(): void {
    if (this.headingRotationStartTimeout != null) {
      clearTimeout(this.headingRotationStartTimeout);
      this.headingRotationStartTimeout = null;
    }
  }

  private startHeadingRotation() {
    this.stopHeadingRotation();
    this.headingInterval = setInterval(() => {
      this.activeHeadingIndex = (this.activeHeadingIndex + 1) % this.headingRotationKeys.length;
      this.cdr.detectChanges();
    }, 2400);
  }

  private stopHeadingRotation() {
    if (this.headingInterval != null) {
      clearInterval(this.headingInterval);
      this.headingInterval = null;
    }
  }

  ngOnInit() {
    const skipInterfaceLanguageStep =
      sessionStorage.getItem(SIGNUP_INTERFACE_LANG_COMPLETED_KEY) === '1' ||
      localStorage.getItem('selectedUserType') === 'tutor';

    if (skipInterfaceLanguageStep) {
      this.preStepPhase = 'welcome';
      this.welcomeRevealed = false;
    } else {
      this.scheduleHeadingRotationAfterLoad();
    }

    this.localeUiSub = this.languageService.currentLanguage$.subscribe(() => {
      this.bindLocaleSensitiveUi();
      this.cdr.markForCheck();
    });
    this.bindLocaleSensitiveUi();
    this.runAuthenticatedTutorOnboardingChecks();
    this.syncTutorWizardCopy();
  }

  private runAuthenticatedTutorOnboardingChecks(): void {
    this.authService.isAuthenticated$.pipe(take(1)).subscribe(isAuthenticated => {
      if (!isAuthenticated) {
        this.router.navigate(['/login']);
        return;
      }

      this.authService.getUserProfile().pipe(take(1)).subscribe(user => {
        if (!user || !user.email) {
          this.router.navigate(['/login']);
          return;
        }

        this.userService.getCurrentUser().pipe(take(1)).subscribe({
          next: (dbUser) => {
            if (dbUser?.onboardingCompleted) {
              this.router.navigate(['/tabs/home'], { replaceUrl: true });
            }
          },
          error: () => {
            // User doesn't exist in DB yet — proceed with onboarding.
          },
        });
      });
    });
  }

  ngAfterViewChecked() {
    const wizardActive =
      this.preStepPhase === 'done' && !this.showPreview && !this.showWelcome;
    if (!wizardActive) {
      return;
    }
    if (this.currentStep !== this.previousStep) {
      const enteredStep = this.currentStep;
      const leftStep = this.previousStep;
      this.previousStep = this.currentStep;
      this.syncTutorWizardCopy();
      this.resetWizardViewportScroll();
      if (leftStep === 11 && enteredStep !== 11) {
        this.tutorRateRangeReady = false;
      }
      if (enteredStep === 11) {
        this.deferMountRateRange();
      } else {
        setTimeout(() => this.focusFirstInput(), 120);
      }
    }
  }

  private resetWizardViewportScroll(): void {
    const el = this.wizardViewportScroll?.nativeElement;
    if (el) {
      el.scrollTop = 0;
    }
  }

  // Wait until the parent step's fade-in animation has settled before mounting
  // ion-range. Mounting during the animation caused the knob to render at value 0
  // and visibly slide to its real position. With a stable layout, ion-range
  // computes its knob and active-bar positions correctly on first paint.
  private deferMountRateRange(): void {
    this.tutorRateRangeReady = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.tutorRateRangeReady = true;
        this.cdr.detectChanges();
      });
    });
  }

  private syncTutorWizardCopy(): void {
    const base = 'ONBOARDING.TUTOR_OB';
    switch (this.currentStep) {
      case 1:
        this.tutorWizardTitleKey = `${base}.STEP1_TITLE`;
        this.tutorWizardSubtitleKey = `${base}.STEP1_SUBTITLE`;
        break;
      case 2:
        this.tutorWizardTitleKey = `${base}.STEP_ORIGIN_TITLE`;
        this.tutorWizardSubtitleKey = `${base}.STEP_ORIGIN_SUBTITLE`;
        break;
      case 3:
        this.tutorWizardTitleKey = `${base}.STEP2_TITLE`;
        this.tutorWizardSubtitleKey = `${base}.STEP2_SUBTITLE`;
        break;
      case 4:
        this.tutorWizardTitleKey = `${base}.STEP3_TITLE`;
        this.tutorWizardSubtitleKey = `${base}.STEP3_SUBTITLE`;
        break;
      case 5:
        this.tutorWizardTitleKey = `${base}.STEP_SPOKEN_TITLE`;
        this.tutorWizardSubtitleKey = `${base}.STEP_SPOKEN_SUBTITLE`;
        break;
      case 6:
        this.tutorWizardTitleKey = `${base}.STEP_SPOKEN_LEVELS_TITLE`;
        this.tutorWizardSubtitleKey = `${base}.STEP_SPOKEN_LEVELS_SUBTITLE`;
        break;
      case 7:
        this.tutorWizardTitleKey = `${base}.STEP4_TITLE`;
        this.tutorWizardSubtitleKey = `${base}.STEP4_SUBTITLE`;
        break;
      case 8:
        this.tutorWizardTitleKey = `${base}.STEP5_TITLE`;
        this.tutorWizardSubtitleKey = `${base}.STEP5_SUBTITLE`;
        break;
      case 9:
        this.tutorWizardTitleKey = `${base}.STEP6_TITLE`;
        this.tutorWizardSubtitleKey = `${base}.STEP6_SUBTITLE`;
        break;
      case 10:
        this.tutorWizardTitleKey = `${base}.STEP7_TITLE`;
        this.tutorWizardSubtitleKey = `${base}.STEP7_SUBTITLE`;
        break;
      case 11:
      default:
        this.tutorWizardTitleKey = `${base}.STEP8_TITLE`;
        this.tutorWizardSubtitleKey = `${base}.STEP8_SUBTITLE`;
        break;
    }
    this.tutorWizardGreetingKey =
      this.currentStep === 1 ? 'ONBOARDING.WELCOME_SCREEN.TUTOR_GREETING' : '';
    this.tutorWizardProgressPercent =
      this.totalSteps > 0 ? (this.currentStep / this.totalSteps) * 100 : 0;
    this.tutorWizardGuidanceItems = TUTOR_WIZARD_GUIDANCE[this.currentStep] ?? [];
  }

  private focusFirstInput() {
    switch (this.currentStep) {
      case 1:
        this.firstNameInput?.nativeElement?.focus();
        break;
      case 2:
        this.countryOriginButton?.nativeElement?.focus();
        break;
      case 3:
        this.countryResidenceButton?.nativeElement?.focus();
        break;
      case 4:
        this.focusFirstInQueryList(this.tutorNativeChips);
        break;
      case 5:
        this.focusFirstInQueryList(this.tutorSpokenLangChips);
        break;
      case 6:
        this.focusFirstInQueryList(this.tutorSpokenCefrChips);
        break;
      case 7:
        this.focusFirstInQueryList(this.tutorTeachableChips);
        break;
      case 8:
        this.focusFirstInQueryList(this.tutorExpChips);
        break;
      case 9:
        this.focusFirstInQueryList(this.tutorScheduleChips);
        break;
      case 10:
        this.summaryInput?.nativeElement?.focus();
        break;
      case 11:
        // Do not autofocus ion-range — pin + bar glitch on first paint.
        break;
      default:
        break;
    }
  }

  private focusFirstInQueryList(list: QueryList<ElementRef<HTMLElement>> | undefined): void {
    const el = list?.first?.nativeElement;
    el?.focus();
  }

  selectInterfaceLanguage(lang: SupportedLanguage) {
    this.selectedInterfaceLanguage = lang;
    this.refreshLanguageToolbarFlag();
    this.refreshPublicLegalLinks();
    this.scheduleInterfaceLanguageApply(lang);
  }

  confirmLanguageSelection() {
    this.clearLanguageApplyDebounce();
    this.languageService.setLanguage(this.selectedInterfaceLanguage);
    this.refreshPublicLegalLinks();
    this.cancelHeadingRotationSchedule();
    this.stopHeadingRotation();
    const ret = this.preLanguageReturn;
    if (ret.phase === 'done') {
      this.preStepPhase = 'done';
      this.showPreview = ret.showPreview;
    } else {
      this.preStepPhase = 'welcome';
      this.welcomeRevealed = false;
      setTimeout(() => this.playWelcomeCelebration(), 0);
    }
  }

  /** Go back to `/role-select` so the user can switch between student/tutor. */
  changeRole(): void {
    void this.router.navigate(['/role-select']);
  }

  goBackToLanguageSelect() {
    this.preStepPhase = 'language';
    this.welcomeRevealed = false;
    this.refreshPublicLegalLinks();
    this.scheduleHeadingRotationAfterLoad();
  }

  onWelcomeCelebrationEnded(): void {
    this.clearWelcomeCelebrationFallback();
    if (!this.welcomeRevealed) {
      this.revealWelcome();
    }
  }

  onWelcomeCelebrationError(): void {
    this.clearWelcomeCelebrationFallback();
    if (!this.welcomeRevealed) {
      this.revealWelcome();
    }
  }

  private clearWelcomeCelebrationFallback(): void {
    if (this.welcomeCelebrationFallbackTimer) {
      clearTimeout(this.welcomeCelebrationFallbackTimer);
      this.welcomeCelebrationFallbackTimer = null;
    }
  }

  private playWelcomeCelebration(): void {
    this.clearWelcomeCelebrationFallback();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.revealWelcome();
      return;
    }

    const video = this.welcomeCelebrationVideo?.nativeElement;
    if (!video) {
      this.welcomeCelebrationFallbackTimer = setTimeout(() => this.revealWelcome(), 6500);
      return;
    }

    const fallbackMs = Number.isFinite(video.duration) && video.duration > 0
      ? video.duration * 1000 + 400
      : 6500;
    this.welcomeCelebrationFallbackTimer = setTimeout(() => {
      if (!this.welcomeRevealed) {
        this.revealWelcome();
      }
    }, fallbackMs);

    video.currentTime = 0;
    void video.play().catch(() => {
      if (!this.welcomeRevealed) {
        this.revealWelcome();
      }
    });
  }

  private revealWelcome(): void {
    if (this.welcomeRevealed) {
      return;
    }
    this.welcomeRevealed = true;
    this.cdr.detectChanges();
  }

  startOnboarding() {
    this.preStepPhase = 'done';
  }

  nextStep() {
    if (this.canProceed() && this.currentStep < this.totalSteps) {
      this.currentStep++;
      // Skip CEFR level step if no spoken languages were selected
      if (this.currentStep === 6 && this.spokenLanguages.length === 0) {
        this.currentStep++;
      }
    }
  }

  prevStep() {
    if (this.currentStep === 1) {
      this.preStepPhase = 'welcome';
      this.welcomeRevealed = false;
      this.cdr.detectChanges();
      setTimeout(() => this.playWelcomeCelebration(), 0);
    } else {
      this.currentStep--;
      // Skip CEFR level step going back if no spoken languages were selected
      if (this.currentStep === 6 && this.spokenLanguages.length === 0) {
        this.currentStep--;
      }
    }
  }

  goToLanguageSelect() {
    this.preLanguageReturn = {
      phase: this.preStepPhase as 'welcome' | 'done',
      showPreview: this.showPreview,
    };
    this.showPreview = false;
    this.preStepPhase = 'language';
    this.scheduleHeadingRotationAfterLoad();
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
    const modal = await this.modalController.create({
      component: CountrySelectModalComponent,
      componentProps: {
        countries: this.countryOptions,
        selectedCountry: this.country,
        modalType: 'origin',
      },
      cssClass: 'modern-modal',
      showBackdrop: true,
      backdropDismiss: true,
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data && data.selectedCountry) {
      this.country = data.selectedCountry;
      this.bindLocaleSensitiveUi();
    }
  }

  // Open country selection modal (for residence)
  async openResidenceCountryModal() {
    const modal = await this.modalController.create({
      component: CountrySelectModalComponent,
      componentProps: {
        countries: this.countryOptions,
        selectedCountry: this.residenceCountry,
        modalType: 'residence',
      },
      cssClass: 'modern-modal',
      showBackdrop: true,
      backdropDismiss: true,
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data && data.selectedCountry) {
      this.residenceCountry = data.selectedCountry;
      this.bindLocaleSensitiveUi();
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
  previewSpokenLanguages: { name: string; level: string }[] = [];
  previewProfileInitials = '';
  previewTimezoneLabel = '';

  readonly tutorPreviewFlowSteps: ReadonlyArray<{ labelKey: string; done: boolean; current: boolean }> = [
    { labelKey: 'ONBOARDING.TUTOR_OB.PREVIEW_FLOW_WELCOME', done: true, current: false },
    { labelKey: 'ONBOARDING.TUTOR_OB.PREVIEW_FLOW_BASIC', done: true, current: false },
    { labelKey: 'ONBOARDING.TUTOR_OB.PREVIEW_FLOW_TEACHING', done: true, current: false },
    { labelKey: 'ONBOARDING.TUTOR_OB.PREVIEW_FLOW_PROFILE', done: true, current: false },
    { labelKey: 'ONBOARDING.TUTOR_OB.PREVIEW_FLOW_REVIEW', done: false, current: true },
  ];

  showPreviewPage() {
    const ui = this.languageService.getCurrentLanguage();
    const nativeLang = this.nativeLanguageOptions.find((l) => l.code === this.nativeLanguage);
    this.previewNativeLanguageName = nativeLang?.interfaceLabel ?? this.nativeLanguage;
    this.previewSelectedLanguages = this.selectedLanguages
      .map((lang) => {
        const iso = TEACHABLE_ENGLISH_NAME_TO_ISO639[lang];
        return iso ? this.localeDisplay.languageName(iso, ui) : lang;
      })
      .join(', ');
    this.previewSpokenLanguages = this.spokenLanguages
      .filter(s => s.code && s.level)
      .map(s => ({
        name: this.nativeLanguageOptions.find(l => l.code === s.code)?.interfaceLabel ?? s.code,
        level: s.level
      }));
    const firstInitial = (this.firstName?.trim().charAt(0) || '').toUpperCase();
    const lastInitial = (this.lastName?.trim().charAt(0) || '').toUpperCase();
    this.previewProfileInitials = (firstInitial + lastInitial) || '?';
    try {
      this.previewTimezoneLabel = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      this.previewTimezoneLabel = '';
    }
    this.showPreview = true;
    this.hasReachedPreview = true;
    // Scroll to top when preview page is shown
    setTimeout(() => {
      const scrollEl =
        this.wizardViewportScroll?.nativeElement ??
        document.querySelector('.preview-wizard-scroll');
      if (scrollEl instanceof HTMLElement) {
        scrollEl.scrollTop = 0;
      }
      window.scrollTo(0, 0);
    }, 0);
  }

  goBackToEdit(step?: number) {
    this.showPreview = false;
    if (step) {
      this.currentStep = step;
      this.previousStep = 0;
    }
    this.syncTutorWizardCopy();
  }

  getNativeLanguageName(): string {
    const lang = this.nativeLanguageOptions.find((l) => l.code === this.nativeLanguage);
    if (!lang) return this.nativeLanguage;
    return lang.interfaceLabel || this.nativeLanguage;
  }

  async completeOnboarding() {
    this.isSubmitting = true;

    try {
      const auth0User = await this.authService.getUserProfile().pipe(take(1)).toPromise();

      if (!auth0User) {
        throw new Error('No Auth0 user data available');
      }

      // No pre-onboarding POST. The user document is created atomically by
      // PUT /api/users/onboarding below with the full tutor payload, so a
      // failed request never leaves a half-populated record behind.
      const onboardingData: TutorOnboardingData & { userType: 'tutor'; nativeLanguage?: string; residenceCountry?: string; interfaceLanguage?: string } = {
        userType: 'tutor',
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
        spokenLanguages: this.spokenLanguages.filter(s => s.code && s.level)
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

  canProceed(): boolean {
    switch (this.currentStep) {
      case 1:
        return this.firstName.trim() !== '' && this.lastName.trim() !== '';
      case 2:
        return this.country !== '';
      case 3:
        return this.residenceCountry !== '';
      case 4:
        return this.nativeLanguage !== '';
      case 5:
      case 6:
        return true; // spoken languages and levels are optional
      case 7:
        return this.selectedLanguages.length > 0;
      case 8:
        return this.selectedExperience !== '';
      case 9:
        return this.selectedSchedule !== '';
      case 10:
        return this.profileBio.length > 0;
      case 11:
        return this.hourlyRate >= 10;
      default:
        return false;
    }
  }

  /**
   * True only when every required field across all steps is filled.
   * Used on the review page to gate the Complete Setup button and
   * to drive the checklist/progress ring.
   */
  get tutorProfileComplete(): boolean {
    return (
      this.firstName.trim() !== '' &&
      this.lastName.trim() !== '' &&
      this.country !== '' &&
      this.residenceCountry !== '' &&
      this.nativeLanguage !== '' &&
      this.selectedLanguages.length > 0 &&
      this.selectedExperience !== '' &&
      this.selectedSchedule !== '' &&
      this.profileBio.trim().length > 0 &&
      this.hourlyRate >= 10
    );
  }

  get tutorChecklistBasicDone(): boolean {
    return (
      this.firstName.trim() !== '' &&
      this.lastName.trim() !== '' &&
      this.country !== '' &&
      this.residenceCountry !== ''
    );
  }

  get tutorChecklistTeachingDone(): boolean {
    return (
      this.nativeLanguage !== '' &&
      this.selectedLanguages.length > 0 &&
      this.selectedExperience !== ''
    );
  }

  get tutorChecklistProfileDone(): boolean {
    return this.profileBio.trim().length > 0 && this.hourlyRate >= 10;
  }

  get tutorChecklistAvailabilityDone(): boolean {
    return this.selectedSchedule !== '';
  }

  get tutorPreviewProgressPercent(): number {
    const done = [
      this.tutorChecklistBasicDone,
      this.tutorChecklistTeachingDone,
      this.tutorChecklistProfileDone,
      this.tutorChecklistAvailabilityDone,
    ].filter(Boolean).length;
    return Math.round((done / 4) * 100);
  }

  /** SVG stroke-dashoffset for the 100% ring (circumference = 97.4). */
  get tutorPreviewProgressOffset(): number {
    return 97.4 - (97.4 * this.tutorPreviewProgressPercent) / 100;
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