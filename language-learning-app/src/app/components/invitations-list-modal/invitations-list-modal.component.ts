import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { ClassService } from '../../services/class.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-invitations-list-modal',
  templateUrl: './invitations-list-modal.component.html',
  styleUrls: ['./invitations-list-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class InvitationsListModalComponent implements OnInit, OnChanges {
  @Input() invitations: any[] = [];

  // View state
  currentView: 'list' | 'details' = 'list';
  selectedInvitation: any = null;
  loadingDetails = false;
  processing = false;

  // Getter to filter out cancelled invitations
  get activeInvitations(): any[] {
    return this.invitations.filter(inv => inv.status !== 'cancelled');
  }

  get sanitizedDescription(): SafeHtml {
    if (!this.selectedInvitation?.description) return '';
    return this.sanitizer.bypassSecurityTrustHtml(this.selectedInvitation.description);
  }

  get spotsLeft(): number {
    if (!this.selectedInvitation) return 0;
    return this.selectedInvitation.capacity - (this.selectedInvitation.confirmedStudents?.length || 0);
  }

  get spotsText(): string {
    const left = this.spotsLeft;
    if (left === 0) return 'Full';
    return `${left} ${left === 1 ? 'spot' : 'spots'} left`;
  }

  get duration(): number {
    if (!this.selectedInvitation?.startTime || !this.selectedInvitation?.endTime) return 0;
    const start = new Date(this.selectedInvitation.startTime);
    const end = new Date(this.selectedInvitation.endTime);
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60));
  }

  constructor(
    private modalController: ModalController,
    private classService: ClassService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    console.log('InvitationsListModalComponent - all invitations:', this.invitations);
    console.log('InvitationsListModalComponent - active invitations:', this.activeInvitations);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['invitations']) {
      console.log('Invitations changed:', changes['invitations'].currentValue);
      // Reset to list view when invitations update
      this.currentView = 'list';
      this.selectedInvitation = null;
    }
  }

  dismiss() {
    this.modalController.dismiss();
  }

  async selectInvitation(invitationId: string) {
    this.loadingDetails = true;
    
    try {
      const response = await this.classService.getClass(invitationId).toPromise();
      if (response && response.success && response.class) {
        this.selectedInvitation = response.class;
        this.currentView = 'details';
      } else {
        // Invitation not found - expired/removed
        console.log('Invitation expired or not found');
        this.modalController.dismiss({ expired: true, classId: invitationId });
      }
    } catch (error) {
      console.error('Error loading class details:', error);
      // Also treat errors as expired invitations
      this.modalController.dismiss({ expired: true, classId: invitationId });
    } finally {
      this.loadingDetails = false;
    }
  }

  backToList() {
    this.currentView = 'list';
    this.selectedInvitation = null;
  }

  async acceptInvitation() {
    if (!this.selectedInvitation || this.processing) return;
    
    this.processing = true;
    try {
      const response = await this.classService.acceptInvitation(
        this.selectedInvitation._id
      ).toPromise();
      
      if (response && response.success) {
        // Close modal and signal success
        this.modalController.dismiss({ accepted: true, classId: this.selectedInvitation._id });
      }
    } catch (error) {
      console.error('Error accepting invitation:', error);
      this.processing = false;
    }
  }

  async declineInvitation() {
    if (!this.selectedInvitation || this.processing) return;
    
    this.processing = true;
    try {
      const response = await this.classService.declineInvitation(
        this.selectedInvitation._id
      ).toPromise();
      
      if (response && response.success) {
        // Close modal and signal decline
        this.modalController.dismiss({ declined: true, classId: this.selectedInvitation._id });
      }
    } catch (error) {
      console.error('Error declining invitation:', error);
      this.processing = false;
    }
  }

  formatClassDate(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
  }

  formatClassTime(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  }

  formatDetailedDate(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric',
      month: 'long', 
      day: 'numeric'
    });
  }

  formatDetailedTime(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  }
}

