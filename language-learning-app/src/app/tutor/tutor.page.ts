import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, Platform } from '@ionic/angular';
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { UserService } from '../services/user.service';
import { TutorAvailabilityViewerComponent } from '../components/tutor-availability-viewer/tutor-availability-viewer.component';
import { TutorSearchPage } from '../tutor-search/tutor-search.page';
import { MessagingService, Message } from '../services/messaging.service';
import { WebSocketService } from '../services/websocket.service';
import { AuthService } from '../services/auth.service';
import { filter, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-tutor-page',
  templateUrl: './tutor.page.html',
  styleUrls: ['./tutor.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, TutorAvailabilityViewerComponent]
})
export class TutorPage implements OnInit, OnDestroy, AfterViewInit {
  tutorId = '';
  tutor: any = null;
  isLoading = true;
  showVideo = false;
  @ViewChild('introVideo', { static: false }) introVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('chatMessagesContainer', { static: false }) chatMessagesRef?: ElementRef<HTMLDivElement>;
  showOverlay = true;
  cameFromModal = false;
  availabilityRefreshTrigger = 0;
  private backButtonSubscription: any;
  private routerSubscription: any;
  
  // Messaging sidebar
  showMessagingSidebar = false;
  messages: Message[] = [];
  newMessage = '';
  isLoadingMessages = false;
  isSending = false;
  currentUserId = '';
  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService,
    private modalController: ModalController,
    private platform: Platform,
    private location: Location,
    private messagingService: MessagingService,
    private websocketService: WebSocketService,
    private authService: AuthService
  ) {}

  ngOnInit() {
    this.tutorId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.tutorId) {
      this.router.navigate(['/tabs']);
      return;
    }
    
    // Check if we came from the modal (via query params)
    const fromModal = this.route.snapshot.queryParamMap.get('fromModal');
    this.cameFromModal = fromModal === 'true';
    
    this.userService.getTutorPublic(this.tutorId).subscribe({
      next: (res) => {
        this.tutor = res.tutor;
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      }
    });
    
    // Check for refresh trigger from query params (e.g., after booking conflict)
    const refreshAvailability = this.route.snapshot.queryParamMap.get('refreshAvailability');
    if (refreshAvailability === 'true') {
      // Trigger availability refresh
      this.availabilityRefreshTrigger = Date.now();
      // Clear the query param to avoid repeated refreshes
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { refreshAvailability: null },
        queryParamsHandling: 'merge'
      });
    }
    
    // Set up back button handler if we came from modal
    if (this.cameFromModal) {
      this.setupBackButtonHandler();
    }
    
    // Get current user ID for messaging - use same format as messages page
    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      const email = user?.email || '';
      // Use email-based ID to match backend format (dev-user-{email}) or use sub if available
      this.currentUserId = email ? `dev-user-${email}` : user?.sub || '';
      console.log('👤 Tutor page: Current user ID set to:', this.currentUserId);
    });
    
    // Connect to WebSocket for real-time messaging
    this.websocketService.connect();
    
    // Listen for new messages
    this.websocketService.newMessage$.pipe(takeUntil(this.destroy$)).subscribe(message => {
      if (this.showMessagingSidebar && this.tutor && 
          (message.senderId === this.tutor.auth0Id || message.receiverId === this.tutor.auth0Id)) {
        // If we sent the message, mark as no longer sending
        if (message.senderId === this.currentUserId) {
          this.isSending = false;
        }
        this.loadMessages();
      }
    });
  }
  
  private setupBackButtonHandler() {
    // Handle platform/hardware back button
    if (this.platform.is('mobile')) {
      this.backButtonSubscription = this.platform.backButton.subscribeWithPriority(10, () => {
        this.reopenSearchModal();
      });
    }
    
    // Override browser back button via popstate
    const popStateHandler = () => {
      if (this.cameFromModal) {
        history.pushState(null, '', window.location.href); // Prevent actual navigation
        this.reopenSearchModal();
      }
    };
    
    history.pushState(null, '', window.location.href); // Add state for back button
    window.addEventListener('popstate', popStateHandler);
    this.routerSubscription = { unsubscribe: () => window.removeEventListener('popstate', popStateHandler) };
  }
  
  async handleBackClick(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    await this.reopenSearchModal();
  }
  
  async reopenSearchModal() {
    // Get the tutor ID from query params to restore scroll position
    const tutorIdToScroll = this.route.snapshot.queryParamMap.get('tutorId') || this.tutorId;
    
    // Navigate back to home tab first
    await this.router.navigate(['/tabs/home'], { replaceUrl: true });
    
    // Small delay to ensure navigation completes
    setTimeout(async () => {
      // Reopen the search modal with data to restore scroll position
      const modal = await this.modalController.create({
        component: TutorSearchPage,
        componentProps: {
          scrollToTutorId: tutorIdToScroll
        }
      });
      await modal.present();
    }, 100);
  }

  ngOnDestroy() {
    const el = this.introVideoRef?.nativeElement;
    if (el) {
      el.pause();
    }
    
    // Clean up back button subscription
    if (this.backButtonSubscription) {
      this.backButtonSubscription.unsubscribe();
    }
    
    // Clean up router/popstate subscription
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
    
    // Clean up messaging subscriptions
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleIntroVideo() {
    const el = this.introVideoRef?.nativeElement;
    if (!el) return;
    el.controls = true;
    el.play();
    this.showOverlay = false;
  }

  expandVideo() {
    this.showVideo = true;
  }

  ngAfterViewInit() {
    const el = this.introVideoRef?.nativeElement;
    if (!el) return;
    el.controls = false;
    el.addEventListener('pause', () => {
      this.showOverlay = true;
    });
    el.addEventListener('ended', () => {
      this.showOverlay = true;
    });
    el.addEventListener('play', () => {
      this.showOverlay = false;
    });
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  async messageTutor() {
    if (!this.tutor) return;
    
    // Open messaging sidebar instead of navigating
    this.showMessagingSidebar = true;
    this.loadMessages();
    
    // Scroll to bottom after a short delay to ensure messages are loaded
    setTimeout(() => {
      this.scrollToBottom();
    }, 300);
  }
  
  toggleMessagingSidebar() {
    this.showMessagingSidebar = !this.showMessagingSidebar;
    if (this.showMessagingSidebar) {
      this.loadMessages();
      setTimeout(() => {
        this.scrollToBottom();
      }, 300);
    }
  }
  
  loadMessages() {
    if (!this.tutor) {
      console.error('❌ Cannot load messages: no tutor object');
      return;
    }
    
    // Ensure we have auth0Id - if not, fetch tutor again
    if (!this.tutor.auth0Id) {
      console.log('🔄 Tutor missing auth0Id, fetching tutor data...');
      this.userService.getTutorPublic(this.tutorId).subscribe({
        next: (res) => {
          this.tutor = res.tutor;
          this.loadMessagesWithAuth0Id();
        },
        error: (error) => {
          console.error('❌ Error fetching tutor:', error);
          this.isLoadingMessages = false;
        }
      });
      return;
    }
    
    this.loadMessagesWithAuth0Id();
  }
  
  private loadMessagesWithAuth0Id() {
    if (!this.tutor?.auth0Id) {
      console.error('❌ Cannot load messages: no auth0Id in tutor object', this.tutor);
      this.isLoadingMessages = false;
      return;
    }
    
    const receiverId = this.tutor.auth0Id;
    if (!receiverId) {
      console.error('❌ Cannot load messages: no auth0Id in tutor');
      this.isLoadingMessages = false;
      return;
    }
    
    console.log('💬 Loading messages for tutor (same as messages page):', {
      tutorId: this.tutorId,
      auth0Id: receiverId,
      name: this.tutor.name
    });
    
    // Use exact same approach as messages page
    this.isLoadingMessages = true;
    this.messagingService.getMessages(receiverId).subscribe({
      next: (response) => {
        console.log('✅ Messages loaded successfully:', {
          count: response.messages?.length || 0,
          hasMessages: (response.messages?.length || 0) > 0,
          firstMessage: response.messages?.[0] ? {
            id: response.messages[0].id,
            senderId: response.messages[0].senderId,
            receiverId: response.messages[0].receiverId,
            content: response.messages[0].content?.substring(0, 50)
          } : null
        });
        this.messages = response.messages || [];
        this.isLoadingMessages = false;
        this.scrollToBottom();
      },
      error: (error) => {
        console.error('❌ Error loading messages:', error);
        console.error('Error details:', {
          status: error.status,
          statusText: error.statusText,
          message: error.message,
          error: error.error,
          url: error.url
        });
        this.isLoadingMessages = false;
        // If error is 404 (no messages yet), that's fine for new conversations
        if (error.status === 404) {
          console.log('ℹ️ No messages found (404) - this is normal for new conversations');
          this.messages = [];
        } else {
          // For other errors, still show empty state but log the issue
          console.warn('⚠️ Failed to load messages, showing empty state');
          this.messages = [];
        }
      }
    });
  }
  
  sendMessage() {
    if (!this.newMessage.trim() || !this.tutor?.auth0Id || this.isSending) {
      return;
    }

    const content = this.newMessage.trim();
    const messageContent = content;
    this.newMessage = '';
    this.isSending = true;

    const receiverId = this.tutor.auth0Id;
    
    // Try WebSocket first (preferred for real-time)
    if (this.websocketService.getConnectionStatus()) {
      this.websocketService.sendMessage(receiverId, messageContent, 'text');
      
      // Set a timeout to fallback to HTTP if WebSocket doesn't respond
      setTimeout(() => {
        if (this.isSending) {
          // WebSocket didn't respond, use HTTP fallback
          this.sendMessageViaHTTP(messageContent);
        }
      }, 2000);
    } else {
      // WebSocket not connected, use HTTP
      this.sendMessageViaHTTP(messageContent);
    }
  }
  
  private sendMessageViaHTTP(content: string) {
    if (!this.tutor?.auth0Id) {
      console.error('❌ Cannot send message: no tutor auth0Id');
      this.isSending = false;
      return;
    }

    this.messagingService.sendMessage(this.tutor.auth0Id, content).subscribe({
      next: () => {
        this.isSending = false;
        this.loadMessages(); // Reload to get the new message
      },
      error: (error) => {
        console.error('Error sending message:', error);
        this.isSending = false;
      }
    });
  }
  
  scrollToBottom() {
    setTimeout(() => {
      if (this.chatMessagesRef?.nativeElement) {
        const container = this.chatMessagesRef.nativeElement;
        container.scrollTop = container.scrollHeight;
      }
    }, 100);
  }
  
  isMyMessage(message: Message): boolean {
    return message.senderId === this.currentUserId;
  }
  
  formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  }
}