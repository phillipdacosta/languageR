import { Component, Input, Output, EventEmitter } from '@angular/core';
import { AlertController, LoadingController, IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../../services/user.service';
import { EarlyExitService } from '../../services/early-exit.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-early-exit-modal',
  templateUrl: './early-exit-modal.component.html',
  styleUrls: ['./early-exit-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class EarlyExitModalComponent {
  @Input() lessonId!: string;
  @Input() minutesRemaining!: number;
  @Input() userRole!: 'tutor' | 'student';
  @Output() modalDismissed = new EventEmitter<{ action: string }>();

  constructor(
    private alertController: AlertController,
    private loadingController: LoadingController,
    private router: Router,
    private http: HttpClient,
    private userService: UserService,
    private earlyExitService: EarlyExitService
  ) {}

  /**
   * Close modal without taking any action
   */
  dismiss() {
    this.modalDismissed.emit({ action: 'dismissed' });
  }

  /**
   * Handle "Report a technical error"
   */
  async reportTechnicalError() {
    // For now, just close the modal and do nothing
    // In the future, this could open a support ticket form
    console.log('📝 Reporting technical error for lesson:', this.lessonId);
    
    this.modalDismissed.emit({ action: 'report_error' });
  }

  /**
   * Handle "End Lesson" - show confirmation dialog
   */
  async endLesson() {
    const alert = await this.alertController.create({
      header: 'End Lesson Early?',
      message: `Are you sure you want to end the class early? There are ${this.minutesRemaining} minutes remaining.`,
      buttons: [
        {
          text: 'No',
          role: 'cancel',
          handler: () => {
            console.log('❌ User cancelled ending lesson early');
            // Don't dismiss modal - let them choose again
          }
        },
        {
          text: 'Yes, End Lesson',
          role: 'destructive',
          handler: async () => {
            console.log('✅ User confirmed ending lesson early');
            await this.finalizeLesson();
          }
        }
      ]
    });

    await alert.present();
  }

  /**
   * Finalize the lesson and trigger analysis
   */
  private async finalizeLesson() {
    const loading = await this.loadingController.create({
      message: 'Finalizing lesson...'
    });
    await loading.present();

    try {
      // FIRST: Notify video-call page to stop transcription immediately
      console.log('🛑 Notifying video-call to stop transcription...');
      this.earlyExitService.confirmLessonEnded(this.lessonId);
      
      // Small delay to let transcription stop
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // THEN: Call the call-end endpoint to finalize the lesson
      const headers = this.userService.getAuthHeadersSync();

      await firstValueFrom(
        this.http.post(`${environment.backendUrl}/api/lessons/${this.lessonId}/call-end`, {}, { headers })
      );

      console.log('✅ Lesson finalized');
      
      await loading.dismiss();

      // Dismiss modal with action
      this.modalDismissed.emit({ action: 'end_lesson_confirmed' });

      // Navigate back to home page (not analysis) for early exits
      await this.router.navigate(['/tabs/home']);

    } catch (error) {
      console.error('❌ Error finalizing lesson:', error);
      await loading.dismiss();
      
      const errorAlert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to finalize the lesson. Please try again.',
        buttons: ['OK']
      });
      await errorAlert.present();
    }
  }

  /**
   * Handle "Rejoin Call"
   */
  async rejoinCall() {
    console.log('🔄 Attempting to rejoin call for lesson:', this.lessonId);
    
    // First, check if lesson is still joinable
    try {
      const headers = this.userService.getAuthHeadersSync();
      const response = await firstValueFrom(
        this.http.get(`${environment.backendUrl}/api/lessons/${this.lessonId}`, { headers })
      );
      
      const lesson = (response as any)?.lesson;
      
      if (lesson?.status === 'completed') {
        // Lesson was ended, cannot rejoin
        this.modalDismissed.emit({ action: 'dismissed' });
        
        const alert = await this.alertController.create({
          header: 'Lesson Ended',
          message: 'This lesson has been completed and cannot be rejoined.',
          buttons: ['OK']
        });
        await alert.present();
        return;
      }
      
      // Lesson is still active, proceed with rejoin
      this.modalDismissed.emit({ action: 'rejoin' });

      // Navigate to pre-call page
      await this.router.navigate(['/pre-call'], {
        queryParams: {
          lessonId: this.lessonId,
          role: this.userRole,
          lessonMode: 'true'
        }
      });
    } catch (error) {
      console.error('❌ Error checking lesson status:', error);
      
      const errorAlert = await this.alertController.create({
        header: 'Error',
        message: 'Unable to rejoin the lesson. Please try again.',
        buttons: ['OK']
      });
      await errorAlert.present();
    }
  }
}
