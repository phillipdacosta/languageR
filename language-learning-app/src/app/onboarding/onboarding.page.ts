import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, ChangeDetectorRef } from '@angular/core';
import '@dotlottie/player-component';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserService, OnboardingData, TutorOnboardingData, User } from '../services/user.service';
import { LanguageService, LanguageOption, SupportedLanguage } from '../services/language.service';
import { TranslateService } from '@ngx-translate/core';
import { OnboardingGuard } from '../guards/onboarding.guard';
import { Observable, Subscription, forkJoin } from 'rxjs';
import { take, timeout, retry, catchError, filter } from 'rxjs/operators';
import { LoadingController, AlertController, ModalController } from '@ionic/angular';
import { CountrySelectModalComponent } from '../components/country-select-modal/country-select-modal.component';
import { LoadingService } from '../services/loading.service';
import {
  recommendedMode as computeRecommendedMode,
  weeksToTarget,
  normalizeGoalTargetDate,
} from '../shared/goal-pace.helper';
import { translateLangToDatetimeLocale } from '../shared/datetime-locale.helper';

export type OnboardingNativeLangChip = { code: string; name: string; native: string; nameKey?: string };
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
  user$: Observable<any>;
  currentStep = 1;
  totalSteps = 6; // Students: Name + Native Language + Languages + Goal + Level + Timeline
  currentUser: User | null = null;

  /** Translation keys for focused wizard header (template uses translate pipe — no getters). */
  studentWizardTitleKey = 'ONBOARDING.STUDENT.STEP1_TITLE';
  studentWizardSubtitleKey = 'ONBOARDING.STUDENT.STEP1_SUBTITLE';
  studentWizardProgressPercent = 0;

  // Language selection pre-step
  preStepPhase: 'language' | 'welcome' | 'done' = 'language';
  private preLanguageReturn: { phase: 'welcome' | 'done'; showPreview: boolean } = { phase: 'welcome', showPreview: false };
  welcomeRevealed: boolean = false;
  availableInterfaceLanguages: LanguageOption[] = [];
  selectedInterfaceLanguage: SupportedLanguage = 'en';
  selectedLanguageFlag = '🇬🇧';
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
  /** Cancels in-flight pacing-banner i18n when goal/date changes or component destroys. */
  private pacingSuggestionI18nSub: Subscription | null = null;
  /** Re-binds pacing banner copy when the interface language changes. */
  private translateLangSub: Subscription | null = null;
  /** Delay before applying `setLanguage` after a tap (avoids instant full-page language flicker). */
  private languageApplyDebounce: ReturnType<typeof setTimeout> | null = null;
  private static readonly LANGUAGE_APPLY_DEBOUNCE_MS = 800;

  // Preview & Welcome state
  showPreview = false;
  showWelcome = false;
  isSubmitting = false;
  hasReachedPreview = false;

  // ViewChild references for autofocus
  @ViewChild('firstNameInput') firstNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('customGoalPanel') customGoalPanel?: ElementRef<HTMLElement>;
  @ViewChild('customGoalTextarea') customGoalTextarea?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('pacingSuggestionBanner') pacingSuggestionBanner?: ElementRef<HTMLElement>;
  
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

  private static readonly NATIVE_LANG_EN_SLUG: Readonly<Record<string, string>> = {
    en: 'ENGLISH',
    es: 'SPANISH',
    fr: 'FRENCH',
    de: 'GERMAN',
    it: 'ITALIAN',
    pt: 'PORTUGUESE',
    ru: 'RUSSIAN',
    zh: 'CHINESE',
    ja: 'JAPANESE',
    ko: 'KOREAN',
    ar: 'ARABIC',
    hi: 'HINDI',
    nl: 'DUTCH',
    pl: 'POLISH',
    tr: 'TURKISH',
    sv: 'SWEDISH',
    no: 'NORWEGIAN',
    da: 'DANISH',
    fi: 'FINNISH',
    el: 'GREEK',
    cs: 'CZECH',
    ro: 'ROMANIAN',
    uk: 'UKRAINIAN',
    vi: 'VIETNAMESE',
    th: 'THAI',
    id: 'INDONESIAN',
    ms: 'MALAY',
    he: 'HEBREW',
    fa: 'PERSIAN',
  };

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

  learnableLanguages: { value: string; nameKey: string }[] = (
    [
      'English',
      'Spanish',
      'French',
      'German',
      'Italian',
      'Portuguese',
      'Russian',
      'Chinese',
      'Japanese',
      'Korean',
      'Arabic',
      'Hindi',
      'Dutch',
      'Polish',
      'Turkish',
      'Swedish',
      'Norwegian',
      'Danish',
      'Finnish',
      'Greek',
      'Czech',
      'Romanian',
      'Ukrainian',
      'Vietnamese',
      'Thai',
      'Indonesian',
      'Malay',
      'Hebrew',
      'Persian',
    ] as const
  ).map((value) => ({
    value,
    nameKey: `ONBOARDING.LANG_EN_NAME.${String(value).replace(/ /g, '_').toUpperCase()}`,
  }));

  // Native language options with ISO codes
  nativeLanguageOptions: OnboardingNativeLangChip[] = [
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
    private translateService: TranslateService,
    private loadingService: LoadingService
  ) {
    this.user$ = this.authService.user$;
    this.availableInterfaceLanguages = this.languageService.supportedLanguages;
    this.selectedInterfaceLanguage = this.languageService.getCurrentLanguage();
    this.refreshPublicLegalLinks();
  }

  ngOnDestroy() {
    this.clearLanguageApplyDebounce();
    this.headingRotationLoadSub?.unsubscribe();
    this.headingRotationLoadSub = null;
    this.pacingSuggestionI18nSub?.unsubscribe();
    this.pacingSuggestionI18nSub = null;
    this.translateLangSub?.unsubscribe();
    this.translateLangSub = null;
    this.cancelHeadingRotationSchedule();
    this.stopHeadingRotation();
  }

  private clearLanguageApplyDebounce(): void {
    if (this.languageApplyDebounce != null) {
      clearTimeout(this.languageApplyDebounce);
      this.languageApplyDebounce = null;
    }
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
    }, OnboardingPage.LANGUAGE_APPLY_DEBOUNCE_MS);
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
    this.nativeLanguageOptions = this.nativeLanguageOptions.map((l) => ({
      ...l,
      nameKey: `ONBOARDING.LANG_EN_NAME.${OnboardingPage.NATIVE_LANG_EN_SLUG[l.code] ?? l.code.toUpperCase()}`,
    }));
    this.scheduleHeadingRotationAfterLoad();

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

  ngAfterViewChecked() {
    if (this.currentStep !== this.lastFocusedStep) {
      this.lastFocusedStep = this.currentStep;
      this.syncStudentWizardCopy();
      setTimeout(() => {
        this.focusFirstInput();
      }, 100);
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
        this.studentWizardTitleKey = 'ONBOARDING.STUDENT.GOAL_WIZARD_TITLE';
        this.studentWizardSubtitleKey = 'ONBOARDING.STUDENT.GOAL_WIZARD_SUBTITLE';
        break;
      case 5:
        this.studentWizardTitleKey = 'ONBOARDING.STUDENT.LEVEL_WIZARD_TITLE';
        this.studentWizardSubtitleKey = 'ONBOARDING.STUDENT.LEVEL_WIZARD_SUBTITLE';
        break;
      case 6:
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
  }

  private focusFirstInput() {
    if (this.currentStep === 1 && this.firstNameInput?.nativeElement) {
      this.firstNameInput.nativeElement.focus();
    }
  }

  selectInterfaceLanguage(lang: SupportedLanguage) {
    this.selectedInterfaceLanguage = lang;
    this.selectedLanguageFlag = this.languageService.getLanguageOption(lang)?.flag || '🇬🇧';
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
      setTimeout(() => { this.welcomeRevealed = true; this.cdr.detectChanges(); }, 3800);
    }
  }

  goBackToLanguageSelect() {
    this.preStepPhase = 'language';
    this.welcomeRevealed = false;
    this.refreshPublicLegalLinks();
    this.scheduleHeadingRotationAfterLoad();
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
      const destRect = dest.getBoundingClientRect();
      const destStyles = window.getComputedStyle(dest);
      const destText = dest.textContent?.trim() || '';

      requestAnimationFrame(() => {
        clone.textContent = destText;
        clone.style.left = `${centerX(destRect)}px`;
        clone.style.top = `${destRect.top}px`;
        clone.style.transform = 'translateX(-50%)';
        clone.style.width = 'auto';
        clone.style.height = `${destRect.height}px`;
        clone.style.fontSize = destStyles.fontSize;
      });

      setTimeout(() => {
        const finalRect = dest.getBoundingClientRect();
        clone.style.transition = 'none';
        clone.style.left = `${centerX(finalRect)}px`;
        clone.style.top = `${finalRect.top}px`;
        clone.style.transform = 'translateX(-50%)';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            dest.style.opacity = '1';
            if (clone.parentNode) clone.remove();
            setTimeout(() => { dest.style.transition = ''; dest.style.opacity = ''; }, 50);
          });
        });
      }, 550);
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

    // "Learn at my own pace" path: skip picking a framed goal on step 4, but still
    // show level (5) and timeline (6) before review. Preview/Done stay on step 6.
    if (this.currentStep === 4 && this.skipGoalSetup) {
      this.currentStep = 5;
      return;
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
    this.preLanguageReturn = {
      phase: this.preStepPhase as 'welcome' | 'done',
      showPreview: this.showPreview,
    };
    this.showPreview = false;
    this.preStepPhase = 'language';
    this.scheduleHeadingRotationAfterLoad();
  }

  toggleLanguage(language: string) {
    if (this.selectedLanguages.includes(language)) {
      this.selectedLanguages = [];
    } else {
      this.selectedLanguages = [language];
    }
  }

  setNativeLanguage(code: string) {
    this.nativeLanguage = code;
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

  private computePreviewLabels() {
    const nativeLang = this.nativeLanguageOptions.find(l => l.code === this.nativeLanguage) as
      | { code: string; name: string; native: string; nameKey?: string }
      | undefined;
    if (nativeLang?.nameKey) {
      const t = this.translateService.instant(nativeLang.nameKey);
      this.previewNativeLanguageName = t !== nativeLang.nameKey ? t : nativeLang.name;
    } else {
      this.previewNativeLanguageName = nativeLang ? nativeLang.name : this.nativeLanguage;
    }
    this.previewSelectedLanguages = this.selectedLanguages
      .map((lang) => {
        const k = `ONBOARDING.LANG_EN_NAME.${lang.replace(/ /g, '_').toUpperCase()}`;
        const t = this.translateService.instant(k);
        return t !== k ? t : lang;
      })
      .join(', ');
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
      this.lastFocusedStep = step;
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
    const lang = this.nativeLanguageOptions.find(l => l.code === this.nativeLanguage) as
      | { code: string; name: string; nameKey?: string }
      | undefined;
    if (!lang) return this.nativeLanguage;
    if (lang.nameKey) {
      const t = this.translateService.instant(lang.nameKey);
      return t !== lang.nameKey ? t : lang.name;
    }
    return lang.name;
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
        const onboardingData: OnboardingData & { userType: string; picture?: string; nativeLanguage?: string; interfaceLanguage?: string; learningGoal?: any; skipGoalSetup?: boolean } = {
          userType: 'student',
          firstName: this.formatName(this.firstName),
          lastName: this.formatName(this.lastName),
          nativeLanguage: this.nativeLanguage,
          interfaceLanguage: this.selectedInterfaceLanguage,
          languages: this.selectedLanguages,
          goals: this.learningGoals.length > 0 ? this.learningGoals : (this.learningGoalType ? [this.learningGoalType] : []),
          experienceLevel: legacyLevel,
          preferredSchedule: this.preferredSchedule || 'Flexible schedule',
          picture: auth0User.picture
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
        if (this.skipGoalSetup) return true;
        if (!this.learningGoalType) return false;
        if (this.learningGoalType === 'other' && !this.learningGoalDescription.trim()) return false;
        return true;
      case 5:
        return this.skipGoalSetup || this.selfAssessedLevel !== '';
      case 6:
        return this.skipGoalSetup || this.goalTimeline !== '';
      default:
        return false;
    }
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
