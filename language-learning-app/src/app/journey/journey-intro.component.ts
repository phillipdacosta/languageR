import {
  Component, Input, Output, EventEmitter,
  ChangeDetectionStrategy, ChangeDetectorRef, OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { take } from 'rxjs/operators';
import { LearningPlanService } from '../services/learning-plan.service';

interface EditablePhase {
  title: string;
  description: string;
  originalTitle: string;
  originalDescription: string;
}

/**
 * Post-onboarding "Your roadmap is ready" intro.
 *
 * Triggered from the home page (tab1) or journey page after onboarding.
 * Three slides explain the plan, then an optional inline edit wizard
 * (expands the modal to full-screen) lets the student personalise phases
 * before committing.
 */
@Component({
  selector: 'app-journey-intro',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, IonicModule, TranslateModule],
  template: `

    <!-- ══════════════════════════════════════════════════════════
         EXPANDED EDIT WIZARD
    ══════════════════════════════════════════════════════════ -->
    <ng-container *ngIf="expanded">

      <button class="ji-close" type="button" (click)="collapseBack()" aria-label="Back">
        <ion-icon name="arrow-back-outline"></ion-icon>
      </button>

      <ion-content>
        <div class="ji-edit-body">
          <h1 class="ji-edit-title">{{ 'JOURNEY.INTRO.EDIT_TITLE' | translate }}</h1>
          <p class="ji-edit-sub">{{ 'JOURNEY.INTRO.EDIT_SUB' | translate }}</p>

          <div class="ji-phase-cards">
            <div *ngFor="let phase of editPhases; let i = index" class="ji-phase-card">
              <div class="ji-phase-card-head">
                <div class="ji-phase-card-num">{{ i + 1 }}</div>
                <span class="ji-phase-card-label">{{ 'JOURNEY.PHASE' | translate }} {{ i + 1 }}</span>
              </div>

              <div class="ji-field">
                <label class="ji-field-label">{{ 'JOURNEY.EDIT.TITLE_LABEL' | translate }}</label>
                <input class="ji-field-input"
                       type="text"
                       [(ngModel)]="phase.title"
                       [placeholder]="phase.originalTitle" />
              </div>

              <div class="ji-field">
                <label class="ji-field-label">{{ 'JOURNEY.EDIT.DESC_LABEL' | translate }}</label>
                <textarea class="ji-field-input ji-field-textarea"
                          [(ngModel)]="phase.description"
                          rows="3"
                          [placeholder]="phase.originalDescription"></textarea>
              </div>
            </div>
          </div>
        </div>
      </ion-content>

      <ion-footer>
        <ion-toolbar>
          <div class="ji-footer">
            <button class="ji-btn ji-btn--outline"
                    type="button"
                    (click)="collapseBack()">
              {{ 'COMMON.BACK' | translate }}
            </button>
            <button class="ji-btn ji-btn--solid"
                    type="button"
                    [disabled]="isSaving"
                    (click)="saveAndClose()">
              <ion-spinner *ngIf="isSaving" name="crescent" class="ji-spinner"></ion-spinner>
              <span *ngIf="!isSaving">{{ 'JOURNEY.INTRO.EDIT_SAVE' | translate }}</span>
            </button>
          </div>
        </ion-toolbar>
      </ion-footer>

    </ng-container>

    <!-- ══════════════════════════════════════════════════════════
         INTRO SLIDES
    ══════════════════════════════════════════════════════════ -->
    <ng-container *ngIf="!expanded">

      <button class="ji-close" type="button" (click)="dismiss('skip')"
              [attr.aria-label]="'COMMON.CLOSE' | translate">
        <ion-icon name="close"></ion-icon>
      </button>

      <ion-content>

        <!-- ── Slide 0: actual plan phases ── -->
        <div *ngIf="step === 0" class="ji-body ji-body--plan">

          <div class="ji-dots" aria-hidden="true">
            <span *ngFor="let _ of slides; let i = index"
                  class="ji-dot"
                  [class.ji-dot--active]="i === step"
                  [class.ji-dot--done]="i < step"></span>
          </div>

          <div class="ji-plan-header">
            <div class="ji-icon ji-icon--sm"><ion-icon name="map-outline"></ion-icon></div>
            <div>
              <h1 class="ji-title ji-title--sm">{{ 'JOURNEY.INTRO.S1_TITLE' | translate }}</h1>
              <p class="ji-desc ji-desc--sm">{{ 'JOURNEY.INTRO.S1_BODY' | translate }}</p>
            </div>
          </div>

          <div class="ji-phases" *ngIf="phaseLabels.length">
            <div *ngFor="let label of phaseLabels; let i = index" class="ji-phase-row">
              <div class="ji-phase-num">{{ i + 1 }}</div>
              <div class="ji-phase-label">{{ label }}</div>
              <div class="ji-phase-line" *ngIf="i < phaseLabels.length - 1"></div>
            </div>
          </div>
        </div>

        <!-- ── Slides 1 & 2: explanatory ── -->
        <div *ngIf="step !== 0" class="ji-body">
          <ng-container [ngSwitch]="step">
            <div *ngSwitchCase="1" class="ji-icon"><ion-icon name="trending-up-outline"></ion-icon></div>
            <div *ngSwitchCase="2" class="ji-icon"><ion-icon name="create-outline"></ion-icon></div>
          </ng-container>

          <div class="ji-dots" aria-hidden="true">
            <span *ngFor="let _ of slides; let i = index"
                  class="ji-dot"
                  [class.ji-dot--active]="i === step"
                  [class.ji-dot--done]="i < step"></span>
          </div>

          <ng-container [ngSwitch]="step">
            <ng-container *ngSwitchCase="1">
              <h1 class="ji-title">{{ 'JOURNEY.INTRO.S2_TITLE' | translate }}</h1>
              <p class="ji-desc">{{ 'JOURNEY.INTRO.S2_BODY' | translate }}</p>
            </ng-container>
            <ng-container *ngSwitchCase="2">
              <h1 class="ji-title">{{ 'JOURNEY.INTRO.S3_TITLE' | translate }}</h1>
              <p class="ji-desc">{{ 'JOURNEY.INTRO.S3_BODY' | translate }}</p>
            </ng-container>
          </ng-container>
        </div>

      </ion-content>

      <ion-footer>
        <ion-toolbar>
          <div class="ji-footer">

            <button *ngIf="step > 0" class="ji-btn ji-btn--outline" type="button" (click)="prev()">
              {{ 'COMMON.BACK' | translate }}
            </button>
            <span *ngIf="step === 0" class="ji-btn-spacer"></span>

            <button *ngIf="step < slides.length - 1"
                    class="ji-btn ji-btn--solid" type="button" (click)="next()">
              {{ 'COMMON.NEXT' | translate }}
            </button>

            <ng-container *ngIf="step === slides.length - 1">
              <button class="ji-btn ji-btn--outline ji-btn--sm" type="button" (click)="expandAndEdit()">
                {{ 'JOURNEY.INTRO.CTA_EDIT' | translate }}
              </button>
              <button class="ji-btn ji-btn--solid" type="button" (click)="dismiss('done')">
                {{ 'JOURNEY.INTRO.CTA_GO' | translate }}
              </button>
            </ng-container>

          </div>
        </ion-toolbar>
      </ion-footer>

    </ng-container>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      position: relative;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    }

    /* ── Floating close / back button ── */
    .ji-close {
      position: absolute;
      top: 16px;
      right: 16px;
      z-index: 1010;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1px solid #dddddd;
      background: #ffffff;
      color: #717171;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;
      outline: none;
      -webkit-appearance: none;
      ion-icon { font-size: 18px; }
      &:hover { color: #222222; border-color: #b0b0b0; box-shadow: 0 2px 4px rgba(0,0,0,.08); }
      &:active { background: #f7f7f7; transform: scale(0.95); }
    }

    ion-content { flex: 1; --background: #ffffff; }

    /* ════════════════════════════════
       INTRO SLIDES
    ════════════════════════════════ */

    .ji-body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      min-height: 100%;
      padding: 48px 28px 24px;
      box-sizing: border-box;
      max-width: 520px;
      margin: 0 auto;
    }

    .ji-body--plan {
      align-items: flex-start;
      text-align: left;
      justify-content: flex-start;
      padding-top: 40px;
    }

    .ji-icon {
      width: 64px; height: 64px;
      border-radius: 18px;
      background: #f7f7f7;
      border: 1px solid #ebebeb;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 24px; flex-shrink: 0;
      ion-icon { font-size: 30px; color: #222222; }
    }

    .ji-icon--sm {
      width: 48px; height: 48px;
      border-radius: 14px;
      margin-bottom: 0;
      ion-icon { font-size: 22px; }
    }

    .ji-plan-header {
      display: flex; align-items: flex-start; gap: 14px;
      margin-bottom: 24px; width: 100%;
    }

    .ji-dots {
      display: flex; gap: 6px; justify-content: center;
      margin-bottom: 24px; align-self: center;
    }

    .ji-dot {
      width: 28px; height: 4px; border-radius: 2px;
      background: #ebebeb; transition: background 0.2s ease;
    }
    .ji-dot--done   { background: #b0b0b0; }
    .ji-dot--active { background: #222222; }

    .ji-title {
      margin: 0 0 8px; font-size: 22px; font-weight: 700;
      letter-spacing: -0.4px; color: #222222; line-height: 1.25;
    }
    .ji-title--sm { font-size: 17px; }

    .ji-desc {
      margin: 0; font-size: 15px; line-height: 1.55;
      color: #717171; letter-spacing: -0.1px;
    }
    .ji-desc--sm { font-size: 14px; }

    /* Phase list on slide 0 */
    .ji-phases { width: 100%; }

    .ji-phase-row {
      display: grid;
      grid-template-columns: 28px 1fr;
      grid-template-rows: 28px auto;
      column-gap: 14px;
    }

    .ji-phase-num {
      width: 28px; height: 28px; border-radius: 50%;
      background: #222222; color: #ffffff;
      font-size: 13px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      grid-row: 1; grid-column: 1;
    }

    .ji-phase-label {
      grid-row: 1; grid-column: 2;
      font-size: 15px; font-weight: 500; color: #222222;
      line-height: 28px; letter-spacing: -0.1px;
    }

    .ji-phase-line {
      grid-row: 2; grid-column: 1;
      width: 2px; height: 16px;
      background: #ebebeb;
      margin: 2px auto;
    }

    /* ════════════════════════════════
       FOOTER (shared by slides & edit)
    ════════════════════════════════ */
    ion-footer {
      flex-shrink: 0;
      ion-toolbar {
        --background: #ffffff;
        --border-width: 0;
        --padding-top: 0; --padding-bottom: 0; --min-height: auto;
      }
    }

    .ji-footer {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      padding: 16px 24px;
      border-top: 1px solid #ebebeb;
      background: #ffffff;
    }

    .ji-btn {
      display: flex; align-items: center; justify-content: center;
      height: 48px; border-radius: 8px;
      font-size: 15px; font-weight: 600;
      cursor: pointer; letter-spacing: -0.1px;
      transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
      outline: none; -webkit-appearance: none; border: none; font-family: inherit;
      &:active { transform: scale(0.98); }
      &[disabled] { opacity: 0.5; cursor: not-allowed; }
    }

    .ji-btn--outline {
      background: #ffffff; color: #222222; border: 1px solid #dddddd;
      &:hover { background: #f7f7f7; }
    }

    .ji-btn--solid {
      background: #222222; color: #ffffff;
      &:hover { background: #000000; box-shadow: 0 4px 12px rgba(0,0,0,.15); }
    }

    .ji-btn--sm { font-size: 13px; }
    .ji-btn-spacer { display: block; }

    .ji-spinner { width: 18px; height: 18px; --color: #fff; }

    /* ════════════════════════════════
       EDIT WIZARD (expanded)
    ════════════════════════════════ */
    .ji-edit-body {
      padding: 56px 24px 32px;
      max-width: 640px;
      margin: 0 auto;
    }

    .ji-edit-title {
      font-size: 24px; font-weight: 700; letter-spacing: -0.5px;
      color: #222222; margin: 0 0 8px; line-height: 1.25;
    }

    .ji-edit-sub {
      font-size: 15px; line-height: 1.55; color: #717171;
      margin: 0 0 28px; letter-spacing: -0.1px;
    }

    .ji-phase-cards { display: flex; flex-direction: column; gap: 16px; }

    .ji-phase-card {
      background: #ffffff;
      border: 1px solid #ebebeb;
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 1px 4px rgba(0,0,0,.04);
    }

    .ji-phase-card-head {
      display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
    }

    .ji-phase-card-num {
      width: 24px; height: 24px; border-radius: 50%;
      background: #222222; color: #ffffff;
      font-size: 12px; font-weight: 700;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }

    .ji-phase-card-label {
      font-size: 13px; font-weight: 600; color: #717171; text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .ji-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .ji-field:last-child { margin-bottom: 0; }

    .ji-field-label {
      font-size: 13px; font-weight: 600; color: #222222; letter-spacing: -0.1px;
    }

    .ji-field-input {
      width: 100%; box-sizing: border-box;
      padding: 10px 12px; border-radius: 10px;
      border: 1px solid #dddddd; background: #ffffff;
      font-size: 15px; color: #222222; font-family: inherit;
      outline: none; -webkit-appearance: none;
      transition: border-color 0.2s ease;
      &:focus { border-color: #222222; }
    }

    .ji-field-textarea { resize: vertical; line-height: 1.5; }

    /* ════════════════════════════════
       DARK MODE
    ════════════════════════════════ */
    :host-context(html.ion-palette-dark) {
      .ji-close {
        background: #2c2c2e; color: #8e8e93; border-color: #3a3a3c;
        &:hover { color: #f5f5f7; }
      }
      ion-content { --background: #1c1c1e !important; }

      .ji-icon { background: #2c2c2e; border-color: rgba(255,255,255,.08); ion-icon { color: #f5f5f7; } }
      .ji-dot { background: #3a3a3c; }
      .ji-dot--done { background: #636366; }
      .ji-dot--active { background: #f5f5f7; }
      .ji-phase-num { background: #f5f5f7; color: #000000; }
      .ji-phase-line { background: #3a3a3c; }
      .ji-phase-label { color: #f5f5f7; }
      .ji-title { color: #f5f5f7; }
      .ji-desc { color: #8e8e93; }

      ion-footer, .ji-footer { background: #1c1c1e; }
      .ji-footer { border-top-color: rgba(255,255,255,.1); }
      .ji-btn--outline { background: transparent; color: #f5f5f7; border-color: rgba(255,255,255,.18); &:hover { background: #2c2c2e; } }
      .ji-btn--solid { background: #f5f5f7; color: #000000; &:hover { background: #ffffff; } }

      .ji-edit-title { color: #f5f5f7; }
      .ji-edit-sub { color: #8e8e93; }
      .ji-phase-card { background: #2c2c2e; border-color: rgba(255,255,255,.08); }
      .ji-phase-card-label { color: #8e8e93; }
      .ji-field-label { color: #f5f5f7; }
      .ji-field-input { background: #1c1c1e; border-color: #3a3a3c; color: #f5f5f7; &:focus { border-color: #f5f5f7; } }
    }
  `]
})
export class JourneyIntroComponent implements OnInit {
  @Input() phaseLabels: string[] = [];
  /** Full plan object — needed to populate the edit wizard */
  @Input() plan: any = null;
  /** Language code (e.g. 'spanish') — required for the edit API call */
  @Input() language: string = '';
  /** When true, dismiss navigates to /journey so the student can see their plan */
  @Input() calledFromHome: boolean = false;

  @Output() done = new EventEmitter<'done' | 'edit' | 'skip'>();

  step = 0;
  slides = [0, 1, 2];

  expanded = false;
  editPhases: EditablePhase[] = [];
  isSaving = false;

  constructor(
    private modalCtrl: ModalController,
    private learningPlanService: LearningPlanService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    if (this.plan?.phases) {
      this.editPhases = this.plan.phases.map((p: any) => ({
        title: p.title || '',
        description: p.description || '',
        originalTitle: p.title || '',
        originalDescription: p.description || ''
      }));
    }
  }

  next() { if (this.step < this.slides.length - 1) this.step++; }
  prev() { if (this.step > 0) this.step--; }

  async expandAndEdit() {
    const modalEl = await this.modalCtrl.getTop();
    if (modalEl) {
      // Enable transition first (reflow needed before class add)
      modalEl.classList.add('journey-intro-expanding');
      void (modalEl as HTMLElement).offsetWidth;
      modalEl.classList.add('journey-intro-expanded');
    }
    this.expanded = true;
    this.cdr.markForCheck();
  }

  async collapseBack() {
    const modalEl = await this.modalCtrl.getTop();
    if (modalEl) {
      modalEl.classList.remove('journey-intro-expanded');
      setTimeout(() => modalEl.classList.remove('journey-intro-expanding'), 450);
    }
    this.expanded = false;
    this.cdr.markForCheck();
  }

  async saveAndClose() {
    if (!this.language || this.isSaving) return;
    this.isSaving = true;
    this.cdr.markForCheck();

    const savePromises = this.editPhases
      .filter((p, i) =>
        p.title !== p.originalTitle || p.description !== p.originalDescription
      )
      .map((p, _) => {
        const idx = this.editPhases.indexOf(p);
        return this.learningPlanService
          .editPhase(this.language, idx, { title: p.title, description: p.description })
          .pipe(take(1))
          .toPromise();
      });

    try {
      if (savePromises.length) await Promise.all(savePromises);
    } catch (_) {
      // best-effort; don't block dismiss on error
    }

    this.isSaving = false;
    this.cdr.markForCheck();
    this.dismiss('done');
  }

  dismiss(reason: 'done' | 'edit' | 'skip') {
    this.done.emit(reason);
    this.modalCtrl.dismiss({ reason }).then(() => {
      if (this.calledFromHome) {
        this.router.navigate(['/tabs/journey']);
      }
    });
  }
}
