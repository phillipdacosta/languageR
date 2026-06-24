import {
  Component,
  Input,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  JourneyMapPreviewComponent,
  JourneyMapPreviewPhase,
} from './journey-map-preview.component';
import { journeyBackgroundUrl } from './journey-map-assets';

interface JourneyMapPreview {
  level: string;
  theme: string;
  imageUrl: string;
  rungKey: string;
}

interface TutorIntroAction {
  imageUrl: string;
  labelKey: string;
}

/**
 * Post-onboarding tutor walkthrough — how student journeys work on Barnabi.
 * Mirrors the student journey intro structure with tutor-facing copy.
 */
@Component({
  selector: 'app-tutor-journey-intro',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [CommonModule, IonicModule, TranslateModule, JourneyMapPreviewComponent],
  templateUrl: './tutor-journey-intro.component.html',
  styleUrls: ['./tutor-journey-intro.component.scss'],
})
export class TutorJourneyIntroComponent {
  @Input() requireConfirmation = false;
  @Input() profileChecklistDoneCount = 0;
  @Input() profileChecklistTotal = 0;

  step = 0;
  readonly slides = [0, 1, 2, 3, 4];

  readonly journeyMapPreviews: JourneyMapPreview[] = [
    { level: 'A1', theme: 'a1-desert', imageUrl: journeyBackgroundUrl('a1-desert', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_START' },
    { level: 'A2', theme: 'a2-coast', imageUrl: journeyBackgroundUrl('a2-coast', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_2' },
    { level: 'B1', theme: 'b1-lake', imageUrl: journeyBackgroundUrl('b1-lake', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_3' },
    { level: 'B2', theme: 'b2-snow', imageUrl: journeyBackgroundUrl('b2-snow', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_4' },
    { level: 'C1', theme: 'c1-cherry', imageUrl: journeyBackgroundUrl('c1-cherry', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_5' },
    { level: 'C2', theme: 'c2-tuscany', imageUrl: journeyBackgroundUrl('c2-tuscany', 5), rungKey: 'JOURNEY.INTRO.MAP_RUNG_SUMMIT' },
  ];

  readonly startingChapterIndex = 0;
  readonly startingChapterPreview = this.journeyMapPreviews[0];
  readonly exampleChapterTheme = 'a1-desert';
  readonly exampleChapterLevel = 'A1';
  readonly exampleMapPhases: JourneyMapPreviewPhase[] = [
    { title: '1', status: 'active' },
    { title: '2', status: 'locked' },
    { title: '3', status: 'locked' },
    { title: '4', status: 'locked' },
    { title: '5', status: 'locked' },
  ];
  exampleMapCaption = '';

  readonly tutorActions: TutorIntroAction[] = [
    { imageUrl: journeyBackgroundUrl('a1-desert', 5), labelKey: 'TUTOR_JOURNEY.INTRO.S4_ACTION_LESSON_MAP' },
    { imageUrl: 'assets/journey-focus.png', labelKey: 'TUTOR_JOURNEY.INTRO.S4_ACTION_FOCUS' },
    { imageUrl: 'assets/journey-phase.png', labelKey: 'TUTOR_JOURNEY.INTRO.S4_ACTION_PHASES' },
  ];

  startingChapterRungLabel = '';
  profileProgressLabel = '';

  constructor(
    private modalCtrl: ModalController,
    private cdr: ChangeDetectorRef,
    private translate: TranslateService,
  ) {
    this.startingChapterRungLabel = this.translate.instant(this.startingChapterPreview.rungKey);
    this.exampleMapCaption = `${this.exampleChapterLevel} · ${this.startingChapterRungLabel}`;
  }

  get profileItemsRemaining(): number {
    return Math.max(0, this.profileChecklistTotal - this.profileChecklistDoneCount);
  }

  next(): void {
    if (this.step >= this.slides.length - 1) {
      return;
    }
    if (this.step === 0) {
      void this.expandModalShell();
    }
    this.step++;
    this.refreshSlideCopy();
    this.cdr.markForCheck();
  }

  prev(): void {
    if (this.step <= 0) {
      return;
    }
    const returningToIntro = this.step === 1;
    this.step--;
    if (returningToIntro) {
      void this.collapseModalShell();
    }
    this.refreshSlideCopy();
    this.cdr.markForCheck();
  }

  dismiss(reason: 'done' | 'skip'): void {
    if (this.requireConfirmation && reason !== 'done') {
      return;
    }
    void this.finishDismiss(reason);
  }

  confirmDismiss(): void {
    void this.finishDismiss('done');
  }

  private finishDismiss(reason: 'done' | 'skip'): void {
    void this.modalCtrl.dismiss(
      { reason },
      reason === 'done' ? 'confirm' : undefined
    );
  }

  private refreshSlideCopy(): void {
    if (this.step === 1 || this.step === 3) {
      this.startingChapterRungLabel = this.translate.instant(this.startingChapterPreview.rungKey);
      this.exampleMapCaption = `${this.exampleChapterLevel} · ${this.startingChapterRungLabel}`;
    }
    if (this.step === 4) {
      this.refreshProfileProgressLabel();
    }
  }

  private refreshProfileProgressLabel(): void {
    if (this.profileChecklistTotal > 0 && this.profileChecklistDoneCount < this.profileChecklistTotal) {
      this.profileProgressLabel = this.translate.instant('TUTOR_JOURNEY.INTRO.S4_PROFILE_NUDGE', {
        done: this.profileChecklistDoneCount,
        total: this.profileChecklistTotal,
        remaining: this.profileItemsRemaining,
      });
      return;
    }
    this.profileProgressLabel = this.translate.instant('TUTOR_JOURNEY.INTRO.S4_PROFILE_NUDGE_GENERIC');
  }

  private async expandModalShell(): Promise<void> {
    const modalEl = await this.modalCtrl.getTop();
    if (!modalEl) {
      return;
    }
    modalEl.classList.add('journey-intro-expanding');
    void (modalEl as HTMLElement).offsetWidth;
    modalEl.classList.add('journey-intro-expanded');
  }

  private async collapseModalShell(): Promise<void> {
    const modalEl = await this.modalCtrl.getTop();
    if (!modalEl) {
      return;
    }
    modalEl.classList.remove('journey-intro-expanded');
    await new Promise<void>(resolve => setTimeout(resolve, 450));
    modalEl.classList.remove('journey-intro-expanding');
  }
}
