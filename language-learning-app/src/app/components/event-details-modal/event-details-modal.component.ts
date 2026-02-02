import { Component, Input, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { Router } from '@angular/router';
import { LessonService } from '../../services/lesson.service';
import { UserService } from '../../services/user.service';

interface EventDetails {
  id?: string;
  title?: string;
  subtitle?: string;
  start: Date;
  end: Date;
  durationMinutes: number;
  location?: string;
  avatarUrl?: string;
  isTrialLesson?: boolean;
  isClass?: boolean;
  isOfficeHours?: boolean;
  isCancelled?: boolean;
  isLesson?: boolean;
  attendees?: any[];
  capacity?: number;
  thumbnail?: string;
  color?: string;
  meta?: string;
  // Lesson-specific
  studentName?: string;
  studentDisplayName?: string;
  subject?: string;
  lessonId?: string;
  // Class-specific
  classId?: string;
  className?: string;
}

interface MenuPosition {
  top?: number;
  bottom?: number;
  left: number;
  showBelow: boolean;
  arrowOffset: number;
  maxHeight: number;
}

@Component({
  selector: 'app-event-details-modal',
  templateUrl: './event-details-modal.component.html',
  styleUrls: ['./event-details-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class EventDetailsModalComponent implements OnInit, OnDestroy {
  @Input() event!: EventDetails;
  @Input() clickEvent?: any; // The click event to position the menu
  
  position: MenuPosition | null = null;
  canJoin = false;
  joinLabel = 'Join';
  isLessonInProgress = false;

  constructor(
    private modalController: ModalController,
    private router: Router,
    private lessonService: LessonService,
    private userService: UserService
  ) {}

  ngOnInit() {
    console.log('Event details modal opened with event:', this.event);
    this.calculatePosition();
    this.updateJoinButton();
  }

  private updateJoinButton() {
    if (!this.event.lessonId && !this.event.classId) {
      return;
    }

    // Create a lesson-like object for the join logic
    const lessonLike = {
      _id: this.event.id,
      startTime: this.event.start,
      endTime: this.event.end,
      status: this.getLessonStatus(),
      tutorId: null, // Will be determined in join method
      studentId: null,
      isClass: this.event.isClass
    } as any;

    this.isLessonInProgress = this.checkIfLessonInProgress();
    this.canJoin = this.isLessonInProgress || this.lessonService.canJoinLesson(lessonLike);
    
    if (this.isLessonInProgress) {
      this.joinLabel = 'Join Now';
    } else if (this.canJoin) {
      this.joinLabel = 'Join';
    } else {
      const secs = this.lessonService.getTimeUntilJoin(lessonLike);
      this.joinLabel = `Join in ${this.lessonService.formatTimeUntil(secs)}`;
    }
  }

  private checkIfLessonInProgress(): boolean {
    if (!this.event.start || !this.event.end) return false;
    const now = new Date();
    const start = new Date(this.event.start);
    const end = new Date(this.event.end);
    return start <= now && end > now;
  }

  private getLessonStatus(): string {
    const now = new Date();
    if (this.event.start <= now && this.event.end > now) {
      return 'in_progress';
    }
    if (this.event.start > now) {
      return 'scheduled';
    }
    return 'completed';
  }

  formatStudentName(name: string): string {
    if (!name) return '';
    const parts = name.trim().split(' ').filter(p => p.length > 0);
    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts[parts.length - 1];
      const lastInitial = last.charAt(0).toUpperCase();
      return `${first} ${lastInitial}.`;
    }
    return name;
  }

  ngOnDestroy() {
    // Cleanup
  }

  @HostListener('window:resize')
  onResize() {
    this.calculatePosition();
  }

  private calculatePosition() {
    if (!this.clickEvent) {
      // Fallback: center on screen
      this.position = {
        left: window.innerWidth / 2 - 210,
        showBelow: true,
        arrowOffset: 210,
        maxHeight: 700
      };
      return;
    }

    const target = this.clickEvent.target?.closest('.calendar-event') || this.clickEvent.target;
    if (!target) {
      this.position = {
        left: window.innerWidth / 2 - 210,
        showBelow: true,
        arrowOffset: 210,
        maxHeight: 700
      };
      return;
    }

    const rect = target.getBoundingClientRect();
    const screenHeight = window.innerHeight;
    const screenWidth = window.innerWidth;
    const menuWidth = 420;
    const menuBaseHeight = 700;
    const paddingFromEdge = 20;
    const gapFromEvent = 8;

    // Calculate available space
    const spaceAbove = rect.top - paddingFromEdge;
    const spaceBelow = screenHeight - rect.bottom - paddingFromEdge;
    const spaceRight = screenWidth - rect.right;
    const spaceLeft = rect.left;

    // Determine if menu should show above or below
    const showBelow = spaceBelow >= 200 || (spaceBelow >= spaceAbove && spaceBelow >= 150);

    // Calculate menu height - use more of available space, allow up to 90vh
    const availableHeight = showBelow ? spaceBelow - gapFromEvent : spaceAbove - gapFromEvent;
    const maxAllowedHeight = Math.min(menuBaseHeight, window.innerHeight * 0.9);
    const menuHeight = Math.min(maxAllowedHeight, Math.max(500, availableHeight - 20));

    // Calculate vertical position
    let menuTop: number | undefined;
    let menuBottom: number | undefined;

    if (showBelow) {
      menuTop = rect.bottom + gapFromEvent;
      const maxTop = screenHeight - menuHeight - paddingFromEdge;
      if (menuTop !== undefined && menuTop > maxTop) {
        menuTop = maxTop;
      }
    } else {
      menuBottom = screenHeight - rect.top + gapFromEvent;
    }

    // Calculate horizontal position - prefer right side, fallback to left
    let menuLeft: number;
    let arrowOffset: number;

    if (spaceRight >= menuWidth + 20) {
      // Show to the right
      menuLeft = rect.right + gapFromEvent;
      arrowOffset = Math.min(20, rect.height / 2);
    } else if (spaceLeft >= menuWidth + 20) {
      // Show to the left
      menuLeft = rect.left - menuWidth - gapFromEvent;
      arrowOffset = menuWidth - Math.min(20, rect.height / 2);
    } else {
      // Center horizontally, show below/above
      menuLeft = Math.max(paddingFromEdge, Math.min(screenWidth - menuWidth - paddingFromEdge, rect.left + (rect.width / 2) - (menuWidth / 2)));
      arrowOffset = Math.min(menuWidth / 2, rect.width / 2);
    }

    this.position = {
      top: menuTop,
      bottom: menuBottom,
      left: menuLeft,
      showBelow,
      arrowOffset,
      maxHeight: menuHeight
    };
  }

  close() {
    this.modalController.dismiss();
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  formatDate(date: Date): string {
    const d = new Date(date);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (d.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (d.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    } else {
      return d.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    }
  }

  formatDuration(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} minutes`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    }
    return `${hours} hour${hours > 1 ? 's' : ''} ${mins} minute${mins > 1 ? 's' : ''}`;
  }

  async openFullDetails() {
    this.close();
    
    if (this.event.lessonId) {
      this.router.navigate(['/tabs/tutor-calendar/event', this.event.lessonId]);
    } else if (this.event.classId) {
      this.router.navigate(['/tabs/tutor-calendar/class', this.event.classId]);
    }
  }

  async joinLesson() {
    if (!this.event.lessonId && !this.event.classId) return;
    
    const currentUser = await this.userService.getCurrentUser().toPromise();
    if (!currentUser) return;

    const currentUserId = (currentUser as any)?._id || (currentUser as any)?.id;
    const isClass = this.event.isClass || false;
    
    // Determine role - for tutor calendar, user is always the tutor
    const role = 'tutor';
    
    const lessonId = this.event.lessonId || this.event.classId;
    
    this.close();
    
    // Navigate to pre-call page
    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: lessonId,
        role: role,
        lessonMode: 'true',
        isClass: isClass ? 'true' : 'false'
      }
    });
  }
}

