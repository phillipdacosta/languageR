import { Component, OnInit, OnDestroy } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LoadingController, AlertController, ToastController, ModalController } from '@ionic/angular';
import { LessonAnalysis } from '../services/transcription.service';
import { UserService } from '../services/user.service';
import { LessonService } from '../services/lesson.service';
import { firstValueFrom, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { formatTimeInTz, formatDateInTz } from '../shared/timezone.utils';
import { CardManagementModalComponent } from '../components/card-management-modal/card-management-modal.component';
import { VocabularyService, VocabEntry, GoalEntry } from '../services/vocabulary.service';
import { ReviewDeckService } from '../services/review-deck.service';
import { LearningPlanService } from '../services/learning-plan.service';

type LessonRating = 'great' | 'okay' | 'not_so_good';
type RightPanelStep = 'rating' | 'sorry' | 'book';

interface LessonInfo {
  _id: string;
  subject: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  actualDurationMinutes?: number;
  price?: number; // Changed from lessonCost
  tutor: {
    _id: string;
    name: string;
    picture?: string;
    firstName?: string;
  };
  student: {
    _id: string;
    name: string;
    picture?: string;
  };
}

@Component({
  selector: 'app-post-lesson-student',
  templateUrl: './post-lesson-student.page.html',
  styleUrls: ['./post-lesson-student.page.scss'],
  standalone: false
})
export class PostLessonStudentPage implements OnInit, OnDestroy {
  lessonId: string = '';
  lesson: LessonInfo | null = null;
  tutor: any = null;
  analysis: LessonAnalysis | null = null;
  analysisReady = false;
  analysisUnavailable = false;
  
  // Trial lesson properties
  isTrialLesson = false;
  isPostCall = false; // True when arriving directly after a video call
  tutorFirstName = '';
  tutorDisplayName = 'Tutor';

  // Computed display properties (avoid function calls in template)
  pageTitle = '';
  pageSubtitle = '';
  lessonWithTutorTitle = '';
  lessonDateTime = '';
  lessonDurationLabel = '';
  lessonSubjectFallback = '';
  loadingLabel = '';
  tipCtaLabel = '';
  tipSentLabel = '';
  reviewLabel = '';
  seeProfileLabel = '';
  trialNextTitle = '';
  trialNextSub = '';
  analysisLoadingTitle = '';
  analysisLoadingSub = '';
  analysisUnavailableTitle = '';
  analysisUnavailableSub = '';
  analysisReadyTitle = '';
  analysisDetailsToggleLabel = '';
  viewFullAnalysisLabel = '';
  takeawaysTitle = '';
  vocabSectionTitle = '';
  vocabCountLabel = '';
  goalsSectionTitle = '';
  saveToDeckLabel = '';
  savedToDeckLabel = '';
  saveAllLabel = '';
  savingAllLabel = '';
  tipModalTitle = '';
  tipCustomPlaceholder = '';
  walletTabLabel = '';
  cardTabLabel = '';
  walletBalanceLabel = '';
  walletNoFeeNote = '';
  walletInsufficientNote = '';
  changeCardLabel = '';
  addCardLabel = '';
  addCardToTipLabel = '';
  cardFeeDetailNote = '';
  cardFeeGenericNote = '';
  tipSendButtonLabel = '';
  tipFootnote = '';
  lessonRatingQuestion = '';
  ratingQuestionLead = '';
  subheaderTitle = '';
  showSubheaderRatingLayout = false;
  showSubheaderEmoji = true;
  positiveEnjoyedTitle = '';
  ratingGreatLabel = '';
  ratingOkayLabel = '';
  ratingNotGoodLabel = '';
  sorryTitle = '';
  sorryBody = '';
  findNewTutorsLabel = '';
  giveAnotherShotLabel = '';
  stepBackLabel = '';

  // Right-panel step flow (rating → book | sorry → book)
  showLessonRatingOptions = true;
  lessonsCompletedWithTutor = 0;
  selectedLessonRating: LessonRating | null = null;
  rightPanelSteps: RightPanelStep[] = ['rating'];
  rightPanelStepIndex = 0;

  // AI analysis
  aiAnalysisEnabled = true;
  
  // Tip functionality
  showTipSection = false;
  selectedTipAmount: number | null = null;
  selectedTipPercentage: number | null = null;
  customTipAmount: number | null = null;
  tipSubmitted = false;
  submittingTip = false;
  tipAmount: number = 0;

  // Payment method selection for tips
  savedCards: any[] = [];
  selectedPaymentMethodId: string | null = null;
  loadingCards = false;
  hasLoadedCards = false;
  showCardPicker = false;

  // Wallet payment option for tips
  walletBalance: number = 0;
  selectedTipPaymentMethod: 'wallet' | 'card' = 'card'; // default to card

  // Card fee calculation — matches wallet-topup-modal logic
  // International cards: 4.4% + $0.30 | Domestic (US) cards: 2.9% + $0.30
  get isInternationalCard(): boolean {
    const card = this.savedCards.find(c => c.stripePaymentMethodId === this.selectedPaymentMethodId);
    return card?.country ? card.country !== 'US' : false;
  }

  get cardFeeRate(): number {
    return this.isInternationalCard ? 0.044 : 0.029;
  }

  get cardFeeLabel(): string {
    return this.isInternationalCard ? '4.4% + $0.30 (international card)' : '2.9% + $0.30';
  }

  get cardProcessingFee(): number {
    if (!this.tipAmount || this.tipAmount <= 0) return 0;
    const amountCents = Math.round(this.tipAmount * 100);
    const feeCents = Math.round(amountCents * this.cardFeeRate + 30);
    return feeCents / 100;
  }

  get tutorReceivesAfterFee(): number {
    return Math.max(0, this.tipAmount - this.cardProcessingFee);
  }

  private get userTz(): string | undefined {
    return this.userService.getCurrentUserValue()?.profile?.timezone || undefined;
  }
  
  // Vocabulary & Goals from lesson
  vocabItems: VocabEntry[] = [];
  goalItems: GoalEntry[] = [];
  savedVocabIds: Set<number> = new Set();
  savingVocabIndex: number | null = null;
  savingAllVocab = false;

  // Polling
  private pollingInterval: any = null;
  pollCount = 0;
  maxPollAttempts = 60;

  // Quick-summary cards are deliberately *qualitative* by default to
  // avoid making each lesson feel like an exam. Students can opt into
  // raw numbers via this toggle. Per-mount only — qualitative is always
  // the first read, no persisted preference.
  showAnalysisDetails = false;

  /** Pre-computed chips for the quick summary block. Built once when
   *  the analysis lands so the template never calls a function — see
   *  AGENTS.md "no functions in templates" rule. */
  quickSummaryChips: Array<{
    key: 'level' | 'vocabulary' | 'grammar';
    label: string;          // localized field name
    qualitative: string;    // "Strong", "Solid", "B1", "142 words"
    detail: string;         // raw value for the "Show details" toggle
    tone: 'neutral' | 'strong' | 'solid' | 'building' | 'needs_work';
  }> = [];

  private readonly destroy$ = new Subject<void>();

  toggleAnalysisDetails() {
    this.showAnalysisDetails = !this.showAnalysisDetails;
    this.analysisDetailsToggleLabel = this.showAnalysisDetails
      ? this.t('POST_LESSON.STUDENT.HIDE_SCORES')
      : this.t('POST_LESSON.STUDENT.SHOW_SCORES');
  }

  /** Map a 0–100 score → student-facing qualitative bucket + tone. */
  private qualitativeFromScore(score: number | null | undefined): { label: string; tone: 'neutral' | 'strong' | 'solid' | 'building' | 'needs_work' } {
    if (score === null || score === undefined || !Number.isFinite(score)) {
      return { label: '—', tone: 'neutral' };
    }
    if (score >= 80) return { label: 'Strong',     tone: 'strong' };
    if (score >= 60) return { label: 'Solid',      tone: 'solid' };
    if (score >= 40) return { label: 'Building',   tone: 'building' };
    return                    { label: 'Needs work', tone: 'needs_work' };
  }

  private rebuildQuickSummary() {
    if (!this.analysis) { this.quickSummaryChips = []; return; }
    const a: any = this.analysis;

    const level: string = a.overallAssessment?.proficiencyLevel || 'N/A';
    const vocabCount: number = a.vocabularyAnalysis?.uniqueWordCount || 0;
    const grammarScore: number | null =
      typeof a.grammarAnalysis?.accuracyScore === 'number' ? a.grammarAnalysis.accuracyScore : null;

    const grammarQ = this.qualitativeFromScore(grammarScore);

    this.quickSummaryChips = [
      {
        key: 'level',
        label: this.t('POST_LESSON.STUDENT.LEVEL'),
        qualitative: level,
        detail: level,
        tone: 'neutral'
      },
      {
        key: 'vocabulary',
        label: this.t('POST_LESSON.STUDENT.VOCABULARY'),
        qualitative: `${vocabCount} word${vocabCount === 1 ? '' : 's'}`,
        detail: `${vocabCount}`,
        tone: 'neutral'
      },
      {
        key: 'grammar',
        label: this.t('POST_LESSON.STUDENT.GRAMMAR'),
        qualitative: grammarQ.label,
        detail: grammarScore === null ? '—' : `${Math.round(grammarScore)}%`,
        tone: grammarQ.tone
      }
    ];
  }

  // Plan-update card (Phase 3 of the better-than-toast UX). Surfaces
  // freshly-fired pendingTransitions flags right after the lesson, with
  // intent-aligned CTAs. Acked here so the journey-page toast doesn't
  // re-fire later. Source: backend/services/learningPlanService.js.
  planUpdate: {
    kind: 'decay_warning' | 'human_intervention' | 'phase_split' | 'recovery_stuck';
    title: string;
    body: string;
    ctaLabel: string;
    ctaAction: 'message_tutor' | 'open_journey' | 'dismiss';
  } | null = null;
  private planUpdateLanguage: string | null = null;
  private planUpdateAcked = false;

  // "Want a plan?" soft prompt for students learning at their own pace or
  // with a paused plan. Backend gates eligibility (≥ 3 lessons since the
  // plan went unframed/paused, dismissal throttled to 30 days). Premium
  // users see a softer copy ("Premium still works without a plan — but a
  // roadmap can sharpen each lesson") instead of the marketing pitch.
  // Copy is precomputed (no template fns / pipes per AGENTS.md).
  softPlanPrompt: {
    mode: 'unframed' | 'paused';
    isPremium: boolean;
    lessonsSince: number;
    title: string;
    body: string;
    ctaLabel: string;
  } | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private userService: UserService,
    private lessonService: LessonService,
    private loadingCtrl: LoadingController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private modalCtrl: ModalController,
    private vocabularyService: VocabularyService,
    private reviewDeckService: ReviewDeckService,
    private location: Location,
    private learningPlanService: LearningPlanService,
    private translate: TranslateService
  ) {}

  async ngOnInit() {
    this.lessonId = this.route.snapshot.paramMap.get('id') || '';
    this.isPostCall = this.route.snapshot.queryParamMap.get('fromPostCall') === 'true';
    this.buildLocalizedStrings();
    this.translate.onLangChange.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.buildLocalizedStrings();
      this.updateLessonDisplay();
      if (this.analysis) {
        this.rebuildQuickSummary();
      }
    });
    console.log('🎓 POST-LESSON-STUDENT: Initializing with lessonId:', this.lessonId);
    
    // Wait for user to be loaded first
    await this.ensureUserLoaded();
    
    if (this.lessonId) {
      await this.loadLessonInfo();
      this.loadVocabulary();
      
      // Only poll for analysis if AI is enabled
      if (this.aiAnalysisEnabled && !this.isTrialLesson) {
        this.startAnalysisPolling();
      } else {
        console.log('⏭️ POST-LESSON-STUDENT: Skipping analysis polling (AI disabled or trial lesson)');
      }

      // Plan-update card (Phase 3 of the better-than-toast UX). Fire-and-forget.
      // Trial lessons don't update the learning plan, so skip there.
      if (!this.isTrialLesson) {
        this.loadPlanUpdate();
      }
    } else {
      console.error('❌ POST-LESSON-STUDENT: No lesson ID provided!');
    }
  }

  /**
   * Phase 3 of the better-than-toast UX. After every non-trial lesson we
   * check the student's learning plan for unacknowledged transition flags
   * (decay warning, human-intervention suggested, phase split). When set,
   * we surface a card on this recap with intent-aligned copy + CTA, and
   * acknowledge the flag so the journey-page toast doesn't re-fire later.
   *
   * For AI-enabled flows the flag is set by `updatePlanAfterLesson` before
   * we land here, so it's typically already set on first read. For
   * tutor-feedback-only flows the tutor still needs to submit feedback,
   * so the card may not appear immediately — the journey banner handles
   * those cases instead.
   */
  private async loadPlanUpdate() {
    try {
      const user = this.userService.getCurrentUserValue();
      const language = user?.onboardingData?.languages?.[0];
      if (!language) return;

      this.planUpdateLanguage = language;

      const res: any = await firstValueFrom(this.learningPlanService.getPlan(language));
      if (!res?.success || !res.plan) return;

      // "Want a plan?" soft prompt — only for plans without a structured
      // roadmap. Server attaches `softPlanPrompt.eligible` when ≥ 3 lessons
      // have happened since the plan went unframed / paused and the
      // 30-day dismissal throttle has elapsed.
      if (
        (res.plan.status === 'unframed' || res.plan.status === 'paused') &&
        res.plan.softPlanPrompt?.eligible
      ) {
        const mode: 'unframed' | 'paused' = res.plan.status;
        const isPremium = res.entitlements?.tier === 'premium';
        const title = mode === 'paused'
          ? 'Ready to pick your plan back up?'
          : 'Want a roadmap?';
        const body = mode === 'paused'
          ? (isPremium
              ? 'Resuming brings back your phases and tutor focus — premium analysis keeps running either way.'
              : 'You\'ve kept showing up. Resuming your plan picks up right where you left off.')
          : (isPremium
              ? 'Premium is doing its job — but a roadmap helps the AI tune each lesson to where you\'re going next.'
              : 'You\'ve taken a few lessons at your own pace. A short roadmap can sharpen each session — same lessons, with a clearer next step.');
        const ctaLabel = mode === 'paused' ? 'Resume my plan' : 'Build me a plan';

        this.softPlanPrompt = {
          mode,
          isPremium,
          lessonsSince: res.plan.softPlanPrompt.lessonsSince || 0,
          title,
          body,
          ctaLabel
        };
      }

      const flags = res.plan.pendingTransitions || {};
      // Order matters — we surface the highest-urgency flag first, and
      // ack only that one so a follow-up plays its part on the next lesson.
      // recoveryStuck (≥ 2 ping-pongs) is the loudest signal: the system
      // and the student keep bouncing between the same two chapter levels,
      // and the right move is to let the tutor reset expectations.
      if (flags.recoveryStuck) {
        this.planUpdate = {
          kind: 'recovery_stuck',
          title: "Let's catch our breath",
          body: "We've moved between two levels a couple of times. A short conversation with your tutor about pace and goals will sort this out far faster than another lesson.",
          ctaLabel: 'Message your tutor',
          ctaAction: 'message_tutor'
        };
      } else if (flags.humanInterventionSuggested) {
        this.planUpdate = {
          kind: 'human_intervention',
          title: 'A check-in might help',
          body: 'Your last few lessons have been bumpy. Talking to your tutor about your plan can get you back on track quickly.',
          ctaLabel: 'Message your tutor',
          ctaAction: 'message_tutor'
        };
      } else if (flags.decayWarning) {
        this.planUpdate = {
          kind: 'decay_warning',
          title: 'The last few lessons were tough',
          body: 'Your tutor will tailor the next session to help you catch up. No action needed — just keep showing up.',
          ctaLabel: 'Got it',
          ctaAction: 'dismiss'
        };
      } else if (flags.phaseSplit) {
        this.planUpdate = {
          kind: 'phase_split',
          title: 'We adjusted your plan',
          body: 'This phase was harder than expected, so we split it in two — same total length, more time to master it.',
          ctaLabel: 'See the change',
          ctaAction: 'open_journey'
        };
      }

      // Eager ack — once shown, clear the backend flag so the journey-page
      // toast doesn't replay it. The user may dismiss without reading,
      // but the recap is a high-attention surface so this is the right call.
      if (this.planUpdate) {
        this.ackPlanUpdate(); // fire and forget
      }
    } catch (err) {
      // Non-blocking — just no card.
      console.warn('[PostLesson] Plan-update card load failed:', err);
    }
  }

  private ackPlanUpdate() {
    if (this.planUpdateAcked || !this.planUpdate || !this.planUpdateLanguage) return;
    this.planUpdateAcked = true;
    const map: Record<string, 'decayWarning' | 'humanInterventionSuggested' | 'phaseSplit' | 'recoveryStuck'> = {
      decay_warning: 'decayWarning',
      human_intervention: 'humanInterventionSuggested',
      phase_split: 'phaseSplit',
      recovery_stuck: 'recoveryStuck'
    };
    const flag = map[this.planUpdate.kind];
    if (!flag) return;
    this.learningPlanService.ackTransition(this.planUpdateLanguage, flag).subscribe({
      next: () => {},
      error: () => { this.planUpdateAcked = false; }
    });
  }

  /** Card CTA tap. Routes to the right surface based on `ctaAction`. */
  onPlanUpdateCta() {
    if (!this.planUpdate) return;
    const action = this.planUpdate.ctaAction;
    this.dismissPlanUpdate();
    if (action === 'message_tutor' && this.tutor?._id) {
      this.router.navigate(['/messages'], { queryParams: { tutorId: this.tutor._id } });
    } else if (action === 'open_journey') {
      this.router.navigate(['/tabs/home/journey']);
    }
    // 'dismiss' → no navigation, just close the card.
  }

  /** Inline close button on the card. Already acked at load time. */
  dismissPlanUpdate() {
    this.planUpdate = null;
  }

  /** "Want a plan?" CTA — paused plans resume in place; unframed plans
   *  jump to the profile to add a goal (which then promotes the plan). */
  onSoftPlanPromptAccept() {
    if (!this.softPlanPrompt || !this.planUpdateLanguage) return;
    const mode = this.softPlanPrompt.mode;
    this.softPlanPrompt = null;

    if (mode === 'paused') {
      this.learningPlanService.resumePlan(this.planUpdateLanguage).subscribe({
        next: () => {
          this.toastCtrl.create({
            message: 'Your plan is back. Welcome back.',
            duration: 2500, position: 'top'
          }).then(t => t.present());
        },
        error: () => {}
      });
      return;
    }

    this.router.navigate(['/tabs/profile'], { queryParams: { editGoal: '1', from: 'post_lesson' } });
  }

  /** Dismiss the soft prompt (server-throttled for 30 days). */
  onSoftPlanPromptDismiss() {
    if (!this.softPlanPrompt || !this.planUpdateLanguage) {
      this.softPlanPrompt = null;
      return;
    }
    this.softPlanPrompt = null;
    this.learningPlanService.dismissSoftPlanPrompt(this.planUpdateLanguage).subscribe({
      next: () => {},
      error: () => {}
    });
  }

  private async ensureUserLoaded(): Promise<void> {
    try {
      const user = await firstValueFrom(this.userService.getCurrentUser());
      console.log('✅ POST-LESSON-STUDENT: User loaded:', user);
      console.log('✅ POST-LESSON-STUDENT: Current user email:', user?.email);
    } catch (error) {
      console.error('❌ POST-LESSON-STUDENT: Error loading user:', error);
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  private buildLocalizedStrings(): void {
    this.lessonSubjectFallback = this.t('POST_LESSON.STUDENT.LESSON');
    this.loadingLabel = this.t('POST_LESSON.STUDENT.LOADING');
    this.tipSentLabel = this.t('POST_LESSON.STUDENT.TIP_SENT');
    this.reviewLabel = this.t('POST_LESSON.STUDENT.REVIEW');
    this.seeProfileLabel = this.t('POST_LESSON.STUDENT.SEE_PROFILE');
    this.trialNextTitle = this.t('POST_LESSON.STUDENT.TRIAL_NEXT');
    this.analysisLoadingTitle = this.t('POST_LESSON.STUDENT.ANALYSIS_LOADING_TITLE');
    this.analysisLoadingSub = this.t('POST_LESSON.STUDENT.ANALYSIS_LOADING_SUB');
    this.analysisUnavailableTitle = this.t('POST_LESSON.STUDENT.ANALYSIS_NONE_TITLE');
    this.analysisUnavailableSub = this.t('POST_LESSON.STUDENT.ANALYSIS_NONE_SUB');
    this.analysisReadyTitle = this.t('POST_LESSON.STUDENT.ANALYSIS_READY');
    this.analysisDetailsToggleLabel = this.showAnalysisDetails
      ? this.t('POST_LESSON.STUDENT.HIDE_SCORES')
      : this.t('POST_LESSON.STUDENT.SHOW_SCORES');
    this.viewFullAnalysisLabel = this.t('POST_LESSON.STUDENT.VIEW_FULL');
    this.takeawaysTitle = this.t('POST_LESSON.STUDENT.TAKEAWAYS');
    this.vocabSectionTitle = this.t('POST_LESSON.STUDENT.VOCAB_SECTION');
    this.goalsSectionTitle = this.t('POST_LESSON.STUDENT.GOALS_SECTION');
    this.saveToDeckLabel = this.t('POST_LESSON.STUDENT.SAVE_TO_DECK');
    this.savedToDeckLabel = this.t('POST_LESSON.STUDENT.SAVED');
    this.saveAllLabel = this.t('POST_LESSON.STUDENT.SAVE_ALL');
    this.savingAllLabel = this.t('POST_LESSON.STUDENT.SAVING_ALL');
    this.tipCustomPlaceholder = this.t('POST_LESSON.STUDENT.TIP_CUSTOM');
    this.walletTabLabel = this.t('POST_LESSON.STUDENT.WALLET_TAB');
    this.cardTabLabel = this.t('POST_LESSON.STUDENT.CARD_TAB');
    this.walletBalanceLabel = this.t('POST_LESSON.STUDENT.WALLET_BALANCE');
    this.walletNoFeeNote = this.t('POST_LESSON.STUDENT.WALLET_NO_FEE');
    this.walletInsufficientNote = this.t('POST_LESSON.STUDENT.WALLET_INSUFFICIENT');
    this.changeCardLabel = this.t('POST_LESSON.STUDENT.CHANGE_CARD');
    this.addCardLabel = this.t('POST_LESSON.STUDENT.ADD_CARD');
    this.addCardToTipLabel = this.t('POST_LESSON.STUDENT.ADD_CARD_TO_TIP');
    this.tipFootnote = this.t('POST_LESSON.STUDENT.TIP_FOOTNOTE');
    this.ratingGreatLabel = this.t('POST_LESSON.STUDENT.RATING_GREAT');
    this.ratingOkayLabel = this.t('POST_LESSON.STUDENT.RATING_OKAY');
    this.ratingNotGoodLabel = this.t('POST_LESSON.STUDENT.RATING_NOT_GOOD');
    this.ratingQuestionLead = this.t('POST_LESSON.STUDENT.RATING_QUESTION_LEAD');
    this.sorryTitle = this.t('POST_LESSON.STUDENT.SORRY_TITLE');
    this.findNewTutorsLabel = this.t('POST_LESSON.STUDENT.FIND_NEW_TUTORS');
    this.stepBackLabel = this.t('POST_LESSON.STUDENT.STEP_BACK');
    this.cardFeeGenericNote = this.t('POST_LESSON.STUDENT.CARD_FEE_GENERIC', { label: this.cardFeeLabel });
    this.updateVocabCountLabel();
    this.updateTipLabels();
    if (this.tutorFirstName) {
      this.lessonRatingQuestion = this.t('POST_LESSON.STUDENT.RATING_QUESTION', { name: this.tutorFirstName });
      this.positiveEnjoyedTitle = this.t('POST_LESSON.STUDENT.POSITIVE_ENJOYED', { name: this.tutorFirstName });
      this.sorryBody = this.t('POST_LESSON.STUDENT.SORRY_BODY', { name: this.tutorFirstName });
      this.giveAnotherShotLabel = this.t('POST_LESSON.STUDENT.GIVE_ANOTHER_SHOT', { name: this.tutorFirstName });
    }
  }

  get currentRightPanelStep(): RightPanelStep {
    return this.rightPanelSteps[this.rightPanelStepIndex] ?? 'rating';
  }

  get canRightPanelGoBack(): boolean {
    return this.rightPanelStepIndex > 0;
  }

  get showRightPanelStepNav(): boolean {
    return this.showLessonRatingOptions && this.canRightPanelGoBack;
  }

  selectLessonRating(rating: LessonRating): void {
    this.selectedLessonRating = rating;
    if (rating === 'not_so_good') {
      this.pushRightPanelStep('sorry');
    } else {
      this.pushRightPanelStep('book');
    }
    this.updateSubheaderDisplay();
  }

  giveTutorAnotherShot(): void {
    this.pushRightPanelStep('book');
    this.updateSubheaderDisplay();
  }

  findNewTutors(): void {
    this.router.navigate(['/tabs/tutor-search']);
  }

  rightPanelGoBack(): void {
    if (!this.canRightPanelGoBack) return;
    this.rightPanelStepIndex--;
    this.updateSubheaderDisplay();
  }

  private pushRightPanelStep(step: RightPanelStep): void {
    if (this.rightPanelStepIndex < this.rightPanelSteps.length - 1) {
      this.rightPanelSteps = this.rightPanelSteps.slice(0, this.rightPanelStepIndex + 1);
    }
    if (this.rightPanelSteps[this.rightPanelSteps.length - 1] === step) {
      return;
    }
    this.rightPanelSteps = [...this.rightPanelSteps, step];
    this.rightPanelStepIndex = this.rightPanelSteps.length - 1;
  }

  private resetRightPanelFlow(): void {
    this.selectedLessonRating = null;
    if (this.showLessonRatingOptions) {
      this.rightPanelSteps = ['rating'];
    } else {
      this.rightPanelSteps = ['book'];
    }
    this.rightPanelStepIndex = 0;
    this.updateSubheaderDisplay();
  }

  private updateSubheaderDisplay(): void {
    const positiveRating =
      this.selectedLessonRating === 'great' || this.selectedLessonRating === 'okay';
    const onRatingStep = this.currentRightPanelStep === 'rating';
    const onSorryStep = this.currentRightPanelStep === 'sorry';
    const onBookAfterPositive =
      this.currentRightPanelStep === 'book' && positiveRating;
    const onBookAfterNegative =
      this.currentRightPanelStep === 'book' && this.selectedLessonRating === 'not_so_good';

    if (onRatingStep && this.tutor && this.showLessonRatingOptions) {
      this.showSubheaderRatingLayout = true;
      this.showSubheaderEmoji = false;
      this.subheaderTitle = '';
      return;
    }

    this.showSubheaderRatingLayout = false;

    if (onBookAfterPositive) {
      this.showSubheaderEmoji = true;
      this.subheaderTitle = this.positiveEnjoyedTitle;
      return;
    }

    if (onSorryStep) {
      this.showSubheaderEmoji = false;
      this.subheaderTitle = '';
      return;
    }

    if (onBookAfterNegative) {
      this.showSubheaderEmoji = false;
      this.subheaderTitle = this.trialNextTitle;
      return;
    }

    this.showSubheaderEmoji = true;
    this.subheaderTitle = this.pageTitle;
  }

  private updateLessonDisplay(): void {
    if (this.isTrialLesson) {
      this.pageTitle = this.t('POST_LESSON.STUDENT.GREAT_LESSON_TRIAL', { name: this.tutorFirstName });
      this.pageSubtitle = this.t('POST_LESSON.STUDENT.SUB_TRIAL', { name: this.tutorFirstName });
      this.trialNextSub = this.t('POST_LESSON.STUDENT.TRIAL_HINT');
    } else {
      this.pageTitle = this.t('POST_LESSON.STUDENT.GREAT_LESSON');
      this.pageSubtitle = this.t('POST_LESSON.STUDENT.SUB');
      this.trialNextSub = this.t('POST_LESSON.STUDENT.TRIAL_HINT');
    }
    this.lessonWithTutorTitle = this.t('POST_LESSON.STUDENT.LESSON_WITH', { name: this.tutorDisplayName });
    this.lessonDateTime = this.computeLessonDateTime();
    this.lessonDurationLabel = this.computeLessonDurationLabel();
    this.ratingQuestionLead = this.t('POST_LESSON.STUDENT.RATING_QUESTION_LEAD');
    this.lessonRatingQuestion = this.t('POST_LESSON.STUDENT.RATING_QUESTION', { name: this.tutorFirstName });
    this.positiveEnjoyedTitle = this.t('POST_LESSON.STUDENT.POSITIVE_ENJOYED', { name: this.tutorFirstName });
    this.sorryBody = this.t('POST_LESSON.STUDENT.SORRY_BODY', { name: this.tutorFirstName });
    this.giveAnotherShotLabel = this.t('POST_LESSON.STUDENT.GIVE_ANOTHER_SHOT', { name: this.tutorFirstName });
    this.updateTipLabels();
    this.updateSubheaderDisplay();
  }

  private computeLessonDateTime(): string {
    if (!this.lesson?.startTime) return '';
    const date = this.formatDate(this.lesson.startTime);
    const startTime = this.formatTime(this.lesson.startTime);
    const endTime = this.lesson.endTime ? this.formatTime(this.lesson.endTime) : '';
    if (endTime) {
      return `${date} · ${startTime} - ${endTime}`;
    }
    return `${date} · ${startTime}`;
  }

  private computeLessonDurationLabel(): string {
    if (!this.lesson) return '';
    const mins = this.lesson.actualDurationMinutes || this.lesson.duration;
    return mins ? this.t('POST_LESSON.STUDENT.MIN_LESSON', { mins }) : '';
  }

  private updateTipLabels(): void {
    this.tipCtaLabel = this.t('POST_LESSON.STUDENT.TIP_CTA', { name: this.tutorFirstName });
    this.tipModalTitle = this.t('POST_LESSON.STUDENT.TIP_MODAL', { name: this.tutorFirstName });
    this.updateTipPaymentNotes();
  }

  private updateTipPaymentNotes(): void {
    this.tipSendButtonLabel = this.tipAmount > 0
      ? this.t('POST_LESSON.STUDENT.TIP_SEND', { amount: this.tipAmount })
      : this.t('POST_LESSON.STUDENT.TIP_SEND', { amount: 0 });
    this.cardFeeDetailNote = this.t('POST_LESSON.STUDENT.CARD_FEE_DETAIL', {
      fee: this.cardProcessingFee.toFixed(2),
      label: this.cardFeeLabel,
      name: this.tutorFirstName,
      amount: this.tutorReceivesAfterFee.toFixed(2)
    });
    this.cardFeeGenericNote = this.t('POST_LESSON.STUDENT.CARD_FEE_GENERIC', { label: this.cardFeeLabel });
  }

  private updateVocabCountLabel(): void {
    const count = this.vocabItems.length;
    const wordKey = count === 1 ? 'POST_LESSON.STUDENT.WORD' : 'POST_LESSON.STUDENT.WORDS';
    this.vocabCountLabel = `${count} ${this.t(wordKey)}`;
  }

  async loadLessonInfo() {
    console.log('📚 POST-LESSON-STUDENT: Loading lesson info for:', this.lessonId);
    try {
      const response: any = await firstValueFrom(
        this.lessonService.getLesson(this.lessonId)
      );
      
      console.log('📚 POST-LESSON-STUDENT: Raw response:', response);
      
      if (response?.lesson) {
        this.lesson = response.lesson;
        // Backend returns tutorId and studentId, not tutor and student
        this.tutor = response.lesson.tutorId || response.lesson.tutor;
        console.log('✅ POST-LESSON-STUDENT: Lesson info loaded:', this.lesson);
        console.log('✅ POST-LESSON-STUDENT: Tutor info:', this.tutor);
        
        // Set trial lesson flag and tutor name properties
        this.isTrialLesson = response.lesson.isTrial || response.lesson.isTrialLesson || false;
        this.lessonsCompletedWithTutor =
          typeof response.lessonsCompleted === 'number' ? response.lessonsCompleted : 0;
        // Thumbs up/down flow is trial-only. Pair count is unreliable here because
        // post-lesson loads before the just-finished lesson is marked completed.
        this.showLessonRatingOptions = this.isTrialLesson;
        this.updateTutorProperties();
        this.resetRightPanelFlow();
        this.updateLessonDisplay();
        
        // Check if tip was already sent for this lesson
        if (response.lesson.tip && response.lesson.tip.amount) {
          this.tipSubmitted = true;
          console.log('💰 POST-LESSON-STUDENT: Tip already sent for this lesson:', response.lesson.tip.amount);
        }
        
        // Use the lesson snapshot of AI setting; fall back to live profile for legacy lessons
        const lesson = response.lesson;
        if (lesson.aiAnalysisEnabledAtTime !== null && lesson.aiAnalysisEnabledAtTime !== undefined) {
          this.aiAnalysisEnabled = lesson.aiAnalysisEnabledAtTime !== false;
          console.log('🤖 POST-LESSON-STUDENT: AI analysis (snapshot):', this.aiAnalysisEnabled);
        } else {
          const student = lesson.studentId;
          if (student && typeof student === 'object' && student.profile && student.profile.aiAnalysisEnabled === false) {
            this.aiAnalysisEnabled = false;
          } else {
            this.aiAnalysisEnabled = true;
          }
          console.log('🤖 POST-LESSON-STUDENT: AI analysis (live fallback):', this.aiAnalysisEnabled);
        }
      } else {
        console.warn('⚠️ POST-LESSON-STUDENT: Response missing lesson data');
      }
    } catch (error) {
      console.error('❌ POST-LESSON-STUDENT: Error loading lesson info:', error);
    }
  }

  private updateTutorProperties() {
    if (!this.tutor) {
      this.tutorFirstName = '';
      this.tutorDisplayName = 'Tutor';
      return;
    }
    
    this.tutorFirstName = this.tutor.firstName || this.tutor.name?.split(' ')[0] || '';
    
    const firstName = this.tutor.firstName || this.tutor.name?.split(' ')[0];
    const lastName = this.tutor.lastName || this.tutor.name?.split(' ')[1];
    
    if (firstName && lastName) {
      this.tutorDisplayName = `${firstName} ${lastName.charAt(0)}.`;
    } else {
      this.tutorDisplayName = this.tutor.name || 'Tutor';
    }
  }

  startAnalysisPolling() {
    // Initial load
    this.checkAnalysis();
    
    // Poll every 3 seconds
    this.pollingInterval = setInterval(async () => {
      this.pollCount++;
      if (this.pollCount >= this.maxPollAttempts) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
        // One final check before giving up, so an analysis that just completed
        // (or was just resolved to insufficient_data) isn't missed by timing.
        await this.checkAnalysis();
        if (!this.analysisReady && !this.analysisUnavailable) {
          this.analysisUnavailable = true;
          console.log('⏰ Max poll attempts reached — marking analysis unavailable');
        }
        return;
      }
      this.checkAnalysis();
    }, 3000);
  }

  async checkAnalysis() {
    try {
      const headers = this.userService.getAuthHeadersSync();
      console.log('🔑 POST-LESSON-STUDENT: Auth headers for analysis check:', headers);
      
      const response: any = await firstValueFrom(
        this.http.get(`${environment.apiUrl}/transcription/lesson/${this.lessonId}/analysis`, { headers })
      );
      
      const status = response?.analysis?.status;
      
      if (status === 'completed') {
        this.analysis = response.analysis;
        this.analysisReady = true;
        this.rebuildQuickSummary();
        if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
        }
        console.log('✅ Analysis ready:', this.analysis);
      } else if (status === 'insufficient_data' || status === 'failed') {
        this.analysisUnavailable = true;
        if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
        }
        console.log(`⚠️ Analysis ${status}:`, response?.analysis?.error || 'No details');
      }
    } catch (error: any) {
      if (error.status === 404 && error.error?.status === 'unavailable') {
        this.analysisUnavailable = true;
        if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
        }
        console.log('⚠️ Analysis will never be generated:', error.error?.transcriptStatus);
      } else if (error.status !== 404) {
        console.error('Error checking analysis:', error);
      }
    }
  }

  toggleTipSection() {
    this.showTipSection = !this.showTipSection;
    if (this.showTipSection && !this.hasLoadedCards) {
      this.loadSavedCards();
    }
  }

  async loadSavedCards() {
    this.loadingCards = true;
    try {
      const headers = this.userService.getAuthHeadersSync();

      // Load cards and wallet balance in parallel
      const [cardsResponse, walletResponse]: any[] = await Promise.all([
        firstValueFrom(this.http.get(`${environment.apiUrl}/payments/payment-methods`, { headers })),
        firstValueFrom(this.http.get(`${environment.apiUrl}/wallet/balance`, { headers })).catch(() => null)
      ]);

      if (cardsResponse.success && cardsResponse.paymentMethods) {
        this.savedCards = cardsResponse.paymentMethods.filter((pm: any) => pm.type === 'card');
        // Auto-select default card
        const defaultCard = this.savedCards.find((c: any) => c.isDefault);
        if (defaultCard) {
          this.selectedPaymentMethodId = defaultCard.stripePaymentMethodId;
        } else if (this.savedCards.length > 0) {
          this.selectedPaymentMethodId = this.savedCards[0].stripePaymentMethodId;
        }
      }

      // Load wallet balance
      if (walletResponse?.success) {
        this.walletBalance = walletResponse.availableBalance || 0;
      }

      // Auto-select wallet if it has a balance, otherwise default to card
      if (this.walletBalance > 0) {
        this.selectedTipPaymentMethod = 'wallet';
      } else {
        this.selectedTipPaymentMethod = 'card';
      }

      this.hasLoadedCards = true;
    } catch (error) {
      console.error('Error loading saved cards:', error);
    } finally {
      this.loadingCards = false;
    }
  }

  selectPaymentMethod(card: any) {
    this.selectedPaymentMethodId = card.stripePaymentMethodId;
    this.updateTipPaymentNotes();
  }

  selectTipAmount(amount: number) {
    this.selectedTipAmount = amount;
    this.selectedTipPercentage = null;
    this.customTipAmount = null;
    this.updateTipAmount();
  }

  selectTipPercentage(percentage: number) {
    this.selectedTipPercentage = percentage;
    this.selectedTipAmount = null;
    this.customTipAmount = null;
    this.updateTipAmount();
  }

  onCustomTipInput() {
    this.selectedTipAmount = null;
    this.selectedTipPercentage = null;
    this.updateTipAmount();
  }

  private updateTipAmount() {
    this.tipAmount = this.getTipAmount();
    this.updateTipPaymentNotes();
  }

  calculatePercentageTip(percentage: number): number {
    if (!this.lesson?.price) return 0;
    // Don't round - show exact percentage amount with cents
    return Math.round((this.lesson.price * percentage / 100) * 100) / 100;
  }

  getTipAmount(): number {
    if (this.customTipAmount && this.customTipAmount > 0) {
      return this.customTipAmount;
    }
    if (this.selectedTipAmount) {
      return this.selectedTipAmount;
    }
    if (this.selectedTipPercentage) {
      return this.calculatePercentageTip(this.selectedTipPercentage);
    }
    return 0;
  }

  async submitTip() {
    const tipAmount = this.getTipAmount();
    if (tipAmount <= 0 || this.submittingTip) return;

    // Confirmation popup
    const confirm = await this.alertCtrl.create({
      header: 'Confirm tip',
      message: `Send a $${tipAmount.toFixed(2)} tip to ${this.tutorFirstName}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Send tip', role: 'confirm' }
      ]
    });
    await confirm.present();
    const { role } = await confirm.onDidDismiss();
    if (role !== 'confirm') return;

    this.submittingTip = true;

    try {
      const headers = this.userService.getAuthHeadersSync();
      const body: any = { amount: tipAmount };

      if (this.selectedTipPaymentMethod === 'wallet') {
        body.useWallet = true;
      } else if (this.selectedPaymentMethodId) {
        body.paymentMethodId = this.selectedPaymentMethodId;
      }
      const response: any = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/lessons/${this.lessonId}/tip`, body, { headers })
      );

      if (response.success) {
        this.tipSubmitted = true;
        this.showTipSection = false;
        
        const toast = await this.toastCtrl.create({
          message: `$${tipAmount.toFixed(2)} tip sent to ${this.tutorFirstName}!`,
          duration: 3000,
          color: 'success',
          position: 'top'
        });
        await toast.present();
      }
    } catch (error: any) {
      console.error('Error submitting tip:', error);
      
      const errorMessage = error.error?.error || 'Failed to send tip. Please try again.';
      const isNoPaymentMethod = errorMessage.toLowerCase().includes('payment method') 
        || errorMessage.toLowerCase().includes('no card');
      
      if (isNoPaymentMethod) {
        // Offer to add a card right here
        const alert = await this.alertCtrl.create({
          header: 'No payment method',
          message: 'You need a card on file to send a tip. Would you like to add one now?',
          buttons: [
            { text: 'Not now', role: 'cancel' },
            { 
              text: 'Add card', 
              handler: () => { this.openCardManagement(); }
            }
          ]
        });
        await alert.present();
      } else {
        const alert = await this.alertCtrl.create({
          header: 'Tip failed',
          message: errorMessage,
          buttons: ['OK']
        });
        await alert.present();
      }
    } finally {
      this.submittingTip = false;
    }
  }

  async leaveReview() {
    // Navigate to tutor profile with review section
    if (this.tutor) {
      await this.router.navigate(['/tabs/profile'], {
        queryParams: { userId: this.tutor._id, action: 'review' }
      });
    }
  }

  async bookAgain() {
    // Navigate to tutor profile to book
    if (this.tutor) {
      await this.router.navigate(['/tutor', this.tutor._id]);
    }
  }

  goBack() {
    if (this.isPostCall) {
      // Came directly from video call — don't return to the call page
      this.router.navigate(['/tabs/home']);
    } else {
      this.location.back();
    }
  }

  formatDate(date: Date): string {
    return formatDateInTz(new Date(date), this.userTz, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  formatTime(date: Date): string {
    return formatTimeInTz(new Date(date), this.userTz);
  }

  async openCardManagement() {
    const modal = await this.modalCtrl.create({
      component: CardManagementModalComponent,
      cssClass: 'card-management-modal'
    });
    
    await modal.present();
    
    const { data } = await modal.onDidDismiss();
    // Always reload cards to stay in sync
    await this.loadSavedCards();

    // Only show toast if cards were actually added or deleted
    if (data?.cardsUpdated) {
      const toast = await this.toastCtrl.create({
        message: 'Card saved! You can now send your tip.',
        duration: 3000,
        color: 'success',
        position: 'top'
      });
      await toast.present();
    }
  }

  viewFullAnalysis() {
    this.router.navigate(['/lesson-analysis', this.lessonId]);
  }

  // ═══════════════════════════════════════════════════════
  // VOCABULARY & GOALS
  // ═══════════════════════════════════════════════════════
  
  private loadVocabulary() {
    if (!this.lessonId) return;
    
    this.vocabularyService.getVocabulary(this.lessonId).subscribe({
      next: (response) => {
        if (response?.data) {
          this.vocabItems = response.data.vocabulary || [];
          this.goalItems = response.data.goals || [];
          this.updateVocabCountLabel();
        }
      },
      error: (err) => {
        console.warn('Could not load vocabulary for post-lesson:', err);
      }
    });
  }
  
  async saveVocabToReviewDeck(item: VocabEntry, index: number) {
    if (this.savedVocabIds.has(index)) return;
    
    this.savingVocabIndex = index;
    
    try {
      await firstValueFrom(this.reviewDeckService.saveItem({
        original: item.word,
        corrected: item.translation,
        explanation: item.example || '',
        context: `Vocabulary from lesson`,
        language: this.lesson?.subject || 'Spanish',
        errorType: 'vocabulary',
        lessonId: this.lessonId
      }));
      
      this.savedVocabIds.add(index);
      
      const toast = await this.toastCtrl.create({
        message: `"${item.word}" saved to Review Deck`,
        duration: 2000,
        color: 'success',
        position: 'top'
      });
      await toast.present();
    } catch (error) {
      console.error('Error saving vocab to review deck:', error);
      const toast = await this.toastCtrl.create({
        message: 'Could not save to Review Deck',
        duration: 2000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    } finally {
      this.savingVocabIndex = null;
    }
  }
  
  async saveAllVocabToReviewDeck() {
    if (this.savingAllVocab) return;
    
    this.savingAllVocab = true;
    
    const unsavedItems = this.vocabItems
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => !this.savedVocabIds.has(index));
    
    if (unsavedItems.length === 0) {
      this.savingAllVocab = false;
      return;
    }
    
    try {
      const batchItems = unsavedItems.map(({ item }) => ({
        original: item.word,
        corrected: item.translation,
        explanation: item.example || '',
        context: `Vocabulary from lesson`,
        language: this.lesson?.subject || 'Spanish',
        errorType: 'vocabulary' as const,
        lessonId: this.lessonId
      }));
      
      await firstValueFrom(this.reviewDeckService.saveMultiple(batchItems));
      
      // Mark all as saved
      unsavedItems.forEach(({ index }) => this.savedVocabIds.add(index));
      
      const toast = await this.toastCtrl.create({
        message: `${unsavedItems.length} words saved to Review Deck`,
        duration: 2500,
        color: 'success',
        position: 'top'
      });
      await toast.present();
    } catch (error) {
      console.error('Error batch saving vocab:', error);
      const toast = await this.toastCtrl.create({
        message: 'Could not save all words. Try saving them individually.',
        duration: 3000,
        color: 'warning',
        position: 'top'
      });
      await toast.present();
    } finally {
      this.savingAllVocab = false;
    }
  }
}

