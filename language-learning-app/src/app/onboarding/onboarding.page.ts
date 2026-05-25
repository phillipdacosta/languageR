import { Component, OnInit, OnDestroy, ViewChild, ViewChildren, QueryList, ElementRef, AfterViewChecked, ChangeDetectorRef, HostBinding } from '@angular/core';
import '@dotlottie/player-component';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserService, OnboardingData, TutorOnboardingData, User } from '../services/user.service';
import { LanguageService, SupportedLanguage } from '../services/language.service';
import { TranslateService } from '@ngx-translate/core';
import { OnboardingGuard } from '../guards/onboarding.guard';
import { Observable, Subscription, forkJoin } from 'rxjs';
import { take, timeout, retry, catchError } from 'rxjs/operators';
import { LoadingController, AlertController, ModalController } from '@ionic/angular';
import { CountrySelectModalComponent } from '../components/country-select-modal/country-select-modal.component';
import {
  recommendedMode as computeRecommendedMode,
  weeksToTarget,
  normalizeGoalTargetDate,
} from '../shared/goal-pace.helper';
import { translateLangToDatetimeLocale } from '../shared/datetime-locale.helper';
import { COUNTRIES_ONBOARDING_LIST } from '../data/country-onboarding-list';
import { TEACHABLE_LANGUAGE_EN_NAMES } from '../data/teachable-language-order';
import { FlagService } from '../services/flag.service';
import { LocaleDisplayService, TEACHABLE_ENGLISH_NAME_TO_ISO639 } from '../services/locale-display.service';
import {
  LANGUAGE_SELECT_RETURN_CONTEXT,
  LanguageSelectReturnPayload,
  ONBOARDING_AFTER_LANGUAGE_RESTORE,
  SIGNUP_INTERFACE_LANG_COMPLETED_KEY,
} from '../signup-language/language-select-flow.storage';
import { WizardGuidanceItem } from '../shared/models/wizard-step-guidance.model';
import { STUDENT_WIZARD_GUIDANCE } from '../shared/wizard-step-guidance.config';

export type OnboardingNativeLangChip = { code: string; native: string; interfaceLabel: string };
export type StudentGoalCardOption = { value: string; labelKey: string; descKey: string; icon: string };
export type StudentLevelCardOption = { value: string; labelKey: string; descKey: string };
export type StudentTimelineCardOption = { value: string; labelKey: string; icon: string };

@Component({
  selector: 'app-onboarding',
  templateUrl: './onboarding.page.html',
  styleUrls: ['./onboarding.page.scss'],
  standalone: false,
})
export class OnboardingPage implements OnInit, OnDestroy, AfterViewChecked {
  @HostBinding('class.onboarding-page--wizard-main')
  get onboardingPageWizardMainActive(): boolean {
    return !this.showWelcome && this.preStepPhase === 'done';
  }

  user$: Observable<any>;
  currentStep = 1;
  totalSteps = 8; // Students: Name + Native Language + Spoken Languages + CEFR Levels + Languages + Goal + Level + Timeline
  currentUser: User | null = null;

  /** Translation keys for focused wizard header (template uses translate pipe — no getters). */
  studentWizardTitleKey = 'ONBOARDING.STUDENT.STEP1_TITLE';
  studentWizardSubtitleKey = 'ONBOARDING.STUDENT.STEP1_SUBTITLE';
  studentWizardGuidanceItems: WizardGuidanceItem[] = STUDENT_WIZARD_GUIDANCE[1];
  studentWizardProgressPercent = 0;

  // Welcome then student wizard (first-time interface language is `/signup-language`).
  preStepPhase: 'welcome' | 'done' = 'welcome';
  welcomeRevealed: boolean = false;
  selectedInterfaceLanguage: SupportedLanguage = 'en';
  selectedLanguageFlag = '🇬🇧';
  selectedLanguageEnglishName = 'English';

  /** Cancels in-flight pacing-banner i18n when goal/date changes or component destroys. */
  private pacingSuggestionI18nSub: Subscription | null = null;
  /** Re-binds pacing banner copy when the interface language changes. */
  private translateLangSub: Subscription | null = null;

  // Preview & Welcome state
  showPreview = false;
  showWelcome = false;
  isSubmitting = false;
  hasReachedPreview = false;
  previewProfileInitials = '';

  // ViewChild references for autofocus
  @ViewChild('firstNameInput') firstNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('customGoalPanel') customGoalPanel?: ElementRef<HTMLElement>;
  @ViewChild('customGoalTextarea') customGoalTextarea?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('pacingSuggestionBanner') pacingSuggestionBanner?: ElementRef<HTMLElement>;

  @ViewChildren('wizardNativeChip') wizardNativeChips?: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChildren('wizardTeachableChip') wizardTeachableChips?: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChildren('wizardGoalCard') wizardGoalCards?: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChildren('wizardLevelCard') wizardLevelCards?: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChildren('wizardTimelineCard') wizardTimelineCards?: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChildren('wizardSpokenLangChip') wizardSpokenLangChips?: QueryList<ElementRef<HTMLButtonElement>>;
  @ViewChildren('wizardSpokenCefrChip') wizardSpokenCefrChips?: QueryList<ElementRef<HTMLButtonElement>>;
  
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

  /** Additional languages the student speaks, each with a CEFR proficiency level. */
  spokenLanguages: { code: string; level: string }[] = [];

  readonly cefrLevels: { value: string; label: string; desc: string }[] = [
    { value: 'A1', label: 'A1', desc: 'Beginner' },
    { value: 'A2', label: 'A2', desc: 'Elementary' },
    { value: 'B1', label: 'B1', desc: 'Intermediate' },
    { value: 'B2', label: 'B2', desc: 'Upper-Intermediate' },
    { value: 'C1', label: 'C1', desc: 'Advanced' },
    { value: 'C2', label: 'C2', desc: 'Mastery' },
  ];

  get spokenLanguageOptions() {
    const learningIsoCodes = new Set(
      this.selectedLanguages
        .map(name => TEACHABLE_ENGLISH_NAME_TO_ISO639[name])
        .filter(Boolean)
    );
    return this.nativeLanguageOptions.filter(
      l => l.code !== this.nativeLanguage && !learningIsoCodes.has(l.code)
    );
  }

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

  selectedLanguages: string[] = [];
  learningGoals: string[] = [];
  experienceLevel = '';
  preferredSchedule = '';

  // Structured learning goal (new flow)
  learningGoalType: string = '';
  learningGoalDescription: string = '';
  selfAssessedLevel: string = '';
  goalTimeline: string = 'no_rush';
  goalTargetDate: string = '';
  readonly minTargetDate: string = new Date().toISOString().split('T')[0];
  /** BCP 47 locale for `ion-datetime` (localized month/weekday/cancel labels). */
  datePickerLocale = 'en-US';

  /** When true, the student opted to skip the goal/level/timeline steps and
   *  start with an unframed plan ("I'll start by trying a lesson"). Backend
   *  creates a thin shell plan automatically since `learningGoal` is omitted
   *  from the onboarding payload. */
  skipGoalSetup: boolean = false;

  /**
   * Soft, non-blocking suggestion shown on the timeline step when the
   * student's goal + deadline combo suggests single lessons would serve
   * them better than the structured roadmap (e.g. exam in ≤ 12 weeks).
   * `null` = no suggestion. See `shared/goal-pace.helper.ts`.
   */
  pacingSuggestion: { weeks: number; goalType: string } | null = null;

  /** Pre-resolved pacing-banner strings (avoid translate pipe before JSON finishes loading). */
  pacingSuggestionTitle = '';
  pacingSuggestionBody = '';
  pacingSuggestionAccept = '';
  pacingSuggestionDismiss = '';

  /** Re-binds country + language chip labels when the interface language changes. */
  private localeUiSub: Subscription | null = null;

  goalTypeOptions: StudentGoalCardOption[] = [
    {
      value: 'conversational',
      labelKey: 'LEARNING_PLAN.GOAL_LABEL_CONVERSATIONAL',
      descKey: 'ONBOARDING.STUDENT.GOAL_DESC_CONVERSATIONAL',
      icon: 'chatbubbles-outline',
    },
    {
      value: 'exam_prep',
      labelKey: 'LEARNING_PLAN.GOAL_LABEL_EXAM_PREP',
      descKey: 'ONBOARDING.STUDENT.GOAL_DESC_EXAM_PREP',
      icon: 'school-outline',
    },
    {
      value: 'professional',
      labelKey: 'LEARNING_PLAN.GOAL_LABEL_PROFESSIONAL',
      descKey: 'ONBOARDING.STUDENT.GOAL_DESC_PROFESSIONAL',
      icon: 'briefcase-outline',
    },
    {
      value: 'travel',
      labelKey: 'LEARNING_PLAN.GOAL_LABEL_TRAVEL',
      descKey: 'ONBOARDING.STUDENT.GOAL_DESC_TRAVEL',
      icon: 'airplane-outline',
    },
    {
      value: 'relocation',
      labelKey: 'LEARNING_PLAN.GOAL_LABEL_RELOCATION',
      descKey: 'ONBOARDING.STUDENT.GOAL_DESC_RELOCATION',
      icon: 'home-outline',
    },
    {
      value: 'other',
      labelKey: 'LEARNING_PLAN.GOAL_LABEL_OTHER',
      descKey: 'ONBOARDING.STUDENT.GOAL_DESC_OTHER',
      icon: 'sparkles-outline',
    },
  ];

  levelOptions: StudentLevelCardOption[] = [
    {
      value: 'complete_beginner',
      labelKey: 'ONBOARDING.STUDENT.LEVEL_OPTION_COMPLETE_BEGINNER',
      descKey: 'ONBOARDING.STUDENT.LEVEL_DESC_COMPLETE_BEGINNER',
    },
    {
      value: 'some_basics',
      labelKey: 'ONBOARDING.STUDENT.LEVEL_OPTION_SOME_BASICS',
      descKey: 'ONBOARDING.STUDENT.LEVEL_DESC_SOME_BASICS',
    },
    {
      value: 'simple_conversations',
      labelKey: 'ONBOARDING.STUDENT.LEVEL_OPTION_SIMPLE_CONVERSATIONS',
      descKey: 'ONBOARDING.STUDENT.LEVEL_DESC_SIMPLE_CONVERSATIONS',
    },
    {
      value: 'intermediate',
      labelKey: 'ONBOARDING.STUDENT.LEVEL_OPTION_INTERMEDIATE',
      descKey: 'ONBOARDING.STUDENT.LEVEL_DESC_INTERMEDIATE',
    },
    {
      value: 'advanced',
      labelKey: 'ONBOARDING.STUDENT.LEVEL_OPTION_ADVANCED',
      descKey: 'ONBOARDING.STUDENT.LEVEL_DESC_ADVANCED',
    },
  ];

  timelineOptions: StudentTimelineCardOption[] = [
    { value: 'specific_date', labelKey: 'ONBOARDING.STUDENT.TIMELINE_OPTION_SPECIFIC_DATE', icon: 'calendar-outline' },
    { value: 'few_months', labelKey: 'ONBOARDING.STUDENT.TIMELINE_OPTION_FEW_MONTHS', icon: 'time-outline' },
    { value: 'no_rush', labelKey: 'ONBOARDING.STUDENT.TIMELINE_OPTION_NO_RUSH', icon: 'leaf-outline' },
  ];

  /** Maps structured goal type to shared plan copy (see `LEARNING_PLAN` i18n). */
  private readonly learningGoalTypeToI18nKey: Record<string, string> = {
    conversational: 'LEARNING_PLAN.GOAL_LABEL_CONVERSATIONAL',
    exam_prep: 'LEARNING_PLAN.GOAL_LABEL_EXAM_PREP',
    professional: 'LEARNING_PLAN.GOAL_LABEL_PROFESSIONAL',
    travel: 'LEARNING_PLAN.GOAL_LABEL_TRAVEL',
    relocation: 'LEARNING_PLAN.GOAL_LABEL_RELOCATION',
    other: 'LEARNING_PLAN.GOAL_LABEL_OTHER',
  };

  // Tutor-specific data
  tutorCountry = '';
  tutorExperience = '';
  tutorSchedule = '';
  tutorBio = '';
  tutorHourlyRate = 25;

  teachableLanguageRows: { value: string; iso: string; interfaceLabel: string }[] = [];

  get filteredTeachableLanguageRows() {
    return this.teachableLanguageRows.filter(r => r.iso !== this.nativeLanguage);
  }

  // Native language options with ISO codes
  nativeLanguageOptions: OnboardingNativeLangChip[] = [
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

  tutorCountryOptions = [...COUNTRIES_ONBOARDING_LIST];

  tutorCountryDisplayLabel = '';

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

  translatedExperienceLevel = '';
  translatedSchedule = '';

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
    private translateService: TranslateService,
    private flagService: FlagService,
    private localeDisplay: LocaleDisplayService
  ) {
    this.user$ = this.authService.user$;
    this.selectedInterfaceLanguage = this.languageService.getCurrentLanguage();
    this.refreshLanguageToolbarFlag();
  }

  ngOnDestroy() {
    this.localeUiSub?.unsubscribe();
    this.localeUiSub = null;
    this.pacingSuggestionI18nSub?.unsubscribe();
    this.pacingSuggestionI18nSub = null;
    this.translateLangSub?.unsubscribe();
    this.translateLangSub = null;
  }

  private persistSignupLanguageReturn(): void {
    const payload: LanguageSelectReturnPayload = {
      phase: this.preStepPhase,
      showPreview: this.showPreview,
    };
    sessionStorage.setItem(LANGUAGE_SELECT_RETURN_CONTEXT, JSON.stringify(payload));
  }

  /** Opens `/signup-language` (welcome header or wizard language control). */
  openSignupLanguageEditor(): void {
    this.persistSignupLanguageReturn();
    void this.router.navigate(['/signup-language']);
  }

  /** Go back to `/role-select` so the user can switch between student/tutor. */
  changeRole(): void {
    void this.router.navigate(['/role-select']);
  }

  ngOnInit() {
    const restoreRaw = sessionStorage.getItem(ONBOARDING_AFTER_LANGUAGE_RESTORE);
    const hasRole = !!localStorage.getItem('selectedUserType');
    const langCompleted =
      sessionStorage.getItem(SIGNUP_INTERFACE_LANG_COMPLETED_KEY) === '1';

    if (!hasRole && !restoreRaw) {
      if (langCompleted) {
        void this.router.navigate(['/role-select'], { replaceUrl: true });
        return;
      }
      void this.router.navigate(['/signup-language'], { replaceUrl: true });
      return;
    }

    if (restoreRaw) {
      sessionStorage.removeItem(ONBOARDING_AFTER_LANGUAGE_RESTORE);
      try {
        const o = JSON.parse(restoreRaw) as LanguageSelectReturnPayload;
        this.preStepPhase = o.phase;
        this.showPreview = o.showPreview;
        this.selectedInterfaceLanguage = this.languageService.getCurrentLanguage();
        this.refreshLanguageToolbarFlag();
      } catch {
        /* ignore malformed restore */
      }
    }

    // Whenever we land on the welcome phase (fresh visit, reload, or signup-language
    // restore), schedule the reveal animation so the title/body fade in and the
    // lottie shrinks into place. Without this, a hard reload leaves the page stuck
    // in its pre-reveal hidden state.
    if (this.preStepPhase === 'welcome' && !this.showPreview && !this.showWelcome) {
      this.welcomeRevealed = false;
      setTimeout(() => this.revealWelcome(), 3800);
    }

    this.localeUiSub = this.languageService.currentLanguage$.subscribe(() => {
      this.bindLocaleSensitiveUi();
      this.cdr.markForCheck();
    });
    this.bindLocaleSensitiveUi();

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
          this.showError(this.translateService.instant('ONBOARDING.ALERTS.AUTH_FAILED'), true);
        }
      );
    });

    this.translateLangSub = this.translateService.onLangChange.subscribe(() => {
      this.refreshDatePickerLocale();
      this.bindPacingSuggestionLabels();
      this.bindLocaleSensitiveUi();
      if (this.showPreview) {
        this.computePreviewLabels();
      }
    });

    this.syncStudentWizardCopy();
    this.refreshDatePickerLocale();
  }

  private refreshDatePickerLocale(): void {
    this.datePickerLocale = translateLangToDatetimeLocale(this.translateService.currentLang);
  }

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
      iso: TEACHABLE_ENGLISH_NAME_TO_ISO639[v] ?? '',
      interfaceLabel: this.localeDisplay.languageName(
        TEACHABLE_ENGLISH_NAME_TO_ISO639[v] ?? 'en',
        ui
      ),
    }));

    this.tutorCountryDisplayLabel = this.tutorCountry
      ? this.localeDisplay.localizedCountryRow(
          this.tutorCountry,
          ui,
          this.flagService.getCountryCodeFromCountryName(this.tutorCountry),
          otherLbl
        )
      : '';
    this.refreshLanguageToolbarFlag();
  }

  /** Keeps header flag + code in sync with the currently active interface language. */
  private refreshLanguageToolbarFlag(): void {
    this.selectedInterfaceLanguage = this.languageService.getCurrentLanguage();
    const option = this.languageService.getLanguageOption(this.selectedInterfaceLanguage);
    this.selectedLanguageFlag = option?.flag ?? '🇬🇧';
    this.selectedLanguageEnglishName = option?.name ?? 'English';
  }

  ngAfterViewChecked() {
    const wizardActive =
      this.preStepPhase === 'done' && !this.showPreview && !this.showWelcome;
    if (!wizardActive) {
      return;
    }
    if (this.currentStep !== this.lastFocusedStep) {
      this.lastFocusedStep = this.currentStep;
      this.syncStudentWizardCopy();
      setTimeout(() => {
        this.focusFirstInput();
      }, 120);
    }
  }

  /** Keeps wizard header + progress bar in sync with `currentStep`. */
  private syncStudentWizardCopy(): void {
    switch (this.currentStep) {
      case 1:
        this.studentWizardTitleKey = 'ONBOARDING.STUDENT.STEP1_TITLE';
        this.studentWizardSubtitleKey = 'ONBOARDING.STUDENT.STEP1_SUBTITLE';
        break;
      case 2:
        this.studentWizardTitleKey = 'ONBOARDING.STUDENT.STEP2_TITLE';
        this.studentWizardSubtitleKey = 'ONBOARDING.STUDENT.STEP2_SUBTITLE';
        break;
      case 3:
        this.studentWizardTitleKey = 'ONBOARDING.STUDENT.STEP3_TITLE';
        this.studentWizardSubtitleKey = 'ONBOARDING.STUDENT.STEP3_SUBTITLE';
        break;
      case 4:
        this.studentWizardTitleKey = 'ONBOARDING.TUTOR_OB.STEP_SPOKEN_TITLE';
        this.studentWizardSubtitleKey = 'ONBOARDING.TUTOR_OB.STEP_SPOKEN_SUBTITLE';
        break;
      case 5:
        this.studentWizardTitleKey = 'ONBOARDING.TUTOR_OB.STEP_SPOKEN_LEVELS_TITLE';
        this.studentWizardSubtitleKey = 'ONBOARDING.TUTOR_OB.STEP_SPOKEN_LEVELS_SUBTITLE';
        break;
      case 6:
        this.studentWizardTitleKey = 'ONBOARDING.STUDENT.GOAL_WIZARD_TITLE';
        this.studentWizardSubtitleKey = 'ONBOARDING.STUDENT.GOAL_WIZARD_SUBTITLE';
        break;
      case 7:
        this.studentWizardTitleKey = 'ONBOARDING.STUDENT.LEVEL_WIZARD_TITLE';
        this.studentWizardSubtitleKey = 'ONBOARDING.STUDENT.LEVEL_WIZARD_SUBTITLE';
        break;
      case 8:
        this.studentWizardTitleKey = 'ONBOARDING.STUDENT.TIMELINE_WIZARD_TITLE';
        this.studentWizardSubtitleKey = 'ONBOARDING.STUDENT.TIMELINE_WIZARD_SUBTITLE';
        this.refreshPacingSuggestion();
        break;
      default:
        this.studentWizardTitleKey = 'ONBOARDING.STUDENT.STEP1_TITLE';
        this.studentWizardSubtitleKey = 'ONBOARDING.STUDENT.STEP1_SUBTITLE';
        break;
    }
    this.studentWizardProgressPercent =
      this.totalSteps > 0 ? (this.currentStep / this.totalSteps) * 100 : 0;
    this.studentWizardGuidanceItems = STUDENT_WIZARD_GUIDANCE[this.currentStep] ?? [];
  }

  private focusFirstInput() {
    switch (this.currentStep) {
      case 1:
        this.firstNameInput?.nativeElement?.focus();
        break;
      case 2:
        this.focusFirstInQueryList(this.wizardNativeChips);
        break;
      case 3:
        this.focusFirstInQueryList(this.wizardTeachableChips);
        break;
      case 4:
        this.focusFirstInQueryList(this.wizardSpokenLangChips);
        break;
      case 5:
        this.focusFirstInQueryList(this.wizardSpokenCefrChips);
        break;
      case 6:
        if (this.learningGoalType === 'other') {
          this.customGoalTextarea?.nativeElement?.focus();
        } else {
          this.focusFirstInQueryList(this.wizardGoalCards);
        }
        break;
      case 7:
        this.focusFirstInQueryList(this.wizardLevelCards);
        break;
      case 8:
        this.focusFirstInQueryList(this.wizardTimelineCards);
        break;
      default:
        break;
    }
  }

  private focusFirstInQueryList(list: QueryList<ElementRef<HTMLElement>> | undefined): void {
    const el = list?.first?.nativeElement;
    el?.focus();
  }

  private revealWelcome(): void {
    this.welcomeRevealed = true;
    this.cdr.detectChanges();
    // The CSS transition shrinks the lottie from 220px to 72px over 0.6s.
    // The dotlottie-player's ResizeObserver stops playback during that resize,
    // so we re-trigger play once the transition has settled.
    setTimeout(() => {
      const player = document.querySelector('.welcome-celebration-lottie') as any;
      player?.play?.();
    }, 750);
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
    const centerX = (r: DOMRect) => r.left + r.width / 2;

    const clone = document.createElement('div');
    clone.textContent = srcText;
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${centerX(srcRect)}px`,
      top: `${srcRect.top}px`,
      transform: 'translateX(-50%)',
      width: 'auto',
      height: `${srcRect.height}px`,
      textAlign: 'center',
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

      // Measure dest after one rAF so the wizard layout has had a chance to settle.
      requestAnimationFrame(() => {
        const destRect = dest.getBoundingClientRect();
        const destStyles = window.getComputedStyle(dest);
        const destText = dest.textContent?.trim() || '';

        clone.textContent = destText;
        clone.style.left = `${centerX(destRect)}px`;
        clone.style.top = `${destRect.top}px`;
        clone.style.transform = 'translateX(-50%)';
        clone.style.width = 'auto';
        clone.style.height = `${destRect.height}px`;
        clone.style.fontSize = destStyles.fontSize;

        // After the main 500ms flight: re-measure dest in case layout shifted
        // during flight (fonts/assets/flex centering settling), nudge the clone
        // to the exact final position, then crossfade clone → real h1.
        setTimeout(() => {
          const finalRect = dest.getBoundingClientRect();
          const finalLeft = centerX(finalRect);
          const finalTop = finalRect.top;
          const currentLeft = parseFloat(clone.style.left) || 0;
          const currentTop = parseFloat(clone.style.top) || 0;
          const drifted =
            Math.abs(finalLeft - currentLeft) > 0.5 ||
            Math.abs(finalTop - currentTop) > 0.5;

          const startCrossfade = () => {
            dest.style.transition = 'opacity 0.18s ease';
            dest.style.opacity = '1';
            clone.style.transition = 'opacity 0.18s ease';
            clone.style.opacity = '0';
            setTimeout(() => {
              if (clone.parentNode) clone.remove();
              dest.style.transition = '';
              dest.style.opacity = '';
            }, 200);
          };

          if (drifted) {
            clone.style.transition =
              'left 0.18s cubic-bezier(0.32, 0.72, 0, 1), top 0.18s cubic-bezier(0.32, 0.72, 0, 1)';
            clone.style.left = `${finalLeft}px`;
            clone.style.top = `${finalTop}px`;
            setTimeout(startCrossfade, 180);
          } else {
            startCrossfade();
          }
        }, 520);
      });
    };

    const destSelector = '.cm-details-wizard-header h1';
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
    if (this.currentStep === 1) {
      if (!this.firstName.trim() || !this.lastName.trim()) {
        alert(this.translateService.instant('ONBOARDING.ALERTS.NAME_REQUIRED'));
        return;
      }
    }

    if (this.currentStep < this.totalSteps) {
      this.currentStep++;
      // Skip CEFR level step if no spoken languages were selected
      if (this.currentStep === 5 && this.spokenLanguages.length === 0) {
        this.currentStep++;
      }
      // "Learn at my own pace" path: skip picking a framed goal on step 6
      if (this.currentStep === 6 && this.skipGoalSetup) {
        this.currentStep++;
      }
    }
  }

  previousStep() {
    if (this.currentStep === 1) {
      this.preStepPhase = 'welcome';
    } else {
      this.currentStep--;
      // Skip CEFR level step going back if no spoken languages were selected
      if (this.currentStep === 5 && this.spokenLanguages.length === 0) {
        this.currentStep--;
      }
    }
  }

  toggleLanguage(language: string) {
    if (this.selectedLanguages.includes(language)) {
      this.selectedLanguages = [];
    } else {
      this.selectedLanguages = [language];
      // Remove from spokenLanguages if the user now picks it as their learning language
      const iso = TEACHABLE_ENGLISH_NAME_TO_ISO639[language];
      if (iso) {
        this.spokenLanguages = this.spokenLanguages.filter(s => s.code !== iso);
      }
    }
  }

  setNativeLanguage(code: string) {
    this.nativeLanguage = code;
    // Clear selected learning language if it matches the new native language
    this.selectedLanguages = this.selectedLanguages.filter(
      lang => TEACHABLE_ENGLISH_NAME_TO_ISO639[lang] !== code
    );
    // Also remove from spoken languages if present
    this.spokenLanguages = this.spokenLanguages.filter(s => s.code !== code);
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

  setLearningGoalType(value: string) {
    this.learningGoalType = value;
    this.skipGoalSetup = false;
    this.refreshPacingSuggestion();
    if (value !== 'other') {
      this.learningGoalDescription = '';
      return;
    }
    this.cdr.detectChanges();
    requestAnimationFrame(() => {
      const panel = this.customGoalPanel?.nativeElement;
      if (panel) {
        this.smoothScrollPanelIntoWizardViewport(panel);
      }
      this.customGoalTextarea?.nativeElement?.focus({ preventScroll: true });
    });
  }

  /** Scrolls the nearest overflow parent so `panel` is visible; avoids focus() cancelling smooth scroll. */
  private smoothScrollPanelIntoWizardViewport(panel: HTMLElement): void {
    const scrollParent = this.findVerticalScrollParent(panel);
    const prefersReduced =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = prefersReduced ? 'auto' : 'smooth';

    if (scrollParent) {
      const cRect = scrollParent.getBoundingClientRect();
      const tRect = panel.getBoundingClientRect();
      const padding = 12;
      const nextTop = scrollParent.scrollTop + (tRect.top - cRect.top) - padding;
      scrollParent.scrollTo({ top: Math.max(0, nextTop), behavior });
      return;
    }

    panel.scrollIntoView({ behavior, block: 'start', inline: 'nearest' });
  }

  private findVerticalScrollParent(from: HTMLElement): HTMLElement | null {
    let el: HTMLElement | null = from.parentElement;
    while (el) {
      const { overflowY } = getComputedStyle(el);
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  /**
   * Second-path entry on the goal step: skip goal/level/timeline and create
   * an unframed plan after onboarding. Selecting an actual goal afterwards
   * unsets the flag (see setLearningGoalType).
   */
  chooseSkipGoalSetup() {
    this.skipGoalSetup = true;
    this.learningGoalType = '';
    this.learningGoalDescription = '';
    this.selfAssessedLevel = '';
    this.goalTimeline = '';
    this.goalTargetDate = '';
    this.pacingSuggestion = null;
    this.bindPacingSuggestionLabels();
  }

  setSelfAssessedLevel(value: string) {
    this.selfAssessedLevel = value;
  }

  setGoalTimeline(value: string) {
    this.goalTimeline = value;
    if (value !== 'specific_date') {
      this.goalTargetDate = '';
    }
    this.refreshPacingSuggestion();
  }

  onGoalTargetDateChange(rawValue?: unknown) {
    // ion-datetime can emit either a plain `YYYY-MM-DD` string or a full
    // ISO datetime. We normalize so `weeksToTarget` is deterministic, then
    // push the canonical date back into the model so downstream payloads
    // (and the preview row) read a single shape.
    const incoming = typeof rawValue === 'undefined' ? this.goalTargetDate : rawValue;
    const n = normalizeGoalTargetDate(incoming);
    if (n) {
      this.goalTargetDate = n;
    } else if (typeof rawValue === 'string') {
      this.goalTargetDate = rawValue;
    }
    this.refreshPacingSuggestion();
    this.cdr.detectChanges();
  }

  /**
   * Recompute `pacingSuggestion` from the current goal type + timeline +
   * target date. Called whenever any of those change. Surfaces a soft
   * "single lessons may serve you better" nudge for deadline-driven
   * goals that don't fit the chapter roadmap shape.
   */
  private refreshPacingSuggestion() {
    const goal = {
      type: this.learningGoalType,
      timeline: this.goalTimeline,
      targetDate: this.goalTargetDate,
    };
    if (computeRecommendedMode(goal) !== 'single_lessons') {
      this.pacingSuggestion = null;
      this.bindPacingSuggestionLabels();
      return;
    }
    const weeks = weeksToTarget(goal);
    this.pacingSuggestion = {
      weeks: weeks ?? 0,
      goalType: this.learningGoalType,
    };
    this.bindPacingSuggestionLabels();
  }

  /**
   * Resolves pacing-banner copy via `TranslateService.get` so strings appear
   * after locale JSON finishes loading (the `translate` pipe can otherwise
   * render raw keys on first paint).
   */
  private bindPacingSuggestionLabels(): void {
    this.pacingSuggestionI18nSub?.unsubscribe();
    this.pacingSuggestionI18nSub = null;
    if (!this.pacingSuggestion) {
      this.pacingSuggestionTitle = '';
      this.pacingSuggestionBody = '';
      this.pacingSuggestionAccept = '';
      this.pacingSuggestionDismiss = '';
      return;
    }
    const weeks = this.pacingSuggestion.weeks;
    const goalType = this.pacingSuggestion.goalType;
    const bodyKey =
      goalType === 'exam_prep'
        ? 'ONBOARDING.STUDENT.PACING_SUGGESTION_BODY_EXAM'
        : 'ONBOARDING.STUDENT.PACING_SUGGESTION_BODY';
    this.pacingSuggestionI18nSub = forkJoin({
      title: this.translateService.get('ONBOARDING.STUDENT.PACING_SUGGESTION_TITLE'),
      body: this.translateService.get(bodyKey, { weeks }),
      accept: this.translateService.get('ONBOARDING.STUDENT.PACING_SUGGESTION_ACCEPT'),
      dismiss: this.translateService.get('ONBOARDING.STUDENT.PACING_SUGGESTION_DISMISS'),
    }).subscribe((t) => {
      let bodyOut = t.body;
      if (goalType === 'exam_prep' && (bodyOut === bodyKey || !bodyOut)) {
        bodyOut = this.translateService.instant('ONBOARDING.STUDENT.PACING_SUGGESTION_BODY', { weeks });
      }
      this.pacingSuggestionTitle = t.title;
      this.pacingSuggestionBody = bodyOut;
      this.pacingSuggestionAccept = t.accept;
      this.pacingSuggestionDismiss = t.dismiss;
      this.cdr.detectChanges();
      this.scheduleScrollPacingSuggestionIntoView();
    });
  }

  /** After the banner mounts and copy is bound, smooth-scroll it into the wizard viewport. */
  private scheduleScrollPacingSuggestionIntoView(): void {
    setTimeout(() => {
      requestAnimationFrame(() => {
        const el = this.pacingSuggestionBanner?.nativeElement;
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      });
    }, 0);
  }

  /**
   * Student accepted the soft "use single lessons instead" suggestion.
   * Mirrors `chooseSkipGoalSetup` but keeps the structured fields the
   * student already filled in (goal type, level) cleared so the backend
   * creates a true unframed plan. Jumps straight to the preview page.
   */
  acceptPacingSuggestion() {
    this.skipGoalSetup = true;
    this.pacingSuggestion = null;
    this.bindPacingSuggestionLabels();
    this.showPreviewPage();
  }

  dismissPacingSuggestion() {
    this.pacingSuggestion = null;
    this.bindPacingSuggestionLabels();
  }

  // Precomputed labels for the preview page (no functions in templates)
  previewGoalLabel: string = '';
  previewLevelLabel: string = '';
  previewTimelineLabel: string = '';
  previewNativeLanguageName: string = '';
  previewSelectedLanguages: string = '';
  previewSpokenLanguages: { name: string; level: string }[] = [];

  private computePreviewLabels() {
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
    if (this.skipGoalSetup) {
      this.previewGoalLabel = this.translateService.instant('ONBOARDING.STUDENT.SKIP_GOAL_PREVIEW');
    } else if (this.learningGoalType === 'other') {
      this.previewGoalLabel =
        this.learningGoalDescription.trim() ||
        this.translateService.instant('LEARNING_PLAN.GOAL_LABEL_OTHER');
    } else {
      const goalI18n = this.learningGoalType
        ? this.learningGoalTypeToI18nKey[this.learningGoalType]
        : '';
      if (goalI18n) {
        const fromKey = this.translateService.instant(goalI18n);
        if (fromKey !== goalI18n) {
          this.previewGoalLabel = fromKey;
        } else {
          const goalOpt = this.goalTypeOptions.find(o => o.value === this.learningGoalType);
          if (goalOpt) {
            const fb = this.translateService.instant(goalOpt.labelKey);
            this.previewGoalLabel = fb !== goalOpt.labelKey ? fb : this.learningGoalType;
          } else {
            this.previewGoalLabel = this.learningGoalType;
          }
        }
      } else {
        const goalOpt = this.goalTypeOptions.find(o => o.value === this.learningGoalType);
        if (goalOpt) {
          const fb = this.translateService.instant(goalOpt.labelKey);
          this.previewGoalLabel = fb !== goalOpt.labelKey ? fb : this.learningGoalType;
        } else {
          this.previewGoalLabel = this.learningGoalType;
        }
      }
    }

    const levelTrimmed = this.selfAssessedLevel.trim();
    if (!levelTrimmed) {
      this.previewLevelLabel = this.translateService.instant('ONBOARDING.STUDENT.PREVIEW_LEVEL_NOT_SET');
    } else {
      const levelKey = `ONBOARDING.STUDENT.LEVEL_OPTION_${levelTrimmed.toUpperCase()}`;
      const fromKey = this.translateService.instant(levelKey);
      if (fromKey !== levelKey) {
        this.previewLevelLabel = fromKey;
      } else {
        const levelOpt = this.levelOptions.find(o => o.value === this.selfAssessedLevel);
        if (levelOpt) {
          const fb = this.translateService.instant(levelOpt.labelKey);
          this.previewLevelLabel = fb !== levelOpt.labelKey ? fb : this.selfAssessedLevel;
        } else {
          this.previewLevelLabel = this.selfAssessedLevel;
        }
      }
    }

    if (this.goalTimeline === 'specific_date') {
      const rawDate = normalizeGoalTargetDate(this.goalTargetDate as unknown);
      if (rawDate) {
        const [y, m, d] = rawDate.split('-').map(Number);
        const locale = this.translateService.currentLang || undefined;
        const formattedDate = new Date(y, m - 1, d).toLocaleDateString(locale, {
          month: 'long', day: 'numeric', year: 'numeric'
        });
        this.previewTimelineLabel = this.translateService.instant(
          'ONBOARDING.STUDENT.PREVIEW_TIMELINE_BY_DATE',
          { date: formattedDate }
        );
      } else {
        this.previewTimelineLabel = this.translateService.instant('ONBOARDING.STUDENT.PREVIEW_TIMELINE_NOT_SET');
      }
    } else if (!this.goalTimeline.trim()) {
      this.previewTimelineLabel = this.translateService.instant('ONBOARDING.STUDENT.PREVIEW_TIMELINE_NOT_SET');
    } else {
      const tlKey = `ONBOARDING.STUDENT.TIMELINE_OPTION_${this.goalTimeline.toUpperCase()}`;
      const fromKey = this.translateService.instant(tlKey);
      if (fromKey !== tlKey) {
        this.previewTimelineLabel = fromKey;
      } else {
        const tlOpt = this.timelineOptions.find(o => o.value === this.goalTimeline);
        if (tlOpt) {
          const fb = this.translateService.instant(tlOpt.labelKey);
          this.previewTimelineLabel =
            fb !== tlOpt.labelKey
              ? fb
              : this.translateService.instant('ONBOARDING.STUDENT.PREVIEW_TIMELINE_NOT_SET');
        } else {
          this.previewTimelineLabel = this.translateService.instant('ONBOARDING.STUDENT.PREVIEW_TIMELINE_NOT_SET');
        }
      }
    }

    const firstInitial = (this.firstName?.trim().charAt(0) || '').toUpperCase();
    const lastInitial = (this.lastName?.trim().charAt(0) || '').toUpperCase();
    this.previewProfileInitials = (firstInitial + lastInitial) || '?';
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
      this.bindLocaleSensitiveUi();
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
    this.tutorHourlyRate = Math.max(10, rate);
  }

  // Helper method to check if user is a tutor (from localStorage)
  isTutorOnboarding(): boolean {
    return localStorage.getItem('selectedUserType') === 'tutor';
  }

  showPreviewPage() {
    this.computePreviewLabels();
    this.showPreview = true;
    this.hasReachedPreview = true;
    // Scroll to top when preview page is shown
    setTimeout(() => {
      const scrollEl = document.querySelector('.preview-wizard-scroll');
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
      this.lastFocusedStep = 0;
      if (step === 4) {
        this.skipGoalSetup = false;
      }
      if (step === 4 || step === 6) {
        this.refreshPacingSuggestion();
      }
    }
    this.syncStudentWizardCopy();
  }

  getNativeLanguageName(): string {
    const lang = this.nativeLanguageOptions.find((l) => l.code === this.nativeLanguage);
    if (!lang) return this.nativeLanguage;
    return lang.interfaceLabel || this.nativeLanguage;
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
        // Map self-assessed level to legacy experienceLevel for backward compat
        const legacyLevel = this.selfAssessedLevel === 'complete_beginner' || this.selfAssessedLevel === 'some_basics'
          ? 'Beginner'
          : this.selfAssessedLevel === 'intermediate' || this.selfAssessedLevel === 'simple_conversations'
            ? 'Intermediate'
            : this.selfAssessedLevel === 'advanced' ? 'Advanced' : 'Beginner';

        // Student onboarding
        const onboardingData: OnboardingData & { userType: string; picture?: string; nativeLanguage?: string; interfaceLanguage?: string; learningGoal?: any; skipGoalSetup?: boolean; spokenLanguages?: { code: string; level: string }[] } = {
          userType: 'student',
          firstName: this.formatName(this.firstName),
          lastName: this.formatName(this.lastName),
          nativeLanguage: this.nativeLanguage,
          interfaceLanguage: this.selectedInterfaceLanguage,
          languages: this.selectedLanguages,
          goals: this.learningGoals.length > 0 ? this.learningGoals : (this.learningGoalType ? [this.learningGoalType] : []),
          experienceLevel: legacyLevel,
          preferredSchedule: this.preferredSchedule || 'Flexible schedule',
          picture: auth0User.picture,
          spokenLanguages: this.spokenLanguages.filter(s => s.code && s.level)
        };
        if (this.skipGoalSetup) {
          // Signal "learn at my own pace" — backend creates an unframed plan
          // for each selected language post-onboarding. Still forward any
          // level / timeline / target-date the student filled in so the
          // backend can keep that context (useful for tutor matching and
          // for upgrading to a structured plan later).
          onboardingData.skipGoalSetup = true;
          onboardingData.learningGoal = {
            type: '',
            description: '',
            targetLevel: '',
            selfAssessedLevel: this.selfAssessedLevel,
            timeline: this.goalTimeline,
            targetDate: this.goalTimeline === 'specific_date' && this.goalTargetDate ? this.goalTargetDate : null
          };
        } else {
          onboardingData.learningGoal = {
            type: this.learningGoalType,
            description: this.learningGoalDescription,
            targetLevel: '',
            selfAssessedLevel: this.selfAssessedLevel,
            timeline: this.goalTimeline,
            targetDate: this.goalTimeline === 'specific_date' && this.goalTargetDate ? this.goalTargetDate : null
          };
        }

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

      this.showWelcome = true;
    } catch (error: any) {
      console.error('❌ Error completing onboarding:', error);
      this.isSubmitting = false;
      
      // Determine error message
      let errorMessage = this.translateService.instant('ONBOARDING.ALERTS.SETUP_FAILED');
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

  canProceed(): boolean {
    switch (this.currentStep) {
      case 1:
        return this.firstName.trim() !== '' && this.lastName.trim() !== '';
      case 2:
        return this.nativeLanguage !== '';
      case 3:
        return this.selectedLanguages.length > 0;
      case 4:
        return true; // Spoken languages are optional
      case 5:
        return this.spokenLanguages.every(s => s.level !== '');
      case 6:
        if (this.skipGoalSetup) return true;
        if (!this.learningGoalType) return false;
        if (this.learningGoalType === 'other' && !this.learningGoalDescription.trim()) return false;
        return true;
      case 7:
        return this.skipGoalSetup || this.selfAssessedLevel !== '';
      case 8:
        return this.skipGoalSetup || this.goalTimeline !== '';
      default:
        return false;
    }
  }

  /**
   * True only when every required field across all student steps is filled.
   * Used on the review page to gate the Complete Setup button.
   */
  get studentProfileComplete(): boolean {
    const nameOk = this.firstName.trim() !== '' && this.lastName.trim() !== '';
    const nativeLangOk = this.nativeLanguage !== '';
    const learnLangOk = this.selectedLanguages.length > 0;
    const goalOk = this.skipGoalSetup ||
      (!!this.learningGoalType &&
        (this.learningGoalType !== 'other' || this.learningGoalDescription.trim() !== '') &&
        this.selfAssessedLevel !== '' &&
        this.goalTimeline !== '');
    return nameOk && nativeLangOk && learnLangOk && goalOk;
  }

  get studentChecklistAboutDone(): boolean {
    return (
      this.firstName.trim() !== '' &&
      this.lastName.trim() !== '' &&
      this.nativeLanguage !== ''
    );
  }

  get studentChecklistLearningDone(): boolean {
    return this.selectedLanguages.length > 0;
  }

  get studentChecklistGoalsDone(): boolean {
    return (
      this.skipGoalSetup ||
      (!!this.learningGoalType &&
        (this.learningGoalType !== 'other' || this.learningGoalDescription.trim() !== '') &&
        this.selfAssessedLevel !== '' &&
        this.goalTimeline !== '')
    );
  }

  get studentPreviewProgressPercent(): number {
    const done = [
      this.studentChecklistAboutDone,
      this.studentChecklistLearningDone,
      this.studentChecklistGoalsDone,
    ].filter(Boolean).length;
    return Math.round((done / 3) * 100);
  }

  get studentPreviewProgressOffset(): number {
    return 97.4 - (97.4 * this.studentPreviewProgressPercent) / 100;
  }

  navigateToHome() {
    // Signal to the home page that the student just finished onboarding so
    // the journey intro modal fires exactly once on their first landing.
    // Skipped for unframed students — there's no roadmap to introduce.
    if (!this.skipGoalSetup) {
      try { sessionStorage.setItem('showJourneyIntro', 'true'); } catch (_) {}
    }

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
