import { Component, Input, OnInit, ChangeDetectionStrategy, ChangeDetectorRef, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RoadblockQuiz, RoadblockQuizQuestion, RoadblockReviewItem } from '../../services/learning-plan.service';

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
  /** When provided, the modal opens immediately in a loading state and resolves
   *  the quiz from this promise — so generation latency never blocks the open. */
  @Input() quizLoader?: Promise<{
    quiz: RoadblockQuiz;
    struggleLabel?: string;
    personalizedHeader?: string;
    label?: string;
    tier?: string;
    reviewItems?: RoadblockReviewItem[];
  } | null>;

  readonly roadblockIconSrc = 'assets/journey/sprites/roadblock.png';

  loading = false;
  loadFailed = false;

  /** Honest provenance label ("Based on your lessons", etc.). */
  provenanceLabel = '';
  /** Saveable nuggets surfaced alongside the quiz; each can be kept. */
  reviewItems: RoadblockReviewItem[] = [];
  savedFlags: boolean[] = [];
  hasReviewItems = false;

  stage: 'intro' | 'quiz' | 'done' = 'intro';
  questionIndex = 0;
  currentQuestion: RoadblockQuizQuestion | null = null;
  /** Resolved prompt (localized if the question carries a promptKey). */
  currentPromptText = '';
  /** Interface-language translation shown under a target-language prompt. */
  currentPromptTranslation = '';
  isMultipleChoice = false;
  selectedAnswer = '';
  typedAnswer = '';
  answered = false;
  isCorrect = false;
  retryHint = '';

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
    if (this.quizLoader) {
      this.loading = true;
      this.footerVisible = false;
      this.quizLoader
        .then(res => this.onQuizLoaded(res))
        .catch(() => this.onQuizLoaded(null));
      this.cdr.markForCheck();
      return;
    }
    this.applyIntroLine();
    this.updateFooterState();
  }

  private onQuizLoaded(res: { quiz: RoadblockQuiz; struggleLabel?: string; personalizedHeader?: string; label?: string; reviewItems?: RoadblockReviewItem[] } | null): void {
    this.loading = false;
    if (!res || !res.quiz) {
      this.loadFailed = true;
      this.footerVisible = true;
      this.footerDisabled = false;
      this.footerLabelKey = 'COMMON.CLOSE';
      this.cdr.markForCheck();
      return;
    }
    this.quiz = res.quiz;
    if (res.struggleLabel) this.struggleLabel = res.struggleLabel;
    if (res.personalizedHeader) this.personalizedHeader = res.personalizedHeader;
    if (res.label) this.provenanceLabel = res.label;
    this.reviewItems = Array.isArray(res.reviewItems) ? res.reviewItems : [];
    this.savedFlags = this.reviewItems.map(() => false);
    this.hasReviewItems = this.reviewItems.length > 0;
    this.applyIntroLine();
    this.stage = 'intro';
    this.updateFooterState();
    this.cdr.markForCheck();
  }

  private applyIntroLine(): void {
    this.introLine = this.personalizedHeader
      || (this.struggleLabel ? `A quick check on ${this.struggleLabel}.` : 'A quick check before you move on.');
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
      this.retryHint = '';
    }
    this.footerDisabled = !this.typedAnswer.trim();
    this.updateFooterState();
    this.cdr.markForCheck();
  }

  onFooterPrimary(): void {
    if (this.footerDisabled || !this.footerVisible) return;
    if (this.loadFailed) {
      this.modalCtrl.dismiss(null, 'cancel');
      return;
    }
    if (this.loading) return;
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
    if (q) this.ensureAnswerable(q);
    this.currentQuestion = q;
    this.currentPromptText = q?.promptKey ? this.translate.instant(q.promptKey) : (q?.prompt || '');
    this.currentPromptTranslation = q?.promptTranslation || '';
    this.isMultipleChoice = !!(q && q.type === 'multiple_choice' && q.options && q.options.length > 0);
    this.selectedAnswer = '';
    this.typedAnswer = '';
    this.answered = false;
    this.isCorrect = false;
    this.retryHint = '';
    this.questionScored = false;
    const total = this.quiz?.questions?.length || 1;
    this.questionCountLabel = this.translate.instant('JOURNEY.ROADBLOCK.QUESTION_COUNT', {
      current: this.questionIndex + 1,
      total
    });
    this.progressPct = Math.round((this.questionIndex / total) * 100);
    this.updateFooterState();
  }

  /** Safety net: a multiple-choice question whose correct answer isn't in
   *  its options is impossible to pass — and the gate is un-failable, so it
   *  would block the student forever. Inject the answer if it's missing. */
  private ensureAnswerable(q: RoadblockQuizQuestion): void {
    if (q.type !== 'multiple_choice' || !q.options || !q.options.length) return;
    const answer = (q.correctAnswer || '').trim();
    if (!answer) return;
    const has = q.options.some(o => this.normalize(o) === this.normalize(answer));
    if (!has) q.options = [...q.options, answer];
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
    this.answered = true;
    this.isCorrect = this.typedAnswerIsCorrect(q, this.typedAnswer);
    this.retryHint = this.isCorrect ? '' : this.buildRetryHint(q);
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

  toggleSave(i: number): void {
    if (i < 0 || i >= this.savedFlags.length) return;
    this.savedFlags[i] = !this.savedFlags[i];
    this.cdr.markForCheck();
  }

  finish(): void {
    const savedReviewItems = this.reviewItems.filter((_, i) => this.savedFlags[i]);
    this.modalCtrl.dismiss(
      {
        completed: true,
        quizId: this.quiz?._id,
        correct: this.firstTryCorrect,
        total: this.quiz?.questions?.length || 0,
        savedReviewItems
      },
      'completed'
    );
  }

  private normalize(s: string): string {
    return String(s || '').trim().toLowerCase().replace(/[.!?¿¡]/g, '');
  }

  private inferOpenAnswer(q: RoadblockQuizQuestion): boolean {
    if (q.openAnswer === true) return true;
    if (q.openAnswer === false) return false;
    if (q.type !== 'fill_blank' && q.type !== 'translate') return false;
    const prompt = q.prompt || '';
    if (!/_{2,}|\.{3,}|\[\s*blank\s*\]|\(\s*\)/i.test(prompt)) return false;
    return /\bhei[ßs]e\b|my name is|me llamo|je m'?appelle|mi chiamo|ich bin\b|\bsoy\b|je suis|introduce yourself|your name/i.test(prompt);
  }

  private isReasonableOpenAnswer(raw: string): boolean {
    const s = String(raw || '').trim();
    if (!s || s.length > 40) return false;
    return /^[\p{L}\p{M}'\-\s]{1,40}$/u.test(s);
  }

  private typedAnswerIsCorrect(q: RoadblockQuizQuestion, raw: string): boolean {
    if (this.inferOpenAnswer(q)) {
      return this.isReasonableOpenAnswer(raw);
    }
    const candidates = [q.correctAnswer, ...(q.acceptableAlternatives || [])].map(a => this.normalize(a));
    return candidates.includes(this.normalize(raw));
  }

  private buildRetryHint(q: RoadblockQuizQuestion): string {
    if (this.inferOpenAnswer(q)) {
      return this.translate.instant('JOURNEY.ROADBLOCK.OPEN_ANSWER_HINT');
    }
    const answer = q.correctAnswer?.trim();
    if (!answer) return '';
    return this.translate.instant('JOURNEY.ROADBLOCK.TRY_ANSWER', { answer });
  }
}
