import { Component, OnInit, ViewChild, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../services/auth.service';
import { UserService, User } from '../services/user.service';
import { ThemeService } from '../services/theme.service';
import { LanguageService, LanguageOption, SupportedLanguage } from '../services/language.service';
import { WebSocketService } from '../services/websocket.service';
import { FileUploadService } from '../services/file-upload.service';
import { Observable, firstValueFrom, Subject } from 'rxjs';
import { filter, take, takeUntil } from 'rxjs/operators';
import { LoadingController, AlertController, ModalController, ToastController, Platform, ViewWillEnter } from '@ionic/angular';
import { VideoUploadComponent } from '../components/video-upload/video-upload.component';
import { TimezoneSelectorComponent } from '../components/timezone-selector/timezone-selector.component';
import { InterfaceLanguageSelectModalComponent } from '../components/interface-language-select-modal/interface-language-select-modal.component';
import { PayoutSelectionModalComponent } from '../components/payout-selection-modal/payout-selection-modal.component';
import { ImageCropperComponent } from '../components/image-cropper/image-cropper.component';
import { detectUserTimezone } from '../shared/timezone.constants';
import { getTimezoneLabel, formatTimeInTz, formatDateInTz } from '../shared/timezone.utils';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '../../environments/environment';
import {
  buildStripeConnectPayloadForProfilePayout,
  parseStripeConnectReturnParams,
  stripStripeConnectQueryParams,
  StripeConnectReturnState,
} from '../utils/stripe-connect.util';
import { isStripeSupportedCountry } from '../data/stripe-supported-countries';
import { TutorFeedbackService } from '../services/tutor-feedback.service';
import { LearningPlanService } from '../services/learning-plan.service';
import { SetGoalComponent } from '../modals/set-goal/set-goal.component';
import {
  TutorGrowthService,
  ProfileChecklistItem,
  buildTutorProfileChecklist,
  mapProfileChecklistIdToApprovalWizardStepId
} from '../services/tutor-growth.service';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false,
})
export class ProfilePage implements OnInit, ViewWillEnter {
  @ViewChild(VideoUploadComponent) videoUploadComponent?: VideoUploadComponent;
  
  user$: Observable<any>;
  isAuthenticated$: Observable<boolean>;
  currentUser: User | null = null;
  viewingUser: any = null; // User being viewed (if different from current user)
  isViewingOtherUser = false;
  tutorIntroductionVideo = '';
  tutorVideoThumbnail = '';
  tutorVideoType: 'upload' | 'youtube' | 'vimeo' = 'upload';
  isVideoApproved = false; // Track if tutor's video is approved
  hasPendingVideo = false; // Track if tutor has a pending video under review
  isDarkMode$: Observable<boolean>;
  remindersEnabled: boolean = true;
  showWalletBalance: boolean = true;
  aiAnalysisEnabled: boolean = true;
  timeFormat: '12h' | '24h' = '12h';
  
  // Video player modal state
  isVideoPlayerModalOpen = false;
  videoPlayerData: {
    videoUrl: string;
    safeVideoUrl?: SafeResourceUrl;
    videoType: 'upload' | 'youtube' | 'vimeo';
  } | null = null;
  
  // Language support
  availableLanguages: LanguageOption[] = [];
  selectedInterfaceLanguage: SupportedLanguage = 'en';
  /** Shown on the settings row (native name only; flag via app-flag-icon). */
  interfaceLanguageLabel = '';
  selectedInterfaceLanguageEnglishName = 'English';

  // Stripe Connect (for tutors)
  stripeConnectOnboarded = false;
  isLoadingStripeConnect = false;
  private destroy$ = new Subject<void>();

  // Payout options (for tutors)
  payoutOptions: any = null;
  hasPayoutSetup: boolean | undefined = undefined; // undefined = loading, false = not setup, true = setup
  payoutProvider: string = 'none'; // Current payout provider: 'stripe', 'paypal', 'manual', 'none'
  profileDeterminedPayoutMethod: 'stripe' | 'paypal' | 'manual' | null = null;
  isCountryDrivenProfilePayoutRouting = false;
  profilePayoutMethodReasonKey = '';
  profilePayoutMethodReasonParams: Record<string, string> = {};
  readonly stripePrivacyPolicyUrl = 'https://stripe.com/privacy';
  readonly paypalPrivacyPolicyUrl = 'https://www.paypal.com/us/legalhub/privacy-full';
  readonly supportEmail = 'support@languageapp.com';
  profilePaypalEmail = '';
  profilePaypalEmailError = '';
  profilePaypalConnectDisabled = true;

  // Visibility status (for tutors)
  isTutorVisible: boolean = true;
  visibilityLoaded: boolean = false;
  feedbackCountLoaded: boolean = false;
  visibilityMissingItems: string[] = [];
  visibilityMissingText: string = '';
  pendingFeedbackCount: number = 0;
  pendingFeedbackItems: any[] = [];

  // Shared tutor profile checklist (mirrors home / tutor-calendar). Drives the
  // "outstanding items" banner so all three pages stay in sync from a single
  // source of truth (tutorApprovalStatus$ → buildTutorProfileChecklist).
  profileChecklist: ProfileChecklistItem[] = [];
  profileChecklistDoneCount = 0;
  profileChecklistTotal = 0;
  /** Latest snapshot from tutorApprovalStatus$ — same pattern as home / tutor-calendar. */
  private tutorApprovalStatusSnapshot: any = null;
  hasProfileCriticalInsights = false;

  /** Split layout (mirrors earnings): sidebar + main on wide; segment on narrow. */
  profileActiveSection: 'personal' | 'payments' | 'stats' | 'teaching' | 'learning' | 'settings' =
    'personal';
  profilePanelTitleKey = 'PROFILE_SCREEN.PANEL_PERSONAL';
  profilePanelSubKey: string | null = 'PROFILE_SCREEN.PANEL_PERSONAL_SUB';
  profileNavItems: Array<{ id: string; labelKey: string; icon: string }> = [];

  // Earnings (for tutors)
  totalEarnings = 0;
  pendingEarnings = 0;
  recentPayments: any[] = [];
  loadingEarnings = false;

  // Learning Goal display (students only, precomputed for template)
  learningGoalTypeKey: string = '';
  learningGoalCustomDesc: string = '';
  learningGoalIcon: string = 'rocket-outline';
  learningGoalLevelKey: string = '';
  learningGoalTimelineKey: string = '';
  learningGoalTimelineDate: string = '';
  goalCooldownActive: boolean = false;
  goalCooldownDateDisplay: string = '';

  // Plan lifecycle controls (pause / resume / skip). Populated alongside the
  // learning goal load. Drive the "Pause my plan" / "Resume my plan" / "Learn
  // at my own pace" actions on the goal card.
  planStatus: 'draft' | 'active' | 'completed' | 'paused' | 'mastery_mode' | 'unframed' | null = null;
  planLanguage: string = '';
  planIsPremium: boolean = false;
  isUnframed: boolean = false;
  isPaused: boolean = false;
  hasStructuredPlan: boolean = false;

  // CEFR estimate (Batch 12). Populated from the same /learning-plan/:lang
  // endpoint we already call for the goal display.
  cefrRevealed: import('../services/learning-plan.service').CefrReveal | null = null;
  cefrScale: Array<{ level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'; active: boolean }> = [];
  cefrSourcesLabel: string = '';
  cefrAgreementShortLabel: string = '';
  // Pre-computed evolution timeline for the template (no function calls).
  cefrEvolution: Array<{
    level: string;
    dateLabel: string;
    deltaSign: 'up' | 'down' | 'flat';
  }> = [];

  // Tutor approval wizard modal state (mirrors tab1 pattern)
  isTutorApprovalWizardModalOpen = false;
  tutorApprovalWizardModalInitialStepId: string | null = null;
  tutorApprovalWizardBackdropVisible = false;
  tutorApprovalWizardModalReady = false;
  isMobileViewport = false;

  // Cached display properties (avoids function calls in template)
  displayUser: any = null;
  isTutorUser = false;
  isStudentUser = false;
  fullName = '';
  discoverableName = '';
  /** i18n key: PROFILE_SCREEN.DISCOVERABLE_TO_STUDENTS_PREFIX or _TUTORS_PREFIX */
  discoverablePrefixKey = 'PROFILE_SCREEN.DISCOVERABLE_TO_STUDENTS_PREFIX';
  displayUserInitials = '';
  hasCustomProfilePicture = false;
  timezoneLabel = 'Auto-detected';
  payoutSetupTitleKey = 'PROFILE_SCREEN.PAYOUT_CONNECT_BANK_TITLE';
  payoutSetupDescriptionKey = 'PROFILE_SCREEN.PAYOUT_SETUP_DESCRIPTION';
  /** i18n key for provider label in "Payouts enabled (…)" */
  payoutProviderLabelKey = '';
  formattedFeedbackItems: { item: any; date: string; time: string }[] = [];

  constructor(
    private authService: AuthService,
    private userService: UserService,
    private themeService: ThemeService,
    private languageService: LanguageService,
    private fileUploadService: FileUploadService,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private toastController: ToastController,
    private route: ActivatedRoute,
    private router: Router,
    private modalController: ModalController,
    private sanitizer: DomSanitizer,
    private http: HttpClient,
    private platform: Platform,
    private websocketService: WebSocketService,
    private tutorFeedbackService: TutorFeedbackService,
    private learningPlanService: LearningPlanService,
    private tutorGrowthService: TutorGrowthService,
    private cdr: ChangeDetectorRef
  ) {
    this.user$ = this.authService.user$;
    this.isAuthenticated$ = this.authService.isAuthenticated$;
    this.isDarkMode$ = this.themeService.darkMode$;
    // TEMP: RTL languages (ar, he, fa) hidden from interface language picker
    // this.availableLanguages = this.languageService.supportedLanguages;
    this.availableLanguages = this.languageService.supportedLanguages.filter(
      (l) => l.code !== 'ar' && l.code !== 'he' && l.code !== 'fa'
    );
  }

  ngOnInit() {
    // For tutors, immediately get cached payout status (prevents flashing)
    if (this.isTutor()) {
      const cachedStatus = this.userService.getPayoutStatus();
      // Only use cached data if it's actually been loaded (has options)
      if (cachedStatus.options) {
        this.payoutProvider = cachedStatus.provider;
        this.hasPayoutSetup = cachedStatus.hasPayoutSetup;
        this.payoutOptions = cachedStatus.options;
        console.log('💰 [PROFILE] Using cached payout status from ngOnInit:', {
          provider: this.payoutProvider,
          hasPayoutSetup: this.hasPayoutSetup
        });
      }
    }
    
    // Subscribe to approval status from UserService
    this.userService.tutorApprovalStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        this.tutorApprovalStatusSnapshot = status;
        if (status) {
          // Note: stripeComplete now includes PayPal and Manual methods too (confusingly named)
          // But we should NOT overwrite hasPayoutSetup here - let checkPayoutStatus() handle it
          // to avoid confusion between payout providers
          this.stripeConnectOnboarded = status.stripeComplete;
          console.log(`💰 [PROFILE] Payment status from service: ${this.stripeConnectOnboarded}`);
          this.applyProfileChecklistFromStatus(status);
        }
      });
    
    // Subscribe to payout status updates from UserService
    this.userService.payoutStatus$.subscribe(payoutStatus => {
      if (this.isTutor()) {
        this.payoutProvider = payoutStatus.provider;
        this.hasPayoutSetup = payoutStatus.hasPayoutSetup;
        this.payoutOptions = payoutStatus.options;
        
        if (this.payoutProvider === 'stripe') {
          this.stripeConnectOnboarded = this.hasPayoutSetup;
        }
        
        console.log('💰 [PROFILE] Payout status updated from service:', payoutStatus);
        this.syncProfilePayoutMethod();

        this.syncDisplayUserProperties();
        this.updateVisibilityStatus();
      }
    });
    
    // Note: loadPendingFeedbackCount is called from loadCurrentUserProfile()
    // after currentUser is set, since isTutor() needs currentUser to work.
    
    // Subscribe to video approval WebSocket notifications
    this.websocketService.tutorVideoApproved$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(async (data: any) => {
      console.log('🎉 [PROFILE] Video approved notification received:', data);
      
      // Reload user data to get updated video
      await this.userService.getCurrentUser(true).pipe(take(1)).toPromise();
      
      // Clear pending video flag
      this.hasPendingVideo = false;
      
      // Show success toast
      const toast = await this.toastController.create({
        message: '✅ Your new video has been approved!',
        duration: 4000,
        color: 'success',
        position: 'top'
      });
      await toast.present();
    });
    
    // Single queryParams subscription handles routing, scrollTo, and Stripe return
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const userId = params['userId'];

      if (!userId) {
        this.applyProfileSectionQueryParam(params['section']);
      }

      // ScrollTo support
      if (params['scrollTo']) {
        setTimeout(() => {
          const el = document.getElementById(params['scrollTo']);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight-pulse');
            setTimeout(() => el.classList.remove('highlight-pulse'), 2000);
          }
        }, 600);
      }

      // Check if returning from Stripe Connect
      const stripeReturn = parseStripeConnectReturnParams(params);
      if (stripeReturn) {
        void this.handleStripeConnectReturn(stripeReturn);
      }

      if (userId) {
        this.isViewingOtherUser = true;
        this.loadOtherUserProfile(userId);
      } else {
        this.isViewingOtherUser = false;
        this.loadCurrentUserProfile();
      }
    });
  }

  loadCurrentUserProfile() {
    // Get current user data from database
    this.userService.getCurrentUser().subscribe(user => {
      console.log('👤 ProfilePage: Loaded currentUser:', {
        id: user?.id,
        name: user?.name,
        email: user?.email,
        picture: user?.picture,
        hasPicture: !!user?.picture
      });
      this.currentUser = user;
      this.syncDisplayUserProperties();
      
      // Set current interface language
      this.selectedInterfaceLanguage = user?.interfaceLanguage || this.languageService.getCurrentLanguage();
      this.refreshInterfaceLanguageLabel();

      // Load tutor-specific data in parallel
      if (this.isTutorUser) {
        Promise.all([
          this.checkPayoutStatus(),
          this.loadEarnings()
        ]);
        this.loadPendingFeedbackCount();
      } else {
        // Not a tutor — mark feedback as loaded so visibility badge doesn't wait
        this.feedbackCountLoaded = true;
        this.computeLearningGoalDisplay(user);
      }
      
      this.remindersEnabled = user?.profile?.remindersEnabled !== false;
      this.showWalletBalance = user?.profile?.showWalletBalance ?? true;
      this.aiAnalysisEnabled = user?.profile?.aiAnalysisEnabled !== false;
      this.timeFormat = user?.profile?.calendarTimeFormat || '12h';
      
      // If user doesn't have a picture but Auth0 user does, reload after a short delay
      // This ensures the picture sync from Auth0 has completed
      if (!user?.picture && user?.email) {
        console.log('🔄 ProfilePage: User has no picture, reloading after sync delay...');
        setTimeout(() => {
          this.userService.getCurrentUser().subscribe((updatedUser: any) => {
            console.log('👤 ProfilePage: Reloaded user after sync:', {
              picture: updatedUser?.picture,
              hasPicture: !!updatedUser?.picture
            });
            this.currentUser = updatedUser;
            this.syncDisplayUserProperties();
          });
        }, 1000);
      }
      
      if (this.isTutorUser) {
        console.log('📹 Full onboardingData from DB:', user.onboardingData);
        
        // Check if video is approved
        this.isVideoApproved = (user as any).tutorOnboarding?.videoApproved === true;
        console.log('✅ Video approval status:', this.isVideoApproved);
        
        // Check if there's a pending video under review (video exists but not approved)
        const onboardingData = user.onboardingData as any;
        const hasPendingVideoFile = !!(onboardingData?.pendingVideo);
        const hasIntroductionVideo = !!(onboardingData?.introductionVideo);
        this.hasPendingVideo = !this.isVideoApproved && (hasPendingVideoFile || hasIntroductionVideo);
        console.log('⏳ Has pending video:', this.hasPendingVideo, {
          isVideoApproved: this.isVideoApproved,
          hasPendingVideoFile,
          hasIntroductionVideo
        });
        
        // Prioritize pending video if it exists (for display to tutor themselves)
        const hasPendingVideo = hasPendingVideoFile;
        const hasApprovedVideo = hasIntroductionVideo;
        
        if (hasPendingVideo) {
          // Show pending video if it exists
          this.tutorIntroductionVideo = onboardingData.pendingVideo;
          this.tutorVideoThumbnail = onboardingData.pendingVideoThumbnail || '';
          this.tutorVideoType = onboardingData.pendingVideoType || 'upload';
          console.log('📹 Loaded PENDING video data from DB:', {
            video: this.tutorIntroductionVideo,
            thumbnail: this.tutorVideoThumbnail,
            type: this.tutorVideoType,
            hasVideo: !!this.tutorIntroductionVideo,
            hasThumbnail: !!this.tutorVideoThumbnail
          });
        } else if (hasApprovedVideo) {
          // Show approved video if no pending video
          this.tutorIntroductionVideo = onboardingData.introductionVideo;
          this.tutorVideoThumbnail = onboardingData.videoThumbnail || '';
          this.tutorVideoType = onboardingData.videoType || 'upload';
          console.log('📹 Loaded APPROVED video data from DB:', {
            video: this.tutorIntroductionVideo,
            thumbnail: this.tutorVideoThumbnail,
            type: this.tutorVideoType,
            hasVideo: !!this.tutorIntroductionVideo,
            hasThumbnail: !!this.tutorVideoThumbnail
          });
        } else {
          console.log('📹 No introduction video in onboardingData');
        }
        
        // Update visibility status after loading user data
        this.updateVisibilityStatus();
      }
    });
    
    // Subscribe to currentUser$ to get updates when picture changes
    this.userService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe((updatedUser: any) => {
        if (!updatedUser || this.isViewingOtherUser) {
          return;
        }
        if (this.currentUser && updatedUser.id !== this.currentUser.id) {
          return;
        }
        console.log('🔄 ProfilePage: Received currentUser$ update:', {
          picture: updatedUser?.picture,
          hasPicture: !!updatedUser?.picture
        });
        this.currentUser = updatedUser;
        this.syncDisplayUserProperties();
      });

    // Ensure the toggle reflects the current theme state
    console.log('🎨 Profile page: Current dark mode state:', this.themeService.isDarkMode());
  }

  // Ionic lifecycle hook - called when leaving the page
  ionViewWillLeave() {
    console.log('📹 ProfilePage ionViewWillLeave - stopping video');
    
    // Stop video playback when leaving the page
    if (this.videoUploadComponent) {
      this.videoUploadComponent.stopVideo();
    }
  }

  loadOtherUserProfile(userId: string) {
    this.userService.getUserPublic(userId).subscribe({
      next: (response) => {
        if (response.tutor) {
          this.viewingUser = {
            ...response.tutor,
            userType: 'tutor'
          };
        } else if (response.student) {
          this.viewingUser = {
            ...response.student,
            userType: 'student'
          };
        }
        this.syncDisplayUserProperties();
      },
      error: (error) => {
        console.error('Error loading user profile:', error);
        // Navigate back or show error
        this.router.navigate(['/tabs/profile']);
      }
    });
  }

  async logout() {
    await this.authService.logout();
  }

  getUserInitials(user: User | null | any): string {
    if (!user || !user.name) return '?';
    return user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
  }

  // Update tutor visibility status
  updateVisibilityStatus(): void {
    if (!this.isTutorUser) {
      return;
    }
    
    const user = this.displayUser;
    if (!user) {
      this.isTutorVisible = false;
      this.visibilityMissingItems = ['Profile not loaded'];
      return;
    }
    
    const missingItems: string[] = [];
    
    // Check 1: Onboarding completed
    const onboardingCompleted = user.onboardingCompleted === true;
    if (!onboardingCompleted) {
      missingItems.push('Complete onboarding');
    }
    
    // Check 2: Custom profile photo uploaded (not just Google/Auth0 default)
    const hasCustomPhoto = !!(user.picture && (
      user.picture.includes('storage.googleapis.com') ||
      (user.auth0Picture && user.picture !== user.auth0Picture)
    ));
    if (!hasCustomPhoto) {
      missingItems.push('Upload profile photo');
    }
    
    // Check 3: Tutor fully approved (video + credentials all approved by admin)
    const tutorApproved = user.tutorApproved === true;
    if (!tutorApproved) {
      const creds = user.tutorCredentials;
      const govIdOk = creds?.governmentId?.status === 'approved';
      const certsOk = !!(creds?.teachingCertifications?.some((c: any) => c.status === 'approved'));
      const videoOk = user.tutorOnboarding?.videoApproved === true;
      
      if (!videoOk) {
        const hasAnyVideo = !!(user.onboardingData?.introductionVideo || user.onboardingData?.pendingVideo);
        missingItems.push(hasAnyVideo ? 'Video pending approval' : 'Upload introduction video');
      }
      if (!govIdOk) missingItems.push('Government ID verification');
      if (!certsOk) missingItems.push('Teaching certification verification');
    }
    
    // Check 4: Has payout setup (Stripe, PayPal, or Manual)
    const hasPayoutMethod = this.hasPayoutSetup === true;
    if (!hasPayoutMethod) {
      missingItems.push('Payout setup');
    }
    
    // Check 5: No outstanding feedback
    const hasPendingFeedback = this.pendingFeedbackCount > 0;
    if (hasPendingFeedback) {
      missingItems.push(`Complete ${this.pendingFeedbackCount} outstanding feedback`);
    }
    
    // All conditions must be met
    this.isTutorVisible = onboardingCompleted && hasCustomPhoto && tutorApproved && hasPayoutMethod && !hasPendingFeedback;
    this.visibilityMissingItems = missingItems;
    this.visibilityMissingText = missingItems.join(' · ');
    
    // Only show the badge once the feedback count has loaded (prevents flash)
    if (this.feedbackCountLoaded) {
      this.visibilityLoaded = true;
    }
    
    console.log('👁️ [PROFILE] Visibility status updated:', {
      isTutorVisible: this.isTutorVisible,
      onboardingCompleted,
      tutorApproved,
      hasPayoutMethod,
      hasPendingFeedback,
      feedbackCountLoaded: this.feedbackCountLoaded,
      missingItems
    });
  }

  // Load pending feedback count for visibility check.
  // Uses the service cache for instant rendering, then refreshes in the background.
  private loadPendingFeedbackCount(): void {
    // 1. If the service already has cached data (e.g. from tab1), apply it immediately
    if (this.tutorFeedbackService.isCacheLoaded) {
      const cached = this.tutorFeedbackService.getCachedPendingFeedback();
      this.pendingFeedbackCount = cached.count || 0;
      this.pendingFeedbackItems = cached.pendingFeedback || [];
      this.feedbackCountLoaded = true;
      console.log(`📝 [PROFILE] Using cached feedback count: ${this.pendingFeedbackCount}`);
      this.updateVisibilityStatus();
    }

    // 2. Subscribe to future updates (including the background refresh below).
    //    Skip emissions until the service has actually loaded from the API at
    //    least once — otherwise the BehaviorSubject's initial { count: 0 }
    //    causes a flash of "Visible to Students" before the real data arrives.
    this.tutorFeedbackService.pendingFeedback$
      .pipe(
        filter(() => this.tutorFeedbackService.isCacheLoaded),
        takeUntil(this.destroy$)
      )
      .subscribe(response => {
        this.pendingFeedbackCount = response.count || 0;
        this.pendingFeedbackItems = response.pendingFeedback || [];
        this.feedbackCountLoaded = true;
        console.log(`📝 [PROFILE] Feedback count updated: ${this.pendingFeedbackCount}`);
        this.syncDisplayUserProperties();
        this.updateVisibilityStatus();

        // Auto-reopen the feedback modal after submitting one item
        if (this.tutorFeedbackService.consumeReopenFlag() && this.pendingFeedbackCount > 0) {
          setTimeout(() => { this.isFeedbackModalOpen = true; }, 400);
        }
      });

    // 3. Always trigger a background refresh to pick up any new changes
    this.tutorFeedbackService.refreshPendingFeedback();
  }

  /**
   * Rebuild the shared tutor profile checklist from the latest approval status
   * snapshot. Mirrors the home / tutor-calendar logic so the same banner data
   * powers all three pages.
   */
  private applyProfileChecklistFromStatus(status: any): void {
    if (!status || !this.isTutorUser || this.isViewingOtherUser) {
      return;
    }

    const checklist = buildTutorProfileChecklist({
      hasCustomPhoto: status.photoComplete === true,
      hasVideo: status.videoComplete === true,
      videoApproved: status.videoApproved === true,
      identityRequired: status.identityRequired === true,
      governmentIdUploaded: status.governmentIdUploaded === true,
      identitySatisfied: status.identitySatisfied === true,
      certificationsUploaded: status.certificationsUploaded === true,
      certificationsApproved: status.certificationsApproved === true,
      hasPayoutSetup: status.stripeComplete === true,
      tosComplete: status.tosComplete === true,
    });

    this.profileChecklist = checklist;
    this.profileChecklistDoneCount = checklist.filter(
      (i) => i.done && !i.pendingReview
    ).length;
    this.profileChecklistTotal = checklist.length;
    this.hasProfileCriticalInsights = this.profileChecklistDoneCount < checklist.length;
    this.tutorGrowthService.profileChecklist = checklist;
    this.cdr.markForCheck();
  }

  ionViewWillEnter() {
    if (!this.isViewingOtherUser && this.tutorApprovalStatusSnapshot) {
      this.applyProfileChecklistFromStatus(this.tutorApprovalStatusSnapshot);
    }
  }

  /** Open the tutor approval flow at the step the user clicked. */
  openProfileChecklistItem(item: ProfileChecklistItem): void {
    if (!item) return;
    this.isMobileViewport = this.platform.is('mobile') || this.platform.is('mobileweb');
    this.tutorApprovalWizardModalInitialStepId = mapProfileChecklistIdToApprovalWizardStepId(item.id);
    this.isTutorApprovalWizardModalOpen = true;
    this.tutorApprovalWizardBackdropVisible = false;
    this.tutorApprovalWizardModalReady = false;
    this.cdr.markForCheck();
    if (!this.isMobileViewport) {
      document.body.classList.add('cm-desktop-modal-open');
      requestAnimationFrame(() => {
        this.tutorApprovalWizardBackdropVisible = true;
        this.cdr.markForCheck();
      });
      setTimeout(() => {
        this.tutorApprovalWizardModalReady = true;
        this.cdr.markForCheck();
      }, 350);
    }
  }

  onTutorApprovalWizardBackdropClick(ev: MouseEvent): void {
    if ((ev.target as HTMLElement).classList.contains('cm-modal-backdrop')) {
      this.closeTutorApprovalWizardModal(true);
    }
  }

  onTutorApprovalWizardDismissedFromChild(): void {
    this.closeTutorApprovalWizardModal(true);
  }

  private closeTutorApprovalWizardModal(refreshUser: boolean): void {
    this.isTutorApprovalWizardModalOpen = false;
    this.tutorApprovalWizardModalInitialStepId = null;
    this.tutorApprovalWizardBackdropVisible = false;
    this.tutorApprovalWizardModalReady = false;
    document.body.classList.remove('cm-desktop-modal-open');
    this.cdr.markForCheck();
    if (refreshUser) {
      void firstValueFrom(this.userService.getCurrentUser(true));
    }
  }

  // Feedback modal state
  isFeedbackModalOpen = false;

  openFeedbackModal(): void {
    if (this.pendingFeedbackItems.length === 0) return;
    this.isFeedbackModalOpen = true;
  }

  closeFeedbackModal(): void {
    this.isFeedbackModalOpen = false;
  }

  navigateToFeedback(lessonId: string, feedbackId: string): void {
    this.closeFeedbackModal();
    this.router.navigate(['/post-lesson-tutor', lessonId], {
      queryParams: { feedbackId }
    });
  }

  formatFeedbackDate(dateStr: any): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return formatDateInTz(d, this.userTz, { weekday: 'short', month: 'short', day: 'numeric', year: undefined });
  }

  formatFeedbackTime(dateStr: any): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return formatTimeInTz(d, this.userTz);
  }

  // Get full name for display
  getFullName(): string {
    const user = this.getDisplayUser();
    if (!user) return 'Unknown';
    
    // If user has firstName and lastName, combine them
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    
    // If user has a name field, use it
    if (user.name) {
      return user.name;
    }
    
    // Fallback to email
    return user.email || 'Unknown';
  }

  // Format discoverable name as "Firstname L." (first name + last initial)
  getDiscoverableName(): string {
    const user = this.getDisplayUser();
    if (!user) return 'Unknown';
    
    // If user has firstName and lastName
    if (user.firstName && user.lastName) {
      const firstName = this.capitalize(user.firstName);
      const lastInitial = user.lastName.charAt(0).toUpperCase();
      return `${firstName} ${lastInitial}.`;
    }
    
    // If user has a name field, parse it
    if (user.name) {
      const nameParts = user.name.trim().split(' ').filter(Boolean);
      if (nameParts.length > 1) {
        const firstName = this.capitalize(nameParts[0]);
        const lastInitial = nameParts[nameParts.length - 1].charAt(0).toUpperCase();
        return `${firstName} ${lastInitial}.`;
      } else if (nameParts.length === 1) {
        return this.capitalize(nameParts[0]);
      }
    }
    
    // Fallback to email if available
    if (user.email) {
      const emailParts = user.email.split('@')[0].split(/[.\s_]+/).filter(Boolean);
      if (emailParts.length > 1) {
        const firstName = this.capitalize(emailParts[0]);
        const lastInitial = emailParts[emailParts.length - 1].charAt(0).toUpperCase();
        return `${firstName} ${lastInitial}.`;
      } else if (emailParts.length === 1) {
        return this.capitalize(emailParts[0]);
      }
    }
    
    return 'Unknown';
  }

  private capitalize(value: string): string {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }

  // User type methods
  isTutor(): boolean {
    const user = this.isViewingOtherUser ? this.viewingUser : this.currentUser;
    return user?.userType === 'tutor';
  }

  isStudent(): boolean {
    const user = this.isViewingOtherUser ? this.viewingUser : this.currentUser;
    return user?.userType === 'student';
  }

  private computeLearningGoalDisplay(user: any) {
    const goal = user?.onboardingData?.learningGoal;
    if (!goal?.type) {
      this.learningGoalTypeKey = '';
      this.learningGoalCustomDesc = '';
      return;
    }

    const GOAL_ICONS: Record<string, string> = {
      conversational: 'chatbubbles-outline',
      exam_prep: 'school-outline',
      professional: 'briefcase-outline',
      travel: 'airplane-outline',
      relocation: 'home-outline',
      other: 'sparkles-outline'
    };

    if (goal.type === 'other') {
      this.learningGoalTypeKey = '';
      this.learningGoalCustomDesc = goal.description || 'LEARNING_PLAN.GOAL_LABEL_OTHER';
    } else {
      this.learningGoalTypeKey = 'LEARNING_PLAN.GOAL_LABEL_' + goal.type.toUpperCase();
      this.learningGoalCustomDesc = '';
    }
    this.learningGoalIcon = GOAL_ICONS[goal.type] || 'rocket-outline';

    const LEVEL_KEY_MAP: Record<string, string> = {
      complete_beginner: 'ONBOARDING.STUDENT.LEVEL_OPTION_COMPLETE_BEGINNER',
      some_basics: 'ONBOARDING.STUDENT.LEVEL_OPTION_SOME_BASICS',
      simple_conversations: 'ONBOARDING.STUDENT.LEVEL_OPTION_SIMPLE_CONVERSATIONS',
      intermediate: 'ONBOARDING.STUDENT.LEVEL_OPTION_INTERMEDIATE',
      advanced: 'ONBOARDING.STUDENT.LEVEL_OPTION_ADVANCED'
    };
    this.learningGoalLevelKey = goal.selfAssessedLevel
      ? (LEVEL_KEY_MAP[goal.selfAssessedLevel] || '') : '';

    if (goal.timeline === 'specific_date' && goal.targetDate) {
      this.learningGoalTimelineKey = 'ONBOARDING.STUDENT.PREVIEW_TIMELINE_BY_DATE';
      this.learningGoalTimelineDate = new Date(goal.targetDate).toLocaleDateString();
    } else if (goal.timeline === 'few_months') {
      this.learningGoalTimelineKey = 'ONBOARDING.STUDENT.TIMELINE_OPTION_FEW_MONTHS';
      this.learningGoalTimelineDate = '';
    } else {
      this.learningGoalTimelineKey = 'ONBOARDING.STUDENT.TIMELINE_OPTION_NO_RUSH';
      this.learningGoalTimelineDate = '';
    }

    // Check cooldown from any existing plan
    if (user?.onboardingData?.languages?.length) {
      this.planLanguage = user.onboardingData.languages[0];
      this.learningPlanService.getPlan(this.planLanguage)
        .pipe(take(1)).subscribe({
          next: (res: any) => {
            if (res.plan?.lastGoalChangedAt) {
              const lastChanged = new Date(res.plan.lastGoalChangedAt);
              const daysSince = (Date.now() - lastChanged.getTime()) / (1000 * 60 * 60 * 24);
              if (daysSince < 7) {
                this.goalCooldownActive = true;
                const nextDate = new Date(lastChanged.getTime() + 7 * 24 * 60 * 60 * 1000);
                this.goalCooldownDateDisplay = nextDate.toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric'
                });
              }
            }
            this.applyPlanLifecycleFromPlan(res?.plan, res?.entitlements);
            this.applyCefrFromPlan(res?.plan);
          },
          error: () => {}
        });
    }
  }

  /**
   * Update the cached plan lifecycle flags from a fresh /learning-plan/:lang
   * response. Drives the visibility of the Pause / Resume / Skip actions and
   * the tier-aware copy that surrounds them.
   */
  private applyPlanLifecycleFromPlan(plan: any, entitlements: any) {
    this.planStatus = plan?.status || null;
    this.planIsPremium = entitlements?.tier === 'premium';
    this.isUnframed = plan?.status === 'unframed';
    this.isPaused = plan?.status === 'paused';
    this.hasStructuredPlan = !!plan
      && plan.status !== 'unframed'
      && plan.status !== 'paused'
      && (plan.phases?.length || 0) > 0;
  }

  private applyCefrFromPlan(plan: any) {
    if (!plan?.revealedCefrLevel) {
      this.cefrRevealed = null;
      this.cefrScale = [];
      this.cefrEvolution = [];
      return;
    }
    this.cefrRevealed = plan.revealedCefrLevel;
    this.cefrScale = Array.isArray(plan.cefrScale) ? plan.cefrScale : [];
    const ai = plan.revealedCefrLevel.sources?.ai || 0;
    const tu = plan.revealedCefrLevel.sources?.tutor || 0;
    this.cefrSourcesLabel = `${ai} AI · ${tu} ${tu === 1 ? 'tutor' : 'tutors'}`;
    const a = plan.revealedCefrLevel.agreement;
    this.cefrAgreementShortLabel =
      a === 'high'   ? 'High agreement' :
      a === 'medium' ? 'Medium agreement' :
                       'Mixed signals';

    // Build the evolution timeline. Show last 6 reveals so it's a quick
    // scan, not an exhaustive log. Pre-compute everything (no template fns).
    const CEFR_NUM: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
    const history: Array<any> = Array.isArray(plan.revealHistory) ? plan.revealHistory : [];
    const recent = history.slice(-6);
    this.cefrEvolution = recent.map((r, i) => {
      const prev = i > 0 ? recent[i - 1] : null;
      const delta = prev ? (CEFR_NUM[r.level] || 0) - (CEFR_NUM[prev.level] || 0) : 0;
      const dateLabel = r.revealedAt
        ? new Date(r.revealedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        : '';
      const deltaSign: 'up' | 'down' | 'flat' = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
      return { level: r.level, dateLabel, deltaSign };
    });
  }

  /**
   * Confirm + pause an active plan. Tier-aware copy: premium students see
   * the "premium-without-a-plan still works" reassurance; free students see
   * the simpler "we'll save your progress" copy.
   */
  async pauseMyPlan() {
    if (!this.planLanguage || !this.hasStructuredPlan) return;
    const message = this.planIsPremium
      ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#222;">
           Pausing keeps everything as-is. Your phases, chapter history, and
           CEFR estimate are preserved.
         </p>
         <p style="margin:0;font-size:13px;line-height:1.5;color:#555;">
           <strong>Premium still works while paused.</strong> AI lesson
           analysis, your personalized review deck, and tutor briefings keep
           running. Resume any time.
         </p>`
      : `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#222;">
           Pausing keeps everything as-is. Your phases and history are
           preserved.
         </p>
         <p style="margin:0;font-size:13px;line-height:1.5;color:#555;">
           Resume any time — we'll pick up right where you left off.
         </p>`;
    const alert = await this.alertController.create({
      header: 'Pause my plan?',
      message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Pause',
          handler: async () => {
            const loading = await this.loadingController.create({ message: 'Pausing...' });
            await loading.present();
            this.learningPlanService.pausePlan(this.planLanguage).pipe(take(1)).subscribe({
              next: async (res: any) => {
                await loading.dismiss();
                if (res?.success && res.plan) {
                  this.applyPlanLifecycleFromPlan(res.plan, res.entitlements);
                  const toast = await this.toastController.create({
                    message: 'Your plan is paused.',
                    duration: 2500, position: 'top'
                  });
                  await toast.present();
                }
              },
              error: async () => {
                await loading.dismiss();
                const toast = await this.toastController.create({
                  message: 'Could not pause your plan. Please try again.',
                  duration: 2500, color: 'danger', position: 'top'
                });
                await toast.present();
              }
            });
          }
        }
      ]
    });
    await alert.present();
  }

  /** Resume a paused plan in place. */
  async resumeMyPlan() {
    if (!this.planLanguage || !this.isPaused) return;
    const loading = await this.loadingController.create({ message: 'Resuming...' });
    await loading.present();
    this.learningPlanService.resumePlan(this.planLanguage).pipe(take(1)).subscribe({
      next: async (res: any) => {
        await loading.dismiss();
        if (res?.success && res.plan) {
          this.applyPlanLifecycleFromPlan(res.plan, res.entitlements);
          const toast = await this.toastController.create({
            message: 'Your plan is back. Welcome back.',
            duration: 2500, position: 'top'
          });
          await toast.present();
        }
      },
      error: async () => {
        await loading.dismiss();
        const toast = await this.toastController.create({
          message: 'Could not resume your plan. Please try again.',
          duration: 2500, color: 'danger', position: 'top'
        });
        await toast.present();
      }
    });
  }

  /**
   * Switch to "learn at my own pace" mode. Different from pause: the active
   * chapter's phases are cleared (history is preserved). Promote later by
   * setting a new goal — see promoteUnframedPlan on the backend.
   */
  async skipMyPlan() {
    if (!this.planLanguage) return;
    const message = this.planIsPremium
      ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#222;">
           You'll learn without a structured roadmap. Past chapters and
           your CEFR history are kept.
         </p>
         <p style="margin:0;font-size:13px;line-height:1.5;color:#555;">
           <strong>Premium still works without a plan.</strong> AI analysis,
           review deck, and tutor briefings keep running on every lesson.
           Add a goal any time to get a fresh roadmap.
         </p>`
      : `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#222;">
           You'll learn without a structured roadmap. Past lessons and
           CEFR estimate are kept.
         </p>
         <p style="margin:0;font-size:13px;line-height:1.5;color:#555;">
           Add a goal any time to get a roadmap built for you.
         </p>`;
    const alert = await this.alertController.create({
      header: 'Learn at my own pace?',
      message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Switch to free pace',
          handler: async () => {
            const loading = await this.loadingController.create({ message: 'Switching...' });
            await loading.present();
            this.learningPlanService.skipPlan(this.planLanguage).pipe(take(1)).subscribe({
              next: async (res: any) => {
                await loading.dismiss();
                if (res?.success && res.plan) {
                  this.applyPlanLifecycleFromPlan(res.plan, res.entitlements);
                  const toast = await this.toastController.create({
                    message: 'You\'re now learning at your own pace.',
                    duration: 2500, position: 'top'
                  });
                  await toast.present();
                }
              },
              error: async () => {
                await loading.dismiss();
                const toast = await this.toastController.create({
                  message: 'Could not switch modes. Please try again.',
                  duration: 2500, color: 'danger', position: 'top'
                });
                await toast.present();
              }
            });
          }
        }
      ]
    });
    await alert.present();
  }

  async openGoalEditor() {
    // Unframed students don't have an active chapter to reset, so the
    // "Change Learning Goal" alert (which talks about chapter restarts +
    // a 7-day cooldown) is misleading here. For them the action is purely
    // additive — they're moving from "no plan" to "first plan". We can't
    // route them back through `/onboarding` either: the onboarding page's
    // safety check bounces anyone with `onboardingCompleted=true` straight
    // back out. Instead we open a focused goal-picker modal that calls
    // `LearningPlanService.promoteUnframedPlan` directly — the journey
    // widget then refreshes itself via `planUpdates$`.
    if (this.isUnframed) {
      if (!this.planLanguage) {
        // Defensive fallback — shouldn't happen for a real unframed plan,
        // but the onboarding fallback is still better than a silent fail.
        this.router.navigate(['/onboarding']);
        return;
      }
      const modal = await this.modalController.create({
        component: SetGoalComponent,
        cssClass: 'set-goal-modal',
        backdropDismiss: true,
        componentProps: {
          language: this.planLanguage
        }
      });
      await modal.present();
      const result = await modal.onDidDismiss();
      if (result?.data?.saved) {
        // Re-pull the plan so the unframed card hides and the goal card
        // replaces it without a page reload. The modal already
        // broadcasts via planUpdates$, so the home journey widget will
        // refresh independently — this call only refreshes the local
        // profile-page lifecycle flags.
        if (this.planLanguage) {
          this.learningPlanService.getPlan(this.planLanguage)
            .pipe(take(1)).subscribe({
              next: (res: any) => this.applyPlanLifecycleFromPlan(res?.plan, res?.entitlements),
              error: () => {}
            });
        }
      }
      return;
    }

    const alert = await this.alertController.create({
      header: 'Change Learning Goal',
      cssClass: 'goal-change-alert',
      message: `
        <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#222;">
          <strong>What's kept</strong><br>
          • Your current level and CEFR estimate<br>
          • All past chapters and badges<br>
          • Your tutors' notes about you
        </p>
        <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#222;">
          <strong>What changes</strong><br>
          • Your current chapter restarts from <strong>Phase 1</strong> with new content matching your new goal<br>
          • Phase progress in this chapter resets (your past lessons stay in your history)
        </p>
        <p style="margin:0;font-size:13px;line-height:1.5;color:#717171;">
          You can change your goal once every <strong>7 days</strong>.
        </p>
      `,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Change Goal',
          handler: () => {
            this.router.navigate(['/onboarding']);
          }
        }
      ]
    });
    await alert.present();
  }

  getDisplayUser(): any {
    return this.isViewingOtherUser ? this.viewingUser : this.currentUser;
  }

  /** Recalculate all cached template properties from current state. */
  private syncDisplayUserProperties(): void {
    const user = this.isViewingOtherUser ? this.viewingUser : this.currentUser;
    this.displayUser = user;
    this.isTutorUser = user?.userType === 'tutor';
    this.isStudentUser = user?.userType === 'student';

    // Full name
    if (user?.firstName && user?.lastName) {
      this.fullName = `${user.firstName} ${user.lastName}`;
    } else if (user?.name) {
      this.fullName = user.name;
    } else {
      this.fullName = user?.email || 'Unknown';
    }

    // Discoverable name
    this.discoverableName = this._computeDiscoverableName(user);
    this.discoverablePrefixKey = this.isTutorUser
      ? 'PROFILE_SCREEN.DISCOVERABLE_TO_STUDENTS_PREFIX'
      : 'PROFILE_SCREEN.DISCOVERABLE_TO_TUTORS_PREFIX';

    // Initials
    if (user?.name) {
      this.displayUserInitials = user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
    } else {
      this.displayUserInitials = '?';
    }

    // Custom picture — must match the same logic used by user.service's
    // tutor-approval `photoComplete` flag so the Personal Info CTA and the
    // shared profile checklist never disagree about whether a custom photo
    // is set.
    const pic = user?.picture;
    const auth0Pic = (user as any)?.auth0Picture;
    this.hasCustomProfilePicture = !!pic && (
      pic.includes('storage.googleapis.com') ||
      (!!auth0Pic && pic !== auth0Pic)
    );

    // Timezone
    const tz = this.currentUser?.profile?.timezone;
    this.timezoneLabel = tz ? getTimezoneLabel(tz) : 'Auto-detected';

    // Payout display
    this.payoutProviderLabelKey = this._computePayoutProviderLabelKey();
    this.payoutSetupTitleKey = this._computePayoutSetupTitleKey();
    this.payoutSetupDescriptionKey = this._computePayoutSetupDescriptionKey();
    this.syncProfilePayoutMethod();

    this.refreshInterfaceLanguageLabel();

    // Formatted feedback items
    this.formattedFeedbackItems = this.pendingFeedbackItems.map(fb => ({
      item: fb,
      date: this.formatFeedbackDate(fb.lesson?.startTime),
      time: this.formatFeedbackTime(fb.lesson?.startTime)
    }));

    this.syncProfileLayoutState();

    if (this.isTutorUser && this.tutorApprovalStatusSnapshot) {
      this.applyProfileChecklistFromStatus(this.tutorApprovalStatusSnapshot);
    }
  }

  /** Build sidebar nav + keep active section valid (own profile only). */
  private syncProfileLayoutState(): void {
    if (this.isViewingOtherUser) {
      this.profileNavItems = [];
      return;
    }
    const items: Array<{ id: string; labelKey: string; icon: string }> = [];
    items.push({ id: 'personal', labelKey: 'PROFILE_SCREEN.NAV_PERSONAL', icon: 'person-outline' });
    if (this.isTutorUser) {
      items.push({ id: 'payments', labelKey: 'PROFILE_SCREEN.PAYOUTS', icon: 'wallet-outline' });
    }
    items.push({ id: 'stats', labelKey: 'PROFILE_SCREEN.NAV_STATS', icon: 'stats-chart-outline' });
    if (this.isTutorUser) {
      items.push({ id: 'teaching', labelKey: 'PROFILE_SCREEN.NAV_TEACHING', icon: 'videocam-outline' });
    }
    if (this.isStudentUser) {
      items.push({ id: 'learning', labelKey: 'PROFILE_SCREEN.NAV_LEARNING', icon: 'school-outline' });
    }
    items.push({ id: 'settings', labelKey: 'PROFILE_SCREEN.SETTINGS', icon: 'settings-outline' });
    this.profileNavItems = items;

    const allowed = new Set(items.map((i) => i.id));
    const sectionQuery = this.route.snapshot.queryParamMap.get('section');
    if (sectionQuery && allowed.has(sectionQuery)) {
      this.profileActiveSection = sectionQuery as typeof this.profileActiveSection;
    } else if (!allowed.has(this.profileActiveSection)) {
      this.profileActiveSection = 'personal';
    }
    this.applyProfilePanelTitles();
  }

  onSelectProfileSection(section: string): void {
    if (!section) return;
    this.profileActiveSection = section as typeof this.profileActiveSection;
    this.applyProfilePanelTitles();
  }

  /** Deep-link / Stripe return: ?section=payments */
  private applyProfileSectionQueryParam(section: string | string[] | undefined): void {
    const raw = Array.isArray(section) ? section[0] : section;
    if (!raw || this.isViewingOtherUser) {
      return;
    }
    const allowed = new Set([
      'personal',
      'payments',
      'stats',
      'teaching',
      'learning',
      'settings',
    ]);
    if (allowed.has(raw)) {
      this.profileActiveSection = raw as typeof this.profileActiveSection;
      this.applyProfilePanelTitles();
    }
  }

  private openProfilePayoutSection(): void {
    this.profileActiveSection = 'payments';
    this.applyProfilePanelTitles();
    this.cdr.markForCheck();
    setTimeout(() => {
      document.getElementById('profile-payout-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 400);
  }

  onProfileSegmentChange(ev: CustomEvent): void {
    const v = (ev as any)?.detail?.value as string | undefined;
    if (v) {
      this.onSelectProfileSection(v);
    }
  }

  private applyProfilePanelTitles(): void {
    switch (this.profileActiveSection) {
      case 'payments':
        this.profilePanelTitleKey = 'PROFILE_SCREEN.PANEL_PAYOUTS';
        this.profilePanelSubKey = 'PROFILE_SCREEN.PANEL_PAYOUTS_SUB';
        break;
      case 'stats':
        this.profilePanelTitleKey = 'PROFILE_SCREEN.PANEL_STATS';
        this.profilePanelSubKey = 'PROFILE_SCREEN.PANEL_STATS_SUB';
        break;
      case 'teaching':
        this.profilePanelTitleKey = 'PROFILE_SCREEN.PANEL_TEACHING';
        this.profilePanelSubKey = 'PROFILE_SCREEN.PANEL_TEACHING_SUB';
        break;
      case 'learning':
        this.profilePanelTitleKey = 'PROFILE_SCREEN.PANEL_LEARNING';
        this.profilePanelSubKey = 'PROFILE_SCREEN.PANEL_LEARNING_SUB';
        break;
      case 'settings':
        this.profilePanelTitleKey = 'PROFILE_SCREEN.PANEL_SETTINGS';
        this.profilePanelSubKey = 'PROFILE_SCREEN.PANEL_SETTINGS_SUB';
        break;
      default:
        this.profilePanelTitleKey = 'PROFILE_SCREEN.PANEL_PERSONAL';
        this.profilePanelSubKey = 'PROFILE_SCREEN.PANEL_PERSONAL_SUB';
    }
  }

  private _computeDiscoverableName(user: any): string {
    if (!user) return 'Unknown';
    if (user.firstName && user.lastName) {
      return `${this.capitalize(user.firstName)} ${user.lastName.charAt(0).toUpperCase()}.`;
    }
    if (user.name) {
      const parts = user.name.trim().split(' ').filter(Boolean);
      if (parts.length > 1) return `${this.capitalize(parts[0])} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
      if (parts.length === 1) return this.capitalize(parts[0]);
    }
    if (user.email) {
      const parts = user.email.split('@')[0].split(/[.\s_]+/).filter(Boolean);
      if (parts.length > 1) return `${this.capitalize(parts[0])} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
      if (parts.length === 1) return this.capitalize(parts[0]);
    }
    return 'Unknown';
  }

  private _computePayoutProviderLabelKey(): string {
    switch (this.payoutProvider) {
      case 'stripe':
        return 'PROFILE_SCREEN.PROVIDER_STRIPE';
      case 'paypal':
        return 'PROFILE_SCREEN.PROVIDER_PAYPAL';
      case 'manual':
        return 'PROFILE_SCREEN.PROVIDER_MANUAL';
      default:
        return '';
    }
  }

  private _computePayoutSetupTitleKey(): string {
    if (!this.payoutOptions) return 'PROFILE_SCREEN.PAYOUT_CONNECT_BANK_TITLE';
    if (this.payoutOptions.stripe?.available && this.payoutOptions.stripe?.recommended) {
      return 'PROFILE_SCREEN.PAYOUT_CONNECT_BANK_TITLE';
    }
    if (this.payoutOptions.paypal?.available && this.payoutOptions.paypal?.recommended) {
      return 'PROFILE_SCREEN.PAYOUT_CONNECT_PAYPAL_TITLE';
    }
    return 'PROFILE_SCREEN.PAYOUT_SETUP_PRIMARY_TITLE';
  }

  private _computePayoutSetupDescriptionKey(): string {
    if (!this.payoutOptions) return 'PROFILE_SCREEN.PAYOUT_SETUP_DESCRIPTION';
    const { stripe, paypal, manual } = this.payoutOptions;
    if (stripe?.available && stripe?.recommended) return 'PROFILE_SCREEN.PAYOUT_SETUP_DESCRIPTION';
    if (paypal?.available && paypal?.recommended) return 'PROFILE_SCREEN.PAYOUT_SETUP_DESCRIPTION';
    if (manual?.available) return 'PROFILE_SCREEN.PAYOUT_SETUP_DESCRIPTION_MANUAL';
    return 'PROFILE_SCREEN.PAYOUT_SETUP_DESCRIPTION';
  }

  /** Match tutor wizard: show Stripe or PayPal setup UI based on residence / payout options. */
  private syncProfilePayoutMethod(): void {
    if (!this.isTutorUser || this.isViewingOtherUser) {
      this.profileDeterminedPayoutMethod = null;
      return;
    }

    if (this.hasPayoutSetup === true) {
      if (this.payoutProvider === 'stripe') {
        this.profileDeterminedPayoutMethod = 'stripe';
      } else if (this.payoutProvider === 'paypal') {
        this.profileDeterminedPayoutMethod = 'paypal';
      } else if (this.payoutProvider === 'manual') {
        this.profileDeterminedPayoutMethod = 'manual';
      }
      return;
    }

    const residence = (this.currentUser?.residenceCountry || this.currentUser?.country || '').trim();
    this.isCountryDrivenProfilePayoutRouting = !!residence;

    if (residence) {
      if (isStripeSupportedCountry(residence)) {
        this.profileDeterminedPayoutMethod = 'stripe';
        this.profilePayoutMethodReasonKey = 'TUTOR_APPROVAL.METHOD_REASON_STRIPE_COUNTRY';
      } else {
        this.profileDeterminedPayoutMethod = 'paypal';
        this.profilePayoutMethodReasonKey = 'TUTOR_APPROVAL.METHOD_REASON_PAYPAL_COUNTRY';
      }
      this.profilePayoutMethodReasonParams = { country: residence };
      return;
    }

    this.isCountryDrivenProfilePayoutRouting = false;
    const opts = this.payoutOptions;
    if (!opts) {
      this.profileDeterminedPayoutMethod = null;
      return;
    }

    if (opts.stripe?.available && opts.stripe?.recommended) {
      this.profileDeterminedPayoutMethod = 'stripe';
    } else if (opts.paypal?.available && opts.paypal?.recommended) {
      this.profileDeterminedPayoutMethod = 'paypal';
    } else if (opts.stripe?.available) {
      this.profileDeterminedPayoutMethod = 'stripe';
    } else if (opts.paypal?.available) {
      this.profileDeterminedPayoutMethod = 'paypal';
    } else if (opts.manual?.available) {
      this.profileDeterminedPayoutMethod = 'manual';
    } else {
      this.profileDeterminedPayoutMethod = null;
    }
  }

  get profilePaypalEmailConnected(): string {
    return this.currentUser?.payoutDetails?.paypalEmail || '';
  }

  canConnectProfilePaypal(): boolean {
    const email = this.profilePaypalEmail.trim();
    return email.length > 0 && !this.profilePaypalEmailError;
  }

  onProfilePaypalEmailInput(): void {
    this.profilePaypalEmailError = '';
    const email = this.profilePaypalEmail.trim();
    if (!email) {
      this.profilePaypalConnectDisabled = true;
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      this.profilePaypalEmailError = 'TUTOR_APPROVAL.ERR_PAYPAL_EMAIL_INVALID';
    }
    this.profilePaypalConnectDisabled = !!this.profilePaypalEmailError;
  }

  onProfilePaypalEmailChange(value: string): void {
    this.profilePaypalEmail = value;
    this.onProfilePaypalEmailInput();
  }

  async connectProfilePayout(): Promise<void> {
    if (this.profileDeterminedPayoutMethod === 'stripe') {
      this.isLoadingStripeConnect = true;
      try {
        await this.setupStripeConnect();
      } finally {
        this.isLoadingStripeConnect = false;
      }
      return;
    }
    if (this.profileDeterminedPayoutMethod === 'paypal') {
      this.onProfilePaypalEmailInput();
      if (!this.canConnectProfilePaypal()) {
        if (!this.profilePaypalEmail.trim()) {
          this.profilePaypalEmailError = 'TUTOR_APPROVAL.ERR_PAYPAL_EMAIL_INVALID';
        }
        return;
      }
      await this.setupPayPal(this.profilePaypalEmail.trim());
      return;
    }
    await this.startStripeConnectOnboarding();
  }

  goBack(): void {
    this.router.navigate(['/tabs']);
  }

  private get userTz(): string | undefined {
    return this.currentUser?.profile?.timezone || undefined;
  }

  onVideoUploaded(data: { url: string; thumbnail: string; type: 'upload' | 'youtube' | 'vimeo' }) {
    console.log('📹 Video uploaded event received:', {
      url: data.url,
      thumbnail: data.thumbnail,
      type: data.type,
      hasThumbnail: !!data.thumbnail
    });
    this.tutorIntroductionVideo = data.url;
    this.tutorVideoThumbnail = data.thumbnail;
    this.tutorVideoType = data.type;
    this.updateTutorVideo(data.url, data.thumbnail, data.type);
    
    // Immediately show pending banner (since new video is now pending approval)
    this.hasPendingVideo = true;
  }

  async onVideoRemoved() {
    const alert = await this.alertController.create({
      header: 'Remove Introduction Video?',
      message: 'Your profile will be <strong>hidden from students</strong> until you upload a new video and it is approved by our team. You will not be able to add availability or receive bookings during this time.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Remove Video',
          role: 'destructive',
          handler: () => {
            this.videoUploadComponent?.clearPreviews();
            this.tutorIntroductionVideo = '';
            this.tutorVideoThumbnail = '';
            this.tutorVideoType = 'upload';
            this.updateTutorVideo('', '', 'upload');
          }
        }
      ]
    });
    await alert.present();
  }

  openVideoPlayerModal() {
    if (!this.tutorIntroductionVideo) return;
    
    let videoUrl = this.tutorIntroductionVideo;
    
    // Add autoplay parameter for external videos
    if (this.tutorVideoType === 'youtube' || this.tutorVideoType === 'vimeo') {
      const separator = videoUrl.includes('?') ? '&' : '?';
      if (!videoUrl.includes('autoplay=')) {
        videoUrl = videoUrl + separator + 'autoplay=1';
      }
    }
    
    this.videoPlayerData = {
      videoUrl: videoUrl,
      safeVideoUrl: this.sanitizer.bypassSecurityTrustResourceUrl(videoUrl),
      videoType: this.tutorVideoType
    };
    this.isVideoPlayerModalOpen = true;
  }

  onVideoPlayerModalDismiss() {
    this.isVideoPlayerModalOpen = false;
    this.videoPlayerData = null;
  }

  onModalVideoReady(event: Event) {
    const video = event.target as HTMLVideoElement;
    if (video) {
      video.muted = false;
      video.play().catch(() => {});
    }
  }

  private async updateTutorVideo(
    videoUrl: string, 
    thumbnailUrl?: string, 
    videoType?: 'upload' | 'youtube' | 'vimeo'
  ) {
    const loading = await this.loadingController.create({
      message: 'Updating video...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      const result = await this.userService.updateTutorVideo(videoUrl, thumbnailUrl, videoType)
        .pipe(take(1))
        .toPromise();
      
      console.log('📹 Backend response after update:', result);
      
      await loading.dismiss();
      
      const isRemoval = !videoUrl;
      let message: string;
      let header: string;

      if (isRemoval) {
        header = 'Video Removed';
        message = 'Your introduction video has been removed. Your profile is now hidden from students. Upload a new video to become visible again.';
      } else if (this.isVideoApproved) {
        header = 'Success';
        message = 'Video updated! The new video has been sent for admin review. Your profile will remain active during the review process.';
      } else {
        header = 'Success';
        message = 'Introduction video updated successfully!';
      }
      
      const alert = await this.alertController.create({
        header,
        message,
        buttons: ['OK']
      });
      await alert.present();
      
      // Update local approval status
      this.isVideoApproved = false;
      
      if (!videoUrl) {
        this.hasPendingVideo = false;
        this.tutorIntroductionVideo = '';
        this.tutorVideoThumbnail = '';
        this.tutorVideoType = 'upload';
      }
      
      // Refresh user data to get updated tutorOnboarding status
      this.userService.getCurrentUser(true).subscribe();
      
    } catch (error) {
      console.error('Error updating tutor video:', error);
      
      // Clear the video data on failure
      this.tutorIntroductionVideo = '';
      this.tutorVideoThumbnail = '';
      this.tutorVideoType = 'upload';
      
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to update video. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      await loading.dismiss();
    }
  }

  /**
   * Toggle dark mode
   */
  toggleDarkMode(event: any): void {
    console.log('🔄 Dark mode toggle clicked, current state:', this.themeService.isDarkMode());
    this.themeService.toggleDarkMode();
    console.log('✅ Dark mode toggled, new state:', this.themeService.isDarkMode());
  }
  
  /**
   * Toggle reminders on/off
   */
  toggleReminders(event: any): void {
    this.remindersEnabled = event.detail.checked;
    
    // Save to database
    this.userService.updateRemindersEnabled(this.remindersEnabled).subscribe({
      next: (user) => {
        console.log('🔔 Reminders setting saved to database:', this.remindersEnabled);
        // Reload page to apply changes
        window.location.reload();
      },
      error: (error) => {
        console.error('❌ Error saving reminders setting:', error);
        // Revert on error
        this.remindersEnabled = !this.remindersEnabled;
      }
    });
  }
  
  /**
   * Toggle show wallet balance on/off
   */
  toggleShowWalletBalance(event: any): void {
    this.showWalletBalance = event.detail.checked;
    
    // Save to database
    this.userService.updateShowWalletBalance(this.showWalletBalance).subscribe({
      next: (user) => {
        console.log('💰 Show wallet balance setting saved to database:', this.showWalletBalance);
        // Update the current user to ensure cache is updated
        this.currentUser = user;
      },
      error: (error) => {
        console.error('❌ Error saving wallet balance setting:', error);
        // Revert on error
        this.showWalletBalance = !this.showWalletBalance;
      }
    });
  }

  /**
   * Toggle AI analysis on/off.
   *
   * For premium students turning AI **off**, we surface a confirmation
   * sheet first because most premium value (per-lesson plan updates,
   * smarter focus, AI-rewritten plans) silently degrades when AI is off.
   */
  toggleAIAnalysis(event: any): void {
    const requested = !!event.detail.checked;
    const previous = this.aiAnalysisEnabled;
    if (requested === previous) return;

    const isPremium = (this.currentUser as any)?.subscription?.tier === 'premium';
    if (!requested && isPremium) {
      // Optimistic revert in UI: keep showing ON until they confirm.
      this.aiAnalysisEnabled = previous;
      this.confirmPremiumAiOff(() => {
        this.aiAnalysisEnabled = false;
        this.persistAIAnalysisSetting(false);
      });
      return;
    }

    this.aiAnalysisEnabled = requested;
    this.persistAIAnalysisSetting(requested);
  }

  /** Confirmation sheet when a Premium student is about to turn AI off. */
  private async confirmPremiumAiOff(onConfirm: () => void): Promise<void> {
    const alert = await this.alertController.create({
      header: this.languageService.instant('PROFILE.AI_OFF_WARN_TITLE'),
      message: this.languageService.instant('PROFILE.AI_OFF_WARN_BODY'),
      buttons: [
        { text: this.languageService.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.languageService.instant('PROFILE.AI_OFF_WARN_CONFIRM'),
          role: 'destructive',
          handler: () => onConfirm()
        }
      ]
    });
    await alert.present();
  }

  private persistAIAnalysisSetting(enabled: boolean): void {
    this.userService.updateAIAnalysisEnabled(enabled).subscribe({
      next: (user) => {
        console.log('🤖 AI analysis setting saved to database:', enabled);
        this.currentUser = user;
      },
      error: (error) => {
        console.error('❌ Error saving AI analysis setting:', error);
        this.aiAnalysisEnabled = !enabled;
      }
    });
  }

  setTimeFormat(format: '12h' | '24h'): void {
    if (format === this.timeFormat) return;
    const prev = this.timeFormat;
    this.timeFormat = format;
    this.userService.updateTimeFormat(format).subscribe({
      error: () => { this.timeFormat = prev; }
    });
  }

  private refreshInterfaceLanguageLabel(): void {
    const opt = this.languageService.getLanguageOption(this.selectedInterfaceLanguage);
    this.interfaceLanguageLabel = opt?.nativeName || this.selectedInterfaceLanguage;
    this.selectedInterfaceLanguageEnglishName = opt?.name || 'English';
  }

  openHelpSupport(): void {
    window.open(`mailto:${this.supportEmail}`, '_blank', 'noopener,noreferrer');
  }

  openTermsOfService(): void {
    const lang = this.selectedInterfaceLanguage || this.languageService.getCurrentLanguage();
    window.open(`/terms?lang=${lang}`, '_blank', 'noopener,noreferrer');
  }

  openPrivacyPolicy(): void {
    void this.router.navigate(['/privacy'], {
      queryParams: { lang: this.selectedInterfaceLanguage || this.languageService.getCurrentLanguage() },
    });
  }

  async openInterfaceLanguageModal(): Promise<void> {
    const modal = await this.modalController.create({
      component: InterfaceLanguageSelectModalComponent,
      componentProps: {
        languages: this.availableLanguages,
        selectedCode: this.selectedInterfaceLanguage,
      },
      cssClass: 'modern-modal',
      showBackdrop: true,
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    const next = data?.selectedLanguage as SupportedLanguage | undefined;
    if (next && next !== this.selectedInterfaceLanguage) {
      await this.applyInterfaceLanguage(next);
    }
  }

  /**
   * Apply interface language (from modal or legacy ion-select).
   */
  async applyInterfaceLanguage(newLanguage: SupportedLanguage): Promise<void> {
    console.log('🌐 Interface language changed to:', newLanguage);

    this.languageService.setLanguage(newLanguage);
    this.selectedInterfaceLanguage = newLanguage;
    this.refreshInterfaceLanguageLabel();

    this.userService.updateInterfaceLanguage(newLanguage).subscribe({
      next: async () => {
        console.log('✅ Interface language saved to backend');
      },
      error: async (error) => {
        console.error('❌ Error saving interface language:', error);
        const toast = await this.toastController.create({
          message: 'Error updating language preference',
          duration: 3000,
          position: 'bottom',
          color: 'danger'
        });
        await toast.present();
      }
    });
  }

  /**
   * Handle profile picture upload
   */
  async onPictureSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate image
    const validation = this.fileUploadService.validateImage(file);
    if (!validation.valid) {
      const alert = await this.alertController.create({
        header: 'Invalid Image',
        message: validation.error,
        buttons: ['OK']
      });
      await alert.present();
      // Reset file input
      event.target.value = '';
      return;
    }

    // Open cropper modal
    const modal = await this.modalController.create({
      component: ImageCropperComponent,
      componentProps: {
        imageChangedEvent: event
      },
      cssClass: 'image-cropper-modal'
    });

    await modal.present();

    const { data, role } = await modal.onWillDismiss();

    if (role === 'crop' && data) {
      // Convert blob to file
      const croppedFile = new File([data], file.name, { type: 'image/png' });
      await this.uploadProfilePicture(croppedFile, event);
    } else {
      // Reset file input if cancelled
      event.target.value = '';
    }
  }

  /**
   * Upload profile picture to server
   */
  async uploadProfilePicture(file: File, event: any) {
    const loading = await this.loadingController.create({
      message: 'Uploading image...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Upload image
      const uploadResult = await this.fileUploadService.uploadImage(file).pipe(take(1)).toPromise();
      
      if (uploadResult?.success && uploadResult?.imageUrl) {
        // Update user picture in database
        const updateResult = await this.userService.updatePicture(uploadResult.imageUrl).pipe(take(1)).toPromise();
        
        if (updateResult?.success) {
          // Update current user with new picture immediately
          if (this.currentUser) {
            this.currentUser.picture = uploadResult.imageUrl;
          }

          // Force a server refresh so currentUser$ re-emits with the new
          // picture URL — that drives updateTutorApprovalStatus which keeps
          // the profile checklist + Payouts tab perfectly in sync.
          this.userService.getCurrentUser(true).subscribe(user => {
            this.currentUser = user;
          });

          const alert = await this.alertController.create({
            header: 'Success',
            message: 'Profile picture updated successfully!',
            buttons: ['OK']
          });
          await alert.present();
        } else {
          throw new Error('Failed to update profile picture');
        }
      } else {
        throw new Error('Failed to upload image');
      }
    } catch (error) {
      console.error('Error uploading profile picture:', error);
      
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to upload profile picture. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      await loading.dismiss();
      if (event?.target) {
        event.target.value = '';
      }
    }
  }

  /**
   * Check if user has a custom uploaded picture (vs Auth0/Google picture)
   */
  hasCustomPicture(): boolean {
    const picture = this.getDisplayUser()?.picture;
    if (!picture) return false;
    
    // Check if it's a custom picture (uploaded to GCS)
    // Custom pictures will be in storage.googleapis.com with our bucket
    return picture.includes('storage.googleapis.com') && picture.includes('profile-pictures');
  }

  /**
   * Open image cropper with current profile picture for zoom/rotate/crop
   */
  async editPicture() {
    const pictureUrl = this.getDisplayUser()?.picture;
    if (!pictureUrl) return;

    const loading = await this.loadingController.create({
      message: 'Loading photo...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      const blob = await this.userService.getProfilePictureBlob().pipe(take(1)).toPromise();
      if (!blob) throw new Error('No image data');

      const file = new File([blob], 'profile.png', { type: 'image/png' });

      const modal = await this.modalController.create({
        component: ImageCropperComponent,
        componentProps: {
          imageFile: file
        },
        cssClass: 'image-cropper-modal'
      });

      await loading.dismiss();
      await modal.present();

      const { data, role } = await modal.onWillDismiss();

      if (role === 'crop' && data) {
        const croppedFile = new File([data], 'profile.png', { type: 'image/png' });
        await this.uploadProfilePicture(croppedFile, null);
      }
    } catch (err) {
      await loading.dismiss();
      console.error('Error opening edit picture:', err);
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Could not load your photo. Try changing the photo instead.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  /**
   * Trigger file input click
   */
  triggerPictureUpload() {
    console.log('🖼️ triggerPictureUpload called');
    const fileInput = document.getElementById('profile-picture-input') as HTMLInputElement;
    console.log('🖼️ File input element:', fileInput);
    if (fileInput) {
      console.log('🖼️ Clicking file input');
      fileInput.click();
    } else {
      console.error('❌ File input element not found in DOM');
    }
  }

  /**
   * Remove profile picture
   */
  async removePicture() {
    // Show confirmation alert
    const alert = await this.alertController.create({
      header: 'Remove Picture',
      message: 'Are you sure you want to remove your profile picture?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Remove',
          role: 'destructive',
          handler: async () => {
            const loading = await this.loadingController.create({
              message: 'Removing picture...',
              spinner: 'crescent'
            });
            await loading.present();

            try {
              const result = await this.userService.removePicture().pipe(take(1)).toPromise();
              
              if (result?.success) {
                // Update current user with restored picture (or undefined if no Auth0 picture)
                if (this.currentUser) {
                  this.currentUser.picture = result.picture;
                }

                // Also reload from server to ensure consistency
                this.userService.getCurrentUser().subscribe(user => {
                  this.currentUser = user;
                });

                const successAlert = await this.alertController.create({
                  header: 'Success',
                  message: result.message || 'Profile picture removed successfully!',
                  buttons: ['OK']
                });
                await successAlert.present();
              } else {
                throw new Error('Failed to remove profile picture');
              }
            } catch (error) {
              console.error('Error removing profile picture:', error);
              
              const errorAlert = await this.alertController.create({
                header: 'Error',
                message: 'Failed to remove profile picture. Please try again.',
                buttons: ['OK']
              });
              await errorAlert.present();
            } finally {
              await loading.dismiss();
            }
          }
        }
      ]
    });

    await alert.present();
  }

  /**
   * Open timezone selector modal
   */
  async openTimezoneSelector() {
    const modal = await this.modalController.create({
      component: TimezoneSelectorComponent,
      componentProps: {
        selectedTimezone: this.currentUser?.profile?.timezone || detectUserTimezone()
      },
      cssClass: 'modern-modal',
      showBackdrop: true,
      backdropDismiss: true,
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    
    if (data && data.timezone) {
      await this.updateTimezone(data.timezone);
    }
  }

  /**
   * Update user's timezone
   */
  private async updateTimezone(timezone: string) {
    const loading = await this.loadingController.create({
      message: 'Updating timezone...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      await this.userService.updateProfile({ timezone })
        .pipe(take(1))
        .toPromise();
      
      // Update current user
      if (this.currentUser) {
        if (!this.currentUser.profile) {
          this.currentUser.profile = { bio: '', timezone: '', preferredLanguage: '' };
        }
        this.currentUser.profile.timezone = timezone;
      }
      
      const alert = await this.alertController.create({
        header: 'Success',
        message: 'Timezone updated successfully!',
        buttons: ['OK']
      });
      await alert.present();
      
    } catch (error) {
      console.error('Error updating timezone:', error);
      
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to update timezone. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      await loading.dismiss();
    }
  }

  /**
   * Get formatted timezone label
   */
  getTimezoneLabel(): string {
    const timezone = this.currentUser?.profile?.timezone;
    if (!timezone) {
      return 'Auto-detected';
    }
    return getTimezoneLabel(timezone);
  }

  /** Reopen the approval wizard modal at a specific step (e.g. after Stripe return). */
  openTutorApprovalWizardAtStep(stepId: string): void {
    this.isMobileViewport = this.platform.is('mobile') || this.platform.is('mobileweb');
    this.tutorApprovalWizardModalInitialStepId = stepId;
    this.isTutorApprovalWizardModalOpen = true;
    this.tutorApprovalWizardBackdropVisible = false;
    this.tutorApprovalWizardModalReady = false;
    this.cdr.markForCheck();
    if (!this.isMobileViewport) {
      document.body.classList.add('cm-desktop-modal-open');
      requestAnimationFrame(() => {
        this.tutorApprovalWizardBackdropVisible = true;
        this.cdr.markForCheck();
      });
      setTimeout(() => {
        this.tutorApprovalWizardModalReady = true;
        this.cdr.markForCheck();
      }, 350);
    }
  }

  // Handle return from Stripe Connect onboarding
  async handleStripeConnectReturn(state: StripeConnectReturnState) {
    const success = state.success;
    if (success) {
      // Verify with backend that Stripe Connect is actually complete
      // (user may have pressed back without finishing)
      try {
        const statusResponse = await firstValueFrom(
          this.http.get<any>(`${environment.apiUrl}/payments/stripe-connect/status`, {
            headers: this.userService.getAuthHeadersSync()
          })
        );
        
        if (statusResponse?.success && statusResponse.onboarded) {
          // Stripe is actually onboarded — show success toast
          const toast = await this.toastController.create({
            message: '✅ Payout setup complete! Your earnings will be transferred to your bank.',
            duration: 5000,
            color: 'success',
            position: 'top'
          });
          await toast.present();
        } else {
          // User returned but didn't finish Stripe setup
          console.log('⚠️ Returned from Stripe but onboarding not complete:', statusResponse);
          const toast = await this.toastController.create({
            message: 'Stripe setup not completed. Please try again to finish connecting your bank account.',
            duration: 5000,
            color: 'warning',
            position: 'top'
          });
          await toast.present();
        }
      } catch (error) {
        console.error('❌ Error verifying Stripe status:', error);
        // Don't show any toast if we can't verify
      }
    }
    
    // Refresh payout status in UserService (will update profile via subscription)
    setTimeout(() => {
      this.userService.loadPayoutStatus();
      this.loadEarnings(); // Also refresh earnings
    }, 1000);

    if (
      state.returnContext === 'tutor-approval-wizard' &&
      state.tutorApprovalStepId
    ) {
      this.openTutorApprovalWizardAtStep(state.tutorApprovalStepId);
    } else if (state.returnContext === 'profile-payout') {
      this.openProfilePayoutSection();
    }

    const cleanedParams = stripStripeConnectQueryParams(this.route.snapshot.queryParams);
    if (state.returnContext === 'profile-payout') {
      cleanedParams['section'] = 'payments';
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: cleanedParams,
      replaceUrl: true,
    });
  }

  // Load earnings summary and recent payments
  async loadEarnings() {
    if (!this.isTutor()) return;

    this.loadingEarnings = true;

    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/payments/tutor/earnings`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success) {
        this.totalEarnings = response.totalEarnings || 0;
        this.pendingEarnings = response.pendingEarnings || 0;
        this.recentPayments = response.recentPayments || [];
        console.log(`💰 Loaded earnings: Total $${this.totalEarnings}, Pending $${this.pendingEarnings}`);
      }
    } catch (error) {
      console.error('❌ Error loading earnings:', error);
    } finally {
      this.loadingEarnings = false;
    }
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
        console.log(`💰 Stripe Connect status: ${this.stripeConnectOnboarded ? 'Onboarded' : 'Not onboarded'}`);
      }
    } catch (error) {
      console.error('❌ Error checking Stripe Connect status:', error);
    }
  }

  // Check overall payout status (Stripe, PayPal, or Manual)
  // Uses cached data from UserService, or loads it if not yet cached
  async checkPayoutStatus() {
    if (!this.isTutor()) return;

    try {
      // Get cached payout status from UserService
      let payoutStatus = this.userService.getPayoutStatus();
      
      console.log('💰 [PROFILE] Initial cached payout status:', JSON.stringify(payoutStatus, null, 2));
      
      // If payout status hasn't been loaded yet (provider is 'none' and no options), load it now
      if (payoutStatus.provider === 'none' && !payoutStatus.options) {
        console.log('💰 [PROFILE] Payout status not cached yet, loading now...');
        await this.userService.loadPayoutStatus();
        payoutStatus = this.userService.getPayoutStatus();
        console.log('💰 [PROFILE] Loaded payout status:', JSON.stringify(payoutStatus, null, 2));
      }
      
      console.log('💰 [PROFILE] Setting local properties:', {
        payoutProvider: payoutStatus.provider,
        hasPayoutSetup: payoutStatus.hasPayoutSetup,
        hasOptions: !!payoutStatus.options
      });
      
      this.payoutProvider = payoutStatus.provider;
      this.hasPayoutSetup = payoutStatus.hasPayoutSetup;
      this.payoutOptions = payoutStatus.options;
      
      console.log('💰 [PROFILE] Local properties set:', {
        'this.payoutProvider': this.payoutProvider,
        'this.hasPayoutSetup': this.hasPayoutSetup,
        'this.payoutOptions': !!this.payoutOptions
      });
      
      // Set stripeConnectOnboarded for legacy compatibility
      if (this.payoutProvider === 'stripe') {
        this.stripeConnectOnboarded = this.hasPayoutSetup;
      }

      console.log(`💰 [PROFILE] Final payout status: provider=${this.payoutProvider}, setup=${this.hasPayoutSetup}`);
      this.syncProfilePayoutMethod();
      this.cdr.markForCheck();
      this.syncDisplayUserProperties();
    } catch (error) {
      console.error('❌ Error checking payout status:', error);
    }
  }

  // Legacy helpers (return i18n keys for translate pipe if used elsewhere)
  getPayoutProviderName(): string {
    return this._computePayoutProviderLabelKey();
  }

  // Get payout setup instructions based on what's available
  getPayoutSetupText(): string {
    return this._computePayoutSetupDescriptionKey();
  }

  // Get payout setup title
  getPayoutSetupTitle(): string {
    return this._computePayoutSetupTitleKey();
  }

  // Start Stripe Connect onboarding OR open payout selection modal
  async startStripeConnectOnboarding() {
    this.isLoadingStripeConnect = true;

    try {
      // First, check what payout options are available
      if (!this.payoutOptions) {
        const optionsResponse = await firstValueFrom(
          this.http.get<any>(`${environment.apiUrl}/payments/payout-options`, {
            headers: this.userService.getAuthHeadersSync()
          })
        );

        if (optionsResponse.success) {
          this.payoutOptions = optionsResponse.options;
          this.payoutSetupTitleKey = this._computePayoutSetupTitleKey();
          this.payoutSetupDescriptionKey = this._computePayoutSetupDescriptionKey();
        }
      }

      // If Stripe is available, go directly to Stripe
      if (this.payoutOptions?.stripe?.available) {
        await this.setupStripeConnect();
      } else {
        // Otherwise, open the payout selection modal
        this.isLoadingStripeConnect = false;
        await this.openPayoutSelectionModal();
      }
    } catch (error: any) {
      console.error('❌ Error starting payout setup:', error);
      this.isLoadingStripeConnect = false;
      
      const errorMessage = error.error?.message || error.message || 'Failed to start payout setup';
      
      const alert = await this.alertController.create({
        header: 'Setup Error',
        message: errorMessage,
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  // Open payout selection modal (PayPal, Manual, etc.)
  async openPayoutSelectionModal() {
    const modal = await this.modalController.create({
      component: PayoutSelectionModalComponent,
      cssClass: 'payout-selection-modal'
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (!data) {
      console.log('🏦 [PROFILE] User cancelled payout selection');
      return;
    }

    console.log('🏦 [PROFILE] User selected:', data.provider);

    // Handle based on selected provider
    switch (data.provider) {
      case 'stripe':
        await this.setupStripeConnect();
        break;
      case 'paypal':
        await this.setupPayPal(data.paypalEmail);
        break;
      case 'manual':
        await this.setupManualPayout();
        break;
    }
  }

  // Setup Stripe Connect
  private async setupStripeConnect() {
    const loading = await this.loadingController.create({
      message: 'Setting up Stripe...'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/payments/stripe-connect/onboard`,
          buildStripeConnectPayloadForProfilePayout(),
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      await loading.dismiss();

      if (response.success && (response.url || response.onboardingUrl)) {
        const redirectUrl = response.url || response.onboardingUrl;
        // On mobile, open in same window (_self) to keep it within the app
        // On desktop, open in new tab (_blank)
        const target = this.platform.is('mobile') || this.platform.is('mobileweb') ? '_self' : '_blank';
        window.open(redirectUrl, target);
        
        const toast = await this.toastController.create({
          message: 'Complete the setup in the new window. Refresh this page when done.',
          duration: 5000,
          color: 'primary',
          position: 'top'
        });
        await toast.present();
      } else {
        this.showToast('Failed to start Stripe onboarding', 'danger');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('❌ Error starting Stripe Connect:', error);
      
      const errorMessage = error.error?.message || error.message || 'Failed to start Stripe onboarding';
      this.showToast(errorMessage, 'danger');
    } finally {
      this.isLoadingStripeConnect = false;
    }
  }

  // Setup PayPal
  private async setupPayPal(email: string) {
    console.log('💳 [PROFILE] Setting up PayPal with email:', email);
    
    const loading = await this.loadingController.create({
      message: 'Connecting PayPal...'
    });
    await loading.present();

    try {
      console.log('💳 [PROFILE] Sending POST to /payments/setup-paypal...');
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/payments/setup-paypal`,
          { paypalEmail: email },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      console.log('💳 [PROFILE] Response from backend:', response);
      await loading.dismiss();

      if (response.success) {
        this.showToast('✅ PayPal connected successfully!', 'success');
        
        console.log('💳 [PROFILE] Forcing user data refresh...');
        // Force refresh user data from backend
        const freshUser = await firstValueFrom(this.userService.getCurrentUser(true));
        console.log('💳 [PROFILE] Fresh user data:', {
          payoutProvider: (freshUser as any)?.payoutProvider,
          paypalEmail: (freshUser as any)?.payoutDetails?.paypalEmail
        });
        
        console.log('💳 [PROFILE] Reloading payout status in UserService...');
        // Reload payout status in UserService (will update profile via subscription)
        await this.userService.loadPayoutStatus();
        
        console.log('💳 [PROFILE] Final state:', {
          payoutProvider: this.payoutProvider,
          hasPayoutSetup: this.hasPayoutSetup
        });
      } else {
        console.error('💳 [PROFILE] Backend returned error:', response.message);
        this.showToast(response.message || 'Failed to connect PayPal', 'danger');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('❌ [PROFILE] Error setting up PayPal:', error);
      console.error('❌ [PROFILE] Error details:', error.error);
      this.showToast(error.error?.message || 'Failed to connect PayPal', 'danger');
    }
  }

  // Setup Manual Payout
  private async setupManualPayout() {
    const alert = await this.alertController.create({
      header: 'Manual Payout',
      message: 'Your earnings will be processed manually by our team. We\'ll contact you via email for payout details.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Confirm',
          handler: async () => {
            const loading = await this.loadingController.create({
              message: 'Setting up manual payout...'
            });
            await loading.present();

            try {
              const response = await firstValueFrom(
                this.http.post<any>(
                  `${environment.apiUrl}/payments/setup-manual`,
                  {},
                  { headers: this.userService.getAuthHeadersSync() }
                )
              );

              await loading.dismiss();

              if (response.success) {
                this.showToast('✅ Manual payout setup complete!', 'success');
                
                // Force refresh user data from backend
                await firstValueFrom(this.userService.getCurrentUser(true));
                
                // Reload payout status in UserService (will update profile via subscription)
                await this.userService.loadPayoutStatus();
              } else {
                this.showToast(response.message || 'Failed to setup manual payout', 'danger');
              }
            } catch (error: any) {
              await loading.dismiss();
              console.error('❌ Error setting up manual payout:', error);
              this.showToast(error.error?.message || 'Failed to setup manual payout', 'danger');
            }
          }
        }
      ]
    });

    await alert.present();
  }

  // Helper to show toast
  private async showToast(message: string, color: string = 'dark') {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      color,
      position: 'top'
    });
    await toast.present();
  }

  // Original Stripe-only onboarding (kept for backward compatibility, now calls new method)
  async startOriginalStripeOnboarding() {
    this.isLoadingStripeConnect = true;

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/payments/stripe-connect/onboard`, buildStripeConnectPayloadForProfilePayout(), {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success && response.onboardingUrl) {
        // On mobile, open in same window (_self) to keep it within the app
        // On desktop, open in new tab (_blank)
        const target = this.platform.is('mobile') || this.platform.is('mobileweb') ? '_self' : '_blank';
        window.open(response.onboardingUrl, target);
        
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
      
      // Show helpful error message
      const errorMessage = error.error?.message || error.message || 'Failed to start payout setup';
      
      const alert = await this.alertController.create({
        header: 'Setup Not Available',
        message: errorMessage.includes('signed up for Connect') 
          ? 'Stripe Connect needs to be enabled in the platform settings. Please contact support.'
          : errorMessage,
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      this.isLoadingStripeConnect = false;
    }
  }

  // NEW: Edit existing Stripe Connect account
  async editStripeConnectAccount() {
    this.isLoadingStripeConnect = true;

    try {
      // Generate a Stripe dashboard login link
      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/payments/stripe-connect/dashboard`, {}, {
          headers: this.userService.getAuthHeadersSync()
        })
      );

      if (response.success && response.dashboardUrl) {
        // On mobile, open in same window (_self) to keep it within the app
        // On desktop, open in new tab (_blank)
        const target = this.platform.is('mobile') || this.platform.is('mobileweb') ? '_self' : '_blank';
        window.open(response.dashboardUrl, target);
        
        const toast = await this.toastController.create({
          message: 'Opening Stripe Express Dashboard...',
          duration: 3000,
          color: 'primary',
          position: 'top'
        });
        await toast.present();
      }
    } catch (error: any) {
      console.error('❌ Error opening Stripe dashboard:', error);
      
      // Fallback: restart onboarding
      const alert = await this.alertController.create({
        header: 'Update Payout Settings',
        message: 'Would you like to update your payout information?',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel'
          },
          {
            text: 'Update',
            handler: () => {
              this.startStripeConnectOnboarding();
            }
          }
        ]
      });
      await alert.present();
    } finally {
      this.isLoadingStripeConnect = false;
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

}
