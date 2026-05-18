import { Component, Input, Output, EventEmitter, ViewEncapsulation, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Home-page Journey widget (replaces the empty student earnings slot).
 *
 * Renders a horizontal phase progression + active phase title + summary line
 * + goal anchor. Whole card is the tap target — no internal CTAs (the Up Next
 * card owns the "do the thing now" CTA).
 *
 * States:
 *   - state="loading"    → skeleton shimmer
 *   - state="empty-goal" → "Set your goal to unlock your journey"
 *   - state="draft"      → has goal + plan, no lesson taken yet
 *   - state="active"     → normal full-data view
 *   - state="completed"  → "You finished this language path — set a new goal"
 *   - state="unframed"   → student opted out of a structured plan
 *   - state="paused"     → student paused an existing plan
 */
// Floor mirrors backend masteryService.js MIN_LESSONS_PER_PHASE.
// The 70 mastery threshold deliberately isn't mirrored — student-facing
// UI never references the raw score or the threshold (see
// docs/learning-journey/voice-and-framing.md).
const MASTERY_FLOOR = 3;

@Component({
  selector: 'app-journey-widget',
  templateUrl: './journey-widget.component.html',
  styleUrls: ['./journey-widget.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  encapsulation: ViewEncapsulation.None
})
export class JourneyWidgetComponent implements OnChanges {
  @Input() state: 'loading' | 'empty-goal' | 'draft' | 'active' | 'completed' | 'unframed' | 'paused' = 'loading';
  @Input() variant: 'compact' | 'full' = 'compact';
  @Input() phaseLabels: string[] = [];
  @Input() currentPhaseIndex = 0;
  @Input() phaseTitle = '';
  @Input() summary = '';
  @Input() nextLessonFocus = '';
  @Input() goalLabel = '';
  @Input() languageLabel = '';

  /** Rolling-window mastery average for the current phase (0–100), null if no lessons yet.
   *  Kept *internal*: drives the bar fill % only. We never display the number — see
   *  voice-and-framing.md. */
  @Input() masteryAverage: number | null = null;
  /** How many lessons the student has taken in the current phase. */
  @Input() lessonsCompleted = 0;
  /** Estimated lessons for the current phase (default 5). */
  @Input() estimatedLessons = 5;
  /** Server-attached qualitative progress state (preferred). When provided,
   *  the widget uses this label instead of computing one locally. */
  @Input() progressState: 'getting_started' | 'building' | 'progressing' | 'ready_soon' | 'wrapping_up' | null = null;
  /** Localized label for `progressState` (computed by parent against i18n). */
  @Input() progressStateLabel = '';
  /** Server-attached 0–100 visual cue for the floor → ceiling window (preferred over local mastery %). */
  @Input() windowProgressPercent: number | null = null;
  /** Premium tier flag — drives the "Premium" chip in the header. */
  @Input() isPremium = false;
  /** True when the active phase is a recovery (bridge) phase that the
   *  student landed on after a chapter demotion. Drives a soft eyebrow
   *  ("Steadying things back at {level}") and tonal copy on the widget,
   *  matching the recovery callout on the journey page. Voice rules in
   *  docs/learning-journey/voice-and-framing.md. */
  @Input() isRecovery = false;
  /** When true, hide the bottom "View roadmap →" CTA (e.g. on the journey page itself). */
  @Input() hideRoadmapCta = false;

  // ── Paused-state display data (precomputed by the parent page) ──────
  /** Current CEFR level chip ("A1".."C2"). Shown on the paused card. */
  @Input() cefrLevel = '';
  /** Number of chapters the student has graduated through. */
  @Input() chaptersCompletedCount = 0;
  /** Total lessons across the whole journey (current + completed chapters). */
  @Input() totalLessonsCompleted = 0;
  /** Human label like "Paused 3 days ago". Empty when unknown. */
  @Input() pausedSinceLabel = '';
  /** Earned gamification badges to surface in the paused/unframed
   *  card's badge stack. Source of truth is `GamificationService`;
   *  parent passes the pre-filtered "earned only" subset. Each entry
   *  is rendered as a small colored disc with an icon — consistency
   *  streaks, lesson milestones, level achievements, skill badges. */
  @Input() earnedBadges: Array<{ id: string; icon: string; color: string; name: string }> = [];

  // ── Latest-lesson highlight (paused & unframed) ─────────────────────
  /** One-line takeaway from the most recent lesson analysis, softly
   *  framed (e.g. "Past tense agreement showed up again."). Empty when
   *  no recent analysis is available. */
  @Input() latestLessonHighlight = '';
  /** Tutor first name attached to the highlight ("Maria"). Optional. */
  @Input() latestLessonTutor = '';
  /** Human "how long ago" label ("2 days ago"). Optional. */
  @Input() latestLessonAgo = '';
  /** Smart adaptive primary CTA shown on the JOURNEY page (not on home).
   *  Owner provides a label + click handler; widget only renders the pill. */
  @Input() primaryCtaLabel = '';
  @Input() primaryCtaSubLabel = '';
  @Input() primaryCtaIcon = 'arrow-forward-outline';
  @Output() primaryCtaTap = new EventEmitter<void>();

  @Output() widgetTap = new EventEmitter<void>();
  @Output() setGoalTap = new EventEmitter<void>();
  /** Emitted from the unframed-state CTA ("Build me a plan"). */
  @Output() buildPlanTap = new EventEmitter<void>();
  /** Emitted from the paused-state CTA ("Resume my plan"). */
  @Output() resumePlanTap = new EventEmitter<void>();

  phaseNodes: Array<{ label: string; status: 'completed' | 'active' | 'locked' | 'destination'; index: number }> = [];

  // Precomputed display values — no functions called from template.
  masteryBarPercent = 0;
  masteryStatusLabel = '';
  masteryReady = false;

  /** Always-rendered "Phase progress" bar percent (0-100). */
  phaseProgressPercent = 0;
  /** Right-aligned label for the progress row (e.g. "25% complete" / "Just starting" / "Ready to advance"). */
  phaseProgressRightLabel = '';

  /** Cap of stacked badges shown before overflowing into "+N". */
  private static readonly MAX_VISIBLE_BADGES = 5;
  visibleEarnedBadges: Array<{ id: string; icon: string; color: string; name: string }> = [];
  earnedBadgesOverflow = 0;

  ngOnChanges(_changes: SimpleChanges) {
    this.recomputePhaseNodes();
    this.recomputeMastery();
    this.recomputePhaseProgress();
    this.recomputeBadgeStack();
  }

  private recomputePhaseNodes() {
    const labels = this.phaseLabels || [];
    const last = Math.max(0, labels.length - 1);
    this.phaseNodes = labels.map((label, i) => {
      let status: 'completed' | 'active' | 'locked' | 'destination';
      if (i < this.currentPhaseIndex) status = 'completed';
      else if (i === this.currentPhaseIndex) status = 'active';
      else if (i === last) status = 'destination';
      else status = 'locked';
      return { label, status, index: i };
    });
  }

  private recomputeMastery() {
    // Internal-only: derives the bar fill % and the "ready" highlight.
    // The raw score is never displayed; we use it only to drive the
    // soft "ready_soon" tint when no server-attached state is available.
    const done = this.lessonsCompleted || 0;
    const avg = this.masteryAverage;

    if (this.windowProgressPercent !== null && this.windowProgressPercent !== undefined) {
      this.masteryBarPercent = Math.max(0, Math.min(100, this.windowProgressPercent));
    } else if (done === 0) {
      this.masteryBarPercent = 0;
    } else if (done < MASTERY_FLOOR) {
      this.masteryBarPercent = Math.round((done / MASTERY_FLOOR) * 50);
    } else {
      const pct = avg !== null ? Math.max(0, Math.min(100, avg)) : 50;
      this.masteryBarPercent = pct;
    }

    this.masteryReady =
      this.progressState === 'ready_soon' ||
      this.progressState === 'wrapping_up';
    this.masteryStatusLabel = '';
  }

  private recomputeBadgeStack() {
    const all = this.earnedBadges || [];
    const max = JourneyWidgetComponent.MAX_VISIBLE_BADGES;
    if (all.length <= max) {
      this.visibleEarnedBadges = all.slice();
      this.earnedBadgesOverflow = 0;
      return;
    }
    // Parent passes badges in priority order (streak → level → skill → lesson),
    // so we keep the first N and overflow the rest into a "+N" pill.
    this.visibleEarnedBadges = all.slice(0, max);
    this.earnedBadgesOverflow = all.length - max;
  }

  private recomputePhaseProgress() {
    this.phaseProgressPercent = this.masteryBarPercent;

    if (this.state === 'completed') {
      this.phaseProgressPercent = 100;
      this.phaseProgressRightLabel = 'Complete';
      return;
    }
    if ((this.lessonsCompleted || 0) === 0) {
      this.phaseProgressPercent = 0;
      this.phaseProgressRightLabel = 'Just starting';
      return;
    }
    // Prefer the server-attached qualitative label. No raw % is ever
    // surfaced — see voice-and-framing.md.
    if (this.progressStateLabel) {
      this.phaseProgressRightLabel = this.progressStateLabel;
      return;
    }
    // Fallback when an older payload doesn't include `progressState`.
    if (this.masteryReady) {
      this.phaseProgressRightLabel = 'Ready to move on soon';
    } else {
      this.phaseProgressRightLabel = 'Building progress';
    }
  }

  onCardClick() {
    if (this.state === 'empty-goal') {
      this.setGoalTap.emit();
    } else if (this.state === 'unframed') {
      this.buildPlanTap.emit();
    } else if (this.state === 'paused') {
      this.resumePlanTap.emit();
    } else if (this.state !== 'loading') {
      this.widgetTap.emit();
    }
  }
}
