import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ModalController, AlertController, ToastController } from '@ionic/angular';
import { PlatformService } from '../services/platform.service';
import { MessagingService, Conversation, Message } from '../services/messaging.service';
import { WebSocketService } from '../services/websocket.service';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';
import { ImageViewerModal } from './image-viewer-modal.component';
import { MessageContextMenuComponent } from './message-context-menu.component';
import { TutorAvailabilityViewerComponent } from '../components/tutor-availability-viewer/tutor-availability-viewer.component';
import { Subject, BehaviorSubject, Subscription } from 'rxjs';
import { takeUntil, debounceTime, take, switchMap } from 'rxjs/operators';
import { trigger, style, transition, animate } from '@angular/animations';

@Component({
  selector: 'app-messages',
  templateUrl: 'messages.page.html',
  styleUrls: ['messages.page.scss'],
  standalone: false,
  animations: [
    trigger('fadeInOut', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('400ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('200ms cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 0 }))
      ])
    ]),
    trigger('slideInUp', [
      transition(':enter', [
        style({ 
          opacity: 0, 
          transform: 'translateY(30px) scale(0.98)' 
        }),
        animate('500ms cubic-bezier(0.4, 0, 0.2, 1)', style({ 
          opacity: 1, 
          transform: 'translateY(0) scale(1)' 
        }))
      ])
    ])
  ]
})
export class MessagesPage implements OnInit, AfterViewInit, OnDestroy {
  private isInitialized = false;
  private isPageVisible = false; // Track if page is currently visible
  @ViewChild('messageInput', { static: false }) messageInput?: ElementRef;
  @ViewChild('chatContainer', { static: false }) chatContainer?: ElementRef;
  @ViewChild('availabilityContainer', { static: false }) availabilityContainer?: ElementRef;
  @ViewChild('topScrollbar', { static: false }) topScrollbar?: ElementRef;

  private destroy$ = new Subject<void>();
  
  conversations: Conversation[] = [];
  selectedConversation: Conversation | null = null;
  messages: Message[] = [];
  isLoading = false;
  isInitialLoad = true; // Only show spinner on first load
  isLoadingMessages = false;
  isSending = false;
  newMessage = '';
  showEmptyState = false; // Control empty state visibility for smooth transitions
  
  // Typing indicator
  isTyping = false;
  otherUserTyping = false;
  typingTimeout: any;
  messageSendTimeout: any;

  // File upload and voice recording
  isUploading = false;
  isRecording = false;
  recordingDuration = 0;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recordingTimer: any;
  private conversationReloadTimeout: any;
  private messagesSubscription?: Subscription;
  private messageLoadRequestId = 0;
  pendingVoiceNote: { file: File; url: string; duration: number } | null = null;
 
  // Platform detection
  isDesktop = false;
  showDetailsPanel = false; // Toggle for details panel visibility
  hasConversationSelected = false; // Track if any conversation has been selected (prevents flicker)
  
  showUserHoverCard = false; // Toggle for user hover card visibility (deprecated - now using hoveredConversationId)
  hoveredConversationId: string | null = null; // Track which conversation is being hovered in the list
  showAvailabilityViewer = false; // Toggle for availability viewer in details panel
  showCheckout = false; // Toggle for checkout in details panel
  checkoutData: { tutorId: string; date: string; time: string; duration: number } | null = null;
  private hoverCardTimeout: any = null; // Timeout for hover card delay
  currentUserId$ = new BehaviorSubject<string>('');
  currentUserType: 'student' | 'tutor' | null = null;
  // Conversations search
  searchTerm = '';
  private searchInput$ = new Subject<string>();
  
  // Reply functionality
  replyingToMessage: Message | null = null;
  highlightedMessageId: string | null = null; // Track which message is highlighted
  private longPressTimer: any = null;
  
  // Context menu state
  showContextMenu = false;
  contextMenuPosition: any = null;
  contextMenuMessage: Message | null = null;
  
  // Track optimistic reaction updates to prevent flicker
  private optimisticReactionUpdates = new Set<string>();
  
  // Track when a message was just deleted to trust server unread counts
  private recentlyDeletedConversations = new Set<string>();
  
  // Track when avatar/name animation is happening
  private isAnimatingConversationTransition = false;
  private animationCleanupTimeout: any = null;
  private currentAnimationElements: {
    avatarClone?: HTMLElement;
    nameClone?: HTMLElement;
    sourceAvatar?: HTMLElement;
    sourceName?: HTMLElement;
  } = {};
  
  // Quick reaction emojis shown in context menu (organized in 3 rows)
  quickReactions = [
    // Positive emotions & support
    '❤️',  // Heart
    '😍',  // Heart eyes
    '🥰',  // Smiling with hearts
    '😊',  // Smiling
    '😁',  // Beaming
    '👍',  // Thumbs up
    '👏',  // Clapping
    '🙌',  // Raised hands
    '💪',  // Strong
    '🙏',  // Thanks/Please
    '🎉',  // Celebrate
    '✨',  // Sparkles
    '🔥',  // Fire
    '💯',  // 100
    '⭐',  // Star
    
    // Reactions & expressions
    '😂',  // Laughing
    '🤣',  // Rolling laughing
    '😅',  // Sweat smile
    '😆',  // Grinning squinting
    '😊',  // Blush
    '🤗',  // Hugging
    '😮',  // Wow
    '😲',  // Astonished
    '🤯',  // Mind blown
    '😱',  // Screaming
    '🤔',  // Thinking
    '🧐',  // Monocle
    '🤨',  // Raised eyebrow
    '😏',  // Smirking
    '😎',  // Cool
    
    // Negative emotions & concerns
    '😢',  // Sad
    '😭',  // Crying
    '😔',  // Pensive
    '😞',  // Disappointed
    '😟',  // Worried
    '😥',  // Sad sweat
    '😰',  // Anxious sweat
    '😬',  // Grimacing
    '🙄',  // Eye roll
    '😒',  // Unamused
    '😑',  // Expressionless
    '👎',  // Thumbs down
    '😤',  // Frustrated
    '😠',  // Angry
    '💔',  // Broken heart
    
    // Questions & emphasis
    '❓',  // Question
    '❔',  // White question
    '⁉️',  // Exclamation question
    '‼️',  // Double exclamation
    '❗',  // Exclamation
    '💡',  // Light bulb (idea)
    '🚀',  // Rocket
    '💝',  // Heart with ribbon
    '🎯',  // Target
    '✅',  // Check mark
    '❌',  // Cross mark
    '⚠️',  // Warning
  ];

  constructor(
    private messagingService: MessagingService,
    private websocketService: WebSocketService,
    private authService: AuthService,
    private platformService: PlatformService,
    private userService: UserService,
    private route: ActivatedRoute,
    private router: Router,
    private modalController: ModalController,
    private alertController: AlertController,
    private toastController: ToastController,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.isDesktop = !this.platformService.isSmallScreen();
    
    // Check if we're actually on the messages page
    const isOnMessagesPage = this.router.url.includes('/messages');
    this.isPageVisible = isOnMessagesPage;
    
    // Only set up subscriptions once
    if (!this.isInitialized) {
      this.isInitialized = true;
      
      // Connect to WebSocket
      this.websocketService.connect();
      
      // Listen for reaction updates
      this.websocketService.reactionUpdated$.pipe(
        takeUntil(this.destroy$)
      ).subscribe(data => {
        console.log('📥 Reaction update received:', data);
        
        // Find and update the message in the local array
        const index = this.messages.findIndex(m => {
          const mId = (m as any).id || (m as any)._id;
          return mId === data.messageId.toString() || mId.toString() === data.messageId.toString();
        });
        
        if (index !== -1) {
          const currentMessage = this.messages[index];
          const updatedMessage = data.message;
          
          // Ensure the message has id property
          if (!updatedMessage.id && (updatedMessage as any)._id) {
            updatedMessage.id = (updatedMessage as any)._id;
          }
          
          // Check if this is our own optimistic update coming back
          const updateKey = `${data.messageId}`;
          if (this.optimisticReactionUpdates.has(updateKey)) {
            // Normalize and compare reaction arrays
            const normalizeReactions = (reactions: any[]) => {
              return (reactions || [])
                .map(r => ({
                  emoji: r.emoji,
                  userId: this.normalizeUserId(r.userId)
                }))
                .sort((a, b) => (a.emoji + a.userId).localeCompare(b.emoji + b.userId));
            };
            
            const currentNormalized = normalizeReactions(currentMessage.reactions || []);
            const newNormalized = normalizeReactions(updatedMessage.reactions || []);
            
            const currentStr = JSON.stringify(currentNormalized);
            const newStr = JSON.stringify(newNormalized);
            
            if (currentStr === newStr) {
              console.log('⏭️ Skipping WebSocket update - matches optimistic update');
              this.optimisticReactionUpdates.delete(updateKey);
              return;
            } else {
              console.log('✅ Accepting WebSocket update - server state differs', {
                current: currentStr,
                new: newStr
              });
              this.optimisticReactionUpdates.delete(updateKey);
            }
          }
          
          console.log('✅ Updating message at index:', index);
          
          // Create new array reference for change detection
          this.messages = [
            ...this.messages.slice(0, index),
            updatedMessage,
            ...this.messages.slice(index + 1)
          ];
          
          // Update context menu if it's the same message
          const ctxId = (this.contextMenuMessage as any)?._id || this.contextMenuMessage?.id;
          if (ctxId && ctxId.toString() === data.messageId.toString()) {
            this.contextMenuMessage = updatedMessage;
            console.log('✅ Updated context menu message');
          }
          
          this.cdr.detectChanges();
        }
      });

      // Listen for message deletions
      this.websocketService.messageDeleted$.pipe(
        takeUntil(this.destroy$)
      ).subscribe(data => {
        console.log('🗑️ Message deletion received:', data);
        
        // Mark this conversation as recently having a deletion
        // This tells the reload logic to trust the server's unread count
        if (data.conversationId) {
          this.recentlyDeletedConversations.add(data.conversationId);
          
          // Clear the flag after 2 seconds (in case reload doesn't happen)
          setTimeout(() => {
            this.recentlyDeletedConversations.delete(data.conversationId);
          }, 2000);
        }
        
        // Check if this message is in the currently selected conversation
        const index = this.messages.findIndex(m => {
          const mId = (m as any).id || (m as any)._id;
          return mId === data.messageId.toString() || mId.toString() === data.messageId.toString();
        });
        
        if (index !== -1) {
          console.log('✅ Removing message from currently selected conversation at index:', index);
          
          // Remove the message from the open conversation
          this.messages = [
            ...this.messages.slice(0, index),
            ...this.messages.slice(index + 1)
          ];
          
          // Close context menu if it was showing for this message
          const ctxId = (this.contextMenuMessage as any)?._id || this.contextMenuMessage?.id;
          if (ctxId && ctxId.toString() === data.messageId.toString()) {
            this.closeContextMenu();
          }
          
          this.cdr.detectChanges();
        } else {
          console.log('ℹ️ Message not in currently selected conversation, updating conversation list');
        }
        
        // ALWAYS reload conversations to update the last message preview
        // This handles cases where:
        // 1. The deleted message was the last message in a conversation
        // 2. User A hasn't selected the conversation where the message was deleted
        // 3. User A is viewing a different conversation
        this.reloadConversationsDebounced();
      });

      // Listen for new messages (both sent and received)
      this.websocketService.newMessage$.pipe(
        takeUntil(this.destroy$)
      ).subscribe(message => {
        const currentUserId = this.getCurrentUserId();
        const normalizedCurrentUserId = this.normalizeUserId(currentUserId);
        const normalizedSenderId = this.normalizeUserId(message.senderId);
        const normalizedReceiverId = this.normalizeUserId(message.receiverId);
        const participatesInMessage = normalizedSenderId === normalizedCurrentUserId || normalizedReceiverId === normalizedCurrentUserId;

        if (!participatesInMessage) {
          return; // Ignore messages unrelated to current user
        }

        // Determine if this message applies to the currently open conversation
        const isForSelectedConversation = !!(this.selectedConversation &&
          (
            (this.selectedConversation.conversationId &&
              this.selectedConversation.conversationId === message.conversationId) ||
            (this.selectedConversation.otherUser &&
              (this.normalizeUserId(this.selectedConversation.otherUser.auth0Id) === normalizedSenderId ||
               this.normalizeUserId(this.selectedConversation.otherUser.auth0Id) === normalizedReceiverId))
          ));

        // Check if this is my message (sent by current user)
        const isMyMessage = normalizedSenderId === normalizedCurrentUserId;

        console.log('[MessagesPage] newMessage$ received', {
          messageId: message.id,
          contentPreview: message.content?.slice(0, 50),
          senderId: message.senderId,
          receiverId: message.receiverId,
          normalizedSenderId,
          normalizedReceiverId,
          currentUserId,
          normalizedCurrentUserId,
          isMyMessage,
          isForSelectedConversation,
          selectedConversationId: this.selectedConversation?.conversationId,
          selectedOtherUserId: this.selectedConversation?.otherUser?.auth0Id,
          isPageVisible: this.isPageVisible
        });

        if (isForSelectedConversation) {
          // Enhanced duplicate check - check by ID, or by content+timestamp if no ID match
          const existingMessage = this.messages.find(m => 
            m.id === message.id || 
            (m.content === message.content && 
             m.senderId === message.senderId && 
             Math.abs(new Date(m.createdAt).getTime() - new Date(message.createdAt).getTime()) < 1000)
          );
          
          if (!existingMessage) {
            this.messages.push(message);
            this.scrollToBottom(true); // Skip animation check for new incoming messages
          }

          const isActiveConversation = isForSelectedConversation && this.isPageVisible;

          this.updateConversationPreviewFromMessage(message, isMyMessage, isActiveConversation);
          
          // If this is an incoming message (not sent by us) and we're actively viewing the conversation,
          // automatically mark it as read, then update conversations
          if (!isMyMessage && this.selectedConversation?.otherUser && this.isPageVisible) {
            this.messagingService.markAsRead(this.selectedConversation.otherUser.auth0Id).subscribe({
              next: () => {
                // Reload conversations AFTER marking as read, so unread count is correct
                this.reloadConversationsDebounced();
              }
            });
          } else {
            // For outgoing messages or when not actively viewing conversation, just reload conversations
            this.reloadConversationsDebounced();
          }
          
          // If this is a message we sent, mark sending as complete
          if (isMyMessage && this.isSending) {
            this.isSending = false;
            // Clear the HTTP fallback timeout since WebSocket succeeded
            if (this.messageSendTimeout) {
              clearTimeout(this.messageSendTimeout);
              this.messageSendTimeout = null;
            }
          }
        } else {
          // Message is for another conversation belonging to the user.
          this.updateConversationPreviewFromMessage(message, isMyMessage, false);
          this.reloadConversationsDebounced();
        }
      });

    // Listen for typing indicators
    this.websocketService.typing$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(data => {
      if (this.selectedConversation && data.userId === this.selectedConversation.otherUser?.auth0Id) {
        this.otherUserTyping = data.isTyping;
      }
    });

      // Get current user ID and type
      // Use email-based ID to match backend format (dev-user-{email})
      this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe(user => {
        const email = user?.email || '';
        const userId = email ? `dev-user-${email}` : user?.sub || '';
        this.currentUserId$.next(userId);
        
        // Note: Conversations are loaded in ionViewWillEnter to ensure they load on every page visit/refresh
      });

      // Get current user type from UserService
      this.userService.currentUser$.pipe(takeUntil(this.destroy$)).subscribe(user => {
        this.currentUserType = user?.userType || null;
      });

      // Ensure current user is loaded
      this.userService.getCurrentUser().pipe(takeUntil(this.destroy$)).subscribe();

      // Check for tutorId query param to open a specific conversation
      this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
        if (params['tutorId']) {
          this.openConversationWithTutor(params['tutorId']);
          // Clear the query param after handling
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { tutorId: null },
            queryParamsHandling: 'merge'
          });
        }
      });

      // Debounce search input updates for smoother filtering
      this.searchInput$.pipe(debounceTime(150), takeUntil(this.destroy$)).subscribe(term => {
        this.searchTerm = (term || '').trim();
      });
    }

    // Note: loadConversations() is now called in the authService.user$ subscription above
    // This ensures the user is authenticated before making API calls
  }

  ngAfterViewInit() {
    // Set up dual scrollbar sync for availability viewer
    setTimeout(() => this.setupDualScrollbar(), 500);
  }

  private setupDualScrollbar() {
    if (this.availabilityContainer && this.topScrollbar) {
      const container = this.availabilityContainer.nativeElement;
      const topScroll = this.topScrollbar.nativeElement;
      
      // Sync top scrollbar content height with container scrollHeight
      const syncHeight = () => {
        const contentDiv = topScroll.querySelector('.top-scrollbar-content');
        if (contentDiv && container) {
          (contentDiv as HTMLElement).style.height = container.scrollHeight + 'px';
        }
      };
      
      // Initial sync
      setTimeout(syncHeight, 100);
      
      // Sync on scroll
      container.addEventListener('scroll', () => {
        topScroll.scrollTop = container.scrollTop;
      });
      
      topScroll.addEventListener('scroll', () => {
        container.scrollTop = topScroll.scrollTop;
      });
      
      // Re-sync when content changes (availability loads)
      const observer = new MutationObserver(syncHeight);
      observer.observe(container, { childList: true, subtree: true });
    }
  }

  // Computed list filtered by search term (matches other user's name)
  get filteredConversations(): Conversation[] {
    if (!this.searchTerm) return this.conversations;
    const searchLower = this.searchTerm.toLowerCase();
    return this.conversations.filter(c => (c.otherUser?.name || '').toLowerCase().includes(searchLower));
  }

  private normalizeUserId(id: string | undefined | null): string {
    if (!id) {
      return '';
    }
    return id.replace(/^dev-user-/, '');
  }

  private findConversationForMessage(message: Message): Conversation | undefined {
    if (message.conversationId) {
      const byId = this.conversations.find(c => c.conversationId === message.conversationId);
      if (byId) {
        return byId;
      }
    }
    const senderId = this.normalizeUserId(message.senderId);
    const receiverId = this.normalizeUserId(message.receiverId);

    return this.conversations.find(c => {
      const otherId = this.normalizeUserId(c.otherUser?.auth0Id);
      return otherId === senderId || otherId === receiverId;
    });
  }

  private getMessagePreviewText(message: Message): string {
    if (message.type === 'text') {
      return message.content;
    }
    if (message.type === 'image') {
      return message.content ? message.content : '📷 Photo';
    }
    if (message.type === 'file') {
      return message.content ? message.content : `📄 ${message.fileName || 'File'}`;
    }
    if (message.type === 'voice') {
      return message.content ? message.content : '🎤 Voice message';
    }
    return message.content;
  }

  private updateConversationPreviewFromMessage(message: Message, isMyMessage: boolean, isActiveConversation: boolean) {
    let conversation = this.findConversationForMessage(message);
    console.log('[MessagesPage] updateConversationPreviewFromMessage', {
      messageId: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      receiverId: message.receiverId,
      isMyMessage,
      isActiveConversation,
      matchedConversationId: conversation?.conversationId
    });
    if (!conversation) {
      // Conversation not found locally, fallback to reload
      console.warn('[MessagesPage] conversation not found locally; scheduling reload');
      this.reloadConversationsDebounced();
      return;
    }

    conversation.lastMessage = {
      content: this.getMessagePreviewText(message),
      senderId: message.senderId,
      createdAt: message.createdAt,
      type: message.type
    };
    conversation.updatedAt = message.createdAt;

    const normalizedSenderId = this.normalizeUserId(message.senderId);
    const conversationOtherUserId = this.normalizeUserId(conversation.otherUser?.auth0Id);
    const isFromOtherUser = conversationOtherUserId === normalizedSenderId;

    const previousUnreadCount = conversation.unreadCount || 0;

    // Update unread count logic:
    // - If this is an incoming message (not from me) AND I'm actively viewing this conversation, mark as read (unreadCount = 0)
    // - If this is an incoming message (not from me) AND I'm NOT viewing it, increment unread count
    // - If this is my own message, DON'T change the unread count (leave existing unreads untouched)
    if (!isMyMessage) {
      // Incoming message from other user
      if (isActiveConversation && isFromOtherUser) {
        // I'm actively viewing this conversation, so mark as read
        conversation.unreadCount = 0;
      } else {
        // I'm not viewing this conversation, so increment unread count
        conversation.unreadCount = (conversation.unreadCount || 0) + 1;
      }
    }
    // If isMyMessage is true, we don't change unreadCount at all - preserve existing unreads

    console.log('[MessagesPage] Unread count decision:', {
      conversationId: conversation.conversationId,
      isMyMessage,
      isActiveConversation,
      isFromOtherUser,
      previousUnreadCount,
      newUnreadCount: conversation.unreadCount,
      action: isMyMessage ? 'NO_CHANGE (my message)' : (isActiveConversation && isFromOtherUser ? 'MARK_READ' : 'INCREMENT')
    });

    // Sort conversations by most recent before animating
    this.sortAndAnimateConversations();
    
    const totalUnread = this.conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
    console.log('[MessagesPage] Updating unread count via MessagingService:', {
      totalUnread,
      conversationUnreadCounts: this.conversations.map(c => ({ id: c.conversationId, unread: c.unreadCount }))
    });
    this.messagingService.updateUnreadCount(totalUnread);
    this.cdr.detectChanges();
  }

  onSearchChange(value: string) {
    this.searchInput$.next(value);
  }

  clearSearch() {
    this.searchTerm = '';
    this.searchInput$.next('');
  }

  /**
   * Sort conversations by most recent and animate position changes using FLIP technique
   */
  private sortAndAnimateConversations() {
    // Early return if no conversations
    if (!this.conversations || this.conversations.length === 0) {
      return;
    }

    // Capture FIRST positions before sorting
    const firstPositions = new Map<string, DOMRect>();
    const conversationElements = document.querySelectorAll('.conversation-item');
    
    // If no elements in DOM yet, just sort without animation
    if (conversationElements.length === 0) {
      this.conversations.sort((a, b) => {
        const dateA = new Date(a.updatedAt || a.lastMessage?.createdAt || 0).getTime();
        const dateB = new Date(b.updatedAt || b.lastMessage?.createdAt || 0).getTime();
        return dateB - dateA; // Most recent first
      });
      return;
    }

    conversationElements.forEach((el) => {
      const conversationId = el.getAttribute('data-conversation-id');
      if (conversationId) {
        firstPositions.set(conversationId, el.getBoundingClientRect());
      }
    });

    // Sort conversations by most recent (updatedAt)
    this.conversations.sort((a, b) => {
      const dateA = new Date(a.updatedAt || a.lastMessage?.createdAt || 0).getTime();
      const dateB = new Date(b.updatedAt || b.lastMessage?.createdAt || 0).getTime();
      return dateB - dateA; // Most recent first
    });

    // Trigger change detection to update DOM
    this.cdr.detectChanges();

    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      // Capture LAST positions after sorting
      const lastPositions = new Map<string, DOMRect>();
      const updatedElements = document.querySelectorAll('.conversation-item');
      updatedElements.forEach((el) => {
        const conversationId = el.getAttribute('data-conversation-id');
        if (conversationId) {
          lastPositions.set(conversationId, el.getBoundingClientRect());
        }
      });

      // INVERT: Calculate the difference and apply transform
      updatedElements.forEach((el: Element) => {
        const htmlEl = el as HTMLElement;
        const conversationId = htmlEl.getAttribute('data-conversation-id');
        if (!conversationId) return;

        const first = firstPositions.get(conversationId);
        const last = lastPositions.get(conversationId);

        if (first && last) {
          const deltaY = first.top - last.top;
          
          // Only animate if there's actual movement
          if (Math.abs(deltaY) > 1) {
            // Apply the inverted transform immediately (no transition)
            htmlEl.style.transition = 'none';
            htmlEl.style.transform = `translateY(${deltaY}px)`;

            // PLAY: Animate to final position
            requestAnimationFrame(() => {
              htmlEl.style.transition = 'transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)';
              htmlEl.style.transform = 'translateY(0)';

              // Clean up after animation
              setTimeout(() => {
                htmlEl.style.transition = '';
                htmlEl.style.transform = '';
              }, 300);
            });
          }
        }
      });
    });
  }

  // Returns a human-friendly day label for a given date: Today, Yesterday, or short date
  formatRelativeDay(dateStr: string | Date): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const today = new Date();
    const toStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffMs = toStart(today).getTime() - toStart(date).getTime();
    const oneDay = 24 * 60 * 60 * 1000;
    const diffDays = Math.round(diffMs / oneDay);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    // Within the last week, show weekday name
    if (diffDays > 1 && diffDays < 7) {
      return date.toLocaleDateString(undefined, { weekday: 'short' });
    }
    // Otherwise show locale short date
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // Ionic lifecycle hook - called every time the view enters
  async ionViewWillEnter() {
    console.log('[MessagesPage] ionViewWillEnter called');
    // Double-check we're actually on the messages page to avoid false triggers on refresh
    const isOnMessagesPage = this.router.url.includes('/messages');
    
    this.isPageVisible = isOnMessagesPage;
    
    // Clear selected conversation on mobile to always show conversation list first
    // This ensures users can choose which conversation to view
    if (!this.isDesktop) {
      this.selectedConversation = null;
      this.messages = [];
      // Notify service that no conversation is selected
      this.messagingService.setHasSelectedConversation(false);
    }
    
    // Always try to load conversations - getCurrentUserId() waits for authentication internally
    console.log('[MessagesPage] ionViewWillEnter - attempting to load conversations');
    try {
      await this.loadConversations();
      console.log('[MessagesPage] ionViewWillEnter - conversations loaded successfully');
    } catch (error) {
      console.error('[MessagesPage] ionViewWillEnter - error loading conversations:', error);
      
      // If loading failed (possibly due to auth not ready), retry after a short delay
      console.log('[MessagesPage] ionViewWillEnter - retrying in 500ms');
      setTimeout(async () => {
        try {
          await this.loadConversations();
          console.log('[MessagesPage] ionViewWillEnter - retry successful');
        } catch (retryError) {
          console.error('[MessagesPage] ionViewWillEnter - retry failed:', retryError);
        }
      }, 500);
    }
  }

  // Ionic lifecycle hook - called every time the view leaves
  ionViewWillLeave() {
    this.isPageVisible = false;
    
    // Clear selected conversation when leaving the page
    // This ensures users see the empty state when returning and can choose which conversation to view
    // This prevents showing messages they're not ready to read
    this.selectedConversation = null;
    this.messages = []; // Also clear messages to prevent showing stale data
    // Notify service that no conversation is selected
    this.messagingService.setHasSelectedConversation(false);
  }

  private openConversationWithTutor(tutorId: string) {
    console.log('💬 Opening conversation with tutor:', tutorId);
    
    // First, ensure conversations are loaded
    this.messagingService.getConversations().subscribe({
      next: (response) => {
        this.conversations = response.conversations;
        
        // Fetch tutor info first to get both MongoDB _id and auth0Id
        this.userService.getTutorPublic(tutorId).subscribe({
          next: (tutorRes) => {
            const tutor = tutorRes.tutor;
            console.log('💬 Fetched tutor info:', {
              id: tutor.id,
              auth0Id: tutor.auth0Id,
              name: tutor.name
            });
            
            // Find conversation with this tutor by matching both id and auth0Id
            const conversation = this.conversations.find(
              conv => conv.otherUser?.auth0Id === tutor.auth0Id || 
                      conv.otherUser?.id === tutor.id ||
                      conv.otherUser?.id === tutorId ||
                      conv.otherUser?.auth0Id === tutorId
            );

            if (conversation) {
              // Conversation exists, select it
              console.log('💬 Found existing conversation, selecting it');
              this.selectConversation(conversation);
            } else {
              // No conversation exists yet - create a placeholder
              console.log('💬 No existing conversation, creating placeholder');
              const placeholderConversation: Conversation = {
                conversationId: '', // Will be created when first message is sent
                otherUser: {
                  id: tutor.id || tutorId,
                  auth0Id: tutor.auth0Id || tutorId,
                  name: tutor.name,
                  picture: tutor.picture,
                  userType: 'tutor',
                  languages: tutor.languages || [],
                  hourlyRate: tutor.hourlyRate,
                  rating: tutor.stats?.rating || tutor.rating,
                  bio: tutor.bio
                },
                lastMessage: {
                  content: '',
                  senderId: '',
                  createdAt: new Date().toISOString(),
                  type: 'text'
                },
                unreadCount: 0,
                updatedAt: new Date().toISOString()
              };
              
              // Select this placeholder conversation
              this.selectedConversation = placeholderConversation;
              this.messages = [];
              this.isLoadingMessages = false; // Don't show loading for new conversations
              // Notify service that a conversation is selected (for hiding tabs on mobile)
              this.messagingService.setHasSelectedConversation(true);
              
              // Focus the message input
              setTimeout(() => {
                if (this.messageInput?.nativeElement) {
                  const inputElement = this.messageInput.nativeElement.querySelector('input');
                  if (inputElement) {
                    inputElement.focus();
                  }
                }
                this.scrollToBottom();
              }, 100);
            }
          },
          error: (error) => {
            console.error('❌ Error fetching tutor info:', error);
          }
        });
      },
      error: (error) => {
        console.error('❌ Error loading conversations:', error);
      }
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    if (this.messagesSubscription) {
      this.messagesSubscription.unsubscribe();
      this.messagesSubscription = undefined;
    }
    if (this.messageSendTimeout) {
      clearTimeout(this.messageSendTimeout);
      this.messageSendTimeout = null;
    }
    if (this.conversationReloadTimeout) {
      clearTimeout(this.conversationReloadTimeout);
      this.conversationReloadTimeout = null;
    }
    this.clearPendingVoiceNote(false);
  }

  // Debounced conversation reload to prevent rapid flashing
  private reloadConversationsDebounced() {
    // Clear any pending reload
    if (this.conversationReloadTimeout) {
      clearTimeout(this.conversationReloadTimeout);
    }
    
    // Schedule reload after 500ms of inactivity
    this.conversationReloadTimeout = setTimeout(() => {
      this.loadConversations();
    }, 500);
  }

  loadConversations(): Promise<void> {
    console.log(`🔄 [${Date.now()}] ═══════ loadConversations START ═══════`);
    console.log(`   Current selected: ${this.selectedConversation?.otherUser?.name || 'none'}`);
    return new Promise((resolve, reject) => {
      this.isLoading = true;
      
      // Ensure user is authenticated before making API call
      this.authService.user$.pipe(
        take(1),
        switchMap(user => {
          if (!user || !user.email) {
            console.warn('[MessagesPage] loadConversations: no authenticated user yet');
            throw new Error('No authenticated user');
          }
          console.log('[MessagesPage] loadConversations: user authenticated, fetching conversations');
          return this.messagingService.getConversations();
        })
      ).subscribe({
        next: (response) => {
          console.log('📋 Loaded conversations:', response.conversations.length, response.conversations.map(c => ({
            conversationId: c.conversationId,
            otherUser: c.otherUser?.name || 'Unknown',
            lastMessageType: c.lastMessage?.type,
            isSystemMessage: (c.lastMessage as any)?.isSystemMessage
          })));
          
          // Process conversations to ensure proper preview text for all message types
          response.conversations.forEach(conv => {
            if (conv.lastMessage) {
              conv.lastMessage.content = this.getMessagePreviewText(conv.lastMessage as Message);
            }
          });
          
          // Update conversations in-place to prevent flash/re-render
          if (this.conversations.length === 0) {
            // First load - just assign
            this.conversations = response.conversations;
          } else {
            // Update existing conversations in place
            const newConversations = response.conversations;
            
            // Update or add conversations
            newConversations.forEach(newConv => {
              const existingIndex = this.conversations.findIndex(
                c => c.conversationId === newConv.conversationId
              );
              
              if (existingIndex !== -1) {
                // Smart unread count merging:
                // - If this is the SELECTED conversation and we just marked it as read, trust the server (likely 0)
                // - Otherwise, preserve local count if higher (prevents race condition when receiving new messages)
                const existingConv = this.conversations[existingIndex];
                const localUnread = existingConv.unreadCount || 0;
                const serverUnread = newConv.unreadCount || 0;
                const isSelectedConv = this.selectedConversation?.conversationId === existingConv.conversationId;
                
                // CRITICAL: Skip updating the selected conversation to prevent header flicker
                // Mutating the selected conversation object triggers change detection and causes visual glitches
                // HOWEVER, we still need to update the unread count for the badge
                if (isSelectedConv) {
                  console.log(`⏭️ [${Date.now()}] Skipping full update for selected conversation, but updating unread count: ${this.selectedConversation?.otherUser?.name}`);
                  // Only update unread count and lastMessage preview (for the badge in sidebar)
                  this.conversations[existingIndex].unreadCount = serverUnread;
                  if (newConv.lastMessage) {
                    this.conversations[existingIndex].lastMessage = newConv.lastMessage;
                  }
                  return; // Skip other updates to prevent flicker
                }
                
                // Update existing conversation properties (preserves reference)
                Object.assign(this.conversations[existingIndex], newConv);
                
                // Check if this conversation recently had a message deleted
                const recentlyDeleted = this.recentlyDeletedConversations.has(newConv.conversationId);
                
                // Only preserve higher local count if:
                // 1. Local count is higher AND
                // 2. This is NOT the selected conversation AND
                // 3. No message was recently deleted in this conversation
                if (localUnread > serverUnread && !isSelectedConv && !recentlyDeleted) {
                  console.log('[MessagesPage] loadConversations: Preserving higher local unread count', {
                    conversationId: newConv.conversationId,
                    localUnread,
                    serverUnread,
                    isSelectedConv,
                    recentlyDeleted,
                    using: localUnread
                  });
                  this.conversations[existingIndex].unreadCount = localUnread;
                } else if (recentlyDeleted) {
                  console.log('[MessagesPage] loadConversations: Message was recently deleted, trusting server unread count', {
                    conversationId: newConv.conversationId,
                    localUnread,
                    serverUnread,
                    using: serverUnread
                  });
                  // Clear the flag since we've now processed this deletion
                  this.recentlyDeletedConversations.delete(newConv.conversationId);
                }
              } else {
                // New conversation - add it
                this.conversations.push(newConv);
              }
            });
            
            // Remove conversations that no longer exist in the new data
            const newConvIds = new Set(newConversations.map(c => c.conversationId));
            for (let i = this.conversations.length - 1; i >= 0; i--) {
              if (!newConvIds.has(this.conversations[i].conversationId)) {
                this.conversations.splice(i, 1);
              }
            }
            
          // After merging conversations, recalculate total unread and update service
          const totalUnread = this.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
          console.log('[MessagesPage] loadConversations: Recalculated total unread after merge:', {
            totalUnread,
            conversationUnreads: this.conversations.map(c => ({ id: c.conversationId, unread: c.unreadCount }))
          });
          this.messagingService.updateUnreadCount(totalUnread);
        }
        
        // Sort conversations by most recent
        this.conversations.sort((a, b) => {
          const dateA = new Date(a.updatedAt || a.lastMessage?.createdAt || 0).getTime();
          const dateB = new Date(b.updatedAt || b.lastMessage?.createdAt || 0).getTime();
          return dateB - dateA; // Most recent first
        });
        
        // Do NOT auto-select conversations - let user choose which conversation to view
        // This applies to both mobile and desktop to prevent showing messages they're not ready to read
        // DO NOT update selectedConversation or chatHeaderData during background conversation reloads
        // This prevents header flicker when viewing messages
        // The selected conversation and header data are set when user clicks and should remain stable
        // Only the sidebar conversation list needs to be updated for unread counts
          
          this.isLoading = false;
          this.isInitialLoad = false; // Mark that we've loaded at least once
          
          // Control empty state visibility for smooth transitions
          if (this.conversations.length === 0) {
            setTimeout(() => {
              this.showEmptyState = true;
            }, 200);
          } else {
            this.showEmptyState = false;
          }
          
          console.log(`✅ [${Date.now()}] ═══════ loadConversations END ═══════`);
          resolve();
        },
        error: (error) => {
          console.error(`❌ [${Date.now()}] Error loading conversations:`, error);
          console.error('❌ Error details:', error.error);
          this.isLoading = false;
          this.isInitialLoad = false;
          
          // Show empty state on error after delay
          setTimeout(() => {
            this.showEmptyState = true;
          }, 200);
          
          reject(error);
        }
      });
    });
  }

  clearSelectedConversation() {
    // Clear animation flag to ensure fresh state
    if (this.isAnimatingConversationTransition) {
      console.log('🎬 Animation flag CLEARED (back button pressed)');
    }
    this.isAnimatingConversationTransition = false;
    
    // Reset container completely on mobile
    this.resetChatContainer();
    
    // Cancel any pending animation cleanup timeout
    if (this.animationCleanupTimeout) {
      console.log('⏰ Cancelling pending animation cleanup timeout (back pressed)');
      clearTimeout(this.animationCleanupTimeout);
      this.animationCleanupTimeout = null;
    }
    
    // Clean up any in-flight animation elements immediately
    if (this.currentAnimationElements.avatarClone) {
      this.currentAnimationElements.avatarClone.remove();
      console.log('🧹 Removed avatar clone');
    }
    if (this.currentAnimationElements.nameClone) {
      this.currentAnimationElements.nameClone.remove();
      console.log('🧹 Removed name clone');
    }
    if (this.currentAnimationElements.sourceAvatar) {
      this.currentAnimationElements.sourceAvatar.style.opacity = '1';
      console.log('🔄 Restored source avatar opacity');
    }
    if (this.currentAnimationElements.sourceName) {
      this.currentAnimationElements.sourceName.style.opacity = '1';
      console.log('🔄 Restored source name opacity');
    }
    this.currentAnimationElements = {};
    
    // Also restore opacity of all conversation list items (belt and suspenders approach)
    setTimeout(() => {
      const allAvatars = document.querySelectorAll('.conversation-item .conversation-avatar') as NodeListOf<HTMLElement>;
      const allNames = document.querySelectorAll('.conversation-item h3') as NodeListOf<HTMLElement>;
      
      let restoredCount = 0;
      allAvatars.forEach(avatar => {
        if (avatar.style.opacity === '0') {
          avatar.style.opacity = '1';
          restoredCount++;
        }
      });
      
      allNames.forEach(name => {
        if (name.style.opacity === '0') {
          name.style.opacity = '1';
          restoredCount++;
        }
      });
      
      if (restoredCount > 0) {
        console.log(`🔄 Restored ${restoredCount} hidden elements in conversation list`);
      }
    }, 100); // Small delay to ensure we're back on the conversation list view
    
    // Use View Transition API for smooth back animation if supported
    const updateView = () => {
      this.selectedConversation = null;
      this.hasConversationSelected = false;
      this.messages = [];
      // Notify service that no conversation is selected
      this.messagingService.setHasSelectedConversation(false);
      this.cdr.detectChanges();
    };
    
    // Check if View Transitions API is supported (modern browsers)
    if ('startViewTransition' in document) {
      (document as any).startViewTransition(() => {
        updateView();
      });
    } else {
      // Fallback for older browsers
      updateView();
    }
  }

  selectConversation(conversation: Conversation, event?: MouseEvent | TouchEvent) {
    const timestamp = Date.now();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔵 [${timestamp}] selectConversation START`);
    console.log(`   Name: ${conversation.otherUser?.name}`);
    console.log(`   Previous: ${this.selectedConversation?.otherUser?.name || 'none'}`);
    console.log(`   hasConversationSelected BEFORE: ${this.hasConversationSelected}`);
    
    // Reset animation flag to ensure clean state when selecting a new conversation
    const wasAnimating = this.isAnimatingConversationTransition;
    if (wasAnimating) {
      console.log('🎬 Animation flag CLEARED (reset at start of selectConversation)');
    }
    this.isAnimatingConversationTransition = false;
    
    // Cancel any pending animation cleanup timeout from previous navigation
    if (this.animationCleanupTimeout) {
      console.log('⏰ Cancelling pending animation cleanup timeout');
      clearTimeout(this.animationCleanupTimeout);
      this.animationCleanupTimeout = null;
    }
    
    // Clean up any leftover animation elements from previous navigation
    if (Object.keys(this.currentAnimationElements).length > 0) {
      console.log('🧹 Cleaning up leftover animation elements');
      if (this.currentAnimationElements.avatarClone) {
        this.currentAnimationElements.avatarClone.remove();
      }
      if (this.currentAnimationElements.nameClone) {
        this.currentAnimationElements.nameClone.remove();
      }
      if (this.currentAnimationElements.sourceAvatar) {
        this.currentAnimationElements.sourceAvatar.style.opacity = '1';
      }
      if (this.currentAnimationElements.sourceName) {
        this.currentAnimationElements.sourceName.style.opacity = '1';
      }
      this.currentAnimationElements = {};
    }
    
    // Close details panel and reset availability viewer and checkout when selecting a new conversation
    this.showDetailsPanel = false;
    this.showAvailabilityViewer = false;
    this.showCheckout = false;
    this.checkoutData = null;
    
    // Store unread count BEFORE loading messages (since backend marks as read when fetching)
    const unreadCount = conversation.unreadCount || 0;
    
    // Cancel any in-flight message requests to avoid stale updates
    if (this.messagesSubscription) {
      this.messagesSubscription.unsubscribe();
      this.messagesSubscription = undefined;
    }
    const requestId = ++this.messageLoadRequestId;
    
    // Clear any pending voice note preview
    this.clearPendingVoiceNote();
    
    // Reset container completely for new conversation on mobile
    this.resetChatContainer();

    console.log(`⚡ [${Date.now()}] Setting selectedConversation to: ${conversation.otherUser?.name}`);
    
    // On mobile, animate avatar and name flying from list to header
    if (event && this.platformService.isSmallScreen()) {
      this.animateSharedElements(event, conversation, unreadCount, requestId);
    } else {
      // Desktop or no event - use regular transition
      this.updateConversationView(conversation, unreadCount, requestId);
    }
    
    console.log(`🏁 [${Date.now()}] selectConversation END`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }
  
  private animateSharedElements(
    event: MouseEvent | TouchEvent,
    conversation: Conversation,
    unreadCount: number,
    requestId: number
  ) {
    // Get the clicked conversation item
    const target = (event.currentTarget || event.target) as HTMLElement;
    const conversationItem = target.closest('.conversation-item') as HTMLElement;
    
    if (!conversationItem) {
      // Fallback if we can't find the element
      this.updateConversationView(conversation, unreadCount, requestId);
      return;
    }
    
    // Get source elements
    const sourceAvatar = conversationItem.querySelector('.conversation-avatar') as HTMLElement;
    const sourceName = conversationItem.querySelector('h3') as HTMLElement;
    
    if (!sourceAvatar || !sourceName) {
      // Fallback if we can't find the elements
      this.updateConversationView(conversation, unreadCount, requestId);
      return;
    }
    
    // Get source positions before any changes
    const avatarRect = sourceAvatar.getBoundingClientRect();
    const nameRect = sourceName.getBoundingClientRect();
    
    // Create clones
    const avatarClone = sourceAvatar.cloneNode(true) as HTMLElement;
    const nameClone = sourceName.cloneNode(true) as HTMLElement;
    
    // Style clones to match source position
    Object.assign(avatarClone.style, {
      position: 'fixed',
      top: `${avatarRect.top}px`,
      left: `${avatarRect.left}px`,
      width: `${avatarRect.width}px`,
      height: `${avatarRect.height}px`,
      margin: '0',
      zIndex: '10001',
      pointerEvents: 'none',
      transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
      borderRadius: window.getComputedStyle(sourceAvatar).borderRadius
    });
    
    Object.assign(nameClone.style, {
      position: 'fixed',
      top: `${nameRect.top}px`,
      left: `${nameRect.left}px`,
      width: `${nameRect.width}px`,
      margin: '0',
      zIndex: '10001',
      pointerEvents: 'none',
      transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      fontSize: window.getComputedStyle(sourceName).fontSize,
      fontWeight: window.getComputedStyle(sourceName).fontWeight,
      color: window.getComputedStyle(sourceName).color
    });
    
    // Store references to elements for cleanup
    this.currentAnimationElements = {
      avatarClone,
      nameClone,
      sourceAvatar,
      sourceName
    };
    
    // Add clones to body
    document.body.appendChild(avatarClone);
    document.body.appendChild(nameClone);
    
    // Hide originals during animation
    sourceAvatar.style.opacity = '0';
    sourceName.style.opacity = '0';
    
    // Pre-hide destination elements to prevent flash
    // Do this BEFORE updating the view
    const preHideDestination = () => {
      const headerAvatar = document.querySelector('.chat-view-mobile .chat-header .chat-avatar') as HTMLElement;
      const headerName = document.querySelector('.chat-view-mobile .chat-header h3') as HTMLElement;
      if (headerAvatar) headerAvatar.style.opacity = '0';
      if (headerName) headerName.style.opacity = '0';
    };
    
    // Update the view and start loading messages immediately (like before)
    this.selectedConversation = conversation;
    this.hasConversationSelected = true;
    this.messagingService.setHasSelectedConversation(true);
    
    // Force immediate change detection to prevent any flicker
    this.cdr.detectChanges();
    
    // Pre-hide destination immediately after render
    preHideDestination();
    
    // Start loading messages immediately (don't wait for animation)
    Promise.resolve().then(() => {
      this.messages = [];
      this.isLoadingMessages = true;
      this.cdr.detectChanges(); // Force update here too
    });
    
    // Mark as read immediately
    if (conversation.otherUser && this.isPageVisible) {
      this.messagingService.markAsRead(conversation.otherUser.auth0Id).subscribe({
        next: () => {
          console.log(`✅ Conversation marked as read`);
        }
      });
    }
    
    // Load messages immediately
    setTimeout(() => {
      this.loadMessages(unreadCount, requestId);
    }, 0);
    
    this.cdr.detectChanges();
    
    // Wait for header to render, then animate to destination (animation happens in parallel)
    setTimeout(() => {
      const headerAvatar = document.querySelector('.chat-view-mobile .chat-header .chat-avatar') as HTMLElement;
      const headerName = document.querySelector('.chat-view-mobile .chat-header h3') as HTMLElement;
      
      if (headerAvatar && headerName) {
        // Set animation flag ONLY after confirming elements exist
        this.isAnimatingConversationTransition = true;
        console.log('🎬 Animation flag SET (starting shared element transition)');
        const destAvatarRect = headerAvatar.getBoundingClientRect();
        const destNameRect = headerName.getBoundingClientRect();
        
        // Hide destination elements during animation
        headerAvatar.style.opacity = '0';
        headerName.style.opacity = '0';
        
        // Trigger reflow
        avatarClone.offsetHeight;
        nameClone.offsetHeight;
        
        // Animate clones to destination
        Object.assign(avatarClone.style, {
          top: `${destAvatarRect.top}px`,
          left: `${destAvatarRect.left}px`,
          width: `${destAvatarRect.width}px`,
          height: `${destAvatarRect.height}px`
        });
        
        Object.assign(nameClone.style, {
          top: `${destNameRect.top}px`,
          left: `${destNameRect.left}px`,
          fontSize: window.getComputedStyle(headerName).fontSize,
          fontWeight: window.getComputedStyle(headerName).fontWeight
        });
        
        // Clean up after animation completes
        this.animationCleanupTimeout = setTimeout(() => {
          avatarClone.remove();
          nameClone.remove();
          
          // Show destination elements
          headerAvatar.style.opacity = '1';
          headerName.style.opacity = '1';
          
          // Restore source elements
          sourceAvatar.style.opacity = '1';
          sourceName.style.opacity = '1';
          
          // Clear animation flag, timeout reference, and element references
          this.isAnimatingConversationTransition = false;
          this.animationCleanupTimeout = null;
          this.currentAnimationElements = {};
          console.log('🎬 Animation flag CLEARED (animation complete)');
        }, 500); // Match transition duration
      } else {
        // Fallback if header not found - just clean up elements
        // (flag was never set since we're in this fallback)
        avatarClone.remove();
        nameClone.remove();
        sourceAvatar.style.opacity = '1';
        sourceName.style.opacity = '1';
        this.currentAnimationElements = {};
        console.log('⚠️ Header not found during animation - using fallback (no animation delay)');
      }
    }, 50); // Small delay to ensure header is rendered
  }
  
  private resetChatContainer() {
    if (!this.platformService.isSmallScreen()) return;
    
    const container = this.chatContainer?.nativeElement;
    if (!container) return;
    
    // Remove ready state (hides with visibility, not display)
    container.classList.remove('messages-ready');
    
    // Force dimension recalculation without hiding
    // Use transform trick to force reflow without affecting rendering
    const currentTransform = container.style.transform;
    container.style.transform = 'translateZ(0)';
    
    // Trigger reflow - forces browser to recalculate everything
    void container.offsetHeight;
    void container.getBoundingClientRect();
    
    // Restore transform
    container.style.transform = currentTransform || '';
    
    // Reset scroll position
    container.scrollTop = 0;
    
    console.log('🔄 Chat container fully reset');
  }
  
  private updateConversationView(conversation: Conversation, unreadCount: number, requestId: number) {
    // Update header FIRST in its own change detection cycle
    this.selectedConversation = conversation;
    this.hasConversationSelected = true;
    console.log(`✅ [${Date.now()}] selectedConversation SET, hasConversationSelected: ${this.hasConversationSelected}`);
    
    // Force immediate change detection
    this.cdr.detectChanges();
    
    // THEN clear messages and show loading in next microtask (separate cycle)
    Promise.resolve().then(() => {
      this.messages = [];
      this.isLoadingMessages = true;
      this.cdr.detectChanges(); // Force update here too
      console.log(`🔄 [${Date.now()}] Loading state set in separate cycle`);
    });
    
    // Notify service that a conversation is selected (for hiding tabs on mobile)
    this.messagingService.setHasSelectedConversation(true);
    
    // Trigger change detection
    this.cdr.detectChanges();
    
    // Small delay to ensure DOM has updated with loading state before fetching
    setTimeout(() => {
      console.log(`📤 [${Date.now()}] Calling loadMessages for: ${conversation.otherUser?.name}`);
      this.loadMessages(unreadCount, requestId);
    }, 0);
    
    // Mark as read
    if (conversation.otherUser && this.isPageVisible) {
      this.messagingService.markAsRead(conversation.otherUser.auth0Id).subscribe({
        next: () => {
          console.log(`✅ [${Date.now()}] Conversation marked as read`);
        }
      });
    }
  }
  

  loadMessages(unreadCount?: number, requestId?: number) {
    console.log(`📥 [${Date.now()}] loadMessages START for: ${this.selectedConversation?.otherUser?.name}`);
    if (!this.selectedConversation?.otherUser) return;
    
    const activeRequestId = requestId ?? ++this.messageLoadRequestId;
    
    // Cancel any previous message load subscription before starting a new one
    if (this.messagesSubscription) {
      this.messagesSubscription.unsubscribe();
      this.messagesSubscription = undefined;
    }
    
    // If this is a placeholder conversation (no conversationId), don't try to load messages
    if (!this.selectedConversation.conversationId) {
      this.messages = [];
      this.isLoadingMessages = false;
      return;
    }
    
    this.isLoadingMessages = true;
    console.log(`⏳ [${Date.now()}] isLoadingMessages = true (no cdr call)`);
    const receiverId = this.selectedConversation.otherUser.auth0Id;
    if (!receiverId) {
      console.error('❌ Cannot load messages: no auth0Id in otherUser');
      this.isLoadingMessages = false;
      return;
    }
    
    // Store unread count for scrolling (use provided value or get from conversation)
    const storedUnreadCount = unreadCount !== undefined ? unreadCount : (this.selectedConversation.unreadCount || 0);
    
    this.messagesSubscription = this.messagingService.getMessages(receiverId).subscribe({
      next: (response) => {
        console.log(`📨 [${Date.now()}] Messages received: ${response.messages?.length || 0} messages`);
        if (activeRequestId !== this.messageLoadRequestId) {
          console.log(`⚠️ [${Date.now()}] Ignoring stale response`);
          return; // Ignore stale response
        }
        
        // Ensure loading state is still true before setting messages
        // This prevents any flash during the brief moment messages are being set
        if (!this.isLoadingMessages) {
          this.isLoadingMessages = true;
        }
        
        // Set messages
        this.messages = response.messages || [];
        console.log(`💬 [${Date.now()}] Messages set (no cdr call)`);
        
        // Immediately scroll to bottom to prevent flash (will be refined later)
        requestAnimationFrame(() => {
          const container = this.chatContainer?.nativeElement;
          if (container) {
            container.scrollTop = 999999;
          }
        });
        
        setTimeout(async () => {
          if (activeRequestId !== this.messageLoadRequestId) {
            return; // Another request has started; do not update state
          }
          // Scroll to first unread message based on stored unread count
          // Note: Backend marks messages as read when fetching, so we use the stored count
          await this.scrollToFirstUnreadMessage(storedUnreadCount);

          this.isLoadingMessages = false;
          console.log(`✅ [${Date.now()}] isLoadingMessages = false (no cdr call)`);
          
          // Now that messages are loaded and UI is stable, refresh conversations
          // This updates the unread count in the sidebar without causing header flicker
          console.log(`🔄 [${Date.now()}] Calling loadConversations()`);
          this.loadConversations();
        }, 150); // Increased from 40ms to 150ms for more reliable scrolling
      },
      error: (error) => {
        if (activeRequestId !== this.messageLoadRequestId) {
          return; // Ignore stale error
        }
        console.error('Error loading messages:', error);
        this.isLoadingMessages = false;
        this.cdr.detectChanges();
        // If error is 404 (no messages yet), that's fine for new conversations
        if (error.status === 404) {
          this.messages = [];
        }
      },
      complete: () => {
        if (activeRequestId === this.messageLoadRequestId) {
          this.messagesSubscription = undefined;
        }
      }
    });
  }

  sendMessage() {
    if (!this.newMessage.trim() || !this.selectedConversation?.otherUser || this.isSending) {
      return;
    }

    // If this is a placeholder conversation (no conversationId), we need to send via HTTP
    // to create the conversation, then WebSocket will work for subsequent messages
    const isPlaceholder = !this.selectedConversation.conversationId;

    const content = this.newMessage.trim();
    const messageContent = content; // Store before clearing
    this.newMessage = '';
    this.isSending = true;

    // Stop typing indicator
    this.sendTypingIndicator(false);

    // For placeholder conversations, always use HTTP first to create the conversation
    if (isPlaceholder) {
      this.sendMessageViaHTTP(messageContent);
    } else {
      // Try WebSocket first (preferred for real-time)
      if (this.websocketService.getConnectionStatus()) {
        const receiverId = this.selectedConversation.otherUser.auth0Id;
        if (!receiverId) {
          console.error('❌ Cannot send message via WebSocket: no auth0Id');
          this.sendMessageViaHTTP(messageContent);
          return;
        }
        
        
        // Prepare replyTo data if replying
        let replyTo = undefined;
        if (this.replyingToMessage) {
          let senderName = 'Unknown';
          if (this.isMyMessage(this.replyingToMessage)) {
            senderName = 'You';
          } else {
            senderName = this.selectedConversation.otherUser.name;
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
        }
        
        this.websocketService.sendMessage(
          receiverId,
          messageContent,
          'text',
          replyTo
        );
        
        // Clear reply after sending
        this.clearReply();
        
        // Set a timeout to fallback to HTTP if WebSocket doesn't respond
        this.messageSendTimeout = setTimeout(() => {
          if (this.isSending) {
            // WebSocket didn't respond, use HTTP fallback
            this.sendMessageViaHTTP(messageContent);
          } else {
          }
        }, 2000);
      } else {
        // WebSocket not connected, use HTTP
        this.sendMessageViaHTTP(messageContent);
      }
    }
  }

  private sendMessageViaHTTP(content: string) {
    
    // If not sending anymore, WebSocket already succeeded - don't send via HTTP
    if (!this.isSending) {
      return;
    }
    
    if (!this.selectedConversation?.otherUser) {
      console.error('❌ Cannot send message: no otherUser in selectedConversation');
      return;
    }

    const receiverId = this.selectedConversation.otherUser.auth0Id;
    if (!receiverId) {
      console.error('❌ Cannot send message: no auth0Id in otherUser', this.selectedConversation.otherUser);
      return;
    }


    // Prepare replyTo data if replying
    let replyTo = undefined;
    if (this.replyingToMessage) {
      let senderName = 'Unknown';
      if (this.isMyMessage(this.replyingToMessage)) {
        senderName = 'You';
      } else {
        senderName = this.selectedConversation.otherUser?.name || 'Unknown';
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
    }

    this.messagingService.sendMessage(
      receiverId,
      content,
      'text',
      replyTo
    ).subscribe({
      next: (response) => {
        const message = response.message;
        
        // Enhanced duplicate check - check by ID, or by content+timestamp if no ID match
        const existingMessage = this.messages.find(m => 
          m.id === message.id || 
          (m.content === message.content && 
           m.senderId === message.senderId && 
           Math.abs(new Date(m.createdAt).getTime() - new Date(message.createdAt).getTime()) < 1000)
        );
        
        if (existingMessage) {
        } else {
          this.messages.push(message);
          this.scrollToBottom(true); // Skip animation check for sent messages
        }
        
        // Clear reply after successful send
        this.clearReply();
        
        // If this was a placeholder conversation, update it with the real conversationId
        if (this.selectedConversation && !this.selectedConversation.conversationId) {
          this.selectedConversation.conversationId = message.conversationId;
          // Refresh conversations to get the updated list, but preserve the current user info
          const preservedOtherUser = this.selectedConversation.otherUser;
          this.loadConversations().then(() => {
            // After loading, ensure the selected conversation still has the user info
            if (this.selectedConversation && preservedOtherUser && !this.selectedConversation.otherUser) {
              this.selectedConversation.otherUser = preservedOtherUser;
            }
          });
        } else {
          // Refresh conversations to update the list with the new message
          this.reloadConversationsDebounced();
        }
        
        this.isSending = false;
      },
      error: (error) => {
        console.error('❌ Error sending message via HTTP:', error);
        console.error('❌ Error details:', error.error);
        this.isSending = false;
        // Optionally show error to user
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
    if (!this.selectedConversation?.otherUser) return;
    
    this.websocketService.sendTypingIndicator(
      this.selectedConversation.otherUser.auth0Id,
      isTyping
    );
  }

  scrollToBottom(skipAnimationCheck = false) {
    // If animation is happening and we haven't explicitly skipped the check, wait for it
    // Use 850ms: avatar animation (500ms) + chat-view-mobile slide-in (300ms) + buffer (50ms)
    const animationDelay = (!skipAnimationCheck && this.isAnimatingConversationTransition) ? 850 : 0;
    
    if (animationDelay > 0) {
      console.log('⏳ scrollToBottom: Waiting for animations (850ms delay)');
    }
    
    setTimeout(() => {
      this.performScrollToBottom(0); // Start with attempt 0
    }, animationDelay);
  }
  
  private performScrollToBottom(attempt: number, previousHeight?: number) {
    const maxAttempts = 5; // Try up to 5 times
    const retryDelay = attempt === 0 ? 150 : 100; // First attempt 150ms (for view to render), subsequent 100ms
    
    requestAnimationFrame(() => {
      setTimeout(() => {
        const container = this.chatContainer?.nativeElement;
        if (!container) {
          console.warn('⚠️ scrollToBottom: container not found');
          return;
        }
        
        // Check if container has content
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        
        // Don't skip scrolling on first attempt - height might still be settling
        if (scrollHeight <= clientHeight && attempt > 0) {
          console.log('ℹ️ scrollToBottom: No scroll needed (content fits in view)');
          return;
        }
        
        // If height is suspiciously small on first attempt, it's likely still rendering
        if (attempt === 0 && scrollHeight < 500) {
          console.log(`⚠️ scrollHeight (${scrollHeight}) seems too small, likely still rendering - will retry`);
          // Force retry
          setTimeout(() => {
            this.performScrollToBottom(1, scrollHeight);
          }, 150);
          return;
        }
        
        const maxScroll = scrollHeight - clientHeight;
        
        // Check if height is still changing
        if (previousHeight && previousHeight !== scrollHeight) {
          console.log(`📏 Height changed: ${previousHeight} → ${scrollHeight} (still rendering)`);
        }
        
        if (attempt === 0) {
          console.log('📍 scrollToBottom (attempt 1)', {
            scrollHeight,
            clientHeight,
            maxScroll,
            currentScrollTop: container.scrollTop
          });
        }
        
        // Force scroll to absolute bottom
        container.scrollTop = maxScroll + 100;
        
        // Verify and retry if needed
        requestAnimationFrame(() => {
          const actualScrollTop = container.scrollTop;
          const actualMaxScroll = container.scrollHeight - container.clientHeight;
          
          // Check if we're at the bottom (with 10px tolerance)
          if (actualScrollTop < actualMaxScroll - 10) {
            if (attempt < maxAttempts - 1) {
              console.log(`⚠️ Scroll attempt ${attempt + 1} not at bottom, retrying... (${actualScrollTop} < ${actualMaxScroll})`);
              // Retry with updated height
              this.performScrollToBottom(attempt + 1, container.scrollHeight);
            } else {
              console.error(`❌ scrollToBottom failed after ${maxAttempts} attempts`, {
                scrollTop: actualScrollTop,
                maxScroll: actualMaxScroll,
                scrollHeight: container.scrollHeight
              });
            }
          } else {
            console.log(`✅ scrollToBottom successful (attempt ${attempt + 1})`);
          }
        });
      }, retryDelay);
    });
  }

  /**
   * Find the first unread message based on unread count
   * Since backend marks messages as read when fetching, we use the unread count
   * to determine which message to scroll to
   */
  private findFirstUnreadMessageByCount(unreadCount: number): string | null {
    if (!this.messages || this.messages.length === 0 || unreadCount <= 0) {
      console.log('📍 findFirstUnreadMessageByCount: No messages or unreadCount is 0', {
        messagesLength: this.messages?.length || 0,
        unreadCount
      });
      return null;
    }

    const currentUserId = this.getCurrentUserId();
    
    // Find messages sent by the other user (not by current user)
    // Messages are in chronological order (oldest first), so unread messages are at the end
    const otherUserMessages = this.messages.filter(message => {
      const isMyMessage = message.senderId === currentUserId || 
                         message.senderId === currentUserId.replace('dev-user-', '') ||
                         `dev-user-${message.senderId}` === currentUserId;
      return !isMyMessage;
    });
    
    console.log('📍 findFirstUnreadMessageByCount:', {
      totalMessages: this.messages.length,
      otherUserMessagesCount: otherUserMessages.length,
      unreadCount,
      currentUserId
    });
    
    // If we have unread messages, scroll to the first unread message
    // Since messages are in chronological order and unread messages are at the end,
    // the first unread message is at position (total - unreadCount)
    if (otherUserMessages.length >= unreadCount) {
      // Get the message at position (total - unreadCount) from the start
      // This gives us the first unread message
      const firstUnreadIndex = otherUserMessages.length - unreadCount;
      const firstUnreadMessage = otherUserMessages[firstUnreadIndex];
      
      console.log('📍 Found first unread message:', {
        firstUnreadIndex,
        messageId: firstUnreadMessage?.id,
        messageContent: firstUnreadMessage?.content?.substring(0, 50)
      });
      
      return firstUnreadMessage?.id || null;
    }
    
    console.log('📍 Not enough other user messages to find unread message');
    return null;
  }

  /**
   * Scroll to the first unread message, or to bottom if all messages are read
   * @param unreadCount - The number of unread messages (from conversation before loading)
   */
  async scrollToFirstUnreadMessage(unreadCount?: number) {
    await this.waitForMessagesRender();
    
    // Scroll to bottom immediately after messages render (prevent flash)
    const container = this.chatContainer?.nativeElement;
    if (container) {
      container.scrollTop = 999999;
    }
    
    // Wait for images/media to load which can affect scroll height
    await this.waitForMediaToLoad();

    // Use provided unread count, or try to find unread messages by checking read status
    const count = unreadCount !== undefined ? unreadCount : 0;
    
    let firstUnreadId: string | null = null;
    
    if (count > 0) {
      // Use unread count to find the message position
      firstUnreadId = this.findFirstUnreadMessageByCount(count);
    } else {
      // Fallback: try to find unread messages by checking read status
      // (in case some messages weren't marked as read yet)
      firstUnreadId = this.findFirstUnreadMessageByReadStatus();
    }
    
    if (firstUnreadId) {
      console.log('📍 Scrolling to first unread message:', firstUnreadId, 'unreadCount:', count);
      // Scroll to the first unread message
      this.scrollToMessageById(firstUnreadId);
    } else {
      console.log('📍 No unread messages found, scrolling to bottom');
      // All messages are read, scroll to bottom by scrolling to the input element
      this.scrollToBottomElement();
    }
  }
  
  private scrollToBottomElement() {
    // Immediately scroll to bottom to prevent any flash
    const container = this.chatContainer?.nativeElement;
    if (container) {
      container.scrollTop = 999999;
      
      // On mobile, hide messages until positioned (prevent flash)
      if (this.platformService.isSmallScreen()) {
        container.classList.remove('messages-ready');
      }
    }
    
    // Mobile needs more time due to animations
    const isMobile = this.platformService.isSmallScreen();
    const baseDelay = isMobile ? 300 : 100; // Extra time for mobile
    const animationDelay = this.isAnimatingConversationTransition ? 850 : 0;
    const totalDelay = baseDelay + animationDelay;
    
    console.log('📍 scrollToBottomElement (instant + delayed check)', { totalDelay });
    
    // Still do delayed checking to ensure we stay at bottom as content loads
    setTimeout(() => {
      this.attemptScrollToBottom(0);
    }, totalDelay);
  }
  
  private attemptScrollToBottom(attemptNumber: number) {
    const maxAttempts = 10; // More attempts for reliability
    const container = this.chatContainer?.nativeElement;
    
    if (!container) {
      console.warn('⚠️ Chat container not found');
      return;
    }
    
    if (attemptNumber === 0) {
      // Force browser to recalculate dimensions on first attempt
      void container.offsetHeight;
      
      // Immediately scroll to bottom on first attempt to avoid flash
      container.scrollTop = 999999;
    }
    
    // Check if content is actually rendered (get fresh measurements)
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    
    // If scrollHeight equals clientHeight, content likely hasn't rendered yet
    if (scrollHeight === clientHeight && attemptNumber < maxAttempts - 1) {
      if (attemptNumber === 0) {
        console.log(`⏳ Waiting for content to render...`);
      }
      // Keep scrolling to bottom while waiting
      container.scrollTop = 999999;
      setTimeout(() => {
        this.attemptScrollToBottom(attemptNumber + 1);
      }, 150); // Wait longer for content to render
      return;
    }
    
    // Ensure we're at the bottom - instant, no smooth scroll
    container.scrollTop = 999999;
    
    // Check if we're at the bottom after a short delay
    setTimeout(() => {
      const newScrollHeight = container.scrollHeight;
      const scrollTop = container.scrollTop;
      const newClientHeight = container.clientHeight;
      const maxScroll = newScrollHeight - newClientHeight;
      const distanceFromBottom = maxScroll - scrollTop;
      
      // If we're not at the bottom and haven't exceeded max attempts, try again
      if (distanceFromBottom > 50 && attemptNumber < maxAttempts - 1) {
        console.log(`⚠️ Retry ${attemptNumber + 1}: ${distanceFromBottom}px from bottom`);
        setTimeout(() => {
          this.attemptScrollToBottom(attemptNumber + 1);
        }, 100);
      } else if (distanceFromBottom > 50) {
        console.error(`❌ Failed to scroll after ${maxAttempts} attempts`);
        // Show messages anyway even if scroll failed
        if (this.platformService.isSmallScreen()) {
          container.classList.add('messages-ready');
        }
      } else {
        console.log(`✅ Scrolled to bottom (attempt ${attemptNumber + 1})`);
        // Show messages now that we're at the bottom
        if (this.platformService.isSmallScreen()) {
          container.classList.add('messages-ready');
        }
      }
    }, 100);
  }
  
  private waitForMediaToLoad(): Promise<void> {
    return new Promise(resolve => {
      const container = this.chatContainer?.nativeElement;
      if (!container) {
        resolve();
        return;
      }
      
      // Find all images and audio elements
      const images = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
      const audios = Array.from(container.querySelectorAll('audio')) as HTMLAudioElement[];
      
      if (images.length === 0 && audios.length === 0) {
        resolve();
        return;
      }
      
      let loadedCount = 0;
      const totalMedia = images.length + audios.length;
      
      const checkComplete = () => {
        loadedCount++;
        if (loadedCount >= totalMedia) {
          resolve();
        }
      };
      
      // Set timeout to not wait forever
      const timeout = setTimeout(() => {
        console.log('⏱️ Media load timeout, proceeding with scroll');
        resolve();
      }, 1000);
      
      // Wait for images to load
      images.forEach((img: HTMLImageElement) => {
        if (img.complete) {
          checkComplete();
        } else {
          img.addEventListener('load', () => {
            checkComplete();
            clearTimeout(timeout);
          });
          img.addEventListener('error', () => {
            checkComplete();
            clearTimeout(timeout);
          });
        }
      });
      
      // Wait for audio metadata to load
      audios.forEach((audio: HTMLAudioElement) => {
        if (audio.readyState >= 1) { // HAVE_METADATA
          checkComplete();
        } else {
          audio.addEventListener('loadedmetadata', () => {
            checkComplete();
            clearTimeout(timeout);
          });
          audio.addEventListener('error', () => {
            checkComplete();
            clearTimeout(timeout);
          });
        }
      });
    });
  }

  private waitForMessagesRender(maxAttempts = 20): Promise<void> {
    return new Promise(resolve => {
      // If there are no messages to render, resolve immediately
      if (!this.messages || this.messages.length === 0) {
        resolve();
        return;
      }

      let attempts = 0;

      const check = () => {
        const container = this.chatContainer?.nativeElement;
        if (!container) {
          resolve();
          return;
        }

        const firstMessage = container.querySelector('[data-message-id]');
        if (firstMessage || attempts >= maxAttempts) {
          // Add a small extra delay to ensure layout is complete
          requestAnimationFrame(() => {
            setTimeout(() => resolve(), 50);
          });
          return;
        }

        attempts += 1;
        requestAnimationFrame(check);
      };

      requestAnimationFrame(check);
    });
  }

  /**
   * Find unread message by checking read status (fallback method)
   */
  private findFirstUnreadMessageByReadStatus(): string | null {
    if (!this.messages || this.messages.length === 0) {
      return null;
    }

    const currentUserId = this.getCurrentUserId();
    
    // Find the first unread message that was sent by the other user (not by us)
    for (const message of this.messages) {
      const isMyMessage = message.senderId === currentUserId || 
                         message.senderId === currentUserId.replace('dev-user-', '') ||
                         `dev-user-${message.senderId}` === currentUserId;
      
      if (!message.read && !isMyMessage) {
        return message.id;
      }
    }
    
    return null;
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

  getCurrentUserId(): string {
    return this.currentUserId$.value;
  }

  // Check if a message was sent by the current user
  isMyMessage(message: Message): boolean {
    const currentUserId = this.getCurrentUserId();
    return message.senderId === currentUserId || 
           message.senderId === currentUserId.replace('dev-user-', '') ||
           `dev-user-${message.senderId}` === currentUserId;
  }

  // Check if message content is emoji-only (no other text)
  isEmojiOnly(content: string): boolean {
    if (!content || content.trim().length === 0) return false;
    
    // Remove all emojis and see if anything is left
    // This regex matches most emoji characters
    const emojiRegex = /[\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Component}]/gu;
    const withoutEmojis = content.replace(emojiRegex, '').trim();
    
    // Also remove variation selectors and zero-width joiners
    const cleanedText = withoutEmojis.replace(/[\u200D\uFE0F]/g, '').trim();
    
    // If nothing left after removing emojis, it's emoji-only
    // Also check that we have at least one emoji
    const hasEmoji = emojiRegex.test(content);
    return hasEmoji && cleanedText.length === 0;
  }

  // Navigate to the other user's public profile
  toggleDetailsPanel() {
    this.showDetailsPanel = !this.showDetailsPanel;
    // Reset availability viewer and checkout when closing details panel
    if (!this.showDetailsPanel) {
      this.showAvailabilityViewer = false;
      this.showCheckout = false;
      this.checkoutData = null;
    }
  }

  openBookLesson() {
    // Desktop: Open details panel and show availability viewer
    // Mobile: Open modal with availability viewer
    if (this.isDesktop) {
      this.showDetailsPanel = true;
      this.showAvailabilityViewer = true;
      this.showUserHoverCard = false; // Hide hover card
      
      // Clear hover card timeout if any
      if (this.hoverCardTimeout) {
        clearTimeout(this.hoverCardTimeout);
        this.hoverCardTimeout = null;
      }
    } else {
      // Mobile: Open in modal
      this.openAvailabilityModal();
    }
  }

  async openAvailabilityModal() {
    if (!this.selectedConversation?.otherUser) return;

    const modal = await this.modalController.create({
      component: TutorAvailabilityViewerComponent,
      componentProps: {
        tutorId: this.selectedConversation.otherUser.id,
        selectionMode: true // Emit event instead of navigating
      },
      cssClass: 'availability-modal'
    });

    await modal.present();

    // Listen for when modal is dismissed with data
    const { data } = await modal.onDidDismiss();
    
    // If a slot was selected, navigate to checkout
    if (data && data.selectedDate && data.selectedTime) {
      this.router.navigate(['/checkout'], {
        queryParams: {
          tutorId: this.selectedConversation.otherUser.id,
          date: data.selectedDate,
          time: data.selectedTime,
          duration: data.lessonMinutes || 25,
          returnTo: 'messages'  // Return to messages after booking
        }
      });
    }
  }

  closeAvailabilityViewer() {
    this.showAvailabilityViewer = false;
  }

  onSlotSelected(event: { selectedDate: string; selectedTime: string }) {
    // Store the selected slot data and show checkout
    if (this.selectedConversation?.otherUser) {
      this.checkoutData = {
        tutorId: this.selectedConversation.otherUser.id,
        date: event.selectedDate,
        time: event.selectedTime,
        duration: 25 // Default, will be updated from availability viewer if needed
      };
      this.showAvailabilityViewer = false;
      this.showCheckout = true;
    }
  }

  onCheckoutComplete() {
    // Go back to availability viewer after successful booking
    this.showCheckout = false;
    this.showAvailabilityViewer = true;
    this.checkoutData = null;
  }

  onCheckoutCancelled() {
    // Go back to availability viewer if checkout is cancelled
    this.showCheckout = false;
    this.showAvailabilityViewer = true;
    this.checkoutData = null;
  }

  showHoverCard() {
    // Clear any pending hide timeout
    if (this.hoverCardTimeout) {
      clearTimeout(this.hoverCardTimeout);
      this.hoverCardTimeout = null;
    }
    this.showUserHoverCard = true;
  }

  hideHoverCard() {
    // Add a delay before hiding to allow cursor to reach the card
    this.hoverCardTimeout = setTimeout(() => {
      this.showUserHoverCard = false;
    }, 200); // 200ms delay
  }

  // Hover card for conversation list items
  showConversationHoverCard(conversationId: string) {
    // Clear any existing timeout
    if (this.hoverCardTimeout) {
      clearTimeout(this.hoverCardTimeout);
      this.hoverCardTimeout = null;
    }
    this.hoveredConversationId = conversationId;
  }

  hideConversationHoverCard() {
    // Add a small delay before hiding
    this.hoverCardTimeout = setTimeout(() => {
      this.hoveredConversationId = null;
    }, 200);
  }

  // Get conversation by ID for hover card display
  getConversationById(conversationId: string) {
    return this.conversations.find(c => c.conversationId === conversationId);
  }

  getUserLocalTime(user: any): string {
    // If user has timezone data, calculate their local time
    if (user?.timezone) {
      try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: user.timezone,
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        return formatter.format(now);
      } catch (error) {
        console.warn('Invalid timezone:', user.timezone);
        return 'Time unavailable';
      }
    }
    return 'Time unavailable';
  }

  openOtherUserProfile(event?: MouseEvent) {
    // Prevent middle-click or Cmd/Ctrl+click from opening in new tab
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    const other = this.selectedConversation?.otherUser;
    if (!other) return;

    if (other.userType === 'tutor' && other.id) {
      // Pass returnTo parameter so tutor page knows to come back to messages
      this.router.navigate([`/tutor/${other.id}`], {
        queryParams: { returnTo: 'messages' }
      });
      return;
    }

    if (other.userType === 'student' && other.id) {
      this.router.navigate([`/student/${other.id}`], {
        queryParams: { returnTo: 'messages' }
      });
      return;
    }

    // Fallback to profile page with query params
    const queryParams: any = {};
    if (other.auth0Id) queryParams.userId = other.auth0Id;
    if (!queryParams.userId && other.id) queryParams.userId = other.id;
    this.router.navigate(['/tabs/profile'], { queryParams });
  }

  // TrackBy function for messages to prevent duplicate rendering
  trackByMessageId(index: number, message: Message): string {
    return message.id;
  }

  // TrackBy function for conversations to prevent re-rendering
  trackByConversationId(index: number, conversation: Conversation): string {
    return conversation.conversationId;
  }

  // Handle file selection
  onFileSelected(event: Event, messageType: 'image' | 'file') {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    
    this.uploadFile(file, messageType);
    
    // Reset input
    input.value = '';
  }

  // Upload file to server
  private uploadFile(file: File, messageType: 'image' | 'file' | 'voice', caption?: string) {
    if (!this.selectedConversation?.otherUser) {
      console.error('No conversation selected');
      return;
    }

    this.isUploading = true;
    const receiverId = this.selectedConversation.otherUser.auth0Id;


    this.messagingService.uploadFile(receiverId, file, messageType, caption).subscribe({
      next: (response) => {
        // Don't manually add the message here - let WebSocket handle it to avoid duplicates
        // The server will emit the message via WebSocket after successful upload
        
        // Reload conversations to update last message
        this.reloadConversationsDebounced();
        
        this.isUploading = false;
      },
      error: (error) => {
        console.error('❌ Error uploading file:', error);
        this.isUploading = false;
        // TODO: Show error toast to user
      }
    });
  }

  // Toggle voice recording
  async toggleVoiceRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.clearPendingVoiceNote();
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

        this.setPendingVoiceNote(audioFile, this.recordingDuration);

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        this.recordingDuration = 0;
        this.cdr.detectChanges();
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
      // TODO: Show error toast to user
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
  async onMessageTap(message: Message, event: any) {
    // Show context menu on long press (both mobile and desktop)
    await this.showMessageContextMenu(message, event);
  }

  onMessagePressStart(message: Message, event: any) {
    // Store the event target for later use
    const pressedElement = event.target.closest('.message-bubble');
    
    this.longPressTimer = setTimeout(async () => {
      // Create a new event-like object with the stored element
      const eventData = {
        target: pressedElement,
        type: 'longpress'
      };
      await this.showMessageContextMenu(message, eventData);
    }, 500);
  }

  onMessagePressEnd(event: any) {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  showMessageContextMenu(message: Message, event: any) {
    // Get the position of the tapped message
    const target = event.target;
    if (!target) {
      return;
    }

    const rect = target.getBoundingClientRect();
    const screenHeight = window.innerHeight;
    const screenWidth = window.innerWidth;
    const menuWidth = 260;
    // Calculate actual menu height based on content:
    // - Emoji reactions (if not my message): ~60px
    // - 4-5 action items × ~50px each = ~200-250px
    const emojiHeight = this.isMyMessage(message) ? 0 : 60;
    const actionsHeight = this.isMyMessage(message) ? 200 : 210; // 4 items vs 5 items
    const baseMenuHeight = emojiHeight + actionsHeight;
    const paddingFromEdge = 20; // Minimum padding from screen edges
    const gapFromMessage = 8; // Gap between message and menu
    
    // Calculate available space
    const spaceAbove = rect.top - paddingFromEdge;
    const spaceBelow = screenHeight - rect.bottom - paddingFromEdge;
    
    // Determine if menu should show above or below based on available space
    const showBelow = spaceBelow >= 200 || (spaceBelow >= spaceAbove && spaceBelow >= 150);
    
    // Calculate menu height and position based on available space
    let menuHeight;
    let menuTop;
    let menuBottom;
    
    if (showBelow) {
      // Show below message - use TOP positioning
      const availableHeight = spaceBelow - gapFromMessage;
      menuHeight = Math.min(baseMenuHeight, Math.max(150, availableHeight));
      menuTop = rect.bottom + gapFromMessage;
      
      // Ensure menu doesn't go off bottom of screen
      const maxTop = screenHeight - menuHeight - paddingFromEdge;
      if (menuTop > maxTop) {
        menuTop = maxTop;
      }
    } else {
      // Show above message - use BOTTOM positioning
      // This anchors the menu bottom to the message top, regardless of menu height
      const availableHeight = spaceAbove - gapFromMessage;
      menuHeight = availableHeight; // Max height available
      
      // Calculate bottom position (distance from bottom of screen to where menu should end)
      // Menu should end at: message.top - gap
      // Bottom position = screenHeight - (message.top - gap)
      menuBottom = screenHeight - rect.top + gapFromMessage;
    }
    
    // Calculate the center of the message bubble
    const messageCenterX = rect.left + (rect.width / 2);
    
    // Position menu centered on the message bubble
    let menuLeft = messageCenterX - (menuWidth / 2);
    
    // Keep menu on screen (with padding on sides)
    const minLeft = 16;
    const maxLeft = screenWidth - menuWidth - 16;
    
    if (menuLeft < minLeft) {
      menuLeft = minLeft;
    } else if (menuLeft > maxLeft) {
      menuLeft = maxLeft;
    }
    
    // Calculate where the arrow should point (relative to menu position)
    const arrowOffset = messageCenterX - menuLeft;
    
    // Clamp arrow offset to keep it within the menu bounds (with some padding)
    const clampedArrowOffset = Math.max(20, Math.min(arrowOffset, menuWidth - 20));
    
    this.contextMenuPosition = {
      top: menuTop,
      bottom: menuBottom,
      left: menuLeft,
      showBelow,
      arrowOffset: clampedArrowOffset,
      maxHeight: menuHeight
    };

    this.contextMenuMessage = message;
    this.showContextMenu = true;
  }

  closeContextMenu() {
    this.showContextMenu = false;
    this.contextMenuMessage = null;
    this.contextMenuPosition = null;
  }

  onContextMenuAction(action: string) {
    if (!this.contextMenuMessage) return;
    
    this.handleContextMenuAction(action, this.contextMenuMessage);
    this.closeContextMenu();
  }

  handleContextMenuAction(action: string, message: Message, data?: any) {
    switch (action) {
      case 'reply':
        this.setReplyTo(message);
        break;
      case 'emoji':
        // Handle emoji reaction (you can implement this later)
        console.log('React with:', data?.emoji, 'to message:', message.id);
        break;
      case 'copy':
        this.copyMessageToClipboard(message);
        break;
      case 'forward':
        // Implement forward functionality
        console.log('Forward message:', message.id);
        break;
      case 'delete':
        this.deleteMessage(message);
        break;
      case 'more':
        // Show more options
        console.log('More options for message:', message.id);
        break;
    }
  }

  async copyMessageToClipboard(message: Message) {
    const textToCopy = message.content || '';
    
    if (!textToCopy) {
      console.warn('No text content to copy');
      return;
    }

    try {
      // Try modern Clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
        await this.showCopySuccessToast();
      } else {
        // Fallback for older browsers or non-HTTPS contexts
        this.fallbackCopyToClipboard(textToCopy);
      }
    } catch (error) {
      console.error('Failed to copy with Clipboard API:', error);
      // Try fallback on error
      this.fallbackCopyToClipboard(textToCopy);
    }
  }

  private fallbackCopyToClipboard(text: string): void {
    try {
      // Create temporary textarea
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      
      // Select and copy
      textarea.focus();
      textarea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      
      if (successful) {
        this.showCopySuccessToast();
      } else {
        this.showCopyFailureToast();
      }
    } catch (error) {
      console.error('Fallback copy failed:', error);
      this.showCopyFailureToast();
    }
  }

  private async showCopySuccessToast() {
    const toast = await this.toastController.create({
      message: '✓ Message copied',
      duration: 1500,
      position: 'top',
      cssClass: 'copy-success-toast',
      mode: 'ios'
    });
    await toast.present();
  }

  private async showCopyFailureToast() {
    const toast = await this.toastController.create({
      message: 'Failed to copy message',
      duration: 2500,
      position: 'top',
      cssClass: 'copy-error-toast',
      buttons: ['OK'],
      mode: 'ios'
    });
    await toast.present();
  }

  addReactionToMessage(message: Message, emoji: string) {
    const messageId = (message as any).id || (message as any)._id;
    
    if (!messageId) {
      console.error('No message ID', message);
      return;
    }
    
    // Close the context menu immediately after clicking emoji
    this.closeContextMenu();
    
    // Find the message index
    const index = this.messages.findIndex(m => {
      const mId = (m as any).id || (m as any)._id;
      return mId === messageId;
    });
    
    if (index === -1) {
      console.error('Message not found in array');
      return;
    }
    
    // Get current user info for optimistic update
    const currentUserId = this.getCurrentUserId();
    const currentUserName = 'You'; // Could get from user service if needed
    
    // Create optimistic update - clone the message with new reaction
    const messageToUpdate = { ...this.messages[index] };
    const existingReactions = messageToUpdate.reactions || [];
    
    // Normalize current user ID for comparison
    const normalizedCurrentId = this.normalizeUserId(currentUserId);
    
    // Check if user already reacted with ANY emoji
    const existingUserReactionIndex = existingReactions.findIndex(
      r => this.normalizeUserId(r.userId) === normalizedCurrentId
    );
    
    // Check if user already reacted with THIS specific emoji
    const existingReactionIndex = existingReactions.findIndex(
      r => r.emoji === emoji && this.normalizeUserId(r.userId) === normalizedCurrentId
    );
    
    let optimisticReactions;
    if (existingReactionIndex !== -1) {
      // User clicked same emoji again - remove it (toggle off)
      optimisticReactions = existingReactions.filter((_, i) => i !== existingReactionIndex);
    } else if (existingUserReactionIndex !== -1) {
      // User already has a different emoji - replace it
      optimisticReactions = existingReactions.map((r, i) => 
        i === existingUserReactionIndex 
          ? { emoji, userId: currentUserId, userName: currentUserName }
          : r
      );
    } else {
      // User has no reaction yet - add new one
      optimisticReactions = [
        ...existingReactions,
        {
          emoji,
          userId: currentUserId,
          userName: currentUserName
        }
      ];
    }
    
    messageToUpdate.reactions = optimisticReactions;
    
    // Optimistically update the UI immediately
    this.messages = [
      ...this.messages.slice(0, index),
      messageToUpdate,
      ...this.messages.slice(index + 1)
    ];
    this.cdr.detectChanges();
    
    // Mark this message as having an optimistic update
    // This will prevent duplicate updates when WebSocket event arrives
    const updateKey = `${messageId}`;
    this.optimisticReactionUpdates.add(updateKey);
    
    // Now send the API request
    this.messagingService.addReaction(messageId, emoji).subscribe({
      next: (response) => {
        // API response successful - the WebSocket will handle the actual update
        // No need to update here since we already did the optimistic update
        // and the WebSocket reactionUpdated$ listener will sync with server state
      },
      error: (error) => {
        console.error('Error adding reaction:', error);
        
        // Remove the optimistic flag since the operation failed
        this.optimisticReactionUpdates.delete(updateKey);
        
        // Roll back the optimistic update on error
        const currentIndex = this.messages.findIndex(m => {
          const mId = (m as any).id || (m as any)._id;
          return mId === messageId;
        });
        
        if (currentIndex !== -1) {
          // Restore original message (from before optimistic update)
          const originalMessage = { ...this.messages[currentIndex] };
          originalMessage.reactions = existingReactions; // Restore original reactions
          
          this.messages = [
            ...this.messages.slice(0, currentIndex),
            originalMessage,
            ...this.messages.slice(currentIndex + 1)
          ];
          this.cdr.detectChanges();
        }
      }
    });
  }

  onReactionClick(message: Message, emoji: string, event: Event) {
    event.stopPropagation();
    // Open context menu for this message at the reaction location
    this.onMessageTap(message, event as any);
  }

  hasReaction(message: Message, emoji: string): boolean {
    if (!message.reactions || message.reactions.length === 0) return false;
    const currentUserId = this.getCurrentUserId();
    const normalizedCurrentId = this.normalizeUserId(currentUserId);
    return message.reactions.some(r => {
      const normalizedReactionUserId = this.normalizeUserId(r.userId);
      return r.emoji === emoji && normalizedReactionUserId === normalizedCurrentId;
    });
  }

  setReplyTo(message: Message) {
    // Get sender name
    let senderName = 'Unknown';
    if (this.isMyMessage(message)) {
      senderName = 'You';
    } else {
      senderName = this.selectedConversation?.otherUser?.name || 'Unknown';
    }
    
    this.replyingToMessage = message;
    this.cdr.detectChanges(); // Force change detection
    
    // Focus the input (works for both desktop and mobile)
    setTimeout(async () => {
      if (this.messageInput?.nativeElement) {
        // For ion-input, we need to call setFocus() method
        try {
          await this.messageInput.nativeElement.setFocus();
        } catch (e) {
          // Fallback to regular focus if setFocus is not available
          const inputElement = this.messageInput.nativeElement.querySelector('input');
          if (inputElement) {
            inputElement.focus();
          }
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
      console.warn('⚠️ Message ID is undefined');
      this.scrollToBottom(true); // Skip animation check for fallback
      return;
    }
    
    // Make messages visible immediately for unread message scroll
    const container = this.chatContainer?.nativeElement;
    if (container && this.platformService.isSmallScreen()) {
      container.classList.add('messages-ready');
      console.log('📱 Mobile: Added messages-ready class for unread scroll');
      // Force change detection to ensure messages render
      this.cdr.detectChanges();
    }
    
    console.log('⏱️ Setting setTimeout for 300ms to find message');
    
    // Longer delay to ensure messages are in DOM (especially after reset)
    setTimeout(() => {
      console.log('⏰ scrollToMessageById setTimeout fired (300ms elapsed)');
      try {
        console.log('🔍 Attempting to find message element:', messageId);
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement;
        
        
        if (!messageElement) {
          const allMessages = document.querySelectorAll('[data-message-id]');
          console.warn(`❌ Message ${messageId} not found. Total messages: ${allMessages.length}`);
          
          // Log first few message IDs to debug
          const messageIds = Array.from(allMessages).slice(0, 5).map(el => el.getAttribute('data-message-id'));
          console.log('First few message IDs in DOM:', messageIds);
          
          // Fallback to scrolling to bottom if message not found
          this.scrollToBottom(true); // Skip animation check for fallback
          return;
        }
      
      // Get the scrollable container
      const container = this.chatContainer?.nativeElement || 
                       document.querySelector('.chat-messages') ||
                       document.querySelector('.messages-list');
      
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
      
      } catch (error) {
        console.error('❌ Error in scrollToMessageById:', error);
      }
    }, 300); // Increased from 100ms to allow container reset and rendering
  }

  // Scroll to and highlight the message being replied to (for the input preview button)
  scrollToRepliedMessage(event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (!this.replyingToMessage) {
      console.warn('⚠️ No replyingToMessage set');
      return;
    }
    
    const messageId = this.replyingToMessage.id;
    if (messageId) {
      this.scrollToMessageById(messageId, event);
    }
  }

  private setPendingVoiceNote(file: File, duration: number) {
    this.clearPendingVoiceNote(false);
    const url = URL.createObjectURL(file);
    this.pendingVoiceNote = {
      file,
      url,
      duration
    };
  }

  clearPendingVoiceNote(triggerChange: boolean = true) {
    if (this.pendingVoiceNote) {
      URL.revokeObjectURL(this.pendingVoiceNote.url);
      this.pendingVoiceNote = null;
      if (triggerChange) {
        this.cdr.detectChanges();
      }
    }
  }

  async deleteMessage(message: Message) {
    const messageId = (message as any).id || (message as any)._id;
    
    if (!messageId) {
      console.error('No message ID');
      return;
    }

    // Show confirmation dialog
    const alert = await this.alertController.create({
      header: 'Delete Message',
      message: 'Are you sure you want to delete this message? This action cannot be undone.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            // Call the delete API
            this.messagingService.deleteMessage(messageId).subscribe({
              next: (response) => {
                console.log('✅ Message deleted successfully:', response);
                
                // Remove the message from the local array
                const index = this.messages.findIndex(m => {
                  const mId = (m as any).id || (m as any)._id;
                  return mId === messageId;
                });
                
                if (index !== -1) {
                  this.messages = [
                    ...this.messages.slice(0, index),
                    ...this.messages.slice(index + 1)
                  ];
                  
                  // Reload conversations to update last message
                  this.reloadConversationsDebounced();
                  
                  this.cdr.detectChanges();
                }
              },
              error: (error) => {
                console.error('❌ Error deleting message:', error);
                // Show error toast
                this.showErrorToast('Failed to delete message');
              }
            });
          }
        }
      ]
    });

    await alert.present();
  }

  private async showErrorToast(message: string) {
    // You can implement this with Ionic Toast if needed
    console.error(message);
  }

  sendPendingVoiceNote() {
    if (!this.pendingVoiceNote || !this.selectedConversation?.otherUser || this.isUploading) {
      return;
    }

    const voiceNote = this.pendingVoiceNote;
    this.pendingVoiceNote = null;
    URL.revokeObjectURL(voiceNote.url);
    this.cdr.detectChanges();

    this.uploadFile(voiceNote.file, 'voice');
  }
}
