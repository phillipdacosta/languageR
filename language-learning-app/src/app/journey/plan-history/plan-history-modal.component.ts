import {
  Component, Input, OnInit, ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { take } from 'rxjs/operators';

import { LearningPlanService } from '../../services/learning-plan.service';

interface HistoryEntry {
  date: string;
  changeDescription: string;
  phaseIndexBefore: number | null;
  phaseIndexAfter: number | null;
  masteryAtAdvance: number | null;
  reason: string | null;
}

/**
 * Plan history modal — human-readable timeline of every algorithmic
 * decision (advance, graduate, demote, calibrate, vote, etc.).
 *
 * Drives transparency: students and tutors can see exactly WHY the
 * plan changed when it did. See docs/learning-journey/architecture.md
 * (audit log section).
 */
@Component({
  selector: 'app-plan-history-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IonicModule, TranslateModule],
  template: `
    <ion-header class="ph-header">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="dismiss()">
            <ion-icon slot="icon-only" name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ 'JOURNEY.PLAN_HISTORY.TITLE' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ph-content">
      <div class="ph-loading" *ngIf="loading">
        <ion-spinner name="crescent"></ion-spinner>
      </div>

      <div class="ph-empty" *ngIf="!loading && history.length === 0">
        <p>{{ 'JOURNEY.PLAN_HISTORY.EMPTY' | translate }}</p>
      </div>

      <div class="ph-timeline" *ngIf="!loading && history.length > 0">
        <div class="ph-entry" *ngFor="let h of history; trackBy: trackByDate">
          <div class="ph-entry-dot" [class]="dotClass(h.reason)">
            <ion-icon [name]="reasonIcon(h.reason)"></ion-icon>
          </div>
          <div class="ph-entry-card">
            <p class="ph-entry-desc">{{ h.changeDescription }}</p>
            <p class="ph-entry-meta">
              <span class="ph-entry-date">{{ h.date | date:'medium' }}</span>
              <span *ngIf="h.reason" class="ph-entry-reason">{{ humanReason(h.reason) }}</span>
            </p>
          </div>
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .ph-header { background: #fff; }
    .ph-content { --background: #f8f8f8; }
    .ph-loading {
      display: flex; justify-content: center; padding: 40px 0;
    }
    .ph-empty {
      text-align: center; padding: 40px;
      p { color: #777; font-size: 14px; }
    }
    .ph-timeline {
      padding: 16px;
      position: relative;
    }
    .ph-entry {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 14px;
      position: relative;
    }
    .ph-entry-dot {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #f0f0f0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      ion-icon { font-size: 16px; color: #555; }
      &.ph-entry-dot--graduate { background: #111; ion-icon { color: #fff; } }
      &.ph-entry-dot--demote   { background: #777; ion-icon { color: #fff; } }
      &.ph-entry-dot--advance  { background: #1c8a44; ion-icon { color: #fff; } }
      &.ph-entry-dot--warning  { background: #d97706; ion-icon { color: #fff; } }
    }
    .ph-entry-card {
      flex: 1;
      background: #fff;
      border: 1px solid rgba(0,0,0,0.06);
      border-radius: 12px;
      padding: 10px 12px;
    }
    .ph-entry-desc {
      font-size: 14px; color: #111; margin: 0 0 4px;
      line-height: 1.45;
    }
    .ph-entry-meta {
      display: flex; gap: 10px; align-items: center;
      font-size: 12px; color: #999; margin: 0;
    }
    .ph-entry-reason {
      background: rgba(0,0,0,0.04);
      padding: 2px 6px;
      border-radius: 4px;
      color: #555;
      font-weight: 500;
    }
  `]
})
export class PlanHistoryModalComponent implements OnInit {
  @Input() language!: string;

  loading = true;
  history: HistoryEntry[] = [];

  constructor(
    private modalCtrl: ModalController,
    private learningPlanService: LearningPlanService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.learningPlanService.getPlanHistory(this.language).pipe(take(1)).subscribe({
      next: (res) => {
        this.history = res.history || [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  trackByDate(_i: number, h: HistoryEntry) { return h.date + h.changeDescription; }

  dotClass(reason: string | null): string {
    if (!reason) return '';
    if (reason.includes('graduated')) return 'ph-entry-dot--graduate';
    if (reason.includes('demoted'))   return 'ph-entry-dot--demote';
    if (reason.includes('advance') || reason.includes('mastery_met') || reason.includes('promoted')) return 'ph-entry-dot--advance';
    if (reason.includes('warning'))   return 'ph-entry-dot--warning';
    return '';
  }

  reasonIcon(reason: string | null): string {
    if (!reason) return 'ellipse';
    if (reason.includes('graduated')) return 'trophy-outline';
    if (reason.includes('demoted'))   return 'leaf-outline';
    if (reason.includes('advance') || reason.includes('mastery_met') || reason.includes('promoted')) return 'arrow-up';
    if (reason.includes('warning'))   return 'alert-circle-outline';
    if (reason.includes('tutor'))     return 'person-outline';
    if (reason === 'created')         return 'flag-outline';
    return 'ellipse';
  }

  humanReason(reason: string): string {
    return reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  dismiss() {
    this.modalCtrl.dismiss();
  }
}
