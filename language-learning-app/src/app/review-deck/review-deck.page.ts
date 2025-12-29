import { Component, OnInit } from '@angular/core';
import { ReviewDeckService, ReviewDeckItem, ReviewDeckStats } from '../services/review-deck.service';
import { AlertController, ToastController, LoadingController } from '@ionic/angular';

@Component({
  selector: 'app-review-deck',
  templateUrl: './review-deck.page.html',
  styleUrls: ['./review-deck.page.scss'],
  standalone: false
})
export class ReviewDeckPage implements OnInit {
  items: ReviewDeckItem[] = [];
  stats: ReviewDeckStats | null = null;
  loading = true;
  
  // Filters
  filterMastered: 'all' | 'active' | 'mastered' = 'all';
  filterLanguage = 'all';
  filterErrorType = 'all';
  
  // Practice mode
  practiceMode = false;
  currentPracticeIndex = 0;
  practiceItems: ReviewDeckItem[] = [];
  showAnswer = false;

  constructor(
    private reviewDeckService: ReviewDeckService,
    private alertController: AlertController,
    private toastController: ToastController,
    private loadingController: LoadingController
  ) {}

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.loading = true;
    
    // Load items and stats in parallel
    Promise.all([
      this.reviewDeckService.getItems({ limit: 1000, ...this.getFilters() }).toPromise(),
      this.reviewDeckService.getStats().toPromise()
    ]).then(([itemsResponse, stats]) => {
      this.items = itemsResponse?.items || [];
      this.stats = stats || null;
      this.loading = false;
    }).catch(async (error) => {
      console.error('Error loading review deck:', error);
      this.loading = false;
      
      // Show user-friendly error
      const toast = await this.toastController.create({
        message: 'Failed to load review deck. Please try again.',
        duration: 3000,
        position: 'bottom',
        color: 'danger'
      });
      await toast.present();
    });
  }

  private getFilters() {
    const filters: any = {};
    
    if (this.filterMastered === 'active') {
      filters.mastered = false;
    } else if (this.filterMastered === 'mastered') {
      filters.mastered = true;
    }
    
    if (this.filterLanguage !== 'all') {
      filters.language = this.filterLanguage;
    }
    
    if (this.filterErrorType !== 'all') {
      filters.errorType = this.filterErrorType;
    }
    
    return filters;
  }

  onFilterChange() {
    this.loadData();
  }

  async toggleMastered(item: ReviewDeckItem, event: Event) {
    event.stopPropagation();
    
    this.reviewDeckService.toggleMastered(item._id).subscribe({
      next: async (response) => {
        item.mastered = response.item.mastered;
        
        const toast = await this.toastController.create({
          message: item.mastered ? '✅ Marked as mastered!' : 'Marked as not mastered',
          duration: 2000,
          position: 'bottom',
          color: item.mastered ? 'success' : 'medium'
        });
        await toast.present();
        
        // Reload stats
        this.reviewDeckService.getStats().subscribe(stats => {
          this.stats = stats;
        });
      },
      error: async (error) => {
        console.error('Error toggling mastered:', error);
        const toast = await this.toastController.create({
          message: 'Failed to update',
          duration: 2000,
          position: 'bottom',
          color: 'danger'
        });
        await toast.present();
      }
    });
  }

  async deleteItem(item: ReviewDeckItem, event: Event) {
    event.stopPropagation();
    
    const alert = await this.alertController.create({
      header: 'Delete Item?',
      message: 'Are you sure you want to remove this from your review deck?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            this.reviewDeckService.deleteItem(item._id).subscribe({
              next: async () => {
                this.items = this.items.filter(i => i._id !== item._id);
                
                const toast = await this.toastController.create({
                  message: 'Removed from review deck',
                  duration: 2000,
                  position: 'bottom',
                  color: 'medium'
                });
                await toast.present();
                
                // Reload stats
                this.reviewDeckService.getStats().subscribe(stats => {
                  this.stats = stats;
                });
              },
              error: async (error) => {
                console.error('Error deleting item:', error);
                const toast = await this.toastController.create({
                  message: 'Failed to delete',
                  duration: 2000,
                  position: 'bottom',
                  color: 'danger'
                });
                await toast.present();
              }
            });
          }
        }
      ]
    });
    
    await alert.present();
  }

  async startPracticeMode() {
    const loading = await this.loadingController.create({
      message: 'Loading practice items...'
    });
    await loading.present();
    
    // Get items that need review
    this.reviewDeckService.getItemsNeedingReview(20).subscribe({
      next: (response) => {
        loading.dismiss();
        
        if (response.items.length === 0) {
          this.showNoItemsAlert();
          return;
        }
        
        this.practiceItems = response.items;
        this.currentPracticeIndex = 0;
        this.showAnswer = false;
        this.practiceMode = true;
      },
      error: (error) => {
        loading.dismiss();
        console.error('Error loading practice items:', error);
      }
    });
  }

  private async showNoItemsAlert() {
    const alert = await this.alertController.create({
      header: 'No Items to Practice',
      message: 'You don\'t have any items that need review right now. Great job! 🎉',
      buttons: ['OK']
    });
    await alert.present();
  }

  exitPracticeMode() {
    this.practiceMode = false;
    this.practiceItems = [];
    this.currentPracticeIndex = 0;
    this.showAnswer = false;
    this.loadData(); // Refresh data
  }

  toggleShowAnswer() {
    this.showAnswer = !this.showAnswer;
    
    if (this.showAnswer) {
      // Mark as reviewed
      const currentItem = this.practiceItems[this.currentPracticeIndex];
      this.reviewDeckService.markAsReviewed(currentItem._id).subscribe({
        next: (response) => {
          // Update the item in the array
          currentItem.reviewCount = response.item.reviewCount;
          currentItem.lastReviewedAt = response.item.lastReviewedAt;
        },
        error: (error) => {
          console.error('Error marking as reviewed:', error);
        }
      });
    }
  }

  nextPracticeItem() {
    if (this.currentPracticeIndex < this.practiceItems.length - 1) {
      this.currentPracticeIndex++;
      this.showAnswer = false;
    } else {
      this.showPracticeComplete();
    }
  }

  previousPracticeItem() {
    if (this.currentPracticeIndex > 0) {
      this.currentPracticeIndex--;
      this.showAnswer = false;
    }
  }

  async markCurrentMastered() {
    const currentItem = this.practiceItems[this.currentPracticeIndex];
    
    this.reviewDeckService.toggleMastered(currentItem._id).subscribe({
      next: async (response) => {
        currentItem.mastered = response.item.mastered;
        
        const toast = await this.toastController.create({
          message: '✅ Mastered!',
          duration: 1500,
          position: 'bottom',
          color: 'success'
        });
        await toast.present();
        
        // Move to next item
        setTimeout(() => {
          this.nextPracticeItem();
        }, 500);
      }
    });
  }

  private async showPracticeComplete() {
    const alert = await this.alertController.create({
      header: 'Practice Complete! 🎉',
      message: `You reviewed ${this.practiceItems.length} items. Great work!`,
      buttons: [
        {
          text: 'Done',
          handler: () => {
            this.exitPracticeMode();
          }
        }
      ]
    });
    await alert.present();
  }

  getErrorTypeColor(type: string): string {
    const colors: { [key: string]: string } = {
      grammar: 'primary',
      vocabulary: 'success',
      pronunciation: 'secondary',
      tense: 'warning',
      preposition: 'tertiary',
      agreement: 'danger',
      spelling: 'medium',
      word_choice: 'light'
    };
    return colors[type] || 'medium';
  }

  formatDate(date: Date | undefined): string {
    if (!date) return 'Never';
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  }
}

