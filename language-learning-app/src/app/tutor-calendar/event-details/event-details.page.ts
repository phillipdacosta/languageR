import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Location } from '@angular/common';
import { IonicModule, ModalController, ToastController, LoadingController } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { LessonService, Lesson } from '../../services/lesson.service';
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
import { ConfirmActionModalComponent } from '../../components/confirm-action-modal/confirm-action-modal.component';
import { RescheduleLessonModalComponent } from '../../components/reschedule-lesson-modal/reschedule-lesson-modal.component';
import { formatTimeInTz, formatDateInTz } from '../../shared/timezone.utils';
import { MaterialService, TutorMaterial } from '../../services/material.service';
import { LearningPlanService, LearningPlanSummary, GOAL_TYPE_LABELS } from '../../services/learning-plan.service';

// ── Interfaces ──────────────────────────────────────────────────
interface AnalysisData {
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
  imports: [CommonModule, IonicModule, SharedModule, CancelReasonModalComponent, ConfirmActionModalComponent, RescheduleLessonModalComponent]
})
export class EventDetailsPage implements OnInit, OnDestroy {
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
  channelsSectionExpanded = true;
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
  hasHomework = false;

  // Previous lesson notes for this tutor-student pair
  previousNotesData: any = null;
  hasPreviousNotes = false;
  previousNotesIsAiSource = false;
  previousNotesDate = '';
  previousNotesSanitized: SafeHtml | null = null;

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
  feedbackHomework = '';
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
  classStudentsDisplay: { name: string; picture?: string; initials: string }[] = [];

  // Countdown
  private countdownInterval: any;
  private pendingRequests = 0;

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
    private learningPlanService: LearningPlanService
  ) {}

  ngOnInit() {
    this.eventId = this.route.snapshot.paramMap.get('id');

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
  }

  ngOnDestroy() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    this.flipTransition.cleanup();
  }

  // ── Data Loading ──────────────────────────────────────────────

  loadEventDetails() {
    if (!this.eventId) return;
    this.loading = true;

    this.lessonService.getLesson(this.eventId).subscribe({
      next: (response: any) => {
        if (response.success && response.lesson) {
          this.lesson = response.lesson;
          this.isClass = false;
          this.lessonsWithParticipant = response.lessonsCompleted || 0;
          // Tutor stats from backend aggregation (not from populated user)
          if (response.tutorStats) {
            const ts = response.tutorStats;
            if (ts.rating && Number(ts.rating) >= 4.0) {
              this.tutorStatsRating = Number(ts.rating).toFixed(1);
              this.tutorStatsRatingRounded = Math.round(Number(ts.rating));
            }
            this.tutorStatsTotalLessons = ts.totalLessons || 0;
            this.tutorStatsStudents = ts.students || 0;
          }
          this.recentLessons = (response.recentLessons || []).map((l: any) => ({
            _id: l._id,
            subject: l.subject || 'Language Lesson',
            dateLabel: formatDateInTz(l.startTime, this.userTz, { month: 'short', day: 'numeric' }),
            durationLabel: l.duration < 60 ? `${l.duration}m` : `${Math.floor(l.duration / 60)}h${l.duration % 60 ? ` ${l.duration % 60}m` : ''}`
          }));
          // loading stays true — skeleton visible until all additional data loads
          this.computeAllProperties();
          this.loadAdditionalData();
          this.startCountdown();
        } else {
          this.loadClassDetails();
        }
      },
      error: () => {
        this.loadClassDetails();
      }
    });
  }

  loadClassDetails() {
    if (!this.eventId) return;

    this.classService.getClass(this.eventId).subscribe({
      next: (response: any) => {
        if (response.success && response.class) {
          this.classData = response.class;
          this.isClass = true;
          if (this.classData?.description) {
            this.sanitizedDescription = this.sanitizer.bypassSecurityTrustHtml(this.classData.description);
          }
          this.loading = false;
          this.computeClassProperties();
          this.startCountdown();
          this.flipTransition.cleanup();
        } else {
          this.error = 'Event not found';
          this.loading = false;
          this.flipTransition.cleanup();
        }
      },
      error: () => {
        this.error = 'Failed to load event details';
        this.loading = false;
        this.flipTransition.cleanup();
      }
    });
  }

  private loadAdditionalData() {
    if (!this.eventId || !this.lesson) {
      this.loading = false;
      return;
    }

    // Track all pending requests — skeleton stays until everything resolves
    this.pendingRequests = 5; // analysis + feedback + billing + payment + previous notes
    if (this.isStudentUser) {
      this.pendingRequests++; // + payment method
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
    this.analysisLoading = true;
    const headers = this.userService.getAuthHeadersSync();
    this.http.get<any>(
      `${environment.backendUrl}/api/transcription/lesson/${this.eventId}/analysis`,
      { headers }
    ).subscribe({
      next: (res) => {
        if (res.success && res.analysis) {
          this.analysisData = res.analysis;
          this.computeAnalysisProperties();
        } else if (this.isLessonCompleted) {
          this.analysisUnavailable = true;
        }
        this.analysisLoading = false;
        this.onRequestComplete();
      },
      error: (err: any) => {
        if (err?.error?.status === 'unavailable' || this.isLessonCompleted) {
          this.analysisUnavailable = true;
        }
        this.analysisLoading = false;
        this.onRequestComplete();
      }
    });

    // Load tutor feedback
    this.feedbackLoading = true;
    this.tutorFeedbackService.getFeedbackForLesson(this.eventId).subscribe({
      next: (res) => {
        if (res.success && res.hasFeedback && res.feedback) {
          this.tutorFeedback = res.feedback;
          this.computeFeedbackProperties();
        }
        this.feedbackLoading = false;
        this.onRequestComplete();
      },
      error: () => {
        this.feedbackLoading = false;
        this.onRequestComplete();
      }
    });

    // Load billing
    this.lessonService.getBillingSummary(this.eventId).subscribe({
      next: (res: any) => {
        if (res.success && res.billing) {
          this.billingData = res.billing;
          this.computeBillingProperties();
        }
        this.onRequestComplete();
      },
      error: () => {
        this.onRequestComplete();
      }
    });

    // Load payment details (for financial status section)
    // Use a dedicated method that ensures valid auth headers
    this.loadPaymentDetails();

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
            }
          }
          this.onRequestComplete();
        },
        error: () => {
          this.onRequestComplete();
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
        }
        this.onRequestComplete();
      },
      error: () => {
        this.onRequestComplete();
      }
    });
  }

  private loadPaymentDetails(retryCount = 0) {
    const headers = this.userService.getAuthHeadersSync();
    const hasAuth = headers.has('Authorization');

    if (!hasAuth && retryCount < 2) {
      setTimeout(() => this.loadPaymentDetails(retryCount + 1), 500);
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
        }
        this.onRequestComplete();
      },
      error: () => {
        if (retryCount < 2) {
          setTimeout(() => this.loadPaymentDetails(retryCount + 1), 800);
        } else {
          this.onRequestComplete();
        }
      }
    });
  }

  /** Called when each async request finishes — reveals content when all done */
  private onRequestComplete() {
    this.pendingRequests--;
    if (this.pendingRequests <= 0) {
      this.computeFeedbackStatus();
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
  }

  private computeRole() {
    if (!this.lesson || !this.currentUser) return;
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
    this.formattedTimeRange = `${formatTimeInTz(start, this.userTz)} – ${formatTimeInTz(end, this.userTz)}`;

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

    // Tutor sees channels/materials collapsed by default
    if (this.isTutorUser) {
      this.channelsSectionExpanded = false;
      this.materialsSectionExpanded = false;
    }
  }

  private loadTutorMaterials() {
    if (!this.tutorId) return;
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
        ? `${formatDateInTz(this.lesson.cancelledAt, this.userTz, { month: 'short', day: 'numeric', year: 'numeric' })} ${formatTimeInTz(this.lesson.cancelledAt, this.userTz)}`
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
        this.proposedTimeRange = `${formatDateInTz(s, this.userTz, { month: 'short', day: 'numeric', year: undefined })} at ${formatTimeInTz(s, this.userTz)} – ${formatTimeInTz(e, this.userTz)}`;
      }
    }
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

    // Homework suggestions
    this.hasHomework = !!(
      this.analysisData.homeworkSuggestions?.length ||
      this.analysisData.tutorNote?.homework
    );
  }

  private calcScoreColor(score: number | undefined): string {
    if (score == null) return '#6b7280';
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#f59e0b';
    return '#ef4444';
  }

  private computeFeedbackProperties() {
    if (!this.tutorFeedback || this.tutorFeedback.status !== 'completed') return;
    this.hasTutorFeedback = true;
    this.feedbackStrengths = this.tutorFeedback.strengths || [];
    this.feedbackImprovements = this.tutorFeedback.areasForImprovement || [];
    this.feedbackHomework = this.tutorFeedback.homework || '';
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
    // Compute status for class
    const now = new Date();
    const start = new Date(this.classData.startTime);
    const end = new Date(this.classData.endTime);

    if (now >= start && now <= end) {
      this.statusLabel = 'In Progress';
      this.statusColor = '#10b981';
      this.statusClass = 'in-progress';
    } else if (now > end) {
      this.statusLabel = 'Completed';
      this.statusColor = '#6b7280';
      this.statusClass = 'completed';
    } else {
      this.statusLabel = 'Upcoming';
      this.statusColor = '#667eea';
      this.statusClass = 'upcoming';
    }

    // Formatted date/time for class
    if (start.toDateString() === new Date().toDateString()) {
      this.formattedDate = 'Today';
    } else {
      this.formattedDate = formatDateInTz(start, this.userTz, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    this.formattedTimeRange = `${formatTimeInTz(start, this.userTz)} – ${formatTimeInTz(end, this.userTz)}`;
    this.formattedDuration = `${this.classData.duration || 60} minutes`;
    this.formattedPrice = this.classData.price ? `$${this.classData.price.toFixed(2)}` : 'Free';

    // Pre-compute class-specific values
    const levelMap: Record<string, string> = {
      any: 'Any Level', beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced'
    };
    this.levelLabel = levelMap[this.classData.level] || 'Any Level';

    if (this.classData.price && this.classData.confirmedStudents?.length) {
      this.classRevenue = `$${(this.classData.price * this.classData.confirmedStudents.length).toFixed(2)}`;
    }

    this.classStudentsDisplay = (this.classData.confirmedStudents || []).map((s: any) => {
      const name = this.formatPersonName(s, 'Student');
      return {
        name,
        picture: s.picture || s.profilePicture,
        initials: name.split(' ').map((p: string) => p.charAt(0)).join('').toUpperCase().slice(0, 2),
      };
    });

    // Check for cancelled class
    if (this.classData.status === 'cancelled') {
      this.statusLabel = 'Cancelled';
      this.statusClass = 'cancelled';
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
    // Use browser history to return to wherever the user came from
    // (lessons page, tutor calendar, home, notifications, etc.)
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

    // For tutors, feedback is always shown as pending if not provided
    // For students, only show "awaiting" if AI analysis is NOT available AND
    // the lesson actually requires tutor feedback (i.e. AI wasn't supposed to handle it)
    if (this.isTutorUser) {
      this.feedbackPending = !this.feedbackProvided;
    } else {
      // Student: check both the loaded analysis AND the lesson's embedded aiAnalysis field
      const hasAiAnalysis = this.hasAnalysis
        || this.lesson.aiAnalysis?.status === 'completed'
        || !!this.lesson.aiAnalysis?.generatedAt;

      // If AI analysis was enabled for this lesson, tutor feedback is NOT required.
      // Only show "Awaiting feedback" when the lesson explicitly requires tutor feedback
      // (requiresTutorFeedback is true) or when there's a pending TutorFeedback record.
      const aiWasEnabled = this.lesson.aiAnalysisEnabledAtTime === true;
      const requiresTutorFeedback = !!this.lesson.requiresTutorFeedback;
      const hasPendingFeedbackRecord = !!this.tutorFeedback && this.tutorFeedback.status === 'pending';

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

  toggleChannelsSection() {
    this.channelsSectionExpanded = !this.channelsSectionExpanded;
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

  // getScoreColor / getLevelLabel are now pre-computed — see calcScoreColor / computeClassProperties
}
