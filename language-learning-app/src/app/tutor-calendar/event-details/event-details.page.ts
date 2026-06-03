import { Component, OnInit, OnDestroy, ChangeDetectorRef, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Location } from '@angular/common';
import { IonicModule, ModalController, ToastController, LoadingController, ViewWillEnter, ViewDidEnter } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { LessonService, Lesson, CachedLessonDetailBundle } from '../../services/lesson.service';
import { EarningsPage } from '../../earnings/earnings.page';
import { AnalysisTranslationService } from '../../services/analysis-translation.service';
import { ClassService } from '../../services/class.service';
import { UserService, User } from '../../services/user.service';
import { TutorFeedbackService, TutorFeedback } from '../../services/tutor-feedback.service';
import { SharedModule } from '../../shared/shared.module';
import { TutorAvailabilitySelectionModalComponent } from '../../components/tutor-availability-selection-modal/tutor-availability-selection-modal.component';
import { FlipTransitionService } from '../../services/flip-transition.service';
import { PlatformService } from '../../services/platform.service';
import { WalletService } from '../../services/wallet.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { environment } from '../../../environments/environment';
import { CancelReasonModalComponent } from '../../components/cancel-reason-modal/cancel-reason-modal.component';
import { ClassAttendeesComponent } from '../../components/class-attendees/class-attendees.component';
import { ClassInvitationModalComponent } from '../../components/class-invitation-modal/class-invitation-modal.component';
import { ClassGoingMessageModalComponent } from '../../components/class-going-message-modal/class-going-message-modal.component';
import { ConfirmActionModalComponent } from '../../components/confirm-action-modal/confirm-action-modal.component';
import { RescheduleLessonModalComponent } from '../../components/reschedule-lesson-modal/reschedule-lesson-modal.component';
import { formatTimeInTz, formatDateInTz } from '../../shared/timezone.utils';
import { MaterialService, TutorMaterial } from '../../services/material.service';
import { LearningPlanService, LearningPlanSummary, LessonPrep } from '../../services/learning-plan.service';

const GOAL_TYPE_I18N_KEYS: Record<string, string> = {
  conversational: 'LEARNING_PLAN.GOAL_LABEL_CONVERSATIONAL',
  exam_prep: 'LEARNING_PLAN.GOAL_LABEL_EXAM_PREP',
  professional: 'LEARNING_PLAN.GOAL_LABEL_PROFESSIONAL',
  travel: 'LEARNING_PLAN.GOAL_LABEL_TRAVEL',
  relocation: 'LEARNING_PLAN.GOAL_LABEL_RELOCATION',
  other: 'LEARNING_PLAN.GOAL_LABEL_OTHER',
};
import { WebSocketService } from '../../services/websocket.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import {
  isLessonMockId,
  buildMockLessonEntity,
  getMockBillingAndPayment,
  getMockRecommendedMaterials,
  getMockLearningPlanContext,
} from '../../lessons/lesson-mock-preview';
import { MOCK_CLASS_ATTENDEES_PREVIEW } from '../../constants/mock-class-attendees-preview';

// ── Interfaces ──────────────────────────────────────────────────
interface AnalysisData {
  _id?: string;
  overallAssessment?: {
    proficiencyLevel?: string;
    confidence?: number;
    summary?: string;
    progressFromLastLesson?: string;
  };
  grammarAnalysis?: {
    mistakeTypes?: { type: string; examples: string[]; frequency: number; severity: string }[];
    suggestions?: string[];
    accuracyScore?: number;
  };
  vocabularyAnalysis?: {
    wordsUsed?: string[];
    uniqueWordCount?: number;
    vocabularyRange?: string;
    suggestedWords?: string[];
    advancedWordsUsed?: string[];
  };
  fluencyAnalysis?: {
    speakingSpeed?: string;
    pauseFrequency?: string;
    fillerWords?: { count: number; examples: string[] };
    overallFluencyScore?: number;
  };
  pronunciationAnalysis?: {
    overallScore?: number;
    accuracyScore?: number;
    fluencyScore?: number;
    prosodyScore?: number;
  };
  topicsDiscussed?: string[];
  recommendedFocus?: string[];
  suggestedExercises?: string[];
  homeworkSuggestions?: string[];
  studentSummary?: string;
  tutorNote?: {
    text?: string;
    quickImpression?: string;
    homework?: string;
    addedAt?: string;
  };
  source?: string;
  status?: string;
  translations?: Record<string, any>;
}

interface BillingData {
  estimatedPrice?: number;
  actualPrice?: number;
  estimatedDuration?: number;
  actualDuration?: number;
  status?: string;
  callStartTime?: string;
  callEndTime?: string;
  isOfficeHours?: boolean;
}

type RecommendedMaterialDisplay = TutorMaterial & {
  isSaved?: boolean;
  _matchedStruggles?: string[];
  _isCurrentTutor?: boolean;
  _typeIcon?: string;
  _typeLabel?: string;
};

@Component({
  selector: 'app-event-details',
  templateUrl: './event-details.page.html',
  styleUrls: ['./event-details.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, SharedModule, TranslateModule, CancelReasonModalComponent, ConfirmActionModalComponent, RescheduleLessonModalComponent, ClassAttendeesComponent, ClassInvitationModalComponent, ClassGoingMessageModalComponent]
})
export class EventDetailsPage implements OnInit, OnDestroy, ViewWillEnter, ViewDidEnter {
  /** When presented as a modal, the caller passes the event ID directly */
  @Input() modalEventId?: string;
  /** When true, back/close dismisses the modal instead of navigating */
  @Input() isModal = false;

  eventId: string | null = null;
  lesson: any = null;
  classData: any = null;
  isClass = false;
  currentUser: User | null = null;
  loading = true;
  error: string | null = null;
  sanitizedDescription: SafeHtml = '';

  // Role
  userRole: 'tutor' | 'student' = 'student';
  isTutorUser = false;
  isStudentUser = false;

  // Analysis & Feedback
  analysisData: AnalysisData | null = null;
  analysisLoading = false;
  tutorFeedback: TutorFeedback | null = null;
  feedbackLoading = false;
  billingData: BillingData | null = null;

  // Pre-computed template properties (no functions in template)
  statusLabel = '';
  statusColor = '';
  statusClass = '';

  canJoinLesson = false;
  joinLabel = 'Join';
  isLessonInProgress = false;
  canCancelLesson = false;
  showJoinButton = false;

  // Formatted data
  formattedDate = '';
  formattedTimeRange = '';
  formattedDuration = '';
  formattedPrice = '';
  formattedActualPrice = '';
  formattedActualDuration = '';

  // Participant info
  participantName = '';
  participantEmail = '';
  participantPicture = '';
  participantInitial = '';
  participantRole = ''; // legacy; prefer participantRoleDisplay
  /** Localized sidebar role label (student vs tutor). */
  participantRoleDisplay = '';
  participantCountry = '';
  tutorId: string | null = null; // For navigation to tutor profile (students only)

  // Sidebar info
  participantBio = '';
  participantLanguages: string[] = [];
  participantRate = '';
  participantRating = '';
  participantExperienceLevel = '';
  participantGoals: string[] = [];
  participantNativeLanguage = '';
  participantId: string | null = null;
  lessonsWithParticipant = 0;
  recentLessons: { _id: string; subject: string; dateLabel: string; durationLabel: string }[] = [];

  // Tutor stats (student view)
  tutorStatsRating = '';
  tutorStatsRatingRounded = 0;
  tutorStatsTotalLessons = 0;
  tutorStatsStudents = 0;
  tutorAvailableNow = false;

  // Content channels & materials
  hasLinkedChannels = false;
  linkedChannels: any = null;
  tutorMaterials: (TutorMaterial & { _addedDate?: string; _typeIcon?: string; _typeLabel?: string })[] = [];
  materialsSectionExpanded = true;

  // Learning plan context (student + tutor)
  edPlanGoalLabel = '';
  edPlanPhaseLabel = '';
  edPlanNextFocus = '';
  edPlanStudentSummary = '';
  edPlanFocusAreas: string[] = [];
  edPlanSuggestedTopics: string[] = [];
  edPlanAgenda: string[] = [];
  edPlanMetaLine = '';
  edPlanTopicChips: string[] = [];
  edPlanEyebrowKey = 'EVENT_DETAILS.LESSON_SCREEN.LESSON_OBJECTIVE';
  // Trial / first-pairing calibration framing. A brand-new pair's trial is a
  // meet-and-greet to gauge level — not a plan checkpoint — so the objective
  // is swapped for a calibration line and phase topics/agenda are hidden.
  edPlanIsTrial = false;
  edPlanTrialBody = '';
  // Small "Draft plan" chip so draft-vs-active is legible on the lesson itself.
  edPlanStateLabel = '';
  edShowPlanExpanded = false;
  edShowTutorBriefing = false;
  edPrepShowPersistentChallenges = false;
  notesSectionLabelKey = 'EVENT_DETAILS.LESSON_SCREEN.NOTES';
  showLessonNotesSection = false;
  showTutorPrivateNotes = false;
  edHasPlan = false;
  private edPlanSummary: LearningPlanSummary | null = null;

  // Pre-lesson briefing (tutor only) — populated alongside plan summary.
  // Combines plan + latest analysis + a short deterministic agenda.
  edPrep: LessonPrep | null = null;
  edPrepHasContent = false;
  edPrepMasteryLabel = '';
  edPrepMasteryPercent = 0;
  edPrepProficiencyChangeIcon: 'arrow-up-outline' | 'remove-outline' | 'arrow-down-outline' | null = null;
  edPrepProficiencyChangeLabel = '';
  edPrepBriefingExpanded = false;
  // Compact phase pill — surfaced in the briefing header so the tutor
  // sees the student's current phase without expanding anything.
  edPrepPhasePillLabel = '';
  edPrepPhasePillIndex = '';
  // True when the tutor has never completed a lesson with this student
  // in this language. Drives the auto-expand + a small badge.
  edPrepFirstTimePairing = false;
  // True when the student has personally edited the active phase. Drives
  // a small "Personalised by student" pill in the briefing header — a
  // high-signal cue that the framing reflects the student's own priorities.
  edPrepStudentEdited = false;

  // Tip info
  hasTip = false;
  tipAmount = '';
  tipDate = '';
  tipStripeFee = '';
  tipTutorReceived = '';
  tipHasFee = false;
  tipMessage = '';

  // Payment method info (student only)
  paymentMethodLabel = '';
  paymentMethodIcon = '';

  // Cancellation info
  isCancelled = false;
  cancelledByLabel = '';
  cancelReasonLabel = '';
  cancelledAtLabel = '';

  // Issue info
  hasIssue = false;
  isIssueReporter = false;
  issueTypeLabel = '';
  issueDetailsText = '';
  issueDate = '';
  isUnderInvestigation = false;
  isInvestigationResolved = false;
  investigationResolutionLabel = '';

  // Reschedule info
  hasReschedule = false;
  rescheduleStatus = '';
  proposedTimeRange = '';

  // Analysis display
  hasAnalysis = false;
  analysisUnavailable = false;
  isAiAnalysis = false;     // true = AI-generated, false = tutor-sourced
  analysisLabel = 'Analysis'; // Dynamic section label
  hasTutorNote = false;
  hasTutorFeedback = false;

  // Last session context (for upcoming lessons)
  hasFirstLessonContext = false;
  firstLessonMessage = '';
  hasLastSessionContext = false;
  lastSessionSummary = '';
  lastSessionFocus: string[] = [];
  lastSessionCanTranslate = false;
  lastSessionTranslating = false;
  lastSessionShowingTranslation = false;
  private lastSessionOriginalSummary = '';
  private lastSessionOriginalFocus: string[] = [];
  private lastSessionTranslatedSummary = '';
  private lastSessionTranslatedFocus: string[] = [];

  // Unified page translation (one button for all dynamic prose)
  pageCanTranslate = false;
  pageTranslating = false;
  pageShowingTranslation = false;
  private pageOriginals: {
    lastSessionSummary: string;
    lastSessionFocus: string[];
    analysisData: any;
    feedbackStrengths: string[];
    feedbackImprovements: string[];
    feedbackNotes: string;
    edPlanNextFocus: string;
    edPlanGoalLabel: string;
    edPlanPhaseLabel: string;
    edPlanMetaLine: string;
    edPlanTopicChips: string[];
    edPlanAgenda: string[];
    edPrep: LessonPrep | null;
    cancelReasonLabel: string;
    issueDetailsText: string;
    lessonNotes: string;
    recommendedStruggles: string[];
    recommendedMaterials: RecommendedMaterialDisplay[];
  } | null = null;

  // Previous lesson notes for this tutor-student pair
  previousNotesData: any = null;
  hasPreviousNotes = false;
  /** True after getPreviousNotes resolves and there is no prior lesson summary for the sidebar */
  showSidebarNotesEmpty = false;
  sidebarNotesEmptyDescKey = 'EVENT_DETAILS.SIDEBAR_NOTES_EMPTY_DESC_STUDENT';
  previousNotesIsAiSource = false;
  previousNotesDate = '';
  previousNotesSanitized: SafeHtml | null = null;

  // Unified sidebar notes (shows current lesson analysis OR previous notes)
  sidebarNotesSource: 'current' | 'previous' | null = null;
  sidebarNotesTitle = '';
  sidebarNotesDateSub = '';
  sidebarNotesAnalysis: any = null;
  sidebarNotesOriginalAnalysis: any = null;
  sidebarNotesIsAi = false;
  sidebarNotesSanitized: SafeHtml | null = null;
  hasSidebarNotes = false;
  sidebarNotesLessonId: string | null = null;
  sidebarNotesAnalysisId: string | null = null;
  sidebarNotesTranslating = false;
  sidebarNotesShowingTranslation = false;
  sidebarNotesTranslationCache: any = null;
  private translationSub?: Subscription;
  private langChangeSub?: Subscription;
  private classStateSub?: Subscription;
  private activeClassRoomId: string | null = null;

  // Pre-computed score colors (no functions in template)
  grammarScoreColor = '#6b7280';
  fluencyScoreColor = '#6b7280';
  pronunciationScoreColor = '#6b7280';

  // Class-specific pre-computed
  levelLabel = '';
  classRevenue = '';
  /**
   * Auto-cancel rule shown in the Students section. Mirrors the wizard hint
   * (`schedule-class.page.html`) so students + tutors see the exact promise
   * the tutor made when scheduling. Computed once in `populateClassDetails`
   * to keep the template free of method calls (see AGENTS.md).
   */
  classRuleVisible = false;
  classRuleKind: 'flexible' | 'min' | null = null;
  classRuleIcon = '';
  classRuleText = '';

  // Class payment status
  hasClassPaymentStatus = false;
  classPaymentStatusIcon = '';
  classPaymentStatusTitle = '';
  classPaymentStatusDescription = '';
  classPaymentStatusClass = '';
  classPaymentDetails: { key: string; value: string }[] = [];

  // Tutor feedback display
  feedbackStrengths: string[] = [];
  feedbackImprovements: string[] = [];
  feedbackSectionExpanded = false; // Collapsible state for tutor view (closed by default)
  cancellationSectionExpanded = false;
  paymentStatusSectionExpanded = false;
  feedbackNotes = '';
  feedbackCefrLevel = '';
  feedbackDate = '';
  sanitizedTutorNote: SafeHtml = '';

  // Feedback status (banner)
  isLessonCompleted = false;
  feedbackProvided = false;
  feedbackPending = false;
  showFeedbackStatusSection = false;
  tutorDisplayName = ''; // "Phillip D." — for student view

  // Payment status (financial outcome)
  paymentData: any = null;
  hasPaymentStatus = false;
  paymentStatusIcon = '';
  paymentStatusTitle = '';
  paymentStatusDescription = '';
  paymentStatusClass = '';   // 'refunded' | 'partial' | 'cancelled' | 'paid' | 'on-hold'
  paymentStatusDetails: { key: string; value: string }[] = [];

  // Class students display
  classStudentsDisplay: { name: string; picture?: string; initials: string; paid?: boolean }[] = [];
  /** Class details grid: stacked avatars — real `confirmedStudents`, or preview mocks when empty (same as Up Next). */
  classAttendeesForGridStack: any[] = [];
  /** Omit when showing preview mocks so capacity does not contradict the stats row (e.g. 0/6). */
  classAttendeesForGridCapacity: number | undefined = undefined;
  /** Student + at least one confirmed classmate: GOING / Students areas open the message tutor modal. */
  classCanOpenGoingMessage = false;
  /** Tutor broadcast recipients (confirmed student ids) for the GOING modal. */
  classGoingReceiverIds: string[] = [];

  // Class layout (matching lesson layout)
  classTutorName = '';
  classTutorPicture = '';
  classTutorInitial = '';
  classTutorBio = '';
  classTutorId: string | null = null;
  classTutorLanguages: string[] = [];
  classTutorCountry = '';
  classIsCurrentUserTutor = false;
  classShowJoinButton = false;
  classCanJoin = false;
  classJoinLabel = 'Join';
  classCanCancel = false;
  classCanReschedule = false;
  /** Student-only: confirmed in a scheduled class → allowed to leave/unenroll. */
  classCanLeave = false;
  /** Student class CTA: accept tutor invite, public enroll, or join session when enrolled. */
  classStudentCtaKind: 'accept_invite' | 'enroll' | 'join_session' | null = null;
  classStudentPrimaryDisabled = false;
  classIsCancelled = false;
  classIsCompleted = false;
  classStudentsPaidCount = 0;

  // Recommended materials (student only)
  recommendedMaterials: RecommendedMaterialDisplay[] = [];
  recommendedStruggles: string[] = [];
  recommendedLoading = false;
  hasRecommendations = false;

  // Countdown
  private countdownInterval: any;
  private pendingRequests = 0;
  /** True while a background cache-revalidation is running — suppresses loading flips. */
  private isRevalidating = false;

  private get userTz(): string | undefined {
    return this.currentUser?.profile?.timezone || undefined;
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private lessonService: LessonService,
    private classService: ClassService,
    private userService: UserService,
    private tutorFeedbackService: TutorFeedbackService,
    private platformService: PlatformService,
    private walletService: WalletService,
    private sanitizer: DomSanitizer,
    private modalController: ModalController,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private location: Location,
    private flipTransition: FlipTransitionService,
    private cdr: ChangeDetectorRef,
    private materialService: MaterialService,
    private learningPlanService: LearningPlanService,
    private analysisTranslation: AnalysisTranslationService,
    private webSocketService: WebSocketService,
    private translate: TranslateService
  ) {}

  ionViewWillEnter() {
    this.syncTranslationOnEnter();
  }

  ionViewDidEnter() {
    this.syncTranslationOnEnter();
  }

  private syncTranslationOnEnter() {
    if (!this.sidebarNotesAnalysisId || !this.sidebarNotesOriginalAnalysis) return;

    const hasTranslation = this.analysisTranslation.hasTranslation(this.sidebarNotesAnalysisId);
    if (!hasTranslation) return;

    const showing = this.analysisTranslation.isShowingTranslated(this.sidebarNotesAnalysisId);
    const translation = this.analysisTranslation.getTranslation(this.sidebarNotesAnalysisId);

    if (showing && translation && !this.sidebarNotesShowingTranslation) {
      this.sidebarNotesAnalysis = this.analysisTranslation.applyTranslation(this.sidebarNotesOriginalAnalysis, translation);
      this.sidebarNotesSanitized = this.sidebarNotesAnalysis.tutorNote?.text
        ? this.sanitizer.bypassSecurityTrustHtml(this.sidebarNotesAnalysis.tutorNote.text)
        : null;
      this.sidebarNotesShowingTranslation = true;
      this.cdr.detectChanges();
    } else if (!showing && this.sidebarNotesShowingTranslation) {
      this.sidebarNotesAnalysis = this.sidebarNotesOriginalAnalysis;
      this.sidebarNotesSanitized = this.sidebarNotesOriginalAnalysis?.tutorNote?.text
        ? this.sanitizer.bypassSecurityTrustHtml(this.sidebarNotesOriginalAnalysis.tutorNote.text)
        : null;
      this.sidebarNotesShowingTranslation = false;
      this.cdr.detectChanges();
    }
  }

  ngOnInit() {
    this.eventId = this.modalEventId || this.route.snapshot.paramMap.get('id');
    this.resetPageTranslation();

    this.userService.getCurrentUser().subscribe({
      next: (user) => {
        this.currentUser = user;
        if (this.eventId) {
          this.loadEventDetails();
        } else {
          this.error = 'No event ID provided';
          this.loading = false;
        }
      },
      error: () => {
        if (this.eventId) {
          this.loadEventDetails();
        } else {
          this.error = 'No event ID provided';
          this.loading = false;
        }
      }
    });

    this.translationSub = this.analysisTranslation.onTranslationChanged().subscribe(changedId => {
      if (changedId === this.sidebarNotesAnalysisId) {
        this.refreshSidebarFromTranslationState();
        this.cdr.detectChanges();
      }
    });

    this.langChangeSub = this.translate.onLangChange.subscribe(() => {
      if (this.paymentData) {
        this.computePaymentStatus();
      }
      if (this.lesson?.paymentMethod) {
        this.computePaymentMethodLabel(this.lesson.paymentMethod);
      }
      if (this.analysisData) {
        this.computeAnalysisProperties();
      }
      if (this.edPrep) {
        this.applyLessonPrep(this.edPrep);
      }
      if (this.hasLastSessionContext) {
        this.resetLastSessionTranslation();
        this.refreshLastSessionTranslateEligibility();
      }
      if (this.lesson && !this.isClass) {
        this.computeAllProperties();
      }
      if (this.edPlanSummary) {
        this.applyPlanSummary(this.edPlanSummary);
      }
      if (this.classData && this.isClass) {
        this.computeClassProperties();
      }
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    this.translationSub?.unsubscribe();
    this.langChangeSub?.unsubscribe();
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    this.flipTransition.cleanup();
    this.teardownClassRoomSubscription();
  }

  ionViewWillLeave() {
    /**
     * Detach from the class room when the user navigates away. We keep the
     * subject subscription up until ngOnDestroy so any in-flight patch that
     * lands mid-transition still updates the cached snapshot.
     */
    this.teardownClassRoomSubscription();
  }

  /**
   * Wire the page to the backend's `class_state_changed` stream. Idempotent:
   * re-calling with the same id is a no-op; calling with a new id cleans up
   * first. Safe to call before `classData` is populated — the merge handler
   * defends against that.
   */
  private ensureClassRoomSubscription(classId: string): void {
    if (!classId) return;
    if (this.activeClassRoomId === classId && this.classStateSub) return;

    if (this.activeClassRoomId && this.activeClassRoomId !== classId) {
      this.webSocketService.leaveClassRoom(this.activeClassRoomId);
    }

    this.activeClassRoomId = classId;
    this.classStateSub?.unsubscribe();
    this.classStateSub = this.webSocketService.classStateChanged$
      .pipe(filter((evt) => !!evt && evt.classId === classId))
      .subscribe((evt) => this.applyClassStatePatch(evt));

    this.webSocketService.joinClassRoom(classId);
  }

  private teardownClassRoomSubscription(): void {
    this.classStateSub?.unsubscribe();
    this.classStateSub = undefined;
    if (this.activeClassRoomId) {
      this.webSocketService.leaveClassRoom(this.activeClassRoomId);
      this.activeClassRoomId = null;
    }
  }

  /**
   * Merge a compact state patch into `classData` and recompute derived
   * properties. Synthesizes a `payments` array from `state.studentPayments`
   * so `computeClassProperties()` — which reads `classData.payments` to
   * drive the paid count — reflects real-time status without an extra
   * backend fetch.
   */
  private applyClassStatePatch(evt: {
    classId: string;
    version: string | null;
    reason: string;
    state: any;
  }): void {
    if (!evt || !evt.state) return;
    if (!this.classData) return;

    const patch = evt.state;
    this.classData.confirmedStudents = Array.isArray(patch.confirmedStudents)
      ? patch.confirmedStudents.map((s: any) => ({
          _id: s.id,
          name: s.name,
          picture: s.picture || '',
        }))
      : this.classData.confirmedStudents;

    if (patch.capacity !== undefined && patch.capacity !== null) this.classData.capacity = patch.capacity;
    if (patch.minStudents !== undefined && patch.minStudents !== null) this.classData.minStudents = patch.minStudents;
    if (typeof patch.flexibleMinimum === 'boolean') this.classData.flexibleMinimum = patch.flexibleMinimum;
    if (patch.price !== undefined && patch.price !== null) this.classData.price = patch.price;
    if (patch.status) this.classData.status = patch.status;
    if (patch.cancelReason !== undefined) this.classData.cancelReason = patch.cancelReason;

    const studentPayments = patch.studentPayments || {};
    const syntheticPayments = Object.keys(studentPayments).map((sid) => {
      const raw = studentPayments[sid];
      const status = raw === 'captured' ? 'succeeded' : raw;
      return { studentId: sid, status };
    });
    this.classData.payments = syntheticPayments;
    this.classData.studentPayments = Object.keys(studentPayments).map((sid) => ({
      studentId: sid,
      paymentStatus: studentPayments[sid],
    }));

    this.computeClassProperties();
    this.cdr.detectChanges();
  }

  // ── Data Loading ──────────────────────────────────────────────

  /** Preview lessons (same IDs as list mocks) — no API calls. */
  private applyMockLessonDetails(id: string): void {
    this.error = null;
    const lesson = buildMockLessonEntity(id, this.currentUser);
    if (!lesson) {
      this.error = 'Event not found';
      this.loading = false;
      this.flipTransition.cleanup();
      this.cdr.detectChanges();
      return;
    }

    this.lesson = lesson;
    this.isClass = false;
    this.classCanOpenGoingMessage = false;
    this.lessonsWithParticipant = 12;
    this.recentLessons = [];
    this.tutorStatsRating = '4.9';
    this.tutorStatsRatingRounded = 5;
    this.tutorStatsTotalLessons = 240;
    this.tutorStatsStudents = 18;

    const bp = getMockBillingAndPayment(id);
    if (bp) {
      this.billingData = bp.billing as any;
      this.paymentData = bp.payment as any;
    }

    this.analysisLoading = false;
    this.feedbackLoading = false;

    this.computeAllProperties();
    this.capturePageOriginals();

    // Hydrate analysis / feedback / sidebar from mock lesson data (mirrors loadAdditionalData flow)
    const mockAi = (lesson as any).aiAnalysis;
    if (mockAi && mockAi.status === 'completed') {
      this.analysisData = this.buildMockAnalysisData(lesson, id);
      this.computeAnalysisProperties();
    } else if (mockAi && mockAi.status === 'generating') {
      this.analysisData = null;
      this.analysisUnavailable = false;
    }

    const mockFeedback = (lesson as any).tutorFeedback;
    if (mockFeedback && mockFeedback.status === 'completed') {
      this.tutorFeedback = {
        _id: `mock-fb-${id}`,
        lessonId: id,
        tutorId: String((lesson as any).tutorId?._id || ''),
        studentId: String((lesson as any).studentId?._id || ''),
        strengths: mockFeedback.strengths || ['Good pronunciation', 'Active participation'],
        areasForImprovement: mockFeedback.areasForImprovement || ['Listening comprehension', 'Irregular verb conjugation'],
        homework: mockFeedback.homework || 'Complete exercises 4-6 in workbook chapter 3.',
        overallNotes: mockFeedback.overallNotes || '',
        estimatedCefrLevel: mockFeedback.estimatedCefrLevel || 'B1',
        status: 'completed',
        providedAt: new Date() as any,
        createdAt: new Date() as any,
        remindersSent: 0,
      };
      this.computeFeedbackProperties();
    } else if (mockFeedback && mockFeedback.status === 'pending') {
      this.tutorFeedback = {
        _id: `mock-fb-${id}`,
        lessonId: id,
        tutorId: String((lesson as any).tutorId?._id || ''),
        studentId: String((lesson as any).studentId?._id || ''),
        strengths: [],
        areasForImprovement: [],
        homework: '',
        overallNotes: '',
        status: 'pending',
        required: mockFeedback.required !== false,
        createdAt: new Date() as any,
        remindersSent: 0,
      };
    }

    this.resolveSidebarNotes();
    this.computeFeedbackStatus();

    if (bp) {
      this.computeBillingProperties();
      if (this.paymentData) {
        this.computePaymentStatus();
      }
    }

    // Mock recommended materials
    const mockRecs = getMockRecommendedMaterials(id);
    if (mockRecs.length) {
      this.recommendedMaterials = mockRecs as any;
      this.hasRecommendations = true;
    }

    this.applyMockLearningPlanContext(id);
    this.refreshNotesPresentation();
    this.capturePageOriginals();

    this.loading = false;
    this.startCountdown();
    this.flipTransition.cleanup();
    this.cdr.detectChanges();
  }

  private buildMockAnalysisData(lesson: any, id: string): AnalysisData {
    const ai = lesson.aiAnalysis || {};
    const note = lesson.tutorNote;
    return {
      _id: `mock-analysis-${id}`,
      overallAssessment: ai.overallAssessment || {
        proficiencyLevel: 'B1 – Intermediate',
        confidence: 82,
        summary: ai.studentSummary || 'Good progress in this session.',
        progressFromLastLesson: 'Slight improvement in verb accuracy.',
      },
      grammarAnalysis: {
        mistakeTypes: [
          { type: 'Verb conjugation', examples: ['yo soy → yo era (in past context)'], frequency: 3, severity: 'medium' },
          { type: 'Gender agreement', examples: ['la problema → el problema'], frequency: 2, severity: 'low' },
        ],
        suggestions: ['Practice irregular preterite forms', 'Review gendered nouns ending in -ma'],
        accuracyScore: ai.grammarAnalysis?.accuracyScore ?? 72,
      },
      vocabularyAnalysis: {
        wordsUsed: ['hablar', 'comer', 'estudiar', 'trabajar', 'querer', 'poder', 'saber'],
        uniqueWordCount: ai.vocabularyAnalysis?.uniqueWordCount ?? 85,
        vocabularyRange: ai.vocabularyAnalysis?.vocabularyRange || 'Intermediate',
        suggestedWords: ['aprovechar', 'destacar', 'lograr'],
        advancedWordsUsed: ['aprovechar'],
      },
      fluencyAnalysis: {
        speakingSpeed: '110 words/min',
        pauseFrequency: 'moderate',
        fillerWords: { count: 8, examples: ['um', 'este', 'como'] },
        overallFluencyScore: ai.fluencyAnalysis?.overallFluencyScore ?? 68,
      },
      pronunciationAnalysis: {
        overallScore: ai.pronunciationAnalysis?.overallScore ?? 75,
        accuracyScore: 78,
        fluencyScore: 70,
        prosodyScore: 73,
      },
      topicsDiscussed: ai.topicsDiscussed || ['Past tense narration', 'Daily routines', 'Weekend plans'],
      recommendedFocus: ai.recommendedFocus || ['Irregular preterite verbs', 'Ser vs estar contextual usage'],
      suggestedExercises: ['Conjugation drills for ir, ser, tener in preterite', 'Listening practice with native speakers'],
      homeworkSuggestions: ai.homeworkSuggestions || ['Complete chapter 5 exercises', 'Write a short paragraph about your last vacation'],
      studentSummary: ai.studentSummary || ai.overallAssessment?.summary || 'Good session overall.',
      tutorNote: note ? { text: note.text, quickImpression: 'Solid progress', homework: 'Review chapter 5' } : undefined,
      source: 'ai',
      status: 'completed',
    };
  }

  loadEventDetails() {
    if (!this.eventId) return;

    if (isLessonMockId(this.eventId)) {
      this.loading = true;
      this.applyMockLessonDetails(this.eventId);
      return;
    }

    // Stale-while-revalidate: hydrate from cache (skip skeleton), then refetch.
    const cached = this.lessonService.getCachedLessonDetail(this.eventId);
    if (cached?.lesson || cached?.classData) {
      this.hydrateFromCache(cached);
      this.revalidateFromServer();
      return;
    }

    this.loading = true;
    this.fetchLessonDetail(/* silent */ false);
  }

  /** Background revalidate after a cache hit — never flips `loading` back on. */
  private revalidateFromServer() {
    if (!this.eventId || this.isRevalidating) return;
    this.isRevalidating = true;
    this.fetchLessonDetail(true);
  }

  private fetchLessonDetail(silent: boolean) {
    if (!this.eventId) return;

    this.lessonService.getLesson(this.eventId).subscribe({
      next: (response: any) => {
        if (response.success && response.lesson) {
          const prevCtx = this.lesson?.lastSessionContext;
          this.lesson = response.lesson;
          if (!this.lesson.lastSessionContext && prevCtx) {
            this.lesson.lastSessionContext = prevCtx;
          }
          this.isClass = false;
          this.classCanOpenGoingMessage = false;
          this.lessonsWithParticipant = response.lessonsCompleted || 0;

          let tutorStats: any = undefined;
          if (response.tutorStats) {
            const ts = response.tutorStats;
            if (ts.rating && Number(ts.rating) >= 4.0) {
              this.tutorStatsRating = Number(ts.rating).toFixed(1);
              this.tutorStatsRatingRounded = Math.round(Number(ts.rating));
            }
            this.tutorStatsTotalLessons = ts.totalLessons || 0;
            this.tutorStatsStudents = ts.students || 0;
            tutorStats = {
              rating: ts.rating,
              totalLessons: ts.totalLessons,
              students: ts.students,
            };
          }

          this.recentLessons = (response.recentLessons || []).map((l: any) => ({
            _id: l._id,
            subject: l.subject || 'Language Lesson',
            dateLabel: formatDateInTz(l.startTime, this.userTz, { month: 'short', day: 'numeric' }),
            durationLabel: l.duration < 60
              ? `${l.duration}m`
              : `${Math.floor(l.duration / 60)}h${l.duration % 60 ? ` ${l.duration % 60}m` : ''}`
          }));

          this.computeAllProperties();

          this.lessonService.updateCachedLessonDetail(this.eventId!, {
            lesson: this.lesson,
            isClass: false,
            lessonsCompleted: this.lessonsWithParticipant,
            tutorStats,
            recentLessons: this.recentLessons,
          });

          this.loadAdditionalData(silent);
          if (!silent) this.startCountdown();
          if (silent) this.isRevalidating = false;
        } else {
          this.loadClassDetails(silent);
        }
      },
      error: () => {
        this.loadClassDetails(silent);
      }
    });
  }

  /** Sync-hydrate the view from a cached bundle so no skeleton is rendered. */
  private hydrateFromCache(cached: CachedLessonDetailBundle) {
    if (cached.classData) {
      this.classData = cached.classData;
      this.isClass = true;
      if (this.classData?.description) {
        this.sanitizedDescription = this.sanitizer.bypassSecurityTrustHtml(this.classData.description);
      }
      this.computeClassProperties();
      if (this.eventId) this.ensureClassRoomSubscription(this.eventId);
    } else if (cached.lesson) {
      this.lesson = cached.lesson;
      this.isClass = false;
      this.classCanOpenGoingMessage = false;
      this.lessonsWithParticipant = cached.lessonsCompleted || 0;
      if (cached.tutorStats) {
        const ts = cached.tutorStats;
        if (ts.rating && Number(ts.rating) >= 4.0) {
          this.tutorStatsRating = Number(ts.rating).toFixed(1);
          this.tutorStatsRatingRounded = Math.round(Number(ts.rating));
        }
        this.tutorStatsTotalLessons = ts.totalLessons || 0;
        this.tutorStatsStudents = ts.students || 0;
      }
      this.recentLessons = cached.recentLessons || [];

      this.computeAllProperties();

      if (cached.analysis) {
        this.analysisData = cached.analysis;
        this.computeAnalysisProperties();
      }
      if (cached.analysisUnavailable) {
        this.analysisUnavailable = true;
      }
      if (cached.feedback) {
        this.tutorFeedback = cached.feedback;
        this.computeFeedbackProperties();
      }
      if (cached.billing) {
        this.billingData = cached.billing;
        this.computeBillingProperties();
      }
      if (cached.payment) {
        this.paymentData = cached.payment;
        this.computePaymentStatus();
      }
      if (cached.previousNotes?.hasPreviousNotes && cached.previousNotes.analysis) {
        this.previousNotesData = cached.previousNotes;
        this.hasPreviousNotes = true;
        this.previousNotesIsAiSource = cached.previousNotes.analysis.source !== 'tutor';
        if (cached.previousNotes.previousLessonDate) {
          this.previousNotesDate = new Date(cached.previousNotes.previousLessonDate)
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        if (cached.previousNotes.analysis.tutorNote?.text) {
          this.previousNotesSanitized = this.sanitizer.bypassSecurityTrustHtml(cached.previousNotes.analysis.tutorNote.text);
        }
      }
      if (cached.paymentMethod) {
        this.paymentMethodLabel = cached.paymentMethod.label;
        this.paymentMethodIcon = cached.paymentMethod.icon;
      }
      if (cached.tutorMaterials?.length) {
        this.tutorMaterials = cached.tutorMaterials as any;
      }
      if (cached.recommendedMaterials?.length) {
        this.recommendedMaterials = cached.recommendedMaterials as any;
        this.recommendedStruggles = cached.recommendedStruggles || [];
        this.hasRecommendations = true;
      }

      this.computeFeedbackStatus();
      this.resolveSidebarNotes();
      this.refreshNotesPresentation();
    }

    this.loading = false;
    this.startCountdown();
    this.flipTransition.cleanup();
    this.cdr.detectChanges();
  }

  loadClassDetails(silent = false) {
    if (!this.eventId) return;

    this.classService.getClass(this.eventId).subscribe({
      next: (response: any) => {
        if (response.success && response.class) {
          this.classData = response.class;
          this.isClass = true;
          if (this.classData?.description) {
            this.sanitizedDescription = this.sanitizer.bypassSecurityTrustHtml(this.classData.description);
          }
          if (!silent) this.loading = false;
          this.computeClassProperties();
          if (!silent) this.startCountdown();
          if (!silent) this.flipTransition.cleanup();
          this.lessonService.updateCachedLessonDetail(this.eventId!, {
            lesson: null,
            classData: this.classData,
            isClass: true,
          });
          this.ensureClassRoomSubscription(this.eventId!);
          if (silent) this.isRevalidating = false;
        } else if (!silent) {
          this.error = 'Event not found';
          this.loading = false;
          this.flipTransition.cleanup();
        } else {
          this.isRevalidating = false;
        }
      },
      error: () => {
        if (silent) {
          this.isRevalidating = false;
          return;
        }
        this.error = 'Failed to load event details';
        this.loading = false;
        this.flipTransition.cleanup();
      }
    });
  }

  private loadAdditionalData(silent = false) {
    if (!this.eventId || !this.lesson) {
      if (!silent) this.loading = false;
      return;
    }

    if (!silent) {
      // Track all pending requests — skeleton stays until everything resolves
      this.pendingRequests = 5; // analysis + feedback + billing + payment + previous notes
      if (this.isStudentUser) {
        this.pendingRequests++; // + payment method
      }

      this.hasPreviousNotes = false;
      this.previousNotesData = null;
      this.previousNotesSanitized = null;
      this.showSidebarNotesEmpty = false;
      this.sidebarNotesEmptyDescKey = 'EVENT_DETAILS.SIDEBAR_NOTES_EMPTY_DESC_STUDENT';
      this.hasSidebarNotes = false;
      this.sidebarNotesSource = null;
      this.sidebarNotesAnalysis = null;
      this.sidebarNotesOriginalAnalysis = null;
      this.sidebarNotesSanitized = null;
      this.sidebarNotesAnalysisId = null;
      this.sidebarNotesTranslating = false;
      this.sidebarNotesShowingTranslation = false;
      this.sidebarNotesTranslationCache = null;
    }

    this.loadLearningPlanContext();

    // Load analysis
    if (!silent) this.analysisLoading = true;
    const headers = this.userService.getAuthHeadersSync();
    this.http.get<any>(
      `${environment.backendUrl}/api/transcription/lesson/${this.eventId}/analysis`,
      { headers }
    ).subscribe({
      next: (res) => {
        if (res.success && res.analysis) {
          this.analysisData = res.analysis;
          this.computeAnalysisProperties();
          this.lessonService.updateCachedLessonDetail(this.eventId!, { analysis: res.analysis });
        } else if (this.isLessonCompleted) {
          this.analysisUnavailable = true;
          this.lessonService.updateCachedLessonDetail(this.eventId!, { analysisUnavailable: true });
        }
        this.refreshNotesPresentation();
        if (!silent) this.analysisLoading = false;
        this.onRequestComplete(silent);
      },
      error: (err: any) => {
        if (err?.error?.status === 'unavailable' || this.isLessonCompleted) {
          this.analysisUnavailable = true;
          this.lessonService.updateCachedLessonDetail(this.eventId!, { analysisUnavailable: true });
        }
        this.refreshNotesPresentation();
        if (!silent) this.analysisLoading = false;
        this.onRequestComplete(silent);
      }
    });

    // Load tutor feedback
    if (!silent) this.feedbackLoading = true;
    this.tutorFeedbackService.getFeedbackForLesson(this.eventId).subscribe({
      next: (res) => {
        if (res.success && res.hasFeedback && res.feedback) {
          this.tutorFeedback = res.feedback;
          this.computeFeedbackProperties();
          this.lessonService.updateCachedLessonDetail(this.eventId!, { feedback: res.feedback });
        }
        if (!silent) this.feedbackLoading = false;
        this.onRequestComplete(silent);
      },
      error: () => {
        if (!silent) this.feedbackLoading = false;
        this.onRequestComplete(silent);
      }
    });

    // Load billing
    this.lessonService.getBillingSummary(this.eventId).subscribe({
      next: (res: any) => {
        if (res.success && res.billing) {
          this.billingData = res.billing;
          this.computeBillingProperties();
          this.lessonService.updateCachedLessonDetail(this.eventId!, { billing: res.billing });
        }
        this.onRequestComplete(silent);
      },
      error: () => {
        this.onRequestComplete(silent);
      }
    });

    // Load payment details (for financial status section)
    // Use a dedicated method that ensures valid auth headers
    this.loadPaymentDetails(0, silent);

    // Load payment method (student only)
    if (this.isStudentUser) {
      this.walletService.getPaymentHistory(100).subscribe({
        next: (res) => {
          if (res.success && res.payments) {
            const payment = res.payments.find(
              (p: any) => p.lessonId?._id === this.eventId && p.status !== 'cancelled' && p.status !== 'failed'
            );
            if (payment) {
              this.computePaymentMethodLabel(payment.paymentMethod);
              this.lessonService.updateCachedLessonDetail(this.eventId!, {
                paymentMethod: { label: this.paymentMethodLabel, icon: this.paymentMethodIcon },
              });
            }
          }
          this.onRequestComplete(silent);
        },
        error: () => {
          this.onRequestComplete(silent);
        }
      });
    }

    // Load previous lesson notes for this tutor-student pair
    this.lessonService.getPreviousNotes(this.eventId).subscribe({
      next: (res) => {
        if (res.hasPreviousNotes && res.analysis) {
          this.previousNotesData = res;
          this.hasPreviousNotes = true;
          this.previousNotesIsAiSource = res.analysis.source !== 'tutor';
          this.previousNotesDate = new Date(res.previousLessonDate!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          if (res.analysis.tutorNote?.text) {
            this.previousNotesSanitized = this.sanitizer.bypassSecurityTrustHtml(res.analysis.tutorNote.text);
          }
          this.lessonService.updateCachedLessonDetail(this.eventId!, { previousNotes: res });
        }
        this.onRequestComplete(silent);
      },
      error: () => {
        this.onRequestComplete(silent);
      }
    });

    // Load recommended materials (student-only, non-blocking)
    if (this.isStudentUser && this.lesson?.language) {
      this.loadRecommendedMaterials();
    }
  }

  private loadRecommendedMaterials() {
    this.recommendedLoading = true;
    this.hasRecommendations = false;
    this.recommendedMaterials = [];

    const language = this.lesson?.language;
    if (!language) {
      this.recommendedLoading = false;
      return;
    }

    this.materialService.getRecommendedMaterials(language, {
      lessonId: this.eventId || undefined,
      tutorId: this.tutorId || undefined
    }).subscribe({
      next: (res) => {
        if (res.success && res.materials?.length) {
          this.recommendedMaterials = res.materials.map(m => ({
            ...m,
            _typeIcon: this.getMaterialTypeIcon(m.materialType),
            _typeLabel: this.getMaterialTypeLabel(m.materialType)
          }));
          this.recommendedStruggles = res.struggles || [];
          this.hasRecommendations = true;
          if (this.eventId) {
            this.lessonService.updateCachedLessonDetail(this.eventId, {
              recommendedMaterials: this.recommendedMaterials,
              recommendedStruggles: this.recommendedStruggles,
            });
          }
        }
        this.recommendedLoading = false;
        this.capturePageOriginals();
        this.cdr.detectChanges();
      },
      error: () => {
        this.recommendedLoading = false;
        this.capturePageOriginals();
        this.cdr.detectChanges();
      }
    });
  }

  private loadPaymentDetails(retryCount = 0, silent = false) {
    const headers = this.userService.getAuthHeadersSync();
    const hasAuth = headers.has('Authorization');

    if (!hasAuth && retryCount < 2) {
      setTimeout(() => this.loadPaymentDetails(retryCount + 1, silent), 500);
      return;
    }

    this.http.get<any>(
      `${environment.backendUrl}/api/payments/lesson/${this.eventId}`,
      { headers }
    ).subscribe({
      next: (res) => {
        if (res.success && res.payment) {
          this.paymentData = res.payment;
          this.computePaymentStatus();
          if (this.eventId) {
            this.lessonService.updateCachedLessonDetail(this.eventId, { payment: res.payment });
          }
        }
        this.onRequestComplete(silent);
      },
      error: () => {
        if (retryCount < 2) {
          setTimeout(() => this.loadPaymentDetails(retryCount + 1, silent), 800);
        } else {
          this.onRequestComplete(silent);
        }
      }
    });
  }

  /**
   * Called when each async request finishes.
   * - Initial load (`silent=false`): flip `loading` off when everything resolves.
   * - Background revalidate (`silent=true`): never touch `loading`; just refresh
   *   sidebar/feedback projections and clear the revalidating flag at the end.
   */
  private onRequestComplete(silent = false) {
    if (silent) {
      // refresh derived projections in case analysis/feedback/previousNotes changed
      this.computeFeedbackStatus();
      this.resolveSidebarNotes();
      this.refreshNotesPresentation();
      this.capturePageOriginals();
      this.cdr.detectChanges();
      // the initial counter isn't maintained in silent mode; flag flips off
      // opportunistically — any in-flight callbacks are safe because each one
      // sets it independently.
      this.isRevalidating = false;
      return;
    }

    this.pendingRequests--;
    if (this.pendingRequests <= 0) {
      this.computeFeedbackStatus();
      this.resolveSidebarNotes();
      this.refreshNotesPresentation();
      this.capturePageOriginals();
      this.loading = false;
      this.cdr.detectChanges();
      this.landFlipTransition();
    }
  }

  /** FLIP landing: fly clones from their source positions to destination elements */
  private landFlipTransition(): void {
    const data = this.flipTransition.consume();
    if (!data?.clones?.length) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const entry of data.clones) {
          const clone = entry.cloneElement;
          if (!clone?.parentNode) continue;

          const dest = document.querySelector(entry.destSelector) as HTMLElement;
          if (!dest) {
            clone.style.opacity = '0';
            setTimeout(() => { if (clone.parentNode) clone.remove(); }, 300);
            continue;
          }

          dest.style.transition = 'none';
          dest.style.opacity = '0';

          const destRect = dest.getBoundingClientRect();
          const destCs = window.getComputedStyle(dest);

          clone.style.left = `${destRect.left}px`;
          clone.style.top = `${destRect.top}px`;
          clone.style.fontSize = destCs.fontSize;
          clone.style.fontWeight = destCs.fontWeight;
          clone.style.color = destCs.color;
          clone.style.letterSpacing = destCs.letterSpacing;

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
          }, 500);
        }
      });
    });
  }

  // ── Compute Properties (no functions in template) ─────────────

  private computeAllProperties() {
    if (!this.lesson) return;

    this.computeRole();
    this.computeStatus();
    this.computeJoinButton();
    this.computeCancelButton();
    this.computeFormatted();
    this.computeParticipant();
    this.computeTip();
    this.computeCancellation();
    this.computeIssue();
    this.computeReschedule();
    this.computeLastSessionContext();
    this.computeFirstLessonContext();
    this.sanitizeLessonForViewerRole();
    this.refreshPlanPresentation();
    this.refreshNotesPresentation();
    this.capturePageOriginals();
  }

  private computeRole() {
    if (!this.lesson || !this.currentUser) return;

    // Mock previews carry an explicit viewing role so tutor accounts
    // can preview student-perspective cards correctly.
    const mockRole = (this.lesson as any)._mockViewRole;
    if (mockRole === 'tutor' || mockRole === 'student') {
      this.isTutorUser = mockRole === 'tutor';
      this.isStudentUser = mockRole === 'student';
      this.userRole = mockRole;
      return;
    }

    const tutorId = String(this.lesson.tutorId?._id || this.lesson.tutorId);
    const userId = String((this.currentUser as any)._id || this.currentUser.id);
    this.isTutorUser = tutorId === userId;
    this.isStudentUser = !this.isTutorUser;
    this.userRole = this.isTutorUser ? 'tutor' : 'student';
  }

  private computeStatus() {
    if (!this.lesson) return;

    if (this.lesson.status === 'cancelled') {
      this.statusLabel = this.translate.instant('LESSONS_PAGE.STATUS_CANCELLED');
      this.statusColor = '#ef4444';
      this.statusClass = 'cancelled';
      return;
    }

    const now = new Date();
    const start = new Date(this.lesson.startTime);
    const end = new Date(this.lesson.endTime);

    if (now >= start && now <= end) {
      this.statusLabel = this.translate.instant('LESSONS_PAGE.STATUS_IN_PROGRESS');
      this.statusColor = '#60a5fa';
      this.statusClass = 'in-progress';
      this.isLessonInProgress = true;
    } else if (now > end) {
      this.statusLabel = this.translate.instant('LESSONS_PAGE.STATUS_COMPLETED');
      this.statusColor = '#6b7280';
      this.statusClass = 'completed';
      this.isLessonCompleted = true;
    } else if (this.lesson.status === 'pending_reschedule') {
      this.statusLabel = this.translate.instant('LESSONS_PAGE.STATUS_PENDING_RESCHEDULE');
      this.statusColor = '#f59e0b';
      this.statusClass = 'pending';
    } else {
      this.statusLabel = this.translate.instant('LESSONS_PAGE.STATUS_UPCOMING');
      this.statusColor = '#667eea';
      this.statusClass = 'upcoming';
    }
  }

  private computeJoinButton() {
    if (!this.lesson) return;
    const now = new Date();
    const start = new Date(this.lesson.startTime);
    const end = new Date(this.lesson.endTime);

    this.showJoinButton = this.statusClass === 'upcoming' || this.statusClass === 'in-progress';

    if (now >= start && now <= end) {
      this.canJoinLesson = true;
      this.joinLabel = this.translate.instant('HOME.JOIN_NOW');
    } else if (this.lessonService.canJoinLesson(this.lesson)) {
      this.canJoinLesson = true;
      this.joinLabel = this.translate.instant('HOME.JOIN');
    } else if (this.showJoinButton) {
      this.canJoinLesson = false;
      const secs = this.lessonService.getTimeUntilJoin(this.lesson);
      this.joinLabel = this.translate.instant('HOME.JOIN_IN_TIME', {
        time: this.lessonService.formatTimeUntil(secs),
      });
    }
  }

  private computeCancelButton() {
    if (!this.lesson?.startTime || this.lesson.status === 'cancelled') {
      this.canCancelLesson = false;
      return;
    }
    const now = new Date();
    const start = new Date(this.lesson.startTime);
    this.canCancelLesson = start > now;
  }

  private computeFormatted() {
    if (!this.lesson) return;

    const start = new Date(this.lesson.startTime);
    const end = new Date(this.lesson.endTime);

    // Date
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (start.toDateString() === today.toDateString()) {
      this.formattedDate = this.translate.instant('HOME.TODAY');
    } else if (start.toDateString() === tomorrow.toDateString()) {
      this.formattedDate = this.translate.instant('HOME.TOMORROW');
    } else {
      this.formattedDate = formatDateInTz(start, this.userTz, {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      });
    }

    // Time range
    this.formattedTimeRange = `${formatTimeInTz(start, this.userTz, undefined, true)} – ${formatTimeInTz(end, this.userTz, undefined, true)}`;

    // Duration
    const mins = this.lesson.duration || 60;
    if (mins < 60) {
      this.formattedDuration = `${mins} minutes`;
    } else {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      this.formattedDuration = m === 0 ? `${h} hour${h > 1 ? 's' : ''}` : `${h}h ${m}m`;
    }

    // Price
    this.formattedPrice = this.lesson.price != null ? `$${this.lesson.price.toFixed(2)}` : '';
  }

  private computeParticipant() {
    if (!this.lesson) return;

    // Tutor sees student info, student sees tutor info
    const p = this.isTutorUser ? this.lesson.studentId : this.lesson.tutorId;
    if (p) {
      const firstName = p.firstName || p.name?.split(' ')[0] || '';
      const lastName = p.lastName || p.name?.split(' ').slice(1).join(' ') || '';
      this.participantName = this.formatPersonName(p);
      this.participantEmail = p.email || '';
      this.participantPicture = p.picture || '';
      this.participantInitial = (p.name || p.firstName || 'P').charAt(0).toUpperCase();
      this.participantRole = this.isTutorUser ? 'Student' : 'Tutor';
      this.participantRoleDisplay = this.isTutorUser
        ? this.translate.instant('LESSONS_PAGE.STUDENT')
        : this.translate.instant('LESSONS_PAGE.TUTOR');
      this.participantCountry = p.country || p.residenceCountry || '';
    } else {
      this.participantRoleDisplay = '';
    }

    // Pre-compute tutor display name for student view ("Phillip D.")
    const tutor = this.lesson.tutorId;
    if (tutor) {
      const tFirst = tutor.firstName || tutor.name?.split(' ')[0] || '';
      const tLast = tutor.lastName || tutor.name?.split(' ').slice(1).join(' ') || '';
      this.tutorDisplayName = tFirst && tLast
        ? `${tFirst} ${tLast.charAt(0).toUpperCase()}.`
        : tutor.name || this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.TUTOR_DISPLAY_FALLBACK');
      
      this.tutorId = tutor._id?.toString() || tutor.toString() || null;
    }

    // Sidebar data
    if (p) {
      const pAny = p as any;
      this.participantId = pAny._id?.toString() || pAny.auth0Id || null;
      this.participantBio = pAny.onboardingData?.bio || pAny.onboardingData?.summary || pAny.profile?.bio || '';
      this.participantLanguages = pAny.onboardingData?.languages || [];
      this.participantExperienceLevel = pAny.onboardingData?.experienceLevel || '';
      this.participantGoals = pAny.onboardingData?.goals || [];
      this.participantNativeLanguage = pAny.nativeLanguage || '';
      if (!this.isTutorUser && pAny.onboardingData?.hourlyRate) {
        this.participantRate = `$${pAny.onboardingData.hourlyRate}/hr`;
      }
      if (pAny.rating && Number(pAny.rating) >= 4.0) {
        this.participantRating = Number(pAny.rating).toFixed(1);
      }
    }

    // Tutor-specific sidebar data (available to both roles)
    const tutorData = this.lesson.tutorId as any;
    if (tutorData) {
      if (this.isStudentUser && tutorData?.profile?.officeHoursEnabled && tutorData?.profile?.officeHoursLastActive) {
        const elapsed = Date.now() - new Date(tutorData.profile.officeHoursLastActive).getTime();
        this.tutorAvailableNow = elapsed < 120000;
      }

      const ch = tutorData?.linkedChannels;
      this.hasLinkedChannels = !!(ch?.youtubeChannelName || ch?.vimeoChannelName || ch?.soundcloudProfileName);
      this.linkedChannels = ch || null;

      if (this.tutorId) {
        this.loadTutorMaterials();
      }
    }

    // Tutor sees materials collapsed by default in sidebar
    if (this.isTutorUser) {
      this.materialsSectionExpanded = false;
    }
  }

  private loadTutorMaterials() {
    if (!this.tutorId) return;
    if (isLessonMockId(this.eventId)) {
      this.tutorMaterials = [];
      return;
    }
    this.materialService.getTutorMaterials(this.tutorId).subscribe({
      next: (res) => {
        this.tutorMaterials = (res.materials || [])
          .filter(m => m.status === 'published')
          .map(m => ({
            ...m,
            _addedDate: this.formatMaterialDate(m.createdAt),
            _typeIcon: this.getMaterialTypeIcon(m.materialType),
            _typeLabel: this.getMaterialTypeLabel(m.materialType)
          }));
        if (this.eventId) {
          this.lessonService.updateCachedLessonDetail(this.eventId, { tutorMaterials: this.tutorMaterials });
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.tutorMaterials = [];
      }
    });
  }

  private formatMaterialDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `Added ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  getMaterialTypeIcon(type: string): string {
    switch (type) {
      case 'video_quiz': return 'videocam';
      case 'reading': return 'book';
      case 'listening': return 'headset';
      default: return 'document';
    }
  }

  getMaterialTypeLabel(type: string): string {
    switch (type) {
      case 'video_quiz': return 'VIDEO QUIZ';
      case 'reading': return 'READING';
      case 'listening': return 'LISTENING';
      default: return 'MATERIAL';
    }
  }

  openMaterial(material: TutorMaterial) {
    this.router.navigate(['/material', material._id]);
  }

  viewRecommendedMaterial(material: any) {
    this.router.navigate(['/material', material._id]);
  }

  toggleSaveRecommendation(material: any) {
    const idx = this.recommendedMaterials.findIndex(m => m._id === material._id);
    if (idx === -1) return;

    const prev = this.recommendedMaterials[idx].isSaved;
    this.recommendedMaterials[idx].isSaved = !prev;
    this.cdr.detectChanges();

    this.materialService.toggleSaveMaterial(material._id, this.eventId || undefined).subscribe({
      next: (res) => {
        if (res.success) {
          this.recommendedMaterials[idx].isSaved = res.saved;
        } else {
          this.recommendedMaterials[idx].isSaved = prev;
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.recommendedMaterials[idx].isSaved = prev;
        this.cdr.detectChanges();
      }
    });
  }

  private computeTip() {
    if (!this.lesson) return;
    if (this.lesson.tip && this.lesson.tip.amount) {
      this.hasTip = true;
      this.tipAmount = `$${this.lesson.tip.amount.toFixed(2)}`;
      this.tipDate = this.lesson.tip.paidAt
        ? formatDateInTz(this.lesson.tip.paidAt, this.userTz, { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      // Fee breakdown for tutor
      const fee = this.lesson.tip.stripeFee || 0;
      const received = this.lesson.tip.tutorReceived || this.lesson.tip.amount;
      this.tipHasFee = fee > 0;
      this.tipStripeFee = `$${fee.toFixed(2)}`;
      this.tipTutorReceived = `$${received.toFixed(2)}`;
      // Contextual message
      if (this.isTutorUser) {
        this.tipMessage = 'You received a tip for this lesson!';
      } else {
        const tutorName = this.tutorDisplayName || 'your tutor';
        this.tipMessage = `You tipped ${tutorName} for this lesson!`;
      }
    }
  }

  private computeCancellation() {
    if (!this.lesson) return;
    this.isCancelled = this.lesson.status === 'cancelled';
    if (this.isCancelled) {
      const ls = (k: string) => this.translate.instant(`EVENT_DETAILS.LESSON_SCREEN.${k}`);
      const cancelledByMap: Record<string, string> = {
        tutor: ls('ROLE_TUTOR'),
        student: ls('ROLE_STUDENT'),
        system: ls('ROLE_SYSTEM'),
        admin: ls('ROLE_ADMIN'),
      };
      this.cancelledByLabel = cancelledByMap[this.lesson.cancelledBy] || ls('ROLE_UNKNOWN');
      this.cancelReasonLabel =
        this.lesson.cancelReasonText || this.lesson.cancelReason || ls('NO_CANCEL_REASON');
      this.cancelledAtLabel = this.lesson.cancelledAt
        ? `${formatDateInTz(this.lesson.cancelledAt, this.userTz, { month: 'short', day: 'numeric', year: 'numeric' })} ${formatTimeInTz(this.lesson.cancelledAt, this.userTz, undefined, true)}`
        : '';
    }
  }

  private computeIssue() {
    if (!this.lesson) return;
    this.hasIssue = !!this.lesson.issueReported;
    if (this.hasIssue) {
      const issueKeyMap: Record<string, string> = {
        tutor_no_show: 'LESSONS_PAGE.ISSUE_TUTOR_NO_SHOW',
        ended_early: 'LESSONS_PAGE.ISSUE_ENDED_EARLY',
        poor_quality: 'LESSONS_PAGE.ISSUE_POOR_QUALITY',
        inappropriate: 'LESSONS_PAGE.ISSUE_INAPPROPRIATE',
        technical: 'LESSONS_PAGE.ISSUE_TECHNICAL',
        other: 'LESSONS_PAGE.ISSUE_OTHER',
      };
      const ik = issueKeyMap[this.lesson.issueType || ''];
      this.issueTypeLabel = ik
        ? this.translate.instant(ik)
        : this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.ISSUE_FALLBACK');

      // Only the person who reported the issue sees the detailed text
      const reporterId = this.lesson.issueReportedBy?._id?.toString()
        || this.lesson.issueReportedBy?.toString()
        || '';
      const userId = String((this.currentUser as any)?._id || this.currentUser?.id || '');
      this.isIssueReporter = reporterId === userId;
      this.issueDetailsText = this.isIssueReporter ? (this.lesson.issueDetails || '') : '';
      this.issueDate = this.lesson.issueReportedAt
        ? formatDateInTz(this.lesson.issueReportedAt, this.userTz, { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      this.isUnderInvestigation = !!this.lesson.underInvestigation;
      this.isInvestigationResolved = !!this.lesson.investigationResolvedAt;
      if (this.isInvestigationResolved) {
        const ls = (k: string) => this.translate.instant(`EVENT_DETAILS.LESSON_SCREEN.${k}`);
        if (this.isTutorUser) {
          this.investigationResolutionLabel = ls('RESOLVED');
        } else {
          const resolutionMap: Record<string, string> = {
            approved: ls('RESOLUTION_NO_ISSUE'),
            refunded: ls('RESOLUTION_REFUNDED'),
            partial_refund: ls('RESOLUTION_PARTIAL'),
            no_action: ls('RESOLUTION_NO_ACTION'),
          };
          this.investigationResolutionLabel =
            resolutionMap[this.lesson.investigationResolution || ''] || ls('RESOLVED');
        }
      }
    }
  }

  private computeReschedule() {
    if (!this.lesson?.rescheduleProposal) return;
    const rp = this.lesson.rescheduleProposal;
    if (rp.status === 'pending' && rp.proposedStartTime && rp.proposedEndTime && rp.proposedBy) {
      this.hasReschedule = true;
      this.rescheduleStatus = this.translate.instant('LESSONS_PAGE.STATUS_PENDING');
      const s = new Date(rp.proposedStartTime);
      const e = new Date(rp.proposedEndTime);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        this.proposedTimeRange = `${formatDateInTz(s, this.userTz, { month: 'short', day: 'numeric', year: undefined })} at ${formatTimeInTz(s, this.userTz, undefined, true)} – ${formatTimeInTz(e, this.userTz, undefined, true)}`;
      }
    }
  }

  private computeFirstLessonContext(): void {
    const ctx = this.lesson?.lastSessionContext;
    const status = this.lesson?.status;
    const isScheduleContext = status === 'scheduled' || status === 'confirmed';
    if (!ctx?.isFirstLesson || !isScheduleContext) {
      this.hasFirstLessonContext = false;
      this.firstLessonMessage = '';
      return;
    }
    const other = this.isTutorUser ? this.lesson?.studentId : this.lesson?.tutorId;
    const otherName = other?.name || other?.firstName || this.participantName || '';
    const shortName = otherName.split(' ')[0] || otherName;
    const key = this.isTutorUser
      ? 'LESSONS_PAGE.FIRST_LESSON_TUTOR'
      : 'LESSONS_PAGE.FIRST_LESSON_STUDENT';
    this.firstLessonMessage = this.translate.instant(key, { name: shortName });
    this.hasFirstLessonContext = !!this.firstLessonMessage;
  }

  private computeLastSessionContext() {
    const ctx = this.lesson?.lastSessionContext;
    if (!ctx || ctx.isFirstLesson || !ctx.summary) {
      this.hasLastSessionContext = false;
      this.resetLastSessionTranslation();
      return;
    }
    this.hasLastSessionContext = true;
    this.lastSessionOriginalSummary = ctx.summary;
    this.lastSessionOriginalFocus = [...(ctx.recommendedFocus || [])];
    this.lastSessionSummary = ctx.summary;
    this.lastSessionFocus = [...(ctx.recommendedFocus || [])];
    this.resetLastSessionTranslation();
    this.refreshLastSessionTranslateEligibility();
  }

  private resetLastSessionTranslation(): void {
    this.lastSessionShowingTranslation = false;
    this.lastSessionTranslating = false;
    this.lastSessionTranslatedSummary = '';
    this.lastSessionTranslatedFocus = [];
  }

  private refreshLastSessionTranslateEligibility(): void {
    const ctx = this.lesson?.lastSessionContext;
    this.lastSessionCanTranslate = !!(
      this.hasLastSessionContext &&
      ctx?.summaryTranslatable !== false &&
      this.lastSessionOriginalSummary &&
      this.lessonService.canTranslateProse() &&
      this.lessonService.shouldOfferProseTranslation(ctx?.summaryLanguage)
    );
    this.refreshPageTranslateEligibility();
  }

  private resetPageTranslation(): void {
    this.pageCanTranslate = false;
    this.pageTranslating = false;
    this.pageShowingTranslation = false;
    this.pageOriginals = null;
  }

  private capturePageOriginals(): void {
    if (this.pageShowingTranslation || this.isClass) {
      return;
    }
    this.pageOriginals = {
      lastSessionSummary: this.lastSessionSummary,
      lastSessionFocus: [...this.lastSessionFocus],
      analysisData: this.analysisData ? JSON.parse(JSON.stringify(this.analysisData)) : null,
      feedbackStrengths: [...this.feedbackStrengths],
      feedbackImprovements: [...this.feedbackImprovements],
      feedbackNotes: this.feedbackNotes,
      edPlanNextFocus: this.edPlanNextFocus,
      edPlanGoalLabel: this.edPlanGoalLabel,
      edPlanPhaseLabel: this.edPlanPhaseLabel,
      edPlanMetaLine: this.edPlanMetaLine,
      edPlanTopicChips: [...this.edPlanTopicChips],
      edPlanAgenda: [...this.edPlanAgenda],
      edPrep: this.edPrep ? JSON.parse(JSON.stringify(this.edPrep)) : null,
      cancelReasonLabel: this.cancelReasonLabel,
      issueDetailsText: this.issueDetailsText,
      lessonNotes: this.lesson?.notes || '',
      recommendedStruggles: [...this.recommendedStruggles],
      recommendedMaterials: JSON.parse(JSON.stringify(this.recommendedMaterials)),
    };
    this.refreshPageTranslateEligibility();
  }

  private refreshPageTranslateEligibility(): void {
    if (this.isClass || !this.lessonService.canTranslateProse()) {
      this.pageCanTranslate = false;
      return;
    }
    if (!this.hasPageTranslatableContent()) {
      this.pageCanTranslate = false;
      return;
    }

    this.pageCanTranslate = this.computePageNeedsTranslation();
  }

  /** Per-block language checks — show Translate only when something differs from the reader's language. */
  private computePageNeedsTranslation(): boolean {
    const blocks: (string | null | undefined)[] = [];

    if (this.hasLastSessionContext && this.lastSessionOriginalSummary) {
      blocks.push(this.lesson?.lastSessionContext?.summaryLanguage);
    }

    if (this.hasAnalysis && this.analysisData?._id) {
      blocks.push(
        this.isAiAnalysis
          ? this.lessonService.inferStudentFacingProseLang(this.lesson)
          : this.lessonService.inferTutorAuthoredProseLang(this.lesson),
      );
    }

    if (this.hasTutorNote && this.analysisData?.tutorNote?.text) {
      blocks.push(
        this.lessonService.inferTutorNoteProseLang(this.lesson, this.analysisData.tutorNote.text),
      );
    }

    if (
      this.hasTutorFeedback &&
      (this.feedbackNotes || this.feedbackStrengths.length || this.feedbackImprovements.length)
    ) {
      blocks.push(this.lessonService.inferTutorAuthoredProseLang(this.lesson));
    }

    if (this.edHasPlan && (this.edPlanNextFocus || this.edPlanGoalLabel || this.edPlanTopicChips.length)) {
      blocks.push(this.lessonService.inferStudentFacingProseLang(this.lesson));
    }

    if (this.edPrepHasContent) {
      blocks.push(this.lessonService.inferStudentFacingProseLang(this.lesson));
    }

    if (this.showTutorPrivateNotes && this.lesson?.notes) {
      blocks.push(this.lessonService.inferTutorAuthoredProseLang(this.lesson));
      blocks.push(this.lessonService.sniffProseLangFromText(this.lesson.notes));
    }

    return this.lessonService.shouldOfferProseTranslationForAnyBlock(blocks);
  }

  private hasPageTranslatableContent(): boolean {
    if (this.hasLastSessionContext && this.lastSessionOriginalSummary) {
      return true;
    }
    if (this.hasAnalysis && this.analysisData?._id) {
      return true;
    }
    if (this.hasTutorFeedback && (
      this.feedbackNotes ||
      this.feedbackStrengths.length ||
      this.feedbackImprovements.length
    )) {
      return true;
    }
    if (this.hasTutorNote && this.analysisData?.tutorNote?.text) {
      return true;
    }
    if (this.edHasPlan && (this.edPlanNextFocus || this.edPlanGoalLabel || this.edPlanTopicChips.length)) {
      return true;
    }
    if (this.edPrepHasContent) {
      return true;
    }
    if (this.isCancelled && this.cancelReasonLabel) {
      return true;
    }
    if (this.hasIssue && this.issueDetailsText) {
      return true;
    }
    if (this.showTutorPrivateNotes && this.lesson?.notes) {
      return true;
    }
    if (this.recommendedStruggles.length || this.recommendedMaterials.length) {
      return true;
    }
    return false;
  }

  private buildClientTranslationSections(): Record<string, unknown> | null {
    const sections: Record<string, unknown> = {};

    const plan: Record<string, unknown> = {};
    if (this.edPlanNextFocus) plan['nextFocus'] = this.edPlanNextFocus;
    if (this.edPlanGoalLabel) plan['goalLabel'] = this.edPlanGoalLabel;
    if (this.edPlanPhaseLabel) plan['phaseLabel'] = this.edPlanPhaseLabel;
    if (this.edPlanTopicChips.length) plan['topicChips'] = [...this.edPlanTopicChips];
    if (this.edPlanAgenda.length) plan['agenda'] = [...this.edPlanAgenda];
    if (Object.keys(plan).length) sections['plan'] = plan;

    if (this.edPrep) {
      const prep: Record<string, unknown> = {};
      if (this.edPrep.agenda?.length) prep['agenda'] = [...this.edPrep.agenda];
      const la = this.edPrep.latestAnalysis;
      if (la?.topErrors?.length) {
        prep['topErrors'] = la.topErrors.map((e) => e.issue).filter(Boolean);
      }
      if (la?.persistentChallenges?.length) {
        prep['persistentChallenges'] = [...la.persistentChallenges];
      }
      if (la?.correctedExcerpts?.length) {
        prep['correctedExcerpts'] = la.correctedExcerpts.map((e) => ({
          context: e.context || '',
          original: e.original || '',
          corrected: e.corrected || '',
        }));
      }
      if (this.edPrep.otherTutorNotes?.length) {
        prep['otherNotes'] = this.edPrep.otherTutorNotes.map((n) => n.text).filter(Boolean);
      }
      if (Object.keys(prep).length) sections['prep'] = prep;
    }

    const misc: Record<string, unknown> = {};
    if (this.isCancelled && this.cancelReasonLabel) misc['cancelReason'] = this.cancelReasonLabel;
    if (this.hasIssue && this.issueDetailsText) misc['issueDetails'] = this.issueDetailsText;
    if (this.showTutorPrivateNotes && this.lesson?.notes) misc['lessonNotes'] = this.lesson.notes;
    if (this.recommendedStruggles.length) misc['recommendedStruggles'] = [...this.recommendedStruggles];
    if (this.recommendedMaterials.length) {
      misc['recommendedMaterialTitles'] = this.recommendedMaterials.map((m) => m.title).filter(Boolean);
    }
    if (Object.keys(misc).length) sections['misc'] = misc;

    return Object.keys(sections).length ? sections : null;
  }

  togglePageTranslation(): void {
    if (!this.pageCanTranslate || this.pageTranslating || !this.eventId) {
      return;
    }

    if (this.pageShowingTranslation) {
      this.restorePageOriginals();
      return;
    }

    if (!this.pageOriginals) {
      this.capturePageOriginals();
    }

    const lang = this.lessonService.getProseTranslationTarget();
    if (!lang) {
      return;
    }

    this.pageTranslating = true;
    this.cdr.detectChanges();

    if (isLessonMockId(this.eventId)) {
      window.setTimeout(() => {
        this.applyMockPageTranslationLocally(lang);
        this.pageShowingTranslation = true;
        this.pageTranslating = false;
        this.cdr.detectChanges();
      }, 350);
      return;
    }

    this.lessonService.translateLessonDetail(
      this.eventId,
      lang,
      this.buildClientTranslationSections(),
    ).subscribe({
      next: (resp) => {
        this.pageTranslating = false;
        if (resp?.success) {
          this.applyPageTranslation(resp);
          this.pageShowingTranslation = true;
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.pageTranslating = false;
        this.cdr.detectChanges();
      },
    });
  }

  private applyMockPageTranslationLocally(targetLang: string): void {
    const tag = targetLang.toUpperCase();
    const tx = (s: string) => (s ? `[${tag}] ${s}` : s);
    const txArr = (items: string[]) => items.map(tx);
    const orig = this.pageOriginals;

    if (this.hasLastSessionContext && orig) {
      this.lastSessionSummary = tx(orig.lastSessionSummary);
      this.lastSessionFocus = txArr(orig.lastSessionFocus);
    }

    if (this.analysisData && orig?.analysisData) {
      const mockAnalysis = {
        summary: orig.analysisData.overallAssessment?.summary,
        progressFromLastLesson: orig.analysisData.overallAssessment?.progressFromLastLesson,
        studentSummary: orig.analysisData.studentSummary,
        tutorNoteText: orig.analysisData.tutorNote?.text,
        recommendedFocus: orig.analysisData.recommendedFocus,
        topicsDiscussed: orig.analysisData.topicsDiscussed,
        homeworkSuggestions: orig.analysisData.homeworkSuggestions,
        suggestedExercises: orig.analysisData.suggestedExercises,
        strengths: orig.analysisData.strengths,
        areasForImprovement: orig.analysisData.areasForImprovement,
      };
      this.analysisData = this.analysisTranslation.applyTranslation(this.analysisData, mockAnalysis);
      this.computeAnalysisProperties();
      this.resolveSidebarNotes();
    }

    if (orig) {
      this.feedbackStrengths = txArr(orig.feedbackStrengths);
      this.feedbackImprovements = txArr(orig.feedbackImprovements);
      this.feedbackNotes = tx(orig.feedbackNotes);
      this.edPlanNextFocus = tx(orig.edPlanNextFocus);
      this.edPlanGoalLabel = tx(orig.edPlanGoalLabel);
      this.edPlanPhaseLabel = tx(orig.edPlanPhaseLabel);
      this.edPlanTopicChips = txArr(orig.edPlanTopicChips);
      this.edPlanAgenda = txArr(orig.edPlanAgenda);
      this.edPlanMetaLine = this.buildPlanMetaLine();
      if (orig.edPrep) {
        this.edPrep = JSON.parse(JSON.stringify(orig.edPrep));
        if (this.edPrep?.agenda?.length) this.edPrep.agenda = txArr(this.edPrep.agenda);
        const la = this.edPrep?.latestAnalysis;
        if (la?.topErrors?.length) {
          la.topErrors = la.topErrors.map((e) => ({ ...e, issue: tx(e.issue) }));
        }
        if (la?.persistentChallenges?.length) {
          la.persistentChallenges = txArr(la.persistentChallenges);
        }
        if (la?.correctedExcerpts?.length) {
          la.correctedExcerpts = la.correctedExcerpts.map((e) => ({
            ...e,
            context: tx(e.context || ''),
            original: tx(e.original || ''),
            corrected: tx(e.corrected || ''),
          }));
        }
        if (this.edPrep?.otherTutorNotes?.length) {
          this.edPrep.otherTutorNotes = this.edPrep.otherTutorNotes.map((n) => ({
            ...n,
            text: tx(n.text),
          }));
        }
      }
      this.cancelReasonLabel = tx(orig.cancelReasonLabel);
      this.issueDetailsText = tx(orig.issueDetailsText);
      if (this.lesson && orig.lessonNotes) {
        this.lesson = { ...this.lesson, notes: tx(orig.lessonNotes) };
      }
      this.recommendedStruggles = txArr(orig.recommendedStruggles);
      this.recommendedMaterials = orig.recommendedMaterials.map((m) => ({
        ...m,
        title: tx(m.title),
        _matchedStruggles: m._matchedStruggles?.length ? txArr(m._matchedStruggles) : m._matchedStruggles,
      }));
    }
  }

  private applyPageTranslation(resp: {
    lastSession?: { summary?: string | null; recommendedFocus?: string[] } | null;
    analysis?: Record<string, unknown> | null;
    feedback?: Record<string, unknown> | null;
    client?: Record<string, unknown> | null;
  }): void {
    if (resp.lastSession?.summary) {
      this.lastSessionSummary = resp.lastSession.summary;
    }
    if (Array.isArray(resp.lastSession?.recommendedFocus) && resp.lastSession.recommendedFocus.length) {
      this.lastSessionFocus = resp.lastSession.recommendedFocus.slice(0, 3);
    }

    if (resp.analysis && this.analysisData) {
      this.analysisData = this.analysisTranslation.applyTranslation(this.analysisData, resp.analysis);
      this.computeAnalysisProperties();
      this.resolveSidebarNotes();
    }

    if (resp.feedback) {
      const fb = resp.feedback;
      if (Array.isArray(fb['strengths']) && fb['strengths'].length) {
        this.feedbackStrengths = fb['strengths'] as string[];
      }
      if (Array.isArray(fb['areasForImprovement']) && fb['areasForImprovement'].length) {
        this.feedbackImprovements = fb['areasForImprovement'] as string[];
      }
      if (typeof fb['overallNotes'] === 'string' && fb['overallNotes']) {
        this.feedbackNotes = fb['overallNotes'];
      }
    }

    const client = resp.client;
    if (client) {
      const plan = client['plan'] as Record<string, unknown> | undefined;
      if (plan) {
        if (typeof plan['nextFocus'] === 'string') this.edPlanNextFocus = plan['nextFocus'];
        if (typeof plan['goalLabel'] === 'string') this.edPlanGoalLabel = plan['goalLabel'];
        if (typeof plan['phaseLabel'] === 'string') this.edPlanPhaseLabel = plan['phaseLabel'];
        if (Array.isArray(plan['topicChips'])) this.edPlanTopicChips = plan['topicChips'] as string[];
        if (Array.isArray(plan['agenda'])) this.edPlanAgenda = plan['agenda'] as string[];
        this.edPlanMetaLine = this.buildPlanMetaLine();
      }

      const prep = client['prep'] as Record<string, unknown> | undefined;
      if (prep && this.edPrep) {
        if (Array.isArray(prep['agenda'])) {
          this.edPrep = { ...this.edPrep, agenda: prep['agenda'] as string[] };
        }
        const la = this.edPrep.latestAnalysis;
        if (la) {
          const nextLa = { ...la };
          if (Array.isArray(prep['topErrors']) && la.topErrors?.length) {
            nextLa.topErrors = la.topErrors.map((err, i) => ({
              ...err,
              issue: (prep['topErrors'] as string[])[i] || err.issue,
            }));
          }
          if (Array.isArray(prep['persistentChallenges'])) {
            nextLa.persistentChallenges = prep['persistentChallenges'] as string[];
          }
          if (Array.isArray(prep['correctedExcerpts']) && la.correctedExcerpts?.length) {
            const translated = prep['correctedExcerpts'] as Array<{ context?: string; original?: string; corrected?: string }>;
            nextLa.correctedExcerpts = la.correctedExcerpts.map((ex, i) => ({
              ...ex,
              context: translated[i]?.context || ex.context,
              original: translated[i]?.original || ex.original,
              corrected: translated[i]?.corrected || ex.corrected,
            }));
          }
          this.edPrep = { ...this.edPrep, latestAnalysis: nextLa };
        }
        if (Array.isArray(prep['otherNotes']) && this.edPrep.otherTutorNotes?.length) {
          const notes = prep['otherNotes'] as string[];
          this.edPrep = {
            ...this.edPrep,
            otherTutorNotes: this.edPrep.otherTutorNotes.map((n, i) => ({
              ...n,
              text: notes[i] || n.text,
            })),
          };
        }
      }

      const misc = client['misc'] as Record<string, unknown> | undefined;
      if (misc) {
        if (typeof misc['cancelReason'] === 'string') this.cancelReasonLabel = misc['cancelReason'];
        if (typeof misc['issueDetails'] === 'string') this.issueDetailsText = misc['issueDetails'];
        if (typeof misc['lessonNotes'] === 'string' && this.lesson) {
          this.lesson = { ...this.lesson, notes: misc['lessonNotes'] };
        }
        if (Array.isArray(misc['recommendedStruggles'])) {
          this.recommendedStruggles = misc['recommendedStruggles'] as string[];
        }
        if (Array.isArray(misc['recommendedMaterialTitles']) && this.recommendedMaterials.length) {
          const titles = misc['recommendedMaterialTitles'] as string[];
          this.recommendedMaterials = this.recommendedMaterials.map((m, i) => ({
            ...m,
            title: titles[i] || m.title,
          }));
        }
      }
    }
  }

  private restorePageOriginals(): void {
    const orig = this.pageOriginals;
    if (!orig) {
      this.pageShowingTranslation = false;
      return;
    }

    this.lastSessionSummary = orig.lastSessionSummary;
    this.lastSessionFocus = [...orig.lastSessionFocus];
    this.analysisData = orig.analysisData ? JSON.parse(JSON.stringify(orig.analysisData)) : this.analysisData;
    this.feedbackStrengths = [...orig.feedbackStrengths];
    this.feedbackImprovements = [...orig.feedbackImprovements];
    this.feedbackNotes = orig.feedbackNotes;
    this.edPlanNextFocus = orig.edPlanNextFocus;
    this.edPlanGoalLabel = orig.edPlanGoalLabel;
    this.edPlanPhaseLabel = orig.edPlanPhaseLabel;
    this.edPlanMetaLine = orig.edPlanMetaLine;
    this.edPlanTopicChips = [...orig.edPlanTopicChips];
    this.edPlanAgenda = [...orig.edPlanAgenda];
    this.edPrep = orig.edPrep ? JSON.parse(JSON.stringify(orig.edPrep)) : this.edPrep;
    this.cancelReasonLabel = orig.cancelReasonLabel;
    this.issueDetailsText = orig.issueDetailsText;
    if (this.lesson && orig.lessonNotes !== undefined) {
      this.lesson = { ...this.lesson, notes: orig.lessonNotes };
    }
    this.recommendedStruggles = [...orig.recommendedStruggles];
    this.recommendedMaterials = JSON.parse(JSON.stringify(orig.recommendedMaterials));

    if (this.analysisData) {
      this.computeAnalysisProperties();
      this.resolveSidebarNotes();
    } else {
      this.hasTutorNote = false;
      this.sanitizedTutorNote = '';
    }
    this.refreshPlanPresentation();
    this.pageShowingTranslation = false;
    this.cdr.detectChanges();
  }

  toggleLastSessionTranslation(): void {
    this.togglePageTranslation();
  }

  private resolvePlanStudentId(): string | null {
    if (this.isTutorUser) {
      return this.participantId;
    }
    const lessonStudent = (this.lesson as any)?.studentId;
    if (lessonStudent) {
      return typeof lessonStudent === 'object'
        ? String(lessonStudent._id || lessonStudent.id || '')
        : String(lessonStudent);
    }
    const userId = (this.currentUser as any)?._id || this.currentUser?.id;
    return userId ? String(userId) : null;
  }

  private pickPlanSummaryForLesson(
    summaries: LearningPlanSummary[],
    lessonLanguage: string
  ): LearningPlanSummary | null {
    if (!summaries.length) return null;
    const normalized = lessonLanguage.trim().toLowerCase();
    if (normalized) {
      const match = summaries.find(
        (s) => (s.language || '').trim().toLowerCase() === normalized
      );
      if (match) return match;
    }
    return summaries[0];
  }

  private goalLabelForType(type: string | undefined, description?: string): string {
    if (type && GOAL_TYPE_I18N_KEYS[type]) {
      return this.translate.instant(GOAL_TYPE_I18N_KEYS[type]);
    }
    return description || '';
  }

  /** Role-aware goal line for the lesson focus card meta row. */
  private buildPlanMetaLine(): string {
    const parts: string[] = [];
    if (this.edPlanGoalLabel) {
      if (this.isTutorUser) {
        const name = this.participantName?.split(' ')[0] || '';
        if (name) {
          const goalPhrase = this.edPlanGoalLabel.charAt(0).toLowerCase() + this.edPlanGoalLabel.slice(1);
          parts.push(this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.PLAN_GOAL_TUTOR_NAMED', {
            name,
            goal: goalPhrase
          }));
        } else {
          parts.push(this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.PLAN_GOAL_TUTOR', {
            goal: this.edPlanGoalLabel
          }));
        }
      } else {
        parts.push(this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.PLAN_GOAL_STUDENT', {
          goal: this.edPlanGoalLabel
        }));
      }
    }
    if (this.edPlanPhaseLabel) {
      parts.push(this.edPlanPhaseLabel);
    }
    return parts.join(' · ');
  }

  private applyPlanSummary(summary: LearningPlanSummary): void {
    this.edPlanSummary = summary;
    this.edPlanGoalLabel = this.goalLabelForType(summary.goal?.type, summary.goal?.description);
    this.edPlanPhaseLabel = summary.currentPhase
      ? this.translate.instant('PRE_CALL.PHASE_LABEL', {
          current: String(summary.currentPhaseIndex + 1),
          total: String(summary.totalPhases),
          title: summary.currentPhase.title,
        })
      : '';
    this.edPlanNextFocus = summary.nextLessonFocus || '';
    this.edPlanStudentSummary = summary.studentSummary || '';
    this.edPlanFocusAreas = summary.currentPhase?.focusAreas || [];
    this.edPlanSuggestedTopics = summary.currentPhase?.suggestedTopics || [];
    this.edHasPlan = true;
    this.refreshPlanPresentation();
    this.capturePageOriginals();
  }

  private resetPlanContext(): void {
    this.edPlanSummary = null;
    this.edPlanGoalLabel = '';
    this.edPlanPhaseLabel = '';
    this.edPlanNextFocus = '';
    this.edPlanStudentSummary = '';
    this.edPlanFocusAreas = [];
    this.edPlanSuggestedTopics = [];
    this.edPlanAgenda = [];
    this.edPlanMetaLine = '';
    this.edPlanTopicChips = [];
    this.edPlanEyebrowKey = 'EVENT_DETAILS.LESSON_SCREEN.LESSON_OBJECTIVE';
    this.edPlanIsTrial = false;
    this.edPlanTrialBody = '';
    this.edPlanStateLabel = '';
    this.edShowPlanExpanded = false;
    this.edShowTutorBriefing = false;
    this.edPrepShowPersistentChallenges = false;
    this.edHasPlan = false;
  }

  private refreshPlanPresentation(): void {
    if (!this.edHasPlan) return;

    this.edPlanMetaLine = this.buildPlanMetaLine();

    this.edPlanEyebrowKey = this.isLessonCompleted
      ? 'EVENT_DETAILS.LESSON_SCREEN.PLAN_NEXT_UP'
      : 'EVENT_DETAILS.LESSON_SCREEN.LESSON_OBJECTIVE';

    if (this.isTutorUser) {
      this.edPlanEyebrowKey = this.isLessonCompleted
        ? 'EVENT_DETAILS.LESSON_SCREEN.PLAN_TUTOR_NEXT'
        : 'EVENT_DETAILS.LESSON_SCREEN.PLAN_TUTOR_THIS';
    }

    this.edShowPlanExpanded = !this.isLessonCompleted;
    this.edPlanTopicChips = this.edShowPlanExpanded
      ? (this.edPlanSuggestedTopics.length
          ? this.edPlanSuggestedTopics
          : this.edPlanFocusAreas).slice(0, 4)
      : [];

    // Trial calibration framing — overrides the objective for an upcoming trial.
    this.edPlanIsTrial = !this.isLessonCompleted && !!this.lesson?.isTrialLesson;
    if (this.edPlanIsTrial) {
      const other = this.isTutorUser ? this.lesson?.studentId : this.lesson?.tutorId;
      const displayName = this.participantName || (other ? this.formatPersonName(other) : '');
      this.edPlanTrialBody = this.isTutorUser
        ? this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.TRIAL_OBJECTIVE_TUTOR', { name: displayName })
        : this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.TRIAL_OBJECTIVE_STUDENT');
    } else {
      this.edPlanTrialBody = '';
    }

    // Draft-state chip — only meaningful while the plan is still a draft.
    this.edPlanStateLabel = this.edPlanSummary?.status === 'draft'
      ? this.translate.instant(this.isTutorUser
          ? 'EVENT_DETAILS.LESSON_SCREEN.PLAN_STATE_DRAFT_TUTOR'
          : 'EVENT_DETAILS.LESSON_SCREEN.PLAN_STATE_DRAFT')
      : '';

    this.edShowTutorBriefing =
      this.isTutorUser && !this.isLessonCompleted && !!this.edPrepHasContent;
  }

  private refreshNotesPresentation(): void {
    if (this.isStudentUser) {
      this.showTutorPrivateNotes = false;
      this.showLessonNotesSection = this.hasAnalysis;
      this.notesSectionLabelKey = 'EVENT_DETAILS.LESSON_SCREEN.NOTES';
      return;
    }

    if (this.isTutorUser) {
      this.showTutorPrivateNotes =
        this.isLessonCompleted && !!this.lesson?.notes && !this.hasAnalysis;
      this.showLessonNotesSection =
        this.isLessonCompleted && (this.hasAnalysis || this.showTutorPrivateNotes);
      if (this.hasAnalysis) {
        this.notesSectionLabelKey = 'EVENT_DETAILS.LESSON_SCREEN.LESSON_ANALYSIS';
      } else if (this.showTutorPrivateNotes) {
        this.notesSectionLabelKey = 'EVENT_DETAILS.LESSON_SCREEN.FROM_THIS_LESSON';
      }
      return;
    }

    this.showLessonNotesSection = false;
    this.showTutorPrivateNotes = false;
  }

  /** `lesson.notes` is tutor-private in the data model — never expose in the student UI. */
  private sanitizeLessonForViewerRole(): void {
    if (!this.lesson || !this.isStudentUser) return;
    if (this.lesson.notes) {
      this.lesson = { ...this.lesson, notes: undefined };
    }
  }

  private loadLearningPlanContext(): void {
    if (isLessonMockId(this.eventId)) {
      this.applyMockLearningPlanContext(this.eventId!);
      return;
    }

    const studentId = this.resolvePlanStudentId();
    if (!studentId) return;

    this.resetPlanContext();

    const lessonLanguage =
      String((this.lesson as any)?.language || (this.lesson as any)?.subject || '').trim();

    this.learningPlanService.getStudentPlanSummary(studentId).subscribe({
      next: (res) => {
        if (res.success && res.summaries?.length) {
          const summary = this.pickPlanSummaryForLesson(res.summaries, lessonLanguage);
          if (summary) {
            this.applyPlanSummary(summary);
            this.cdr.detectChanges();
          }
        }
      },
      error: () => {},
    });

    if (lessonLanguage) {
      this.learningPlanService.getLessonPrep(studentId, lessonLanguage).subscribe({
        next: (res) => {
          if (!res.success || !res.prep) return;
          if (this.isTutorUser) {
            this.applyLessonPrep(res.prep);
          } else {
            this.edPlanAgenda = res.prep.agenda || [];
            if (!this.edPlanNextFocus && res.prep.plan?.nextLessonFocus) {
              this.edPlanNextFocus = res.prep.plan.nextLessonFocus;
            }
          }
          this.cdr.detectChanges();
        },
        error: () => {},
      });
    }
  }

  private applyMockLearningPlanContext(mockId: string): void {
    const ctx = getMockLearningPlanContext(mockId);
    if (!ctx) {
      this.resetPlanContext();
      return;
    }

    this.applyPlanSummary(ctx.summary);
    if (this.isTutorUser) {
      this.applyLessonPrep(ctx.prep);
    } else {
      this.edPlanAgenda = ctx.prep.agenda || [];
    }
  }

  /**
   * Map the lesson-prep payload onto the briefing UI bindings.
   * Pure presentation — no fetches.
   */
  private applyLessonPrep(prep: LessonPrep) {
    this.edPrep = prep;

    const phase = prep.plan?.currentPhase;
    const mastery = phase?.masteryAverage;
    if (mastery !== null && mastery !== undefined) {
      this.edPrepMasteryLabel = this.translate.instant('EVENT_DETAILS.BRIEFING.MASTERY_LABEL', { score: mastery });
      this.edPrepMasteryPercent = Math.max(0, Math.min(100, mastery));
    } else {
      this.edPrepMasteryLabel = '';
      this.edPrepMasteryPercent = 0;
    }

    // Phase pill — short label so it fits next to the briefing title.
    if (phase?.title && prep.plan) {
      const idx = (prep.plan.currentPhaseIndex ?? 0) + 1;
      const total = prep.plan.totalPhases ?? 0;
      this.edPrepPhasePillLabel = phase.title;
      this.edPrepPhasePillIndex = total ? `${idx}/${total}` : `${idx}`;
    } else {
      this.edPrepPhasePillLabel = '';
      this.edPrepPhasePillIndex = '';
    }

    this.edPrepStudentEdited = !!phase?.studentEditedAt;

    // First-time pairing → auto-expand briefing so the tutor reads it
    // before the lesson starts. We only force-expand once on load; the
    // tutor can collapse it manually if they want to.
    this.edPrepFirstTimePairing = !!prep.firstTimePairing;
    if (this.edPrepFirstTimePairing) {
      this.edPrepBriefingExpanded = true;
    }

    const change = prep.latestAnalysis?.proficiencyChange;
    if (change === 'improved') {
      this.edPrepProficiencyChangeIcon = 'arrow-up-outline';
      this.edPrepProficiencyChangeLabel = this.translate.instant('EVENT_DETAILS.BRIEFING.PROFICIENCY_IMPROVING');
    } else if (change === 'declined') {
      this.edPrepProficiencyChangeIcon = 'arrow-down-outline';
      this.edPrepProficiencyChangeLabel = this.translate.instant('EVENT_DETAILS.BRIEFING.PROFICIENCY_SLIPPING');
    } else if (change === 'maintained') {
      this.edPrepProficiencyChangeIcon = 'remove-outline';
      this.edPrepProficiencyChangeLabel = this.translate.instant('EVENT_DETAILS.BRIEFING.PROFICIENCY_HOLDING');
    } else {
      this.edPrepProficiencyChangeIcon = null;
      this.edPrepProficiencyChangeLabel = '';
    }

    this.edPrepHasContent = !!(
      prep.agenda?.length ||
      prep.latestAnalysis?.topErrors?.length ||
      prep.latestAnalysis?.persistentChallenges?.length ||
      prep.latestAnalysis?.correctedExcerpts?.length ||
      prep.otherTutorNotes?.length ||
      mastery !== null
    );

    const hasTopErrors = (prep.latestAnalysis?.topErrors?.length || 0) > 0;
    this.edPrepShowPersistentChallenges =
      !hasTopErrors && (prep.latestAnalysis?.persistentChallenges?.length || 0) > 0;

    this.refreshPlanPresentation();
    this.capturePageOriginals();
  }

  toggleBriefingExpanded() {
    this.edPrepBriefingExpanded = !this.edPrepBriefingExpanded;
  }

  private computeAnalysisProperties() {
    if (!this.analysisData) return;
    this.hasAnalysis = this.analysisData.status === 'completed';
    this.analysisUnavailable = ['failed', 'insufficient_data'].includes(this.analysisData.status || '');
    this.isAiAnalysis = this.analysisData.source !== 'tutor';
    this.analysisLabel = this.isAiAnalysis
      ? this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.AI_ANALYSIS_LABEL')
      : this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.TUTOR_ASSESSMENT_LABEL');

    // Pre-compute score colors
    this.grammarScoreColor = this.calcScoreColor(this.analysisData.grammarAnalysis?.accuracyScore);
    this.fluencyScoreColor = this.calcScoreColor(this.analysisData.fluencyAnalysis?.overallFluencyScore);
    this.pronunciationScoreColor = this.calcScoreColor(this.analysisData.pronunciationAnalysis?.overallScore);

    // Tutor note
    if (this.analysisData.tutorNote?.text) {
      this.hasTutorNote = true;
      this.sanitizedTutorNote = this.sanitizer.bypassSecurityTrustHtml(this.analysisData.tutorNote.text);
    }

    this.refreshNotesPresentation();
  }

  private calcScoreColor(score: number | undefined): string {
    if (score == null) return '#6b7280';
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#f59e0b';
    return '#ef4444';
  }

  private resolveSidebarNotes() {
    this.sidebarNotesShowingTranslation = false;
    this.sidebarNotesTranslationCache = null;
    this.sidebarNotesTranslating = false;

    if (this.hasAnalysis && this.analysisData) {
      this.sidebarNotesSource = 'current';
      this.sidebarNotesTitle = 'Lesson notes';
      this.sidebarNotesDateSub = '';
      this.sidebarNotesOriginalAnalysis = this.analysisData;
      this.sidebarNotesIsAi = this.isAiAnalysis;
      this.sidebarNotesLessonId = this.eventId;
      this.sidebarNotesAnalysisId = this.analysisData._id || null;
      this.hasSidebarNotes = true;
      this.showSidebarNotesEmpty = false;
      this.seedAndApplyTranslation(this.analysisData, this.analysisData.translations);
    } else if (this.hasPreviousNotes && this.previousNotesData?.analysis) {
      this.sidebarNotesSource = 'previous';
      this.sidebarNotesTitle = 'Notes from last lesson';
      this.sidebarNotesDateSub = this.previousNotesDate;
      this.sidebarNotesOriginalAnalysis = this.previousNotesData.analysis;
      this.sidebarNotesIsAi = this.previousNotesIsAiSource;
      this.sidebarNotesLessonId = this.previousNotesData.previousLessonId;
      this.sidebarNotesAnalysisId = this.previousNotesData.analysisId || null;
      this.hasSidebarNotes = true;
      this.showSidebarNotesEmpty = false;
      this.seedAndApplyTranslation(this.previousNotesData.analysis, this.previousNotesData.translations);
    } else {
      this.sidebarNotesSource = null;
      this.hasSidebarNotes = false;
      this.sidebarNotesAnalysis = null;
      this.sidebarNotesOriginalAnalysis = null;
      this.sidebarNotesSanitized = null;
      this.sidebarNotesAnalysisId = null;
      this.showSidebarNotesEmpty = true;
      this.sidebarNotesEmptyDescKey = this.isTutorUser
        ? 'EVENT_DETAILS.SIDEBAR_NOTES_EMPTY_DESC_TUTOR'
        : 'EVENT_DETAILS.SIDEBAR_NOTES_EMPTY_DESC_STUDENT';
    }
  }

  private seedAndApplyTranslation(analysis: any, translations?: Record<string, any>) {
    const targetLang = this.currentUser?.nativeLanguage || 'en';
    const cached = translations?.[targetLang];
    if (cached && this.sidebarNotesAnalysisId) {
      this.analysisTranslation.seedFromResponse(this.sidebarNotesAnalysisId, cached);
    }
    this.refreshSidebarFromTranslationState();
    if (!this.sidebarNotesShowingTranslation) {
      this.sidebarNotesAnalysis = analysis;
      this.sidebarNotesSanitized = analysis.tutorNote?.text
        ? this.sanitizer.bypassSecurityTrustHtml(analysis.tutorNote.text)
        : null;
    }
  }

  viewSidebarAnalysis() {
    if (!this.sidebarNotesLessonId) return;
    this.router.navigate(['/lesson-analysis', this.sidebarNotesLessonId]);
  }

  toggleSidebarTranslation() {
    this.togglePageTranslation();
  }

  private refreshSidebarFromTranslationState() {
    if (!this.sidebarNotesAnalysisId || !this.sidebarNotesOriginalAnalysis) return;

    const hasTranslation = this.analysisTranslation.hasTranslation(this.sidebarNotesAnalysisId);
    const showing = this.analysisTranslation.isShowingTranslated(this.sidebarNotesAnalysisId);
    const translation = this.analysisTranslation.getTranslation(this.sidebarNotesAnalysisId);

    if (hasTranslation && showing && translation) {
      this.sidebarNotesAnalysis = this.analysisTranslation.applyTranslation(this.sidebarNotesOriginalAnalysis, translation);
      this.sidebarNotesSanitized = this.sidebarNotesAnalysis.tutorNote?.text
        ? this.sanitizer.bypassSecurityTrustHtml(this.sidebarNotesAnalysis.tutorNote.text)
        : null;
      this.sidebarNotesShowingTranslation = true;
    } else {
      this.sidebarNotesAnalysis = this.sidebarNotesOriginalAnalysis;
      this.sidebarNotesSanitized = this.sidebarNotesOriginalAnalysis?.tutorNote?.text
        ? this.sanitizer.bypassSecurityTrustHtml(this.sidebarNotesOriginalAnalysis.tutorNote.text)
        : null;
      this.sidebarNotesShowingTranslation = false;
    }
    this.cdr.detectChanges();
  }

  private computeFeedbackProperties() {
    if (!this.tutorFeedback || this.tutorFeedback.status !== 'completed') return;
    this.hasTutorFeedback = true;
    this.feedbackStrengths = this.tutorFeedback.strengths || [];
    this.feedbackImprovements = this.tutorFeedback.areasForImprovement || [];
    this.feedbackNotes = this.tutorFeedback.overallNotes || '';
    this.feedbackCefrLevel = this.tutorFeedback.estimatedCefrLevel || '';
    this.feedbackDate = this.tutorFeedback.providedAt
      ? formatDateInTz(this.tutorFeedback.providedAt, this.userTz, { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
  }

  private computeBillingProperties() {
    if (!this.billingData) return;
    this.formattedActualPrice = this.billingData.actualPrice != null
      ? `$${this.billingData.actualPrice.toFixed(2)}`
      : '';
    this.formattedActualDuration = this.billingData.actualDuration != null
      ? `${this.billingData.actualDuration} min`
      : '';
  }

  private computePaymentMethodLabel(method: string) {
    switch (method) {
      case 'wallet':
        this.paymentMethodLabel = this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.PAYMENT_WALLET');
        this.paymentMethodIcon = 'wallet-outline';
        break;
      case 'card':
        this.paymentMethodLabel = this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.PAYMENT_CARD');
        this.paymentMethodIcon = 'card-outline';
        break;
      case 'apple_pay':
        this.paymentMethodLabel = this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.PAYMENT_APPLE_PAY');
        this.paymentMethodIcon = 'logo-apple';
        break;
      case 'google_pay':
        this.paymentMethodLabel = this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.PAYMENT_GOOGLE_PAY');
        this.paymentMethodIcon = 'logo-google';
        break;
      default:
        this.paymentMethodLabel = method ? method.charAt(0).toUpperCase() + method.slice(1).replace(/_/g, ' ') : '';
        this.paymentMethodIcon = 'card-outline';
        break;
    }
  }

  /** Payment status copy under `EVENT_DETAILS.PAYMENT.*` */
  private paymentTr(key: string): string {
    return this.translate.instant(`EVENT_DETAILS.PAYMENT.${key}`);
  }

  private computePaymentStatus() {
    const p = this.paymentData;
    if (!p) return;

    this.paymentStatusDetails = [];

    const status = p.status;
    const transferStatus = p.transferStatus;
    const isCancelled = this.lesson?.status === 'cancelled';
    const isLate = !!this.lesson?.isLateCancellation;
    const cancellationFee = this.lesson?.cancellationFeeCharged || 0;
    const refundAmt = p.refundAmount || 0;
    const amount = p.amount || 0;
    const tutorPayout = p.tutorPayout || 0;

    this.hasPaymentStatus = true;

    if (status === 'refunded') {
      this.paymentStatusClass = 'refunded';
      this.paymentStatusIcon = 'arrow-undo-circle-outline';
      if (this.isStudentUser) {
        this.paymentStatusTitle = this.paymentTr('REFUNDED_TITLE_STUDENT');
        const refundDisplay = refundAmt > 0 ? refundAmt.toFixed(2) : amount.toFixed(2);
        this.paymentStatusDescription = this.paymentTr('REFUNDED_DESC_STUDENT').replace(
          '{{amount}}',
          `$${refundDisplay}`,
        );
        if (p.refundReason) {
          this.paymentStatusDetails.push({ key: this.paymentTr('ROW_REASON'), value: p.refundReason });
        }
        if (p.refundMethod) {
          const methodLabel =
            p.refundMethod === 'wallet'
              ? this.paymentTr('ROW_WALLET_CREDIT')
              : this.paymentTr('ROW_ORIGINAL_PAYMENT_METHOD');
          this.paymentStatusDetails.push({ key: this.paymentTr('ROW_REFUNDED_TO'), value: methodLabel });
        }
      } else {
        this.paymentStatusTitle = this.paymentTr('REVERSED_TITLE_TUTOR');
        this.paymentStatusDescription = this.paymentTr('REVERSED_DESC_TUTOR');
        if (p.refundReason) {
          this.paymentStatusDetails.push({ key: this.paymentTr('ROW_REASON'), value: p.refundReason });
        }
      }
    } else if (status === 'partially_refunded') {
      this.paymentStatusClass = 'partial';
      this.paymentStatusIcon = 'swap-horizontal-outline';
      if (this.isStudentUser) {
        this.paymentStatusTitle = this.paymentTr('PARTIAL_TITLE_STUDENT');
        this.paymentStatusDescription = this.paymentTr('PARTIAL_DESC_STUDENT').replace(
          '{{amount}}',
          `$${refundAmt.toFixed(2)}`,
        );
        const finalCharge = amount - refundAmt;
        this.paymentStatusDetails.push({
          key: this.paymentTr('ROW_ORIGINAL_AMOUNT'),
          value: `$${amount.toFixed(2)}`,
        });
        this.paymentStatusDetails.push({
          key: this.paymentTr('ROW_REFUNDED'),
          value: `$${refundAmt.toFixed(2)}`,
        });
        this.paymentStatusDetails.push({
          key: this.paymentTr('ROW_FINAL_CHARGE'),
          value: `$${finalCharge.toFixed(2)}`,
        });
        if (p.refundReason) {
          this.paymentStatusDetails.push({ key: this.paymentTr('ROW_REASON'), value: p.refundReason });
        }
      } else {
        this.paymentStatusTitle = this.paymentTr('ADJUSTED_TITLE_TUTOR');
        this.paymentStatusDescription = this.paymentTr('ADJUSTED_DESC_TUTOR');
        if (tutorPayout > 0) {
          this.paymentStatusDetails.push({
            key: this.paymentTr('ROW_YOUR_EARNINGS'),
            value: `$${tutorPayout.toFixed(2)}`,
          });
        }
        if (p.refundReason) {
          this.paymentStatusDetails.push({ key: this.paymentTr('ROW_REASON'), value: p.refundReason });
        }
      }
    } else if (status === 'cancelled' || (isCancelled && status !== 'succeeded')) {
      this.paymentStatusClass = 'cancelled';
      this.paymentStatusIcon = 'close-circle-outline';
      if (this.isStudentUser) {
        if (isLate && cancellationFee > 0) {
          this.paymentStatusTitle = this.paymentTr('CANCEL_FEE_TITLE_STUDENT');
          this.paymentStatusDescription = this.paymentTr('CANCEL_FEE_DESC_STUDENT').replace(
            '{{fee}}',
            `$${cancellationFee.toFixed(2)}`,
          );
          if (amount - cancellationFee > 0) {
            this.paymentStatusDetails.push({
              key: this.paymentTr('ROW_REFUNDED'),
              value: `$${(amount - cancellationFee).toFixed(2)}`,
            });
          }
          this.paymentStatusDetails.push({
            key: this.paymentTr('ROW_CANCELLATION_FEE'),
            value: `$${cancellationFee.toFixed(2)}`,
          });
        } else {
          this.paymentStatusTitle = this.paymentTr('NO_CHARGE_TITLE_STUDENT');
          this.paymentStatusDescription = this.paymentTr('NO_CHARGE_DESC_STUDENT');
        }
      } else {
        if (isLate && cancellationFee > 0) {
          this.paymentStatusTitle = this.paymentTr('LATE_COMP_TITLE_TUTOR');
          const comp = tutorPayout > 0 ? tutorPayout.toFixed(2) : cancellationFee.toFixed(2);
          this.paymentStatusDescription = this.paymentTr('LATE_COMP_DESC_TUTOR').replace('{{amount}}', `$${comp}`);
        } else {
          this.paymentStatusTitle = this.paymentTr('NO_EARNINGS_TITLE_TUTOR');
          this.paymentStatusDescription = this.paymentTr('NO_EARNINGS_DESC_TUTOR');
        }
      }
    } else if (transferStatus === 'on_hold' || this.lesson?.payoutPaused) {
      this.paymentStatusClass = 'on-hold';
      this.paymentStatusIcon = 'pause-circle-outline';
      if (this.isStudentUser) {
        this.paymentStatusTitle = this.paymentTr('HOLD_TITLE_STUDENT');
        this.paymentStatusDescription = this.paymentTr('HOLD_DESC_STUDENT');
      } else {
        this.paymentStatusTitle = this.paymentTr('HOLD_TITLE_TUTOR');
        this.paymentStatusDescription = this.paymentTr('HOLD_DESC_TUTOR');
      }
    } else if (status === 'succeeded' || status === 'authorized') {
      const lessonCompleted = this.lesson?.status === 'completed';
      const lessonEnded = this.lesson?.endTime && new Date(this.lesson.endTime).getTime() < Date.now();
      const isFinished = lessonCompleted || lessonEnded;

      this.paymentStatusClass = isFinished ? 'paid' : 'pending';
      this.paymentStatusIcon = isFinished ? 'checkmark-circle-outline' : 'time-outline';
      if (this.isStudentUser) {
        if (isFinished) {
          this.paymentStatusTitle = this.paymentTr('COMPLETE_TITLE_STUDENT');
          this.paymentStatusDescription = this.paymentTr('COMPLETE_DESC_STUDENT').replace(
            '{{amount}}',
            `$${amount.toFixed(2)}`,
          );
        } else {
          this.paymentStatusTitle = this.paymentTr('AUTHORIZED_TITLE_STUDENT');
          this.paymentStatusDescription = this.paymentTr('AUTHORIZED_DESC_STUDENT').replace(
            '{{amount}}',
            `$${amount.toFixed(2)}`,
          );
        }
      } else {
        const tipNet = this.lesson?.tip?.tutorReceived ?? this.lesson?.tip?.amount ?? 0;
        const totalEarned = tutorPayout + tipNet;
        const hasTip = tipNet > 0;
        if (isFinished) {
          this.paymentStatusTitle = this.paymentTr('CONFIRMED_TITLE_TUTOR');
          if (totalEarned > 0) {
            const descKey = hasTip ? 'CONFIRMED_DESC_TUTOR_WITH_TIP' : 'CONFIRMED_DESC_TUTOR';
            this.paymentStatusDescription = this.paymentTr(descKey).replace('{{total}}', `$${totalEarned.toFixed(2)}`);
          } else {
            this.paymentStatusDescription = this.paymentTr('CONFIRMED_DESC_TUTOR_EMPTY');
          }
          if (amount > 0 && tutorPayout > 0 && amount > tutorPayout) {
            const platformFee = amount - tutorPayout;
            this.paymentStatusDetails.push({
              key: this.paymentTr('ROW_LESSON_PRICE'),
              value: `+$${amount.toFixed(2)}`,
            });
            this.paymentStatusDetails.push({
              key: this.paymentTr('ROW_PLATFORM_FEE'),
              value: `−$${platformFee.toFixed(2)}`,
            });
            this.paymentStatusDetails.push({
              key: this.paymentTr('ROW_YOUR_EARNINGS'),
              value: `$${tutorPayout.toFixed(2)}`,
            });
          }
        } else {
          this.paymentStatusTitle = this.paymentTr('PENDING_TITLE_TUTOR');
          if (totalEarned > 0) {
            const descKey = hasTip ? 'PENDING_DESC_TUTOR_WITH_TIP' : 'PENDING_DESC_TUTOR';
            this.paymentStatusDescription = this.paymentTr(descKey).replace('{{total}}', `$${totalEarned.toFixed(2)}`);
          } else {
            this.paymentStatusDescription = this.paymentTr('PENDING_DESC_TUTOR_EMPTY');
          }
          if (amount > 0 && tutorPayout > 0 && amount > tutorPayout) {
            const platformFee = amount - tutorPayout;
            this.paymentStatusDetails.push({
              key: this.paymentTr('ROW_LESSON_PRICE'),
              value: `+$${amount.toFixed(2)}`,
            });
            this.paymentStatusDetails.push({
              key: this.paymentTr('ROW_PLATFORM_FEE'),
              value: `−$${platformFee.toFixed(2)}`,
            });
            this.paymentStatusDetails.push({
              key: this.paymentTr('ROW_YOUR_EARNINGS'),
              value: `$${tutorPayout.toFixed(2)}`,
            });
          }
        }
      }
    } else {
      this.hasPaymentStatus = false;
    }

    if (p.refundedAt && this.hasPaymentStatus && (status === 'refunded' || status === 'partially_refunded')) {
      this.paymentStatusDetails.push({
        key: this.paymentTr('ROW_DATE'),
        value: formatDateInTz(p.refundedAt, this.userTz, { month: 'short', day: 'numeric', year: 'numeric' }),
      });
    }

    if (this.hasPaymentStatus && this.hasTip) {
      if (this.isTutorUser && this.tipHasFee) {
        this.paymentStatusDetails.push({ key: this.paymentTr('ROW_TIP'), value: `+${this.tipAmount}` });
        this.paymentStatusDetails.push({ key: this.paymentTr('ROW_PROCESSING_FEE'), value: `−${this.tipStripeFee}` });
        this.paymentStatusDetails.push({
          key: this.paymentTr('ROW_TIP_RECEIVED'),
          value: this.tipTutorReceived,
        });
      } else {
        this.paymentStatusDetails.push({
          key: this.isTutorUser ? this.paymentTr('ROW_TIP_RECEIVED') : this.paymentTr('ROW_TIP_SENT'),
          value: this.tipAmount,
        });
      }
    }
  }

  /**
   * Stable string id for API refs: string, ObjectId, or { _id, id, $oid }.
   */
  private normalizeRefId(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') {
      const o: any = v;
      if (typeof o.$oid === 'string') return o.$oid;
      if (o._id != null) return this.normalizeRefId(o._id);
      if (o.id != null) return this.normalizeRefId(o.id);
      if (typeof o.toString === 'function') {
        const s = o.toString();
        if (s && s !== '[object Object]') return s;
      }
    }
    return '';
  }

  /**
   * Resolve class `tutorId` (string ref or populated lean user) to a user id string.
   */
  private tutorUserIdFromClassTutorRef(tutor: unknown): string {
    if (tutor == null) return '';
    if (typeof tutor === 'string') return tutor;
    if (typeof tutor === 'object') {
      const t: any = tutor;
      if (t._id != null || t.id != null) {
        return this.normalizeRefId(t._id ?? t.id);
      }
    }
    return this.normalizeRefId(tutor);
  }

  private computeClassProperties() {
    if (!this.classData) return;
    const now = new Date();
    const start = new Date(this.classData.startTime);
    const end = new Date(this.classData.endTime);

    if (this.classData.status === 'cancelled') {
      this.statusLabel = this.translate.instant('LESSONS_PAGE.STATUS_CANCELLED');
      this.statusColor = '#ef4444';
      this.statusClass = 'cancelled';
      this.classIsCancelled = true;
    } else if (now >= start && now <= end) {
      this.statusLabel = this.translate.instant('LESSONS_PAGE.STATUS_IN_PROGRESS');
      this.statusColor = '#10b981';
      this.statusClass = 'in-progress';
    } else if (now > end || this.classData.status === 'completed') {
      this.statusLabel = this.translate.instant('LESSONS_PAGE.STATUS_COMPLETED');
      this.statusColor = '#6b7280';
      this.statusClass = 'completed';
      this.classIsCompleted = true;
    } else {
      this.statusLabel = this.translate.instant('LESSONS_PAGE.STATUS_UPCOMING');
      this.statusColor = '#667eea';
      this.statusClass = 'upcoming';
    }

    // Formatted date/time
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (start.toDateString() === today.toDateString()) {
      this.formattedDate = this.translate.instant('HOME.TODAY');
    } else if (start.toDateString() === tomorrow.toDateString()) {
      this.formattedDate = this.translate.instant('HOME.TOMORROW');
    } else {
      this.formattedDate = formatDateInTz(start, this.userTz, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    this.formattedTimeRange = `${formatTimeInTz(start, this.userTz, undefined, true)} – ${formatTimeInTz(end, this.userTz, undefined, true)}`;
    this.formattedDuration = `${this.classData.duration || 60} minutes`;
    this.formattedPrice = this.classData.price
      ? `$${this.classData.price.toFixed(2)}`
      : this.translate.instant('EVENT_DETAILS.LESSON_SCREEN.MATERIAL_FREE');

    const levelMap: Record<string, string> = {
      any: 'Any Level', beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced'
    };
    this.levelLabel = levelMap[this.classData.level] || 'Any Level';

    if (this.classData.price && this.classData.confirmedStudents?.length) {
      this.classRevenue = `$${(this.classData.price * this.classData.confirmedStudents.length).toFixed(2)}`;
    }

    /**
     * Auto-cancel rule — mirrors the schedule-class wizard hint. Hidden once
     * the class has reached a terminal state (completed / in-progress /
     * cancelled), since the rule is a forward-looking promise. Copy tracks
     * the 1-hour job window in `backend/jobs/autoCancelClasses.js`.
     */
    const ruleClassStatus = String(this.classData?.status || '').toLowerCase();
    const ruleTerminalStatus =
      ruleClassStatus === 'cancelled' || ruleClassStatus === 'completed' || ruleClassStatus === 'in_progress';
    const minStudents = Number(this.classData?.minStudents ?? 0) || 0;
    const flexibleMinimum = !!this.classData?.flexibleMinimum;
    if (ruleTerminalStatus) {
      this.classRuleVisible = false;
      this.classRuleKind = null;
      this.classRuleIcon = '';
      this.classRuleText = '';
    } else if (flexibleMinimum) {
      this.classRuleVisible = true;
      this.classRuleKind = 'flexible';
      this.classRuleIcon = 'infinite-outline';
      this.classRuleText = `Auto-cancel disabled. Class will still cancel 1 hour before start if no students enroll.`;
    } else if (minStudents > 0) {
      this.classRuleVisible = true;
      this.classRuleKind = 'min';
      this.classRuleIcon = 'alert-circle-outline';
      this.classRuleText = `Auto-cancels 1 hour before start if fewer than ${minStudents} student${minStudents === 1 ? '' : 's'} enroll${minStudents === 1 ? 's' : ''}.`;
    } else {
      this.classRuleVisible = false;
      this.classRuleKind = null;
      this.classRuleIcon = '';
      this.classRuleText = '';
    }

    // Tutor info for the profile panel
    const tutor = this.classData.tutorId;
    const userId = this.normalizeRefId((this.currentUser as any)?._id ?? (this.currentUser as any)?.id);
    const resolvedTutorUserId = this.tutorUserIdFromClassTutorRef(tutor);
    this.classTutorId = resolvedTutorUserId || null;
    this.classIsCurrentUserTutor = userId !== '' && resolvedTutorUserId !== '' && resolvedTutorUserId === userId;
    this.isTutorUser = this.classIsCurrentUserTutor;
    this.isStudentUser = !this.classIsCurrentUserTutor;

    if (tutor && typeof tutor === 'object') {
      this.classTutorName = this.formatPersonName(tutor, 'Tutor');
      this.classTutorPicture = tutor.picture || tutor.profilePicture || '';
      this.classTutorInitial = (tutor.name || tutor.firstName || 'T').charAt(0).toUpperCase();
      this.classTutorBio = tutor.onboardingData?.bio || tutor.profile?.bio || '';
      this.classTutorLanguages = tutor.onboardingData?.languages || [];
      this.classTutorCountry = tutor.country || tutor.residenceCountry || '';
    }

    // Join / cancel button
    const minutesUntilStart = (start.getTime() - now.getTime()) / (1000 * 60);
    this.classShowJoinButton = this.statusClass === 'upcoming' || this.statusClass === 'in-progress';
    if (now >= start && now <= end) {
      this.classCanJoin = true;
      this.classJoinLabel = this.translate.instant('HOME.JOIN_NOW');
    } else if (minutesUntilStart <= 10 && end > now && !this.classIsCancelled) {
      this.classCanJoin = true;
      this.classJoinLabel = this.translate.instant('HOME.JOIN');
    } else if (this.classShowJoinButton) {
      this.classCanJoin = false;
      const secs = Math.max(0, Math.floor((start.getTime() - now.getTime()) / 1000));
      this.classJoinLabel = this.translate.instant('HOME.JOIN_IN_TIME', {
        time: this.lessonService.formatTimeUntil(secs),
      });
    }
    const tutorCanManage = this.classIsCurrentUserTutor;
    this.classCanCancel = tutorCanManage && !this.classIsCancelled && !this.classIsCompleted && start > now;
    this.classCanReschedule = tutorCanManage && !this.classIsCancelled && !this.classIsCompleted && start > now;

    // Student-only: may leave a scheduled class they're confirmed on, as long
    // as it hasn't started. Mirrors backend guard on POST /:classId/unenroll.
    const classStatus = String(this.classData?.status || '').toLowerCase();
    const isConfirmedStudent =
      !!userId &&
      (this.classData?.confirmedStudents || []).some(
        (s: any) => this.normalizeRefId(s?._id ?? s?.id) === userId
      );
    this.classCanLeave =
      this.isStudentUser &&
      isConfirmedStudent &&
      classStatus === 'scheduled' &&
      !this.classIsCancelled &&
      !this.classIsCompleted &&
      start > now;

    this.classStudentCtaKind = null;
    this.classStudentPrimaryDisabled = false;
    if (
      this.isStudentUser &&
      this.classData &&
      (this.statusClass === 'upcoming' || this.statusClass === 'in-progress') &&
      !this.classIsCancelled
    ) {
      const hasPendingInv = this.classData.hasInvitation && this.classData.invitationStatus === 'pending';
      const enrolled = !!this.classData.isEnrolled;
      if (hasPendingInv) {
        this.classStudentCtaKind = 'accept_invite';
      } else if (this.classData.isPublic && !enrolled && start > now) {
        this.classStudentCtaKind = 'enroll';
      } else {
        this.classStudentCtaKind = 'join_session';
      }
      if (this.classStudentCtaKind === 'accept_invite' || this.classStudentCtaKind === 'enroll') {
        this.classStudentPrimaryDisabled = !!this.classData.isFull || start.getTime() <= now.getTime();
      }
    }

    // Payment: count students who have paid
    const payments: any[] = this.classData.payments || [];
    const paidStudentIds = new Set(
      payments
        .filter((p: any) => p.status === 'succeeded' || p.status === 'authorized')
        .map((p: any) => String(p.studentId?._id || p.studentId || ''))
    );
    this.classStudentsPaidCount = paidStudentIds.size;

    this.classStudentsDisplay = (this.classData.confirmedStudents || []).map((s: any) => {
      const name = this.formatPersonName(s, 'Student');
      const sId = String(s._id || '');
      return {
        name,
        picture: s.picture || s.profilePicture,
        initials: name.split(' ').map((p: string) => p.charAt(0)).join('').toUpperCase().slice(0, 2),
        paid: paidStudentIds.has(sId),
      };
    });

    const enrolled = this.classData.confirmedStudents || [];
    // Tutor broadcast: collect confirmed student ids (excluding self).
    let receiverIds: string[] = enrolled
      .map((s: any) => this.normalizeRefId(s?._id ?? s?.id))
      .filter((id: string) => id && id !== userId);

    // Fall back to the mock preview's seeded auth0Ids when the class has no
    // real confirmed students yet. This keeps the broadcast flow testable
    // end-to-end against the preview avatars (see
    // `backend/scripts/seed-mock-class-students.js`).
    if (receiverIds.length === 0) {
      receiverIds = MOCK_CLASS_ATTENDEES_PREVIEW
        .map((s: any) => (s?.auth0Id || '').trim())
        .filter((id: string) => id && id !== userId);
    }
    this.classGoingReceiverIds = receiverIds;

    // Clickable only when we actually have someone to message:
    //  - student → tutor: need `classTutorId`.
    //  - tutor → students: need at least one recipient (real or seeded mock).
    this.classCanOpenGoingMessage =
      (this.isStudentUser && !!this.classTutorId) ||
      (this.classIsCurrentUserTutor && this.classGoingReceiverIds.length > 0);
    if (enrolled.length > 0) {
      this.classAttendeesForGridStack = enrolled;
      const cap = this.classData.maxStudents ?? this.classData.capacity;
      this.classAttendeesForGridCapacity =
        cap != null && Number.isFinite(Number(cap)) && Number(cap) > 0 ? Number(cap) : undefined;
    } else {
      this.classAttendeesForGridStack = [...MOCK_CLASS_ATTENDEES_PREVIEW];
      this.classAttendeesForGridCapacity = undefined;
    }

    // Compute class payment status
    this.computeClassPaymentStatus();
  }

  private computeClassPaymentStatus() {
    if (!this.classData) return;

    const isTutor = this.classData.tutorId?._id === this.currentUser?.id
      || this.classData.tutorId === this.currentUser?.id;
    const summary = this.classData.paymentSummary;
    const payments: any[] = this.classData.payments || [];
    const classStatus = this.classData.status;
    const classEnded = new Date(this.classData.endTime).getTime() < Date.now();

    if (isTutor && summary) {
      this.hasClassPaymentStatus = true;
      this.classPaymentDetails = [];

      if (summary.earningsStatus === 'withdrawn') {
        this.classPaymentStatusClass = 'paid';
        this.classPaymentStatusIcon = 'checkmark-circle-outline';
        this.classPaymentStatusTitle = 'Earnings withdrawn';
        this.classPaymentStatusDescription = `$${summary.totalTutorPayout.toFixed(2)} has been withdrawn to your account.`;
      } else if (summary.earningsStatus === 'available') {
        this.classPaymentStatusClass = 'paid';
        this.classPaymentStatusIcon = 'checkmark-circle-outline';
        this.classPaymentStatusTitle = 'Earnings available';
        this.classPaymentStatusDescription = `$${summary.totalTutorPayout.toFixed(2)} is available for withdrawal.`;
      } else if (summary.earningsStatus === 'on_hold') {
        this.classPaymentStatusClass = 'on-hold';
        this.classPaymentStatusIcon = 'pause-circle-outline';
        this.classPaymentStatusTitle = 'Earnings on hold';
        this.classPaymentStatusDescription = 'Your earnings are on hold during the review period.';
      } else if (summary.earningsStatus === 'pending' && classEnded) {
        this.classPaymentStatusClass = 'pending';
        this.classPaymentStatusIcon = 'time-outline';
        this.classPaymentStatusTitle = 'Earnings pending';
        this.classPaymentStatusDescription = `$${summary.totalTutorPayout.toFixed(2)} will be available after processing.`;
      } else if (classStatus === 'cancelled') {
        this.classPaymentStatusClass = 'cancelled';
        this.classPaymentStatusIcon = 'close-circle-outline';
        this.classPaymentStatusTitle = 'No earnings';
        this.classPaymentStatusDescription = 'This class was cancelled. No earnings apply.';
      } else if (!classEnded) {
        this.classPaymentStatusClass = 'pending';
        this.classPaymentStatusIcon = 'time-outline';
        this.classPaymentStatusTitle = 'Earnings pending';
        this.classPaymentStatusDescription = summary.totalTutorPayout > 0
          ? `You'll earn $${summary.totalTutorPayout.toFixed(2)} after this class.`
          : 'Your earnings will be confirmed after the class.';
      } else {
        this.hasClassPaymentStatus = false;
        return;
      }

      if (summary.totalCaptured > 0) {
        this.classPaymentDetails.push({ key: 'Gross revenue', value: `$${summary.totalCaptured.toFixed(2)}` });
      }
      if (summary.totalFees > 0) {
        this.classPaymentDetails.push({ key: 'Platform fee', value: `-$${summary.totalFees.toFixed(2)}` });
      }
      if (summary.totalTutorPayout > 0) {
        this.classPaymentDetails.push({ key: 'Your earnings', value: `$${summary.totalTutorPayout.toFixed(2)}` });
      }
      if (summary.paymentCount > 0) {
        this.classPaymentDetails.push({ key: 'Payments received', value: `${summary.paymentCount}` });
      }
    } else if (!isTutor && payments.length > 0) {
      const myPayment = payments[0];
      this.hasClassPaymentStatus = true;
      this.classPaymentDetails = [];

      if (myPayment.status === 'succeeded') {
        this.classPaymentStatusClass = 'paid';
        this.classPaymentStatusIcon = 'checkmark-circle-outline';
        this.classPaymentStatusTitle = 'Payment complete';
        this.classPaymentStatusDescription = `$${myPayment.amount.toFixed(2)} was charged.`;
      } else if (myPayment.status === 'authorized') {
        this.classPaymentStatusClass = 'pending';
        this.classPaymentStatusIcon = 'time-outline';
        this.classPaymentStatusTitle = 'Payment authorized';
        this.classPaymentStatusDescription = `$${myPayment.amount.toFixed(2)} will be charged after the class.`;
      } else if (myPayment.status === 'refunded') {
        this.classPaymentStatusClass = 'refunded';
        this.classPaymentStatusIcon = 'arrow-undo-circle-outline';
        this.classPaymentStatusTitle = 'Payment refunded';
        this.classPaymentStatusDescription = `$${myPayment.amount.toFixed(2)} was returned to your account.`;
      } else if (myPayment.status === 'cancelled') {
        this.classPaymentStatusClass = 'cancelled';
        this.classPaymentStatusIcon = 'close-circle-outline';
        this.classPaymentStatusTitle = 'No charge applied';
        this.classPaymentStatusDescription = 'The class was cancelled and no payment was charged.';
      } else {
        this.hasClassPaymentStatus = false;
      }
    } else if (classStatus === 'cancelled') {
      this.hasClassPaymentStatus = true;
      this.classPaymentDetails = [];
      this.classPaymentStatusClass = 'cancelled';
      this.classPaymentStatusIcon = 'close-circle-outline';
      this.classPaymentStatusTitle = isTutor ? 'No earnings' : 'No charge applied';
      this.classPaymentStatusDescription = 'This class was cancelled.';
    }
  }

  private formatPersonName(person: any, fallback = 'Participant'): string {
    if (person.firstName) {
      const lastInitial = person.lastName ? ` ${person.lastName.charAt(0)}.` : '';
      return `${person.firstName}${lastInitial}`;
    }
    if (person.name && !person.name.includes('@')) {
      const parts = person.name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
      }
      return parts[0];
    }
    return fallback;
  }

  // ── Countdown ─────────────────────────────────────────────────

  private startCountdown() {
    this.countdownInterval = setInterval(() => {
      this.computeJoinButton();
    }, 60000);
  }

  // ── Actions ───────────────────────────────────────────────────

  goBack() {
    if (this.isModal) {
      this.modalController.dismiss();
      return;
    }
    const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
    if (returnTo === 'earnings') {
      const sectionParam = this.route.snapshot.queryParamMap.get('earningsSection');
      const earningsInline = this.route.snapshot.queryParamMap.get('earningsInline') === '1';
      const section =
        sectionParam === 'details' || sectionParam === 'transfers' || sectionParam === 'transactions'
          ? sectionParam
          : 'transactions';
      EarningsPage.stashReturnSection(section);
      if (earningsInline) {
        void this.router.navigate(['/tabs/home'], {
          queryParams: { openEarnings: '1', earningsSection: section },
          replaceUrl: true,
        });
      } else {
        void this.router.navigate(['/tabs/home/earnings'], {
          queryParams: { earningsSection: section },
          replaceUrl: true,
        });
      }
      return;
    }
    this.location.back();
  }

  joinLesson() {
    if (!this.lesson || !this.currentUser) return;
    // SECURITY: role is determined from lesson data + auth, not passed in URL
    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: this.lesson._id,
        lessonMode: 'true',
        isClass: 'false'
      }
    });
  }

  async openClassStudentPrimaryAction(): Promise<void> {
    if (!this.eventId) return;
    if (this.classStudentCtaKind === 'enroll') {
      const loading = await this.loadingController.create({
        message: 'Preparing enrollment…',
        spinner: 'crescent'
      });
      await loading.present();
      try {
        await firstValueFrom(this.classService.requestPublicEnrollment(this.eventId));
      } catch (err: any) {
        await loading.dismiss();
        const msg = err?.error?.message || 'Could not start enrollment. Please try again.';
        const toast = await this.toastController.create({
          message: msg,
          duration: 4000,
          color: 'danger',
          position: 'bottom'
        });
        await toast.present();
        return;
      }
      await loading.dismiss();
    }
    if (this.classStudentCtaKind === 'accept_invite' || this.classStudentCtaKind === 'enroll') {
      const modal = await this.modalController.create({
        component: ClassInvitationModalComponent,
        componentProps: { classId: this.eventId },
        cssClass: 'class-invitation-modal'
      });
      await modal.present();
      const { data } = await modal.onDidDismiss();
      if (data?.accepted || data?.declined) {
        if (this.eventId) this.lessonService.clearDetailCache(this.eventId);
        this.loadEventDetails();
      }
    } else if (this.classStudentCtaKind === 'join_session') {
      this.joinClass();
    }
  }

  joinClass() {
    if (!this.classData || !this.currentUser) return;
    if (!this.classCanJoin) return;
    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: this.classData._id,
        lessonMode: 'true',
        isClass: 'true'
      }
    });
  }

  messageClassTutor() {
    if (!this.classTutorId) return;
    this.router.navigate(['/tabs/messages'], { queryParams: { tutorId: this.classTutorId } });
  }

  onClassGoingMessageTap(): void {
    if (!this.classCanOpenGoingMessage) {
      return;
    }
    void this.openClassGoingMessageModal();
  }

  async openClassGoingMessageModal(): Promise<void> {
    if (!this.classCanOpenGoingMessage || !this.classData) return;

    // Student → single tutor recipient. Tutor → broadcast to confirmed students.
    const receiverId = this.isStudentUser ? (this.classTutorId || '') : '';
    const receiverIds = this.classIsCurrentUserTutor ? [...this.classGoingReceiverIds] : [];

    try {
      const modal = await this.modalController.create({
        component: ClassGoingMessageModalComponent,
        componentProps: {
          attendees: this.classAttendeesForGridStack || [],
          receiverId,
          receiverIds,
          className: this.classData.name || '',
          // Anchor the group thread to this class so the backend routes to
          // the class-broadcast conversation (membership follows enrollment)
          // rather than spawning a new ad-hoc thread keyed off the current
          // participant hash.
          classId: this.eventId || '',
        },
        cssClass: 'class-going-message-modal',
      });
      await modal.present();
      const { data } = await modal.onDidDismiss();
      if (data?.sent) {
        const total: number = typeof data?.total === 'number' ? data.total : 1;
        const toast = await this.toastController.create({
          message: total > 1 ? `Message sent to ${total} participants` : 'Message sent',
          duration: 2200,
          color: 'success',
          position: 'bottom',
        });
        await toast.present();

        if (data?.kind === 'group' && data?.groupId) {
          await this.router.navigate(['/tabs/messages'], { queryParams: { groupId: data.groupId } });
        } else if (data?.kind === 'direct' && data?.userId) {
          await this.router.navigate(['/tabs/messages'], { queryParams: { userId: data.userId } });
        } else {
          await this.router.navigate(['/tabs/messages']);
        }
      }
    } catch (e) {
      console.error('[GoingMessage] modal failed', e);
    }
  }

  openClassTutorProfile() {
    if (this.isStudentUser && this.classTutorId) {
      this.router.navigate(['/tutor', this.classTutorId]);
    }
  }

  viewAnalysis() {
    if (!this.eventId) return;
    this.router.navigate(['/lesson-analysis', this.eventId]);
  }

  viewPreviousAnalysis() {
    if (!this.previousNotesData?.previousLessonId) return;
    this.router.navigate(['/lesson-analysis', this.previousNotesData.previousLessonId]);
  }

  async openRescheduleModal() {
    if (!this.lesson || this.lesson.status === 'cancelled' || !this.currentUser?.id || !this.eventId) return;

    const otherParticipant = this.isTutorUser ? this.lesson.studentId : this.lesson.tutorId;
    let participantId: string | null = null;
    if (otherParticipant && typeof otherParticipant === 'object') {
      participantId = (otherParticipant as any)?._id ?? (otherParticipant as any)?.id ?? null;
    } else if (typeof otherParticipant === 'string') {
      participantId = otherParticipant;
    }

    if (!participantId) {
      const toast = await this.toastController.create({
        message: 'Could not find participant information',
        duration: 2000,
        color: 'danger',
        position: 'bottom'
      });
      await toast.present();
      return;
    }

    const participantNameForModal = otherParticipant || this.participantName || 'Student';

    const modal = await this.modalController.create({
      component: RescheduleLessonModalComponent,
      componentProps: {
        lessonId: this.eventId,
        lesson: this.lesson,
        participantId,
        participantName: participantNameForModal,
        participantAvatar: this.participantPicture || undefined,
        currentUserId: this.currentUser.id,
        isTutor: this.isTutorUser,
        showBackButton: false
      },
      cssClass: 'reschedule-lesson-modal'
    });

    await modal.present();
    const result = await modal.onDidDismiss();

    if (result.data?.rescheduled) {
      if (this.eventId) this.lessonService.clearDetailCache(this.eventId);
      this.loadEventDetails();
    }
  }

  async cancelLesson() {
    if (!this.lesson || this.lesson.status === 'cancelled') return;

    const currentUser = this.currentUser;
    if (!currentUser) return;

    const participantName = this.participantName;
    const participantAvatar = this.participantPicture;
    const lessonId = this.lesson._id;
    const lessonStartTime = this.lesson.startTime;
    const lessonSubject = this.lesson.subject;
    const lessonDuration = this.lesson.duration;

    // Step 1: Cancellation reason modal
    const reasonModal = await this.modalController.create({
      component: CancelReasonModalComponent,
      componentProps: {
        participantName,
        participantAvatar: participantAvatar || undefined,
        userRole: this.userRole,
        lessonStartTime,
        lessonSubject,
        lessonDuration
      },
      cssClass: 'cancel-reason-modal'
    });

    await reasonModal.present();
    const reasonResult = await reasonModal.onDidDismiss();
    if (reasonResult.data?.rescheduleInstead) {
      await this.openRescheduleModal();
      return;
    }
    if (reasonResult.data?.cancelled || !reasonResult.data?.reason) return;

    const selectedReason = reasonResult.data.reason;

    // Step 2: Confirmation modal
    const confirmModal = await this.modalController.create({
      component: ConfirmActionModalComponent,
      componentProps: {
        title: 'Cancel Lesson',
        message: `Reason: ${selectedReason.label}`,
        notificationMessage: `${participantName || 'The other participant'} will be notified and this action cannot be undone.`,
        confirmText: 'Cancel Lesson',
        cancelText: 'Reschedule instead?',
        secondaryDismissReschedules: true,
        confirmColor: 'danger',
        icon: 'close-circle',
        iconColor: 'danger',
        participantName,
        participantAvatar: participantAvatar || undefined
      },
      cssClass: 'confirm-action-modal'
    });

    await confirmModal.present();
    const confirmResult = await confirmModal.onDidDismiss();
    if (confirmResult.data?.rescheduleInstead) {
      await this.openRescheduleModal();
      return;
    }
    if (!confirmResult.data?.confirmed) return;

    // Step 3: Proceed with cancellation
    const loading = await this.loadingController.create({
      message: 'Cancelling lesson...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      const response = await this.lessonService.cancelLesson(lessonId, selectedReason.id, selectedReason.label).toPromise();
      await loading.dismiss();

      if (response?.success) {
        const toast = await this.toastController.create({
          message: 'Lesson cancelled successfully',
          duration: 3000,
          position: 'bottom',
          color: 'success'
        });
        await toast.present();
        window.dispatchEvent(new CustomEvent('lesson-cancelled', { detail: { lessonId } }));
        this.lessonService.clearDetailCache(lessonId);
        // Reload data
        this.loadEventDetails();
      } else {
        throw new Error(response?.message || 'Failed to cancel lesson');
      }
    } catch (error: any) {
      await loading.dismiss();
      const toast = await this.toastController.create({
        message: error?.error?.message || 'Failed to cancel lesson. Please try again.',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    }
  }

  private computeFeedbackStatus() {
    if (!this.isLessonCompleted || !this.lesson) return;

    // Trial lessons: no feedback expected from tutors
    const isTrial = !!this.lesson.isTrialLesson;
    if (isTrial) {
      this.feedbackProvided = false;
      this.feedbackPending = false;
      this.showFeedbackStatusSection = false;
      return;
    }

    // Feedback is "provided" if we have either a tutor note or structured TutorFeedback
    this.feedbackProvided = this.hasTutorNote || this.hasTutorFeedback;

    const requiresTutorFeedback = !!this.lesson.requiresTutorFeedback;
    const hasPendingFeedbackRecord = !!this.tutorFeedback && this.tutorFeedback.status === 'pending';
    const aiWasDisabled = this.lesson.aiAnalysisEnabledAtTime === false;

    if (this.isTutorUser) {
      // Only show "Feedback outstanding" when AI was DISABLED for this lesson AND
      // there's an actual pending + required record. AI-enabled lessons don't
      // create a TutorFeedback record, so feedback is optional.
      this.feedbackPending = !this.feedbackProvided
        && aiWasDisabled
        && (requiresTutorFeedback || (hasPendingFeedbackRecord && this.tutorFeedback?.required !== false));
    } else {
      const hasAiAnalysis = this.hasAnalysis
        || this.lesson.aiAnalysis?.status === 'completed'
        || !!this.lesson.aiAnalysis?.generatedAt;
      const aiWasEnabled = this.lesson.aiAnalysisEnabledAtTime === true;

      this.feedbackPending = !this.feedbackProvided
        && !hasAiAnalysis
        && (requiresTutorFeedback || hasPendingFeedbackRecord || !aiWasEnabled);
    }

    this.showFeedbackStatusSection =
      (this.isTutorUser && (this.feedbackPending || this.feedbackProvided)) ||
      (this.isStudentUser && (this.feedbackPending || this.feedbackProvided));
  }

  leaveFeedback() {
    if (!this.eventId) return;
    this.router.navigate(['/post-lesson-tutor', this.eventId]);
  }

  toggleFeedbackSection() {
    this.feedbackSectionExpanded = !this.feedbackSectionExpanded;
  }

  toggleMaterialsSection() {
    this.materialsSectionExpanded = !this.materialsSectionExpanded;
  }

  toggleCancellationSection() {
    this.cancellationSectionExpanded = !this.cancellationSectionExpanded;
  }

  togglePaymentStatusSection() {
    this.paymentStatusSectionExpanded = !this.paymentStatusSectionExpanded;
  }

  viewFeedback() {
    // Scroll to the feedback section or show in a modal
    // For now, just scroll to the tutor feedback/note section
    const el = document.querySelector('.ed-feedback-status')?.closest('.ed')?.querySelector('.ed-section-label');
    if (this.hasTutorFeedback || this.hasTutorNote) {
      // The feedback is displayed inline below — just scroll down
      const feedbackSection = document.getElementById('feedback-detail-section');
      if (feedbackSection) {
        feedbackSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  openTutorProfile() {
    if (this.isStudentUser && this.tutorId) {
      this.router.navigate(['/tutor', this.tutorId]);
    }
  }

  messageParticipant() {
    if (!this.participantId) return;
    const param = this.isTutorUser ? 'userId' : 'tutorId';
    this.router.navigate(['/tabs/messages'], { queryParams: { [param]: this.participantId } });
  }

  openLesson(lessonId: string) {
    this.router.navigate(['/tabs/lessons', lessonId]);
  }

  async bookLesson() {
    if (!this.tutorId || !this.lesson?.tutorId) return;
    const tutor = this.lesson.tutorId;
    const nameParts = (tutor.name || '').split(' ');

    const modal = await this.modalController.create({
      component: TutorAvailabilitySelectionModalComponent,
      componentProps: {
        tutors: [{
          id: tutor._id,
          _id: tutor._id,
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
          name: tutor.name,
          picture: tutor.picture
        }],
        title: 'Book a Lesson'
      },
      cssClass: 'tutor-availability-selection-modal'
    });
    await modal.present();
  }

  async shareTutor() {
    if (!this.tutorId) return;
    const url = `${window.location.origin}/tutor/${this.tutorId}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Learn with ${this.participantName}`,
          text: `Check out ${this.participantName} on our platform!`,
          url
        });
      } else {
        await navigator.clipboard.writeText(url);
        const toast = await this.toastController.create({
          message: 'Link copied to clipboard',
          duration: 2000,
          position: 'bottom'
        });
        await toast.present();
      }
    } catch {}
  }

  async rescheduleClass() {
    await this.presentClassRescheduleModal();
  }

  /** Build a lesson-shaped object for `RescheduleLessonModalComponent` (hub class). */
  private buildLessonLikeFromClass(): any {
    const c = this.classData;
    if (!c || !this.eventId) return null;
    const duration =
      typeof c.duration === 'number' && c.duration > 0 ? c.duration : 60;
    return {
      _id: c._id || this.eventId,
      isClass: true,
      className: c.name,
      classData: c,
      startTime: c.startTime,
      endTime: c.endTime,
      duration,
      tutorId: c.tutorId,
      subject: c.name || 'Class',
      status: c.status || 'scheduled',
    };
  }

  /** Opens the same reschedule experience as home (availability viewer + confirm). */
  async presentClassRescheduleModal(): Promise<void> {
    if (!this.eventId || !this.classData || !this.currentUser?.id) return;
    if (!this.classCanReschedule) {
      const toast = await this.toastController.create({
        message: 'This class cannot be rescheduled right now.',
        duration: 2500,
        position: 'bottom',
        color: 'medium',
      });
      await toast.present();
      return;
    }

    const lesson = this.buildLessonLikeFromClass();
    if (!lesson) return;

    const classId = this.eventId;
    const isTutor = this.isTutorUser;
    const className = this.classData.name || 'Class';
    const participantAvatar = this.classData.thumbnail || undefined;
    const participantForModal = isTutor ? className : this.classData.tutorId;
    const tid = this.classData.tutorId as any;
    const tutorRawId = tid?._id ?? tid;
    const participantIdForModal = isTutor
      ? String(this.currentUser.id)
      : String(tutorRawId || '');

    if (!isTutor && !participantIdForModal) {
      const toast = await this.toastController.create({
        message: 'Could not find tutor information',
        duration: 2000,
        color: 'danger',
        position: 'bottom',
      });
      await toast.present();
      return;
    }

    const resModal = await this.modalController.create({
      component: RescheduleLessonModalComponent,
      componentProps: {
        lessonId: classId,
        lesson,
        participantId: participantIdForModal,
        participantName: participantForModal,
        participantAvatar,
        currentUserId: this.currentUser.id,
        isTutor,
        showBackButton: false,
      },
      cssClass: 'reschedule-lesson-modal',
    });
    await resModal.present();
    const result = await resModal.onDidDismiss();
    if (result.data?.rescheduled) {
      if (this.eventId) this.lessonService.clearDetailCache(this.eventId);
      this.loadEventDetails();
    }
  }

  async cancelClassAction() {
    if (!this.classData || this.classIsCancelled || this.classIsCompleted) return;
    const className = this.classData.name || 'this class';

    // STEP 1: Reason picker (class variant)
    const reasonModal = await this.modalController.create({
      component: CancelReasonModalComponent,
      componentProps: {
        entityType: 'class',
        userRole: 'tutor',
        className,
        classThumbnailUrl: this.classData.thumbnail || undefined,
        lessonStartTime: this.classData.startTime,
        lessonDuration: this.classData.duration
      },
      cssClass: 'cancel-reason-modal'
    });
    await reasonModal.present();
    const reasonResult = await reasonModal.onDidDismiss();
    if (reasonResult.data?.rescheduleInstead) {
      if (this.classCanReschedule) {
        await this.presentClassRescheduleModal();
      } else {
        const toast = await this.toastController.create({
          message: 'This class cannot be rescheduled right now.',
          duration: 2500,
          position: 'bottom',
          color: 'medium',
        });
        await toast.present();
      }
      return;
    }
    if (reasonResult.data?.cancelled || !reasonResult.data?.reason) {
      return;
    }

    // STEP 2: Final confirmation
    const modal = await this.modalController.create({
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
    const { data } = await modal.onWillDismiss();
    if (data?.rescheduleInstead) {
      if (this.classCanReschedule) {
        await this.presentClassRescheduleModal();
      } else {
        const toast = await this.toastController.create({
          message: 'This class cannot be rescheduled right now.',
          duration: 2500,
          position: 'bottom',
          color: 'medium',
        });
        await toast.present();
      }
      return;
    }
    if (!data?.confirmed) return;

    const loading = await this.loadingController.create({
      message: 'Cancelling class...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      await this.classService.cancelClass(this.eventId!).toPromise();
      await loading.dismiss();
      const toast = await this.toastController.create({
        message: `"${className}" has been cancelled`,
        duration: 3000,
        position: 'bottom',
        color: 'success'
      });
      await toast.present();
      window.dispatchEvent(new CustomEvent('lesson-cancelled', { detail: { lessonId: this.eventId } }));
      if (this.eventId) this.lessonService.clearDetailCache(this.eventId);
      this.loadEventDetails();
    } catch (error: any) {
      await loading.dismiss();
      const toast = await this.toastController.create({
        message: error?.error?.message || 'Failed to cancel class. Please try again.',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    }
  }

  /**
   * Student-initiated "Leave class". One-step confirmation modal, then hits
   * POST /api/classes/:classId/unenroll — backend releases any authorized
   * Stripe hold, syncs the class conversation, and notifies the tutor.
   */
  async leaveClassAction() {
    if (!this.classData || !this.classCanLeave || !this.eventId) return;
    const className = this.classData.name || 'this class';

    const modal = await this.modalController.create({
      component: ConfirmActionModalComponent,
      componentProps: {
        title: 'Leave class?',
        message: `Are you sure you want to leave "${className}"? Any authorized payment will be released and your seat will be given up. This can't be undone.`,
        confirmText: 'Leave class',
        cancelText: 'Stay enrolled',
        confirmColor: 'danger',
        icon: 'exit-outline',
        iconColor: 'danger'
      },
      cssClass: 'confirm-action-modal'
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (!data?.confirmed) return;

    const loading = await this.loadingController.create({
      message: 'Leaving class...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      await firstValueFrom(this.classService.unenrollFromClass(this.eventId));
      await loading.dismiss();
      const toast = await this.toastController.create({
        message: `You have left "${className}".`,
        duration: 3000,
        position: 'bottom',
        color: 'success'
      });
      await toast.present();
      window.dispatchEvent(new CustomEvent('class-unenrolled', { detail: { classId: this.eventId } }));
      if (this.eventId) this.lessonService.clearDetailCache(this.eventId);
      if (this.isModal) {
        this.modalController.dismiss({ unenrolled: true });
      } else {
        this.router.navigate(['/tabs/lessons']);
      }
    } catch (error: any) {
      await loading.dismiss();
      const toast = await this.toastController.create({
        message: error?.error?.message || 'Failed to leave class. Please try again.',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    }
  }
}
