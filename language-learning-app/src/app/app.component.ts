import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { App as CapacitorApp, URLOpenListenerEvent } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { LoadingService } from './services/loading.service';
import { ThemeService } from './services/theme.service';
import { WebSocketService } from './services/websocket.service';
import { MessagingService } from './services/messaging.service';
import { AuthService } from './services/auth.service';
import { UserService } from './services/user.service';
import { LanguageService } from './services/language.service';
import { ReminderService, ReminderEvent } from './services/reminder.service';
import { LessonService } from './services/lesson.service';
import { ClassService } from './services/class.service';
import { TutorFeedbackService } from './services/tutor-feedback.service';
import { ImagePreloadService } from './services/image-preload.service';
import { GROWTH_TICKER_ICON_URLS } from './services/tutor-growth.service';
import { Router, NavigationEnd } from '@angular/router';
import { Subject, takeUntil, filter, forkJoin, take } from 'rxjs';
import { AlertController, ToastController } from '@ionic/angular';
import { environment } from '../environments/environment';
import { getTimezoneLabel } from './shared/timezone.utils';

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
  private splashHidden = false;
  private authResolved = false;

  constructor(
    private loadingService: LoadingService,
    private themeService: ThemeService,
    private websocketService: WebSocketService,
    private messagingService: MessagingService,
    private authService: AuthService,
    private userService: UserService,
    private languageService: LanguageService,
    private router: Router,
    private zone: NgZone,
    private reminderService: ReminderService,
    private lessonService: LessonService,
    private classService: ClassService,
    private tutorFeedbackService: TutorFeedbackService,
    private alertController: AlertController,
    private toastController: ToastController,
    private imagePreloadService: ImagePreloadService
  ) {
    this.initializeDeepLinks();
  }

  /** Static home/UI illustrations that render behind *ngIf — warm them so they
   *  paint instantly on first view instead of fetching in front of the user. */
  private static readonly HOME_PRELOAD_ASSETS: string[] = [
    'assets/up-next-empty-light.png',
    'assets/this-week-empty-calendar.png',
    'assets/setup-availability-arrow.png',
    'assets/upnext-schedule-clock.png',
    'assets/home-earnings-dollar.png',
    'assets/home-earnings-dollar-dark.png',
    'assets/quick-actions-classes.png',
    'assets/quick-actions-classes-original.png',
    'assets/quick-actions-create-material.png',
    'assets/quick-actions-create-material-original.png',
    'assets/quick-actions-forum.png',
    'assets/quick-actions-forum-original.png',
    'assets/quick-actions-reviews.png',
    'assets/quick-actions-reviews-original.png',
    ...GROWTH_TICKER_ICON_URLS,
  ];

  private initializeDeepLinks() {
    if (!Capacitor.isNativePlatform()) return;

    CapacitorApp.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
      await Browser.close();

      this.zone.run(async () => {
        const isCallback = event.url.includes('callback') &&
          (event.url.includes('code=') || event.url.includes('error='));

        if (isCallback) {
          try {
            await this.authService.handleAuthCallback(event.url).toPromise();
            this.router.navigate(['/tabs'], { replaceUrl: true });
          } catch (error) {
            console.error('Auth callback error:', error);
            this.router.navigate(['/login'], { replaceUrl: true });
          }
        } else {
          const slug = event.url.replace(/^[^:]+:\/\//, '');
          const path = slug.startsWith('/') ? slug : '/' + slug;
          this.router.navigateByUrl(path);
        }
      });
    });
  }

  ngOnInit() {
    this.languageService.initializeLanguage();

    // Warm static home illustrations during idle time so they paint instantly.
    this.imagePreloadService.preloadWhenIdle(AppComponent.HOME_PRELOAD_ASSETS);
    
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

    // Track when auth SDK finishes resolving
    this.authService.isLoading$.pipe(
      filter(loading => !loading),
      take(1),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.authResolved = true;
    });

    // Safety net: hide everything after 10s no matter what
    setTimeout(() => {
      if (this.loadingService.isLoading()) {
        this.loadingService.hide();
      }
      this.hideSplashScreen();
    }, 10000);

    // Track previous URL for back-navigation (avoids YouTube iframe history issues)
    let lastUrl = '';
    let loginHoldTimer: any = null;
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((event: any) => {
      const url = event.urlAfterRedirects || event.url;

      if (lastUrl && !/^\/material\//.test(lastUrl)) {
        sessionStorage.setItem('materialReferrer', lastUrl);
      }
      lastUrl = url;

      const publicRoutes = ['/login', '/tutor/', '/signup'];
      const isPublicRoute = publicRoutes.some(route => url.includes(route));
      const isStaticPublicRoute = /^\/(terms|privacy)(\?|\/|$)/.test(url);

      if (url.includes('/tabs') || url.includes('/onboarding') || url.includes('/signup-language') || url.includes('/role-select') || isStaticPublicRoute) {
        // Landed on an authenticated page or static public page — safe to reveal everything
        if (loginHoldTimer) { clearTimeout(loginHoldTimer); loginHoldTimer = null; }
        this.loadingService.hide();
        this.hideSplashScreen();
      } else if (isPublicRoute) {
        // Landed on login/signup — might be a pass-through.
        // Hold splash for 3s; if we don't navigate away, user is genuinely here.
        if (!loginHoldTimer) {
          loginHoldTimer = setTimeout(() => {
            this.loadingService.hide();
            this.hideSplashScreen();
          }, 3000);
        }
      }
    });
    
    // Set up global WebSocket listener for real-time badge updates
    this.setupGlobalMessageListener();
    
  }

  private setupGlobalMessageListener() {
    // Wait for user to be available, then connect and listen
    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      if (user?.email) {
        this.currentUserId = `dev-user-${user.email}`;
        
        // Sync Stripe status for tutors
        this.syncStripeStatus();
        
        // Detect and save timezone automatically
        this.userService.detectAndSaveTimezone().subscribe({
          next: async (result) => {
            // Only toast when the user already had a timezone and it changed
            // (e.g. they traveled). First login saves silently.
            if (result !== 'changed' || this.isOnboardingFlowRoute()) {
              return;
            }
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const label = getTimezoneLabel(tz);
            const toast = await this.toastController.create({
              message: `Timezone updated to ${label}`,
              duration: 3000,
              position: 'bottom',
              icon: 'globe-outline',
              color: 'primary'
            });
            await toast.present();
          },
          error: (error) => {
            // 404 is expected for new users in the pre-onboarding window —
            // their profile (and timezone) gets saved during onboarding.
            if (error?.status !== 404) {
              console.error('❌ Error detecting/saving timezone:', error);
            }
          }
        });
        
        // Load user profile and set interface language (force refresh to bypass cache)
        this.userService.getCurrentUser(true).subscribe({
          next: (currentUser) => {
            // Load payout status for tutors (cached in UserService to avoid flashing in profile)
            if (currentUser?.userType === 'tutor') {
              this.userService.loadPayoutStatus();
            }
            
            this.reconcileInterfaceLanguage(currentUser);

            // Check if reminders are enabled from user profile (database)
            const remindersEnabled = currentUser?.profile?.remindersEnabled !== false; // Default true

            if (remindersEnabled) {
              if (currentUser?.userType === 'tutor' && currentUser.id) {
                this.loadGlobalReminders(currentUser.id);
                this.checkPendingFeedbackGlobally();
              } else if (currentUser?.userType === 'student' && currentUser.id) {
                this.loadStudentReminders(currentUser.id);
              }
            } else {
              // Still check for feedback even if reminders are disabled
              // (feedback is critical, not just a reminder)
              if (currentUser?.userType === 'tutor' && currentUser.id) {
                this.checkPendingFeedbackGlobally();
              }
            }
          },
          error: (error) => {
            if (error?.status !== 404) {
              console.error('❌ Error loading user profile for language:', error);
            }
          }
        });
        
        // Now that we have user, connect to WebSocket
        this.websocketService.connect();
        
        // Listen for WebSocket reconnection to refresh data
        this.websocketService.connection$.pipe(
          takeUntil(this.destroy$)
        ).subscribe(isConnected => {
          if (isConnected && this.currentUserId) {
            // Reload conversations after reconnection to sync unread counts
            setTimeout(() => {
              this.messagingService.getConversations().subscribe({
                error: (error) => console.error('Error reloading conversations after reconnect:', error)
              });
            }, 500);
          }
        });
        
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

          // Listen for tutor video approval notifications
          this.websocketService.tutorVideoApproved$.pipe(
            takeUntil(this.destroy$)
          ).subscribe(async (data: any) => {
            // Show success toast
            const toast = await this.toastController.create({
              message: data.message,
              duration: 5000,
              color: 'success',
              position: 'top',
              icon: 'checkmark-circle'
            });
            await toast.present();

            // Refresh user data to update approval status across the app
            this.userService.getCurrentUser(true).subscribe();
          });

          // Listen for tutor video rejection notifications
          this.websocketService.tutorVideoRejected$.pipe(
            takeUntil(this.destroy$)
          ).subscribe(async (data: any) => {
            // Show rejection toast
            const toast = await this.toastController.create({
              message: data.message,
              duration: 7000,
              color: 'danger',
              position: 'top',
              icon: 'close-circle'
            });
            await toast.present();

            // Refresh user data to update approval status across the app
            this.userService.getCurrentUser(true).subscribe();
          });

          // Listen for credential approval notifications (global - works on all pages)
          this.websocketService.credentialApproved$.pipe(
            takeUntil(this.destroy$)
          ).subscribe(async (data: any) => {
            const toast = await this.toastController.create({
              message: data.message || 'Your credential has been verified and approved.',
              duration: 5000,
              color: 'success',
              position: 'top',
              icon: 'shield-checkmark'
            });
            await toast.present();
          });

          // Listen for credential rejection notifications (global - works on all pages)
          this.websocketService.credentialRejected$.pipe(
            takeUntil(this.destroy$)
          ).subscribe(async (data: any) => {
            const toast = await this.toastController.create({
              message: data.message || 'A credential was not accepted. Please re-upload.',
              duration: 7000,
              color: 'danger',
              position: 'top',
              icon: 'shield'
            });
            await toast.present();
          });
        }
      }
    });
  }
  
  /** Suppress timezone-change toast on setup flows (onboarding, tutor onboarding, etc.). */
  private isOnboardingFlowRoute(): boolean {
    const path = this.router.url.split('?')[0];
    return (
      path === '/onboarding' ||
      path.startsWith('/onboarding/') ||
      path === '/tutor-onboarding' ||
      path.startsWith('/tutor-onboarding/') ||
      path === '/tutor-approval' ||
      path.startsWith('/tutor-approval/')
    );
  }

  private hideSplashScreen() {
    if (this.splashHidden) return;
    this.splashHidden = true;
    if (Capacitor.isNativePlatform()) {
      SplashScreen.hide({ fadeOutDuration: 300 });
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
  // Load reminders globally for tutors
  private loadGlobalReminders(tutorId: string) {
    // Load both lessons and classes
    forkJoin({
      lessons: this.lessonService.getLessonsByTutor(tutorId, true),
      classes: this.classService.getClassesForTutor(tutorId)
    }).subscribe({
      next: ({ lessons, classes }) => {
        const reminderEvents: ReminderEvent[] = [];
        const now = new Date();
        
        // Process lessons
        if (lessons.success && lessons.lessons) {
          lessons.lessons.forEach((lesson: any) => {
            if (lesson.status === 'cancelled') {
              return;
            }

            const startTime = new Date(lesson.startTime);
            const endTime = new Date(lesson.endTime);
            const minutesSinceEnd = Math.floor((now.getTime() - endTime.getTime()) / 60000);

            // Track lessons that are upcoming OR currently happening OR ended recently (within 1 hour)
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

              reminderEvents.push(reminderEvent);
            }
          });
        }

        // Process classes
        if (classes.success && classes.classes) {
          classes.classes.forEach((cls: any) => {
            // Skip cancelled classes
            if (cls.status === 'cancelled') {
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
    // Load student's lessons (including all past lessons to catch recently ended ones)
    this.lessonService.getLessonsByStudent(studentId, true).subscribe({
      next: (response) => {
        const reminderEvents: ReminderEvent[] = [];
        const now = new Date();
        
        if (response.success && response.lessons) {
          response.lessons.forEach((lesson: any) => {
            if (lesson.status === 'cancelled') {
              return;
            }

            const startTime = new Date(lesson.startTime);
            const endTime = new Date(lesson.endTime);
            const minutesSinceEnd = Math.floor((now.getTime() - endTime.getTime()) / 60000);

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

              reminderEvents.push(reminderEvent);
            }
          });
        }

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
   * Reconcile the local UI language with the server-stored preference.
   *
   * Product rule: the local active language is the source of truth for
   * the device. The server tracks it.
   *   - `localStorage.userLanguage` is written by `LanguageService` on
   *     every `setLanguage` call (browser detect during `initializeLanguage`
   *     uses `source: 'auto'`; the picker uses `source: 'user'`).
   *   - On every authenticated sync we compare local to server and push
   *     local up if they differ.
   *   - `USER_PICK_KEY` is a durable record of the most recent explicit
   *     picker selection; it survives `localStorage.clear()` in the auth
   *     flow (see `AuthService.captureLanguagePreferences`) so a failed
   *     PUT retries on the next sign-in. It is cleared once the sync
   *     succeeds (or the server already matches).
   *
   * Cross-device consequence (intentional): opening the app on a device
   * with a different browser locale overwrites the server-side preference
   * to match that device's locale. If the user wants a specific language
   * across devices they pick it once via the picker.
   */
  private reconcileInterfaceLanguage(currentUser: any): void {
    const serverLang = currentUser?.interfaceLanguage as string | undefined;
    const pickedLang = this.languageService.getPendingPick();
    const localLang = (typeof localStorage !== 'undefined')
      ? localStorage.getItem(LanguageService.USER_LANGUAGE_KEY)
      : null;

    const target: string | null =
      (localLang && this.languageService.isSupported(localLang)) ? localLang
      : (serverLang && this.languageService.isSupported(serverLang)) ? serverLang
      : null;

    if (!target) {
      return;
    }

    if (target !== serverLang) {
      console.log('🌐 Syncing local interfaceLanguage up to server:', {
        local: target,
        server: serverLang,
        picker: !!pickedLang,
      });
      this.userService.updateInterfaceLanguage(target as any).subscribe({
        next: () => {
          if (pickedLang) {
            this.languageService.consumePendingPick();
          }
        },
        error: (err) => {
          console.error('❌ Failed to sync interfaceLanguage (will retry next login):', err);
        },
      });
      return;
    }

    // Server already matches local. Clear any stale pick marker.
    if (pickedLang) {
      this.languageService.consumePendingPick();
    }
  }

  /**
   * Check for pending tutor feedback globally (when app loads).
   * The home page Quick Actions and profile page handle the UI.
   */
  private checkPendingFeedbackGlobally() {
    this.tutorFeedbackService.getPendingFeedback().subscribe({
      error: (error) => {
        console.error('❌ [APP] Error checking pending feedback:', error);
      }
    });
  }

  /**
   * Sync Stripe Connect status from Stripe API to user document
   * This ensures the user's stripeConnectOnboarded field is always up-to-date
   */
  private async syncStripeStatus() {
    try {
      const currentUser = await this.userService.getCurrentUser().toPromise();
      
      // Only check for tutors
      if (currentUser?.userType !== 'tutor') return;

      // The backend /stripe-connect/status endpoint automatically updates the user document
      // when it detects onboarding is complete, so we just need to call it
      const headers = this.userService.getAuthHeadersSync();
      fetch(`${environment.apiUrl}/payments/stripe-connect/status`, {
        method: 'GET',
        headers: {
          'Authorization': headers.get('Authorization') || '',
          'Content-Type': 'application/json'
        }
      })
      .then(response => response.json())
      .then(data => {
        if (data.success && data.onboarded) {
          // Force refresh the user data and approval status
          this.userService.getCurrentUser(true).subscribe(() => {
            this.userService.refreshTutorApprovalStatus();
            // Reload payout status to reflect Stripe connection
            this.userService.loadPayoutStatus();
          });
        }
      })
      .catch(error => {
        console.error('❌ [APP] Error syncing Stripe status:', error);
      });
    } catch (error) {
      console.error('❌ [APP] Error in syncStripeStatus:', error);
    }
  }

}
