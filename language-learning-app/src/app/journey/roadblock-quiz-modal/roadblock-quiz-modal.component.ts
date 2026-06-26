import { Component, Input, OnInit, ChangeDetectionStrategy, ChangeDetectorRef, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RoadblockQuiz, RoadblockQuizQuestion } from '../../services/learning-plan.service';

/**
 * Journey-map roadblock checkpoint. Mandatory but un-failable: a wrong
 * answer gently reveals the explanation and lets the student try again.
 */
@Component({
  selector: 'app-roadblock-quiz-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, TranslateModule],
  templateUrl: './roadblock-quiz-modal.component.html',
  styleUrls: ['../journey.page.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RoadblockQuizModalComponent implements OnInit {
  @Input() quiz!: RoadblockQuiz;
  @Input() struggleLabel = '';
  @Input() personalizedHeader = '';

  readonly roadblockIconSrc = 'assets/journey/sprites/roadblock.png';

  stage: 'intro' | 'quiz' | 'done' = 'intro';
  questionIndex = 0;
  currentQuestion: RoadblockQuizQuestion | null = null;
  isMultipleChoice = false;
  selectedAnswer = '';
  typedAnswer = '';
  answered = false;
  isCorrect = false;

  // First-attempt performance — reported on finish so the backend can
  // fold it into the student's skill belief. The gate is un-failable, so
  // only the FIRST attempt per question counts as evidence.
  private firstTryCorrect = 0;
  private questionScored = false;

  introLine = '';
  questionCountLabel = '';
  footerLabelKey = 'JOURNEY.ROADBLOCK.START';
  footerDisabled = false;
  footerVisible = true;
  progressPct = 0;

  constructor(
    private modalCtrl: ModalController,
    private cdr: ChangeDetectorRef,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.introLine = this.personalizedHeader
      || (this.struggleLabel ? `A quick check on ${this.struggleLabel}.` : 'A quick check before you move on.');
    this.updateFooterState();
  }

  trackByIndex(i: number): number { return i; }

  start(): void {
    this.questionIndex = 0;
    this.loadQuestion();
    this.stage = 'quiz';
    this.updateFooterState();
    this.cdr.markForCheck();
  }

  onTypedAnswerChange(): void {
    if (this.stage !== 'quiz' || this.isMultipleChoice) return;
    if (this.answered && !this.isCorrect) {
      this.answered = false;
      this.isCorrect = false;
    }
    this.footerDisabled = !this.typedAnswer.trim();
    this.updateFooterState();
    this.cdr.markForCheck();
  }

  onFooterPrimary(): void {
    if (this.footerDisabled || !this.footerVisible) return;
    if (this.stage === 'intro') {
      this.start();
      return;
    }
    if (this.stage === 'done') {
      this.finish();
      return;
    }
    if (this.stage === 'quiz') {
      if (!this.isMultipleChoice && !this.answered) {
        this.checkTyped();
        return;
      }
      if (this.answered && this.isCorrect) {
        this.next();
      }
    }
  }

  private loadQuestion(): void {
    const q = this.quiz?.questions?.[this.questionIndex] || null;
    this.currentQuestion = q;
    this.isMultipleChoice = !!(q && q.type === 'multiple_choice' && q.options && q.options.length > 0);
    this.selectedAnswer = '';
    this.typedAnswer = '';
    this.answered = false;
    this.isCorrect = false;
    this.questionScored = false;
    const total = this.quiz?.questions?.length || 1;
    this.questionCountLabel = this.translate.instant('JOURNEY.ROADBLOCK.QUESTION_COUNT', {
      current: this.questionIndex + 1,
      total
    });
    this.progressPct = Math.round((this.questionIndex / total) * 100);
    this.updateFooterState();
  }

  private updateFooterState(): void {
    if (this.stage === 'intro') {
      this.footerLabelKey = 'JOURNEY.ROADBLOCK.START';
      this.footerDisabled = false;
      this.footerVisible = true;
      return;
    }

    if (this.stage === 'done') {
      this.footerLabelKey = 'JOURNEY.ROADBLOCK.CONTINUE';
      this.footerDisabled = false;
      this.footerVisible = true;
      return;
    }

    const total = this.quiz?.questions?.length || 1;
    const isLast = this.questionIndex >= total - 1;

    if (!this.isMultipleChoice) {
      if (this.answered && this.isCorrect) {
        this.footerLabelKey = isLast ? 'JOURNEY.ROADBLOCK.DONE' : 'COMMON.NEXT';
        this.footerDisabled = false;
        this.footerVisible = true;
        return;
      }
      this.footerLabelKey = 'JOURNEY.ROADBLOCK.CHECK';
      this.footerDisabled = !this.typedAnswer.trim();
      this.footerVisible = true;
      return;
    }

    if (this.answered && this.isCorrect) {
      this.footerLabelKey = isLast ? 'JOURNEY.ROADBLOCK.DONE' : 'COMMON.NEXT';
      this.footerDisabled = false;
      this.footerVisible = true;
      return;
    }

    this.footerVisible = false;
  }

  optionIsCorrect(opt: string): boolean {
    return this.normalize(opt) === this.normalize(this.currentQuestion?.correctAnswer || '');
  }

  pickOption(opt: string): void {
    if (this.answered && this.isCorrect) return;
    this.selectedAnswer = opt;
    this.answered = true;
    this.isCorrect = this.optionIsCorrect(opt);
    this.gradeFirstAttempt();
    if (this.isCorrect) {
      const total = this.quiz?.questions?.length || 1;
      this.progressPct = Math.round(((this.questionIndex + 1) / total) * 100);
    }
    this.updateFooterState();
    this.cdr.markForCheck();
  }

  checkTyped(): void {
    if (!this.typedAnswer.trim()) return;
    if (this.answered && this.isCorrect) return;
    const q = this.currentQuestion;
    if (!q) return;
    const candidates = [q.correctAnswer, ...(q.acceptableAlternatives || [])].map(a => this.normalize(a));
    this.answered = true;
    this.isCorrect = candidates.includes(this.normalize(this.typedAnswer));
    this.gradeFirstAttempt();
    if (this.isCorrect) {
      const total = this.quiz?.questions?.length || 1;
      this.progressPct = Math.round(((this.questionIndex + 1) / total) * 100);
    }
    this.updateFooterState();
    this.cdr.markForCheck();
  }

  next(): void {
    const total = this.quiz?.questions?.length || 0;
    if (this.questionIndex >= total - 1) {
      this.stage = 'done';
      this.updateFooterState();
      this.cdr.markForCheck();
      return;
    }
    this.questionIndex++;
    this.loadQuestion();
    this.cdr.markForCheck();
  }

  /** Credit the FIRST attempt at the current question (un-failable gate). */
  private gradeFirstAttempt(): void {
    if (this.questionScored) return;
    this.questionScored = true;
    if (this.isCorrect) this.firstTryCorrect++;
  }

  finish(): void {
    this.modalCtrl.dismiss(
      {
        completed: true,
        quizId: this.quiz?._id,
        correct: this.firstTryCorrect,
        total: this.quiz?.questions?.length || 0
      },
      'completed'
    );
  }

  private normalize(s: string): string {
    return String(s || '').trim().toLowerCase().replace(/[.!?¿¡]/g, '');
  }
}
