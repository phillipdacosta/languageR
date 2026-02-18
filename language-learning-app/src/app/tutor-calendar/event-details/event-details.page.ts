import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Location } from '@angular/common';
import { IonicModule, ModalController, ToastController, LoadingController } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { LessonService, Lesson } from '../../services/lesson.service';
import { ClassService } from '../../services/class.service';
import { UserService, User } from '../../services/user.service';
import { TutorFeedbackService, TutorFeedback } from '../../services/tutor-feedback.service';
import { PlatformService } from '../../services/platform.service';
import { WalletService } from '../../services/wallet.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { environment } from '../../../environments/environment';
import { CancelReasonModalComponent } from '../../components/cancel-reason-modal/cancel-reason-modal.component';
import { ConfirmActionModalComponent } from '../../components/confirm-action-modal/confirm-action-modal.component';

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
  imports: [CommonModule, IonicModule, CancelReasonModalComponent, ConfirmActionModalComponent]
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
  tutorId: string | null = null; // For navigation to tutor profile (students only)

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
  isAiAnalysis = false;     // true = AI-generated, false = tutor-sourced
  analysisLabel = 'Analysis'; // Dynamic section label
  hasTutorNote = false;
  hasTutorFeedback = false;
  hasHomework = false;

  // Pre-computed score colors (no functions in template)
  grammarScoreColor = '#6b7280';
  fluencyScoreColor = '#6b7280';
  pronunciationScoreColor = '#6b7280';

  // Class-specific pre-computed
  levelLabel = '';
  classRevenue = '';

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

  // Countdown
  private countdownInterval: any;
  private pendingRequests = 0;

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
    private location: Location
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
  }

  // ── Data Loading ──────────────────────────────────────────────

  loadEventDetails() {
    if (!this.eventId) return;
    this.loading = true;

    this.lessonService.getLesson(this.eventId).subscribe({
      next: (response) => {
        if (response.success && response.lesson) {
          this.lesson = response.lesson;
          this.isClass = false;
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
        } else {
          this.error = 'Event not found';
          this.loading = false;
        }
      },
      error: () => {
        this.error = 'Failed to load event details';
        this.loading = false;
      }
    });
  }

  private loadAdditionalData() {
    if (!this.eventId || !this.lesson) {
      this.loading = false;
      return;
    }

    // Track all pending requests — skeleton stays until everything resolves
    this.pendingRequests = 3; // analysis + feedback + billing
    if (this.isStudentUser) {
      this.pendingRequests++; // + payment method
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
        }
        this.analysisLoading = false;
        this.onRequestComplete();
      },
      error: () => {
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
  }

  /** Called when each async request finishes — reveals content when all done */
  private onRequestComplete() {
    this.pendingRequests--;
    if (this.pendingRequests <= 0) {
      this.computeFeedbackStatus();
      this.loading = false;
    }
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
      this.formattedDate = start.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      });
    }

    // Time range
    const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    this.formattedTimeRange = `${fmt(start)} – ${fmt(end)}`;

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
      this.participantName = firstName && lastName
        ? `${firstName} ${lastName.charAt(0).toUpperCase()}.`
        : p.name || 'Participant';
      this.participantEmail = p.email || '';
      this.participantPicture = p.picture || '';
      this.participantInitial = (p.name || p.firstName || 'P').charAt(0).toUpperCase();
      this.participantRole = this.isTutorUser ? 'Student' : 'Tutor';
    }

    // Pre-compute tutor display name for student view ("Phillip D.")
    const tutor = this.lesson.tutorId;
    if (tutor) {
      const tFirst = tutor.firstName || tutor.name?.split(' ')[0] || '';
      const tLast = tutor.lastName || tutor.name?.split(' ').slice(1).join(' ') || '';
      this.tutorDisplayName = tFirst && tLast
        ? `${tFirst} ${tLast.charAt(0).toUpperCase()}.`
        : tutor.name || 'Your tutor';
      
      // Store tutor ID for navigation (students only)
      if (this.isStudentUser) {
        this.tutorId = tutor._id?.toString() || tutor.toString() || null;
      }
    }
  }

  private computeTip() {
    if (!this.lesson) return;
    if (this.lesson.tip && this.lesson.tip.amount) {
      this.hasTip = true;
      this.tipAmount = `$${this.lesson.tip.amount.toFixed(2)}`;
      this.tipDate = this.lesson.tip.paidAt
        ? new Date(this.lesson.tip.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
        ? new Date(this.lesson.cancelledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
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
      this.issueDetailsText = this.lesson.issueDetails || '';
      this.issueDate = this.lesson.issueReportedAt
        ? new Date(this.lesson.issueReportedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
    // Only show for pending reschedule proposals — accepted/rejected are historical
    if (rp.status && rp.status === 'pending') {
      this.hasReschedule = true;
      this.rescheduleStatus = 'Pending';
      if (rp.proposedStartTime && rp.proposedEndTime) {
        const s = new Date(rp.proposedStartTime);
        const e = new Date(rp.proposedEndTime);
        const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        this.proposedTimeRange = `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${fmt(s)} – ${fmt(e)}`;
      }
    }
  }

  private computeAnalysisProperties() {
    if (!this.analysisData) return;
    this.hasAnalysis = this.analysisData.status === 'completed';
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
      ? new Date(this.tutorFeedback.providedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
      this.formattedDate = start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    this.formattedTimeRange = `${fmt(start)} – ${fmt(end)}`;
    this.formattedDuration = `${this.classData.duration || 60} minutes`;
    this.formattedPrice = this.classData.price ? `$${this.classData.price.toFixed(2)}` : 'Free';

    // Pre-compute class-specific values
    const levelMap: Record<string, string> = {
      any: 'Any Level', beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced'
    };
    this.levelLabel = levelMap[this.classData.level] || 'Any Level';

    if (this.classData.price && this.classData.studentIds?.length) {
      this.classRevenue = `$${(this.classData.price * this.classData.studentIds.length).toFixed(2)}`;
    }
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
    // Only allow navigation for students viewing tutor info
    if (this.isStudentUser && this.tutorId) {
      this.router.navigate(['/tutor', this.tutorId]);
    }
  }

  // getScoreColor / getLevelLabel are now pre-computed — see calcScoreColor / computeClassProperties
}
