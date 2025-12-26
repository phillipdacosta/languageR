import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ClassService, ClassInvitation } from '../../services/class.service';

@Component({
  selector: 'app-class-invitation-modal',
  templateUrl: './class-invitation-modal.component.html',
  styleUrls: ['./class-invitation-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class ClassInvitationModalComponent implements OnInit {
  @Input() classId!: string;
  @Input() notification?: any; // Notification data if opened from notification
  
  classData: ClassInvitation | null = null;
  loading = true;
  processing = false;
  sanitizedDescription: SafeHtml = '';

  constructor(
    private modalCtrl: ModalController,
    private classService: ClassService,
    private toastController: ToastController,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    if (this.notification?.data) {
      // If opened from notification, we have most data already
      this.classData = {
        _id: this.notification.data.classId,
        tutorId: {
          _id: this.notification.data.tutorId,
          name: this.notification.data.tutorName,
          email: '',
          picture: this.notification.data.tutorPicture || ''
        },
        name: this.notification.data.className,
        description: this.notification.data.classDescription || '',
        capacity: this.notification.data.capacity || 1,
        price: this.notification.data.price || 0,
        startTime: this.notification.data.startTime,
        endTime: this.notification.data.endTime,
        invitedStudents: [],
        confirmedStudents: []
      } as ClassInvitation;
      this.updateSanitizedDescription();
      this.loading = false;
    } else if (this.classId) {
      // Otherwise, fetch from API
      this.loadClassDetails();
    } else {
      console.error('No classId or notification data provided to ClassInvitationModal');
      this.loading = false;
    }
  }

  loadClassDetails() {
    this.loading = true;
    this.classService.getPendingInvitations().subscribe({
      next: (response) => {
        if (response.success) {
          this.classData = response.classes.find(c => c._id === this.classId) || null;
          
          // If class not found, it means the invitation was removed/expired
          if (!this.classData) {
            console.log('Invitation not found - likely removed or expired');
            // Dismiss modal and signal that invitation expired
            this.modalCtrl.dismiss({ expired: true, classId: this.classId });
          } else {
            this.updateSanitizedDescription();
          }
        }
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading class details:', error);
        this.loading = false;
      }
    });
  }

  private updateSanitizedDescription() {
    if (this.classData?.description) {
      this.sanitizedDescription = this.sanitizer.bypassSecurityTrustHtml(this.classData.description);
    } else {
      this.sanitizedDescription = '';
    }
  }

  get formattedDate(): string {
    if (!this.classData) return '';
    const date = new Date(this.classData.startTime);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  get formattedTime(): string {
    if (!this.classData) return '';
    const date = new Date(this.classData.startTime);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });
  }

  get duration(): number {
    if (!this.classData) return 0;
    const start = new Date(this.classData.startTime);
    const end = new Date(this.classData.endTime);
    return Math.round((end.getTime() - start.getTime()) / 60000);
  }

  get spotsLeft(): number {
    if (!this.classData) return 0;
    return this.classData.capacity - this.classData.confirmedStudents.length;
  }

  get spotsText(): string {
    const spots = this.spotsLeft;
    if (spots === 0) return 'Class is full';
    if (spots === 1) return '1 spot left';
    return `${spots} spots left`;
  }

  async acceptInvitation() {
    if (!this.classData) return;
    
    this.processing = true;
    this.classService.acceptInvitation(this.classData._id).subscribe({
      next: async (response) => {
        const toast = await this.toastController.create({
          message: 'Class invitation accepted! Added to your calendar.',
          duration: 2000,
          color: 'success',
          position: 'top'
        });
        await toast.present();
        
        this.modalCtrl.dismiss({ accepted: true });
      },
      error: async (error) => {
        console.error('Error accepting invitation:', error);
        
        // Handle scheduling conflicts (409) with more detailed message
        const isConflict = error.status === 409;
        const message = error.error?.message || 'Failed to accept invitation';
        
        const toast = await this.toastController.create({
          message,
          duration: isConflict ? 5000 : 2500, // Longer duration for conflict messages
          color: isConflict ? 'warning' : 'danger',
          position: 'top',
          buttons: isConflict ? [
            {
              text: 'OK',
              role: 'cancel'
            }
          ] : undefined
        });
        await toast.present();
        this.processing = false;
      }
    });
  }

  async declineInvitation() {
    if (!this.classData) return;
    
    this.processing = true;
    this.classService.declineInvitation(this.classData._id).subscribe({
      next: async (response) => {
        const toast = await this.toastController.create({
          message: 'Class invitation declined',
          duration: 2000,
          color: 'medium',
          position: 'top'
        });
        await toast.present();
        
        this.modalCtrl.dismiss({ declined: true });
      },
      error: async (error) => {
        console.error('Error declining invitation:', error);
        const toast = await this.toastController.create({
          message: 'Failed to decline invitation',
          duration: 2500,
          color: 'danger',
          position: 'top'
        });
        await toast.present();
        this.processing = false;
      }
    });
  }

  close() {
    this.modalCtrl.dismiss();
  }
}

