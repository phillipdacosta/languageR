import { Component, OnInit, OnDestroy } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Router } from '@angular/router';
import { TutorSearchPage } from '../tutor-search/tutor-search.page';
import { PlatformService } from '../services/platform.service';
import { AuthService } from '../services/auth.service';
import { UserService, User } from '../services/user.service';
import { Observable, takeUntil } from 'rxjs';
import { Subject } from 'rxjs';
import { LessonService, Lesson } from '../services/lesson.service';


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
  constructor(
    private modalCtrl: ModalController, 
    private router: Router,
    public platformService: PlatformService,
    private authService: AuthService,
    private userService: UserService,
    private lessonService: LessonService
  ) {
    // Get database user data instead of Auth0 data
    this.userService.getCurrentUser()
    .pipe(takeUntil(this.destroy$))
    .subscribe(user => {
      console.log('Tab1Page: Database user data:', user);
      console.log('Tab1Page: User type:', user?.userType);
      this.currentUser = user;
      console.log('Tab1Page: Current user set to:', this.currentUser);
      console.log('Tab1Page: Is student?', this.isStudent());
      console.log('Tab1Page: Is tutor?', this.isTutor());
      // Load lessons as soon as we have the current user
      this.loadLessons();
    });
  }

  private resizeListener: any;

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

    console.log('Home page - Platform detected:', this.currentPlatform);
    console.log('Home page - Platform config:', this.platformConfig);
  }

  ngOnDestroy() {
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
    }
  }

  async openSearchTutors() {
    if(this.isWeb) {
      this.router.navigate(['/tabs/tutor-search']);
    } else {
      const modal = await this.modalCtrl.create({
        component: TutorSearchPage,
      });
      modal.present();

      const { data, role } = await modal.onWillDismiss();

      if (role === 'confirm') {
        // Handle tutor selection
        console.log('Selected tutor:', data);
      }
    }
  }

  loadUserStats() {
    // Load user stats from database
    this.userService.getCurrentUser().subscribe(user => {
      console.log('Loading user stats for:', user?.name);
      console.log('User stats:', user?.['stats']);
    });
  }

  startVideoCall() {
    // Navigate to the video call page
    this.router.navigate(['/video-call']);
  }

  openDebugPage() {
    // Navigate to the debug page
    console.log('Opening debug page...');
    this.router.navigate(['/debug-permissions']);
  }

  // Lessons handling for Home tab
  async loadLessons() {
    this.isLoadingLessons = true;
    try {
      const resp = await this.lessonService.getMyLessons().toPromise();
      if (resp?.success) {
        this.lessons = [...resp.lessons].sort((a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        );
        console.log('Tab1Page: Loaded lessons for home tab:', this.lessons);
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
    const dateOptions: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
    const timeOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    const dateStr = start.toLocaleDateString('en-US', dateOptions);
    const timeStr = `${start.toLocaleTimeString('en-US', timeOptions)} - ${end.toLocaleTimeString('en-US', timeOptions)}`;
    return `${dateStr}, ${timeStr}`;
  }

  getOtherParticipantName(lesson: Lesson): string {
    if (!this.currentUser) return '';
    const isTutor = lesson.tutorId?._id === this.currentUser.id;
    const other = isTutor ? lesson.studentId : lesson.tutorId;
    return other?.name || other?.email || 'Unknown';
  }

  trackByLessonId(index: number, lesson: Lesson): string {
    return lesson._id;
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
