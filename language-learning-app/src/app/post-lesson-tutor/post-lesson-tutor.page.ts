import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LoadingController, AlertController, ToastController } from '@ionic/angular';
import { LessonAnalysis } from '../services/transcription.service';
import { UserService } from '../services/user.service';
import { LessonService } from '../services/lesson.service';
import { TutorFeedbackService } from '../services/tutor-feedback.service';
import { LearningPlanService, LearningPlanSummary } from '../services/learning-plan.service';
import { JourneyMapPreviewPhase } from '../journey/journey-map-preview.component';
import { firstValueFrom, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { formatTimeInTz, formatDateInTz, isSameDayInTimezone } from '../shared/timezone.utils';

interface LessonInfo {
  _id: string;
  subject: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  actualDurationMinutes?: number;
  price?: number;
  aiAnalysisEnabledAtTime?: boolean | null;
  isTrialLesson?: boolean;
  isTrial?: boolean;
  tutor: {
    _id: string;
    name: string;
    picture?: string;
  };
  student: {
    _id: string;
    name: string;
    firstName?: string;
    picture?: string;
  };
}

interface LabeledOption {
  value: string;
  label: string;
}

interface ImpressionOption {
  value: string;
  label: string;
  color: string;
}

@Component({
  selector: 'app-post-lesson-tutor',
  templateUrl: './post-lesson-tutor.page.html',
  styleUrls: ['./post-lesson-tutor.page.scss'],
  standalone: false
})
export class PostLessonTutorPage implements OnInit, OnDestroy {
  @ViewChild('actionsScroll') actionsScrollRef?: ElementRef<HTMLElement>;
  @ViewChild('correctionsSection') correctionsSectionRef?: ElementRef<HTMLElement>;
  @ViewChild('planOverrideContext') planOverrideContextRef?: ElementRef<HTMLElement>;

  lessonId: string = '';
  feedbackId: string = ''; // From TutorFeedback system (if navigated from pending feedback)
  isPostCall: boolean = false; // True when arriving directly after a video call
  lessonSubjectFallback: string = '';
  notePlaceholder: string = '';
  homeworkPlaceholder: string = '';
  correctionOriginalPlaceholder: string = '';
  correctionFixedPlaceholder: string = '';
  correctionWhyPlaceholder: string = '';
  removeCorrectionLabel: string = '';
  focusPlaceholder: string = '';
  planNotePlaceholder: string = '';
  lesson: LessonInfo | null = null;
  student: any = null;
  analysis: LessonAnalysis | null = null;
  analysisLoaded = false;

  quickSummaryChips: Array<{
    key: 'level' | 'grammar';
    label: string;
    qualitative: string;
    tone: 'neutral' | 'strong' | 'solid' | 'building' | 'needs_work';
  }> = [];
  recapOnly = false;
  recapMessage = '';
  aiAnalysisLabel = '';

  // Trial mode: trials capture no audio, so the tutor's quick assessment
  // (CEFR + "start with" chips + optional note) is the only signal that
  // seeds the student's learning plan. Trimmed form, always skippable.
  isTrialMode: boolean = false;
  
  // Computed display properties (avoid function calls in template)
  studentDisplayName: string = '';
  lessonDateTime: string = '';
  lessonDurationLabel: string = '';
  dotIndices: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  
  // AI-enabled flag for this student
  studentAiEnabled: boolean = true;
  
  // Countdown timer (2-hour grace period before profile is hidden)
  countdownDisplay: string = '';
  countdownExpired: boolean = false;
  showCountdown: boolean = false;
  private countdownInterval: any = null;
  private graceDeadline: Date | null = null;
  private static readonly GRACE_PERIOD_MS = 2 * 60 * 60 * 1000; // 2 hours

  // Note form
  noteText: string = '';
  quickImpression: string = '';
  homework: string = '';
  submittingNote = false;
  noteSubmitted = false;
  
  // Enhanced tutor assessment fields (shown when AI is off)
  cefrLevel: string = '';
  grammarRating: number = 0;
  fluencyRating: number = 0;
  selectedErrorAreas: string[] = [];
  selectedStrengths: string[] = [];
  selectedAreasToImprove: string[] = [];
  customStrength: string = '';
  customAreaToImprove: string = '';

  // Optional structured corrections — go straight onto the student's
  // spaced-repetition deck server-side. Lazily expanded.
  showCorrections = false;
  capturedCorrections: Array<{ original: string; corrected: string; explanation?: string }> = [];

  // Learning Plan overrides
  showPlanOverride = false;
  planOverrideAction: string = '';
  planOverrideFocus: string = '';
  planOverrideNote: string = '';
  hasActivePlan = false;
  planStudentId: string = '';
  planLanguage: string = '';

  // Phase context so the tutor knows what they're adjusting + where the
  // student sits in the journey overall. Reuses the journey-map snapshot
  // shown in lessons/:id. Precomputed (no template fns per AGENTS rules).
  private planSummary: LearningPlanSummary | null = null;
  showJourneyMap = false;
  journeySectionTitle: string = '';
  journeyChapterTheme: string = 'a1-desert';
  journeyChapterLevel: string = 'A1';
  journeyPhases: JourneyMapPreviewPhase[] = [];
  journeyCurrentPhaseIndex: number = 0;
  journeyCaption: string = '';
  journeyStartingChapterIndex = -1;
  showFullJourneyLabel = '';
  planPhaseLabel: string = '';
  planPhaseFocusLabel: string = '';

  impressionOptions: ImpressionOption[] = [];
  errorAreaOptions: LabeledOption[] = [];
  strengthOptions: LabeledOption[] = [];
  improvementOptions: LabeledOption[] = [];
  planOverrideActions: LabeledOption[] = [];

  private readonly destroy$ = new Subject<void>();

  private readonly impressionConfig = [
    { value: 'excellent', key: 'VIDEO_CALL.IMPRESSION_EXCELLENT', color: 'success' },
    { value: 'great', key: 'VIDEO_CALL.IMPRESSION_GREAT', color: 'primary' },
    { value: 'good', key: 'VIDEO_CALL.IMPRESSION_GOOD', color: 'secondary' },
    { value: 'needs-work', key: 'VIDEO_CALL.IMPRESSION_NEEDS_WORK', color: 'warning' }
  ];

  cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  private readonly errorAreaConfig = [
    { value: 'Verb conjugation', key: 'VIDEO_CALL.ERROR_VERB_CONJUGATION' },
    { value: 'Gender agreement', key: 'VIDEO_CALL.ERROR_GENDER_AGREEMENT' },
    { value: 'Prepositions', key: 'VIDEO_CALL.ERROR_PREPOSITIONS' },
    { value: 'Tense usage', key: 'VIDEO_CALL.ERROR_TENSE' },
    { value: 'Vocabulary', key: 'VIDEO_CALL.ERROR_VOCABULARY' },
    { value: 'Pronunciation', key: 'VIDEO_CALL.ERROR_PRONUNCIATION' },
    { value: 'Sentence structure', key: 'VIDEO_CALL.ERROR_SENTENCE_STRUCTURE' },
    { value: 'Articles', key: 'VIDEO_CALL.ERROR_ARTICLES' }
  ];

  private readonly strengthConfig = [
    { value: 'Conversational fluency', key: 'VIDEO_CALL.STRENGTH_CONVERSATIONAL_FLUENCY' },
    { value: 'Vocabulary usage', key: 'VIDEO_CALL.STRENGTH_VOCABULARY' },
    { value: 'Grammar accuracy', key: 'VIDEO_CALL.STRENGTH_GRAMMAR' },
    { value: 'Pronunciation', key: 'VIDEO_CALL.STRENGTH_PRONUNCIATION' },
    { value: 'Listening comprehension', key: 'VIDEO_CALL.STRENGTH_LISTENING' },
    { value: 'Confidence', key: 'VIDEO_CALL.STRENGTH_CONFIDENCE' },
    { value: 'Complex sentences', key: 'VIDEO_CALL.STRENGTH_COMPLEX_SENTENCES' },
    { value: 'Natural expressions', key: 'VIDEO_CALL.STRENGTH_NATURAL_EXPRESSIONS' }
  ];

  private readonly improvementConfig = [
    { value: 'Grammar accuracy', key: 'VIDEO_CALL.IMPROVE_GRAMMAR' },
    { value: 'Verb conjugation', key: 'VIDEO_CALL.IMPROVE_VERB_CONJUGATION' },
    { value: 'Vocabulary range', key: 'VIDEO_CALL.IMPROVE_VOCABULARY' },
    { value: 'Pronunciation', key: 'VIDEO_CALL.IMPROVE_PRONUNCIATION' },
    { value: 'Fluency/speed', key: 'VIDEO_CALL.IMPROVE_FLUENCY' },
    { value: 'Listening skills', key: 'VIDEO_CALL.IMPROVE_LISTENING' },
    { value: 'Sentence complexity', key: 'VIDEO_CALL.IMPROVE_SENTENCE_COMPLEXITY' },
    { value: 'Idiomatic expressions', key: 'VIDEO_CALL.IMPROVE_IDIOMATIC' }
  ];

  private readonly planOverrideConfig = [
    { value: '', key: 'POST_LESSON.TUTOR.PLAN_NO_CHANGE' },
    { value: 'advance_phase', key: 'POST_LESSON.TUTOR.PLAN_ADVANCE' },
    { value: 'extend_phase', key: 'POST_LESSON.TUTOR.PLAN_EXTEND' },
    { value: 'adjust_focus', key: 'POST_LESSON.TUTOR.PLAN_ADJUST_FOCUS' },
    { value: 'add_note', key: 'POST_LESSON.TUTOR.PLAN_ADD_NOTE' }
  ];

  private get userTz(): string | undefined {
    return this.userService.getCurrentUserValue()?.profile?.timezone || undefined;
  }

  /** Disable submit button when form is incomplete */
  get isSubmitDisabled(): boolean {
    if (this.submittingNote) return true;
    if (this.isTrialMode) {
      // Trial assessment: level + at least one "start with" chip; note optional.
      return !(this.cefrLevel && this.selectedAreasToImprove.length > 0);
    }
    if (!this.noteText.trim()) return true;
    if (!this.studentAiEnabled) {
      return !(this.cefrLevel && this.grammarRating > 0 && this.fluencyRating > 0 &&
        this.selectedStrengths.length > 0 && this.selectedAreasToImprove.length > 0);
    }
    return false;
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private http: HttpClient,
    private userService: UserService,
    private lessonService: LessonService,
    private loadingCtrl: LoadingController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private tutorFeedbackService: TutorFeedbackService,
    private learningPlanService: LearningPlanService,
    private translate: TranslateService
  ) {}

  async ngOnInit() {
    this.lessonId = this.route.snapshot.paramMap.get('id') || '';
    this.feedbackId = this.route.snapshot.queryParamMap.get('feedbackId') || '';
    this.isPostCall = this.route.snapshot.queryParamMap.get('fromPostCall') === 'true';
    this.isTrialMode = this.route.snapshot.queryParamMap.get('trial') === 'true';
    this.buildLocalizedStrings();
    this.translate.onLangChange.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.buildLocalizedStrings();
      if (this.lesson) {
        this.lessonDateTime = this.computeLessonDateTime();
        this.lessonDurationLabel = this.computeLessonDurationLabel();
      }
      if (this.analysis) {
        this.rebuildQuickSummary();
      }
      if (this.planSummary) {
        this.buildPlanPhaseContext();
      }
    });
    
    // Wait for user to be loaded first
    await this.ensureUserLoaded();
    
    if (this.lessonId) {
      this.loadLessonInfo();
      this.loadAnalysis();
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  private buildLocalizedStrings(): void {
    this.lessonSubjectFallback = this.t('POST_LESSON.TUTOR.LESSON');
    this.notePlaceholder = this.t('POST_LESSON.TUTOR.NOTE_PLACEHOLDER');
    this.homeworkPlaceholder = this.t('POST_LESSON.TUTOR.HOMEWORK_PLACEHOLDER');
    this.correctionOriginalPlaceholder = this.t('POST_LESSON.TUTOR.STUDENT_SAID_PLACEHOLDER');
    this.correctionFixedPlaceholder = this.t('POST_LESSON.TUTOR.SHOULD_BE_PLACEHOLDER');
    this.correctionWhyPlaceholder = this.t('POST_LESSON.TUTOR.WHY_PLACEHOLDER');
    this.removeCorrectionLabel = this.t('POST_LESSON.TUTOR.REMOVE_CORRECTION');
    this.focusPlaceholder = this.t('POST_LESSON.TUTOR.FOCUS_PLACEHOLDER');
    this.planNotePlaceholder = this.t('POST_LESSON.TUTOR.PLAN_NOTE_PLACEHOLDER');
    this.aiAnalysisLabel = this.t('POST_LESSON.TUTOR.AI_ANALYSIS_LABEL');
    this.showFullJourneyLabel = this.t('JOURNEY.SNAPSHOT.SHOW_FULL_JOURNEY');

    this.impressionOptions = this.impressionConfig.map(o => ({
      value: o.value,
      color: o.color,
      label: this.t(o.key)
    }));
    this.errorAreaOptions = this.errorAreaConfig.map(o => ({
      value: o.value,
      label: this.t(o.key)
    }));
    this.strengthOptions = this.strengthConfig.map(o => ({
      value: o.value,
      label: this.t(o.key)
    }));
    this.improvementOptions = this.improvementConfig.map(o => ({
      value: o.value,
      label: this.t(o.key)
    }));
    this.planOverrideActions = this.planOverrideConfig.map(o => ({
      value: o.value,
      label: this.t(o.key)
    }));
  }

  private async ensureUserLoaded(): Promise<void> {
    try {
      const user = await firstValueFrom(this.userService.getCurrentUser());
      console.log('✅ POST-LESSON-TUTOR: User loaded:', user);
      console.log('✅ POST-LESSON-TUTOR: Current user email:', user?.email);
    } catch (error) {
      console.error('❌ POST-LESSON-TUTOR: Error loading user:', error);
    }
  }

  async loadLessonInfo() {
    try {
      console.log('📚 POST-LESSON-TUTOR: Loading lesson info for:', this.lessonId);
      const response: any = await firstValueFrom(
        this.lessonService.getLesson(this.lessonId)
      );
      
      if (response?.lesson) {
        this.lesson = response.lesson;
        // Backend returns studentId and tutorId, not student and tutor
        this.student = response.lesson.studentId || response.lesson.student;
        
        const isTrial = !!(response.lesson.isTrialLesson || response.lesson.isTrial);
        if (isTrial) this.isTrialMode = true;

        // Use the lesson's snapshot of the AI setting (immutable at lesson completion).
        // Fall back to live student profile for legacy lessons without the snapshot.
        // Trial lessons never run AI analysis and never require mandatory structured
        // feedback, so they are always treated as "AI enabled" here to avoid forcing
        // the tutor into the countdown / required-assessment flow.
        if (isTrial) {
          this.studentAiEnabled = true;
        } else if (this.lesson!.aiAnalysisEnabledAtTime !== null && this.lesson!.aiAnalysisEnabledAtTime !== undefined) {
          this.studentAiEnabled = this.lesson!.aiAnalysisEnabledAtTime !== false;
        } else if (this.student && typeof this.student === 'object' && this.student.profile) {
          this.studentAiEnabled = this.student.profile.aiAnalysisEnabled !== false;
        } else {
          this.studentAiEnabled = true; // Default to enabled
        }
        
        // Compute display properties once (avoid function calls in template)
        this.studentDisplayName = this.computeStudentDisplayName();
        this.lessonDateTime = this.computeLessonDateTime();
        this.lessonDurationLabel = this.computeLessonDurationLabel();

        // Start countdown timer if student has AI disabled (feedback is required)
        if (!this.studentAiEnabled) {
          this.startCountdownTimer();
        }

        console.log('✅ POST-LESSON-TUTOR: Lesson info loaded:', this.lesson);
        console.log('✅ POST-LESSON-TUTOR: Student info:', this.student);
        console.log('🤖 POST-LESSON-TUTOR: Student AI enabled:', this.studentAiEnabled);

        this.checkForActivePlan();
      }
    } catch (error) {
      console.error('❌ POST-LESSON-TUTOR: Error loading lesson info:', error);
    }
  }

  private checkForActivePlan() {
    const studentId = typeof this.student === 'object' ? (this.student as any)?._id : this.student;
    if (!studentId) return;

    this.planStudentId = studentId;
    this.planLanguage = (this.lesson?.subject || '').replace(/\s*lesson$/i, '').trim() || this.lesson?.subject || '';

    this.learningPlanService.getStudentPlanSummary(studentId).subscribe({
      next: (res) => {
        if (res.success && res.summaries?.length) {
          this.hasActivePlan = true;
          const lang = this.planLanguage.toLowerCase();
          const match = res.summaries.find(
            (s) => (s.language || '').toLowerCase() === lang
          );
          this.planSummary = match || res.summaries[0];
          this.buildPlanPhaseContext();
        }
      },
      error: () => {}
    });
  }

  private buildPlanPhaseContext(): void {
    const summary = this.planSummary;
    if (!summary) {
      this.resetPlanPhaseContext();
      return;
    }

    const currentIndex = summary.currentPhaseIndex ?? 0;
    const total = summary.totalPhases ?? 0;

    this.journeySectionTitle = this.t('JOURNEY.SNAPSHOT.STUDENT_IS_HERE', {
      name: this.studentDisplayName
    });

    // Same phase label used in the pre-lesson briefing / map caption.
    this.planPhaseLabel = summary.currentPhase
      ? this.t('PRE_CALL.PHASE_LABEL', {
          current: String(currentIndex + 1),
          total: String(total),
          title: summary.currentPhase.title
        })
      : '';

    const focusAreas = summary.currentPhase?.focusAreas || [];
    this.planPhaseFocusLabel = focusAreas.length
      ? this.t('JOURNEY.SNAPSHOT.PHASE_FOCUS', { areas: focusAreas.slice(0, 3).join(' · ') })
      : '';

    // Journey-map inputs (mirrors event-details' applyJourneyMapFromSummary).
    this.journeyChapterTheme = summary.chapterTheme || 'a1-desert';
    this.journeyChapterLevel = summary.chapterLevel || 'A1';
    this.journeyStartingChapterIndex = this.resolveChapterIndex(summary.chapterTheme, summary.chapterLevel);
    this.journeyCurrentPhaseIndex = currentIndex;
    this.journeyPhases = this.buildJourneyPhases(summary, currentIndex, total);
    this.journeyCaption = this.planPhaseLabel;

    const mapStatuses = new Set(['draft', 'active', 'completed', 'mastery_mode']);
    this.showJourneyMap =
      this.journeyPhases.length > 0 && mapStatuses.has(summary.status || '');
  }

  private buildJourneyPhases(
    summary: LearningPlanSummary,
    currentIndex: number,
    total: number
  ): JourneyMapPreviewPhase[] {
    if (summary.phases?.length) {
      return summary.phases.map((p) => ({
        title: p.title || '',
        status: (p.status as JourneyMapPreviewPhase['status']) || 'locked',
        isRecovery: !!p._isRecovery,
        isSplit: !!p._isSplit
      }));
    }

    if (total > 0) {
      return Array.from({ length: total }, (_, i) => {
        let status: JourneyMapPreviewPhase['status'] = 'locked';
        if (i < currentIndex) status = 'completed';
        else if (i === currentIndex) status = 'active';
        return {
          title: i === currentIndex ? summary.currentPhase?.title || '' : '',
          status,
          isRecovery: i === currentIndex && !!summary.currentPhase?._isRecovery,
          isSplit: i === currentIndex && !!summary.currentPhase?._isSplit
        };
      });
    }

    return [];
  }

  private resolveChapterIndex(theme?: string, level?: string): number {
    const themeMap: Record<string, number> = {
      'a1-desert': 0,
      'a2-coast': 1,
      'b1-lake': 2,
      'b2-snow': 3,
      'c1-cherry': 4,
      'c2-tuscany': 5
    };
    const fromTheme = themeMap[(theme || '').toLowerCase()];
    if (typeof fromTheme === 'number') {
      return fromTheme;
    }
    const levelMap: Record<string, number> = {
      A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5
    };
    return levelMap[(level || 'A1').toUpperCase()] ?? 0;
  }

  private resetPlanPhaseContext(): void {
    this.showJourneyMap = false;
    this.journeySectionTitle = '';
    this.journeyChapterTheme = 'a1-desert';
    this.journeyChapterLevel = 'A1';
    this.journeyPhases = [];
    this.journeyCurrentPhaseIndex = 0;
    this.journeyCaption = '';
    this.journeyStartingChapterIndex = -1;
    this.planPhaseLabel = '';
    this.planPhaseFocusLabel = '';
  }

  async loadAnalysis() {
    try {
      const headers = this.userService.getAuthHeadersSync();
      console.log('🔑 POST-LESSON-TUTOR: Auth headers for analysis check:', headers);
      
      const response: any = await firstValueFrom(
        this.http.get(`${environment.apiUrl}/transcription/lesson/${this.lessonId}/analysis`, { headers })
      );
      
      if (response?.analysis?.status === 'completed') {
        this.analysis = response.analysis;
        this.analysisLoaded = true;
        this.rebuildQuickSummary();
        console.log('✅ POST-LESSON-TUTOR: Analysis loaded:', this.analysis);
      }
    } catch (error: any) {
      // Analysis not ready yet - that's okay
      console.log('Analysis not ready yet');
    }
  }

  selectImpression(value: string) {
    this.quickImpression = value;
  }

  addCorrectionRow() {
    if (!this.showCorrections) this.showCorrections = true;
    this.capturedCorrections.push({ original: '', corrected: '', explanation: '' });

    this.scheduleScrollIntoActionsView(() => this.correctionsSectionRef?.nativeElement);
  }

  removeCorrectionRow(index: number) {
    this.capturedCorrections.splice(index, 1);
    if (this.capturedCorrections.length === 0) this.showCorrections = false;
  }

  onPlanOverrideActionChange(action: string): void {
    this.planOverrideAction = action;
    if (!action) {
      return;
    }

    this.scheduleScrollIntoActionsView(() => this.planOverrideContextRef?.nativeElement);
  }

  private scheduleScrollIntoActionsView(getElement: () => HTMLElement | null | undefined): void {
    // Wait for *ngIf content + ion fields to finish layout before measuring.
    setTimeout(() => {
      const element = getElement();
      if (element) {
        this.scrollIntoActionsView(element);
      }
    }, 120);
  }

  private scrollIntoActionsView(element: HTMLElement): void {
    const container = this.actionsScrollRef?.nativeElement;
    if (!container) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const footerClearance = 120;
    const topPadding = 16;
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const elementTop = elementRect.top - containerRect.top + container.scrollTop;
    const elementBottom = elementTop + element.offsetHeight;
    const visibleTop = container.scrollTop + topPadding;
    const visibleBottom = container.scrollTop + container.clientHeight - footerClearance;

    let targetScroll = container.scrollTop;

    if (elementBottom > visibleBottom) {
      targetScroll = elementBottom + footerClearance - container.clientHeight;
    } else if (elementTop < visibleTop) {
      targetScroll = elementTop - topPadding;
    }

    targetScroll = Math.max(0, Math.min(targetScroll, container.scrollHeight - container.clientHeight));

    if (Math.abs(targetScroll - container.scrollTop) < 2) {
      return;
    }

    container.scrollTo({ top: targetScroll, behavior: 'smooth' });
  }

  trackByIndex(i: number) { return i; }

  private validCorrections() {
    return this.capturedCorrections
      .map(c => ({
        original: (c.original || '').trim(),
        corrected: (c.corrected || '').trim(),
        explanation: (c.explanation || '').trim()
      }))
      .filter(c => c.original.length >= 2 && c.corrected.length >= 2 && c.original.toLowerCase() !== c.corrected.toLowerCase());
  }

  toggleErrorArea(area: string) {
    const idx = this.selectedErrorAreas.indexOf(area);
    if (idx >= 0) {
      this.selectedErrorAreas.splice(idx, 1);
    } else {
      this.selectedErrorAreas.push(area);
    }
  }

  toggleStrength(strength: string) {
    const idx = this.selectedStrengths.indexOf(strength);
    if (idx >= 0) {
      this.selectedStrengths.splice(idx, 1);
    } else {
      this.selectedStrengths.push(strength);
    }
  }

  toggleAreaToImprove(area: string) {
    const idx = this.selectedAreasToImprove.indexOf(area);
    if (idx >= 0) {
      this.selectedAreasToImprove.splice(idx, 1);
    } else {
      this.selectedAreasToImprove.push(area);
    }
  }

  selectCefrLevel(level: string) {
    this.cefrLevel = level;
  }

  setGrammarRating(rating: number) {
    this.grammarRating = rating;
  }

  setFluencyRating(rating: number) {
    this.fluencyRating = rating;
  }

  async submitNote() {
    // Trial mode: note is optional — only level + focus chips are required
    // (enforced by isSubmitDisabled, double-checked here).
    if (this.isTrialMode) {
      if (!this.cefrLevel || this.selectedAreasToImprove.length === 0) {
        const alert = await this.alertCtrl.create({
          header: this.t('ALERTS.POST_LESSON.ASSESSMENT_REQUIRED_HEADER'),
          message: this.t('ALERTS.POST_LESSON.ASSESSMENT_REQUIRED_MSG'),
          buttons: [this.t('COMMON.OK')]
        });
        await alert.present();
        return;
      }
    } else if (!this.noteText.trim()) {
      const alert = await this.alertCtrl.create({
        header: this.t('ALERTS.POST_LESSON.NOTE_REQUIRED_HEADER'),
        message: this.t('ALERTS.POST_LESSON.NOTE_REQUIRED_MSG'),
        buttons: [this.t('COMMON.OK')]
      });
      await alert.present();
      return;
    }

    // Validate enhanced form when AI is off
    if (!this.isTrialMode && !this.studentAiEnabled && !(this.cefrLevel && this.grammarRating > 0 && this.fluencyRating > 0 &&
        this.selectedStrengths.length > 0 && this.selectedAreasToImprove.length > 0)) {
      const alert = await this.alertCtrl.create({
        header: this.t('ALERTS.POST_LESSON.ASSESSMENT_REQUIRED_HEADER'),
        message: this.t('ALERTS.POST_LESSON.ASSESSMENT_REQUIRED_MSG'),
        buttons: [this.t('COMMON.OK')]
      });
      await alert.present();
      return;
    }

    this.submittingNote = true;

    try {
      const headers = this.userService.getAuthHeadersSync();
      
      // Build payload - include enhanced fields when AI is off
      const payload: any = {
        text: this.noteText,
        quickImpression: this.quickImpression,
        homework: this.homework
      };

      const validCorrections = this.validCorrections();
      if (validCorrections.length > 0) {
        payload.capturedCorrections = validCorrections;
      }

      if (this.isTrialMode) {
        // Trial mini-assessment: level + "start with" focus areas. Backend
        // creates a tutor-sourced analysis and seeds the learning plan
        // (seed-only — trials never push mastery scores).
        payload.cefrLevel = this.cefrLevel;
        payload.areasToImprove = [...this.selectedAreasToImprove];
        payload.isTutorAssessment = true;
      } else if (!this.studentAiEnabled) {
        payload.cefrLevel = this.cefrLevel;
        payload.grammarRating = this.grammarRating;
        payload.fluencyRating = this.fluencyRating;
        payload.keyErrorAreas = this.selectedErrorAreas;
        payload.strengths = [
          ...this.selectedStrengths,
          ...(this.customStrength.trim() ? [this.customStrength.trim()] : [])
        ];
        payload.areasToImprove = [
          ...this.selectedAreasToImprove,
          ...(this.customAreaToImprove.trim() ? [this.customAreaToImprove.trim()] : [])
        ];
        payload.isTutorAssessment = true;
      }
      
      const response: any = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/lessons/${this.lessonId}/tutor-note`, payload, { headers })
      );

      if (response.success) {
        this.noteSubmitted = true;
        
        // If this was opened from a pending TutorFeedback request, mark it as completed too
        if (this.feedbackId) {
          try {
            await firstValueFrom(this.tutorFeedbackService.submitFeedback(this.feedbackId, {
              strengths: this.selectedStrengths.length > 0 
                ? this.selectedStrengths 
                : [this.noteText.trim()],
              areasForImprovement: this.selectedAreasToImprove.length > 0 
                ? this.selectedAreasToImprove 
                : [],
              homework: this.homework || '',
              overallNotes: this.noteText || '',
              estimatedCefrLevel: this.cefrLevel || ''
            }));
            console.log('✅ POST-LESSON-TUTOR: TutorFeedback record also marked as completed');
          } catch (fbError) {
            console.warn('⚠️ POST-LESSON-TUTOR: Could not mark TutorFeedback as completed:', fbError);
            // Non-blocking — the tutor note was already saved successfully
          }
        }

        // Submit tutor override to learning plan if selected
        if (this.hasActivePlan && this.planOverrideAction && this.planStudentId) {
          try {
            await firstValueFrom(this.learningPlanService.submitTutorOverride({
              studentId: this.planStudentId,
              language: this.planLanguage,
              action: this.planOverrideAction,
              note: this.planOverrideNote || this.planOverrideFocus || undefined
            }));
          } catch (overrideErr) {
            console.warn('⚠️ Learning plan override failed (non-blocking):', overrideErr);
          }
        }

        // Always refresh the pending feedback cache so banners update everywhere instantly.
        // submitFeedback() above already triggers a refresh when feedbackId exists,
        // but this covers the post-call flow where there's no feedbackId.
        if (!this.feedbackId) {
          this.tutorFeedbackService.refreshPendingFeedback();
        }
        
        const toast = await this.toastCtrl.create({
          message: this.t('POST_LESSON.TUTOR.NOTE_SENT_TOAST'),
          duration: 3000,
          color: 'success',
          position: 'top'
        });
        await toast.present();
        
        // Navigate to home after a short delay
        setTimeout(() => {
          this.goHome();
        }, 1500);
      }
    } catch (error: any) {
      console.error('Error submitting note:', error);
      
      const alert = await this.alertCtrl.create({
        header: this.t('ALERTS.POST_LESSON.NOTE_FAILED_HEADER'),
        message: error.error?.error || this.t('ALERTS.POST_LESSON.NOTE_FAILED_MSG'),
        buttons: [this.t('COMMON.OK')]
      });
      await alert.present();
    } finally {
      this.submittingNote = false;
    }
  }

  skipNote() {
    this.navigateBack();
  }

  async goHome() {
    // If AI is disabled and tutor hasn't submitted feedback yet, warn them
    if (!this.studentAiEnabled && !this.noteSubmitted) {
      const alert = await this.alertCtrl.create({
        header: this.t('ALERTS.POST_LESSON.FEEDBACK_REQUIRED_HEADER'),
        message: this.countdownExpired
          ? this.t('ALERTS.POST_LESSON.FEEDBACK_REQUIRED_EXPIRED')
          : this.t('ALERTS.POST_LESSON.FEEDBACK_REQUIRED_PENDING'),
        buttons: [
          {
            text: this.t('ALERTS.POST_LESSON.LEAVE_ANYWAY'),
            role: 'cancel',
            cssClass: 'secondary',
            handler: () => {
              this.navigateBack();
            }
          },
          {
            text: this.t('ALERTS.POST_LESSON.COMPLETE_FEEDBACK'),
            handler: () => {
              // Stay on the page
            }
          }
        ]
      });
      await alert.present();
      return;
    }
    
    this.navigateBack();
  }

  private navigateBack() {
    if (this.isPostCall) {
      // Came directly from video call — go to lessons home
      this.router.navigate(['/tabs/lessons']);
    } else {
      // Came from calendar, home, lessons list, notifications, etc. — go back
      this.location.back();
    }
  }

  // ── Countdown Timer ──────────────────────────────────────
  private startCountdownTimer() {
    if (!this.lesson) return;

    // Use lesson end time as the reference for the 2-hour grace period
    const lessonEndTime = this.lesson.endTime
      ? new Date(this.lesson.endTime)
      : new Date(this.lesson.startTime);
    
    this.graceDeadline = new Date(lessonEndTime.getTime() + PostLessonTutorPage.GRACE_PERIOD_MS);
    this.showCountdown = true;

    // Update immediately, then every second
    this.updateCountdown();
    this.countdownInterval = setInterval(() => this.updateCountdown(), 1000);
  }

  private updateCountdown() {
    if (!this.graceDeadline) return;

    const now = new Date();
    const remainingMs = this.graceDeadline.getTime() - now.getTime();

    if (remainingMs <= 0) {
      this.countdownExpired = true;
      this.countdownDisplay = this.t('POST_LESSON.TUTOR.EXPIRED');
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
      return;
    }

    const totalSeconds = Math.floor(remainingMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      this.countdownDisplay = `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
    } else {
      this.countdownDisplay = `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
    }
  }

  formatDate(date: Date): string {
    const d = new Date(date);
    const tz = this.userTz || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);

    if (isSameDayInTimezone(d, today, tz)) {
      return this.t('MESSAGES.TODAY');
    }
    if (isSameDayInTimezone(d, yesterday, tz)) {
      return this.t('MESSAGES.YESTERDAY');
    }

    return formatDateInTz(d, this.userTz, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  formatTime(date: Date): string {
    return formatTimeInTz(new Date(date), this.userTz);
  }

  private computeStudentDisplayName(): string {
    if (!this.student) return this.t('VIDEO_CALL.STUDENT');
    
    const firstName = this.student.firstName;
    const lastName = this.student.lastName;
    
    // Best case: we have both firstName and lastName
    if (firstName && lastName) {
      const lastInitial = lastName.charAt(0).toUpperCase();
      return `${firstName} ${lastInitial}.`;
    }
    
    // If only firstName
    if (firstName) {
      return firstName;
    }
    
    // Fallback: try to parse from full name
    const name = this.student.name || '';
    const parts = name.trim().split(' ');
    
    if (parts.length > 1) {
      const first = parts[0];
      const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
      return `${first} ${lastInitial}.`;
    }
    
    // Last resort: just return whatever name we have
    return name || this.t('VIDEO_CALL.STUDENT');
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
    return mins ? this.t('POST_LESSON.TUTOR.MIN_LESSON', { mins }) : '';
  }

  private qualitativeFromScore(score: number | null | undefined): { label: string; tone: 'neutral' | 'strong' | 'solid' | 'building' | 'needs_work' } {
    if (score === null || score === undefined || !Number.isFinite(score)) {
      return { label: '—', tone: 'neutral' };
    }
    if (score >= 80) return { label: 'Strong', tone: 'strong' };
    if (score >= 60) return { label: 'Solid', tone: 'solid' };
    if (score >= 40) return { label: 'Building', tone: 'building' };
    return { label: 'Needs work', tone: 'needs_work' };
  }

  private rebuildQuickSummary(): void {
    if (!this.analysis) {
      this.quickSummaryChips = [];
      this.recapOnly = false;
      this.recapMessage = '';
      return;
    }

    const a: any = this.analysis;
    const level: string = a.overallAssessment?.proficiencyLevel || 'N/A';
    const grammarScore: number | null =
      typeof a.grammarAnalysis?.accuracyScore === 'number' ? a.grammarAnalysis.accuracyScore : null;
    const grammarQ = this.qualitativeFromScore(grammarScore);

    this.recapOnly = a.proficiencyAssessed === false || !a.overallAssessment?.proficiencyLevel;
    if (this.recapOnly) {
      const reason: string = a.gradeWithheldReason || 'insufficient_target_language';
      this.recapMessage = reason === 'insufficient_student_speech'
        ? this.t('POST_LESSON.STUDENT.RECAP_LITTLE_SPEECH')
        : this.t('POST_LESSON.STUDENT.RECAP_MORE_TARGET_LANGUAGE');
    } else {
      this.recapMessage = '';
    }

    const chips: typeof this.quickSummaryChips = [];
    if (!this.recapOnly) {
      chips.push({
        key: 'level',
        label: this.t('POST_LESSON.TUTOR.LEVEL'),
        qualitative: level,
        tone: 'neutral'
      });
    }
    chips.push({
      key: 'grammar',
      label: this.t('POST_LESSON.TUTOR.GRAMMAR'),
      qualitative: grammarQ.label,
      tone: grammarQ.tone
    });
    this.quickSummaryChips = chips;
  }
}

