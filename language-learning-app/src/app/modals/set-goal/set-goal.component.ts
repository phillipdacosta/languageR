import { Component, Input, OnDestroy, OnInit, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin, Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import { LearningPlanService } from '../../services/learning-plan.service';
import {
  recommendedMode as computeRecommendedMode,
  weeksToTarget,
  normalizeGoalTargetDate,
} from '../../shared/goal-pace.helper';
import { translateLangToDatetimeLocale } from '../../shared/datetime-locale.helper';

/**
 * Focused goal-picker for unframed students promoting their plan to a
 * structured one. Intentionally narrower than the full onboarding flow:
 * we already know the student's name, language, level, and schedule —
 * we just need a goal.
 *
 * Flow:
 *   1. Student picks a goal type (and optionally describes "other").
 *   2. Student picks a timeline ("no rush" by default).
 *   3. Submit → `LearningPlanService.promoteUnframedPlan(lang, goal)`,
 *      which broadcasts `planUpdates$` so the home journey widget
 *      re-renders without a page refresh.
 *
 * This modal is deliberately NOT used for the "Change Goal" path on an
 * active plan — that flow keeps its existing confirmation alert because
 * it carries different consequences (chapter restart + 7-day cooldown).
 */
type GoalType = 'conversational' | 'exam_prep' | 'professional' | 'travel' | 'relocation' | 'other';
type Timeline = 'specific_date' | 'few_months' | 'no_rush';

interface GoalOption {
  value: GoalType;
  labelKey: string;
  icon: string;
  descKey: string;
}

interface TimelineOption {
  value: Timeline;
  labelKey: string;
  icon: string;
}

@Component({
  selector: 'app-set-goal',
  templateUrl: './set-goal.component.html',
  styleUrls: ['./set-goal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, TranslateModule]
})
export class SetGoalComponent implements OnInit, OnDestroy {
  /** Smooth-scroll target once pacing copy is bound. */
  @ViewChild('pacingSuggestionBanner') pacingSuggestionBanner?: ElementRef<HTMLElement>;

  /** Language whose plan we're promoting. Required. */
  @Input() language!: string;
  /** Pre-fill the type chooser if the student had a prior goal. */
  @Input() initialGoalType: GoalType | '' = '';
  /** Pre-fill the description for `type === 'other'`. */
  @Input() initialDescription = '';

  readonly goalOptions: GoalOption[] = [
    { value: 'conversational', labelKey: 'LEARNING_PLAN.GOAL_LABEL_CONVERSATIONAL', icon: 'chatbubbles-outline', descKey: 'ONBOARDING.STUDENT.GOAL_DESC_CONVERSATIONAL' },
    { value: 'exam_prep',      labelKey: 'LEARNING_PLAN.GOAL_LABEL_EXAM_PREP',      icon: 'school-outline',      descKey: 'ONBOARDING.STUDENT.GOAL_DESC_EXAM_PREP' },
    { value: 'professional',   labelKey: 'LEARNING_PLAN.GOAL_LABEL_PROFESSIONAL',   icon: 'briefcase-outline',   descKey: 'ONBOARDING.STUDENT.GOAL_DESC_PROFESSIONAL' },
    { value: 'travel',         labelKey: 'LEARNING_PLAN.GOAL_LABEL_TRAVEL',         icon: 'airplane-outline',    descKey: 'ONBOARDING.STUDENT.GOAL_DESC_TRAVEL' },
    { value: 'relocation',     labelKey: 'LEARNING_PLAN.GOAL_LABEL_RELOCATION',     icon: 'home-outline',        descKey: 'ONBOARDING.STUDENT.GOAL_DESC_RELOCATION' },
    { value: 'other',          labelKey: 'LEARNING_PLAN.GOAL_LABEL_OTHER',          icon: 'sparkles-outline',    descKey: 'ONBOARDING.STUDENT.GOAL_DESC_OTHER' }
  ];

  readonly timelineOptions: TimelineOption[] = [
    { value: 'no_rush',       labelKey: 'ONBOARDING.STUDENT.TIMELINE_OPTION_NO_RUSH',       icon: 'leaf-outline' },
    { value: 'few_months',    labelKey: 'ONBOARDING.STUDENT.TIMELINE_OPTION_FEW_MONTHS',    icon: 'time-outline' },
    { value: 'specific_date', labelKey: 'ONBOARDING.STUDENT.TIMELINE_OPTION_SPECIFIC_DATE', icon: 'calendar-outline' }
  ];

  selectedGoalType: GoalType | '' = '';
  description = '';
  selectedTimeline: Timeline = 'no_rush';
  targetDate = '';
  readonly minTargetDate: string = new Date().toISOString().split('T')[0];
  datePickerLocale = 'en-US';

  submitting = false;

  /**
   * Non-blocking nudge: if the picked goal + deadline matches an
   * "unframed serves you better" combo (exam_prep ≤ 12 weeks,
   * professional ≤ 4 weeks), surface a soft suggestion and let the
   * student dismiss the modal to stay on single lessons. See
   * `shared/goal-pace.helper.ts`.
   */
  pacingSuggestion: { weeks: number } | null = null;

  pacingBannerTitle = '';
  pacingBannerBody = '';
  pacingBannerPrimary = '';
  pacingBannerDismiss = '';

  private pacingBannerI18nSub: Subscription | null = null;
  private translateLangSub: Subscription | null = null;

  constructor(
    private modalController: ModalController,
    private learningPlanService: LearningPlanService,
    private toastController: ToastController,
    private translate: TranslateService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    if (this.initialGoalType) {
      this.selectedGoalType = this.initialGoalType;
    }
    if (this.initialDescription) {
      this.description = this.initialDescription;
    }
    this.translateLangSub = this.translate.onLangChange.subscribe(() => {
      this.refreshDatePickerLocale();
      this.bindPacingBannerLabels();
    });
    this.refreshDatePickerLocale();
    this.refreshPacingSuggestion();
  }

  private refreshDatePickerLocale(): void {
    this.datePickerLocale = translateLangToDatetimeLocale(this.translate.currentLang);
  }

  ngOnDestroy(): void {
    this.pacingBannerI18nSub?.unsubscribe();
    this.pacingBannerI18nSub = null;
    this.translateLangSub?.unsubscribe();
    this.translateLangSub = null;
  }

  selectGoal(value: GoalType) {
    this.selectedGoalType = value;
    if (value !== 'other') {
      this.description = '';
    }
    this.refreshPacingSuggestion();
  }

  selectTimeline(value: Timeline) {
    this.selectedTimeline = value;
    if (value !== 'specific_date') {
      this.targetDate = '';
    }
    this.refreshPacingSuggestion();
  }

  onTargetDateChange(rawValue?: unknown) {
    const incoming = typeof rawValue === 'undefined' ? this.targetDate : rawValue;
    const n = normalizeGoalTargetDate(incoming);
    if (n) {
      this.targetDate = n;
    } else if (typeof rawValue === 'string') {
      this.targetDate = rawValue;
    }
    this.refreshPacingSuggestion();
  }

  private refreshPacingSuggestion() {
    const goal = {
      type: this.selectedGoalType || null,
      timeline: this.selectedTimeline,
      targetDate: this.targetDate || null,
    };
    if (computeRecommendedMode(goal) !== 'single_lessons') {
      this.pacingSuggestion = null;
      this.bindPacingBannerLabels();
      return;
    }
    const weeks = weeksToTarget(goal);
    this.pacingSuggestion = { weeks: weeks ?? 0 };
    this.bindPacingBannerLabels();
  }

  private bindPacingBannerLabels(): void {
    this.pacingBannerI18nSub?.unsubscribe();
    this.pacingBannerI18nSub = null;
    if (!this.pacingSuggestion) {
      this.pacingBannerTitle = '';
      this.pacingBannerBody = '';
      this.pacingBannerPrimary = '';
      this.pacingBannerDismiss = '';
      return;
    }
    const weeks = this.pacingSuggestion.weeks;
    this.pacingBannerI18nSub = forkJoin({
      title: this.translate.get('ONBOARDING.STUDENT.PACING_SUGGESTION_TITLE'),
      body: this.translate.get('ONBOARDING.STUDENT.PACING_SUGGESTION_BODY_UNFRAMED', { weeks }),
      primary: this.translate.get('ONBOARDING.STUDENT.PACING_SUGGESTION_STAY'),
      dismiss: this.translate.get('ONBOARDING.STUDENT.PACING_SUGGESTION_DISMISS'),
    }).subscribe((t) => {
      this.pacingBannerTitle = t.title;
      this.pacingBannerBody = t.body;
      this.pacingBannerPrimary = t.primary;
      this.pacingBannerDismiss = t.dismiss;
      this.cdr.detectChanges();
      this.scheduleScrollPacingSuggestionIntoView();
    });
  }

  private scheduleScrollPacingSuggestionIntoView(): void {
    setTimeout(() => {
      requestAnimationFrame(() => {
        const el = this.pacingSuggestionBanner?.nativeElement;
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      });
    }, 0);
  }

  /**
   * Student accepted the "stay on single lessons" suggestion. They're
   * already on an unframed plan (this modal only opens for unframed
   * students), so we just dismiss without promoting.
   */
  stayOnSingleLessons() {
    this.dismiss(false);
  }

  dismissPacingSuggestion() {
    this.pacingSuggestion = null;
    this.bindPacingBannerLabels();
  }

  /** Mirrors onboarding's enabling logic: type required, description
   *  required only when "other" is chosen, target date required only
   *  when "specific_date" is chosen. */
  get canSubmit(): boolean {
    if (this.submitting) return false;
    if (!this.selectedGoalType) return false;
    if (this.selectedGoalType === 'other' && !this.description.trim()) return false;
    if (this.selectedTimeline === 'specific_date' && !this.targetDate) return false;
    return !!this.language;
  }

  dismiss(saved: boolean = false) {
    this.modalController.dismiss({ saved });
  }

  async submit() {
    if (!this.canSubmit) return;
    this.submitting = true;

    const goal: any = {
      type: this.selectedGoalType,
      description: this.selectedGoalType === 'other' ? this.description.trim() : '',
      targetLevel: '',
      timeline: this.selectedTimeline,
      targetDate: this.selectedTimeline === 'specific_date' && this.targetDate ? this.targetDate : null
    };

    this.learningPlanService.promoteUnframedPlan(this.language, goal).pipe(take(1)).subscribe({
      next: async () => {
        const toast = await this.toastController.create({
          message: this.translate.instant('ONBOARDING.SET_GOAL.TOAST_SUCCESS'),
          duration: 2200,
          color: 'success',
          position: 'top'
        });
        await toast.present();
        this.submitting = false;
        this.dismiss(true);
      },
      error: async (err) => {
        this.submitting = false;
        const message = err?.error?.message
          || this.translate.instant('ONBOARDING.SET_GOAL.TOAST_ERROR_FALLBACK');
        const toast = await this.toastController.create({
          message,
          duration: 3000,
          color: 'danger',
          position: 'top'
        });
        await toast.present();
      }
    });
  }
}
