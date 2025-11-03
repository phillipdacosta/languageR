import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { LessonService, Lesson } from '../../services/lesson.service';
import { UserService, User } from '../../services/user.service';

@Component({
  selector: 'app-event-details',
  templateUrl: './event-details.page.html',
  styleUrls: ['./event-details.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class EventDetailsPage implements OnInit, OnDestroy {
  lessonId: string | null = null;
  lesson: Lesson | null = null;
  currentUser: User | null = null;
  loading = true;
  error: string | null = null;
  countdownTick = Date.now();
  private countdownInterval: any;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private lessonService: LessonService,
    private userService: UserService
  ) { }

  ngOnInit() {
    this.lessonId = this.route.snapshot.paramMap.get('id');
    
    // Load current user first
    this.userService.getCurrentUser().subscribe({
      next: (user) => {
        this.currentUser = user;
        if (this.lessonId) {
          this.loadLessonDetails();
        } else {
          this.error = 'No lesson ID provided';
          this.loading = false;
        }
      },
      error: () => {
        // Continue even if user load fails
        if (this.lessonId) {
          this.loadLessonDetails();
        } else {
          this.error = 'No lesson ID provided';
          this.loading = false;
        }
      }
    });
  }

  loadLessonDetails() {
    if (!this.lessonId) return;

    this.loading = true;
    this.lessonService.getLesson(this.lessonId).subscribe({
      next: (response) => {
        if (response.success && response.lesson) {
          this.lesson = response.lesson;
          this.loading = false;
          this.startCountdown();
        } else {
          this.error = 'Lesson not found';
          this.loading = false;
        }
      },
      error: (error) => {
        console.error('Error loading lesson:', error);
        this.error = 'Failed to load lesson details';
        this.loading = false;
      }
    });
  }

  startCountdown() {
    // Update countdown every minute
    this.countdownInterval = setInterval(() => {
      this.countdownTick = Date.now();
    }, 60000);
  }

  ngOnDestroy() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
  }

  goBack() {
    this.router.navigate(['/tabs/tutor-calendar']);
  }

  getStatusInfo(): { label: string; color: string } {
    if (!this.lesson) {
      return { label: 'Unknown', color: '#6b7280' };
    }

    // If lesson is cancelled, always show cancelled
    if (this.lesson.status === 'cancelled') {
      return { label: 'Cancelled', color: '#ef4444' };
    }

    // Determine status based on current time vs lesson time
    const now = new Date();
    const startTime = new Date(this.lesson.startTime);
    const endTime = new Date(this.lesson.endTime);

    // Check if lesson is happening now (within start and end time)
    if (now >= startTime && now <= endTime) {
      return { label: 'In Progress', color: '#10b981' };
    }

    // Check if lesson is in the past
    if (now > endTime) {
      return { label: 'Completed', color: '#6b7280' };
    }

    // Lesson is in the future
    return { label: 'Upcoming', color: '#667eea' };
  }

  canJoinLesson(): boolean {
    if (!this.lesson || !this.currentUser) return false;
    
    // Check if lesson is in progress or can be joined
    const now = new Date();
    const startTime = new Date(this.lesson.startTime);
    const endTime = new Date(this.lesson.endTime);
    
    // Can join if lesson is happening now (within time window)
    if (now >= startTime && now <= endTime) {
      return true;
    }
    
    // Also check using lesson service helper (includes 15 min early window)
    return this.lessonService.canJoinLesson(this.lesson);
  }

  shouldShowJoinButton(): boolean {
    if (!this.lesson || !this.currentUser) return false;
    
    // Show join button if lesson is upcoming or in progress
    const status = this.getStatusInfo();
    return status.label === 'Upcoming' || status.label === 'In Progress';
  }

  getJoinLabel(): string {
    if (!this.lesson) return 'Join';
    
    // Reference countdownTick to trigger change detection
    void this.countdownTick;
    
    // Check if lesson is in progress
    const now = new Date();
    const startTime = new Date(this.lesson.startTime);
    const endTime = new Date(this.lesson.endTime);
    
    if (now >= startTime && now <= endTime) {
      return 'Join';
    }
    
    // Check if we can join now (within 15 min window)
    if (this.lessonService.canJoinLesson(this.lesson)) {
      return 'Join';
    }
    
    // Otherwise show countdown
    const secs = this.lessonService.getTimeUntilJoin(this.lesson);
    const timeStr = this.lessonService.formatTimeUntil(secs);
    
    // If time is "Now" or <= 0 but we can't join, check if it's because of status
    if (timeStr === 'Now' || secs <= 0) {
      // If within the time window but status prevents joining, show appropriate message
      const earliestJoin = new Date(startTime.getTime() - 15 * 60000);
      const latestJoin = new Date(endTime.getTime() + 5 * 60000);
      if (now >= earliestJoin && now <= latestJoin) {
        // We're in the time window, so if canJoinLesson is false, it's a status issue
        return 'Join'; // Show "Join" but button will be disabled due to status
      }
    }
    
    return `Join in ${timeStr}`;
  }

  async joinLesson() {
    if (!this.lesson || !this.currentUser) return;
    
    // Determine user role
    const role = this.lesson.tutorId._id === this.currentUser.id ? 'tutor' : 'student';
    
    // Navigate to pre-call page
    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: this.lesson._id,
        role,
        lessonMode: 'true'
      }
    });
  }

  getUserRole(): 'tutor' | 'student' {
    if (!this.lesson || !this.currentUser) return 'student';
    return this.lesson.tutorId._id === this.currentUser.id ? 'tutor' : 'student';
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const month = date.toLocaleDateString('en-US', { month: 'long' });
    const day = date.getDate();
    const year = date.getFullYear();
    
    // Get ordinal suffix (st, nd, rd, th)
    const getOrdinalSuffix = (d: number): string => {
      if (d > 3 && d < 21) return 'th';
      switch (d % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
      }
    };
    
    return `${month} ${day}${getOrdinalSuffix(day)}, ${year}`;
  }

  formatTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

