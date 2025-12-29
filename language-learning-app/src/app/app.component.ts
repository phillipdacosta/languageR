import { Component, OnInit, OnDestroy } from '@angular/core';
import { LoadingService } from './services/loading.service';
import { ThemeService } from './services/theme.service';
import { WebSocketService } from './services/websocket.service';
import { MessagingService } from './services/messaging.service';
import { AuthService } from './services/auth.service';
import { UserService } from './services/user.service';
import { LanguageService } from './services/language.service';
import { EarlyExitService } from './services/early-exit.service';
import { ReminderService, ReminderEvent } from './services/reminder.service';
import { LessonService } from './services/lesson.service';
import { ClassService } from './services/class.service';
import { TutorFeedbackService } from './services/tutor-feedback.service';
import { Router, NavigationEnd } from '@angular/router';
import { Subject, takeUntil, filter, forkJoin } from 'rxjs';
import { AlertController } from '@ionic/angular';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private currentUserId: string = '';
  private isMessageListenerSetup = false;
  
  // Early exit modal state
  isEarlyExitModalOpen = false;
  earlyExitLessonId: string = '';
  earlyExitMinutesRemaining: number = 0;
  earlyExitUserRole: 'tutor' | 'student' = 'student';

  constructor(
    private loadingService: LoadingService,
    private themeService: ThemeService,
    private websocketService: WebSocketService,
    private messagingService: MessagingService,
    private authService: AuthService,
    private userService: UserService,
    private languageService: LanguageService,
    private earlyExitService: EarlyExitService,
    private router: Router,
    private reminderService: ReminderService,
    private lessonService: LessonService,
    private classService: ClassService,
    private tutorFeedbackService: TutorFeedbackService,
    private alertController: AlertController
  ) {}

  ngOnInit() {
    // Initialize language service with default language
    // Will be updated when user profile loads
    this.languageService.initializeLanguage();
    
    // Ensure theme is applied immediately when app initializes
    // This ensures dark mode works across all pages, not just the profile page
    this.themeService.forceApplyTheme();
    
    // Subscribe to theme changes to ensure they apply globally
    this.themeService.darkMode$.subscribe(darkMode => {
      // Force apply whenever theme changes
      setTimeout(() => this.themeService.forceApplyTheme(), 10);
    });
    
    // Apply theme after a short delay to ensure DOM is fully ready
    setTimeout(() => {
      this.themeService.forceApplyTheme();
    }, 100);
    
    // Show loading immediately when app starts to prevent any flash
    this.loadingService.show();
    
    // Hide loading for public routes immediately
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((event: any) => {
      const url = event.urlAfterRedirects || event.url;
      
      // List of public routes that don't need auth/onboarding checks
      const publicRoutes = ['/login', '/tutor/', '/signup'];
      const isPublicRoute = publicRoutes.some(route => url.includes(route));
      
      if (isPublicRoute) {
        console.log('🔓 Public route detected, hiding loading:', url);
        this.loadingService.hide();
      }
    });
    
    // Add a timeout to hide loading after 10 seconds as a safety net
    setTimeout(() => {
      if (this.loadingService.isLoading()) {
        console.log('⏱️ Safety timeout reached, hiding loading');
        this.loadingService.hide();
      }
    }, 10000);
    
    // Set up global WebSocket listener for real-time badge updates
    this.setupGlobalMessageListener();
    
    // Set up early exit modal listener
    this.setupEarlyExitListener();
  }
  
  private async setupEarlyExitListener() {
    this.earlyExitService.earlyExitTriggered$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(async (data) => {
      console.log('🚪 AppComponent: Early exit triggered, showing modal', data);
      
      // Get current user to determine role
      let userRole: 'tutor' | 'student' = 'student';
      try {
        const currentUser = await this.userService.getCurrentUser().toPromise();
        userRole = currentUser?.userType === 'tutor' ? 'tutor' : 'student';
      } catch (error) {
        console.error('Error getting user role:', error);
      }
      
      // Set modal state and open
      this.earlyExitLessonId = data.lessonId;
      this.earlyExitMinutesRemaining = data.minutesRemaining;
      this.earlyExitUserRole = userRole;
      this.isEarlyExitModalOpen = true;
    });
  }
  
  onEarlyExitModalDismiss(event: { action: string }) {
    console.log('🚪 AppComponent: Early exit modal dismissed with action:', event.action);
    this.isEarlyExitModalOpen = false;
  }
  
  private setupGlobalMessageListener() {
    // Wait for user to be available, then connect and listen
    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      if (user?.email) {
        this.currentUserId = `dev-user-${user.email}`;
        
        // Detect and save timezone automatically
        this.userService.detectAndSaveTimezone().subscribe({
          next: (updated) => {
            if (updated) {
              console.log('🌍 Timezone auto-detected and saved');
            }
          },
          error: (error) => {
            console.error('❌ Error detecting/saving timezone:', error);
          }
        });
        
        // Load user profile and set interface language (force refresh to bypass cache)
        this.userService.getCurrentUser(true).subscribe({
          next: (currentUser) => {
              console.log('🌐 AppComponent: Loaded user profile:', currentUser);
            console.log('🌐 AppComponent: Loaded user profile:', {
              hasUser: !!currentUser,
              email: currentUser?.email,
              interfaceLanguage: currentUser?.interfaceLanguage,
              nativeLanguage: currentUser?.nativeLanguage,
              userType: currentUser?.userType,
              id: currentUser?.id
            });
            
            if (currentUser?.interfaceLanguage) {
              console.log('🌐 AppComponent: Setting language from user profile:', currentUser.interfaceLanguage);
              this.languageService.setLanguage(currentUser.interfaceLanguage);
            } else {
              console.log('⚠️ AppComponent: No interfaceLanguage in user profile, keeping current language');
            }
            
            // Load reminders globally if user is a tutor
            console.log('🔔 [APP] Checking user type for reminders:', currentUser?.userType, currentUser?.id);
            
            // Check if reminders are enabled from user profile (database)
            const remindersEnabled = currentUser?.profile?.remindersEnabled !== false; // Default true
            
            console.log('🔔 [APP] Reminders enabled:', remindersEnabled);
            
            if (remindersEnabled) {
              if (currentUser?.userType === 'tutor' && currentUser.id) {
                console.log('🔔 [APP] User is tutor, loading tutor reminders');
                this.loadGlobalReminders(currentUser.id);
                
                // Also check for pending feedback globally
                console.log('📝 [APP] Checking for pending tutor feedback');
                this.checkPendingFeedbackGlobally();
              } else if (currentUser?.userType === 'student' && currentUser.id) {
                console.log('🔔 [APP] User is student, loading student reminders');
                this.loadStudentReminders(currentUser.id);
              } else {
                console.log('⚠️ [APP] User type not matched for reminders:', currentUser?.userType);
              }
            } else {
              console.log('🔕 [APP] Reminders disabled by user');
              
              // Still check for feedback even if reminders are disabled
              // (feedback is critical, not just a reminder)
              if (currentUser?.userType === 'tutor' && currentUser.id) {
                console.log('📝 [APP] Checking for pending tutor feedback (reminders disabled)');
                this.checkPendingFeedbackGlobally();
              }
            }
          },
          error: (error) => {
            console.error('❌ Error loading user profile for language:', error);
          }
        });
        
        // Now that we have user, connect to WebSocket
        this.websocketService.connect();
        
        // Set up message listener (only once)
        if (!this.isMessageListenerSetup) {
          this.isMessageListenerSetup = true;
          
          // Listen for all incoming messages globally
          this.websocketService.newMessage$.pipe(
            takeUntil(this.destroy$)
          ).subscribe(message => {
            // Check if this is a message FOR me (I'm the receiver)
            const isMessageForMe = message.receiverId === this.currentUserId || 
                                   `dev-user-${message.receiverId}` === this.currentUserId ||
                                   message.receiverId === this.currentUserId.replace('dev-user-', '');
            
            if (isMessageForMe) {
              // Reload conversations which will automatically update the unread count
              this.messagingService.getConversations().subscribe({
                error: (error) => {
                  console.error('AppComponent: Error reloading conversations:', error);
                }
              });
            }
          });
          
          /* 
          TEMPORARILY DISABLED: Global Feedback Required Listener
          TODO: Re-enable if we want to support AI-disabled mode
          
          // Listen for feedback_required events globally (for tutors)
          // Set a flag instead of showing alert immediately to avoid conflicts
          this.websocketService.on('feedback_required').pipe(
            takeUntil(this.destroy$)
          ).subscribe(async (data: any) => {
            console.log('📝 [APP] Feedback required event received:', data);
            // Don't show alert here - let the home page handle it
            // This avoids conflicts with other alerts (e.g., "student left early")
          });
          */
        }
      }
    });
  }
  
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
  // Load reminders globally for tutors
  private loadGlobalReminders(tutorId: string) {
    console.log('🔔 [APP] Loading global reminders for tutor:', tutorId);
    
    // Load both lessons and classes
    forkJoin({
      lessons: this.lessonService.getLessonsByTutor(tutorId, true),
      classes: this.classService.getClassesForTutor(tutorId)
    }).subscribe({
      next: ({ lessons, classes }) => {
        console.log('🔔 [APP] Tutor lessons response:', lessons);
        console.log('🔔 [APP] Tutor classes response:', classes);
        
        const reminderEvents: ReminderEvent[] = [];
        const now = new Date();
        
        // Process lessons
        if (lessons.success && lessons.lessons) {
          console.log('🔔 [APP] Processing', lessons.lessons.length, 'lessons for tutor');
          
          lessons.lessons.forEach((lesson: any) => {
            const startTime = new Date(lesson.startTime);
            const endTime = new Date(lesson.endTime);
            const minutesUntil = Math.floor((startTime.getTime() - now.getTime()) / 60000);
            const minutesSinceEnd = Math.floor((now.getTime() - endTime.getTime()) / 60000);
            
            console.log('🔔 [APP] Lesson:', {
              id: lesson._id,
              startTime: startTime.toLocaleString(),
              endTime: endTime.toLocaleString(),
              minutesUntil,
              isFuture: startTime > now,
              hasEnded: endTime < now,
              minutesSinceEnd
            });
            
            // Track lessons that are upcoming OR currently happening OR ended recently (within 1 hour)
            // This ensures reminders show for lessons that started and persist until dismissed
            const shouldTrack = startTime > now || minutesSinceEnd < 60;
            
            if (shouldTrack) {
              // Extract student info from the lesson object
              const student = lesson.studentId as any;
              const studentFirst = typeof student?.firstName === 'string' ? student.firstName.trim() : '';
              const studentLast = typeof student?.lastName === 'string' ? student.lastName.trim() : '';
              
              // Format student name as "FirstName L."
              const studentName = studentFirst && studentLast
                ? `${studentFirst} ${studentLast.charAt(0)}.`
                : studentFirst || 'Student';
              
              // Format title - use the language/subject
              const language = lesson.tutorLanguage || lesson.subject || 'Language';
              const title = `${language} with ${studentName}`;
              
              const reminderEvent: ReminderEvent = {
                id: lesson._id,
                title: title,
                startTime: startTime,
                type: 'lesson',
                lessonId: lesson._id,
                studentName: studentName,
                studentAvatar: student?.picture || student?.avatar || student?.photoUrl,
                meetingLink: lesson.meetingLink
              };
              
              console.log('✅ [APP] Adding reminder event:', reminderEvent);
              reminderEvents.push(reminderEvent);
            }
          });
        }
        
        // Process classes
        if (classes.success && classes.classes) {
          classes.classes.forEach((cls: any) => {
            // Skip cancelled classes
            if (cls.status === 'cancelled') {
              console.log('⏭️ [APP] Skipping cancelled class:', cls.name);
              return;
            }
            
            const startTime = new Date(cls.startTime);
            
            // Only track future classes
            if (startTime > now) {
              reminderEvents.push({
                id: cls._id,
                title: cls.name || 'Class',
                startTime: startTime,
                type: 'class',
                classId: cls._id,
                thumbnail: cls.thumbnail,
                meetingLink: cls.meetingLink
              });
            }
          });
        }
        
        console.log('🔔 [APP] Loaded', reminderEvents.length, 'events for global reminders');
        this.reminderService.trackEvents(reminderEvents);
        
        // Refresh reminders every 5 minutes to catch new lessons/classes
        setTimeout(() => {
          if (!this.destroy$.closed) {
            this.loadGlobalReminders(tutorId);
          }
        }, 5 * 60 * 1000);
      },
      error: (error) => {
        console.error('❌ [APP] Error loading global reminders:', error);
      }
    });
  }
  
  // Load reminders for students
  private loadStudentReminders(studentId: string) {
    console.log('🔔 [APP] Loading reminders for student:', studentId);
    
    // Load student's lessons (including all past lessons to catch recently ended ones)
    this.lessonService.getLessonsByStudent(studentId, true).subscribe({
      next: (response) => {
        console.log('🔔 [APP] Student lessons response:', response);
        
        const reminderEvents: ReminderEvent[] = [];
        const now = new Date();
        
        if (response.success && response.lessons) {
          console.log('🔔 [APP] Processing', response.lessons.length, 'lessons for student');
          
          response.lessons.forEach((lesson: any) => {
            const startTime = new Date(lesson.startTime);
            const endTime = new Date(lesson.endTime);
            const minutesUntil = Math.floor((startTime.getTime() - now.getTime()) / 60000);
            const minutesSinceEnd = Math.floor((now.getTime() - endTime.getTime()) / 60000);
            
            console.log('🔔 [APP] Lesson:', {
              id: lesson._id,
              startTime: startTime.toLocaleString(),
              endTime: endTime.toLocaleString(),
              minutesUntil,
              isFuture: startTime > now,
              hasEnded: endTime < now,
              minutesSinceEnd
            });
            
            // Track lessons that are upcoming OR currently happening OR ended recently (within 1 hour)
            const shouldTrack = startTime > now || minutesSinceEnd < 60;
            
            if (shouldTrack) {
              // Extract tutor info
              const tutor = lesson.tutorId as any;
              const tutorFirst = typeof tutor?.firstName === 'string' ? tutor.firstName.trim() : '';
              const tutorLast = typeof tutor?.lastName === 'string' ? tutor.lastName.trim() : '';
              
              // Format tutor name as "FirstName L."
              const tutorName = tutorFirst && tutorLast
                ? `${tutorFirst} ${tutorLast.charAt(0)}.`
                : tutorFirst || 'Tutor';
              
              // Format title - use the language/subject
              const language = lesson.tutorLanguage || lesson.subject || 'Language';
              const title = `${language} with ${tutorName}`;
              
              const reminderEvent: ReminderEvent = {
                id: lesson._id,
                title: title,
                startTime: startTime,
                type: 'lesson',
                lessonId: lesson._id,
                studentName: tutorName, // For students, this is the tutor name
                studentAvatar: tutor?.picture || tutor?.avatar || tutor?.photoUrl,
                meetingLink: lesson.meetingLink
              };
              
              console.log('✅ [APP] Adding reminder event:', reminderEvent);
              reminderEvents.push(reminderEvent);
            }
          });
        }
        
        console.log('🔔 [APP] Loaded', reminderEvents.length, 'lessons for student reminders');
        this.reminderService.trackEvents(reminderEvents);
        
        // Refresh reminders every 5 minutes
        setTimeout(() => {
          if (!this.destroy$.closed) {
            this.loadStudentReminders(studentId);
          }
        }, 5 * 60 * 1000);
      },
      error: (error) => {
        console.error('❌ [APP] Error loading student reminders:', error);
      }
    });
  }
  
  /**
   * Check for pending tutor feedback globally (when app loads)
   * Just logs the count - the home page will show the actual UI
   */
  private checkPendingFeedbackGlobally() {
    this.tutorFeedbackService.getPendingFeedback().subscribe({
      next: async (response) => {
        const count = response.count || 0;
        console.log(`📝 [APP] Global feedback check: ${count} pending feedback requests`);
        // Don't show alert here - let the home page handle the UI
        // This avoids interrupting the user during initial app load
      },
      error: (error) => {
        console.error('❌ [APP] Error checking pending feedback:', error);
      }
    });
  }
}
