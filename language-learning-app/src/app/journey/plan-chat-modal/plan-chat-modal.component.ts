import {
  Component, Input, OnInit, ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, AlertController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { take } from 'rxjs/operators';

import {
  LearningPlanService,
  LearningPlan,
  ChatTurn,
  ProposedPhase,
  ProposedChapterEdits,
  AiRegenStatus
} from '../../services/learning-plan.service';

/**
 * Conversational plan editing (Batch 12). Premium-only.
 *
 * Two-pane modal:
 *   - Left/top: chat thread with the AI
 *   - Right/bottom (when proposed edits exist): diff view showing
 *     before/after for each phase, with an "Apply" CTA that consumes
 *     one regen credit.
 *
 * The student can iterate freely on the chat — each turn is a cheap
 * proposal call. Only "Apply" costs a credit.
 *
 * See docs/learning-journey/scenarios.md and changelog.md (Batch 12).
 */
@Component({
  selector: 'app-plan-chat-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, IonicModule, TranslateModule],
  template: `
    <ion-header class="pcm-header">
      <ion-toolbar>
        <ion-title>{{ 'JOURNEY.CHAT.TITLE' | translate }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()" aria-label="Close">
            <ion-icon name="close" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <div class="pcm-meta" *ngIf="regen">
        <span class="pcm-regen-pill">
          {{ 'JOURNEY.CHAT.CREDITS' | translate: { remaining: regen.remaining, limit: regen.limit } }}
        </span>
      </div>
    </ion-header>

    <ion-content class="pcm-content">

      <div class="pcm-empty" *ngIf="!turns.length && !loadingReply">
        <ion-icon name="chatbubbles-outline"></ion-icon>
        <h3>{{ 'JOURNEY.CHAT.EMPTY_TITLE' | translate }}</h3>
        <p>{{ 'JOURNEY.CHAT.EMPTY_BODY' | translate }}</p>
      </div>

      <div class="pcm-thread">
        <div
          *ngFor="let t of turns; trackBy: trackTurn"
          class="pcm-bubble"
          [class.pcm-bubble--user]="t.role === 'user'"
          [class.pcm-bubble--ai]="t.role === 'assistant'">
          <div class="pcm-bubble-text">{{ t.content }}</div>
        </div>
        <div class="pcm-bubble pcm-bubble--ai pcm-bubble--loading" *ngIf="loadingReply">
          <div class="pcm-typing"><span></span><span></span><span></span></div>
        </div>
      </div>

      <div class="pcm-diff" *ngIf="proposedPhases?.length">
        <div class="pcm-diff-head">
          <ion-icon name="swap-vertical-outline"></ion-icon>
          <div>
            <h4>{{ 'JOURNEY.CHAT.PROPOSED_TITLE' | translate }}</h4>
            <p *ngIf="proposedSummary">{{ proposedSummary }}</p>
          </div>
        </div>
        <div class="pcm-diff-list">
          <div
            *ngFor="let pair of phasePairs; let i = index; trackBy: trackPair"
            class="pcm-diff-row"
            [class.pcm-diff-row--changed]="pair.changed">
            <div class="pcm-diff-index">{{ i + 1 }}</div>
            <div class="pcm-diff-cols">
              <div class="pcm-diff-col pcm-diff-col--before">
                <span class="pcm-diff-tag">{{ 'JOURNEY.CHAT.BEFORE' | translate }}</span>
                <h5>{{ pair.before.title }}</h5>
                <p>{{ pair.before.description }}</p>
              </div>
              <div class="pcm-diff-col pcm-diff-col--after">
                <span class="pcm-diff-tag pcm-diff-tag--after">{{ 'JOURNEY.CHAT.AFTER' | translate }}</span>
                <h5>{{ pair.after.title }}</h5>
                <p>{{ pair.after.description }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

    </ion-content>

    <ion-footer>
      <ion-toolbar>
        <div class="pcm-input-row" *ngIf="!proposedPhases?.length">
          <ion-textarea
            [(ngModel)]="draft"
            [placeholder]="'JOURNEY.CHAT.PLACEHOLDER' | translate"
            [autoGrow]="true"
            [rows]="1"
            [maxlength]="500"
            class="pcm-textarea">
          </ion-textarea>
          <button
            class="pcm-send"
            type="button"
            [disabled]="!draft.trim() || loadingReply"
            (click)="send()">
            <ion-icon name="arrow-up"></ion-icon>
          </button>
        </div>
        <div class="pcm-apply-row" *ngIf="proposedPhases?.length">
          <button
            class="pcm-secondary"
            type="button"
            [disabled]="applying"
            (click)="rejectProposal()">
            {{ 'JOURNEY.CHAT.KEEP_CHATTING' | translate }}
          </button>
          <button
            class="pcm-cta"
            type="button"
            [disabled]="applying || (regen && regen.remaining <= 0)"
            (click)="apply()">
            <ion-spinner name="dots" *ngIf="applying"></ion-spinner>
            <span *ngIf="!applying">{{ 'JOURNEY.CHAT.APPLY' | translate }}</span>
          </button>
        </div>
      </ion-toolbar>
    </ion-footer>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .pcm-header ion-toolbar { --background: #fff; --border-color: rgba(0,0,0,0.06); }
    .pcm-meta { padding: 4px 16px 10px; background: #fff; }
    .pcm-regen-pill {
      display: inline-block;
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      background: #f4f4f5;
      padding: 4px 10px;
      border-radius: 999px;
    }
    .pcm-content { --background: #fafafa; }
    .pcm-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 32px;
      color: #9ca3af;
      text-align: center;
    }
    .pcm-empty ion-icon { font-size: 56px; margin-bottom: 16px; color: #d1d5db; }
    .pcm-empty h3 { font-size: 18px; font-weight: 700; color: #111; margin: 0 0 6px; }
    .pcm-empty p { font-size: 14px; line-height: 1.5; max-width: 360px; margin: 0; }
    .pcm-thread {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 20px 16px 12px;
    }
    .pcm-bubble {
      max-width: 85%;
      padding: 12px 14px;
      border-radius: 16px;
      font-size: 14.5px;
      line-height: 1.5;
      word-wrap: break-word;
    }
    .pcm-bubble--user {
      align-self: flex-end;
      background: #111;
      color: #fff;
      border-bottom-right-radius: 6px;
    }
    .pcm-bubble--ai {
      align-self: flex-start;
      background: #fff;
      color: #111;
      border: 1px solid rgba(0,0,0,0.06);
      border-bottom-left-radius: 6px;
    }
    .pcm-bubble--loading { padding: 16px 18px; }
    .pcm-typing { display: flex; gap: 4px; }
    .pcm-typing span {
      width: 6px; height: 6px; border-radius: 50%;
      background: #9ca3af;
      animation: pcm-blink 1.2s infinite ease-in-out;
    }
    .pcm-typing span:nth-child(2) { animation-delay: 0.15s; }
    .pcm-typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes pcm-blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }

    .pcm-diff {
      margin: 16px;
      padding: 16px;
      background: #fff;
      border: 1px solid rgba(0,0,0,0.06);
      border-radius: 16px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.04);
    }
    .pcm-diff-head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
    .pcm-diff-head ion-icon { font-size: 22px; color: #111; padding-top: 2px; }
    .pcm-diff-head h4 { font-size: 16px; font-weight: 700; margin: 0 0 4px; color: #111; }
    .pcm-diff-head p { font-size: 13.5px; color: #6b7280; margin: 0; line-height: 1.45; }

    .pcm-diff-list { display: flex; flex-direction: column; gap: 10px; }
    .pcm-diff-row { display: flex; gap: 10px; padding: 10px; border-radius: 12px; background: #fafafa; }
    .pcm-diff-row--changed { background: #fff8e6; }
    .pcm-diff-index {
      width: 24px; height: 24px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: #111; color: #fff;
      border-radius: 50%;
      font-size: 12px; font-weight: 700;
    }
    .pcm-diff-cols { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    @media (max-width: 600px) { .pcm-diff-cols { grid-template-columns: 1fr; } }
    .pcm-diff-col h5 { font-size: 14px; margin: 4px 0; color: #111; font-weight: 600; }
    .pcm-diff-col p { font-size: 12.5px; color: #4b5563; margin: 0; line-height: 1.4; }
    .pcm-diff-tag {
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
      color: #9ca3af;
    }
    .pcm-diff-tag--after { color: #d97706; }
    .pcm-diff-col--before h5, .pcm-diff-col--before p { opacity: 0.7; }

    .pcm-input-row {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 10px 12px;
    }
    .pcm-textarea {
      flex: 1;
      --background: #f4f4f5;
      --padding-start: 14px;
      --padding-end: 14px;
      --padding-top: 10px;
      --padding-bottom: 10px;
      border-radius: 16px;
      font-size: 14.5px;
    }
    .pcm-send {
      width: 40px; height: 40px;
      flex-shrink: 0;
      border: none; background: #111; color: #fff;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      transition: opacity 0.2s ease;
    }
    .pcm-send:disabled { opacity: 0.35; cursor: not-allowed; }
    .pcm-send ion-icon { font-size: 18px; }

    .pcm-apply-row {
      display: flex;
      gap: 10px;
      padding: 10px 12px;
    }
    .pcm-secondary, .pcm-cta {
      flex: 1;
      height: 48px;
      border-radius: 14px;
      font-size: 14.5px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: opacity 0.2s ease;
    }
    .pcm-secondary { background: #f4f4f5; color: #111; }
    .pcm-cta {
      background: #111; color: #fff;
      display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    .pcm-cta:disabled { opacity: 0.4; cursor: not-allowed; }
  `]
})
export class PlanChatModalComponent implements OnInit {
  @Input() language!: string;
  @Input() plan!: LearningPlan;

  turns: ChatTurn[] = [];
  draft = '';
  loadingReply = false;
  applying = false;

  proposedPhases: ProposedPhase[] | null = null;
  proposedSummary = '';
  regen: AiRegenStatus | null = null;

  phasePairs: { before: ProposedPhase; after: ProposedPhase; changed: boolean }[] = [];

  constructor(
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private learningPlanService: LearningPlanService,
    private translate: TranslateService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    if (!this.language && this.plan?.language) this.language = this.plan.language;
  }

  trackTurn = (i: number, t: ChatTurn) => i + ':' + t.role;
  trackPair = (i: number) => i;

  async send() {
    const text = this.draft.trim();
    if (!text || this.loadingReply) return;
    this.draft = '';
    this.turns = [...this.turns, { role: 'user', content: text }];
    this.loadingReply = true;
    this.cdr.markForCheck();

    this.learningPlanService.chatProposeEdits(this.language, this.turns)
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          this.loadingReply = false;
          this.turns = [...this.turns, { role: 'assistant', content: res.reply || '' }];
          this.regen = res.regen || this.regen;
          if (res.proposedEdits?.phases) {
            this.proposedPhases = res.proposedEdits.phases;
            this.proposedSummary = res.proposedEdits.summary || '';
            this.phasePairs = this.computePairs(this.proposedPhases);
          } else {
            this.proposedPhases = null;
            this.proposedSummary = '';
            this.phasePairs = [];
          }
          this.cdr.markForCheck();
        },
        error: async (err) => {
          this.loadingReply = false;
          const msg = err?.error?.message || this.translate.instant('JOURNEY.CHAT.ERROR_GENERIC');
          this.turns = [...this.turns, { role: 'assistant', content: `⚠️ ${msg}` }];
          this.cdr.markForCheck();
        }
      });
  }

  rejectProposal() {
    this.proposedPhases = null;
    this.proposedSummary = '';
    this.phasePairs = [];
    this.cdr.markForCheck();
  }

  async apply() {
    if (!this.proposedPhases?.length || this.applying) return;

    if (this.regen && this.regen.remaining <= 1) {
      const alert = await this.alertCtrl.create({
        header: this.translate.instant('JOURNEY.CHAT.CONFIRM_TITLE'),
        message: this.translate.instant('JOURNEY.CHAT.CONFIRM_BODY', { remaining: this.regen.remaining }),
        buttons: [
          { text: this.translate.instant('JOURNEY.CHAT.CONFIRM_CANCEL'), role: 'cancel' },
          { text: this.translate.instant('JOURNEY.CHAT.CONFIRM_APPLY'), role: 'destructive' }
        ]
      });
      await alert.present();
      const { role } = await alert.onDidDismiss();
      if (role !== 'destructive') return;
    }

    this.applying = true;
    this.cdr.markForCheck();

    this.learningPlanService.chatApplyEdits(this.language, this.proposedPhases, this.proposedSummary)
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          this.applying = false;
          this.modalCtrl.dismiss({ applied: true, plan: res.plan, regen: res.regen });
        },
        error: async (err) => {
          this.applying = false;
          const msg = err?.error?.message || this.translate.instant('JOURNEY.CHAT.ERROR_APPLY');
          this.turns = [...this.turns, { role: 'assistant', content: `⚠️ ${msg}` }];
          this.cdr.markForCheck();
        }
      });
  }

  dismiss() {
    this.modalCtrl.dismiss({ applied: false });
  }

  private computePairs(after: ProposedPhase[]) {
    const before = (this.plan?.phases || []).map((p: any) => ({
      title: p.title || '',
      description: p.description || '',
      focusAreas: p.focusAreas || [],
      suggestedTopics: p.suggestedTopics || [],
      exitCriteria: p.exitCriteria || '',
      estimatedLessons: p.estimatedLessons || 5
    }));
    return after.map((a, i) => {
      const b = before[i] || a;
      const changed =
        a.title !== b.title ||
        a.description !== b.description ||
        JSON.stringify(a.focusAreas) !== JSON.stringify(b.focusAreas) ||
        JSON.stringify(a.suggestedTopics) !== JSON.stringify(b.suggestedTopics) ||
        a.exitCriteria !== b.exitCriteria ||
        a.estimatedLessons !== b.estimatedLessons;
      return { before: b, after: a, changed };
    });
  }
}
