import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { TutorFeedbackService, PendingFeedbackItem } from '../services/tutor-feedback.service';

@Component({
  selector: 'app-tutor-feedback',
  templateUrl: './tutor-feedback.page.html',
  styleUrls: ['./tutor-feedback.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule]
})
export class TutorFeedbackPage implements OnInit {
  feedbackItem: PendingFeedbackItem | null = null;
  isLoading = true;
  isSubmitting = false;

  // Form fields
  strengths: string[] = [''];
  areasForImprovement: string[] = [''];
  homework: string = '';
  overallNotes: string = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private tutorFeedbackService: TutorFeedbackService,
    private toastController: ToastController,
    private modalController: ModalController
  ) {}

  ngOnInit() {
    const feedbackId = this.route.snapshot.paramMap.get('feedbackId');
    if (feedbackId) {
      this.loadFeedbackItem(feedbackId);
    }
  }

  async loadFeedbackItem(feedbackId: string) {
    this.isLoading = true;
    try {
      // TEST MODE: Show mock data for UI testing
      if (feedbackId === 'test') {
        this.feedbackItem = {
          _id: 'test',
          lessonId: 'test-lesson',
          tutorId: 'test-tutor',
          studentId: 'test-student',
          strengths: [],
          areasForImprovement: [],
          homework: '',
          overallNotes: '',
          status: 'pending',
          createdAt: new Date(),
          remindersSent: 0,
          studentName: 'Test Student',
          studentPicture: 'https://ui-avatars.com/api/?name=Test+Student&background=007bff&color=fff',
          lesson: {
            startTime: new Date(),
            endTime: new Date(),
            subject: 'Spanish',
            duration: 25
          }
        };
        this.isLoading = false;
        return;
      }
      
      const response = await this.tutorFeedbackService.getPendingFeedback().toPromise();
      this.feedbackItem = response?.pendingFeedback.find(item => item._id === feedbackId) || null;
      
      if (!this.feedbackItem) {
        const toast = await this.toastController.create({
          message: 'Feedback request not found',
          duration: 3000,
          color: 'danger'
        });
        await toast.present();
        this.router.navigate(['/tabs/home']);
      }
    } catch (error) {
      console.error('Error loading feedback item:', error);
      const toast = await this.toastController.create({
        message: 'Failed to load feedback request',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
    } finally {
      this.isLoading = false;
    }
  }

  addStrength() {
    this.strengths.push('');
  }

  removeStrength(index: number) {
    if (this.strengths.length > 1) {
      this.strengths.splice(index, 1);
    }
  }

  addAreaForImprovement() {
    this.areasForImprovement.push('');
  }

  removeAreaForImprovement(index: number) {
    if (this.areasForImprovement.length > 1) {
      this.areasForImprovement.splice(index, 1);
    }
  }

  async submitFeedback() {
    // Validate
    const validStrengths = this.strengths.filter(s => s.trim().length > 0);
    const validImprovements = this.areasForImprovement.filter(a => a.trim().length > 0);

    if (validStrengths.length === 0) {
      const toast = await this.toastController.create({
        message: 'Please add at least one strength',
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
      return;
    }

    if (validImprovements.length === 0) {
      const toast = await this.toastController.create({
        message: 'Please add at least one area for improvement',
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
      return;
    }

    this.isSubmitting = true;
    try {
      // TEST MODE: Just show success message without API call
      if (this.feedbackItem!._id === 'test') {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API delay
        
        const toast = await this.toastController.create({
          message: '🧪 Test mode: Feedback preview looks good! ✅',
          duration: 3000,
          color: 'success'
        });
        await toast.present();
        
        // Navigate back
        const modal = await this.modalController.getTop();
        if (modal) {
          await modal.dismiss({ submitted: true });
        } else {
          this.router.navigate(['/tabs/home']);
        }
        return;
      }
      
      await this.tutorFeedbackService.submitFeedback(
        this.feedbackItem!._id,
        {
          strengths: validStrengths,
          areasForImprovement: validImprovements,
          homework: this.homework.trim(),
          overallNotes: this.overallNotes.trim()
        }
      ).toPromise();

      const toast = await this.toastController.create({
        message: 'Feedback submitted successfully! ✅',
        duration: 3000,
        color: 'success'
      });
      await toast.present();

      // Close modal if opened as modal, otherwise navigate back
      const modal = await this.modalController.getTop();
      if (modal) {
        await modal.dismiss({ submitted: true });
      } else {
        this.router.navigate(['/tabs/home']);
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
      const toast = await this.toastController.create({
        message: 'Failed to submit feedback',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
    } finally {
      this.isSubmitting = false;
    }
  }

  async cancel() {
    const modal = await this.modalController.getTop();
    if (modal) {
      await modal.dismiss();
    } else {
      this.router.navigate(['/tabs/home']);
    }
  }

  formatDate(date: Date | undefined): string {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }
}

