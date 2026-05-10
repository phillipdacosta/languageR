import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy, Input, Output, EventEmitter, HostBinding } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { take, Subscription } from 'rxjs';

import { JourneyWidgetComponent } from '../components/home/journey-widget.component';
import { ReviewDeckService } from '../services/review-deck.service';
import {
  LearningPlanService,
  LearningPlan,
  LearningPlanPhase,
  RecommendedMaterial,
  ClientEntitlements,
  EditPermissions,
  AiRegenStatus,
  ComingUpItem,
  CefrReveal
} from '../services/learning-plan.service';
import { UserService } from '../services/user.service';
import { FormsModule } from '@angular/forms';
import { AlertController, ToastController, ModalController } from '@ionic/angular';
import { JourneyIntroComponent } from './journey-intro.component';
import { ChapterCompleteModalComponent } from './chapter-complete-modal/chapter-complete-modal.component';
import { PastMapsModalComponent } from './past-maps/past-maps-modal.component';
import { PlanHistoryModalComponent } from './plan-history/plan-history-modal.component';
import { PlanChatModalComponent } from './plan-chat-modal/plan-chat-modal.component';
import { MasteryWeeklyChallenge } from '../services/learning-plan.service';
import { environment } from '../../environments/environment';

interface PhaseRow {
  index: number;
  title: string;
  description: string;
  focusAreas: string[];
  exitCriteria: string;
  status: 'completed' | 'active' | 'locked';
  lessonsCompleted: number;
  estimatedLessons: number;
  // Mastery (0–100) — null if no lessons yet for this phase. Kept for
  // internal reasoning (CTA picking, etc.) but never shown to the student.
  masteryAverage: number | null;
  // Where the student is in the soft min→max-lessons window for this phase.
  // Used to render a non-misleading progress hint while mastery is the gate.
  windowProgressPercent: number;
  // Coarse server-attached state — drives the qualitative pill copy.
  // See backend masteryService.phaseProgressState. Hides raw score + threshold.
  progressState: 'getting_started' | 'building' | 'progressing' | 'ready_soon' | 'wrapping_up' | null;
  // Localised pill label derived from `progressState`. Computed once in TS.
  progressStateLabel: string;
  expanded: boolean;
  // Edit-mode local state (not persisted until Save).
  editing: boolean;
  saving: boolean;
  draftTitle: string;
  draftDescription: string;
  draftFocusAreasText: string; // newline-separated
  // True for both halves of a phase that was adaptively split. Drives the
  // "✂ split" annotation on the roadmap node + the explainer in the
  // detail card. (Phase 2 of the better-than-toast UX work — see
  // docs/learning-journey/scenarios.md.)
  isSplit: boolean;
  // True for a recovery (bridge) phase — the last phase of the previous
  // chapter the student was placed onto after a decay-driven demotion
  // (Batch 13). Drives a soft framing on the journey UI ("you've got this,
  // we're getting you back to {nextLevel}") and a chip on the node.
  isRecovery: boolean;
  // Title of the immediately preceding phase. Surfaced on locked-phase
  // preview cards as "Continues from {previousPhaseTitle}" so the student
  // is anchored in *where they are now*. Empty string for phase 0.
  previousPhaseTitle: string;
}

interface MapNode {
  index: number;
  xPct: number; // 0–100, left % on the canvas
  yPct: number; // 0–100, top % on the canvas
  // Where the label sits relative to the dot. Default 'above' matches the
  // canonical winding-path UX, but flips to 'below' when the node is
  // close to the top edge so the label can never overflow the canvas.
  labelPlacement: 'above' | 'below';
  // Horizontal anchoring of the label relative to the dot. Center is the
  // default; flips to start/end when the node is near the canvas edge so
  // the (max-width 92px) label can't escape the canvas sideways.
  labelAlign: 'start' | 'center' | 'end';
  row: PhaseRow;
}

// Safe-zone thresholds for label placement. Values are in canvas-percent.
// Pulled out as constants so the layout logic is auditable in one place.
const LABEL_FLIP_TOP_THRESHOLD = 22;     // yPct < this → label below the dot
const LABEL_FLIP_BOTTOM_THRESHOLD = 88;  // yPct > this → label above (already default)
const LABEL_EDGE_LEFT_THRESHOLD = 14;    // xPct < this → label anchored to the left of the dot
const LABEL_EDGE_RIGHT_THRESHOLD = 86;   // xPct > this → label anchored to the right of the dot

// Mirrors backend masteryService floor/ceiling. Used only as a fallback
// for the progress bar fill when an older payload doesn't include the
// server-attached `windowProgressPercent`. The 70 mastery threshold is
// deliberately not mirrored here — student-facing UI never shows it.
const MIN_LESSONS_PER_PHASE = 3;
const MAX_LESSONS_PER_PHASE = 10;

@Component({
  selector: 'app-journey-page',
  templateUrl: './journey.page.html',
  styleUrls: ['./journey.page.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule,
    TranslateModule,
    JourneyWidgetComponent
  ]
})
export class JourneyPage implements OnInit, OnDestroy {
  /** When true, the page is rendered inline inside another container (tab1
   *  home) instead of as a standalone route. Mirrors the earnings page's
   *  inline mode so the FLIP animation can short-hop between the home CTA
   *  and the inline panel's own back link. */
  @Input() @HostBinding('class.inline') inline = false;
  /** Emitted instead of router.back() when running inline, so the host can
   *  drive the reverse FLIP animation. */
  @Output() goBackEvent = new EventEmitter<void>();

  loading = true;
  language = '';
  plan: LearningPlan | null = null;
  entitlements: ClientEntitlements | null = null;

  // CEFR estimate (Batch 12). Server hides these fields until the student
  // has crossed the milestone reveal threshold (5 lessons or chapter graduation).
  cefrScale: Array<{ level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'; active: boolean }> | null = null;
  revealedCefrLevel: CefrReveal | null = null;
  cefrAgreementLabel = '';

  // Widget bindings (full variant)
  widgetState: 'loading' | 'empty-goal' | 'draft' | 'active' | 'completed' = 'loading';
  phaseLabels: string[] = [];
  currentPhaseIndex = 0;
  phaseTitle = '';
  summary = '';
  nextLessonFocus = '';
  goalLabel = '';

  // Roadmap
  phaseRows: PhaseRow[] = [];
  // The single phase whose detail card is currently shown (null = none).
  selectedRow: PhaseRow | null = null;

  // Scenic winding-path map
  mapNodes: MapNode[] = [];
  mapPathD = '';
  // Toggled off → on around `applyPlan` so the path SVG remounts and its
  // CSS draw-in animation replays each time the chapter changes.
  pathReady = true;

  // Static preview shown in the empty state — gives a sense of structure
  // before the student commits to a goal. Localized via i18n.
  emptyPreviewPhases: string[] = [];

  // Recommendations (free tier)
  recommendedMaterials: RecommendedMaterial[] = [];
  recommendedUpdatedAt: string | null = null;
  showRecommendations = false;

  // Coming Up — upcoming lessons + each tutor's per-lane focus.
  // Surfaced on the journey page so the student can see what each
  // tutor will work on next, then tap to open the lesson detail.
  comingUp: Array<ComingUpItem & { dateLabel: string; timeLabel: string }> = [];

  isPremium = false;
  goalChangeCooldownDays = 7;

  // Edit-mode permissions. Loaded alongside the plan; refreshed after
  // each AI regeneration so the counter stays accurate.
  permissions: EditPermissions | null = null;
  regen: AiRegenStatus | null = null;
  regenTooltip = '';

  // Smart adaptive primary CTA — bottom-right of the journey-widget hero.
  // Recomputed whenever plan, comingUp, or due-card data changes so the most
  // relevant next-action is always one tap away. Mirrors the iOS Wallet
  // "primary action adapts to state" pattern.
  primaryCtaLabel = '';
  primaryCtaSubLabel = '';
  primaryCtaIcon = 'arrow-forward-outline';
  practiceDueCount = 0;
  private primaryCtaRoute: any[] | null = null;
  private primaryCtaQueryParams: any = null;

  private subs: Subscription[] = [];

  constructor(
    private learningPlanService: LearningPlanService,
    private userService: UserService,
    private reviewDeckService: ReviewDeckService,
    private router: Router,
    private location: Location,
    private translate: TranslateService,
    private cdr: ChangeDetectorRef,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private modalCtrl: ModalController
  ) {}

  ngOnInit() {
    this.emptyPreviewPhases = [
      this.translate.instant('JOURNEY.EMPTY_PREVIEW_P1'),
      this.translate.instant('JOURNEY.EMPTY_PREVIEW_P2'),
      this.translate.instant('JOURNEY.EMPTY_PREVIEW_P3'),
      this.translate.instant('JOURNEY.EMPTY_PREVIEW_P4')
    ];

    const sub = this.userService.getCurrentUser().pipe(take(1)).subscribe(user => {
      const lang = user?.onboardingData?.languages?.[0];
      if (!lang) {
        this.widgetState = 'empty-goal';
        this.loading = false;
        this.cdr.markForCheck();
        return;
      }
      this.language = lang;
      this.loadPlan();
    });
    this.subs.push(sub);
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  goBack() {
    // Inline mode: let the host (tab1) drive the reverse FLIP animation.
    if (this.inline) {
      this.goBackEvent.emit();
      return;
    }
    if (window.history.length > 1) {
      this.location.back();
    } else {
      this.router.navigate(['/tabs/home']);
    }
  }

  togglePhase(i: number) {
    const row = this.phaseRows[i];
    if (!row) return;
    const wasExpanded = row.expanded;
    // Collapse all rows first.
    this.phaseRows.forEach(r => { r.expanded = false; });
    if (!wasExpanded) {
      row.expanded = true;
      this.selectedRow = row;
    } else {
      this.selectedRow = null;
    }
    this.cdr.markForCheck();
  }

  navigateToMaterial(materialId: string) {
    this.router.navigate(['/material', materialId]);
  }

  openSetGoalFlow() {
    this.router.navigate(['/tabs/profile'], { queryParams: { editGoal: '1' } });
  }

  goToUpgrade() {
    this.router.navigate(['/tabs/home/upgrade']);
  }

  /**
   * Open the "Your roadmap is ready" intro sheet.
   *
   * @param markSeen — if true, persist that the student has now seen it
   *                   so we don't auto-open again. The "Why this plan?"
   *                   link passes false, since we want it re-openable
   *                   on demand without resetting any state.
   */
  async openIntroSheet(markSeen = false) {
    // Prevent opening a second copy if one is already visible.
    const existing = await this.modalCtrl.getTop();
    if (existing?.classList.contains('journey-intro-modal')) return;

    const modal = await this.modalCtrl.create({
      component: JourneyIntroComponent,
      componentProps: {
        phaseLabels: this.phaseLabels,
        plan: this.plan,
        language: this.language,
        calledFromHome: false
      },
      cssClass: 'journey-intro-modal'
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    const reason: 'done' | 'edit' | 'skip' = data?.reason || 'skip';

    if (markSeen && this.language) {
      const sub = this.learningPlanService.markIntroSeen(this.language).pipe(take(1)).subscribe({
        next: () => { /* fire and forget */ },
        error: () => { /* non-fatal */ }
      });
      this.subs.push(sub);
    }

    if (reason === 'edit') {
      // Open edit mode on the active phase. Falls back to the first
      // editable phase if none is active.
      const active = this.phaseRows.find(r => r.status === 'active') ||
                     this.phaseRows.find(r => r.status === 'locked');
      if (active) {
        // Wait one tick so the modal close animation finishes first.
        setTimeout(() => this.startEdit(active), 200);
      }
    }
  }

  trackByPhase(_i: number, row: PhaseRow) { return row.index; }
  trackByMapNode(_i: number, node: MapNode) { return node.index; }
  trackByMaterial(_i: number, mat: RecommendedMaterial) { return mat._id; }

  // ── Internal ────────────────────────────────────────────────────

  private loadPlan() {
    this.loading = true;
    this.widgetState = 'loading';
    this.cdr.markForCheck();

    // Use cache-first path so the journey page renders instantly when
    // tab1 has already loaded the plan (pre-mount scenario). Falls back
    // to a network call if the cache is cold (standalone navigation).
    const sub = this.learningPlanService.getPlanWithCache(this.language).pipe(take(1)).subscribe({
      next: (res: any) => {
        if (res?.success && res.plan) {
          this.applyPlan(res.plan, res.entitlements || null);
          this.maybeLoadRecommendations();
          this.loadComingUp();
        } else {
          this.attemptDraftCreation();
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        if (err?.status === 404) {
          this.attemptDraftCreation();
        } else {
          this.widgetState = 'empty-goal';
        }
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
    this.subs.push(sub);
  }

  private attemptDraftCreation() {
    const sub = this.learningPlanService.createInitialPlan(this.language).pipe(take(1)).subscribe({
      next: (res: any) => {
        if (res?.success && res.plan) {
          this.applyPlan(res.plan, res.entitlements || null);
          this.maybeLoadRecommendations();
          this.loadComingUp();
        } else {
          this.widgetState = 'empty-goal';
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.widgetState = 'empty-goal';
        this.cdr.markForCheck();
      }
    });
    this.subs.push(sub);
  }

  private applyPlan(plan: LearningPlan, entitlements: ClientEntitlements | null) {
    this.plan = plan;
    this.entitlements = entitlements;
    this.isPremium = entitlements?.tier === 'premium';
    this.goalChangeCooldownDays = entitlements?.features?.goalChangeCooldownDays ?? 7;

    const phases = plan.phases || [];
    const idx = plan.currentPhaseIndex || 0;
    this.currentPhaseIndex = idx;

    this.phaseLabels = phases.map(p => p.title || '');
    const activePhase = phases[idx];
    this.phaseTitle = activePhase?.title || '';
    this.summary = plan.studentSummary || '';
    this.nextLessonFocus = plan.nextLessonFocus || '';
    this.goalLabel = plan.goal?.description
      || this.translate.instant('LEARNING_PLAN.GOAL_LABEL_' + ((plan.goal?.type || 'OTHER').toUpperCase()))
      || '';

    if (plan.status === 'completed') this.widgetState = 'completed';
    else if (plan.status === 'draft') this.widgetState = 'draft';
    else this.widgetState = 'active';

    // Mastery Mode (Batch 13). Post-C2 endgame — fetch this week's
    // micro-challenge whenever we apply a mastery_mode plan.
    this.isMasteryMode = plan.status === 'mastery_mode';
    if (this.isMasteryMode) {
      this.loadMasteryWeekly();
    } else {
      this.masteryChallenge = null;
      this.masteryNextEligibleLabel = '';
      this.masteryChallengeThemeLabel = '';
    }

    // Resolve chapter theme from the plan. Drives both the background image
    // and the per-theme waypoint set used to place nodes on the road.
    this.chapterTheme = (plan as any).chapterTheme || 'a1-desert';
    this.chapterLevel = (plan as any).chapterLevel || 'A1';
    this.chapterIndex = (plan as any).chapterIndex || 0;
    this.backgroundUrl = `assets/journey-backgrounds/${this.chapterTheme}.png`;
    this.backgroundFailed = false;

    // Re-pick the smart CTA now that plan + phaseTitle + nextLessonFocus
    // are populated. Will be re-run again when comingUp / practiceDue arrive.
    this.recomputePrimaryCta();

    this.phaseRows = phases.map((p: LearningPlanPhase, i: number) => {
      const target = p.estimatedLessons || 5;
      const done = p.lessonsCompleted || 0;
      const mastery = (p.masteryAverage === null || p.masteryAverage === undefined) ? null : p.masteryAverage;
      const previousPhaseTitle = i > 0 ? (phases[i - 1].title || '') : '';

      // Server-attached `windowProgressPercent` is the source of truth.
      // Fallback computes the same shape locally so old payloads still render.
      let windowProgressPercent = (p as any).windowProgressPercent;
      if (windowProgressPercent === undefined || windowProgressPercent === null) {
        windowProgressPercent = 0;
        if (done > 0 && done <= MIN_LESSONS_PER_PHASE) {
          windowProgressPercent = Math.round((done / MIN_LESSONS_PER_PHASE) * 50);
        } else if (done > MIN_LESSONS_PER_PHASE) {
          const extra = Math.min(done - MIN_LESSONS_PER_PHASE, MAX_LESSONS_PER_PHASE - MIN_LESSONS_PER_PHASE);
          windowProgressPercent = 50 + Math.round((extra / (MAX_LESSONS_PER_PHASE - MIN_LESSONS_PER_PHASE)) * 50);
        }
      }

      // Server-attached state. We never render raw mastery numbers or the
      // 70 threshold; the qualitative pill is the only progress signal.
      const progressState = (p.status === 'completed' ? null : ((p as any).progressState || null)) as PhaseRow['progressState'];
      const progressStateLabel = progressState
        ? this.translate.instant(this.PROGRESS_STATE_KEY[progressState])
        : '';

      return {
        index: i,
        title: p.title || `Phase ${i + 1}`,
        description: p.description || '',
        focusAreas: p.focusAreas || [],
        exitCriteria: p.exitCriteria || '',
        status: (p.status as any) || 'locked',
        lessonsCompleted: done,
        estimatedLessons: target,
        masteryAverage: mastery,
        windowProgressPercent,
        progressState,
        progressStateLabel,
        expanded: i === idx,
        editing: false,
        saving: false,
        draftTitle: '',
        draftDescription: '',
        draftFocusAreasText: '',
        isSplit: !!p._isSplit,
        isRecovery: !!p._isRecovery,
        previousPhaseTitle
      };
    });

    this.computeMapNodes();

    // Auto-select the active phase so the detail card shows on load.
    this.selectedRow = this.phaseRows.find(r => r.expanded) || null;

    // Refresh edit permissions whenever the plan changes — new regen
    // counts, new ownership, etc.
    this.loadEditPermissions();

    // Pre-fetch background for the next chapter so cross-fade is smooth.
    if (this.chapterIndex < 5) {
      const nextThemes = ['a1-desert','a2-coast','b1-lake','b2-snow','c1-cherry','c2-tuscany'];
      this.prefetchBackground(nextThemes[this.chapterIndex + 1]);
    }

    // CEFR scale + revealed level (Batch 12). Server hides these fields
    // until the student has crossed the reveal threshold.
    this.cefrScale = (plan as any).cefrScale || null;
    this.revealedCefrLevel = (plan as any).revealedCefrLevel || null;
    this.cefrAgreementLabel = this.computeCefrAgreementLabel();
    if ((plan as any).pendingCefrReveal && this.revealedCefrLevel) {
      this.maybeHandleCefrReveal(this.revealedCefrLevel);
    }

    // Pending transition flags drive the celebration / demotion modal.
    // Live-page rule: when the user is already on the journey page, we
    // surface a non-blocking toast instead of blocking with a modal.
    this.maybeHandlePendingTransitions(plan);
  }

  private computeCefrAgreementLabel(): string {
    const a = this.revealedCefrLevel?.agreement;
    if (!a) return '';
    if (a === 'high') return this.translate.instant('JOURNEY.CEFR.AGREEMENT_HIGH');
    if (a === 'medium') return this.translate.instant('JOURNEY.CEFR.AGREEMENT_MEDIUM');
    return this.translate.instant('JOURNEY.CEFR.AGREEMENT_LOW');
  }

  /**
   * Open the CEFR details alert (sources, narrative, agreement explanation).
   * Tapping the chip in the journey header. Read-only — no actions.
   */
  async openCefrDetails() {
    if (!this.revealedCefrLevel) return;
    const r = this.revealedCefrLevel;
    const sources = `${r.sources?.ai || 0} AI · ${r.sources?.tutor || 0} ${this.translate.instant('JOURNEY.CEFR.TUTOR_PLURAL')}`;
    const agreementCopy =
      r.agreement === 'high'   ? this.translate.instant('JOURNEY.CEFR.AGREEMENT_HIGH_LONG') :
      r.agreement === 'medium' ? this.translate.instant('JOURNEY.CEFR.AGREEMENT_MEDIUM_LONG') :
                                 this.translate.instant('JOURNEY.CEFR.AGREEMENT_LOW_LONG');
    const divergenceBlock = r.divergence ? `
      <div style="margin:12px 0 0;padding:10px 12px;background:#fff7e6;border:1px solid #f9d18a;border-radius:10px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#5a3d00;">${this.translate.instant('JOURNEY.CEFR.DIVERGENCE_TITLE')}</p>
        <p style="margin:0;font-size:13px;line-height:1.5;color:#5a3d00;">${this.translate.instant('JOURNEY.CEFR.DIVERGENCE_BODY', { aiLevel: r.divergence.aiLevel, tutorLevel: r.divergence.tutorLevel })}</p>
      </div>
    ` : '';
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('JOURNEY.CEFR.MODAL_TITLE', { level: r.level }),
      cssClass: 'cefr-details-alert',
      message: `
        <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">${r.narrative || ''}</p>
        <p style="margin:0 0 8px;font-size:13px;color:#666;">
          <strong>${this.translate.instant('JOURNEY.CEFR.BASED_ON')}:</strong> ${sources}
        </p>
        <p style="margin:0;font-size:13px;color:#666;">
          <strong>${this.translate.instant('JOURNEY.CEFR.AGREEMENT_LABEL')}:</strong> ${agreementCopy}
        </p>
        ${divergenceBlock}
      `,
      buttons: [{ text: this.translate.instant('COMMON.GOT_IT') || 'Got it', role: 'cancel' }]
    });
    await alert.present();
  }

  // CEFR reveal display routing — first reveal opens an alert; subsequent
  // re-reveals (chapter graduation, monthly refresh) show a less-intrusive
  // toast. Calls the ack endpoint either way.
  private cefrRevealShown = false;
  private async maybeHandleCefrReveal(reveal: CefrReveal) {
    if (this.cefrRevealShown) return;
    this.cefrRevealShown = true;

    const isFirst = reveal.trigger === 'first_milestone';
    if (isFirst) {
      const sources = `${reveal.sources?.ai || 0} AI · ${reveal.sources?.tutor || 0} ${this.translate.instant('JOURNEY.CEFR.TUTOR_PLURAL')}`;
      const alert = await this.alertCtrl.create({
        header: this.translate.instant('JOURNEY.CEFR.REVEAL_TITLE', { level: reveal.level }),
        cssClass: 'cefr-reveal-alert',
        message: `
          <p style="margin:0 0 12px;font-size:15.5px;line-height:1.55;">${reveal.narrative || ''}</p>
          <p style="margin:0;font-size:13px;color:#717171;">${sources}</p>
        `,
        buttons: [{
          text: this.translate.instant('JOURNEY.CEFR.REVEAL_DISMISS'),
          role: 'cancel'
        }]
      });
      await alert.present();
    } else {
      this.presentToast(
        this.translate.instant('JOURNEY.CEFR.REVEAL_TITLE', { level: reveal.level }),
        'success',
        5000
      );
    }

    // Ack so it doesn't fire again on next page load.
    if (this.language) {
      this.learningPlanService.ackCefrReveal(this.language).pipe(take(1)).subscribe({
        next: () => {},
        error: () => {}
      });
    }
  }

  /**
   * If the plan has a pending chapter transition (graduation / demotion /
   * mastery / promotion / decay warning), surface the right UI.
   *
   * Modal vs toast routing:
   *   - Decay warning → always a toast (non-blocking, soft signal G15).
   *   - Chapter transitions → modal IF the user just landed on this page
   *     (first applyPlan), otherwise toast (G33 live-page rule).
   *
   * After display, POST /ack-transition so it doesn't fire again on next
   * load (G33: max 3 displays before auto-dismiss).
   */
  private chapterTransitionShown = false;
  private async maybeHandlePendingTransitions(plan: LearningPlan) {
    const flags = plan.pendingTransitions || {};

    // Decay warning is always a toast.
    if (flags.decayWarning && !this.decayWarningShown) {
      this.decayWarningShown = true;
      this.presentToast(
        this.translate.instant('JOURNEY.DECAY_WARNING_TOAST'),
        'warning'
      );
      this.ackTransitionFlag('decayWarning');
      return;
    }

    if (flags.humanInterventionSuggested && !this.humanInterventionShown) {
      this.humanInterventionShown = true;
      this.presentToast(
        this.translate.instant('JOURNEY.HUMAN_INTERVENTION_TOAST'),
        'medium',
        6000
      );
      this.ackTransitionFlag('humanInterventionSuggested');
      return;
    }

    // Adaptive phase split (Batch 11). Polite, one-time toast.
    if (flags.phaseSplit && !this.phaseSplitShown) {
      this.phaseSplitShown = true;
      this.presentToast(
        this.translate.instant('JOURNEY.PHASE_SPLIT_TOAST'),
        'tertiary',
        6000
      );
      this.ackTransitionFlag('phaseSplit');
      return;
    }

    // Chapter transitions: figure out which one fired.
    let mode: 'graduated' | 'demoted' | 'mastery_mode' | 'promoted' | null = null;
    if (flags.masteryModeEntered) mode = 'mastery_mode';
    else if (flags.chapterJustCompleted) mode = 'graduated';
    else if (flags.chapterPromotionPending) mode = 'promoted';
    else if (flags.chapterDemotionPending) mode = 'demoted';

    if (!mode) return;
    if (this.chapterTransitionShown) return;
    // Home page (tab1) takes precedence — if it already showed this session,
    // skip here. Otherwise claim the slot so home doesn't double-fire.
    if (this.learningPlanService.chapterTransitionShownThisSession) {
      this.chapterTransitionShown = true;
      return;
    }
    this.chapterTransitionShown = true;
    this.learningPlanService.chapterTransitionShownThisSession = true;

    // Live-page rule: if this is a refresh on the journey page (not the
    // initial landing from elsewhere), prefer toast.
    if (this.suppressTransitionModal) {
      this.presentToast(
        this.translate.instant('JOURNEY.CHAPTER_COMPLETE.LIVE_TOAST_' + mode.toUpperCase()),
        mode === 'demoted' ? 'medium' : 'success'
      );
      this.ackTransitionFlagForMode(mode);
      return;
    }

    // Find prior chapter snapshot for richer UI (level transition arrow).
    const lastCompleted = (plan.chaptersCompleted || []).slice(-1)[0];
    const fromLevel = lastCompleted?.level || null;
    const toLevel = plan.chapterLevel || null;

    const modal = await this.modalCtrl.create({
      component: ChapterCompleteModalComponent,
      cssClass: 'chapter-complete-modal',
      backdropDismiss: false,
      componentProps: {
        mode,
        fromLevel,
        toLevel,
        masteryAtCompletion: lastCompleted?.masteryAtCompletion ?? null,
        lessonsCompleted: lastCompleted
          ? (lastCompleted.phases || []).reduce((s, p) => s + (p.lessonsCompleted || 0), 0)
          : null
      }
    });
    await modal.present();
    await modal.onDidDismiss();
    this.ackTransitionFlagForMode(mode);
    // After ack, future visits to this page should suppress the modal.
    this.suppressTransitionModal = true;
  }

  private ackTransitionFlagForMode(mode: 'graduated' | 'demoted' | 'mastery_mode' | 'promoted') {
    const flag =
      mode === 'graduated'    ? 'chapterJustCompleted' :
      mode === 'demoted'      ? 'chapterDemotionPending' :
      mode === 'mastery_mode' ? 'masteryModeEntered' :
      /* promoted */            'chapterPromotionPending';
    this.ackTransitionFlag(flag as any);
  }

  private ackTransitionFlag(
    flag: 'chapterJustCompleted' | 'chapterDemotionPending' | 'chapterPromotionPending' | 'masteryModeEntered' | 'decayWarning' | 'humanInterventionSuggested' | 'phaseSplit'
  ) {
    if (!this.language) return;
    const sub = this.learningPlanService.ackTransition(this.language, flag).pipe(take(1)).subscribe({
      next: () => { /* fire and forget */ },
      error: () => { /* non-fatal */ }
    });
    this.subs.push(sub);
  }

  private async presentToast(message: string, color: string = 'medium', duration = 4000) {
    const toast = await this.toastCtrl.create({
      message,
      duration,
      color,
      position: 'top',
      buttons: [{ text: 'OK', role: 'cancel' }]
    });
    await toast.present();
  }

  // ── Past Maps + Plan History (Batch 6) ───────────────────────────

  /** Snapshot of the live chapter so we can restore after a "visit". */
  private liveChapterSnapshot: { theme: string; level: string; index: number; backgroundUrl: string; backgroundFailed: boolean } | null = null;
  visitingChapter: { index: number; level: string; theme: string } | null = null;

  async openPastMaps() {
    if (!this.language) return;
    const modal = await this.modalCtrl.create({
      component: PastMapsModalComponent,
      cssClass: 'past-maps-modal',
      componentProps: { language: this.language }
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data?.visit) this.startVisitingChapter(data.visit);
  }

  async openPlanHistory() {
    if (!this.language) return;
    const modal = await this.modalCtrl.create({
      component: PlanHistoryModalComponent,
      cssClass: 'plan-history-modal',
      componentProps: { language: this.language }
    });
    await modal.present();
  }

  // ── Mastery Mode (Batch 13) ─────────────────────────────────────
  isMasteryMode = false;
  masteryChallenge: MasteryWeeklyChallenge | null = null;
  masteryNextEligibleLabel = '';
  masteryChallengeThemeLabel = '';

  private loadMasteryWeekly() {
    if (!this.language) return;
    const sub = this.learningPlanService.getMasteryWeekly(this.language)
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          this.masteryChallenge = res.challenge || null;
          this.masteryChallengeThemeLabel = this.masteryChallenge
            ? this.themeLabel(this.masteryChallenge.theme)
            : '';
          if (res.nextEligibleAt) {
            const next = new Date(res.nextEligibleAt);
            this.masteryNextEligibleLabel = next.toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'short',
              day: 'numeric'
            });
          } else {
            this.masteryNextEligibleLabel = '';
          }
          this.cdr.markForCheck();
        },
        error: (err) => {
          console.warn('[Mastery] Failed to load weekly challenge:', err?.error?.message || err);
          this.masteryChallenge = null;
          this.cdr.markForCheck();
        }
      });
    this.subs.push(sub);
  }

  private themeLabel(theme: string): string {
    if (!theme) return '';
    return theme
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  openMasteryChallenge() {
    if (!this.masteryChallenge?.quizId) return;
    // The standalone quiz player route is built alongside the warm-up
    // experience (see HOME.WARMUP). For now, fall through to the same
    // placeholder pattern: surface a toast acknowledging the action so
    // the page still feels alive when the user taps the CTA.
    this.presentToast(
      this.translate.instant('JOURNEY.MASTERY.STARTED_TOAST', {
        theme: this.masteryChallengeThemeLabel
      }),
      'success'
    );
  }

  /**
   * Adaptive-split deep explainer (Phase 2 of the better-than-toast UX).
   * Opens a deeper alert when the student taps "Why?" on the inline
   * callout in the detail card. Read-only — purely educational.
   */
  async openSplitExplainer(ev?: Event) {
    if (ev) { ev.stopPropagation(); }
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('JOURNEY.SPLIT.MODAL_TITLE'),
      cssClass: 'jpcd-split-alert',
      message: `
        <p style="margin:0 0 12px;font-size:14.5px;line-height:1.55;color:#222;">
          ${this.translate.instant('JOURNEY.SPLIT.MODAL_BODY_1')}
        </p>
        <p style="margin:0 0 12px;font-size:14.5px;line-height:1.55;color:#222;">
          ${this.translate.instant('JOURNEY.SPLIT.MODAL_BODY_2')}
        </p>
        <p style="margin:0;font-size:13px;line-height:1.5;color:#717171;">
          ${this.translate.instant('JOURNEY.SPLIT.MODAL_FOOTNOTE')}
        </p>
      `,
      buttons: [{ text: this.translate.instant('COMMON.GOT_IT') || 'Got it', role: 'cancel' }]
    });
    await alert.present();
  }

  /**
   * "How do I move on?" disclosure for the active phase. Honest about
   * cadence, deliberately vague about the exact mastery threshold so
   * the journey doesn't read like a test. Read-only / educational.
   */
  async openProgressionExplainer(ev?: Event) {
    if (ev) { ev.stopPropagation(); }
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('JOURNEY.PROGRESSION.MODAL_TITLE'),
      cssClass: 'jpcd-progression-alert',
      message: `
        <p style="margin:0 0 12px;font-size:14.5px;line-height:1.55;color:#222;">
          ${this.translate.instant('JOURNEY.PROGRESSION.MODAL_BODY_1')}
        </p>
        <p style="margin:0 0 12px;font-size:14.5px;line-height:1.55;color:#222;">
          ${this.translate.instant('JOURNEY.PROGRESSION.MODAL_BODY_2')}
        </p>
        <p style="margin:0;font-size:13px;line-height:1.5;color:#717171;">
          ${this.translate.instant('JOURNEY.PROGRESSION.MODAL_FOOTNOTE')}
        </p>
      `,
      buttons: [{ text: this.translate.instant('COMMON.GOT_IT') || 'Got it', role: 'cancel' }]
    });
    await alert.present();
  }

  /**
   * Conversational plan editing (Batch 12). Premium-only — gated by
   * `canChatEdit` which the template binds against entitlements.
   */
  async openPlanChat() {
    if (!this.language || !this.plan) return;
    const modal = await this.modalCtrl.create({
      component: PlanChatModalComponent,
      cssClass: 'plan-chat-modal',
      componentProps: { language: this.language, plan: this.plan }
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data?.applied && data.plan) {
      this.applyPlan(data.plan, this.entitlements);
      this.presentToast(
        this.translate.instant('JOURNEY.CHAT.APPLIED_TOAST'),
        'success'
      );
    }
  }

  // ── Replay latest milestone (graduation / mastery) ────────────
  // Lets the student re-open the celebration message any time they
  // want to recall the moment. Reads chaptersCompleted; falls back
  // to a fake "graduated" entry for mastery_mode plans.

  get hasCelebrationToReplay(): boolean {
    if (!this.plan) return false;
    if (this.plan.status === 'mastery_mode') return true;
    return Array.isArray(this.plan.chaptersCompleted) && this.plan.chaptersCompleted.length > 0;
  }

  async replayLatestCelebration() {
    if (!this.plan) return;
    const completed = this.plan.chaptersCompleted || [];
    const last = completed[completed.length - 1];

    let mode: 'graduated' | 'demoted' | 'mastery_mode' | 'promoted' = 'graduated';
    let fromLevel: string | null = null;
    let toLevel: string | null = this.plan.chapterLevel || null;
    let masteryAtCompletion: number | null = null;
    let lessonsCompleted: number | null = null;

    if (this.plan.status === 'mastery_mode') {
      mode = 'mastery_mode';
      fromLevel = 'C1';
      toLevel = 'C2';
    } else if (last) {
      mode = (last.exitReason === 'demoted' ? 'demoted'
            : last.exitReason === 'calibrated' ? 'promoted'
            : 'graduated');
      fromLevel = last.level || null;
      toLevel = this.plan.chapterLevel || null;
      masteryAtCompletion = last.masteryAtCompletion ?? null;
      lessonsCompleted = (last.phases || []).reduce(
        (s: number, p: any) => s + (p.lessonsCompleted || 0), 0) || null;
    }

    const modal = await this.modalCtrl.create({
      component: ChapterCompleteModalComponent,
      cssClass: 'chapter-complete-modal',
      componentProps: { mode, fromLevel, toLevel, masteryAtCompletion, lessonsCompleted }
    });
    await modal.present();
  }

  // ── Dev-only celebration preview ────────────────────────────────
  // Lets QA see chapter graduation / demotion / mastery / promotion
  // modals + the background cross-fade without manipulating the DB.
  // Hidden in production builds.

  isDev = !environment.production;

  private static readonly THEME_BY_LEVEL: { [k: string]: string } = {
    A1: 'a1-desert',
    A2: 'a2-coast',
    B1: 'b1-lake',
    B2: 'b2-snow',
    C1: 'c1-cherry',
    C2: 'c2-tuscany'
  };
  private static readonly NEXT_LEVEL: { [k: string]: string } = {
    A1: 'A2', A2: 'B1', B1: 'B2', B2: 'C1', C1: 'C2', C2: 'C2'
  };
  private static readonly PREV_LEVEL: { [k: string]: string } = {
    A1: 'A1', A2: 'A1', B1: 'A2', B2: 'B1', C1: 'B2', C2: 'C1'
  };

  // Server-attached `progressState` → i18n key. Keeps the qualitative
  // pill copy out of the template (no template function calls) and easy
  // to translate. The student never sees the underlying mastery score
  // or the 70 threshold — only this label.
  readonly PROGRESS_STATE_KEY: { [k: string]: string } = {
    getting_started: 'JOURNEY.PROGRESS_STATE.GETTING_STARTED',
    building:        'JOURNEY.PROGRESS_STATE.BUILDING',
    progressing:     'JOURNEY.PROGRESS_STATE.PROGRESSING',
    ready_soon:      'JOURNEY.PROGRESS_STATE.READY_SOON',
    wrapping_up:     'JOURNEY.PROGRESS_STATE.WRAPPING_UP'
  };

  async openDevPreview() {
    if (!this.isDev) return;
    const alert = await this.alertCtrl.create({
      header: 'Preview transition',
      subHeader: 'Local-only — does NOT touch the DB',
      cssClass: 'journey-dev-preview-alert',
      inputs: [
        { type: 'radio', label: 'Chapter graduated (A1 → A2)', value: 'graduated', checked: true },
        { type: 'radio', label: 'Chapter promoted (calibration)', value: 'promoted' },
        { type: 'radio', label: 'Chapter demoted (decay)', value: 'demoted' },
        { type: 'radio', label: 'Mastery Mode entered (post-C2)', value: 'mastery_mode' },
        { type: 'radio', label: 'Phase split (visual on map)', value: 'phase_split_visual' },
        { type: 'radio', label: 'Phase split toast', value: 'phase_split' },
        { type: 'radio', label: 'Decay warning toast', value: 'decay' },
        { type: 'radio', label: 'Human intervention toast', value: 'human' }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Preview',
          handler: (mode: string) => { void this.runDevPreview(mode); }
        }
      ]
    });
    await alert.present();
  }

  private async runDevPreview(mode: string) {
    if (mode === 'phase_split') {
      this.presentToast(this.translate.instant('JOURNEY.PHASE_SPLIT_TOAST'), 'tertiary', 6000);
      return;
    }
    if (mode === 'decay') {
      this.presentToast(this.translate.instant('JOURNEY.DECAY_WARNING_TOAST'), 'warning');
      return;
    }
    if (mode === 'human') {
      this.presentToast(this.translate.instant('JOURNEY.HUMAN_INTERVENTION_TOAST'), 'medium', 6000);
      return;
    }
    if (mode === 'phase_split_visual') {
      this.previewPhaseSplit();
      return;
    }

    // Compute a believable from/to level pair for the chosen mode.
    const currentLevel = this.chapterLevel || 'A1';
    let fromLevel = currentLevel;
    let toLevel = currentLevel;
    let nextTheme = this.chapterTheme;
    let nextChapterIndex = this.chapterIndex;

    if (mode === 'graduated' || mode === 'promoted') {
      fromLevel = currentLevel;
      toLevel = JourneyPage.NEXT_LEVEL[currentLevel] || currentLevel;
      nextTheme = JourneyPage.THEME_BY_LEVEL[toLevel] || this.chapterTheme;
      nextChapterIndex = this.chapterIndex + (toLevel !== currentLevel ? 1 : 0);
    } else if (mode === 'demoted') {
      fromLevel = currentLevel;
      toLevel = JourneyPage.PREV_LEVEL[currentLevel] || currentLevel;
      nextTheme = JourneyPage.THEME_BY_LEVEL[toLevel] || this.chapterTheme;
      nextChapterIndex = Math.max(0, this.chapterIndex - 1);
    } else if (mode === 'mastery_mode') {
      fromLevel = 'C1';
      toLevel = 'C2';
      nextTheme = 'c2-tuscany';
      nextChapterIndex = 5;
    }

    const modal = await this.modalCtrl.create({
      component: ChapterCompleteModalComponent,
      cssClass: 'chapter-complete-modal',
      backdropDismiss: false,
      componentProps: {
        mode,
        fromLevel,
        toLevel,
        masteryAtCompletion: 84,
        lessonsCompleted: 18
      }
    });
    await modal.present();
    await modal.onDidDismiss();

    // Trigger the background cross-fade by swapping in the new theme.
    // We restore the live values after 4s so QA can re-trigger without
    // the journey page looking permanently confused.
    const prev = {
      theme: this.chapterTheme,
      level: this.chapterLevel,
      index: this.chapterIndex,
      url: this.backgroundUrl
    };
    this.chapterTheme = nextTheme;
    this.chapterLevel = toLevel;
    this.chapterIndex = nextChapterIndex;
    this.backgroundUrl = `assets/journey-backgrounds/${nextTheme}.png`;
    this.backgroundFailed = false;
    // Rebuild the winding path for the new theme — this also remounts the
    // SVG so the per-chapter draw-in animation replays.
    this.computeMapNodes();
    this.cdr.markForCheck();

    setTimeout(() => {
      this.chapterTheme = prev.theme;
      this.chapterLevel = prev.level;
      this.chapterIndex = prev.index;
      this.backgroundUrl = prev.url;
      this.computeMapNodes();
      this.cdr.markForCheck();
      this.presentToast('Preview ended — reverted to live chapter.', 'medium', 2500);
    }, 4500);
  }

  /**
   * Dev-only: visually preview the adaptive phase-split UI on the live
   * roadmap. Picks the active phase (or the first one if none active),
   * replaces it in-place with two halves marked `isSplit: true`, rebuilds
   * the map nodes, opens the detail card on the new "Part 1", and reverts
   * after 8 seconds. Local-only — does NOT touch the DB. See:
   * `_maybeSplitPhase` in backend/services/learningPlanService.js for the
   * production path.
   */
  private previewPhaseSplit() {
    if (!this.phaseRows.length) {
      this.presentToast('No phases on the roadmap to split.', 'warning');
      return;
    }
    const targetIdx = Math.max(0, this.phaseRows.findIndex(r => r.status === 'active'));
    const original = this.phaseRows[targetIdx];
    const snapshot = this.phaseRows.map(r => ({ ...r }));
    const prevSelectedIdx = this.selectedRow?.index ?? targetIdx;

    const baseTitle = original.title.replace(/\s*\(Part [12]\)$/i, '');
    const halfA: PhaseRow = {
      ...original,
      title: `${baseTitle} (Part 1)`,
      isSplit: true,
      status: original.status === 'completed' ? 'completed' : 'active',
      expanded: true
    };
    const halfB: PhaseRow = {
      ...original,
      index: original.index + 1,
      title: `${baseTitle} (Part 2)`,
      isSplit: true,
      status: 'locked',
      lessonsCompleted: 0,
      masteryAverage: null,
      windowProgressPercent: 0,
      progressState: null,
      progressStateLabel: '',
      expanded: false,
      previousPhaseTitle: `${baseTitle} (Part 1)`
    };

    const next: PhaseRow[] = [];
    for (let i = 0; i < this.phaseRows.length; i++) {
      const row = this.phaseRows[i];
      if (i === targetIdx) {
        next.push(halfA, halfB);
      } else if (i > targetIdx) {
        next.push({ ...row, index: row.index + 1, expanded: false });
      } else {
        next.push({ ...row, expanded: false });
      }
    }
    this.phaseRows = next;
    this.selectedRow = halfA;
    this.computeMapNodes();
    this.cdr.markForCheck();

    this.presentToast(
      'Preview: phase split — badge on map node + callout in card. Reverting in 8s.',
      'tertiary',
      3000
    );

    setTimeout(() => {
      this.phaseRows = snapshot;
      this.selectedRow = this.phaseRows[prevSelectedIdx] || null;
      if (this.selectedRow) this.selectedRow.expanded = true;
      this.computeMapNodes();
      this.cdr.markForCheck();
      this.presentToast('Preview ended — reverted to live phases.', 'medium', 2500);
    }, 8000);
  }

  private startVisitingChapter(c: { index: number; level: string; theme: string; phaseTitles?: string[] }) {
    if (!this.liveChapterSnapshot) {
      this.liveChapterSnapshot = {
        theme: this.chapterTheme,
        level: this.chapterLevel,
        index: this.chapterIndex,
        backgroundUrl: this.backgroundUrl,
        backgroundFailed: this.backgroundFailed
      };
    }
    this.visitingChapter = { index: c.index, level: c.level, theme: c.theme };
    this.chapterTheme = c.theme;
    this.chapterLevel = c.level;
    this.chapterIndex = c.index;
    this.backgroundUrl = `assets/journey-backgrounds/${c.theme}.png`;
    this.backgroundFailed = false;
    // Replace map nodes with the visited chapter's titles (read-only).
    if (Array.isArray(c.phaseTitles) && c.phaseTitles.length) {
      this.phaseRows = c.phaseTitles.map((title, i) => ({
        index: i,
        title: title || `Phase ${i + 1}`,
        description: '',
        focusAreas: [],
        exitCriteria: '',
        status: 'completed' as const,
        lessonsCompleted: 0,
        estimatedLessons: 0,
        masteryAverage: null,
        windowProgressPercent: 100,
        progressState: null,
        progressStateLabel: '',
        expanded: false,
        editing: false,
        saving: false,
        draftTitle: '',
        draftDescription: '',
        draftFocusAreasText: '',
        isSplit: false,
        isRecovery: false,
        previousPhaseTitle: i > 0 ? (c.phaseTitles![i - 1] || '') : ''
      }));
    }
    // Always rebuild — chapter theme changed, so the path needs a redraw.
    this.computeMapNodes();
    this.cdr.markForCheck();
  }

  exitVisitingChapter() {
    if (!this.liveChapterSnapshot) return;
    this.chapterTheme = this.liveChapterSnapshot.theme;
    this.chapterLevel = this.liveChapterSnapshot.level;
    this.chapterIndex = this.liveChapterSnapshot.index;
    this.backgroundUrl = this.liveChapterSnapshot.backgroundUrl;
    this.backgroundFailed = this.liveChapterSnapshot.backgroundFailed;
    this.liveChapterSnapshot = null;
    this.visitingChapter = null;
    // Reload the live plan to restore phaseRows.
    if (this.plan) this.applyPlan(this.plan, this.entitlements);
    this.cdr.markForCheck();
  }

  // Waypoints per chapter theme. Each background's road has different curves,
  // so each theme owns its own set of (x%, y%) points. Nodes are sampled
  // along these curves. Falls back to a generic gentle curve if a theme
  // doesn't yet have hand-tuned waypoints.
  // Waypoints per chapter theme. Each chapter gets a *visibly* distinct
  // winding path — different overall shape, different y-amplitude, and
  // different start/end heights — so flipping between chapters is an
  // obvious change, not a subtle one. Y range used: 25 (top) → 95 (bottom).
  private static readonly THEME_PATH_PTS: { [theme: string]: Array<{ x: number; y: number }> } = {
    // A1 — flat foothill: nearly straight gentle slope across the bottom.
    //      Beginner-friendly: low energy, no surprises.
    'a1-desert': [
      { x:  4, y: 78 },
      { x: 28, y: 82 },
      { x: 52, y: 88 },
      { x: 76, y: 80 },
      { x: 96, y: 72 }
    ],
    // A2 — steep coastal climb: clear left-low-to-right-high diagonal.
    //      "You're climbing now" reads at a glance.
    'a2-coast': [
      { x:  4, y: 92 },
      { x: 30, y: 76 },
      { x: 56, y: 56 },
      { x: 78, y: 40 },
      { x: 96, y: 28 }
    ],
    // B1 — pronounced S-curve: deep valley → peak → valley.
    //      Clearly snake-like, distinct from A2's straight climb.
    'b1-lake': [
      { x:  4, y: 50 },
      { x: 22, y: 88 },
      { x: 48, y: 50 },
      { x: 74, y: 88 },
      { x: 96, y: 50 }
    ],
    // B2 — sharp alpine zigzag: pointy peaks/troughs (six waypoints).
    //      Reads as switchback / mountain trail.
    'b2-snow': [
      { x:  4, y: 88 },
      { x: 22, y: 38 },
      { x: 38, y: 78 },
      { x: 56, y: 32 },
      { x: 76, y: 78 },
      { x: 96, y: 36 }
    ],
    // C1 — deep central valley: starts and ends high, plunges low in
    //      the middle. Inverted "U" — distinct from C2's arch.
    'c1-cherry': [
      { x:  4, y: 38 },
      { x: 26, y: 62 },
      { x: 50, y: 90 },
      { x: 74, y: 62 },
      { x: 96, y: 38 }
    ],
    // C2 — sweeping mountain arc: low → high → low (true arch).
    //      Mirror image of C1 for nice visual symmetry across mastery.
    'c2-tuscany': [
      { x:  4, y: 88 },
      { x: 26, y: 62 },
      { x: 50, y: 30 },
      { x: 74, y: 62 },
      { x: 96, y: 88 }
    ]
  };

  private static readonly DEFAULT_PATH_PTS = [
    { x:  5, y: 72 }, { x: 25, y: 60 }, { x: 45, y: 75 },
    { x: 65, y: 55 }, { x: 85, y: 70 }
  ];

  // Resolved at applyPlan() time from plan.chapterTheme.
  chapterTheme = 'a1-desert';
  chapterLevel = 'A1';
  chapterIndex = 0;
  // Background asset path. Built from chapterTheme; falls back to a gradient
  // when image fails to load (G35) — handled in template via (error).
  backgroundUrl = 'assets/journey-backgrounds/a1-desert.png';
  backgroundFailed = false;

  // ── Pending transition state (Batch 4) ──────────────────────────────
  // Tracks whether we already showed the corresponding transition this
  // session — prevents duplicate modals/toasts on plan refresh.
  private decayWarningShown = false;
  private humanInterventionShown = false;
  private phaseSplitShown = false;
  // After we display the chapter modal once, subsequent applyPlan() calls
  // (e.g. polling refreshes) should suppress and use a toast instead. This
  // is the live-page rule (G33).
  private suppressTransitionModal = false;

  private sampleJourneyPath(t: number): { x: number; y: number } {
    const pts = JourneyPage.THEME_PATH_PTS[this.chapterTheme] || JourneyPage.DEFAULT_PATH_PTS;
    if (t <= 0) return pts[0];
    if (t >= 1) return pts[pts.length - 1];
    const raw = (pts.length - 1) * t;
    const i = Math.floor(raw);
    const f = raw - i;
    return {
      x: pts[i].x + (pts[i + 1].x - pts[i].x) * f,
      y: pts[i].y + (pts[i + 1].y - pts[i].y) * f
    };
  }

  private computeMapNodes() {
    const rows = this.phaseRows;
    const n = rows.length;
    if (n === 0) { this.mapNodes = []; this.mapPathD = ''; return; }

    this.mapNodes = rows.map((row, i) => {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const pt = this.sampleJourneyPath(t);
      // Choose label placement so it never escapes the canvas. The canonical
      // position is above the dot; flip below when the node is in the top
      // safe-zone. Horizontal alignment defaults to centered; anchors to a
      // side when the node is near a canvas edge.
      const labelPlacement: 'above' | 'below' =
        pt.y < LABEL_FLIP_TOP_THRESHOLD ? 'below' : 'above';
      const labelAlign: 'start' | 'center' | 'end' =
        pt.x < LABEL_EDGE_LEFT_THRESHOLD ? 'start' :
        pt.x > LABEL_EDGE_RIGHT_THRESHOLD ? 'end' :
        'center';
      return { index: i, xPct: pt.x, yPct: pt.y, labelPlacement, labelAlign, row };
    });

    const nextD = this.buildSvgPathD();
    if (nextD !== this.mapPathD) {
      // Remount the SVG so its CSS draw-in animation replays.
      this.mapPathD = nextD;
      this.pathReady = false;
      // requestAnimationFrame ensures the *ngIf=false reaches the DOM
      // before we flip back to true — guarantees re-creation.
      requestAnimationFrame(() => {
        this.pathReady = true;
        this.cdr.markForCheck();
      });
    }
  }

  /** Build a smooth winding SVG path string from the active theme's
   *  waypoints using a Catmull-Rom → cubic-Bezier conversion. The path
   *  is drawn in the same 100×100 viewBox as the map canvas so node
   *  positions and the path stay perfectly in sync. */
  private buildSvgPathD(): string {
    const pts = JourneyPage.THEME_PATH_PTS[this.chapterTheme] || JourneyPage.DEFAULT_PATH_PTS;
    if (pts.length < 2) return '';
    const tension = 0.5; // 0.5 ≈ Catmull-Rom; lower = tighter curve
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) * (tension / 3);
      const c1y = p1.y + (p2.y - p0.y) * (tension / 3);
      const c2x = p2.x - (p3.x - p1.x) * (tension / 3);
      const c2y = p2.y - (p3.y - p1.y) * (tension / 3);
      d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  /** Pre-fetch the next chapter's background so the cross-fade in Batch 4
   *  doesn't flash an unloaded image. Cheap, idempotent. */
  private prefetchBackground(theme: string) {
    if (!theme) return;
    const img = new Image();
    img.src = `assets/journey-backgrounds/${theme}.png`;
  }

  /** Called from template (img error) when a background asset 404s.
   *  Sets a class so the SCSS gradient fallback shows (G35). */
  onBackgroundError() {
    this.backgroundFailed = true;
    this.cdr.markForCheck();
  }

  // ── Edit mode ────────────────────────────────────────────────────

  private loadEditPermissions() {
    if (!this.language) return;
    const sub = this.learningPlanService.getEditPermissions(this.language).pipe(take(1)).subscribe({
      next: (res) => {
        if (res?.success) {
          this.permissions = res.permissions;
          this.regen = res.permissions.regen;
          this.regenTooltip = this.buildRegenTooltip(res.permissions);
          this.cdr.markForCheck();
        }
      },
      error: () => { /* fail soft — edit UI stays hidden */ }
    });
    this.subs.push(sub);
  }

  private buildRegenTooltip(perms: EditPermissions): string {
    if (!perms.isPremium) {
      return this.translate.instant('JOURNEY.EDIT.AI_LOCKED_FREE');
    }
    if (perms.regen.remaining > 0) {
      return this.translate.instant('JOURNEY.EDIT.AI_REMAINING', { count: perms.regen.remaining });
    }
    return this.translate.instant('JOURNEY.EDIT.AI_LIMIT_REACHED');
  }

  startEdit(row: PhaseRow, event?: Event) {
    event?.stopPropagation();
    if (row.status === 'completed') return;
    if (!this.permissions?.canEditPhases) return;
    row.draftTitle = row.title;
    row.draftDescription = row.description;
    row.draftFocusAreasText = (row.focusAreas || []).join('\n');
    row.editing = true;
    row.expanded = true;
    this.cdr.markForCheck();
  }

  cancelEdit(row: PhaseRow, event?: Event) {
    event?.stopPropagation();
    row.editing = false;
    this.cdr.markForCheck();
  }

  saveEdit(row: PhaseRow, event?: Event) {
    event?.stopPropagation();
    const title = (row.draftTitle || '').trim();
    if (!title) {
      this.showToast(this.translate.instant('JOURNEY.EDIT.TITLE_REQUIRED'), 'warning');
      return;
    }
    const focusAreas = (row.draftFocusAreasText || '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);

    row.saving = true;
    this.cdr.markForCheck();

    const sub = this.learningPlanService.editPhase(this.language, row.index, {
      title,
      description: (row.draftDescription || '').trim(),
      focusAreas
    }).pipe(take(1)).subscribe({
      next: (res) => {
        if (res?.success && res.plan) {
          this.applyPlan(res.plan, this.entitlements);
          this.showToast(this.translate.instant('JOURNEY.EDIT.SAVED'), 'success');
        }
        row.saving = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        row.saving = false;
        this.showToast(err?.error?.message || this.translate.instant('JOURNEY.EDIT.SAVE_FAILED'), 'danger');
        this.cdr.markForCheck();
      }
    });
    this.subs.push(sub);
  }

  async askAiToRegenerate(event?: Event) {
    event?.stopPropagation();
    if (!this.permissions?.canRegenWithAi) {
      // Free user → nudge to upgrade. Premium with no quota → show why.
      const message = this.permissions?.isPremium
        ? this.translate.instant('JOURNEY.EDIT.AI_LIMIT_REACHED_LONG')
        : this.translate.instant('JOURNEY.EDIT.AI_LOCKED_FREE_LONG');
      const alert = await this.alertCtrl.create({
        header: this.translate.instant('JOURNEY.EDIT.AI_TITLE'),
        message,
        buttons: this.permissions?.isPremium
          ? [{ text: this.translate.instant('COMMON.OK'), role: 'cancel' }]
          : [
              { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
              { text: this.translate.instant('JOURNEY.EDIT.AI_GO_PREMIUM'), handler: () => this.goToUpgrade() }
            ]
      });
      await alert.present();
      return;
    }

    const remaining = this.permissions.regen.remaining;
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('JOURNEY.EDIT.AI_TITLE'),
      message: this.translate.instant('JOURNEY.EDIT.AI_PROMPT_BODY', { count: remaining }),
      inputs: [{
        name: 'reason',
        type: 'textarea',
        placeholder: this.translate.instant('JOURNEY.EDIT.AI_REASON_PLACEHOLDER'),
        attributes: { maxlength: 400 }
      }],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('JOURNEY.EDIT.AI_CONFIRM'),
          handler: (data) => {
            this.performAiRegen(data?.reason || '');
          }
        }
      ]
    });
    await alert.present();
  }

  private performAiRegen(reason: string) {
    this.loading = true;
    this.cdr.markForCheck();

    const sub = this.learningPlanService.regenerateWithAi(this.language, reason).pipe(take(1)).subscribe({
      next: (res) => {
        if (res?.success && res.plan) {
          this.applyPlan(res.plan, this.entitlements);
          this.showToast(this.translate.instant('JOURNEY.EDIT.AI_DONE'), 'success');
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loading = false;
        const msg = err?.status === 429
          ? this.translate.instant('JOURNEY.EDIT.AI_LIMIT_REACHED')
          : (err?.error?.message || this.translate.instant('JOURNEY.EDIT.AI_FAILED'));
        this.showToast(msg, 'danger');
        this.cdr.markForCheck();
      }
    });
    this.subs.push(sub);
  }

  private async showToast(message: string, color: 'success' | 'warning' | 'danger') {
    const t = await this.toastCtrl.create({
      message,
      duration: 2400,
      position: 'bottom',
      color
    });
    await t.present();
  }

  private loadComingUp() {
    if (!this.language) return;
    const sub = this.learningPlanService.getComingUp(this.language).pipe(take(1)).subscribe({
      next: (res) => {
        if (res?.success && Array.isArray(res.items)) {
          this.comingUp = res.items.map(it => {
            const d = new Date(it.startTime);
            return {
              ...it,
              dateLabel: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
              timeLabel: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
            };
          });
          this.recomputePrimaryCta();
          this.cdr.markForCheck();
        }
        // Practice deck is loaded after comingUp so the CTA can prefer
        // upcoming-lesson signals when both apply.
        this.loadPracticeDueCount();
      },
      error: () => {
        this.comingUp = [];
        this.loadPracticeDueCount();
      }
    });
    this.subs.push(sub);
  }

  private loadPracticeDueCount() {
    const sub = this.reviewDeckService.getNeedsReviewCount(this.language).pipe(take(1)).subscribe({
      next: (res) => {
        this.practiceDueCount = res?.count || 0;
        this.recomputePrimaryCta();
        this.cdr.markForCheck();
      },
      error: () => {
        this.practiceDueCount = 0;
        this.recomputePrimaryCta();
        this.cdr.markForCheck();
      }
    });
    this.subs.push(sub);
  }

  /**
   * Smart adaptive primary CTA — picks the single most-relevant next action
   * for the student based on their current state. Mirrors how iOS Wallet's
   * primary card-action button changes by context.
   *
   * Priority order:
   *   1. Upcoming lesson within 24h     → "Open next lesson"
   *   2. Has review cards due           → "Practice now · X cards due"
   *   3. Plan exists, no lessons yet    → "Book your first lesson"
   *   4. Default (active learner)       → "Find a tutor"
   */
  private recomputePrimaryCta() {
    if (this.widgetState === 'loading' || this.widgetState === 'empty-goal') {
      this.primaryCtaLabel = '';
      this.primaryCtaSubLabel = '';
      this.primaryCtaIcon = '';
      this.primaryCtaRoute = null;
      this.primaryCtaQueryParams = null;
      return;
    }

    const now = Date.now();
    const next = this.comingUp[0];
    const nextStartMs = next ? new Date(next.startTime).getTime() : 0;
    const within24h = next && nextStartMs > now && (nextStartMs - now) <= 24 * 60 * 60 * 1000;

    if (next && within24h) {
      this.primaryCtaLabel = this.translate.instant('JOURNEY.CTA_OPEN_NEXT_LESSON');
      this.primaryCtaSubLabel = `${next.dateLabel} · ${next.timeLabel}`;
      this.primaryCtaIcon = 'play-circle-outline';
      this.primaryCtaRoute = ['/tabs/lessons', next.lessonId];
      this.primaryCtaQueryParams = null;
      return;
    }

    if (this.practiceDueCount > 0) {
      this.primaryCtaLabel = this.translate.instant('JOURNEY.CTA_PRACTICE_NOW');
      this.primaryCtaSubLabel = this.translate.instant('JOURNEY.CTA_PRACTICE_DUE', { count: this.practiceDueCount });
      this.primaryCtaIcon = 'flash-outline';
      this.primaryCtaRoute = ['/review-deck'];
      this.primaryCtaQueryParams = null;
      return;
    }

    const totalLessonsDone = (this.plan?.phases || []).reduce((sum, p: any) => sum + (p.lessonsCompleted || 0), 0);
    if (totalLessonsDone === 0) {
      this.primaryCtaLabel = this.translate.instant('JOURNEY.CTA_BOOK_FIRST');
      this.primaryCtaSubLabel = this.translate.instant('JOURNEY.CTA_BOOK_FIRST_SUB');
      this.primaryCtaIcon = '';
      this.primaryCtaRoute = ['/tabs/tutor-search'];
      this.primaryCtaQueryParams = null;
      return;
    }

    this.primaryCtaLabel = this.translate.instant('JOURNEY.CTA_FIND_TUTOR');
    this.primaryCtaSubLabel = this.nextLessonFocus
      ? this.translate.instant('JOURNEY.CTA_FIND_TUTOR_SUB')
      : '';
    this.primaryCtaIcon = 'search-outline';
    this.primaryCtaRoute = ['/tabs/tutor-search'];
    this.primaryCtaQueryParams = null;
  }

  /** Triggered by the bottom-right pill on the journey-widget hero. */
  onPrimaryCtaTap() {
    if (!this.primaryCtaRoute) return;
    if (this.primaryCtaQueryParams) {
      this.router.navigate(this.primaryCtaRoute, { queryParams: this.primaryCtaQueryParams });
    } else {
      this.router.navigate(this.primaryCtaRoute);
    }
  }

  openComingUpLesson(item: ComingUpItem) {
    this.router.navigate(['/tabs/lessons', item.lessonId]);
  }

  trackByComingUp(_i: number, it: ComingUpItem) { return it.lessonId; }

  private maybeLoadRecommendations() {
    // Recommendations are a baseline student feature — both tiers get them.
    const eligible = this.entitlements?.features?.materialRecommendationsPostLesson;
    if (!eligible || !this.language) {
      this.showRecommendations = false;
      return;
    }
    const sub = this.learningPlanService.getRecommendedMaterials(this.language).pipe(take(1)).subscribe({
      next: (res) => {
        if (res?.success && Array.isArray(res.materials)) {
          this.recommendedMaterials = res.materials;
          this.recommendedUpdatedAt = res.updatedAt || null;
          this.showRecommendations = res.materials.length > 0;
          this.cdr.markForCheck();
        }
      },
      error: () => { this.showRecommendations = false; }
    });
    this.subs.push(sub);
  }
}
