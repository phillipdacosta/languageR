import { Component, OnInit, OnDestroy, ChangeDetectorRef, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Location } from '@angular/common';
import { IonicModule, ModalController, ToastController, LoadingController, ViewWillEnter, ViewDidEnter } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { LessonService, Lesson, CachedLessonDetailBundle } from '../../services/lesson.service';
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
import { ConfirmActionModalComponent } from '../../components/confirm-action-modal/confirm-action-modal.component';
import { RescheduleLessonModalComponent } from '../../components/reschedule-lesson-modal/reschedule-lesson-modal.component';
import { formatTimeInTz, formatDateInTz } from '../../shared/timezone.utils';
import { MaterialService, TutorMaterial } from '../../services/material.service';
import { LearningPlanService, LearningPlanSummary, GOAL_TYPE_LABELS } from '../../services/learning-plan.service';
import { Subscription, firstValueFrom } from 'rxjs';
import {
  isLessonMockId,
  buildMockLessonEntity,
  getMockBillingAndPayment,
  getMockRecommendedMaterials,
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

@Component({
  selector: 'app-event-details',
  templateUrl: './event-details.page.html',
  styleUrls: ['./event-details.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, SharedModule, CancelReasonModalComponent, ConfirmActionModalComponent, RescheduleLessonModalComponent, ClassAttendeesComponent, ClassInvitationModalComponent]
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
  participantRole = ''; // "Student" or "Tutor"
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

  // Learning Plan summary (sidebar)
  edPlanGoalLabel = '';
  edPlanPhaseLabel = '';
  edPlanNextFocus = '';
  edPlanStudentSummary = '';
  edHasPlan = false;

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
  hasLastSessionContext = false;
  lastSessionSummary = '';
  lastSessionFocus: string[] = [];

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

  // Pre-computed score colors (no functions in template)
  grammarScoreColor = '#6b7280';
  fluencyScoreColor = '#6b7280';
  pronunciationScoreColor = '#6b7280';

  // Class-specific pre-computed
  levelLabel = '';
  classRevenue = '';

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
  feedbackNotes = '';
  feedbackCefrLevel = '';
  feedbackDate = '';
  sanitizedTutorNote: SafeHtml = '';

  // Feedback status (banner)
  isLessonCompleted = false;
  feedbackProvided = false;
  feedbackPending = false;
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
  /** Student class CTA: accept tutor invite, public enroll, or join session when enrolled. */
  classStudentCtaKind: 'accept_invite' | 'enroll' | 'join_session' | null = null;
  classStudentPrimaryDisabled = false;
  classIsCancelled = false;
  classIsCompleted = false;
  classStudentsPaidCount = 0;

  // Recommended materials (student only)
  recommendedMaterials: (TutorMaterial & { isSaved?: boolean; _matchedStruggles?: string[]; _isCurrentTutor?: boolean; _typeIcon?: string; _typeLabel?: string })[] = [];
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
    private analysisTranslation: AnalysisTranslationService
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
  }

  ngOnDestroy() {
    this.translationSub?.unsubscribe();
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    this.flipTransition.cleanup();
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
          this.lesson = response.lesson;
          this.isClass = false;
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
    } else if (cached.lesson) {
      this.lesson = cached.lesson;
      this.isClass = false;
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

    // Load learning plan summary (non-blocking sidebar data)
    if (this.isTutorUser && this.participantId) {
      this.learningPlanService.getStudentPlanSummary(this.participantId).subscribe({
        next: (res) => {
          if (res.success && res.summaries?.length) {
            const s = res.summaries[0];
            this.edPlanGoalLabel = GOAL_TYPE_LABELS[s.goal?.type] || s.goal?.description || '';
            this.edPlanPhaseLabel = s.currentPhase
              ? `Phase ${s.currentPhaseIndex + 1} of ${s.totalPhases}: ${s.currentPhase.title}`
              : '';
            this.edPlanNextFocus = s.nextLessonFocus || '';
            this.edPlanStudentSummary = s.studentSummary || '';
            this.edHasPlan = true;
            this.cdr.detectChanges();
          }
        },
        error: () => {}
      });
    }

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
        if (!silent) this.analysisLoading = false;
        this.onRequestComplete(silent);
      },
      error: (err: any) => {
        if (err?.error?.status === 'unavailable' || this.isLessonCompleted) {
          this.analysisUnavailable = true;
          this.lessonService.updateCachedLessonDetail(this.eventId!, { analysisUnavailable: true });
        }
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
        this.cdr.detectChanges();
      },
      error: () => {
        this.recommendedLoading = false;
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
      this.statusLabel = 'Cancelled';
      this.statusColor = '#ef4444';
      this.statusClass = 'cancelled';
      return;
    }

    const now = new Date();
    const start = new Date(this.lesson.startTime);
    const end = new Date(this.lesson.endTime);

    if (now >= start && now <= end) {
      this.statusLabel = 'In Progress';
      this.statusColor = '#60a5fa';
      this.statusClass = 'in-progress';
      this.isLessonInProgress = true;
    } else if (now > end) {
      this.statusLabel = 'Completed';
      this.statusColor = '#6b7280';
      this.statusClass = 'completed';
      this.isLessonCompleted = true;
    } else if (this.lesson.status === 'pending_reschedule') {
      this.statusLabel = 'Pending Reschedule';
      this.statusColor = '#f59e0b';
      this.statusClass = 'pending';
    } else {
      this.statusLabel = 'Upcoming';
      this.statusColor = '#667eea';
      this.statusClass = 'upcoming';
    }
  }

  private computeJoinButton() {
    if (!this.lesson) return;
    const now = new Date();
    const start = new Date(this.lesson.startTime);
    const end = new Date(this.lesson.endTime);

    this.showJoinButton = this.statusLabel === 'Upcoming' || this.statusLabel === 'In Progress';

    if (now >= start && now <= end) {
      this.canJoinLesson = true;
      this.joinLabel = 'Join Now';
    } else if (this.lessonService.canJoinLesson(this.lesson)) {
      this.canJoinLesson = true;
      this.joinLabel = 'Join';
    } else if (this.showJoinButton) {
      this.canJoinLesson = false;
      const secs = this.lessonService.getTimeUntilJoin(this.lesson);
      this.joinLabel = `Join in ${this.lessonService.formatTimeUntil(secs)}`;
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
      this.formattedDate = 'Today';
    } else if (start.toDateString() === tomorrow.toDateString()) {
      this.formattedDate = 'Tomorrow';
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
      this.participantCountry = p.country || p.residenceCountry || '';
    }

    // Pre-compute tutor display name for student view ("Phillip D.")
    const tutor = this.lesson.tutorId;
    if (tutor) {
      const tFirst = tutor.firstName || tutor.name?.split(' ')[0] || '';
      const tLast = tutor.lastName || tutor.name?.split(' ').slice(1).join(' ') || '';
      this.tutorDisplayName = tFirst && tLast
        ? `${tFirst} ${tLast.charAt(0).toUpperCase()}.`
        : tutor.name || 'Your tutor';
      
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
      const cancelledByMap: Record<string, string> = {
        tutor: 'Tutor', student: 'Student', system: 'System', admin: 'Admin'
      };
      this.cancelledByLabel = cancelledByMap[this.lesson.cancelledBy] || 'Unknown';
      this.cancelReasonLabel = this.lesson.cancelReasonText || this.lesson.cancelReason || 'No reason provided';
      this.cancelledAtLabel = this.lesson.cancelledAt
        ? `${formatDateInTz(this.lesson.cancelledAt, this.userTz, { month: 'short', day: 'numeric', year: 'numeric' })} ${formatTimeInTz(this.lesson.cancelledAt, this.userTz, undefined, true)}`
        : '';
    }
  }

  private computeIssue() {
    if (!this.lesson) return;
    this.hasIssue = !!this.lesson.issueReported;
    if (this.hasIssue) {
      const issueMap: Record<string, string> = {
        tutor_no_show: 'Tutor No-Show',
        ended_early: 'Ended Early',
        poor_quality: 'Poor Quality',
        inappropriate: 'Inappropriate Behavior',
        technical: 'Technical Issues',
        other: 'Other'
      };
      this.issueTypeLabel = issueMap[this.lesson.issueType || ''] || 'Issue Reported';

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
        if (this.isTutorUser) {
          // Tutor just sees "Resolved" — no need for specifics
          this.investigationResolutionLabel = 'Resolved';
        } else {
          // Student sees the specific outcome
          const resolutionMap: Record<string, string> = {
            approved: 'Resolved — No issue found',
            refunded: 'Resolved — Refunded',
            partial_refund: 'Resolved — Partially refunded',
            no_action: 'Resolved — No action taken'
          };
          this.investigationResolutionLabel = resolutionMap[this.lesson.investigationResolution || ''] || 'Resolved';
        }
      }
    }
  }

  private computeReschedule() {
    if (!this.lesson?.rescheduleProposal) return;
    const rp = this.lesson.rescheduleProposal;
    if (rp.status === 'pending' && rp.proposedStartTime && rp.proposedEndTime && rp.proposedBy) {
      this.hasReschedule = true;
      this.rescheduleStatus = 'Pending';
      const s = new Date(rp.proposedStartTime);
      const e = new Date(rp.proposedEndTime);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        this.proposedTimeRange = `${formatDateInTz(s, this.userTz, { month: 'short', day: 'numeric', year: undefined })} at ${formatTimeInTz(s, this.userTz, undefined, true)} – ${formatTimeInTz(e, this.userTz, undefined, true)}`;
      }
    }
  }

  private computeLastSessionContext() {
    const ctx = this.lesson?.lastSessionContext;
    if (!ctx || ctx.isFirstLesson || !ctx.summary) {
      this.hasLastSessionContext = false;
      return;
    }
    this.hasLastSessionContext = true;
    this.lastSessionSummary = ctx.summary;
    this.lastSessionFocus = ctx.recommendedFocus || [];
  }

  private computeAnalysisProperties() {
    if (!this.analysisData) return;
    this.hasAnalysis = this.analysisData.status === 'completed';
    this.analysisUnavailable = ['failed', 'insufficient_data'].includes(this.analysisData.status || '');
    this.isAiAnalysis = this.analysisData.source !== 'tutor';
    this.analysisLabel = this.isAiAnalysis ? 'AI Analysis' : 'Tutor Assessment';

    // Pre-compute score colors
    this.grammarScoreColor = this.calcScoreColor(this.analysisData.grammarAnalysis?.accuracyScore);
    this.fluencyScoreColor = this.calcScoreColor(this.analysisData.fluencyAnalysis?.overallFluencyScore);
    this.pronunciationScoreColor = this.calcScoreColor(this.analysisData.pronunciationAnalysis?.overallScore);

    // Tutor note
    if (this.analysisData.tutorNote?.text) {
      this.hasTutorNote = true;
      this.sanitizedTutorNote = this.sanitizer.bypassSecurityTrustHtml(this.analysisData.tutorNote.text);
    }
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
    if (!this.sidebarNotesAnalysisId) return;

    if (this.sidebarNotesShowingTranslation) {
      this.analysisTranslation.showOriginal(this.sidebarNotesAnalysisId);
      this.refreshSidebarFromTranslationState();
      return;
    }

    if (this.analysisTranslation.hasTranslation(this.sidebarNotesAnalysisId)) {
      this.analysisTranslation.showTranslated(this.sidebarNotesAnalysisId);
      this.refreshSidebarFromTranslationState();
      return;
    }

    this.sidebarNotesTranslating = true;
    this.analysisTranslation.translate(this.sidebarNotesAnalysisId).subscribe({
      next: () => {
        this.sidebarNotesTranslating = false;
        this.refreshSidebarFromTranslationState();
      },
      error: () => {
        this.sidebarNotesTranslating = false;
        this.cdr.detectChanges();
      }
    });
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
        this.paymentMethodLabel = 'Wallet';
        this.paymentMethodIcon = 'wallet-outline';
        break;
      case 'card':
        this.paymentMethodLabel = 'Credit / Debit card';
        this.paymentMethodIcon = 'card-outline';
        break;
      case 'apple_pay':
        this.paymentMethodLabel = 'Apple Pay';
        this.paymentMethodIcon = 'logo-apple';
        break;
      case 'google_pay':
        this.paymentMethodLabel = 'Google Pay';
        this.paymentMethodIcon = 'logo-google';
        break;
      default:
        this.paymentMethodLabel = method ? method.charAt(0).toUpperCase() + method.slice(1).replace(/_/g, ' ') : '';
        this.paymentMethodIcon = 'card-outline';
        break;
    }
  }

  private computePaymentStatus() {
    const p = this.paymentData;
    if (!p) return;

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
        this.paymentStatusTitle = 'Payment refunded';
        this.paymentStatusDescription = `$${refundAmt > 0 ? refundAmt.toFixed(2) : amount.toFixed(2)} was returned to your account.`;
        if (p.refundReason) {
          this.paymentStatusDetails.push({ key: 'Reason', value: p.refundReason });
        }
        if (p.refundMethod) {
          const methodLabel = p.refundMethod === 'wallet' ? 'Wallet credit' : 'Original payment method';
          this.paymentStatusDetails.push({ key: 'Refunded to', value: methodLabel });
        }
      } else {
        this.paymentStatusTitle = 'Payment reversed';
        this.paymentStatusDescription = 'The payment for this lesson was refunded to the student. No earnings apply.';
        if (p.refundReason) {
          this.paymentStatusDetails.push({ key: 'Reason', value: p.refundReason });
        }
      }
    } else if (status === 'partially_refunded') {
      this.paymentStatusClass = 'partial';
      this.paymentStatusIcon = 'swap-horizontal-outline';
      if (this.isStudentUser) {
        this.paymentStatusTitle = 'Payment reduced';
        this.paymentStatusDescription = `$${refundAmt.toFixed(2)} was refunded to your account.`;
        const finalCharge = amount - refundAmt;
        this.paymentStatusDetails.push({ key: 'Original amount', value: `$${amount.toFixed(2)}` });
        this.paymentStatusDetails.push({ key: 'Refunded', value: `$${refundAmt.toFixed(2)}` });
        this.paymentStatusDetails.push({ key: 'Final charge', value: `$${finalCharge.toFixed(2)}` });
        if (p.refundReason) {
          this.paymentStatusDetails.push({ key: 'Reason', value: p.refundReason });
        }
      } else {
        this.paymentStatusTitle = 'Earnings adjusted';
        this.paymentStatusDescription = 'The student received a partial refund. Your earnings were adjusted accordingly.';
        if (tutorPayout > 0) {
          this.paymentStatusDetails.push({ key: 'Your earnings', value: `$${tutorPayout.toFixed(2)}` });
        }
        if (p.refundReason) {
          this.paymentStatusDetails.push({ key: 'Reason', value: p.refundReason });
        }
      }
    } else if (status === 'cancelled' || (isCancelled && status !== 'succeeded')) {
      this.paymentStatusClass = 'cancelled';
      this.paymentStatusIcon = 'close-circle-outline';
      if (this.isStudentUser) {
        if (isLate && cancellationFee > 0) {
          this.paymentStatusTitle = 'Cancellation fee applied';
          this.paymentStatusDescription = `A late cancellation fee of $${cancellationFee.toFixed(2)} was charged.`;
          if (amount - cancellationFee > 0) {
            this.paymentStatusDetails.push({ key: 'Refunded', value: `$${(amount - cancellationFee).toFixed(2)}` });
          }
          this.paymentStatusDetails.push({ key: 'Cancellation fee', value: `$${cancellationFee.toFixed(2)}` });
        } else {
          this.paymentStatusTitle = 'No charge applied';
          this.paymentStatusDescription = 'The lesson was cancelled and no payment was charged.';
        }
      } else {
        if (isLate && cancellationFee > 0) {
          this.paymentStatusTitle = 'Late cancellation compensation';
          this.paymentStatusDescription = `You earned $${tutorPayout > 0 ? tutorPayout.toFixed(2) : cancellationFee.toFixed(2)} from the late cancellation fee.`;
        } else {
          this.paymentStatusTitle = 'No earnings';
          this.paymentStatusDescription = 'This lesson was cancelled. No earnings apply.';
        }
      }
    } else if (transferStatus === 'on_hold' || this.lesson?.payoutPaused) {
      this.paymentStatusClass = 'on-hold';
      this.paymentStatusIcon = 'pause-circle-outline';
      if (this.isStudentUser) {
        this.paymentStatusTitle = 'Payment on hold';
        this.paymentStatusDescription = 'Your payment is on hold while this lesson is being reviewed.';
      } else {
        this.paymentStatusTitle = 'Earnings on hold';
        this.paymentStatusDescription = 'Your earnings are on hold while this lesson is being reviewed.';
      }
    } else if (status === 'succeeded' || status === 'authorized') {
      const lessonCompleted = this.lesson?.status === 'completed';
      const lessonEnded = this.lesson?.endTime && new Date(this.lesson.endTime).getTime() < Date.now();
      const isFinished = lessonCompleted || lessonEnded;

      this.paymentStatusClass = isFinished ? 'paid' : 'pending';
      this.paymentStatusIcon = isFinished ? 'checkmark-circle-outline' : 'time-outline';
      if (this.isStudentUser) {
        if (isFinished) {
          this.paymentStatusTitle = 'Payment complete';
          this.paymentStatusDescription = `$${amount.toFixed(2)} was charged.`;
        } else {
          this.paymentStatusTitle = 'Payment authorized';
          this.paymentStatusDescription = `$${amount.toFixed(2)} will be charged after the lesson.`;
        }
      } else {
        if (isFinished) {
          this.paymentStatusTitle = 'Earnings confirmed';
          this.paymentStatusDescription = tutorPayout > 0
            ? `You earned $${tutorPayout.toFixed(2)} from this lesson.`
            : 'Your earnings for this lesson have been confirmed.';
        } else {
          this.paymentStatusTitle = 'Earnings pending';
          this.paymentStatusDescription = tutorPayout > 0
            ? `You'll earn $${tutorPayout.toFixed(2)} after this lesson.`
            : 'Your earnings will be confirmed after the lesson.';
        }
      }
    } else {
      // Pending, processing, or unknown
      this.hasPaymentStatus = false;
    }

    if (p.refundedAt && this.hasPaymentStatus && (status === 'refunded' || status === 'partially_refunded')) {
      this.paymentStatusDetails.push({
        key: 'Date',
        value: formatDateInTz(p.refundedAt, this.userTz, { month: 'short', day: 'numeric', year: 'numeric' })
      });
    }
  }

  private computeClassProperties() {
    if (!this.classData) return;
    const now = new Date();
    const start = new Date(this.classData.startTime);
    const end = new Date(this.classData.endTime);

    if (this.classData.status === 'cancelled') {
      this.statusLabel = 'Cancelled';
      this.statusColor = '#ef4444';
      this.statusClass = 'cancelled';
      this.classIsCancelled = true;
    } else if (now >= start && now <= end) {
      this.statusLabel = 'In Progress';
      this.statusColor = '#10b981';
      this.statusClass = 'in-progress';
    } else if (now > end || this.classData.status === 'completed') {
      this.statusLabel = 'Completed';
      this.statusColor = '#6b7280';
      this.statusClass = 'completed';
      this.classIsCompleted = true;
    } else {
      this.statusLabel = 'Upcoming';
      this.statusColor = '#667eea';
      this.statusClass = 'upcoming';
    }

    // Formatted date/time
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (start.toDateString() === today.toDateString()) {
      this.formattedDate = 'Today';
    } else if (start.toDateString() === tomorrow.toDateString()) {
      this.formattedDate = 'Tomorrow';
    } else {
      this.formattedDate = formatDateInTz(start, this.userTz, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    this.formattedTimeRange = `${formatTimeInTz(start, this.userTz, undefined, true)} – ${formatTimeInTz(end, this.userTz, undefined, true)}`;
    this.formattedDuration = `${this.classData.duration || 60} minutes`;
    this.formattedPrice = this.classData.price ? `$${this.classData.price.toFixed(2)}` : 'Free';

    const levelMap: Record<string, string> = {
      any: 'Any Level', beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced'
    };
    this.levelLabel = levelMap[this.classData.level] || 'Any Level';

    if (this.classData.price && this.classData.confirmedStudents?.length) {
      this.classRevenue = `$${(this.classData.price * this.classData.confirmedStudents.length).toFixed(2)}`;
    }

    // Tutor info for the profile panel
    const tutor = this.classData.tutorId;
    const userId = String((this.currentUser as any)?._id || this.currentUser?.id || '');
    this.classIsCurrentUserTutor = String(tutor?._id || tutor) === userId;
    this.isTutorUser = this.classIsCurrentUserTutor;
    this.isStudentUser = !this.classIsCurrentUserTutor;

    if (tutor && typeof tutor === 'object') {
      this.classTutorName = this.formatPersonName(tutor, 'Tutor');
      this.classTutorPicture = tutor.picture || tutor.profilePicture || '';
      this.classTutorInitial = (tutor.name || tutor.firstName || 'T').charAt(0).toUpperCase();
      this.classTutorBio = tutor.onboardingData?.bio || tutor.profile?.bio || '';
      this.classTutorId = tutor._id?.toString() || null;
      this.classTutorLanguages = tutor.onboardingData?.languages || [];
      this.classTutorCountry = tutor.country || tutor.residenceCountry || '';
    }

    // Join / cancel button
    const minutesUntilStart = (start.getTime() - now.getTime()) / (1000 * 60);
    this.classShowJoinButton = this.statusLabel === 'Upcoming' || this.statusLabel === 'In Progress';
    if (now >= start && now <= end) {
      this.classCanJoin = true;
      this.classJoinLabel = 'Join Now';
    } else if (minutesUntilStart <= 10 && end > now && !this.classIsCancelled) {
      this.classCanJoin = true;
      this.classJoinLabel = 'Join';
    } else if (this.classShowJoinButton) {
      this.classCanJoin = false;
      const secs = Math.max(0, Math.floor((start.getTime() - now.getTime()) / 1000));
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      this.classJoinLabel = h > 0 ? `Join in ${h}h ${m}m` : `Join in ${m}m`;
    }
    const tutorCanManage = this.classIsCurrentUserTutor;
    this.classCanCancel = tutorCanManage && !this.classIsCancelled && !this.classIsCompleted && start > now;
    this.classCanReschedule = tutorCanManage && !this.classIsCancelled && !this.classIsCompleted && start > now;

    this.classStudentCtaKind = null;
    this.classStudentPrimaryDisabled = false;
    if (
      this.isStudentUser &&
      this.classData &&
      (this.statusLabel === 'Upcoming' || this.statusLabel === 'In Progress') &&
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
        cancelText: 'Go Back',
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
      return;
    }

    // Feedback is "provided" if we have either a tutor note or structured TutorFeedback
    this.feedbackProvided = this.hasTutorNote || this.hasTutorFeedback;

    const requiresTutorFeedback = !!this.lesson.requiresTutorFeedback;
    const hasPendingFeedbackRecord = !!this.tutorFeedback && this.tutorFeedback.status === 'pending';

    if (this.isTutorUser) {
      // Only show "Feedback outstanding" when there's an actual pending + required record.
      // AI-enabled lessons don't create a TutorFeedback record, so feedback is optional.
      this.feedbackPending = !this.feedbackProvided
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
    if (!this.classData || this.classIsCancelled || this.classIsCompleted) return;
    const className = this.classData.name || 'this class';

    const modal = await this.modalController.create({
      component: ConfirmActionModalComponent,
      componentProps: {
        title: 'Reschedule Class',
        message: `Do you want to reschedule "${className}"? All enrolled students will be notified of this change.`,
        confirmText: 'Reschedule',
        cancelText: 'Cancel',
        confirmColor: 'primary',
        icon: 'calendar',
        iconColor: 'primary'
      },
      cssClass: 'confirm-action-modal'
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.confirmed) {
      const toast = await this.toastController.create({
        message: 'Reschedule functionality coming soon',
        duration: 2000,
        position: 'bottom'
      });
      await toast.present();
    }
  }

  async cancelClassAction() {
    if (!this.classData || this.classIsCancelled || this.classIsCompleted) return;
    const className = this.classData.name || 'this class';

    const modal = await this.modalController.create({
      component: ConfirmActionModalComponent,
      componentProps: {
        title: 'Cancel Class',
        message: `Are you sure you want to cancel "${className}"? All enrolled students will be notified and this action cannot be undone.`,
        confirmText: 'Cancel Class',
        cancelText: 'Keep Class',
        confirmColor: 'danger',
        icon: 'close-circle',
        iconColor: 'danger'
      },
      cssClass: 'confirm-action-modal'
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();
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
}
