import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ModalController, LoadingController, ToastController, ActionSheetController, PopoverController, AlertController } from '@ionic/angular';
import { Router } from '@angular/router';
import { TutorSearchPage } from '../tutor-search/tutor-search.page';
import { PlatformService } from '../services/platform.service';
import { AuthService } from '../services/auth.service';
import { UserService, User } from '../services/user.service';
import { Observable, takeUntil, take, filter, firstValueFrom, observeOn, asyncScheduler } from 'rxjs';
import { Subject } from 'rxjs';
import { LessonService, Lesson } from '../services/lesson.service';
import { ClassService, ClassInvitation } from '../services/class.service';
import { ClassInvitationModalComponent } from '../components/class-invitation-modal/class-invitation-modal.component';
import { ClassMenuPopoverComponent } from '../components/class-menu-popover/class-menu-popover.component';
import { AgoraService } from '../services/agora.service';
import { WebSocketService } from '../services/websocket.service';
import { NotificationService } from '../services/notification.service';
import { MessagingService } from '../services/messaging.service';
import { ConfirmActionModalComponent } from '../components/confirm-action-modal/confirm-action-modal.component';
import { InviteStudentModalComponent } from '../components/invite-student-modal/invite-student-modal.component';
import { RescheduleLessonModalComponent } from '../components/reschedule-lesson-modal/reschedule-lesson-modal.component';
import { RescheduleProposalModalComponent } from '../components/reschedule-proposal-modal/reschedule-proposal-modal.component';
import { LessonSummaryComponent } from '../modals/lesson-summary/lesson-summary.component';
import { NotesModalComponent } from '../components/notes-modal/notes-modal.component';

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
  cancelledLessons: Lesson[] = [];
  pastLessons: Lesson[] = [];
  pastTutors: Array<{ id: string; name: string; picture?: string }> = [];
  pendingClassInvitations: ClassInvitation[] = [];
  isLoadingLessons = false;
  isLoadingInvitations = false;
  
  // Smart caching to prevent unnecessary skeleton loaders
  private _hasInitiallyLoaded = false; // Track if we've loaded data at least once
  private _lastDataFetch = 0; // Timestamp of last data fetch
  private _cacheValidityMs = 30000; // Cache valid for 30 seconds
  availabilityBlocks: any[] = [];
  availabilityHeadline = '';
  availabilityDetail = '';
  isSelectedDatePast = false;
  
  // Lesson view toggle
  lessonView: 'upcoming' | 'cancelled' = 'upcoming';
  
  // UI state
  hasNotifications = false;
  unreadNotificationCount = 0;
  
  // Cached avatar cache for student/tutor avatars
  private _avatarCache = new Map<string, string | null>();
  
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
  walletBalance = 0; // TODO: Load from actual wallet service
  showWalletBalance = false; // Hide by default
  walletDisplay = '$•••••'; // Computed display value
  walletTemporarilyVisible = false; // For mobile tap-to-reveal
  
  // Cache of current students array for efficient label updates
  private currentStudents: any[] = [];
  private cachedStudentsForDate: any[] = [];
  private cachedStudentsDate: Date | null = null;
  private cachedStudentsLessonsHash: string = '';
  
  // Cached computed properties to prevent re-computation during change detection
  private _cachedFirstLesson: any | null = null;
  private _cachedFirstLessonHash: string = '';
  private _cachedTimelineEvents: any[] = [];
  private _cachedTimelineEventsHash: string = '';
  
  // Cache for reschedule proposer checks to avoid repeated function calls
  private _rescheduleProposerCache: Map<string, boolean> = new Map();
  private _rescheduleProposerCacheTime: number = 0;
  
  // Inline modal state for reschedule modal
  isRescheduleModalOpen = false;
  rescheduleModalData: {
    lessonId: string;
    lesson: Lesson;
    participantId: string;
    participantName: any;
    participantAvatar: string | undefined;
    currentUserId: string;
    isTutor: boolean;
    showBackButton?: boolean;
  } | null = null;
  
  // Inline modal state for reschedule proposal modal
  isRescheduleProposalModalOpen = false;
  rescheduleProposalModalData: {
    lessonId: string;
    lesson: any;
    proposal: any;
    participantName: string;
    participantAvatar: string | undefined;
    proposedDate: string;
    proposedTime: string;
    originalDate: string;
    originalTime: string;
    otherParticipant: any; // Store for counter-propose action
  } | null = null;
  
  // Inline modal state for confirm action modal (reschedule)
  isConfirmRescheduleModalOpen = false;
  confirmRescheduleModalData: {
    title: string;
    message: string;
    notificationMessage: string;
    confirmText: string;
    cancelText: string;
    confirmColor: string;
    icon: string;
    iconColor: string;
    participantName: string;
    participantAvatar: string | undefined;
    lessonId: string;
    lesson: Lesson;
    otherParticipant: any;
  } | null = null;
  
  // Inline modal state for class invitation modal
  isClassInvitationModalOpen = false;
  classInvitationModalData: {
    classId: string;
    notification?: any;
  } | null = null;
  
  // Inline modal state for confirm action modal (cancel)
  isConfirmCancelModalOpen = false;
  confirmCancelModalData: {
    title: string;
    message: string;
    notificationMessage: string;
    confirmText: string;
    cancelText: string;
    confirmColor: string;
    icon: string;
    iconColor: string;
    participantName: string;
    participantAvatar: string | undefined;
    lessonId: string;
    lesson: Lesson;
  } | null = null;
  
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
    private classService: ClassService,
    private agoraService: AgoraService,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private websocketService: WebSocketService,
    private notificationService: NotificationService,
    private messagingService: MessagingService,
    private actionSheetController: ActionSheetController,
    private popoverController: PopoverController,
    private alertController: AlertController,
    private cdr: ChangeDetectorRef
  ) {
    // Subscribe to currentUser$ observable to get updates automatically
    // Use asyncScheduler to prevent synchronous emission from blocking
    this.userService.currentUser$
      .pipe(
        observeOn(asyncScheduler), // Make emissions async to prevent freezing
        filter(user => user !== null),
        takeUntil(this.destroy$)
      )
      .subscribe(user => {
        this.currentUser = user;
        
        // Load notification count when user is available
        if (user) {
          setTimeout(() => {
            this.loadUnreadNotificationCount();
          }, 500);
        }
        
        // Only load lessons on initial user setup, not on every navigation
        // ionViewWillEnter() handles subsequent loads with smart caching
        if (!this._hasInitiallyLoaded) {
          this.loadLessons(true); // Show skeleton only on first load
        }
        
        // Load tutor-specific data
        if (this.isTutor()) {
          this.loadTutorInsights();
          this.loadAvailability();
        } else {
          // Load pending class invitations for students
          this.loadPendingInvitations();
        }
      });
    
    // Subscribe to unread message count
    this.messagingService.unreadCount$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(count => {
      this.unreadMessages = count;
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
      // Skip if upcoming lesson is a class (not a real lesson)
      if (this.upcomingLesson && this.upcomingLesson._id === leftLessonId && !(this.upcomingLesson as any).isClass) {
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
    ).subscribe(async (notification) => {
      // Reload notification count when a new notification arrives (only if user is authenticated)
      if (this.currentUser) {
        this.loadUnreadNotificationCount();
        
        // Handle class auto-cancelled notifications
        if ((notification?.type === 'class_auto_cancelled' || notification?.type === 'class_invitation_cancelled') && notification.data?.classId) {
          console.log('🔔 [TAB1] Received class cancellation notification:', notification);
          
          // Smart update: Move the cancelled class from lessons to cancelledLessons without full reload
          await this.handleClassCancellation(notification.data.classId, notification.data.cancelReason);
          
          // Manually trigger change detection to update the UI
          this.cdr.detectChanges();
          
          // Show toast notification
          const toast = await this.toastController.create({
            message: notification.message || 'A class has been cancelled',
            duration: 5000,
            position: 'top',
            color: 'warning',
            buttons: [
              {
                text: 'View',
                handler: () => {
                  // Switch to cancelled tab when user clicks "View"
                  this.lessonView = 'cancelled';
                  this.cdr.detectChanges();
                }
              },
              {
                text: 'Dismiss',
                role: 'cancel'
              }
            ]
          });
          await toast.present();
        }
        
        // Handle lesson cancelled notifications
        if (notification?.type === 'lesson_cancelled' && notification.data?.lessonId) {
          console.log('🔔 [TAB1] Received lesson cancellation notification:', notification);
          
          // Smart update: Move the cancelled lesson without full reload
          await this.handleLessonCancellation(notification.data.lessonId);
          
          // Manually trigger change detection to update the UI
          this.cdr.detectChanges();
          
          // Show toast notification
          const toast = await this.toastController.create({
            message: notification.message || 'A lesson has been cancelled',
            duration: 5000,
            position: 'top',
            color: 'warning',
            buttons: [
              {
                text: 'OK',
                role: 'cancel'
              }
            ]
          });
          await toast.present();
        }
        
        // Handle class invitations specially
        if (notification?.type === 'class_invitation' && this.currentUser.userType === 'student') {
          // Reload pending invitations to show the new one
          this.loadPendingInvitations();
          
          // Show a toast notification
          const toast = await this.toastController.create({
            message: notification.message || 'You have a new class invitation!',
            duration: 4000,
            position: 'top',
            color: 'primary',
            buttons: [
              {
                text: 'View',
                handler: () => {
                  if (notification.classId) {
                    this.openClassInvitation(notification.classId, { data: notification });
                  }
                }
              },
              {
                text: 'Dismiss',
                role: 'cancel'
              }
            ]
          });
          await toast.present();
        }
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
        
        // Recalculate upcoming lesson in case current one ended
        this.recalculateUpcomingLesson();
        
        // Update join labels for all displayed students
        this.updateStudentJoinLabels();
        // Update countdownTick after labels are updated to trigger single change detection
        // This also triggers the isNextClassInProgress() check for the badge
        this.countdownTick = now;
      }
    }, 5000); // Check every 5s, but only update when minute changes
    
    // Poll lesson status periodically to reflect In Progress/Rejoin
    this.statusInterval = setInterval(() => {
      // Skip if upcoming lesson is a class (not a real lesson)
      if (this.upcomingLesson && !(this.upcomingLesson as any).isClass) {
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

    // Listen for reschedule proposal events
    this.websocketService.on('reschedule_proposed').pipe(
      takeUntil(this.destroy$)
    ).subscribe(async (data: any) => {
      console.log('📅 [TAB1] Reschedule proposed:', data);
      console.log('📅 [TAB1] Current lessons count:', this.lessons.length);
      console.log('📅 [TAB1] Looking for lesson with ID:', data.lessonId);
      
      // Update the lesson status in the UI
      const lesson = this.lessons.find(l => {
        const match = String(l._id) === String(data.lessonId);
        console.log('📅 [TAB1] Comparing:', String(l._id), 'vs', String(data.lessonId), '=', match);
        return match;
      });
      
      if (lesson) {
        console.log('✅ [TAB1] Found lesson, updating...');
        lesson.status = 'pending_reschedule';
        (lesson as any).rescheduleProposal = data.proposal;
        
        // Invalidate cached computed properties to force recalculation
        this._cachedFirstLessonHash = '';
        this._cachedFirstLesson = undefined;
        this._cachedTimelineEventsHash = '';
        this._cachedTimelineEvents = [];
        this._rescheduleProposerCache.clear(); // Clear reschedule proposer cache
        
        // Force change detection and update
        this.cdr.detectChanges();
        
        // Trigger a recomputation by updating countdownTick
        this.countdownTick = Date.now();

        // Show toast
        const toast = await this.toastController.create({
          message: `${data.proposerName} proposed a new time for your lesson`,
          duration: 5000,
          color: 'primary',
          position: 'top',
          buttons: [{
            text: 'View',
            handler: () => {
              this.showRescheduleProposal(lesson);
            }
          }]
        });
        await toast.present();
      } else {
        console.warn('❌ [TAB1] Lesson not found in lessons array, reloading lessons...');
        // Reload lessons to ensure we have the latest data
        await this.loadLessons(false);
      }
    });

    // Listen for lesson_updated events (for when you're the proposer)
    this.websocketService.on('lesson_updated').pipe(
      takeUntil(this.destroy$)
    ).subscribe(async (data: any) => {
      console.log('📅 [TAB1] Lesson updated:', data);
      
      // Update the lesson in the UI
      const lesson = this.lessons.find(l => String(l._id) === String(data.lessonId));
      
      if (lesson) {
        console.log('✅ [TAB1] Found lesson, updating status to:', data.status);
        lesson.status = data.status as any;
        
        if (data.rescheduleProposal) {
          (lesson as any).rescheduleProposal = data.rescheduleProposal;
        }
        
        // Invalidate cached computed properties to force recalculation
        this._cachedFirstLessonHash = '';
        this._cachedFirstLesson = undefined;
        this._cachedTimelineEventsHash = '';
        this._cachedTimelineEvents = [];
        this._rescheduleProposerCache.clear();
        
        // Force change detection and update
        this.cdr.detectChanges();
        
        // Trigger a recomputation by updating countdownTick
        this.countdownTick = Date.now();
      } else {
        console.warn('⚠️ [TAB1] Lesson not found in current list:', data.lessonId);
      }
    });

    // Listen for reschedule accepted events
    this.websocketService.on('reschedule_accepted').pipe(
      takeUntil(this.destroy$)
    ).subscribe(async (data: any) => {
      console.log('✅ [TAB1] Reschedule accepted:', data);
      const lesson = this.lessons.find(l => l._id === data.lessonId);
      if (lesson) {
        console.log('📅 [TAB1] Before update:', {
          lessonId: lesson._id,
          oldStartTime: lesson.startTime,
          oldEndTime: lesson.endTime,
          status: lesson.status
        });
        
        // Update the lesson times to the new accepted times
        lesson.startTime = data.newStartTime;
        lesson.endTime = data.newEndTime;
        lesson.status = 'scheduled';
        
        console.log('📅 [TAB1] After update:', {
          lessonId: lesson._id,
          newStartTime: lesson.startTime,
          newEndTime: lesson.endTime,
          status: lesson.status,
          newDate: new Date(lesson.startTime).toLocaleDateString(),
          newTime: new Date(lesson.startTime).toLocaleTimeString()
        });
        
        // Mark the rescheduleProposal as accepted (keep the proposal object for badge display)
        if ((lesson as any).rescheduleProposal) {
          (lesson as any).rescheduleProposal.status = 'accepted';
        }
        
        // Re-sort lessons array by startTime to ensure correct ordering
        this.lessons.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
        
        console.log('📅 [TAB1] Total lessons after sort:', this.lessons.length);
        console.log('📅 [TAB1] Currently viewing date:', this.selectedDate?.toLocaleDateString());
        console.log('📅 [TAB1] Lessons for currently selected date:', this.lessonsForSelectedDate().length);
        
        // Invalidate ALL cached computed properties to force full recalculation
        // This will determine if the lesson is still the "next class" or should move to timeline
        this._cachedFirstLessonHash = '';
        this._cachedFirstLesson = undefined;
        this._cachedTimelineEventsHash = '';
        this._cachedTimelineEvents = [];
        this._rescheduleProposerCache.clear();
        
        // Force change detection to recompute all getters
        this.cdr.detectChanges();
        this.countdownTick = Date.now();

        // Show toast
        const toast = await this.toastController.create({
          message: 'Reschedule accepted! Lesson time updated.',
          duration: 3000,
          color: 'success',
          position: 'top'
        });
        await toast.present();
      } else {
        console.warn('❌ [TAB1] Lesson not found for reschedule_accepted, reloading lessons...');
        await this.loadLessons(false);
      }
    });

    // Listen for reschedule rejected events
    this.websocketService.on('reschedule_rejected').pipe(
      takeUntil(this.destroy$)
    ).subscribe(async (data: any) => {
      console.log('❌ [TAB1] Reschedule rejected:', data);
      // Clear the proposal
      const lesson = this.lessons.find(l => l._id === data.lessonId);
      if (lesson) {
        lesson.status = 'scheduled';
        (lesson as any).rescheduleProposal = null;
        
        // Invalidate cached computed properties
        this._cachedFirstLessonHash = '';
        this._cachedFirstLesson = undefined;
        
        this.cdr.detectChanges();
        this.countdownTick = Date.now();

        // Show toast
        const toast = await this.toastController.create({
          message: 'Reschedule request was declined',
          duration: 3000,
          color: 'warning',
          position: 'top'
        });
        await toast.present();
      }
    });
  }

  ionViewWillEnter() {
    console.log('🔄 [TAB1] ionViewWillEnter - hasInitiallyLoaded:', this._hasInitiallyLoaded, 'lastFetch:', new Date(this._lastDataFetch).toLocaleTimeString());
    
    // Refresh presence data when returning to the home page
    // This ensures we see updated presence if someone joined while we were away
    if (this.lessons.length > 0) {
      this.checkExistingPresence();
    }
    // Reload notification count when returning to the page (important for page refresh)
    if (this.currentUser) {
      this.loadUnreadNotificationCount();
      
      // Reload class invitations to get latest status (including cancelled classes)
      if (this.currentUser.userType === 'student') {
        this.loadPendingInvitations();
      }
    }
    
    // Reload user settings to ensure wallet display is up to date
    this.loadUserStats();
    
    // Smart refresh: only reload if cache is stale or this is the initial load
    const now = Date.now();
    const cacheAge = now - this._lastDataFetch;
    const isCacheStale = cacheAge > this._cacheValidityMs;
    
    console.log('🔄 [TAB1] Cache age:', Math.round(cacheAge / 1000), 'seconds, stale:', isCacheStale);
    
    if (!this._hasInitiallyLoaded || isCacheStale) {
      console.log('🔄 [TAB1] Loading lessons - showSkeleton:', !this._hasInitiallyLoaded);
      // Only show skeleton on initial load, not on subsequent visits
      this.loadLessons(!this._hasInitiallyLoaded);
    } else {
      console.log('✅ [TAB1] Using cached data, forcing recomputation of computed properties');
      // Even when using cached data, we need to invalidate computed property caches
      // to ensure the UI updates properly when returning to this tab
      this._cachedFirstLessonHash = '';
      this._cachedFirstLesson = undefined;
      this._cachedTimelineEventsHash = '';
      this._cachedTimelineEvents = [];
      this._rescheduleProposerCache.clear();
      
      // Trigger change detection to recompute getters
      this.cdr.detectChanges();
      this.countdownTick = Date.now();
    }
  }

  loadUnreadNotificationCount() {
    // Only load if user is authenticated
    if (!this.currentUser) {
      return;
    }

    this.notificationService.getUnreadCount().pipe(
      observeOn(asyncScheduler), // Make emissions async to prevent freezing
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

  loadPendingInvitations() {
    if (!this.currentUser || this.currentUser.userType !== 'student') {
      return;
    }

    this.isLoadingInvitations = true;
    this.classService.getPendingInvitations().pipe(
      observeOn(asyncScheduler), // Make emissions async to prevent freezing
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        if (response.success) {
          // Keep all classes including cancelled ones (they'll show status in UI)
          this.pendingClassInvitations = response.classes;
        }
        this.isLoadingInvitations = false;
      },
      error: (error) => {
        console.error('Error loading pending invitations:', error);
        this.isLoadingInvitations = false;
      }
    });
  }

  async openClassInvitation(classId: string, notification?: any) {
    // Use inline modal instead of programmatic modal to prevent freezing
    this.classInvitationModalData = {
      classId,
      notification
    };
    this.isClassInvitationModalOpen = true;
  }
  
  // Handle inline class invitation modal dismissal
  onClassInvitationModalDismiss(event: any) {
    console.log('📧 Class invitation modal dismissed:', event);
    this.isClassInvitationModalOpen = false;
    
    const data = event.detail?.data;
    if (data?.accepted || data?.declined) {
      // Reload invitations and lessons to reflect the change (no skeleton if already loaded)
      this.loadPendingInvitations();
      this.loadLessons(false);
    }
  }

  formatClassDate(dateString: string | null | undefined): string {
    if (!dateString) return 'Date TBD';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Date TBD';
      return date.toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return 'Date TBD';
    }
  }

  formatClassTime(dateString: string | null | undefined): string {
    if (!dateString) return 'Time TBD';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Time TBD';
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      });
    } catch {
      return 'Time TBD';
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

  // 🎨 DEV: Preview the new lesson summary modal with mock data
  async previewLessonSummaryModal() {
    const modal = await this.modalCtrl.create({
      component: LessonSummaryComponent,
      componentProps: {
        lessonId: 'mock-lesson-id',
        // Pass mock analysis directly to skip API call
        mockAnalysis: this.getMockAnalysisData()
      },
      cssClass: 'fullscreen-modal'
    });

    await modal.present();
  }

  private getMockAnalysisData() {
    return {
      _id: 'mock-analysis-id',
      lessonId: 'mock-lesson-id',
      studentId: 'mock-student-id',
      tutorId: 'mock-tutor-id',
      language: 'Spanish',
      status: 'completed',
      
      // Student Summary
      studentSummary: "You told a great story about bumping into your friend at the supermarket! You said 'me encontré con una amiga' (I met a friend) which was perfect. However, you said 'acompañarle' when it should be 'acompañarla' since you're referring to your female friend. Also, 'desde hace' should be 'desde hacía' in past context.",
      
      // Overall Assessment
      overallAssessment: {
        proficiencyLevel: 'B1',
        confidence: 85,
        summary: 'Discussed going to the supermarket, meeting a friend, and declining coffee because already had too much.',
        progressFromLastLesson: 'Grammar accuracy decreased from 75% to 72%. Tense errors increased from 2 to 4.'
      },
      
      // Top Errors (Priority)
      topErrors: [
        {
          rank: 1,
          issue: 'Tense consistency',
          impact: 'high',
          occurrences: 8,
          teachingPriority: 'Focus on past tense forms, especially imperfect vs preterite'
        },
        {
          rank: 2,
          issue: 'Pronoun agreement',
          impact: 'medium',
          occurrences: 3,
          teachingPriority: 'Practice gender agreement with pronouns'
        }
      ],
      
      // Error Patterns (Detailed)
      errorPatterns: [
        {
          pattern: 'Tense consistency',
          frequency: 8,
          severity: 'high',
          examples: [
            {
              original: 'no la veo desde mucho tiempo',
              corrected: 'no la veía desde hacía mucho tiempo',
              explanation: 'The past tense "veía" should be used with "hacía" for past context.'
            },
            {
              original: 'yo quiso',
              corrected: 'yo quería',
              explanation: 'Corrected to the imperfect tense for expressing a past intention.'
            },
            {
              original: 'estaba muy llenado',
              corrected: 'estaba muy lleno',
              explanation: 'The adjective "lleno" (full) should be used instead of past participle "llenado".'
            }
          ],
          practiceNeeded: 'Focus on distinguishing between preterite and imperfect tenses in storytelling'
        },
        {
          pattern: 'Pronoun agreement',
          frequency: 3,
          severity: 'medium',
          examples: [
            {
              original: 'acompañarle',
              corrected: 'acompañarla',
              explanation: 'The pronoun should be feminine "la" to match "una amiga" (a female friend).'
            },
            {
              original: 'no miraba',
              corrected: 'no veía',
              explanation: 'The verb "ver" (to see) is more appropriate than "mirar" (to look at) in this context.'
            }
          ],
          practiceNeeded: 'Practice gender agreement with direct and indirect object pronouns'
        }
      ],
      
      // Corrected Excerpts (Before/After)
      correctedExcerpts: [
        {
          context: 'Talking about meeting a friend at the supermarket',
          original: 'me encontré con una amiga que no veía desde hace mucho tiempo y ella me preguntó si yo podía acompañarle a comprar unas cosas',
          corrected: 'me encontré con una amiga que no veía desde hacía mucho tiempo y ella me preguntó si yo podía acompañarla a comprar unas cosas',
          keyCorrections: ['desde hace → desde hacía', 'acompañarle → acompañarla']
        },
        {
          context: 'Describing a cold day at work',
          original: 'yo estaba caminando a trabajo y estaba muy frío como 10 grados',
          corrected: 'estaba caminando al trabajo y hacía mucho frío, como 10 grados',
          keyCorrections: ['a trabajo → al trabajo', 'estaba frío → hacía frío']
        }
      ],
      
      // Strengths
      strengths: [
        'Natural use of colloquialisms like "pues" and "o sea"',
        'Good use of vocabulary related to daily activities',
        'Ability to narrate events clearly',
        'Confident conversational flow and engagement',
        'Proper use of reflexive verbs in most contexts'
      ],
      
      // Areas for Improvement
      areasForImprovement: [
        'Tense consistency',
        'Pronoun agreement',
        'Preposition usage'
      ],
      
      // Grammar Analysis
      grammarAnalysis: {
        accuracyScore: 75,
        mistakeTypes: [
          {
            type: 'Tense Consistency',
            examples: ['yo quiso → quise', 'no la veo → no veía'],
            frequency: 8,
            severity: 'high'
          },
          {
            type: 'Pronoun Agreement',
            examples: ['acompañarle → acompañarla'],
            frequency: 3,
            severity: 'medium'
          }
        ],
        suggestions: ['Focus on past tense forms and practice with storytelling exercises.']
      },
      
      // Vocabulary Analysis
      vocabularyAnalysis: {
        uniqueWordCount: 80,
        vocabularyRange: 'moderate',
        suggestedWords: ['acordarse (to remember)', 'esperar (to wait)'],
        advancedWordsUsed: ['acompañar', 'urgente', 'encontrarse']
      },
      
      // Fluency Analysis
      fluencyAnalysis: {
        speakingSpeed: 'moderate',
        pauseFrequency: 'occasional',
        fillerWords: {
          count: 2,
          examples: ['uh-huh', 'ok']
        },
        overallFluencyScore: 70
      },
      
      // Pronunciation Assessment (NEW - Azure Speech)
      pronunciationAnalysis: {
        overallScore: 78,
        accuracyScore: 82,
        fluencyScore: 75,
        prosodyScore: 76,
        completenessScore: 85,
        mispronunciations: [
          {
            word: 'acompañarle',
            score: 45,
            errorType: 'Mispronunciation',
            problematicPhonemes: ['ñ', 'le']
          },
          {
            word: 'encontré',
            score: 58,
            errorType: 'Mispronunciation',
            problematicPhonemes: ['é']
          },
          {
            word: 'supermercado',
            score: 52,
            errorType: 'Mispronunciation',
            problematicPhonemes: ['r', 'c']
          }
        ],
        segmentsAssessed: 8,
        totalSegments: 40,
        targetLanguageSegments: 24,
        samplingRate: 0.20
      },
      
      // Recommendations
      topicsDiscussed: ['Going to the supermarket', 'Meeting a friend', 'Declining coffee'],
      conversationQuality: 'intermediate',
      recommendedFocus: ['Tense consistency', 'Pronoun agreement', 'Past perfect usage'],
      suggestedExercises: ['Practice storytelling focusing on past events', 'Exercises on pronoun agreement'],
      homeworkSuggestions: [
        'Write 3-4 sentences about the next time you plan to meet your friend, focusing on using the correct gender pronouns.'
      ],
      
      // Progression Metrics
      progressionMetrics: {
        previousProficiencyLevel: 'B1',
        proficiencyChange: 'maintained',
        errorRate: 1.2,
        errorRateChange: -0.3,
        vocabularyGrowth: 8,
        fluencyImprovement: 2,
        grammarAccuracyChange: -3,
        confidenceLevel: 7,
        speakingTimeMinutes: 12,
        complexSentencesUsed: 5,
        keyImprovements: [
          'Expanded vocabulary',
          'Improved confidence in speaking'
        ],
        persistentChallenges: [
          'Tense consistency',
          'Pronoun agreement'
        ]
      },
      
      lessonDate: new Date()
    };
  }

  async openSearchTutors() {
      this.router.navigate(['/tabs/tutor-search']);
  }

  navigateToTutorCalendar() {
    this.router.navigate(['/tabs/tutor-calendar']);
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
    // Force refresh from server to get latest settings
    this.userService.getCurrentUser(true).subscribe(user => {
      if (user) {
        console.log('💰 User profile data:', user.profile);
        // Load show wallet balance setting from database
        this.showWalletBalance = user?.profile?.showWalletBalance || false;
        console.log('💰 Loaded wallet balance setting:', this.showWalletBalance);
        
        // Update display property
        this.updateWalletDisplay();
      }
    });
  }
  
  // Update wallet display property
  private updateWalletDisplay(): void {
    this.walletDisplay = this.showWalletBalance 
      ? `$${this.walletBalance.toFixed(2)}` 
      : '$ • • • • •';
  }
  
  // Toggle wallet visibility temporarily (for mobile tap-to-reveal)
  toggleWalletVisibility(event: Event): void {
    // Only allow toggle on mobile/touch devices (non-hover devices)
    const isTouchDevice = !window.matchMedia('(hover: hover)').matches;
    if (!isTouchDevice) {
      return; // Exit early on desktop - let hover handle it
    }
    
    event.stopPropagation(); // Prevent navigation to wallet page
    if (!this.showWalletBalance) {
      this.walletTemporarilyVisible = !this.walletTemporarilyVisible;
      
      // Auto-hide after 3 seconds
      if (this.walletTemporarilyVisible) {
        setTimeout(() => {
          this.walletTemporarilyVisible = false;
        }, 3000);
      }
    }
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

  // Get formatted info about the next lesson for empty state display
  getNextLessonInfo(): { date: string; time: string; dayText: string } | null {
    const nextLesson = this.getNextLesson();
    if (!nextLesson) return null;
    
    const start = new Date(nextLesson.startTime);
    const now = new Date();
    const today = this.startOfDay(new Date());
    const lessonDay = this.startOfDay(start);
    const daysDiff = Math.floor((lessonDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    // Format time
    const time = start.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });
    
    // Determine day text
    let dayText = '';
    if (daysDiff === 0) {
      dayText = 'today';
    } else if (daysDiff === 1) {
      dayText = 'tomorrow';
    } else if (daysDiff < 7) {
      // Show weekday with date: "Monday, November 25"
      const weekday = start.toLocaleDateString('en-US', { weekday: 'long' });
      const date = start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      dayText = `${weekday}, ${date}`;
    } else {
      // Show month and day: "December 2"
      dayText = start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    }
    
    return {
      date: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      time,
      dayText
    };
  }

  // Format lesson time for display with clear when information
  formatLessonTime(lesson: Lesson): string {
    const start = new Date(lesson.startTime);
    const end = new Date(lesson.endTime);
    const now = new Date();
    
    const startTime = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const endTime = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    
    // Calculate relative date
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfLessonDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const daysDiff = Math.floor((startOfLessonDay.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));
    
    // Calculate hours until start for very soon classes
    const hoursUntilStart = (start.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    let whenText = '';
    
    // First check if it's today - prioritize showing "Today"
    if (daysDiff === 0) {
      // If it's today and starting very soon (within 2 hours), show countdown
      if (hoursUntilStart > 0 && hoursUntilStart <= 2) {
        const hours = Math.floor(hoursUntilStart);
        const minutes = Math.floor((hoursUntilStart - hours) * 60);
        if (hours > 0) {
          whenText = `Today • In ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
        } else if (minutes > 0) {
          whenText = `Today • In ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
        } else {
          whenText = 'Today • Starting now';
        }
      } else {
        whenText = 'Today';
      }
    } else if (daysDiff === 1) {
      whenText = 'Tomorrow';
    } else if (daysDiff > 1 && daysDiff < 7) {
      // Within the next week, show weekday name
      whenText = start.toLocaleDateString('en-US', { weekday: 'long' });
    } else {
      // Further out, show full date
      whenText = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    
    return `${whenText} • ${startTime} - ${endTime}`;
  }

  // Format subject to show language (e.g., "Spanish" -> "Spanish")
  formatSubject(subject: string): string {
    if (!subject || subject === 'Language Lesson') {
      return 'Language';
    }
    // Extract language name from subject (remove "Lesson" if present)
    return subject.replace(/ Lesson$/i, '').trim();
  }
  
  // Get just the time range portion (e.g., "2:00 PM - 3:00 PM")
  getTimeRangeOnly(lesson: Lesson): string {
    const start = new Date(lesson.startTime);
    const end = new Date(lesson.endTime);
    
    const startTime = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const endTime = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    
    return `${startTime} — ${endTime}`;
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
        const studentId = (l.studentId as any)?._id;
        if (!studentId) return; // Skip if no valid studentId
        
        const existing = studentLessonMap.get(studentId);
        
        // If no existing entry, or this lesson is earlier, use this lesson
        if (!existing || new Date(l.startTime) < new Date(existing.lesson.startTime)) {
          const studentData = l.studentId as any;
          if (!studentData) return; // Skip if studentData is null
          
          // Build full name from firstName and lastName if available
          let fullName = studentData?.name || studentData?.email || 'Student';
          if (studentData?.firstName && studentData?.lastName) {
            fullName = `${studentData.firstName} ${studentData.lastName}`;
          } else if (studentData?.firstName) {
            fullName = studentData.firstName;
          }
          
          studentLessonMap.set(studentId, {
            student: {
              id: studentId,
              name: fullName,
              firstName: studentData?.firstName,
              lastName: studentData?.lastName,
              profilePicture: studentData?.picture || studentData?.profilePicture || 'assets/avatar.png',
              email: studentData?.email,
              rating: studentData?.rating || 4.5,
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
        if (l.status !== 'scheduled' && l.status !== 'in_progress' && l.status !== 'pending_reschedule') return false;
        const startTime = new Date(l.startTime);
        const endTime = new Date(l.endTime);
        // Include lessons that are in progress (started but not ended yet)
        if (startTime <= now && now < endTime) {
          return true;
        }
        // Include lessons that haven't started yet (upcoming)
        return startTime > now;
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
    const students = Array.from(studentLessonMap.values())
      .filter(({ student }) => student != null) // Filter out any null students
      .map(({ student, lesson, isNext }) => {
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

  // Format student display name as "First L."
  formatStudentDisplayName(studentOrName: any): string {
    // Handle if it's a student object with firstName and lastName
    if (typeof studentOrName === 'object' && studentOrName) {
      const firstName = studentOrName.firstName;
      const lastName = studentOrName.lastName;
      
      if (firstName && lastName) {
        return `${this.capitalize(firstName)} ${lastName.charAt(0).toUpperCase()}.`;
      } else if (firstName) {
        return this.capitalize(firstName);
      }
      
      // Fall back to name field if firstName/lastName not available
      const rawName = studentOrName.name || studentOrName.email;
      if (!rawName) return 'Student';
      return this.formatStudentDisplayName(rawName); // Recursively handle the string
    }
    
    // Handle if it's just a string name
    const rawName = studentOrName;
    if (!rawName || typeof rawName !== 'string') {
      return 'Student';
    }

    const name = rawName.trim();

    // If it's an email, use the part before @ as a fallback
    if (name.includes('@')) {
      const base = name.split('@')[0];
      if (!base) return 'Student';
      const parts = base.split(/[.\s_]+/).filter(Boolean);
      const first = parts[0];
      const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : '';
      return lastInitial
        ? `${this.capitalize(first)} ${lastInitial.toUpperCase()}.`
        : this.capitalize(first);
    }

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
    return value.charAt(0).toUpperCase() + value.slice(1);
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
    return students.filter(s => s && !s.isNextClass); // Filter out null/undefined entries
  }

  // Check if there were completed lessons earlier today
  hadLessonsEarlierToday(): boolean {
    if (!this.selectedDate) {
      return false;
    }
    
    const now = new Date();
    const today = this.startOfDay(new Date());
    const selectedDay = this.startOfDay(this.selectedDate);
    const isToday = selectedDay.getTime() === today.getTime();
    
    // Only check for today
    if (!isToday) {
      return false;
    }
    
    // Check both current lessons and past lessons for today
    // (since this.lessons now only includes in-progress/upcoming, we need to check pastLessons too)
    const allLessonsToday = [
      ...this.lessons.filter(lesson => {
        const lessonDate = new Date(lesson.startTime);
        const lessonDay = this.startOfDay(lessonDate);
        return lessonDay.getTime() === selectedDay.getTime();
      }),
      ...this.pastLessons.filter(lesson => {
        const lessonDate = new Date(lesson.startTime);
        const lessonDay = this.startOfDay(lessonDate);
        return lessonDay.getTime() === selectedDay.getTime();
      })
    ];
    
    // Check if any lessons happened earlier today
    // A lesson counts as "earlier today" if:
    // 1. Status is 'completed', OR
    // 2. Its end time was in the past
    const completedLessonsToday = allLessonsToday.filter(l => {
      // Check if status is explicitly 'completed'
      if (l.status === 'completed') {
        return true;
      }
      
      // Also check if lesson time has passed (even if status isn't updated)
      const startTime = new Date(l.startTime);
      const endTime = l.endTime ? new Date(l.endTime) : new Date(startTime.getTime() + 60 * 60 * 1000); // Assume 1 hour if no end time
      
      // Check if lesson ended more than 10 minutes ago
      const graceMinutes = 10;
      const gracePeriodAgo = new Date(now.getTime() - graceMinutes * 60 * 1000);
      const hasEnded = endTime < gracePeriodAgo;
      
      return hasEnded;
    });
    
    return completedLessonsToday.length > 0;
  }

  // Get the absolute NEXT lesson (regardless of date) - used for "Up Next" card
  get nextLesson(): any | null {
    // Create a hash of the inputs to detect changes
    const lessonsHash = this.lessons.map(l => `${l._id}:${l.startTime}:${l.status}`).join(',');
    const currentHash = `next:${lessonsHash}:${Date.now() - (Date.now() % 60000)}`; // Update every minute
    
    // Return cached value if inputs haven't changed
    if (this._cachedFirstLessonHash === currentHash && this._cachedFirstLesson !== undefined) {
      return this._cachedFirstLesson;
    }
    
    // Compute and cache the result
    this._cachedFirstLessonHash = currentHash;
    this._cachedFirstLesson = this.computeNextLesson();
    return this._cachedFirstLesson;
  }

  // Get first lesson for the selected date (cached for performance) - used for timeline
  get firstLessonForSelectedDate(): any | null {
    // Create a hash of the inputs to detect changes
    const selectedDateStr = this.selectedDate ? this.selectedDate.toISOString() : 'null';
    const lessonsHash = this.lessons.map(l => `${l._id}:${l.startTime}:${l.status}`).join(',');
    const currentHash = `${selectedDateStr}:${lessonsHash}:${Date.now() - (Date.now() % 60000)}`; // Update every minute
    
    // Return cached value if inputs haven't changed
    if (this._cachedFirstLessonHash === currentHash && this._cachedFirstLesson !== undefined) {
      return this._cachedFirstLesson;
    }
    
    // Compute and cache the result
    this._cachedFirstLessonHash = currentHash;
    this._cachedFirstLesson = this.computeFirstLessonForSelectedDate();
    return this._cachedFirstLesson;
  }
  
  // Getter for first cancelled lesson (for card display when viewing cancelled tab)
  get firstCancelledLesson(): any | null {
    if (!this.cancelledLessons || this.cancelledLessons.length === 0) {
      return null;
    }
    
    // Get the most recent cancelled lesson
    const cancelledLesson = this.cancelledLessons[0];
    
    // Format it the same way as firstLessonForSelectedDate
    return {
      lesson: cancelledLesson,
      lessonId: cancelledLesson._id,
      isInProgress: false,
      isNextClass: false,
      dateTag: this.formatClassDate(cancelledLesson.startTime)
    };
  }
  
  // Internal method to compute the absolute next lesson (regardless of date)
  private computeNextLesson(): any | null {
    const now = new Date();
    const today = this.startOfDay(new Date());
    
    // Get ALL upcoming/active lessons (across all dates)
    const allUpcomingLessons = this.lessons
      .filter(l => {
        if (l.status !== 'scheduled' && l.status !== 'in_progress' && l.status !== 'pending_reschedule') return false;
        const startTime = new Date(l.startTime);
        const endTime = new Date(l.endTime);
        // Include lessons that are in progress (started but not ended yet)
        if (startTime <= now && now < endTime) {
          return true;
        }
        // Include lessons that haven't started yet (upcoming)
        return startTime > now;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    if (allUpcomingLessons.length === 0) {
      return null;
    }
    
    const nextLesson = allUpcomingLessons[0];
    const lessonDate = new Date(nextLesson.startTime);
    const lessonDay = this.startOfDay(lessonDate);
    const isToday = lessonDay.getTime() === today.getTime();
    
    // Handle both classes and regular lessons
    let student: any = null;
    if ((nextLesson as any).isClass) {
      // For classes, show class info
      student = {
        id: String(nextLesson._id),
        name: (nextLesson as any).className || nextLesson.subject || 'Class',
        profilePicture: 'assets/avatar.png',
        email: '',
        rating: 0,
        isClass: true
      };
    } else if (nextLesson.studentId && typeof nextLesson.studentId === 'object') {
      // For regular lessons, show student info
      const studentData = nextLesson.studentId as any;
      // Build full name from firstName and lastName if available, otherwise use name field
      let fullName = studentData.name || studentData.email;
      if (studentData.firstName && studentData.lastName) {
        fullName = `${studentData.firstName} ${studentData.lastName}`;
      } else if (studentData.firstName) {
        fullName = studentData.firstName;
      }
      
      student = {
        id: studentData._id,
        name: fullName,
        firstName: studentData.firstName,
        lastName: studentData.lastName,
        profilePicture: studentData.picture || studentData.profilePicture || 'assets/avatar.png',
        email: studentData.email,
        rating: studentData.rating || 4.5,
      };
    }
    
    const dateTag = this.getDateTag(lessonDate);
    const isInProgress = this.isLessonInProgress(nextLesson);
    
    // Precompute reschedule flags to avoid function calls in template
    const isRescheduleProposer = this.isRescheduleProposer(nextLesson);
    const rescheduleAccepted = (nextLesson as any).rescheduleProposal?.status === 'accepted';
    
    return {
      ...student,
      lessonId: String(nextLesson._id),
      lesson: nextLesson,
      lessonTime: this.formatLessonTime(nextLesson),
      subject: this.formatSubject(nextLesson.subject),
      dateTag: dateTag,
      isToday: isToday,
      isNextClass: true, // This is always the next class
      isInProgress: isInProgress,
      startTime: nextLesson.startTime,
      joinLabel: this.calculateJoinLabel(nextLesson),
      isRescheduleProposer: isRescheduleProposer,
      rescheduleAccepted: rescheduleAccepted
    };
  }
  
  // Internal method to compute first lesson (called by cached getter)
  private computeFirstLessonForSelectedDate(): any | null {
    if (!this.selectedDate) {
      return null;
    }
    
    const now = new Date();
    const today = this.startOfDay(new Date());
    const selectedDay = this.startOfDay(this.selectedDate);
    const isToday = selectedDay.getTime() === today.getTime();
    
    // Get all lessons for the selected date
    const lessonsForDate = this.lessonsForSelectedDate();
    
    // Filter for upcoming/active lessons (include pending_reschedule)
    const activeLessons = lessonsForDate.filter(l => {
      if (l.status !== 'scheduled' && l.status !== 'in_progress' && l.status !== 'pending_reschedule') return false;
      const startTime = new Date(l.startTime);
      const endTime = new Date(l.endTime);
      // Include lessons that are in progress (started but not ended yet)
      if (startTime <= now && now < endTime) {
        return true;
      }
      // Include lessons that haven't started yet (upcoming)
      return startTime > now;
    }).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    if (activeLessons.length === 0) {
      return null;
    }
    
    const firstLesson = activeLessons[0];
    
    // Check if this is the actual next class across ALL dates
    const allUpcomingLessons = this.lessons
      .filter(l => {
        if (l.status !== 'scheduled' && l.status !== 'in_progress' && l.status !== 'pending_reschedule') return false;
        const startTime = new Date(l.startTime);
        const endTime = new Date(l.endTime);
        // Include lessons that are in progress (started but not ended yet)
        if (startTime <= now && now < endTime) {
          return true;
        }
        // Include lessons that haven't started yet (upcoming)
        return startTime > now;
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
      const studentData = firstLesson.studentId as any;
      // Build full name from firstName and lastName if available, otherwise use name field
      let fullName = studentData.name || studentData.email;
      if (studentData.firstName && studentData.lastName) {
        fullName = `${studentData.firstName} ${studentData.lastName}`;
      } else if (studentData.firstName) {
        fullName = studentData.firstName;
      }
      
      student = {
        id: studentData._id,
        name: fullName,
        firstName: studentData.firstName,
        lastName: studentData.lastName,
        profilePicture: studentData.picture || studentData.profilePicture || 'assets/avatar.png',
        email: studentData.email,
        rating: studentData.rating || 4.5,
      };
    }
    
    const lessonDate = new Date(firstLesson.startTime);
    const dateTag = this.getDateTag(lessonDate);
    const isInProgress = this.isLessonInProgress(firstLesson);
    
    // Precompute reschedule flags to avoid function calls in template
    const isRescheduleProposer = this.isRescheduleProposer(firstLesson);
    const rescheduleAccepted = (firstLesson as any).rescheduleProposal?.status === 'accepted';
    
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
      joinLabel: this.calculateJoinLabel(firstLesson),
      isRescheduleProposer: isRescheduleProposer,
      rescheduleAccepted: rescheduleAccepted
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

  // Get time until lesson starts (e.g., "55 minutes", "2h 30m")
  // Or elapsed time if already started (e.g., "5m ago", "1h 15m ago")
  getTimeUntilLesson(lesson: any): string {
    if (!lesson) return '';
    
    const now = new Date();
    const startTime = new Date(lesson.startTime);
    const diffMs = startTime.getTime() - now.getTime();
    
    // If lesson has started, show elapsed time
    if (diffMs < 0) {
      const elapsedMs = Math.abs(diffMs);
      const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));
      const hours = Math.floor(elapsedMinutes / 60);
      const minutes = elapsedMinutes % 60;
      
      if (hours > 0) {
        if (minutes > 0) {
          return `${hours}h ${minutes}m ago`;
        }
        return `${hours}h ago`;
      }
      
      if (minutes === 0) {
        return 'just now';
      }
      
      return `${minutes}m ago`;
    }
    
    // Lesson hasn't started yet
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    
    if (hours > 0) {
      if (minutes > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${hours}h`;
    }
    
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
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
    return this.getDisplayLessons();
  }

  // Track by function for tutors
  trackByTutorId(index: number, tutor: { id: string; name: string; picture?: string }): string {
    return tutor.id;
  }

  // Get timeline events for "Coming Up Next" section (cached for performance)
  get timelineEvents(): any[] {
    // Create a hash of the inputs to detect changes
    const lessonsHash = this.lessons.map(l => `${l._id}:${l.startTime}`).join(',');
    const cancelledHash = this.cancelledLessons.map(l => `${l._id}:${l.startTime}`).join(',');
    const nextLessonId = this.nextLesson?.lessonId || 'null';
    const currentHash = `${lessonsHash}:${cancelledHash}:${nextLessonId}:${this.lessonView}:${Date.now() - (Date.now() % 60000)}`; // Update every minute
    
    // Return cached value if inputs haven't changed
    if (this._cachedTimelineEventsHash === currentHash && this._cachedTimelineEvents.length >= 0) {
      return this._cachedTimelineEvents;
    }
    
    // Compute and cache the result
    this._cachedTimelineEventsHash = currentHash;
    this._cachedTimelineEvents = this.computeTimelineEvents();
    return this._cachedTimelineEvents;
  }
  
  // Internal method to compute timeline events (called by cached getter)
  private computeTimelineEvents(): any[] {
    // When showing cancelled view, show cancelled lessons
    if (this.lessonView === 'cancelled') {
      const now = new Date();
      const result = this.cancelledLessons
        .slice(0, 10) // Show up to 10 cancelled lessons
        .map(lesson => {
          const startTime = new Date(lesson.startTime);
          const endTime = lesson.endTime ? new Date(lesson.endTime) : null;
          const student = lesson.studentId as any;
          const isClass = (lesson as any).isClass;
          
          return {
            time: this.formatTimeOnly(startTime),
            endTime: endTime ? this.formatTimeOnly(endTime) : null,
            date: this.formatRelativeDate(startTime),
            name: isClass 
              ? ((lesson as any).className || lesson.subject || 'Group Class')
              : (student ? this.formatStudentDisplayName(student) : 'Unknown'),
            subject: isClass 
              ? 'Group Class'
              : this.formatSubject(lesson.subject),
            avatar: isClass 
              ? ((lesson as any).classData?.thumbnail || null)
              : (student?.picture || student?.profilePicture || null),
            lesson: lesson,
            isTrialLesson: lesson.isTrialLesson || false,
            isCancelled: true,
            cancelReason: lesson.cancelReason,
            isRescheduleProposer: false,
            rescheduleAccepted: false
          };
        });
      return result;
    }
    
    // Regular upcoming lessons view - includes cancelled lessons in timeline
    // Combine upcoming lessons and cancelled lessons, then sort by start time
    const allLessonsForTimeline = [...this.lessons, ...this.cancelledLessons];
    const now = new Date();
    
    // Get the next class being shown in the "Up Next" card (if tutor view)
    const nextClassLesson = this.isTutor() ? this.nextLesson : null;
    // Get the lesson ID - it could be in lessonId, lesson._id, or the lesson object itself
    const nextClassLessonId = nextClassLesson?.lessonId || 
                              nextClassLesson?.lesson?._id || 
                              (nextClassLesson?.lesson && String(nextClassLesson.lesson._id));
    
    // Filter and sort all lessons for timeline
    return allLessonsForTimeline
      .filter(lesson => {
        // Exclude if it's in the past
        if (new Date(lesson.startTime) <= now) return false;
        // Exclude if it's the next class being shown in the "Up Next" card
        if (nextClassLessonId && String(lesson._id) === String(nextClassLessonId)) return false;
        return true;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()) // Sort by time
      .slice(0, 3) // Get next 3 items
      .map(lesson => {
        const startTime = new Date(lesson.startTime);
        const endTime = lesson.endTime ? new Date(lesson.endTime) : null;
        const student = lesson.studentId as any;
        const isClass = (lesson as any).isClass;
        const isCancelled = lesson.status === 'cancelled';
        
        // Precompute reschedule flags
        const isRescheduleProposer = this.isRescheduleProposer(lesson);
        const rescheduleAccepted = lesson.rescheduleProposal?.status === 'accepted';
        
        return {
          time: this.formatTimeOnly(startTime),
          endTime: endTime ? this.formatTimeOnly(endTime) : null,
          date: this.formatRelativeDate(startTime),
          name: isClass 
            ? ((lesson as any).className || lesson.subject || 'Group Class')
            : (student ? this.formatStudentDisplayName(student) : 'Unknown'),
          subject: isClass 
            ? 'Group Class'
            : this.formatSubject(lesson.subject),
          avatar: isClass 
            ? ((lesson as any).classData?.thumbnail || null) // Show class thumbnail if available
            : (student?.picture || student?.profilePicture || null),
          lesson: lesson,
          isTrialLesson: lesson.isTrialLesson || false,
          isCancelled: isCancelled,
          cancelReason: isCancelled ? lesson.cancelReason : null,
          isRescheduleProposer: isRescheduleProposer,
          rescheduleAccepted: rescheduleAccepted
        };
      });
  }

  hasMoreTimelineEvents(): boolean {
    const allLessons = [...this.lessons, ...this.cancelledLessons];
    const now = new Date();
    const futureLessons = allLessons.filter(lesson => new Date(lesson.startTime) > now);
    
    // Get the next class being shown in the "Up Next" card
    const nextClassLesson = this.isTutor() ? this.nextLesson : null;
    const nextClassLessonId = nextClassLesson?.lessonId || 
                              nextClassLesson?.lesson?._id || 
                              (nextClassLesson?.lesson && String(nextClassLesson.lesson._id));
    
    // Filter out the next class from count
    const timelineLessons = futureLessons.filter(lesson => {
      if (nextClassLessonId && String(lesson._id) === String(nextClassLessonId)) return false;
      return true;
    });
    
    return timelineLessons.length > 3;
  }

  /**
   * Open modal to display lesson notes
   */
  async openNotesModal(lesson: any) {
    try {
      // Notes are stored as plain text with \n line breaks
      // Use a modal component instead of alert to properly render formatted text
      const modal = await this.modalCtrl.create({
        component: NotesModalComponent,
        componentProps: {
          lesson: lesson,
          notes: lesson.notes || 'No notes available for this lesson.',
          subject: lesson.subject || 'Lesson',
          time: this.formatLessonTime(lesson)
        },
        cssClass: 'notes-modal-component'
      });
      await modal.present();
    } catch (error) {
      console.error('Error opening notes modal:', error);
      // Fallback to simple alert
      const alert = await this.alertController.create({
        header: 'Lesson Notes',
        subHeader: `${lesson.subject || 'Lesson'} - ${this.formatLessonTime(lesson)}`,
        message: lesson.notes || 'No notes available',
        buttons: ['Close']
      });
      await alert.present();
    }
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
    // Navigate to pre-call page - let pre-call handle the join logic
    const now = new Date();
    const startTime = new Date(lesson.startTime);
    const canJoin = this.canJoinLessonByTime(startTime);
    
    if (canJoin) {
      this.joinLessonById(lesson);
    }
  }

  // Helper to navigate to pre-call for lesson or class
  async joinLessonById(lesson: Lesson) {
    const isClass = (lesson as any).isClass;
    const role = this.isTutor() ? 'tutor' : 'student';
    
    console.log('🎯 TAB1: Navigating to pre-call:', {
      sessionId: lesson._id,
      isClass: isClass,
      role: role
    });
    
    // Navigate directly to pre-call - don't call backend join yet
    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: lesson._id,
        role: role,
        lessonMode: 'true',
        isClass: isClass ? 'true' : 'false'
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
  getPresenceAvatar(lesson: Lesson | null): string | null {
    if (!lesson) return null;
    const presence = this.getPresenceData(lesson);
    if (presence?.participantPicture) {
      return presence.participantPicture;
    }
    return this.getOtherParticipantAvatar(lesson);
  }

  getOtherParticipantAvatar(lesson: Lesson): string | null {
    if (!this.currentUser || !lesson) return null;
    
    // Classes don't have a single participant avatar
    if ((lesson as any).isClass) {
      return null;
    }
    
    // Use lesson ID + participant ID as cache key
    // Safely check if current user is the tutor
    // Handle case where tutorId/studentId might be a string ID or an object
    let tutorId: string | null = null;
    if (lesson.tutorId) {
      if (typeof lesson.tutorId === 'string') {
        tutorId = lesson.tutorId;
      } else if (typeof lesson.tutorId === 'object' && lesson.tutorId !== null) {
        tutorId = (lesson.tutorId as any)?._id || (lesson.tutorId as any)?.id || null;
      }
    }
    
    const isTutor = tutorId && this.currentUser?.id ? tutorId === this.currentUser.id : false;
    
    let participantId: string | null = null;
    if (isTutor) {
      // Get student ID
      if (lesson.studentId) {
        if (typeof lesson.studentId === 'string') {
          participantId = lesson.studentId;
        } else if (typeof lesson.studentId === 'object' && lesson.studentId !== null) {
          participantId = (lesson.studentId as any)?._id || (lesson.studentId as any)?.id || null;
        }
      }
    } else {
      participantId = tutorId;
    }
    
    if (!participantId) return null; // No valid participant ID
    
    const cacheKey = `${lesson._id}-${participantId}`;
    
    // Return cached value if available
    if (this._avatarCache.has(cacheKey)) {
      return this._avatarCache.get(cacheKey)!;
    }
    
    // Calculate and cache the avatar URL
    const other = isTutor ? lesson.studentId : lesson.tutorId;
    let avatarUrl: string | null = null;
    
    // Safely access picture property - handle both object and string ID cases
    if (other != null && typeof other === 'object' && other !== null) {
      // other is an object with potential picture property
      avatarUrl = (other as any)?.picture || (other as any)?.profilePicture || null;
    }
    // If other is a string ID, we can't get the picture from it directly
    // (would need to fetch user data, but that's handled elsewhere)
    
    // Cache the result
    this._avatarCache.set(cacheKey, avatarUrl);
    
    return avatarUrl;
  }

  // New method: Get other participant's specialty
  getOtherParticipantSpecialty(lesson: Lesson): string {
    if (!this.currentUser) return 'Language Learning';
    
    // Handle classes
    if ((lesson as any).isClass) {
      return 'Group Class';
    }
    
    const isTutor = lesson.tutorId?._id === this.currentUser.id;
    
    if (isTutor) {
      return 'Language Student';
    } else {
      const tutor = lesson.tutorId;
      if (typeof tutor === 'object' && tutor) {
        return (tutor as any)?.specialty || 'Language Tutor';
      }
      return 'Language Tutor';
    }
  }

  async loadLessons(showSkeleton = true) {
    console.log('📊 [TAB1] loadLessons called - showSkeleton:', showSkeleton, 'isLoadingLessons:', this.isLoadingLessons);
    
    // Only show skeleton loader if explicitly requested (e.g., initial load)
    if (showSkeleton) {
      this.isLoadingLessons = true;
      console.log('⏳ [TAB1] Showing skeleton loader');
    }
    
    try {
      const resp = await this.lessonService.getMyLessons().toPromise();
      if (resp?.success) {
        const now = Date.now();
        let allLessons = [...resp.lessons];

        // For tutors, also load classes with attendee information
        if (this.isTutor()) {
          const tutorId = (this.currentUser as any)?._id || (this.currentUser as any)?.id;
          if (tutorId) {
            try {
              const classesResp = await this.classService.getClassesForTutor(tutorId).toPromise();
              if (classesResp?.success && classesResp.classes) {
                // Convert classes to lesson-like objects with attendee info
                const classLessons = classesResp.classes.map((cls: any) => ({
                  _id: cls._id,
                  tutorId: tutorId,
                  studentId: null as any, // Classes don't have a single student
                  startTime: cls.startTime,
                  endTime: cls.endTime,
                  status: cls.status || 'scheduled', // Use actual class status
                  subject: cls.name || 'Class',
                  channelName: `class_${cls._id}`,
                  price: cls.price || 0,
                  duration: Math.round((new Date(cls.endTime).getTime() - new Date(cls.startTime).getTime()) / 60000),
                  createdAt: cls.createdAt || new Date(),
                  updatedAt: cls.updatedAt || new Date(),
                  isClass: true, // Mark as class to differentiate
                  className: cls.name,
                  classData: cls, // Store full class data including attendees
                  attendees: cls.attendees || [], // Confirmed students who are going
                  capacity: cls.capacity,
                  invitationStats: cls.invitationStats,
                  cancelReason: cls.cancelReason // Include cancel reason
                } as any));
                
                // Merge classes with lessons
                allLessons = [...allLessons, ...classLessons];
              }
            } catch (error) {
              console.error('Error loading tutor classes:', error);
            }
          }
        }

        // For students, also load their accepted/confirmed classes
        if (!this.isTutor()) {
          try {
            const classesResp = await this.classService.getAcceptedClasses().toPromise();
            if (classesResp?.success && classesResp.classes) {
              // Convert accepted classes to lesson-like objects
              const classLessons = classesResp.classes.map((cls: any) => ({
                _id: cls._id,
                tutorId: cls.tutorId, // Already populated with tutor details
                studentId: null as any, // Classes don't have a single student
                startTime: cls.startTime,
                endTime: cls.endTime,
                status: cls.status || 'scheduled', // Use actual class status
                subject: cls.name || 'Class',
                channelName: `class_${cls._id}`,
                price: cls.price || 0,
                duration: Math.round((new Date(cls.endTime).getTime() - new Date(cls.startTime).getTime()) / 60000),
                createdAt: cls.createdAt || new Date(),
                updatedAt: cls.updatedAt || new Date(),
                isClass: true, // Mark as class to differentiate
                className: cls.name,
                classData: cls, // Store full class data
                attendees: cls.confirmedStudents || [], // Other confirmed students
                capacity: cls.capacity,
                cancelReason: cls.cancelReason // Include cancel reason
              } as any));
              
              // Merge classes with lessons
              allLessons = [...allLessons, ...classLessons];
            }
          } catch (error) {
            console.error('Error loading student classes:', error);
          }
        }

        // Filter for upcoming lessons + lessons from today (even if completed)
        const today = this.startOfDay(new Date());
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
        
        // Separate cancelled lessons (show recent and future cancellations)
        this.cancelledLessons = allLessons
          .filter(l => {
            if (l.status !== 'cancelled') return false;
            const lessonTime = new Date(l.startTime).getTime();
            // Show cancelled lessons from last 7 days or future
            return lessonTime >= sevenDaysAgo.getTime();
          })
          .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
        
        // Filter for active (non-cancelled) lessons
        this.lessons = allLessons
          .filter(l => {
            // Exclude cancelled lessons (they go to cancelledLessons array)
            if (l.status === 'cancelled') {
              return false;
            }
            
            const endTime = new Date(l.endTime).getTime();
            const lessonDate = new Date(l.startTime);
            const lessonDay = this.startOfDay(lessonDate);
            
            // Keep if: upcoming OR happened today
            const isUpcoming = endTime >= now;
            const isToday = lessonDay.getTime() === today.getTime();
            
            return isUpcoming || isToday;
          })
          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

        // Filter for past/completed lessons (for students to show past tutors)
        // Include lessons that have ended and are not cancelled
        this.pastLessons = [...resp.lessons]
          .filter(l => {
            const endTime = new Date(l.endTime).getTime();
            return endTime < now && l.status !== 'cancelled';
          })
          .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());

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
        } else {
          this.pastTutors = [];
        }

        // Clear avatar cache when lessons reload to get fresh images
        this._avatarCache.clear();
        
        // Clear computed caches to force recalculation with new data
        this._cachedFirstLessonHash = '';
        this._cachedFirstLesson = undefined;
        this._cachedTimelineEventsHash = '';
        this._cachedTimelineEvents = [];

        // Set upcoming lesson (most relevant: in progress, next upcoming, or most recent)
        // Reuse 'now' variable already declared at the top of this function
        this.upcomingLesson = this.selectMostRelevantLesson(now);
        
        // Check for existing presence in lessons
        await this.checkExistingPresence();
        
        // Refresh availability summary with the latest lessons
        this.updateAvailabilitySummary();
        
        // Update tutor insights if tutor
        if (this.isTutor()) {
          this.loadTutorInsights();
        }
        
        // Mark that we've loaded data and update cache timestamp
        this._hasInitiallyLoaded = true;
        this._lastDataFetch = Date.now();
        console.log('✅ [TAB1] Lessons loaded successfully, cache updated');
      } else {
        this.lessons = [];
      }
    } catch (err) {
      console.error('Tab1Page: Failed to load lessons', err);
      this.lessons = [];
    } finally {
      if (showSkeleton) {
        this.isLoadingLessons = false;
        console.log('✅ [TAB1] Skeleton hidden');
      }
    }
  }

  /**
   * Handle class cancellation via websocket without full page reload
   * This moves the class from lessons to cancelledLessons array seamlessly
   */
  private async handleClassCancellation(classId: string, cancelReason?: string) {
    console.log('🔄 [TAB1] Handling class cancellation via websocket:', classId);
    
    // Find the class in the lessons array
    const classIndex = this.lessons.findIndex(l => l._id === classId);
    
    if (classIndex !== -1) {
      // Get the class and update its status
      const cancelledClass = { ...this.lessons[classIndex] };
      cancelledClass.status = 'cancelled';
      if (cancelReason) {
        (cancelledClass as any).cancelReason = cancelReason;
      }
      
      // Remove from lessons array
      this.lessons = this.lessons.filter(l => l._id !== classId);
      
      // Add to cancelled lessons at the beginning (most recent first)
      this.cancelledLessons = [cancelledClass, ...this.cancelledLessons];
      
      // Update upcoming lesson if this was it
      if (this.upcomingLesson && this.upcomingLesson._id === classId) {
        this.upcomingLesson = this.selectMostRelevantLesson(Date.now());
      }
      
      // Clear computed caches to force recalculation
      this._cachedFirstLessonHash = '';
      this._cachedFirstLesson = undefined;
      this._cachedTimelineEventsHash = '';
      this._cachedTimelineEvents = [];
      
      // Update tutor insights
      if (this.isTutor()) {
        this.loadTutorInsights();
      }
      
      console.log('✅ [TAB1] Class moved to cancelled without reload');
    } else {
      // If not found in current lessons, do a background refresh to sync
      console.log('⚠️ [TAB1] Class not found in current lessons, doing background refresh');
      await this.loadLessons(false); // Don't show skeleton
    }
  }

  /**
   * Handle lesson cancellation via websocket without full page reload
   * This moves the lesson from lessons to cancelledLessons array seamlessly
   */
  private async handleLessonCancellation(lessonId: string) {
    console.log('🔄 [TAB1] Handling lesson cancellation via websocket:', lessonId);
    
    // Find the lesson in the lessons array
    const lessonIndex = this.lessons.findIndex(l => l._id === lessonId);
    
    if (lessonIndex !== -1) {
      // Get the lesson and update its status
      const cancelledLesson = { ...this.lessons[lessonIndex] };
      cancelledLesson.status = 'cancelled';
      
      // Remove from lessons array
      this.lessons = this.lessons.filter(l => l._id !== lessonId);
      
      // Add to cancelled lessons at the beginning (most recent first)
      this.cancelledLessons = [cancelledLesson, ...this.cancelledLessons];
      
      // Update upcoming lesson if this was it
      if (this.upcomingLesson && this.upcomingLesson._id === lessonId) {
        this.upcomingLesson = this.selectMostRelevantLesson(Date.now());
      }
      
      // Clear computed caches to force recalculation
      this._cachedFirstLessonHash = '';
      this._cachedFirstLesson = undefined;
      this._cachedTimelineEventsHash = '';
      this._cachedTimelineEvents = [];
      
      // Update tutor insights
      if (this.isTutor()) {
        this.loadTutorInsights();
      }
      
      console.log('✅ [TAB1] Lesson moved to cancelled without reload');
    } else {
      // If not found in current lessons, do a background refresh to sync
      console.log('⚠️ [TAB1] Lesson not found in current lessons, doing background refresh');
      await this.loadLessons(false); // Don't show skeleton
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
      // Skip classes - they don't exist in the lessons API
      if ((lesson as any).isClass) {
        continue;
      }
      
      try {
        // Get detailed lesson info with participants
        const lessonResponse = await this.lessonService.getLesson(lesson._id).toPromise();
        if (lessonResponse?.success && lessonResponse.lesson?.participants) {
          const detailedLesson = lessonResponse.lesson;
          
          // Determine who the other participant is
          const isTutor = this.currentUser.userType === 'tutor';
          
          // Safely get the other participant ID
          let otherParticipantId: string | undefined = undefined;
          if (isTutor) {
            const student = detailedLesson.studentId;
            if (student && typeof student === 'object') {
              otherParticipantId = (student as any)?._id || (student as any)?.id;
            }
          } else {
            const tutor = detailedLesson.tutorId;
            if (tutor && typeof tutor === 'object') {
              otherParticipantId = (tutor as any)?._id || (tutor as any)?.id;
            }
          }
          
          if (otherParticipantId && detailedLesson.participants) {
            const otherParticipantKey = String(otherParticipantId);
            const participantData = detailedLesson.participants[otherParticipantKey];
            
            // If the other participant has joined and hasn't left
            if (participantData && participantData.joinedAt && !participantData.leftAt) {
              
              // Set presence in our map
              const normalizedLessonId = String(lesson._id);
              
              // Safely get participant picture
              let participantPicture: string | undefined = undefined;
              if (isTutor) {
                const student = detailedLesson.studentId;
                if (student && typeof student === 'object') {
                  participantPicture = (student as any)?.picture || (student as any)?.profilePicture;
                }
              } else {
                const tutor = detailedLesson.tutorId;
                if (tutor && typeof tutor === 'object') {
                  participantPicture = (tutor as any)?.picture || (tutor as any)?.profilePicture;
                }
              }
              
              this.lessonPresence.set(normalizedLessonId, {
                participantName: isTutor 
                  ? (detailedLesson.studentId && typeof detailedLesson.studentId === 'object' 
                      ? (detailedLesson.studentId as any)?.name || 'Student'
                      : 'Student')
                  : (detailedLesson.tutorId && typeof detailedLesson.tutorId === 'object'
                      ? (detailedLesson.tutorId as any)?.name || 'Tutor'
                      : 'Tutor'),
                participantPicture: participantPicture,
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
    
    // Handle classes
    if ((lesson as any).isClass) {
      return (lesson as any).className || lesson.subject || 'Group Class';
    }
    
    const isTutor = lesson.tutorId?._id === this.currentUser.id;
    const other = isTutor ? lesson.studentId : lesson.tutorId;
    
    if (typeof other === 'object' && other) {
      return (other as any)?.name || (other as any)?.email || 'Unknown';
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

  // Helper to check if any lesson can be joined
  canJoinLesson(lesson: Lesson): boolean {
    if (!lesson) return false;
    if (this.isLessonInProgress(lesson)) return true;
    return this.lessonService.canJoinLesson(lesson);
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

  /**
   * Check if a lesson has started (and therefore cannot be rescheduled)
   */
  hasLessonStarted(lesson: Lesson): boolean {
    // Reference countdownTick to trigger change detection updates
    void this.countdownTick;
    
    if (!lesson) return false;
    
    const status = (lesson as any)?.status;
    
    // Cannot reschedule if lesson is in progress, completed, or cancelled
    if (status === 'in_progress' || status === 'completed' || status === 'cancelled') {
      return true;
    }
    
    // Cannot reschedule if the start time has passed
    const now = new Date();
    const startTime = new Date(lesson.startTime);
    
    return now >= startTime;
  }

  getUserRole(lesson: Lesson): 'tutor' | 'student' {
    if (!this.currentUser) return 'student';
    return lesson.tutorId._id === this.currentUser.id ? 'tutor' : 'student';
  }

  async joinUpcomingLesson() {
    if (!this.upcomingLesson || !this.currentUser) return;
    
    const role = this.getUserRole(this.upcomingLesson);
    const isClass = (this.upcomingLesson as any).isClass || false;
    
    console.log('🎯 TAB1: Joining upcoming session:', {
      sessionId: this.upcomingLesson._id,
      isClass: isClass,
      role: role
    });
    
    // Navigate to pre-call page first
    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: this.upcomingLesson._id,
        role,
        lessonMode: 'true',
        isClass: isClass ? 'true' : 'false'
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
    // Clear cached computations when date changes
    this._cachedFirstLessonHash = '';
    this.cachedStudentsDate = null;
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

  // Get current user's picture directly from database
  get currentUserPicture(): string | null {
    return this.currentUser?.picture || null;
  }

  // Check if user has a profile picture from the database
  get hasUserPicture(): boolean {
    const hasPicture = !!this.currentUser?.picture;
    return hasPicture;
  }

  // Get user's first initial for avatar fallback
  get userInitial(): string {
    if (this.currentUser?.firstName) {
      return this.currentUser.firstName.charAt(0).toUpperCase();
    }
    if (this.currentUser?.name) {
      return this.currentUser.name.charAt(0).toUpperCase();
    }
    return '?';
  }

  // Debug methods for avatar loading
  onAvatarError(event: any) {
    console.error('❌ Avatar image failed to load:', {
      src: event.target?.src,
      currentUserPicture: this.currentUser?.picture,
      areEqual: event.target?.src === this.currentUser?.picture,
      srcLength: event.target?.src?.length,
      pictureLength: this.currentUser?.picture?.length,
      errorType: event.type,
      error: event
    });
    
    // Try to diagnose the issue
    if (this.currentUser?.picture) {
      const img = new Image();
      img.onerror = (e) => console.error('❌ Manual image test failed for:', this.currentUser?.picture, e);
      img.src = this.currentUser.picture;
    }
  }

  onAvatarLoad(event: any) {
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
    this.userService.getCurrentUser().pipe(
      observeOn(asyncScheduler) // Make emissions async to prevent freezing
    ).subscribe(user => {
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
    const isClass = (lesson as any).isClass || false;
    
    // Navigate to pre-call page first
    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: lesson._id,
        role: 'tutor',
        lessonMode: 'true',
        isClass: isClass ? 'true' : 'false'
      }
    });
  }

  messageStudent(student: any) {
    // TODO: Implement message functionality
  }

  async openMobileLessonMenu(event: Event, lesson: Lesson) {
    event.stopPropagation();
    
    if (!lesson) {
      return;
    }

    const isClass = lesson.isClass || false;
    const itemId = lesson._id || (lesson.classData?._id);
    if (!itemId) {
      console.error('Lesson/Class ID not found');
      return;
    }

    // Use Action Sheet for mobile
    const buttons: any[] = [];
    
    // Only show "Invite Student" for classes
    if (isClass) {
      buttons.push({
        text: 'Invite Student',
        icon: 'person-add-outline',
        handler: () => {
          this.inviteStudentToClass(itemId);
        }
      });
    }
    
    // Check if lesson has started
    const lessonStarted = this.hasLessonStarted(lesson);
    
    // Only add Reschedule button if lesson hasn't started
    if (!lessonStarted) {
      buttons.push({
        text: 'Reschedule',
        icon: 'calendar-outline',
        handler: () => {
          // Return true to dismiss action sheet immediately, then handle action
          setTimeout(() => {
            if (isClass) {
              this.rescheduleClass(itemId, lesson);
            } else {
              this.rescheduleLesson(itemId, lesson);
            }
          }, 100); // Wait for action sheet to fully dismiss
          return true; // Dismiss action sheet
        }
      });
    }
    
    buttons.push(
      {
        text: 'Cancel',
        icon: 'close-circle-outline',
        role: 'destructive',
        handler: () => {
          // Return true to dismiss action sheet immediately, then handle action
          setTimeout(() => {
            if (isClass) {
              this.cancelClass(itemId, lesson);
            } else {
              this.cancelLesson(itemId, lesson);
            }
          }, 100); // Wait for action sheet to fully dismiss
          return true; // Dismiss action sheet
        }
      },
      {
        text: 'Close',
        icon: 'close',
        role: 'cancel'
      }
    );

    const actionSheet = await this.actionSheetController.create({
      header: isClass ? 'Class Options' : 'Lesson Options',
      buttons: buttons
    });
    await actionSheet.present();
  }

  async openLessonMenu(event: Event, lesson: Lesson) {
    event.stopPropagation();
    
    if (!lesson) {
      return;
    }

    const isClass = lesson.isClass || false;
    const itemId = lesson._id || (lesson.classData?._id);
    if (!itemId) {
      console.error('Lesson/Class ID not found');
      return;
    }

    if (this.isMobile) {
      this.openMobileLessonMenu(event, lesson);
    } else {
      // Use Popover for desktop
      // Get the button element (currentTarget should be the ion-button)
      const buttonElement = (event.currentTarget as HTMLElement) || (event.target as HTMLElement).closest('ion-button') as HTMLElement;
      
      if (!buttonElement) {
        console.error('Could not find button element for popover');
        return;
      }
      
      // Get button's position in viewport (accounts for scroll automatically)
      const rect = buttonElement.getBoundingClientRect();
      
      // Use the original event but ensure coordinates are from button center-bottom
      const popoverEvent = {
        ...event,
        clientX: rect.left + rect.width / 2,
        clientY: rect.bottom,
        target: buttonElement,
        currentTarget: buttonElement
      };
      
      const popover = await this.popoverController.create({
        component: ClassMenuPopoverComponent,
        event: popoverEvent as any,
        componentProps: {
          classId: itemId,
          lesson: lesson,
          isClass: isClass
        },
        showBackdrop: true,
        alignment: 'start',
        side: 'bottom',
        size: 'auto'
      });
      await popover.present();
      const { data } = await popover.onWillDismiss();
      
      // Add delay after popover dismisses before opening modal to prevent freeze
      if (data) {
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (data.action === 'invite' && isClass) {
          this.inviteStudentToClass(itemId);
        } else if (data.action === 'reschedule') {
          if (isClass) {
            this.rescheduleClass(itemId, lesson);
          } else {
            this.rescheduleLesson(itemId, lesson);
          }
        } else if (data.action === 'cancel') {
          if (isClass) {
            this.cancelClass(itemId, lesson);
          } else {
            this.cancelLesson(itemId, lesson);
          }
        }
      }
    }
  }

  async inviteStudentToClass(classId: string) {
    console.log('🟢 inviteStudentToClass called for:', classId);
    
    try {
      // Find the lesson/class to get the name and full class data
      const lesson = this.lessons.find(l => l._id === classId || l.classData?._id === classId);
      const className = lesson?.className || lesson?.classData?.name || 'this class';
      const classData = lesson?.classData || lesson;
      
      console.log('🟢 Creating modal...');
      const modal = await this.modalCtrl.create({
        component: InviteStudentModalComponent,
        componentProps: {
          className: className,
          classId: classId,
          classData: classData  // Pass full class data including invitedStudents
        },
        cssClass: 'invite-student-modal'
      });

      console.log('🟢 Presenting modal...');
      await modal.present();
      console.log('✅ Modal presented successfully');
      
      const { data } = await modal.onWillDismiss();
      if (data && data.invited) {
        // Refresh lessons to show updated invitations (no skeleton)
        this.loadLessons(false);
      }
    } catch (error) {
      console.error('❌ Error opening invite modal:', error);
    }
  }

  /**
   * Handle reschedule button click - prevents menu from closing when disabled
   */
  handleRescheduleClick(event: Event, lesson: Lesson): void {
    if (this.hasLessonStarted(lesson)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    
    // Only proceed if lesson hasn't started
    if (lesson?.isClass) {
      this.rescheduleClass(lesson._id, lesson);
    } else {
      this.rescheduleLesson(lesson._id, lesson);
    }
  }

  async rescheduleClass(classId: string, lesson: Lesson) {
    console.log('🟡 rescheduleClass called for:', classId);
    try {
      const className = lesson?.className || lesson?.classData?.name || 'this class';
      
      console.log('🟡 Creating modal...');
      const modal = await this.modalCtrl.create({
        component: ConfirmActionModalComponent,
        componentProps: {
          title: 'Reschedule Class',
          message: `Do you want to reschedule "${className}"? All invited students will be notified of this change.`,
          confirmText: 'Reschedule',
          cancelText: 'Cancel',
          confirmColor: 'primary',
          icon: 'calendar',
          iconColor: 'primary'
        },
        cssClass: 'confirm-action-modal'
      });

      console.log('🟡 Presenting modal...');
      await modal.present();
      console.log('✅ Reschedule class modal presented');
      
      const { data } = await modal.onWillDismiss();
      if (data && data.confirmed) {
        // TODO: Implement class reschedule with availability calendar
        const toast = await this.toastController.create({
          message: 'Reschedule functionality coming soon',
          duration: 2000,
          position: 'bottom'
        });
        await toast.present();
      }
    } catch (error) {
      console.error('❌ Error opening reschedule class modal:', error);
    }
  }

  async rescheduleLesson(lessonId: string, lesson: Lesson) {
    console.log('🟡 rescheduleLesson called for:', lesson);
    
    try {
      // Get participant info
      const isTutor = lesson.tutorId?._id === this.currentUser?.id;
      const otherParticipant = isTutor ? lesson.studentId : lesson.tutorId;
      
      // Format participant name using the participant object directly (not the .name string)
      // This ensures we use firstName/lastName for proper formatting
      const participantName = this.formatStudentDisplayName(otherParticipant);
      
      // Get participant avatar
      const participantAvatar = this.getOtherParticipantAvatar(lesson);
      
      // Set confirm modal data and open inline modal (no programmatic creation = no freeze)
      this.confirmRescheduleModalData = {
        title: 'Reschedule Lesson',
        message: 'Do you want to reschedule your lesson?',
        notificationMessage: `${participantName} will be notified of this change.`,
        confirmText: 'Reschedule',
        cancelText: 'Cancel',
        confirmColor: 'primary',
        icon: 'calendar',
        iconColor: 'primary',
        participantName: participantName,
        participantAvatar: participantAvatar || undefined,
        lessonId: lessonId,
        lesson: lesson,
        otherParticipant: otherParticipant
      };
      
      this.isConfirmRescheduleModalOpen = true;
    } catch (error) {
      console.error('❌ Error opening reschedule lesson modal:', error);
    }
  }
  
  // Handle confirm reschedule modal dismissal
  onConfirmRescheduleModalDismiss(event: any) {
    console.log('🟡 Confirm reschedule modal dismissed:', event);
    this.isConfirmRescheduleModalOpen = false;
    
    const data = event.detail?.data;
    if (data && data.confirmed && this.confirmRescheduleModalData) {
      // Open reschedule modal with raw participant object (not formatted name)
      const lessonId = this.confirmRescheduleModalData.lessonId;
      const lesson = this.confirmRescheduleModalData.lesson;
      const otherParticipant = this.confirmRescheduleModalData.otherParticipant;
      const participantAvatar = this.confirmRescheduleModalData.participantAvatar || null;
      
      this.openRescheduleModal(lessonId, lesson, otherParticipant, participantAvatar);
    }
  }

  async showRescheduleProposal(lesson: any) {
    console.log('📅 showRescheduleProposal called for:', lesson);
    
    try {
      // Get participant info
      const isTutor = lesson.tutorId?._id === this.currentUser?.id;
      const otherParticipant = isTutor ? lesson.studentId : lesson.tutorId;
      const participantName = this.formatStudentDisplayName(otherParticipant);
      const participantAvatar = this.getOtherParticipantAvatar(lesson);
      
      const proposal = lesson.rescheduleProposal;
      if (!proposal) {
        console.error('No reschedule proposal found');
        return;
      }

      const proposedDate = new Date(proposal.proposedStartTime);
      const originalDate = new Date(lesson.startTime);

      // Set modal data and open inline modal (no programmatic creation = no JIT compilation delay)
      this.rescheduleProposalModalData = {
        lessonId: lesson._id,
        lesson: lesson,
        proposal: proposal,
        participantName: participantName,
        participantAvatar: participantAvatar || undefined,
        proposedDate: proposedDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        }),
        proposedTime: proposedDate.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit' 
        }),
        originalDate: originalDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        }),
        originalTime: originalDate.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit' 
        }),
        otherParticipant: otherParticipant
      };
      
      // Open the inline modal
      this.isRescheduleProposalModalOpen = true;
    } catch (error) {
      console.error('❌ Error opening reschedule proposal modal:', error);
    }
  }
  
  // Handle inline reschedule proposal modal dismissal
  onRescheduleProposalModalDismiss(event: any) {
    console.log('📅 Reschedule proposal modal dismissed:', event);
    this.isRescheduleProposalModalOpen = false;
    
    const data = event.detail?.data;
    if (data && data.action) {
      if (data.action === 'accepted' || data.action === 'rejected') {
        // Force reload lessons to get updated data (bypass cache)
        console.log('📅 [TAB1] Reschedule proposal modal dismissed, action:', data.action);
        this._lastDataFetch = 0; // Invalidate cache to force reload
        this.loadLessons(false);
      } else if (data.action === 'counter' && this.rescheduleProposalModalData) {
        // Open reschedule modal to propose a different time
        const lesson = this.rescheduleProposalModalData.lesson;
        const otherParticipant = this.rescheduleProposalModalData.otherParticipant;
        const participantAvatar = this.rescheduleProposalModalData.participantAvatar || null;
        this.openRescheduleModal(lesson._id, lesson, otherParticipant, participantAvatar, true); // Pass true for showBackButton
      }
    }
  }

  isRescheduleProposer(lesson: any): boolean {
    if (!lesson?.rescheduleProposal || !this.currentUser) {
      return false;
    }
    
    const lessonId = lesson._id || lesson.lessonId;
    const cacheKey = `${lessonId}-${lesson.rescheduleProposal.status}`;
    
    // Cache results for 5 seconds to avoid repeated computation during change detection
    const now = Date.now();
    if (now - this._rescheduleProposerCacheTime > 5000) {
      this._rescheduleProposerCache.clear();
      this._rescheduleProposerCacheTime = now;
    }
    
    if (this._rescheduleProposerCache.has(cacheKey)) {
      return this._rescheduleProposerCache.get(cacheKey)!;
    }
    
    const proposedById = lesson.rescheduleProposal.proposedBy?._id || lesson.rescheduleProposal.proposedBy;
    const currentUserId = this.currentUser.id;
    
    // Convert both to strings for comparison
    const proposedByStr = String(proposedById);
    const currentUserStr = String(currentUserId);
    
    const result = proposedByStr === currentUserStr;
    this._rescheduleProposerCache.set(cacheKey, result);
    return result;
  }
  
  // Helper: Check if reschedule was accepted (for template)
  isRescheduleAccepted(lesson: any): boolean {
    return lesson?.rescheduleProposal?.status === 'accepted';
  }

  async cancelClass(classId: string, lesson: Lesson) {
    console.log('🔴 cancelClass called for:', classId);
    
    try {
      const className = lesson?.className || lesson?.classData?.name || 'this class';
      
      console.log('🔴 Creating modal...');
      const modal = await this.modalCtrl.create({
        component: ConfirmActionModalComponent,
        componentProps: {
          title: 'Cancel Class',
          message: `Are you sure you want to cancel "${className}"? All invited students will be notified and this action cannot be undone.`,
          confirmText: 'Cancel Class',
          cancelText: 'Keep Class',
          confirmColor: 'danger',
          icon: 'close-circle',
          iconColor: 'danger'
        },
        cssClass: 'confirm-action-modal'
      });

      console.log('🔴 Presenting modal...');
      await modal.present();
      console.log('✅ Cancel class modal presented');
      
      const { data } = await modal.onWillDismiss();
      if (data && data.confirmed) {
        const loading = await this.loadingController.create({
          message: 'Cancelling class...',
          spinner: 'crescent'
        });
        await loading.present();
        
        try {
          // Call the backend to cancel the class
          await firstValueFrom(this.classService.cancelClass(classId));
          
          console.log(`✅ [CLASS-CANCEL] Class ${classId} cancelled successfully`);
          
          // Remove the class from the UI
          this.lessons = this.lessons.filter(l => {
            const lessonId = l._id;
            return lessonId?.toString() !== classId?.toString();
          });
          
          // Refresh the data
          await this.ionViewWillEnter();
          
          const toast = await this.toastController.create({
            message: `"${className}" has been cancelled`,
            duration: 3000,
            position: 'bottom',
            color: 'success'
          });
          await toast.present();
        } catch (error: any) {
          console.error('❌ [CLASS-CANCEL] Error cancelling class:', error);
          const errorMessage = error?.error?.message || 'Failed to cancel class';
          const toast = await this.toastController.create({
            message: errorMessage,
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        } finally {
          await loading.dismiss();
        }
      }
    } catch (error) {
      console.error('❌ Error opening cancel class modal:', error);
    }
  }

  async cancelLesson(lessonId: string, lesson: Lesson) {
    console.log('🔴 cancelLesson called for:', lessonId);
    
    try {
      // Get participant info
      const isTutor = lesson.tutorId?._id === this.currentUser?.id;
      const otherParticipant = isTutor ? lesson.studentId : lesson.tutorId;
      
      // Format participant name using the participant object directly (not the .name string)
      // This ensures we use firstName/lastName for proper formatting
      const participantName = this.formatStudentDisplayName(otherParticipant);
      
      // Get participant avatar
      const participantAvatar = this.getOtherParticipantAvatar(lesson);
      
      // Set confirm modal data and open inline modal (no programmatic creation = no freeze)
      this.confirmCancelModalData = {
        title: 'Cancel Lesson',
        message: 'Are you sure you want to cancel your lesson?',
        notificationMessage: `${participantName} will be notified and this action cannot be undone.`,
        confirmText: 'Cancel Lesson',
        cancelText: 'Keep Lesson',
        confirmColor: 'danger',
        icon: 'close-circle',
        iconColor: 'danger',
        participantName: participantName,
        participantAvatar: participantAvatar || undefined,
        lessonId: lessonId,
        lesson: lesson
      };
      
      this.isConfirmCancelModalOpen = true;
    } catch (error) {
      console.error('❌ Error opening cancel lesson modal:', error);
    }
  }
  
  // Handle confirm cancel modal dismissal
  async onConfirmCancelModalDismiss(event: any) {
    console.log('🔴 Confirm cancel modal dismissed:', event);
    this.isConfirmCancelModalOpen = false;
    
    const data = event.detail?.data;
    if (data && data.confirmed && this.confirmCancelModalData) {
      const lessonId = this.confirmCancelModalData.lessonId;
      
      // Show loading
      const loading = await this.loadingController.create({
        message: 'Cancelling lesson...',
        spinner: 'crescent'
      });
      await loading.present();

      try {
        // Call the backend to cancel the lesson
        const response = await this.lessonService.cancelLesson(lessonId).toPromise();
        
        await loading.dismiss();

        if (response?.success) {
          // Show success toast
          const toast = await this.toastController.create({
            message: 'Lesson cancelled successfully',
            duration: 3000,
            position: 'bottom',
            color: 'success'
          });
          await toast.present();

          // Reload lessons to reflect the change (no skeleton)
          await this.loadLessons(false);
        } else {
          throw new Error(response?.message || 'Failed to cancel lesson');
        }
      } catch (error: any) {
        await loading.dismiss();
        console.error('❌ Error cancelling lesson:', error);
        
        const toast = await this.toastController.create({
          message: error?.error?.message || 'Failed to cancel lesson. Please try again.',
          duration: 3000,
          position: 'bottom',
          color: 'danger'
        });
        await toast.present();
      }
    }
  }

  // Open reschedule modal with embedded availability calendar
  async openRescheduleModal(lessonId: string, lesson: Lesson, participantObject: any, participantAvatar: string | null, showBackButton: boolean = false) {
    console.log('📅 Opening reschedule modal for lesson:', lessonId);
    
    // Get the other participant's ID
    const isTutor = lesson.tutorId?._id === this.currentUser?.id;
    let otherParticipantId: string | null = null;
    
    // Use the passed participant object, or extract from lesson
    let otherParticipant = participantObject;
    if (!otherParticipant) {
      otherParticipant = isTutor ? lesson.studentId : lesson.tutorId;
    }
    
    if (otherParticipant && typeof otherParticipant === 'object') {
      otherParticipantId = (otherParticipant as any)?._id || (otherParticipant as any)?.id;
    } else if (typeof otherParticipant === 'string') {
      otherParticipantId = otherParticipant;
    }
    
    if (!otherParticipantId || !this.currentUser?.id) {
      const toast = await this.toastController.create({
        message: 'Could not find participant information',
        duration: 2000,
        color: 'danger',
        position: 'bottom'
      });
      await toast.present();
      return;
    }
    
    // Pass the raw participant object so the modal can format it properly using firstName/lastName
    // If it's a string, pass it as-is (will be formatted in modal)
    const participantNameForModal = otherParticipant || 'Student';
    
    // Set modal data and open inline modal (no programmatic creation = no JIT compilation delay)
    this.rescheduleModalData = {
      lessonId: lessonId,
      lesson: lesson,
      participantId: otherParticipantId,
      participantName: participantNameForModal,
      participantAvatar: participantAvatar || undefined,
      currentUserId: this.currentUser.id,
      isTutor: isTutor,
      showBackButton: showBackButton
    };
    
    // Open the inline modal
    this.isRescheduleModalOpen = true;
  }
  
  // Handle inline modal dismissal
  onRescheduleModalDismiss(event: any) {
    console.log('📅 Reschedule modal dismissed:', event);
    this.isRescheduleModalOpen = false;
    
    const data = event.detail?.data;
    
    // Check if user wants to go back to the proposal modal
    if (data?.goBackToProposal && this.rescheduleProposalModalData) {
      // Re-open the proposal modal
      setTimeout(() => {
        this.isRescheduleProposalModalOpen = true;
      }, 100);
      return;
    }
    
    // Check if lesson was rescheduled
    if (data?.rescheduled) {
      // Lesson was successfully rescheduled, reload lessons (no skeleton)
      this.loadLessons(false);
    }
  }

  /**
   * Select the most relevant lesson from this.lessons
   * Priority: 1) In progress, 2) Next upcoming, 3) Most recent past (only from today)
   */
  private selectMostRelevantLesson(now: number): Lesson | null {
    if (!this.lessons || this.lessons.length === 0) {
      return null;
    }

    // First priority: Find any lesson currently in progress
    const inProgressLesson = this.lessons.find(l => {
      const startTime = new Date(l.startTime).getTime();
      const endTime = new Date(l.endTime).getTime();
      return startTime <= now && now < endTime;
    });
    
    if (inProgressLesson) {
      return inProgressLesson;
    }
    
    // Second priority: Find the next upcoming lesson (future lessons only)
    const upcomingLessons = this.lessons.filter(l => {
      const startTime = new Date(l.startTime).getTime();
      return startTime > now;
    });
    
    if (upcomingLessons.length > 0) {
      // Return the soonest upcoming lesson (lessons are already sorted by startTime)
      return upcomingLessons[0];
    }
    
    // Third priority: If no upcoming lessons, show the most recent past lesson from today only
    // This ensures we don't show old lessons from earlier today after they've ended
    const today = this.startOfDay(new Date());
    const pastLessonsToday = this.lessons.filter(l => {
      const endTime = new Date(l.endTime).getTime();
      const lessonDate = new Date(l.startTime);
      const lessonDay = this.startOfDay(lessonDate);
      
      // Only include lessons that ended in the past but happened today
      return endTime < now && lessonDay.getTime() === today.getTime();
    });
    
    if (pastLessonsToday.length > 0) {
      // Find the lesson with the most recent end time from today
      return pastLessonsToday.reduce((mostRecent, current) => {
        const currentEnd = new Date(current.endTime).getTime();
        const mostRecentEnd = new Date(mostRecent.endTime).getTime();
        return currentEnd > mostRecentEnd ? current : mostRecent;
      });
    }
    
    return null;
  }

  /**
   * Recalculate upcoming lesson (called periodically to update as time passes)
   */
  private recalculateUpcomingLesson(): void {
    const now = Date.now();
    const newUpcomingLesson = this.selectMostRelevantLesson(now);
    
    // Only update if it actually changed (to avoid unnecessary change detection)
    if (newUpcomingLesson?._id !== this.upcomingLesson?._id) {
      this.upcomingLesson = newUpcomingLesson;
      console.log('📅 Upcoming lesson changed:', {
        lessonId: this.upcomingLesson?._id,
        startTime: this.upcomingLesson?.startTime,
        endTime: this.upcomingLesson?.endTime
      });
    }
  }

  /**
   * Switch between upcoming and cancelled lesson views
   */
  switchLessonView(view: 'upcoming' | 'cancelled'): void {
    this.lessonView = view;
  }

  /**
   * Get lessons for display based on selected view
   */
  getDisplayLessons(): Lesson[] {
    return this.lessonView === 'upcoming' ? this.lessons : this.cancelledLessons;
  }

  /**
   * Check if there are any cancelled lessons
   */
  /**
   * Check if there are any cancelled lessons
   * Tabs only appear if the NEXT CLASS itself is cancelled
   */
  hasCancelledLessons(): boolean {
    // Show tabs if we have cancelled lessons OR if the next lesson is cancelled
    if (this.cancelledLessons && this.cancelledLessons.length > 0) {
      return true;
    }
    // Also check if the next lesson shown in the "Up Next" card is cancelled
    if (this.nextLesson && this.nextLesson.lesson && this.nextLesson.lesson.status === 'cancelled') {
      return true;
    }
    return false;
  }

}