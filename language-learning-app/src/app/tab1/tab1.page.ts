import { Component, OnInit, OnDestroy } from '@angular/core';
import { ModalController, LoadingController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { TutorSearchPage } from '../tutor-search/tutor-search.page';
import { PlatformService } from '../services/platform.service';
import { AuthService } from '../services/auth.service';
import { UserService, User } from '../services/user.service';
import { Observable, takeUntil } from 'rxjs';
import { Subject } from 'rxjs';
import { LessonService, Lesson } from '../services/lesson.service';
import { AgoraService } from '../services/agora.service';
import { WebSocketService } from '../services/websocket.service';
import { NotificationService } from '../services/notification.service';
import { MessagingService } from '../services/messaging.service';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  standalone: false,
})
export class Tab1Page implements OnInit, OnDestroy {
  // Platform detection properties
  private destroy$ = new Subject<void>();

  currentPlatform = 'unknown';
  platformConfig: any = {};
  isWeb = false;
  isMobile = false;
  currentUser: User | null = null;
  lessons: Lesson[] = [];
  pastLessons: Lesson[] = [];
  pastTutors: Array<{ id: string; name: string; picture?: string }> = [];
  isLoadingLessons = false;
  availabilityBlocks: any[] = [];
  availabilityHeadline = '';
  availabilityDetail = '';
  isSelectedDatePast = false;
  
  // UI state
  hasNotifications = false;
  unreadNotificationCount = 0;
  
  // Cached profile picture to avoid repeated evaluations
  private _currentUserPicture: string = 'assets/avatar.png';
  private _avatarCache = new Map<string, string>();
  
  // Tutor date strip and upcoming lesson
  dateStrip: { label: string; dayNum: number; date: Date; isToday: boolean }[] = [];
  selectedDate: Date | null = null;
  weekStartDate: Date = new Date();
  weekRangeLabel = '';
  upcomingLesson: Lesson | null = null;
  private countdownInterval: any;
  countdownTick = Date.now();
  private statusInterval: any;
  private lastLabelUpdateTime = 0; // Track last time labels were updated
  
  // Tutor-specific insights
  totalStudents = 0;
  lessonsThisWeek = 0;
  tutorRating = '0.0';
  unreadMessages = 0;
  
  // Cache of current students array for efficient label updates
  private currentStudents: any[] = [];
  private cachedStudentsForDate: any[] = [];
  private cachedStudentsDate: Date | null = null;
  private cachedStudentsLessonsHash: string = '';
  
  // Featured tutors for students (mock data - replace with real data)
  featuredTutors: any[] = [];

  // Lesson presence tracking: lessonId -> presence data
  lessonPresence: Map<string, {
    participantName: string;
    participantPicture?: string;
    participantRole: 'tutor' | 'student';
    joinedAt: string;
  }> = new Map();

  private resizeListener: any;

  constructor(
    private modalCtrl: ModalController, 
    public router: Router,
    public platformService: PlatformService,
    private authService: AuthService,
    private userService: UserService,
    private lessonService: LessonService,
    private agoraService: AgoraService,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private websocketService: WebSocketService,
    private notificationService: NotificationService,
    private messagingService: MessagingService
  ) {
    // Get database user data instead of Auth0 data
    this.userService.getCurrentUser()
    .pipe(takeUntil(this.destroy$))
    .subscribe(user => {
      this.currentUser = user;
      // Load notification count when user is available
      if (user) {
        setTimeout(() => {
          this.loadUnreadNotificationCount();
        }, 500);
      }
        
        // Cache profile picture to avoid repeated evaluations
        this._currentUserPicture = user?.picture || 'assets/avatar.png';
        
        // Load lessons as soon as we have the current user
        this.loadLessons();
        
        // Load tutor-specific data
        if (this.isTutor()) {
          this.loadTutorInsights();
          this.loadAvailability();
        }
      });
    
    // Subscribe to unread message count
    this.messagingService.unreadCount$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(count => {
      this.unreadMessages = count;
    });
    
    // Subscribe to currentUser$ to get updates when picture changes
    this.userService.currentUser$.pipe(
      takeUntil(this.destroy$)
    ).subscribe((updatedUser: any) => {
      if (updatedUser && updatedUser['id'] === this.currentUser?.['id']) {
        console.log('🔄 Tab1Page: Received currentUser$ update:', {
          picture: updatedUser?.picture,
          hasPicture: !!updatedUser?.picture
        });
        this.currentUser = updatedUser;
        this._currentUserPicture = updatedUser?.picture || 'assets/avatar.png';
      }
    });
  }

  ngOnInit() {
    // Load user data and stats
    this.loadUserStats();

    const today = this.startOfDay(new Date());
    this.selectedDate = today;
    this.weekStartDate = this.getStartOfWeek(today);

    // Get platform information
    this.currentPlatform = this.platformService.getPlatform();
    this.platformConfig = this.platformService.getPlatformConfig();
    this.isWeb = this.platformService.isWeb();
    this.isMobile = this.platformService.isMobile();
    const initialStart = this.getStripStartForDate(today);
    this.updateDateStrip(initialStart, false);

    // Add window resize listener for reactive viewport detection
    this.resizeListener = () => {
      const prevIsMobile = this.isMobile;
      this.isWeb = this.platformService.isWeb();
      this.isMobile = this.platformService.isMobile();
      if (prevIsMobile !== this.isMobile) {
        const referenceDate = this.selectedDate ?? this.startOfDay(new Date());
        const newStart = this.getStripStartForDate(referenceDate);
        this.updateDateStrip(newStart, false);
      }
    };
    window.addEventListener('resize', this.resizeListener);

    // Listen for lesson-left events to immediately refresh status
    window.addEventListener('lesson-left' as any, (e: any) => {
      const leftLessonId = e?.detail?.lessonId;
      if (this.upcomingLesson && this.upcomingLesson._id === leftLessonId) {
        this.lessonService.getLessonStatus(this.upcomingLesson._id).subscribe(status => {
          if (status?.success) {
            (this.upcomingLesson as any).status = status.lesson?.status || (this.upcomingLesson as any).status;
            (this.upcomingLesson as any).participant = status.participant;
          }
        });
      }
    });

    // Listen for WebSocket notifications
    this.websocketService.connect();
    this.websocketService.newNotification$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      // Reload notification count when a new notification arrives (only if user is authenticated)
      if (this.currentUser) {
        this.loadUnreadNotificationCount();
      }
    });


    // Live countdown tick (updates change detection)
    // Only update when minutes change to prevent flashing
    this.countdownInterval = setInterval(() => {
      const now = Date.now();
      const currentMinute = Math.floor(now / 60000); // Get current minute
      const lastMinute = Math.floor(this.lastLabelUpdateTime / 60000);
      
      // Only update if minute has changed or it's the first update
      if (currentMinute !== lastMinute || this.lastLabelUpdateTime === 0) {
        this.lastLabelUpdateTime = now;
        // Update join labels for all displayed students
        this.updateStudentJoinLabels();
        // Update countdownTick after labels are updated to trigger single change detection
        // This also triggers the isNextClassInProgress() check for the badge
        this.countdownTick = now;
      }
    }, 5000); // Check every 5s, but only update when minute changes
    
    // Poll lesson status periodically to reflect In Progress/Rejoin
    this.statusInterval = setInterval(() => {
      if (this.upcomingLesson) {
        this.lessonService.getLessonStatus(this.upcomingLesson._id).subscribe(status => {
          if (status?.success && this.upcomingLesson) {
            (this.upcomingLesson as any).serverTime = status.serverTime;
            (this.upcomingLesson as any).status = status.lesson?.status || this.upcomingLesson.status;
            (this.upcomingLesson as any).participant = status.participant;
          }
        });
      }
    }, 30000);

    // Load featured tutors for students
    if (this.isStudent()) {
      this.loadFeaturedTutors();
    }

    // Connect to WebSocket and listen for lesson presence
    this.websocketService.connect();
    
    this.websocketService.lessonPresence$
      .pipe(takeUntil(this.destroy$))
      .subscribe(presence => {
        const normalizedLessonId = String(presence.lessonId);
        this.lessonPresence.set(normalizedLessonId, {
          participantName: presence.participantName,
          participantPicture: presence.participantPicture,
          participantRole: presence.participantRole,
          joinedAt: presence.joinedAt
        });
        // Force change detection
        this.countdownTick = Date.now();
      });
    
    // Listen for participant left events
    this.websocketService.lessonPresenceLeft$
      .pipe(takeUntil(this.destroy$))
      .subscribe(presence => {
        const normalizedLessonId = String(presence.lessonId);
        this.lessonPresence.delete(normalizedLessonId);
        // Force change detection
        this.countdownTick = Date.now();
      });
  }

  ionViewWillEnter() {
    // Refresh presence data when returning to the home page
    // This ensures we see updated presence if someone joined while we were away
    if (this.lessons.length > 0) {
      this.checkExistingPresence();
    }
    // Reload notification count when returning to the page (important for page refresh)
    if (this.currentUser) {
      this.loadUnreadNotificationCount();
    }
  }

  loadUnreadNotificationCount() {
    // Only load if user is authenticated
    if (!this.currentUser) {
      return;
    }

    this.notificationService.getUnreadCount().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        if (response.success) {
          this.unreadNotificationCount = response.count;
          this.hasNotifications = this.unreadNotificationCount > 0;
        }
      },
      error: (error) => {
        console.error('Error loading unread notification count:', error);
      }
    });
  }

  ngOnDestroy() {
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  async openSearchTutors() {
      this.router.navigate(['/tabs/tutor-search']);
  }

  openAvailabilitySetup() {
    if (!this.isTutor()) {
      return;
    }
    // Navigate to single day availability setup with the selected date
    if (this.selectedDate) {
      const dateStr = this.selectedDate.toISOString().split('T')[0]; // YYYY-MM-DD format
      this.router.navigate(['/tabs/availability-setup', dateStr]);
    } else {
      // Fallback to regular availability setup if no date selected
      this.router.navigate(['/tabs/availability-setup']);
    }
  }

  loadUserStats() {
    this.userService.getCurrentUser().subscribe(user => {
    });
  }

  // New method: Load tutor insights
  loadTutorInsights() {
    // TODO: Replace with actual API call to get tutor statistics
    // For now, calculate from lessons
    const uniqueStudents = new Set(
      this.lessons
        .filter(l => l.studentId && typeof l.studentId === 'object')
        .map(l => (l.studentId as any)._id)
    );
    this.totalStudents = uniqueStudents.size;

    // Count lessons this week
    const now = new Date();
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    const endOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 7));
    
    this.lessonsThisWeek = this.lessons.filter(l => {
      const lessonDate = new Date(l.startTime);
      return lessonDate >= startOfWeek && lessonDate <= endOfWeek;
    }).length;

    // Get tutor rating from user profile or calculate from reviews
    // Note: Rating might not be in User type yet, so we safely access it
    const userAny = this.currentUser as any;
    this.tutorRating = userAny?.rating ? userAny.rating.toFixed(1) : '0.0';
  }

  // New method: Load featured tutors for students
  loadFeaturedTutors() {
    // TODO: Replace with actual API call to get featured tutors
    // Mock data for now
    this.featuredTutors = [
      { 
        id: '1', 
        name: 'Maria Garcia', 
        rating: 4.9, 
        specialty: 'Spanish Native Speaker',
        profilePicture: 'assets/avatar.png' 
      },
      { 
        id: '2', 
        name: 'John Smith', 
        rating: 4.7, 
        specialty: 'English Business Expert',
        profilePicture: 'assets/avatar.png' 
      },
      { 
        id: '3', 
        name: 'Sophie Chen', 
        rating: 4.8, 
        specialty: 'Mandarin Teacher',
        profilePicture: 'assets/avatar.png' 
      },
    ];
  }

  // Helper method to get the next upcoming lesson across all dates
  getNextLesson(): Lesson | null {
    const now = new Date();
    const upcoming = this.lessons
      .filter(l => {
        const start = new Date(l.startTime);
        return start > now && (l.status === 'scheduled' || l.status === 'in_progress');
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    return upcoming.length > 0 ? upcoming[0] : null;
  }

  // Format lesson time for display
  formatLessonTime(lesson: Lesson): string {
    const start = new Date(lesson.startTime);
    const end = new Date(lesson.endTime);
    
    const dateStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const startTime = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const endTime = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    
    return `${dateStr}, ${startTime} - ${endTime}`;
  }

  // Format subject to show language (e.g., "Spanish" -> "Spanish Student")
  formatSubject(subject: string): string {
    if (!subject || subject === 'Language Lesson') {
      return 'Language Student';
    }
    // Extract language name from subject (remove "Lesson" if present)
    const language = subject.replace(/ Lesson$/i, '').trim();
    return `${language} Student`;
  }

  // New method: Get students for selected date (tutor view)
  getStudentsForDate(): any[] {
    if (!this.selectedDate) {
      this.cachedStudentsForDate = [];
      return [];
    }
    
    // Check if we can use cached result
    const dateChanged = !this.cachedStudentsDate || 
      this.cachedStudentsDate.getTime() !== this.selectedDate.getTime();
    
    // Create a simple hash of lesson IDs to detect changes
    const lessonsForDate = this.lessonsForSelectedDate();
    const lessonsHash = lessonsForDate.map(l => String(l._id)).sort().join(',');
    const lessonsChanged = this.cachedStudentsLessonsHash !== lessonsHash;
    
    // Use cached result if date and lessons haven't changed
    if (!dateChanged && !lessonsChanged && this.cachedStudentsForDate.length > 0) {
      return this.cachedStudentsForDate;
    }
    
    // Update cache keys
    this.cachedStudentsDate = new Date(this.selectedDate);
    this.cachedStudentsLessonsHash = lessonsHash;
    
    const now = new Date();
    
    // Group lessons by student and find the earliest lesson for each student
    const studentLessonMap = new Map<string, { student: any; lesson: Lesson; isNext: boolean }>();
    
    // First pass: find the earliest lesson for each student, and handle classes
    lessonsForDate.forEach(l => {
      // Handle classes (they don't have a studentId)
      if ((l as any).isClass) {
        const classId = String(l._id);
        studentLessonMap.set(`class_${classId}`, {
          student: {
            id: classId,
            name: (l as any).className || l.subject || 'Class',
            profilePicture: 'assets/avatar.png', // Use default avatar for classes
            email: '',
            rating: 0,
            isClass: true
          },
          lesson: l,
          isNext: false // Will be set correctly below
        });
      }
      // Handle regular lessons with students
      else if (l.studentId && typeof l.studentId === 'object') {
        const studentId = (l.studentId as any)._id;
        const existing = studentLessonMap.get(studentId);
        
        // If no existing entry, or this lesson is earlier, use this lesson
        if (!existing || new Date(l.startTime) < new Date(existing.lesson.startTime)) {
          studentLessonMap.set(studentId, {
            student: {
              id: studentId,
              name: (l.studentId as any).name || (l.studentId as any).email,
              profilePicture: (l.studentId as any).picture || (l.studentId as any).profilePicture || 'assets/avatar.png',
              email: (l.studentId as any).email,
              rating: (l.studentId as any).rating || 4.5,
            },
            lesson: l,
            isNext: false // Will be set correctly below
          });
        }
      }
    });
    
    // Second pass: find the earliest upcoming lesson ACROSS ALL DATES and mark it as "next"
    // Get ALL upcoming lessons (not just for this date)
    const allUpcomingLessons = this.lessons
      .filter(l => {
        if (l.status !== 'scheduled' && l.status !== 'in_progress') return false;
        const startTime = new Date(l.startTime);
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        // Include lessons that are upcoming or started within the last hour (still active)
        return startTime >= oneHourAgo;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    // Get the very next lesson ID (the earliest upcoming lesson across all dates)
    const nextLessonId = allUpcomingLessons.length > 0 ? String(allUpcomingLessons[0]._id) : null;
    
    // Mark the lesson as "next" if it matches the next lesson ID
    if (nextLessonId) {
      studentLessonMap.forEach((entry) => {
        if (String(entry.lesson._id) === nextLessonId) {
          entry.isNext = true;
        }
      });
    }
    
    // Convert map to array and calculate join labels
    const students = Array.from(studentLessonMap.values()).map(({ student, lesson, isNext }) => {
      const currentLessonId = String(lesson._id);
      
      // Pre-calculate join label to prevent flashing
      const joinLabel = this.calculateJoinLabel(lesson);
      
      return {
        ...student,
        lessonId: String(lesson._id), // Convert to string to match backend format
        lesson: lesson, // Include full lesson object for join functionality
        lessonTime: this.formatLessonTime(lesson),
        subject: this.formatSubject(lesson.subject),
        isNextClass: isNext,
        startTime: lesson.startTime, // Keep for sorting if needed
        joinLabel: joinLabel // Pre-calculated label
      };
    });
    
    
    // Sort by lesson time
    students.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    // Cache students array for efficient label updates
    this.currentStudents = students;
    this.cachedStudentsForDate = students; // Cache for template reuse
    
    // Enrich profile pictures from latest user data (fetch by email)
    students.forEach(s => {
      if (!s.profilePicture || s.profilePicture === 'assets/avatar.png') {
        if (s.email) {
          this.userService.getUserByEmail(s.email).subscribe(u => {
            if (u && u.picture) {
              s.profilePicture = u.picture;
            }
          });
        }
      }
    });
    
    return students;
  }

  // Get the next class student (the one with isNextClass: true)
  getNextClassStudent(): any | null {
    const students = this.getStudentsForDate();
    return students.find(s => s.isNextClass) || null;
  }

  // Check if the next class is currently in progress
  isNextClassInProgress(): boolean {
    const nextClassStudent = this.getNextClassStudent();
    if (!nextClassStudent || !nextClassStudent.lesson) {
      return false;
    }
    
    const lesson = nextClassStudent.lesson;
    const now = new Date();
    const startTime = new Date(lesson.startTime);
    const endTime = new Date(lesson.endTime);
    
    // Check if lesson status is in_progress OR if current time is between start and end
    return lesson.status === 'in_progress' || (now >= startTime && now <= endTime);
  }

  // Get students for date excluding the next class one
  getOtherStudentsForDate(): any[] {
    const students = this.getStudentsForDate();
    return students.filter(s => !s.isNextClass);
  }

  // Get first lesson for the selected date
  getFirstLessonForSelectedDate(): any | null {
    if (!this.selectedDate) {
      return null;
    }
    
    const now = new Date();
    const today = this.startOfDay(new Date());
    const selectedDay = this.startOfDay(this.selectedDate);
    const isToday = selectedDay.getTime() === today.getTime();
    
    // Get all lessons for the selected date
    const lessonsForDate = this.lessonsForSelectedDate();
    
    // Filter for upcoming/active lessons
    const activeLessons = lessonsForDate.filter(l => {
      if (l.status !== 'scheduled' && l.status !== 'in_progress') return false;
      const startTime = new Date(l.startTime);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      // Include lessons that are upcoming or started within the last hour (still active)
      return startTime >= oneHourAgo;
    }).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    if (activeLessons.length === 0) {
      return null;
    }
    
    const firstLesson = activeLessons[0];
    
    // Check if this is the actual next class across ALL dates
    const allUpcomingLessons = this.lessons
      .filter(l => {
        if (l.status !== 'scheduled' && l.status !== 'in_progress') return false;
        const startTime = new Date(l.startTime);
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        return startTime >= oneHourAgo;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    const isNextClass = allUpcomingLessons.length > 0 && String(allUpcomingLessons[0]._id) === String(firstLesson._id);
    
    // Handle both classes and regular lessons
    let student: any = null;
    if ((firstLesson as any).isClass) {
      // For classes, show class info
      student = {
        id: String(firstLesson._id),
        name: (firstLesson as any).className || firstLesson.subject || 'Class',
        profilePicture: 'assets/avatar.png',
        email: '',
        rating: 0,
        isClass: true
      };
    } else if (firstLesson.studentId && typeof firstLesson.studentId === 'object') {
      // For regular lessons, show student info
      student = {
        id: (firstLesson.studentId as any)._id,
        name: (firstLesson.studentId as any).name || (firstLesson.studentId as any).email,
        profilePicture: (firstLesson.studentId as any).picture || (firstLesson.studentId as any).profilePicture || 'assets/avatar.png',
        email: (firstLesson.studentId as any).email,
        rating: (firstLesson.studentId as any).rating || 4.5,
      };
    }
    
    const lessonDate = new Date(firstLesson.startTime);
    const dateTag = this.getDateTag(lessonDate);
    const isInProgress = this.isLessonInProgress(firstLesson);
    
    return {
      ...student,
      lessonId: String(firstLesson._id),
      lesson: firstLesson,
      lessonTime: this.formatLessonTime(firstLesson),
      subject: this.formatSubject(firstLesson.subject),
      dateTag: dateTag,
      isToday: isToday,
      isNextClass: isNextClass,
      isInProgress: isInProgress,
      startTime: firstLesson.startTime,
      joinLabel: this.calculateJoinLabel(firstLesson)
    };
  }

  // Get date tag for featured lessons
  getDateTag(date: Date): string {
    const lessonDate = this.startOfDay(date);
    const today = this.startOfDay(new Date());
    const tomorrow = this.startOfDay(new Date());
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (lessonDate.getTime() === today.getTime()) {
      return 'TODAY';
    } else if (lessonDate.getTime() === tomorrow.getTime()) {
      return 'TOMORROW';
    } else {
      // Format as "Mon. Nov 17"
      return date.toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      }).replace(',', '.');
    }
  }

  // Check if there are any completed/past lessons for the selected date
  hasPastLessonsForDate(): boolean {
    if (!this.selectedDate) {
      return false;
    }
    
    const lessonsForDate = this.lessonsForSelectedDate();
    const now = new Date();
    
    // Check if there are any completed lessons OR lessons that ended in the past
    return lessonsForDate.some(lesson => {
      if (lesson.status === 'completed') {
        return true;
      }
      
      // Check if lesson has ended (end time is in the past)
      const endTime = new Date(lesson.endTime);
      return endTime < now;
    });
  }

  // New method: Get upcoming lessons (all future lessons)
  getUpcomingLessons(): Lesson[] {
    return this.lessons;
  }

  // Track by function for tutors
  trackByTutorId(index: number, tutor: { id: string; name: string; picture?: string }): string {
    return tutor.id;
  }

  // Get timeline events for "Coming Up Next" section
  getTimelineEvents() {
    const upcomingLessons = this.getUpcomingLessons();
    const now = new Date();
    
    // Get next 3 upcoming lessons
    return upcomingLessons
      .filter(lesson => new Date(lesson.startTime) > now)
      .slice(0, 3)
      .map(lesson => {
        const startTime = new Date(lesson.startTime);
        const student = lesson.studentId as any;
        
        return {
          time: this.formatTimeOnly(startTime),
          date: this.formatRelativeDate(startTime),
          name: student?.name || 'Student',
          subject: this.formatSubject(lesson.subject),
          avatar: student?.picture || student?.profilePicture || 'assets/avatar.png',
          lesson: lesson
        };
      });
  }

  hasMoreTimelineEvents(): boolean {
    const upcomingLessons = this.getUpcomingLessons();
    const now = new Date();
    const futureLessons = upcomingLessons.filter(lesson => new Date(lesson.startTime) > now);
    return futureLessons.length > 3;
  }

  navigateToLessons() {
    this.router.navigate(['/lessons']);
  }

  // Format time only (e.g., "2:00 PM")
  formatTimeOnly(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  // Format relative date (e.g., "Today", "Tomorrow", "Wed, Nov 15")
  formatRelativeDate(date: Date): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    const diffDays = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    
    // For other dates, show day and date (e.g., "Wed, Nov 15")
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  // Navigate to lesson details or join
  navigateToLesson(lesson: Lesson) {
    // For now, we could navigate to the call page if it's time to join
    // Or show lesson details. Let's make it joinable if within time window
    const now = new Date();
    const startTime = new Date(lesson.startTime);
    const canJoin = this.canJoinLessonByTime(startTime);
    
    if (canJoin) {
      this.joinLessonById(lesson._id);
    }
  }

  // Helper to join lesson by ID
  async joinLessonById(lessonId: string) {
    const loading = await this.loadingController.create({
      message: 'Joining lesson...',
    });
    await loading.present();

    this.lessonService.joinLesson(lessonId, 'tutor', this.currentUser?.['id']).subscribe({
      next: async (response) => {
        await loading.dismiss();
        
        if (response.success) {
          // Navigate to call page with lesson data
          this.router.navigate(['/call'], {
            state: {
              agora: response.agora,
              lesson: response.lesson,
              role: 'tutor'
            }
          });
        }
      },
      error: async (error) => {
        await loading.dismiss();
        console.error('Error joining lesson:', error);
        
        const toast = await this.toastController.create({
          message: error.error?.message || 'Failed to join lesson',
          duration: 3000,
          color: 'danger'
        });
        toast.present();
      }
    });
  }

  // Check if lesson can be joined based on time
  canJoinLessonByTime(startTime: Date): boolean {
    const now = new Date();
    const timeDiff = startTime.getTime() - now.getTime();
    const minutesDiff = timeDiff / (1000 * 60);
    
    // Can join 15 minutes before or anytime after start
    return minutesDiff <= 15 && minutesDiff >= -60;
  }

  // New method: Get other participant's avatar (with caching)
  // Check if lesson has participant joined (presence)
  hasParticipantJoined(lesson: Lesson | null): boolean {
    if (!lesson) return false;
    return this.lessonPresence.has(lesson._id);
  }

  // Check if lesson has participant joined by lessonId string
  hasParticipantJoinedById(lessonId: string | null | undefined): boolean {
    if (!lessonId) {
      return false;
    }
    // Normalize lessonId to string
    const normalizedId = String(lessonId);
    const hasPresence = this.lessonPresence.has(normalizedId);
    if (!hasPresence) {
      // Try to find by any key that matches (case-insensitive or partial match)
      const allKeys = Array.from(this.lessonPresence.keys());
      const matchingKey = allKeys.find(key => String(key) === normalizedId);
      if (matchingKey) {
        return true;
      }
    }
    return hasPresence;
  }

  // Get presence data for a lesson
  getPresenceData(lesson: Lesson | null): {
    participantName: string;
    participantPicture?: string;
    participantRole: 'tutor' | 'student';
    joinedAt: string;
  } | null {
    if (!lesson) return null;
    return this.lessonPresence.get(lesson._id) || null;
  }

  // Get presence data by lessonId string
  getPresenceDataById(lessonId: string | null | undefined): {
    participantName: string;
    participantPicture?: string;
    participantRole: 'tutor' | 'student';
    joinedAt: string;
  } | null {
    if (!lessonId) return null;
    return this.lessonPresence.get(lessonId) || null;
  }

  // Get presence avatar (uses presence data if available, otherwise falls back to lesson data)
  getPresenceAvatar(lesson: Lesson | null): string {
    if (!lesson) return 'assets/avatar.png';
    const presence = this.getPresenceData(lesson);
    if (presence?.participantPicture) {
      return presence.participantPicture;
    }
    return this.getOtherParticipantAvatar(lesson);
  }

  getOtherParticipantAvatar(lesson: Lesson): string {
    if (!this.currentUser || !lesson) return 'assets/avatar.png';
    
    // Use lesson ID + participant ID as cache key
    const isTutor = lesson.tutorId?._id === this.currentUser.id;
    const participantId = isTutor 
      ? (lesson.studentId as any)?._id || (lesson.studentId as any)?.id
      : (lesson.tutorId as any)?._id || (lesson.tutorId as any)?.id;
    
    const cacheKey = `${lesson._id}-${participantId}`;
    
    // Return cached value if available
    if (this._avatarCache.has(cacheKey)) {
      return this._avatarCache.get(cacheKey)!;
    }
    
    // Calculate and cache the avatar URL
    const other = isTutor ? lesson.studentId : lesson.tutorId;
    let avatarUrl = 'assets/avatar.png';
    
    if (typeof other === 'object' && other) {
      avatarUrl = (other as any).picture || (other as any).profilePicture || 'assets/avatar.png';
    }
    
    // Cache the result
    this._avatarCache.set(cacheKey, avatarUrl);
    
    return avatarUrl;
  }

  // New method: Get other participant's specialty
  getOtherParticipantSpecialty(lesson: Lesson): string {
    if (!this.currentUser) return 'Language Learning';
    
    const isTutor = lesson.tutorId?._id === this.currentUser.id;
    
    if (isTutor) {
      return 'Language Student';
    } else {
      const tutor = lesson.tutorId;
      if (typeof tutor === 'object' && tutor) {
        return (tutor as any).specialty || 'Language Tutor';
      }
      return 'Language Tutor';
    }
  }

  async loadLessons() {
    this.isLoadingLessons = true;
    try {
      const resp = await this.lessonService.getMyLessons().toPromise();
      if (resp?.success) {
        const now = Date.now();
        let allLessons = [...resp.lessons];

        // For tutors, also load classes from availability
        if (this.isTutor()) {
          const availResp = await this.userService.getAvailability().toPromise();
          if (availResp?.availability) {
            // Find class blocks in availability
            const classBlocks = availResp.availability.filter((b: any) => b.type === 'class');
            
            // Convert class blocks to lesson-like objects
            const classLessons = classBlocks.map((cls: any) => ({
              _id: cls.id,
              tutorId: (this.currentUser as any)?._id || (this.currentUser as any)?.id,
              studentId: null as any, // Classes don't have a specific student
              startTime: cls.absoluteStart || cls.startTime,
              endTime: cls.absoluteEnd || cls.endTime,
              status: 'scheduled' as const,
              subject: cls.title || cls.name || 'Class',
              channelName: `class_${cls.id}`,
              price: 0, // Classes don't have individual pricing
              duration: 60, // Default duration
              createdAt: cls.createdAt || new Date(),
              updatedAt: cls.updatedAt || new Date(),
              isClass: true, // Mark as class to differentiate
              className: cls.title || cls.name
            } as any));
            
            // Merge classes with lessons
            allLessons = [...allLessons, ...classLessons];
          }
        }

        // Filter for upcoming lessons
        this.lessons = allLessons
          .filter(l => new Date(l.endTime).getTime() >= now)
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

        // Filter for past/completed lessons (for students to show past tutors)
        // Include lessons that have ended and are not cancelled
        this.pastLessons = [...resp.lessons]
          .filter(l => {
            const endTime = new Date(l.endTime).getTime();
            return endTime < now && l.status !== 'cancelled';
          })
          .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());

        console.log('📚 Tab1Page: Past lessons found:', this.pastLessons.length);
        console.log('📚 Tab1Page: Is tutor?', this.isTutor());
        console.log('📚 Tab1Page: Past lessons:', this.pastLessons.map(l => ({
          id: l._id,
          tutorId: l.tutorId?._id || l.tutorId,
          tutorName: l.tutorId?.name,
          status: l.status,
          endTime: l.endTime
        })));

        // Extract unique tutors from past lessons (for students only)
        if (!this.isTutor()) {
          const tutorMap = new Map<string, { id: string; name: string; picture?: string }>();
          this.pastLessons.forEach(lesson => {
            // Handle both populated and non-populated tutorId
            const tutor = lesson.tutorId;
            if (tutor) {
              const tutorId = (tutor as any)._id?.toString() || (tutor as any).id?.toString() || tutor.toString();
              if (!tutorMap.has(tutorId)) {
                tutorMap.set(tutorId, {
                  id: tutorId,
                  name: (tutor as any).name || 'Unknown Tutor',
                  picture: (tutor as any).picture
                });
              }
            }
          });
          this.pastTutors = Array.from(tutorMap.values());
          console.log('👥 Tab1Page: Past tutors extracted:', this.pastTutors.length, this.pastTutors);
        } else {
          this.pastTutors = [];
        }

        // Clear avatar cache when lessons reload to get fresh images
        this._avatarCache.clear();

        // Set upcoming lesson (first future lesson)
        this.upcomingLesson = this.lessons.length > 0 ? this.lessons[0] : null;
        
        // Check for existing presence in lessons
        await this.checkExistingPresence();
        
        // Refresh availability summary with the latest lessons
        this.updateAvailabilitySummary();
        
        // Update tutor insights if tutor
        if (this.isTutor()) {
          this.loadTutorInsights();
        }
      } else {
        this.lessons = [];
      }
    } catch (err) {
      console.error('Tab1Page: Failed to load lessons', err);
      this.lessons = [];
    } finally {
      this.isLoadingLessons = false;
    }
  }

  private loadAvailability() {
    if (!this.isTutor()) {
      return;
    }
    this.userService.getAvailability()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.availabilityBlocks = response?.availability || [];
          this.updateAvailabilitySummary();
        },
        error: (error) => {
          console.error('Tab1Page: Failed to load availability', error);
          this.availabilityBlocks = [];
          this.updateAvailabilitySummary();
        }
      });
  }

  private updateAvailabilitySummary() {
    if (!this.isTutor() || !this.selectedDate) {
      this.availabilityHeadline = '';
      this.availabilityDetail = '';
      this.isSelectedDatePast = false;
      return;
    }

    // Check if selected date is in the past, today, or future
    const today = this.startOfDay(new Date());
    const selectedDay = this.startOfDay(this.selectedDate);
    this.isSelectedDatePast = selectedDay.getTime() < today.getTime();
    const isToday = this.isSameDay(this.selectedDate, new Date());
    const isFuture = selectedDay.getTime() > today.getTime();
    
    // Format date for messages
    const dateLabel = isToday ? 'today' : this.selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    if (!Array.isArray(this.availabilityBlocks) || this.availabilityBlocks.length === 0) {
      if (this.isSelectedDatePast) {
        this.availabilityHeadline = 'You hadn\'t set any availability for ' + dateLabel + '.';
      } else if (isFuture) {
        this.availabilityHeadline = 'You haven\'t set any availability for ' + dateLabel + ' yet.';
      } else {
        this.availabilityHeadline = 'You haven\'t set any availability for today yet.';
      }
      this.availabilityDetail = 'Add some time slots so students can book you.';
      return;
    }

    const dayIndex = this.getAvailabilityDayIndex(this.selectedDate);
    const dayBlocks = this.availabilityBlocks.filter(block => block.day === dayIndex);

    if (dayBlocks.length === 0) {
      if (this.isSelectedDatePast) {
        this.availabilityHeadline = 'You hadn\'t set any availability for ' + dateLabel + '.';
      } else if (isFuture) {
        this.availabilityHeadline = 'You haven\'t set any availability for ' + dateLabel + ' yet.';
      } else {
        this.availabilityHeadline = 'You haven\'t set any availability for today yet.';
      }
      this.availabilityDetail = 'Add some time slots so students can book you.';
      return;
    }

    const slots = dayBlocks.map(block => {
      const start = this.parseTimeToMinutes(block.startTime);
      const end = this.parseTimeToMinutes(block.endTime);
      return {
        start,
        end,
        duration: Math.max(end - start, 0),
        booked: 0
      };
    });

    const totalAvailabilityMinutes = slots.reduce((sum, slot) => sum + slot.duration, 0);

    const dayStart = this.startOfDay(this.selectedDate).getTime();
    const dayLessons = this.lessons.filter(lesson => {
      const lessonDate = new Date(lesson.startTime);
      return lessonDate.getTime() >= dayStart && lessonDate.getTime() < dayStart + 24 * 60 * 60 * 1000;
    });

    let bookedMinutes = 0;
    for (const lesson of dayLessons) {
      const lessonStart = new Date(lesson.startTime);
      const lessonEnd = new Date(lesson.endTime);
      const lessonStartMinutes = this.minutesSinceStartOfDay(lessonStart, dayStart);
      const lessonEndMinutes = this.minutesSinceStartOfDay(lessonEnd, dayStart);

      for (const slot of slots) {
        const overlapStart = Math.max(slot.start, lessonStartMinutes);
        const overlapEnd = Math.min(slot.end, lessonEndMinutes);
        if (overlapEnd > overlapStart) {
          const overlap = overlapEnd - overlapStart;
          slot.booked += overlap;
          bookedMinutes += overlap;
        }
      }
    }

    const openMinutes = slots.reduce((sum, slot) => {
      const free = Math.max(slot.duration - Math.min(slot.duration, slot.booked), 0);
      return sum + free;
    }, 0);

    const openSlots = slots.filter(slot => slot.duration - Math.min(slot.duration, slot.booked) > 0).length;
    const totalSlots = slots.length;

    if (totalAvailabilityMinutes <= 0) {
      if (this.isSelectedDatePast) {
        this.availabilityHeadline = 'You hadn\'t set any availability for ' + dateLabel + '.';
      } else if (isFuture) {
        this.availabilityHeadline = 'You haven\'t set any availability for ' + dateLabel + ' yet.';
      } else {
        this.availabilityHeadline = 'You haven\'t set any availability for today yet.';
      }
      this.availabilityDetail = 'Add some time slots so students can book you.';
      return;
    }

    if (openMinutes <= 0) {
      if (this.isSelectedDatePast) {
        this.availabilityHeadline = dateLabel + '\'s ' + this.pluralize(totalSlots, 'availability block') + ' (' + this.formatMinutes(totalAvailabilityMinutes) + ') were fully booked.';
        this.availabilityDetail = '';
      } else if (isFuture) {
        this.availabilityHeadline = dateLabel + '\'s ' + this.pluralize(totalSlots, 'availability block') + ' (' + this.formatMinutes(totalAvailabilityMinutes) + ') are fully booked.';
        this.availabilityDetail = 'Add more availability to accept new students.';
      } else {
        this.availabilityHeadline = 'Great news—today\'s ' + this.pluralize(totalSlots, 'availability block') + ' (' + this.formatMinutes(totalAvailabilityMinutes) + ') are fully booked.';
        this.availabilityDetail = 'Add more availability to accept new students.';
      }
      return;
    }

    if (bookedMinutes <= 0) {
      if (this.isSelectedDatePast) {
        this.availabilityHeadline = 'You were available for ' + this.formatMinutes(openMinutes) + ' on ' + dateLabel + '.';
        this.availabilityDetail = 'That was spread across ' + this.pluralize(totalSlots, 'availability block') + '.';
      } else if (isFuture) {
        this.availabilityHeadline = 'You are available for ' + this.formatMinutes(openMinutes) + ' on ' + dateLabel + '.';
        this.availabilityDetail = 'That\'s spread across ' + this.pluralize(totalSlots, 'availability block') + '. Add or adjust times to fill your schedule.';
      } else {
        this.availabilityHeadline = 'You are available for ' + this.formatMinutes(openMinutes) + ' today.';
        this.availabilityDetail = 'That\'s spread across ' + this.pluralize(totalSlots, 'availability block') + '. Add or adjust times to fill your schedule.';
      }
      return;
    }

    if (this.isSelectedDatePast) {
      this.availabilityHeadline = 'You had ' + this.formatMinutes(openMinutes) + ' open for ' + dateLabel + '.';
      this.availabilityDetail = this.pluralize(openSlots, 'availability block') + ' were partially open (' + this.formatMinutes(totalAvailabilityMinutes) + ' total, ' + this.formatMinutes(Math.min(bookedMinutes, totalAvailabilityMinutes)) + ' already booked).';
    } else if (isFuture) {
      this.availabilityHeadline = 'You have ' + this.formatMinutes(openMinutes) + ' open for ' + dateLabel + '.';
      this.availabilityDetail = this.pluralize(openSlots, 'availability block') + ' are partially open (' + this.formatMinutes(totalAvailabilityMinutes) + ' total, ' + this.formatMinutes(Math.min(bookedMinutes, totalAvailabilityMinutes)) + ' already booked). Add or adjust availability to fill the gaps.';
    } else {
      this.availabilityHeadline = 'You still have ' + this.formatMinutes(openMinutes) + ' open today.';
      this.availabilityDetail = this.pluralize(openSlots, 'availability block') + ' are partially open (' + this.formatMinutes(totalAvailabilityMinutes) + ' total, ' + this.formatMinutes(Math.min(bookedMinutes, totalAvailabilityMinutes)) + ' already booked). Add or adjust availability to fill the gaps.';
    }
  }

  private getAvailabilityDayIndex(date: Date): number {
    // Use the same day index system as availability setup component
    // Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5, Saturday=6
    return date.getDay();
  }

  private parseTimeToMinutes(time: string): number {
    if (!time) return 0;
    const [hoursStr, minutesStr] = time.split(':');
    const hours = parseInt(hoursStr, 10) || 0;
    const minutes = parseInt(minutesStr, 10) || 0;
    return hours * 60 + minutes;
  }

  private minutesSinceStartOfDay(date: Date, dayStart: number): number {
    return Math.max(0, Math.min(24 * 60, Math.round((date.getTime() - dayStart) / 60000)));
  }

  private formatMinutes(totalMinutes: number): string {
    const minutes = Math.max(0, Math.round(totalMinutes));
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const parts: string[] = [];
    if (hours > 0) {
      parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    }
    if (mins > 0 || parts.length === 0) {
      parts.push(`${mins} ${mins === 1 ? 'minute' : 'minutes'}`);
    }
    return parts.join(' ');
  }

  private pluralize(count: number, singular: string, plural?: string): string {
    const resolvedPlural = plural || `${singular}s`;
    return count === 1 ? `1 ${singular}` : `${count} ${resolvedPlural}`;
  }

  // Check for existing presence in loaded lessons
  async checkExistingPresence() {
    if (!this.currentUser) return;
    
    
    // Check each lesson for existing participants
    for (const lesson of this.lessons) {
      try {
        // Get detailed lesson info with participants
        const lessonResponse = await this.lessonService.getLesson(lesson._id).toPromise();
        if (lessonResponse?.success && lessonResponse.lesson?.participants) {
          const detailedLesson = lessonResponse.lesson;
          
          // Determine who the other participant is
          const isTutor = this.currentUser.userType === 'tutor';
          const otherParticipantId = isTutor 
            ? detailedLesson.studentId?._id 
            : detailedLesson.tutorId?._id;
          
          if (otherParticipantId && detailedLesson.participants) {
            const otherParticipantKey = String(otherParticipantId);
            const participantData = detailedLesson.participants[otherParticipantKey];
            
            // If the other participant has joined and hasn't left
            if (participantData && participantData.joinedAt && !participantData.leftAt) {
              
              // Set presence in our map
              const normalizedLessonId = String(lesson._id);
              this.lessonPresence.set(normalizedLessonId, {
                participantName: isTutor 
                  ? (detailedLesson.studentId?.name || 'Student')
                  : (detailedLesson.tutorId?.name || 'Tutor'),
                participantPicture: isTutor 
                  ? detailedLesson.studentId?.picture 
                  : detailedLesson.tutorId?.picture,
                participantRole: isTutor ? 'student' : 'tutor',
                joinedAt: typeof participantData.joinedAt === 'string' 
                  ? participantData.joinedAt 
                  : participantData.joinedAt?.toISOString() || new Date().toISOString()
              });
            }
          }
        }
      } catch (error) {
        console.error('📚 Tab1: Error checking presence for lesson', lesson._id, error);
        // Continue with other lessons even if one fails
      }
    }
    
  }

  getOtherParticipantName(lesson: Lesson): string {
    if (!this.currentUser) return '';
    const isTutor = lesson.tutorId?._id === this.currentUser.id;
    const other = isTutor ? lesson.studentId : lesson.tutorId;
    
    if (typeof other === 'object' && other) {
      return (other as any).name || (other as any).email || 'Unknown';
    }
    
    return 'Unknown';
  }

  trackByLessonId(index: number, lesson: Lesson): string {
    return lesson._id;
  }

  // Join helpers for Upcoming card
  canJoinUpcoming(): boolean {
    if (!this.upcomingLesson) return false;
    if (this.isLessonInProgress(this.upcomingLesson)) return true;
    return this.lessonService.canJoinLesson(this.upcomingLesson);
  }

  upcomingJoinCountdown(): string {
    if (!this.upcomingLesson) return '';
    // Reference countdownTick to trigger change detection updates
    void this.countdownTick;
    const secs = this.lessonService.getTimeUntilJoin(this.upcomingLesson);
    return this.lessonService.formatTimeUntil(secs);
  }

  upcomingJoinLabel(): string {
    if (!this.upcomingLesson) return 'Join';
    const participant = (this.upcomingLesson as any).participant;
    if (this.isLessonInProgress(this.upcomingLesson) && participant?.joinedBefore && participant?.leftAfterJoin) return 'Rejoin';
    return this.canJoinUpcoming() ? 'Join' : `Join in ${this.upcomingJoinCountdown()}`;
  }

  isLessonInProgress(lesson: Lesson): boolean {
    if (!lesson) return false;
    
    const now = new Date();
    const startTime = new Date(lesson.startTime);
    const endTime = new Date(lesson.endTime);
    
    // Check if lesson status is in_progress OR if current time is between start and end
    return (lesson as any)?.status === 'in_progress' || (now >= startTime && now <= endTime);
  }

  getUserRole(lesson: Lesson): 'tutor' | 'student' {
    if (!this.currentUser) return 'student';
    return lesson.tutorId._id === this.currentUser.id ? 'tutor' : 'student';
  }

  async joinUpcomingLesson() {
    if (!this.upcomingLesson || !this.currentUser) return;
    
    const role = this.getUserRole(this.upcomingLesson);
    
    // Navigate to pre-call page first
    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: this.upcomingLesson._id,
        role,
        lessonMode: 'true'
      }
    });
  }

  openNotifications() {
    this.router.navigate(['/tabs/notifications']);
  }

  // Date strip helpers (tutor view)
  generateDateStrip(days: number, startDate: Date): { label: string; dayNum: number; date: Date; isToday: boolean }[] {
    const result: { label: string; dayNum: number; date: Date; isToday: boolean }[] = [];
    const today = this.startOfDay(new Date());
    for (let i = 0; i < days; i++) {
      const d = this.startOfDay(new Date(startDate));
      d.setDate(d.getDate() + i);
      result.push({
        label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNum: d.getDate(),
        date: d,
        isToday: this.isSameDay(d, today)
      });
    }
    this.weekRangeLabel = this.getWeekRangeLabel(startDate);
    return result;
  }
 
  selectDate(d: Date) {
    this.selectedDate = this.startOfDay(new Date(d));
    this.updateAvailabilitySummary();
  }

  navigateWeek(direction: 'prev' | 'next') {
    const days = this.getDateStripDaysCount();
    const delta = direction === 'prev' ? -days : days;
    const newStart = this.startOfDay(new Date(this.weekStartDate));
    newStart.setDate(newStart.getDate() + delta);
    // When going back, prefer selecting today if it's in the range
    this.updateDateStrip(newStart, direction === 'next');
  }

  goToToday() {
    const today = this.startOfDay(new Date());
    this.selectedDate = today;
    const start = this.getStripStartForDate(today);
    this.updateDateStrip(start, false);
    this.updateAvailabilitySummary();
  }

  isCurrentWeek(): boolean {
    const todayStart = this.getStripStartForDate(new Date());
    return this.weekStartDate.getTime() === todayStart.getTime();
  }

  private updateDateStrip(startDate: Date, forceSelectStart = false) {
    const start = this.startOfDay(new Date(startDate));
    this.weekStartDate = start;
    const days = this.getDateStripDaysCount();
    this.dateStrip = this.generateDateStrip(days, start);
    
    if (forceSelectStart || !this.selectedDate || !this.isDateInWeek(this.selectedDate, start)) {
      // When going back (forceSelectStart is false), check if today is in the range
      if (!forceSelectStart) {
        const today = this.startOfDay(new Date());
        if (this.isDateInWeek(today, start)) {
          this.selectedDate = today;
        } else {
          this.selectedDate = this.dateStrip[0]?.date ?? null;
        }
      } else {
        // When going forward, select the first date
        this.selectedDate = this.dateStrip[0]?.date ?? null;
      }
    }
    this.updateAvailabilitySummary();
  }
 
  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }
 
  private getStartOfWeek(date: Date): Date {
    const d = this.startOfDay(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d;
  }
 
  private getDateStripDaysCount(): number {
    return this.isMobile ? 5 : 7;
  }
 
  isToday(date: Date | null): boolean {
    if (!date) {
      return false;
    }
    return this.isSameDay(date, new Date());
  }

  private getStripStartForDate(target: Date): Date {
    const days = this.getDateStripDaysCount();
    const start = this.getStartOfWeek(target);
    if (days >= 7) {
      return start;
    }

    const adjustedStart = this.startOfDay(new Date(start));
    const end = this.startOfDay(new Date(adjustedStart));
    end.setDate(end.getDate() + (days - 1));

    const normalizedTarget = this.startOfDay(target);
    while (normalizedTarget.getTime() > end.getTime()) {
      adjustedStart.setDate(adjustedStart.getDate() + 1);
      end.setDate(end.getDate() + 1);
    }

    return adjustedStart;
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  private isDateInWeek(date: Date, weekStart: Date): boolean {
    const start = this.startOfDay(weekStart);
    const end = this.startOfDay(new Date(weekStart));
    end.setDate(end.getDate() + (this.getDateStripDaysCount() - 1));
    const target = this.startOfDay(date);
    return target >= start && target <= end;
  }

  private getWeekRangeLabel(start: Date): string {
    const startOfWeek = this.startOfDay(new Date(start));
    const endOfWeek = this.startOfDay(new Date(start));
    endOfWeek.setDate(endOfWeek.getDate() + (this.getDateStripDaysCount() - 1));

    const sameMonth = startOfWeek.getMonth() === endOfWeek.getMonth();
    const sameYear = startOfWeek.getFullYear() === endOfWeek.getFullYear();

    if (sameMonth && sameYear) {
      const startLabel = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${startLabel} - ${endOfWeek.getDate()}, ${startOfWeek.getFullYear()}`;
    }

    if (sameYear) {
      const startLabel = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endLabel = endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${startLabel} - ${endLabel}, ${startOfWeek.getFullYear()}`;
    }

    const startLabel = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const endLabel = endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startLabel} - ${endLabel}`;
  }

  lessonsForSelectedDate(): Lesson[] {
    if (!this.selectedDate) return this.lessons;
    const y = this.selectedDate.getFullYear();
    const m = this.selectedDate.getMonth();
    const day = this.selectedDate.getDate();
    return this.lessons.filter(l => {
      const start = new Date(l.startTime);
      return start.getFullYear() === y && start.getMonth() === m && start.getDate() === day;
    });
  }

  // Cached getter for profile picture
  get currentUserPicture(): string {
    return this._currentUserPicture;
  }

  // Simple helper methods for user type checking
  isStudent(): boolean {
    return this.currentUser?.['userType'] === 'student';
  }

  isTutor(): boolean {
    return this.currentUser?.['userType'] === 'tutor';
  }

  // Method to refresh user data from database
  refreshUserData() {
    this.userService.getCurrentUser().subscribe(user => {
      this.currentUser = user;
    });
  }

  // Student lesson join helpers (for tutor view student cards)
  canJoinStudentLesson(student: any): boolean {
    if (!student.lesson) return false;
    const lesson = student.lesson as Lesson;
    if (this.isLessonInProgress(lesson)) return true;
    // No need to reference countdownTick here - we use cached joinLabel instead
    return this.lessonService.canJoinLesson(lesson);
  }

  /**
   * Calculate join label for a lesson (used for pre-calculation)
   */
  private calculateJoinLabel(lesson: Lesson): string {
    const participant = (lesson as any).participant;
    if (this.isLessonInProgress(lesson) && participant?.joinedBefore && participant?.leftAfterJoin) {
      return 'Rejoin';
    }
    
    if (this.isLessonInProgress(lesson) || this.lessonService.canJoinLesson(lesson)) {
      return 'Join';
    }
    
    const secs = this.lessonService.getTimeUntilJoin(lesson);
    return `Join in ${this.lessonService.formatTimeUntil(secs)}`;
  }

  /**
   * Update join labels for all displayed students
   */
  private updateStudentJoinLabels(): void {
    // Update labels in place for cached students to prevent flashing
    // Only update if the label text would actually change (e.g., minute change)
    // Update both currentStudents and cachedStudentsForDate (they reference the same objects)
    if (this.currentStudents && this.currentStudents.length > 0) {
      this.currentStudents.forEach(student => {
        if (student.lesson) {
          const newLabel = this.calculateJoinLabel(student.lesson as Lesson);
          // Only update if label changed to minimize DOM updates
          if (student.joinLabel !== newLabel) {
            student.joinLabel = newLabel;
          }
        }
      });
      // cachedStudentsForDate contains references to the same student objects,
      // so updating currentStudents also updates cachedStudentsForDate
      // Note: countdownTick is updated by the caller after this method
      // to ensure a single change detection cycle
    }
  }

  getStudentJoinLabel(student: any): string {
    // Use pre-calculated label if available to prevent flashing
    if (student.joinLabel !== undefined) {
      return student.joinLabel;
    }
    
    // Fallback to calculation if label not pre-calculated
    if (!student.lesson) return 'Join';
    return this.calculateJoinLabel(student.lesson as Lesson);
  }

  async joinStudentLesson(student: any) {
    if (!student.lesson || !this.currentUser) return;
    const lesson = student.lesson as Lesson;
    
    // Navigate to pre-call page first
    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: lesson._id,
        role: 'tutor',
        lessonMode: 'true'
      }
    });
  }

  messageStudent(student: any) {
    // TODO: Implement message functionality
  }
}