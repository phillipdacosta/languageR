import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewInit,
  Input,
  Output,
  EventEmitter,
  ChangeDetectorRef,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import {
  IonicModule,
  ToastController,
  ModalController,
  ActionSheetController,
  AlertController,
  ViewWillEnter,
  IonContent,
} from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { ClassService, ClassInvitation, CreateClassRequest } from '../../services/class.service';
import { UserService } from '../../services/user.service';
import { LessonService } from '../../services/lesson.service';
import { TutorAvailabilityViewerComponent } from '../../components/tutor-availability-viewer/tutor-availability-viewer.component';
import { AvailabilitySetupComponent } from '../../components/availability-setup/availability-setup.component';
import { StudentSelectionActionsheetComponent } from '../../components/student-selection-actionsheet/student-selection-actionsheet.component';
import { Subscription, firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { QuillEditorComponent } from 'ngx-quill';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ImageCropperComponent } from '../../components/image-cropper/image-cropper.component';

interface Student {
  _id: string;
  name: string;
  email: string;
  picture?: string;
  userType?: 'student' | 'tutor';
}

/** Tutor hub list card (precomputed for templates — no per-row method calls). */
export interface HubClassCardVm {
  id: string;
  name: string;
  price: number;
  priceDisplay: string;
  capacity: number;
  confirmedCount: number;
  startTime: string;
  endTime: string;
  whenLine: string;
  thumbUrl?: string;
  badgeKey:
    | 'SCHEDULE_CLASS.HUB_BADGE_LIVE'
    | 'SCHEDULE_CLASS.HUB_BADGE_UPCOMING'
    | 'SCHEDULE_CLASS.HUB_BADGE_PAST'
    | 'SCHEDULE_CLASS.HUB_BADGE_CANCELLED'
    | 'SCHEDULE_CLASS.HUB_BADGE_DRAFT';
  badgeClass: 'live' | 'upcoming' | 'past' | 'cancelled' | 'draft';
  canEdit: boolean;
  canCancel: boolean;
  /** Past, completed, or cancelled — tutor can remove from history list only. */
  canRemoveFromHistory: boolean;
  /** Unpublished server draft — continue wizard. */
  isDraft?: boolean;
  canResumeDraft?: boolean;
  canDiscardDraft?: boolean;
}

/** One screen per field when `inline` (modal / explore). */
type WizardScreenId =
  | 'type'
  | 'name'
  | 'description'
  | 'level'
  | 'duration'
  | 'pricing'
  | 'maxStudents'
  | 'minStudents'
  | 'flexibleMin'
  | 'invites'
  | 'schedule'
  | 'recurrence'
  | 'recurrenceCount'
  | 'student'
  | 'visibility'
  | 'thumbnail'
  | 'review';

@Component({
  selector: 'app-schedule-class',
  templateUrl: './schedule-class.page.html',
  styleUrls: ['./schedule-class.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, ReactiveFormsModule, RouterModule, TutorAvailabilityViewerComponent, AvailabilitySetupComponent, QuillEditorComponent, TranslateModule]
})
export class ScheduleClassPage implements OnInit, OnDestroy, ViewWillEnter, AfterViewInit {
  @Input() inline = false;
  /**
   * When true (desktop home modal), parent renders top bar + `cm-modal-footer`;
   * this component hides its internal wizard bar and ion nav row.
   */
  @Input() hostChromeFooter = false;
  @Output() goBackEvent = new EventEmitter<void>();
  @Output() classCreated = new EventEmitter<void>();
  @Output() classSaved = new EventEmitter<void>();
  /** Hub list changed (cancel, remove from history) — parent should refresh home lessons. */
  @Output() hubListMutated = new EventEmitter<void>();
  /** Inline/modal: user wants to browse public classes instead */
  @Output() browseClassesEvent = new EventEmitter<void>();
  /** Parent (OnPush) should markForCheck when wizard step chrome changes. */
  @Output() wizardLayoutChange = new EventEmitter<void>();

  // Flag to track if students have been loaded
  private studentsLoadAttempted = false;
  
  @ViewChild('stepContentScrollable', { read: ElementRef }) stepContentScrollable?: ElementRef;
  @ViewChild(IonContent) ionContent?: IonContent;

  ionViewWillEnter() {
    console.log('📍 ScheduleClassPage ionViewWillEnter() - students:', this.students.length, 'loading:', this.loadingStudents);
    // If students haven't been loaded yet, try loading them
    if (this.students.length === 0 && !this.loadingStudents) {
      console.log('🔄 ionViewWillEnter: Loading students...');
      this.loadStudents();
    }
  }
  classType: 'one' | 'recurring' = 'recurring'; // Default to multiple students
  students: Student[] = [];
  loadingStudents = false;
  showStudentDropdown = false;
  showEarningsBreakdown = false; // Toggle for earnings breakdown visibility

  /** Desktop modal: start on class list; `create` = stepper (group class, no type step). */
  scheduleHubPhase: 'list' | 'create' = 'create';
  hubListTab: 'active' | 'history' | 'drafts' = 'active';
  /** True after first hub list request finishes (success or error). Prevents empty-state flash before load. */
  hubInitialLoadDone = false;
  hubClassesLoading = false;
  hubLoadError = false;
  hubActiveCards: HubClassCardVm[] = [];
  hubHistoryCards: HubClassCardVm[] = [];
  hubDraftCards: HubClassCardVm[] = [];
  /** Hub list: class id being edited in wizard (PATCH on submit). */
  editingClassId: string | null = null;
  /** Server-backed hub wizard draft id (PATCH); not used when editing a scheduled class. */
  hubDraftClassId: string | null = null;
  hubClassDeleteInFlight = false;
  savingEdit = false;
  savingDraft = false;
  /** i18n keys for last-step primary CTA (inline + tab1 footer). */
  scheduleFooterPrimaryLabelKey = 'SCHEDULE_CLASS.CREATE_CLASS';
  scheduleFooterPrimaryBusyKey = 'SCHEDULE_CLASS.CREATING';
  /** Wide layout: use inline checklist instead of Ionic modal for multi-invite. */
  desktopInviteInlineList = false;
  inviteStudentPanelOpen = false;
  private userSubscription?: Subscription;
  
  // Step tracking — classic: 1–5 compound screens; inline: `wizardStepIndex` + `wizardScreenId`
  currentStep = 1;
  /** Index into `getWizardStepIds()` when `inline`. */
  wizardStepIndex = 0;
  /** Current wizard screen (inline only); synced in `syncStepUi` for templates. */
  wizardScreenId: WizardScreenId = 'type';
  /** i18n key for optional per-step title (inline). */
  wizardStepHeadingKey = '';
  /** Centered subline under headline (Create Material–style wizard). */
  wizardStepSublineKey = '';
  /** Previous step title for parent top bar `< …` (inline + hostChromeFooter). */
  wizardHostBackLabelKey = '';
  /** When true, parent renders footer; hide ion nav row here. */
  hideInlineWizardFooter = false;
  showStepsList = false; // For mobile: collapsible steps list (classic layout)

  /** Wizard (modal/inline): one screen per field */
  get useWizardLayout(): boolean {
    return this.inline;
  }

  /** Ordered step ids for classic (non-inline) layout only */
  get stepSequence(): number[] {
    return this.classType === 'one' ? [1, 2, 3, 5] : [1, 2, 3, 4, 5];
  }

  get displayStepIndex(): number {
    if (this.inline) {
      return this.wizardStepIndex + 1;
    }
    const i = this.stepSequence.indexOf(this.currentStep);
    return i >= 0 ? i + 1 : 1;
  }

  get displayStepTotal(): number {
    if (this.inline) {
      return this.getWizardStepIds().length;
    }
    return this.stepSequence.length;
  }

  /** Modal top bar title (tab1 reads via ViewChild). */
  get scheduleModalTitleKey(): string {
    if (this.hostChromeFooter && this.scheduleHubPhase === 'list') {
      return 'SCHEDULE_CLASS.HUB_TITLE';
    }
    if (this.editingClassId && this.hostChromeFooter && this.scheduleHubPhase === 'create') {
      return 'SCHEDULE_CLASS.HUB_EDIT_MODAL_TITLE';
    }
    return 'SCHEDULE_CLASS.MODAL_TITLE';
  }

  /** Show step fraction, progress rail, footer (tab1). */
  get scheduleHubShowsWizardChrome(): boolean {
    return this.hostChromeFooter && this.scheduleHubPhase === 'create';
  }

  /** Hub wizard: Save draft only after the class has a name (required for server drafts). */
  get hubSaveDraftButtonVisible(): boolean {
    if (!this.inline || this.editingClassId) {
      return false;
    }
    if (!this.hostChromeFooter || this.scheduleHubPhase !== 'create') {
      return false;
    }
    return !!String(this.form.getRawValue().name ?? '').trim();
  }

  get lastStepId(): number {
    const seq = this.stepSequence;
    return seq[seq.length - 1] ?? 5;
  }

  /** Synced when `currentStep` changes — for template (no method calls in HTML). */
  isLastScheduleStep = false;
  progressPercent = 0;

  /** Previous nav enabled (classic: not on first form step; wizard: not on type step) */
  get canSchedulePrevious(): boolean {
    if (this.inline) {
      if (this.hostChromeFooter && this.scheduleHubPhase === 'create' && this.wizardStepIndex <= 0) {
        return true;
      }
      return this.wizardStepIndex > 0;
    }
    return this.stepSequence.indexOf(this.currentStep) > 0;
  }

  getWizardStepIds(): WizardScreenId[] {
    if (!this.inline) {
      return [];
    }
    const steps: WizardScreenId[] = [];
    const skipTypeStep = this.hostChromeFooter && this.scheduleHubPhase === 'create';
    if (!skipTypeStep) {
      steps.push('type');
    }
    steps.push('name', 'description', 'level', 'duration');
    if (this.classType === 'recurring') {
      steps.push('maxStudents', 'pricing', 'minStudents', 'flexibleMin', 'invites', 'schedule', 'recurrence');
      if (this.form.value.recurrenceType !== 'none') {
        steps.push('recurrenceCount');
      }
    } else {
      steps.push('student', 'schedule');
    }
    steps.push('visibility', 'thumbnail', 'review');
    return steps;
  }

  /** Wizard review screen: label i18n key + plain-text value (no HTML). */
  wizardReviewRows: { labelKey: string; value: string }[] = [];
  /** Review preview: title, format badge key, meta chips. */
  wizardReviewHeroName = '';
  wizardReviewFormatLabelKey = '';
  wizardReviewMetaBadges: string[] = [];
  /** Rich-text description for review (Quill HTML); null when empty. */
  wizardReviewDescriptionHtml: SafeHtml | null = null;
  /** Safe `[src]` for review cover (string only; set in `refreshWizardReviewRows`). */
  wizardReviewThumbnailSrc = '';

  /**
   * When inline wizard is on the last screen, primary action should match `isWizardScreenValid` for that screen
   * (e.g. review + thumbnail rules), not only `form.invalid`.
   */
  footerCreateDisabled = false;

  private readonly wizardSublineKeys: Partial<Record<WizardScreenId, string>> = {
    name: 'SCHEDULE_CLASS.WIZARD_NAME_SUB',
    description: 'SCHEDULE_CLASS.WIZARD_DESCRIPTION_SUBLINE',
    level: 'SCHEDULE_CLASS.WIZARD_LEVEL_SUB',
    duration: 'SCHEDULE_CLASS.WIZARD_DURATION_SUB',
    pricing: 'SCHEDULE_CLASS.WIZARD_PRICING_SUB',
    maxStudents: 'SCHEDULE_CLASS.WIZARD_MAX_STUDENTS_SUB',
    minStudents: 'SCHEDULE_CLASS.WIZARD_MIN_STUDENTS_SUB',
    flexibleMin: 'SCHEDULE_CLASS.WIZARD_FLEXIBLE_MIN_SUB',
    invites: 'SCHEDULE_CLASS.WIZARD_INVITES_SUB',
    schedule: 'SCHEDULE_CLASS.WIZARD_SCHEDULE_SUB',
    recurrence: 'SCHEDULE_CLASS.WIZARD_RECURRENCE_SUB',
    recurrenceCount: 'SCHEDULE_CLASS.WIZARD_RECURRENCE_COUNT_SUB',
    student: 'SCHEDULE_CLASS.CHOOSE_STUDENT_DESC',
    visibility: 'SCHEDULE_CLASS.WIZARD_VISIBILITY_SUB',
    thumbnail: 'SCHEDULE_CLASS.WIZARD_THUMBNAIL_SUB',
    review: 'SCHEDULE_CLASS.WIZARD_REVIEW_SUB',
  };

  private readonly wizardHeadingKeys: Partial<Record<WizardScreenId, string>> = {
    name: 'SCHEDULE_CLASS.WIZARD_NAME_TITLE',
    description: 'SCHEDULE_CLASS.WIZARD_DESCRIPTION_TITLE',
    level: 'SCHEDULE_CLASS.WIZARD_LEVEL_TITLE',
    duration: 'SCHEDULE_CLASS.WIZARD_DURATION_TITLE',
    pricing: 'SCHEDULE_CLASS.WIZARD_PRICING_TITLE',
    maxStudents: 'SCHEDULE_CLASS.WIZARD_MAX_STUDENTS_TITLE',
    minStudents: 'SCHEDULE_CLASS.WIZARD_MIN_STUDENTS_TITLE',
    flexibleMin: 'SCHEDULE_CLASS.WIZARD_FLEXIBLE_MIN_TITLE',
    invites: 'SCHEDULE_CLASS.WIZARD_INVITES_TITLE',
    schedule: 'SCHEDULE_CLASS.WIZARD_SCHEDULE_TITLE',
    recurrence: 'SCHEDULE_CLASS.WIZARD_RECURRENCE_TITLE',
    recurrenceCount: 'SCHEDULE_CLASS.WIZARD_RECURRENCE_COUNT_TITLE',
    student: 'SCHEDULE_CLASS.CHOOSE_STUDENT',
    visibility: 'SCHEDULE_CLASS.WIZARD_VISIBILITY_TITLE',
    thumbnail: 'SCHEDULE_CLASS.WIZARD_THUMBNAIL_TITLE',
    review: 'SCHEDULE_CLASS.WIZARD_REVIEW_TITLE',
  };

  private updateScheduleSubmitLabels(): void {
    if (this.editingClassId && this.classType === 'recurring') {
      this.scheduleFooterPrimaryLabelKey = 'SCHEDULE_CLASS.HUB_SAVE_CLASS';
      this.scheduleFooterPrimaryBusyKey = 'SCHEDULE_CLASS.HUB_SAVING_CLASS';
    } else {
      this.scheduleFooterPrimaryLabelKey = 'SCHEDULE_CLASS.CREATE_CLASS';
      this.scheduleFooterPrimaryBusyKey = 'SCHEDULE_CLASS.CREATING';
    }
  }

  private syncStepUi(): void {
    if (this.inline) {
      if (this.hostChromeFooter && this.scheduleHubPhase === 'list') {
        this.wizardHostBackLabelKey = '';
        this.isLastScheduleStep = false;
        this.progressPercent = 0;
        this.hideInlineWizardFooter = this.hostChromeFooter;
        this.wizardReviewRows = [];
        this.wizardReviewHeroName = '';
        this.wizardReviewFormatLabelKey = '';
        this.wizardReviewMetaBadges = [];
        this.wizardReviewDescriptionHtml = null;
        this.wizardReviewThumbnailSrc = '';
        this.updateScheduleSubmitLabels();
        if (this.hostChromeFooter) {
          this.wizardLayoutChange.emit();
        }
        this.cdr.markForCheck();
        return;
      }
      const ids = this.getWizardStepIds();
      if (this.wizardStepIndex >= ids.length) {
        this.wizardStepIndex = Math.max(0, ids.length - 1);
      }
      this.wizardScreenId = ids[this.wizardStepIndex] ?? 'type';
      if (this.wizardScreenId !== 'invites') {
        this.inviteStudentPanelOpen = false;
      }
      this.wizardStepHeadingKey = this.wizardHeadingKeys[this.wizardScreenId] ?? '';
      this.wizardStepSublineKey = this.wizardSublineKeys[this.wizardScreenId] ?? '';
      this.isLastScheduleStep = this.wizardStepIndex >= ids.length - 1;
      this.syncWizardHostBackLabel(ids);
      this.refreshWizardReviewRows();
    } else {
      this.wizardScreenId = 'type';
      this.wizardStepHeadingKey = '';
      this.wizardStepSublineKey = '';
      this.wizardHostBackLabelKey = '';
      this.hideInlineWizardFooter = false;
      this.isLastScheduleStep = this.currentStep === this.lastStepId;
      this.wizardReviewRows = [];
      this.wizardReviewHeroName = '';
      this.wizardReviewFormatLabelKey = '';
      this.wizardReviewMetaBadges = [];
      this.wizardReviewDescriptionHtml = null;
      this.wizardReviewThumbnailSrc = '';
    }
    const t = this.displayStepTotal;
    this.progressPercent = t <= 0 ? 0 : (this.displayStepIndex / t) * 100;
    if (this.inline) {
      this.hideInlineWizardFooter = this.hostChromeFooter;
    }
    if (this.hostChromeFooter) {
      this.wizardLayoutChange.emit();
    }
    this.updateScheduleSubmitLabels();
    this.updateFooterCreateDisabled();
    this.prefetchAvailabilityWhenOnDateTimeStep();
    this.cdr.markForCheck();
  }

  private updateFooterCreateDisabled(): void {
    if (this.submitting) {
      this.footerCreateDisabled = true;
      return;
    }
    if (!this.inline) {
      const onFinalClassic =
        this.currentStep === this.lastStepId && !this.thumbnailFile && !this.form.value.thumbnail;
      this.footerCreateDisabled = this.form.invalid || !!onFinalClassic;
      return;
    }
    if (!this.isLastScheduleStep) {
      this.footerCreateDisabled = false;
      return;
    }
    this.footerCreateDisabled = !this.isWizardScreenValid(this.wizardScreenId);
  }

  private syncWizardHostBackLabel(ids: WizardScreenId[]): void {
    if (!this.hostChromeFooter) {
      this.wizardHostBackLabelKey = '';
      return;
    }
    if (this.scheduleHubPhase === 'create' && this.wizardStepIndex <= 0) {
      this.wizardHostBackLabelKey = 'SCHEDULE_CLASS.HUB_BACK_TO_LIST';
      return;
    }
    if (this.wizardStepIndex <= 0) {
      this.wizardHostBackLabelKey = '';
      return;
    }
    const prevId = ids[this.wizardStepIndex - 1];
    if (prevId === 'type') {
      this.wizardHostBackLabelKey = 'SCHEDULE_CLASS.WIZARD_BACK_TO_TYPE';
    } else {
      this.wizardHostBackLabelKey = this.wizardHeadingKeys[prevId] ?? '';
    }
  }

  private clampWizardStepAfterIdsChange(): void {
    if (!this.inline) {
      return;
    }
    const prevId = this.wizardScreenId;
    const ids = this.getWizardStepIds();
    if (prevId === 'recurrenceCount' && this.form.value.recurrenceType === 'none') {
      this.wizardStepIndex = Math.max(0, ids.indexOf('recurrence'));
    } else if (this.wizardStepIndex >= ids.length) {
      this.wizardStepIndex = Math.max(0, ids.length - 1);
    }
    this.syncStepUi();
  }

  private refreshWizardReviewRows(): void {
    if (!this.inline || (this.hostChromeFooter && this.scheduleHubPhase === 'list')) {
      this.wizardReviewRows = [];
      this.wizardReviewHeroName = '';
      this.wizardReviewFormatLabelKey = '';
      this.wizardReviewMetaBadges = [];
      this.wizardReviewDescriptionHtml = null;
      this.wizardReviewThumbnailSrc = '';
      return;
    }
    if (this.wizardScreenId !== 'review') {
      this.wizardReviewRows = [];
      this.wizardReviewHeroName = '';
      this.wizardReviewFormatLabelKey = '';
      this.wizardReviewMetaBadges = [];
      this.wizardReviewDescriptionHtml = null;
      this.wizardReviewThumbnailSrc = '';
      return;
    }
    const v = this.form.value;
    const rows: { labelKey: string; value: string }[] = [];
    const yn = (b: boolean) => (b ? 'SCHEDULE_CLASS.WIZARD_REVIEW_YES' : 'SCHEDULE_CLASS.WIZARD_REVIEW_NO');

    const nameTrim = (v.name || '').trim();
    this.wizardReviewHeroName = nameTrim || this.translate.instant('SCHEDULE_CLASS.WIZARD_REVIEW_UNTITLED');
    this.wizardReviewFormatLabelKey =
      this.classType === 'recurring'
        ? 'SCHEDULE_CLASS.WIZARD_REVIEW_TYPE_GROUP'
        : 'SCHEDULE_CLASS.WIZARD_REVIEW_TYPE_ONE';
    const datePart = this.formatReviewDate(v.date);
    const timePart = (v.time as string) || '—';
    const levelPart = this.getLevelLabel(v.level) || '—';
    const listingPart = this.translate.instant(
      v.isPublic ? 'SCHEDULE_CLASS.WIZARD_REVIEW_LISTING_PUBLIC' : 'SCHEDULE_CLASS.WIZARD_REVIEW_LISTING_PRIVATE'
    );
    this.wizardReviewMetaBadges = [datePart, timePart, levelPart, listingPart];
    const rawDesc = (v.description || '').trim();
    this.wizardReviewDescriptionHtml = this.isQuillEmptyDescription(rawDesc)
      ? null
      : this.sanitizer.bypassSecurityTrustHtml(rawDesc);
    const thumbRaw = this.thumbnailPreview || (typeof v.thumbnail === 'string' ? v.thumbnail : '');
    this.wizardReviewThumbnailSrc = (thumbRaw || '').trim();

    rows.push({
      labelKey: 'SCHEDULE_CLASS.WIZARD_REVIEW_DURATION',
      value: v.duration ? `${v.duration} min` : '—',
    });

    if (this.classType === 'recurring') {
      rows.push({ labelKey: 'SCHEDULE_CLASS.WIZARD_REVIEW_MAX', value: v.maxStudents != null ? String(v.maxStudents) : '—' });
      rows.push({ labelKey: 'SCHEDULE_CLASS.WIZARD_REVIEW_MIN', value: v.minStudents != null ? String(v.minStudents) : '—' });
      rows.push({ labelKey: 'SCHEDULE_CLASS.WIZARD_REVIEW_FLEXIBLE', value: this.translate.instant(yn(!!v.flexibleMinimum)) });
      const price = this.getFinalPrice();
      if (v.useSuggestedPricing) {
        rows.push({
          labelKey: 'SCHEDULE_CLASS.WIZARD_REVIEW_PRICE',
          value:
            price > 0
              ? this.translate.instant('SCHEDULE_CLASS.WIZARD_REVIEW_PRICE_SUGGESTED', { amount: `$${price.toFixed(2)}` })
              : '—',
        });
      } else {
        const cp = v.customPrice;
        rows.push({
          labelKey: 'SCHEDULE_CLASS.WIZARD_REVIEW_PRICE',
          value: cp != null && Number(cp) > 0 ? `$${Number(cp).toFixed(2)}` : '—',
        });
      }
      const invited = this.getSelectedStudents();
      rows.push({
        labelKey: 'SCHEDULE_CLASS.WIZARD_REVIEW_INVITES',
        value: invited.length ? invited.map(s => s.name).join(', ') : this.translate.instant('SCHEDULE_CLASS.WIZARD_REVIEW_NONE'),
      });
    } else {
      const st = this.students.find(s => s._id === v.studentId);
      rows.push({ labelKey: 'SCHEDULE_CLASS.WIZARD_REVIEW_STUDENT', value: st?.name || '—' });
    }

    if (this.classType === 'recurring') {
      rows.push({ labelKey: 'SCHEDULE_CLASS.WIZARD_REVIEW_RECURRENCE', value: this.recurrenceTypeLabel(v.recurrenceType) });
      if (v.recurrenceType && v.recurrenceType !== 'none') {
        rows.push({
          labelKey: 'SCHEDULE_CLASS.WIZARD_REVIEW_OCCURRENCES',
          value: v.recurrenceCount != null ? String(v.recurrenceCount) : '—',
        });
      }
    }

    rows.push({ labelKey: 'SCHEDULE_CLASS.WIZARD_REVIEW_PUBLIC', value: this.translate.instant(yn(!!v.isPublic)) });

    this.wizardReviewRows = rows;
  }

  /** True when Quill output has no visible text (e.g. empty `<p><br></p>`). */
  private isQuillEmptyDescription(html: string): boolean {
    const t = (html || '').trim();
    if (!t) {
      return true;
    }
    if (typeof document === 'undefined') {
      return !t.replace(/<[^>]*>/g, '').trim();
    }
    const el = document.createElement('div');
    el.innerHTML = t;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return !text;
  }

  private formatReviewDate(dateVal: string | null | undefined): string {
    if (!dateVal) {
      return '—';
    }
    const d = new Date(`${dateVal}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      return dateVal;
    }
    return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  }

  private recurrenceTypeLabel(rt: string | null | undefined): string {
    switch (rt) {
      case 'daily':
        return 'Daily';
      case 'weekly':
        return 'Weekly';
      case 'monthly':
        return 'Monthly';
      case 'none':
      default:
        return 'None (single class)';
    }
  }

  private isWizardScreenValid(screen: WizardScreenId): boolean {
    switch (screen) {
      case 'type':
        return true;
      case 'name':
        return this.form.controls.name.valid;
      case 'description':
        return this.form.controls.description.valid;
      case 'level':
        return this.form.controls.level.valid;
      case 'duration':
        return this.form.controls.duration.valid;
      case 'pricing': {
        if (this.form.value.useSuggestedPricing) {
          return true;
        }
        const c = this.form.controls.customPrice;
        return !!(c && c.valid && c.value != null && Number(c.value) > 0);
      }
      case 'maxStudents':
        return this.form.controls.maxStudents.valid;
      case 'minStudents':
        return this.form.controls.minStudents.valid;
      case 'flexibleMin':
        return true;
      case 'invites':
        return true;
      case 'schedule':
        return this.form.controls.date.valid && this.form.controls.time.valid;
      case 'recurrence':
        return this.form.controls.recurrenceType.valid;
      case 'recurrenceCount':
        if (this.form.value.recurrenceType === 'none') {
          return true;
        }
        return this.form.controls.recurrenceCount.valid;
      case 'student':
        return !!this.form.value.studentId && this.form.controls.studentId.valid;
      case 'visibility':
        return true;
      case 'thumbnail':
        return !!(this.thumbnailFile || this.form.value.thumbnail);
      case 'review':
        if (this.form.invalid) {
          return false;
        }
        return !!(this.thumbnailFile || this.form.value.thumbnail);
      default:
        return true;
    }
  }

  private markWizardScreenTouched(screen: WizardScreenId): void {
    switch (screen) {
      case 'name':
        this.form.controls.name.markAsTouched();
        break;
      case 'description':
        this.form.controls.description.markAsTouched();
        break;
      case 'level':
        this.form.controls.level.markAsTouched();
        break;
      case 'duration':
        this.form.controls.duration.markAsTouched();
        break;
      case 'pricing':
        if (!this.form.value.useSuggestedPricing) {
          this.form.controls.customPrice?.markAsTouched();
        }
        break;
      case 'maxStudents':
        this.form.controls.maxStudents.markAsTouched();
        break;
      case 'minStudents':
        this.form.controls.minStudents.markAsTouched();
        break;
      case 'schedule':
        this.form.controls.date.markAsTouched();
        this.form.controls.time.markAsTouched();
        break;
      case 'recurrence':
        this.form.controls.recurrenceType.markAsTouched();
        break;
      case 'recurrenceCount':
        this.form.controls.recurrenceCount.markAsTouched();
        break;
      case 'student':
        this.form.controls.studentId.markAsTouched();
        break;
      case 'thumbnail':
        this.form.controls.thumbnail?.markAsTouched();
        this.form.markAsTouched();
        break;
      case 'review':
        this.form.markAllAsTouched();
        break;
      default:
        break;
    }
  }

  private nextWizardStep(): void {
    const ids = this.getWizardStepIds();
    const cur = ids[this.wizardStepIndex];
    if (this.wizardStepIndex >= ids.length - 1 || cur === undefined) {
      return;
    }
    if (!this.isWizardScreenValid(cur)) {
      this.markWizardScreenTouched(cur);
      return;
    }
    this.wizardStepIndex++;
    this.syncStepUi();
    setTimeout(() => this.scrollToTopOnStepChange(), 100);
  }

  private previousWizardStep(): void {
    if (this.wizardStepIndex <= 0) {
      if (this.hostChromeFooter && this.scheduleHubPhase === 'create') {
        this.scheduleHubPhase = 'list';
        this.hubListTab = 'active';
        this.editingClassId = null;
        this.hubDraftClassId = null;
        this.updateScheduleSubmitLabels();
        this.loadHubClasses();
        this.syncStepUi();
        this.wizardLayoutChange.emit();
        this.cdr.markForCheck();
      }
      return;
    }
    this.wizardStepIndex--;
    this.syncStepUi();
    setTimeout(() => this.scrollToTopOnStepChange(), 100);
  }
  
  // Pricing properties
  readonly STANDARD_LESSON_DURATION = 50; // Base duration for tutor rates (50 minutes, not 60)
  readonly PLATFORM_FEE_PERCENTAGE = 20; // 20% platform fee - competitive and fair
  tutorStandardRate: number = 25; // Tutor's rate for a standard 50-minute lesson
  suggestedPrice: number = 0;
  currentUser: any = null;

  form = this.fb.group({
    studentId: [''],
    studentIds: [[] as string[]], // For multiple student selection
    name: ['', [Validators.required, Validators.maxLength(80)]],
    description: ['', [Validators.required, Validators.minLength(20)]],
    maxStudents: [2, [Validators.required, Validators.min(2), Validators.max(50)]], // Default to 2 for group classes
    minStudents: [2, [Validators.required, Validators.min(2)]], // Minimum students for class to run (default to 2 for group classes)
    flexibleMinimum: [false], // Run class even if minimum not met
    level: ['', Validators.required], // Class level
    duration: [null as number | null, Validators.required], // 25 | 50 (ion-select); null = unset
    date: ['', Validators.required],
    time: ['', Validators.required],
    isPublic: [false],
    thumbnail: [''],
    recurrenceType: ['none'],
    recurrenceCount: [1],
    useSuggestedPricing: [true], // Default to using suggested pricing
    customPrice: [null as number | null] // Custom price if not using suggested
  });

  levelOptions = [
    { value: 'any', label: 'Any Level' },
    { value: 'beginner', label: 'Beginner' },
    { value: 'intermediate', label: 'Intermediate' },
    { value: 'advanced', label: 'Advanced' }
  ];

  durationOptions = [
    { value: 25, label: '25 minutes' },
    { value: 50, label: '50 minutes' }
  ];

  submitting = false;
  thumbnailFile: File | null = null;
  thumbnailPreview: string | null = null;
  isUploadingThumbnail = false;

  quillConfig = {
    toolbar: [
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      [{ 'header': [1, 2, 3, false] }],
      ['link'],
      ['clean']
    ],
    placeholder: 'Describe what students will learn in this class, what materials they need, and any prerequisites...'
  };

  constructor(
    private readonly hostRef: ElementRef<HTMLElement>,
    private cdr: ChangeDetectorRef,
    private fb: FormBuilder,
    public router: Router,
    private toast: ToastController,
    private alertController: AlertController,
    private sanitizer: DomSanitizer,
    private classService: ClassService,
    private userService: UserService,
    private lessonService: LessonService,
    private modalController: ModalController,
    private actionSheetController: ActionSheetController,
    private http: HttpClient,
    private translate: TranslateService
  ) {
    // Update validators based on class type
    this.updateFormValidators();
  }

  /** Enter advances Next / Submit (desktop); capture phase avoids implicit <form> submit on single-line fields. */
  private readonly wizardEnterNavDown = (event: KeyboardEvent) => this.onWizardEnterKeydown(event);

  ngOnInit() {
    if (this.inline && this.hostChromeFooter) {
      this.scheduleHubPhase = 'list';
      this.hubInitialLoadDone = false;
      this.hubClassesLoading = true;
    }
    if (this.inline) {
      this.wizardStepIndex = 0;
    } else {
      this.currentStep = 1;
    }
    this.syncStepUi();
    this.updateDesktopInviteInlineFlag();
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this.wizardEnterNavDown, true);
    }
    // Wait for user to be loaded before loading students
    this.userSubscription = this.userService.currentUser$
      .pipe(
        filter(user => !!user?.id),
        take(1)
      )
      .subscribe(user => {
        console.log('✅ User loaded in ngOnInit:', user?.id);
        this.currentUser = user;
        // Load tutor's standard rate (for 50-minute lessons)
        this.tutorStandardRate = user?.onboardingData?.hourlyRate || 25;
        console.log('💰 Tutor standard rate (50-min):', this.tutorStandardRate);
        
        if (user?.id) {
          this.loadStudents();
        }
        // Hub list: loaded only from enterHubListMode() to avoid finishing before modal init (empty flash).

        // Calculate initial suggested price if level and duration are set
        this.calculateSuggestedPrice();
      });
    
    // Also try immediate load in case user is already available
    const currentUser = this.userService.getCurrentUserValue();
    if (currentUser?.id) {
      console.log('✅ User already available, loading students immediately');
      this.currentUser = currentUser;
      this.tutorStandardRate = currentUser?.onboardingData?.hourlyRate || 25;
      this.loadStudents();
      this.calculateSuggestedPrice();
    }

    // Subscribe to form changes to recalculate pricing
    this.form.get('level')?.valueChanges.subscribe(() => {
      this.calculateSuggestedPrice();
    });
    
    this.form.get('duration')?.valueChanges.subscribe(() => {
      this.calculateSuggestedPrice();
    });
    
    // Update minStudents max validator when maxStudents changes
    if (this.inline && this.hostChromeFooter) {
      this.form.get('name')?.valueChanges.subscribe(() => {
        this.wizardLayoutChange.emit();
        this.cdr.markForCheck();
      });
    }

    this.form.get('maxStudents')?.valueChanges.subscribe((maxStudents) => {
      const minStudentsControl = this.form.get('minStudents');
      if (minStudentsControl && maxStudents) {
        minStudentsControl.setValidators([
          Validators.required, 
          Validators.min(2), // Minimum 2 students for group classes
          Validators.max(maxStudents)
        ]);
        minStudentsControl.updateValueAndValidity();
        
        // Auto-adjust if minStudents exceeds new maxStudents
        const currentMin = minStudentsControl.value || 1;
        if (currentMin > maxStudents) {
          minStudentsControl.setValue(maxStudents);
        }
      }
    });
    
    // Set recommended minimum when duration or level changes
    this.form.get('duration')?.valueChanges.subscribe(() => {
      if (this.classType === 'recurring') {
        const recommended = this.getRecommendedMinimum();
        this.form.patchValue({ minStudents: recommended });
      }
    });

    this.form.get('recurrenceType')?.valueChanges.subscribe(() => {
      this.clampWizardStepAfterIdsChange();
    });
    this.form.get('isPublic')?.valueChanges.subscribe(() => {
      this.clampWizardStepAfterIdsChange();
    });
  }

  ngOnDestroy() {
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.wizardEnterNavDown, true);
    }
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }

  private onWizardEnterKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.repeat || event.defaultPrevented) {
      return;
    }
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (this.submitting) {
      return;
    }
    if (this.hostChromeFooter && this.scheduleHubPhase === 'list') {
      return;
    }
    const host = this.hostRef.nativeElement;
    const path = event.composedPath();
    if (!path.includes(host)) {
      return;
    }
    if (this.inline && this.wizardScreenId === 'type') {
      return;
    }

    const t = event.target;
    if (!(t instanceof Node)) {
      return;
    }

    for (const n of path) {
      if (!(n instanceof HTMLElement)) {
        continue;
      }
      if (n.tagName === 'TEXTAREA' || n.isContentEditable) {
        return;
      }
      if (n.classList?.contains('ql-editor') || n.classList?.contains('ql-container')) {
        return;
      }
      const tag = n.tagName?.toLowerCase();
      if (
        tag === 'ion-modal' ||
        tag === 'ion-popover' ||
        tag === 'ion-alert' ||
        tag === 'ion-action-sheet' ||
        tag === 'ion-picker'
      ) {
        return;
      }
    }

    const el = t instanceof Element ? t : null;
    if (el) {
      if (el.closest('button')) {
        return;
      }
      if (el.closest('ion-toggle, ion-checkbox, ion-radio, ion-datetime, ion-segment')) {
        return;
      }
    }

    event.preventDefault();
    event.stopPropagation();

    if (this.isLastScheduleStep) {
      if (!this.footerCreateDisabled) {
        void this.submit();
      }
    } else {
      this.nextStep();
    }
    this.cdr.markForCheck();
  }

  @HostListener('window:resize')
  onInviteLayoutResize(): void {
    this.updateDesktopInviteInlineFlag();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClickCloseInvitePanel(ev: MouseEvent): void {
    if (!this.inviteStudentPanelOpen || !this.desktopInviteInlineList) {
      return;
    }
    const t = ev.target as HTMLElement;
    if (t.closest('.student-selector') || t.closest('.sch-invite-panel')) {
      return;
    }
    this.inviteStudentPanelOpen = false;
    this.cdr.markForCheck();
  }

  private updateDesktopInviteInlineFlag(): void {
    this.desktopInviteInlineList = typeof window !== 'undefined' && window.innerWidth > 768;
    if (!this.desktopInviteInlineList) {
      this.inviteStudentPanelOpen = false;
    }
    this.cdr.markForCheck();
  }

  // Step navigation methods
  canGoToStep(step: number): boolean {
    if (step === 0) return this.inline;
    if (step <= this.currentStep) return true;

    if (step === 2) {
      return this.isStepValid(1);
    }
    if (step === 3) {
      return this.isStepValid(1) && this.isStepValid(2);
    }
    if (step === 4) {
      if (this.classType === 'one') return false;
      return this.isStepValid(1) && this.isStepValid(2) && this.isStepValid(3);
    }
    if (step === 5) {
      return this.isStepValid(1) && (this.classType === 'one' ? this.isStepValid(2) : this.isStepValid(2)) && this.isStepValid(3);
    }
    return false;
  }

  isStepValid(step: number): boolean {
    switch (step) {
      case 0:
        return true;
      case 1: // Class Basics
        return this.form.controls.name.valid && 
               this.form.controls.description.valid && 
               this.form.controls.level.valid && 
               this.form.controls.duration.valid;
      case 2: // Economics (group) or student (1:1)
        if (this.classType === 'one') {
          return !!this.form.value.studentId && this.form.controls.studentId.valid;
        }
        const customPriceValue = this.form.controls.customPrice?.value;
        const hasPrice = this.form.value.useSuggestedPricing || 
                        (customPriceValue !== null && customPriceValue !== undefined && customPriceValue > 0);
        return this.form.controls.maxStudents.valid && 
               this.form.controls.minStudents.valid && 
               hasPrice;
      case 3: // Schedule
        return this.form.controls.date.valid && this.form.controls.time.valid;
      case 4: // Recurrence (optional)
        return true; // Always valid, it's optional
      case 5: // Visibility + cover (thumbnail required)
        return !!(this.thumbnailFile || this.form.value.thumbnail);
      default:
        return true;
    }
  }

  ngAfterViewInit() {
    // Initial scroll to top
    this.scrollToTopOnStepChange();
  }

  private scrollToTopOnStepChange() {
    // Use Ionic's IonContent scrollToTop for proper mobile scrolling
    if (this.ionContent) {
      this.ionContent.scrollToTop(300);
    }
    
    // Also scroll the div element
    if (this.stepContentScrollable) {
      const element = this.stepContentScrollable.nativeElement;
      if (element) {
        element.scrollTop = 0;
      }
    }
    
    // Also scroll window for desktop
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  goToStep(step: number) {
    if (this.canGoToStep(step)) {
      this.currentStep = step;
      this.syncStepUi();
      setTimeout(() => this.scrollToTopOnStepChange(), 100);
    }
  }

  nextStep() {
    if (this.inline) {
      this.nextWizardStep();
      return;
    }
    const seq = this.stepSequence;
    const idx = seq.indexOf(this.currentStep);
    if (idx < 0 || idx >= seq.length - 1) return;
    if (!this.isStepValid(this.currentStep)) {
      this.markStepFieldsAsTouched(this.currentStep);
      return;
    }
    this.currentStep = seq[idx + 1];
    this.syncStepUi();
    setTimeout(() => this.scrollToTopOnStepChange(), 100);
  }

  previousStep() {
    if (this.inline) {
      this.previousWizardStep();
      return;
    }
    const seq = this.stepSequence;
    const idx = seq.indexOf(this.currentStep);
    if (idx <= 0) return;
    this.currentStep = seq[idx - 1];
    this.syncStepUi();
    setTimeout(() => this.scrollToTopOnStepChange(), 100);
  }

  selectWizardClassType(type: 'one' | 'recurring'): void {
    this.classType = type;
    this.onClassTypeChange();
    if (this.inline) {
      const ids = this.getWizardStepIds();
      const ix = ids.indexOf('name');
      this.wizardStepIndex = ix >= 0 ? ix : 1;
    } else {
      this.currentStep = 1;
    }
    this.syncStepUi();
    setTimeout(() => this.scrollToTopOnStepChange(), 100);
  }

  requestClose(): void {
    if (this.inline) {
      this.goBackEvent.emit();
    } else {
      void this.router.navigate(['/tabs/tutor-calendar']);
    }
  }

  onBrowsePublicClasses(): void {
    this.browseClassesEvent.emit();
  }

  private markStepFieldsAsTouched(step: number) {
    switch (step) {
      case 1:
        this.form.controls.name.markAsTouched();
        this.form.controls.description.markAsTouched();
        this.form.controls.level.markAsTouched();
        this.form.controls.duration.markAsTouched();
        break;
      case 2:
        if (this.classType === 'one') {
          this.form.controls.studentId.markAsTouched();
        } else {
          this.form.controls.maxStudents.markAsTouched();
          this.form.controls.minStudents.markAsTouched();
          if (!this.form.value.useSuggestedPricing) {
            this.form.controls.customPrice?.markAsTouched();
          }
        }
        break;
      case 3:
        this.form.controls.date.markAsTouched();
        this.form.controls.time.markAsTouched();
        break;
    }
  }

  onClassTypeChange() {
    this.updateFormValidators();
    if (this.classType === 'one') {
      this.form.patchValue({ recurrenceType: 'none', studentIds: [] });
    } else {
      this.form.patchValue({ studentId: '' });
      this.showStudentDropdown = false;
    }
  }

  private updateFormValidators() {
    if (this.classType === 'one') {
      this.form.get('studentId')?.setValidators([Validators.required]);
      this.form.get('recurrenceType')?.clearValidators();
      this.form.get('recurrenceCount')?.clearValidators();
    } else {
      this.form.get('studentId')?.clearValidators();
      this.form.get('recurrenceType')?.setValidators([Validators.required]);
      this.form.get('recurrenceCount')?.setValidators([Validators.required, Validators.min(1)]);
    }
    this.form.get('studentId')?.updateValueAndValidity();
    this.form.get('recurrenceType')?.updateValueAndValidity();
    this.form.get('recurrenceCount')?.updateValueAndValidity();
  }

  isSingleStudentSelected(): boolean {
    return !!this.form.value.studentId;
  }

  loadStudents() {
    console.log('🚀 loadStudents() called');
    this.studentsLoadAttempted = true;
    this.loadingStudents = true;
    const currentUser = this.userService.getCurrentUserValue();
    console.log('👤 Current user from service:', currentUser);
    
    if (!currentUser?.id) {
      console.log('❌ No current user ID found, will retry...');
      this.loadingStudents = false;
      // Retry after a short delay if user isn't available yet
      setTimeout(() => {
        const retryUser = this.userService.getCurrentUserValue();
        if (retryUser?.id) {
          console.log('🔄 Retrying loadStudents with user:', retryUser.id);
          this.loadStudents();
        }
      }, 500);
      return;
    }

    console.log('📞 Calling getMyLessons with userId:', currentUser.id);
    this.lessonService.getMyLessons(currentUser.id).subscribe({
      next: (response) => {
        if (response.success && response.lessons) {
          console.log('📚 All lessons received:', response.lessons.length);
          console.log('👤 Current user ID:', currentUser.id);
          
          // Extract unique students from lessons where current user is the tutor
          const studentMap = new Map<string, Student>();
          
          response.lessons.forEach((lesson, index) => {
            // Normalize tutorId - handle both object and string formats
            let tutorId: string | undefined;
            if (lesson.tutorId) {
              if (typeof lesson.tutorId === 'object' && lesson.tutorId !== null) {
                tutorId = (lesson.tutorId as any)._id?.toString() || (lesson.tutorId as any)._id;
              } else if (typeof lesson.tutorId === 'string') {
                tutorId = lesson.tutorId;
              } else {
                // Fallback: try to convert to string
                tutorId = String(lesson.tutorId);
              }
            }
            
            // Normalize current user ID for comparison
            const currentUserId = currentUser.id?.toString();
            
            // Debug logging for first few lessons
            if (index < 3) {
              console.log(`📋 Lesson ${index + 1}:`, {
                tutorId,
                tutorIdType: typeof tutorId,
                currentUserId,
                currentUserIdType: typeof currentUserId,
                tutorIdRaw: lesson.tutorId,
                hasStudentId: !!lesson.studentId,
                studentIdType: typeof lesson.studentId
              });
            }
            
            // Compare IDs (handle both string and ObjectId formats)
            if (tutorId && currentUserId) {
              // Normalize both to strings for comparison
              const normalizedTutorId = String(tutorId).trim();
              const normalizedCurrentUserId = String(currentUserId).trim();
              const isMatch = normalizedTutorId === normalizedCurrentUserId;
              
              if (index < 3) {
                console.log(`🔍 Comparison ${index + 1}:`, {
                  normalizedTutorId,
                  normalizedCurrentUserId,
                  isMatch
                });
              }
              
              if (isMatch && lesson.studentId && typeof lesson.studentId === 'object') {
                const student = lesson.studentId as any;
                console.log('✅ Found lesson with student:', student.name, student.email);
                
                const studentId = student._id?.toString() || student._id;
                if (studentId && !studentMap.has(studentId)) {
                  // Format display name as "FirstName LastInitial."
                  let displayName = student.name || student.email || 'Unknown';
                  
                  // Try to use firstName and lastName if available
                  if (student.firstName) {
                    const firstName = student.firstName;
                    const lastName = student.lastName || '';
                    displayName = lastName 
                      ? `${firstName} ${lastName.charAt(0).toUpperCase()}.`
                      : firstName;
                  } else if (student.name) {
                    // Parse from full name
                    const nameParts = student.name.trim().split(' ');
                    if (nameParts.length > 1) {
                      const firstName = nameParts[0];
                      const lastName = nameParts[nameParts.length - 1];
                      displayName = `${firstName} ${lastName.charAt(0).toUpperCase()}.`;
                    } else {
                      displayName = student.name;
                    }
                  }
                  
                  studentMap.set(studentId, {
                    _id: studentId,
                    name: displayName,
                    email: student.email || '',
                    picture: student.picture,
                    userType: 'student'
                  });
                }
              } else if (isMatch && !lesson.studentId) {
                console.log('⚠️ Lesson matched but no studentId:', lesson);
              }
            } else {
              if (index < 3) {
                console.log(`❌ Lesson ${index + 1} - Missing IDs:`, { tutorId, currentUserId });
              }
            }
          });
          
          this.students = Array.from(studentMap.values());
          console.log('👥 Unique students found:', this.students.length, this.students.map(s => s.name));
          
          // If no students found, log all lessons for debugging
          if (this.students.length === 0 && response.lessons.length > 0) {
            console.log('🔍 No students found. All lessons:', response.lessons.map((l: any, i: number) => ({
              index: i,
              tutorId: l.tutorId,
              tutorIdType: typeof l.tutorId,
              tutorId_id: (l.tutorId as any)?._id,
              studentId: l.studentId,
              studentIdType: typeof l.studentId,
              studentId_id: (l.studentId as any)?._id,
              studentName: (l.studentId as any)?.name
            })));
          }
          // Sort by name
          this.students.sort((a, b) => a.name.localeCompare(b.name));
        } else {
          console.log('⚠️ No lessons found or response not successful');
        }
        this.loadingStudents = false;
      },
      error: (error) => {
        console.error('❌ Error loading students:', error);
        this.loadingStudents = false;
      }
    });
  }
  
  // Availability picker modal state
  isAvailabilityPickerOpen = false;
  availabilityPickerProps: any = null;
  modalView: 'availability-viewer' | 'availability-setup' = 'availability-viewer';
  availabilityRefreshTrigger = 0; // Used to refresh the availability viewer
  /** True while tutor availability + bookings prefetch (same calls as availability viewer) is in flight. */
  private scheduleAvailabilityPrefetchInFlight = false;

  /**
   * Warm the same HTTP data the availability picker uses so opening the modal feels instant.
   * Runs when the user lands on date/time (wizard `schedule` or classic step 3).
   */
  private prefetchAvailabilityWhenOnDateTimeStep(): void {
    if (this.hostChromeFooter && this.scheduleHubPhase === 'list') return;
    const currentUser = this.userService.getCurrentUserValue();
    const tutorId = currentUser?.id;
    if (!tutorId || this.scheduleAvailabilityPrefetchInFlight) return;
    this.scheduleAvailabilityPrefetchInFlight = true;
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(weekStart);
    rangeEnd.setDate(rangeEnd.getDate() + 28);
    const sd = weekStart.toISOString();
    const ed = rangeEnd.toISOString();
    void Promise.all([
      firstValueFrom(this.userService.getTutorAvailability(tutorId)).catch(() => null),
      firstValueFrom(this.lessonService.getLessonsByTutor(tutorId, false, sd, ed)).catch(() => null),
      firstValueFrom(this.classService.getClassesForTutor(tutorId, sd, ed)).catch(() => null),
    ]).finally(() => {
      this.scheduleAvailabilityPrefetchInFlight = false;
    });
  }

  async openAvailabilityPicker() {
    const currentUser = this.userService.getCurrentUserValue();
    console.log('🔍 [Schedule Class] Opening availability picker with user:', currentUser);
    
    if (!currentUser?.id) {
      console.error('❌ [Schedule Class] Cannot open availability picker: currentUser.id is missing', currentUser);
      const toast = await this.toast.create({
        message: 'Unable to load availability. Please try again.',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
      return;
    }

    console.log('✅ [Schedule Class] Valid user ID:', currentUser.id);

    // Get selected duration from form (only for recurring/multiple-students classes)
    const selectedDuration = this.classType === 'recurring' && this.form.value.duration 
      ? Number(this.form.value.duration) 
      : 25; // Default to 25

    console.log('📅 [Schedule Class] Setting modal props:', {
      tutorId: currentUser.id,
      tutorName: currentUser.name || 'You',
      currentUserAuth0Id: currentUser.auth0Id,
      tutorAuth0Id: currentUser.auth0Id,
      selectedDuration
    });

    // Set props for inline modal
    this.availabilityPickerProps = {
      tutorId: currentUser.id,
      tutorName: currentUser.name || 'You',
      currentUserAuth0Id: currentUser.auth0Id,
      tutorAuth0Id: currentUser.auth0Id,
      inline: true,
      selectionMode: true,
      dismissOnSelect: true,
      showDurationSelector: false,
      selectedDuration: selectedDuration
    };

    // Reset modal view and open
    this.modalView = 'availability-viewer';
    this.isAvailabilityPickerOpen = true;
  }

  onAvailabilityPickerDismiss(event: any) {
    console.log('📅 Availability picker dismissed:', event);
    this.isAvailabilityPickerOpen = false;
    this.modalView = 'availability-viewer'; // Reset to default view
    
    const data = event.detail?.data;
    if (data?.selectedDate && data?.selectedTime) {
      // Fill in the form with the selected date/time
      this.form.patchValue({
        date: data.selectedDate,
        time: data.selectedTime
      });
    }
  }

  showAddAvailability() {
    this.modalView = 'availability-setup';
  }

  goBackToAvailabilityViewer() {
    this.modalView = 'availability-viewer';
  }

  onAvailabilitySaved() {
    // When availability is saved, go back to the viewer to let tutor select a slot
    this.modalView = 'availability-viewer';
    // Trigger a refresh of the availability viewer
    this.availabilityRefreshTrigger++;
  }

  async onThumbnailSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.toast.create({ message: 'Please select a valid image file', duration: 2000, color: 'danger' }).then(t => t.present());
      event.target.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.toast.create({ message: 'Image size must be less than 5MB', duration: 2000, color: 'danger' }).then(t => t.present());
      event.target.value = '';
      return;
    }

    const modal = await this.modalController.create({
      component: ImageCropperComponent,
      componentProps: {
        imageChangedEvent: event,
        aspectRatio: 16 / 10,
        cropTitle: 'Crop cover image',
      },
      cssClass: 'image-cropper-modal',
    });

    await modal.present();
    const { data, role } = await modal.onWillDismiss();

    if (role === 'crop' && data) {
      this.thumbnailFile = new File([data], file.name, { type: 'image/png' });
      this.thumbnailPreview = URL.createObjectURL(data);
      this.refreshWizardReviewRows();
      this.updateFooterCreateDisabled();
      this.cdr.detectChanges();
    }
    event.target.value = '';
  }

  removeThumbnail() {
    this.thumbnailFile = null;
    this.thumbnailPreview = null;
    this.form.patchValue({ thumbnail: '' });
    this.refreshWizardReviewRows();
    this.updateFooterCreateDisabled();
    this.cdr.markForCheck();
  }

  async uploadThumbnailToGCS(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('thumbnail', file);

    // Get current user for auth token
    const currentUser = this.userService.getCurrentUserValue();
    if (!currentUser || !currentUser.email) {
      throw new Error('User not authenticated');
    }

    // Create headers with ONLY Authorization - don't set Content-Type for FormData
    // Browser will automatically set Content-Type with boundary for multipart/form-data
    const userEmail = currentUser.email;
    const authToken = `Bearer dev-token-${userEmail.replace('@', '-').replace(/\./g, '-')}`;
    const headers = new HttpHeaders({
      'Authorization': authToken
      // Don't set Content-Type - let browser handle it for multipart/form-data
    });
    
    const response = await this.http.post<{ success: boolean; imageUrl: string }>(
      `${environment.backendUrl}/api/classes/upload-thumbnail`,
      formData,
      { headers }
    ).toPromise();

    if (!response || !response.success) {
      throw new Error('Failed to upload thumbnail');
    }

    return response.imageUrl;
  }

  async submit() {
    if (this.inline) {
      const ids = this.getWizardStepIds();
      const cur = ids[this.wizardStepIndex];
      if (cur && !this.isWizardScreenValid(cur)) {
        this.markWizardScreenTouched(cur);
        return;
      }
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (!this.thumbnailFile && !this.form.value.thumbnail) {
      const t = await this.toast.create({
        message: this.translate.instant('SCHEDULE_CLASS.WIZARD_THUMBNAIL_REQUIRED_TOAST'),
        duration: 2500,
        color: 'warning',
      });
      await t.present();
      return;
    }

    this.submitting = true;
    
    try {
      if (this.thumbnailFile) {
        this.isUploadingThumbnail = true;
        
        try {
          const thumbnailUrl = await this.uploadThumbnailToGCS(this.thumbnailFile);
          this.form.patchValue({ thumbnail: thumbnailUrl });
          this.thumbnailFile = null;
          this.isUploadingThumbnail = false;
        } catch (uploadError) {
          console.error('Error uploading thumbnail:', uploadError);
          this.isUploadingThumbnail = false;
          const t = await this.toast.create({
            message: 'Failed to upload thumbnail. Please try again.',
            duration: 2000,
            color: 'danger'
          });
          await t.present();
          this.submitting = false;
          return;
        }
      }

      const { date, time, name, description, maxStudents, level, duration, isPublic, thumbnail, studentId, recurrenceType, recurrenceCount } = this.form.value;
      const start = new Date(`${date}T${time}`);
      const end = new Date(start);
      // Use selected duration for recurring classes, default to 60 for one-time lessons
      const lessonDuration = this.classType === 'recurring' && duration ? Number(duration) : 60;
      end.setMinutes(end.getMinutes() + lessonDuration);
      
      // Validate that the class time is in the future
      const now = new Date();
      if (end <= now) {
        const t = await this.toast.create({ 
          message: 'Please select a future date and time for your class', 
          duration: 2500, 
          color: 'warning' 
        });
        await t.present();
        this.submitting = false;
        return;
      }
      
      console.log('Creating class with times:', {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        duration: lessonDuration,
        isPublic,
        name
      });

      if (this.classType === 'one') {
        if (!studentId) {
          const t = await this.toast.create({ message: 'Please select a student', duration: 1800, color: 'danger' });
          await t.present();
          this.submitting = false;
          return;
        }

        // Create a single lesson for one student
        const currentUser = this.userService.getCurrentUserValue();
        if (!currentUser?.id) {
          const t = await this.toast.create({ message: 'User not found', duration: 1800, color: 'danger' });
          await t.present();
          this.submitting = false;
          this.updateFooterCreateDisabled();
          return;
        }

        // Use lesson service to create a lesson
        const lessonPayload = {
          tutorId: currentUser.id,
          studentId: studentId as string,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          subject: name as string,
          description: description as string,
          price: 0, // Default price, can be updated later
          duration: 60,
          thumbnail: (this.form.value.thumbnail as string) || undefined,
        };

        this.lessonService.createLesson(lessonPayload).subscribe({
          next: async (resp) => {
            console.log('📚 Lesson created:', resp);
            this.submitting = false;
            this.updateFooterCreateDisabled();
            const t = await this.toast.create({ message: 'Lesson scheduled successfully', duration: 1500, color: 'success' });
            await t.present();
            this.userService.getAvailability().subscribe({
              next: () => {
                this.emitAfterInlineCreateSuccess();
                if (!this.inline) {
                  this.router.navigate(['/tabs/tutor-calendar']);
                }
              }
            });
          },
          error: async (err) => {
            console.error('❌ Error creating lesson:', err);
            this.submitting = false;
            this.updateFooterCreateDisabled();
            const t = await this.toast.create({ message: 'Failed to schedule lesson', duration: 1800, color: 'danger' });
            await t.present();
          }
        });
      } else {
        // Create a recurring class
        const finalPrice = this.getFinalPrice();
        const recurringBody = {
          name: name as string,
          description: description as string,
          capacity: Number(maxStudents),
          minStudents: Number(this.form.value.minStudents) || 2,
          flexibleMinimum: !!this.form.value.flexibleMinimum,
          level: level as string,
          duration: Number(duration),
          isPublic: !!isPublic,
          thumbnail: thumbnail || undefined,
          price: finalPrice,
          /** Form value can be typed as `boolean | null`; API expects a real boolean. */
          useSuggestedPricing: !!(this.form.value.useSuggestedPricing ?? true),
          suggestedPrice: this.suggestedPrice,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          recurrence: {
            type: (recurrenceType as any) || 'none',
            count: Number(recurrenceCount) || 1
          },
        };
        const createPayload: CreateClassRequest = {
          ...recurringBody,
          invitedStudentIds: (this.form.value.studentIds || []) as string[],
        };

        console.log('📤 Sending class creation payload:', createPayload);

        if (this.editingClassId) {
          this.classService.updateClass(this.editingClassId, recurringBody).subscribe({
            next: async () => {
              this.submitting = false;
              this.updateFooterCreateDisabled();
              const t = await this.toast.create({
                message: this.translate.instant('SCHEDULE_CLASS.HUB_SAVE_SUCCESS', { name: recurringBody.name }),
                duration: 2000,
                color: 'success',
              });
              await t.present();
              this.editingClassId = null;
              this.updateScheduleSubmitLabels();
              this.userService.getAvailability().subscribe({
                next: () => {
                  this.emitAfterInlineCreateSuccess();
                  if (!this.inline) {
                    this.router.navigate(['/tabs/tutor-calendar']);
                  }
                },
              });
            },
            error: async (err) => {
              this.submitting = false;
              this.updateFooterCreateDisabled();
              const errorMessage = err.error?.message || this.translate.instant('SCHEDULE_CLASS.HUB_SAVE_ERROR');
              const t = await this.toast.create({
                message: errorMessage,
                duration: 3000,
                color: 'danger',
              });
              await t.present();
            },
          });
        } else {
          this.classService.createClass(createPayload).subscribe({
            next: async (resp: any) => {
              const serverDraftId = this.hubDraftClassId;
              this.clearLocalHubDraftTracking();
              this.submitting = false;
              this.updateFooterCreateDisabled();
              console.log('✅ Class created successfully:', resp);
              const createdClass = resp.class || resp.classes?.[0];
              if (createdClass) {
                console.log('📊 Class details:', {
                  id: createdClass._id,
                  name: createdClass.name,
                  isPublic: createdClass.isPublic,
                  duration: createdClass.duration,
                  level: createdClass.level,
                  startTime: createdClass.startTime,
                  endTime: createdClass.endTime
                });
              }
              const t = await this.toast.create({
                message: `Class "${createPayload.name}" created successfully!`,
                duration: 2000,
                color: 'success'
              });
              await t.present();
              if (serverDraftId) {
                try {
                  await firstValueFrom(this.classService.cancelClass(serverDraftId));
                } catch {
                  /* ignore — class is live even if draft row lingers */
                }
              }
              this.userService.getAvailability().subscribe({
                next: () => {
                  this.emitAfterInlineCreateSuccess();
                  if (!this.inline) {
                    this.router.navigate(['/tabs/tutor-calendar']);
                  }
                }
              });
            },
            error: async (err) => {
              this.submitting = false;
              this.updateFooterCreateDisabled();
              console.error('❌ Error creating class:', err);
              console.error('❌ Error details:', {
                status: err.status,
                message: err.error?.message || err.message,
                error: err.error
              });
              const errorMessage = err.error?.message || 'Failed to create class';
              const t = await this.toast.create({
                message: errorMessage,
                duration: 3000,
                color: 'danger'
              });
              await t.present();
            }
          });
        }
      }
    } finally {
      this.updateFooterCreateDisabled();
    }
  }

  /** Persist hub “create class” wizard to the server (Drafts tab). Requires a non-empty name. */
  async saveHubWizardDraft(): Promise<void> {
    if (!this.inline || !this.hostChromeFooter || this.scheduleHubPhase !== 'create' || this.editingClassId) {
      return;
    }
    const name = String(this.form.getRawValue().name ?? '').trim();
    if (!name || this.savingDraft) {
      return;
    }
    this.savingDraft = true;
    this.cdr.markForCheck();
    this.wizardLayoutChange.emit();
    try {
      const v = this.form.getRawValue();
      const hubDraftForm = this.buildHubDraftFormSnapshot();
      const finalPrice = this.getFinalPrice();
      const capacity = Math.max(1, Number(v['maxStudents']) || 1);
      const patchBody: Record<string, unknown> = {
        name,
        description: (v['description'] as string) ?? '',
        capacity,
        minStudents: Number(v['minStudents']) || 2,
        flexibleMinimum: !!v['flexibleMinimum'],
        level: (v['level'] as string) || 'any',
        duration: Number(v['duration']) || 60,
        price: finalPrice,
        useSuggestedPricing: !!v['useSuggestedPricing'],
        suggestedPrice: this.suggestedPrice,
        thumbnail: (v['thumbnail'] as string) || undefined,
        hubDraftForm,
      };
      if (this.hubDraftClassId) {
        await firstValueFrom(this.classService.updateClass(this.hubDraftClassId, patchBody));
      } else {
        const resp = await firstValueFrom(
          this.classService.createClass({
            status: 'draft',
            name,
            description: patchBody['description'] as string,
            capacity,
            isPublic: false,
            minStudents: patchBody['minStudents'] as number,
            flexibleMinimum: patchBody['flexibleMinimum'] as boolean,
            level: patchBody['level'] as string,
            duration: patchBody['duration'] as number,
            price: finalPrice,
            useSuggestedPricing: patchBody['useSuggestedPricing'] as boolean,
            suggestedPrice: this.suggestedPrice,
            thumbnail: patchBody['thumbnail'] as string | undefined,
            hubDraftForm,
          } as CreateClassRequest)
        );
        const created = resp.class || resp.classes?.[0];
        if (created?._id) {
          this.hubDraftClassId = String(created._id);
        }
      }
      const t = await this.toast.create({
        message: this.translate.instant('SCHEDULE_CLASS.HUB_DRAFT_SAVED'),
        duration: 2200,
        color: 'success',
      });
      await t.present();
      this.hubListMutated.emit();
    } catch {
      const t = await this.toast.create({
        message: this.translate.instant('SCHEDULE_CLASS.HUB_SAVE_ERROR'),
        duration: 2500,
        color: 'danger',
      });
      await t.present();
    } finally {
      this.savingDraft = false;
      this.cdr.markForCheck();
      this.wizardLayoutChange.emit();
    }
  }

  private buildHubDraftFormSnapshot(): Record<string, unknown> {
    const v = this.form.getRawValue();
    let preview: string | null = this.thumbnailPreview;
    if (preview && (preview.startsWith('blob:') || preview.startsWith('data:'))) {
      preview = null;
    }
    return {
      v: 1,
      wizardStepIndex: this.wizardStepIndex,
      classType: this.classType,
      suggestedPrice: this.suggestedPrice,
      thumbnailPreview: preview,
      form: { ...v },
    };
  }

  private clearLocalHubDraftTracking(): void {
    this.hubDraftClassId = null;
  }

  private applyHubDraftFromServer(loaded: any): void {
    const hub = loaded.hubDraftForm || {};
    this.hubDraftClassId = String(loaded._id);
    this.editingClassId = null;
    this.classType = hub.classType === 'one' ? 'one' : 'recurring';
    this.onClassTypeChange();
    if (typeof hub.suggestedPrice === 'number' && Number.isFinite(hub.suggestedPrice)) {
      this.suggestedPrice = hub.suggestedPrice;
    } else if (Number.isFinite(Number(loaded.suggestedPrice))) {
      this.suggestedPrice = Math.round(Number(loaded.suggestedPrice) * 100) / 100;
    }
    if (hub.form && typeof hub.form === 'object') {
      this.form.patchValue(hub.form as object);
    } else {
      this.form.patchValue({
        name: loaded.name || '',
        description: loaded.description ?? '',
        maxStudents: loaded.capacity ?? 2,
        minStudents: loaded.minStudents ?? 2,
        flexibleMinimum: !!loaded.flexibleMinimum,
        level: loaded.level || '',
        duration: this.durationToFormSelectValue(loaded.duration),
        date: '',
        time: '',
        isPublic: false,
        thumbnail: loaded.thumbnail || '',
        recurrenceType: 'none',
        recurrenceCount: 1,
        useSuggestedPricing: loaded.useSuggestedPricing !== false,
        customPrice: null,
        studentIds: [],
        studentId: '',
      });
    }
    const storedThumb = (loaded.thumbnail as string) || '';
    const prev = hub.thumbnailPreview;
    if (typeof prev === 'string' && prev.length > 0 && !prev.startsWith('blob:')) {
      this.thumbnailPreview = prev;
    } else if (storedThumb) {
      this.thumbnailPreview = storedThumb;
    } else {
      this.thumbnailPreview = null;
    }
    this.thumbnailFile = null;
    const ids = this.getWizardStepIds();
    const max = Math.max(0, ids.length - 1);
    this.wizardStepIndex = Math.min(Math.max(0, Number(hub.wizardStepIndex) || 0), max);
    this.updateFormValidators();
    this.calculateSuggestedPrice();
    this.updateScheduleSubmitLabels();
    this.syncStepUi();
    this.updateFooterCreateDisabled();
  }

  async saveEdit(): Promise<void> {
    if (!this.editingClassId || this.savingEdit) return;

    this.savingEdit = true;
    try {
      if (this.thumbnailFile) {
        this.isUploadingThumbnail = true;
        try {
          const thumbnailUrl = await this.uploadThumbnailToGCS(this.thumbnailFile);
          this.form.patchValue({ thumbnail: thumbnailUrl });
          this.thumbnailFile = null;
        } catch {
          const t = await this.toast.create({
            message: 'Failed to upload thumbnail. Please try again.',
            duration: 2000,
            color: 'danger',
          });
          await t.present();
          this.savingEdit = false;
          this.isUploadingThumbnail = false;
          return;
        } finally {
          this.isUploadingThumbnail = false;
        }
      }

      const v = this.form.value;
      const start = v.date && v.time ? new Date(`${v.date}T${v.time}`) : null;
      const lessonDuration = this.classType === 'recurring' && v.duration ? Number(v.duration) : 60;
      const end = start ? new Date(start.getTime() + lessonDuration * 60000) : null;
      const finalPrice = this.getFinalPrice();

      const body: Record<string, any> = {
        name: v.name as string,
        description: v.description as string,
        capacity: Number(v.maxStudents) || undefined,
        minStudents: Number(v.minStudents) || 2,
        flexibleMinimum: !!v.flexibleMinimum,
        level: v.level as string,
        duration: Number(v.duration) || undefined,
        isPublic: !!v.isPublic,
        thumbnail: v.thumbnail || undefined,
        price: finalPrice,
        useSuggestedPricing: v.useSuggestedPricing,
        suggestedPrice: this.suggestedPrice,
        recurrence: {
          type: (v.recurrenceType as any) || 'none',
          count: Number(v.recurrenceCount) || 1,
        },
      };
      if (start && end) {
        body['startTime'] = start.toISOString();
        body['endTime'] = end.toISOString();
      }

      await firstValueFrom(this.classService.updateClass(this.editingClassId, body));

      this.classSaved.emit();

      const t = await this.toast.create({
        message: this.translate.instant('SCHEDULE_CLASS.HUB_SAVE_SUCCESS', { name: body['name'] || '' }),
        duration: 2000,
        color: 'success',
      });
      await t.present();
    } catch (err: any) {
      const errorMessage = err?.error?.message || this.translate.instant('SCHEDULE_CLASS.HUB_SAVE_ERROR');
      const t = await this.toast.create({
        message: errorMessage,
        duration: 3000,
        color: 'danger',
      });
      await t.present();
    } finally {
      this.savingEdit = false;
      this.cdr.markForCheck();
      if (this.hostChromeFooter) this.wizardLayoutChange.emit();
    }
  }

  private emitAfterInlineCreateSuccess(): void {
    if (!this.inline) {
      return;
    }
    if (this.hostChromeFooter && this.classType === 'recurring') {
      void this.afterCreateReturnToHub();
      return;
    }
    this.classCreated.emit();
  }

  private async afterCreateReturnToHub(): Promise<void> {
    this.clearLocalHubDraftTracking();
    this.resetFormForNewClass();
    this.scheduleHubPhase = 'list';
    this.wizardStepIndex = 0;
    this.syncStepUi();
    this.loadHubClasses();
    this.wizardLayoutChange.emit();
    this.cdr.markForCheck();
  }

  private resetFormForNewClass(): void {
    this.editingClassId = null;
    this.hubDraftClassId = null;
    this.thumbnailFile = null;
    this.thumbnailPreview = null;
    this.form.reset({
      studentId: '',
      studentIds: [],
      name: '',
      description: '',
      maxStudents: 2,
      minStudents: 2,
      flexibleMinimum: false,
      level: '',
      duration: null,
      date: '',
      time: '',
      isPublic: false,
      thumbnail: '',
      recurrenceType: 'none',
      recurrenceCount: 1,
      useSuggestedPricing: true,
      customPrice: null,
    });
    this.updateFormValidators();
    this.calculateSuggestedPrice();
    this.updateScheduleSubmitLabels();
  }

  enterHubListMode(): void {
    if (!this.hostChromeFooter) {
      return;
    }
    this.editingClassId = null;
    this.hubDraftClassId = null;
    this.updateScheduleSubmitLabels();
    this.scheduleHubPhase = 'list';
    this.hubListTab = 'active';
    this.hubInitialLoadDone = false;
    this.hubClassesLoading = true;
    this.hubLoadError = false;
    this.wizardStepIndex = 0;
    this.classType = 'recurring';
    this.onClassTypeChange();
    this.syncStepUi();
    this.loadHubClasses();
    this.cdr.markForCheck();
  }

  beginCreateClassFromHub(): void {
    if (!this.hostChromeFooter) {
      return;
    }
    this.resetFormForNewClass();
    this.classType = 'recurring';
    this.onClassTypeChange();
    this.scheduleHubPhase = 'create';
    this.wizardStepIndex = 0;
    this.syncStepUi();
    setTimeout(() => this.scrollToTopOnStepChange(), 50);
    this.wizardLayoutChange.emit();
    this.cdr.markForCheck();
  }

  loadHubClasses(): void {
    const id = this.currentUser?.id || this.userService.getCurrentUserValue()?.id;
    if (!id) {
      this.hubClassesLoading = false;
      this.hubInitialLoadDone = true;
      this.hubActiveCards = [];
      this.hubHistoryCards = [];
      this.hubDraftCards = [];
      this.cdr.markForCheck();
      return;
    }
    this.hubClassesLoading = true;
    this.hubLoadError = false;
    this.cdr.markForCheck();
    this.classService.getClassesForTutor(id).subscribe({
      next: (res) => {
        const all = res.classes || [];
        const { active, history, drafts } = this.partitionHubClasses(all);
        this.hubActiveCards = active.map((x) => this.classToHubCardVm(x));
        this.hubHistoryCards = history.map((x) => this.classToHubCardVm(x));
        this.hubDraftCards = drafts.map((x) => this.classToHubCardVm(x));
        this.hubClassesLoading = false;
        this.hubLoadError = false;
        this.hubInitialLoadDone = true;
        this.cdr.markForCheck();
      },
      error: () => {
        this.hubClassesLoading = false;
        this.hubLoadError = true;
        this.hubInitialLoadDone = true;
        this.hubActiveCards = [];
        this.hubHistoryCards = [];
        this.hubDraftCards = [];
        this.cdr.markForCheck();
      },
    });
  }

  private partitionHubClasses(all: ClassInvitation[]): {
    active: ClassInvitation[];
    history: ClassInvitation[];
    drafts: ClassInvitation[];
  } {
    const now = Date.now();
    const active: ClassInvitation[] = [];
    const history: ClassInvitation[] = [];
    const drafts: ClassInvitation[] = [];
    for (const c of all) {
      const st = c.status || 'scheduled';
      if (st === 'draft') {
        drafts.push(c);
        continue;
      }
      const end = new Date(c.endTime).getTime();
      const start = new Date(c.startTime).getTime();
      const cancelled = st === 'cancelled';
      const completed = st === 'completed';
      const past = end < now || completed;
      const inProgress = !cancelled && start <= now && now < end;
      const upcoming = !cancelled && start > now;
      if (past || cancelled) {
        history.push(c);
      } else if (upcoming || inProgress) {
        active.push(c);
      } else {
        history.push(c);
      }
    }
    active.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    history.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    drafts.sort(
      (a, b) =>
        new Date(b.updatedAt || b.startTime).getTime() - new Date(a.updatedAt || a.startTime).getTime()
    );
    return { active, history, drafts };
  }

  private formatHubWhen(startIso: string, endIso: string): string {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const dOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    const tOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    return `${start.toLocaleDateString(undefined, dOpts)} · ${start.toLocaleTimeString(undefined, tOpts)} – ${end.toLocaleTimeString(undefined, tOpts)}`;
  }

  private classToHubCardVm(c: ClassInvitation): HubClassCardVm {
    const now = Date.now();
    const start = new Date(c.startTime).getTime();
    const end = new Date(c.endTime).getTime();
    const st = c.status || 'scheduled';
    if (st === 'draft') {
      const ext = c as ClassInvitation & { thumbnail?: string };
      const id = String(ext._id);
      return {
        id,
        name: c.name,
        price: c.price,
        priceDisplay: c.price > 0 ? c.price.toFixed(2) : '',
        capacity: c.capacity,
        confirmedCount: 0,
        startTime: c.startTime,
        endTime: c.endTime,
        whenLine: '',
        thumbUrl: ext.thumbnail,
        badgeKey: 'SCHEDULE_CLASS.HUB_BADGE_DRAFT',
        badgeClass: 'draft',
        canEdit: false,
        canCancel: false,
        canRemoveFromHistory: false,
        isDraft: true,
        canResumeDraft: true,
        canDiscardDraft: true,
      };
    }
    let badgeKey: HubClassCardVm['badgeKey'] = 'SCHEDULE_CLASS.HUB_BADGE_UPCOMING';
    let badgeClass: HubClassCardVm['badgeClass'] = 'upcoming';
    if (st === 'cancelled') {
      badgeKey = 'SCHEDULE_CLASS.HUB_BADGE_CANCELLED';
      badgeClass = 'cancelled';
    } else if (end < now || st === 'completed') {
      badgeKey = 'SCHEDULE_CLASS.HUB_BADGE_PAST';
      badgeClass = 'past';
    } else if (start <= now && now < end) {
      badgeKey = 'SCHEDULE_CLASS.HUB_BADGE_LIVE';
      badgeClass = 'live';
    }
    const ext = c as ClassInvitation & { thumbnail?: string };
    const confirmed =
      Array.isArray(c.confirmedStudents) && c.confirmedStudents.length > 0
        ? c.confirmedStudents.length
        : c.invitationStats?.accepted ?? 0;
    const canEdit = st === 'scheduled' && start > now;
    const canCancel = st !== 'cancelled' && end > now;
    const canRemoveFromHistory =
      end < now || st === 'completed' || st === 'cancelled';
    return {
      id: c._id,
      name: c.name,
      price: c.price,
      priceDisplay: c.price > 0 ? c.price.toFixed(2) : '',
      capacity: c.capacity,
      confirmedCount: confirmed,
      startTime: c.startTime,
      endTime: c.endTime,
      whenLine: this.formatHubWhen(c.startTime, c.endTime),
      thumbUrl: ext.thumbnail,
      badgeKey,
      badgeClass,
      canEdit,
      canCancel,
      canRemoveFromHistory,
    };
  }

  private pad2(n: number): string {
    return n.toString().padStart(2, '0');
  }

  /** Map stored duration (e.g. 60) to wizard select values (25 | 50). */
  private durationToFormSelectValue(d: unknown): number | null {
    const n = Number(d);
    if (!Number.isFinite(n) || n <= 0) {
      return null;
    }
    if (n === 25) {
      return 25;
    }
    if (n === 50) {
      return 50;
    }
    return n >= 45 ? 50 : 25;
  }

  private applyLoadedClassToForm(loaded: any): void {
    const start = new Date(loaded.startTime);
    const dateStr = `${start.getFullYear()}-${this.pad2(start.getMonth() + 1)}-${this.pad2(start.getDate())}`;
    const timeStr = `${this.pad2(start.getHours())}:${this.pad2(start.getMinutes())}`;
    const rec = loaded.recurrence || { type: 'none', count: 1 };
    const invited: string[] = [];
    if (Array.isArray(loaded.invitedStudents)) {
      for (const inv of loaded.invitedStudents) {
        const sid = inv.studentId?._id ?? inv.studentId;
        if (sid) {
          invited.push(String(sid));
        }
      }
    }
    const useSuggested = loaded.useSuggestedPricing !== false;
    const priceNum = Number(loaded.price) || 0;
    const sug = Number(loaded.suggestedPrice);
    if (Number.isFinite(sug) && sug > 0) {
      this.suggestedPrice = Math.round(sug * 100) / 100;
    }
    this.form.patchValue({
      name: loaded.name || '',
      description: loaded.description || '',
      maxStudents: loaded.capacity ?? 2,
      minStudents: loaded.minStudents ?? 2,
      flexibleMinimum: !!loaded.flexibleMinimum,
      level: loaded.level || '',
      duration: this.durationToFormSelectValue(loaded.duration),
      date: dateStr,
      time: timeStr,
      isPublic: !!loaded.isPublic,
      thumbnail: loaded.thumbnail || '',
      recurrenceType: rec.type || 'none',
      recurrenceCount: rec.count ?? 1,
      useSuggestedPricing: useSuggested,
      customPrice: useSuggested ? null : priceNum,
      studentIds: invited,
      studentId: '',
    });
    this.thumbnailFile = null;
    this.thumbnailPreview = null;
    this.updateFormValidators();
    this.calculateSuggestedPrice();
  }

  async beginEditHubClass(c: HubClassCardVm, ev: Event): Promise<void> {
    ev.stopPropagation();
    if (!c.canEdit || !this.hostChromeFooter) {
      return;
    }
    this.clearLocalHubDraftTracking();
    try {
      const res = await firstValueFrom(this.classService.getClass(c.id));
      if (!res.success || !res.class) {
        const t = await this.toast.create({
          message: this.translate.instant('SCHEDULE_CLASS.HUB_EDIT_LOAD_ERROR'),
          duration: 2500,
          color: 'danger',
        });
        await t.present();
        return;
      }
      this.scheduleHubPhase = 'create';
      this.editingClassId = c.id;
      this.classType = 'recurring';
      this.applyLoadedClassToForm(res.class);
      this.onClassTypeChange();
      this.wizardStepIndex = 0;
      if (this.students.length === 0 && !this.loadingStudents) {
        this.loadStudents();
      }
      this.updateScheduleSubmitLabels();
      this.syncStepUi();
      this.updateFooterCreateDisabled();
      setTimeout(() => this.scrollToTopOnStepChange(), 50);
      this.wizardLayoutChange.emit();
      this.cdr.markForCheck();
    } catch {
      const t = await this.toast.create({
        message: this.translate.instant('SCHEDULE_CLASS.HUB_EDIT_LOAD_ERROR'),
        duration: 2500,
        color: 'danger',
      });
      await t.present();
    }
  }

  async beginResumeHubDraft(c: HubClassCardVm, ev: Event): Promise<void> {
    ev.stopPropagation();
    if (!c.canResumeDraft || !this.hostChromeFooter) {
      return;
    }
    try {
      const res = await firstValueFrom(this.classService.getClass(c.id));
      if (!res.success || !res.class) {
        const t = await this.toast.create({
          message: this.translate.instant('SCHEDULE_CLASS.HUB_EDIT_LOAD_ERROR'),
          duration: 2500,
          color: 'danger',
        });
        await t.present();
        return;
      }
      this.scheduleHubPhase = 'create';
      this.applyHubDraftFromServer(res.class);
      if (this.students.length === 0 && !this.loadingStudents) {
        this.loadStudents();
      }
      this.updateScheduleSubmitLabels();
      setTimeout(() => this.scrollToTopOnStepChange(), 50);
      this.wizardLayoutChange.emit();
      this.cdr.markForCheck();
    } catch {
      const t = await this.toast.create({
        message: this.translate.instant('SCHEDULE_CLASS.HUB_EDIT_LOAD_ERROR'),
        duration: 2500,
        color: 'danger',
      });
      await t.present();
    }
  }

  async confirmDeleteHubClass(c: HubClassCardVm, ev: Event): Promise<void> {
    ev.stopPropagation();
    if ((!c.canCancel && !c.canDiscardDraft) || this.hubClassDeleteInFlight) {
      return;
    }
    const isDraft = !!c.isDraft;
    const alert = await this.alertController.create({
      header: this.translate.instant(
        isDraft ? 'SCHEDULE_CLASS.HUB_DISCARD_DRAFT_TITLE' : 'SCHEDULE_CLASS.HUB_DELETE_TITLE'
      ),
      message: this.translate.instant(
        isDraft ? 'SCHEDULE_CLASS.HUB_DISCARD_DRAFT_MESSAGE' : 'SCHEDULE_CLASS.HUB_DELETE_MESSAGE',
        { name: c.name }
      ),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant(
            isDraft ? 'SCHEDULE_CLASS.HUB_DISCARD_DRAFT_CONFIRM' : 'SCHEDULE_CLASS.HUB_DELETE_CONFIRM'
          ),
          role: 'destructive',
          handler: () => {
            this.executeHubClassDelete(c.id, isDraft);
          },
        },
      ],
    });
    await alert.present();
  }

  async confirmRemoveFromHistoryHubClass(c: HubClassCardVm, ev: Event): Promise<void> {
    ev.stopPropagation();
    if (!c.canRemoveFromHistory || this.hubClassDeleteInFlight) {
      return;
    }
    const alert = await this.alertController.create({
      header: this.translate.instant('SCHEDULE_CLASS.HUB_REMOVE_HISTORY_TITLE'),
      message: this.translate.instant('SCHEDULE_CLASS.HUB_REMOVE_HISTORY_MESSAGE', { name: c.name }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('SCHEDULE_CLASS.HUB_REMOVE_HISTORY_CONFIRM'),
          role: 'destructive',
          handler: () => {
            this.executeHubClassRemoveFromHistory(c.id);
          },
        },
      ],
    });
    await alert.present();
  }

  private executeHubClassRemoveFromHistory(classId: string): void {
    this.hubClassDeleteInFlight = true;
    this.cdr.markForCheck();
    this.classService.hideClassFromHub(classId).subscribe({
      next: async () => {
        this.hubClassDeleteInFlight = false;
        const t = await this.toast.create({
          message: this.translate.instant('SCHEDULE_CLASS.HUB_REMOVE_HISTORY_SUCCESS'),
          duration: 2000,
          color: 'success',
        });
        await t.present();
        this.loadHubClasses();
        this.hubListMutated.emit();
        this.cdr.markForCheck();
      },
      error: async (err) => {
        this.hubClassDeleteInFlight = false;
        const msg =
          err.error?.message || this.translate.instant('SCHEDULE_CLASS.HUB_REMOVE_HISTORY_ERROR');
        const t = await this.toast.create({ message: msg, duration: 2500, color: 'danger' });
        await t.present();
        this.cdr.markForCheck();
      },
    });
  }

  private executeHubClassDelete(classId: string, isDraft = false): void {
    this.hubClassDeleteInFlight = true;
    this.cdr.markForCheck();
    this.classService.cancelClass(classId).subscribe({
      next: async () => {
        this.hubClassDeleteInFlight = false;
        if (this.hubDraftClassId === classId) {
          this.clearLocalHubDraftTracking();
        }
        const t = await this.toast.create({
          message: this.translate.instant(
            isDraft ? 'SCHEDULE_CLASS.HUB_DISCARD_DRAFT_SUCCESS' : 'SCHEDULE_CLASS.HUB_DELETE_SUCCESS'
          ),
          duration: 2000,
          color: 'success',
        });
        await t.present();
        this.loadHubClasses();
        this.hubListMutated.emit();
        this.cdr.markForCheck();
      },
      error: async (err) => {
        this.hubClassDeleteInFlight = false;
        const msg =
          err.error?.message || this.translate.instant('SCHEDULE_CLASS.HUB_DELETE_ERROR');
        const t = await this.toast.create({ message: msg, duration: 2500, color: 'danger' });
        await t.present();
        this.cdr.markForCheck();
      },
    });
  }

  getSelectedStudentName(): string {
    const student = this.getSelectedStudent();
    return student?.name || '';
  }

  getSelectedStudent(): Student | undefined {
    const studentId = this.form.value.studentId;
    if (!studentId) return undefined;
    return this.students.find(s => s._id === studentId);
  }

  getSelectedStudentPicture(): string | undefined {
    const student = this.getSelectedStudent();
    return student?.picture;
  }

  getSelectedStudentType(): string {
    const student = this.getSelectedStudent();
    return student?.userType || 'student';
  }

  toggleStudentDropdown() {
    if (this.loadingStudents || this.students.length === 0) {
      return;
    }
    this.showStudentDropdown = !this.showStudentDropdown;
  }

  toggleStudentSelection(studentId: string) {
    // If clicking the already selected student, deselect it
    if (this.form.value.studentId === studentId) {
      this.clearStudent();
    } else {
      this.selectStudent(studentId);
    }
  }

  selectStudent(studentId: string) {
    this.form.patchValue({ studentId });
    this.showStudentDropdown = false;
    this.form.controls.studentId.markAsTouched();
  }

  clearStudent(event?: Event) {
    if (event) {
      event.stopPropagation(); // Prevent dropdown from opening
    }
    this.form.patchValue({ studentId: '' });
    this.form.controls.studentId.markAsTouched();
  }

  // Multi-select methods
  async toggleMultiStudentDropdown() {
    if (this.students.length === 0 && !this.loadingStudents) {
      this.loadStudents();
      return;
    }

    if (this.loadingStudents) {
      return;
    }

    this.updateDesktopInviteInlineFlag();
    if (this.desktopInviteInlineList) {
      this.inviteStudentPanelOpen = !this.inviteStudentPanelOpen;
      this.cdr.markForCheck();
      return;
    }

    await this.openStudentSelectionActionSheet();
  }

  async openStudentSelectionActionSheet() {
    const maxStudents = this.form.value.maxStudents || 2;
    const selectedIds = this.form.value.studentIds || [];
    
    const isMobile = window.innerWidth <= 768;
    
    const modalOpts: any = {
      component: StudentSelectionActionsheetComponent,
      componentProps: {
        students: this.students,
        selectedStudentIds: selectedIds,
        maxStudents: maxStudents
      },
      cssClass: isMobile ? 'student-selection-actionsheet-modal' : 'student-selection-desktop-modal',
      showBackdrop: true,
      backdropDismiss: true,
    };
    
    if (isMobile) {
      modalOpts.breakpoints = [0, 0.5, 0.75, 1];
      modalOpts.initialBreakpoint = 0.75;
    }
    
    const modal = await this.modalController.create(modalOpts);
    
    await modal.present();
    
    const { data } = await modal.onWillDismiss();
    if (data && data.selectedIds) {
      this.form.patchValue({ studentIds: data.selectedIds });
    }
  }

  toggleMultiStudentSelection(studentId: string) {
    const currentIds = this.form.value.studentIds || [];
    const index = currentIds.indexOf(studentId);
    
    if (index > -1) {
      // Remove if already selected
      currentIds.splice(index, 1);
    } else {
      // Check if we can add more students
      if (!this.canSelectMoreStudents()) {
        this.showMaxStudentsReachedToast();
        return;
      }
      // Add if not selected
      currentIds.push(studentId);
    }
    
    this.form.patchValue({ studentIds: [...currentIds] });
    this.form.controls.studentIds.markAsTouched();
    // Don't close dropdown - allow multiple selections
  }

  canSelectMoreStudents(): boolean {
    const currentIds = this.form.value.studentIds || [];
    const maxStudents = this.form.value.maxStudents || 2;
    return currentIds.length < maxStudents;
  }

  isStudentDisabled(studentId: string): boolean {
    const currentIds = this.form.value.studentIds || [];
    const isSelected = currentIds.indexOf(studentId) > -1;
    // Student is disabled if not selected AND max capacity reached
    return !isSelected && !this.canSelectMoreStudents();
  }

  async showMaxStudentsReachedToast() {
    const maxStudents = this.form.value.maxStudents || 2;
    const toast = await this.toast.create({
      message: `Maximum of ${maxStudents} student${maxStudents > 1 ? 's' : ''} can be selected`,
      duration: 2000,
      position: 'top',
      color: 'warning'
    });
    await toast.present();
  }

  isStudentSelected(studentId: string): boolean {
    const currentIds = this.form.value.studentIds || [];
    return currentIds.includes(studentId);
  }

  getSelectedStudents(): Student[] {
    const selectedIds = this.form.value.studentIds || [];
    return this.students.filter(s => selectedIds.includes(s._id));
  }

  getSelectedStudentsCount(): number {
    return (this.form.value.studentIds || []).length;
  }

  clearAllStudents(event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.form.patchValue({ studentIds: [] });
    this.form.controls.studentIds.markAsTouched();
  }

  // ============ PRICING METHODS ============
  
  calculateSuggestedPrice() {
    const level = this.form.get('level')?.value;
    const duration = this.form.get('duration')?.value;
    
    if (!level || !duration) {
      this.suggestedPrice = 0;
      return;
    }

    // Level multipliers based on expertise required
    const levelMultipliers: { [key: string]: number } = {
      'any': 0.8,
      'beginner': 0.9,
      'intermediate': 1.0,
      'advanced': 1.2
    };

    const baseRate = this.tutorStandardRate;
    const durationNum = Number(duration);
    const durationMultiplier = durationNum / this.STANDARD_LESSON_DURATION; // Divide by 50, not 60
    const groupDiscount = 0.80; // 20% off per student (better reward for tutors)
    const groupRewardMultiplier = 1.10; // 10% bonus for managing group dynamics
    const levelMultiplier = levelMultipliers[level] || 1.0;

    // Calculate: standardRate * (duration/50) * groupDiscount * groupRewardMultiplier * levelMultiplier
    this.suggestedPrice = Math.round(
      baseRate * durationMultiplier * groupDiscount * groupRewardMultiplier * levelMultiplier * 100
    ) / 100;

    console.log('💰 Calculated suggested price:', {
      baseRate,
      duration,
      level,
      groupDiscount,
      groupRewardMultiplier,
      suggestedPrice: this.suggestedPrice
    });
  }

  getFinalPrice(): number {
    if (this.classType !== 'recurring') return 0;
    
    return this.form.get('useSuggestedPricing')?.value
      ? this.suggestedPrice
      : (this.form.get('customPrice')?.value || 0);
  }

  calculatePotentialRevenue(): number {
    const price = this.getFinalPrice();
    const maxStudents = this.form.value.maxStudents || 0;
    return Math.round(price * maxStudents * 100) / 100;
  }

  calculateRevenueIncrease(): number {
    if (!this.tutorStandardRate || !this.form.value.duration) return 0;
    
    const classRevenue = this.calculatePotentialRevenue();
    const durationNum = Number(this.form.value.duration);
    const oneOnOneRevenue = this.tutorStandardRate * (durationNum / this.STANDARD_LESSON_DURATION);
    
    if (oneOnOneRevenue === 0) return 0;
    
    return Math.round(((classRevenue - oneOnOneRevenue) / oneOnOneRevenue) * 100);
  }

  onPricingToggleChange() {
    const customPriceControl = this.form.get('customPrice');
    const useSuggested = this.form.get('useSuggestedPricing')?.value;
    
    if (useSuggested) {
      // Using suggested pricing - clear custom price and remove validators
      customPriceControl?.clearValidators();
      customPriceControl?.setValue(null);
    } else {
      // Using custom pricing - add validators and pre-fill with suggested price
      customPriceControl?.setValidators([Validators.required, Validators.min(10)]);
      customPriceControl?.setValue(this.suggestedPrice);
    }
    customPriceControl?.updateValueAndValidity();
  }

  getLevelLabel(level: string | null | undefined): string {
    if (!level) return '';
    const levelOption = this.levelOptions.find(opt => opt.value === level);
    return levelOption?.label || level;
  }

  // ============ EARNINGS CALCULATOR METHODS ============
  
  calculateNetEarnings(gross: number): number {
    return Math.round(gross * (1 - this.PLATFORM_FEE_PERCENTAGE / 100) * 100) / 100;
  }

  calculate1on1Earnings(): number {
    if (!this.form.value.duration) return 0;
    const duration = Number(this.form.value.duration);
    // Calculate based on standard 50-minute lesson rate, not hourly
    const multiplier = duration / this.STANDARD_LESSON_DURATION;
    return Math.round(this.tutorStandardRate * multiplier * 100) / 100;
  }

  calculate1on1EarningsGross(): number {
    return this.calculate1on1Earnings();
  }

  calculate1on1EarningsNet(): number {
    return this.calculateNetEarnings(this.calculate1on1EarningsGross());
  }

  calculateGroupEarnings(studentCount: number): number {
    const pricePerStudent = this.getFinalPrice();
    return Math.round(pricePerStudent * studentCount * 100) / 100;
  }

  calculateGroupEarningsNet(studentCount: number): number {
    const gross = this.calculateGroupEarnings(studentCount);
    return this.calculateNetEarnings(gross);
  }

  getEarningsDifference(studentCount: number): string {
    const oneOnOne = this.calculate1on1Earnings();
    const group = this.calculateGroupEarnings(studentCount);
    const diff = group - oneOnOne;
    const sign = diff >= 0 ? '+' : '';
    return `${sign}$${Math.abs(diff).toFixed(2)}`;
  }

  isBreakEven(studentCount: number): boolean {
    const oneOnOne = this.calculate1on1Earnings();
    const group = this.calculateGroupEarnings(studentCount);
    return Math.abs(group - oneOnOne) < 0.5; // Within 50 cents
  }

  isProfitable(studentCount: number): boolean {
    const oneOnOne = this.calculate1on1Earnings();
    const group = this.calculateGroupEarnings(studentCount);
    return group >= oneOnOne;
  }

  getEarningsPercentage(studentCount: number): number {
    const oneOnOneNet = this.calculate1on1EarningsNet();
    const groupNet = this.calculateGroupEarningsNet(studentCount);
    if (oneOnOneNet === 0) return 0;
    const percentage = ((groupNet - oneOnOneNet) / oneOnOneNet) * 100;
    return Math.round(percentage);
  }

  getRecommendedMinimum(): number {
    if (!this.form.value.duration) return 2; // Default to 2 for group classes

    const oneOnOneNet = this.calculate1on1EarningsNet();
    const pricePerStudent = this.getFinalPrice();
    const maxStudents = this.form.value.maxStudents || 2;

    if (pricePerStudent === 0) return 2; // Default to 2 for group classes

    // Find the smallest group size where net earnings meet or exceed 1:1 net
    for (let count = 2; count <= maxStudents; count++) {
      const groupNet = this.calculateGroupEarningsNet(count);
      if (groupNet >= oneOnOneNet) {
        return count;
      }
    }

    // If none meet/exceed, recommend the max available
    return maxStudents;
  }

  /**
   * Group sizes shown in the earnings breakdown (2 .. maxStudents).
   * Must always include `maxStudents` so the table updates when capacity changes.
   * For very large caps, only the largest sizes are listed to keep the table short.
   */
  getStudentCountRange(): number[] {
    const raw = this.form.value.maxStudents;
    const parsed = Number(raw);
    const max = Number.isFinite(parsed) && parsed >= 2 ? Math.min(parsed, 50) : 10;

    const totalSizes = max - 1; // 2 through max inclusive
    const maxRows = 12;

    if (totalSizes <= maxRows) {
      return Array.from({ length: totalSizes }, (_, i) => i + 2);
    }

    const start = max - maxRows + 1;
    return Array.from({ length: maxRows }, (_, i) => start + i);
  }
}


