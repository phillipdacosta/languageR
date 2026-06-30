import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy, Input, Output, EventEmitter, HostBinding, ElementRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { take, Subscription, firstValueFrom } from 'rxjs';

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
  CefrReveal,
  RoadblockQuiz,
  RoadblockResponse
} from '../services/learning-plan.service';
import { UserService } from '../services/user.service';
import { FormsModule } from '@angular/forms';
import { AlertController, ModalController, AnimationController } from '@ionic/angular';
import { ToastService } from '../services/toast.service';
import { JourneyIntroComponent } from './journey-intro.component';
import { ChapterCompleteModalComponent } from './chapter-complete-modal/chapter-complete-modal.component';
import { PastMapsModalComponent } from './past-maps/past-maps-modal.component';
import { PlanHistoryModalComponent } from './plan-history/plan-history-modal.component';
import { PlanChatModalComponent } from './plan-chat-modal/plan-chat-modal.component';
import { JourneyPhaseDetailModalComponent } from './journey-phase-detail-modal.component';
import { MasteryWeeklyChallenge } from '../services/learning-plan.service';
import { environment } from '../../environments/environment';
import {
  journeyBackgroundSrcSetFromUrl,
  journeyBackgroundUrlHiRes,
  journeyBackgroundUrl,
  MapPhaseVariant,
  resolveMapVariant,
  resolvePlatformLayout,
  resolvePathLayout,
  resolveJourneyHotspots,
  resolveRoadblockTravelWaypoints,
  resolvePostRoadblockTravelWaypoints,
  resolveRoadblockTravelPathIndices,
  resolvePostRoadblockPathIndices,
  mapLayoutKey,
  chestId as buildChestId,
  ALL_JOURNEY_CHEST_FRAME_URLS,
  resolveChestFrameUrls
} from './journey-map-assets';
import { RoadblockQuizModalComponent } from './roadblock-quiz-modal/roadblock-quiz-modal.component';
import { ChestRewardModalComponent } from './chest-reward-modal/chest-reward-modal.component';

interface PhaseRow {
  index: number;
  title: string;
  description: string;
  focusAreas: string[];
  /** Goal-flavored scenario hints (e.g. "workplace and meetings") that
   *  the plan generator attached when the student set their goal. These
   *  are *separate* from focusAreas (which are skill-flavored) — they
   *  give the student a visible signal that their goal was honored. */
  suggestedTopics: string[];
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

interface PathWaypoint {
  x: number;
  y: number;
  /** Nearness along the scene: 0 = far/back, 1 = near/front. Drives node scale. */
  z?: number;
  /** Optional label card anchor override from map-layouts.json. */
  labelAlign?: 'start' | 'center' | 'end';
  /** Fine-tune label position (px). Negative shifts the card left. */
  labelOffsetX?: number;
}

interface MapNode {
  index: number;
  xPct: number; // 0–100, left % on the canvas
  yPct: number; // 0–100, top % on the canvas
  /** CSS scale factor derived from path depth (≈0.62–1.0). */
  depthScale: number;
  /** Slight fade for distant nodes; active/selected stay fully opaque. */
  depthOpacity: number;
  /** Stacking order so nearer nodes sit above farther ones. */
  depthZIndex: number;
  // Where the label sits relative to the dot. Default 'above' matches the
  // canonical winding-path UX, but flips to 'below' when the node is
  // close to the top edge so the label can never overflow the canvas.
  labelPlacement: 'above' | 'below';
  // Horizontal anchoring of the label relative to the dot. Center is the
  // default; flips to start/end when the node is near the canvas edge so
  // the (max-width 92px) label can't escape the canvas sideways.
  labelAlign: 'start' | 'center' | 'end';
  /** Per-node label nudge from map-layouts.json (px). */
  labelOffsetX: number;
  row: PhaseRow;
}

interface JourneyChapterStripItem {
  index: number;
  level: string;
  theme: string;
  label: string;
  imageUrl: string;
  state: 'past' | 'current' | 'future';
}

interface RoadblockNode {
  x: number;
  y: number;
  afterPhase: number;
  /** locked = upstream phase not done; active = current gate; cleared = passed. */
  state: 'locked' | 'active' | 'cleared';
}

interface ChestNode {
  x: number;
  y: number;
  phaseIndex: number;
  chestId: string;
  /** locked = phase not done; claimable = open it; claimed = already opened. */
  state: 'locked' | 'claimable' | 'claimed';
  tier: 'bronze' | 'silver' | 'gold' | null;
  /** Flipbook frame index (0 = closed … last = open). */
  spriteFrame: number;
  /** Closed + open URLs for this chest's side. */
  frameUrls: readonly [string, string];
  side: 'left' | 'right';
  /** Painted into the map art — no sprite overlay. */
  bakedIn: boolean;
  /** True while the open sequence is playing (pauses idle bob). */
  opening: boolean;
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
  /** True only while the inline panel is actually on-screen. The host (tab1)
   *  pre-mounts this page hidden so the canvas is warm, so we must NOT fire
   *  the roadblock quiz / travel animation until the student really opens the
   *  map. Flipping false → true runs the deferred entry check exactly once. */
  private _active = false;
  @Input()
  set active(value: boolean) {
    const next = !!value;
    if (next === this._active) return;
    this._active = next;
    if (next) this.onJourneyBecameVisible();
  }
  get active(): boolean {
    return this._active;
  }
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
  phaseModalCircleBounds: { x: number; y: number; width: number; height: number } | null = null;
  private phaseDetailModal: Awaited<ReturnType<ModalController['create']>> | null = null;
  private phaseDetailModalView: JourneyPhaseDetailModalComponent | null = null;
  private roadblockModalBounds: { x: number; y: number; width: number; height: number } | null = null;
  private chestModalBounds: { x: number; y: number; width: number; height: number } | null = null;

  // All-chapter strip — lowest → highest with past/current/future styling.
  chapterStrip: JourneyChapterStripItem[] = [];

  // Scenic winding-path map
  mapNodes: MapNode[] = [];
  private chestFramesReady: Promise<void> | null = null;
  // Tappable overlays for art baked into the background (roadblocks + chests).
  roadblockNodes: RoadblockNode[] = [];
  chestNodes: ChestNode[] = [];
  private claimedChestIds = new Set<string>();
  private roadblockBusy = false;
  private chestBusy = false;

  /** Dev-only: force roadblock gates active + show hitboxes for QA. */
  devRoadblockForceActive = false;
  devRoadblockShowHitboxes = false;

  /** Blue traveler dot — rests on active phase; animates for roadblock checkpoints. */
  travelerVisible = false;
  travelerXPct = 0;
  travelerYPct = 0;
  /** Phase index the traveler is currently on (hides that node's built-in dot). */
  travelerPhaseIndex: number | null = null;
  /** Keeps single-dot styling while the traveler dot is hidden (e.g. roadblock modal). */
  travelerMapMode = false;
  /** True while the blue dot is parked ON an active roadblock gate (not a phase).
   *  Suppresses the active-phase node's placeholder so only the blue dot shows. */
  travelerOnRoadblock = false;
  private travelerAnimating = false;
  private roadblockTravelQueued = false;
  /** In-flight roadblock-quiz fetch, started as soon as the gate is detected so
   *  generation overlaps the travel animation instead of blocking the open. */
  private roadblockPrefetch: Promise<RoadblockResponse | null> | null = null;
  private roadblockPrefetchKey: number | null = null;
  /** Rest here after clearing a gate until the plan active phase catches up. */
  private travelerArrivedPhaseIndex: number | null = null;

  mapPathD = '';
  /** Pixel dash length for the draw-in animation (non-scaling-stroke). */
  mapPathDashLen = 500;
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

  // True when the student's *literal next event* is a trial booking — either
  // their first-ever lesson, or a meet-and-greet with a brand-new tutor after
  // a long history with someone else. Drives a trial-aware framing on the
  // "Next lesson focus" card so the plan isn't advertising "ordering food at
  // a restaurant" right before a 30-min discovery call.
  pendingTrial = false;
  nextTrialTutorFirstName = '';

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
  private mapStageResizeObserver: ResizeObserver | null = null;
  private mapPathMeasurePending = false;

  constructor(
    private learningPlanService: LearningPlanService,
    private userService: UserService,
    private reviewDeckService: ReviewDeckService,
    private router: Router,
    private location: Location,
    private translate: TranslateService,
    private cdr: ChangeDetectorRef,
    private alertCtrl: AlertController,
    private toastService: ToastService,
    private modalCtrl: ModalController,
    private animationCtrl: AnimationController,
    private el: ElementRef<HTMLElement>
  ) {}

  ngOnInit() {
    this.emptyPreviewPhases = [
      this.translate.instant('JOURNEY.EMPTY_PREVIEW_P1'),
      this.translate.instant('JOURNEY.EMPTY_PREVIEW_P2'),
      this.translate.instant('JOURNEY.EMPTY_PREVIEW_P3'),
      this.translate.instant('JOURNEY.EMPTY_PREVIEW_P4')
    ];
    this.preloadChestFrames();
    const sub = this.userService.getCurrentUser().pipe(take(1)).subscribe(user => {
      // Prefer the active journey language resolved on Home (most recent
      // lesson → active plan → paused → onboarding). Falls back to the
      // first onboarding language when this page is opened cold.
      const lang = this.learningPlanService.activeJourneyLanguage || user?.onboardingData?.languages?.[0];
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

    // If the plan transitions to paused / unframed while this page is
    // mounted (e.g. user pauses from Profile in another tab), feed that
    // straight through applyPlan — which will short-circuit and bounce
    // them back to home. Keeps tab1's widget and this surface honest.
    const planSub = this.learningPlanService.planUpdates$.subscribe(update => {
      if (!this.language || update.language !== this.language) return;
      this.applyPlan(update.plan, update.entitlements || null);
    });
    this.subs.push(planSub);

    // Keep the inline / pre-mounted journey map in sync when the student
    // switches languages from the Home widget picker.
    const langSub = this.learningPlanService.activeJourneyLanguage$.subscribe(lang => {
      if (!lang) return;
      this.switchJourneyLanguage(lang);
    });
    this.subs.push(langSub);
  }

  /** Reload the map and ancillary data when the surfaced language changes. */
  private switchJourneyLanguage(language: string): void {
    const next = (language || '').trim();
    if (!next || next.toLowerCase() === (this.language || '').trim().toLowerCase()) return;

    void this.closePhaseModal();
    this.visitingChapter = null;
    this.liveChapterSnapshot = null;
    this.mapVariantPreviewSnapshot = null;
    this.comingUp = [];
    this.recommendedMaterials = [];
    this.showRecommendations = false;
    this.masteryChallenge = null;

    this.language = next;
    this.loadPlan();
    this.loadPracticeDueCount();
    this.loadEditPermissions();
  }

  ngOnDestroy() {
    this.mapStageResizeObserver?.disconnect();
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

  togglePhase(i: number, event?: Event) {
    const row = this.phaseRows[i];
    if (!row) return;

    const bounds = this.capturePhaseNodeBounds(event);

    if (this.phaseDetailModal && this.selectedRow?.index === i) {
      void this.closePhaseModal();
      return;
    }

    void this.presentPhaseDetailModal(row, bounds);
  }

  private async presentPhaseDetailModal(
    row: PhaseRow,
    bounds: { x: number; y: number; width: number; height: number } | null
  ) {
    if (this.phaseDetailModal) {
      await this.phaseDetailModal.dismiss();
      this.phaseDetailModal = null;
      this.phaseDetailModalView = null;
    }

    this.phaseRows.forEach(r => { r.expanded = false; });
    row.expanded = true;
    this.selectedRow = row;
    this.phaseModalCircleBounds = bounds;

    try {
      const modal = await this.modalCtrl.create({
        component: JourneyPhaseDetailModalComponent,
        componentProps: { host: this, selectedRow: row },
        cssClass: 'journey-phase-modal',
        backdropDismiss: true,
        enterAnimation: (baseEl) => this.createPhaseModalEnterAnimation(baseEl, bounds),
        leaveAnimation: (baseEl) => this.createPhaseModalLeaveAnimation(baseEl, bounds)
      });

      this.phaseDetailModal = modal;
      await modal.present();
      this.phaseDetailModalView = (modal as unknown as { component?: JourneyPhaseDetailModalComponent }).component ?? null;

      void modal.onDidDismiss().then(() => {
        if (this.phaseDetailModal === modal) {
          this.onPhaseModalDismiss();
        }
      });
    } catch {
      this.onPhaseModalDismiss();
    }

    this.cdr.markForCheck();
  }

  refreshPhaseDetailModal() {
    this.phaseDetailModalView?.markForCheck();
    this.cdr.markForCheck();
  }

  private capturePhaseNodeBounds(event?: Event): { x: number; y: number; width: number; height: number } | null {
    const btn = event?.currentTarget as HTMLElement | undefined;
    const dot = btn?.querySelector('.jm-dot') as HTMLElement | null;
    const target = dot || btn;
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    const safeTop = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ion-safe-area-top')) || 0;
    return {
      x: rect.left,
      y: rect.top - safeTop,
      width: rect.width,
      height: rect.height
    };
  }

  async closePhaseModal() {
    if (this.phaseDetailModal) {
      await this.phaseDetailModal.dismiss();
    }
  }

  backToCurrentPhase(event: Event) {
    const mapStage = (event.target as HTMLElement | null)?.closest('.journey-map-stage');
    const currentNode = mapStage?.querySelectorAll('.jm-node')?.[this.currentPhaseIndex] as HTMLElement | undefined;
    if (currentNode) {
      void this.presentPhaseDetailModal(
        this.phaseRows[this.currentPhaseIndex],
        this.capturePhaseNodeBounds({ currentTarget: currentNode } as unknown as Event)
      );
      return;
    }
    void this.closePhaseModal();
    void this.presentPhaseDetailModal(this.phaseRows[this.currentPhaseIndex], null);
  }

  onPhaseModalDismiss() {
    this.phaseDetailModal = null;
    this.phaseDetailModalView = null;
    this.phaseRows.forEach(r => { r.expanded = false; });
    this.selectedRow = null;
    this.phaseModalCircleBounds = null;
    this.cdr.markForCheck();
  }

  private queryModalElements(baseEl: HTMLElement) {
    const root = (baseEl as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot || baseEl;
    return {
      root,
      backdrop: root.querySelector('ion-backdrop') as HTMLElement | null,
      wrapper: root.querySelector('.modal-wrapper') as HTMLElement | null
    };
  }

  private fadeModalAnimation(baseEl: HTMLElement, from: string, to: string, duration = 200) {
    return this.animationCtrl.create()
      .addElement(baseEl)
      .duration(duration)
      .fromTo('opacity', from, to);
  }

  createPhaseModalEnterAnimation = (baseEl: HTMLElement, bounds?: { x: number; y: number; width: number; height: number } | null) => {
    const circleBounds = bounds ?? this.phaseModalCircleBounds;
    if (!circleBounds) {
      return this.fadeModalAnimation(baseEl, '0', '1');
    }
    return this.createPhaseZoomEnterAnimation(baseEl, circleBounds);
  };

  createPhaseModalLeaveAnimation = (baseEl: HTMLElement, bounds?: { x: number; y: number; width: number; height: number } | null) => {
    const circleBounds = bounds ?? this.phaseModalCircleBounds;
    if (!circleBounds) {
      return this.fadeModalAnimation(baseEl, '1', '0');
    }
    return this.createPhaseZoomLeaveAnimation(baseEl, circleBounds);
  };

  private createPhaseZoomEnterAnimation(
    baseEl: HTMLElement,
    circleBounds: { x: number; y: number; width: number; height: number },
    backdropTo = 0.4
  ) {
    const { backdrop, wrapper: modalWrapper } = this.queryModalElements(baseEl);
    if (!modalWrapper) {
      return this.fadeModalAnimation(baseEl, '0', '1');
    }

    const animations = [];
    if (backdrop) {
      animations.push(this.animationCtrl.create()
        .addElement(backdrop)
        .fromTo('opacity', '0', String(backdropTo))
        .duration(200));
    }

    modalWrapper.offsetHeight;
    const modalRect = modalWrapper.getBoundingClientRect();
    const modalW = Math.max(modalRect.width, 320);
    const modalH = Math.max(modalRect.height, 400);
    const modalCenterX = modalRect.width > 0
      ? modalRect.left + modalRect.width / 2
      : window.innerWidth / 2;
    const modalCenterY = modalRect.height > 0
      ? modalRect.top + modalRect.height / 2
      : window.innerHeight / 2;

    const circleCenterX = circleBounds.x + circleBounds.width / 2;
    const circleCenterY = circleBounds.y + circleBounds.height / 2;
    const safeAreaTop = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ion-safe-area-top')) || 0;
    const adjustedCircleCenterY = circleCenterY + safeAreaTop;
    const translateX = circleCenterX - modalCenterX;
    const translateY = adjustedCircleCenterY - modalCenterY;
    const extraOffset = window.navigator.userAgent.includes('iPhone') ? 10 : 0;
    let finalScale = Math.min(
      circleBounds.width / modalW,
      circleBounds.height / modalH
    );
    if (!Number.isFinite(finalScale) || finalScale <= 0) {
      finalScale = 0.08;
    }
    finalScale = Math.min(finalScale, 1);

    const wrapperAnimation = this.animationCtrl.create()
      .addElement(modalWrapper)
      .duration(250)
      .easing('ease-in-out')
      .fromTo('transform',
        `translate(${translateX}px, ${translateY - extraOffset}px) scale(${finalScale})`,
        'translate(0px, 0px) scale(1)')
      .fromTo('opacity', '0.3', '1')
      .afterClearStyles(['transform']);
    animations.push(wrapperAnimation);

    return this.animationCtrl.create().addAnimation(animations);
  }

  private createPhaseZoomLeaveAnimation(
    baseEl: HTMLElement,
    circleBounds: { x: number; y: number; width: number; height: number },
    backdropFrom = 0.4
  ) {
    const { backdrop, wrapper: modalWrapper } = this.queryModalElements(baseEl);
    if (!modalWrapper) {
      return this.fadeModalAnimation(baseEl, '1', '0', 250);
    }

    const animations = [];
    if (backdrop) {
      animations.push(this.animationCtrl.create()
        .addElement(backdrop)
        .fromTo('opacity', String(backdropFrom), '0')
        .duration(250));
    }

    const modalRect = modalWrapper.getBoundingClientRect();
    const modalW = Math.max(modalRect.width, 320);
    const modalH = Math.max(modalRect.height, 400);
    const modalCenterX = modalRect.width > 0
      ? modalRect.left + modalRect.width / 2
      : window.innerWidth / 2;
    const modalCenterY = modalRect.height > 0
      ? modalRect.top + modalRect.height / 2
      : window.innerHeight / 2;

    const circleCenterX = circleBounds.x + circleBounds.width / 2;
    const circleCenterY = circleBounds.y + circleBounds.height / 2;
    const safeAreaTop = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ion-safe-area-top')) || 0;
    const adjustedCircleCenterY = circleCenterY + safeAreaTop;
    const translateX = circleCenterX - modalCenterX;
    const translateY = adjustedCircleCenterY - modalCenterY;
    const extraOffset = window.navigator.userAgent.includes('iPhone') ? 10 : 0;
    let finalScale = Math.min(
      circleBounds.width / modalW,
      circleBounds.height / modalH
    );
    if (!Number.isFinite(finalScale) || finalScale <= 0) {
      finalScale = 0.08;
    }
    finalScale = Math.min(finalScale, 1);

    const wrapperAnimation = this.animationCtrl.create()
      .addElement(modalWrapper)
      .duration(300)
      .easing('ease-in-out')
      .fromTo('transform',
        'translate(0px, 0px) scale(1)',
        `translate(${translateX}px, ${translateY - extraOffset}px) scale(${finalScale})`)
      .fromTo('opacity', '1', '0.3');
    animations.push(wrapperAnimation);

    return this.animationCtrl.create().addAnimation(animations);
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
  trackByChapterStrip(_i: number, ch: JourneyChapterStripItem) { return ch.index; }
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
    // Paused / unframed plans have no roadmap to view — bounce the user
    // back to home so they only ever see the journey widget for those
    // states. Inline mode emits goBack so tab1 can dismiss the panel
    // (and run its reverse FLIP); standalone route navigates back to
    // /tabs/home directly.
    if (plan?.status === 'paused' || plan?.status === 'unframed') {
      if (this.inline) {
        this.goBackEvent.emit();
      } else {
        this.router.navigate(['/tabs/home'], { replaceUrl: true });
      }
      return;
    }

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
    const goalType = plan.goal?.type || 'other';
    this.goalLabel = (goalType === 'other' && plan.goal?.description)
      ? plan.goal.description
      : (this.translate.instant('LEARNING_PLAN.GOAL_LABEL_' + goalType.toUpperCase()) || '');

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
    this.claimedChestIds = new Set((plan.claimedChests || []).map(c => c.chestId));
    this.mapPhaseVariant = resolveMapVariant(phases.length || 4);
    this.backgroundUrl = journeyBackgroundUrl(this.chapterTheme, phases.length || 4);
    this.backgroundFailed = false;
    this.rebuildChapterStrip();

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
        suggestedTopics: (p as any).suggestedTopics || [],
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
      this.prefetchBackground(nextThemes[this.chapterIndex + 1], 4);
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

  private presentToast(message: string, color: string = 'medium', duration = 4000) {
    void this.toastService.showLegacy(message, color, duration, {
      position: 'top',
      buttons: [{ text: 'OK', role: 'cancel' }],
    });
  }

  // ── Past Maps + Plan History (Batch 6) ───────────────────────────

  /** Snapshot of the live chapter so we can restore after a "visit". */
  private liveChapterSnapshot: {
    theme: string;
    level: string;
    index: number;
    backgroundUrl: string;
    backgroundFailed: boolean;
    mapPhaseVariant: MapPhaseVariant;
  } | null = null;
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

  private static readonly CHAPTER_PREVIEWS: { level: string; theme: string; index: number; label: string }[] = [
    { level: 'A1', theme: 'a1-desert', index: 0, label: 'A1 · Desert' },
    { level: 'A2', theme: 'a2-coast', index: 1, label: 'A2 · Coast' },
    { level: 'B1', theme: 'b1-lake', index: 2, label: 'B1 · Lake' },
    { level: 'B2', theme: 'b2-snow', index: 3, label: 'B2 · Snow' },
    { level: 'C1', theme: 'c1-cherry', index: 4, label: 'C1 · Cherry blossom' },
    { level: 'C2', theme: 'c2-tuscany', index: 5, label: 'C2 · Tuscany' }
  ];

  async openMapLayoutPreview() {
    if (!this.isDev) return;
    const alert = await this.alertCtrl.create({
      header: 'Preview map — pick chapter',
      subHeader: 'Local only — does not touch DB',
      cssClass: 'journey-dev-preview-alert',
      inputs: [
        ...JourneyPage.CHAPTER_PREVIEWS.map((c, i) => ({
          type: 'radio' as const,
          label: c.label,
          value: c.theme,
          checked: c.theme === this.chapterTheme
        })),
        { type: 'radio', label: 'Revert to live plan', value: 'revert' }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Next',
          handler: (theme: string) => {
            if (theme === 'revert') {
              this.revertMapVariantPreview();
              return;
            }
            void this.openMapVariantPreview(theme);
          }
        }
      ]
    });
    await alert.present();
  }

  private async openMapVariantPreview(theme: string) {
    const chapter = JourneyPage.CHAPTER_PREVIEWS.find(c => c.theme === theme);
    if (!chapter) return;
    const alert = await this.alertCtrl.create({
      header: 'Preview map — pick layout',
      subHeader: chapter.label,
      cssClass: 'journey-dev-preview-alert',
      inputs: [
        { type: 'radio', label: '3-phase map', value: '3', checked: true },
        { type: 'radio', label: '4-phase map', value: '4' },
        { type: 'radio', label: '5-phase map', value: '5' }
      ],
      buttons: [
        { text: 'Back', role: 'cancel', handler: () => { void this.openMapLayoutPreview(); } },
        {
          text: 'Apply',
          handler: (variant: string) => {
            this.previewMapLayout(chapter, Number(variant) as 3 | 4 | 5);
          }
        }
      ]
    });
    await alert.present();
  }

  private mapVariantPreviewSnapshot: {
    phaseRows: PhaseRow[];
    selectedRow: PhaseRow | null;
    backgroundUrl: string;
    backgroundFailed: boolean;
    mapPhaseVariant: MapPhaseVariant;
    chapterTheme: string;
    chapterLevel: string;
    chapterIndex: number;
  } | null = null;

  private previewMapLayout(
    chapter: { level: string; theme: string; index: number },
    variant: 3 | 4 | 5
  ) {
    if (!this.mapVariantPreviewSnapshot) {
      this.mapVariantPreviewSnapshot = {
        phaseRows: this.phaseRows.map(r => ({ ...r })),
        selectedRow: this.selectedRow,
        backgroundUrl: this.backgroundUrl,
        backgroundFailed: this.backgroundFailed,
        mapPhaseVariant: this.mapPhaseVariant,
        chapterTheme: this.chapterTheme,
        chapterLevel: this.chapterLevel,
        chapterIndex: this.chapterIndex
      };
    }
    this.chapterTheme = chapter.theme;
    this.chapterLevel = chapter.level;
    this.chapterIndex = chapter.index;
    this.phaseRows = this.buildPreviewPhaseRows(variant);
    this.selectedRow = this.phaseRows[0] || null;
    this.mapPhaseVariant = variant;
    this.backgroundUrl = journeyBackgroundUrl(chapter.theme, variant);
    this.backgroundFailed = false;
    this.computeMapNodes();
    this.cdr.markForCheck();
    this.presentToast(
      `Preview: ${chapter.theme} · ${variant}-phase. Map icon → Revert.`,
      'tertiary',
      3500
    );
  }

  private previewMapVariant(variant: 3 | 4 | 5) {
    this.previewMapLayout(
      { level: this.chapterLevel, theme: this.chapterTheme, index: this.chapterIndex },
      variant
    );
  }

  private revertMapVariantPreview() {
    if (!this.mapVariantPreviewSnapshot) {
      this.presentToast('No map preview active.', 'medium', 2000);
      return;
    }
    this.phaseRows = this.mapVariantPreviewSnapshot.phaseRows;
    this.selectedRow = this.mapVariantPreviewSnapshot.selectedRow;
    this.backgroundUrl = this.mapVariantPreviewSnapshot.backgroundUrl;
    this.backgroundFailed = this.mapVariantPreviewSnapshot.backgroundFailed;
    this.mapPhaseVariant = this.mapVariantPreviewSnapshot.mapPhaseVariant;
    this.chapterTheme = this.mapVariantPreviewSnapshot.chapterTheme;
    this.chapterLevel = this.mapVariantPreviewSnapshot.chapterLevel;
    this.chapterIndex = this.mapVariantPreviewSnapshot.chapterIndex;
    this.mapVariantPreviewSnapshot = null;
    this.computeMapNodes();
    this.cdr.markForCheck();
    this.presentToast('Reverted to live plan map.', 'medium', 2500);
  }

  private buildPreviewPhaseRows(count: 3 | 4 | 5): PhaseRow[] {
    const titles = [
      'Foundations of German',
      'Everyday Conversations',
      'Social Interactions',
      'Exploring Culture',
      'Building Confidence'
    ].slice(0, count);
    return titles.map((title, i) => ({
      index: i,
      title,
      description: '',
      focusAreas: [] as string[],
      suggestedTopics: [] as string[],
      exitCriteria: '',
      status: (i === 0 ? 'active' : 'locked') as PhaseRow['status'],
      lessonsCompleted: 0,
      estimatedLessons: 5,
      masteryAverage: null,
      windowProgressPercent: 0,
      progressState: null,
      progressStateLabel: '',
      expanded: i === 0,
      editing: false,
      saving: false,
      draftTitle: '',
      draftDescription: '',
      draftFocusAreasText: '',
      isSplit: false,
      isRecovery: false,
      previousPhaseTitle: i > 0 ? titles[i - 1] : ''
    }));
  }

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
    this.mapPhaseVariant = 4;
    this.backgroundUrl = journeyBackgroundUrl(nextTheme, 4);
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
      'Preview: phase split — extra map node + callout in card. Reverting in 8s.',
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
        backgroundFailed: this.backgroundFailed,
        mapPhaseVariant: this.mapPhaseVariant
      };
    }
    this.visitingChapter = { index: c.index, level: c.level, theme: c.theme };
    this.chapterTheme = c.theme;
    this.chapterLevel = c.level;
    this.chapterIndex = c.index;
    const visitPhaseCount = Array.isArray(c.phaseTitles) && c.phaseTitles.length
      ? c.phaseTitles.length
      : 4;
    this.mapPhaseVariant = resolveMapVariant(visitPhaseCount);
    this.backgroundUrl = journeyBackgroundUrl(c.theme, visitPhaseCount);
    this.backgroundFailed = false;
    // Replace map nodes with the visited chapter's titles (read-only).
    if (Array.isArray(c.phaseTitles) && c.phaseTitles.length) {
      this.phaseRows = c.phaseTitles.map((title, i) => ({
        index: i,
        title: title || `Phase ${i + 1}`,
        description: '',
        focusAreas: [],
        suggestedTopics: [],
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
    this.rebuildChapterStrip();
    this.cdr.markForCheck();
  }

  exitVisitingChapter() {
    if (!this.liveChapterSnapshot) return;
    this.chapterTheme = this.liveChapterSnapshot.theme;
    this.chapterLevel = this.liveChapterSnapshot.level;
    this.chapterIndex = this.liveChapterSnapshot.index;
    this.backgroundUrl = this.liveChapterSnapshot.backgroundUrl;
    this.backgroundFailed = this.liveChapterSnapshot.backgroundFailed;
    this.mapPhaseVariant = this.liveChapterSnapshot.mapPhaseVariant;
    this.liveChapterSnapshot = null;
    this.visitingChapter = null;
    // Reload the live plan to restore phaseRows.
    if (this.plan) this.applyPlan(this.plan, this.entitlements);
    this.cdr.markForCheck();
  }

  // Platform-centre waypoints per theme + phase-count variant (from map-layouts.json).
  // Phase nodes sit only on empty platforms — the badge pedestal is decorative.
  mapPhaseVariant: MapPhaseVariant = 4;

  // Resolved at applyPlan() time from plan.chapterTheme.
  chapterTheme = 'a1-desert';
  chapterLevel = 'A1';
  chapterIndex = 0;
  // Background asset path. Built from chapterTheme + phase count; falls back to a gradient
  // when image fails to load (G35) — handled in template via (error).
  backgroundUrl = journeyBackgroundUrl('a1-desert', 4);
  backgroundFailed = false;
  /** Accurate rendered width for srcset — updated by ResizeObserver on .journey-map-stage. */
  backgroundSizes = '100vw';

  get backgroundSrcSet(): string {
    return journeyBackgroundSrcSetFromUrl(this.backgroundUrl);
  }

  get backgroundSrcHiRes(): string {
    return journeyBackgroundUrlHiRes(this.backgroundUrl);
  }

  /** Non-current chapters for the left vertical rail (A1→C2). */
  get chapterRailItems(): JourneyChapterStripItem[] {
    return this.chapterStrip.filter(ch => ch.state !== 'current');
  }

  private rebuildChapterStrip(): void {
    const progressIndex = this.visitingChapter
      ? (this.liveChapterSnapshot?.index ?? this.chapterIndex)
      : this.chapterIndex;
    const displayIndex = this.visitingChapter?.index ?? this.chapterIndex;

    this.chapterStrip = JourneyPage.CHAPTER_PREVIEWS.map(ch => {
      let state: JourneyChapterStripItem['state'];
      if (ch.index === displayIndex) {
        state = 'current';
      } else if (ch.index > progressIndex) {
        state = 'future';
      } else {
        state = 'past';
      }
      return {
        index: ch.index,
        level: ch.level,
        theme: ch.theme,
        label: ch.label,
        imageUrl: journeyBackgroundUrl(ch.theme, 5),
        state
      };
    });
  }

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

  /** Map path depth (0 = far, 1 = near) to a visible node scale. */
  private static depthToScale(z: number): number {
    const clamped = Math.max(0, Math.min(1, z));
    return 0.62 + clamped * 0.38;
  }

  private static depthToOpacity(z: number): number {
    const clamped = Math.max(0, Math.min(1, z));
    return 0.76 + clamped * 0.24;
  }

  private waypointDepth(pt: PathWaypoint, pts: PathWaypoint[]): number {
    if (typeof pt.z === 'number') return pt.z;
    // Fallback: lower on canvas ≈ nearer when z isn't hand-tuned.
    const ys = pts.map(p => p.y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    if (maxY === minY) return 0.85;
    return 0.55 + ((pt.y - minY) / (maxY - minY)) * 0.4;
  }

  private themePlatformPts(phaseCount: number): PathWaypoint[] {
    return resolvePlatformLayout(this.chapterTheme, phaseCount);
  }

  /** Platform centres for node badges (pedestal excluded). */
  private resolveNodePts(phaseCount: number): PathWaypoint[] {
    return this.resolvePlatformPts(phaseCount);
  }

  /** Waypoints the dust trail follows — platforms + path kinks (roadblocks). */
  private resolvePathPts(phaseCount: number): PathWaypoint[] {
    return resolvePathLayout(this.chapterTheme, phaseCount);
  }

  private resolvePlatformPts(phaseCount: number): PathWaypoint[] {
    const platforms = this.themePlatformPts(phaseCount);
    const count = Math.max(1, phaseCount);
    if (count <= platforms.length) {
      return platforms.slice(0, count);
    }
    // Adaptive split can briefly exceed the baked platform count — interpolate.
    return Array.from({ length: count }, (_, i) =>
      this.sampleJourneyPathFromPts(platforms, count > 1 ? i / (count - 1) : 0.5)
    );
  }

  private themePathPts(): PathWaypoint[] {
    return this.themePlatformPts(this.phaseRows.length || 4);
  }

  private sampleJourneyPath(t: number): { x: number; y: number; z: number } {
    return this.sampleJourneyPathFromPts(this.resolveNodePts(this.phaseRows.length || 4), t);
  }

  private sampleJourneyPathFromPts(pts: PathWaypoint[], t: number): { x: number; y: number; z: number } {
    if (t <= 0) {
      const z0 = this.waypointDepth(pts[0], pts);
      return { x: pts[0].x, y: pts[0].y, z: z0 };
    }
    if (t >= 1) {
      const last = pts[pts.length - 1];
      const zLast = this.waypointDepth(last, pts);
      return { x: last.x, y: last.y, z: zLast };
    }
    const raw = (pts.length - 1) * t;
    const i = Math.floor(raw);
    const f = raw - i;
    const z0 = this.waypointDepth(pts[i], pts);
    const z1 = this.waypointDepth(pts[i + 1], pts);
    return {
      x: pts[i].x + (pts[i + 1].x - pts[i].x) * f,
      y: pts[i].y + (pts[i + 1].y - pts[i].y) * f,
      z: z0 + (z1 - z0) * f
    };
  }

  private computeMapNodes() {
    const rows = this.phaseRows;
    const n = rows.length;
    if (n === 0) { this.mapNodes = []; this.mapPathD = ''; return; }

    const variant = resolveMapVariant(n);
    if (this.mapPhaseVariant !== variant) {
      this.mapPhaseVariant = variant;
      if (!this.visitingChapter) {
        const nextUrl = journeyBackgroundUrl(this.chapterTheme, n);
        if (this.backgroundUrl !== nextUrl) {
          this.backgroundUrl = nextUrl;
          this.backgroundFailed = false;
        }
      }
    }

    const pathPts = this.resolvePathPts(n);
    const nodePts = this.resolveNodePts(n);

    this.mapNodes = rows.map((row, i) => {
      const layoutPt = n === nodePts.length ? nodePts[i] : null;
      const pt = layoutPt
        ? {
            x: layoutPt.x,
            y: layoutPt.y,
            z: typeof layoutPt.z === 'number'
              ? layoutPt.z!
              : this.waypointDepth(layoutPt, nodePts)
          }
        : this.sampleJourneyPathFromPts(nodePts, n > 1 ? i / (n - 1) : 0.5);
      const labelPlacement: 'above' | 'below' = pt.y < LABEL_FLIP_TOP_THRESHOLD
        ? 'below'
        : 'above';
      const labelAlign: 'start' | 'center' | 'end' = layoutPt?.labelAlign ?? (
        pt.x < LABEL_EDGE_LEFT_THRESHOLD
          ? 'start'
          : pt.x > LABEL_EDGE_RIGHT_THRESHOLD
            ? 'end'
            : 'center'
      );
      const depthScale = JourneyPage.depthToScale(pt.z);
      const depthOpacity = JourneyPage.depthToOpacity(pt.z);
      const depthZIndex =
        row.status === 'active' || row.expanded
          ? 24
          : 2 + Math.round(pt.z * 20);
      return {
        index: i,
        xPct: pt.x,
        yPct: pt.y,
        depthScale,
        depthOpacity,
        depthZIndex,
        labelPlacement,
        labelAlign,
        labelOffsetX: layoutPt?.labelOffsetX ?? 0,
        row
      };
    });

    this.computeHotspots();

    const nextD = this.buildSvgPathD(pathPts);
    if (nextD !== this.mapPathD) {
      this.revealMapPath(nextD);
    } else {
      this.ensureMapStageResizeObserver();
    }

    this.scheduleRoadblockTravelCheck();
  }

  /** Build roadblock + chest overlays from the current map art and phase state. */
  private computeHotspots(): void {
    const n = this.phaseRows.length;
    const hotspots = resolveJourneyHotspots(this.chapterTheme, n);
    if (!hotspots) {
      this.roadblockNodes = [];
      this.chestNodes = [];
      return;
    }

    const statusAt = (i: number): 'completed' | 'active' | 'locked' | null =>
      (i >= 0 && i < n) ? this.phaseRows[i].status : null;

    this.roadblockNodes = (hotspots.roadblocks || [])
      .filter(rb => rb.afterPhase < n - 1) // a gate needs a phase after it
      .map(rb => {
        const upstreamDone = statusAt(rb.afterPhase) === 'completed';
        const nextDone = statusAt(rb.afterPhase + 1) === 'completed';
        let state: RoadblockNode['state'] = nextDone ? 'cleared' : upstreamDone ? 'active' : 'locked';
        if (this.isDev && this.devRoadblockForceActive && state !== 'cleared') {
          state = 'active';
        }
        return { x: rb.x, y: rb.y, afterPhase: rb.afterPhase, state };
      });

    this.chestNodes = (hotspots.chests || [])
      .filter(c => c.phaseIndex < n)
      .map(c => {
        const id = buildChestId(this.chapterTheme, n, c.phaseIndex);
        const claimed = this.claimedChestIds.has(id);
        const phaseDone = statusAt(c.phaseIndex) === 'completed';
        const state: ChestNode['state'] = claimed
          ? 'claimed'
          : (phaseDone || this.isDev)
            ? 'claimable'
            : 'locked';
        const tier = claimed
          ? ((this.plan?.claimedChests || []).find(cc => cc.chestId === id)?.tier ?? null)
          : null;
        const frameUrls = resolveChestFrameUrls(c.side);
        const spriteFrame = claimed ? frameUrls.length - 1 : 0;
        return {
          x: c.x, y: c.y, phaseIndex: c.phaseIndex, chestId: id, state, tier,
          spriteFrame, frameUrls, side: c.side, bakedIn: !!c.bakedIn, opening: false
        };
      });
  }

  /** Warm + decode all chest frames before the first open. */
  private preloadChestFrames(): void {
    if (typeof Image === 'undefined') return;
    this.chestFramesReady = Promise.all(
      ALL_JOURNEY_CHEST_FRAME_URLS.map(src => {
        const img = new Image();
        img.src = src;
        return img.decode?.() ?? Promise.resolve();
      })
    ).then(() => undefined).catch(() => undefined);
  }

  trackByFrameIndex(index: number): number { return index; }
  trackByChestId(_i: number, node: ChestNode): string { return node.chestId; }
  trackByRoadblock(_i: number, node: RoadblockNode): number { return node.afterPhase; }

  /** Kick off the checkpoint-quiz fetch the moment a gate is detected, so the
   *  (potentially slow) generation overlaps the travel animation. Single-flight
   *  per gate; reused by onRoadblockTap so the modal open is instant/warm. */
  private prefetchRoadblockQuiz(node: RoadblockNode): void {
    if (this.roadblockPrefetchKey === node.afterPhase && this.roadblockPrefetch) return;
    this.roadblockPrefetchKey = node.afterPhase;
    this.roadblockPrefetch = firstValueFrom(
      this.learningPlanService.getRoadblockQuiz(this.language, node.afterPhase + 1).pipe(take(1))
    ).catch(() => null);
  }

  /** Tap an active roadblock → open the checkpoint immediately; the quiz loads
   *  inside the modal so generation latency never blocks the open. */
  async onRoadblockTap(node: RoadblockNode, devOpts?: { mock?: boolean; skipStateCheck?: boolean }): Promise<void> {
    if (this.roadblockBusy || this.travelerAnimating) return;
    if (node.state !== 'active' && !(this.isDev && (devOpts?.skipStateCheck || this.devRoadblockForceActive))) {
      return;
    }

    this.roadblockBusy = true;
    this.updateTravelerMapMode();
    try {
      const loader = this.buildRoadblockQuizLoader(node, devOpts);
      await this.presentRoadblockQuizModal(loader, node);
    } finally {
      this.roadblockBusy = false;
      this.updateTravelerMapMode();
    }
  }

  /** Resolve the quiz for a gate (reusing any in-flight prefetch), with dev
   *  mock fallbacks. Returns null when no quiz is available. */
  private buildRoadblockQuizLoader(
    node: RoadblockNode,
    devOpts?: { mock?: boolean; skipStateCheck?: boolean }
  ): Promise<{ quiz: RoadblockQuiz; struggleLabel: string; personalizedHeader: string } | null> {
    if (devOpts?.mock) {
      return Promise.resolve({
        quiz: this.buildMockRoadblockQuiz(),
        struggleLabel: 'greetings',
        personalizedHeader: 'Dev preview — quick check on greetings.'
      });
    }

    let fetch$: Promise<RoadblockResponse | null>;
    if (this.roadblockPrefetchKey === node.afterPhase && this.roadblockPrefetch) {
      fetch$ = this.roadblockPrefetch;
    } else {
      fetch$ = firstValueFrom(
        this.learningPlanService.getRoadblockQuiz(this.language, node.afterPhase + 1).pipe(take(1))
      ).catch(() => null);
    }
    // Single-use: clear so a later open re-fetches fresh state.
    this.roadblockPrefetch = null;
    this.roadblockPrefetchKey = null;

    return fetch$.then(res => {
      if (res?.available && res.quiz) {
        return {
          quiz: res.quiz,
          struggleLabel: res.struggleLabel || '',
          personalizedHeader: res.personalizedHeader || ''
        };
      }
      if (this.isDev) {
        return {
          quiz: this.buildMockRoadblockQuiz(),
          struggleLabel: res?.struggleLabel || 'checkpoint',
          personalizedHeader: res?.personalizedHeader || 'Dev fallback quiz.'
        };
      }
      return null;
    });
  }

  private async presentRoadblockQuizModal(
    quizLoader: Promise<{ quiz: RoadblockQuiz; struggleLabel: string; personalizedHeader: string } | null>,
    roadblockNode?: RoadblockNode
  ): Promise<void> {
    // Park the blue dot ON the gate (not hidden) so it's the only marker and
    // is already in place when the modal closes — no lingering green ghost.
    if (roadblockNode) {
      this.restTravelerAtRoadblock(roadblockNode);
    } else {
      this.hideTravelerDot();
    }
    const bounds = roadblockNode ? this.captureRoadblockBounds(roadblockNode) : null;
    this.roadblockModalBounds = bounds;

    const modal = await this.modalCtrl.create({
      component: RoadblockQuizModalComponent,
      componentProps: { quizLoader },
      cssClass: 'journey-roadblock-modal',
      backdropDismiss: false,
      enterAnimation: (baseEl) => this.createRoadblockModalEnterAnimation(baseEl),
      leaveAnimation: (baseEl) => this.createRoadblockModalLeaveAnimation(baseEl)
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    this.roadblockModalBounds = null;
    if (role === 'completed' && data?.quizId) {
      this.learningPlanService
        .completeQuiz(data.quizId, 0, { correct: data.correct, total: data.total })
        .pipe(take(1))
        .subscribe({ error: () => {} });
      this.showToast(this.translate.instant('JOURNEY.ROADBLOCK.PASSED_TOAST'), 'success');
      if (roadblockNode) {
        await this.playPostRoadblockTravelSequence(roadblockNode);
        return;
      }
    }
    this.syncTravelerRestingPosition();
  }

  createRoadblockModalEnterAnimation = (baseEl: HTMLElement) => {
    const bounds = this.roadblockModalBounds;
    if (!bounds) return this.fadeModalAnimation(baseEl, '0', '1');
    return this.createPhaseZoomEnterAnimation(baseEl, bounds, 1);
  };

  createRoadblockModalLeaveAnimation = (baseEl: HTMLElement) => {
    const bounds = this.roadblockModalBounds;
    if (!bounds) return this.fadeModalAnimation(baseEl, '1', '0', 250);
    return this.createPhaseZoomLeaveAnimation(baseEl, bounds, 1);
  };

  private captureRoadblockBounds(node: RoadblockNode): { x: number; y: number; width: number; height: number } | null {
    const hotspot = this.el.nativeElement.querySelector(
      `[data-rb-phase="${node.afterPhase}"]`
    ) as HTMLElement | null;

    const safeTop = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ion-safe-area-top')) || 0;

    if (hotspot) {
      const rect = hotspot.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height, 44);
      return {
        x: rect.left + rect.width / 2 - size / 2,
        y: rect.top - safeTop + rect.height / 2 - size / 2,
        width: size,
        height: size
      };
    }

    const stage = this.el.nativeElement.querySelector('.journey-map-stage') as HTMLElement | null;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const size = 44;
    const cx = rect.left + (node.x / 100) * rect.width;
    const cy = rect.top + (node.y / 100) * rect.height;
    return {
      x: cx - size / 2,
      y: cy - safeTop - size / 2,
      width: size,
      height: size
    };
  }

  private buildMockRoadblockQuiz(): RoadblockQuiz {
    return {
      _id: 'dev-roadblock-mock',
      title: 'Roadblock checkpoint (dev)',
      description: 'Local preview — not saved unless you complete via live API.',
      questions: [
        {
          type: 'multiple_choice',
          prompt: 'What does "hola" mean?',
          options: ['Hello', 'Goodbye', 'Please', 'Thank you'],
          correctAnswer: 'Hello',
          explanation: '"Hola" is the most common Spanish greeting.'
        },
        {
          type: 'multiple_choice',
          prompt: 'Which word means "thank you"?',
          options: ['Por favor', 'De nada', 'Gracias', 'Perdón'],
          correctAnswer: 'Gracias',
          explanation: '"Gracias" means thank you.'
        }
      ]
    };
  }

  /** Dev-only: test roadblock travel + quiz without map pan. */
  async openRoadblockDevTools(): Promise<void> {
    if (!this.isDev) return;

    const mapKey = mapLayoutKey(this.chapterTheme, this.phaseRows.length);
    const gateCount = this.roadblockNodes.length;

    const alert = await this.alertCtrl.create({
      header: 'Roadblock debug',
      subHeader: gateCount
        ? `${gateCount} gate(s) on ${mapKey} · local only`
        : `No gates on ${mapKey} — try A1 with 3, 4, or 5 phases`,
      cssClass: 'journey-dev-preview-alert',
      inputs: [
        { type: 'radio', label: 'Full flow: travel → quiz → phase 2', value: 'full-mock', checked: true },
        { type: 'radio', label: 'Travel dot only (replay)', value: 'travel' },
        { type: 'radio', label: 'Mock quiz only', value: 'mock' },
        { type: 'radio', label: 'Live API quiz', value: 'live' },
        { type: 'radio', label: 'Clear travel seen flags', value: 'clear-seen' },
        { type: 'radio', label: 'Toggle force-active gates', value: 'toggle-force' },
        { type: 'radio', label: 'Toggle hitbox outlines', value: 'toggle-hitboxes' }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Run',
          handler: (mode: string) => { void this.runRoadblockDevTool(mode); }
        }
      ]
    });
    await alert.present();
  }

  private async runRoadblockDevTool(mode: string): Promise<void> {
    if (mode === 'toggle-force') {
      this.devRoadblockForceActive = !this.devRoadblockForceActive;
      this.computeHotspots();
      this.cdr.markForCheck();
      this.showToast(
        this.devRoadblockForceActive ? 'Roadblocks forced active' : 'Roadblocks back to live state',
        'success'
      );
      return;
    }

    if (mode === 'toggle-hitboxes') {
      this.devRoadblockShowHitboxes = !this.devRoadblockShowHitboxes;
      this.cdr.markForCheck();
      this.showToast(
        this.devRoadblockShowHitboxes ? 'Roadblock hitboxes visible' : 'Roadblock hitboxes hidden',
        'success'
      );
      return;
    }

    if (mode === 'clear-seen') {
      this.clearRoadblockTravelSeenFlags();
      this.roadblockTravelQueued = false;
      this.showToast('Roadblock travel flags cleared', 'success');
      return;
    }

    const node = this.pickRoadblockForDev();
    if (!node) {
      this.showToast('No roadblock on this map variant', 'warning');
      return;
    }

    if (mode === 'travel') {
      await this.playRoadblockTravelSequence(node, { force: true, openQuiz: false });
      return;
    }

    if (mode === 'mock') {
      await this.onRoadblockTap(node, { mock: true, skipStateCheck: true });
      return;
    }

    if (mode === 'live') {
      await this.onRoadblockTap(node, { skipStateCheck: true });
      return;
    }

    if (mode === 'full-mock') {
      this.devRoadblockForceActive = true;
      this.computeHotspots();
      this.cdr.markForCheck();
      const gate = this.pickRoadblockForDev();
      if (gate) {
        await this.playRoadblockTravelSequence(gate, { force: true, openQuiz: true, mockQuiz: true });
      }
    }
  }

  private pickRoadblockForDev(): RoadblockNode | null {
    if (!this.roadblockNodes.length) return null;
    return this.roadblockNodes.find(rb => rb.state !== 'cleared') || this.roadblockNodes[0];
  }

  private roadblockTravelStorageKey(afterPhase: number): string {
    const key = mapLayoutKey(this.chapterTheme, this.phaseRows.length);
    return `journey_rb_travel_v1_${this.language}_${key}_${afterPhase}`;
  }

  private hasSeenRoadblockTravel(afterPhase: number): boolean {
    try {
      return localStorage.getItem(this.roadblockTravelStorageKey(afterPhase)) === '1';
    } catch {
      return false;
    }
  }

  private markRoadblockTravelSeen(afterPhase: number): void {
    try {
      localStorage.setItem(this.roadblockTravelStorageKey(afterPhase), '1');
    } catch { /* ignore */ }
  }

  private clearRoadblockTravelSeenFlags(): void {
    try {
      for (const rb of this.roadblockNodes) {
        localStorage.removeItem(this.roadblockTravelStorageKey(rb.afterPhase));
      }
    } catch { /* ignore */ }
  }

  /**
   * On entry: surface any pending movement, then open an active roadblock.
   *
   * - Active gate present → animate travel to it the FIRST time (once per
   *   gate), then ALWAYS open the checkpoint quiz. Landing on an active gate
   *   must surface the quiz every visit until it's cleared — the gate blocks
   *   progress, so a dismissed/refreshed quiz has to come back.
   * - No active gate → animate plain phase-to-phase movement (once), then rest.
   */
  /**
   * Fired when the inline panel transitions hidden → visible. Geometry is only
   * valid once the panel is actually displayed (it's `display:none` while
   * pre-mounted), so re-measure the map, then run the entry travel/quiz check
   * that was deliberately skipped while hidden.
   */
  private onJourneyBecameVisible(): void {
    // Double rAF: let the panel's display flip flush layout before we measure.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.ensureMapStageResizeObserver();
      this.computeMapNodes();
    }));
  }

  private scheduleRoadblockTravelCheck(): void {
    // Inline + not yet on-screen: the page is pre-mounted hidden inside tab1.
    // Never auto-open the quiz or play movement here — just settle the dot in
    // place. The real entry check runs from onJourneyBecameVisible() once the
    // student actually opens the map.
    if (this.inline && !this._active) {
      this.syncTravelerRestingPosition();
      return;
    }
    if (this.roadblockTravelQueued || this.travelerAnimating || this.roadblockBusy || this.visitingChapter) return;

    const gate = this.roadblockNodes.find(rb => rb.state === 'active' && !this.devRoadblockForceActive);
    if (!gate) {
      this.schedulePhaseMovementCheck();
      return;
    }

    // Warm the quiz now so generation overlaps the travel animation.
    this.prefetchRoadblockQuiz(gate);

    this.roadblockTravelQueued = true;
    const alreadyTravelled = this.hasSeenRoadblockTravel(gate.afterPhase);
    const waitForPath = () => {
      if (!this.pathReady) {
        requestAnimationFrame(waitForPath);
        return;
      }
      if (alreadyTravelled) {
        // Travel already shown — skip the animation, park the blue dot on the
        // gate, and still open the quiz.
        this.roadblockTravelQueued = false;
        this.restTravelerAtRoadblock(gate);
        void this.onRoadblockTap(gate);
      } else {
        void this.playRoadblockTravelSequence(gate, { openQuiz: true });
      }
    };
    requestAnimationFrame(waitForPath);
  }

  /**
   * Animate the traveler from the last phase the student saw to their current
   * one, so a fresh advancement is *seen* moving rather than just appearing.
   * Plays once per target phase (persisted), then rests there on later visits.
   */
  private schedulePhaseMovementCheck(): void {
    const target = this.resolveTravelerRestPhaseIndex();
    if (target == null) {
      this.syncTravelerRestingPosition();
      return;
    }

    const lastSeen = this.getLastSeenPhaseIndex();
    // First-ever load (no record) or no forward movement → just rest.
    if (lastSeen == null || lastSeen >= target) {
      this.setLastSeenPhaseIndex(target);
      this.syncTravelerRestingPosition();
      return;
    }

    this.roadblockTravelQueued = true;
    const waitForPath = () => {
      if (!this.pathReady) {
        requestAnimationFrame(waitForPath);
        return;
      }
      void this.playPhaseMovementSequence(lastSeen, target);
    };
    requestAnimationFrame(waitForPath);
  }

  /** Animate dot from one platform to another, then rest + record it seen. */
  private async playPhaseMovementSequence(fromPhaseIndex: number, toPhaseIndex: number): Promise<void> {
    if (this.travelerAnimating) {
      this.roadblockTravelQueued = false;
      return;
    }
    await this.animateTravelerBetweenPhases(fromPhaseIndex, toPhaseIndex);
    this.setLastSeenPhaseIndex(toPhaseIndex);
    this.roadblockTravelQueued = false;
    this.restTravelerAtPhase(toPhaseIndex);
    this.cdr.markForCheck();
  }

  private lastSeenPhaseStorageKey(): string {
    const key = mapLayoutKey(this.chapterTheme, this.phaseRows.length);
    return `journey_phase_seen_v1_${this.language}_${key}`;
  }

  private getLastSeenPhaseIndex(): number | null {
    try {
      const raw = localStorage.getItem(this.lastSeenPhaseStorageKey());
      if (raw == null) return null;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  /** Monotonic — the recorded position never rewinds (demotions keep their own UX). */
  private setLastSeenPhaseIndex(idx: number): void {
    try {
      const prev = this.getLastSeenPhaseIndex();
      if (prev != null && prev >= idx) return;
      localStorage.setItem(this.lastSeenPhaseStorageKey(), String(idx));
    } catch { /* ignore */ }
  }

  /** Tween the dot along the path between two phase platforms. */
  private async animateTravelerBetweenPhases(fromIndex: number, toIndex: number): Promise<void> {
    const from = this.mapNodes[fromIndex];
    const to = this.mapNodes[toIndex];
    if (!from || !to || toIndex <= fromIndex) return;

    this.travelerVisible = true;
    this.travelerPhaseIndex = null;
    this.travelerOnRoadblock = false;
    this.travelerXPct = from.xPct;
    this.travelerYPct = from.yPct;
    this.travelerAnimating = true;
    this.updateTravelerMapMode();
    this.cdr.markForCheck();

    const durationMs = 1100 + Math.max(0, toIndex - fromIndex - 1) * 350;
    const path = this.el.nativeElement.querySelector('.journey-map-path-line') as SVGPathElement | null;

    try {
      if (path && this.mapPathD) {
        const lenStart = this.findPathLengthAtPoint(path, from.xPct, from.yPct, 0);
        const lenEnd = this.findPathLengthAtPoint(path, to.xPct, to.yPct, lenStart + 0.001);
        if (lenEnd > lenStart) {
          await this.animateTravelerPathLength(path, lenStart, lenEnd, durationMs);
          return;
        }
      }
      await this.animateTravelerSegment(
        { x: from.xPct, y: from.yPct },
        { x: to.xPct, y: to.yPct },
        durationMs
      );
    } finally {
      this.travelerAnimating = false;
      this.updateTravelerMapMode();
    }
  }

  private async playRoadblockTravelSequence(
    node: RoadblockNode,
    opts?: { force?: boolean; openQuiz?: boolean; mockQuiz?: boolean }
  ): Promise<void> {
    if (this.travelerAnimating) return;
    if (!opts?.force && this.hasSeenRoadblockTravel(node.afterPhase)) {
      this.roadblockTravelQueued = false;
      this.syncTravelerRestingPosition();
      return;
    }

    const pathIndices = resolveRoadblockTravelPathIndices(
      this.chapterTheme,
      this.phaseRows.length,
      node.afterPhase
    );
    const waypoints = resolveRoadblockTravelWaypoints(
      this.chapterTheme,
      this.phaseRows.length,
      node.afterPhase
    );
    if (!pathIndices && (!waypoints || waypoints.length < 2)) {
      this.roadblockTravelQueued = false;
      if (opts?.openQuiz) {
        await this.onRoadblockTap(node, opts.mockQuiz ? { mock: true, skipStateCheck: true } : undefined);
      } else {
        this.syncTravelerRestingPosition();
      }
      return;
    }

    await this.animateTravelerToPathIndicesOrWaypoints(pathIndices, waypoints);
    this.markRoadblockTravelSeen(node.afterPhase);
    this.roadblockTravelQueued = false;
    this.cdr.markForCheck();

    if (opts?.openQuiz) {
      await this.onRoadblockTap(
        node,
        opts.mockQuiz ? { mock: true, skipStateCheck: true } : undefined
      );
      return;
    }

    this.syncTravelerRestingPosition();
  }

  /** After clearing a gate: animate the blue dot from the gate to the next platform. */
  private async playPostRoadblockTravelSequence(node: RoadblockNode): Promise<void> {
    if (this.travelerAnimating) return;

    const waypoints = resolvePostRoadblockTravelWaypoints(
      this.chapterTheme,
      this.phaseRows.length,
      node.afterPhase
    );
    const pathIndices = resolvePostRoadblockPathIndices(
      this.chapterTheme,
      this.phaseRows.length,
      node.afterPhase
    );
    if (!waypoints && !pathIndices) return;

    if (!this.pathReady) {
      await new Promise<void>(resolve => {
        const wait = () => {
          if (this.pathReady) {
            resolve();
            return;
          }
          requestAnimationFrame(wait);
        };
        requestAnimationFrame(wait);
      });
    }

    await this.animateTravelerToPathIndicesOrWaypoints(pathIndices, waypoints);
    this.travelerArrivedPhaseIndex = node.afterPhase + 1;
    // Record the arrival so the plain phase-movement animation doesn't replay
    // this same hop on the next page entry.
    this.setLastSeenPhaseIndex(this.travelerArrivedPhaseIndex);
    this.restTravelerAtPhase(this.travelerArrivedPhaseIndex);
  }

  private setTravelerVisible(visible: boolean): void {
    this.travelerVisible = visible;
    if (!visible) {
      this.travelerPhaseIndex = null;
      this.travelerOnRoadblock = false;
    }
    this.updateTravelerMapMode();
  }

  private hideTravelerDot(): void {
    this.travelerVisible = false;
    this.travelerOnRoadblock = false;
    this.updateTravelerMapMode();
  }

  /** The current active gate (if any) the student is parked at. */
  private activeRoadblockGate(): RoadblockNode | null {
    return this.roadblockNodes.find(
      rb => rb.state === 'active' && !this.devRoadblockForceActive
    ) || null;
  }

  /** Park the blue dot directly on an active roadblock gate. */
  private restTravelerAtRoadblock(node: RoadblockNode): void {
    this.travelerXPct = node.x;
    this.travelerYPct = node.y;
    this.travelerPhaseIndex = null;
    this.travelerOnRoadblock = true;
    this.travelerVisible = true;
    this.updateTravelerMapMode();
    this.cdr.markForCheck();
  }

  private updateTravelerMapMode(): void {
    this.travelerMapMode = this.travelerVisible || this.roadblockBusy || this.travelerAnimating;
  }

  /** Rest the dot on a phase platform (used after animations + on page load). */
  private restTravelerAtPhase(phaseIndex: number): void {
    const node = this.mapNodes[phaseIndex];
    if (!node) {
      this.setTravelerVisible(false);
      this.cdr.markForCheck();
      return;
    }
    this.travelerXPct = node.xPct;
    this.travelerYPct = node.yPct;
    this.travelerPhaseIndex = phaseIndex;
    this.travelerOnRoadblock = false;
    this.travelerVisible = true;
    this.updateTravelerMapMode();
    this.cdr.markForCheck();
  }

  /**
   * Show the blue dot wherever the student is idling: parked ON an active
   * roadblock gate if one is blocking them, otherwise on the current phase.
   * Single source of truth for "you are here" — never leaves the green
   * placeholder showing on its own.
   */
  private syncTravelerRestingPosition(): void {
    if (this.travelerAnimating || this.visitingChapter || this.roadblockTravelQueued) {
      return;
    }
    const gate = this.activeRoadblockGate();
    if (gate) {
      this.restTravelerAtRoadblock(gate);
      return;
    }
    const idx = this.resolveTravelerRestPhaseIndex();
    if (idx == null) {
      this.setTravelerVisible(false);
      this.cdr.markForCheck();
      return;
    }
    this.restTravelerAtPhase(idx);
  }

  private resolveTravelerRestPhaseIndex(): number | null {
    if (!this.phaseRows.length) return null;
    const activeIdx = this.phaseRows.findIndex(r => r.status === 'active');
    if (activeIdx >= 0) {
      if (this.travelerArrivedPhaseIndex != null && this.travelerArrivedPhaseIndex > activeIdx) {
        return this.travelerArrivedPhaseIndex;
      }
      if (activeIdx >= (this.travelerArrivedPhaseIndex ?? -1)) {
        this.travelerArrivedPhaseIndex = null;
      }
      return activeIdx;
    }
    if (this.travelerArrivedPhaseIndex != null) {
      return this.travelerArrivedPhaseIndex;
    }
    const lastCompleted = this.phaseRows.reduce(
      (acc, row, i) => (row.status === 'completed' ? i : acc),
      -1
    );
    if (lastCompleted >= 0) return lastCompleted;
    return 0;
  }

  private async animateTravelerToPathIndicesOrWaypoints(
    pathIndices: { fromIndex: number; toIndex: number } | null,
    waypoints: { x: number; y: number }[] | null
  ): Promise<void> {
    if (pathIndices) {
      await this.animateTravelerPathIndices(pathIndices.fromIndex, pathIndices.toIndex);
      return;
    }
    if (waypoints && waypoints.length >= 2) {
      await this.animateTravelerThrough(waypoints);
    }
  }

  private async animateTravelerPathIndices(fromIndex: number, toIndex: number): Promise<void> {
    const pathPts = this.resolvePathPts(this.phaseRows.length);
    const from = pathPts[fromIndex];
    const to = pathPts[toIndex];
    if (!from || !to || toIndex <= fromIndex) return;

    this.travelerVisible = true;
    this.travelerPhaseIndex = null;
    this.travelerOnRoadblock = false;
    this.travelerXPct = from.x;
    this.travelerYPct = from.y;
    this.travelerAnimating = true;
    this.updateTravelerMapMode();
    this.cdr.markForCheck();

    const durationMs = 1100 + Math.max(0, toIndex - fromIndex - 1) * 350;
    const path = this.el.nativeElement.querySelector('.journey-map-path-line') as SVGPathElement | null;

    try {
      if (path && this.mapPathD) {
        const lenStart = this.findPathLengthAtLayoutWaypoint(path, pathPts, fromIndex);
        const lenEnd = this.findPathLengthAtLayoutWaypoint(path, pathPts, toIndex);
        if (lenEnd > lenStart) {
          await this.animateTravelerPathLength(path, lenStart, lenEnd, durationMs);
          return;
        }
      }
      await this.animateTravelerSegment(from, to, durationMs);
    } finally {
      this.travelerAnimating = false;
      this.updateTravelerMapMode();
    }
  }

  private findPathLengthAtLayoutWaypoint(
    path: SVGPathElement,
    pathPts: PathWaypoint[],
    index: number
  ): number {
    const minLen = index > 0
      ? this.findPathLengthAtLayoutWaypoint(path, pathPts, index - 1) + 0.001
      : 0;
    const pt = pathPts[index];
    return this.findPathLengthAtPoint(path, pt.x, pt.y, minLen);
  }

  private animateTravelerPathLength(
    path: SVGPathElement,
    lenStart: number,
    lenEnd: number,
    durationMs: number
  ): Promise<void> {
    return new Promise(resolve => {
      const t0 = performance.now();
      const step = (now: number) => {
        const raw = Math.min(1, (now - t0) / durationMs);
        const eased = raw * (2 - raw);
        const len = lenStart + (lenEnd - lenStart) * eased;
        const p = path.getPointAtLength(len);
        this.travelerXPct = p.x;
        this.travelerYPct = p.y;
        this.cdr.markForCheck();
        if (raw < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  private animateTravelerThrough(waypoints: { x: number; y: number }[]): Promise<void> {
    const start = waypoints[0];
    const end = waypoints[waypoints.length - 1];
    this.travelerVisible = true;
    this.travelerPhaseIndex = null;
    this.travelerOnRoadblock = false;
    this.travelerXPct = start.x;
    this.travelerYPct = start.y;
    this.travelerAnimating = true;
    this.updateTravelerMapMode();
    this.cdr.markForCheck();

    const durationMs = 1100 + Math.max(0, waypoints.length - 2) * 350;
    return this.animateTravelerSegment(start, end, durationMs).finally(() => {
      this.travelerAnimating = false;
      this.updateTravelerMapMode();
    });
  }

  /** Closest path-length sample to a viewBox coordinate (0–100). */
  private findPathLengthAtPoint(
    path: SVGPathElement,
    x: number,
    y: number,
    minLength = 0
  ): number {
    const total = path.getTotalLength();
    if (!total) return 0;

    const steps = Math.max(240, Math.ceil(total * 10));
    let bestLen = 0;
    let bestDist = Infinity;

    for (let i = 0; i <= steps; i++) {
      const len = (total * i) / steps;
      if (len < minLength) continue;
      const p = path.getPointAtLength(len);
      const dist = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestLen = len;
      }
    }
    if (bestDist === Infinity && minLength > 0) {
      return this.findPathLengthAtPoint(path, x, y, 0);
    }
    return bestLen;
  }

  /** Straight-line fallback when the SVG path is not mounted yet. */
  private animateTravelerSegment(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs: number
  ): Promise<void> {
    return new Promise(resolve => {
      const start = performance.now();
      const step = (now: number) => {
        const raw = Math.min(1, (now - start) / durationMs);
        const t = raw * (2 - raw);
        this.travelerXPct = from.x + (to.x - from.x) * t;
        this.travelerYPct = from.y + (to.y - from.y) * t;
        this.cdr.markForCheck();
        if (raw < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  /** Tap a chest → animate open, claim (if eligible), reveal reward. */
  async onChestTap(node: ChestNode): Promise<void> {
    if (this.chestBusy) return;

    if (node.state === 'locked' && !this.isDev) {
      this.showToast(this.translate.instant('JOURNEY.CHEST.LOCKED_TOAST'), 'warning');
      return;
    }

    this.chestBusy = true;
    try {
      // Already opened — show reward again, no re-animation.
      if (node.state === 'claimed') {
        const existing = (this.plan?.claimedChests || []).find(c => c.chestId === node.chestId);
        if (existing) {
          await this.presentChestRewardModal({
            tier: existing.tier,
            xp: existing.xp,
            totalXp: this.plan?.journeyXp ?? existing.xp,
            alreadyClaimed: true,
            chestSide: node.side
          }, node);
        }
        return;
      }

      if (!node.bakedIn) {
        await this.playChestOpenAnimation(node);
      }

      let reward: { tier: 'bronze' | 'silver' | 'gold'; xp: number; chestId: string; phaseIndex: number; chapterIndex: number; claimedAt: string } | null = null;
      let journeyXp = this.plan?.journeyXp ?? 0;
      let alreadyClaimed = false;

      try {
        const res = await firstValueFrom(
          this.learningPlanService.claimChest(this.language, node.chestId, node.phaseIndex).pipe(take(1))
        );
        if (res?.reward) {
          reward = res.reward;
          journeyXp = res.journeyXp ?? journeyXp;
          alreadyClaimed = !!res.alreadyClaimed;
        } else if (this.isDev) {
          reward = this.mockChestReward(node);
          journeyXp += reward.xp;
        } else if (res?.locked) {
          node.spriteFrame = 0;
          node.opening = false;
          node.state = 'locked';
          this.cdr.markForCheck();
          this.showToast(this.translate.instant('JOURNEY.CHEST.LOCKED_TOAST'), 'warning');
          return;
        }
      } catch {
        if (!this.isDev) throw new Error('chest_claim_failed');
        reward = this.mockChestReward(node);
        journeyXp += reward.xp;
      }

      if (!reward) return;

      this.claimedChestIds.add(node.chestId);
      node.state = 'claimed';
      node.tier = reward.tier;
      node.spriteFrame = node.frameUrls.length - 1;
      node.opening = false;
      if (this.plan) {
        this.plan.journeyXp = journeyXp;
        if (!alreadyClaimed) {
          this.plan.claimedChests = [...(this.plan.claimedChests || []), reward];
        }
      }
      this.cdr.markForCheck();

      await this.presentChestRewardModal({
        tier: reward.tier,
        xp: reward.xp,
        totalXp: journeyXp,
        alreadyClaimed,
        chestSide: node.side
      }, node);
    } catch {
      node.spriteFrame = 0;
      node.opening = false;
      this.cdr.markForCheck();
      this.showToast(this.translate.instant('COMMON.ERROR_GENERIC') || 'Something went wrong', 'danger');
    } finally {
      this.chestBusy = false;
    }
  }

  private async presentChestRewardModal(
    props: {
      tier: 'bronze' | 'silver' | 'gold';
      xp: number;
      totalXp: number;
      alreadyClaimed: boolean;
      chestSide: 'left' | 'right';
    },
    chestNode?: ChestNode
  ): Promise<void> {
    const bounds = chestNode ? this.captureChestBounds(chestNode) : null;
    this.chestModalBounds = bounds;

    const modal = await this.modalCtrl.create({
      component: ChestRewardModalComponent,
      componentProps: props,
      cssClass: 'journey-chest-modal',
      backdropDismiss: true,
      enterAnimation: (baseEl) => this.createChestModalEnterAnimation(baseEl),
      leaveAnimation: (baseEl) => this.createChestModalLeaveAnimation(baseEl)
    });
    await modal.present();
    await modal.onDidDismiss();
    this.chestModalBounds = null;
  }

  createChestModalEnterAnimation = (baseEl: HTMLElement) => {
    const bounds = this.chestModalBounds;
    if (!bounds) return this.fadeModalAnimation(baseEl, '0', '1');
    return this.createPhaseZoomEnterAnimation(baseEl, bounds, 1);
  };

  createChestModalLeaveAnimation = (baseEl: HTMLElement) => {
    const bounds = this.chestModalBounds;
    if (!bounds) return this.fadeModalAnimation(baseEl, '1', '0', 250);
    return this.createPhaseZoomLeaveAnimation(baseEl, bounds, 1);
  };

  private captureChestBounds(node: ChestNode): { x: number; y: number; width: number; height: number } | null {
    const hotspot = this.el.nativeElement.querySelector(
      `[data-chest-id="${node.chestId}"]`
    ) as HTMLElement | null;

    const safeTop = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ion-safe-area-top')) || 0;

    if (hotspot) {
      const rect = hotspot.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height, 44);
      return {
        x: rect.left + rect.width / 2 - size / 2,
        y: rect.top - safeTop + rect.height / 2 - size / 2,
        width: size,
        height: size
      };
    }

    const stage = this.el.nativeElement.querySelector('.journey-map-stage') as HTMLElement | null;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const size = 44;
    const cx = rect.left + (node.x / 100) * rect.width;
    const cy = rect.top + (node.y / 100) * rect.height;
    return {
      x: cx - size / 2,
      y: cy - safeTop - size / 2,
      width: size,
      height: size
    };
  }

  /** Local-only reward when testing chest UX without a completed phase. */
  private mockChestReward(node: ChestNode) {
    return {
      chestId: node.chestId,
      chapterIndex: this.chapterIndex,
      phaseIndex: node.phaseIndex,
      tier: 'gold' as const,
      xp: 100,
      claimedAt: new Date().toISOString()
    };
  }

  /** Flip through preloaded frames (no src swapping — avoids decode jank). */
  private async playChestOpenAnimation(node: ChestNode): Promise<void> {
    if (this.chestFramesReady) await this.chestFramesReady;
    node.opening = true;
    const last = node.frameUrls.length - 1;
    const frameMs = 180;
    for (let f = 0; f <= last; f++) {
      node.spriteFrame = f;
      this.cdr.markForCheck();
      if (f < last) {
        await new Promise<void>(r => setTimeout(r, frameMs));
      }
    }
    node.opening = false;
    this.cdr.markForCheck();
  }

  private revealMapPath(nextD: string): void {
    this.mapPathD = nextD;
    this.pathReady = false;
    this.mapPathMeasurePending = true;

    const mount = () => {
      this.mapPathDashLen = this.measurePathDashForD(nextD);
      this.pathReady = true;
      this.mapPathMeasurePending = false;
      this.ensureMapStageResizeObserver();
      this.cdr.markForCheck();
    };

    const stage = this.el.nativeElement.querySelector('.journey-map-stage') as HTMLElement | null;
    const rect = stage?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) {
      requestAnimationFrame(() => requestAnimationFrame(mount));
      return;
    }
    mount();
  }

  private ensureMapStageResizeObserver(): void {
    const stage = this.el.nativeElement.querySelector('.journey-map-stage') as HTMLElement | null;
    if (!stage || typeof ResizeObserver === 'undefined') return;

    if (!this.mapStageResizeObserver) {
      this.mapStageResizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry?.contentRect.width) {
          const w = Math.ceil(entry.contentRect.width);
          if (w > 0) {
            const next = `${w}px`;
            if (this.backgroundSizes !== next) {
              this.backgroundSizes = next;
              this.cdr.markForCheck();
            }
          }
        }
        if (!this.mapPathD || this.mapPathMeasurePending) return;
        const measured = this.measurePathDashForD(this.mapPathD);
        if (measured > this.mapPathDashLen + 4) {
          this.mapPathDashLen = measured;
          this.pathReady = false;
          requestAnimationFrame(() => {
            this.pathReady = true;
            this.cdr.markForCheck();
          });
        }
      });
    }

    if (!this.mapStageResizeObserver) return;
    try {
      this.mapStageResizeObserver.disconnect();
      this.mapStageResizeObserver.observe(stage);
    } catch {
      // Stage may be mid-unmount.
    }
  }

  /** Measure the rendered pixel length of a path `d` on the live map stage. */
  private measurePathDashForD(d: string): number {
    if (!d) return 500;
    const stage = this.el.nativeElement.querySelector('.journey-map-stage') as HTMLElement | null;
    if (!stage) return 500;

    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return this.mapPathDashLen || 500;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;visibility:hidden;pointer-events:none;';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    stage.appendChild(svg);

    const pxLen = this.samplePathScreenPixelLength(path);
    stage.removeChild(svg);
    return Math.max(500, Math.ceil(pxLen + 24));
  }

  private samplePathScreenPixelLength(path: SVGPathElement): number {
    const total = path.getTotalLength();
    if (!total) return 0;

    const svg = path.ownerSVGElement;
    const ctm = path.getScreenCTM();
    if (!svg || !ctm) return 0;

    const pt = svg.createSVGPoint();
    const toScreen = (x: number, y: number) => {
      pt.x = x;
      pt.y = y;
      const s = pt.matrixTransform(ctm);
      return { x: s.x, y: s.y };
    };

    const steps = Math.max(48, Math.ceil(total * 3));
    let len = 0;
    const start = path.getPointAtLength(0);
    let prev = toScreen(start.x, start.y);

    for (let i = 1; i <= steps; i++) {
      const p = path.getPointAtLength((total * i) / steps);
      const s = toScreen(p.x, p.y);
      len += Math.hypot(s.x - prev.x, s.y - prev.y);
      prev = s;
    }
    return len;
  }

  /** Build a smooth winding SVG path string from the active theme's
   *  waypoints using a Catmull-Rom → cubic-Bezier conversion. The path
   *  is drawn in the same 100×100 viewBox as the map canvas so node
   *  positions and the path stay perfectly in sync. */
  private buildSvgPathD(pts?: PathWaypoint[]): string {
    const pathPts = pts ?? this.resolvePathPts(this.phaseRows.length || 4);
    if (pathPts.length < 2) return '';
    const tension = 0.5; // 0.5 ≈ Catmull-Rom; lower = tighter curve
    let d = `M ${pathPts[0].x} ${pathPts[0].y}`;
    for (let i = 0; i < pathPts.length - 1; i++) {
      const p0 = pathPts[i - 1] || pathPts[i];
      const p1 = pathPts[i];
      const p2 = pathPts[i + 1];
      const p3 = pathPts[i + 2] || p2;
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
  private prefetchBackground(theme: string, phaseCount = 4) {
    if (!theme) return;
    const img = new Image();
    img.src = journeyBackgroundUrl(theme, phaseCount);
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
    this.refreshPhaseDetailModal();
  }

  cancelEdit(row: PhaseRow, event?: Event) {
    event?.stopPropagation();
    row.editing = false;
    this.refreshPhaseDetailModal();
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
    this.refreshPhaseDetailModal();

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
        this.refreshPhaseDetailModal();
      },
      error: (err) => {
        row.saving = false;
        this.showToast(err?.error?.message || this.translate.instant('JOURNEY.EDIT.SAVE_FAILED'), 'danger');
        this.refreshPhaseDetailModal();
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

  private showToast(message: string, color: 'success' | 'warning' | 'danger') {
    void this.toastService.showLegacy(message, color);
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
          this.recomputeTrialFraming();
          this.recomputePrimaryCta();
          this.cdr.markForCheck();
        }
        // Practice deck is loaded after comingUp so the CTA can prefer
        // upcoming-lesson signals when both apply.
        this.loadPracticeDueCount();
      },
      error: () => {
        this.comingUp = [];
        this.recomputeTrialFraming();
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
  /** Derive the trial-aware framing for the journey hero. We trust the
   *  literal next booked event — comingUp[0].isTrialLesson — because the
   *  backend marks per-tutor trials regardless of total lessons taken. */
  private recomputeTrialFraming() {
    const next = this.comingUp[0];
    if (next?.isTrialLesson) {
      this.pendingTrial = true;
      this.nextTrialTutorFirstName = next.tutor?.firstName || '';
    } else {
      this.pendingTrial = false;
      this.nextTrialTutorFirstName = '';
    }
  }

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
