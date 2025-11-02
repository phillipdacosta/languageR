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
  
  // Tutor-specific insights
  totalStudents = 0;
  lessonsThisWeek = 0;
  tutorRating = '0.0';
  
  // Featured tutors for students (mock data - replace with real data)
  featuredTutors: any[] = [];

  private resizeListener: any;

  constructor(
    private modalCtrl: ModalController, 
    private router: Router,
    public platformService: PlatformService,
    private authService: AuthService,
    private userService: UserService,
    private lessonService: LessonService,
    private agoraService: AgoraService,
    private loadingController: LoadingController,
    private toastController: ToastController
  ) {
    // Get database user data instead of Auth0 data
      this.userService.getCurrentUser()
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        console.log('Tab1Page: Database user data:', user);
        console.log('Tab1Page: User type:', user?.userType);
        this.currentUser = user;
        
        // Cache profile picture to avoid repeated evaluations
        this._currentUserPicture = user?.picture || 'assets/avatar.png';
        
        console.log('Tab1Page: Current user set to:', this.currentUser);
        console.log('Tab1Page: Is student?', this.isStudent());
        console.log('Tab1Page: Is tutor?', this.isTutor());
        
        // Load lessons as soon as we have the current user
        this.loadLessons();
        
        // Load tutor-specific data
        if (this.isTutor()) {
          this.loadTutorInsights();
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
      console.log('Home page - Window resized - Is web:', this.isWeb, 'Is mobile:', this.isMobile);
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

    console.log('Home page - Platform detected:', this.currentPlatform);
    console.log('Home page - Platform config:', this.platformConfig);

    // Prepare date strip (next 7 days)
    this.dateStrip = this.generateDateStrip(7);

    // Live countdown tick (updates change detection)
    this.countdownInterval = setInterval(() => {
      this.countdownTick = Date.now();
    }, 30000); // update every 30s
    
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
    if (this.isWeb) {
      this.router.navigate(['/tabs/tutor-search']);
    } else {
      const modal = await this.modalCtrl.create({
        component: TutorSearchPage,
      });
      modal.present();

      const { data, role } = await modal.onWillDismiss();

      if (role === 'confirm') {
        console.log('Selected tutor:', data);
      }
    }
  }

  loadUserStats() {
    this.userService.getCurrentUser().subscribe(user => {
      console.log('Loading user stats for:', user?.name);
      console.log('User stats:', user?.['stats']);
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

  // New method: Get students for selected date (tutor view)
  getStudentsForDate(): any[] {
    if (!this.selectedDate) return [];
    
    const lessonsForDate = this.lessonsForSelectedDate();
    const students = lessonsForDate
      .filter(l => l.studentId && typeof l.studentId === 'object')
      .map(l => ({
        id: (l.studentId as any)._id,
        name: (l.studentId as any).name || (l.studentId as any).email,
        profilePicture: (l.studentId as any).picture || (l.studentId as any).profilePicture || 'assets/avatar.png',
        email: (l.studentId as any).email,
        rating: (l.studentId as any).rating || 4.5,
        subject: 'Language Student',
        lessonId: l._id
      }));
    
    // Remove duplicates by student ID
    const uniqueStudents = students.filter((student, index, self) =>
      index === self.findIndex(s => s.id === student.id)
    );
    
    // Enrich profile pictures from latest user data (fetch by email)
    uniqueStudents.forEach(s => {
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
    
    return uniqueStudents;
  }

  // New method: Get upcoming lessons (all future lessons)
  getUpcomingLessons(): Lesson[] {
    return this.lessons;
  }

  // New method: Get other participant's avatar (with caching)
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
        console.log('Tab1Page: Loaded lessons for home tab:', this.lessons);

        // Clear avatar cache when lessons reload to get fresh images
        this._avatarCache.clear();

        // Set upcoming lesson (first future lesson)
        this.upcomingLesson = this.lessons.length > 0 ? this.lessons[0] : null;
        
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

  formatLessonTime(lesson: Lesson): string {
    const start = new Date(lesson.startTime);
    const end = new Date(lesson.endTime);
    const dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const timeOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    const dateStr = start.toLocaleDateString('en-US', dateOptions);
    const timeStr = `${start.toLocaleTimeString('en-US', timeOptions)} - ${end.toLocaleTimeString('en-US', timeOptions)}`;
    return `${dateStr}, ${timeStr}`;
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
      console.log('Refreshed database user data:', user);
      this.currentUser = user;
    });
  }
}