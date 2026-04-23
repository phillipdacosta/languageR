import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy, NgZone, ViewChild, AfterViewInit, HostBinding } from '@angular/core';
import { trigger, transition, style, animate } from '@angular/animations';
import { ModalController, LoadingController, ToastController, ActionSheetController, PopoverController, AlertController, ViewDidLeave, NavController, IonContent } from '@ionic/angular';
import { Router, NavigationStart, NavigationEnd, ActivatedRoute } from '@angular/router';
import { PlatformService } from '../services/platform.service';
import { AuthService } from '../services/auth.service';
import { UserService, User } from '../services/user.service';
import { WalletService } from '../services/wallet.service';
import { Observable, takeUntil, take, filter, firstValueFrom, observeOn, asyncScheduler, forkJoin, of, catchError } from 'rxjs';
import { Subject, Subscription } from 'rxjs';
import { LessonService, Lesson } from '../services/lesson.service';
import { ClassService, ClassInvitation } from '../services/class.service';
import { ClassInvitationModalComponent } from '../components/class-invitation-modal/class-invitation-modal.component';
import { ClassMenuPopoverComponent } from '../components/class-menu-popover/class-menu-popover.component';
import { AgoraService } from '../services/agora.service';
import { WebSocketService } from '../services/websocket.service';
import { NotificationService } from '../services/notification.service';
import { MessagingService } from '../services/messaging.service';
import { ReminderService } from '../services/reminder.service';
import { ConfirmActionModalComponent } from '../components/confirm-action-modal/confirm-action-modal.component';
import { CancelReasonModalComponent } from '../components/cancel-reason-modal/cancel-reason-modal.component';
import { InviteStudentModalComponent } from '../components/invite-student-modal/invite-student-modal.component';
import { RescheduleLessonModalComponent } from '../components/reschedule-lesson-modal/reschedule-lesson-modal.component';
import { RescheduleProposalModalComponent } from '../components/reschedule-proposal-modal/reschedule-proposal-modal.component';
import { LessonSummaryComponent } from '../modals/lesson-summary/lesson-summary.component';
import { formatTimeInTz, formatDateInTz } from '../shared/timezone.utils';
import { NotesModalComponent } from '../components/notes-modal/notes-modal.component';
import { TutorAvailabilityViewerComponent } from '../components/tutor-availability-viewer/tutor-availability-viewer.component';
import { TutorNoteModalComponent } from '../components/tutor-note-modal/tutor-note-modal.component';
import { SmartIslandComponent, IslandPriority } from '../components/smart-island/smart-island.component';
import { FlagService } from '../services/flag.service';
import { TutorFeedbackService, PendingFeedbackItem } from '../services/tutor-feedback.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { SmartIslandService, DynamicCard } from '../services/smart-island.service';
import { TranslateService } from '@ngx-translate/core';
import { LearningPlanService, LearningPlan } from '../services/learning-plan.service';
import { AnalysisTranslationService } from '../services/analysis-translation.service';
import { HomeInlineToolbarService } from '../services/home-inline-toolbar.service';
import { MaterialService, TutorMaterial } from '../services/material.service';
import { TutorGrowthService, GrowthInsight, GrowthContext } from '../services/tutor-growth.service';
import { ScheduleClassPage } from '../tutor-calendar/schedule-class/schedule-class.page';
import { MOCK_CLASS_ATTENDEES_PREVIEW } from '../constants/mock-class-attendees-preview';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.98)' }),
        animate('400ms 100ms cubic-bezier(0.25, 0.46, 0.45, 0.94)', style({ opacity: 1, transform: 'scale(1)' }))
      ]),
      transition(':leave', [
        animate('200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)', style({ opacity: 0, transform: 'scale(0.98)' }))
      ])
    ]),
    trigger('buttonTextFade', [
      transition('* => *', [
        style({ opacity: 0 }),
        animate('300ms ease-in-out', style({ opacity: 1 }))
      ])
    ]),
    trigger('earningsSlide', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(60px)' }),
        animate('380ms cubic-bezier(0.32, 0.72, 0, 1)', style({ opacity: 1, transform: 'translateX(0)' }))
      ]),
      transition(':leave', [
        animate('280ms cubic-bezier(0.32, 0.72, 0, 1)', style({ opacity: 0, transform: 'translateX(60px)' }))
      ])
    ]),
    trigger('lessonRowEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(8px) scale(0.98)' }),
        animate('300ms cubic-bezier(0.32, 0.72, 0, 1)', style({ opacity: 1, transform: 'translateY(0) scale(1)' }))
      ])
    ]),
    trigger('dateSectionEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-4px)' }),
        animate('250ms cubic-bezier(0.32, 0.72, 0, 1)', style({ opacity: 1, transform: 'translateY(0)' }))
      ])
    ])
  ]
})
export class Tab1Page implements OnInit, AfterViewInit, OnDestroy, ViewDidLeave {
  @ViewChild(IonContent) ionContent!: IonContent;
  @ViewChild('smartIsland') smartIsland!: SmartIslandComponent;
  @ViewChild('earningsComponent') earningsComponent: any;
  @ViewChild('createMaterialRef') createMaterialRef: any;
  @ViewChild('scheduleClassModalRef') scheduleClassModalRef?: ScheduleClassPage;
  
  // Platform detection properties
  private destroy$ = new Subject<void>();

  currentPlatform = 'unknown';
  platformConfig: any = {};
  isWeb = false;
  isMobile = false;
  createMaterialModalExpanded = false;
  createMaterialModalReady = false;
  createMaterialBackdropVisible = false;
  /** Desktop: material/bundle detail rendered via router-outlet inside the materials modal. */
  cmModalRouterOutletActive = false;
  modalSidebarTab: 'materials' | 'bundles' = 'materials';
  modalShowFooter = true;
  modalShowSaveExit = true;
  modalIsEditingBundle = false;
  modalIsEditingMaterial = false;
  /** Desktop create-material modal topbar: "3/9" style count (centered with Save and exit). */
  modalTopbarCenterStep: string | null = null;
  /** From create-material `syncModalTopbarChrome` — material mid-steps + bundle share exit. */
  modalTopbarNavBackLabel = '';
  /** From create-material — previous bundle wizard step title. */
  modalTopbarBundleWizardBackLabel = '';
  modalShowGoBack = false;
  /** Bundle wizard step "How would you like to share this?" — same top bar as list `< Go back`. */
  modalShowBundleShareGoBack = false;
  /** Desktop bundle wizard (after share step): Go back in modal top bar */
  modalShowBundleWizardGoBack = false;
  modalDetailsWizardFooter = false;
  modalDetailsWizardShowBack = false;
  modalDetailsWizardShowSaveDraft = false;
  /** ngx-translate key from create-material (e.g. SAVE_DRAFT or COMMON.SAVE). */
  modalFooterSaveLabelKey: string | null = null;
  modalDetailsWizardIsLastStep = false;
  /** When set (e.g. bundle publish), overrides "Continue to Quiz" on last wizard step. */
  modalDetailsWizardLastStepKey: string | null = null;
  /** Footer Back text (previous step title), from create-material. */
  modalFooterBackLabel: string | null = null;
  /** Web at ≤600px: use same tutor empty / Up Next UI as native mobile */
  isNarrowTutorHomeViewport = false;
  isDarkModeActive = false;
  currentUser: User | null = null;
  private get userTz(): string | undefined { return this.currentUser?.profile?.timezone || undefined; }
  lessons: Lesson[] = [];
  cancelledLessons: Lesson[] = [];
  pastLessons: Lesson[] = [];
  pastTutors: Array<{ id: string; name: string; picture?: string }> = [];
  pendingClassInvitations: ClassInvitation[] = [];
  isLoadingLessons = true;
  private _isLoadingInProgress = false; // Prevent double-loading
  isLoadingInvitations = false;
  hasAvailability = false;
  
  // Cached button text animation trigger — updated when hasAvailability changes
  buttonTextState = 'add';
  
  // Wallet balance
  currentWalletBalance = 0;

  // Stripe Connect status (for tutors)
  stripeConnectOnboarded = false;
  isLoadingStripeConnect = false;

  // Tutor earnings
  tutorTotalEarnings = 0;
  tutorPendingEarnings = 0;
  earningsBalanceLoading = true; // true until first loadTutorEarnings() completes
  private _earningsVisibilityHandler: (() => void) | null = null;
  private _lastEarningsVisibilityRefresh = 0;

  // ─── Desktop earnings widget: weekly goal progress (tutor-only) ───
  /** Sum of `price` for completed lessons this week (Sun–Sat) where current user is tutor. */
  weeklyEarningsCompleted = 0;
  /** Sum of `price` for scheduled/confirmed/in_progress lessons this week. */
  weeklyEarningsScheduled = 0;
  /** Count of scheduled lessons this week — used in non-$ copy ("3 lessons scheduled"). */
  weeklyScheduledLessonCount = 0;
  /** User-configurable target; persisted per-user in localStorage. */
  weeklyEarningsGoal = 500;
  /** 0–100, for the solid (earned) fill. */
  weeklyEarningsGoalPercent = 0;
  /** 0–100, for the ghost overlay (earned + scheduled). */
  weeklyEarningsScheduledPercent = 0;
  /** Pre-formatted amount label, e.g. "$340 of $500 goal". */
  weeklyEarningsGoalLabel = '';
  /** Secondary context line: empty-state / daily target / reached copy. */
  weeklyEarningsGoalSubLabel = '';
  /** True when current total ≥ goal — used to switch the bar to a "success" state. */
  isWeeklyGoalReached = false;
  /** True when wallet balance is masked (respect same privacy rule as Total Balance). */
  isWeeklyGoalMasked = false;
  /** True when inline "Set goal" input is open. */
  isEditingWeeklyGoal = false;
  /** Bound to the inline edit input; reset on cancel. */
  weeklyGoalEditValue: number = 500;

  // Inline earnings view toggle
  showEarningsView = false;
  returningFromEarnings = false;
  quickActionsAnimated = false;
  quickActionsReady = false;
  /** Mobile Up Next card: animate after quick actions (scale settle-in). */
  upNextCardReady = false;
  upNextCardAnimated = false;
  mobileStaggerReady = false;
  mobileStaggerDone = false;
  private _earningsOpenedFromOtherTab = false;
  @HostBinding('class.returning-from-inline') returningFromInline = false;
  @HostBinding('class.skip-tab-entry-animations') skipTabEntryAnimations = false;

  // Inline explore view toggle
  showExploreView = false;
  returningFromExplore = false;
  private _savedScrollBeforeExplore = 0;

  // Inline create-material view toggle
  showCreateMaterialView = false;
  private _savedScrollBeforeMaterial = 0;
  private _scrollElRef: HTMLElement | null = null;

  /** Tutor: schedule class in modal (desktop) or full-width panel (mobile), like Create Material */
  showScheduleClassView = false;
  private _savedScrollBeforeSchedule = 0;
  scheduleClassBackdropVisible = false;
  scheduleClassModalReady = false;

  /** Forum: same shell as My Classes / Create Material quick actions */
  showForumView = false;
  private _savedScrollBeforeForum = 0;
  forumBackdropVisible = false;
  forumModalReady = false;

  // Cached count of active (non-cancelled) invitations — updated when pendingClassInvitations changes
  activeInvitationsCount = 0;
  
  // Smart caching to prevent unnecessary skeleton loaders
  private _hasInitiallyLoaded = false;
  private _lastDataFetch = 0;
  private _cacheValidityMs = 30000; // 30 seconds
  private _lastDynamicCardRefresh = 0; // Track last dynamic card refresh
  private readonly DYNAMIC_CARD_REFRESH_INTERVAL = 2 * 60 * 1000; // 2 minutes
  private _dynamicCardRefreshInterval: any = null; // Interval for periodic card refresh while on page
  availabilityBlocks: any[] = [];
  availabilityHeadline = '';
  availabilityDetail = '';
  isSelectedDatePast = false;
  
  // UI state
  hasNotifications = false;
  unreadNotificationCount = 0;
  
  // Cached avatar cache for student/tutor avatars
  private _avatarCache = new Map<string, string | null>();
  
  // Cached lesson counts per tutor-student pair (key: "tutorId_studentId")
  private _lessonCountCache = new Map<string, number>();
  
  // Dynamic Smart Island card
  dynamicCard: DynamicCard | null = null;
  dynamicCardAnimationState = 0; // Used to trigger animations on card change
  dynamicCardReady = false; // Track if card system is initialized
  dynamicCardsLoaded = false; // Track if cards have been loaded to prevent re-initialization
  
  // Up Next card properties (cached — updated when nextLesson changes)
  nextLessonTutor: any = null;
  upNextFormattedPrice = '';
  upNextLevelLabel = '';
  /** Class Up Next: real or preview attendees for `app-class-attendees` (never overwrites API data). */
  nextLessonClassAttendeesDisplay: any[] = [];
  
  // Tutor date strip and upcoming lesson
  dateStrip: { label: string; dayNum: number; date: Date; isToday: boolean }[] = [];
  selectedDate: Date | null = null;
  weekStartDate: Date = new Date();
  weekRangeLabel = '';
  upcomingLesson: Lesson | null = null;
  private countdownInterval: any;
  countdownTick = Date.now();
  nextLessonTimeLabel = ''; // Cached next lesson time label for template (avoids function calls in template)
  /** Mobile This Week: empty-state text (context-aware). */
  thisWeekMobileShowNothingYet = false;
  thisWeekEmptyLabel = '';
  /** Mobile This Week: deduplicated student avatars + total lesson count for current week. */
  thisWeekAvatars: { name: string; avatar: string | null; lessonCount: number }[] = [];
  thisWeekLessonCount = 0;
  thisWeekSingleLesson: any = null;

  /** Mobile tutor: greeting line (same as desktop welcome title). */
  tutorMobileWelcomeTitle = '';
  /** Mobile tutor: welcome subtitle when no next-lesson line (getWelcomeMessage). */
  tutorMobileWelcomeSubtitle = '';
  /** Mobile home hero (≤600px): large headline only; greeting lives in tabs toolbar. */
  mobileHeroHeadline = '';
  emptyStateTitle = '';
  emptyStateMessage = '';
  /** Mobile tutor Up Next: hero image URL (class thumbnail or student photo); empty → gradient fallback */
  tutorMobileUpNextCoverUrl: string | null = null;
  hadLessonsToday = false;
  hadOnlyCancelledLessonsToday = false;
  
  // Message rotation system - cached on init, changes on page refresh
  private greetingIndex = Math.floor(Math.random() * 6);
  private welcomeMessageIndex = Math.floor(Math.random() * 6);
  private emptyStateTitleIndex = Math.floor(Math.random() * 6);
  private emptyStateMessageIndex = Math.floor(Math.random() * 6);
  
  private statusInterval: any;
  private lastLabelUpdateTime = 0; // Track last time labels were updated
  
  // Tutor-specific insights
  totalStudents = 0;
  totalTutors = 0;  // Used by tutors to show total students, and by students to show total tutors
  lessonsThisWeek = 0;
  tutorRating = '0.0';
  unreadMessages = 0;
  totalConversations = 0;
  walletBalance = 0; // TODO: Load from actual wallet service
  showWalletBalance = false; // Hide by default
  walletDisplay = '$•••••'; // Computed display value
  insightsLoading = true; // Loading state for insights panel
  walletTemporarilyVisible = false; // For mobile tap-to-reveal
  
  // Student-specific insights
  totalLessonsCompleted = 0;

  /**
   * From the full lesson/class API feed before trimming to `this.lessons` (tutors only keep upcoming + today).
   * Used for growth nudges such as "first booking" — do not derive from `this.lessons` alone.
   */
  tutorHasEverHadPastBooking = false;
  
  // Coaching badge metrics (for tutors)
  coachingMetrics: any = null;

  // Mobile: recent students (derived from lessons)
  recentStudents: { id: string; name: string; avatar: string | null; subject: string }[] = [];
  // Mobile: pending action items (feedback + reschedule requests)
  pendingActionItems: { type: 'feedback' | 'reschedule'; label: string; sublabel: string; avatar: string | null; lessonId: string; feedbackId?: string; lesson?: any }[] = [];
  
  // Tutor pending feedback (extended with pre-formatted date/time for template)
  pendingFeedback: (PendingFeedbackItem & { formattedDate?: string; formattedTime?: string })[] = [];
  pendingFeedbackCount = 0;
  feedbackBannerSubtitle: string = '';
  feedbackGraceExpired: boolean = false;
  private feedbackGraceInterval: any = null;
  private static readonly FEEDBACK_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours
  
  // All tutors modal state
  isAllTutorsModalOpen = false;
  
  // Tutor booking modal state
  isTutorBookingModalOpen = false;
  selectedTutorForBooking: any = null;
  
  // Tutor onboarding state
  showOnboardingBanner = false;
  profileHiddenNoVideo = false;
  tutorOnboardingStatus: any = null;
  hasCustomProfilePhoto = false; // True only if user has uploaded a custom photo (not Google photo)
  isTutorUser = false; // Use property instead of function call in template
  isStudentUser = false; // Use property instead of function call in template

  // Learning Plan precomputed properties (no functions in template)
  learningPlanData: any = null;
  learningPlanCurrentPhase = 0;
  learningPlanTotalPhases = 0;
  learningPlanPhaseTitle = '';
  learningPlanSummary = '';
  learningPlanNextFocus = '';
  learningPlanPhaseDots: boolean[] = [];

  homePracticeMaterials: any[] = [];
  
  // Cache of current students array for efficient label updates
  private currentStudents: any[] = [];
  private cachedStudentsForDate: any[] = [];
  private cachedStudentsDate: Date | null = null;
  private cachedStudentsLessonsHash: string = '';
  
  // Cached computed properties to prevent re-computation during change detection
  private _cachedFirstLesson: any | null = null;
  private _cachedFirstLessonHash: string = '';
  private _cachedTimelineEvents: any[] = [];
  private _cachedTimelineEventsHash: string = '';
  
  // Cache for reschedule proposer checks to avoid repeated function calls
  private _rescheduleProposerCache: Map<string, boolean> = new Map();
  private _rescheduleProposerCacheTime: number = 0;
  
  // Inline modal state for reschedule modal
  isRescheduleModalOpen = false;
  rescheduleModalData: {
    lessonId: string;
    lesson: Lesson;
    participantId: string;
    participantName: any;
    participantAvatar: string | undefined;
    currentUserId: string;
    isTutor: boolean;
    showBackButton?: boolean;
  } | null = null;
  
  // Inline modal state for reschedule proposal modal
  isRescheduleProposalModalOpen = false;
  rescheduleProposalModalData: {
    lessonId: string;
    lesson: any;
    proposal: any;
    participantName: string;
    participantAvatar: string | undefined;
    proposedDate: string;
    proposedTime: string;
    originalDate: string;
    originalTime: string;
    otherParticipant: any; // Store for counter-propose action
  } | null = null;
  
  // Inline modal state for tutor note modal
  isTutorNoteModalOpen = false;
  tutorNoteModalData: {
    lessonId: string;
    studentName: string;
    lessonSubject: string;
    duration: number;
  } | null = null;
  
  // Inline modal state for confirm action modal (reschedule)
  isConfirmRescheduleModalOpen = false;
  confirmRescheduleModalData: {
    title: string;
    message: string;
    notificationMessage: string;
    confirmText: string;
    cancelText: string;
    confirmColor: string;
    icon: string;
    iconColor: string;
    participantName: string;
    participantAvatar: string | undefined;
    lessonId: string;
    lesson: Lesson;
    otherParticipant: any;
  } | null = null;
  
  // Inline modal state for class invitation modal
  isClassInvitationModalOpen = false;
  classInvitationModalData: {
    classId: string;
    notification?: any;
  } | null = null;
  
  // Inline modal state for invite student modal
  isInviteStudentModalOpen = false;
  inviteStudentModalProps: {
    className: string;
    classId: string;
    classData: any;
  } | null = null;
  
  // Inline modal state for invitations list modal
  isInvitationsListModalOpen = false;
  
  // Inline modal state for confirm action modal (cancel)
  isConfirmCancelModalOpen = false;
  confirmCancelModalData: {
    title: string;
    message: string;
    notificationMessage: string;
    confirmText: string;
    cancelText: string;
    confirmColor: string;
    icon: string;
    iconColor: string;
    participantName: string;
    participantAvatar: string | undefined;
    lessonId: string;
    lesson: Lesson;
  } | null = null;
  
  // Featured tutors for students (mock data - replace with real data)
  featuredTutors: any[] = [];

  // Lesson presence tracking: lessonId -> presence data
  lessonPresence: Map<string, {
    participantName: string;
    participantPicture?: string;
    participantRole: 'tutor' | 'student';
    joinedAt: string;
  }> = new Map();

  // Pre-computed presence state for the Up Next card (avoids function calls in template)
  nextLessonOtherJoined = false;
  nextLessonOtherName = '';

  // Growth insight ticker (tutor welcome line)
  growthInsight: GrowthInsight | null = null;
  growthInsights: GrowthInsight[] = [];
  growthIndex = 0;
  growthCount = 0;
  growthPaused = false;
  /** True when the growth ticker contains profile-critical items (should override next lesson display). */
  hasProfileCriticalInsights = false;
  /** Profile completion checklist for inline welcome display. */
  profileChecklist: { id: string; label: string; done: boolean; route: string }[] = [];
  profileChecklistDoneCount = 0;
  profileChecklistTotal = 0;
  /** Single-item row; `epoch` bumps every visible change so trackBy never reuses a cached view (restarts CSS fade). */
  growthInsightSlideRow: { epoch: number; insight: GrowthInsight }[] = [];
  readonly trackGrowthInsightSlide = (_index: number, row: { epoch: number }) => row.epoch;
  private _growthSlideEpoch = 0;
  private _lastGrowthSlideSig = '';
  isGrowthModalOpen = false;
  growthModalItems: { insight: GrowthInsight; dismissed: boolean; active: boolean }[] = [];
  private _growthInsightsLoaded = false;

  // Pre-computed template values (avoid function calls in template)
  greetingText = '';
  welcomeMessageText = '';

  // Previous lesson notes for the Up Next tutor-student pair
  previousNotesData: any = null;
  previousNotesLoading = false;
  isPreviousNotesModalOpen = false;
  previousNotesDate = '';
  previousNotesScores: { label: string; value: number }[] = [];

  // Previous notes translation
  prevNotesAnalysisId: string | null = null;
  prevNotesOriginalAnalysis: any = null;
  private translationSub?: Subscription;
  prevNotesDisplayAnalysis: any = null;
  prevNotesTranslating = false;
  prevNotesShowingTranslation = false;

  private resizeListener: any;

  constructor(
    private modalCtrl: ModalController, 
    public router: Router,
    public platformService: PlatformService,
    private authService: AuthService,
    private userService: UserService,
    private walletService: WalletService,
    private lessonService: LessonService,
    private classService: ClassService,
    private agoraService: AgoraService,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private websocketService: WebSocketService,
    private notificationService: NotificationService,
    private messagingService: MessagingService,
    private reminderService: ReminderService,
    private actionSheetController: ActionSheetController,
    private popoverController: PopoverController,
    private alertController: AlertController,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    public flagService: FlagService,
    private tutorFeedbackService: TutorFeedbackService,
    private http: HttpClient,
    private smartIslandService: SmartIslandService,
    private navCtrl: NavController,
    private translateService: TranslateService,
    private activatedRoute: ActivatedRoute,
    private learningPlanService: LearningPlanService,
    private analysisTranslation: AnalysisTranslationService,
    private homeInlineToolbar: HomeInlineToolbarService,
    private materialService: MaterialService,
    private tutorGrowthService: TutorGrowthService
  ) {
    // Subscribe to currentUser$ observable to get updates automatically
    // Use asyncScheduler to prevent synchronous emission from blocking
    this.userService.currentUser$
      .pipe(
        observeOn(asyncScheduler), // Make emissions async to prevent freezing
        filter(user => user !== null),
        takeUntil(this.destroy$)
      )
      .subscribe(user => {
        this.currentUser = user;
        this.isTutorUser = this.isTutor(); // Set property once
        this.isStudentUser = this.isStudent(); // Set property once
        
        // Update showWalletBalance immediately when user profile changes
        // This ensures instant update when toggled in profile page
        if (user?.profile) {
          this.showWalletBalance = user.profile.showWalletBalance || false;
          this.updateWalletDisplay();
        }
        
        // Load notification count when user is available
        if (user) {
          setTimeout(() => {
            this.loadUnreadNotificationCount();
          }, 500);
        }
        
        // Load pending feedback for tutors as soon as currentUser is available.
        // This catches the case where ionViewWillEnter fired before currentUser was set
        // (due to asyncScheduler), so loadPendingFeedback() was skipped.
        if (this.isTutorUser) {
          this.loadPendingFeedback();
        }

        if (this.isStudentUser && user?.onboardingData?.languages?.length) {
          this.loadLearningPlan(user.onboardingData.languages[0]);
          this.loadHomePracticeMaterials(user.onboardingData.languages[0]);
        }
        
        // Check tutor onboarding status when user loads
        // Only check if we have complete tutor data (tutorApproved is defined)
        // This prevents banner flash when partial user data is emitted (e.g., from profile update)
        if (this.isTutorUser && user?.tutorApproved !== undefined) {
          this.checkTutorOnboardingStatus();
        }
        
        // Only load lessons on initial user setup, not on every navigation
        // ionViewWillEnter() handles subsequent loads with smart caching
        if (!this._hasInitiallyLoaded) {
          this.loadLessons(true); // Show skeleton only on first load
        }
        
        this.refreshPreComputedTemplateValues();
        this.cdr.markForCheck();
        
        // Load availability immediately — it controls the primary CTA
        if (this.isTutor()) {
          this.loadAvailability();
          this.loadWeeklyEarningsGoalFromStorage();
          this.refreshWeeklyEarningsProgress();
          // Defer earnings only — loadTutorInsights runs after loadLessons so growth context sees full lesson feed
          setTimeout(() => {
            this.loadTutorEarnings();
          }, 1500);
        } else {
          this.earningsBalanceLoading = false;
          setTimeout(() => {
            this.loadStudentInsights();
            this.loadWalletBalance();
            this.loadPendingInvitations();
          }, 1500);
          
          // Set up real-time tutor availability socket listeners (students only)
          // These must be set up HERE after currentUser is loaded, not in ngOnInit
          this.setupTutorAvailabilitySocketListeners();
          
          // Start dynamic card refresh interval for students
          // This is also started in ionViewWillEnter, but we start here too in case
          // currentUser loads AFTER ionViewWillEnter has already run
          
          this.startDynamicCardRefreshInterval();
          
          // Also do an initial load of dynamic cards
          this.loadAdditionalDynamicCards();
          this._lastDynamicCardRefresh = Date.now();
        }
      });
    
    // Subscribe to unread message count
    this.messagingService.unreadCount$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(count => {
      this.unreadMessages = count;
      this.cdr.markForCheck();
    });
    
    // Subscribe to Smart Island dynamic card updates
    this.smartIslandService.currentCard$.pipe(
      takeUntil(this.destroy$),
      observeOn(asyncScheduler) // Smooth transition timing
    ).subscribe(card => {
      
      
      // Run in Angular zone to ensure proper change detection and animations
      this.ngZone.run(() => {
        // Handle null card (card was removed)
        if (!card) {
          
          this.dynamicCard = null;
          this.cdr.detectChanges();
          return;
        }
        
        // Small delay on first card to ensure smooth animation
        if (!this.dynamicCardReady) {
          this.dynamicCardReady = true;
          setTimeout(() => {
            
            this.dynamicCard = card;
            this.dynamicCardAnimationState++;
            this.cdr.detectChanges();
          }, 100); // 100ms delay for initial card
        } else {
          
          // Create a new object reference to ensure Angular detects the change
          this.dynamicCard = { ...card };
          this.dynamicCardAnimationState++; // Increment to trigger animation
          this.cdr.detectChanges();
        }
      });
    });

    // Subscribe to pending feedback cache so tab1 updates reactively
    // when the cache is populated by any page (e.g. profile).
    this.tutorFeedbackService.pendingFeedback$
      .pipe(takeUntil(this.destroy$))
      .subscribe(response => {
        if (this.isTutorUser) {
          this.pendingFeedback = (response.pendingFeedback || []).map((fb: any) => ({
            ...fb,
            formattedDate: fb.lesson?.startTime ? this.formatFeedbackDate(fb.lesson.startTime) : '',
            formattedTime: fb.lesson?.startTime ? this.formatFeedbackTime(fb.lesson.startTime) : ''
          }));
          this.pendingFeedbackCount = response.count || 0;

          // Update grace period countdown for feedback banner
          this.updateFeedbackGraceCountdown();

          // Auto-reopen the feedback modal after submitting one item
          // so the tutor can continue working through remaining feedback.
          if (this.tutorFeedbackService.consumeReopenFlag() && this.pendingFeedbackCount > 0) {
            setTimeout(() => { this.isFeedbackModalOpen = true; this.cdr.markForCheck(); }, 400);
          }
          this.cdr.markForCheck();
        }
      });
  }

  private _darkModeObserver?: MutationObserver;

  ngOnInit() {
    this.isDarkModeActive = document.documentElement.classList.contains('ion-palette-dark');
    this._darkModeObserver = new MutationObserver(() => {
      this.isDarkModeActive = document.documentElement.classList.contains('ion-palette-dark');
    });
    this._darkModeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    this.translationSub = this.analysisTranslation.onTranslationChanged().subscribe(changedId => {
      if (changedId === this.prevNotesAnalysisId) {
        this.refreshPrevNotesTranslationState();
        this.cdr.detectChanges();
      }
    });

    this.homeInlineToolbar.onOpenEarningsRequest$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.isTutorUser && !this.showEarningsView) {
          this.closeAllInlinePanelsExceptEarnings();
          this.showEarningsView = true;
          this.cdr.detectChanges();
          this.ionContent?.scrollToTop(0);
        }
      });

    this.loadUserStats();
    
    // Subscribe to wallet balance updates for students
    if (this.isStudent()) {
      this.subscribeToWalletBalance();
    }

    // Subscribe to availability updates (always subscribe, check user type inside)
    // This ensures the subscription is set up even before user data loads
    
    this.userService.availabilityUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe((updatedAvailability) => {
        
        
        // Only process if user is a tutor
        if (!this.isTutor()) {
          
          return;
        }
        
        
        
        // Immediately update hasAvailability based on the new data
        if (updatedAvailability && Array.isArray(updatedAvailability)) {
          const timeNow = new Date();
          
          // Check if there is availability AND at least one slot is in the future
          const hasFutureAvailability = updatedAvailability.some(slot => {
            // Check if slot has absoluteEnd and it's in the future
            if (slot.absoluteEnd) {
              return new Date(slot.absoluteEnd) > timeNow;
            }
            // If no absoluteEnd, check absoluteStart
            if (slot.absoluteStart) {
              return new Date(slot.absoluteStart) > timeNow;
            }
            // If no absolute dates, assume it's a recurring pattern (future availability)
            return true;
          });
          
          this.hasAvailability = hasFutureAvailability || false;
          this.buttonTextState = this.hasAvailability ? 'view' : 'add';
          this.availabilityBlocks = updatedAvailability;
          this.updateAvailabilitySummary();
          
          // Trigger change detection to ensure UI updates immediately
          this.cdr.detectChanges();
          
          
          this.syncTutorMobileWelcomeAboveUpNext();
        }
        
        // Also reload to ensure we have the latest data (in case of any edge cases)
        this.loadAvailability();
      });

    const today = this.startOfDay(new Date());
    this.selectedDate = today;
    this.weekStartDate = this.getStartOfWeek(today);

    // Get platform information
    this.currentPlatform = this.platformService.getPlatform();
    this.platformConfig = this.platformService.getPlatformConfig();
    this.isWeb = this.platformService.isWeb();
    this.isMobile = this.platformService.isMobile();
    this.refreshNarrowTutorHomeViewport();
    const initialStart = this.getStripStartForDate(today);
    this.updateDateStrip(initialStart, false);
    
    // Listen for navigation events to close tutor booking modal
    this.router.events.pipe(
      takeUntil(this.destroy$)
    ).subscribe(event => {
      if (event instanceof NavigationStart) {
        if (this.isTutorBookingModalOpen) {
          this.closeTutorBookingModal();
          this.cdr.markForCheck();
        }
      }
      if (event instanceof NavigationEnd) {
        const url = (event as NavigationEnd).urlAfterRedirects || (event as NavigationEnd).url;
        this.syncMaterialsModalChildRoute(url);
        if (
          this.isMobile &&
          (url === '/tabs/home' || url === '/tabs/home/')
        ) {
          // Force re-render inline panels that may be visually stale after
          // returning from a root-level route (e.g. /material/:id on native iOS)
          if (this.showCreateMaterialView || this.showExploreView || this.showScheduleClassView || this.showForumView) {
            const wasCM = this.showCreateMaterialView;
            const wasExplore = this.showExploreView;
            const wasSchedule = this.showScheduleClassView;
            const wasForum = this.showForumView;
            this.showCreateMaterialView = false;
            this.showExploreView = false;
            this.showScheduleClassView = false;
            this.showForumView = false;
            this.cdr.detectChanges();
            requestAnimationFrame(() => {
              this.showCreateMaterialView = wasCM;
              this.showExploreView = wasExplore;
              this.showScheduleClassView = wasSchedule;
              this.showForumView = wasForum;
              this.cdr.detectChanges();
              if (wasCM && this.createMaterialRef?.restoreSection) {
                this.createMaterialRef.restoreSection();
              }
            });
          }
        }
      }
    });

    this.syncMaterialsModalChildRoute(this.router.url);

    // Add window resize listener for reactive viewport detection
    this.resizeListener = () => {
      const prevIsMobile = this.isMobile;
      this.isWeb = this.platformService.isWeb();
      this.isMobile = this.platformService.isMobile();
      if (prevIsMobile !== this.isMobile) {
        const referenceDate = this.selectedDate ?? this.startOfDay(new Date());
        const newStart = this.getStripStartForDate(referenceDate);
        this.updateDateStrip(newStart, false);
      }
      this.refreshNarrowTutorHomeViewport();
      this.syncTutorMobileWelcomeAboveUpNext();
    };
    window.addEventListener('resize', this.resizeListener);

    // Listen for lesson-left events to immediately refresh status
    window.addEventListener('lesson-left' as any, (e: any) => {
      const leftLessonId = e?.detail?.lessonId;
      // Skip if upcoming lesson is a class (not a real lesson)
      if (this.upcomingLesson && this.upcomingLesson._id === leftLessonId && !(this.upcomingLesson as any).isClass) {
        this.lessonService.getLessonStatus(this.upcomingLesson._id).subscribe(status => {
          if (status?.success) {
            (this.upcomingLesson as any).status = status.lesson?.status || (this.upcomingLesson as any).status;
            (this.upcomingLesson as any).participant = status.participant;
            this.cdr.markForCheck();
          }
        });
      }
    });

    // Listen for WebSocket notifications
    this.websocketService.connect();
    
    
    
    // Test if observable is working
    
    this.websocketService.newNotification$.pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: async (notification) => {
        
        
        // Reload notification count when a new notification arrives (only if user is authenticated)
        if (this.currentUser) {
          this.loadUnreadNotificationCount();
          
          // LOG ALL NOTIFICATIONS TO DEBUG
          
          
          
          
          
          
          // FALLBACK: For students, reload invitations on ANY notification
          // This ensures count updates even if event type is different than expected
          if (this.currentUser.userType === 'student') {
            
            setTimeout(() => {
              this.ngZone.run(() => {
                this.loadPendingInvitations();
              });
            }, 1000);
          }
          
          // Check if it's a class invitation
          const isClassInvitation = notification?.type === 'class_invitation';
          const isStudent = this.currentUser.userType === 'student';
          
          
          
          
          // Handle class auto-cancelled notifications
          if ((notification?.type === 'class_auto_cancelled' || notification?.type === 'class_invitation_cancelled') && notification.data?.classId) {
          
          
          // If student received invitation cancellation, reload invitations to update count
          if (notification?.type === 'class_invitation_cancelled' && this.currentUser.userType === 'student') {
            
            this.loadPendingInvitations();
          }
          
          // Smart update: Move the cancelled class from lessons to cancelledLessons without full reload
          await this.handleClassCancellation(notification.data.classId, notification.data.cancelReason);
          
          // Manually trigger change detection to update the UI
          this.cdr.detectChanges();
          
          // Show toast notification
          const toast = await this.toastController.create({
            message: notification.message || 'A class has been cancelled',
            duration: 5000,
            position: 'top',
            color: 'warning',
            buttons: [
              {
                text: 'Dismiss',
                role: 'cancel'
              }
            ]
          });
          await toast.present();
        }
        
        // Handle lesson cancelled notifications
        if (notification?.type === 'lesson_cancelled' && notification.data?.lessonId) {
          
          
          // Smart update: Move the cancelled lesson without full reload
          await this.handleLessonCancellation(notification.data.lessonId);
          
          // Manually trigger change detection to update the UI
          this.cdr.detectChanges();
        }
        
        // Handle class invitations specially
        if (notification?.type === 'class_invitation' && this.currentUser.userType === 'student') {
          
          
          
          // Show Smart Island moment
          
          
          
          
          if (this.smartIsland && notification.data) {
            
            
            // Ensure we're in Angular zone
            this.ngZone.run(() => {
              // Format tutor name properly
              const tutorName = notification.data.tutorName || this.formatTutorName(
                notification.data.tutorFirstName, 
                notification.data.tutorLastName
              );
              const className = notification.data.className || 'a class';
              
              this.smartIsland.addMoment({
                type: 'invitation',
                priority: IslandPriority.HIGH,
                id: `invitation:${notification.data.classId}`, // Unique ID per class invitation
                avatarUrl: notification.data.tutorPicture || '',
                title: `${tutorName} invited you`,
                subtitle: `to ${className}`,
                emoji: '📬',
                gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
                action: () => {
                  if (notification.data.classId) {
                    this.openClassInvitation(notification.data.classId, { data: notification });
                  }
                },
                glow: false,
                duration: 6000
              });
              
            });
          } else {
            console.warn('⚠️ [TAB1] Could not add Smart Island moment. smartIsland:', !!this.smartIsland, 'notification.data:', !!notification.data);
            
            // If Smart Island not ready, retry after a short delay
            if (!this.smartIsland) {
              
              setTimeout(() => {
                if (this.smartIsland && notification.data) {
                  
                  this.ngZone.run(() => {
                    // Format tutor name properly
                    const tutorName = notification.data.tutorName || this.formatTutorName(
                      notification.data.tutorFirstName, 
                      notification.data.tutorLastName
                    );
                    const className = notification.data.className || 'a class';
                    
                    this.smartIsland.addMoment({
                      type: 'invitation',
                      priority: IslandPriority.HIGH,
                      id: `invitation:${notification.data.classId}`,
                      avatarUrl: notification.data.tutorPicture || '',
                      title: `${tutorName} invited you`,
                      subtitle: `to ${className}`,
                      emoji: '📬',
                      gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
                      action: () => {
                        if (notification.data.classId) {
                          this.openClassInvitation(notification.data.classId, { data: notification });
                        }
                      },
                      glow: false,
                      duration: 6000
                    });
                    
                  });
                } else {
                  console.error('❌ [TAB1] Smart Island still not available on retry');
                }
              }, 500);
            }
          }
          
          // Wait a bit for backend to save the invitation before fetching
          // This prevents race condition where WebSocket arrives before DB write completes
          setTimeout(() => {
            
            
            // Run inside Angular zone to ensure change detection works
            this.ngZone.run(() => {
              this.loadPendingInvitations();
              
              // Force change detection after data loads
              setTimeout(() => {
                
                
                this.cdr.detectChanges();
              }, 1000);
            });
          }, 1000);
          
          // Show a toast notification immediately
          const toast = await this.toastController.create({
            message: notification.message || 'You have a new class invitation!',
            duration: 4000,
            position: 'top',
            color: 'primary',
            buttons: [
              {
                text: 'View',
                handler: () => {
                  if (notification.classId) {
                    this.openClassInvitation(notification.classId, { data: notification });
                  }
                }
              },
              {
                text: 'Dismiss',
                role: 'cancel'
              }
            ]
          });
          await toast.present();
        }
        }
      },
      error: (err: any) => {
        console.error('❌ [TAB1] WebSocket subscription error:', err);
      },
      complete: () => {
        
      }
    });


    // Live countdown tick — runs outside Angular zone to avoid triggering global CD on every tick.
    // Only runs detectChanges on this component when labels actually change.
    this.ngZone.runOutsideAngular(() => {
      this.countdownInterval = setInterval(() => {
        const now = Date.now();
        const currentMinute = Math.floor(now / 60000);
        const lastMinute = Math.floor(this.lastLabelUpdateTime / 60000);
        
        if (currentMinute !== lastMinute || this.lastLabelUpdateTime === 0) {
          this.lastLabelUpdateTime = now;
          
          this.recalculateUpcomingLesson();
          this.updateStudentJoinLabels();
          this.nextLessonTimeLabel = this.getNextLessonTimeLabel();
          this.hadLessonsToday = this.hadLessonsEarlierToday();
          this.hadOnlyCancelledLessonsToday = this.checkHadOnlyCancelledLessonsToday();
          this.syncTutorMobileWelcomeAboveUpNext();
          this.refreshNextLessonTimeSensitiveFields();
          this.greetingText = this.getGreeting();
          this.countdownTick = now;
          this.cdr.detectChanges();
        }
      }, 5000);
      
      this.statusInterval = setInterval(() => {
        if (this.upcomingLesson && !(this.upcomingLesson as any).isClass) {
          this.ngZone.run(() => {
            this.lessonService.getLessonStatus(this.upcomingLesson!._id).subscribe(status => {
              if (status?.success && this.upcomingLesson) {
                (this.upcomingLesson as any).serverTime = status.serverTime;
                (this.upcomingLesson as any).status = status.lesson?.status || this.upcomingLesson.status;
                (this.upcomingLesson as any).participant = status.participant;
                this.cdr.markForCheck();
              }
            });
          });
        }
      }, 30000);
    });

    // Load featured tutors for students
    if (this.isStudent()) {
      this.loadFeaturedTutors();
    }

    // Listen for WebSocket reconnection to refresh data
    this.websocketService.connection$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(isConnected => {
      
      if (isConnected && this.currentUser) {
        
        // Reload important data after reconnection (no skeleton — silent refresh)
        setTimeout(() => {
          this.loadUnreadNotificationCount();
          this.loadLessons(false);
          if (this.isStudent()) {
            this.loadPendingInvitations();
          }
        }, 500);
      }
    });
    
    this.websocketService.lessonPresence$
      .pipe(takeUntil(this.destroy$))
      .subscribe(presence => {
        const normalizedLessonId = String(presence.lessonId);
        this.lessonPresence.set(normalizedLessonId, {
          participantName: presence.participantName,
          participantPicture: presence.participantPicture,
          participantRole: presence.participantRole,
          joinedAt: presence.joinedAt
        });
        this.updateNextLessonPresence();
        this.countdownTick = Date.now();
        this.cdr.markForCheck();
      });
    
    // Listen for participant left events
    this.websocketService.lessonPresenceLeft$
      .pipe(takeUntil(this.destroy$))
      .subscribe(presence => {
        const normalizedLessonId = String(presence.lessonId);
        this.lessonPresence.delete(normalizedLessonId);
        this.updateNextLessonPresence();
        this.countdownTick = Date.now();
        this.cdr.markForCheck();
      });

    // Listen for reschedule proposal events
    this.websocketService.on('reschedule_proposed').pipe(
      takeUntil(this.destroy$)
    ).subscribe(async (data: any) => {
      
      
      
      
      // Update the lesson status in the UI
      const lesson = this.lessons.find(l => {
        const match = String(l._id) === String(data.lessonId);
        
        return match;
      });
      
      if (lesson) {
        
        lesson.status = 'pending_reschedule';
        (lesson as any).rescheduleProposal = data.proposal;
        
        // Invalidate cached computed properties to force recalculation
        this._cachedFirstLessonHash = '';
        this._cachedFirstLesson = undefined;
        this._cachedTimelineEventsHash = '';
        this._cachedTimelineEvents = [];
        this._rescheduleProposerCache.clear(); // Clear reschedule proposer cache
        
        // Force change detection and update
        this.cdr.detectChanges();
        
        // Trigger a recomputation by updating countdownTick
        this.countdownTick = Date.now();

        // Show toast
        const toast = await this.toastController.create({
          message: `${data.proposerName} proposed a new time for your lesson`,
          duration: 5000,
          color: 'primary',
          position: 'top',
          buttons: [{
            text: 'View',
            handler: () => {
              this.showRescheduleProposal(lesson);
            }
          }]
        });
        await toast.present();
      } else {
        console.warn('❌ [TAB1] Lesson not found in lessons array, reloading lessons...');
        // Reload lessons to ensure we have the latest data
        await this.loadLessons(false);
      }
    });

    // Listen for lesson_updated events (for when you're the proposer)
    this.websocketService.on('lesson_updated').pipe(
      takeUntil(this.destroy$)
    ).subscribe(async (data: any) => {
      
      
      // Update the lesson in the UI
      const lesson = this.lessons.find(l => String(l._id) === String(data.lessonId));
      
      if (lesson) {
        
        lesson.status = data.status as any;
        
        if (data.rescheduleProposal) {
          (lesson as any).rescheduleProposal = data.rescheduleProposal;
        }
        
        // Invalidate cached computed properties to force recalculation
        this._cachedFirstLessonHash = '';
        this._cachedFirstLesson = undefined;
        this._cachedTimelineEventsHash = '';
        this._cachedTimelineEvents = [];
        this._rescheduleProposerCache.clear();
        
        // Force change detection and update
        this.cdr.detectChanges();
        
        // Trigger a recomputation by updating countdownTick
        this.countdownTick = Date.now();
      } else {
        console.warn('⚠️ [TAB1] Lesson not found in current list:', data.lessonId);
      }
    });
    
    // Listen for reschedule accepted events
    this.websocketService.on('reschedule_accepted').pipe(
      takeUntil(this.destroy$)
    ).subscribe(async (data: any) => {
      
      const lesson = this.lessons.find(l => l._id === data.lessonId);
      if (lesson) {
        
        
        // Update the lesson times to the new accepted times
        lesson.startTime = data.newStartTime;
        lesson.endTime = data.newEndTime;
        lesson.status = 'scheduled';
        
        
        
        // Mark the rescheduleProposal as accepted (keep the proposal object for badge display)
        if ((lesson as any).rescheduleProposal) {
          (lesson as any).rescheduleProposal.status = 'accepted';
        }
        
        // ✅ NEW: Un-dismiss the reminder for this lesson so it can show again for the new time
        this.reminderService.undismissReminder(lesson._id);
        
        
        // Re-sort lessons array by startTime to ensure correct ordering
        this.lessons.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
        
        
        
        
        
        // Invalidate ALL cached computed properties to force full recalculation
        // This will determine if the lesson is still the "next class" or should move to timeline
        this._cachedFirstLessonHash = '';
        this._cachedFirstLesson = undefined;
        this._cachedTimelineEventsHash = '';
        this._cachedTimelineEvents = [];
        this._rescheduleProposerCache.clear();
        
        // Force change detection to recompute all getters
        this.cdr.detectChanges();
        this.countdownTick = Date.now();

        // Show toast
        const toast = await this.toastController.create({
          message: 'Reschedule accepted! Lesson time updated.',
          duration: 3000,
          color: 'success',
          position: 'top'
        });
        await toast.present();
      } else {
        console.warn('❌ [TAB1] Lesson not found for reschedule_accepted, reloading lessons...');
        await this.loadLessons(false);
      }
    });

    // Listen for reschedule rejected events
    this.websocketService.on('reschedule_rejected').pipe(
      takeUntil(this.destroy$)
    ).subscribe(async (data: any) => {
      
      // Clear the proposal
      const lesson = this.lessons.find(l => l._id === data.lessonId);
      if (lesson) {
        lesson.status = 'scheduled';
        (lesson as any).rescheduleProposal = null;
        
        // Invalidate cached computed properties
        this._cachedFirstLessonHash = '';
        this._cachedFirstLesson = undefined;
        
        this.cdr.detectChanges();
        this.countdownTick = Date.now();

        // Show toast
        const toast = await this.toastController.create({
          message: 'Reschedule request was declined',
          duration: 3000,
          color: 'warning',
          position: 'top'
        });
        await toast.present();
      }
    });
    
    /* 
    TEMPORARILY DISABLED: Feedback Required WebSocket Listener
    TODO: Re-enable if we want to support AI-disabled mode
    
    // Listen for feedback_required events (tutors only)
    if (this.currentUser?.userType === 'tutor') {
      this.websocketService.on('feedback_required').pipe(
        takeUntil(this.destroy$)
      ).subscribe(async (data: any) => {
        // Reload pending feedback which will trigger the alert via loadPendingFeedback()
        await this.loadPendingFeedback();
        this.cdr.detectChanges();
      });
    }
    */
    
    // ====================
    // SMART ISLAND WEBSOCKET EVENTS (for students)
    // ====================
    
    if (this.currentUser?.userType === 'student') {
      // Listen for lesson completions to show quick rating
      this.websocketService.on('lesson_completed').pipe(
        takeUntil(this.destroy$)
      ).subscribe((data: any) => {
        
        if (data.lessonId && data.tutorName) {
          // Show quick rating after 2 seconds
          setTimeout(() => {
            this.showQuickRating(data.lessonId, data.tutorName, data.tutorPicture);
          }, 2000);
        }
      });
      
      // Listen for tutor shared content
      this.websocketService.on('tutor_shared_content').pipe(
        takeUntil(this.destroy$)
      ).subscribe((data: any) => {
        
        if (data.tutor && data.contentType) {
          this.showTutorSharedContent(data.tutor, data.contentType, data.contentId);
        }
      });
      
      // Listen for milestone achievements
      this.websocketService.on('milestone_achieved').pipe(
        takeUntil(this.destroy$)
      ).subscribe((data: any) => {
        
        if (data.type && data.value) {
          this.showMilestone(data.type, data.value);
        }
      });
      
      // Listen for smart recommendations
      this.websocketService.on('smart_recommendation').pipe(
        takeUntil(this.destroy$)
      ).subscribe((data: any) => {
        
        if (data.message) {
          this.showRecommendation(data.message, data.type || 'general');
        }
      });
      
    }
    
    // Listen for tutor note modal trigger from video-call page
    window.addEventListener('openTutorNoteModal', async () => {
      const modalDataStr = localStorage.getItem('openTutorNoteModal');
      if (modalDataStr) {
        try {
          const modalData = JSON.parse(modalDataStr);
          const lessonId = modalData.lessonId;
          
          // Clear the flag
          localStorage.removeItem('openTutorNoteModal');
          
          // Fetch lesson details and open modal
          const lessonResponse = await firstValueFrom(
            this.lessonService.getLesson(lessonId)
          );
          const lesson = lessonResponse.lesson;
          const student = lesson.studentId;
          
          this.tutorNoteModalData = {
            lessonId,
            studentName: this.formatTutorDisplayName(student),
            lessonSubject: lesson.subject || 'Language',
            duration: lesson.actualDurationMinutes || lesson.duration
          };
          
          this.isTutorNoteModalOpen = true;
        } catch (error) {
          console.error('❌ Error opening tutor note modal:', error);
        }
      }
    });
    
    // Refresh tutor earnings when the tab/window becomes visible (laptop wake, tab switch)
    this._earningsVisibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.isTutorUser) {
        const now = Date.now();
        if (now - this._lastEarningsVisibilityRefresh > 60000) {
          
          this._lastEarningsVisibilityRefresh = now;
          this.loadTutorEarnings();
        }
      }
    };
    document.addEventListener('visibilitychange', this._earningsVisibilityHandler);

    
  }
  
  ngAfterViewInit() {
    
    if (this.smartIsland) {
      
    } else {
      console.error('❌ [TAB1] Smart Island component NOT available after view init!');
    }
    this.ionContent?.getScrollElement().then(el => { this._scrollElRef = el || null; });
  }

  ionViewWillEnter() {
    if (this._hasInitiallyLoaded) {
      this.skipTabEntryAnimations = true;
    }
    this.refreshPrevNotesTranslationState();

    if (this.showCreateMaterialView && this.createMaterialRef?.restoreSection) {
      this.createMaterialRef.restoreSection();
    }
    
    
    
    
    // Refresh wallet balance or earnings when returning to this page
    if (this.currentUser) {
      if (this.currentUser.userType === 'student') {
        this.loadWalletBalance();
      } else if (this.currentUser.userType === 'tutor') {
        this.loadTutorEarnings();
      }
    }

    // If the toolbar "$" pill was tapped from another tab, open earnings now
    if (this.homeInlineToolbar.consumePendingOpenEarnings()) {
      if (this.isTutorUser && !this.showEarningsView) {
        this._earningsOpenedFromOtherTab = true;
        this.closeAllInlinePanelsExceptEarnings();
        this.showEarningsView = true;
        this.cdr.detectChanges();
        this.ionContent?.scrollToTop(0);
      }
    }
    
    // Check if we need to force reload (e.g., after booking a lesson)
    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras?.state || history.state;
    const forceReload = state?.forceReload === true;
    
    if (forceReload) {
      
      this._lastDataFetch = 0; // Invalidate cache
      this._lastDynamicCardRefresh = 0; // Force dynamic card refresh
      // Clear the state to prevent repeated reloads
      if (history.state?.forceReload) {
        history.replaceState({ ...history.state, forceReload: false }, '');
      }
    }

    
    // Refresh presence data when returning to the home page
    // This ensures we see updated presence if someone joined while we were away
    if (this.lessons.length > 0) {
      this.checkExistingPresence();
    }
    // Reload notification count when returning to the page (important for page refresh)
    if (this.currentUser) {
      this.loadUnreadNotificationCount();
      
      // Reload class invitations to get latest status (including cancelled classes)
      if (this.currentUser.userType === 'student') {
        this.loadPendingInvitations();
        
        // Check idle status and show nudge if appropriate (after 5 seconds)
        setTimeout(() => {
          this.checkIdleStatus();
        }, 5000);
        
        // Check if they have no upcoming lessons scheduled (after 10 seconds)
        setTimeout(() => {
          this.checkNoUpcomingLessons();
        }, 10000);
      }
      
      // Load pending feedback for tutors (drives Quick Actions feedback item)
      if (this.currentUser.userType === 'tutor') {
        
        this.loadPendingFeedback();
      } else {
        
      }
    } else {
      console.warn('⚠️ [TAB1] ionViewWillEnter - No currentUser available!');
    }
    
    // Reload user settings to ensure wallet display is up to date
    // Don't force refresh - use cached value first to prevent flashing
    this.loadUserStats(false);
    
    // Smart refresh: only reload if cache is stale or this is the initial load
    const now = Date.now();
    const cacheAge = now - this._lastDataFetch;
    const isCacheStale = cacheAge > this._cacheValidityMs;
    
    // Refresh dynamic cards when entering the page (students only)
    // Use a 30s debounce to prevent rapid API calls, but always refresh on page entry
    
    if (this.currentUser?.userType === 'student') {
      const timeSinceLastRefresh = now - this._lastDynamicCardRefresh;
      const shortDebounce = 30 * 1000; // 30 seconds debounce for page entries
      const shouldRefresh = timeSinceLastRefresh > shortDebounce || !this._hasInitiallyLoaded;
      
      if (shouldRefresh) {
        
        this.loadAdditionalDynamicCards();
        this._lastDynamicCardRefresh = now;
      } else {
        
      }
      
      // Start periodic refresh interval while on page (refresh every 2 minutes)
      this.startDynamicCardRefreshInterval();
    } else {
      
      // Clear any existing interval if user is not a student
      this.stopDynamicCardRefreshInterval();
    }
    
    
    
    if (!this._hasInitiallyLoaded || isCacheStale) {
      
      // Only show skeleton on initial load, not on subsequent visits
      this.loadLessons(!this._hasInitiallyLoaded);
    } else {
      
      // Invalidate hashes so getters recompute on next access,
      // but keep the existing data arrays so the UI doesn't flash empty.
      this._cachedFirstLessonHash = '';
      this._cachedTimelineEventsHash = '';
      this._rescheduleProposerCache.clear();
      
      this.cdr.detectChanges();
      this.countdownTick = Date.now();
    }
    this.refreshPreComputedTemplateValues();
    this.syncTutorMobileWelcomeAboveUpNext();
    this.cdr.markForCheck();
  }

  loadUnreadNotificationCount() {
    // Only load if user is authenticated
    if (!this.currentUser) {
      return;
    }

    this.notificationService.getUnreadCount().pipe(
      observeOn(asyncScheduler), // Make emissions async to prevent freezing
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        if (response.success) {
          this.unreadNotificationCount = response.count;
          this.hasNotifications = this.unreadNotificationCount > 0;
          this.cdr.markForCheck();
        }
      },
      error: (error) => {
        console.error('Error loading unread notification count:', error);
      }
    });
  }

  loadPendingInvitations() {
    if (!this.currentUser || this.currentUser.userType !== 'student') {
      
      return;
    }

    
    this.isLoadingInvitations = true;
    this.classService.getPendingInvitations().pipe(
      observeOn(asyncScheduler), // Make emissions async to prevent freezing
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        
        
        if (response.success) {
          // Keep all classes including cancelled ones (they'll show status in UI)
          const previousCount = this.activeInvitationsCount;
          const previousTotal = this.pendingClassInvitations.length;
          
          this.pendingClassInvitations = response.classes;
          this.activeInvitationsCount = this.pendingClassInvitations.filter(inv => inv.status !== 'cancelled').length;
          
          const newCount = this.activeInvitationsCount;
          const newTotal = this.pendingClassInvitations.length;
          
          
          
          
          
          
          
          // Add pending invitations to Smart Island
          const activeInvitations = this.pendingClassInvitations.filter(inv => inv.status !== 'cancelled');
          
          
          
          if (this.smartIsland && activeInvitations.length > 0) {
            
            
            // Small delay to ensure Smart Island is fully initialized
            setTimeout(() => {
              activeInvitations.forEach((invitation: any) => {
                // Only add if not already in the carousel
                const momentId = `invitation:${invitation._id}`;
                
                // Get firstName and lastName from tutorId (now populated by backend)
                const firstName = invitation.tutorId?.firstName;
                const lastName = invitation.tutorId?.lastName;
                
                const tutorName = this.formatTutorName(firstName, lastName);
                const className = invitation.name || 'a class';
                
                
                
                this.smartIsland.addMoment({
                  type: 'invitation',
                  priority: IslandPriority.HIGH,
                  id: momentId,
                  avatarUrl: invitation.tutorId?.picture || '',
                  title: `${tutorName} invited you`,
                  subtitle: `to ${className}`,
                  emoji: '📬',
                  gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
                  action: () => {
                    this.openClassInvitation(invitation._id);
                  },
                  glow: false,
                  duration: 6000
                });
              });
              
              
            }, 100);
          } else if (!this.smartIsland) {
            console.warn('⚠️ [TAB1] Smart Island not available yet, will retry...');
            // Retry after view init
            setTimeout(() => {
              if (this.smartIsland && activeInvitations.length > 0) {
                
                this.loadPendingInvitations(); // Reload to trigger add
              }
            }, 500);
          }
          
          // Force change detection to ensure UI updates
          this.cdr.detectChanges();
          
          // If count increased, log it
          if (newCount > previousCount) {
            
          } else if (newCount < previousCount) {
            
          } else {
            
          }
        } else {
          
        }
        this.isLoadingInvitations = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('❌ [TAB1] Error loading pending invitations:', error);
        this.isLoadingInvitations = false;
        this.cdr.markForCheck();
      }
    });
  }

  async openClassInvitation(classId: string, notification?: any) {
    // Use inline modal instead of programmatic modal to prevent freezing
    this.classInvitationModalData = {
      classId,
      notification
    };
    this.isClassInvitationModalOpen = true;
  }
  
  // Handle inline class invitation modal dismissal
  async onClassInvitationModalDismiss(event: any) {
    
    this.isClassInvitationModalOpen = false;
    
    const data = event.detail?.data;
    
    // Remove Smart Island moment for this invitation
    if (this.classInvitationModalData?.classId && this.smartIsland) {
      const momentId = `invitation:${this.classInvitationModalData.classId}`;
      
      this.smartIsland.removeMoment(momentId);
    }
    
    if (data?.accepted || data?.declined) {
      // Reload invitations and lessons to reflect the change (no skeleton if already loaded)
      this.loadPendingInvitations();
      this.loadLessons(false);
    } else if (data?.expired) {
      // Invitation was removed/expired - show message and refresh
      
      
      const toast = await this.toastController.create({
        message: 'This invitation is no longer available',
        duration: 2500,
        color: 'medium',
        position: 'bottom'
      });
      await toast.present();
      
      // Refresh invitations to update the count
      this.loadPendingInvitations();
    }
  }

  formatClassDate(dateString: string | null | undefined): string {
    if (!dateString) return 'Date TBD';
    const result = formatDateInTz(dateString, this.userTz, { weekday: 'short', month: 'short', day: 'numeric', year: undefined });
    return result || 'Date TBD';
  }

  formatClassTime(dateString: string | null | undefined): string {
    if (!dateString) return 'Time TBD';
    const result = formatTimeInTz(dateString, this.userTz);
    return result || 'Time TBD';
  }

  ionViewDidLeave() {
    this.stopDynamicCardRefreshInterval();
    const u = this.router.url;
    const toMaterial =
      u.startsWith('/material/') ||
      u.includes('/tabs/home/material/') ||
      u.startsWith('/bundle/') ||
      u.includes('/tabs/home/bundle/');
    if (this.showCreateMaterialView && !toMaterial) {
      this.showCreateMaterialView = false;
      this.homeInlineToolbar.setMaterialsViewOpen(false);
      this.cdr.detectChanges();
    }
    if (this.showExploreView && !toMaterial) {
      this.showExploreView = false;
      this.homeInlineToolbar.setExploreViewOpen(false);
      this.cdr.detectChanges();
    }
    if (this.showScheduleClassView && !toMaterial) {
      this.closeScheduleClassModal(false);
    }
    if (this.showForumView && !toMaterial) {
      this.closeForumModal(false);
    }
  }

  // ── Feedback Grace Period Countdown ──────────────────────
  private updateFeedbackGraceCountdown() {
    // Clear existing interval
    if (this.feedbackGraceInterval) {
      clearInterval(this.feedbackGraceInterval);
      this.feedbackGraceInterval = null;
    }

    if (this.pendingFeedback.length === 0) {
      this.feedbackBannerSubtitle = '';
      this.feedbackGraceExpired = false;
      return;
    }

    // Find the oldest pending feedback's createdAt
    const oldestCreatedAt = Math.min(
      ...this.pendingFeedback.map(f => new Date(f.createdAt).getTime())
    );
    const deadline = oldestCreatedAt + Tab1Page.FEEDBACK_GRACE_MS;

    // Helper to compute display
    const tick = () => {
      const now = Date.now();
      const remainingMs = deadline - now;

      if (remainingMs <= 0) {
        this.feedbackGraceExpired = true;
        this.feedbackBannerSubtitle = this.translateService.instant('HOME.FEEDBACK_HIDDEN_UNTIL_COMPLETE');
        if (this.feedbackGraceInterval) {
          clearInterval(this.feedbackGraceInterval);
          this.feedbackGraceInterval = null;
        }
        return;
      }

      this.feedbackGraceExpired = false;
      const totalSec = Math.floor(remainingMs / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);

      if (h > 0) {
        this.feedbackBannerSubtitle = this.translateService.instant('HOME.FEEDBACK_COMPLETE_WITHIN_HM', { h, m: m.toString().padStart(2, '0') });
      } else {
        this.feedbackBannerSubtitle = this.translateService.instant('HOME.FEEDBACK_COMPLETE_WITHIN_M', { m });
      }
    };

    // Run immediately, then every 30 seconds (no need for per-second here)
    tick();
    this.feedbackGraceInterval = setInterval(tick, 30000);
  }

  ngOnDestroy() {
    document.body.classList.remove('cm-desktop-modal-open');
    this._darkModeObserver?.disconnect();
    this.translationSub?.unsubscribe();
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    if (this.feedbackGraceInterval) {
      clearInterval(this.feedbackGraceInterval);
    }
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
    }
    
    // Stop dynamic card refresh interval
    this.stopDynamicCardRefreshInterval();
    
    // Remove earnings visibility handler
    if (this._earningsVisibilityHandler) {
      document.removeEventListener('visibilitychange', this._earningsVisibilityHandler);
      this._earningsVisibilityHandler = null;
    }
    
    // Reset dynamic card ready flag so it animates in next time
    this.dynamicCardReady = false;
    
    this.tutorGrowthService.destroy();
    this._growthInsightsLoaded = false;

    this.destroy$.next();

    this.destroy$.complete();
  }
  
  /**
   * Start the periodic dynamic card refresh interval
   * This refreshes tutor availability cards every 5 minutes while user is on the page
   */
  private _visibilityChangeHandler: (() => void) | null = null;
  
  private startDynamicCardRefreshInterval() {
    // Clear any existing interval first
    this.stopDynamicCardRefreshInterval();
    
    
    
    this._dynamicCardRefreshInterval = setInterval(() => {
      
      
      this.loadAdditionalDynamicCards();
      this._lastDynamicCardRefresh = Date.now();
    }, this.DYNAMIC_CARD_REFRESH_INTERVAL);
    
    // Also refresh when the page becomes visible (handles browser tab switching)
    if (!this._visibilityChangeHandler) {
      this._visibilityChangeHandler = () => {
        if (document.visibilityState === 'visible') {
          const timeSinceLastRefresh = Date.now() - this._lastDynamicCardRefresh;
          // If more than 30 seconds since last refresh, refresh now
          if (timeSinceLastRefresh > 30000) {
            
            this.loadAdditionalDynamicCards();
            this._lastDynamicCardRefresh = Date.now();
          }
        }
      };
      document.addEventListener('visibilitychange', this._visibilityChangeHandler);
    }
  }
  
  /**
   * Stop the periodic dynamic card refresh interval
   */
  private stopDynamicCardRefreshInterval() {
    if (this._dynamicCardRefreshInterval) {
      
      clearInterval(this._dynamicCardRefreshInterval);
      this._dynamicCardRefreshInterval = null;
    }
    
    // Also remove visibility change handler
    if (this._visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this._visibilityChangeHandler);
      this._visibilityChangeHandler = null;
    }
  }
  
  /**
   * Set up real-time socket listeners for tutor availability updates (students only)
   * This enables instant dynamic card updates when tutors add new availability
   */
  private _tutorAvailabilityListenersSetup = false;
  private setupTutorAvailabilitySocketListeners() {
    // Prevent duplicate listeners
    if (this._tutorAvailabilityListenersSetup) {
      
      return;
    }
    this._tutorAvailabilityListenersSetup = true;
    
    
    
    // Listen for targeted tutor availability updates
    this.websocketService.on('tutor_availability_updated').pipe(
      takeUntil(this.destroy$)
    ).subscribe((data: any) => {
      
      // Immediately refresh dynamic cards when a tutor adds availability
      this.loadAdditionalDynamicCards();
      this._lastDynamicCardRefresh = Date.now();
    });
    
    // Also listen for the general broadcast event
    this.websocketService.on('tutor_availability_changed').pipe(
      takeUntil(this.destroy$)
    ).subscribe((data: any) => {
      
      // Refresh dynamic cards
      this.loadAdditionalDynamicCards();
      this._lastDynamicCardRefresh = Date.now();
    });
  }

  // 🎨 DEV: Preview the new lesson summary modal with mock data
  async previewLessonSummaryModal() {
    const modal = await this.modalCtrl.create({
      component: LessonSummaryComponent,
      componentProps: {
        lessonId: 'mock-lesson-id',
        // Pass mock analysis directly to skip API call
        mockAnalysis: this.getMockAnalysisData()
      },
      cssClass: 'fullscreen-modal'
    });

    await modal.present();
  }
  
  // ====================
  // SMART ISLAND EVENT HELPERS
  // ====================

  // 1. Show tutor availability
  showTutorOnline(tutor: any) {
    if (!this.smartIsland) return;
    
    this.smartIsland.addMoment({
      type: 'tutor-online',
      priority: IslandPriority.HIGH,
      avatarUrl: tutor.picture,
      title: `${tutor.name} is online`,
      subtitle: 'Book a lesson now',
      gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
      action: () => {
        this.router.navigate(['/tutor-profile', tutor._id]);
      },
      duration: 6000
    });
  }

  // 2. Milestone celebration
  showMilestone(type: 'vocabulary' | 'lessons' | 'streak' | 'level', value: number | string) {
    if (!this.smartIsland) return;
    
    const milestones = {
      vocabulary: {
        emoji: '📚',
        title: `${value} words learned!`,
        subtitle: 'You\'re expanding your vocabulary'
      },
      lessons: {
        emoji: '🎓',
        title: `${value} lessons completed!`,
        subtitle: 'Keep up the amazing progress'
      },
      streak: {
        emoji: '🔥',
        title: `${value}-day streak!`,
        subtitle: 'You\'re on fire'
      },
      level: {
        emoji: '⭐',
        title: `Level up: ${value}`,
        subtitle: 'New achievements unlocked'
      }
    };
    
    const milestone = milestones[type];
    
    this.smartIsland.addMoment({
      type: 'milestone',
      priority: IslandPriority.MEDIUM,
      emoji: milestone.emoji,
      title: milestone.title,
      subtitle: milestone.subtitle,
      gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
      duration: 5000
    });
  }

  // 3. Quick lesson rating (after lesson ends)
  showQuickRating(lessonId: string, tutorName: string, tutorPicture?: string) {
    if (!this.smartIsland) return;
    
    this.smartIsland.addMoment({
      type: 'rating',
      priority: IslandPriority.HIGH,
      avatarUrl: tutorPicture,
      icon: tutorPicture ? undefined : 'star-outline',
      title: `Rate your lesson`,
      subtitle: `with ${tutorName}`,
      gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
      action: () => {
        // Open rating modal or navigate to lesson details
        this.openLessonRating(lessonId);
      },
      duration: 8000  // Longer duration for important feedback
    });
  }

  // 4. Tutor shared content
  showTutorSharedContent(tutor: any, contentType: 'resource' | 'homework' | 'note', contentId?: string) {
    if (!this.smartIsland) return;
    
    const content = {
      resource: { icon: '📎', text: 'shared a resource' },
      homework: { icon: '✏️', text: 'assigned homework' },
      note: { icon: '📝', text: 'sent you a note' }
    };
    
    const item = content[contentType];
    
    this.smartIsland.addMoment({
      type: 'tutor-shared',
      priority: IslandPriority.HIGH,
      avatarUrl: tutor.picture,
      title: `${tutor.name} ${item.text}`,
      subtitle: 'Tap to view',
      gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
      action: () => {
        // Navigate to content or open modal
        this.viewTutorContent(tutor._id, contentType, contentId);
      },
      duration: 7000
    });
  }

  // 5. Smart idle nudge (re-engagement)
  showIdleNudge(daysSinceLastLesson: number) {
    if (!this.smartIsland) return;
    
    this.smartIsland.addMoment({
      type: 'idle-nudge',
      priority: IslandPriority.LOW,
      emoji: '💭',
      title: `${daysSinceLastLesson} days since your last lesson`,
      subtitle: 'Ready to continue learning?',
      gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
      action: () => {
        this.router.navigate(['/tabs/find-tutors']);
      },
      duration: 6000
    });
  }

  // 6. Smart recommendation
  showRecommendation(message: string, type: string = 'general') {
    if (!this.smartIsland) return;
    
    this.smartIsland.addMoment({
      type: 'recommendation',
      priority: IslandPriority.MEDIUM,
      emoji: '💡',
      title: message,
      subtitle: 'Based on your progress',
      gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
      action: () => {
        // Navigate based on recommendation type
        this.handleRecommendation(type);
      },
      duration: 6000
    });
  }

  // Helper: Open lesson rating
  private openLessonRating(lessonId: string) {
    
    // TODO: Implement rating modal/navigation
    this.showTestToast('Rating feature coming soon!');
  }

  // Helper: View tutor content
  private viewTutorContent(tutorId: string, contentType: string, contentId?: string) {
    
    // TODO: Implement content viewing
    this.showTestToast('Content viewing coming soon!');
  }

  // Helper: Handle recommendation
  private handleRecommendation(type: string) {
    
    switch (type) {
      case 'conversation':
        this.router.navigate(['/tabs/find-tutors'], { queryParams: { filter: 'conversation' } });
        break;
      case 'grammar':
        this.router.navigate(['/tabs/find-tutors'], { queryParams: { filter: 'grammar' } });
        break;
      default:
        this.router.navigate(['/tabs/find-tutors']);
    }
  }

  // Helper: Check idle status
  checkIdleStatus() {
    if (!this.currentUser || this.currentUser.userType !== 'student') return;
    
    const lastLessonDate = this.getLastLessonDate();
    if (lastLessonDate) {
      const daysSince = Math.floor((Date.now() - lastLessonDate.getTime()) / (1000 * 60 * 60 * 24));
      // Show nudge if 7+ days and they have lessons
      if (daysSince >= 7 && this.lessons.length > 0) {
        setTimeout(() => {
          this.showIdleNudge(daysSince);
        }, 5000); // Show after 5 seconds on page
      }
    }
  }

  // Helper: Get last lesson date
  private getLastLessonDate(): Date | null {
    if (this.lessons.length === 0) return null;
    const completedLessons = this.lessons.filter(l => {
      const endTime = new Date(l.endTime);
      return endTime < new Date() && l.status !== 'cancelled';
    });
    if (completedLessons.length === 0) return null;
    const sorted = [...completedLessons].sort((a, b) => 
      new Date(b.endTime).getTime() - new Date(a.endTime).getTime()
    );
    return new Date(sorted[0].endTime);
  }

  // Helper: Get most recent tutor from completed lessons
  private getMostRecentTutor(): any {
    if (this.lessons.length === 0) return null;
    
    const completedLessons = this.lessons.filter(l => {
      const endTime = new Date(l.endTime);
      return endTime < new Date() && l.status !== 'cancelled' && l.tutorId;
    }).sort((a, b) => 
      new Date(b.endTime).getTime() - new Date(a.endTime).getTime()
    );
    
    if (completedLessons.length === 0) return null;
    return completedLessons[0].tutorId;
  }
  
  // Helper: Get list of recent tutors (all unique tutors) from completed lessons
  getRecentTutors(): any[] {
    if (this.lessons.length === 0) return [];
    
    const completedLessons = this.lessons.filter(l => {
      const endTime = new Date(l.endTime);
      return endTime < new Date() && l.status !== 'cancelled' && l.tutorId;
    }).sort((a, b) => 
      new Date(b.endTime).getTime() - new Date(a.endTime).getTime()
    );
    
    if (completedLessons.length === 0) return [];
    
    // Get ALL unique tutors
    const uniqueTutors = new Map();
    for (const lesson of completedLessons) {
      const tutorId = lesson.tutorId._id || lesson.tutorId;
      if (!uniqueTutors.has(String(tutorId))) {
        uniqueTutors.set(String(tutorId), lesson.tutorId);
      }
    }
    
    return Array.from(uniqueTutors.values());
  }
  
  // Helper: Get tutors for display (max 5)
  getRecentTutorsForDisplay(): any[] {
    const allTutors = this.getRecentTutors();
    return allTutors.slice(0, 5);
  }
  
  // Helper: Check if there are more than 5 tutors
  hasMoreTutors(): boolean {
    return this.getRecentTutors().length > 5;
  }
  
  // Navigate to all tutors (tutor search)
  navigateToAllTutors() {
    this.router.navigate(['/tabs/tutor-search']);
  }
  
  // Show recent tutors list for booking
  async showRecentTutors() {
    const recentTutors = this.getRecentTutors();
    
    if (recentTutors.length === 0) {
      // Shouldn't happen, but fallback to search
      this.router.navigate(['/tabs/tutor-search']);
      return;
    }
    
    // Navigate to tutor search (it will show all tutors, but user can easily find recent ones)
    this.router.navigate(['/tabs/tutor-search']);
  }
  
  // Navigate to tutor profile for booking
  navigateToTutorProfile(tutor: any) {
    const tutorId = tutor._id || tutor.id;
    if (tutorId) {
      this.router.navigate(['/tabs/tutor-search/tutor-profile', tutorId]);
    }
  }
  
  // Format tutor name for tooltip: "FirstName L."
  getTutorTooltipName(tutor: any): string {
    if (!tutor) return '';
    
    const firstName = tutor.firstName || (tutor.name ? tutor.name.split(' ')[0] : '');
    const lastName = tutor.lastName || (tutor.name && tutor.name.split(' ').length > 1 ? tutor.name.split(' ')[tutor.name.split(' ').length - 1] : '');
    
    if (lastName) {
      return `${firstName} ${lastName.charAt(0).toUpperCase()}.`;
    }
    return firstName;
  }
  
  // Open tutor availability viewer for a specific tutor
  openTutorAvailability(tutor: any) {
    
    
    // Format tutor name properly
    let tutorName = '';
    if (tutor.firstName && tutor.lastName) {
      tutorName = `${tutor.firstName} ${tutor.lastName}`;
    } else if (tutor.firstName) {
      tutorName = tutor.firstName;
    } else if (tutor.name) {
      tutorName = tutor.name;
    } else {
      tutorName = tutor.email || 'Tutor';
    }
    
    this.selectedTutorForBooking = {
      ...tutor,
      name: tutorName
    };
    this.isTutorBookingModalOpen = true;
    
  }
  
  // Close tutor booking modal
  closeTutorBookingModal() {
    
    this.isTutorBookingModalOpen = false;
    this.selectedTutorForBooking = null;
  }
  
  // Navigate to completed lessons page
  navigateToCompletedLessons() {
    this.router.navigate(['/tabs/lessons']);
  }
  
  loadLearningPlan(language: string) {
    this.learningPlanService.getPlan(language).pipe(take(1)).subscribe({
      next: (res) => {
        if (res.success && res.plan) {
          const plan = res.plan;
          this.learningPlanData = plan;
          this.learningPlanCurrentPhase = plan.currentPhaseIndex + 1;
          this.learningPlanTotalPhases = plan.phases.length;
          const activePhase = plan.phases[plan.currentPhaseIndex];
          this.learningPlanPhaseTitle = activePhase?.title || '';
          this.learningPlanSummary = plan.studentSummary || '';
          this.learningPlanNextFocus = plan.nextLessonFocus || '';
          this.learningPlanPhaseDots = plan.phases.map(
            (p: any) => p.status === 'completed' || p.status === 'active'
          );
          this.cdr.detectChanges();
        }
      },
      error: () => {}
    });
  }

  loadHomePracticeMaterials(language: string) {
    this.materialService.getRecommendedMaterials(language).pipe(take(1)).subscribe({
      next: (res: any) => {
        if (res.success) {
          this.homePracticeMaterials = (res.materials || []).slice(0, 6);
          this.cdr.detectChanges();
        }
      },
      error: () => {}
    });
  }

  navigateToMaterial(materialId: string) {
    this.router.navigate(['/material', materialId]);
  }

  navigateToMyLibrary() {
    this.router.navigate(['/my-library']);
  }

  trackByMaterialId(index: number, mat: any): string {
    return mat._id;
  }

  navigateToProgressPlan() {
    this.router.navigate(['/tabs/progress']);
  }

  navigateToExplore() {
    this._savedScrollBeforeExplore = this._scrollElRef?.scrollTop || 0;
    this.showExploreView = true;
    this.homeInlineToolbar.setExploreViewOpen(true);
    this.cdr.detectChanges();
    this.ionContent?.scrollToTop(0);
  }

  /** Tutors open schedule wizard in a modal; students open Explore. */
  onClassesQuickAction(): void {
    if (this.isTutorUser) {
      this.openScheduleClassModal();
    } else {
      this.navigateToExplore();
    }
  }

  openScheduleClassModal(): void {
    this._savedScrollBeforeSchedule = this._scrollElRef?.scrollTop || 0;
    this.showScheduleClassView = true;
    this.scheduleClassModalReady = false;
    this.scheduleClassBackdropVisible = false;
    this.cdr.detectChanges();
    if (this.isMobile) {
      this.ionContent?.scrollToTop(0);
      setTimeout(() => {
        this.scheduleClassModalRef?.enterHubListMode();
        this.cdr.markForCheck();
      }, 0);
      return;
    }
    document.body.classList.add('cm-desktop-modal-open');
    requestAnimationFrame(() => {
      this.scheduleClassBackdropVisible = true;
      this.cdr.detectChanges();
    });
    setTimeout(() => {
      this.scheduleClassModalReady = true;
      this.scheduleClassModalRef?.enterHubListMode();
      this.cdr.detectChanges();
    }, 350);
  }

  /** @param restoreScroll pass false when route already changed */
  closeScheduleClassModal(restoreScroll = true): void {
    this.scheduleClassModalReady = false;
    this.scheduleClassBackdropVisible = false;
    this.showScheduleClassView = false;
    document.body.classList.remove('cm-desktop-modal-open');
    this.cdr.detectChanges();
    if (restoreScroll && this._scrollElRef) {
      this._scrollElRef.scrollTop = this._savedScrollBeforeSchedule;
    }
  }

  onScheduleClassGoBack(): void {
    this.closeScheduleClassModal(true);
  }

  /** OnPush: child wizard step / labels updated. */
  onScheduleClassWizardLayoutChange(): void {
    this.cdr.markForCheck();
  }

  onScheduleClassModalBackdropClick(ev: MouseEvent): void {
    if ((ev.target as HTMLElement).classList.contains('cm-modal-backdrop')) {
      this.onScheduleClassGoBack();
    }
  }

  onScheduleClassBrowsePublic(): void {
    this.closeScheduleClassModal(true);
    this.navigateToExplore();
  }

  onScheduleClassCreated(): void {
    this.closeScheduleClassModal(true);
  }

  onScheduleClassSaved(): void {
    this._lastDataFetch = 0;
    this._cachedFirstLessonHash = '';
    this._cachedFirstLesson = undefined;
    this._cachedTimelineEventsHash = '';
    this._cachedTimelineEvents = [];
    this.loadLessons(false);
  }

  onTutorHubListMutated(): void {
    this.onScheduleClassSaved();
  }

  navigateToForum(): void {
    this.openForumModal();
  }

  openForumModal(): void {
    this._savedScrollBeforeForum = this._scrollElRef?.scrollTop || 0;
    this.showForumView = true;
    this.forumModalReady = false;
    this.forumBackdropVisible = false;
    this.cdr.detectChanges();
    if (this.isMobile) {
      this.ionContent?.scrollToTop(0);
      return;
    }
    document.body.classList.add('cm-desktop-modal-open');
    requestAnimationFrame(() => {
      this.forumBackdropVisible = true;
      this.cdr.detectChanges();
    });
    setTimeout(() => {
      this.forumModalReady = true;
      this.cdr.detectChanges();
    }, 350);
  }

  closeForumModal(restoreScroll = true): void {
    this.forumModalReady = false;
    this.forumBackdropVisible = false;
    this.showForumView = false;
    document.body.classList.remove('cm-desktop-modal-open');
    this.cdr.detectChanges();
    if (restoreScroll && this._scrollElRef) {
      this._scrollElRef.scrollTop = this._savedScrollBeforeForum;
    }
  }

  onForumGoBack(): void {
    this.closeForumModal(true);
  }

  onForumModalBackdropClick(ev: MouseEvent): void {
    if ((ev.target as HTMLElement).classList.contains('cm-modal-backdrop')) {
      this.onForumGoBack();
    }
  }

  navigateToCreateMaterial(event?: MouseEvent) {
    const srcEl = event
      ? (event.currentTarget as HTMLElement || event.target as HTMLElement)
      : null;
    const srcRect = srcEl?.getBoundingClientRect() ?? null;

    this._savedScrollBeforeMaterial = this._scrollElRef?.scrollTop || 0;
    this.createMaterialModalExpanded = false;
    this.modalSidebarTab = 'materials';
    this.showCreateMaterialView = true;
    this.createMaterialModalReady = false;
    this.createMaterialBackdropVisible = false;
    this.homeInlineToolbar.setMaterialsViewOpen(true);
    this.cdr.detectChanges();
    if (this.isMobile) this.ionContent?.scrollToTop(0);

    if (!this.isMobile) {
      document.body.classList.add('cm-desktop-modal-open');
      requestAnimationFrame(() => {
        this.createMaterialBackdropVisible = true;
        this.cdr.detectChanges();
      });
      setTimeout(() => {
        this.createMaterialModalReady = true;
        this.cdr.detectChanges();
      }, 350);
      return;
    }
    if (!srcRect) return;

    const dest = document.querySelector('.cm-library') as HTMLElement;
    if (!dest) return;

    dest.style.transition = 'none';
    dest.style.opacity = '0';

    const destRect = dest.getBoundingClientRect();
    if (!destRect.width) { dest.style.transition = ''; dest.style.opacity = ''; return; }

    const initH = srcRect.height;
    const initTop = srcRect.top;

    const dur = '0.32s';
    const ease = 'cubic-bezier(0.32,0.72,0,1)';

    // Backdrop dim for depth
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0',
      zIndex: '9999', pointerEvents: 'none',
      backgroundColor: 'rgba(0,0,0,0)', 
      transition: `background-color ${dur} ${ease}`,
    });
    document.body.appendChild(backdrop);

    const clone = document.createElement('div');
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${srcRect.left}px`,
      top: `${initTop}px`,
      width: `${srcRect.width}px`,
      height: `${initH}px`,
      zIndex: '10000',
      pointerEvents: 'none',
      boxSizing: 'border-box',
      backgroundColor: '#ffffff',
      border: '1px solid rgba(0,0,0,0.08)',
      borderRadius: '10px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      transition: `left ${dur} ${ease}, top ${dur} ${ease}, width ${dur} ${ease}, height ${dur} ${ease}, border-radius ${dur} ${ease}, box-shadow 0.4s ease, border-color 0.3s ease`,
      overflow: 'hidden',
    });
    document.body.appendChild(clone);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        backdrop.style.backgroundColor = 'rgba(0,0,0,0.04)';

        clone.style.left = `${destRect.left}px`;
        clone.style.top = `${destRect.top}px`;
        clone.style.width = `${destRect.width}px`;
        clone.style.height = `${destRect.height}px`;
        clone.style.borderRadius = '18px';
        clone.style.boxShadow = '0 2px 16px rgba(0,0,0,0.08)';
        clone.style.borderColor = 'rgba(0,0,0,0.06)';

        setTimeout(() => {
          dest.style.transition = 'opacity 0.15s ease';
          dest.style.opacity = '1';
          backdrop.style.transition = 'opacity 0.15s ease';
          backdrop.style.opacity = '0';
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (clone.parentNode) clone.remove();
              if (backdrop.parentNode) backdrop.remove();
              setTimeout(() => { dest.style.transition = ''; dest.style.opacity = ''; }, 180);
            });
          });
        }, 300);
      });
    });
  }

  
  // Open modal showing all tutors
  openAllTutorsModal() {
    this.isAllTutorsModalOpen = true;
  }
  
  // Close all tutors modal
  closeAllTutorsModal() {
    this.isAllTutorsModalOpen = false;
  }

  // Helper: Check if student has no upcoming lessons and nudge them
  checkNoUpcomingLessons() {
    if (!this.currentUser || this.currentUser.userType !== 'student') return;
    
    const now = new Date().getTime();
    const upcomingLessons = this.lessons.filter(l => {
      const startTime = new Date(l.startTime).getTime();
      return startTime > now && l.status === 'scheduled';
    });
    
    // Only show if:
    // 1. No upcoming lessons
    // 2. They have lesson history (not brand new)
    // 3. It's been at least 3 days since their last completed lesson
    const lastLessonDate = this.getLastLessonDate();
    const daysSinceLast = lastLessonDate 
      ? Math.floor((Date.now() - lastLessonDate.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    
    if (upcomingLessons.length === 0 && this.lessons.length > 0 && daysSinceLast >= 3) {
      
      setTimeout(() => {
        this.showNoUpcomingLessonsNudge();
      }, 10000); // Show after 10 seconds on page
    }
  }

  // Show nudge when student has no upcoming lessons
  showNoUpcomingLessonsNudge() {
    if (!this.smartIsland) return;
    
    // Try to get their most recent tutor for personalization
    const recentTutor = this.getMostRecentTutor();
    
    if (recentTutor) {
      this.smartIsland.addMoment({
        type: 'recommendation',
        priority: IslandPriority.MEDIUM, // Higher than idle nudge
        avatarUrl: recentTutor.picture,
        title: 'No upcoming lessons',
        subtitle: `Book with ${recentTutor.name}?`,
        gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
        action: () => {
          this.router.navigate(['/tutor-profile', recentTutor._id]);
        },
        duration: 6000
      });
    } else {
      this.smartIsland.addMoment({
        type: 'recommendation',
        priority: IslandPriority.MEDIUM,
        emoji: '📅',
        title: 'No upcoming lessons',
        subtitle: 'Schedule a lesson to keep learning',
        gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
        action: () => {
          this.router.navigate(['/tabs/find-tutors']);
        },
        duration: 6000
      });
    }
  }
  
  // Test Smart Island with mock data
  testSmartIsland() {
    if (!this.smartIsland) {
      console.error('Smart Island not available');
      return;
    }
    
    
    
    // Clear all existing moments first
    this.smartIsland.clearAll();
    
    // Optional: Clear dismissal history for testing (comment out to test persistence)
    // this.smartIsland.clearDismissalHistory();
    
    // Queue diverse moments to test all functionality (white background)
    const moments = [
      // 1. URGENT: Lesson Starting Soon (transient)
      {
        type: 'lesson-soon' as const,
        priority: IslandPriority.URGENT,
        persistent: false, // Will expire after showing
        avatarUrl: 'https://i.pravatar.cc/150?img=48',
        title: 'Lesson in 3 min',
        subtitle: 'with Carlos Mendez',
        emoji: '⏰',
        gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
        action: () => this.showTestToast('Joining lesson...'),
        duration: 3000
      },
      // 2. HIGH: Class Invitation (PERSISTENT - will re-queue until acted upon)
      {
        type: 'invitation' as const,
        priority: IslandPriority.HIGH,
        persistent: true, // Stays until accepted/declined
        id: 'test-invitation-1',
        avatarUrl: 'https://i.pravatar.cc/150?img=29',
        title: 'Sofia invited you',
        subtitle: 'Advanced Grammar Class',
        gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
        action: () => {
          this.showTestToast('Opening invitation...');
          // Simulate accepting - remove the moment
          setTimeout(() => {
            this.smartIsland.removeMoment('test-invitation-1');
            this.showTestToast('Invitation accepted! ✅');
          }, 1500);
        },
        duration: 4000
      },
      // 3. HIGH: Quick Rating (PERSISTENT)
      {
        type: 'rating' as const,
        priority: IslandPriority.HIGH,
        persistent: true, // Stays until rated
        id: 'test-rating-1',
        avatarUrl: 'https://i.pravatar.cc/150?img=33',
        title: 'Rate your lesson',
        subtitle: 'with Pedro Martinez',
        gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
        action: () => {
          this.showTestToast('Opening rating...');
          // Simulate rating - remove the moment
          setTimeout(() => {
            this.smartIsland.removeMoment('test-rating-1');
            this.showTestToast('Rating submitted! ⭐⭐⭐⭐⭐');
          }, 1500);
        },
        duration: 4000
      },
      // 4. HIGH: Tutor Shared Content (PERSISTENT)
      {
        type: 'tutor-shared' as const,
        priority: IslandPriority.HIGH,
        persistent: true, // Stays until viewed
        id: 'test-shared-content-1',
        avatarUrl: 'https://i.pravatar.cc/150?img=47',
        title: 'Ana shared a resource',
        subtitle: 'Tap to view',
        gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
        action: () => {
          this.showTestToast('Opening resource...');
          setTimeout(() => {
            this.smartIsland.removeMoment('test-shared-content-1');
            this.showTestToast('Resource viewed! 📎');
          }, 1500);
        },
        duration: 4000
      },
      // 5. MEDIUM: Milestone (transient - show once, tracked by dismissal)
      {
        type: 'milestone' as const,
        priority: IslandPriority.MEDIUM,
        persistent: false,
        emoji: '📚',
        title: '100 words learned!',
        subtitle: 'You\'re expanding your vocabulary',
        gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
        duration: 3000
        // Note: No ID needed - auto-generated as "milestone:100 words learned!"
        // Once dismissed, won't show again for 7 days
      },
      // 6. MEDIUM: Streak (transient, tracked by dismissal)
      {
        type: 'milestone' as const,
        priority: IslandPriority.MEDIUM,
        persistent: false,
        emoji: '🔥',
        title: '10-day streak!',
        subtitle: 'You\'re on fire',
        gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
        duration: 3000
        // Note: Auto-generated ID "milestone:10-day streak!"
        // Once dismissed, won't show again for 7 days
      },
      // 7. LOW: Idle Nudge (transient, tracked by dismissal)
      {
        type: 'idle-nudge' as const,
        priority: IslandPriority.LOW,
        persistent: false,
        emoji: '💭',
        title: '7 days since your last lesson',
        subtitle: 'Ready to continue learning?',
        gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
        action: () => this.showTestToast('Opening tutors...'),
        duration: 3000
        // Note: Auto-generated ID "idle-nudge:7 days since your last lesson"
        // Once dismissed, won't show again for 7 days
      }
    ];
    
    // Add all moments (dismissal tracking will filter out already-dismissed ones)
    moments.forEach(moment => this.smartIsland.addMoment(moment));
    
    this.showTestToast(`Testing ${moments.length} events! 3 persistent, 4 transient 🌟\nDismissed moments won't reappear for 7 days.`);
  }
  
  async showTestToast(message: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'bottom',
      color: 'dark'
    });
    await toast.present();
  }

  private getMockAnalysisData() {
    return {
      _id: 'mock-analysis-id',
      lessonId: 'mock-lesson-id',
      studentId: 'mock-student-id',
      tutorId: 'mock-tutor-id',
      language: 'Spanish',
      status: 'completed',
      
      // Student Summary
      studentSummary: "You told a great story about bumping into your friend at the supermarket! You said 'me encontré con una amiga' (I met a friend) which was perfect. However, you said 'acompañarle' when it should be 'acompañarla' since you're referring to your female friend. Also, 'desde hace' should be 'desde hacía' in past context.",
      
      // Overall Assessment
      overallAssessment: {
        proficiencyLevel: 'B1',
        confidence: 85,
        summary: 'Discussed going to the supermarket, meeting a friend, and declining coffee because already had too much.',
        progressFromLastLesson: 'Grammar accuracy decreased from 75% to 72%. Tense errors increased from 2 to 4.'
      },
      
      // Top Errors (Priority)
      topErrors: [
        {
          rank: 1,
          issue: 'Tense consistency',
          impact: 'high',
          occurrences: 8,
          teachingPriority: 'Focus on past tense forms, especially imperfect vs preterite'
        },
        {
          rank: 2,
          issue: 'Pronoun agreement',
          impact: 'medium',
          occurrences: 3,
          teachingPriority: 'Practice gender agreement with pronouns'
        }
      ],
      
      // Error Patterns (Detailed)
      errorPatterns: [
        {
          pattern: 'Tense consistency',
          frequency: 8,
          severity: 'high',
          examples: [
            {
              original: 'no la veo desde mucho tiempo',
              corrected: 'no la veía desde hacía mucho tiempo',
              explanation: 'The past tense "veía" should be used with "hacía" for past context.'
            },
            {
              original: 'yo quiso',
              corrected: 'yo quería',
              explanation: 'Corrected to the imperfect tense for expressing a past intention.'
            },
            {
              original: 'estaba muy llenado',
              corrected: 'estaba muy lleno',
              explanation: 'The adjective "lleno" (full) should be used instead of past participle "llenado".'
            }
          ],
          practiceNeeded: 'Focus on distinguishing between preterite and imperfect tenses in storytelling'
        },
        {
          pattern: 'Pronoun agreement',
          frequency: 3,
          severity: 'medium',
          examples: [
            {
              original: 'acompañarle',
              corrected: 'acompañarla',
              explanation: 'The pronoun should be feminine "la" to match "una amiga" (a female friend).'
            },
            {
              original: 'no miraba',
              corrected: 'no veía',
              explanation: 'The verb "ver" (to see) is more appropriate than "mirar" (to look at) in this context.'
            }
          ],
          practiceNeeded: 'Practice gender agreement with direct and indirect object pronouns'
        }
      ],
      
      // Corrected Excerpts (Before/After)
      correctedExcerpts: [
        {
          context: 'Talking about meeting a friend at the supermarket',
          original: 'me encontré con una amiga que no veía desde hace mucho tiempo y ella me preguntó si yo podía acompañarle a comprar unas cosas',
          corrected: 'me encontré con una amiga que no veía desde hacía mucho tiempo y ella me preguntó si yo podía acompañarla a comprar unas cosas',
          keyCorrections: ['desde hace → desde hacía', 'acompañarle → acompañarla']
        },
        {
          context: 'Describing a cold day at work',
          original: 'yo estaba caminando a trabajo y estaba muy frío como 10 grados',
          corrected: 'estaba caminando al trabajo y hacía mucho frío, como 10 grados',
          keyCorrections: ['a trabajo → al trabajo', 'estaba frío → hacía frío']
        }
      ],
      
      // Strengths
      strengths: [
        'Natural use of colloquialisms like "pues" and "o sea"',
        'Good use of vocabulary related to daily activities',
        'Ability to narrate events clearly',
        'Confident conversational flow and engagement',
        'Proper use of reflexive verbs in most contexts'
      ],
      
      // Areas for Improvement
      areasForImprovement: [
        'Tense consistency',
        'Pronoun agreement',
        'Preposition usage'
      ],
      
      // Grammar Analysis
      grammarAnalysis: {
        accuracyScore: 75,
        mistakeTypes: [
          {
            type: 'Tense Consistency',
            examples: ['yo quiso → quise', 'no la veo → no veía'],
            frequency: 8,
            severity: 'high'
          },
          {
            type: 'Pronoun Agreement',
            examples: ['acompañarle → acompañarla'],
            frequency: 3,
            severity: 'medium'
          }
        ],
        suggestions: ['Focus on past tense forms and practice with storytelling exercises.']
      },
      
      // Vocabulary Analysis
      vocabularyAnalysis: {
        uniqueWordCount: 80,
        vocabularyRange: 'moderate',
        suggestedWords: ['acordarse (to remember)', 'esperar (to wait)'],
        advancedWordsUsed: ['acompañar', 'urgente', 'encontrarse']
      },
      
      // Fluency Analysis
      fluencyAnalysis: {
        speakingSpeed: 'moderate',
        pauseFrequency: 'occasional',
        fillerWords: {
          count: 2,
          examples: ['uh-huh', 'ok']
        },
        overallFluencyScore: 70
      },
      
      // Pronunciation Assessment (NEW - Azure Speech)
      pronunciationAnalysis: {
        overallScore: 78,
        accuracyScore: 82,
        fluencyScore: 75,
        prosodyScore: 76,
        completenessScore: 85,
        mispronunciations: [
          {
            word: 'acompañarle',
            score: 45,
            errorType: 'Mispronunciation',
            problematicPhonemes: ['ñ', 'le']
          },
          {
            word: 'encontré',
            score: 58,
            errorType: 'Mispronunciation',
            problematicPhonemes: ['é']
          },
          {
            word: 'supermercado',
            score: 52,
            errorType: 'Mispronunciation',
            problematicPhonemes: ['r', 'c']
          }
        ],
        segmentsAssessed: 8,
        totalSegments: 40,
        targetLanguageSegments: 24,
        samplingRate: 0.20
      },
      
      // Recommendations
      topicsDiscussed: ['Going to the supermarket', 'Meeting a friend', 'Declining coffee'],
      conversationQuality: 'intermediate',
      recommendedFocus: ['Tense consistency', 'Pronoun agreement', 'Past perfect usage'],
      suggestedExercises: ['Practice storytelling focusing on past events', 'Exercises on pronoun agreement'],
      homeworkSuggestions: [
        'Write 3-4 sentences about the next time you plan to meet your friend, focusing on using the correct gender pronouns.'
      ],
      
      // Progression Metrics
      progressionMetrics: {
        previousProficiencyLevel: 'B1',
        proficiencyChange: 'maintained',
        errorRate: 1.2,
        errorRateChange: -0.3,
        vocabularyGrowth: 8,
        fluencyImprovement: 2,
        grammarAccuracyChange: -3,
        confidenceLevel: 7,
        speakingTimeMinutes: 12,
        complexSentencesUsed: 5,
        keyImprovements: [
          'Expanded vocabulary',
          'Improved confidence in speaking'
        ],
        persistentChallenges: [
          'Tense consistency',
          'Pronoun agreement'
        ]
      },
      
      lessonDate: new Date()
    };
  }

  async openSearchTutors() {
      this.router.navigate(['/tabs/tutor-search']);
  }

  navigateToTutorCalendar() {
    this.router.navigate(['/tabs/tutor-calendar']);
  }

  openAvailabilitySetup() {
    if (!this.isTutor()) {
      return;
    }
    // Navigate to single day availability setup with the selected date
    if (this.selectedDate) {
      const dateStr = this.selectedDate.toISOString().split('T')[0]; // YYYY-MM-DD format
      this.router.navigate(['/tabs/availability-setup', dateStr]);
    } else {
      // Fallback to regular availability setup if no date selected
      this.router.navigate(['/tabs/availability-setup']);
    }
  }

  loadUserStats(forceRefresh = false) {
    
    
    // First, use cached user if available (prevents flashing when returning from profile)
    const cachedUser = this.userService.getCurrentUserValue();
    if (cachedUser) {
      // Apply cached settings immediately to prevent flash
      this.showWalletBalance = cachedUser?.profile?.showWalletBalance || false;
      this.updateWalletDisplay();
      
    }
    
    // Then fetch from server (only if forced or no cached user)
    this.userService.getCurrentUser(forceRefresh).subscribe(user => {
      
      
      if (user) {
        
        // Load show wallet balance setting from database
        this.showWalletBalance = user?.profile?.showWalletBalance || false;
        
        
        // Update display property
        this.updateWalletDisplay();
        
        // Load coaching metrics for tutors
        if (user.userType === 'tutor') {
          
          this.loadCoachingMetrics();
        }
        
        // Load gamification cards for students
        if (user.userType === 'student') {
          
          this.loadGamificationCards();
        }
        this.cdr.markForCheck();
      }
    });
  }
  
  // Load coaching badge metrics (for tutors)
  async loadCoachingMetrics() {
    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/users/coaching-metrics`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );
      
      if (response.success) {
        this.coachingMetrics = response.data;
        
      }
    } catch (error: any) {
      console.error('❌ Error loading coaching metrics:', error);
      // Don't show error to user - just silently fail
    }
  }
  
  // Load gamification data and populate Smart Island cards (for students)
  async loadGamificationCards() {
    
    
    
    
    if (!this.isStudent()) {
      
      return;
    }
    
    // Skip if cards are already loaded (prevents resetting rotation on navigation)
    if (this.dynamicCardsLoaded) {
      
      return;
    }
    
    // Mark as loaded immediately to prevent race conditions
    this.dynamicCardsLoaded = true;
    
    // Clear any existing cards first (only on first load)
    this.smartIslandService.clearAllCards();
    
    
    try {
      
      
      // Fetch student progress data
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/transcription/my-analyses?limit=100`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );
      
      
      
      
      
      if (response.success && response.analyses) {
        const analyses = response.analyses || [];
        const lessonCount = analyses.length;
        
        
        if (analyses.length > 0) {
          
        }
        
        // Add badge card with actual data
        for (const milestone of [
          { count: 5, name: 'Getting Started', icon: 'rocket', color: '#3b82f6', desc: 'Complete 5 lessons' },
          { count: 10, name: 'Committed Learner', icon: 'school', color: '#8b5cf6', desc: 'Complete 10 lessons' },
          { count: 25, name: 'Dedicated Student', icon: 'book', color: '#06b6d4', desc: 'Complete 25 lessons' },
          { count: 50, name: 'Rising Star', icon: 'star', color: '#f59e0b', desc: 'Complete 50 lessons' },
          { count: 100, name: 'Language Master', icon: 'trophy', color: '#fbbf24', desc: 'Complete 100 lessons' }
        ]) {
          if (lessonCount < milestone.count) {
            this.smartIslandService.addGamificationCard('next_badge', {
              name: milestone.name,
              description: milestone.desc,
              icon: milestone.icon,
              color: milestone.color,
              current: lessonCount,
              target: milestone.count
            });
            
            break;
          }
        }
        
        // Add welcome tip ONLY if no lessons yet
        if (lessonCount === 0) {
          this.smartIslandService.addTipCard(
            'Start your journey! Book your first lesson to unlock detailed progress tracking and achievements.',
            'Find Tutors',
            '/tabs/tutor-search'
          );
          
        }
        
        // Calculate streak (only if lessons exist)
        let streak = 0;
        if (analyses.length > 0) {
          const sortedAnalyses = [...analyses].sort((a: any, b: any) => 
            new Date(b.lessonDate).getTime() - new Date(a.lessonDate).getTime()
          );
          
          let currentStreak = 0;
          let lastDate: Date | null = null;
          
          for (const analysis of sortedAnalyses) {
            const lessonDate = new Date(analysis.lessonDate);
            const dayStart = new Date(lessonDate.getFullYear(), lessonDate.getMonth(), lessonDate.getDate());
            
            if (!lastDate) {
              currentStreak = 1;
              lastDate = dayStart;
            } else {
              const dayDiff = Math.floor((lastDate.getTime() - dayStart.getTime()) / (1000 * 60 * 60 * 24));
              if (dayDiff === 1) {
                currentStreak++;
                lastDate = dayStart;
              } else if (dayDiff > 1) {
                break;
              }
            }
          }
          streak = currentStreak;
        }
        
        // Add streak card if applicable
        const today = new Date();
        const lastLessonDate = analyses.length > 0 ? new Date(analyses[0].lessonDate) : null;
        const daysSinceLastLesson = lastLessonDate 
          ? Math.floor((today.getTime() - lastLessonDate.getTime()) / (1000 * 60 * 60 * 24))
          : 999;
        const isStreakAtRisk = streak >= 3 && daysSinceLastLesson >= 1;
        
        if (streak >= 3) {
          this.smartIslandService.addStreakCard(streak, isStreakAtRisk);
          
        }
        
        // Calculate highest level and next level (only if 5+ lessons)
        if (analyses.length >= 5) {
          const levelHierarchy: { [key: string]: number } = {
            'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6
          };
          
          let highestLevel = 'A1';
          let highestValue = 0;
          
          for (const analysis of analyses) {
            if (analysis.level) {
              const value = levelHierarchy[analysis.level] || 0;
              if (value > highestValue) {
                highestValue = value;
                highestLevel = analysis.level;
              }
            }
          }
          
          // Determine next level
          const nextLevelMap: { [key: string]: string } = {
            'A1': 'A2', 'A2': 'B1', 'B1': 'B2', 'B2': 'C1', 'C1': 'C2'
          };
          
          const nextLevel = nextLevelMap[highestLevel];
          if (nextLevel) {
            this.smartIslandService.addGamificationCard('level_progress', {
              currentLevel: highestLevel,
              nextLevel: nextLevel
            });
          }
        }
        
        // Check for pending ratings
        const lessonsPendingRating = analyses.filter((a: any) => !a.studentRating);
        if (lessonsPendingRating.length > 0) {
          const lesson = lessonsPendingRating[0];
          this.smartIslandService.addPendingRatingCard(
            lesson.lessonId || lesson._id,
            lesson.tutorName || 'your tutor',
            lesson.tutorPicture
          );
        }
        
        // Weekly summary (if there are lessons this week)
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const thisWeekAnalyses = analyses.filter((a: any) => 
          new Date(a.lessonDate) >= oneWeekAgo
        );
        
        if (thisWeekAnalyses.length > 0) {
          const speakingMinutes = thisWeekAnalyses.reduce((sum: number, a: any) => 
            sum + (a.speakingTime || 0), 0
          );
          const wordsLearned = thisWeekAnalyses.reduce((sum: number, a: any) => 
            sum + (a.newWords?.length || 0), 0
          );
          
          this.smartIslandService.addWeeklySummaryCard(
            thisWeekAnalyses.length,
            Math.round(speakingMinutes / 60),
            wordsLearned
          );
        }
        
        
        
        // Restart rotation to ensure it's running after all cards are loaded
        this.smartIslandService.restartRotation();
      } else {
        console.warn('⚠️ [Smart Island] Response not successful or no analyses:', response);
        console.warn('⚠️ [Smart Island] response.success:', response?.success);
        console.warn('⚠️ [Smart Island] response.analyses:', response?.analyses);
      }
    } catch (error: any) {
      console.error('❌ [Smart Island] Error loading gamification data:', error);
      console.error('❌ [Smart Island] Error details:', error.message, error.stack);
      console.error('❌ [Smart Island] Full error object:', error);
      // Don't show error to user - just silently fail
    }
    
    // Load additional card types (independent of analyses API)
    this.loadAdditionalDynamicCards();
  }
  
  // Load additional dynamic cards (tutors online, recommendations, tips, etc.)
  private async loadAdditionalDynamicCards() {
    
    
    
    // Check for tutors with new availability
    try {
      
      const availabilityResponse = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/users/tutors-with-new-availability`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );
      
      
      
      
      
      if (availabilityResponse.success && availabilityResponse.tutors.length > 0) {
        let tutors = availabilityResponse.tutors;
        
        
        
        // Filter out tutors whose availability has already been dismissed by the student
        tutors = this.smartIslandService.filterDismissedTutors(tutors);
        
        
        
        if (tutors.length > 0) {
          this.smartIslandService.addTutorAvailabilityCard(
            tutors, // Pass full tutor objects
            '/tabs/tutor-search'
          );
          
        } else {
          
          // Remove any existing card since all tutors are dismissed
          this.smartIslandService.removeTutorAvailabilityCard();
        }
      } else {
        
        // IMPORTANT: Remove the card since no tutors have availability anymore
        this.smartIslandService.removeTutorAvailabilityCard();
        // Force change detection to update UI
        this.cdr.detectChanges();
      }
    } catch (error) {
      console.error('❌ [Smart Island] Error fetching tutor availability:', error);
      // On error, also try to remove the card (safe to call even if no card exists)
      // This prevents stale cards from showing due to API failures
      this.smartIslandService.removeTutorAvailabilityCard();
    }
    
    // Add personalized tips based on user behavior
    const tips = [
      {
        tip: 'Students who practice in the morning retain 30% more vocabulary',
        ctaText: 'Browse Times',
        ctaAction: '/tabs/tutor-search'
      },
      {
        tip: 'Try 25-minute lessons for better focus and retention',
        ctaText: 'Find Tutors',
        ctaAction: '/tabs/tutor-search'
      },
      {
        tip: 'Review your lesson notes within 24 hours to boost memory',
        ctaText: 'View Progress',
        ctaAction: '/tabs/progress'
      }
    ];
    
    // Randomly select a tip
    const randomTip = tips[Math.floor(Math.random() * tips.length)];
    this.smartIslandService.addTipCard(randomTip.tip, randomTip.ctaText, randomTip.ctaAction);
    
    // Add new feature card (example - can be enabled when new features launch)
    // this.smartIslandService.addNewFeatureCard(
    //   'Pronunciation Coach',
    //   'Get real-time feedback on your pronunciation',
    //   '/tabs/progress'
    // );
  }
  
  // Handle dynamic card click
  async onDynamicCardClick(card: DynamicCard) {
    if (!card) return;
    
    // Special handling for tutor availability card
    if (card.type === 'tutor_availability' && card.data?.tutors) {
      await this.openTutorAvailabilityModal(card.data.tutors);
      return;
    }
    
    // Navigate to the action route
    if (card.ctaAction.startsWith('/')) {
      this.router.navigate([card.ctaAction]);
    }
  }
  
  // Open tutor availability selection modal
  async openTutorAvailabilityModal(tutors: any[]) {
    const { TutorAvailabilitySelectionModalComponent } = await import('../components/tutor-availability-selection-modal/tutor-availability-selection-modal.component');
    
    // Build a map of tutor IDs to their lastAvailabilityUpdate timestamps
    const tutorTimestamps: { [tutorId: string]: string } = {};
    tutors.forEach(t => {
      const id = t.id || t._id;
      if (id && t.lastAvailabilityUpdate) {
        tutorTimestamps[id] = t.lastAvailabilityUpdate;
      }
    });
    
    // Check each tutor's actual availability before showing the modal
    // This filters out tutors who no longer have any available time slots
    
    const tutorsWithAvailability: any[] = [];
    const tutorsToRemove: string[] = [];
    
    for (const tutor of tutors) {
      const tutorId = tutor.id || tutor._id;
      try {
        const response = await firstValueFrom(
          this.http.get<any>(`${environment.apiUrl}/users/${tutorId}/availability`, {
            headers: this.userService.getAuthHeadersSync()
          })
        );
        
        // Check if tutor has any future availability slots
        const availability = response?.availability || [];
        const now = new Date();
        const hasFutureSlots = availability.some((block: any) => {
          if (block.type === 'class') return false;
          if (block.absoluteEnd) return new Date(block.absoluteEnd) > now;
          if (block.absoluteStart) return new Date(block.absoluteStart) > now;
          return true; // Recurring patterns
        });
        
        if (hasFutureSlots) {
          tutorsWithAvailability.push(tutor);
          
        } else {
          tutorsToRemove.push(tutorId);
          
        }
      } catch (error) {
        console.error(`❌ [TAB1] Error checking availability for tutor ${tutorId}:`, error);
        // Keep the tutor in case of error (let modal handle it)
        tutorsWithAvailability.push(tutor);
      }
    }
    
    // Remove tutors with no availability from the card
    tutorsToRemove.forEach(tutorId => {
      this.smartIslandService.removeTutorFromAvailabilityCard(tutorId);
      // Also dismiss them so they don't reappear
      if (tutorTimestamps[tutorId]) {
        this.smartIslandService.dismissTutorAvailability([tutorId], { [tutorId]: tutorTimestamps[tutorId] });
      }
    });
    
    // If no tutors have availability, show a toast and return
    if (tutorsWithAvailability.length === 0) {
      const toast = await this.toastController.create({
        message: 'Sorry, these tutors no longer have available time slots.',
        duration: 3000,
        position: 'top',
        color: 'warning',
        cssClass: 'custom-toast'
      });
      await toast.present();
      
      // Refresh the dynamic cards to update the UI
      this.loadAdditionalDynamicCards();
      return;
    }
    
    const modal = await this.modalCtrl.create({
      component: TutorAvailabilitySelectionModalComponent,
      componentProps: {
        tutors: tutorsWithAvailability, // Only pass tutors with actual availability
        title: 'Book a Lesson'
      },
      cssClass: 'tutor-availability-selection-modal' // Proper modal styling
    });
    
    await modal.present();
    
    const { data } = await modal.onWillDismiss();
    
    
    
    if (data?.success && data?.booked && data?.tutorId) {
      // Booking was completed successfully within the modal
      
      
      
      // Only dismiss the BOOKED tutor, not all tutors
      // This way the card will remain for other tutors who have availability
      const bookedTutorId = data.tutorId;
      const bookedTutorTimestamp = tutorTimestamps[bookedTutorId] ? 
        { [bookedTutorId]: tutorTimestamps[bookedTutorId] } : undefined;
      this.smartIslandService.dismissTutorAvailability([bookedTutorId], bookedTutorTimestamp);
      
      
      // Remove the booked tutor from the availability card
      // If no tutors remain, the card will be removed automatically
      this.smartIslandService.removeTutorFromAvailabilityCard(bookedTutorId);
      
      
      // Add a longer delay to ensure database transaction is fully committed and replicated
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Refresh lessons to show the new booking
      await this.loadLessons(false);
      
      
      
      
      
      
      // Check if the new lesson is in the list
      const newLesson = this.lessons.find(l => {
        const lessonDate = new Date(l.startTime).toISOString().split('T')[0];
        const lessonTime = new Date(l.startTime).toISOString().split('T')[1].substring(0, 5);
        const tutorId = (l.tutorId as any)?._id || (l.tutorId as any)?.id || l.tutorId;
        return lessonDate === data.selectedDate && tutorId === data.tutorId;
      });
      
      if (newLesson) {
        
      } else {
        console.error('❌ [TAB1] NEWLY BOOKED LESSON NOT FOUND IN API RESPONSE!');
        console.error('❌ [TAB1] This indicates a backend issue - lesson created but not returned by getMyLessons()');
      }
      
      
      
      // Force change detection
      this.cdr.detectChanges();
    } else {
      
    }
  }
  
  // TrackBy function for dynamic card to force re-render on type change
  trackByCardType(index: number, card: DynamicCard | null): string {
    return card?.type || 'none';
  }
  
  // Handle Up Next card click
  onUpNextCardClick() {
    if (this.nextLesson) {
      // If there's a lesson, join it
      this.joinLessonById(this.nextLesson);
    } else {
      // If no lesson, go to tutor search
      this.openSearchTutors();
    }
  }

  /** Student home: Up Next card opens lesson/class detail; empty card still opens tutor search. */
  onStudentUpNextCardClick(): void {
    const lesson = this.nextLesson?.lesson as Lesson | undefined;
    if (lesson?._id) {
      this.navigateToLesson(lesson);
      return;
    }
    this.onUpNextCardClick();
  }

  /** Tutor home: tap card background opens lesson/class on Lessons tab; join/menu/notes keep their own actions. */
  onTutorUpNextCardShellClick(ev: MouseEvent): void {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (
      target.closest(
        'ion-button.upnext-filled-menu, .upnext-filled-actions, .m-card-empty-link, button.previous-notes-link, .badge-reschedule-proposal'
      )
    ) {
      return;
    }
    const lesson = this.nextLesson?.lesson as Lesson | undefined;
    if (lesson?._id) {
      this.navigateToLesson(lesson);
    }
  }
  
  // Check tutor onboarding status and show banner if incomplete
  checkTutorOnboardingStatus() {
    if (!this.isTutorUser) return;
    if (!this.currentUser) return; // Only check if we have current user
    
    
    
    const user = this.currentUser;
    
    
    
    // Only show approval banner if basic onboarding is complete
    if (!user.onboardingCompleted) {
      this.showOnboardingBanner = false;
      
      return;
    }
    
    // Compute credential status for banner
    const creds = user.tutorCredentials;
    const governmentIdUploaded = !!(creds?.governmentId?.url && creds.governmentId.status !== 'not_uploaded');
    const governmentIdApproved = creds?.governmentId?.status === 'approved';
    const certificationsUploaded = !!(creds?.teachingCertifications && creds.teachingCertifications.length > 0);
    const certificationsApproved = !!(creds?.teachingCertifications?.some((c: any) => c.status === 'approved'));
    const credentialsComplete = governmentIdUploaded && certificationsUploaded;
    const credentialsApproved = governmentIdApproved && certificationsApproved;

    this.tutorOnboardingStatus = {
      ...(user.tutorOnboarding || {}),
      credentialsComplete,
      credentialsApproved,
      stripeComplete: user.stripeConnectOnboarded || user.payoutProvider === 'paypal' || user.payoutProvider === 'manual'
    };
    
    // Check if user has a custom uploaded photo (not just Google/Auth0 photo)
    this.hasCustomProfilePhoto = !!(user.picture && (
      user.picture.includes('storage.googleapis.com') || // GCS uploaded photo
      (user.auth0Picture && user.picture !== user.auth0Picture) // Different from original Auth0 photo
    ));
    
    // Show banner if user is NOT fully approved, or if approved but missing critical items
    const hasAllCritical = this.hasCustomProfilePhoto &&
      (user.tutorOnboarding?.videoApproved || !!user.onboardingData?.introductionVideo || !!user.onboardingData?.pendingVideo) &&
      this.tutorOnboardingStatus?.stripeComplete;
    this.showOnboardingBanner = !user.tutorApproved || !hasAllCritical;

    // Detect profile hidden due to video removal: onboarding was completed but no video exists
    const hasNoVideo = !user.onboardingData?.introductionVideo && !user.onboardingData?.pendingVideo;
    this.profileHiddenNoVideo = !user.tutorApproved && user.onboardingCompleted && hasNoVideo && !user.tutorOnboarding?.videoApproved;
    
    
    
    this.cdr.detectChanges();
  }

  private refreshNarrowTutorHomeViewport(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const next = window.innerWidth <= 600;
    if (next !== this.isNarrowTutorHomeViewport) {
      this.isNarrowTutorHomeViewport = next;
      this.cdr.markForCheck();
    }
  }
  
  // Open tutor onboarding modal/page
  openTutorOnboarding() {
    this.router.navigate(['/tutor-approval']);
  }
  
  // Update wallet display property
  private updateWalletDisplay(): void {
    this.walletDisplay = this.showWalletBalance 
      ? `$${this.walletBalance.toFixed(2)}` 
      : '$ • • • • •';
  }
  
  // Toggle wallet visibility temporarily (for mobile tap-to-reveal)
  toggleWalletVisibility(event: Event): void {
    // Only allow toggle on mobile/touch devices (non-hover devices)
    const isTouchDevice = !window.matchMedia('(hover: hover)').matches;
    if (!isTouchDevice) {
      return; // Exit early on desktop - let hover handle it
    }
    
    event.stopPropagation(); // Prevent navigation to wallet page
    if (!this.showWalletBalance) {
      this.walletTemporarilyVisible = !this.walletTemporarilyVisible;
      
      // Auto-hide after 3 seconds
      if (this.walletTemporarilyVisible) {
        setTimeout(() => {
          this.walletTemporarilyVisible = false;
        }, 3000);
      }
    }
  }

  // New method: Load tutor insights
  loadTutorInsights() {
    // TODO: Replace with actual API call to get tutor statistics
    // For now, calculate from lessons
    this._growthInsightsLoaded = false;

    const uniqueStudents = new Set<string>();
    for (const l of this.lessons) {
      if (l.status === 'cancelled' || (l as any).isClass) continue;
      const sid = l.studentId as any;
      if (sid && typeof sid === 'object' && sid._id) {
        uniqueStudents.add(String(sid._id));
      } else if (sid != null && sid !== '') {
        uniqueStudents.add(String(sid));
      }
    }
    this.totalStudents = uniqueStudents.size;

    // Count completed lessons and classes this week
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - currentDay);
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    endOfWeek.setHours(23, 59, 59, 999);
    
    this.lessonsThisWeek = this.lessons.filter(l => {
      // Exclude cancelled lessons/classes
      if (l.status === 'cancelled') return false;
      
      // Check if lesson/class ended this week (completed this week)
      const lessonEndTime = new Date(l.endTime);
      return lessonEndTime >= startOfWeek && lessonEndTime < endOfWeek && lessonEndTime < now;
    }).length;
    
    // Count completed lessons (lessons in the past with 'completed' status or just past lessons)
    const currentTime = new Date();
    this.totalLessonsCompleted = this.lessons.filter(l => {
      const lessonEndTime = new Date(l.endTime);
      return lessonEndTime < currentTime && l.status !== 'cancelled';
    }).length;

    // Get tutor rating from user profile or calculate from reviews
    // Note: Rating might not be in User type yet, so we safely access it
    const userAny = this.currentUser as any;
    this.tutorRating = userAny?.rating ? userAny.rating.toFixed(1) : '0.0';
    
    // Get total conversations (unique students the tutor has messaged)
    this.totalConversations = uniqueStudents.size;
    
    // Insights loaded
    this.insightsLoading = false;
    
    // Check for upcoming lessons and show Smart Island moments
    this.checkUpcomingLessonsForIsland();

    // Compute growth insights for the welcome ticker
    this.computeGrowthInsights();

    // Mobile sections
    this.syncRecentStudents();
    this.syncPendingActionItems();
    this.syncThisWeekMobileNothingYet();
  }

  private syncRecentStudents(): void {
    if (!this.isTutorUser) return;
    const now = new Date();
    const seen = new Set<string>();
    this.recentStudents = this.lessons
      .filter(l => l.studentId && typeof l.studentId === 'object' && new Date(l.endTime) < now && l.status !== 'cancelled')
      .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime())
      .reduce<{ id: string; name: string; avatar: string | null; subject: string }[]>((acc, l) => {
        const s = l.studentId as any;
        const id = s?._id || s?.id;
        if (!id || seen.has(id)) return acc;
        seen.add(id);
        acc.push({
          id,
          name: s?.name || s?.email || 'Student',
          avatar: s?.picture || s?.profilePicture || null,
          subject: l.subject || ''
        });
        return acc;
      }, [])
      .slice(0, 6);
  }

  private syncPendingActionItems(): void {
    if (!this.isTutorUser) return;
    const items: typeof this.pendingActionItems = [];

    for (const fb of this.pendingFeedback) {
      const dateLabel = fb.lesson?.startTime
        ? this.formatFeedbackDate(fb.lesson.startTime)
        : '';
      items.push({
        type: 'feedback',
        label: fb.studentName || 'Student',
        sublabel: dateLabel ? `Lesson on ${dateLabel}` : 'Feedback needed',
        avatar: fb.studentPicture || null,
        lessonId: fb.lessonId,
        feedbackId: fb._id,
      });
    }

    for (const l of this.lessons) {
      if (l.status === 'pending_reschedule' && (l as any).rescheduleProposal?.status === 'pending') {
        const isTutor = (l.tutorId as any)?._id === this.currentUser?.id;
        const other = isTutor ? l.studentId : l.tutorId;
        const otherName = typeof other === 'object' ? ((other as any)?.name || 'Someone') : 'Someone';
        const otherAvatar = typeof other === 'object' ? ((other as any)?.picture || (other as any)?.profilePicture || null) : null;
        const isProposer = (l as any).rescheduleProposal?.proposedBy?._id === this.currentUser?.id ||
                           (l as any).rescheduleProposal?.proposedBy === this.currentUser?.id;
        if (!isProposer) {
          items.push({
            type: 'reschedule',
            label: otherName,
            sublabel: 'Wants to reschedule',
            avatar: otherAvatar,
            lessonId: l._id,
            lesson: l,
          });
        }
      }
    }

    this.pendingActionItems = items;
  }

  private computeGrowthInsights(): void {
    if (!this.isTutorUser || this._growthInsightsLoaded) return;
    this._growthInsightsLoaded = true;

    this.tutorGrowthService.setUpdateCallback(() => {
      this.syncGrowthInsightProperties();
      this.cdr.detectChanges();
    });

    const materials$ = this.materialService.getMyMaterials().pipe(
      take(1),
      catchError(() => of({ success: false, materials: [] as any[] }))
    );

    const classes$ = this.classService.getMyClasses().pipe(
      take(1),
      catchError(() => of({ success: false, classes: [] as any[] }))
    );

    forkJoin([materials$, classes$]).subscribe(([matRes, classRes]) => {
      const materials = matRes.success ? matRes.materials : [];
      const published = materials.filter((m: any) => m.status === 'published');
      const sorted = [...published].sort((a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      let totalViews = 0;
      let totalQuizAttempts = 0;
      let totalPurchases = 0;
      for (const m of published) {
        if (m.stats) {
          totalViews += m.stats.views || 0;
          totalQuizAttempts += m.stats.quizAttempts || 0;
          totalPurchases += m.stats.purchases || 0;
        }
      }

      const classes = classRes.success ? classRes.classes : [];
      const now = Date.now();
      const upcomingClasses = classes.filter((c: any) =>
        c.status !== 'cancelled' && new Date(c.startTime).getTime() > now
      );
      const pastClasses = classes
        .filter((c: any) => c.status !== 'cancelled' && new Date(c.startTime).getTime() <= now)
        .sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

      const userAny = this.currentUser as any;
      const todayCounts = this.countTodayLessons();

      const user = this.currentUser;
      const creds = user?.tutorCredentials;
      const govIdUploaded = !!(creds?.governmentId?.url && creds.governmentId.status !== 'not_uploaded');
      const certsUploaded = !!(creds?.teachingCertifications && creds.teachingCertifications.length > 0);

      const ctx: GrowthContext = {
        hasAvailability: this.hasAvailability,
        hasUpcomingLessons: !!this.nextLesson,
        tutorName: user?.firstName || '',
        lessonsThisWeek: this.lessonsThisWeek,
        lessonsToday: todayCounts.total,
        completedToday: todayCounts.completed,
        totalStudents: this.totalStudents,
        hasEverHadBooking: this.tutorHasEverHadPastBooking,
        freeHoursThisWeek: this.estimateFreeHoursThisWeek(),
        nextGapHours: this.computeNextLessonGap(),
        scheduleHash: this.computeScheduleHash(),
        pendingFeedbackCount: this.pendingFeedbackCount,
        unreadMessages: this.unreadMessages,
        materialCount: published.length,
        lastMaterialCreatedAt: sorted.length > 0 ? sorted[0].createdAt : null,
        totalMaterialViews: totalViews,
        totalQuizAttempts,
        totalPurchases,
        hasUpcomingGroupClass: upcomingClasses.length > 0,
        lastGroupClassAt: pastClasses.length > 0 ? pastClasses[0].startTime : null,
        officeHoursEnabled: !!userAny?.profile?.officeHoursEnabled,
        recentForumPostCount: 0,
        activeForumThreadsInLanguage: 0,
        tutorRating: this.tutorRating,
        hasCustomPhoto: this.hasCustomProfilePhoto,
        hasVideo: !!(user?.onboardingData?.introductionVideo || user?.onboardingData?.pendingVideo),
        videoApproved: user?.tutorOnboarding?.videoApproved === true,
        credentialsComplete: govIdUploaded && certsUploaded,
        credentialsApproved: creds?.governmentId?.status === 'approved' && !!(creds?.teachingCertifications?.some((c: any) => c.status === 'approved')),
        hasPayoutSetup: this.tutorOnboardingStatus?.stripeComplete === true,
        tutorApproved: user?.tutorApproved === true,
      };

      this.tutorGrowthService.compute(ctx);

      // Only save baselines when the tutor actually sees the insight — otherwise delta is preserved for next session
      const activeIds = new Set(this.tutorGrowthService.allInsights.map(i => i.id));
      if (activeIds.has('material_stats')) {
        this.tutorGrowthService.snapshotMaterialStats(totalViews, totalQuizAttempts, totalPurchases);
      }
      if (activeIds.has('office_hours_gap')) {
        this.tutorGrowthService.snapshotScheduleHash(ctx.scheduleHash);
      }

      this.syncGrowthInsightProperties();
      this.cdr.detectChanges();
    });
  }

  private computeNextLessonGap(): number {
    const now = Date.now();
    const upcoming = this.lessons
      .filter(l => l.status !== 'cancelled' && new Date(l.startTime).getTime() > now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    if (upcoming.length < 2) return 0;
    let maxGap = 0;
    for (let i = 0; i < upcoming.length - 1; i++) {
      const endCurrent = new Date(upcoming[i].endTime).getTime();
      const startNext = new Date(upcoming[i + 1].startTime).getTime();
      const gapHours = (startNext - endCurrent) / 3600000;
      if (gapHours > maxGap) maxGap = gapHours;
    }
    return Math.round(maxGap);
  }

  private computeScheduleHash(): string {
    const now = Date.now();
    const starts = this.lessons
      .filter(l => l.status !== 'cancelled' && new Date(l.startTime).getTime() > now)
      .map(l => l.startTime)
      .sort()
      .join(',');
    let hash = 0;
    for (let i = 0; i < starts.length; i++) {
      hash = ((hash << 5) - hash + starts.charCodeAt(i)) | 0;
    }
    return String(hash);
  }

  private syncGrowthInsightProperties(): void {
    const insight = this.tutorGrowthService.activeInsight;
    const idx = this.tutorGrowthService.activeIndex;
    const sig = insight ? `${idx}:${insight.id}` : '';
    if (sig !== this._lastGrowthSlideSig) {
      this._lastGrowthSlideSig = sig;
      if (insight) {
        this._growthSlideEpoch++;
      }
    }

    this.growthInsight = insight;
    this.growthInsights = this.tutorGrowthService.allInsights;
    this.growthIndex = idx;
    this.growthCount = this.tutorGrowthService.count;
    this.growthPaused = this.tutorGrowthService.paused;
    this.hasProfileCriticalInsights = this.tutorGrowthService.hasProfileCritical;
    this.profileChecklist = this.tutorGrowthService.profileChecklist;
    this.profileChecklistDoneCount = this.profileChecklist.filter(i => i.done).length;
    this.profileChecklistTotal = this.profileChecklist.length;
    this.growthInsightSlideRow = insight
      ? [{ epoch: this._growthSlideEpoch, insight }]
      : [];
  }

  private estimateFreeHoursThisWeek(): number {
    const now = new Date();
    const currentDay = now.getDay();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (7 - currentDay));
    endOfWeek.setHours(23, 59, 59, 999);

    const bookedMs = this.lessons
      .filter(l => {
        if (l.status === 'cancelled') return false;
        const start = new Date(l.startTime);
        return start >= now && start <= endOfWeek;
      })
      .reduce((sum, l) => sum + (new Date(l.endTime).getTime() - new Date(l.startTime).getTime()), 0);

    const totalAvailMs = (this.availabilityBlocks || [])
      .reduce((sum: number, b: any) => {
        const start = new Date(b.startTime || b.start);
        const end = new Date(b.endTime || b.end);
        if (start >= now && start <= endOfWeek) {
          return sum + (end.getTime() - start.getTime());
        }
        return sum;
      }, 0);

    const freeMs = Math.max(0, totalAvailMs - bookedMs);
    return Math.round(freeMs / 3600000);
  }

  private countTodayLessons(): { total: number; completed: number } {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    let total = 0;
    let completed = 0;
    for (const l of this.lessons) {
      if (l.status === 'cancelled') continue;
      const start = new Date(l.startTime);
      if (start >= startOfDay && start < endOfDay) {
        total++;
        const end = new Date(l.endTime);
        if (end < now || l.status === 'completed') {
          completed++;
        }
      }
    }
    return { total, completed };
  }

  onGrowthInsightDotClick(index: number): void {
    this.tutorGrowthService.goTo(index);
    this.syncGrowthInsightProperties();
  }

  onGrowthInsightPause(): void {
    this.tutorGrowthService.pause();
    this.growthPaused = true;
  }

  onGrowthInsightResume(): void {
    this.tutorGrowthService.resume();
    this.growthPaused = false;
  }

  onGrowthInsightDismiss(): void {
    const current = this.tutorGrowthService.activeInsight;
    if (current) {
      this.tutorGrowthService.dismiss(current);
      this.syncGrowthInsightProperties();
    }
  }

  onGrowthInsightTapAdvance(): void {
    this.tutorGrowthService.next();
    this.syncGrowthInsightProperties();
  }

  onGrowthInsightClick(): void {
    const current = this.tutorGrowthService.activeInsight;
    if (!current) return;

    if (current.id === 'create_material' || current.id === 'first_material') {
      this.navigateToCreateMaterial(new MouseEvent('click'));
    } else if (current.route.startsWith('/')) {
      this.router.navigate([current.route]);
    }
  }

  openGrowthInsightsModal(): void {
    this.growthModalItems = this.tutorGrowthService.getAllWithStatus();
    this.isGrowthModalOpen = true;
    this.tutorGrowthService.pause();
    this.syncGrowthInsightProperties();
  }

  closeGrowthInsightsModal(): void {
    this.isGrowthModalOpen = false;
    this.tutorGrowthService.resume();
    this.syncGrowthInsightProperties();
  }

  onGrowthInsightRestore(insight: GrowthInsight): void {
    this.tutorGrowthService.undismiss(insight);
    this.growthModalItems = this.tutorGrowthService.getAllWithStatus();
    this.syncGrowthInsightProperties();
  }

  onGrowthInsightDismissFromModal(insight: GrowthInsight): void {
    this.tutorGrowthService.dismiss(insight);
    this.growthModalItems = this.tutorGrowthService.getAllWithStatus();
    this.syncGrowthInsightProperties();
  }

  // New method: Load student insights
  loadStudentInsights() {
    // Count unique tutors from lessons
    const uniqueTutors = new Set(
      this.lessons
        .filter(l => l.tutorId && typeof l.tutorId === 'object')
        .map(l => (l.tutorId as any)._id)
    );
    this.totalTutors = uniqueTutors.size;

    // Count lessons this week (for students, count both regular lessons and classes they're attending)
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - currentDay);
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    endOfWeek.setHours(23, 59, 59, 999);
    
    this.lessonsThisWeek = this.lessons.filter(l => {
      // Exclude cancelled lessons/classes
      if (l.status === 'cancelled') return false;
      
      const lessonDate = new Date(l.startTime);
      return lessonDate >= startOfWeek && lessonDate < endOfWeek;
    }).length;

    // Count completed lessons (lessons in the past with 'completed' status or just past lessons)
    const currentTime = new Date();
    this.totalLessonsCompleted = this.lessons.filter(l => {
      const lessonEndTime = new Date(l.endTime);
      return lessonEndTime < currentTime && l.status !== 'cancelled';
    }).length;
    
    // Count unique tutors (from lessons)
    const uniqueTutorIds = new Set(this.lessons.map((l: any) => l.tutorId?._id || l.tutorId).filter(Boolean));
    this.totalTutors = uniqueTutorIds.size;
    
    // Insights loaded
    this.insightsLoading = false;
    
    // Check for upcoming lessons and show Smart Island moments
    this.checkUpcomingLessonsForIsland();
  }
  
  // Check for upcoming lessons and show Smart Island moments
  checkUpcomingLessonsForIsland() {
    if (!this.smartIsland) return;
    
    const next = this.nextLesson;
    if (!next || !next.lesson) return;
    
    const now = new Date();
    const startTime = new Date(next.lesson.startTime);
    const minutesUntil = Math.floor((startTime.getTime() - now.getTime()) / 60000);
    
    // Show moment if lesson is within 15 minutes
    if (minutesUntil > 0 && minutesUntil <= 15) {
      const otherUser = this.currentUser?.userType === 'student' 
        ? (next.lesson.tutorId as any) 
        : (next.lesson.studentId as any);
      
      this.smartIsland.addMoment({
        type: 'lesson-soon',
        priority: minutesUntil <= 5 ? IslandPriority.URGENT : IslandPriority.HIGH,
        avatarUrl: otherUser?.picture || '',
        title: `Lesson in ${minutesUntil} min`,
        subtitle: `with ${otherUser?.name || 'tutor'}`,
        emoji: '⏰',
        gradient: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(250, 250, 250, 0.98))',
        action: () => {
          this.joinLessonById(next.lesson);
        },
        glow: false,
        duration: 7000
      });
    }
  }

  // Navigate to invitations (for students)
  navigateToInvitations() {
    
    
    
    
    // Filter out cancelled invitations
    const activeInvitations = this.pendingClassInvitations.filter(inv => inv.status !== 'cancelled');
    
    
    
    if (activeInvitations.length === 0) return;
    
    // If only 1 active invitation, open it directly
    if (activeInvitations.length === 1) {
      this.openClassInvitation(activeInvitations[0]._id);
      return;
    }
    
    // If multiple invitations, show list modal (includes cancelled ones for reference)
    this.isInvitationsListModalOpen = true;
  }
  
  // Handle invitations list modal dismiss
  async onInvitationsListModalDismiss(event: any) {
    this.isInvitationsListModalOpen = false;
    
    // If user accepted or declined, refresh data immediately
    if (event.detail.data?.accepted || event.detail.data?.declined) {
      
      
      // Reload both invitations and lessons
      this.loadPendingInvitations();
      await this.loadLessons(false);
      
      // Show success message
      const action = event.detail.data?.accepted ? 'accepted' : 'declined';
      const toast = await this.toastController.create({
        message: `Class invitation ${action} successfully`,
        duration: 2000,
        color: event.detail.data?.accepted ? 'success' : 'medium',
        position: 'bottom'
      });
      await toast.present();
    } else if (event.detail.data?.expired) {
      // Invitation was removed/expired - show message and refresh
      
      
      const toast = await this.toastController.create({
        message: 'This invitation is no longer available',
        duration: 2500,
        color: 'medium',
        position: 'bottom'
      });
      await toast.present();
      
      // Refresh invitations to update the count
      this.loadPendingInvitations();
    }
  }

  // New method: Load featured tutors for students
  loadFeaturedTutors() {
    // TODO: Replace with actual API call to get featured tutors
    // Mock data for now
    this.featuredTutors = [
      { 
        id: '1', 
        name: 'Maria Garcia', 
        rating: 4.9, 
        specialty: 'Spanish Native Speaker',
        profilePicture: 'assets/avatar.png' 
      },
      { 
        id: '2', 
        name: 'John Smith', 
        rating: 4.7, 
        specialty: 'English Business Expert',
        profilePicture: 'assets/avatar.png' 
      },
      { 
        id: '3', 
        name: 'Sophie Chen', 
        rating: 4.8, 
        specialty: 'Mandarin Teacher',
        profilePicture: 'assets/avatar.png' 
      },
    ];
  }

  // Helper method to format tutor name with last initial
  private formatTutorName(firstName: string | undefined, lastName: string | undefined): string {
    if (!firstName && !lastName) {
      return 'A tutor';
    }
    
    const first = firstName || 'Unknown';
    const lastInitial = lastName ? lastName.charAt(0).toUpperCase() + '.' : '';
    
    return lastInitial ? `${first} ${lastInitial}` : first;
  }
  
  // Helper method to get next lesson time label (e.g., "in 29h" or "tomorrow")
  getNextLessonTimeLabel(): string {
    if (!this.nextLesson) return '';
    
    const now = Date.now();
    const startTime = new Date(this.nextLesson.startTime).getTime();
    const diff = startTime - now;
    
    // If lesson has started (negative diff), return empty string to hide the subtitle
    if (diff < 0) return '';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    // If 0 minutes, show "now"
    if (hours < 1 && minutes === 0) {
      return 'now';
    }
    
    // Use consistent "in Xh Ym" format
    if (hours < 1) {
      return `in ${minutes}m`;
    } else if (hours < 24) {
      return minutes > 0 ? `in ${hours}h ${minutes}m` : `in ${hours}h`;
    } else {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return remainingHours > 0 ? `in ${days}d ${remainingHours}h` : `in ${days}d`;
    }
  }
  
  // Helper method to get next lesson tutor
  getNextLessonTutor(): any {
    if (!this.nextLesson) return null;
    return this.nextLesson.tutorId || this.nextLesson.studentId;
  }

  // Helper method to get the next upcoming lesson across all dates
  getNextLesson(): Lesson | null {
    const now = new Date();
    
    // Combine both lessons and cancelledLessons arrays
    const allLessons = [...this.lessons, ...this.cancelledLessons];
    
    const upcoming = allLessons
      .filter(l => {
        const start = new Date(l.startTime);
        const end = new Date(l.endTime);
        
        // For cancelled lessons: only show if START time hasn't passed yet
        // Once a cancelled lesson's start time passes, it should disappear from Up Next
        if (l.status === 'cancelled') {
          return start > now;
        }
        
        // For non-cancelled lessons: show if start time hasn't passed yet
        return start > now && (l.status === 'scheduled' || l.status === 'in_progress');
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    // Return the first lesson chronologically (whether cancelled or not)
    return upcoming.length > 0 ? upcoming[0] : null;
  }

  // Get formatted info about the next lesson for empty state display
  getNextLessonInfo(): { date: string; time: string; dayText: string } | null {
    const nextLesson = this.getNextLesson();
    if (!nextLesson) return null;
    
    const start = new Date(nextLesson.startTime);
    const now = new Date();
    const today = this.startOfDay(new Date());
    const lessonDay = this.startOfDay(start);
    const daysDiff = Math.floor((lessonDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    const tz = this.userTz;
    const time = formatTimeInTz(start, tz);

    let dayText = '';
    if (daysDiff === 0) {
      dayText = 'today';
    } else if (daysDiff === 1) {
      dayText = 'tomorrow';
    } else if (daysDiff < 7) {
      const weekday = formatDateInTz(start, tz, { weekday: 'long', month: undefined, day: undefined, year: undefined });
      const date = formatDateInTz(start, tz, { month: 'long', day: 'numeric', year: undefined });
      dayText = `${weekday}, ${date}`;
    } else {
      dayText = formatDateInTz(start, tz, { month: 'long', day: 'numeric', year: undefined });
    }

    return {
      date: formatDateInTz(start, tz, { month: 'short', day: 'numeric', year: undefined }),
      time,
      dayText
    };
  }

  formatLessonTime(lesson: Lesson): string {
    const start = new Date(lesson.startTime);
    const end = new Date(lesson.endTime);
    const now = new Date();
    const tz = this.userTz;

    const startTime = formatTimeInTz(start, tz);
    const endTime = formatTimeInTz(end, tz);
    
    // Calculate relative date
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfLessonDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const daysDiff = Math.floor((startOfLessonDay.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));
    
    // Calculate hours until start for very soon classes
    const hoursUntilStart = (start.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    let whenText = '';
    
    // First check if it's today - prioritize showing "Today"
    if (daysDiff === 0) {
      // If it's today and starting very soon (within 2 hours), show countdown
      if (hoursUntilStart > 0 && hoursUntilStart <= 2) {
        const hours = Math.floor(hoursUntilStart);
        const minutes = Math.floor((hoursUntilStart - hours) * 60);
        if (hours > 0) {
          whenText = `Today • In ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
        } else if (minutes > 0) {
          whenText = `Today • In ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
        } else {
          whenText = 'Today • Starting now';
        }
      } else {
        whenText = 'Today';
      }
    } else if (daysDiff === 1) {
      whenText = 'Tomorrow';
    } else if (daysDiff > 1 && daysDiff < 7) {
      // Within the next week, show weekday name
      whenText = formatDateInTz(start, this.userTz, { weekday: 'long', month: undefined, day: undefined, year: undefined });
    } else {
      whenText = formatDateInTz(start, this.userTz, { month: 'short', day: 'numeric', year: undefined });
    }
    
    return `${whenText} • ${startTime} - ${endTime}`;
  }

  // Format subject to show language (e.g., "Spanish" -> "Spanish")
  formatSubject(subject: string): string {
    if (!subject || subject === 'Language Lesson') {
      return 'Language';
    }
    // Extract language name from subject (remove "Lesson" if present)
    return subject.replace(/ Lesson$/i, '').trim();
  }
  
  getTimeRangeOnly(lesson: Lesson): string {
    const tz = this.userTz;
    return `${formatTimeInTz(lesson.startTime, tz, undefined, true)} — ${formatTimeInTz(lesson.endTime, tz, undefined, true)}`;
  }

  /**
   * Primary date line — matches event-details (`/tabs/lessons/:id`): Today, Tomorrow, or long form in profile TZ.
   */
  private formatEventDetailsDatePrimary(startInput: string | Date): string {
    const start = typeof startInput === 'string' ? new Date(startInput) : startInput;
    if (isNaN(start.getTime())) return '';
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (start.toDateString() === today.toDateString()) {
      return this.translateService.instant('HOME.TODAY');
    }
    if (start.toDateString() === tomorrow.toDateString()) {
      return this.translateService.instant('HOME.TOMORROW');
    }
    return formatDateInTz(
      start,
      this.userTz,
      { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
      this.currentLocale,
    );
  }

  /**
   * Time range — matches event-details (12h, en dash between start and end).
   */
  private formatEventDetailsTimeRange(lesson: { startTime?: string; endTime?: string; duration?: number }): string {
    if (!lesson?.startTime) return '';
    const start = new Date(lesson.startTime);
    const end = lesson.endTime
      ? new Date(lesson.endTime)
      : new Date(start.getTime() + (Number(lesson.duration) || 60) * 60000);
    return `${formatTimeInTz(start, this.userTz, undefined, true)} – ${formatTimeInTz(end, this.userTz, undefined, true)}`;
  }

  /**
   * Get the lesson number for a specific lesson (excluding trial lessons)
   * DEPRECATED: Lesson numbers are now stored as properties on lesson objects.
   * This function is kept for backwards compatibility but should not be called from templates.
   * @deprecated Use lesson.lessonNumber property instead
   */
  getLessonNumber(lesson: any): number | null {
    // Return the property if it exists (preferred method)
    if (lesson && (lesson as any).lessonNumber !== undefined) {
      return (lesson as any).lessonNumber;
    }
    
    // Fallback calculation (for backwards compatibility)
    if (!lesson) return null;
    if (lesson.isTrialLesson) return null;
    
    const tutorId = (lesson.tutorId as any)?._id?.toString() || (lesson.tutorId as any)?.id?.toString() || lesson.tutorId?.toString();
    const studentId = (lesson.studentId as any)?._id?.toString() || (lesson.studentId as any)?.id?.toString() || lesson.studentId?.toString();
    
    if (!tutorId || !studentId) return null;
    
    const cacheKey = `${tutorId}_${studentId}`;
    const completedCount = this._lessonCountCache.get(cacheKey) || 0;
    return completedCount + 1;
  }

  // New method: Get students for selected date (tutor view)
  getStudentsForDate(): any[] {
    if (!this.selectedDate) {
      this.cachedStudentsForDate = [];
      return [];
    }
    
    // Check if we can use cached result
    const dateChanged = !this.cachedStudentsDate || 
      this.cachedStudentsDate.getTime() !== this.selectedDate.getTime();
    
    // Create a simple hash of lesson IDs to detect changes
    const lessonsForDate = this.lessonsForSelectedDate();
    const lessonsHash = lessonsForDate.map(l => String(l._id)).sort().join(',');
    const lessonsChanged = this.cachedStudentsLessonsHash !== lessonsHash;
    
    // Use cached result if date and lessons haven't changed
    if (!dateChanged && !lessonsChanged && this.cachedStudentsForDate.length > 0) {
      return this.cachedStudentsForDate;
    }
    
    // Update cache keys
    this.cachedStudentsDate = new Date(this.selectedDate);
    this.cachedStudentsLessonsHash = lessonsHash;
    
    const now = new Date();
    
    // Group lessons by student and find the earliest lesson for each student
    const studentLessonMap = new Map<string, { student: any; lesson: Lesson; isNext: boolean }>();
    
    // First pass: find the earliest lesson for each student, and handle classes
    lessonsForDate.forEach(l => {
      // Handle classes (they don't have a studentId)
      if ((l as any).isClass) {
        const classId = String(l._id);
        studentLessonMap.set(`class_${classId}`, {
          student: {
            id: classId,
            name: (l as any).className || l.subject || 'Class',
            profilePicture: 'assets/avatar.png', // Use default avatar for classes
            email: '',
            rating: 0,
            isClass: true
          },
          lesson: l,
          isNext: false // Will be set correctly below
        });
      }
      // Handle regular lessons with students
      else if (l.studentId && typeof l.studentId === 'object') {
        const studentId = (l.studentId as any)?._id;
        if (!studentId) return; // Skip if no valid studentId
        
        const existing = studentLessonMap.get(studentId);
        
        // If no existing entry, or this lesson is earlier, use this lesson
        if (!existing || new Date(l.startTime) < new Date(existing.lesson.startTime)) {
          const studentData = l.studentId as any;
          if (!studentData) return; // Skip if studentData is null
          
          // Build full name from firstName and lastName if available
          let fullName = studentData?.name || studentData?.email || 'Student';
          if (studentData?.firstName && studentData?.lastName) {
            fullName = `${studentData.firstName} ${studentData.lastName}`;
          } else if (studentData?.firstName) {
            fullName = studentData.firstName;
          }
          
          studentLessonMap.set(studentId, {
            student: {
              id: studentId,
              name: fullName,
              firstName: studentData?.firstName,
              lastName: studentData?.lastName,
              profilePicture: studentData?.picture || studentData?.profilePicture || 'assets/avatar.png',
              email: studentData?.email,
              rating: studentData?.rating || 4.5,
            },
            lesson: l,
            isNext: false // Will be set correctly below
          });
        }
      }
    });
    
    // Second pass: find the earliest upcoming lesson ACROSS ALL DATES and mark it as "next"
    // Get ALL upcoming lessons (not just for this date)
    const allUpcomingLessons = this.lessons
      .filter(l => {
        if (l.status !== 'scheduled' && l.status !== 'in_progress' && l.status !== 'pending_reschedule') return false;
        const startTime = new Date(l.startTime);
        const endTime = new Date(l.endTime);
        // Include lessons that are in progress (started but not ended yet)
        if (startTime <= now && now < endTime) {
          return true;
        }
        // Include lessons that haven't started yet (upcoming)
        return startTime > now;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    // Get the very next lesson ID (the earliest upcoming lesson across all dates)
    const nextLessonId = allUpcomingLessons.length > 0 ? String(allUpcomingLessons[0]._id) : null;
    
    // Mark the lesson as "next" if it matches the next lesson ID
    if (nextLessonId) {
      studentLessonMap.forEach((entry) => {
        if (String(entry.lesson._id) === nextLessonId) {
          entry.isNext = true;
        }
      });
    }
    
    // Convert map to array and calculate join labels
    const students = Array.from(studentLessonMap.values())
      .filter(({ student }) => student != null) // Filter out any null students
      .map(({ student, lesson, isNext }) => {
        const currentLessonId = String(lesson._id);
        
        // Pre-calculate join label to prevent flashing
        const joinLabel = this.calculateJoinLabel(lesson);
        
        return {
          ...student,
          lessonId: String(lesson._id), // Convert to string to match backend format
          lesson: lesson, // Include full lesson object for join functionality
          lessonTime: this.formatLessonTime(lesson),
          subject: this.formatSubject(lesson.subject),
          isNextClass: isNext,
          startTime: lesson.startTime, // Keep for sorting if needed
          joinLabel: joinLabel // Pre-calculated label
        };
      });
    
    
    // Sort by lesson time
    students.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    // Cache students array for efficient label updates
    this.currentStudents = students;
    this.cachedStudentsForDate = students; // Cache for template reuse
    
    // Enrich profile pictures from latest user data (fetch by email)
    students.forEach(s => {
      if (!s.profilePicture || s.profilePicture === 'assets/avatar.png') {
        if (s.email) {
          this.userService.getUserByEmail(s.email).subscribe(u => {
            if (u && u.picture) {
              s.profilePicture = u.picture;
            }
          });
        }
      }
    });
    
    return students;
  }

  // Get the next class student (the one with isNextClass: true)
  getNextClassStudent(): any | null {
    const students = this.getStudentsForDate();
    return students.find(s => s.isNextClass) || null;
  }

  // Format student display name as "First L."
  formatStudentDisplayName(studentOrName: any): string {
    // Handle if it's a student object with firstName and lastName
    if (typeof studentOrName === 'object' && studentOrName) {
      const firstName = studentOrName.firstName;
      const lastName = studentOrName.lastName;
      
      if (firstName && lastName) {
        return `${this.capitalize(firstName)} ${lastName.charAt(0).toUpperCase()}.`;
      } else if (firstName) {
        return this.capitalize(firstName);
      }
      
      // Fall back to name field if firstName/lastName not available
      const rawName = studentOrName.name || studentOrName.email;
      if (!rawName) return 'Student';
      return this.formatStudentDisplayName(rawName); // Recursively handle the string
    }
    
    // Handle if it's just a string name
    const rawName = studentOrName;
    if (!rawName || typeof rawName !== 'string') {
      return 'Student';
    }

    const name = rawName.trim();

    // If it's an email, use the part before @ as a fallback
    if (name.includes('@')) {
      const base = name.split('@')[0];
      if (!base) return 'Student';
      const parts = base.split(/[.\s_]+/).filter(Boolean);
      const first = parts[0];
      const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : '';
      return lastInitial
        ? `${this.capitalize(first)} ${lastInitial.toUpperCase()}.`
        : this.capitalize(first);
    }

    const parts = name.split(' ').filter(Boolean);
    if (parts.length === 1) {
      return this.capitalize(parts[0]);
    }

    const first = this.capitalize(parts[0]);
    const last = parts[parts.length - 1];
    const lastInitial = last ? last[0].toUpperCase() : '';
    return lastInitial ? `${first} ${lastInitial}.` : first;
  }

  formatTutorDisplayName(tutorOrName: any): string {
    // Handle if it's a tutor object with firstName and lastName
    if (typeof tutorOrName === 'object' && tutorOrName) {
      const firstName = tutorOrName.firstName;
      const lastName = tutorOrName.lastName;
      
      if (firstName && lastName) {
        return `${this.capitalize(firstName)} ${lastName.charAt(0).toUpperCase()}.`;
      } else if (firstName) {
        return this.capitalize(firstName);
      }
      
      // Fall back to name field if firstName/lastName not available
      const rawName = tutorOrName.name || tutorOrName.email;
      if (!rawName) return 'Tutor';
      return this.formatTutorDisplayName(rawName); // Recursively handle the string
    }
    
    // Handle if it's just a string name
    const rawName = tutorOrName;
    if (!rawName || typeof rawName !== 'string') {
      return 'Tutor';
    }

    const name = rawName.trim();

    // If it's an email, use the part before @ as a fallback
    if (name.includes('@')) {
      const base = name.split('@')[0];
      if (!base) return 'Tutor';
      const parts = base.split(/[.\s_]+/).filter(Boolean);
      const first = parts[0];
      const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : '';
      return lastInitial
        ? `${this.capitalize(first)} ${lastInitial.toUpperCase()}.`
        : this.capitalize(first);
    }

    const parts = name.split(' ').filter(Boolean);
    if (parts.length === 1) {
      return this.capitalize(parts[0]);
    }

    const first = this.capitalize(parts[0]);
    const last = parts[parts.length - 1];
    const lastInitial = last ? last[0].toUpperCase() : '';
    return lastInitial ? `${first} ${lastInitial}.` : first;
  }

  private capitalize(value: string): string {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  // Check if the next class is currently in progress
  isNextClassInProgress(): boolean {
    const nextClassStudent = this.getNextClassStudent();
    if (!nextClassStudent || !nextClassStudent.lesson) {
      return false;
    }
    
    const lesson = nextClassStudent.lesson;
    const now = new Date();
    const startTime = new Date(lesson.startTime);
    const endTime = new Date(lesson.endTime);
    
    // Check if lesson status is in_progress OR if current time is between start and end
    return lesson.status === 'in_progress' || (now >= startTime && now <= endTime);
  }

  // Get students for date excluding the next class one
  getOtherStudentsForDate(): any[] {
    const students = this.getStudentsForDate();
    return students.filter(s => s && !s.isNextClass); // Filter out null/undefined entries
  }

  // Check if there were completed lessons earlier today
  hadLessonsEarlierToday(): boolean {
    if (!this.selectedDate) {
      return false;
    }
    
    const now = new Date();
    const today = this.startOfDay(new Date());
    const selectedDay = this.startOfDay(this.selectedDate);
    const isToday = selectedDay.getTime() === today.getTime();
    
    // Only check for today
    if (!isToday) {
      return false;
    }
    
    // Check current lessons, past lessons, AND cancelled lessons for today
    // (since this.lessons now only includes in-progress/upcoming, we need to check pastLessons too)
    const allLessonsToday = [
      ...this.lessons.filter(lesson => {
        const lessonDate = new Date(lesson.startTime);
        const lessonDay = this.startOfDay(lessonDate);
        return lessonDay.getTime() === selectedDay.getTime();
      }),
      ...this.pastLessons.filter(lesson => {
        const lessonDate = new Date(lesson.startTime);
        const lessonDay = this.startOfDay(lessonDate);
        return lessonDay.getTime() === selectedDay.getTime();
      }),
      // Include cancelled lessons that were scheduled for today
      ...this.cancelledLessons.filter(lesson => {
        const lessonDate = new Date(lesson.startTime);
        const lessonDay = this.startOfDay(lessonDate);
        return lessonDay.getTime() === selectedDay.getTime();
      })
    ];
    
    // Check if any lessons happened earlier today or were scheduled for today
    // A lesson counts as "earlier today" if:
    // 1. Status is 'completed', OR
    // 2. Status is 'cancelled', OR
    // 3. Its end time was in the past
    const completedLessonsToday = allLessonsToday.filter(l => {
      // Check if status is explicitly 'completed'
      if (l.status === 'completed') {
        return true;
      }
      
      // Check if status is 'cancelled' (counts as having had a lesson scheduled)
      if (l.status === 'cancelled') {
        return true;
      }
      
      // Also check if lesson time has passed (even if status isn't updated)
      const startTime = new Date(l.startTime);
      const endTime = l.endTime ? new Date(l.endTime) : new Date(startTime.getTime() + 60 * 60 * 1000); // Assume 1 hour if no end time
      
      // Check if lesson ended more than 10 minutes ago
      const graceMinutes = 10;
      const gracePeriodAgo = new Date(now.getTime() - graceMinutes * 60 * 1000);
      const hasEnded = endTime < gracePeriodAgo;
      
      return hasEnded;
    });
    
    return completedLessonsToday.length > 0;
  }

  // Check if today's lessons were only cancelled (no completed lessons)
  checkHadOnlyCancelledLessonsToday(): boolean {
    if (!this.selectedDate) {
      return false;
    }
    
    const now = new Date();
    const today = this.startOfDay(new Date());
    const selectedDay = this.startOfDay(this.selectedDate);
    const isToday = selectedDay.getTime() === today.getTime();
    
    // Only check for today
    if (!isToday) {
      return false;
    }
    
    // Get all lessons for today (same logic as hadLessonsEarlierToday)
    const allLessonsToday = [
      ...this.lessons.filter(lesson => {
        const lessonDate = new Date(lesson.startTime);
        const lessonDay = this.startOfDay(lessonDate);
        return lessonDay.getTime() === selectedDay.getTime();
      }),
      ...this.pastLessons.filter(lesson => {
        const lessonDate = new Date(lesson.startTime);
        const lessonDay = this.startOfDay(lessonDate);
        return lessonDay.getTime() === selectedDay.getTime();
      }),
      ...this.cancelledLessons.filter(lesson => {
        const lessonDate = new Date(lesson.startTime);
        const lessonDay = this.startOfDay(lessonDate);
        return lessonDay.getTime() === selectedDay.getTime();
      })
    ];
    
    // Check if there are any completed lessons (not cancelled)
    const completedLessons = allLessonsToday.filter(l => {
      if (l.status === 'completed') {
        return true;
      }
      // Check if lesson time has passed (completed but status not updated)
      const startTime = new Date(l.startTime);
      const endTime = l.endTime ? new Date(l.endTime) : new Date(startTime.getTime() + 60 * 60 * 1000);
      const graceMinutes = 10;
      const gracePeriodAgo = new Date(now.getTime() - graceMinutes * 60 * 1000);
      return endTime < gracePeriodAgo && l.status !== 'cancelled';
    });
    
    // Check if there are any cancelled lessons
    const cancelledLessons = allLessonsToday.filter(l => l.status === 'cancelled');
    
    // Return true if there are cancelled lessons but no completed lessons
    return cancelledLessons.length > 0 && completedLessons.length === 0;
  }

  getGreeting(): string {
    const now = new Date();
    const hour = now.getHours();
    const name = this.currentUser?.firstName || '';

    let key: string;
    if (hour >= 5 && hour < 12) {
      key = 'HOME.GREETING_MORNING';
    } else if (hour >= 12 && hour < 17) {
      key = 'HOME.GREETING_AFTERNOON';
    } else if (hour >= 17 && hour < 22) {
      key = 'HOME.GREETING_EVENING';
    } else {
      key = 'HOME.GREETING_NIGHT';
    }

    return this.translateService.instant(key, { name });
  }

  getWelcomeMessage(): string {
    if (!this.nextLesson && this.hasAvailability && !this.hadLessonsToday) {
      return this.translateService.instant('HOME.WELCOME_OPEN_SCHEDULE');
    }
    if (!this.nextLesson && this.hasAvailability && this.hadLessonsToday && !this.hadOnlyCancelledLessonsToday) {
      return this.translateService.instant('HOME.WELCOME_GREAT_WORK');
    }
    if (!this.nextLesson && this.hasAvailability && this.hadLessonsToday && this.hadOnlyCancelledLessonsToday) {
      return this.translateService.instant('HOME.WELCOME_PLANS_CHANGED');
    }
    if (!this.nextLesson && !this.hasAvailability && this.pendingFeedbackCount === 0) {
      return this.translateService.instant('HOME.WELCOME_SET_AVAILABILITY');
    }
    if (this.pendingFeedbackCount > 0) {
      return this.translateService.instant('HOME.WELCOME_FEEDBACK_NEEDED');
    }
    return '';
  }

  /** Refreshes time-sensitive pre-computed fields on the cached nextLesson object. */
  private refreshNextLessonTimeSensitiveFields(): void {
    const cached = this._cachedFirstLesson;
    if (cached?.lesson) {
      cached.isInProgress = this.isLessonInProgress(cached.lesson);
      cached.hasStarted = this.hasLessonStarted(cached.lesson);
      cached.countdown = this.getTimeUntilLesson(cached.lesson);
      cached.joinLabel = this.calculateJoinLabel(cached.lesson);
    }
  }

  /** Refreshes all pre-computed template values that depend on user/lesson state. */
  private refreshPreComputedTemplateValues(): void {
    this.greetingText = this.getGreeting();
    this.welcomeMessageText = this.getWelcomeMessage();
    this.buttonTextState = this.hasAvailability ? 'view' : 'add';
    const nl = this.nextLesson;
    this.nextLessonTutor = nl ? (nl.tutorId || nl.studentId) : null;
    const lesson = nl?.lesson as any;
    if (lesson?.isClass) {
      const price = lesson.price ?? lesson.classData?.price;
      this.upNextFormattedPrice = price != null && price > 0 ? `$${(price as number).toFixed(2)}` : 'Free';
      const levelMap: Record<string, string> = {
        any: 'Any Level', beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced',
      };
      const rawLevel = lesson.classData?.level || lesson.level || '';
      this.upNextLevelLabel = levelMap[rawLevel] || '';
      this.nextLessonClassAttendeesDisplay = this.getClassAttendeesForPreview(lesson);
    } else {
      this.upNextFormattedPrice = '';
      this.upNextLevelLabel = '';
      this.nextLessonClassAttendeesDisplay = [];
    }
    this.refreshNextLessonTimeSensitiveFields();
    this.refreshWeeklyEarningsProgress();
  }

  /** Real enrollments when present; otherwise mock list so Up Next “Going” is visible in dev/preview. */
  private getClassAttendeesForPreview(lesson: any): any[] {
    if (!lesson?.isClass) return [];
    const a = lesson.attendees;
    if (Array.isArray(a) && a.length > 0) return a;
    return [...MOCK_CLASS_ATTENDEES_PREVIEW];
  }

  /** Syncs mobile tutor welcome hero, empty-state copy, and Up Next cover when lessons load. */
  private syncTutorMobileWelcomeAboveUpNext(): void {
    this.syncTutorMobileWelcomeSection();
    this.syncMobileHeroBanner();
    this.emptyStateTitle = this.getEmptyStateTitle();
    this.emptyStateMessage = this.getEmptyStateMessage();
    this.syncTutorMobileUpNextCoverUrl();
    this.syncThisWeekMobileNothingYet();
  }

  private syncThisWeekMobileNothingYet(): void {
    if (!this.isTutorUser || this.isLoadingLessons) {
      this.thisWeekMobileShowNothingYet = false;
      this.thisWeekAvatars = [];
      this.thisWeekLessonCount = 0;
      return;
    }

    const now = new Date();
    const weekStart = this.getStartOfWeek(this.startOfDay(now));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const upNextLessonId = this.nextLesson?.lesson?._id ? String(this.nextLesson.lesson._id) : null;

    const weekLessons = this.lessons.filter(l => {
      if (l.status === 'cancelled' || l.status === 'completed') return false;
      if (upNextLessonId && String(l._id) === upNextLessonId) return false;
      const start = new Date(l.startTime);
      return start >= now && start < weekEnd;
    });

    this.thisWeekLessonCount = weekLessons.length;

    const studentMap = new Map<string, { name: string; avatar: string | null; lessonCount: number }>();
    for (const lesson of weekLessons) {
      const isClass = (lesson as any).isClass;
      let key: string;
      let name: string;
      let avatar: string | null;

      if (isClass) {
        key = 'class_' + ((lesson as any).className || lesson.subject || 'group');
        name = (lesson as any).className || lesson.subject || 'Group Class';
        avatar = (lesson as any).classData?.thumbnail || null;
      } else {
        const student = lesson.studentId as any;
        const studentId = typeof student === 'string' ? student : student?._id || student?.id || 'unknown';
        key = studentId;
        name = student ? this.formatStudentDisplayName(student) : 'Unknown';
        avatar = student?.picture || student?.profilePicture || null;
      }

      const existing = studentMap.get(key);
      if (existing) {
        existing.lessonCount++;
      } else {
        studentMap.set(key, { name, avatar, lessonCount: 1 });
      }
    }

    this.thisWeekAvatars = Array.from(studentMap.values());
    this.thisWeekSingleLesson = weekLessons.length === 1 ? weekLessons[0] : null;
    this.thisWeekMobileShowNothingYet = this.thisWeekLessonCount === 0;

    if (this.thisWeekMobileShowNothingYet) {
      const hadLessonsThisWeek =
        this.nextLesson != null ||
        this.pastLessons.some(l => {
          const s = new Date(l.startTime);
          return s >= weekStart && s < weekEnd;
        }) ||
        this.lessons.some(l => {
          const s = new Date(l.startTime);
          return l.status === 'completed' && s >= weekStart && s < weekEnd;
        });
      this.thisWeekEmptyLabel = hadLessonsThisWeek ? 'HOME.THIS_WEEK_NOTHING_ELSE' : 'HOME.THIS_WEEK_NOTHING_YET';
    }
  }

  /** Mobile tutor home: headline + subtitle match desktop welcome (not MOBILE_TUTOR_DASHBOARD). */
  private syncTutorMobileWelcomeSection(): void {
    if (!this.isTutorUser || !this.isMobile) {
      this.tutorMobileWelcomeTitle = '';
      this.tutorMobileWelcomeSubtitle = '';
      return;
    }
    this.tutorMobileWelcomeTitle = this.getGreeting();
    if (this.isLoadingLessons) {
      this.tutorMobileWelcomeSubtitle = '';
      return;
    }
    if (this.nextLesson && this.nextLessonTimeLabel) {
      this.tutorMobileWelcomeSubtitle = '';
      return;
    }
    this.tutorMobileWelcomeSubtitle = this.getWelcomeMessage();
  }

  private syncTutorMobileUpNextCoverUrl(): void {
    if (!this.isMobile || !this.isTutorUser) {
      this.tutorMobileUpNextCoverUrl = null;
      return;
    }
    const row = this.nextLesson;
    if (!row?.lesson) {
      this.tutorMobileUpNextCoverUrl = null;
      return;
    }
    const lesson = row.lesson as Lesson & { isClass?: boolean; classData?: { thumbnail?: string } };
    if (lesson.isClass && lesson.classData?.thumbnail) {
      this.tutorMobileUpNextCoverUrl = lesson.classData.thumbnail;
      return;
    }
    const avatar = this.getOtherParticipantAvatar(lesson);
    if (avatar && avatar !== 'assets/avatar.png') {
      this.tutorMobileUpNextCoverUrl = avatar;
      return;
    }
    this.tutorMobileUpNextCoverUrl = null;
  }

  private static readonly STUDY_LANG_DISPLAY: Record<string, string> = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese',
    ru: 'Russian',
    ar: 'Arabic',
    hi: 'Hindi',
    nl: 'Dutch',
    pl: 'Polish',
    tr: 'Turkish',
    vi: 'Vietnamese',
  };

  private languageCodeToDisplayName(code: string): string {
    const c = (code || '').toLowerCase().split(/[-_]/)[0];
    return Tab1Page.STUDY_LANG_DISPLAY[c] || (code ? code.charAt(0).toUpperCase() + code.slice(1).toLowerCase() : '');
  }

  /** Large white headline block on mobile home (student + tutor). */
  private syncMobileHeroBanner(): void {
    if (!this.isMobile || !this.currentUser) {
      this.mobileHeroHeadline = '';
      return;
    }
    if (this.isLoadingLessons) {
      this.mobileHeroHeadline = '';
      return;
    }
    if (this.isStudentUser) {
      const code = this.currentUser.onboardingData?.languages?.[0];
      this.mobileHeroHeadline = code
        ? this.translateService.instant('HOME.MOBILE_HEADLINE_CONTINUE', {
            language: this.languageCodeToDisplayName(code),
          })
        : this.translateService.instant('HOME.MOBILE_HEADLINE_FALLBACK');
    } else if (this.isTutorUser) {
      // Tutor mobile: welcome block uses tutorMobileWelcomeTitle / subtitle instead
      this.mobileHeroHeadline = '';
    } else {
      this.mobileHeroHeadline = '';
    }
  }

  getEmptyStateTitle(): string {
    if (!this.hadLessonsToday) {
      return this.translateService.instant('HOME.EMPTY_TITLE_CLEAR');
    }
    return this.translateService.instant('HOME.EMPTY_TITLE_DONE');
  }

  getEmptyStateMessage(): string {
    if (!this.hasAvailability) {
      return this.translateService.instant('HOME.EMPTY_MSG_NO_AVAILABILITY');
    }
    if (!this.hadLessonsToday) {
      return this.translateService.instant('HOME.EMPTY_MSG_OPEN');
    }
    if (this.hadOnlyCancelledLessonsToday) {
      return this.translateService.instant('HOME.EMPTY_MSG_CANCELLED');
    }
    return this.translateService.instant('HOME.EMPTY_MSG_COMPLETED');
  }

  getComingUpEmptyMessage(): string {
    if (this.nextLesson) {
      return this.translateService.instant('HOME.COMING_UP_NO_ADDITIONAL');
    }
    if (this.hadLessonsToday && !this.hadOnlyCancelledLessonsToday) {
      return this.translateService.instant('HOME.COMING_UP_NO_MORE');
    }
    if (this.hadLessonsToday && this.hadOnlyCancelledLessonsToday) {
      return this.translateService.instant('HOME.COMING_UP_CANCELLED');
    }
    return this.translateService.instant('HOME.COMING_UP_NONE');
  }

  // Get the absolute NEXT lesson (regardless of date) - used for "Up Next" card
  get nextLesson(): any | null {
    // Create a hash of the inputs to detect changes
    // MUST include both lessons and cancelledLessons since getNextLesson() checks both
    const lessonsHash = this.lessons.map(l => `${l._id}:${l.startTime}:${l.status}`).join(',');
    const cancelledHash = this.cancelledLessons.map(l => `${l._id}:${l.startTime}:${l.status}`).join(',');
    const currentHash = `next:${lessonsHash}:${cancelledHash}:${Date.now() - (Date.now() % 60000)}`; // Update every minute
    
    // Return cached value if inputs haven't changed
    if (this._cachedFirstLessonHash === currentHash && this._cachedFirstLesson !== undefined) {
      return this._cachedFirstLesson;
    }
    
    // Compute and cache the result
    this._cachedFirstLessonHash = currentHash;
    this._cachedFirstLesson = this.computeNextLesson();
    return this._cachedFirstLesson;
  }

  // Get first lesson for the selected date (cached for performance) - used for timeline
  get firstLessonForSelectedDate(): any | null {
    // Create a hash of the inputs to detect changes
    const selectedDateStr = this.selectedDate ? this.selectedDate.toISOString() : 'null';
    const lessonsHash = this.lessons.map(l => `${l._id}:${l.startTime}:${l.status}`).join(',');
    const currentHash = `${selectedDateStr}:${lessonsHash}:${Date.now() - (Date.now() % 60000)}`; // Update every minute
    
    // Return cached value if inputs haven't changed
    if (this._cachedFirstLessonHash === currentHash && this._cachedFirstLesson !== undefined) {
      return this._cachedFirstLesson;
    }
    
    // Compute and cache the result
    this._cachedFirstLessonHash = currentHash;
    this._cachedFirstLesson = this.computeFirstLessonForSelectedDate();
    return this._cachedFirstLesson;
  }
  
  // Internal method to compute the absolute next lesson (regardless of date)
  private computeNextLesson(): any | null {
    const now = new Date();
    const today = this.startOfDay(new Date());
    
    // Get ALL upcoming/active lessons (across all dates)
    const allUpcomingLessons = this.lessons
      .filter(l => {
        if (l.status !== 'scheduled' && l.status !== 'in_progress' && l.status !== 'pending_reschedule') return false;
        const startTime = new Date(l.startTime);
        const endTime = new Date(l.endTime);
        // Include lessons that are in progress (started but not ended yet)
        if (startTime <= now && now < endTime) {
          return true;
        }
        // Include lessons that haven't started yet (upcoming)
        return startTime > now;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    if (allUpcomingLessons.length === 0) {
      return null;
    }
    
    const nextLesson = allUpcomingLessons[0];
    const lessonDate = new Date(nextLesson.startTime);
    const lessonDay = this.startOfDay(lessonDate);
    const isToday = lessonDay.getTime() === today.getTime();
    
    // Handle both classes and regular lessons
    let student: any = null;
    if ((nextLesson as any).isClass) {
      // For classes, show class info
      student = {
        id: String(nextLesson._id),
        name: (nextLesson as any).className || nextLesson.subject || 'Class',
        profilePicture: 'assets/avatar.png',
        email: '',
        rating: 0,
        isClass: true
      };
    } else {
      // For regular lessons, show the OTHER participant (tutor for students, student for tutors)
      const isTutorView = this.isTutor();
      const participantData = isTutorView 
        ? (nextLesson.studentId && typeof nextLesson.studentId === 'object' ? nextLesson.studentId : null)
        : (nextLesson.tutorId && typeof nextLesson.tutorId === 'object' ? nextLesson.tutorId : null);
      
      if (participantData) {
        const participant = participantData as any;
        // Build full name from firstName and lastName if available, otherwise use name field
        let fullName = participant.name || participant.email;
        if (participant.firstName && participant.lastName) {
          fullName = `${participant.firstName} ${participant.lastName}`;
        } else if (participant.firstName) {
          fullName = participant.firstName;
        }
        
        student = {
          id: participant._id,
          name: fullName,
          firstName: participant.firstName,
          lastName: participant.lastName,
          profilePicture: participant.picture || participant.profilePicture || 'assets/avatar.png',
          email: participant.email,
          rating: participant.rating || 4.5,
        };
      }
    }
    
    const dateTag = this.getDateTag(lessonDate);
    const dateBadge = this.lessonDateBadgeParts(lessonDate);
    const isInProgress = this.isLessonInProgress(nextLesson);
    
    // Precompute flags to avoid function calls in template
    const isRescheduleProposer = this.isRescheduleProposer(nextLesson);
    const rescheduleAccepted = (nextLesson as any).rescheduleProposal?.status === 'accepted';
    const isTrialLesson = nextLesson.isTrialLesson || false;
    
    return {
      ...student,
      lessonId: String(nextLesson._id),
      lesson: nextLesson,
      lessonTime: this.formatLessonTime(nextLesson),
      subject: this.formatSubject(nextLesson.subject),
      dateTag: dateTag,
      dateBadgeMonth: dateBadge.month,
      dateBadgeDay: dateBadge.dayNum,
      dateBadgeWeekday: dateBadge.weekdayShort,
      isToday: isToday,
      isNextClass: true,
      isInProgress: isInProgress,
      startTime: nextLesson.startTime,
      joinLabel: this.calculateJoinLabel(nextLesson),
      isRescheduleProposer: isRescheduleProposer,
      rescheduleAccepted: rescheduleAccepted,
      isTrialLesson: isTrialLesson,
      timeRange: this.getTimeRangeOnly(nextLesson),
      detailDatePrimary: this.formatEventDetailsDatePrimary(lessonDate),
      detailTimeRange: this.formatEventDetailsTimeRange(nextLesson),
      avatar: this.getOtherParticipantAvatar(nextLesson),
      instructorName: this.getClassInstructorName(nextLesson),
      countdown: this.getTimeUntilLesson(nextLesson),
      hasStarted: this.hasLessonStarted(nextLesson)
    };
  }
  
  // Internal method to compute first lesson (called by cached getter)
  private computeFirstLessonForSelectedDate(): any | null {
    if (!this.selectedDate) {
      return null;
    }
    
    const now = new Date();
    const today = this.startOfDay(new Date());
    const selectedDay = this.startOfDay(this.selectedDate);
    const isToday = selectedDay.getTime() === today.getTime();
    
    // Get all lessons for the selected date
    const lessonsForDate = this.lessonsForSelectedDate();
    
    // Filter for upcoming/active lessons (include pending_reschedule)
    const activeLessons = lessonsForDate.filter(l => {
      if (l.status !== 'scheduled' && l.status !== 'in_progress' && l.status !== 'pending_reschedule') return false;
      const startTime = new Date(l.startTime);
      const endTime = new Date(l.endTime);
      // Include lessons that are in progress (started but not ended yet)
      if (startTime <= now && now < endTime) {
        return true;
      }
      // Include lessons that haven't started yet (upcoming)
      return startTime > now;
    }).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    if (activeLessons.length === 0) {
      return null;
    }
    
    const firstLesson = activeLessons[0];
    
    // Check if this is the actual next class across ALL dates
    const allUpcomingLessons = this.lessons
      .filter(l => {
        if (l.status !== 'scheduled' && l.status !== 'in_progress' && l.status !== 'pending_reschedule') return false;
        const startTime = new Date(l.startTime);
        const endTime = new Date(l.endTime);
        // Include lessons that are in progress (started but not ended yet)
        if (startTime <= now && now < endTime) {
          return true;
        }
        // Include lessons that haven't started yet (upcoming)
        return startTime > now;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    const isNextClass = allUpcomingLessons.length > 0 && String(allUpcomingLessons[0]._id) === String(firstLesson._id);
    
    // Handle both classes and regular lessons
    let student: any = null;
    if ((firstLesson as any).isClass) {
      // For classes, show class info
      student = {
        id: String(firstLesson._id),
        name: (firstLesson as any).className || firstLesson.subject || 'Class',
        profilePicture: 'assets/avatar.png',
        email: '',
        rating: 0,
        isClass: true
      };
    } else if (firstLesson.studentId && typeof firstLesson.studentId === 'object') {
      // For regular lessons, show student info
      const studentData = firstLesson.studentId as any;
      // Build full name from firstName and lastName if available, otherwise use name field
      let fullName = studentData.name || studentData.email;
      if (studentData.firstName && studentData.lastName) {
        fullName = `${studentData.firstName} ${studentData.lastName}`;
      } else if (studentData.firstName) {
        fullName = studentData.firstName;
      }
      
      student = {
        id: studentData._id,
        name: fullName,
        firstName: studentData.firstName,
        lastName: studentData.lastName,
        profilePicture: studentData.picture || studentData.profilePicture || 'assets/avatar.png',
        email: studentData.email,
        rating: studentData.rating || 4.5,
      };
    }
    
    const lessonDate = new Date(firstLesson.startTime);
    const dateTag = this.getDateTag(lessonDate);
    const dateBadge = this.lessonDateBadgeParts(lessonDate);
    const isInProgress = this.isLessonInProgress(firstLesson);
    
    // Precompute reschedule flags to avoid function calls in template
    const isRescheduleProposer = this.isRescheduleProposer(firstLesson);
    const rescheduleAccepted = (firstLesson as any).rescheduleProposal?.status === 'accepted';
    
    return {
      ...student,
      lessonId: String(firstLesson._id),
      lesson: firstLesson,
      lessonTime: this.formatLessonTime(firstLesson),
      subject: this.formatSubject(firstLesson.subject),
      dateTag: dateTag,
      dateBadgeMonth: dateBadge.month,
      dateBadgeDay: dateBadge.dayNum,
      dateBadgeWeekday: dateBadge.weekdayShort,
      isToday: isToday,
      isNextClass: isNextClass,
      isInProgress: isInProgress,
      startTime: firstLesson.startTime,
      joinLabel: this.calculateJoinLabel(firstLesson),
      isRescheduleProposer: isRescheduleProposer,
      rescheduleAccepted: rescheduleAccepted,
      timeRange: this.getTimeRangeOnly(firstLesson),
      detailDatePrimary: this.formatEventDetailsDatePrimary(lessonDate),
      detailTimeRange: this.formatEventDetailsTimeRange(firstLesson),
      avatar: this.getOtherParticipantAvatar(firstLesson),
      instructorName: this.getClassInstructorName(firstLesson),
      countdown: this.getTimeUntilLesson(firstLesson),
      hasStarted: this.hasLessonStarted(firstLesson)
    };
  }

  // Get date tag for featured lessons
  getDateTag(date: Date): string {
    const lessonDate = this.startOfDay(date);
    const today = this.startOfDay(new Date());
    const tomorrow = this.startOfDay(new Date());
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (lessonDate.getTime() === today.getTime()) {
      return 'TODAY';
    } else if (lessonDate.getTime() === tomorrow.getTime()) {
      return 'TOMORROW';
    } else {
      return formatDateInTz(date, this.userTz, { weekday: 'short', month: 'short', day: 'numeric', year: undefined }).replace(',', '.');
    }
  }

  // Get time until lesson starts (e.g., "55 minutes", "2h 30m", "2d 3h")
  // Or elapsed time if already started (e.g., "5m ago", "1h 15m ago")
  getTimeUntilLesson(lesson: any): string {
    if (!lesson) return '';
    
    const now = new Date();
    const startTime = new Date(lesson.startTime);
    const diffMs = startTime.getTime() - now.getTime();
    
    // If lesson has started, show elapsed time
    if (diffMs < 0) {
      const elapsedMs = Math.abs(diffMs);
      const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));
      const hours = Math.floor(elapsedMinutes / 60);
      const minutes = elapsedMinutes % 60;
      
      if (hours > 0) {
        if (minutes > 0) {
          return `${hours}h ${minutes}m ago`;
        }
        return `${hours}h ago`;
      }
      
      if (minutes === 0) {
        return 'just now';
      }
      
      return `${minutes}m ago`;
    }
    
    // Lesson hasn't started yet
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    // If 0 or negative minutes, show "NOW" instead
    if (diffMinutes <= 0) {
      return 'NOW';
    }
    
    const totalHours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    
    // If more than 24 hours, show days
    if (totalHours >= 24) {
      const days = Math.floor(totalHours / 24);
      const remainingHours = totalHours % 24;
      
      if (remainingHours > 0) {
        return `${days}d ${remainingHours}h`;
      }
      return `${days} day${days !== 1 ? 's' : ''}`;
    }
    
    // Less than 24 hours
    if (totalHours > 0) {
      if (minutes > 0) {
        return `${totalHours}h ${minutes}m`;
      }
      return `${totalHours}h`;
    }
    
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  // Check if there are any completed/past lessons for the selected date
  hasPastLessonsForDate(): boolean {
    if (!this.selectedDate) {
      return false;
    }
    
    const lessonsForDate = this.lessonsForSelectedDate();
    const now = new Date();
    
    // Check if there are any completed lessons OR lessons that ended in the past
    return lessonsForDate.some(lesson => {
      if (lesson.status === 'completed') {
        return true;
      }
      
      // Check if lesson has ended (end time is in the past)
      const endTime = new Date(lesson.endTime);
      return endTime < now;
    });
  }

  // New method: Get upcoming lessons (all future lessons)
  getUpcomingLessons(): Lesson[] {
    return this.lessons;
  }

  // Track by function for tutors
  trackByTutorId(index: number, tutor: { id: string; name: string; picture?: string }): string {
    return tutor.id;
  }

  /** Max lessons shown in the desktop This Week horizontal strip (rest via Full schedule / modal). */
  private readonly thisWeekHomeMaxLessons = 15;

  trackByTimelineEvent(_index: number, ev: { lesson?: { _id?: string; startTime?: string } }): string {
    const id = ev?.lesson?._id;
    const st = ev?.lesson?.startTime;
    if (id != null && st != null) {
      return `${id}:${st}`;
    }
    return String(_index);
  }

  trackByTimelineDayGroup(_index: number, group: { dayKey: string }): string {
    return group.dayKey;
  }

  /** Calendar-day groups for the desktop This Week strip (one date column per day, events scroll horizontally). */
  get timelineDayGroups(): Array<{ dayKey: string; dateLabel: string; dateBadgeMonth: string; dateBadgeDay: string; dateBadgeWeekday: string; isToday: boolean; events: any[] }> {
    const events = this.timelineEvents;
    if (!events.length) {
      return [];
    }
    const groups: Array<{ dayKey: string; dateLabel: string; dateBadgeMonth: string; dateBadgeDay: string; dateBadgeWeekday: string; isToday: boolean; events: any[] }> = [];
    for (const ev of events) {
      const st = ev?.lesson?.startTime;
      const d = st ? new Date(st) : new Date();
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const dateLabel = ev.date as string;
      const last = groups[groups.length - 1];
      if (last && last.dayKey === dayKey) {
        last.events.push(ev);
      } else {
        groups.push({
          dayKey,
          dateLabel,
          dateBadgeMonth: ev.dateBadgeMonth || '',
          dateBadgeDay: ev.dateBadgeDay || '',
          dateBadgeWeekday: ev.dateBadgeWeekday || '',
          isToday: !!ev.isToday,
          events: [ev],
        });
      }
    }
    return groups;
  }

  /** Single lesson in a single day — stretch row inside the fixed-width card. */
  get thisWeekStripSingleEvent(): boolean {
    const g = this.timelineDayGroups;
    return g.length === 1 && g[0].events.length === 1;
  }

  // Get timeline events for "Coming Up Next" section (cached for performance)
  get timelineEvents(): any[] {
    // Create a hash of the inputs to detect changes
    const lessonsHash = this.lessons.map(l => `${l._id}:${l.startTime}`).join(',');
    const cancelledHash = this.cancelledLessons.map(l => `${l._id}:${l.startTime}`).join(',');
    const nextLessonId = this.nextLesson?.lessonId || 'null';
    const currentHash = `${lessonsHash}:${cancelledHash}:${nextLessonId}:${Date.now() - (Date.now() % 60000)}`; // Update every minute
    
    // Return cached value if inputs haven't changed
    if (this._cachedTimelineEventsHash === currentHash && this._cachedTimelineEvents.length >= 0) {
      return this._cachedTimelineEvents;
    }
    
    // Compute and cache the result
    this._cachedTimelineEventsHash = currentHash;
    this._cachedTimelineEvents = this.computeTimelineEvents();
    return this._cachedTimelineEvents;
  }
  
  // Internal method to compute timeline events (called by cached getter)
  private computeTimelineEvents(): any[] {
    // Show only active upcoming lessons (cancelled lessons excluded — they're not "coming up")
    const allLessonsForTimeline = [...this.lessons];
    const now = new Date();
    
    // Get the next class being shown in the "Up Next" card (for both tutors and students)
    const nextClassLesson = this.nextLesson;
    // Get the lesson ID - it could be in lessonId, lesson._id, or the lesson object itself
    const nextClassLessonId = nextClassLesson?.lessonId || 
                              nextClassLesson?.lesson?._id || 
                              (nextClassLesson?.lesson && String(nextClassLesson.lesson._id));
    
    // Get all scheduled (non-cancelled) lesson times to check for replacements
    const scheduledLessonTimes = new Set(
      allLessonsForTimeline
        .filter(l => l.status !== 'cancelled')
        .map(l => new Date(l.startTime).getTime())
    );
    
    // Future / active lessons for This Week row(s)
    const baseFilter = (lesson: any) => {
      const startTime = new Date(lesson.startTime);
      const endTime = new Date(lesson.endTime);
      if (startTime <= now) return false;
      if (lesson.status === 'completed') return false;
      return true;
    };

    const pool = allLessonsForTimeline
      .filter(baseFilter)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // Always omit the Up Next lesson — the Up Next card already shows it.
    // If no other lessons remain, This Week will be hidden entirely.
    const withoutNext = pool.filter(
      (lesson) => !nextClassLessonId || String(lesson._id) !== String(nextClassLessonId)
    );
    const cap = this.thisWeekHomeMaxLessons;
    const chosen = withoutNext.slice(0, cap);

    return chosen.map((lesson) => {
        const startTime = new Date(lesson.startTime);
        const endTime = lesson.endTime ? new Date(lesson.endTime) : null;
        const student = lesson.studentId as any;
        const tutor = lesson.tutorId as any;
        const isClass = (lesson as any).isClass;
        const isCancelled = lesson.status === 'cancelled';
        
        // For classes, ensure tutor is properly extracted (could be populated object or ID)
        let tutorObj = tutor;
        if (isClass && tutor && typeof tutor === 'object') {
          tutorObj = tutor; // Already populated
        } else if (isClass && lesson.tutorId && typeof lesson.tutorId === 'object') {
          tutorObj = lesson.tutorId; // Use the populated tutorId
        }
        
        // Precompute reschedule flags
        const isRescheduleProposer = this.isRescheduleProposer(lesson);
        const rescheduleAccepted = lesson.rescheduleProposal?.status === 'accepted';
        
        // Determine which participant to show based on user role
        const isStudentView = this.isStudent();
        const participantToShow = isStudentView ? tutorObj : student;
        
        // Precompute status label and class for table display
        const statusLabel = isCancelled ? 'CANCELLED'
          : lesson.status === 'in_progress' ? 'IN PROGRESS'
          : lesson.status === 'pending_reschedule' ? 'PENDING'
          : lesson.status === 'scheduled' ? 'CONFIRMED'
          : 'SCHEDULED';
        const statusClass = isCancelled ? 'cancelled'
          : lesson.status === 'in_progress' ? 'in-progress'
          : lesson.status === 'pending_reschedule' ? 'pending'
          : 'confirmed';

        const lessonDayStart = this.startOfDay(startTime);
        const todayStart = this.startOfDay(new Date());
        const isLessonToday = lessonDayStart.getTime() === todayStart.getTime();
        const dateBadge = this.lessonDateBadgeParts(startTime);
        
        return {
          time: this.formatTimeOnly(startTime),
          endTime: endTime ? this.formatTimeOnly(endTime) : null,
          date: this.formatRelativeDate(startTime),
          isToday: isLessonToday,
          dateBadgeMonth: dateBadge.month,
          dateBadgeDay: dateBadge.dayNum,
          dateBadgeWeekday: dateBadge.weekdayShort,
          /** Mirrors lesson.isClass — used by This Week strip for layout (avatar shape, no ring). */
          isClass: !!isClass,
          detailDatePrimary: this.formatEventDetailsDatePrimary(startTime),
          detailTimeRange: this.formatEventDetailsTimeRange(lesson),
          name: isClass 
            ? ((lesson as any).className || lesson.subject || 'Group Class')
            : (participantToShow ? (isStudentView ? this.formatTutorDisplayName(participantToShow) : this.formatStudentDisplayName(participantToShow)) : 'Unknown'),
          subject: isClass 
            ? 'Group Class'
            : this.formatSubject(lesson.subject),
          avatar: isClass 
            ? ((lesson as any).classData?.thumbnail || null) // Show class thumbnail if available
            : (participantToShow?.picture || participantToShow?.profilePicture || null),
          lesson: lesson,
          tutor: tutorObj, // Include tutor object for easy access (use properly extracted tutor)
          isTrialLesson: lesson.isTrialLesson || false,
          isCancelled: isCancelled,
          cancelReason: isCancelled ? lesson.cancelReason : null,
          isRescheduleProposer: isRescheduleProposer,
          rescheduleAccepted: rescheduleAccepted,
          duration: (lesson as any).duration || 25,
          statusLabel: statusLabel,
          statusClass: statusClass
        };
      });
  }

  // Get count of scheduled (non-cancelled) timeline events
  get scheduledTimelineCount(): number {
    return this.timelineEvents.filter(e => !e.isCancelled).length;
  }

  // Count of additional lessons on the same day as the first timeline event
  get sameDayExtraCount(): number {
    const events = this.timelineEvents;
    if (events.length < 2) return 0;
    const firstDate = events[0].date;
    return events.filter((e: any, i: number) => i > 0 && e.date === firstDate).length;
  }
  
  // Get count of cancelled timeline events
  get cancelledTimelineCount(): number {
    return this.timelineEvents.filter(e => e.isCancelled).length;
  }

  hasMoreTimelineEvents(): boolean {
    const allLessons = [...this.lessons, ...this.cancelledLessons];
    const now = new Date();
    const futureLessons = allLessons.filter(lesson => new Date(lesson.startTime) > now);
    
    // Get the next class being shown in the "Up Next" card (for both tutors and students)
    const nextClassLesson = this.nextLesson;
    const nextClassLessonId = nextClassLesson?.lessonId || 
                              nextClassLesson?.lesson?._id || 
                              (nextClassLesson?.lesson && String(nextClassLesson.lesson._id));
    
    // Filter out the next class from count
    const timelineLessons = futureLessons.filter(lesson => {
      if (nextClassLessonId && String(lesson._id) === String(nextClassLessonId)) return false;
      return true;
    });
    
    return timelineLessons.length > this.thisWeekHomeMaxLessons;
  }

  // Track if all lessons modal is open
  isAllLessonsModalOpen = false;
  allLessonsForModal: any[] = [];
  
  // Track if feedback modal is open
  isFeedbackModalOpen = false;

  /**
   * Open modal to show all upcoming lessons (Airbnb style)
   */
  async openAllLessonsModal() {
    // Reset filter state
    this.selectedFilterMonth = null;
    this.selectedFilterYear = null;
    this.selectedDateForPicker = new Date().toISOString();
    
    // Get all future lessons (exclude cancelled — they're not "upcoming")
    const allLessons = [...this.lessons];
    const now = new Date();
    
    this.allLessonsForModal = allLessons
      .filter(lesson => new Date(lesson.startTime) > now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .map(lesson => {
        const startTime = new Date(lesson.startTime);
        const endTime = lesson.endTime ? new Date(lesson.endTime) : null;
        const student = lesson.studentId as any;
        const tutor = lesson.tutorId as any;
        const isStudentView = this.isStudent();
        const participantToShow = isStudentView ? tutor : student;
        
        return {
          date: this.formatRelativeDate(startTime),
          fullDate: this.formatFullDate(startTime),
          time: this.formatTimeOnly(startTime),
          endTime: endTime ? this.formatTimeOnly(endTime) : null,
          name: participantToShow ? (isStudentView ? this.formatTutorDisplayName(participantToShow) : this.formatStudentDisplayName(participantToShow)) : 'Unknown',
          avatar: participantToShow?.picture || participantToShow?.profilePicture || null,
          subject: this.formatSubject(lesson.subject),
          duration: lesson.duration || 25,
          isCancelled: lesson.status === 'cancelled',
          lesson: lesson
        };
      });
    
    // Store unfiltered list
    this.allLessonsUnfiltered = [...this.allLessonsForModal];
    
    this.isAllLessonsModalOpen = true;
  }

  closeAllLessonsModal() {
    this.isAllLessonsModalOpen = false;
    this.isDatePickerView = false; // Reset to lessons view
  }

  // Date picker view state (same modal, different view)
  isDatePickerView = false;
  selectedDateForPicker: string = new Date().toISOString();
  minDateForPicker: string = new Date().toISOString();
  highlightedLessonDates: any[] = [];
  
  // Filtering state
  selectedFilterMonth: number | null = null;
  selectedFilterYear: number | null = null;
  allLessonsUnfiltered: any[] = [];
  
  // Get current month label for display
  /** Current UI locale for date/time formatting (e.g. 'en', 'fr') */
  get currentLocale(): string {
    return this.translateService.currentLang || this.translateService.defaultLang || 'en';
  }

  get currentMonthLabel(): string {
    const d = this.selectedFilterMonth !== null && this.selectedFilterYear !== null
      ? new Date(this.selectedFilterYear, this.selectedFilterMonth, 1)
      : new Date();
    const loc = this.currentLocale;
    const formatter = new Intl.DateTimeFormat(loc, {
      month: 'long',
      year: 'numeric',
      ...(this.userTz ? { timeZone: this.userTz } : {})
    });
    return formatter.format(d);
  }

  // Pre-computed flag for smooth animations
  get hasMonthFilter(): boolean {
    return this.selectedFilterMonth !== null;
  }

  openDatePickerView() {
    // Store unfiltered lessons if not already stored
    if (this.allLessonsUnfiltered.length === 0) {
      this.allLessonsUnfiltered = [...this.allLessonsForModal];
    }
    
    // Get dates that have lessons for highlighting (from unfiltered list)
    const lessonDates = this.allLessonsUnfiltered.map(event => {
      const date = new Date(event.lesson.startTime);
      return {
        date: date.toISOString().split('T')[0],
        textColor: '#E31C5F',
        backgroundColor: '#FCE4EC'
      };
    });
    
    // Remove duplicates
    this.highlightedLessonDates = lessonDates.filter((item, index, self) =>
      index === self.findIndex(t => t.date === item.date)
    );
    
    this.isDatePickerView = true;
  }

  closeDatePickerView() {
    this.isDatePickerView = false;
    
    // Apply month filter if a date was selected
    if (this.selectedFilterMonth !== null && this.selectedFilterYear !== null) {
      this.filterLessonsByMonth();
    }
  }
  
  onDateSelected(event: any) {
    const selectedDate = new Date(event.detail.value);
    this.selectedFilterMonth = selectedDate.getMonth();
    this.selectedFilterYear = selectedDate.getFullYear();
    this.selectedDateForPicker = event.detail.value;
  }
  
  filterLessonsByMonth() {
    if (this.selectedFilterMonth === null || this.selectedFilterYear === null) {
      return;
    }
    
    // Filter lessons to only show those in the selected month
    this.allLessonsForModal = this.allLessonsUnfiltered.filter(event => {
      const lessonDate = new Date(event.lesson.startTime);
      return lessonDate.getMonth() === this.selectedFilterMonth && 
             lessonDate.getFullYear() === this.selectedFilterYear;
    });
  }
  
  clearMonthFilter() {
    this.selectedFilterMonth = null;
    this.selectedFilterYear = null;
    this.allLessonsForModal = [...this.allLessonsUnfiltered];
  }

  // Format full date like "Friday, February 6"
  formatFullDate(date: Date): string {
    return formatDateInTz(date, this.userTz, { weekday: 'long', month: 'long', day: 'numeric', year: undefined }, this.currentLocale);
  }

  /**
   * Open modal to display lesson notes
   */
  async openNotesModal(lesson: any) {
    try {
      // Notes are stored as plain text with \n line breaks
      // Use a modal component instead of alert to properly render formatted text
      const modal = await this.modalCtrl.create({
        component: NotesModalComponent,
        componentProps: {
          lesson: lesson,
          notes: lesson.notes || 'No notes available for this lesson.',
          subject: lesson.subject || 'Lesson',
          time: this.formatLessonTime(lesson)
        },
        cssClass: 'notes-modal-component'
      });
      await modal.present();
    } catch (error) {
      console.error('Error opening notes modal:', error);
      // Fallback to simple alert
      const alert = await this.alertController.create({
        header: 'Lesson Notes',
        subHeader: `${lesson.subject || 'Lesson'} - ${this.formatLessonTime(lesson)}`,
        message: lesson.notes || 'No notes available',
        buttons: ['Close']
      });
      await alert.present();
    }
  }
  
navigateToLessons() {
    this.router.navigate(['/tabs/lessons']);
  }

  // Format time only (e.g., "2:00 PM")
  formatTimeOnly(date: Date): string {
    return formatTimeInTz(date, this.userTz, this.currentLocale);
  }

  /** Month + day chip + short weekday — matches lessons list `lgc-date-badge` (lessons.page). */
  lessonDateBadgeParts(isoOrDate: string | Date): { month: string; dayNum: string; weekdayShort: string } {
    const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
    const loc = this.currentLocale;
    const tz = this.userTz;
    return {
      month: formatDateInTz(d, tz, { month: 'short', day: undefined, year: undefined }, loc),
      dayNum: formatDateInTz(d, tz, { day: 'numeric', month: undefined, year: undefined }, loc),
      weekdayShort: formatDateInTz(d, tz, { weekday: 'short', month: undefined, day: undefined, year: undefined }, loc),
    };
  }

  formatRelativeDate(date: Date): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const diffDays = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return this.translateService.instant('NOTIFICATIONS.TODAY');
    if (diffDays === 1) return this.translateService.instant('NOTIFICATIONS.TOMORROW');
    if (diffDays === -1) return this.translateService.instant('NOTIFICATIONS.YESTERDAY');

    return formatDateInTz(date, this.userTz, { weekday: 'short', month: 'short', day: 'numeric', year: undefined }, this.currentLocale);
  }

  // Navigate to lesson details or join
  navigateToLesson(lesson: Lesson) {
    if (lesson?._id) {
      this.router.navigate(['/tabs/lessons', lesson._id]);
    }
  }

  onThisWeekTap() {
    if (this.thisWeekSingleLesson?._id) {
      this.router.navigate(['/tabs/lessons', this.thisWeekSingleLesson._id]);
    } else {
      this.router.navigate(['/tabs/tutor-calendar']);
    }
  }

  /**
   * Navigate to lesson from modal - closes modal first, then navigates
   */
  navigateToLessonFromModal(lesson: Lesson) {
    // Close modal first
    this.closeAllLessonsModal();
    
    // Small delay to ensure modal closes before navigation
    setTimeout(() => {
      this.navigateToLesson(lesson);
    }, 100);
  }

  // Helper to navigate to pre-call for lesson or class
  async joinLessonById(lesson: Lesson) {
    const isClass = (lesson as any).isClass;
    
    
    
    // Navigate directly to pre-call - don't call backend join yet
    // SECURITY: role is determined from lesson data + auth, not passed in URL
    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: lesson._id,
        lessonMode: 'true',
        isClass: isClass ? 'true' : 'false'
      }
    });
  }

  // Check if lesson can be joined based on time
  canJoinLessonByTime(startTime: Date): boolean {
    const now = new Date();
    const timeDiff = startTime.getTime() - now.getTime();
    const minutesDiff = timeDiff / (1000 * 60);
    
    // Can join 15 minutes before or anytime after start
    return minutesDiff <= 15 && minutesDiff >= -60;
  }

  // New method: Get other participant's avatar (with caching)
  updateNextLessonPresence() {
    const nl = this.nextLesson;
    if (nl?.lesson?._id) {
      const presence = this.lessonPresence.get(String(nl.lesson._id));
      this.nextLessonOtherJoined = !!presence;
      this.nextLessonOtherName = presence?.participantName || '';
    } else {
      this.nextLessonOtherJoined = false;
      this.nextLessonOtherName = '';
    }
  }

  private loadPreviousNotes() {
    const nl = this.nextLesson;
    if (!nl?.lesson?._id || nl.lesson.isClass) {
      this.previousNotesData = null;
      return;
    }
    this.previousNotesLoading = true;
    this.lessonService.getPreviousNotes(nl.lesson._id).subscribe({
      next: (res) => {
        this.previousNotesData = res.hasPreviousNotes ? res : null;
        this.previousNotesLoading = false;
        this.initPrevNotesTranslation();
        this.cdr.markForCheck();
      },
      error: () => {
        this.previousNotesData = null;
        this.previousNotesLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private initPrevNotesTranslation() {
    if (!this.previousNotesData?.analysis) return;
    this.prevNotesAnalysisId = this.previousNotesData.analysisId || null;
    this.prevNotesOriginalAnalysis = this.previousNotesData.analysis;
    this.prevNotesDisplayAnalysis = this.previousNotesData.analysis;
    this.prevNotesShowingTranslation = false;

    if (this.prevNotesAnalysisId) {
      const targetLang = this.currentUser?.nativeLanguage || 'en';
      const cached = this.previousNotesData.translations?.[targetLang];
      if (cached) {
        this.analysisTranslation.seedFromResponse(this.prevNotesAnalysisId, cached);
      }
      if (this.analysisTranslation.isShowingTranslated(this.prevNotesAnalysisId)) {
        const t = this.analysisTranslation.getTranslation(this.prevNotesAnalysisId);
        if (t) {
          this.prevNotesDisplayAnalysis = this.analysisTranslation.applyTranslation(this.prevNotesOriginalAnalysis, t);
          this.prevNotesShowingTranslation = true;
        }
      }
    }
  }

  showPreviousNotesModal() {
    if (!this.previousNotesData?.analysis) return;
    const a = this.prevNotesDisplayAnalysis || this.previousNotesData.analysis;
    this.previousNotesDate = new Date(this.previousNotesData.previousLessonDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const scores: { label: string; value: number }[] = [];
    if (a.grammarAnalysis?.accuracyScore != null) scores.push({ label: 'Grammar', value: a.grammarAnalysis.accuracyScore });
    if (a.fluencyAnalysis?.overallFluencyScore != null) scores.push({ label: 'Fluency', value: a.fluencyAnalysis.overallFluencyScore });
    if (a.pronunciationAnalysis?.overallScore != null) scores.push({ label: 'Pronunciation', value: a.pronunciationAnalysis.overallScore });
    this.previousNotesScores = scores;
    this.isPreviousNotesModalOpen = true;
  }

  private refreshPrevNotesTranslationState() {
    if (!this.prevNotesAnalysisId || !this.prevNotesOriginalAnalysis) return;
    const showing = this.analysisTranslation.isShowingTranslated(this.prevNotesAnalysisId);
    const t = this.analysisTranslation.getTranslation(this.prevNotesAnalysisId);
    if (showing && t) {
      this.prevNotesDisplayAnalysis = this.analysisTranslation.applyTranslation(this.prevNotesOriginalAnalysis, t);
      this.prevNotesShowingTranslation = true;
    } else if (!showing && this.prevNotesShowingTranslation) {
      this.prevNotesDisplayAnalysis = this.prevNotesOriginalAnalysis;
      this.prevNotesShowingTranslation = false;
    }
  }

  togglePrevNotesTranslation() {
    if (!this.prevNotesAnalysisId) return;

    if (this.prevNotesShowingTranslation) {
      this.analysisTranslation.showOriginal(this.prevNotesAnalysisId);
      this.prevNotesDisplayAnalysis = this.prevNotesOriginalAnalysis;
      this.prevNotesShowingTranslation = false;
      return;
    }

    if (this.analysisTranslation.hasTranslation(this.prevNotesAnalysisId)) {
      this.analysisTranslation.showTranslated(this.prevNotesAnalysisId);
      const t = this.analysisTranslation.getTranslation(this.prevNotesAnalysisId);
      if (t) {
        this.prevNotesDisplayAnalysis = this.analysisTranslation.applyTranslation(this.prevNotesOriginalAnalysis, t);
      }
      this.prevNotesShowingTranslation = true;
      return;
    }

    this.prevNotesTranslating = true;
    this.analysisTranslation.translate(this.prevNotesAnalysisId).subscribe({
      next: (t) => {
        this.prevNotesDisplayAnalysis = this.analysisTranslation.applyTranslation(this.prevNotesOriginalAnalysis, t);
        this.prevNotesTranslating = false;
        this.prevNotesShowingTranslation = true;
        this.cdr.detectChanges();
      },
      error: () => {
        this.prevNotesTranslating = false;
        this.cdr.detectChanges();
      }
    });
  }

  closePreviousNotesModal() {
    this.isPreviousNotesModalOpen = false;
  }

  viewFullAnalysis() {
    this.isPreviousNotesModalOpen = false;
    if (this.previousNotesData?.previousLessonId) {
      this.router.navigate(['/lesson-analysis', this.previousNotesData.previousLessonId]);
    }
  }

  // Check if lesson has participant joined (presence)
  hasParticipantJoined(lesson: Lesson | null): boolean {
    if (!lesson) return false;
    return this.lessonPresence.has(lesson._id);
  }

  // Check if lesson has participant joined by lessonId string
  hasParticipantJoinedById(lessonId: string | null | undefined): boolean {
    if (!lessonId) {
      return false;
    }
    // Normalize lessonId to string
    const normalizedId = String(lessonId);
    const hasPresence = this.lessonPresence.has(normalizedId);
    if (!hasPresence) {
      // Try to find by any key that matches (case-insensitive or partial match)
      const allKeys = Array.from(this.lessonPresence.keys());
      const matchingKey = allKeys.find(key => String(key) === normalizedId);
      if (matchingKey) {
        return true;
      }
    }
    return hasPresence;
  }

  // Get presence data for a lesson
  getPresenceData(lesson: Lesson | null): {
    participantName: string;
    participantPicture?: string;
    participantRole: 'tutor' | 'student';
    joinedAt: string;
  } | null {
    if (!lesson) return null;
    return this.lessonPresence.get(lesson._id) || null;
  }

  // Get presence data by lessonId string
  getPresenceDataById(lessonId: string | null | undefined): {
    participantName: string;
    participantPicture?: string;
    participantRole: 'tutor' | 'student';
    joinedAt: string;
  } | null {
    if (!lessonId) return null;
    return this.lessonPresence.get(lessonId) || null;
  }

  // Get presence avatar (uses presence data if available, otherwise falls back to lesson data)
  getPresenceAvatar(lesson: Lesson | null): string | null {
    if (!lesson) return null;
    const presence = this.getPresenceData(lesson);
    if (presence?.participantPicture) {
      return presence.participantPicture;
    }
    return this.getOtherParticipantAvatar(lesson);
  }

  getOtherParticipantAvatar(lesson: Lesson): string | null {
    if (!this.currentUser || !lesson) return null;
    
    // Classes don't have a single participant avatar
    if ((lesson as any).isClass) {
      return null;
    }
    
    // Use lesson ID + participant ID as cache key
    // Safely check if current user is the tutor
    // Handle case where tutorId/studentId might be a string ID or an object
    let tutorId: string | null = null;
    if (lesson.tutorId) {
      if (typeof lesson.tutorId === 'string') {
        tutorId = lesson.tutorId;
      } else if (typeof lesson.tutorId === 'object' && lesson.tutorId !== null) {
        tutorId = (lesson.tutorId as any)?._id || (lesson.tutorId as any)?.id || null;
      }
    }
    
    const isTutor = tutorId && this.currentUser?.id ? tutorId === this.currentUser.id : false;
    
    let participantId: string | null = null;
    if (isTutor) {
      // Get student ID
      if (lesson.studentId) {
        if (typeof lesson.studentId === 'string') {
          participantId = lesson.studentId;
        } else if (typeof lesson.studentId === 'object' && lesson.studentId !== null) {
          participantId = (lesson.studentId as any)?._id || (lesson.studentId as any)?.id || null;
        }
      }
    } else {
      participantId = tutorId;
    }
    
    if (!participantId) return null; // No valid participant ID
    
    const cacheKey = `${lesson._id}-${participantId}`;
    
    // Return cached value if available
    if (this._avatarCache.has(cacheKey)) {
      return this._avatarCache.get(cacheKey)!;
    }
    
    // Calculate and cache the avatar URL
    const other = isTutor ? lesson.studentId : lesson.tutorId;
    let avatarUrl: string | null = null;
    
    // Safely access picture property - handle both object and string ID cases
    if (other != null && typeof other === 'object' && other !== null) {
      // other is an object with potential picture property
      avatarUrl = (other as any)?.picture || (other as any)?.profilePicture || null;
    }
    // If other is a string ID, we can't get the picture from it directly
    // (would need to fetch user data, but that's handled elsewhere)
    
    // Cache the result
    this._avatarCache.set(cacheKey, avatarUrl);
    
    return avatarUrl;
  }

  // New method: Get other participant's specialty
  getOtherParticipantSpecialty(lesson: Lesson): string {
    if (!this.currentUser) return 'Language Learning';
    
    // Handle classes
    if ((lesson as any).isClass) {
      return 'Group Class';
    }
    
    const isTutor = lesson.tutorId?._id === this.currentUser.id;
    
    if (isTutor) {
      return 'Language Student';
    } else {
      const tutor = lesson.tutorId;
      if (typeof tutor === 'object' && tutor) {
        return (tutor as any)?.specialty || 'Language Tutor';
      }
      return 'Language Tutor';
    }
  }

  // Get the instructor name for a class (First L. format)
  getClassInstructorName(lesson: any): string {
    if (!lesson?.tutorId) return 'Instructor';
    
    const tutor = lesson.tutorId;
    if (typeof tutor === 'object' && tutor) {
      // Try multiple ways to get the name
      let firstName = tutor.firstName || '';
      let lastName = tutor.lastName || '';
      
      // Fallback to splitting 'name' field
      if (!firstName && tutor.name) {
        const nameParts = tutor.name.trim().split(/\s+/);
        firstName = nameParts[0] || '';
        lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
      }
      
      // Fallback to email if no name
      if (!firstName && tutor.email) {
        const emailParts = tutor.email.split('@')[0];
        // Try to extract name from email (e.g., john.doe@email.com)
        const emailNameParts = emailParts.split(/[._-]/);
        firstName = emailNameParts[0] || '';
        firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
      }
      
      if (firstName && lastName) {
        return `${firstName} ${lastName.charAt(0).toUpperCase()}.`;
      } else if (firstName) {
        return firstName;
      }
    }
    
    return 'Instructor';
  }

  // Get tutor from lesson (handles both populated and non-populated tutorId)
  getTutorFromLesson(lesson: any): any {
    if (!lesson) return null;
    
    // Try lesson.tutorId first (most common - should be populated for classes)
    if (lesson.tutorId) {
      // If it's an object (populated), return it
      if (typeof lesson.tutorId === 'object' && lesson.tutorId !== null && !Array.isArray(lesson.tutorId)) {
        // It's a populated object - return it
        return lesson.tutorId;
      }
      // If it's a string ID, we can't use it (not populated)
      // Return null so template can fallback to event.tutor
    }
    
    return null;
  }

  // Get tutor picture from multiple possible fields
  getTutorPicture(tutor: any): string | null {
    if (!tutor) return null;
    
    // Handle if tutor is just an ID string (shouldn't happen but be safe)
    if (typeof tutor === 'string') return null;
    
    // Handle if tutor is an object
    if (typeof tutor === 'object') {
      // Try picture first (most common)
      if (tutor.picture && typeof tutor.picture === 'string' && tutor.picture.trim() !== '') {
        return tutor.picture;
      }
      // Try profilePicture
      if (tutor.profilePicture && typeof tutor.profilePicture === 'string' && tutor.profilePicture.trim() !== '') {
        return tutor.profilePicture;
      }
      // Try auth0Picture as last resort
      if (tutor.auth0Picture && typeof tutor.auth0Picture === 'string' && tutor.auth0Picture.trim() !== '') {
        return tutor.auth0Picture;
      }
    }
    
    return null;
  }

  async loadLessons(showSkeleton = true) {
    
    
    // Prevent double-loading which causes flash
    if (this._isLoadingInProgress) {
      
      return;
    }
    
    this._isLoadingInProgress = true;
    
    // Only show skeleton loader if explicitly requested (e.g., initial load)
    if (showSkeleton) {
      this.isLoadingLessons = true;
      
    }
    
    try {
      const resp = await this.lessonService.getMyLessons().toPromise();
      if (resp?.success) {
        
        
        
        const now = Date.now();
        let allLessons = [...resp.lessons];

        // For tutors, also load classes with attendee information
        if (this.isTutor()) {
          const tutorId = (this.currentUser as any)?._id || (this.currentUser as any)?.id;
          if (tutorId) {
            try {
              const classesResp = await this.classService.getClassesForTutor(tutorId).toPromise();
              if (classesResp?.success && classesResp.classes) {
                // Convert classes to lesson-like objects with attendee info
                const classLessons = classesResp.classes.map((cls: any) => ({
                  _id: cls._id,
                  tutorId: tutorId,
                  studentId: null as any, // Classes don't have a single student
                  startTime: cls.startTime,
                  endTime: cls.endTime,
                  status: cls.status || 'scheduled', // Use actual class status
                  subject: cls.name || 'Class',
                  channelName: `class_${cls._id}`,
                  price: cls.price || 0,
                  duration: Math.round((new Date(cls.endTime).getTime() - new Date(cls.startTime).getTime()) / 60000),
                  createdAt: cls.createdAt || new Date(),
                  updatedAt: cls.updatedAt || new Date(),
                  isClass: true, // Mark as class to differentiate
                  className: cls.name,
                  isPublic: cls.isPublic || false, // Include isPublic flag
                  classData: cls, // Store full class data including attendees
                  attendees: cls.attendees || [], // Confirmed students who are going
                  capacity: cls.capacity,
                  invitationStats: cls.invitationStats,
                  cancelReason: cls.cancelReason // Include cancel reason
                } as any));
                
                // Merge classes with lessons
                allLessons = [...allLessons, ...classLessons];
              }
            } catch (error) {
              console.error('Error loading tutor classes:', error);
            }
          }
        }

        
        if (!this.isTutor()) {
          
          try {
            const classesResp = await this.classService.getAcceptedClasses().toPromise();
            
            
            
            if (classesResp?.success && classesResp.classes) {
              // Convert accepted classes to lesson-like objects
              const classLessons = classesResp.classes.map((cls: any) => ({
                _id: cls._id,
                tutorId: cls.tutorId, // Already populated with tutor details
                studentId: null as any, // Classes don't have a single student
                startTime: cls.startTime,
                endTime: cls.endTime,
                status: cls.status || 'scheduled', // Use actual class status
                subject: cls.name || 'Class',
                channelName: `class_${cls._id}`,
                price: cls.price || 0,
                duration: Math.round((new Date(cls.endTime).getTime() - new Date(cls.startTime).getTime()) / 60000),
                createdAt: cls.createdAt || new Date(),
                updatedAt: cls.updatedAt || new Date(),
                isClass: true, // Mark as class to differentiate
                className: cls.name,
                isPublic: cls.isPublic || false, // Include isPublic flag
                classData: cls, // Store full class data
                attendees: cls.confirmedStudents || [], // Other confirmed students (with populated picture/profilePicture)
                capacity: cls.capacity,
                cancelReason: cls.cancelReason // Include cancel reason
              } as any));
              
              
              
              // Merge classes with lessons
              allLessons = [...allLessons, ...classLessons];
              
            }
          } catch (error) {
            console.error('🎓 [TAB1] Error loading student classes:', error);
          }
        } else {
          
        }

        // Tutor home stores only upcoming + today in `this.lessons` — detect past bookings from full feed
        this.tutorHasEverHadPastBooking =
          this.isTutor() &&
          allLessons.some((l) => {
            if (l.status === 'cancelled') return false;
            return new Date(l.endTime).getTime() < now;
          });

        // Filter for upcoming lessons + lessons from today (even if completed)
        const today = this.startOfDay(new Date());
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
        
        
        
        
        
        
        // Separate cancelled lessons (show recent and future cancellations, exclude payment failures)
        this.cancelledLessons = allLessons
          .filter(l => {
            if (l.status !== 'cancelled') return false;
            if ((l as any).cancelReason === 'payment_failed') return false;
            const lessonTime = new Date(l.startTime).getTime();
            return lessonTime >= sevenDaysAgo.getTime();
          })
          .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
        
        
        
        // Filter for active (non-cancelled) lessons
        this.lessons = allLessons
          .filter(l => {
            const endTime = new Date(l.endTime).getTime();
            const lessonDate = new Date(l.startTime);
            const lessonDay = this.startOfDay(lessonDate);
            const startTime = new Date(l.startTime).getTime();
            
            // Exclude cancelled lessons (they go to cancelledLessons array)
            if (l.status === 'cancelled') {
              
              return false;
            }
            
            // Keep if: upcoming OR happened today
            const isUpcoming = endTime >= now;
            const isToday = lessonDay.getTime() === today.getTime();
            
            
            
            return isUpcoming || isToday;
          })
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

        // Filter for past/completed lessons (for students to show past tutors)
        // Include lessons that have ended and are not cancelled
        this.pastLessons = [...resp.lessons]
          .filter(l => {
            const endTime = new Date(l.endTime).getTime();
            return endTime < now && l.status !== 'cancelled';
          })
          .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());

        // Extract unique tutors from past lessons (for students only)
        if (!this.isTutor()) {
          const tutorMap = new Map<string, { id: string; name: string; picture?: string }>();
          this.pastLessons.forEach(lesson => {
            // Handle both populated and non-populated tutorId
            const tutor = lesson.tutorId;
            if (tutor) {
              const tutorId = (tutor as any)._id?.toString() || (tutor as any).id?.toString() || tutor.toString();
              if (!tutorMap.has(tutorId)) {
                tutorMap.set(tutorId, {
                  id: tutorId,
                  name: (tutor as any).name || 'Unknown Tutor',
                  picture: (tutor as any).picture
                });
              }
            }
          });
          this.pastTutors = Array.from(tutorMap.values());
        } else {
          this.pastTutors = [];
        }

        // Clear avatar cache when lessons reload to get fresh images
        this._avatarCache.clear();
        
        // Populate lesson count cache for all tutor-student pairs
        // Use ALL lessons from API (not filtered) to get accurate counts
        this._lessonCountCache.clear();
        const allLessonsFromAPI = resp.lessons || [];
        
        // Group lessons by tutor-student pair and count completed (non-trial) lessons
        const lessonCountMap = new Map<string, number>();
        const debugLog: any[] = [];
        
        allLessonsFromAPI.forEach(lesson => {
          const tutorId = (lesson.tutorId as any)?._id?.toString() || (lesson.tutorId as any)?.id?.toString() || lesson.tutorId?.toString();
          const studentId = (lesson.studentId as any)?._id?.toString() || (lesson.studentId as any)?.id?.toString() || lesson.studentId?.toString();
          
          if (!tutorId || !studentId) {
            debugLog.push({ lessonId: lesson._id, reason: 'Missing tutorId or studentId' });
            return;
          }
          
          // Skip trial lessons
          if (lesson.isTrialLesson) {
            debugLog.push({ 
              lessonId: lesson._id, 
              tutorId, 
              studentId, 
              status: lesson.status, 
              reason: 'Trial lesson - excluded' 
            });
            return;
          }
          
          const cacheKey = `${tutorId}_${studentId}`;
          
          // Only count completed lessons
          if (lesson.status === 'completed') {
            const currentCount = lessonCountMap.get(cacheKey) || 0;
            lessonCountMap.set(cacheKey, currentCount + 1);
            debugLog.push({ 
              lessonId: lesson._id, 
              tutorId, 
              studentId, 
              status: lesson.status, 
              cacheKey,
              count: currentCount + 1,
              reason: 'Completed - counted' 
            });
          } else {
            debugLog.push({ 
              lessonId: lesson._id, 
              tutorId, 
              studentId, 
              status: lesson.status, 
              cacheKey,
              reason: `Status "${lesson.status}" - not counted (only completed lessons count)` 
            });
          }
        });
        
        // Store in cache
        lessonCountMap.forEach((count, key) => {
          this._lessonCountCache.set(key, count);
        });
        
        
        
        
        // Only log debug details if there are issues (more than 0 excluded lessons)
        const excludedCount = debugLog.filter(d => d.reason !== 'Completed - counted').length;
        if (excludedCount > 0) {
          
          
        }
        
        // Add lesson number as a property to each lesson (for template use - no function calls in HTML)
        allLessons.forEach(lesson => {
          // Skip trial lessons and classes
          if (lesson.isTrialLesson || (lesson as any).isClass) {
            (lesson as any).lessonNumber = null;
            return;
          }
          
          const tutorId = (lesson.tutorId as any)?._id?.toString() || (lesson.tutorId as any)?.id?.toString() || lesson.tutorId?.toString();
          const studentId = (lesson.studentId as any)?._id?.toString() || (lesson.studentId as any)?.id?.toString() || lesson.studentId?.toString();
          
          if (!tutorId || !studentId) {
            (lesson as any).lessonNumber = null;
            return;
          }
          
          const cacheKey = `${tutorId}_${studentId}`;
          const completedCount = this._lessonCountCache.get(cacheKey) || 0;
          (lesson as any).lessonNumber = completedCount + 1;
        });
        
        // Clear computed caches to force recalculation with new data
        this._cachedFirstLessonHash = '';
        this._cachedFirstLesson = undefined;
        this._cachedTimelineEventsHash = '';
        this._cachedTimelineEvents = [];

        // Set upcoming lesson (most relevant: in progress, next upcoming, or most recent)
        // Reuse 'now' variable already declared at the top of this function
        this.upcomingLesson = this.selectMostRelevantLesson(now);
        
        // Check for existing presence in lessons
        await this.checkExistingPresence();
        
        // Refresh availability summary with the latest lessons
        this.updateAvailabilitySummary();
        
        // Update insights
        if (this.isTutor()) {
          this.loadTutorInsights();
        } else {
          this.loadStudentInsights();
        }
        
        // Mark that we've loaded data and update cache timestamp
        this._hasInitiallyLoaded = true;
        this._lastDataFetch = Date.now();
        
      } else {
        this.lessons = [];
      }
    } catch (err) {
      console.error('Tab1Page: Failed to load lessons', err);
      this.lessons = [];
    } finally {
      this._isLoadingInProgress = false; // Reset flag
      if (showSkeleton) {
        this.isLoadingLessons = false;
        this.nextLessonTimeLabel = this.getNextLessonTimeLabel();
        this.hadLessonsToday = this.hadLessonsEarlierToday();
        this.hadOnlyCancelledLessonsToday = this.checkHadOnlyCancelledLessonsToday();
        this.refreshPreComputedTemplateValues();
        this.loadPreviousNotes();
        if (!this.mobileStaggerDone && this.isMobile) {
          this.cdr.detectChanges();

          setTimeout(() => {
            this.mobileStaggerReady = true;
            this.quickActionsReady = true;
            this.upNextCardReady = true;
            this.cdr.detectChanges();

            setTimeout(() => {
              this.quickActionsAnimated = true;
              this.upNextCardAnimated = true;
              this.mobileStaggerDone = true;
              this.cdr.detectChanges();
            }, 800);
          }, 50);
        } else if (!this.quickActionsAnimated && !this.isMobile) {
          setTimeout(() => {
            this.quickActionsReady = true;
            this.cdr.detectChanges();
            setTimeout(() => {
              this.quickActionsAnimated = true;
              setTimeout(() => {
                this.upNextCardReady = true;
                this.cdr.detectChanges();
                setTimeout(() => {
                  this.upNextCardAnimated = true;
                }, 300);
              }, 80);
            }, 450);
          }, 150);
        } else {
          this.upNextCardReady = true;
          this.upNextCardAnimated = true;
          this.mobileStaggerReady = true;
          this.mobileStaggerDone = true;
        }
        
      } else {
        this.upNextCardReady = true;
        this.upNextCardAnimated = true;
        this.mobileStaggerReady = true;
        this.mobileStaggerDone = true;
        this.refreshPreComputedTemplateValues();
        this.cdr.detectChanges();
      }
      this.syncTutorMobileWelcomeAboveUpNext();
    }
  }

  /**
   * Handle class cancellation via websocket without full page reload
   * This moves the class from lessons to cancelledLessons array seamlessly
   */
  private async handleClassCancellation(classId: string, cancelReason?: string) {
    
    // Find the class in the lessons array
    const classIndex = this.lessons.findIndex(l => l._id === classId);
    
    if (classIndex !== -1) {
      // Get the class and update its status
      const cancelledClass = { ...this.lessons[classIndex] };
      cancelledClass.status = 'cancelled';
      if (cancelReason) {
        (cancelledClass as any).cancelReason = cancelReason;
      }
      
      // Remove from lessons array
      this.lessons = this.lessons.filter(l => l._id !== classId);
      
      // Add to cancelled lessons at the beginning (most recent first)
      this.cancelledLessons = [cancelledClass, ...this.cancelledLessons];
      
      // Update upcoming lesson if this was it
      if (this.upcomingLesson && this.upcomingLesson._id === classId) {
        this.upcomingLesson = this.selectMostRelevantLesson(Date.now());
      }
      
      // Clear computed caches to force recalculation
      this._cachedFirstLessonHash = '';
      this._cachedFirstLesson = undefined;
      this._cachedTimelineEventsHash = '';
      this._cachedTimelineEvents = [];
      
      // Update insights
      if (this.isTutor()) {
        this.loadTutorInsights();
      } else {
        this.loadStudentInsights();
      }
      
    } else {
      // If not found in current lessons, do a background refresh to sync
      
      await this.loadLessons(false); // Don't show skeleton
    }
  }

  /**
   * Handle lesson cancellation via websocket without full page reload
   * This moves the lesson from lessons to cancelledLessons array seamlessly
   */
  private async handleLessonCancellation(lessonId: string) {
    
    // Find the lesson in the lessons array
    const lessonIndex = this.lessons.findIndex(l => l._id === lessonId);
    
    if (lessonIndex !== -1) {
      // Get the lesson and update its status
      const cancelledLesson = { ...this.lessons[lessonIndex] };
      cancelledLesson.status = 'cancelled';
      
      // Remove from lessons array
      this.lessons = this.lessons.filter(l => l._id !== lessonId);
      
      // Add to cancelled lessons at the beginning (most recent first)
      this.cancelledLessons = [cancelledLesson, ...this.cancelledLessons];
      
      // Update upcoming lesson if this was it
      if (this.upcomingLesson && this.upcomingLesson._id === lessonId) {
        this.upcomingLesson = this.selectMostRelevantLesson(Date.now());
      }
      
      // Clear computed caches to force recalculation
      this._cachedFirstLessonHash = '';
      this._cachedFirstLesson = undefined;
      this._cachedTimelineEventsHash = '';
      this._cachedTimelineEvents = [];
      
      // Update insights
      if (this.isTutor()) {
        this.loadTutorInsights();
      } else {
        this.loadStudentInsights();
      }
      
      
    } else {
      // If not found in current lessons, do a background refresh to sync
      
      await this.loadLessons(false); // Don't show skeleton
    }
  }

  private loadAvailability() {
    if (!this.isTutor()) {
      return;
    }
    
    // First, check if there's a cached state from a recent save (instant update)
    const cachedHasAvailability = this.userService.getCachedHasAvailability();
    if (cachedHasAvailability !== null) {
      this.hasAvailability = cachedHasAvailability;
      this.buttonTextState = this.hasAvailability ? 'view' : 'add';
      this.availabilityBlocks = this.userService.getCachedAvailabilityBlocks();
      this.updateAvailabilitySummary();
      this.syncTutorMobileWelcomeAboveUpNext();
      this.cdr.detectChanges();
    }
    
    // Then fetch from server to ensure we have the latest data
    this.userService.getAvailability()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          
          const timeNow = new Date();
          
          // Check if there is availability AND at least one slot is in the future
          const hasFutureAvailability = response?.availability?.some(slot => {
            // Check if slot has absoluteEnd and it's in the future
            if (slot.absoluteEnd) {
              return new Date(slot.absoluteEnd) > timeNow;
            }
            // If no absoluteEnd, check absoluteStart
            if (slot.absoluteStart) {
              return new Date(slot.absoluteStart) > timeNow;
            }
            // If no absolute dates, assume it's a recurring pattern (future availability)
            return true;
          });
          
          this.hasAvailability = hasFutureAvailability || false;
          this.buttonTextState = this.hasAvailability ? 'view' : 'add';
          this.availabilityBlocks = response?.availability || [];
          this.updateAvailabilitySummary();
          this.syncTutorMobileWelcomeAboveUpNext();
          this.cdr.markForCheck();
        },
        error: (error) => {
          console.error('Tab1Page: Failed to load availability', error);
          this.availabilityBlocks = [];
          this.updateAvailabilitySummary();
          this.syncTutorMobileWelcomeAboveUpNext();
        }
      });
  }

  private updateAvailabilitySummary() {
    if (!this.isTutor() || !this.selectedDate) {
      this.availabilityHeadline = '';
      this.availabilityDetail = '';
      this.isSelectedDatePast = false;
      return;
    }

    // Check if selected date is in the past, today, or future
    const today = this.startOfDay(new Date());
    const selectedDay = this.startOfDay(this.selectedDate);
    this.isSelectedDatePast = selectedDay.getTime() < today.getTime();
    const isToday = this.isSameDay(this.selectedDate, new Date());
    const isFuture = selectedDay.getTime() > today.getTime();
    
    // Format date for messages
    const dateLabel = isToday ? 'today' : formatDateInTz(this.selectedDate, this.userTz);

    if (!Array.isArray(this.availabilityBlocks) || this.availabilityBlocks.length === 0) {
      if (this.isSelectedDatePast) {
        this.availabilityHeadline = 'You hadn\'t set any availability for ' + dateLabel + '.';
      } else if (isFuture) {
        this.availabilityHeadline = 'You haven\'t set any availability for ' + dateLabel + ' yet.';
      } else {
        this.availabilityHeadline = 'You haven\'t set any availability for today yet.';
      }
      this.availabilityDetail = 'Add some time slots so students can book you.';
      return;
    }

    const dayIndex = this.getAvailabilityDayIndex(this.selectedDate);
    const dayBlocks = this.availabilityBlocks.filter(block => block.day === dayIndex);

    if (dayBlocks.length === 0) {
      if (this.isSelectedDatePast) {
        this.availabilityHeadline = 'You hadn\'t set any availability for ' + dateLabel + '.';
      } else if (isFuture) {
        this.availabilityHeadline = 'You haven\'t set any availability for ' + dateLabel + ' yet.';
      } else {
        this.availabilityHeadline = 'You haven\'t set any availability for today yet.';
      }
      this.availabilityDetail = 'Add some time slots so students can book you.';
      return;
    }

    const slots = dayBlocks.map(block => {
      const start = this.parseTimeToMinutes(block.startTime);
      const end = this.parseTimeToMinutes(block.endTime);
      return {
        start,
        end,
        duration: Math.max(end - start, 0),
        booked: 0
      };
    });

    const totalAvailabilityMinutes = slots.reduce((sum, slot) => sum + slot.duration, 0);

    const dayStart = this.startOfDay(this.selectedDate).getTime();
    const dayLessons = this.lessons.filter(lesson => {
      const lessonDate = new Date(lesson.startTime);
      return lessonDate.getTime() >= dayStart && lessonDate.getTime() < dayStart + 24 * 60 * 60 * 1000;
    });

    let bookedMinutes = 0;
    for (const lesson of dayLessons) {
      const lessonStart = new Date(lesson.startTime);
      const lessonEnd = new Date(lesson.endTime);
      const lessonStartMinutes = this.minutesSinceStartOfDay(lessonStart, dayStart);
      const lessonEndMinutes = this.minutesSinceStartOfDay(lessonEnd, dayStart);

      for (const slot of slots) {
        const overlapStart = Math.max(slot.start, lessonStartMinutes);
        const overlapEnd = Math.min(slot.end, lessonEndMinutes);
        if (overlapEnd > overlapStart) {
          const overlap = overlapEnd - overlapStart;
          slot.booked += overlap;
          bookedMinutes += overlap;
        }
      }
    }

    const openMinutes = slots.reduce((sum, slot) => {
      const free = Math.max(slot.duration - Math.min(slot.duration, slot.booked), 0);
      return sum + free;
    }, 0);

    const openSlots = slots.filter(slot => slot.duration - Math.min(slot.duration, slot.booked) > 0).length;
    const totalSlots = slots.length;

    if (totalAvailabilityMinutes <= 0) {
      if (this.isSelectedDatePast) {
        this.availabilityHeadline = 'You hadn\'t set any availability for ' + dateLabel + '.';
      } else if (isFuture) {
        this.availabilityHeadline = 'You haven\'t set any availability for ' + dateLabel + ' yet.';
      } else {
        this.availabilityHeadline = 'You haven\'t set any availability for today yet.';
      }
      this.availabilityDetail = 'Add some time slots so students can book you.';
      return;
    }

    if (openMinutes <= 0) {
      if (this.isSelectedDatePast) {
        this.availabilityHeadline = dateLabel + '\'s ' + this.pluralize(totalSlots, 'availability block') + ' (' + this.formatMinutes(totalAvailabilityMinutes) + ') were fully booked.';
        this.availabilityDetail = '';
      } else if (isFuture) {
        this.availabilityHeadline = dateLabel + '\'s ' + this.pluralize(totalSlots, 'availability block') + ' (' + this.formatMinutes(totalAvailabilityMinutes) + ') are fully booked.';
        this.availabilityDetail = 'Add more availability to accept new students.';
      } else {
        this.availabilityHeadline = 'Great news—today\'s ' + this.pluralize(totalSlots, 'availability block') + ' (' + this.formatMinutes(totalAvailabilityMinutes) + ') are fully booked.';
        this.availabilityDetail = 'Add more availability to accept new students.';
      }
      return;
    }

    if (bookedMinutes <= 0) {
      if (this.isSelectedDatePast) {
        this.availabilityHeadline = 'You were available for ' + this.formatMinutes(openMinutes) + ' on ' + dateLabel + '.';
        this.availabilityDetail = 'That was spread across ' + this.pluralize(totalSlots, 'availability block') + '.';
      } else if (isFuture) {
        this.availabilityHeadline = 'You are available for ' + this.formatMinutes(openMinutes) + ' on ' + dateLabel + '.';
        this.availabilityDetail = 'That\'s spread across ' + this.pluralize(totalSlots, 'availability block') + '. Add or adjust times to fill your schedule.';
      } else {
        this.availabilityHeadline = 'You are available for ' + this.formatMinutes(openMinutes) + ' today.';
        this.availabilityDetail = 'That\'s spread across ' + this.pluralize(totalSlots, 'availability block') + '. Add or adjust times to fill your schedule.';
      }
      return;
    }

    if (this.isSelectedDatePast) {
      this.availabilityHeadline = 'You had ' + this.formatMinutes(openMinutes) + ' open for ' + dateLabel + '.';
      this.availabilityDetail = this.pluralize(openSlots, 'availability block') + ' were partially open (' + this.formatMinutes(totalAvailabilityMinutes) + ' total, ' + this.formatMinutes(Math.min(bookedMinutes, totalAvailabilityMinutes)) + ' already booked).';
    } else if (isFuture) {
      this.availabilityHeadline = 'You have ' + this.formatMinutes(openMinutes) + ' open for ' + dateLabel + '.';
      this.availabilityDetail = this.pluralize(openSlots, 'availability block') + ' are partially open (' + this.formatMinutes(totalAvailabilityMinutes) + ' total, ' + this.formatMinutes(Math.min(bookedMinutes, totalAvailabilityMinutes)) + ' already booked). Add or adjust availability to fill the gaps.';
    } else {
      this.availabilityHeadline = 'You still have ' + this.formatMinutes(openMinutes) + ' open today.';
      this.availabilityDetail = this.pluralize(openSlots, 'availability block') + ' are partially open (' + this.formatMinutes(totalAvailabilityMinutes) + ' total, ' + this.formatMinutes(Math.min(bookedMinutes, totalAvailabilityMinutes)) + ' already booked). Add or adjust availability to fill the gaps.';
    }
  }

  private getAvailabilityDayIndex(date: Date): number {
    // Use the same day index system as availability setup component
    // Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5, Saturday=6
    return date.getDay();
  }

  private parseTimeToMinutes(time: string): number {
    if (!time) return 0;
    const [hoursStr, minutesStr] = time.split(':');
    const hours = parseInt(hoursStr, 10) || 0;
    const minutes = parseInt(minutesStr, 10) || 0;
    return hours * 60 + minutes;
  }

  private minutesSinceStartOfDay(date: Date, dayStart: number): number {
    return Math.max(0, Math.min(24 * 60, Math.round((date.getTime() - dayStart) / 60000)));
  }

  private formatMinutes(totalMinutes: number): string {
    const minutes = Math.max(0, Math.round(totalMinutes));
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const parts: string[] = [];
    if (hours > 0) {
      parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    }
    if (mins > 0 || parts.length === 0) {
      parts.push(`${mins} ${mins === 1 ? 'minute' : 'minutes'}`);
    }
    return parts.join(' ');
  }

  private pluralize(count: number, singular: string, plural?: string): string {
    const resolvedPlural = plural || `${singular}s`;
    return count === 1 ? `1 ${singular}` : `${count} ${resolvedPlural}`;
  }

  // Check for existing presence in loaded lessons
  async checkExistingPresence() {
    if (!this.currentUser) return;
    
    
    // Check each lesson for existing participants
    for (const lesson of this.lessons) {
      // Skip classes - they don't exist in the lessons API
      if ((lesson as any).isClass) {
        continue;
      }
      
      try {
        // Get detailed lesson info with participants
        const lessonResponse = await this.lessonService.getLesson(lesson._id).toPromise();
        if (lessonResponse?.success && lessonResponse.lesson?.participants) {
          const detailedLesson = lessonResponse.lesson;
          
          // Determine who the other participant is
          const isTutor = this.currentUser.userType === 'tutor';
          
          // Safely get the other participant ID
          let otherParticipantId: string | undefined = undefined;
          if (isTutor) {
            const student = detailedLesson.studentId;
            if (student && typeof student === 'object') {
              otherParticipantId = (student as any)?._id || (student as any)?.id;
            }
          } else {
            const tutor = detailedLesson.tutorId;
            if (tutor && typeof tutor === 'object') {
              otherParticipantId = (tutor as any)?._id || (tutor as any)?.id;
            }
          }
          
          if (otherParticipantId && detailedLesson.participants) {
            const otherParticipantKey = String(otherParticipantId);
            const participantData = detailedLesson.participants[otherParticipantKey];
            
            // If the other participant has joined and hasn't left
            if (participantData && participantData.joinedAt && !participantData.leftAt) {
              
              // Set presence in our map
              const normalizedLessonId = String(lesson._id);
              
              // Safely get participant picture
              let participantPicture: string | undefined = undefined;
              if (isTutor) {
                const student = detailedLesson.studentId;
                if (student && typeof student === 'object') {
                  participantPicture = (student as any)?.picture || (student as any)?.profilePicture;
                }
              } else {
                const tutor = detailedLesson.tutorId;
                if (tutor && typeof tutor === 'object') {
                  participantPicture = (tutor as any)?.picture || (tutor as any)?.profilePicture;
                }
              }
              
              this.lessonPresence.set(normalizedLessonId, {
                participantName: isTutor 
                  ? (detailedLesson.studentId && typeof detailedLesson.studentId === 'object' 
                      ? (detailedLesson.studentId as any)?.name || 'Student'
                      : 'Student')
                  : (detailedLesson.tutorId && typeof detailedLesson.tutorId === 'object'
                      ? (detailedLesson.tutorId as any)?.name || 'Tutor'
                      : 'Tutor'),
                participantPicture: participantPicture,
                participantRole: isTutor ? 'student' : 'tutor',
                joinedAt: typeof participantData.joinedAt === 'string' 
                  ? participantData.joinedAt 
                  : participantData.joinedAt?.toISOString() || new Date().toISOString()
              });
            }
          }
        }
      } catch (error) {
        console.error('📚 Tab1: Error checking presence for lesson', lesson._id, error);
      }
    }

    this.updateNextLessonPresence();
  }

  getOtherParticipantName(lesson: Lesson): string {
    if (!this.currentUser) return '';
    
    // Handle classes
    if ((lesson as any).isClass) {
      return (lesson as any).className || lesson.subject || 'Group Class';
    }
    
    const isTutor = lesson.tutorId?._id === this.currentUser.id;
    const other = isTutor ? lesson.studentId : lesson.tutorId;
    
    if (typeof other === 'object' && other) {
      return (other as any)?.name || (other as any)?.email || 'Unknown';
    }
    
    return 'Unknown';
  }

  trackByLessonId(index: number, lesson: Lesson): string {
    return lesson._id;
  }

  // Join helpers for Upcoming card
  canJoinUpcoming(): boolean {
    if (!this.upcomingLesson) return false;
    if (this.isLessonInProgress(this.upcomingLesson)) return true;
    return this.lessonService.canJoinLesson(this.upcomingLesson);
  }

  // Helper to check if any lesson can be joined
  canJoinLesson(lesson: Lesson): boolean {
    if (!lesson) return false;
    if (this.isLessonInProgress(lesson)) return true;
    return this.lessonService.canJoinLesson(lesson);
  }

  upcomingJoinCountdown(): string {
    if (!this.upcomingLesson) return '';
    // Reference countdownTick to trigger change detection updates
    void this.countdownTick;
    const secs = this.lessonService.getTimeUntilJoin(this.upcomingLesson);
    return this.lessonService.formatTimeUntil(secs);
  }

  upcomingJoinLabel(): string {
    if (!this.upcomingLesson) return 'Join';
    const participant = (this.upcomingLesson as any).participant;
    if (this.isLessonInProgress(this.upcomingLesson) && participant?.joinedBefore && participant?.leftAfterJoin) return 'Rejoin';
    return this.canJoinUpcoming() ? 'Join' : `Join in ${this.upcomingJoinCountdown()}`;
  }

  isLessonInProgress(lesson: Lesson): boolean {
    // Reference countdownTick to trigger change detection updates
    void this.countdownTick;
    
    if (!lesson) return false;
    
    const now = new Date();
    const startTime = new Date(lesson.startTime);
    const endTime = new Date(lesson.endTime);
    
    // Only check time range, not status (status might be set prematurely)
    // Lesson is in progress only if current time is between start and end
    return now >= startTime && now <= endTime;
  }

  /**
   * Check if a lesson has started (and therefore cannot be rescheduled)
   */
  hasLessonStarted(lesson: Lesson): boolean {
    // Reference countdownTick to trigger change detection updates
    void this.countdownTick;
    
    if (!lesson) return false;
    
    const status = (lesson as any)?.status;
    
    // Cannot reschedule if lesson is in progress, completed, or cancelled
    if (status === 'in_progress' || status === 'completed' || status === 'cancelled') {
      return true;
    }
    
    // Cannot reschedule if the start time has passed
    const now = new Date();
    const startTime = new Date(lesson.startTime);
    
    return now >= startTime;
  }

  getUserRole(lesson: Lesson): 'tutor' | 'student' {
    if (!this.currentUser) return 'student';
    return lesson.tutorId._id === this.currentUser.id ? 'tutor' : 'student';
  }

  async joinUpcomingLesson() {
    if (!this.upcomingLesson || !this.currentUser) return;
    
    const isClass = (this.upcomingLesson as any).isClass || false;
    
    
    
    // Navigate to pre-call page first
    // SECURITY: role is determined from lesson data + auth, not passed in URL
    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: this.upcomingLesson._id,
        lessonMode: 'true',
        isClass: isClass ? 'true' : 'false'
      }
    });
  }

  openNotifications() {
    this.router.navigate(['/tabs/notifications']);
  }

  // Date strip helpers (tutor view)
  generateDateStrip(days: number, startDate: Date): { label: string; dayNum: number; date: Date; isToday: boolean }[] {
    const result: { label: string; dayNum: number; date: Date; isToday: boolean }[] = [];
    const today = this.startOfDay(new Date());
    for (let i = 0; i < days; i++) {
      const d = this.startOfDay(new Date(startDate));
      d.setDate(d.getDate() + i);
      result.push({
        label: formatDateInTz(d, this.userTz, { weekday: 'short', month: undefined, day: undefined, year: undefined }),
        dayNum: d.getDate(),
        date: d,
        isToday: this.isSameDay(d, today)
      });
    }
    this.weekRangeLabel = this.getWeekRangeLabel(startDate);
    return result;
  }
 
  selectDate(d: Date) {
    this.selectedDate = this.startOfDay(new Date(d));
    // Clear cached computations when date changes
    this._cachedFirstLessonHash = '';
    this.cachedStudentsDate = null;
    this.updateAvailabilitySummary();
  }

  navigateWeek(direction: 'prev' | 'next') {
    const days = this.getDateStripDaysCount();
    const delta = direction === 'prev' ? -days : days;
    const newStart = this.startOfDay(new Date(this.weekStartDate));
    newStart.setDate(newStart.getDate() + delta);
    // When going back, prefer selecting today if it's in the range
    this.updateDateStrip(newStart, direction === 'next');
  }

  goToToday() {
    const today = this.startOfDay(new Date());
    this.selectedDate = today;
    const start = this.getStripStartForDate(today);
    this.updateDateStrip(start, false);
    this.updateAvailabilitySummary();
  }

  isCurrentWeek(): boolean {
    const todayStart = this.getStripStartForDate(new Date());
    return this.weekStartDate.getTime() === todayStart.getTime();
  }

  private updateDateStrip(startDate: Date, forceSelectStart = false) {
    const start = this.startOfDay(new Date(startDate));
    this.weekStartDate = start;
    const days = this.getDateStripDaysCount();
    this.dateStrip = this.generateDateStrip(days, start);
    
    if (forceSelectStart || !this.selectedDate || !this.isDateInWeek(this.selectedDate, start)) {
      // When going back (forceSelectStart is false), check if today is in the range
      if (!forceSelectStart) {
        const today = this.startOfDay(new Date());
        if (this.isDateInWeek(today, start)) {
          this.selectedDate = today;
        } else {
          this.selectedDate = this.dateStrip[0]?.date ?? null;
        }
      } else {
        // When going forward, select the first date
        this.selectedDate = this.dateStrip[0]?.date ?? null;
      }
    }
    this.updateAvailabilitySummary();
  }
 
  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }
 
  private getStartOfWeek(date: Date): Date {
    const d = this.startOfDay(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d;
  }
 
  private getDateStripDaysCount(): number {
    return this.isMobile ? 5 : 7;
  }
 
  isToday(date: Date | null): boolean {
    if (!date) {
      return false;
    }
    return this.isSameDay(date, new Date());
  }

  private getStripStartForDate(target: Date): Date {
    const days = this.getDateStripDaysCount();
    const start = this.getStartOfWeek(target);
    if (days >= 7) {
      return start;
    }

    const adjustedStart = this.startOfDay(new Date(start));
    const end = this.startOfDay(new Date(adjustedStart));
    end.setDate(end.getDate() + (days - 1));

    const normalizedTarget = this.startOfDay(target);
    while (normalizedTarget.getTime() > end.getTime()) {
      adjustedStart.setDate(adjustedStart.getDate() + 1);
      end.setDate(end.getDate() + 1);
    }

    return adjustedStart;
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  private isDateInWeek(date: Date, weekStart: Date): boolean {
    const start = this.startOfDay(weekStart);
    const end = this.startOfDay(new Date(weekStart));
    end.setDate(end.getDate() + (this.getDateStripDaysCount() - 1));
    const target = this.startOfDay(date);
    return target >= start && target <= end;
  }

  private getWeekRangeLabel(start: Date): string {
    const startOfWeek = this.startOfDay(new Date(start));
    const endOfWeek = this.startOfDay(new Date(start));
    endOfWeek.setDate(endOfWeek.getDate() + (this.getDateStripDaysCount() - 1));

    const sameMonth = startOfWeek.getMonth() === endOfWeek.getMonth();
    const sameYear = startOfWeek.getFullYear() === endOfWeek.getFullYear();

    const tz = this.userTz;
    if (sameMonth && sameYear) {
      const startLabel = formatDateInTz(startOfWeek, tz, { month: 'short', day: 'numeric', year: undefined });
      return `${startLabel} - ${endOfWeek.getDate()}, ${startOfWeek.getFullYear()}`;
    }

    if (sameYear) {
      const startLabel = formatDateInTz(startOfWeek, tz, { month: 'short', day: 'numeric', year: undefined });
      const endLabel = formatDateInTz(endOfWeek, tz, { month: 'short', day: 'numeric', year: undefined });
      return `${startLabel} - ${endLabel}, ${startOfWeek.getFullYear()}`;
    }

    const startLabel = formatDateInTz(startOfWeek, tz);
    const endLabel = formatDateInTz(endOfWeek, tz);
    return `${startLabel} - ${endLabel}`;
  }

  lessonsForSelectedDate(): Lesson[] {
    if (!this.selectedDate) return this.lessons;
    const y = this.selectedDate.getFullYear();
    const m = this.selectedDate.getMonth();
    const day = this.selectedDate.getDate();
    return this.lessons.filter(l => {
      const start = new Date(l.startTime);
      return start.getFullYear() === y && start.getMonth() === m && start.getDate() === day;
    });
  }

  // Get current user's picture directly from database
  get currentUserPicture(): string | null {
    return this.currentUser?.picture || null;
  }

  // Check if user has a profile picture from the database
  get hasUserPicture(): boolean {
    const hasPicture = !!this.currentUser?.picture;
    return hasPicture;
  }

  // Get user's first initial for avatar fallback
  get userInitial(): string {
    if (this.currentUser?.firstName) {
      return this.currentUser.firstName.charAt(0).toUpperCase();
    }
    if (this.currentUser?.name) {
      return this.currentUser.name.charAt(0).toUpperCase();
    }
    return '?';
  }

  // Debug methods for avatar loading
  onAvatarError(event: any) {
    console.error('❌ Avatar image failed to load:', {
      src: event.target?.src,
      currentUserPicture: this.currentUser?.picture,
      areEqual: event.target?.src === this.currentUser?.picture,
      srcLength: event.target?.src?.length,
      pictureLength: this.currentUser?.picture?.length,
      errorType: event.type,
      error: event
    });
    
    // Try to diagnose the issue
    if (this.currentUser?.picture) {
      const img = new Image();
      img.onerror = (e) => console.error('❌ Manual image test failed for:', this.currentUser?.picture, e);
      img.src = this.currentUser.picture;
    }
  }

  onAvatarLoad(event: any) {
  }

  // Simple helper methods for user type checking
  isStudent(): boolean {
    return this.currentUser?.['userType'] === 'student';
  }

  // Subscribe to wallet balance updates (real-time)
  subscribeToWalletBalance() {
    // Subscribe to the balance observable for automatic updates
    this.walletService.balance$
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (balance) => {
          if (balance) {
            this.currentWalletBalance = balance.availableBalance;
            this.cdr.detectChanges();
          }
        }
      });

    // Initial load
    this.loadWalletBalance();
  }

  // Load wallet balance
  loadWalletBalance() {
    this.walletService.getBalance()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.currentWalletBalance = response.availableBalance;
            this.cdr.detectChanges();
          }
        },
        error: (error) => {
          console.error('Error loading wallet balance:', error);
          this.currentWalletBalance = 0;
          this.cdr.markForCheck();
        }
      });
  }

  // Navigate to wallet page
  navigateToWallet() {
    this.router.navigate(['/tabs/home/wallet']);
  }

  async openWithdrawModal() {
    // Earnings component is always in DOM (hidden) for modal access
    // No need to navigate - component already exists
    this.cdr.detectChanges();

    // Wait for earnings component to be ready AND data to be loaded
    const waitForEarningsReady = (): Promise<void> => {
      return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds max wait (50 * 100ms)
        
        const checkComponent = () => {
          attempts++;
          
          if (this.earningsComponent) {
            // Wait for component to finish loading data (ngOnInit completes)
            // Check if loading is false, which means loadBalance() and loadEarnings() have completed
            if (this.earningsComponent.loading === false) {
              // Give it one more frame to ensure all properties are set
              requestAnimationFrame(() => {
                if (typeof this.earningsComponent.requestWithdrawal === 'function') {
                  this.earningsComponent.requestWithdrawal();
                  resolve();
                } else {
                  if (attempts < maxAttempts) {
                    setTimeout(checkComponent, 100);
                  } else {
                    console.error('❌ Earnings component requestWithdrawal method not available');
                    resolve();
                  }
                }
              });
            } else {
              // Still loading, wait a bit more
              if (attempts < maxAttempts) {
                setTimeout(checkComponent, 100);
              } else {
                console.error('❌ Earnings component took too long to load');
                resolve();
              }
            }
          } else {
            // Component not created yet, wait
            if (attempts < maxAttempts) {
              setTimeout(checkComponent, 50);
            } else {
              console.error('❌ Earnings component not found');
              resolve();
            }
          }
        };
        // Start checking immediately since component should already be in DOM
        checkComponent();
      });
    };

    await waitForEarningsReady();
  }

  navigateToEarnings() {
    // === FLIP Animation: Home → Earnings ===

    // Step 1: Capture source button rects from the home earnings card
    const earningsSrc = this.isMobile ? '.earnings-mobile-card' : '.grid-cell-earnings';
    const srcWithdraw = this.isMobile ? null : document.querySelector('.grid-cell-earnings .withdraw-btn') as HTMLElement;
    const srcViewDetails = document.querySelector(`${earningsSrc} .view-details-link`) as HTMLElement;
    const srcWithdrawRect = srcWithdraw?.getBoundingClientRect();
    const srcViewDetailsRect = srcViewDetails?.getBoundingClientRect();

    // Step 2: Create styled clones at source positions
    const withdrawClone: HTMLElement | null = srcWithdrawRect ? document.createElement('div') : null;
    const viewDetailsClone: HTMLElement | null = srcViewDetailsRect ? document.createElement('div') : null;

    const isDark = document.documentElement.classList.contains('ion-palette-dark');
    const cloneFg = isDark ? '#f5f5f7' : '#222222';
    const cloneSolidBg = isDark ? '#f5f5f7' : '#000000';
    const cloneSolidFg = isDark ? '#000000' : 'white';

    if (withdrawClone && srcWithdrawRect) {
      withdrawClone.textContent = this.translateService.instant('HOME.WITHDRAW_FUNDS');
      Object.assign(withdrawClone.style, {
        position: 'fixed',
        left: `${srcWithdrawRect.left}px`,
        top: `${srcWithdrawRect.top}px`,
        width: `${srcWithdrawRect.width}px`,
        height: `${srcWithdrawRect.height}px`,
        zIndex: '10000',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        fontSize: '15px',
        fontWeight: '600',
        color: cloneFg,
        backgroundColor: 'transparent',
        border: `1px solid ${cloneFg}`,
        borderRadius: '12px',
        transition: 'left 0.46s cubic-bezier(0.32, 0.72, 0, 1), top 0.46s cubic-bezier(0.32, 0.72, 0, 1), width 0.46s cubic-bezier(0.32, 0.72, 0, 1), height 0.46s cubic-bezier(0.32, 0.72, 0, 1), border-radius 0.46s cubic-bezier(0.32, 0.72, 0, 1), font-size 0.36s ease 0.1s, background-color 0.36s ease 0.1s, color 0.36s ease 0.1s, border-color 0.36s ease 0.1s, opacity 0.2s ease',
      });
      document.body.appendChild(withdrawClone);
    }

    if (viewDetailsClone && srcViewDetailsRect) {
      const viewDetailsText = this.translateService.instant('HOME.VIEW_DETAILS');
      if (this.isMobile) {
        viewDetailsClone.textContent = `${viewDetailsText} →`;
      } else {
        viewDetailsClone.innerHTML = `<span style="text-decoration:underline">${viewDetailsText}</span><span style="width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:16px;line-height:1">→</span>`;
      }
      Object.assign(viewDetailsClone.style, {
        position: 'fixed',
        left: `${srcViewDetailsRect.left}px`,
        top: `${srcViewDetailsRect.top}px`,
        width: `${srcViewDetailsRect.width}px`,
        height: `${srcViewDetailsRect.height}px`,
        zIndex: '10000',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: this.isMobile ? '3px' : '6px',
        boxSizing: 'border-box',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        fontSize: this.isMobile ? '11px' : '14px',
        fontWeight: '600',
        color: this.isMobile ? (isDark ? '#60a5fa' : '#6b7280') : cloneFg,
        backgroundColor: 'transparent',
        border: 'none',
        whiteSpace: 'nowrap',
        transition: 'all 0.42s cubic-bezier(0.32, 0.72, 0, 1)',
      });
      document.body.appendChild(viewDetailsClone);
    }

    // Step 3: Switch to earnings view & scroll to top so layout is stable
    this.showEarningsView = true;
    this.cdr.detectChanges();
    this.ionContent?.scrollToTop(0);

    // Step 4a: View Details → Go back (destination always available in inline chrome)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const destGoBack = document.querySelector('.earnings-inline-panel .go-back-link') as HTMLElement;

        if (viewDetailsClone && destGoBack) {
          destGoBack.style.transition = 'none';
          destGoBack.style.opacity = '0';
          const destRect = destGoBack.getBoundingClientRect();
          const goBackLabel = this.translateService.instant('EARNINGS.GO_BACK');
          viewDetailsClone.innerHTML = `<span style="text-decoration:underline">${goBackLabel}</span>`;
          viewDetailsClone.style.whiteSpace = 'nowrap';
          viewDetailsClone.style.left = `${destRect.left}px`;
          viewDetailsClone.style.top = `${destRect.top}px`;
          viewDetailsClone.style.width = `${destRect.width}px`;
          viewDetailsClone.style.height = `${destRect.height}px`;
          viewDetailsClone.style.fontSize = '14px';
          viewDetailsClone.style.color = isDark ? '#8e8e93' : '#222222';

          // On landing: snap dest visible (still no transition), then remove clone next frame
          setTimeout(() => {
            destGoBack.style.opacity = '1';
            requestAnimationFrame(() => {
              if (viewDetailsClone.parentNode) viewDetailsClone.remove();
              // Restore default transition and clear inline opacity
              setTimeout(() => { destGoBack.style.transition = ''; destGoBack.style.opacity = ''; }, 50);
            });
          }, 450);
        } else if (viewDetailsClone) {
          viewDetailsClone.style.opacity = '0';
          viewDetailsClone.style.transform = 'translateY(-20px)';
          setTimeout(() => { if (viewDetailsClone.parentNode) viewDetailsClone.remove(); }, 420);
        }
      });
    });

    // Step 4b: Withdraw Funds — MutationObserver for instant detection (before paint)
    if (withdrawClone && srcWithdrawRect) {
      let landed = false;
      let pulseAnim: Animation | null = null;

      requestAnimationFrame(() => {
        if (landed || !withdrawClone.parentNode) return;
        withdrawClone.style.top = `${srcWithdrawRect.top - 15}px`;
        withdrawClone.style.backgroundColor = cloneSolidBg;
        withdrawClone.style.color = cloneSolidFg;
        withdrawClone.style.borderColor = cloneSolidBg;
        withdrawClone.style.borderRadius = '8px';
      });

      // Fly clone to the real button once it's found
      const flyToDestination = (dest: HTMLElement) => {
        if (landed) return;
        landed = true;
        // Stop any pulse animation before flying
        if (pulseAnim) { pulseAnim.cancel(); pulseAnim = null; }
        // Disable CSS transition before hiding to prevent fade-flash
        dest.style.transition = 'none';
        dest.style.opacity = '0';
        const destRect = dest.getBoundingClientRect();
        // Shorten transition for remaining flight to destination (include color props for smooth fill)
        withdrawClone.style.transition = 'left 0.36s cubic-bezier(0.32, 0.72, 0, 1), top 0.36s cubic-bezier(0.32, 0.72, 0, 1), width 0.36s cubic-bezier(0.32, 0.72, 0, 1), height 0.36s cubic-bezier(0.32, 0.72, 0, 1), border-radius 0.36s cubic-bezier(0.32, 0.72, 0, 1), font-size 0.36s cubic-bezier(0.32, 0.72, 0, 1), background-color 0.32s ease, color 0.32s ease, border-color 0.32s ease, opacity 0.2s ease';
        requestAnimationFrame(() => {
          withdrawClone.style.left = `${destRect.left}px`;
          withdrawClone.style.top = `${destRect.top}px`;
          withdrawClone.style.width = `${destRect.width}px`;
          withdrawClone.style.height = `${destRect.height}px`;
          withdrawClone.style.fontSize = '14px';
          withdrawClone.style.backgroundColor = cloneSolidBg;
          withdrawClone.style.color = cloneSolidFg;
          withdrawClone.style.borderColor = cloneSolidBg;
          withdrawClone.style.borderRadius = '8px';
        });
        // Wait for layout to fully settle (longer than earningsFadeIn 400ms), then swap
        setTimeout(() => {
          const finalRect = dest.getBoundingClientRect();
          withdrawClone.style.transition = 'none';
          withdrawClone.style.left = `${finalRect.left}px`;
          withdrawClone.style.top = `${finalRect.top}px`;
          withdrawClone.style.width = `${finalRect.width}px`;
          withdrawClone.style.height = `${finalRect.height}px`;
          // Double-rAF to ensure paint has flushed the snap before revealing
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              dest.style.opacity = '1';
              if (withdrawClone.parentNode) withdrawClone.remove();
              setTimeout(() => { dest.style.transition = ''; dest.style.opacity = ''; }, 50);
            });
          });
        }, 520);
      };

      // Check if button is already in DOM (unlikely but possible with cached data)
      const existingDest = document.querySelector('.earnings-inline-panel .withdraw-btn') as HTMLElement;
      if (existingDest) {
        flyToDestination(existingDest);
      } else {
        // Watch for the button to appear (fires before browser paints — no flash)
        const panelEl = document.querySelector('.earnings-inline-panel');
        if (panelEl) {
          const observer = new MutationObserver(() => {
            const dest = document.querySelector('.earnings-inline-panel .withdraw-btn') as HTMLElement;
            if (dest) {
              observer.disconnect();
              flyToDestination(dest);
            }
          });
          observer.observe(panelEl, { childList: true, subtree: true });

          // On slow connections: add a gentle breathing pulse after 1s so the clone feels "alive"
          setTimeout(() => {
            if (!landed && withdrawClone.parentNode) {
              pulseAnim = withdrawClone.animate([
                { transform: 'scale(1)', opacity: 1 },
                { transform: 'scale(1.04)', opacity: 0.8 },
                { transform: 'scale(1)', opacity: 1 }
              ], { duration: 1600, iterations: Infinity, easing: 'ease-in-out' });
            }
          }, 1000);

          // Safety fallback: generous timeout for very slow connections (15s)
          setTimeout(() => {
            if (!landed) {
              observer.disconnect();
              if (pulseAnim) { pulseAnim.cancel(); pulseAnim = null; }
              withdrawClone.style.opacity = '0';
              withdrawClone.style.transition = 'opacity 0.3s ease';
              setTimeout(() => { if (withdrawClone.parentNode) withdrawClone.remove(); }, 350);
            }
          }, 15000);
        } else {
          // Panel not found — fade out
          withdrawClone.style.opacity = '0';
          setTimeout(() => { if (withdrawClone.parentNode) withdrawClone.remove(); }, 250);
        }
      }
    }
  }

  onEarningsGoBack() {
    // If earnings was opened from another tab via the toolbar "$" pill,
    // navigate back to that tab instead of showing home content.
    if (this._earningsOpenedFromOtherTab && this.isMobile) {
      this._earningsOpenedFromOtherTab = false;
      this.showEarningsView = false;
      this.navCtrl.back();
      return;
    }
    this._earningsOpenedFromOtherTab = false;

    // === FLIP Animation: Earnings → Home ===

    // Step 1: Capture source button rects from earnings view
    const srcWithdraw = document.querySelector('.earnings-inline-panel .withdraw-btn') as HTMLElement;
    const srcGoBack = document.querySelector('.earnings-inline-panel .go-back-link') as HTMLElement;
    const srcWithdrawRect = srcWithdraw?.getBoundingClientRect();
    const srcGoBackRect = srcGoBack?.getBoundingClientRect();

    // Step 2: Create styled clones at earnings positions
    let withdrawClone: HTMLElement | null = null;
    let goBackClone: HTMLElement | null = null;

    const isDark = document.documentElement.classList.contains('ion-palette-dark');
    const cloneFg = isDark ? '#f5f5f7' : '#222222';
    const cloneSolidBg = isDark ? '#f5f5f7' : '#000000';
    const cloneSolidFg = isDark ? '#000000' : 'white';

    if (srcWithdrawRect) {
      withdrawClone = document.createElement('div');
      withdrawClone.textContent = this.translateService.instant('EARNINGS.WITHDRAW_FUNDS');
      Object.assign(withdrawClone.style, {
        position: 'fixed',
        left: `${srcWithdrawRect.left}px`,
        top: `${srcWithdrawRect.top}px`,
        width: `${srcWithdrawRect.width}px`,
        height: `${srcWithdrawRect.height}px`,
        zIndex: '10000',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        fontSize: '14px',
        fontWeight: '600',
        color: cloneSolidFg,
        backgroundColor: cloneSolidBg,
        border: `1px solid ${cloneSolidBg}`,
        borderRadius: '8px',
        transition: 'left 0.46s cubic-bezier(0.32, 0.72, 0, 1), top 0.46s cubic-bezier(0.32, 0.72, 0, 1), width 0.46s cubic-bezier(0.32, 0.72, 0, 1), height 0.46s cubic-bezier(0.32, 0.72, 0, 1), border-radius 0.46s cubic-bezier(0.32, 0.72, 0, 1), font-size 0.36s ease 0.1s, background-color 0.36s ease 0.1s, color 0.36s ease 0.1s, border-color 0.36s ease 0.1s',
      });
      document.body.appendChild(withdrawClone);
    }

    if (srcGoBackRect) {
      goBackClone = document.createElement('div');
      const goBackText = this.translateService.instant('EARNINGS.GO_BACK');
      goBackClone.innerHTML = `<span style="text-decoration:underline">${goBackText}</span>`;
      Object.assign(goBackClone.style, {
        position: 'fixed',
        left: `${srcGoBackRect.left}px`,
        top: `${srcGoBackRect.top}px`,
        width: `${srcGoBackRect.width}px`,
        height: `${srcGoBackRect.height}px`,
        zIndex: '10000',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        boxSizing: 'border-box',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        fontSize: '14px',
        fontWeight: '600',
        color: isDark ? '#8e8e93' : '#222222',
        backgroundColor: 'transparent',
        border: 'none',
        whiteSpace: 'nowrap',
        transition: 'all 0.42s cubic-bezier(0.32, 0.72, 0, 1)',
      });
      document.body.appendChild(goBackClone);
    }

    // Step 3: Suppress all entry animations on the home view so nothing flashes/drifts.
    this.returningFromEarnings = true;
    if (this.isMobile) {
      this.returningFromInline = true;
    }

    // Step 4: Switch back to home view
    this.showEarningsView = false;
    this.cdr.detectChanges();

    // Step 5: Force-hide the earnings card via inline style BEFORE the browser paints.
    // This is synchronous after detectChanges(), so the card never appears at opacity 1.
    // CSS animations have timing gaps; inline JS does not.
    const earningsDest = this.isMobile ? '.earnings-mobile-card' : '.grid-cell-earnings .earnings-card-widget';
    const cardWidget = document.querySelector(earningsDest) as HTMLElement;
    if (cardWidget) {
      cardWidget.style.opacity = '0';
    }

    // Step 6: After render, find home destinations and animate clones
    // Buttons start invisible via CSS (.skip-entry-animation .withdraw-btn/.view-details-link { opacity: 0 })
    const earningsDestContainer = this.isMobile ? '.earnings-mobile-card' : '.grid-cell-earnings';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const destWithdraw = document.querySelector(`${earningsDestContainer} .withdraw-btn`) as HTMLElement;
        const destViewDetails = document.querySelector(`${earningsDestContainer} .view-details-link`) as HTMLElement;

        // Fade the card in smoothly via JS transition (no CSS animation involved)
        if (cardWidget) {
          cardWidget.style.transition = 'opacity 0.32s ease-out';
          cardWidget.style.opacity = '1';
        }

        // Animate Withdraw Funds clone back to home card
        if (withdrawClone && destWithdraw) {
          const destRect = destWithdraw.getBoundingClientRect();
          withdrawClone.style.left = `${destRect.left}px`;
          withdrawClone.style.top = `${destRect.top}px`;
          withdrawClone.style.width = `${destRect.width}px`;
          withdrawClone.style.height = `${destRect.height}px`;
          withdrawClone.style.backgroundColor = 'transparent';
          withdrawClone.style.color = cloneFg;
          withdrawClone.style.borderColor = cloneFg;
          withdrawClone.style.borderRadius = '12px';
          withdrawClone.style.fontSize = '15px';

          // On landing: snap dest visible (inline overrides CSS opacity:0), then remove clone
          setTimeout(() => {
            destWithdraw.style.opacity = '1';
            requestAnimationFrame(() => {
              if (withdrawClone?.parentNode) withdrawClone.remove();
            });
          }, 480);
        } else if (withdrawClone) {
          withdrawClone.style.opacity = '0';
          setTimeout(() => { if (withdrawClone?.parentNode) withdrawClone.remove(); }, 350);
        }

        // Animate Go back → View Details clone back to home card
        if (goBackClone && destViewDetails) {
          const destRect = destViewDetails.getBoundingClientRect();
          const viewDetailsLabel = this.translateService.instant('HOME.VIEW_DETAILS');
          if (this.isMobile) {
            goBackClone.textContent = `${viewDetailsLabel} →`;
          } else {
            goBackClone.innerHTML = `<span style="text-decoration:underline">${viewDetailsLabel}</span><span style="width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:16px;line-height:1">→</span>`;
          }
          goBackClone.style.whiteSpace = 'nowrap';
          goBackClone.style.left = `${destRect.left}px`;
          goBackClone.style.top = `${destRect.top}px`;
          goBackClone.style.width = `${destRect.width}px`;
          goBackClone.style.height = `${destRect.height}px`;
          goBackClone.style.fontSize = this.isMobile ? '11px' : '14px';
          goBackClone.style.color = this.isMobile ? (isDark ? '#60a5fa' : '#6b7280') : (isDark ? '#8e8e93' : '#222222');

          // On landing: snap dest visible (inline overrides CSS opacity:0), then remove clone
          setTimeout(() => {
            destViewDetails.style.opacity = '1';
            requestAnimationFrame(() => {
              if (goBackClone?.parentNode) goBackClone.remove();
            });
          }, 450);
        } else if (goBackClone) {
          goBackClone.style.opacity = '0';
          setTimeout(() => { if (goBackClone?.parentNode) goBackClone.remove(); }, 420);
        }

        // Reset flag and clean inline styles.
        // CRITICAL: Before removing .skip-entry-animation, lock animation:none as an
        // inline style. Otherwise removing the class re-enables the CSS fadeInUp animation
        // which starts from opacity:0 → causing the flash.
        setTimeout(() => {
          // Lock inline animation:none BEFORE the class is removed
          if (cardWidget) {
            cardWidget.style.animation = 'none';
          }
          this.returningFromEarnings = false;
          this.returningFromInline = false;
          this.cdr.detectChanges();
          // Clean inline overrides (keep animation:none for now)
          requestAnimationFrame(() => {
            if (destWithdraw) destWithdraw.style.opacity = '';
            if (destViewDetails) destViewDetails.style.opacity = '';
            if (cardWidget) {
              cardWidget.style.transition = '';
              cardWidget.style.opacity = '';
            }
          });
        }, 550);
      });
    });

    // Refresh earnings summary data when returning to home view
    this.loadTutorEarnings();
  }

  private closeAllInlinePanelsExceptEarnings(): void {
    if (this.showCreateMaterialView) {
      this.showCreateMaterialView = false;
      this.homeInlineToolbar.setMaterialsViewOpen(false);
    }
    if (this.showExploreView) {
      this.showExploreView = false;
      this.homeInlineToolbar.setExploreViewOpen(false);
    }
    if (this.showScheduleClassView) {
      this.closeScheduleClassModal(false);
    }
    if (this.showForumView) {
      this.closeForumModal(false);
    }
  }

  onExploreGoBack() {
    this.showExploreView = false;
    this.homeInlineToolbar.setExploreViewOpen(false);
    this.cdr.detectChanges();

    if (this._scrollElRef) {
      this._scrollElRef.scrollTop = this._savedScrollBeforeExplore;
    }
  }

  onEditSaveInPlace(): void {
    const cm = this.createMaterialRef as {
      saveBundleInPlace?: () => Promise<boolean>;
      saveMaterialInPlace?: () => Promise<boolean>;
      viewMode?: string;
    } | undefined;
    if (cm?.viewMode === 'bundle-create') {
      void cm.saveBundleInPlace?.();
    } else {
      void cm?.saveMaterialInPlace?.();
    }
  }

  onCreateMaterialGoBack() {
    if (!this.isMobile && this.activatedRoute.firstChild) {
      this.router.navigate(['/tabs/home']);
    }
    this.createMaterialModalExpanded = false;
    this.createMaterialModalReady = false;
    this.createMaterialBackdropVisible = false;
    this.cmModalRouterOutletActive = false;
    this.showCreateMaterialView = false;
    this.homeInlineToolbar.setMaterialsViewOpen(false);
    document.body.classList.remove('cm-desktop-modal-open');
    this.modalShowSaveExit = true;
    this.modalIsEditingBundle = false;
    this.modalIsEditingMaterial = false;
    this.modalTopbarCenterStep = null;
    this.modalTopbarNavBackLabel = '';
    this.modalTopbarBundleWizardBackLabel = '';
    this.modalShowGoBack = false;
    this.modalShowBundleShareGoBack = false;
    this.modalShowBundleWizardGoBack = false;
    this.modalDetailsWizardFooter = false;
    this.modalDetailsWizardShowBack = false;
    this.modalDetailsWizardShowSaveDraft = false;
    this.modalFooterSaveLabelKey = null;
    this.modalDetailsWizardIsLastStep = false;
    this.modalDetailsWizardLastStepKey = null;
    this.modalFooterBackLabel = null;
    this.cdr.detectChanges();

    if (this._scrollElRef) {
      this._scrollElRef.scrollTop = this._savedScrollBeforeMaterial;
    }
  }

  onModalExpand(expanded: boolean) {
    this.createMaterialModalExpanded = expanded;

    if (!expanded) {
      this.modalShowFooter = false;
      this.modalShowSaveExit = true;
      this.modalIsEditingBundle = false;
      this.modalIsEditingMaterial = false;
      this.modalTopbarCenterStep = null;
      this.modalTopbarNavBackLabel = '';
      this.modalTopbarBundleWizardBackLabel = '';
      this.modalShowGoBack = false;
      this.modalShowBundleShareGoBack = false;
      this.modalShowBundleWizardGoBack = false;
      this.modalDetailsWizardFooter = false;
      this.modalDetailsWizardShowBack = false;
      this.modalDetailsWizardShowSaveDraft = false;
      this.modalFooterSaveLabelKey = null;
      this.modalDetailsWizardIsLastStep = false;
      this.modalDetailsWizardLastStepKey = null;
      this.modalFooterBackLabel = null;
    } else {
      this.applyDesktopModalFooterVisibility();
      setTimeout(() => {
        const cm = this.createMaterialRef as { refreshModalTopbarChrome?: () => void } | undefined;
        cm?.refreshModalTopbarChrome?.();
        this.applyDesktopModalFooterVisibility();
      }, 0);
    }

    this.cdr.detectChanges();
  }

  /** Footer "+ New" only on materials/bundles list — hide during gateway, create, and bundle flows. */
  private syncMaterialsModalChildRoute(url: string): void {
    if (this.isMobile) {
      if (this.cmModalRouterOutletActive) {
        this.cmModalRouterOutletActive = false;
        this.cdr.markForCheck();
      }
      return;
    }
    const prev = this.cmModalRouterOutletActive;
    const homeMaterial = url.match(/\/tabs\/home\/material\/([^/?#]+)/);
    const homeBundle = url.match(/\/tabs\/home\/bundle\/([^/?#]+)/);
    const next = !!(homeMaterial?.[1] || homeBundle?.[1]);
    this.cmModalRouterOutletActive = next;
    if (next) {
      this.showCreateMaterialView = true;
      this.createMaterialModalExpanded = true;
      if (!prev) {
        this.modalSidebarTab = homeMaterial ? 'materials' : 'bundles';
      }
      document.body.classList.add('cm-desktop-modal-open');
      this.homeInlineToolbar.setMaterialsViewOpen(true);
      if (!this.createMaterialBackdropVisible) {
        requestAnimationFrame(() => {
          this.createMaterialBackdropVisible = true;
          this.cdr.markForCheck();
        });
      }
      if (!this.createMaterialModalReady) {
        setTimeout(() => {
          this.createMaterialModalReady = true;
          this.cdr.markForCheck();
        }, 350);
      }
      this.modalShowFooter = false;
      this.modalDetailsWizardFooter = false;
      this.modalShowBundleShareGoBack = false;
      this.modalShowBundleWizardGoBack = false;
      this.modalShowSaveExit = false;
      this.modalTopbarCenterStep = null;
      this.modalTopbarNavBackLabel = '';
      this.modalTopbarBundleWizardBackLabel = '';
      this.modalShowGoBack = false;
      this.modalDetailsWizardShowSaveDraft = false;
      this.modalFooterSaveLabelKey = null;
      this.modalFooterBackLabel = null;
    }
    if (prev && !next && this.showCreateMaterialView) {
      requestAnimationFrame(() => {
        const ref = this.createMaterialRef as { restoreSection?: () => void; refreshModalTopbarChrome?: () => void } | undefined;
        ref?.restoreSection?.();
        ref?.refreshModalTopbarChrome?.();
        this.applyDesktopModalFooterVisibility();
        this.cdr.markForCheck();
      });
    }
    if (prev !== next) {
      this.cdr.markForCheck();
    }
  }

  private applyDesktopModalFooterVisibility(): void {
    if (this.isMobile || !this.createMaterialModalExpanded) {
      this.modalShowFooter = false;
      return;
    }
    if (this.cmModalRouterOutletActive) {
      this.modalShowFooter = false;
      this.modalDetailsWizardFooter = false;
      return;
    }
    const cm = this.createMaterialRef as {
      viewMode?: string;
      showMaterialsList?: boolean;
      showBundlesList?: boolean;
    } | undefined;
    const show =
      !!cm &&
      cm.viewMode === 'library' &&
      (cm.showMaterialsList === true || cm.showBundlesList === true);
    this.modalShowFooter = show;
  }

  onModalTopbarChrome(payload: {
    showSaveExit: boolean;
    showModalBack: boolean;
    showBundleShareGoBack?: boolean;
    showBundleWizardGoBack?: boolean;
    centerStepLabel?: string | null;
    topbarNavBackLabel?: string;
    topbarBundleWizardBackLabel?: string;
    isEditingBundle?: boolean;
    isEditingMaterial?: boolean;
  }) {
    if (this.isMobile) return;
    if (this.cmModalRouterOutletActive) return;
    this.modalShowSaveExit = payload.showSaveExit;
    this.modalIsEditingBundle = !!payload.isEditingBundle;
    this.modalIsEditingMaterial = !!payload.isEditingMaterial;
    this.modalShowGoBack = payload.showModalBack;
    this.modalShowBundleShareGoBack = !!payload.showBundleShareGoBack;
    this.modalShowBundleWizardGoBack = !!payload.showBundleWizardGoBack;
    this.modalTopbarCenterStep = payload.centerStepLabel ?? null;
    this.modalTopbarNavBackLabel = payload.topbarNavBackLabel ?? '';
    this.modalTopbarBundleWizardBackLabel = payload.topbarBundleWizardBackLabel ?? '';
    this.applyDesktopModalFooterVisibility();
    this.cdr.detectChanges();
  }

  onModalChromeBack() {
    const cmRef = this.createMaterialRef as { handleNavBack?: () => void } | undefined;
    cmRef?.handleNavBack?.();
  }

  onModalListBackToGateway(): void {
    const cm = this.createMaterialRef as { closeActiveListToGateway?: () => void } | undefined;
    cm?.closeActiveListToGateway?.();
  }

  onModalDetailOutletGoBack(): void {
    const url = this.router.url;
    const isMaterial = url.includes('/tabs/home/material/');
    const referrer = isMaterial
      ? sessionStorage.getItem('materialReferrer')
      : sessionStorage.getItem('bundleReferrer');
    if (referrer && (referrer.startsWith('/tabs/home/bundle/') || referrer.startsWith('/tabs/home/material/'))) {
      this.router.navigate([referrer]);
    } else {
      this.router.navigate(['/tabs/home']);
    }
  }

  onModalBundleShareGoBack(): void {
    const cm = this.createMaterialRef as { cancelBundleCreate?: () => void } | undefined;
    cm?.cancelBundleCreate?.();
  }

  onDetailsModalFooterChrome(payload: {
    active: boolean;
    showBack: boolean;
    showSaveDraft?: boolean;
    footerSaveLabelKey?: string | null;
    isLastStep: boolean;
    lastStepLabelKey?: string | null;
    footerBackLabel?: string | null;
  }) {
    if (this.isMobile) return;
    if (this.cmModalRouterOutletActive) return;
    this.modalDetailsWizardFooter = payload.active;
    this.modalDetailsWizardShowBack = payload.showBack;
    this.modalDetailsWizardShowSaveDraft = !!payload.showSaveDraft;
    this.modalFooterSaveLabelKey = payload.footerSaveLabelKey ?? null;
    this.modalDetailsWizardIsLastStep = payload.isLastStep;
    this.modalDetailsWizardLastStepKey = payload.lastStepLabelKey ?? null;
    this.modalFooterBackLabel = payload.footerBackLabel ?? null;
    this.cdr.detectChanges();
  }

  onModalSaveMaterialDraft(): void {
    const cm = this.createMaterialRef as {
      viewMode?: string;
      saveMaterialDraft?: () => Promise<void>;
      saveBundleAsDraft?: () => Promise<void>;
    } | undefined;
    if (cm?.viewMode === 'bundle-create') {
      void cm.saveBundleAsDraft?.();
      return;
    }
    void cm?.saveMaterialDraft?.();
  }

  onModalDetailsWizardBack() {
    const cm = this.createMaterialRef as { onWizardFooterBack?: () => void } | undefined;
    cm?.onWizardFooterBack?.();
  }

  onModalDetailsWizardNext() {
    const cm = this.createMaterialRef as { onWizardFooterNext?: () => void } | undefined;
    cm?.onWizardFooterNext?.();
  }

  onModalFooterCreate() {
    const cmRef = this.createMaterialRef as any;
    if (this.modalSidebarTab === 'materials' && cmRef?.startCreate) {
      cmRef.startCreate();
    } else if (this.modalSidebarTab === 'bundles' && cmRef?.startCreateBundle) {
      cmRef.startCreateBundle();
    }
    this.applyDesktopModalFooterVisibility();
    this.cdr.detectChanges();
  }

  onModalSidebarTabFromChild(tab: 'materials' | 'bundles') {
    if (this.isMobile) return;
    this.modalSidebarTab = tab;
    this.applyDesktopModalFooterVisibility();
    this.cdr.detectChanges();
  }

  onCreateMaterialModalBackdropClick(event: MouseEvent) {
    if (this.createMaterialModalExpanded) return;
    this.onCreateMaterialGoBack();
  }

  onModalSidebarSwitch(tab: 'materials' | 'bundles') {
    this.modalSidebarTab = tab;
    const cmRef = this.createMaterialRef as any;
    if (cmRef?.switchLibraryTab) {
      cmRef.switchLibraryTab(tab);
    }
    if (cmRef) {
      cmRef.viewMode = 'library';
      cmRef.showMaterialsList = false;
      cmRef.showBundlesList = false;
      if (tab === 'materials') {
        cmRef.showMaterialsList = true;
      } else {
        cmRef.showBundlesList = true;
      }
    }
    this.cdr.detectChanges();
    this.applyDesktopModalFooterVisibility();
    setTimeout(() => {
      const cm = this.createMaterialRef as { refreshModalTopbarChrome?: () => void } | undefined;
      cm?.refreshModalTopbarChrome?.();
      this.applyDesktopModalFooterVisibility();
    }, 0);
  }

  // Check Stripe Connect status for tutors
  async checkStripeConnectStatus() {
    if (!this.isTutor()) return;

    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/payments/stripe-connect/status`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success) {
        this.stripeConnectOnboarded = response.onboarded;
        
      }
    } catch (error) {
      console.error('❌ Error checking Stripe Connect status:', error);
    }
  }

  // Start Stripe Connect onboarding
  async startStripeConnectOnboarding() {
    this.isLoadingStripeConnect = true;

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/payments/stripe-connect/onboard`, {}, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success && response.onboardingUrl) {
        // Open Stripe onboarding in new window
        window.open(response.onboardingUrl, '_blank');
        
        const toast = await this.toastController.create({
          message: 'Complete the setup in the new window. Refresh this page when done.',
          duration: 5000,
          color: 'primary',
          position: 'top'
        });
        await toast.present();
      }
    } catch (error: any) {
      console.error('❌ Error starting Stripe Connect onboarding:', error);
      
      const toast = await this.toastController.create({
        message: error.error?.message || 'Failed to start payout setup. Please try again.',
        duration: 4000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    } finally {
      this.isLoadingStripeConnect = false;
    }
  }

  onEarningsBalanceChanged(event: { available: number; pending: number }) {
    this.tutorTotalEarnings = event.available || 0;
    this.tutorPendingEarnings = event.pending || 0;
    this.walletBalance = this.tutorTotalEarnings;
    this.updateWalletDisplay();
    this.cdr.detectChanges();
  }

  // Load tutor earnings summary
  async loadTutorEarnings() {
    if (!this.isTutorUser) {
      return;
    }

    try {
      // Use the NEW withdrawal system endpoint instead of legacy earnings
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/withdrawals/balance`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success) {
        // Show AVAILABLE balance only (ready to withdraw)
        this.tutorTotalEarnings = response.balance.available || 0;
        this.tutorPendingEarnings = response.balance.pending || 0;
        this.walletBalance = this.tutorTotalEarnings; // Show only available amount
        this.updateWalletDisplay(); // Update the hidden/revealed display
      }
    } catch (error) {
      console.error('❌ [TAB1] Error loading tutor earnings:', error);
    } finally {
      this.earningsBalanceLoading = false;
      this.cdr.detectChanges();
    }
  }

  // ─── Weekly earnings goal (desktop earnings widget) ─────────────────────────
  /** Per-user key; keeps goals isolated across tutors sharing a browser.
   * Persistence hierarchy: profile.weeklyEarningsGoal (DB) → localStorage (offline cache) → 500 default.
   */
  private get weeklyGoalStorageKey(): string {
    return `tutorWeeklyEarningsGoal_${this.currentUser?.id || 'anon'}`;
  }

  /** Hydrate from user profile first, then localStorage cache, then default.
   * Called on initial load and whenever currentUser$ emits.
   */
  private loadWeeklyEarningsGoalFromStorage(): void {
    const fromProfile = Number((this.currentUser as any)?.profile?.weeklyEarningsGoal);
    if (Number.isFinite(fromProfile) && fromProfile > 0) {
      this.weeklyEarningsGoal = Math.round(fromProfile);
      try { localStorage.setItem(this.weeklyGoalStorageKey, String(this.weeklyEarningsGoal)); } catch { /* ignore */ }
      this.weeklyGoalEditValue = this.weeklyEarningsGoal;
      return;
    }
    try {
      const raw = localStorage.getItem(this.weeklyGoalStorageKey);
      const parsed = raw != null ? parseFloat(raw) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        this.weeklyEarningsGoal = Math.round(parsed);
      }
    } catch { /* storage disabled — keep default */ }
    this.weeklyGoalEditValue = this.weeklyEarningsGoal;
  }

  /** Recomputes earned + scheduled from lessons; safe to call any time lessons change. */
  refreshWeeklyEarningsProgress(): void {
    if (!this.isTutorUser) {
      this.weeklyEarningsCompleted = 0;
      this.weeklyEarningsScheduled = 0;
      this.weeklyScheduledLessonCount = 0;
      this.updateWeeklyEarningsLabels();
      return;
    }
    const now = new Date();
    const weekStart = this.getStartOfWeek(this.startOfDay(now));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const earnedStatuses = new Set(['completed', 'ended_early']);
    const upcomingStatuses = new Set(['scheduled', 'confirmed', 'in_progress']);

    // pastLessons → completed; this.lessons may hold upcoming AND recently-completed.
    const pool: Lesson[] = [...(this.pastLessons || []), ...(this.lessons || [])];
    const seen = new Set<string>();
    let earned = 0;
    let scheduled = 0;
    let scheduledCount = 0;
    for (const l of pool) {
      const id = String((l as any)._id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const start = new Date(l.startTime);
      if (!(start >= weekStart && start < weekEnd)) continue;
      const price = Number((l as any).price);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (earnedStatuses.has(l.status)) {
        earned += price;
      } else if (upcomingStatuses.has(l.status)) {
        scheduled += price;
        scheduledCount += 1;
      }
    }
    this.weeklyEarningsCompleted = Math.round(earned * 100) / 100;
    this.weeklyEarningsScheduled = Math.round(scheduled * 100) / 100;
    this.weeklyScheduledLessonCount = scheduledCount;
    this.updateWeeklyEarningsLabels();
  }

  private updateWeeklyEarningsLabels(): void {
    const goal = this.weeklyEarningsGoal > 0 ? this.weeklyEarningsGoal : 1;
    const earned = this.weeklyEarningsCompleted;
    const scheduled = this.weeklyEarningsScheduled;
    const scheduledCount = this.weeklyScheduledLessonCount;

    const earnedPct = Math.max(0, Math.min(100, (earned / goal) * 100));
    const combinedPct = Math.max(0, Math.min(100, ((earned + scheduled) / goal) * 100));
    this.weeklyEarningsGoalPercent = earnedPct;
    this.weeklyEarningsScheduledPercent = combinedPct;
    this.isWeeklyGoalReached = earned >= this.weeklyEarningsGoal;

    // When wallet balance is masked we hide the entire goal section — no need to compute
    // masked copy variants. Still set the flag so the template's *ngIf can gate visibility.
    this.isWeeklyGoalMasked = !this.showWalletBalance && !this.walletTemporarilyVisible;

    const fmt = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
    this.weeklyEarningsGoalLabel = `${fmt(earned)} of ${fmt(this.weeklyEarningsGoal)} goal`;

    // Sub-label priority (first match wins).
    const combined = earned + scheduled;
    const lessonWord = scheduledCount === 1 ? 'lesson' : 'lessons';

    if (this.isWeeklyGoalReached) {
      this.weeklyEarningsGoalSubLabel = 'Goal reached — nice work';
      return;
    }

    if (earned > 0) {
      if (combined >= this.weeklyEarningsGoal && scheduled > 0) {
        this.weeklyEarningsGoalSubLabel = `On pace · ${fmt(scheduled)} scheduled this week`;
      } else {
        const today = new Date();
        const daysLeft = Math.max(1, 7 - today.getDay());
        const remaining = Math.max(0, this.weeklyEarningsGoal - earned);
        const perDay = Math.ceil(remaining / daysLeft);
        this.weeklyEarningsGoalSubLabel = `$${perDay}/day to hit goal`;
      }
      return;
    }

    if (scheduled > 0) {
      const shortfall = Math.max(0, this.weeklyEarningsGoal - scheduled);
      this.weeklyEarningsGoalSubLabel = shortfall > 0
        ? `${scheduledCount} ${lessonWord} scheduled · ${fmt(shortfall)} to go`
        : `${scheduledCount} ${lessonWord} scheduled · on pace`;
      return;
    }

    this.weeklyEarningsGoalSubLabel = this.hasAvailability
      ? 'Open for bookings — no lessons yet'
      : 'Add availability to start earning';
  }

  startEditWeeklyGoal(): void {
    this.weeklyGoalEditValue = this.weeklyEarningsGoal;
    this.isEditingWeeklyGoal = true;
    this.cdr.markForCheck();
  }

  cancelEditWeeklyGoal(): void {
    this.isEditingWeeklyGoal = false;
    this.weeklyGoalEditValue = this.weeklyEarningsGoal;
    this.cdr.markForCheck();
  }

  saveWeeklyGoal(): void {
    const next = Math.round(Number(this.weeklyGoalEditValue));
    if (!Number.isFinite(next) || next <= 0) {
      this.cancelEditWeeklyGoal();
      return;
    }
    const previous = this.weeklyEarningsGoal;
    // Optimistic local update so UI feels instant; recompute percentages + sub-labels now.
    this.weeklyEarningsGoal = next;
    try { localStorage.setItem(this.weeklyGoalStorageKey, String(next)); } catch { /* ignore */ }
    this.isEditingWeeklyGoal = false;
    this.refreshWeeklyEarningsProgress();
    this.cdr.markForCheck();

    // Persist to DB. On failure, roll back to previous value so local + server stay in sync.
    this.userService.updateProfile({ weeklyEarningsGoal: next } as any).subscribe({
      error: (err) => {
        console.error('Failed to save weekly earnings goal:', err);
        this.weeklyEarningsGoal = previous;
        this.weeklyGoalEditValue = previous;
        try { localStorage.setItem(this.weeklyGoalStorageKey, String(previous)); } catch { /* ignore */ }
        this.refreshWeeklyEarningsProgress();
        this.cdr.markForCheck();
      }
    });
  }

  isTutor(): boolean {
    return this.currentUser?.['userType'] === 'tutor';
  }

  // Method to refresh user data from database
  refreshUserData() {
    this.userService.getCurrentUser().pipe(
      observeOn(asyncScheduler)
    ).subscribe(user => {
      this.currentUser = user;
      this.cdr.markForCheck();
    });
  }

  // Student lesson join helpers (for tutor view student cards)
  canJoinStudentLesson(student: any): boolean {
    if (!student.lesson) return false;
    const lesson = student.lesson as Lesson;
    if (this.isLessonInProgress(lesson)) return true;
    // No need to reference countdownTick here - we use cached joinLabel instead
    return this.lessonService.canJoinLesson(lesson);
  }

  /**
   * Calculate join label for a lesson (used for pre-calculation)
   */
  private calculateJoinLabel(lesson: Lesson): string {
    const participant = (lesson as any).participant;
    if (this.isLessonInProgress(lesson) && participant?.joinedBefore && participant?.leftAfterJoin) {
      return 'Rejoin';
    }
    
    if (this.isLessonInProgress(lesson) || this.lessonService.canJoinLesson(lesson)) {
      return 'Join';
    }
    
    const secs = this.lessonService.getTimeUntilJoin(lesson);
    return `Join in ${this.lessonService.formatTimeUntil(secs)}`;
  }

  /**
   * Update join labels for all displayed students
   */
  private updateStudentJoinLabels(): void {
    // Update labels in place for cached students to prevent flashing
    // Only update if the label text would actually change (e.g., minute change)
    // Update both currentStudents and cachedStudentsForDate (they reference the same objects)
    if (this.currentStudents && this.currentStudents.length > 0) {
      this.currentStudents.forEach(student => {
        if (student.lesson) {
          const newLabel = this.calculateJoinLabel(student.lesson as Lesson);
          // Only update if label changed to minimize DOM updates
          if (student.joinLabel !== newLabel) {
            student.joinLabel = newLabel;
          }
        }
      });
      // cachedStudentsForDate contains references to the same student objects,
      // so updating currentStudents also updates cachedStudentsForDate
      // Note: countdownTick is updated by the caller after this method
      // to ensure a single change detection cycle
    }
  }

  getStudentJoinLabel(student: any): string {
    // Use pre-calculated label if available to prevent flashing
    if (student.joinLabel !== undefined) {
      return student.joinLabel;
    }
    
    // Fallback to calculation if label not pre-calculated
    if (!student.lesson) return 'Join';
    return this.calculateJoinLabel(student.lesson as Lesson);
  }

  async joinStudentLesson(student: any) {
    if (!student.lesson || !this.currentUser) return;
    const lesson = student.lesson as Lesson;
    const isClass = (lesson as any).isClass || false;

    if (lesson.status === 'cancelled') {
      const alert = await this.alertController.create({
        header: this.translateService.instant('HOME.JOIN_CANCELLED_TITLE'),
        message: this.translateService.instant('HOME.JOIN_CANCELLED_MSG'),
        buttons: [{ text: this.translateService.instant('COMMON.OK'), role: 'cancel' }]
      });
      await alert.present();
      return;
    }

    const canJoin = this.isLessonInProgress(lesson) || this.lessonService.canJoinLesson(lesson);
    if (!canJoin) {
      const now = new Date();
      const endTime = new Date(lesson.endTime);
      const latestJoin = new Date(endTime.getTime() + 5 * 60000);
      if (now > latestJoin) {
        const alert = await this.alertController.create({
          header: this.translateService.instant('HOME.JOIN_LESSON_ENDED_TITLE'),
          message: this.translateService.instant('HOME.JOIN_LESSON_ENDED_MSG'),
          buttons: [{ text: this.translateService.instant('COMMON.OK'), role: 'cancel' }]
        });
        await alert.present();
        return;
      }

      const timeStr = this.getTimeUntilLesson(lesson);
      const sessionKey = isClass ? 'HOME.JOIN_SESSION_CLASS' : 'HOME.JOIN_SESSION_LESSON';
      const alert = await this.alertController.create({
        header: this.translateService.instant('HOME.JOIN_NOT_READY_TITLE'),
        message: this.translateService.instant('HOME.JOIN_NOT_READY_MSG', {
          session: this.translateService.instant(sessionKey),
          time: timeStr
        }),
        buttons: [{ text: this.translateService.instant('COMMON.OK'), role: 'cancel' }]
      });
      await alert.present();
      return;
    }

    

    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: lesson._id,
        lessonMode: 'true',
        isClass: isClass ? 'true' : 'false'
      }
    });
  }

  messageStudent(student: any) {
    // TODO: Implement message functionality
  }

  async openMobileLessonMenu(event: Event, lesson: Lesson) {
    event.stopPropagation();
    
    if (!lesson) {
      return;
    }

    const isClass = lesson.isClass || false;
    const itemId = lesson._id || (lesson.classData?._id);
    if (!itemId) {
      console.error('Lesson/Class ID not found');
      return;
    }

    // Use Action Sheet for mobile
    const buttons: any[] = [];
    
    // Only show "Invite Student" for classes
    if (isClass) {
      buttons.push({
        text: 'Invite Student',
        icon: 'person-add-outline',
        handler: () => {
          this.inviteStudentToClass(itemId);
        }
      });
    }
    
    // Check if lesson has started
    const lessonStarted = this.hasLessonStarted(lesson);
    
    // Only add Reschedule button if lesson hasn't started
    if (!lessonStarted) {
      buttons.push({
        text: 'Reschedule',
        icon: 'calendar-outline',
        handler: () => {
          // Return true to dismiss action sheet immediately, then handle action
          setTimeout(() => {
            if (isClass) {
              this.rescheduleClass(itemId, lesson);
            } else {
              this.rescheduleLesson(itemId, lesson);
            }
          }, 100); // Wait for action sheet to fully dismiss
          return true; // Dismiss action sheet
        }
      });
    }
    
    buttons.push(
      {
        text: 'Cancel',
        icon: 'close-circle-outline',
        role: 'destructive',
        handler: () => {
          // Return true to dismiss action sheet immediately, then handle action
          setTimeout(() => {
            if (isClass) {
              this.cancelClass(itemId, lesson);
            } else {
              this.cancelLesson(itemId, lesson);
            }
          }, 100); // Wait for action sheet to fully dismiss
          return true; // Dismiss action sheet
        }
      },
      {
        text: 'Close',
        icon: 'close',
        role: 'cancel'
      }
    );

    const actionSheet = await this.actionSheetController.create({
      header: isClass ? 'Class Options' : 'Lesson Options',
      buttons: buttons
    });
    await actionSheet.present();
  }

  async openLessonMenu(event: Event, lesson: Lesson) {
    event.stopPropagation();
    
    if (!lesson) {
      return;
    }

    const isClass = lesson.isClass || false;
    const itemId = lesson._id || (lesson.classData?._id);
    if (!itemId) {
      console.error('Lesson/Class ID not found');
      return;
    }

    if (this.isMobile) {
      this.openMobileLessonMenu(event, lesson);
    } else {
      // Use Popover for desktop
      // Get the button element (currentTarget should be the ion-button)
      const buttonElement = (event.currentTarget as HTMLElement) || (event.target as HTMLElement).closest('ion-button') as HTMLElement;
      
      if (!buttonElement) {
        console.error('Could not find button element for popover');
        return;
      }
      
      // Get button's position in viewport (accounts for scroll automatically)
      const rect = buttonElement.getBoundingClientRect();
      
      // Use the original event but ensure coordinates are from button center-bottom
      const popoverEvent = {
        ...event,
        clientX: rect.left + rect.width / 2,
        clientY: rect.bottom,
        target: buttonElement,
        currentTarget: buttonElement
      };
      
      const popover = await this.popoverController.create({
        component: ClassMenuPopoverComponent,
        event: popoverEvent as any,
        componentProps: {
          classId: itemId,
          lesson: lesson,
          isClass: isClass
        },
        showBackdrop: true,
        alignment: 'start',
        side: 'bottom',
        size: 'auto'
      });
      await popover.present();
      const { data } = await popover.onWillDismiss();
      
      // Add delay after popover dismisses before opening modal to prevent freeze
      if (data) {
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (data.action === 'invite' && isClass) {
          this.inviteStudentToClass(itemId);
        } else if (data.action === 'reschedule') {
          if (isClass) {
            this.rescheduleClass(itemId, lesson);
          } else {
            this.rescheduleLesson(itemId, lesson);
          }
        } else if (data.action === 'cancel') {
          if (isClass) {
            this.cancelClass(itemId, lesson);
          } else {
            this.cancelLesson(itemId, lesson);
          }
        }
      }
    }
  }

  async inviteStudentToClass(classId: string) {
    
    
    try {
      // Find the lesson/class to get the name and full class data
      const lesson = this.lessons.find(l => l._id === classId || l.classData?._id === classId);
      const className = lesson?.className || lesson?.classData?.name || '';
      const classData = lesson?.classData || lesson;
      
      
      
      // Use inline modal instead of programmatic modal
      this.inviteStudentModalProps = {
        className: className,
        classId: classId,
        classData: classData
      };
      this.isInviteStudentModalOpen = true;
      
      
    } catch (error) {
      console.error('❌ Error opening invite modal:', error);
    }
  }
  
  onInviteStudentModalDismiss(event: any) {
    this.isInviteStudentModalOpen = false;
  }

  /** Invite modal stays open after send; refresh home/calendar data when invites succeed. */
  onInviteStudentsSent(_payload: { count: number }) {
    this.loadLessons(false);
  }

  /**
   * Handle reschedule button click - prevents menu from closing when disabled
   */
  handleRescheduleClick(event: Event, lesson: Lesson): void {
    if (this.hasLessonStarted(lesson)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    
    // Only proceed if lesson hasn't started
    if (lesson?.isClass) {
      this.rescheduleClass(lesson._id, lesson);
    } else {
      this.rescheduleLesson(lesson._id, lesson);
    }
  }

  async rescheduleClass(classId: string, lesson: Lesson) {
    try {
      const isTutor = this.lessonTutorIsCurrentUser(lesson);
      const participantAvatar =
        (lesson as any).classData?.thumbnail ||
        (lesson as any).thumbnail ||
        this.getOtherParticipantAvatar(lesson) ||
        null;
      const participantForModal = isTutor
        ? (lesson as any).className || (lesson as any).classData?.name || lesson.subject || 'Class'
        : lesson.tutorId;
      await this.openRescheduleModal(classId, lesson, participantForModal, participantAvatar, false);
    } catch (error) {
      console.error('❌ Error opening reschedule class modal:', error);
    }
  }

  async rescheduleLesson(lessonId: string, lesson: Lesson) {
    
    
    try {
      // Get participant info
      const isTutor = this.lessonTutorIsCurrentUser(lesson);
      const otherParticipant = isTutor ? lesson.studentId : lesson.tutorId;
      
      // Get participant avatar
      const participantAvatar = this.getOtherParticipantAvatar(lesson);
      
      // Directly open the full reschedule modal with calendar
      await this.openRescheduleModal(lessonId, lesson, otherParticipant, participantAvatar, false);
    } catch (error) {
      console.error('❌ Error opening reschedule lesson modal:', error);
    }
  }
  
  // Handle confirm reschedule modal dismissal
  onConfirmRescheduleModalDismiss(event: any) {
    
    this.isConfirmRescheduleModalOpen = false;
    
    const data = event.detail?.data;
    if (data && data.confirmed && this.confirmRescheduleModalData) {
      // Open reschedule modal with raw participant object (not formatted name)
      const lessonId = this.confirmRescheduleModalData.lessonId;
      const lesson = this.confirmRescheduleModalData.lesson;
      const otherParticipant = this.confirmRescheduleModalData.otherParticipant;
      const participantAvatar = this.confirmRescheduleModalData.participantAvatar || null;
      
      this.openRescheduleModal(lessonId, lesson, otherParticipant, participantAvatar);
    }
  }

  async showRescheduleProposal(lesson: any) {
    
    
    try {
      // Get participant info
      const isTutor = lesson.tutorId?._id === this.currentUser?.id;
      const otherParticipant = isTutor ? lesson.studentId : lesson.tutorId;
      const participantName = this.formatStudentDisplayName(otherParticipant);
      const participantAvatar = this.getOtherParticipantAvatar(lesson);
      
      const proposal = lesson.rescheduleProposal;
      if (!proposal) {
        console.error('No reschedule proposal found');
        return;
      }

      const proposedDate = new Date(proposal.proposedStartTime);
      const originalDate = new Date(lesson.startTime);

      // Set modal data and open inline modal (no programmatic creation = no JIT compilation delay)
      this.rescheduleProposalModalData = {
        lessonId: lesson._id,
        lesson: lesson,
        proposal: proposal,
        participantName: participantName,
        participantAvatar: participantAvatar || undefined,
        proposedDate: formatDateInTz(proposedDate, this.userTz, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        proposedTime: formatTimeInTz(proposedDate, this.userTz),
        originalDate: formatDateInTz(originalDate, this.userTz, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        originalTime: formatTimeInTz(originalDate, this.userTz),
        otherParticipant: otherParticipant
      };
      
      // Open the inline modal
      this.isRescheduleProposalModalOpen = true;
    } catch (error) {
      console.error('❌ Error opening reschedule proposal modal:', error);
    }
  }
  
  // Handle inline reschedule proposal modal dismissal
  onRescheduleProposalModalDismiss(event: any) {
    
    this.isRescheduleProposalModalOpen = false;
    
    const data = event.detail?.data;
    if (data && data.action) {
      if (data.action === 'accepted' || data.action === 'rejected') {
        // Force reload lessons to get updated data (bypass cache)
        
        this._lastDataFetch = 0; // Invalidate cache to force reload
        this.loadLessons(false);
      } else if (data.action === 'counter' && this.rescheduleProposalModalData) {
        // Open reschedule modal to propose a different time
        const lesson = this.rescheduleProposalModalData.lesson;
        const otherParticipant = this.rescheduleProposalModalData.otherParticipant;
        const participantAvatar = this.rescheduleProposalModalData.participantAvatar || null;
        this.openRescheduleModal(lesson._id, lesson, otherParticipant, participantAvatar, true); // Pass true for showBackButton
      }
    }
  }

  isRescheduleProposer(lesson: any): boolean {
    if (!lesson?.rescheduleProposal || !this.currentUser) {
      return false;
    }
    
    const lessonId = lesson._id || lesson.lessonId;
    const cacheKey = `${lessonId}-${lesson.rescheduleProposal.status}`;
    
    // Cache results for 5 seconds to avoid repeated computation during change detection
    const now = Date.now();
    if (now - this._rescheduleProposerCacheTime > 5000) {
      this._rescheduleProposerCache.clear();
      this._rescheduleProposerCacheTime = now;
    }
    
    if (this._rescheduleProposerCache.has(cacheKey)) {
      return this._rescheduleProposerCache.get(cacheKey)!;
    }
    
    const proposedById = lesson.rescheduleProposal.proposedBy?._id || lesson.rescheduleProposal.proposedBy;
    const currentUserId = this.currentUser.id;
    
    // Convert both to strings for comparison
    const proposedByStr = String(proposedById);
    const currentUserStr = String(currentUserId);
    
    const result = proposedByStr === currentUserStr;
    this._rescheduleProposerCache.set(cacheKey, result);
    return result;
  }
  
  // Helper: Check if reschedule was accepted (for template)
  isRescheduleAccepted(lesson: any): boolean {
    return lesson?.rescheduleProposal?.status === 'accepted';
  }

  async cancelClass(classId: string, lesson: Lesson) {
    
    
    try {
      const className = lesson?.className || lesson?.classData?.name || '';
      const anyLesson = lesson as any;
      const classThumbnailUrl =
        anyLesson?.classData?.thumbnail || anyLesson?.thumbnail || undefined;

      // STEP 1: Show the cancellation reason modal (class variant)
      const reasonModal = await this.modalCtrl.create({
        component: CancelReasonModalComponent,
        componentProps: {
          entityType: 'class',
          userRole: 'tutor',
          className: className,
          classThumbnailUrl,
          lessonStartTime: lesson?.startTime,
          lessonDuration: lesson?.duration
        },
        cssClass: 'cancel-reason-modal'
      });
      await reasonModal.present();
      const reasonResult = await reasonModal.onDidDismiss();
      if (reasonResult.data?.rescheduleInstead) {
        if (!this.hasLessonStarted(lesson)) {
          await this.rescheduleClass(classId, lesson);
        } else {
          const toast = await this.toastController.create({
            message: 'This class has already started and cannot be rescheduled.',
            duration: 3000,
            position: 'bottom',
            color: 'medium'
          });
          await toast.present();
        }
        return;
      }
      if (reasonResult.data?.cancelled || !reasonResult.data?.reason) {
        return;
      }
      this.selectedCancelReason = reasonResult.data.reason;

      // STEP 2: Final confirmation (compact Apple-style dialog)
      const modal = await this.modalCtrl.create({
        component: ConfirmActionModalComponent,
        componentProps: {
          title: 'Cancel class?',
          message: `Are you sure you want to cancel "${className}"? All invited and confirmed students will be notified. This action cannot be undone.`,
          confirmText: 'Cancel class',
          cancelText: 'Reschedule instead?',
          secondaryDismissReschedules: true,
          confirmColor: 'danger',
          icon: 'close-circle',
          iconColor: 'danger'
        },
        cssClass: 'confirm-action-modal'
      });

      await modal.present();
      const { data } = await modal.onDidDismiss();
      if (data?.rescheduleInstead) {
        if (!this.hasLessonStarted(lesson)) {
          await this.rescheduleClass(classId, lesson);
        } else {
          const toast = await this.toastController.create({
            message: 'This class has already started and cannot be rescheduled.',
            duration: 3000,
            position: 'bottom',
            color: 'medium'
          });
          await toast.present();
        }
        return;
      }
      if (data && data.confirmed) {
        const loading = await this.loadingController.create({
          message: 'Cancelling class...',
          spinner: 'crescent'
        });
        await loading.present();
        
        try {
          // Call the backend to cancel the class
          await firstValueFrom(this.classService.cancelClass(classId));
          
          
          
          // Remove the class from the UI
          this.lessons = this.lessons.filter(l => {
            const lessonId = l._id;
            return lessonId?.toString() !== classId?.toString();
          });
          
          // Refresh the data
          await this.ionViewWillEnter();
          
          const toast = await this.toastController.create({
            message: `"${className}" has been cancelled`,
            duration: 3000,
            position: 'bottom',
            color: 'success'
          });
          await toast.present();
        } catch (error: any) {
          console.error('❌ [CLASS-CANCEL] Error cancelling class:', error);
          const errorMessage = error?.error?.message || 'Failed to cancel class';
          const toast = await this.toastController.create({
            message: errorMessage,
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        } finally {
          await loading.dismiss();
        }
      }
    } catch (error) {
      console.error('❌ Error opening cancel class modal:', error);
    }
  }

  // Store selected cancellation reason
  private selectedCancelReason: { id: string; label: string } | null = null;

  async cancelLesson(lessonId: string, lesson: Lesson) {
    
    
    try {
      // Get participant info
      const isTutor = lesson.tutorId?._id === this.currentUser?.id;
      const otherParticipant = isTutor ? lesson.studentId : lesson.tutorId;
      
      // Format participant name using the participant object directly (not the .name string)
      const participantName = this.formatStudentDisplayName(otherParticipant);
      
      // Get participant avatar
      const participantAvatar = this.getOtherParticipantAvatar(lesson);
      
      // STEP 1: Show the cancellation reason modal first
      const reasonModal = await this.modalCtrl.create({
        component: CancelReasonModalComponent,
        componentProps: {
          participantName: participantName,
          participantAvatar: participantAvatar || undefined,
          userRole: isTutor ? 'tutor' : 'student',
          lessonStartTime: lesson.startTime,
          lessonSubject: lesson.subject || 'Language Lesson',
          lessonDuration: lesson.duration
        },
        cssClass: 'cancel-reason-modal'
      });
      
      await reasonModal.present();
      const reasonResult = await reasonModal.onDidDismiss();

      if (reasonResult.data?.rescheduleInstead) {
        if (!this.hasLessonStarted(lesson)) {
          await this.rescheduleLesson(lessonId, lesson);
        } else {
          const toast = await this.toastController.create({
            message: 'This lesson has already started and cannot be rescheduled.',
            duration: 3000,
            position: 'bottom',
            color: 'medium'
          });
          await toast.present();
        }
        return;
      }

      // If user cancelled or didn't select a reason, stop here
      if (reasonResult.data?.cancelled || !reasonResult.data?.reason) {
        
        return;
      }
      
      // Store the selected reason for use in confirmation
      this.selectedCancelReason = reasonResult.data.reason;
      const selectedReasonLabel = this.selectedCancelReason?.label || 'Not specified';
      
      
      // STEP 2: Show confirmation alert popup (matches reschedule confirmation style)
      const alert = await this.alertController.create({
        header: 'Cancel Lesson',
        message: `Are you sure you want to cancel this lesson? ${participantName} will be notified and this action cannot be undone.`,
        buttons: [
          {
            text: 'Go Back',
            role: 'cancel',
            cssClass: 'alert-cancel-button'
          },
          {
            text: 'Reschedule instead?',
            handler: () => {
              if (!this.hasLessonStarted(lesson)) {
                void this.rescheduleLesson(lessonId, lesson);
              } else {
                void this.toastController.create({
                  message: 'This lesson has already started and cannot be rescheduled.',
                  duration: 3000,
                  position: 'bottom',
                  color: 'medium'
                }).then(t => t.present());
              }
              return true;
            }
          },
          {
            text: 'Cancel Lesson',
            role: 'confirm',
            cssClass: 'alert-confirm-button',
            handler: () => {
              this.executeCancelLesson(lessonId);
            }
          }
        ]
      });
      await alert.present();
    } catch (error) {
      console.error('❌ Error opening cancel lesson modal:', error);
    }
  }
  
  // Execute the actual cancel lesson API call (called from alert confirmation)
  private async executeCancelLesson(lessonId: string) {
    const loading = await this.loadingController.create({
      message: 'Cancelling lesson...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Call the backend to cancel the lesson with the reason
      const response = await this.lessonService.cancelLesson(
        lessonId, 
        this.selectedCancelReason?.id,
        this.selectedCancelReason?.label
      ).toPromise();
      
      await loading.dismiss();
      
      // Clear the selected reason
      this.selectedCancelReason = null;

      if (response?.success) {
        // Show success toast
        const toast = await this.toastController.create({
          message: 'Lesson cancelled successfully',
          duration: 3000,
          position: 'bottom',
          color: 'success'
        });
        await toast.present();

        // Reload lessons to reflect the change (no skeleton)
        await this.loadLessons(false);
      } else {
        throw new Error(response?.message || 'Failed to cancel lesson');
      }
    } catch (error: any) {
      await loading.dismiss();
      this.selectedCancelReason = null;
      console.error('❌ Error cancelling lesson:', error);
      
      const toast = await this.toastController.create({
        message: error?.error?.message || 'Failed to cancel lesson. Please try again.',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    }
  }

  // Handle confirm cancel modal dismissal (kept for backward compatibility)
  async onConfirmCancelModalDismiss(event: any) {
    
    this.isConfirmCancelModalOpen = false;
    this.selectedCancelReason = null;
  }

  /**
   * Whether the current user is the tutor on this row. Handles hub classes where `tutorId`
   * may be a plain Mongo id string (see `loadLessons` class merge).
   */
  private lessonTutorIsCurrentUser(lesson: Lesson | null | undefined): boolean {
    if (!lesson?.tutorId || !this.currentUser?.id) {
      return false;
    }
    const t = lesson.tutorId as any;
    const tid = t?._id ?? t;
    return String(tid) === String(this.currentUser.id);
  }

  // Open reschedule modal with embedded availability calendar
  async openRescheduleModal(lessonId: string, lesson: Lesson, participantObject: any, participantAvatar: string | null, showBackButton: boolean = false) {
    const isClassLesson = !!(lesson as any)?.isClass;

    // Get the other participant's ID
    const isTutor = this.lessonTutorIsCurrentUser(lesson);
    let otherParticipantId: string | null = null;

    // Use the passed participant object, or extract from lesson
    let otherParticipant = participantObject;
    if (!otherParticipant) {
      otherParticipant = isTutor ? lesson.studentId : lesson.tutorId;
    }

    if (otherParticipant && typeof otherParticipant === 'object') {
      otherParticipantId = (otherParticipant as any)?._id || (otherParticipant as any)?.id;
    } else if (typeof otherParticipant === 'string') {
      otherParticipantId = null;
    }

    if (!this.currentUser?.id) {
      const toast = await this.toastController.create({
        message: 'Could not find participant information',
        duration: 2000,
        color: 'danger',
        position: 'bottom'
      });
      await toast.present();
      return;
    }

    // Group classes have no single "other student"; reschedule modal skips mutual student-busy load.
    if (!isClassLesson && !otherParticipantId) {
      const toast = await this.toastController.create({
        message: 'Could not find participant information',
        duration: 2000,
        color: 'danger',
        position: 'bottom'
      });
      await toast.present();
      return;
    }
    
    // Pass the raw participant object so the modal can format it properly using firstName/lastName
    // If it's a string, pass it as-is (will be formatted in modal)
    const participantNameForModal = otherParticipant || 'Student';
    
    const participantIdForModal =
      isClassLesson && isTutor
        ? String(this.currentUser.id)
        : String(otherParticipantId);

    // Set modal data and open inline modal (no programmatic creation = no JIT compilation delay)
    this.rescheduleModalData = {
      lessonId: lessonId,
      lesson: lesson,
      participantId: participantIdForModal,
      participantName: participantNameForModal,
      participantAvatar: participantAvatar || undefined,
      currentUserId: this.currentUser.id,
      isTutor: isTutor,
      showBackButton: showBackButton
    };
    
    // Open the inline modal
    this.isRescheduleModalOpen = true;
    // Required when opening from Ionic modal dismiss (e.g. "Reschedule instead?") — OnPush won't refresh otherwise
    this.cdr.markForCheck();
  }
  
  // Handle inline modal dismissal
  onRescheduleModalDismiss(event: any) {
    
    this.isRescheduleModalOpen = false;
    
    const data = event.detail?.data;
    
    // Check if user wants to go back to the proposal modal
    if (data?.goBackToProposal && this.rescheduleProposalModalData) {
      // Re-open the proposal modal
      setTimeout(() => {
        this.isRescheduleProposalModalOpen = true;
      }, 100);
      return;
    }
    
    // Check if lesson was rescheduled
    if (data?.rescheduled) {
      // Lesson was successfully rescheduled, reload lessons (no skeleton)
      this.loadLessons(false);
    }
  }

  /**
   * Select the most relevant lesson from this.lessons
   * Priority: 1) In progress, 2) Next upcoming, 3) Most recent past (only from today)
   */
  private selectMostRelevantLesson(now: number): Lesson | null {
    if (!this.lessons || this.lessons.length === 0) {
      return null;
    }

    // First priority: Find any lesson currently in progress
    const inProgressLesson = this.lessons.find(l => {
      const startTime = new Date(l.startTime).getTime();
      const endTime = new Date(l.endTime).getTime();
      return startTime <= now && now < endTime;
    });
    
    if (inProgressLesson) {
      return inProgressLesson;
    }
    
    // Second priority: Find the next upcoming lesson (future lessons only)
    const upcomingLessons = this.lessons.filter(l => {
      const startTime = new Date(l.startTime).getTime();
      return startTime > now;
    });
    
    if (upcomingLessons.length > 0) {
      // Return the soonest upcoming lesson (lessons are already sorted by startTime)
      return upcomingLessons[0];
    }
    
    // Third priority: If no upcoming lessons, show the most recent past lesson from today only
    // This ensures we don't show old lessons from earlier today after they've ended
    const today = this.startOfDay(new Date());
    const pastLessonsToday = this.lessons.filter(l => {
      const endTime = new Date(l.endTime).getTime();
      const lessonDate = new Date(l.startTime);
      const lessonDay = this.startOfDay(lessonDate);
      
      // Only include lessons that ended in the past but happened today
      return endTime < now && lessonDay.getTime() === today.getTime();
    });
    
    if (pastLessonsToday.length > 0) {
      // Find the lesson with the most recent end time from today
      return pastLessonsToday.reduce((mostRecent, current) => {
        const currentEnd = new Date(current.endTime).getTime();
        const mostRecentEnd = new Date(mostRecent.endTime).getTime();
        return currentEnd > mostRecentEnd ? current : mostRecent;
      });
    }
    
    return null;
  }

  /**
   * Recalculate upcoming lesson (called periodically to update as time passes)
   */
  private recalculateUpcomingLesson(): void {
    const now = Date.now();
    const newUpcomingLesson = this.selectMostRelevantLesson(now);
    
    // Only update if it actually changed (to avoid unnecessary change detection)
    if (newUpcomingLesson?._id !== this.upcomingLesson?._id) {
      this.upcomingLesson = newUpcomingLesson;
      
    }
  }

  /**
   * Load pending feedback requests for tutors
   * No popup — the Quick Actions card handles the UI inline.
   */
  private _feedbackLoadInProgress = false;
  async loadPendingFeedback() {
    if (!this.isTutor()) return;
    if (this._feedbackLoadInProgress) return;
    this._feedbackLoadInProgress = true;
    
    
    
    if (this.tutorFeedbackService.isCacheLoaded) {
      const cached = this.tutorFeedbackService.getCachedPendingFeedback();
      this.pendingFeedback = (cached.pendingFeedback || []).map((fb: any) => ({
        ...fb,
        formattedDate: fb.lesson?.startTime ? this.formatFeedbackDate(fb.lesson.startTime) : '',
        formattedTime: fb.lesson?.startTime ? this.formatFeedbackTime(fb.lesson.startTime) : ''
      }));
      this.pendingFeedbackCount = cached.count || 0;
      this.updateFeedbackGraceCountdown();
      
    }
    
    // 2. Always fetch fresh data from the API (updates the cache for other pages too)
    try {
      const response = await firstValueFrom(this.tutorFeedbackService.getPendingFeedback());
      this.pendingFeedback = (response.pendingFeedback || []).map((fb: any) => ({
        ...fb,
        formattedDate: fb.lesson?.startTime ? this.formatFeedbackDate(fb.lesson.startTime) : '',
        formattedTime: fb.lesson?.startTime ? this.formatFeedbackTime(fb.lesson.startTime) : ''
      }));
      this.pendingFeedbackCount = response.count || 0;
      this.updateFeedbackGraceCountdown();
      
    } catch (error) {
      console.error('❌ [TAB1] Error loading pending feedback:', error);
    } finally {
      this._feedbackLoadInProgress = false;
    }
    this.syncTutorMobileWelcomeAboveUpNext();
  }

  /**
   * Navigate to feedback form (post-lesson-tutor page)
   */
  async openFeedbackForm(lessonId: string, feedbackId: string) {
    this.router.navigate(['/post-lesson-tutor', lessonId], {
      queryParams: { feedbackId }
    });
  }

  /**
   * Open pending feedback modal (Airbnb style, matches Upcoming Lessons modal)
   */
  async openPendingFeedback(): Promise<void> {
    if (this.pendingFeedback.length === 0) return;
    this.isFeedbackModalOpen = true;
  }

  closeFeedbackModal(): void {
    this.isFeedbackModalOpen = false;
  }

  formatFeedbackDate(dateStr: any): string {
    if (!dateStr) return '';
    return formatDateInTz(dateStr, this.userTz, { weekday: 'short', month: 'short', day: 'numeric', year: undefined });
  }

  formatFeedbackTime(dateStr: any): string {
    if (!dateStr) return '';
    return formatTimeInTz(dateStr, this.userTz);
  }

  // ---- LEGACY ACTION SHEET (kept for reference, replaced by modal) ----
  async _openPendingFeedbackActionSheet(): Promise<void> {
    if (this.pendingFeedback.length === 0) return;
    
    const buttons = this.pendingFeedback.map((fb: any) => {
      const date = fb.lesson?.startTime
        ? `${formatDateInTz(fb.lesson.startTime, this.userTz, { month: 'short', day: 'numeric', year: undefined })} ${formatTimeInTz(fb.lesson.startTime, this.userTz)}`
        : '';
      return {
        text: `${fb.studentName || 'Student'} — ${date}`,
        icon: 'clipboard-outline',
        handler: () => {
          this.openFeedbackForm(fb.lessonId, fb._id);
        }
      };
    });
    
    buttons.push({ text: 'Cancel', icon: 'close-outline', handler: () => {} });
    
    const actionSheet = await this.actionSheetController.create({
      header: `${this.pendingFeedbackCount} lessons need feedback`,
      buttons: buttons as any
    });
    await actionSheet.present();
  }
  
  /**
   * TEST: Open feedback form with a mock ID for testing UI
   */
  async openTestFeedbackForm() {
    // Use 'test' as the lesson ID to trigger test mode in the feedback form
    this.router.navigate(['/post-lesson-tutor', 'test']);
  }

  /**
   * TEST: Open tutor note modal with mock data for testing UI
   */
  async openTestTutorNoteModal() {
    // Use a REAL lesson ID (69527f6d6d02ed29ab721d32 from logs)
    this.tutorNoteModalData = {
      lessonId: '69527f6d6d02ed29ab721d32',
      studentName: 'Phillip D.',
      lessonSubject: 'Spanish Lesson',
      duration: 25
    };
    this.isTutorNoteModalOpen = true;
  }

  /**
   * Handle tutor note modal dismissal
   */
  onTutorNoteModalDismiss() {
    this.isTutorNoteModalOpen = false;
    this.tutorNoteModalData = null;
  }

  /**
   * Close tutor note modal
   */
  closeTutorNoteModal() {
    this.isTutorNoteModalOpen = false;
    this.tutorNoteModalData = null;
  }

  /**
   * Handle tutor note saved event
   */
  async onTutorNoteSaved(noteData: { quickImpression: string; text: string; homework: string }) {
    if (!this.tutorNoteModalData) return;
    
    try {
      await firstValueFrom(
        this.lessonService.saveTutorNote(this.tutorNoteModalData.lessonId, noteData)
      );
      
      const successToast = await this.toastController.create({
        message: '✅ Note saved!',
        duration: 2000,
        color: 'success',
        position: 'bottom'
      });
      await successToast.present();
      
      // Close the modal
      this.closeTutorNoteModal();
    } catch (error) {
      console.error('❌ Error saving tutor note:', error);
      const errorToast = await this.toastController.create({
        message: '❌ Failed to save note. Please try again.',
        duration: 3000,
        color: 'danger',
        position: 'bottom'
      });
      await errorToast.present();
    }
  }

  // trackBy functions for *ngFor performance
  trackById = (_: number, item: any) => item?._id || item?.id;
  trackByIndex = (i: number) => i;
}

