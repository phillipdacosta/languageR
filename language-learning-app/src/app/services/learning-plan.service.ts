import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import { switchMap, take, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { UserService } from './user.service';

export interface LearningPlanPhase {
  title: string;
  description: string;
  focusAreas: string[];
  suggestedTopics: string[];
  exitCriteria: string;
  estimatedLessons: number;
  lessonsCompleted: number;
  lessonScores?: number[];
  masteryAverage?: number | null;
  status: 'locked' | 'active' | 'completed';
  completedAt?: string;
  /** Set the first time a student edits any field on this phase. */
  studentEditedAt?: string | null;
  /** True for both halves of a phase that was adaptively split (Batch 11). */
  _isSplit?: boolean;
  /** True for the remedial "fundamentals" phase inserted on demotion. */
  _isFundamentals?: boolean;
  /** True for a recovery (bridge) phase added when a chapter demotion lands
   *  the student on the previous chapter's last phase (Batch 13). Drives
   *  the recovery chip on the journey widget + callout on the journey
   *  page detail card. */
  _isRecovery?: boolean;
  /**
   * Coarse, *student-facing* progress state attached server-side. Hides
   * the raw mastery score and the 70 threshold so each lesson doesn't
   * feel like an exam. See backend masteryService.phaseProgressState.
   */
  progressState?: 'getting_started' | 'building' | 'progressing' | 'ready_soon' | 'wrapping_up';
  /** 0–100 visual cue for where the student sits in the lesson floor → ceiling window. */
  windowProgressPercent?: number;
}

export interface LearningPlanGoal {
  type: 'conversational' | 'exam_prep' | 'professional' | 'travel' | 'relocation' | 'other';
  description: string;
  targetLevel: string;
  timeline: string;
  timelinePressure: 'specific_date' | 'few_months' | 'no_rush';
  targetDate?: string;
}

export interface TutorOverride {
  tutorId: string;
  tutorName: string;
  date: string;
  action: 'extend_phase' | 'advance_phase' | 'skip_phase' | 'adjust_focus' | 'add_note';
  note: string;
}

export interface LearningPlan {
  _id: string;
  studentId: string;
  language: string;
  goal: LearningPlanGoal;
  selfAssessedLevel: string;
  currentPhaseIndex: number;
  phases: LearningPlanPhase[];
  weeklyRecommendations: {
    lessonFrequency: string;
    selfStudyMinutes: number;
    focusBetweenLessons: string;
  };
  studentSummary: string;
  nextLessonFocus: string;
  history: Array<{
    date: string;
    lessonId?: string;
    changeDescription: string;
    phaseIndexBefore: number | null;
    phaseIndexAfter: number | null;
    masteryAtAdvance?: number | null;
    reason?: string | null;
  }>;
  tutorOverrides: TutorOverride[];
  lastUpdatedAt: string;
  lastGoalChangedAt: string;
  status: 'draft' | 'active' | 'completed' | 'paused' | 'mastery_mode' | 'unframed';
  journeyIntroSeenAt?: string | null;
  /** Set when the plan went unframed; cleared on promote/resume. */
  unframedAt?: string | null;
  /** Set when the plan went paused; cleared on resume. */
  pausedAt?: string | null;
  /** Last time the student dismissed the "Want a plan?" prompt. */
  softPlanPromptDismissedAt?: string | null;
  /**
   * Soft-prompt eligibility envelope, attached server-side for unframed
   * and paused plans. Drives the post-lesson "Want a plan?" card.
   */
  softPlanPrompt?: {
    eligible: boolean;
    lessonsSince: number;
    dismissedAt: string | null;
  };

  // Chapter system (Batch 1+)
  chapterIndex?: number;
  chapterLevel?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  chapterTheme?: string;
  chaptersCompleted?: Array<{
    index: number;
    level: string;
    theme: string;
    phases: LearningPlanPhase[];
    completedAt: string;
    masteryAtCompletion: number | null;
    exitReason: 'graduated' | 'demoted' | 'calibrated' | 'recovery_graduated';
  }>;
  pendingTransitions?: {
    chapterJustCompleted?: boolean;
    chapterDemotionPending?: boolean;
    chapterPromotionPending?: boolean;
    masteryModeEntered?: boolean;
    decayWarning?: boolean;
    humanInterventionSuggested?: boolean;
    phaseSplit?: boolean;
    /** Strong "let's slow down and talk to your tutor" signal —
     *  set when pingPongCount ≥ 2 (Batch 13). Surfaces a dedicated
     *  card on the post-lesson recap. */
    recoveryStuck?: boolean;
    celebrationShownCount?: number;
  };

  /** Number of times the student has demoted out of the same chapter
   *  level in a row (Batch 13). 1 = nudge, 2+ = recoveryStuck. */
  pingPongCount?: number;
  /** Snapshot of the chapter level the student fell out of at the last
   *  demotion. Lets the next promotion detect bounce-back. */
  lastDemotedFromLevel?: CefrLevel | null;

  // CEFR estimation (Batch 12). See backend/services/cefrEstimatorService.js.
  internalCefrEstimate?: CefrEstimate | null;
  revealedCefrLevel?: CefrReveal | null;
  revealHistory?: CefrReveal[];
  pendingCefrReveal?: boolean;
  /** Server-provided scale visual: A1..C2 with `active` set on the revealed level. */
  cefrScale?: Array<{ level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'; active: boolean }>;
}

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface CefrEstimate {
  level: CefrLevel | null;
  numericLevel: number | null;
  confidence: number | null;
  agreement: 'high' | 'medium' | 'low' | null;
  sources: { ai: number; tutor: number };
  lessonsConsidered: number;
  computedAt: string;
}

export interface CefrDivergence {
  gap: number;                          // signed: tutorMean - aiMean
  aiLevel: CefrLevel;
  tutorLevel: CefrLevel;
  direction: 'tutor_higher' | 'ai_higher';
}

export interface CefrReveal {
  level: CefrLevel;
  numericLevel: number;
  confidence: number | null;
  agreement: 'high' | 'medium' | 'low';
  narrative: string;
  sources: { ai: number; tutor: number };
  lessonsAtReveal: number;
  trigger: 'first_milestone' | 'chapter_graduation' | 'monthly_refresh';
  revealedAt: string;
  divergence?: CefrDivergence | null;
}

export interface LearningPlanSummary {
  _id: string;
  language: string;
  status: string;
  goal: LearningPlanGoal;
  currentPhaseIndex: number;
  totalPhases: number;
  currentPhase: LearningPlanPhase | null;
  studentSummary: string;
  nextLessonFocus: string;
  nextLessonFocusSource?: 'tutor-lane' | 'plan' | 'none';
  nextLessonFocusTutor?: { id: string; name: string } | null;
  tutorOverrides: TutorOverride[];
  selfAssessedLevel: string;
}

export interface ClientEntitlements {
  tier: 'free' | 'premium';
  status: string;
  features: {
    adaptivePlanAi: boolean;
    goalChangeCooldownDays: number;
    materialRecommendationsPostLesson: boolean;
    dailyMicroTaskLimit: number | null;
  };
}

export interface AiRegenStatus {
  used: number;
  remaining: number;
  limit: number;
  nextAvailableAt: string | null;
}

export interface EditPermissions {
  canEditPhases: boolean;
  canReorderLockedPhases: boolean;
  canRegenWithAi: boolean;
  isPremium: boolean;
  regen: AiRegenStatus;
}

export interface PhaseEditUpdates {
  title?: string;
  description?: string;
  focusAreas?: string[];
  suggestedTopics?: string[];
}

export interface LessonPrepCorrectedExcerpt {
  context?: string;
  original: string;
  corrected: string;
  keyCorrections?: string[];
}

export interface LessonPrepTopError {
  rank?: number;
  issue: string;
  impact?: 'low' | 'medium' | 'high';
  occurrences?: number;
  teachingPriority?: string;
}

export interface LessonPrepErrorPattern {
  pattern: string;
  severity?: 'low' | 'medium' | 'high';
}

export interface LessonPrep {
  plan: {
    _id: string;
    language: string;
    status: string;
    goal: LearningPlanGoal;
    studentSummary: string;
    nextLessonFocus: string;
    currentPhaseIndex: number;
    totalPhases: number;
    currentPhase: {
      title: string;
      description: string;
      focusAreas: string[];
      suggestedTopics: string[];
      exitCriteria: string;
      lessonsCompleted: number;
      estimatedLessons: number;
      masteryAverage: number | null;
      lessonScores: number[];
      studentEditedAt?: string | null;
    } | null;
    tutorOverrides: TutorOverride[];
  } | null;
  latestAnalysis: {
    lessonId: string | null;
    lessonDate: string | null;
    proficiencyLevel: string;
    summary: string;
    topErrors: LessonPrepTopError[];
    errorPatterns: LessonPrepErrorPattern[];
    persistentChallenges: string[];
    proficiencyChange: 'improved' | 'maintained' | 'declined' | 'first_lesson' | null;
    areasForImprovement: string[];
    recommendedFocus: string[];
    correctedExcerpts: LessonPrepCorrectedExcerpt[];
  } | null;
  agenda: string[];
  /** 0 = first time the requesting tutor has taught this student in this language. */
  priorLessonCount?: number;
  firstTimePairing?: boolean;
  /** Anonymized first-name only — what other tutors have been working on. */
  otherTutorNotes?: Array<{ tutorFirstName: string; text: string; setAt: string }>;
}

export interface ComingUpItem {
  lessonId: string;
  startTime: string;
  duration: number | null;
  tutor: { id: string; firstName: string; name: string; picture: string };
  focus: string;
  /** True when this specific booking is a trial (per-tutor — a returning
   *  student gets `true` if it's their first lesson with *this* tutor). */
  isTrialLesson?: boolean;
}

export interface RecommendedMaterial {
  _id: string;
  title: string;
  description?: string;
  language: string;
  level: string;
  materialType: string;
  thumbnailUrl?: string;
  videoEmbedUrl?: string;
  audioEmbedUrl?: string;
  whyTakeThis?: string;
  pricingType?: 'free' | 'paid';
  price?: number;
  matchedStruggles: string[];
  tutorId?: { _id: string; firstName?: string; lastName?: string; name?: string; picture?: string };
}

export const GOAL_TYPE_LABELS: Record<string, string> = {
  conversational: 'Become conversational',
  exam_prep: 'Prepare for an exam',
  professional: 'Use it for work',
  travel: 'Travel and get by',
  relocation: 'Moving to a new country',
  other: 'Custom goal'
};

export const LEVEL_LABELS: Record<string, string> = {
  complete_beginner: 'Complete beginner',
  some_basics: 'I know some basics',
  simple_conversations: 'I can hold simple conversations',
  intermediate: "I'm intermediate, want to improve",
  advanced: "I'm advanced, refining skills"
};

@Injectable({
  providedIn: 'root'
})
export class LearningPlanService {
  private apiUrl = `${environment.backendUrl}/api/learning-plan`;

  /** Set to true once the journey-intro modal has been opened this app session.
   *  Prevents duplicate modals when both tab1 and journey.page react to the same unseen plan. */
  introModalShownThisSession = false;

  /** Set to true once the chapter-transition celebration modal has been
   *  opened this app session. Prevents duplicate modals when both tab1
   *  (home) and journey.page react to the same pendingTransitions flag. */
  chapterTransitionShownThisSession = false;

  /**
   * In-memory plan cache keyed by language. Populated by any `getPlan` call
   * so the journey page can render immediately from the cache instead of
   * waiting for a second network round-trip. The cache is intentionally
   * shallow (single session); invalidated by calls that mutate the plan
   * (editPhase, regenerateWithAi, ackTransition, etc.).
   */
  private planCache = new Map<string, { success: boolean; plan: LearningPlan; entitlements?: ClientEntitlements }>();

  /**
   * Broadcast lifecycle changes (pause / resume / skip / promote) so any
   * page already mounted with stale plan data — most notably the home tab
   * — can re-render without forcing the user to refresh.
   */
  private planUpdatesSubject = new Subject<{ language: string; plan: LearningPlan; entitlements?: ClientEntitlements }>();
  readonly planUpdates$ = this.planUpdatesSubject.asObservable();

  /** Expose the cached plan for a language so consumers can read it synchronously. */
  getCachedPlan(language: string) {
    return this.planCache.get(language) ?? null;
  }

  /** Invalidate the cache for a language (call after any plan-mutating operation). */
  invalidatePlanCache(language: string) {
    this.planCache.delete(language);
  }

  constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  getPlan(language: string): Observable<{ success: boolean; plan: LearningPlan; entitlements?: ClientEntitlements }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; plan: LearningPlan; entitlements?: ClientEntitlements }>(
          `${this.apiUrl}/${encodeURIComponent(language)}`,
          { headers }
        ).pipe(
          tap(res => { if (res?.success) this.planCache.set(language, res); })
        );
      })
    );
  }

  /**
   * Returns the cached plan immediately (as a synchronous Observable) if
   * available, and simultaneously triggers a background refresh so the
   * cache stays fresh. The journey page uses this when it was pre-mounted
   * hidden — it already has fresh data from tab1's load, so it renders
   * instantly from cache while the background refresh runs silently.
   */
  getPlanWithCache(language: string): Observable<{ success: boolean; plan: LearningPlan; entitlements?: ClientEntitlements }> {
    const cached = this.planCache.get(language);
    if (cached) {
      // Kick off a background refresh (don't await — caller already has data).
      this.getPlan(language).pipe(take(1)).subscribe({ error: () => {} });
      return of(cached);
    }
    return this.getPlan(language);
  }

  /**
   * Create a draft plan from the student's onboarding goal alone — no
   * trial lesson required. Idempotent: returns the existing plan if one
   * already exists for that language.
   */
  createInitialPlan(language?: string): Observable<{ success: boolean; plan: LearningPlan; created: boolean; entitlements?: ClientEntitlements }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; plan: LearningPlan; created: boolean; entitlements?: ClientEntitlements }>(
          `${this.apiUrl}/initial`,
          language ? { language } : {},
          { headers }
        );
      })
    );
  }

  getRecommendedMaterials(language: string): Observable<{ success: boolean; materials: RecommendedMaterial[]; updatedAt: string | null }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; materials: RecommendedMaterial[]; updatedAt: string | null }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/recommended-materials`,
          { headers }
        );
      })
    );
  }

  getStudentPlan(studentId: string, language: string): Observable<{ success: boolean; plan: LearningPlan }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; plan: LearningPlan }>(
          `${this.apiUrl}/student/${studentId}/${encodeURIComponent(language)}`,
          { headers }
        );
      })
    );
  }

  getStudentPlanSummary(
    studentId: string,
    tutorId?: string
  ): Observable<{ success: boolean; summaries: LearningPlanSummary[] }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        const url = tutorId
          ? `${this.apiUrl}/student/${studentId}/summary?tutorId=${encodeURIComponent(tutorId)}`
          : `${this.apiUrl}/student/${studentId}/summary`;
        return this.http.get<{ success: boolean; summaries: LearningPlanSummary[] }>(
          url,
          { headers }
        );
      })
    );
  }

  /**
   * One-shot pre-lesson briefing — returns plan summary + latest analysis
   * fields (top errors, persistent challenges, corrected excerpts) + a
   * deterministic 2–3-bullet agenda. Used by the tutor's event-details view.
   */
  getLessonPrep(studentId: string, language: string): Observable<{ success: boolean; prep: LessonPrep | null }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; prep: LessonPrep | null }>(
          `${this.apiUrl}/student/${studentId}/${encodeURIComponent(language)}/lesson-prep`,
          { headers }
        );
      })
    );
  }

  updateGoal(language: string, goal: Partial<LearningPlanGoal>): Observable<{ success: boolean; plan: LearningPlan }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.put<{ success: boolean; plan: LearningPlan }>(
          `${this.apiUrl}/goal`,
          { language, goal },
          { headers }
        );
      })
    );
  }

  submitTutorOverride(override: {
    studentId: string;
    language: string;
    action: string;
    note?: string;
  }): Observable<{ success: boolean; plan: LearningPlan }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; plan: LearningPlan }>(
          `${this.apiUrl}/tutor-override`,
          override,
          { headers }
        );
      })
    );
  }

  /** Edit-mode capability check. Drives UI gating + counters. */
  getEditPermissions(language: string): Observable<{ success: boolean; permissions: EditPermissions }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; permissions: EditPermissions }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/edit-permissions`,
          { headers }
        );
      })
    );
  }

  /** Student-driven edit of a single phase's text fields. */
  editPhase(language: string, phaseIndex: number, updates: PhaseEditUpdates): Observable<{ success: boolean; plan: LearningPlan }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.put<{ success: boolean; plan: LearningPlan }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/phase/${phaseIndex}`,
          updates,
          { headers }
        ).pipe(tap(res => this.broadcastPlanUpdate(language, res)));
      })
    );
  }

  /** Move a locked phase to a new position. */
  reorderPhases(language: string, fromIndex: number, toIndex: number): Observable<{ success: boolean; plan: LearningPlan }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; plan: LearningPlan }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/reorder-phases`,
          { fromIndex, toIndex },
          { headers }
        );
      })
    );
  }

  /** Upcoming lessons + each tutor's per-lane focus. */
  getComingUp(language: string): Observable<{ success: boolean; items: ComingUpItem[] }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<{ success: boolean; items: ComingUpItem[] }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/coming-up`,
          { headers }
        );
      })
    );
  }

  /** Acknowledge the latest CEFR reveal (clears the first-reveal modal / re-reveal toast). */
  ackCefrReveal(language: string): Observable<{ success: boolean }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/cefr-reveal/ack`,
          {},
          { headers }
        );
      })
    );
  }

  /**
   * Switch to "learn at your own pace" mode. Idempotent. Mutates the
   * server-side plan to status `unframed` and clears the cache so the
   * home + journey pages re-render the unframed treatment.
   */
  skipPlan(language: string): Observable<{ success: boolean; plan: LearningPlan; entitlements?: ClientEntitlements }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; plan: LearningPlan; entitlements?: ClientEntitlements }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/skip`,
          {},
          { headers }
        ).pipe(tap(res => this.broadcastPlanUpdate(language, res)));
      })
    );
  }

  /** Pause an active plan (preserves all state). */
  pausePlan(language: string): Observable<{ success: boolean; plan: LearningPlan; entitlements?: ClientEntitlements }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; plan: LearningPlan; entitlements?: ClientEntitlements }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/pause`,
          {},
          { headers }
        ).pipe(tap(res => this.broadcastPlanUpdate(language, res)));
      })
    );
  }

  /** Resume a paused plan. */
  resumePlan(language: string): Observable<{ success: boolean; plan: LearningPlan; entitlements?: ClientEntitlements }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; plan: LearningPlan; entitlements?: ClientEntitlements }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/resume`,
          {},
          { headers }
        ).pipe(tap(res => this.broadcastPlanUpdate(language, res)));
      })
    );
  }

  /** Promote an unframed plan into a structured plan with the supplied goal. */
  promoteUnframedPlan(language: string, goal: Partial<LearningPlanGoal>): Observable<{ success: boolean; plan: LearningPlan; entitlements?: ClientEntitlements }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; plan: LearningPlan; entitlements?: ClientEntitlements }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/promote`,
          { goal },
          { headers }
        ).pipe(tap(res => this.broadcastPlanUpdate(language, res)));
      })
    );
  }

  private broadcastPlanUpdate(
    language: string,
    res: { success: boolean; plan: LearningPlan; entitlements?: ClientEntitlements } | null | undefined
  ) {
    if (!res?.success || !res.plan) return;
    this.planCache.set(language, res);
    this.planUpdatesSubject.next({ language, plan: res.plan, entitlements: res.entitlements });
  }

  /** Throttle the "Want a plan?" soft prompt for the next 30 days. */
  dismissSoftPlanPrompt(language: string): Observable<{ success: boolean }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/soft-prompt/dismiss`,
          {},
          { headers }
        ).pipe(tap(() => this.invalidatePlanCache(language)));
      })
    );
  }

  /** Mark the post-onboarding intro sheet as seen (idempotent). */
  markIntroSeen(language: string): Observable<{ success: boolean; journeyIntroSeenAt: string | null }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; journeyIntroSeenAt: string | null }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/intro-seen`,
          {},
          { headers }
        );
      })
    );
  }

  /**
   * Premium pre-lesson warm-up (Batch 9). Returns null when not premium,
   * no upcoming lesson, or no usable focus signal.
   */
  getWarmup(language: string): Observable<{
    success: boolean;
    warmup: null | {
      lessonId: string;
      startsAt: string;
      focus: string;
      quiz: any;
      personalizedHeader: string;
    };
    reason?: string;
  }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<any>(
          `${this.apiUrl}/${encodeURIComponent(language)}/warmup`,
          { headers }
        );
      })
    );
  }

  /**
   * Past chapters (read-only history). Used by the "Past maps" view.
   */
  getChapterHistory(language: string): Observable<{
    success: boolean;
    currentChapter: { index: number; level: string; theme: string };
    completed: Array<{
      index: number;
      level: string;
      theme: string;
      completedAt: string;
      masteryAtCompletion: number | null;
      exitReason: 'graduated' | 'demoted' | 'calibrated';
      phaseTitles: string[];
    }>;
  }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<any>(
          `${this.apiUrl}/${encodeURIComponent(language)}/chapters`,
          { headers }
        );
      })
    );
  }

  /**
   * Plan audit log (last 200 entries, newest first). Used by the "Plan
   * history" timeline view.
   */
  getPlanHistory(language: string): Observable<{
    success: boolean;
    history: Array<{
      date: string;
      lessonId?: string;
      changeDescription: string;
      phaseIndexBefore: number | null;
      phaseIndexAfter: number | null;
      masteryAtAdvance: number | null;
      reason: string | null;
    }>;
  }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<any>(
          `${this.apiUrl}/${encodeURIComponent(language)}/history`,
          { headers }
        );
      })
    );
  }

  /**
   * Acknowledge a pending chapter transition flag once the student has seen
   * the celebration / demotion / mastery-mode modal. Clears the flag on the
   * server so subsequent GETs no longer see it (G33, G34).
   */
  ackTransition(
    language: string,
    flag:
      | 'chapterJustCompleted'
      | 'chapterDemotionPending'
      | 'chapterPromotionPending'
      | 'masteryModeEntered'
      | 'decayWarning'
      | 'humanInterventionSuggested'
      | 'phaseSplit'
      | 'recoveryStuck'
  ): Observable<{ success: boolean; pendingTransitions: NonNullable<LearningPlan['pendingTransitions']> }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; pendingTransitions: NonNullable<LearningPlan['pendingTransitions']> }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/ack-transition`,
          { flag },
          { headers }
        ).pipe(tap(res => {
          // Update the cached plan's pendingTransitions in place so a
          // subsequent getPlanWithCache doesn't return a stale flag and
          // re-fire (e.g. journey-page toast after post-lesson recap ack).
          const cached = this.planCache.get(language);
          if (cached?.plan && res?.pendingTransitions) {
            cached.plan.pendingTransitions = { ...cached.plan.pendingTransitions, ...res.pendingTransitions };
          }
        }));
      })
    );
  }

  /** Premium-only AI regeneration. Server returns { plan, regen }. */
  regenerateWithAi(language: string, reason?: string): Observable<{ success: boolean; plan: LearningPlan; regen: AiRegenStatus }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; plan: LearningPlan; regen: AiRegenStatus }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/regenerate-ai`,
          { reason: reason || '' },
          { headers }
        ).pipe(tap(() => this.invalidatePlanCache(language)));
      })
    );
  }

  /**
   * Mastery Mode weekly micro-challenge (Batch 13). Returns the active
   * challenge for the student, or `{ challenge: null }` if not eligible
   * or none yet available.
   */
  getMasteryWeekly(language: string): Observable<MasteryWeeklyResponse> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.get<MasteryWeeklyResponse>(
          `${this.apiUrl}/${encodeURIComponent(language)}/mastery-weekly`,
          { headers }
        );
      })
    );
  }

  /**
   * Premium-only conversational plan editing (Batch 12).
   * Sends the chat history; returns AI reply + optional proposed edits
   * for the current chapter. Does NOT mutate the plan server-side.
   */
  chatProposeEdits(
    language: string,
    messages: ChatTurn[]
  ): Observable<{ success: boolean; reply: string; proposedEdits: ProposedChapterEdits; regen: AiRegenStatus }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{
          success: boolean;
          reply: string;
          proposedEdits: ProposedChapterEdits;
          regen: AiRegenStatus;
        }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/chat`,
          { messages },
          { headers }
        );
      })
    );
  }

  /**
   * Apply previously-proposed conversational edits. Costs one AI
   * regeneration credit. Server returns the updated plan + regen status.
   */
  chatApplyEdits(
    language: string,
    phases: ProposedPhase[],
    summary?: string
  ): Observable<{ success: boolean; plan: LearningPlan; regen: AiRegenStatus }> {
    return this.userService.getCurrentUser().pipe(
      take(1),
      switchMap(() => {
        const headers = this.userService.getAuthHeadersSync();
        return this.http.post<{ success: boolean; plan: LearningPlan; regen: AiRegenStatus }>(
          `${this.apiUrl}/${encodeURIComponent(language)}/chat/apply`,
          { phases, summary: summary || '' },
          { headers }
        );
      })
    );
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProposedPhase {
  title: string;
  description: string;
  focusAreas: string[];
  suggestedTopics: string[];
  exitCriteria: string;
  estimatedLessons: number;
}

export interface ProposedChapterEdits {
  summary: string;
  phases: ProposedPhase[] | null;
}

export interface MasteryWeeklyChallenge {
  quizId: string;
  theme: string;
  pushedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  rating: number;
  personalizedHeader: string;
  quiz: any;
}

export interface MasteryWeeklyResponse {
  success: boolean;
  challenge: MasteryWeeklyChallenge | null;
  reason?: string;
  nextEligibleAt?: string | null;
}
