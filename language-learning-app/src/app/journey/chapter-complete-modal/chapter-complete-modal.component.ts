import {
  Component, Input, ChangeDetectionStrategy, Output, EventEmitter,
  CUSTOM_ELEMENTS_SCHEMA
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
// Side-effect import — registers <dotlottie-player> as a custom element.
// Same pattern used by tab3.page.ts.
import '@dotlottie/player-component';

/** Subset of the tab3 Badge interface we need to render the unlock pill. */
interface BadgeMeta {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
}

/**
 * Chapter graduation / demotion / mastery-mode celebration modal.
 *
 * Mode-driven so we don't proliferate near-identical modals:
 *   - 'graduated'    → full-screen celebratory badge, "you earned the next chapter"
 *   - 'demoted'      → friendly "let's strengthen your foundations" copy
 *   - 'mastery_mode' → final celebration after C2
 *   - 'promoted'     → calibration-driven promotion (positive surprise)
 *
 * Single CTA dismisses + emits an ack event so the page can:
 *   1. POST /ack-transition (via parent)
 *   2. Trigger 1.2s background cross-fade (already a CSS transition on
 *      .journey-map-canvas — happens automatically when chapterTheme changes)
 *
 * See docs/learning-journey/scenarios.md (G33, G34) for re-display rules.
 */
@Component({
  selector: 'app-chapter-complete-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IonicModule, TranslateModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA], // for <dotlottie-player>
  template: `
    <div class="ccm-root" [class]="'ccm-root--' + mode">

      <!-- Confetti shower (graduated / promoted / mastery_mode only).
           50 staggered pieces, two waves, ~5s each. Same look used by
           the milestone snapshot celebration in tab3. -->
      <div class="ccm-confetti-container" *ngIf="showConfetti">
        <div
          class="ccm-confetti-piece"
          *ngFor="let i of confettiPieces"
          [attr.data-i]="i"></div>
      </div>

      <button class="ccm-close" type="button" (click)="onDismiss()" aria-label="Close">
        <ion-icon name="close"></ion-icon>
      </button>

      <ion-content>
        <div class="ccm-body">

          <!-- ── TOP HERO (always full-width) ────────────────────────── -->
          <div class="ccm-hero">
            <div class="ccm-trophy-wrapper" *ngIf="showTrophy">
              <div class="ccm-trophy-glow"></div>
              <dotlottie-player
                src="/assets/Trophy.lottie"
                autoplay
                speed="1"
                class="ccm-trophy-lottie"></dotlottie-player>
            </div>

            <div class="ccm-soft-badge" *ngIf="!showTrophy">
              <ion-icon name="leaf-outline"></ion-icon>
            </div>

            <h1 class="ccm-title">{{ titleKey | translate }}</h1>

            <p class="ccm-sub" *ngIf="fromLevel && toLevel && mode !== 'mastery_mode'">
              {{ fromLevel }} <ion-icon name="arrow-forward"></ion-icon> {{ toLevel }}
            </p>
          </div>

          <!-- ── TWO-COLUMN GRID (collapses to one column on narrow) ─── -->
          <div class="ccm-grid">

            <!-- Left column: progress stats + descriptive body copy. -->
            <div class="ccm-col ccm-col--info">
              <div class="ccm-stats" *ngIf="masteryLabelKey || lessonsCompleted">
                <div class="ccm-stat ccm-stat--word" *ngIf="masteryLabelKey">
                  <div class="ccm-stat-value">{{ masteryLabelKey | translate }}</div>
                  <div class="ccm-stat-label">{{ 'JOURNEY.CHAPTER_COMPLETE.MASTERY' | translate }}</div>
                </div>
                <div class="ccm-stat" *ngIf="lessonsCompleted">
                  <div class="ccm-stat-value">{{ lessonsCompleted }}</div>
                  <div class="ccm-stat-label">{{ 'JOURNEY.CHAPTER_COMPLETE.LESSONS_LABEL' | translate }}</div>
                </div>
              </div>

              <p class="ccm-body-text">{{ bodyKey | translate }}</p>
            </div>

            <!-- Right column: the unlocked progress-page badge.
                 Visual matches tab3's .badge-item exactly so the
                 student recognises it on /progress. -->
            <div class="ccm-col ccm-col--badge" *ngIf="badge">
              <div class="ccm-badge-eyebrow">
                {{ 'JOURNEY.CHAPTER_COMPLETE.BADGE_UNLOCKED' | translate }}
              </div>
              <div class="ccm-badge-card earned">
                <div class="ccm-badge-icon-wrapper" [style.background]="badge.color">
                  <ion-icon [name]="badge.icon"></ion-icon>
                </div>
                <div class="ccm-badge-name">{{ badge.name }}</div>
                <div class="ccm-badge-desc">{{ badge.description }}</div>
              </div>
              <div class="ccm-badge-hint">
                {{ 'JOURNEY.CHAPTER_COMPLETE.BADGE_HINT' | translate }}
              </div>
            </div>
          </div>

        </div>
      </ion-content>

      <ion-footer>
        <ion-toolbar>
          <div class="ccm-footer">
            <button class="ccm-cta" type="button" (click)="onDismiss()">
              {{ ctaKey | translate }}
            </button>
          </div>
        </ion-toolbar>
      </ion-footer>

    </div>
  `,
  styleUrls: ['./chapter-complete-modal.component.scss']
})
export class ChapterCompleteModalComponent {
  @Input() mode: 'graduated' | 'demoted' | 'mastery_mode' | 'promoted' = 'graduated';
  @Input() fromLevel: string | null = null;
  @Input() toLevel: string | null = null;
  @Input() masteryAtCompletion: number | null = null;
  @Input() lessonsCompleted: number | null = null;

  @Output() acknowledged = new EventEmitter<void>();

  // Hardcoded array used by the *ngFor confetti renderer — same approach
  // as the milestone snapshot celebration in tab3 to keep the SCSS
  // staggered-position rules simple (data-i="1"..."50").
  readonly confettiPieces = Array.from({ length: 50 }, (_, i) => i + 1);

  // Level → progress-page badge mapping. Mirrors the level badges in
  // tab3.page.ts (initializeBadges) so the celebration's "Badge unlocked"
  // pill matches what the student will see on their progress page.
  private static readonly LEVEL_BADGES: { [level: string]: BadgeMeta } = {
    A2: { id: 'level-a2', name: 'Breaking Through',     description: 'Reach A2 level',         icon: 'trending-up',      color: '#f59e0b' },
    B1: { id: 'level-b1', name: 'Intermediate Achiever', description: 'Reach B1 level',         icon: 'ribbon',           color: '#8b5cf6' },
    B2: { id: 'level-b2', name: 'Advanced Learner',     description: 'Reach B2 level',         icon: 'medal',            color: '#3b82f6' },
    C1: { id: 'level-c1', name: 'Proficiency Master',   description: 'Reach C1 level',         icon: 'shield-checkmark', color: '#22c55e' },
    C2: { id: 'level-c2', name: 'Native-Level Legend',  description: 'Reach C2 level',         icon: 'sparkles',         color: '#10b981' }
  };

  get showConfetti(): boolean {
    return this.mode === 'graduated' || this.mode === 'promoted' || this.mode === 'mastery_mode';
  }

  get showTrophy(): boolean {
    return this.mode === 'graduated' || this.mode === 'promoted' || this.mode === 'mastery_mode';
  }

  /** Badge to surface in the unlock pill. Only shown for upward
   *  transitions (graduated / promoted / mastery_mode) and only when
   *  the new level has a defined badge (A1 has no badge — it's the
   *  starting point). Returns null otherwise. */
  get badge(): BadgeMeta | null {
    if (this.mode !== 'graduated' && this.mode !== 'promoted' && this.mode !== 'mastery_mode') {
      return null;
    }
    const level = this.toLevel;
    if (!level) return null;
    return ChapterCompleteModalComponent.LEVEL_BADGES[level] || null;
  }

  constructor(private modalCtrl: ModalController) {}

  /**
   * Map `masteryAtCompletion` (0–100) → student-facing qualitative label.
   * The raw score is never shown — see docs/learning-journey/voice-and-framing.md.
   * Buckets are tuned for *finish* contexts (graduation/demotion celebration),
   * which is more emotive than the in-progress `phaseProgressState`.
   */
  get masteryLabelKey(): string | null {
    const m = this.masteryAtCompletion;
    if (m === null || m === undefined || !Number.isFinite(m)) return null;
    if (m >= 90) return 'JOURNEY.MASTERY_LABEL.MASTERED';
    if (m >= 80) return 'JOURNEY.MASTERY_LABEL.STRONG';
    if (m >= 70) return 'JOURNEY.MASTERY_LABEL.SOLID';
    if (m >= 60) return 'JOURNEY.MASTERY_LABEL.STEADY';
    return         'JOURNEY.MASTERY_LABEL.BUILDING';
  }

  get titleKey(): string {
    switch (this.mode) {
      case 'graduated':    return 'JOURNEY.CHAPTER_COMPLETE.TITLE_GRADUATED';
      case 'demoted':      return 'JOURNEY.CHAPTER_COMPLETE.TITLE_DEMOTED';
      case 'mastery_mode': return 'JOURNEY.CHAPTER_COMPLETE.TITLE_MASTERY';
      case 'promoted':     return 'JOURNEY.CHAPTER_COMPLETE.TITLE_PROMOTED';
    }
  }

  get bodyKey(): string {
    switch (this.mode) {
      case 'graduated':    return 'JOURNEY.CHAPTER_COMPLETE.BODY_GRADUATED';
      case 'demoted':      return 'JOURNEY.CHAPTER_COMPLETE.BODY_DEMOTED';
      case 'mastery_mode': return 'JOURNEY.CHAPTER_COMPLETE.BODY_MASTERY';
      case 'promoted':     return 'JOURNEY.CHAPTER_COMPLETE.BODY_PROMOTED';
    }
  }

  get ctaKey(): string {
    switch (this.mode) {
      case 'graduated':    return 'JOURNEY.CHAPTER_COMPLETE.CTA_OPEN_NEW_MAP';
      case 'demoted':      return 'JOURNEY.CHAPTER_COMPLETE.CTA_GOT_IT';
      case 'mastery_mode': return 'JOURNEY.CHAPTER_COMPLETE.CTA_ENTER_MASTERY';
      case 'promoted':     return 'JOURNEY.CHAPTER_COMPLETE.CTA_OPEN_NEW_MAP';
    }
  }

  onDismiss() {
    this.acknowledged.emit();
    this.modalCtrl.dismiss({ acknowledged: true });
  }
}
