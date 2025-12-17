import { Component, OnInit, OnDestroy } from '@angular/core';
import { LoadingService } from './services/loading.service';
import { ThemeService } from './services/theme.service';
import { WebSocketService } from './services/websocket.service';
import { MessagingService } from './services/messaging.service';
import { AuthService } from './services/auth.service';
import { UserService } from './services/user.service';
import { LanguageService } from './services/language.service';
import { EarlyExitService } from './services/early-exit.service';
import { Router, NavigationEnd } from '@angular/router';
import { Subject, takeUntil, filter } from 'rxjs';
import { ModalController } from '@ionic/angular';
import { EarlyExitModalComponent } from './components/early-exit-modal/early-exit-modal.component';

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

  constructor(
    private loadingService: LoadingService,
    private themeService: ThemeService,
    private websocketService: WebSocketService,
    private messagingService: MessagingService,
    private authService: AuthService,
    private userService: UserService,
    private languageService: LanguageService,
    private earlyExitService: EarlyExitService,
    private modalController: ModalController,
    private router: Router
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
      
      // Show the early exit modal
      const modal = await this.modalController.create({
        component: EarlyExitModalComponent,
        componentProps: {
          lessonId: data.lessonId,
          minutesRemaining: data.minutesRemaining,
          userRole: userRole
        },
        cssClass: 'early-exit-modal',
        backdropDismiss: true
      });
      
      await modal.present();
      
      const { data: result } = await modal.onWillDismiss();
      console.log('🚪 AppComponent: Early exit modal dismissed with action:', result?.action);
    });
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
              nativeLanguage: currentUser?.nativeLanguage
            });
            
            if (currentUser?.interfaceLanguage) {
              console.log('🌐 AppComponent: Setting language from user profile:', currentUser.interfaceLanguage);
              this.languageService.setLanguage(currentUser.interfaceLanguage);
            } else {
              console.log('⚠️ AppComponent: No interfaceLanguage in user profile, keeping current language');
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
        }
      }
    });
  }
  
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
