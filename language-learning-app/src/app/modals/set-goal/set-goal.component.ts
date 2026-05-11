import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { take } from 'rxjs/operators';
import { LearningPlanService } from '../../services/learning-plan.service';

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
  label: string;
  icon: string;
  description: string;
}

interface TimelineOption {
  value: Timeline;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-set-goal',
  templateUrl: './set-goal.component.html',
  styleUrls: ['./set-goal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class SetGoalComponent implements OnInit {
  /** Language whose plan we're promoting. Required. */
  @Input() language!: string;
  /** Pre-fill the type chooser if the student had a prior goal. */
  @Input() initialGoalType: GoalType | '' = '';
  /** Pre-fill the description for `type === 'other'`. */
  @Input() initialDescription = '';

  readonly goalOptions: GoalOption[] = [
    { value: 'conversational', label: 'Become conversational', icon: 'chatbubbles-outline', description: 'Hold natural conversations with native speakers' },
    { value: 'exam_prep',     label: 'Prepare for an exam',    icon: 'school-outline',      description: 'DELF, DELE, JLPT, or other certification' },
    { value: 'professional',  label: 'Use it for work',         icon: 'briefcase-outline',   description: 'Meetings, emails, and business communication' },
    { value: 'travel',        label: 'Travel and get by',       icon: 'airplane-outline',    description: 'Navigate confidently while traveling abroad' },
    { value: 'relocation',    label: 'Moving to a new country', icon: 'home-outline',        description: 'Settle in and handle daily life in a new place' },
    { value: 'other',         label: 'Something else',          icon: 'sparkles-outline',    description: "I'll describe my goal" }
  ];

  readonly timelineOptions: TimelineOption[] = [
    { value: 'no_rush',       label: 'No rush, just steady progress', icon: 'leaf-outline' },
    { value: 'few_months',    label: 'Within a few months',           icon: 'time-outline' },
    { value: 'specific_date', label: 'By a specific date',            icon: 'calendar-outline' }
  ];

  selectedGoalType: GoalType | '' = '';
  description = '';
  selectedTimeline: Timeline = 'no_rush';
  targetDate = '';

  submitting = false;

  constructor(
    private modalController: ModalController,
    private learningPlanService: LearningPlanService,
    private toastController: ToastController
  ) {}

  ngOnInit() {
    if (this.initialGoalType) {
      this.selectedGoalType = this.initialGoalType;
    }
    if (this.initialDescription) {
      this.description = this.initialDescription;
    }
  }

  selectGoal(value: GoalType) {
    this.selectedGoalType = value;
    if (value !== 'other') {
      this.description = '';
    }
  }

  selectTimeline(value: Timeline) {
    this.selectedTimeline = value;
    if (value !== 'specific_date') {
      this.targetDate = '';
    }
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
          message: 'Your plan is ready — opening your journey.',
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
          || 'We couldn\'t build your plan just now. Please try again in a moment.';
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
