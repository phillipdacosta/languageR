import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, LoadingController, ToastController } from '@ionic/angular';
import { LessonService } from '../../services/lesson.service';
import { Router } from '@angular/router';
import { firstValueFrom, asyncScheduler } from 'rxjs';
import { timeout, observeOn } from 'rxjs/operators';

@Component({
  selector: 'app-reschedule-proposal-modal',
  templateUrl: './reschedule-proposal-modal.component.html',
  styleUrls: ['./reschedule-proposal-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class RescheduleProposalModalComponent implements OnInit {
  @Input() lessonId!: string;
  @Input() lesson: any;
  @Input() proposal: any;
  @Input() participantName!: string;
  @Input() participantAvatar?: string;
  @Input() proposedDate!: string;
  @Input() proposedTime!: string;
  @Input() originalDate!: string;
  @Input() originalTime!: string;
  
  // Computed property to avoid function call in template
  participantInitial: string = '?';

  constructor(
    private modalCtrl: ModalController,
    private lessonService: LessonService,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private router: Router
  ) {}

  ngOnInit() {
    try {
      // Pre-compute the initial
      this.participantInitial = this.participantName ? this.participantName.charAt(0).toUpperCase() : '?';
      
      console.log('📅 RescheduleProposalModal initialized:', {
        lessonId: this.lessonId,
        proposal: this.proposal,
        participantName: this.participantName,
        participantAvatar: this.participantAvatar,
        proposedDate: this.proposedDate,
        proposedTime: this.proposedTime,
        originalDate: this.originalDate,
        originalTime: this.originalTime
      });
    } catch (error) {
      console.error('❌ Error initializing reschedule proposal modal:', error);
    }
  }

  dismiss() {
    this.modalCtrl.dismiss();
  }

  async acceptProposal() {
    const loading = await this.loadingController.create({
      message: 'Accepting new time...'
    });
    await loading.present();

    try {
      // Add timeout protection and asyncScheduler to the API call
      const apiPromise = firstValueFrom(
        this.lessonService.respondToReschedule(this.lessonId, true).pipe(
          observeOn(asyncScheduler), // Make emissions async to prevent freezing
          timeout(15000) // 15 second timeout
        )
      );
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 15000)
      );
      
      const response: any = await Promise.race([apiPromise, timeoutPromise]);

      await loading.dismiss();

      if (response?.success) {
        const toast = await this.toastController.create({
          message: 'New time accepted! Lesson updated.',
          duration: 3000,
          color: 'success'
        });
        await toast.present();

        this.modalCtrl.dismiss({ action: 'accepted' });
      } else {
        throw new Error(response?.message || 'Failed to accept reschedule');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('Error accepting reschedule:', error);
      
      const errorMessage = error?.message === 'Request timeout'
        ? 'Request timed out. Please try again.'
        : (error?.error?.message || 'Failed to accept reschedule');
      
      const toast = await this.toastController.create({
        message: errorMessage,
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
    }
  }

  async rejectProposal() {
    const loading = await this.loadingController.create({
      message: 'Declining proposal...'
    });
    await loading.present();

    try {
      // Add timeout protection and asyncScheduler to the API call
      const apiPromise = firstValueFrom(
        this.lessonService.respondToReschedule(this.lessonId, false).pipe(
          observeOn(asyncScheduler), // Make emissions async to prevent freezing
          timeout(15000) // 15 second timeout
        )
      );
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 15000)
      );
      
      const response: any = await Promise.race([apiPromise, timeoutPromise]);

      await loading.dismiss();

      if (response?.success) {
        // Ask if user wants to propose a different time
        const toast = await this.toastController.create({
          message: 'Proposal declined',
          duration: 5000,
          color: 'warning',
          buttons: [
            {
              text: 'Propose Different Time',
              handler: () => {
                this.modalCtrl.dismiss({ action: 'counter' });
              }
            },
            {
              text: 'Close',
              role: 'cancel'
            }
          ]
        });
        await toast.present();

        // Wait a bit before dismissing to allow user to see the toast
        setTimeout(() => {
          this.modalCtrl.dismiss({ action: 'rejected' });
        }, 500);
      } else {
        throw new Error(response?.message || 'Failed to reject reschedule');
      }
    } catch (error: any) {
      await loading.dismiss();
      console.error('Error rejecting reschedule:', error);
      
      const errorMessage = error?.message === 'Request timeout'
        ? 'Request timed out. Please try again.'
        : (error?.error?.message || 'Failed to reject reschedule');
      
      const toast = await this.toastController.create({
        message: errorMessage,
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
    }
  }

  counterPropose() {
    this.modalCtrl.dismiss({ action: 'counter' });
  }
}

