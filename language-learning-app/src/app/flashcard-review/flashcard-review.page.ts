import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { VocabularyService, VocabularyCard, SrsStats } from '../services/vocabulary.service';
import { SharedModule } from '../shared/shared.module';
import { trigger, transition, style, animate } from '@angular/animations';

@Component({
  selector: 'app-flashcard-review',
  templateUrl: './flashcard-review.page.html',
  styleUrls: ['./flashcard-review.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule, SharedModule],
  animations: [
    trigger('cardFlip', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(20px)' }),
        animate('300ms ease-out', style({ opacity: 1, transform: 'translateY(0)' }))
      ])
    ])
  ]
})
export class FlashcardReviewPage implements OnInit {
  language = '';
  cards: VocabularyCard[] = [];
  stats: SrsStats | null = null;
  isLoading = true;
  currentIndex = 0;
  isFlipped = false;
  sessionComplete = false;
  reviewedCount = 0;
  correctCount = 0;

  constructor(
    private vocabService: VocabularyService,
    private route: ActivatedRoute,
    private router: Router,
    private toast: ToastController
  ) {}

  ngOnInit() {
    this.language = this.route.snapshot.paramMap.get('language') || '';
    if (this.language) {
      this.loadDueCards();
      this.loadStats();
    }
  }

  get currentCard(): VocabularyCard | null {
    return this.cards[this.currentIndex] || null;
  }

  get progressPercent(): number {
    if (this.cards.length === 0) return 0;
    return Math.round((this.reviewedCount / this.cards.length) * 100);
  }

  private loadDueCards() {
    this.isLoading = true;
    this.vocabService.getDueCards(this.language, 20).subscribe({
      next: (res) => {
        this.cards = res.success ? res.cards : [];
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  private loadStats() {
    this.vocabService.getSrsStats(this.language).subscribe({
      next: (res) => {
        if (res.success) {
          this.stats = {
            total: res.total,
            new: res.new,
            learning: res.learning,
            review: res.review,
            mastered: res.mastered,
            dueNow: res.dueNow
          };
        }
      }
    });
  }

  flipCard() {
    this.isFlipped = !this.isFlipped;
  }

  rateCard(quality: number) {
    const card = this.currentCard;
    if (!card) return;

    this.vocabService.reviewCard(card._id, quality).subscribe({
      next: () => {
        this.reviewedCount++;
        if (quality >= 3) this.correctCount++;
        this.isFlipped = false;

        if (this.currentIndex < this.cards.length - 1) {
          this.currentIndex++;
        } else {
          this.sessionComplete = true;
          this.loadStats();
        }
      },
      error: async () => {
        const t = await this.toast.create({ message: 'Error saving review', duration: 2000, color: 'danger' });
        t.present();
      }
    });
  }

  startNewSession() {
    this.sessionComplete = false;
    this.currentIndex = 0;
    this.reviewedCount = 0;
    this.correctCount = 0;
    this.isFlipped = false;
    this.loadDueCards();
  }

  goBack() {
    this.router.navigate(['/tabs/home']);
  }
}
