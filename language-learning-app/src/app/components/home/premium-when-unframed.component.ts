import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Surfaces the premium value proposition for students who are in
 * `unframed` or `paused` mode. Premium without a plan still gets:
 *   - AI lesson analysis
 *   - Personalized SRS deck (review cards generated from real mistakes)
 *   - Tutor briefings before each booked lesson
 *   - CEFR estimate
 *
 * Hidden for free students — the existing free upsell card covers them.
 */
@Component({
  selector: 'app-premium-when-unframed',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      class="premium-unframed-card"
      [class.premium-unframed-card--paused]="mode === 'paused'"
      *ngIf="visible">
      <div class="puc-head">
        <span class="puc-chip">
          <ion-icon name="sparkles-outline" aria-hidden="true"></ion-icon>
          {{ 'HOME.PREMIUM_UNFRAMED.CHIP' | translate }}
        </span>
        <button
          *ngIf="dismissible"
          type="button"
          class="puc-dismiss"
          (click)="dismiss.emit()"
          [attr.aria-label]="'COMMON.DISMISS' | translate">
          <ion-icon name="close-outline" aria-hidden="true"></ion-icon>
        </button>
      </div>

      <h3 class="puc-title">
        <ng-container *ngIf="mode === 'unframed'">
          {{ 'HOME.PREMIUM_UNFRAMED.TITLE_UNFRAMED' | translate }}
        </ng-container>
        <ng-container *ngIf="mode === 'paused'">
          {{ 'HOME.PREMIUM_UNFRAMED.TITLE_PAUSED' | translate }}
        </ng-container>
      </h3>

      <p class="puc-body">
        {{ 'HOME.PREMIUM_UNFRAMED.BODY' | translate }}
      </p>

      <ul class="puc-list">
        <li>
          <ion-icon name="bulb-outline" aria-hidden="true"></ion-icon>
          <span>{{ 'HOME.PREMIUM_UNFRAMED.ITEM_AI' | translate }}</span>
        </li>
        <li>
          <ion-icon name="layers-outline" aria-hidden="true"></ion-icon>
          <span>{{ 'HOME.PREMIUM_UNFRAMED.ITEM_REVIEW' | translate }}</span>
        </li>
        <li>
          <ion-icon name="people-outline" aria-hidden="true"></ion-icon>
          <span>{{ 'HOME.PREMIUM_UNFRAMED.ITEM_TUTOR' | translate }}</span>
        </li>
        <li>
          <ion-icon name="bar-chart-outline" aria-hidden="true"></ion-icon>
          <span>{{ 'HOME.PREMIUM_UNFRAMED.ITEM_CEFR' | translate }}</span>
        </li>
      </ul>
    </div>
  `,
  styles: [`
    .premium-unframed-card {
      background: #fff;
      border: 1px solid #ebebeb;
      border-radius: 16px;
      padding: 20px 22px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
      margin-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .puc-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .puc-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: #111;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .puc-chip ion-icon {
      font-size: 14px;
    }
    .puc-dismiss {
      background: none;
      border: 0;
      color: #717171;
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      cursor: pointer;
    }
    .puc-dismiss:hover {
      background: #f7f7f7;
      color: #111;
    }
    .puc-title {
      margin: 0;
      font-size: 17px;
      font-weight: 600;
      color: #111;
      letter-spacing: -0.01em;
    }
    .puc-body {
      margin: 0;
      font-size: 14px;
      line-height: 1.5;
      color: #555;
    }
    .puc-list {
      list-style: none;
      padding: 0;
      margin: 4px 0 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .puc-list li {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      color: #222;
    }
    .puc-list li ion-icon {
      font-size: 18px;
      color: #555;
      flex: 0 0 auto;
    }
    html.ion-palette-dark .premium-unframed-card {
      background: #1c1c1e;
      border-color: #2c2c2e;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
    }
    html.ion-palette-dark .puc-title { color: #fff; }
    html.ion-palette-dark .puc-body { color: #c7c7cc; }
    html.ion-palette-dark .puc-list li { color: #f2f2f7; }
    html.ion-palette-dark .puc-list li ion-icon { color: #98989d; }
    html.ion-palette-dark .puc-chip { background: #f2f2f7; color: #111; }
    html.ion-palette-dark .puc-dismiss { color: #98989d; }
    html.ion-palette-dark .puc-dismiss:hover { background: #2c2c2e; color: #fff; }
  `]
})
export class PremiumWhenUnframedComponent {
  @Input() visible = false;
  @Input() mode: 'unframed' | 'paused' = 'unframed';
  @Input() dismissible = false;
  @Output() dismiss = new EventEmitter<void>();
}
