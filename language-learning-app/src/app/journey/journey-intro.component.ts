import {
  Component, Input, Output, EventEmitter,
  ChangeDetectionStrategy, ChangeDetectorRef, OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LearningPlanService } from '../services/learning-plan.service';
import { ToastService } from '../services/toast.service';
import { journeyBackgroundUrl } from './journey-map-assets';
import {
  JourneyMapPreviewComponent,
  JourneyMapPreviewPhase,
} from './journey-map-preview.component';

interface JourneyMapPreview {
  level: string;
  theme: string;
  imageUrl: string;
  rungKey: string;
}

interface EditablePhase {
  title: string;
  description: string;
  originalTitle: string;
  originalDescription: string;
}

/**
 * Post-onboarding student intro.
 *
 * Slide 0 explains how Barnabi works (lessons, feedback, optional journey).
 * Later slides cover the provisional first chapter, calibration, and map.
 */
@Component({
  selector: 'app-journey-intro',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, IonicModule, TranslateModule, JourneyMapPreviewComponent],
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
            <div class="ji-footer-start">
              <button class="ji-btn ji-btn--outline"
                      type="button"
                      (click)="collapseBack()">
                {{ 'COMMON.BACK' | translate }}
              </button>
            </div>
            <div class="ji-footer-spacer" aria-hidden="true"></div>
            <button class="ji-btn ji-btn--solid"
                    type="button"
                    [disabled]="isSaving"
                    (click)="savePhases()">
              <ion-spinner *ngIf="isSaving" name="crescent" class="ji-spinner"></ion-spinner>
              <span *ngIf="!isSaving">{{ 'COMMON.SAVE' | translate }}</span>
            </button>
          </div>
        </ion-toolbar>
      </ion-footer>

    </ng-container>

    <!-- ══════════════════════════════════════════════════════════
         INTRO SLIDES
    ══════════════════════════════════════════════════════════ -->
    <ng-container *ngIf="!expanded">

      <button *ngIf="!requireConfirmation" class="ji-close" type="button" (click)="dismiss('skip')"
              [attr.aria-label]="'COMMON.CLOSE' | translate">
        <ion-icon name="close"></ion-icon>
      </button>

      <ion-content>

        <!-- ── Slide 0: how Barnabi works ── -->
        <div *ngIf="step === 0" class="ji-body ji-body--student-welcome">

          <div class="ji-dots" aria-hidden="true">
            <span *ngFor="let _ of slides; let i = index"
                  class="ji-dot"
                  [class.ji-dot--active]="i === step"
                  [class.ji-dot--done]="i < step"></span>
          </div>

          <p class="ji-eyebrow">{{ 'JOURNEY.INTRO.S1_EYEBROW' | translate }}</p>

          <img
            src="assets/barnabi-journey-intro-hero.png"
            alt=""
            class="ji-hero-mascot ji-hero-mascot--centered"
            width="96"
            height="96"
            decoding="async" />

          <h1 class="ji-title ji-title--sm">{{ 'JOURNEY.INTRO.S1_TITLE' | translate }}</h1>
          <p class="ji-desc ji-desc--sm">{{ 'JOURNEY.INTRO.S1_BODY' | translate }}</p>

          <div class="ji-callout ji-callout--card">
            <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
            <p>{{ 'JOURNEY.INTRO.S1_CALLOUT' | translate }}</p>
          </div>
        </div>

        <!-- ── Slide 1: starting chapter map + phase steps ── -->
        <div *ngIf="step === 1" class="ji-body ji-body--phases ji-body--student-phases">
          <div class="ji-dots ji-animate-in ji-animate-in--1" aria-hidden="true">
            <span *ngFor="let _ of slides; let i = index"
                  class="ji-dot"
                  [class.ji-dot--active]="i === step"
                  [class.ji-dot--done]="i < step"></span>
          </div>

          <h1 class="ji-title ji-title--sm ji-animate-in ji-animate-in--2">{{ 'JOURNEY.INTRO.S1B_TITLE' | translate }}</h1>

          <p *ngIf="selfLevelLabel" class="ji-self-level ji-animate-in ji-animate-in--2">
            {{ 'JOURNEY.INTRO.S1_SELF_LEVEL' | translate:{ level: selfLevelLabel } }}
          </p>

          <p class="ji-phases-label ji-animate-in ji-animate-in--2">
            {{ 'JOURNEY.INTRO.S1B_PHASES_LABEL' | translate }}
          </p>
          <p class="ji-desc ji-desc--sm ji-animate-in ji-animate-in--2">{{ 'JOURNEY.INTRO.S1B_BODY' | translate }}</p>

          <div class="ji-map-preview-wrap ji-animate-in ji-animate-in--3" *ngIf="startingChapterPreview">
            <app-journey-map-preview
              class="ji-map-preview"
              [chapterTheme]="startingChapterPreview.theme"
              [chapterLevel]="startingChapterPreview.level"
              [phases]="mapPreviewPhases"
              [currentPhaseIndex]="0"
              [caption]="mapPreviewCaption" />
          </div>

          <div class="ji-callout ji-callout--card ji-animate-in ji-animate-in--4">
            <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
            <p>{{ 'JOURNEY.INTRO.S1B_CALLOUT' | translate }}</p>
          </div>
        </div>

        <!-- ── Slide 2: adapts ── -->
        <div *ngIf="step === 2" class="ji-body ji-body--explain ji-body--student-explain">
          <div class="ji-dots ji-animate-in ji-animate-in--1" aria-hidden="true">
            <span *ngFor="let _ of slides; let i = index"
                  class="ji-dot"
                  [class.ji-dot--active]="i === step"
                  [class.ji-dot--done]="i < step"></span>
          </div>
          <div class="ji-empty-title-block ji-animate-in ji-animate-in--2">
            <h1 class="ji-empty-title">{{ 'JOURNEY.INTRO.S2_TITLE_LEAD' | translate }}</h1>
            <p class="ji-empty-title-tail">{{ 'JOURNEY.INTRO.S2_TITLE_TAIL' | translate }}</p>
          </div>
          <div class="ji-focus-demo ji-animate-in ji-animate-in--3" aria-hidden="true">
            <div class="ji-focus-card">
              <span class="ji-focus-label">{{ 'JOURNEY.INTRO.S2_FOCUS_LABEL' | translate }}</span>
              <div class="ji-focus-row">
                <span class="ji-focus-chip ji-focus-chip--before">{{ 'JOURNEY.INTRO.S2_FOCUS_BEFORE' | translate }}</span>
                <ion-icon name="arrow-forward-outline" class="ji-focus-arrow"></ion-icon>
                <span class="ji-focus-chip ji-focus-chip--after">{{ 'JOURNEY.INTRO.S2_FOCUS_AFTER' | translate }}</span>
              </div>
            </div>
          </div>
          <p class="ji-desc ji-animate-in ji-animate-in--4">{{ 'JOURNEY.INTRO.S2_BODY' | translate }}</p>
          <p class="ji-desc ji-desc--hint ji-animate-in ji-animate-in--5">{{ 'JOURNEY.INTRO.S2_GUIDE' | translate }}</p>
          <p class="ji-desc ji-desc--hint ji-animate-in ji-animate-in--6">{{ 'JOURNEY.INTRO.S2_HINT' | translate }}</p>
        </div>

        <!-- ── Slide 3: journey maps glimpse ── -->
        <div *ngIf="step === 3" class="ji-body ji-body--maps ji-body--maps-expanded">
          <div class="ji-dots ji-animate-in ji-animate-in--1" aria-hidden="true">
            <span *ngFor="let _ of slides; let i = index"
                  class="ji-dot"
                  [class.ji-dot--active]="i === step"
                  [class.ji-dot--done]="i < step"></span>
          </div>
          <div class="ji-maps-stage">
            <div class="ji-maps-title-block">
              <h1 class="ji-empty-title">{{ 'JOURNEY.INTRO.S3_TITLE_LEAD' | translate }}</h1>
              <p class="ji-empty-title-tail">{{ 'JOURNEY.INTRO.S3_TITLE_TAIL' | translate }}</p>
            </div>
            <div class="ji-maps-rail" aria-hidden="true">
              <div class="ji-maps-track">
                <div *ngFor="let map of journeyMapPreviews; let i = index"
                     class="ji-map-card"
                     [class.ji-map-card--start]="i === startingChapterIndex"
                     [class.ji-map-card--summit]="i === journeyMapPreviews.length - 1"
                     [style.--map-index]="i">
                  <div class="ji-map-badge-slot">
                    <span *ngIf="i === startingChapterIndex" class="ji-map-start-badge">{{ 'JOURNEY.INTRO.MAP_START_HERE' | translate }}</span>
                  </div>
                  <div class="ji-map-thumb-wrap">
                    <div class="ji-map-thumb" [style.background-image]="'url(' + map.imageUrl + ')'"></div>
                  </div>
                  <div class="ji-map-meta">
                    <span class="ji-map-level">{{ map.level }}</span>
                    <span class="ji-map-rung">{{ map.rungKey | translate }}</span>
                  </div>
                </div>
              </div>
            </div>
            <p class="ji-desc ji-maps-caption">{{ 'JOURNEY.INTRO.S3_BODY' | translate:{ chapter: startingChapterRungLabel } }}</p>
          </div>
        </div>

        <!-- ── Slide 4: control ── -->
        <div *ngIf="step === 4" class="ji-body ji-body--explain ji-body--student-control">
          <div class="ji-dots ji-animate-in ji-animate-in--1" aria-hidden="true">
            <span *ngFor="let _ of slides; let i = index"
                  class="ji-dot"
                  [class.ji-dot--active]="i === step"
                  [class.ji-dot--done]="i < step"></span>
          </div>
          <div class="ji-empty-title-block ji-animate-in ji-animate-in--2">
            <h1 class="ji-empty-title">{{ 'JOURNEY.INTRO.S4_TITLE_LEAD' | translate }}</h1>
            <p class="ji-empty-title-tail">{{ 'JOURNEY.INTRO.S4_TITLE_TAIL' | translate }}</p>
          </div>
          <p class="ji-desc ji-animate-in ji-animate-in--3">{{ 'JOURNEY.INTRO.S4_BODY' | translate }}</p>
          <div class="ji-action-cards ji-animate-in ji-animate-in--4">
            <div *ngFor="let action of controlActions" class="ji-action-card ji-action-card--elevated">
              <div class="ji-action-icon">
                <ion-icon [name]="action.icon"></ion-icon>
              </div>
              <span class="ji-action-label">{{ action.labelKey | translate }}</span>
            </div>
          </div>
          <div class="ji-book-nudge ji-animate-in ji-animate-in--5">
            <ion-icon name="calendar-outline"></ion-icon>
            <p>{{ 'JOURNEY.INTRO.S4_NEXT_STEP' | translate }}</p>
          </div>
        </div>

      </ion-content>

      <ion-footer>
        <ion-toolbar>
          <div class="ji-footer">
            <div class="ji-footer-start">
              <button *ngIf="step > 0" class="ji-btn ji-btn--outline" type="button" (click)="prev()">
                {{ 'COMMON.BACK' | translate }}
              </button>
              <button *ngIf="step === slides.length - 1"
                      class="ji-btn ji-btn--outline ji-btn--sm"
                      type="button"
                      (click)="expandAndEdit()">
                {{ 'JOURNEY.INTRO.CTA_EDIT' | translate }}
              </button>
            </div>
            <div class="ji-footer-spacer" aria-hidden="true"></div>
            <button *ngIf="step < slides.length - 1"
                    class="ji-btn ji-btn--solid"
                    type="button"
                    (click)="next()">
              {{ 'COMMON.NEXT' | translate }}
            </button>
            <button *ngIf="step === slides.length - 1"
                    class="ji-btn ji-btn--solid"
                    type="button"
                    (click)="confirmDismiss()">
              {{ requireConfirmation ? ('JOURNEY.INTRO.CTA_OK' | translate) : ('JOURNEY.INTRO.CTA_GO' | translate) }}
            </button>
          </div>
        </ion-toolbar>
      </ion-footer>

    </ng-container>
  `,
  styleUrls: ['./journey-intro.component.scss']
})
export class JourneyIntroComponent implements OnInit {
  private static readonly SELF_LEVEL_KEYS: Record<string, string> = {
    complete_beginner: 'ONBOARDING.STUDENT.LEVEL_OPTION_COMPLETE_BEGINNER',
    some_basics: 'ONBOARDING.STUDENT.LEVEL_OPTION_SOME_BASICS',
    simple_conversations: 'ONBOARDING.STUDENT.LEVEL_OPTION_SIMPLE_CONVERSATIONS',
    intermediate: 'ONBOARDING.STUDENT.LEVEL_OPTION_INTERMEDIATE',
    advanced: 'ONBOARDING.STUDENT.LEVEL_OPTION_ADVANCED',
  };

  private static readonly SELF_ASSESSED_TO_CHAPTER_INDEX: Record<string, number> = {
    complete_beginner: 0,
    some_basics: 0,
    simple_conversations: 1,
    intermediate: 2,
    advanced: 4,
  };

  @Input() phaseLabels: string[] = [];
  /** Full plan object — needed to populate the edit wizard */
  @Input() plan: any = null;
  /** Language code (e.g. 'spanish') — required for the edit API call */
  @Input() language: string = '';
  /** When true, dismiss navigates to /journey so the student can see their plan */
  @Input() calledFromHome: boolean = false;
  /** New-user flow: no X/backdrop dismiss; must tap Okay on the last slide. */
  @Input() requireConfirmation = false;

  @Output() done = new EventEmitter<'done' | 'edit' | 'skip'>();

  step = 0;
  slides = [0, 1, 2, 3, 4];

  readonly journeyMapPreviews: JourneyMapPreview[] = [
    { level: 'A1', theme: 'a1-desert', imageUrl: journeyBackgroundUrl('a1-desert', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_START' },
    { level: 'A2', theme: 'a2-coast', imageUrl: journeyBackgroundUrl('a2-coast', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_2' },
    { level: 'B1', theme: 'b1-lake', imageUrl: journeyBackgroundUrl('b1-lake', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_3' },
    { level: 'B2', theme: 'b2-snow', imageUrl: journeyBackgroundUrl('b2-snow', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_4' },
    { level: 'C1', theme: 'c1-cherry', imageUrl: journeyBackgroundUrl('c1-cherry', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_5' },
    { level: 'C2', theme: 'c2-tuscany', imageUrl: journeyBackgroundUrl('c2-tuscany', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_SUMMIT' },
  ];

  readonly controlActions = [
    { icon: 'create-outline', labelKey: 'JOURNEY.INTRO.S4_ACTION_EDIT' },
    { icon: 'map-outline', labelKey: 'JOURNEY.INTRO.S4_ACTION_ROADMAP' },
    { icon: 'flag-outline', labelKey: 'JOURNEY.INTRO.S4_ACTION_GOAL' },
  ];

  expanded = false;
  editPhases: EditablePhase[] = [];
  isSaving = false;
  languageDisplay = '';
  selfLevelLabel = '';
  startingChapterIndex = 0;
  startingChapterPreview: JourneyMapPreview | null = null;
  startingChapterRungLabel = '';
  mapPreviewPhases: JourneyMapPreviewPhase[] = [];
  mapPreviewCaption = '';

  constructor(
    private modalCtrl: ModalController,
    private learningPlanService: LearningPlanService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngOnInit() {
    this.languageDisplay = (this.language || '').trim() || 'your target language';
    const levelKey = JourneyIntroComponent.SELF_LEVEL_KEYS[this.plan?.selfAssessedLevel || ''];
    this.selfLevelLabel = levelKey ? this.translate.instant(levelKey) : '';

    const planChapterIndex = typeof this.plan?.chapterIndex === 'number'
      ? this.plan.chapterIndex
      : null;
    const selfChapterIndex = JourneyIntroComponent.SELF_ASSESSED_TO_CHAPTER_INDEX[this.plan?.selfAssessedLevel || ''];
    this.startingChapterIndex = Math.max(0, Math.min(5, planChapterIndex ?? selfChapterIndex ?? 0));
    this.startingChapterPreview = this.journeyMapPreviews[this.startingChapterIndex] || this.journeyMapPreviews[0];
    this.startingChapterRungLabel = this.translate.instant(this.startingChapterPreview.rungKey);
    this.mapPreviewPhases = this.buildMapPreviewPhases();
    this.mapPreviewCaption = `${this.startingChapterPreview.level} · ${this.startingChapterRungLabel}`;

    if (this.plan?.phases) {
      this.editPhases = this.plan.phases.map((p: any) => ({
        title: p.title || '',
        description: p.description || '',
        originalTitle: p.title || '',
        originalDescription: p.description || ''
      }));
    }
  }

  private buildMapPreviewPhases(): JourneyMapPreviewPhase[] {
    const rawCount = this.phaseLabels.length || this.plan?.phases?.length || 5;
    const count = Math.max(3, Math.min(5, rawCount));
    return Array.from({ length: count }, (_, i) => ({
      title: String(i + 1),
      status: i === 0 ? 'active' : 'locked',
    }));
  }

  next() {
    if (this.step >= this.slides.length - 1) {
      return;
    }
    const leavingIntro = this.step === 0;
    this.step++;
    if (leavingIntro) {
      void this.expandModalShell();
    }
    this.cdr.markForCheck();
  }

  prev() {
    if (this.step <= 0) {
      return;
    }
    const returningToIntro = this.step === 1;
    this.step--;
    if (returningToIntro) {
      void this.collapseModalShell();
    }
    this.cdr.markForCheck();
  }

  private async expandModalShell() {
    const modalEl = await this.modalCtrl.getTop();
    if (!modalEl) {
      return;
    }
    modalEl.classList.add('journey-intro-expanding');
    void (modalEl as HTMLElement).offsetWidth;
    modalEl.classList.add('journey-intro-expanded');
  }

  private async collapseModalShell() {
    const modalEl = await this.modalCtrl.getTop();
    if (!modalEl) {
      return;
    }
    modalEl.classList.remove('journey-intro-expanded');
    setTimeout(() => modalEl.classList.remove('journey-intro-expanding'), 450);
  }

  async expandAndEdit() {
    await this.expandModalShell();
    this.expanded = true;
    this.cdr.markForCheck();
  }

  async collapseBack() {
    this.expanded = false;
    this.cdr.markForCheck();
  }

  async savePhases() {
    const language = this.language || this.plan?.language;
    if (!language || this.isSaving) {
      return;
    }

    const changed: Array<{ index: number; phase: EditablePhase }> = [];
    for (let i = 0; i < this.editPhases.length; i++) {
      const phase = this.editPhases[i];
      if (phase.title !== phase.originalTitle || phase.description !== phase.originalDescription) {
        changed.push({ index: i, phase });
      }
    }

    if (!changed.length) {
      void this.toast.showInfo(this.translate.instant('JOURNEY.INTRO.EDIT_NO_CHANGES'));
      return;
    }

    for (const { phase } of changed) {
      if (!(phase.title || '').trim()) {
        void this.toast.showWarning(this.translate.instant('JOURNEY.EDIT.TITLE_REQUIRED'));
        return;
      }
    }

    this.isSaving = true;
    this.cdr.markForCheck();

    try {
      let latestPlan = this.plan;
      for (const { index, phase } of changed) {
        const res = await firstValueFrom(
          this.learningPlanService.editPhase(language, index, {
            title: phase.title.trim(),
            description: (phase.description || '').trim(),
          })
        );
        if (!res?.success) {
          throw new Error('save failed');
        }
        if (res.plan) {
          latestPlan = res.plan;
        }
        phase.title = phase.title.trim();
        phase.description = (phase.description || '').trim();
        phase.originalTitle = phase.title;
        phase.originalDescription = phase.description;
      }

      this.plan = latestPlan;
      this.phaseLabels = (latestPlan?.phases || []).map((p: { title?: string } | string) =>
        typeof p === 'string' ? p : (p.title || '')
      );
      void this.toast.showSuccess(this.translate.instant('JOURNEY.EDIT.SAVED'));
    } catch {
      void this.toast.showError(this.translate.instant('JOURNEY.EDIT.SAVE_FAILED'));
    } finally {
      this.isSaving = false;
      this.cdr.markForCheck();
    }
  }

  dismiss(reason: 'done' | 'edit' | 'skip') {
    if (this.requireConfirmation && reason !== 'done') {
      return;
    }
    this.done.emit(reason);
    void this.modalCtrl.dismiss({ reason }, reason === 'done' ? 'confirm' : undefined).then(() => {
      if (this.calledFromHome && reason === 'done') {
        void this.router.navigate(['/tabs/journey']);
      }
    });
  }

  confirmDismiss() {
    this.dismiss('done');
  }
}
