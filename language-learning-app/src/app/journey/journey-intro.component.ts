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

        <!-- ── Slide 0: actual plan phases ── -->
        <div *ngIf="step === 0" class="ji-body ji-body--plan">

          <div class="ji-dots" aria-hidden="true">
            <span *ngFor="let _ of slides; let i = index"
                  class="ji-dot"
                  [class.ji-dot--active]="i === step"
                  [class.ji-dot--done]="i < step"></span>
          </div>

          <div class="ji-plan-header">
            <img
              src="assets/barnabi-journey-intro-hero.png"
              alt=""
              class="ji-hero-mascot"
              width="88"
              height="88"
              decoding="async" />
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

        <!-- ── Slide 1: adapts ── -->
        <div *ngIf="step === 1" class="ji-body ji-body--explain">
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
          <p class="ji-desc ji-desc--hint ji-animate-in ji-animate-in--5">{{ 'JOURNEY.INTRO.S2_HINT' | translate }}</p>
        </div>

        <!-- ── Slide 2: journey maps glimpse ── -->
        <div *ngIf="step === 2" class="ji-body ji-body--maps">
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
                     [class.ji-map-card--start]="i === 0"
                     [class.ji-map-card--summit]="i === journeyMapPreviews.length - 1"
                     [style.--map-index]="i">
                  <div class="ji-map-thumb" [style.background-image]="'url(' + map.imageUrl + ')'"></div>
                  <div class="ji-map-meta">
                    <span class="ji-map-level">{{ map.level }}</span>
                    <span class="ji-map-rung">{{ map.rungKey | translate }}</span>
                  </div>
                </div>
              </div>
            </div>
            <p class="ji-desc ji-maps-caption">{{ 'JOURNEY.INTRO.S3_BODY' | translate }}</p>
          </div>
        </div>

        <!-- ── Slide 3: control ── -->
        <div *ngIf="step === 3" class="ji-body ji-body--explain">
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
            <div *ngFor="let action of controlActions" class="ji-action-card">
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
      max-width: 640px;
      margin: 0 auto;
    }

    .ji-body--plan {
      align-items: flex-start;
      text-align: left;
      justify-content: flex-start;
      padding-top: 116px;
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
      display: flex; align-items: center; gap: 16px;
      margin-bottom: 24px; width: 100%;
    }

    .ji-hero-mascot {
      width: 88px;
      height: 88px;
      object-fit: contain;
      flex-shrink: 0;
      display: block;
      background: transparent;
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
    .ji-title--sm {
      font-size: 28px;
      letter-spacing: -0.5px;
      line-height: 1.2;
    }

    /* Slide 2 — matches Create Material bundles empty hero title */
    .ji-empty-title-block {
      margin: 0 0 12px;
      text-align: center;
    }

    .ji-empty-title {
      margin: 0;
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.6px;
      color: #222222;
      line-height: 1.1;
    }

    .ji-empty-title-tail {
      margin: 4px 0 0;
      font-size: 15px;
      line-height: 1.5;
      font-weight: 400;
      color: #484848;
      letter-spacing: -0.1px;
    }

    @keyframes jiSoftRise {
      from {
        opacity: 0;
        transform: translateY(18px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .ji-animate-in {
      opacity: 0;
      animation: jiSoftRise 0.5s cubic-bezier(0.32, 0.72, 0, 1) forwards;
    }

    .ji-animate-in--1 { animation-delay: 0.08s; }
    .ji-animate-in--2 { animation-delay: 0.14s; }
    .ji-animate-in--3 { animation-delay: 0.2s; }
    .ji-animate-in--4 { animation-delay: 0.28s; }
    .ji-animate-in--5 { animation-delay: 0.36s; }

    .ji-body--explain {
      justify-content: flex-start;
      padding-top: 56px;
    }

    .ji-focus-demo {
      width: 100%;
      max-width: 420px;
      margin: 0 0 20px;
    }

    .ji-focus-card {
      background: #ffffff;
      border: 1px solid #ebebeb;
      border-radius: 16px;
      padding: 16px 18px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
      text-align: left;
    }

    .ji-focus-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      color: #717171;
      margin-bottom: 12px;
    }

    .ji-focus-row {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .ji-focus-chip {
      display: inline-flex;
      align-items: center;
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.1px;
      line-height: 1.2;
      max-width: 100%;
    }

    .ji-focus-chip--before {
      background: #f7f7f7;
      color: #717171;
      border: 1px solid #ebebeb;
    }

    .ji-focus-chip--after {
      background: #f0fdf4;
      color: #1d8348;
      border: 1px solid rgba(52, 199, 89, 0.35);
      animation: jiFocusPulse 2.4s ease-in-out 0.8s infinite;
    }

    @keyframes jiFocusPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(52, 199, 89, 0); }
      50% { box-shadow: 0 0 0 4px rgba(52, 199, 89, 0.12); }
    }

    .ji-focus-arrow {
      font-size: 18px;
      color: #b0b0b0;
      flex-shrink: 0;
    }

    .ji-desc--hint {
      margin-top: 10px;
      font-size: 14px;
      color: #98989d;
    }

    .ji-action-cards {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      max-width: 420px;
      margin: 16px 0 20px;
    }

    .ji-action-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      background: #ffffff;
      border: 1px solid #ebebeb;
      border-radius: 14px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
      text-align: left;
    }

    .ji-action-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: #f7f7f7;
      border: 1px solid #ebebeb;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      ion-icon {
        font-size: 20px;
        color: #1d1d1f;
      }
    }

    .ji-action-label {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.1px;
      color: #1d1d1f;
      line-height: 1.35;
    }

    .ji-book-nudge {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      width: 100%;
      max-width: 420px;
      padding: 14px 16px;
      border-radius: 14px;
      background: linear-gradient(135deg, #f7f7f7 0%, #ffffff 100%);
      border: 1px solid #ebebeb;
      text-align: left;

      ion-icon {
        font-size: 22px;
        color: #1d1d1f;
        flex-shrink: 0;
        margin-top: 1px;
      }

      p {
        margin: 0;
        font-size: 14px;
        line-height: 1.5;
        font-weight: 500;
        color: #484848;
        letter-spacing: -0.1px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .ji-animate-in {
        animation: none !important;
        opacity: 1 !important;
        transform: none !important;
      }

      .ji-focus-chip--after {
        animation: none !important;
      }

      .ji-maps-title-block,
      .ji-maps-rail,
      .ji-map-card,
      .ji-maps-caption {
        animation: none !important;
        opacity: 1 !important;
        transform: none !important;
        position: static !important;
      }

      .ji-maps-stage {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
    }

    /* Slide 3 — journey maps preview */
    .ji-body--maps {
      align-items: stretch;
      justify-content: flex-start;
      text-align: center;
      padding-top: 32px;
      max-width: 100%;
    }

    .ji-maps-stage {
      position: relative;
      width: 100%;
      min-height: min(48vh, 360px);
      margin-top: 8px;
    }

    .ji-maps-title-block {
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      z-index: 2;
      animation: jiMapsTitleLift 0.72s cubic-bezier(0.32, 0.72, 0, 1) 0.12s forwards;
    }

    @keyframes jiMapsTitleLift {
      from {
        top: 50%;
        transform: translateY(-50%);
      }
      to {
        top: 0;
        transform: translateY(0);
      }
    }

    .ji-maps-rail {
      position: absolute;
      left: 0;
      right: 0;
      top: 96px;
      bottom: 64px;
      opacity: 0;
      animation: jiSoftRise 0.55s cubic-bezier(0.32, 0.72, 0, 1) 0.42s forwards;
    }

    .ji-maps-track {
      position: relative;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      flex-wrap: nowrap;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      height: 100%;
      padding: 20px 24px 8px;
      mask-image: linear-gradient(to right, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%);

      &::-webkit-scrollbar {
        display: none;
      }

      &::before {
        content: '';
        position: absolute;
        left: 56px;
        right: 56px;
        top: calc(20px + 37px);
        height: 2px;
        border-radius: 999px;
        background: linear-gradient(to right, #dddddd 0%, #717171 45%, #34c759 100%);
        opacity: 0.85;
        pointer-events: none;
      }
    }

    .ji-map-card {
      flex: 0 0 118px;
      scroll-snap-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      position: relative;
      z-index: 1;
      opacity: 0;
      transform: translateY(10px);
      animation: jiMapChipIn 0.42s cubic-bezier(0.32, 0.72, 0, 1) forwards;
      animation-delay: calc(0.52s + var(--map-index) * 0.07s);

      &:not(:last-child) {
        margin-right: 10px;
      }
    }

    @keyframes jiMapChipIn {
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .ji-map-thumb {
      width: 118px;
      height: 74px;
      border-radius: 12px;
      background-size: cover;
      background-position: center;
      border: 2px solid rgba(0, 0, 0, 0.08);
      box-shadow: 0 3px 12px rgba(0, 0, 0, 0.1);
      flex-shrink: 0;
      margin-bottom: 10px;
    }

    .ji-map-meta {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      min-width: 0;
      max-width: 118px;
      text-align: center;
    }

    .ji-map-level {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.2px;
      color: #222222;
    }

    .ji-map-rung {
      font-size: 13px;
      line-height: 1.35;
      color: #717171;
    }

    .ji-map-card--start .ji-map-thumb {
      border-color: #222222;
    }

    .ji-map-card--summit .ji-map-thumb {
      border-color: #34c759;
      box-shadow: 0 4px 14px rgba(52, 199, 89, 0.28);
    }

    .ji-map-card--summit .ji-map-level {
      color: #1d8348;
    }

    .ji-maps-caption {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      margin: 0;
      opacity: 0;
      animation: jiSoftRise 0.5s cubic-bezier(0.32, 0.72, 0, 1) 0.95s forwards;
    }

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
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      padding: 16px 24px;
      border-top: 1px solid #ebebeb;
      background: #ffffff;
    }

    .ji-footer-start {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }

    .ji-footer-spacer {
      flex: 1;
      min-width: 0;
    }

    .ji-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: auto;
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: -0.1px;
      white-space: nowrap;
      flex-shrink: 0;
      transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, border-color 0.15s ease;
      outline: none;
      -webkit-appearance: none;
      border: none;
      font-family: inherit;
      &:active { transform: scale(0.98); }
      &[disabled] { opacity: 0.5; cursor: not-allowed; }
    }

    .ji-btn--outline {
      padding: 12px 20px;
      background: #ffffff;
      color: #1d1d1f;
      border: 1.5px solid #e0e0e0;
      &:hover { background: #fafafa; border-color: #1d1d1f; }
    }

    .ji-btn--solid {
      background: #1d1d1f;
      color: #ffffff;
      &:hover { background: #333333; box-shadow: 0 4px 12px rgba(0,0,0,.15); }
    }

    .ji-btn--sm { font-size: 13px; padding: 12px 16px; }

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
      .ji-empty-title { color: #f5f5f7; }
      .ji-empty-title-tail { color: #98989d; }
      .ji-desc { color: #8e8e93; }
      .ji-map-level { color: #f5f5f7; }
      .ji-map-rung { color: #8e8e93; }
      .ji-map-card--summit .ji-map-level { color: #6ee7a0; }
      .ji-maps-track::before { background: linear-gradient(to right, #3a3a3c 0%, #98989d 45%, #34c759 100%); }

      .ji-focus-card { background: #2c2c2e; border-color: rgba(255,255,255,.08); box-shadow: none; }
      .ji-focus-label { color: #8e8e93; }
      .ji-focus-chip--before { background: #1c1c1e; color: #8e8e93; border-color: #3a3a3c; }
      .ji-focus-chip--after { background: rgba(52, 199, 89, 0.12); color: #6ee7a0; border-color: rgba(52, 199, 89, 0.35); }
      .ji-focus-arrow { color: #636366; }
      .ji-desc--hint { color: #636366; }
      .ji-action-card { background: #2c2c2e; border-color: rgba(255,255,255,.08); }
      .ji-action-icon { background: #1c1c1e; border-color: #3a3a3c; ion-icon { color: #f5f5f7; } }
      .ji-action-label { color: #f5f5f7; }
      .ji-book-nudge { background: linear-gradient(135deg, #2c2c2e 0%, #1c1c1e 100%); border-color: rgba(255,255,255,.08); ion-icon { color: #f5f5f7; } p { color: #98989d; } }

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
  /** New-user flow: no X/backdrop dismiss; must tap Okay on the last slide. */
  @Input() requireConfirmation = false;

  @Output() done = new EventEmitter<'done' | 'edit' | 'skip'>();

  step = 0;
  slides = [0, 1, 2, 3];

  readonly journeyMapPreviews: JourneyMapPreview[] = [
    { level: 'A1', theme: 'a1-desert', imageUrl: 'assets/journey-backgrounds/a1-desert.png', rungKey: 'JOURNEY.INTRO.MAP_RUNG_START' },
    { level: 'A2', theme: 'a2-coast', imageUrl: 'assets/journey-backgrounds/a2-coast.png', rungKey: 'JOURNEY.INTRO.MAP_RUNG_2' },
    { level: 'B1', theme: 'b1-lake', imageUrl: 'assets/journey-backgrounds/b1-lake.png', rungKey: 'JOURNEY.INTRO.MAP_RUNG_3' },
    { level: 'B2', theme: 'b2-snow', imageUrl: 'assets/journey-backgrounds/b2-snow.png', rungKey: 'JOURNEY.INTRO.MAP_RUNG_4' },
    { level: 'C1', theme: 'c1-cherry', imageUrl: 'assets/journey-backgrounds/c1-cherry.png', rungKey: 'JOURNEY.INTRO.MAP_RUNG_5' },
    { level: 'C2', theme: 'c2-tuscany', imageUrl: 'assets/journey-backgrounds/c2-tuscany.png', rungKey: 'JOURNEY.INTRO.MAP_RUNG_SUMMIT' },
  ];

  readonly controlActions = [
    { icon: 'create-outline', labelKey: 'JOURNEY.INTRO.S4_ACTION_EDIT' },
    { icon: 'map-outline', labelKey: 'JOURNEY.INTRO.S4_ACTION_ROADMAP' },
    { icon: 'flag-outline', labelKey: 'JOURNEY.INTRO.S4_ACTION_GOAL' },
  ];

  expanded = false;
  editPhases: EditablePhase[] = [];
  isSaving = false;

  constructor(
    private modalCtrl: ModalController,
    private learningPlanService: LearningPlanService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private toast: ToastService,
    private translate: TranslateService
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
