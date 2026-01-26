import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-payment-dispute-modal',
  templateUrl: './payment-dispute-modal.component.html',
  styleUrls: ['./payment-dispute-modal.component.scss'],
  standalone: false
})
export class PaymentDisputeModalComponent implements OnInit {
  @Input() notification: any; // The notification object with investigation data
  
  // Lesson details for display
  lessonDetails: any = null;
  
  // Form fields
  disputeMessage: string = '';
  isSubmitting: boolean = false;
  
  constructor(
    private modalController: ModalController,
    private http: HttpClient
  ) {}
  
  ngOnInit() {
    console.log('💼 Dispute modal opened with notification:', this.notification);
    console.log('💼 Notification data:', this.notification?.data);
    
    // Initialize lessonDetails immediately from notification data
    // This ensures we show data right away, even while loading full lesson details
    const scheduledAt = this.notification?.data?.scheduledAt || new Date();
    this.lessonDetails = {
      studentId: {
        name: this.notification?.data?.studentName || 'Student',
        picture: null
      },
      tutorId: {
        name: this.notification?.data?.tutorName || 'Tutor',
        picture: null
      },
      scheduledAt: scheduledAt,
      startTime: scheduledAt, // Use scheduledAt as startTime fallback
      endTime: null // Will be loaded from API if available
    };
    
    console.log('💼 Initial lessonDetails from notification:', this.lessonDetails);
    
    // Also try to load full lesson details for avatars and additional info
    if (this.notification?.data?.lessonId) {
      this.loadLessonDetails();
    }
  }
  
  loadLessonDetails() {
    const lessonId = this.notification.data.lessonId;
    const token = localStorage.getItem('token');
    
    this.http.get(`${environment.backendUrl}/api/lessons/${lessonId}`, {
      headers: { Authorization: `Bearer ${token}` }
    }).subscribe({
      next: (response: any) => {
        if (response.success && response.lesson) {
          // Merge loaded lesson data with notification data (prefer loaded data for avatars)
          this.lessonDetails = {
            ...response.lesson,
            studentId: {
              ...response.lesson.studentId,
              name: response.lesson.studentId?.name || this.notification?.data?.studentName || 'Student'
            },
            tutorId: {
              ...response.lesson.tutorId,
              name: response.lesson.tutorId?.name || this.notification?.data?.tutorName || 'Tutor'
            },
            scheduledAt: response.lesson.scheduledAt || this.notification?.data?.scheduledAt || new Date()
          };
          console.log('✅ Lesson details loaded and merged:', this.lessonDetails);
        }
      },
      error: (error) => {
        console.error('❌ Error loading lesson details:', error);
        // Keep the initial data from notification
        console.log('Using notification data (lesson load failed)');
      }
    });
  }
  
  dismiss() {
    this.modalController.dismiss();
  }
  
  submitDispute() {
    if (!this.disputeMessage.trim()) {
      return;
    }
    
    this.isSubmitting = true;
    const token = localStorage.getItem('token');
    
    const disputeData = {
      notificationId: this.notification._id,
      lessonId: this.notification.data.lessonId,
      message: this.disputeMessage,
      originalAmount: this.notification.data.amount || this.notification.data.originalAmount,
      reason: this.notification.data.reason
    };
    
    this.http.post(`${environment.backendUrl}/api/disputes/create`, disputeData, {
      headers: { Authorization: `Bearer ${token}` }
    }).subscribe({
      next: (response: any) => {
        console.log('✅ Dispute submitted:', response);
        this.modalController.dismiss({ disputed: true });
      },
      error: (error) => {
        console.error('❌ Error submitting dispute:', error);
        this.isSubmitting = false;
      }
    });
  }
  
  // Format name as "First L." (First name + Last initial)
  formatDisplayName(nameOrObject: any): string {
    if (!nameOrObject) return 'Unknown';
    
    // Handle if it's an object with firstName/lastName
    if (typeof nameOrObject === 'object') {
      const firstName = nameOrObject.firstName || nameOrObject.name?.split(' ')[0];
      const lastName = nameOrObject.lastName || nameOrObject.name?.split(' ').slice(1).join(' ');
      
      if (firstName && lastName) {
        return `${this.capitalize(firstName)} ${lastName.charAt(0).toUpperCase()}.`;
      } else if (firstName) {
        return this.capitalize(firstName);
      }
      
      // Fall back to name field
      const rawName = nameOrObject.name || nameOrObject.email;
      if (rawName) {
        return this.formatDisplayName(rawName); // Recursively handle string
      }
      return 'Unknown';
    }
    
    // Handle if it's a string
    const name = String(nameOrObject).trim();
    if (!name) return 'Unknown';
    
    // If it's an email, extract name part
    if (name.includes('@')) {
      const base = name.split('@')[0];
      const parts = base.split(/[.\s_]+/).filter(Boolean);
      const first = parts[0];
      const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : '';
      return lastInitial
        ? `${this.capitalize(first)} ${lastInitial.toUpperCase()}.`
        : this.capitalize(first);
    }
    
    // Split by spaces
    const parts = name.split(' ').filter(Boolean);
    if (parts.length === 1) {
      return this.capitalize(parts[0]);
    }
    
    const first = this.capitalize(parts[0]);
    const last = parts[parts.length - 1];
    const lastInitial = last ? last[0].toUpperCase() : '';
    return lastInitial ? `${first} ${lastInitial}.` : first;
  }
  
  private capitalize(value: string): string {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }
  
  formatDate(date: string | Date): string {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }
  
  formatLessonDateTime(): string {
    const startTime = this.lessonDetails?.startTime || 
                     this.lessonDetails?.scheduledAt || 
                     this.notification?.data?.scheduledAt;
    
    if (!startTime) return 'Date not available';
    
    const start = new Date(startTime);
    const endTime = this.lessonDetails?.endTime;
    const end = endTime ? new Date(endTime) : null;
    
    // Format date
    const dateStr = start.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    
    // Format start time
    const startTimeStr = start.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    // Format end time if available
    if (end) {
      const endTimeStr = end.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      return `${dateStr}, ${startTimeStr} - ${endTimeStr}`;
    }
    
    return `${dateStr}, ${startTimeStr}`;
  }
  
  getAdminNotes(): string {
    return this.notification?.data?.reason || 'No additional details provided.';
  }
  
  getStudentName(): string {
    const studentObj = this.lessonDetails?.studentId;
    const studentName = studentObj?.name || 
                       this.notification?.data?.studentName || 
                       'Student';
    
    // If it's an object, use it directly; if it's a string, format it
    return this.formatDisplayName(studentObj || studentName);
  }
  
  getStudentAvatar(): string {
    return this.lessonDetails?.studentId?.picture || 
           'assets/default-avatar.png';
  }
  
  getTutorName(): string {
    const tutorObj = this.lessonDetails?.tutorId;
    const tutorName = tutorObj?.name || 
                     this.notification?.data?.tutorName || 
                     'Tutor';
    
    // If it's an object, use it directly; if it's a string, format it
    return this.formatDisplayName(tutorObj || tutorName);
  }
  
  getTutorAvatar(): string {
    return this.lessonDetails?.tutorId?.picture || 
           'assets/default-avatar.png';
  }
  
  getLessonDate(): string {
    return this.formatLessonDateTime();
  }
}
