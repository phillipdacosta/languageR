import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, Platform, AlertController, AnimationController } from '@ionic/angular';
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { UserService } from '../services/user.service';
import { LanguageService } from '../services/language.service';
import { TutorAvailabilityViewerComponent } from '../components/tutor-availability-viewer/tutor-availability-viewer.component';
import { TutorSearchPage } from '../tutor-search/tutor-search.page';
import { MessagingService, Message } from '../services/messaging.service';
import { WebSocketService } from '../services/websocket.service';
import { AuthService } from '../services/auth.service';
import { TutorSearchContentPageModule } from '../tutor-search-content/tutor-search-content.module';
import { VideoPlayerModalComponent } from '../tutor-search-content/video-player-modal.component';
import { ImageViewerModal } from '../messages/image-viewer-modal.component';
import { SharedModule } from '../shared/shared.module';
import { filter, takeUntil } from 'rxjs/operators';
import { Subject, firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-tutor-page',
  templateUrl: './tutor.page.html',
  styleUrls: ['./tutor.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, TutorAvailabilityViewerComponent, SharedModule, TutorSearchContentPageModule]
})
export class TutorPage implements OnInit, OnDestroy, AfterViewInit {
  tutorId = '';
  tutor: any = null;
  isLoading = true;
  currentUserAuth0Id: string = '';
  bioExpanded = false;
  @ViewChild('introVideo', { static: false }) introVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('chatMessagesContainer', { static: false }) chatMessagesRef?: ElementRef<HTMLDivElement>;
  @ViewChild('messageInput', { static: false }) messageInput?: ElementRef;
  cameFromModal = false;
  justLoggedIn = false;
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
  
  // File upload and voice recording
  isUploading = false;
  isRecording = false;
  selectedFile: File | null = null;
  selectedConversation: any = null; // For conversation context
  recordingDuration = 0;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recordingTimer: any;
  private messageSendTimeout: any;
  
  // Typing indicator
  isTyping = false;
  otherUserTyping = false;
  typingTimeout: any;
  
  // Reply functionality
  replyingToMessage: Message | null = null;
  private longPressTimeout: any;
  private readonly LONG_PRESS_DURATION = 500; // ms
  highlightedMessageId: string | null = null; // Track which message is highlighted

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService,
    private languageService: LanguageService,
    private modalController: ModalController,
    private platform: Platform,
    private location: Location,
    private messagingService: MessagingService,
    private websocketService: WebSocketService,
    private authService: AuthService,
    private alertController: AlertController,
    private animationCtrl: AnimationController
  ) {}

  ngOnInit() {
    const pageLoadStart = performance.now();
    console.log(`⏱️ [Tutor Page] ========== PAGE INIT STARTED ==========`);
    
    this.tutorId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.tutorId) {
      this.router.navigate(['/tabs']);
      return;
    }
    
    // Check for language query parameter (for shareable links)
    const langParam = this.route.snapshot.queryParamMap.get('lang');
    if (langParam && this.languageService.isSupported(langParam)) {
      console.log('🌐 Language query parameter detected:', langParam);
      this.languageService.setLanguage(langParam as any);
    }
    
    // Check if user just logged in via returnUrl
    const returnUrl = localStorage.getItem('justCompletedLogin');
    console.log('🔍 Checking justCompletedLogin:', {
      returnUrl,
      currentUrl: this.router.url,
      matches: returnUrl === this.router.url
    });
    
    if (returnUrl && returnUrl === this.router.url) {
      console.log('✅ User just completed login flow to this page - setting justLoggedIn = true');
      localStorage.removeItem('justCompletedLogin');
      this.justLoggedIn = true;
    } else if (returnUrl) {
      console.log('❌ URLs do not match - justLoggedIn will be false');
    }
    
    // Check if we came from the modal (via query params)
    const fromModal = this.route.snapshot.queryParamMap.get('fromModal');
    this.cameFromModal = fromModal === 'true';
    
    const startTime = performance.now();
    console.log(`⏱️ [Tutor Page] Starting to load tutor: ${this.tutorId}`);
    
    this.userService.getTutorPublic(this.tutorId).subscribe({
      next: (res) => {
        const duration = performance.now() - startTime;
        this.tutor = res.tutor;
        console.log('🔄 tutor:', this.tutor);
        this.isLoading = false;
      },
      error: (err) => {
        const duration = performance.now() - startTime;
        this.isLoading = false;
      }
    });
    
    // Subscribe to query params to detect refresh trigger (even on navigation back)
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
      if (params['refreshAvailability'] === 'true') {
        console.log('🔄 Refresh availability query param detected, triggering refresh...');
        // Trigger availability refresh
        this.availabilityRefreshTrigger = Date.now();
        console.log('🔄 New refresh trigger value:', this.availabilityRefreshTrigger);
        // Clear the query param to avoid repeated refreshes
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { refreshAvailability: null },
          queryParamsHandling: 'merge'
        });
      }
    });
    
    // Set up back button handler if we came from modal
    if (this.cameFromModal) {
      this.setupBackButtonHandler();
    }
    
    // Get current user ID for messaging - use same format as messages page
    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      const email = user?.email || '';
      // Use email-based ID to match backend format (dev-user-{email}) or use sub if available
      this.currentUserId = email ? `dev-user-${email}` : user?.sub || '';
      // Also store auth0Id for availability component
      this.currentUserAuth0Id = user?.sub || email || '';
      console.log('👤 Tutor page: Current user ID set to:', this.currentUserId);
    });
    
    // Connect to WebSocket for real-time messaging
    this.websocketService.connect();
    
    // Listen for new messages
    this.websocketService.newMessage$.pipe(takeUntil(this.destroy$)).subscribe(message => {
      if (this.showMessagingSidebar && this.tutor && 
          (message.senderId === this.tutor.auth0Id || message.receiverId === this.tutor.auth0Id)) {
        // Check if this is my message (sent by me)
        const isMyMessage = message.senderId === this.currentUserId || 
                            message.senderId === this.currentUserId.replace('dev-user-', '') ||
                            `dev-user-${message.senderId}` === this.currentUserId;
        
        // Enhanced duplicate check
        const existingMessage = this.messages.find(m => 
          m.id === message.id || 
          (m.content === message.content && 
           m.senderId === message.senderId && 
           Math.abs(new Date(m.createdAt).getTime() - new Date(message.createdAt).getTime()) < 1000)
        );
        
        if (!existingMessage) {
          this.messages.push(message);
          this.scrollToBottom();
        }
        
        // If we sent the message, mark as no longer sending
        if (isMyMessage && this.isSending) {
          this.isSending = false;
          if (this.messageSendTimeout) {
            clearTimeout(this.messageSendTimeout);
            this.messageSendTimeout = null;
          }
        }
      }
    });
    
    // Listen for typing indicators
    this.websocketService.typing$.pipe(takeUntil(this.destroy$)).subscribe(data => {
      if (this.showMessagingSidebar && this.tutor && data.userId === this.tutor.auth0Id) {
        this.otherUserTyping = data.isTyping;
      }
    });
    
    const pageLoadEnd = performance.now();
    const totalInitTime = pageLoadEnd - pageLoadStart;
    console.log(`⏱️ [Tutor Page] ========== PAGE INIT COMPLETED in ${totalInitTime.toFixed(2)}ms ==========`);
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
  
  navigateToHome() {
    console.log('🔄 Navigating to /tabs/home (post-login)');
    this.router.navigate(['/tabs/home']);
  }
  
  goBackToSearch() {
    console.log('🔙 Going back to tutor search - localStorage should have the ID');
    // Simply navigate back - localStorage already has returnToTutorId
    this.router.navigate(['/tabs/tutor-search']);
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

  ngAfterViewInit() {
    console.log(`⏱️ [Tutor Page] ========== DOM RENDERED - ngAfterViewInit called ==========`);
  }

  async openVideoModal(event: Event) {
    if (!this.tutor || !this.tutor.introductionVideo) return;

    event.stopPropagation();

    // Get element bounds for animation origin
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ion-safe-area-top')) || 0;

    const circleBounds = {
      x: rect.left,
      y: rect.top - safeTop,
      width: rect.width,
      height: rect.height
    };

    const modal = await this.modalController.create({
      component: VideoPlayerModalComponent,
      componentProps: {
        videoUrl: this.tutor.introductionVideo,
        thumbnailUrl: this.tutor.videoThumbnail || '',
        tutorName: this.formatStudentDisplayName(this.tutor)
      },
      cssClass: 'video-player-modal',
      backdropDismiss: true,
      enterAnimation: (baseEl: any) => {
        return this.createZoomEnterAnimation(baseEl, circleBounds);
      },
      leaveAnimation: (baseEl: any) => {
        return this.createZoomLeaveAnimation(baseEl, circleBounds);
      }
    });

    await modal.present();
  }

  private createZoomEnterAnimation(baseEl: any, circleBounds: { x: number; y: number; width: number; height: number }) {
    const backdropAnimation = this.animationCtrl.create()
      .addElement(baseEl.querySelector('ion-backdrop')!)
      .fromTo('opacity', '0', '0.4')
      .duration(200);

    const root = baseEl.shadowRoot || baseEl;
    const modalWrapper = root.querySelector('.modal-wrapper') as HTMLElement;

    if (!modalWrapper) {
      console.warn('Modal wrapper not found');
      return this.animationCtrl.create();
    }

    const forcedLayout = modalWrapper.offsetHeight;

    const modalRect = modalWrapper.getBoundingClientRect();

    let modalCenterX: number;
    let modalCenterY: number;

    if (Math.abs(modalRect.top) > 10) {
      modalCenterX = window.innerWidth / 2;
      modalCenterY = window.innerHeight / 2;
    } else {
      modalCenterX = modalRect.left + modalRect.width / 2;
      modalCenterY = modalRect.top + modalRect.height / 2;
    }

    const circleCenterX = circleBounds.x + circleBounds.width / 2;
    const circleCenterY = circleBounds.y + circleBounds.height / 2;

    const safeAreaTop = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ion-safe-area-top')) || 0;

    const adjustedCircleCenterY = circleCenterY + safeAreaTop;

    const translateX = circleCenterX - modalCenterX;
    const translateY = adjustedCircleCenterY - modalCenterY;

    let extraOffset = 0;
    if (window.navigator.userAgent.includes('iPhone')) {
      extraOffset = 10;
    }

    const adjustedTranslateY = translateY - extraOffset;

    const scaleX = circleBounds.width / modalRect.width;
    const scaleY = circleBounds.height / modalRect.height;
    const finalScale = Math.min(scaleX, scaleY);

    const wrapperAnimation = this.animationCtrl.create()
      .addElement(modalWrapper)
      .duration(250)
      .easing('ease-in-out')
      .fromTo('transform',
        `translate(${translateX}px, ${adjustedTranslateY}px) scale(${finalScale})`,
        'translate(0px, 0px) scale(1)')
      .fromTo('opacity', '0.3', '1');

    return this.animationCtrl.create()
      .addAnimation([backdropAnimation, wrapperAnimation]);
  }

  private createZoomLeaveAnimation(baseEl: any, circleBounds: { x: number; y: number; width: number; height: number }) {
    const backdropAnimation = this.animationCtrl.create()
      .addElement(baseEl.querySelector('ion-backdrop')!)
      .fromTo('opacity', '0.4', '0')
      .duration(250);

    const root = baseEl.shadowRoot || baseEl;
    const modalWrapper = root.querySelector('.modal-wrapper') as HTMLElement;

    if (!modalWrapper) {
      console.warn('Modal wrapper not found');
      return this.animationCtrl.create();
    }

    const modalRect = modalWrapper.getBoundingClientRect();

    let modalCenterX: number;
    let modalCenterY: number;

    if (Math.abs(modalRect.top) > 10) {
      modalCenterX = window.innerWidth / 2;
      modalCenterY = window.innerHeight / 2;
    } else {
      modalCenterX = modalRect.left + modalRect.width / 2;
      modalCenterY = modalRect.top + modalRect.height / 2;
    }

    const circleCenterX = circleBounds.x + circleBounds.width / 2;
    const circleCenterY = circleBounds.y + circleBounds.height / 2;

    const safeAreaTop = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ion-safe-area-top')) || 0;

    const adjustedCircleCenterY = circleCenterY + safeAreaTop;

    const translateX = circleCenterX - modalCenterX;
    const translateY = adjustedCircleCenterY - modalCenterY;

    let extraOffset = 0;
    if (window.navigator.userAgent.includes('iPhone')) {
      extraOffset = 10;
    }

    const adjustedTranslateY = translateY - extraOffset;

    const scaleX = circleBounds.width / modalRect.width;
    const scaleY = circleBounds.height / modalRect.height;
    const finalScale = Math.min(scaleX, scaleY);

    const wrapperAnimation = this.animationCtrl.create()
      .addElement(modalWrapper)
      .duration(300)
      .easing('ease-in-out')
      .fromTo('transform',
        'translate(0px, 0px) scale(1)',
        `translate(${translateX}px, ${adjustedTranslateY}px) scale(${finalScale})`)
      .fromTo('opacity', '1', '0.3');

    return this.animationCtrl.create()
      .addAnimation([backdropAnimation, wrapperAnimation]);
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  toggleBio() {
    this.bioExpanded = !this.bioExpanded;
  }

  shouldShowReadMore(bio: string | undefined): boolean {
    return !!(bio && typeof bio === 'string' && bio.length > 200);
  }

  async messageTutor() {
    if (!this.tutor) return;
    
    // Check authentication first
    const isAuth = await firstValueFrom(this.authService.isAuthenticated$);
    
    if (!isAuth) {
      // Store where they wanted to go
      const currentUrl = this.router.url;
      localStorage.setItem('returnUrl', currentUrl);
      console.log('🔄 Saving returnUrl for after login:', currentUrl);
      
      // Show friendly prompt
      const alert = await this.alertController.create({
        header: 'Login Required',
        message: `Please log in to message ${this.tutor.name}.`,
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel'
          },
          {
            text: 'Log In',
            handler: async () => {
              // Navigate to login
              await this.router.navigate(['/login']);
            }
          }
        ]
      });
      await alert.present();
      return;
    }
    
    // Open messaging sidebar instead of navigating
    this.showMessagingSidebar = true;
    
    // Ensure user is fully loaded (including getCurrentUser) before loading messages
    // This ensures auth headers are set correctly with the actual user email
    this.userService.getCurrentUser().subscribe({
      next: (user) => {
        if (user?.email) {
          console.log('👤 User loaded, now loading messages:', user.email);
          // User is fully loaded, now we can load messages
          this.loadMessages();
          
          // Scroll to bottom after a short delay to ensure messages are loaded
          setTimeout(() => {
            this.scrollToBottom();
          }, 300);
        }
      },
      error: (error) => {
        console.error('❌ Error loading user:', error);
        // Still try to load messages even if user load fails
        this.loadMessages();
      }
    });
  }
  
  toggleMessagingSidebar() {
    this.showMessagingSidebar = !this.showMessagingSidebar;
    if (this.showMessagingSidebar) {
      // Ensure user is fully loaded before loading messages
      this.userService.getCurrentUser().subscribe({
        next: (user) => {
          if (user?.email) {
            console.log('👤 User loaded, now loading messages:', user.email);
            // User is fully loaded, now we can load messages
            this.loadMessages();
            setTimeout(() => {
              this.scrollToBottom();
            }, 300);
          }
        },
        error: (error) => {
          console.error('❌ Error loading user:', error);
          // Still try to load messages even if user load fails
          this.loadMessages();
        }
      });
    }
  }
  
  closeMessaging() {
    this.showMessagingSidebar = false;
  }
  
  formatMessageTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) {
      return 'Just now';
    } else if (minutes < 60) {
      return `${minutes}m ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }
  
  onTyping() {
    this.onInputChange();
  }
  
  onEnterKey(event: KeyboardEvent) {
    if (!event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }
  
  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;
  
  triggerFileInput() {
    this.fileInputRef?.nativeElement?.click();
  }
  
  cancelReply() {
    this.clearReply();
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
    if (!this.newMessage.trim() || !this.tutor?.auth0Id || this.isSending || this.isUploading || this.isRecording) {
      return;
    }

    const content = this.newMessage.trim();
    const messageContent = content;
    this.newMessage = '';
    this.isSending = true;

    // Stop typing indicator
    this.sendTypingIndicator(false);

    // Prepare replyTo data if replying - store it before clearing
    let replyTo: any = undefined;
    if (this.replyingToMessage && this.replyingToMessage.id) {
      let senderName = 'Unknown';
      if (this.isMyMessage(this.replyingToMessage)) {
        senderName = 'You';
      } else {
        senderName = this.tutor?.name || 'Unknown';
      }
      
      replyTo = {
        messageId: this.replyingToMessage.id,
        content: this.replyingToMessage.content,
        senderId: this.replyingToMessage.senderId,
        senderName: senderName,
        type: this.replyingToMessage.type,
        fileUrl: this.replyingToMessage.fileUrl,
        fileName: this.replyingToMessage.fileName
      };
      
      console.log('💬 Sending message WITH reply:', replyTo);
      // Clear reply state after storing the data
      this.clearReply();
    } else {
      console.log('💬 Sending message WITHOUT reply (replyingToMessage:', this.replyingToMessage, ')');
    }

    const receiverId = this.tutor.auth0Id;
    
    // Try WebSocket first (preferred for real-time)
    if (this.websocketService.getConnectionStatus()) {
      // Only send replyTo if it was actually set (user was replying)
      // Explicitly pass undefined if not replying
      const replyToToSend = replyTo ? replyTo : undefined;
      console.log('📤 Sending via WebSocket with replyTo:', replyToToSend);
      this.websocketService.sendMessage(receiverId, messageContent, 'text', replyToToSend);
      
      // Set a timeout to fallback to HTTP if WebSocket doesn't respond
      this.messageSendTimeout = setTimeout(() => {
        if (this.isSending) {
          // WebSocket didn't respond, use HTTP fallback
          const replyToToSend = replyTo ? replyTo : undefined;
          this.sendMessageViaHTTP(messageContent, replyToToSend);
        }
      }, 2000);
    } else {
      // WebSocket not connected, use HTTP
      const replyToToSend = replyTo ? replyTo : undefined;
      this.sendMessageViaHTTP(messageContent, replyToToSend);
    }
  }
  
  private sendMessageViaHTTP(content: string, replyTo?: any) {
    if (!this.tutor?.auth0Id) {
      console.error('❌ Cannot send message: no tutor auth0Id');
      this.isSending = false;
      return;
    }

    // If not sending anymore, WebSocket already succeeded - don't send via HTTP
    if (!this.isSending) {
      return;
    }

    // Only include replyTo if it was provided and is a valid object (user was actually replying)
    const replyToToSend = replyTo && replyTo.messageId ? replyTo : undefined;
    console.log('📤 Sending via HTTP with replyTo:', replyToToSend);
    this.messagingService.sendMessage(this.tutor.auth0Id, content, 'text', replyToToSend).subscribe({
      next: (response) => {
        const message = response.message;
        
        // Enhanced duplicate check
        const existingMessage = this.messages.find(m => 
          m.id === message.id || 
          (m.content === message.content && 
           m.senderId === message.senderId && 
           Math.abs(new Date(m.createdAt).getTime() - new Date(message.createdAt).getTime()) < 1000)
        );
        
        if (!existingMessage) {
          this.messages.push(message);
          this.scrollToBottom();
        }
        
        this.isSending = false;
      },
      error: (error) => {
        console.error('Error sending message:', error);
        this.isSending = false;
      }
    });
  }
  
  onInputChange() {
    if (!this.isTyping) {
      this.isTyping = true;
      this.sendTypingIndicator(true);
    }

    // Clear existing timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }

    // Set new timeout to stop typing indicator
    this.typingTimeout = setTimeout(() => {
      this.isTyping = false;
      this.sendTypingIndicator(false);
    }, 1000);
  }

  sendTypingIndicator(isTyping: boolean) {
    if (!this.tutor?.auth0Id) return;
    
    this.websocketService.sendTypingIndicator(
      this.tutor.auth0Id,
      isTyping
    );
  }
  
  // Handle file selection
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    this.selectedFile = file;
    
    // Determine message type based on file type
    const messageType = file.type.startsWith('image/') ? 'image' : 'file';
    
    this.uploadFile(file, messageType);
    
    // Reset input
    input.value = '';
    this.selectedFile = null;
  }

  // Upload file to server
  private uploadFile(file: File, messageType: 'image' | 'file' | 'voice', caption?: string) {
    if (!this.tutor?.auth0Id) {
      console.error('No tutor selected');
      return;
    }

    this.isUploading = true;
    const receiverId = this.tutor.auth0Id;

    this.messagingService.uploadFile(receiverId, file, messageType, caption).subscribe({
      next: (response) => {
        // Add message to local messages array
        this.messages.push(response.message);
        this.scrollToBottom();
        this.isUploading = false;
      },
      error: (error) => {
        console.error('❌ Error uploading file:', error);
        this.isUploading = false;
      }
    });
  }

  // Toggle voice recording
  async toggleVoiceRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  // Start voice recording
  private async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];
      this.recordingDuration = 0;
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };
      
      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const audioFile = new File([audioBlob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' });
        
        // Upload the voice note
        this.uploadFile(audioFile, 'voice');
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };
      
      this.mediaRecorder.start();
      this.isRecording = true;
      
      // Start timer
      this.recordingTimer = setInterval(() => {
        this.recordingDuration++;
        
        // Auto-stop after 60 seconds
        if (this.recordingDuration >= 60) {
          this.stopRecording();
        }
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error starting recording:', error);
    }
  }

  // Stop voice recording
  private stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      
      if (this.recordingTimer) {
        clearInterval(this.recordingTimer);
        this.recordingTimer = null;
      }
    }
  }

  // Format file size for display
  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Get file icon based on type
  getFileIcon(fileType: string): string {
    if (fileType.startsWith('image/')) return 'image';
    if (fileType.startsWith('audio/')) return 'musical-note';
    if (fileType.startsWith('video/')) return 'videocam';
    if (fileType.includes('pdf')) return 'document-text';
    if (fileType.includes('word') || fileType.includes('doc')) return 'document';
    if (fileType.includes('excel') || fileType.includes('sheet')) return 'grid';
    if (fileType.includes('powerpoint') || fileType.includes('presentation')) return 'easel';
    return 'attach';
  }

  // Open file - images in modal viewer, other files for download
  async openFile(fileUrl: string, fileType?: string, fileName?: string) {
    // Check if it's an image
    const isImage = fileType?.startsWith('image/') || 
                    fileUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i);
    
    if (isImage) {
      // Open image in modal viewer
      await this.openImageViewer(fileUrl, fileName);
    } else {
      // For non-images, open in new tab for download
      window.open(fileUrl, '_blank');
    }
  }

  // Open image viewer modal
  async openImageViewer(imageUrl: string, imageName?: string) {
    const modal = await this.modalController.create({
      component: ImageViewerModal,
      componentProps: {
        imageUrl,
        imageName
      },
      cssClass: 'image-viewer-modal'
    });
    
    await modal.present();
  }

  // Reply functionality handlers
  onMessageMouseDown(message: Message, event: MouseEvent | TouchEvent) {
    // Only on desktop (long-press)
    if (window.innerWidth >= 769) {
      this.longPressTimeout = setTimeout(() => {
        this.setReplyTo(message);
      }, this.LONG_PRESS_DURATION);
    }
  }

  onMessageMouseUp() {
    if (this.longPressTimeout) {
      clearTimeout(this.longPressTimeout);
      this.longPressTimeout = null;
    }
  }

  onMessageDoubleClick(message: Message) {
    // Desktop only
    if (window.innerWidth >= 769) {
      this.setReplyTo(message);
    }
  }

  setReplyTo(message: Message) {
    // Get sender name
    let senderName = 'Unknown';
    if (this.isMyMessage(message)) {
      senderName = 'You';
    } else {
      senderName = this.tutor?.name || 'Unknown';
    }
    
    this.replyingToMessage = message;
    
    // Focus the input
    setTimeout(() => {
      if (this.messageInput?.nativeElement) {
        const inputElement = this.messageInput.nativeElement.querySelector('input');
        if (inputElement) {
          inputElement.focus();
        }
      }
    }, 100);
  }

  clearReply() {
    this.replyingToMessage = null;
  }

  getReplyPreviewContent(): string {
    if (!this.replyingToMessage) return '';
    
    if (this.replyingToMessage.type === 'text') {
      const maxLength = 50;
      const content = this.replyingToMessage.content || '';
      return content.length > maxLength ? content.substring(0, maxLength) + '...' : content;
    } else if (this.replyingToMessage.type === 'image') {
      return '📷 Photo';
    } else if (this.replyingToMessage.type === 'file') {
      return `📄 ${this.replyingToMessage.fileName || 'File'}`;
    } else if (this.replyingToMessage.type === 'voice') {
      return '🎤 Voice message';
    }
    return '';
  }

  // Scroll to a specific message by ID and highlight it
  scrollToMessageById(messageId: string, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (!messageId) {
      return;
    }
    
    // Small delay to ensure DOM is ready
    setTimeout(() => {
      const messageElement = document.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement;
      
      if (!messageElement) {
        return;
      }
      
      // Get the scrollable container
      const container = this.chatMessagesRef?.nativeElement;
      
      if (container) {
        // Calculate position
        const containerRect = container.getBoundingClientRect();
        const elementRect = messageElement.getBoundingClientRect();
        const scrollTop = container.scrollTop;
        const elementTop = elementRect.top - containerRect.top + scrollTop;
        const centerOffset = container.clientHeight / 2 - elementRect.height / 2;
        const targetScroll = Math.max(0, elementTop - centerOffset);
        
        // Scroll smoothly
        container.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });
      } else {
        // Fallback
        messageElement.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }
      
      // Highlight the message
      this.highlightedMessageId = messageId;
      
      // Remove highlight after 2 seconds
      setTimeout(() => {
        this.highlightedMessageId = null;
      }, 2000);
      
    }, 100);
  }

  // Scroll to and highlight the message being replied to (for the input preview button)
  scrollToRepliedMessage(event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (!this.replyingToMessage) {
      return;
    }
    
    const messageId = this.replyingToMessage.id;
    if (messageId) {
      this.scrollToMessageById(messageId, event);
    }
  }
  
  formatDate(timestamp: string): string {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
    }
  }

  shouldShowDateSeparator(currentMessage: Message, previousMessage: Message | undefined): boolean {
    if (!previousMessage) return true;
    
    const currentDate = new Date(currentMessage.createdAt).toDateString();
    const previousDate = new Date(previousMessage.createdAt).toDateString();
    
    return currentDate !== previousDate;
  }
  
  trackByMessageId(index: number, message: Message): string {
    return message.id;
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
    const currentUserId = this.currentUserId;
    return message.senderId === currentUserId || 
           message.senderId === currentUserId.replace('dev-user-', '') ||
           `dev-user-${message.senderId}` === currentUserId;
  }
  
  formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }

  async bookLesson() {
    if (!this.tutor) {
      return;
    }

    try {
      // Check authentication first
      const isAuth = await firstValueFrom(this.authService.isAuthenticated$);
      
      if (!isAuth) {
        // Store where they wanted to go
        const currentUrl = this.router.url;
        localStorage.setItem('returnUrl', currentUrl);
        console.log('🔄 Saving returnUrl for after login (book):', currentUrl);
        
        // Show friendly prompt
        const alert = await this.alertController.create({
          header: 'Login Required',
          message: `Please log in to book a lesson with ${this.tutor.name}.`,
          buttons: [
            {
              text: 'Cancel',
              role: 'cancel'
            },
            {
              text: 'Log In',
              handler: async () => {
                // Navigate to login with replaceUrl to replace current page (tutor) with login
                // This prevents tutor page from being in history
                await this.router.navigate(['/login'], { replaceUrl: true });
              }
            }
          ]
        });
        await alert.present();
        return;
      }
      
      const currentUser = await firstValueFrom(this.authService.user$);
      
      if (!currentUser) {
        console.log('User not authenticated');
        return;
      }
      
      // Check if user is a student
      if (currentUser.userType !== 'student') {
        const alert = await this.alertController.create({
          header: 'Student Account Required',
          message: 'Only students can book lessons. Please log in with a student account.',
          buttons: ['OK']
        });
        await alert.present();
        return;
      }

      // Get the tutor's auth0Id
      const tutorId = this.tutor.auth0Id || this.tutor.id;

      // Create potential student conversation
      const response = await firstValueFrom(this.messagingService.createPotentialStudent(tutorId, 'book_lesson'));

      if (response?.success) {
        console.log('Potential student conversation created:', response.conversationId);
        // Navigate to checkout or booking page
        // For now, we'll just create the conversation
        // TODO: Navigate to booking/checkout page
      } else {
        console.error('Failed to create potential student conversation');
      }
    } catch (error) {
      console.error('Error creating potential student conversation:', error);
    }
  }

  async bookOfficeHours() {
    if (!this.tutor) {
      return;
    }

    try {
      // Check authentication first
      const isAuth = await firstValueFrom(this.authService.isAuthenticated$);
      
      if (!isAuth) {
        // Store where they wanted to go
        const currentUrl = this.router.url;
        localStorage.setItem('returnUrl', currentUrl);
        console.log('🔄 Saving returnUrl for after login (office hours):', currentUrl);
        
        // Show friendly prompt
        const alert = await this.alertController.create({
          header: 'Login Required',
          message: `Please log in to book office hours with ${this.tutor.name}.`,
          buttons: [
            {
              text: 'Cancel',
              role: 'cancel'
            },
            {
              text: 'Log In',
              handler: async () => {
                await this.router.navigate(['/login'], { replaceUrl: true });
              }
            }
          ]
        });
        await alert.present();
        return;
      }
      
      const currentUser = await firstValueFrom(this.authService.user$);
      
      if (!currentUser) {
        console.log('User not authenticated');
        return;
      }
      
      // Check if user is a student
      if (currentUser.userType !== 'student') {
        const alert = await this.alertController.create({
          header: 'Student Account Required',
          message: 'Only students can book office hours. Please log in with a student account.',
          buttons: ['OK']
        });
        await alert.present();
        return;
      }

      // Import the modal component dynamically
      const { OfficeHoursBookingComponent } = await import('../modals/office-hours-booking/office-hours-booking.component');
      
      const modal = await this.modalController.create({
        component: OfficeHoursBookingComponent,
        componentProps: {
          tutorId: this.tutor.id,
          tutorName: this.tutor.name,
          tutorPicture: this.tutor.picture,
          hourlyRate: this.tutor.hourlyRate
        }
      });

      await modal.present();

      const { data } = await modal.onWillDismiss();
      if (data?.success) {
        console.log('Office hours booked successfully:', data.lesson);
      }
    } catch (error) {
      console.error('Error booking office hours:', error);
    }
  }

  // Format student display name as "First L."
  formatStudentDisplayName(studentOrName: any): string {
    // Handle if it's a student object with firstName and lastName
    console.log('🔄 formatStudentDisplayName:', studentOrName);
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
}