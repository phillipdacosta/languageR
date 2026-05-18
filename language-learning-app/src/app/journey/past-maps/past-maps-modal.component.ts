import {
  Component, Input, OnInit, ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { take } from 'rxjs/operators';

import { LearningPlanService } from '../../services/learning-plan.service';

interface CompletedChapter {
  index: number;
  level: string;
  theme: string;
  completedAt: string;
  masteryAtCompletion: number | null;
  exitReason: 'graduated' | 'demoted' | 'calibrated';
  phaseTitles: string[];
  /** Pre-computed in `ngOnInit` so the template can `| translate` it directly
   *  (no template function calls per AGENTS.md). Null when no mastery score
   *  is available — the template skips the line in that case. */
  masteryLabelKey?: string | null;
}

/**
 * Past Maps modal — list of completed chapters with mini-thumbnails.
 *
 * Tap a chapter → emits a "visitChapter" event so the parent journey
 * page can swap the background temporarily and display a sticky badge
 * "Visiting Chapter X (read-only)".
 *
 * Empty state is built into the template (G — past maps empty state).
 */
@Component({
  selector: 'app-past-maps-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IonicModule, TranslateModule],
  template: `
    <ion-header class="pm-header">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="dismiss()">
            <ion-icon slot="icon-only" name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ 'JOURNEY.PAST_MAPS.TITLE' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="pm-content">

      <!-- Loading state -->
      <div class="pm-loading" *ngIf="loading">
        <ion-spinner name="crescent"></ion-spinner>
      </div>

      <!-- Empty state — no chapters completed yet. -->
      <div class="pm-empty" *ngIf="!loading && completed.length === 0">
        <div class="pm-empty-icon">
          <ion-icon name="map-outline"></ion-icon>
        </div>
        <h3 class="pm-empty-title">{{ 'JOURNEY.PAST_MAPS.EMPTY_TITLE' | translate }}</h3>
        <p class="pm-empty-body">{{ 'JOURNEY.PAST_MAPS.EMPTY_BODY' | translate }}</p>
      </div>

      <!-- List of completed chapters -->
      <div class="pm-list" *ngIf="!loading && completed.length > 0">
        <button
          *ngFor="let c of completed; trackBy: trackByIndex"
          type="button"
          class="pm-card"
          (click)="visit(c)">
          <div class="pm-thumb" [style.background-image]="'url(assets/journey-backgrounds/' + c.theme + '.png)'">
            <span class="pm-level-pill">{{ c.level }}</span>
          </div>
          <div class="pm-meta">
            <h4 class="pm-card-title">
              {{ 'JOURNEY.PAST_MAPS.CHAPTER' | translate }} {{ c.index + 1 }} · {{ c.level }}
            </h4>
            <p class="pm-card-sub">
              <ng-container [ngSwitch]="c.exitReason">
                <span *ngSwitchCase="'graduated'">{{ 'JOURNEY.PAST_MAPS.EXIT_GRADUATED' | translate }}</span>
                <span *ngSwitchCase="'demoted'">{{ 'JOURNEY.PAST_MAPS.EXIT_DEMOTED' | translate }}</span>
                <span *ngSwitchCase="'calibrated'">{{ 'JOURNEY.PAST_MAPS.EXIT_CALIBRATED' | translate }}</span>
              </ng-container>
              <span *ngIf="c.masteryLabelKey"> · {{ c.masteryLabelKey | translate }}</span>
            </p>
            <p class="pm-card-date">{{ c.completedAt | date:'mediumDate' }}</p>
          </div>
          <ion-icon class="pm-chevron" name="chevron-forward"></ion-icon>
        </button>
      </div>
    </ion-content>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .pm-header { background: #fff; }
    .pm-content { --background: #f8f8f8; }
    .pm-loading {
      display: flex;
      justify-content: center;
      padding: 40px 0;
    }
    .pm-empty {
      text-align: center;
      padding: 64px 32px;
    }
    .pm-empty-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 16px;
      border-radius: 50%;
      background: rgba(0,0,0,0.05);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      ion-icon { font-size: 30px; color: #999; }
    }
    .pm-empty-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 8px;
      color: #111;
    }
    .pm-empty-body {
      font-size: 14px;
      color: #777;
      max-width: 280px;
      margin: 0 auto;
      line-height: 1.5;
    }
    .pm-list {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pm-card {
      display: flex;
      align-items: center;
      gap: 14px;
      background: #fff;
      border: 1px solid rgba(0,0,0,0.06);
      border-radius: 16px;
      padding: 12px;
      cursor: pointer;
      width: 100%;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      &:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.08); }
      &:active { transform: translateY(0); }
    }
    .pm-thumb {
      position: relative;
      width: 80px;
      height: 60px;
      border-radius: 10px;
      background-position: center;
      background-size: cover;
      background-repeat: no-repeat;
      background-color: #ddd;
      flex-shrink: 0;
    }
    .pm-level-pill {
      position: absolute;
      top: 4px;
      left: 4px;
      background: rgba(0,0,0,0.65);
      color: #fff;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .pm-meta { flex: 1; text-align: left; }
    .pm-card-title { font-size: 15px; font-weight: 600; margin: 0; color: #111; }
    .pm-card-sub { font-size: 13px; color: #555; margin: 2px 0; }
    .pm-card-date { font-size: 12px; color: #999; margin: 0; }
    .pm-chevron { font-size: 20px; color: #aaa; flex-shrink: 0; }
  `]
})
export class PastMapsModalComponent implements OnInit {
  @Input() language!: string;

  loading = true;
  completed: CompletedChapter[] = [];

  constructor(
    private modalCtrl: ModalController,
    private learningPlanService: LearningPlanService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.learningPlanService.getChapterHistory(this.language).pipe(take(1)).subscribe({
      next: (res) => {
        this.completed = (res.completed || []).map((c: CompletedChapter) => ({
          ...c,
          masteryLabelKey: this.toMasteryLabelKey(c.masteryAtCompletion)
        }));
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  /**
   * Map a 0–100 score → student-facing qualitative label key. Same buckets
   * the chapter-complete celebration uses, so a chapter that landed as
   * "Strong finish" stays "Strong finish" forever in past maps.
   * See docs/learning-journey/voice-and-framing.md.
   */
  private toMasteryLabelKey(m: number | null | undefined): string | null {
    if (m === null || m === undefined || !Number.isFinite(m)) return null;
    if (m >= 90) return 'JOURNEY.MASTERY_LABEL.MASTERED';
    if (m >= 80) return 'JOURNEY.MASTERY_LABEL.STRONG';
    if (m >= 70) return 'JOURNEY.MASTERY_LABEL.SOLID';
    if (m >= 60) return 'JOURNEY.MASTERY_LABEL.STEADY';
    return         'JOURNEY.MASTERY_LABEL.BUILDING';
  }

  trackByIndex(_i: number, c: CompletedChapter) { return c.index + ':' + c.theme; }

  visit(c: CompletedChapter) {
    this.modalCtrl.dismiss({ visit: c });
  }

  dismiss() {
    this.modalCtrl.dismiss();
  }
}
