import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, ModalController } from '@ionic/angular';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { ClassService } from '../services/class.service';
import { UserService } from '../services/user.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SharedModule } from '../shared/shared.module';

@Component({
  selector: 'app-explore-details',
  templateUrl: './explore-details.page.html',
  styleUrls: ['./explore-details.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, FormsModule, SharedModule]
})
export class ExploreDetailsPage implements OnInit {
  classId: string | null = null;
  classDetails: any = null;
  isLoading = true;
  currentUser: any = null;
  sanitizedDescription: SafeHtml = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private classService: ClassService,
    private userService: UserService,
    private toast: ToastController,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    this.userService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });

    this.route.paramMap.subscribe(params => {
      this.classId = params.get('id');
      if (this.classId) {
        this.loadClassDetails();
      }
    });
  }

  loadClassDetails() {
    if (!this.classId) return;

    this.isLoading = true;
    this.classService.getClass(this.classId).subscribe({
      next: (response) => {
        if (response.success) {
          this.classDetails = response.class;
          // Pre-sanitize description to avoid calling function in template
          if (this.classDetails?.description) {
            this.sanitizedDescription = this.sanitizer.bypassSecurityTrustHtml(this.classDetails.description);
          }
        } else {
          this.toast.create({
            message: 'Class not found',
            duration: 2000,
            color: 'danger'
          }).then(t => t.present());
          this.router.navigate(['/tabs/home/explore']);
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading class details:', error);
        this.isLoading = false;
        this.toast.create({
          message: 'Failed to load class details',
          duration: 2000,
          color: 'danger'
        }).then(t => t.present());
        this.router.navigate(['/explore']);
      }
    });
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  formatTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });
  }

  formatTimeRange(startTime: string, endTime: string): string {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const startStr = start.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });
    const endStr = end.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });
    return `${startStr} - ${endStr}`;
  }

  getDuration(startTime: string, endTime: string): number {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60)); // Duration in minutes
  }

  getLevelLabel(level: string): string {
    const levelMap: { [key: string]: string } = {
      'any': 'Any Level',
      'beginner': 'Beginner',
      'intermediate': 'Intermediate',
      'advanced': 'Advanced'
    };
    return levelMap[level] || 'Any Level';
  }

  async enrollInClass() {
    if (!this.classDetails) return;

    // If already enrolled
    if (this.classDetails.isEnrolled) {
      this.toast.create({
        message: 'You are already enrolled in this class',
        duration: 2000,
        color: 'primary'
      }).then(t => t.present());
      return;
    }

    // If they have a pending invitation, direct them to invitations
    if (this.classDetails.hasInvitation && this.classDetails.invitationStatus === 'pending') {
      this.toast.create({
        message: 'You have been invited to this class. Check your class invitations on the home page.',
        duration: 3000,
        color: 'warning'
      }).then(t => t.present());
      return;
    }

    // If they already declined the invitation
    if (this.classDetails.hasInvitation && this.classDetails.invitationStatus === 'declined') {
      this.toast.create({
        message: 'You previously declined this class invitation',
        duration: 2000,
        color: 'medium'
      }).then(t => t.present());
      return;
    }

    // If class is full
    if (this.classDetails.isFull) {
      this.toast.create({
        message: 'This class is full',
        duration: 2000,
        color: 'warning'
      }).then(t => t.present());
      return;
    }

    // For now, show message that enrollment needs to be implemented
    this.toast.create({
      message: 'Direct enrollment for public classes will be implemented soon. For now, ask the tutor for an invitation.',
      duration: 3000,
      color: 'primary'
    }).then(t => t.present());
  }

  messageTutor() {
    if (!this.classDetails?.tutorId?._id) return;
    this.router.navigate(['/tabs/messages'], {
      queryParams: { tutorId: this.classDetails.tutorId._id }
    });
  }

  viewTutorProfile() {
    if (!this.classDetails?.tutorId?._id) return;
    this.router.navigate(['/tutor', this.classDetails.tutorId._id]);
  }
}

