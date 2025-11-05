import { Component, OnInit, OnDestroy } from '@angular/core';
import { LoadingService } from './services/loading.service';
import { ThemeService } from './services/theme.service';
import { WebSocketService } from './services/websocket.service';
import { MessagingService } from './services/messaging.service';
import { AuthService } from './services/auth.service';
import { Subject, takeUntil } from 'rxjs';

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
    private authService: AuthService
  ) {}

  ngOnInit() {
    console.log('🚀 AppComponent: Starting app initialization');
    
    // Ensure theme is applied immediately when app initializes
    // This ensures dark mode works across all pages, not just the profile page
    const isDark = this.themeService.isDarkMode();
    console.log('🎨 AppComponent: Current theme state:', isDark);
    
    // Force apply theme to ensure it's active globally
    this.themeService.forceApplyTheme();
    
    // Subscribe to theme changes to log them and ensure they apply globally
    this.themeService.darkMode$.subscribe(darkMode => {
      console.log('🌓 AppComponent: Theme changed to:', darkMode ? 'dark' : 'light');
      // Force apply whenever theme changes
      setTimeout(() => this.themeService.forceApplyTheme(), 10);
    });
    
    // Apply theme after a short delay to ensure DOM is fully ready
    setTimeout(() => {
      console.log('🎨 AppComponent: Delayed theme application');
      this.themeService.forceApplyTheme();
    }, 100);
    
    // Show loading immediately when app starts to prevent any flash
    console.log('🚀 AppComponent: Starting app, showing loading');
    this.loadingService.show();
    
    // Add a timeout to hide loading after 10 seconds as a safety net
    setTimeout(() => {
      if (this.loadingService.isLoading()) {
        console.log('🚀 AppComponent: Timeout reached, hiding loading as safety net');
        this.loadingService.hide();
      }
    }, 10000);
    
    // Set up global WebSocket listener for real-time badge updates
    this.setupGlobalMessageListener();
  }
  
  private setupGlobalMessageListener() {
    console.log('🌐 AppComponent: Setting up global WebSocket message listener');
    
    // Wait for user to be available, then connect and listen
    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      if (user?.email) {
        this.currentUserId = `dev-user-${user.email}`;
        console.log('🌐 AppComponent: Current user ID set to:', this.currentUserId);
        
        // Now that we have user, connect to WebSocket
        console.log('🌐 AppComponent: User available, connecting to WebSocket');
        this.websocketService.connect();
        
        // Set up message listener (only once)
        if (!this.isMessageListenerSetup) {
          this.isMessageListenerSetup = true;
          
          // Listen for all incoming messages globally
          this.websocketService.newMessage$.pipe(
            takeUntil(this.destroy$)
          ).subscribe(message => {
            console.log('🌐 AppComponent: Received WebSocket message:', message.id);
            
            // Check if this is a message FOR me (I'm the receiver)
            const isMessageForMe = message.receiverId === this.currentUserId || 
                                   `dev-user-${message.receiverId}` === this.currentUserId ||
                                   message.receiverId === this.currentUserId.replace('dev-user-', '');
            
            console.log('🌐 AppComponent: Is message for me?', isMessageForMe, 
                        'receiverId:', message.receiverId, 
                        'currentUserId:', this.currentUserId);
            
            if (isMessageForMe) {
              console.log('📬 AppComponent: Message is for me, refreshing conversations to update badge');
              // Reload conversations which will automatically update the unread count
              this.messagingService.getConversations().subscribe({
                next: (response) => {
                  console.log('✅ AppComponent: Conversations reloaded after incoming message');
                },
                error: (error) => {
                  console.error('❌ AppComponent: Error reloading conversations:', error);
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
