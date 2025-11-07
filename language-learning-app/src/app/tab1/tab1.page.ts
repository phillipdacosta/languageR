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
  isLoadingLessons = false;
  
  // UI state
  hasNotifications = false;
  unreadNotificationCount = 0;
  
  // Cached profile picture to avoid repeated evaluations
  private _currentUserPicture: string = 'assets/avatar.png';
  private _avatarCache = new Map<string, string>();
  
  // Tutor date strip and upcoming lesson
  dateStrip: { label: string; dayNum: number; date: Date; isToday: boolean }[] = [];
  selectedDate: Date | null = null;
  upcomingLesson: Lesson | null = null;
  private countdownInterval: any;
  countdownTick = Date.now();
  private statusInterval: any;
  private lastLabelUpdateTime = 0; // Track last time labels were updated
  
  // Tutor-specific insights
  totalStudents = 0;
  lessonsThisWeek = 0;
  tutorRating = '0.0';
  
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
    private notificationService: NotificationService
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
        }
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

    // Get platform information
    this.currentPlatform = this.platformService.getPlatform();
    this.platformConfig = this.platformService.getPlatformConfig();
    this.isWeb = this.platformService.isWeb();
    this.isMobile = this.platformService.isMobile();

    // Add window resize listener for reactive viewport detection
    this.resizeListener = () => {
      this.isWeb = this.platformService.isWeb();
      this.isMobile = this.platformService.isMobile();
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


    // Prepare date strip (next 7 days)
    this.dateStrip = this.generateDateStrip(7);

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
    
    // Find the earliest lesson among ALL scheduled/in_progress lessons on the selected date
    const now = new Date();
    
    // Get all scheduled/in_progress lessons on this date (past or future)
    const activeLessonsOnDate = lessonsForDate
      .filter(l => l.status === 'scheduled' || l.status === 'in_progress')
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    // Get the earliest start time from all active lessons on this date
    const earliestStartTime = activeLessonsOnDate.length > 0 
      ? new Date(activeLessonsOnDate[0].startTime).getTime() 
      : null;
    
    // Mark all lessons that start at the earliest time as "next" (if earliest is upcoming or in progress)
    const nextLessonIds = new Set<string>();
    if (earliestStartTime !== null) {
      // Check if the earliest lesson is upcoming or currently in progress (within the last hour)
      const earliestStartDate = new Date(earliestStartTime);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      // Mark as "next" if it's upcoming or started within the last hour (still active)
      if (earliestStartDate >= oneHourAgo) {
        activeLessonsOnDate.forEach(l => {
          const lessonStartTime = new Date(l.startTime).getTime();
          // If lesson starts within 5 minutes of the earliest time, consider it "next"
          // This handles cases where lessons are scheduled for the exact same time
          if (Math.abs(lessonStartTime - earliestStartTime) < 5 * 60 * 1000) {
            nextLessonIds.add(String(l._id));
          }
        });
      }
      
    }
    
    // Group lessons by student and find the earliest lesson for each student
    const studentLessonMap = new Map<string, { student: any; lesson: Lesson; isNext: boolean }>();
    
    // First pass: find the earliest lesson for each student
    lessonsForDate
      .filter(l => l.studentId && typeof l.studentId === 'object')
      .forEach(l => {
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
      });
    
    // Second pass: find the earliest among displayed lessons and mark them as "next"
    const displayedLessons = Array.from(studentLessonMap.values()).map(({ lesson }) => lesson);
    if (displayedLessons.length > 0) {
      displayedLessons.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      const earliestDisplayedStartTime = new Date(displayedLessons[0].startTime).getTime();
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      
      // Mark as "next" if earliest is upcoming or started within the last hour
      if (new Date(earliestDisplayedStartTime) >= oneHourAgo) {
        displayedLessons.forEach(l => {
          const lessonStartTime = new Date(l.startTime).getTime();
          // If lesson starts within 5 minutes of the earliest displayed time, mark as "next"
          if (Math.abs(lessonStartTime - earliestDisplayedStartTime) < 5 * 60 * 1000) {
            const studentId = String((l.studentId as any)._id);
            const entry = studentLessonMap.get(studentId);
            if (entry && String(entry.lesson._id) === String(l._id)) {
              entry.isNext = true;
            }
          }
        });
      } else {
      }
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

  // New method: Get upcoming lessons (all future lessons)
  getUpcomingLessons(): Lesson[] {
    return this.lessons;
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
        this.lessons = [...resp.lessons]
          .filter(l => new Date(l.endTime).getTime() >= now)
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

        // Clear avatar cache when lessons reload to get fresh images
        this._avatarCache.clear();

        // Set upcoming lesson (first future lesson)
        this.upcomingLesson = this.lessons.length > 0 ? this.lessons[0] : null;
        
        // Check for existing presence in lessons
        await this.checkExistingPresence();
        
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
    return (lesson as any)?.status === 'in_progress';
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

  // Date strip helpers (tutor view)
  generateDateStrip(days: number): { label: string; dayNum: number; date: Date; isToday: boolean }[] {
    const result: { label: string; dayNum: number; date: Date; isToday: boolean }[] = [];
    const now = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      result.push({
        label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNum: d.getDate(),
        date: d,
        isToday: i === 0
      });
    }
    this.selectedDate = result[0]?.date ?? null;
    return result;
  }

  selectDate(d: Date) {
    this.selectedDate = d;
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