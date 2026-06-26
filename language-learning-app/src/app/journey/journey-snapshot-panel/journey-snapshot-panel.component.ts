import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, IonModal } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  JourneyMapPreviewComponent,
  JourneyMapPreviewPhase
} from '../journey-map-preview.component';
import { JourneyMapsOverviewComponent } from '../journey-maps-overview/journey-maps-overview.component';

const CHAPTER_THEME_TO_INDEX: Record<string, number> = {
  'a1-desert': 0,
  'a2-coast': 1,
  'b1-lake': 2,
  'b2-snow': 3,
  'c1-cherry': 4,
  'c2-tuscany': 5
};

const CHAPTER_RUNG_KEYS = [
  'JOURNEY.INTRO.MAP_RUNG_START',
  'JOURNEY.INTRO.MAP_RUNG_2',
  'JOURNEY.INTRO.MAP_RUNG_3',
  'JOURNEY.INTRO.MAP_RUNG_4',
  'JOURNEY.INTRO.MAP_RUNG_5',
  'JOURNEY.INTRO.MAP_RUNG_SUMMIT'
];

/**
 * Clickable journey-map snapshot that opens an inline modal showing the
 * student's current stage. "Show full journey" expands the modal in place
 * (Create Material / journey-intro pattern) to the all-chapters overview.
 */
@Component({
  selector: 'app-journey-snapshot-panel',
  standalone: true,
  imports: [
    CommonModule,
    IonicModule,
    TranslateModule,
    JourneyMapPreviewComponent,
    JourneyMapsOverviewComponent
  ],
  templateUrl: './journey-snapshot-panel.component.html',
  styleUrls: ['./journey-snapshot-panel.component.scss']
})
export class JourneySnapshotPanelComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('stageModal') stageModal?: IonModal;

  @Input() sectionTitle = '';
  @Input() modalTitle = '';
  @Input() chapterTheme = 'a1-desert';
  @Input() chapterLevel = 'A1';
  @Input() phases: JourneyMapPreviewPhase[] = [];
  @Input() currentPhaseIndex = 0;
  @Input() caption = '';
  @Input() phaseLabel = '';
  @Input() focusLabel = '';
  @Input() showFullJourneyLabel = '';
  @Input() startingChapterIndex = -1;
  /** When set, tutor is viewing a student's journey (e.g. post-lesson, lesson details). */
  @Input() subjectDisplayName = '';

  /** Optional hook when the user finishes viewing the full journey overview. */
  @Output() showFullJourney = new EventEmitter<void>();

  modalOpen = false;
  modalExpanded = false;

  fullJourneyTitleLead = '';
  fullJourneyTitleTail = '';
  fullJourneyBodyCaption = '';
  fullJourneyStartHereBadge = '';
  resolvedStartingChapterIndex = 0;
  backToCurrentLabel = '';

  private readonly destroy$ = new Subject<void>();

  constructor(private translate: TranslateService) {}

  ngOnInit(): void {
    this.resolvedStartingChapterIndex = this.resolveStartingChapterIndex();
    this.rebuildFullJourneyCopy();
    this.translate.onLangChange.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.rebuildFullJourneyCopy();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['startingChapterIndex'] ||
      changes['chapterTheme'] ||
      changes['chapterLevel']
    ) {
      this.resolvedStartingChapterIndex = this.resolveStartingChapterIndex();
    }
    if (
      changes['startingChapterIndex'] ||
      changes['chapterTheme'] ||
      changes['showFullJourneyLabel'] ||
      changes['subjectDisplayName']
    ) {
      this.rebuildFullJourneyCopy();
    }
  }

  openModal(): void {
    this.modalExpanded = false;
    this.modalOpen = true;
  }

  onModalDismiss(): void {
    this.modalOpen = false;
    this.modalExpanded = false;
    void this.collapseModalShell(true);
  }

  closeModal(): void {
    this.modalOpen = false;
  }

  async onShowFullJourney(): Promise<void> {
    await this.expandModalShell();
    this.modalExpanded = true;
    this.showFullJourney.emit();
  }

  async backToCurrentStage(): Promise<void> {
    this.modalExpanded = false;
    await this.collapseModalShell(false);
  }

  private resolveStartingChapterIndex(): number {
    if (this.startingChapterIndex >= 0) {
      return Math.max(0, Math.min(5, this.startingChapterIndex));
    }
    const fromTheme = CHAPTER_THEME_TO_INDEX[(this.chapterTheme || '').toLowerCase()];
    if (typeof fromTheme === 'number') {
      return fromTheme;
    }
    const levelMap: Record<string, number> = {
      A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5
    };
    return levelMap[(this.chapterLevel || 'A1').toUpperCase()] ?? 0;
  }

  private rebuildFullJourneyCopy(): void {
    const idx = this.resolvedStartingChapterIndex;
    const rungKey = CHAPTER_RUNG_KEYS[idx] || CHAPTER_RUNG_KEYS[0];
    const chapterLabel = this.translate.instant(rungKey);
    const tutorView = !!this.subjectDisplayName?.trim();

    if (tutorView) {
      const name = this.subjectDisplayName.trim();
      this.fullJourneyTitleLead = this.translate.instant('TUTOR_JOURNEY.INTRO.S3_TITLE_LEAD');
      this.fullJourneyTitleTail = this.translate.instant('TUTOR_JOURNEY.INTRO.S3_TITLE_TAIL');
      this.fullJourneyBodyCaption = this.translate.instant('JOURNEY.SNAPSHOT.FULL_JOURNEY_BODY_TUTOR', {
        chapter: chapterLabel
      });
      this.fullJourneyStartHereBadge = this.translate.instant('JOURNEY.SNAPSHOT.STUDENT_IS_HERE', {
        name
      });
    } else {
      this.fullJourneyTitleLead = this.translate.instant('JOURNEY.INTRO.S3_TITLE_LEAD');
      this.fullJourneyTitleTail = this.translate.instant('JOURNEY.INTRO.S3_TITLE_TAIL');
      this.fullJourneyBodyCaption = this.translate.instant('JOURNEY.SNAPSHOT.FULL_JOURNEY_BODY_STUDENT', {
        chapter: chapterLabel
      });
      this.fullJourneyStartHereBadge = this.translate.instant('JOURNEY.SNAPSHOT.YOU_ARE_HERE');
    }

    this.backToCurrentLabel = this.translate.instant('JOURNEY.SNAPSHOT.BACK_TO_CURRENT_STAGE');
  }

  private async expandModalShell(): Promise<void> {
    const modalEl = await this.getModalElement();
    if (!modalEl) {
      return;
    }
    modalEl.classList.add('journey-current-stage-expanding');
    void modalEl.offsetWidth;
    modalEl.classList.add('journey-current-stage-expanded');
  }

  private async collapseModalShell(force: boolean): Promise<void> {
    const modalEl = await this.getModalElement();
    if (!modalEl) {
      return;
    }
    modalEl.classList.remove('journey-current-stage-expanded');
    if (force) {
      modalEl.classList.remove('journey-current-stage-expanding');
      return;
    }
    setTimeout(() => modalEl.classList.remove('journey-current-stage-expanding'), 450);
  }

  private async getModalElement(): Promise<HTMLElement | null> {
    const fromRef = (this.stageModal as unknown as { el?: HTMLElement })?.el;
    if (fromRef) {
      return fromRef;
    }
    return document.querySelector('ion-modal.journey-current-stage-modal') as HTMLElement | null;
  }
}
