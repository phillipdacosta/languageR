import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostBinding,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  TrialLessonRating,
  TrialRecapLayoutState,
  TrialRecapStateService,
  TrialRecapStep,
} from '../../services/trial-recap-state.service';
import {
  BookableSlotPreview,
  TutorAvailabilityViewerComponent,
} from '../tutor-availability-viewer/tutor-availability-viewer.component';
import { ClassGoingMessageModalComponent } from '../class-going-message-modal/class-going-message-modal.component';

export interface TrialRecapTutor {
  _id: string;
  name?: string;
  firstName?: string;
  picture?: string;
  auth0Id?: string;
  auth0_id?: string;
}

@Component({
  selector: 'app-trial-lesson-recap-panel',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule, TutorAvailabilityViewerComponent],
  templateUrl: './trial-lesson-recap-panel.component.html',
  styleUrls: ['./trial-lesson-recap-panel.component.scss'],
})
export class TrialLessonRecapPanelComponent implements OnInit, OnChanges {
  /** TEMP — set to false before shipping. Shows calendar on book step for layout QA. */
  static readonly TEMP_FORCE_CALENDAR_FOR_DESIGN = false;

  @Input({ required: true }) lessonId!: string;
  @Input({ required: true }) tutor!: TrialRecapTutor;
  /** When false, skip the rating step (e.g. upcoming trial). */
  @Input() showRatingStep = true;
  /** When true, the host page renders the main trial title (post-lesson right column). */
  @Input() hideTrialTitle = false;
  /** Title for the inline head row when hideTrialTitle (from host page). */
  @Input() headTitle = '';
  @Input() headShowEmoji = false;
  @Output() layoutChange = new EventEmitter<TrialRecapLayoutState>();

  @HostBinding('class.trl-recap-host--full-calendar')
  get hostFullCalendarClass(): boolean {
    return this.showFullCalendarView;
  }

  @ViewChild('availabilityViewer') availabilityViewer?: TutorAvailabilityViewerComponent;

  tutorFirstName = '';
  tutorDisplayName = 'Tutor';
  selectedLessonRating: TrialLessonRating | null = null;
  rightPanelSteps: TrialRecapStep[] = ['rating'];
  rightPanelStepIndex = 0;
  showFullAvailabilityViewer = false;
  availabilityPreviewLoading = false;
  availabilityPreviewSlots: BookableSlotPreview[] = [];
  availabilityPreviewHasMore = false;
  availabilityPreviewEmpty = false;
  showTrialNextTitle = true;
  showTrialNextSub = true;

  ratingQuestionLead = '';
  ratingGreatLabel = '';
  ratingOkayLabel = '';
  ratingNotGoodLabel = '';
  positiveEnjoyedTitle = '';
  sorryTitle = '';
  sorryBody = '';
  findNewTutorsLabel = '';
  giveAnotherShotLabel = '';
  stepBackLabel = '';
  trialNextTitle = '';
  trialNextSub = '';
  availPreviewLoadingLabel = '';
  availNoSlotsBody = '';
  availSendMessageLabel = '';
  viewAvailabilityLabel = '';

  private availabilityPreviewScanning = false;

  constructor(
    private translate: TranslateService,
    private trialRecapState: TrialRecapStateService,
    private modalCtrl: ModalController,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.refreshLabels();
    this.hydrateFromStorage();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tutor']) {
      this.refreshTutorNames();
      this.refreshLabels();
    }
    if (changes['lessonId'] && !changes['lessonId'].firstChange) {
      this.hydrateFromStorage();
    }
  }

  get currentRightPanelStep(): TrialRecapStep {
    return this.rightPanelSteps[this.rightPanelStepIndex] ?? 'rating';
  }

  get canRightPanelGoBack(): boolean {
    return this.rightPanelStepIndex > 0;
  }

  get useAvailabilityPreview(): boolean {
    if (this.currentRightPanelStep !== 'book') return false;
    return (
      this.selectedLessonRating === 'great' ||
      this.selectedLessonRating === 'okay' ||
      this.selectedLessonRating === null
    );
  }

  get hasBookableAvailability(): boolean {
    return !this.availabilityPreviewLoading && !this.availabilityPreviewEmpty;
  }

  /** Full calendar only when the student opened it and slots exist. */
  get showFullCalendarView(): boolean {
    if (
      TrialLessonRecapPanelComponent.TEMP_FORCE_CALENDAR_FOR_DESIGN &&
      this.currentRightPanelStep === 'book'
    ) {
      return true;
    }
    return this.showFullAvailabilityViewer && this.hasBookableAvailability;
  }

  get showAvailabilityPreviewPanel(): boolean {
    return this.currentRightPanelStep === 'book' && !this.showFullCalendarView;
  }

  selectLessonRating(rating: TrialLessonRating): void {
    this.selectedLessonRating = rating;
    this.showFullAvailabilityViewer = false;
    if (rating === 'not_so_good') {
      this.pushRightPanelStep('sorry');
    } else {
      this.pushRightPanelStep('book');
      void this.refreshAvailabilityPreview();
    }
    this.persistState();
    this.updateTrialSectionVisibility();
    this.emitLayoutChange();
    this.cdr.markForCheck();
  }

  giveTutorAnotherShot(): void {
    void this.openFullAvailabilityOrPreview();
  }

  findNewTutors(): void {
    void this.router.navigate(['/tabs/tutor-search']);
  }

  rightPanelGoBack(): void {
    if (!this.canRightPanelGoBack) return;
    this.rightPanelStepIndex--;
    if (this.currentRightPanelStep !== 'book') {
      this.showFullAvailabilityViewer = false;
    }
    this.persistState();
    this.emitLayoutChange();
    this.cdr.markForCheck();
  }

  openFullAvailabilityViewer(): void {
    void this.openFullAvailabilityOrPreview();
  }

  private async openFullAvailabilityOrPreview(): Promise<void> {
    this.pushRightPanelStep('book');
    await this.refreshAvailabilityPreview();

    if (this.availabilityPreviewEmpty) {
      this.showFullAvailabilityViewer = false;
    } else {
      this.showFullAvailabilityViewer = true;
      await this.availabilityViewer?.jumpToFirstAvailableWeek();
    }

    this.persistState();
    this.updateTrialSectionVisibility();
    this.emitLayoutChange();
    this.cdr.markForCheck();
  }

  async onAvailabilityPreviewSlotClick(slot: BookableSlotPreview): Promise<void> {
    await this.availabilityViewer?.jumpToWeekContaining(slot.date);
    this.showFullAvailabilityViewer = true;
    this.persistState();
    this.cdr.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.availabilityViewer?.openBookableSlot(slot);
    this.updateTrialSectionVisibility();
    this.emitLayoutChange();
  }

  onAvailabilityPreloaded(): void {
    if (this.currentRightPanelStep === 'book') {
      void this.refreshAvailabilityPreview();
    }
  }

  async refreshAvailabilityPreview(): Promise<void> {
    if (!this.availabilityViewer || this.currentRightPanelStep !== 'book') return;
    if (this.availabilityPreviewScanning) return;

    this.availabilityPreviewScanning = true;
    this.availabilityPreviewLoading = true;
    this.cdr.markForCheck();

    try {
      const result = await this.availabilityViewer.scanBookableSlots(3);
      this.availabilityPreviewSlots = result.slots;
      this.availabilityPreviewHasMore = result.hasMore;
      this.availabilityPreviewEmpty =
        this.availabilityViewer.tutorBlocked || result.slots.length === 0;
    } finally {
      this.availabilityPreviewScanning = false;
      this.availabilityPreviewLoading = false;
      this.updateTrialSectionVisibility();
      this.emitLayoutChange();
      this.cdr.markForCheck();
    }
  }

  async openAskTutorForTimesMessage(): Promise<void> {
    const receiverId = this.resolveTutorMessageReceiverId();
    if (!receiverId) return;

    const modal = await this.modalCtrl.create({
      component: ClassGoingMessageModalComponent,
      componentProps: {
        attendees: [this.tutor],
        receiverId,
        receiverIds: [receiverId],
        className: '',
        classId: '',
        subtitleKey: 'POST_LESSON.STUDENT.AVAIL_MESSAGE_SUBTITLE',
        placeholderKey: 'POST_LESSON.STUDENT.AVAIL_MESSAGE_PLACEHOLDER',
      },
      cssClass: 'class-going-message-modal',
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data?.sent) {
      if (data?.kind === 'direct' && data?.userId) {
        await this.router.navigate(['/tabs/messages'], { queryParams: { userId: data.userId } });
      } else {
        await this.router.navigate(['/tabs/messages']);
      }
    }
  }

  private hydrateFromStorage(): void {
    const saved = this.lessonId ? this.trialRecapState.get(this.lessonId) : null;
    if (saved) {
      this.selectedLessonRating = saved.rating;
      this.rightPanelSteps = saved.steps.length ? [...saved.steps] : ['rating'];
      this.rightPanelStepIndex = Math.min(
        saved.stepIndex,
        Math.max(0, this.rightPanelSteps.length - 1)
      );
      this.showFullAvailabilityViewer = saved.showFullAvailability;
    } else {
      this.resetFlow();
    }
    this.updateTrialSectionVisibility();
    this.emitLayoutChange();
    this.cdr.markForCheck();
  }

  private resetFlow(): void {
    this.selectedLessonRating = null;
    this.showFullAvailabilityViewer = false;
    this.availabilityPreviewSlots = [];
    this.availabilityPreviewHasMore = false;
    this.availabilityPreviewEmpty = false;
    this.showTrialNextTitle = true;
    this.showTrialNextSub = true;
    if (this.showRatingStep) {
      this.rightPanelSteps = ['rating'];
    } else {
      this.rightPanelSteps = ['book'];
    }
    this.rightPanelStepIndex = 0;
  }

  private persistState(): void {
    if (!this.lessonId) return;
    this.trialRecapState.save(this.lessonId, {
      rating: this.selectedLessonRating,
      steps: [...this.rightPanelSteps],
      stepIndex: this.rightPanelStepIndex,
      showFullAvailability: this.showFullAvailabilityViewer,
    });
  }

  private pushRightPanelStep(step: TrialRecapStep): void {
    if (this.rightPanelStepIndex < this.rightPanelSteps.length - 1) {
      this.rightPanelSteps = this.rightPanelSteps.slice(0, this.rightPanelStepIndex + 1);
    }
    if (this.rightPanelSteps[this.rightPanelSteps.length - 1] === step) {
      return;
    }
    this.rightPanelSteps = [...this.rightPanelSteps, step];
    this.rightPanelStepIndex = this.rightPanelSteps.length - 1;
  }

  private updateTrialSectionVisibility(): void {
    const onBookStep = this.currentRightPanelStep === 'book';
    const isEmptyState =
      onBookStep &&
      this.showAvailabilityPreviewPanel &&
      !this.availabilityPreviewLoading &&
      this.availabilityPreviewEmpty;
    const isLoadingPreview =
      onBookStep && this.showAvailabilityPreviewPanel && this.availabilityPreviewLoading;

    if (isEmptyState || isLoadingPreview) {
      this.showTrialNextTitle = false;
      this.showTrialNextSub = false;
      return;
    }

    this.showTrialNextTitle = true;
    this.showTrialNextSub = true;
  }

  private refreshTutorNames(): void {
    const t = this.tutor;
    if (!t) {
      this.tutorFirstName = '';
      this.tutorDisplayName = 'Tutor';
      return;
    }
    this.tutorFirstName = t.firstName || t.name?.split(' ')[0] || 'Tutor';
    this.tutorDisplayName = t.name || this.tutorFirstName;
  }

  private refreshLabels(): void {
    this.refreshTutorNames();
    const name = this.tutorFirstName;
    this.ratingQuestionLead = this.t('POST_LESSON.STUDENT.RATING_QUESTION_LEAD');
    this.ratingGreatLabel = this.t('POST_LESSON.STUDENT.RATING_GREAT');
    this.ratingOkayLabel = this.t('POST_LESSON.STUDENT.RATING_OKAY');
    this.ratingNotGoodLabel = this.t('POST_LESSON.STUDENT.RATING_NOT_GOOD');
    this.positiveEnjoyedTitle = this.t('POST_LESSON.STUDENT.POSITIVE_ENJOYED', { name });
    this.sorryTitle = this.t('POST_LESSON.STUDENT.SORRY_TITLE');
    this.sorryBody = this.t('POST_LESSON.STUDENT.SORRY_BODY', { name });
    this.findNewTutorsLabel = this.t('POST_LESSON.STUDENT.FIND_NEW_TUTORS');
    this.giveAnotherShotLabel = this.t('POST_LESSON.STUDENT.GIVE_ANOTHER_SHOT', { name });
    this.stepBackLabel = this.t('POST_LESSON.STUDENT.STEP_BACK');
    this.trialNextTitle = this.t('POST_LESSON.STUDENT.TRIAL_NEXT');
    this.trialNextSub = this.t('POST_LESSON.STUDENT.TRIAL_HINT');
    this.availPreviewLoadingLabel = this.t('POST_LESSON.STUDENT.AVAIL_PREVIEW_LOADING');
    this.availNoSlotsBody = this.t('POST_LESSON.STUDENT.AVAIL_NO_SLOTS_BODY', { name });
    this.availSendMessageLabel = this.t('POST_LESSON.STUDENT.AVAIL_SEND_MESSAGE');
    this.viewAvailabilityLabel = this.t('POST_LESSON.STUDENT.VIEW_AVAILABILITY');
  }

  private resolveTutorMessageReceiverId(): string {
    const t = this.tutor;
    if (!t) return '';
    const auth0 = t.auth0Id || t.auth0_id;
    if (typeof auth0 === 'string' && auth0.trim()) return auth0.trim();
    const id = t._id;
    return id == null ? '' : String(id);
  }

  private emitLayoutChange(): void {
    this.layoutChange.emit({
      step: this.currentRightPanelStep,
      rating: this.selectedLessonRating,
      useAvailabilityPreview: this.useAvailabilityPreview,
      showFullAvailabilityViewer: this.showFullCalendarView,
      canGoBack: this.canRightPanelGoBack,
    });
  }

  private t(key: string, params?: Record<string, string>): string {
    return this.translate.instant(key, params);
  }
}
