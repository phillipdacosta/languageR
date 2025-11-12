import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ModalController } from '@ionic/angular';
import { PlatformService } from '../services/platform.service';
import { MessagingService, Conversation, Message } from '../services/messaging.service';
import { WebSocketService } from '../services/websocket.service';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';
import { ImageViewerModal } from './image-viewer-modal.component';
import { MessageContextMenuComponent } from './message-context-menu.component';
import { Subject, BehaviorSubject, Subscription } from 'rxjs';
import { takeUntil, debounceTime, take, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-messages',
  templateUrl: 'messages.page.html',
  styleUrls: ['messages.page.scss'],
  standalone: false,
})
export class MessagesPage implements OnInit, OnDestroy {
  private isInitialized = false;
  private isPageVisible = false; // Track if page is currently visible
  @ViewChild('messageInput', { static: false }) messageInput?: ElementRef;
  @ViewChild('chatContainer', { static: false }) chatContainer?: ElementRef;

  private destroy$ = new Subject<void>();
  
  conversations: Conversation[] = [];
  selectedConversation: Conversation | null = null;
  messages: Message[] = [];
  isLoading = false;
  isInitialLoad = true; // Only show spinner on first load
  isLoadingMessages = false;
  isSending = false;
  newMessage = '';
  
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

  constructor(
    private messagingService: MessagingService,
    private websocketService: WebSocketService,
    private authService: AuthService,
    private platformService: PlatformService,
    private userService: UserService,
    private route: ActivatedRoute,
    private router: Router,
    private modalController: ModalController,
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
            this.scrollToBottom();
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

    this.conversations = [...this.conversations];
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
    console.log('[MessagesPage] loadConversations: starting');
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
                
                // Update existing conversation properties (preserves reference)
                Object.assign(this.conversations[existingIndex], newConv);
                
                // Only preserve higher local count if:
                // 1. Local count is higher AND
                // 2. This is NOT the selected conversation (selected conversation always trusts server for mark-as-read)
                if (localUnread > serverUnread && !isSelectedConv) {
                  console.log('[MessagesPage] loadConversations: Preserving higher local unread count', {
                    conversationId: newConv.conversationId,
                    localUnread,
                    serverUnread,
                    isSelectedConv,
                    using: localUnread
                  });
                  this.conversations[existingIndex].unreadCount = localUnread;
                } else if (isSelectedConv && serverUnread !== localUnread) {
                  console.log('[MessagesPage] loadConversations: Accepting server unread count for selected conversation', {
                    conversationId: newConv.conversationId,
                    localUnread,
                    serverUnread,
                    using: serverUnread
                  });
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
        
        // Do NOT auto-select conversations - let user choose which conversation to view
        // This applies to both mobile and desktop to prevent showing messages they're not ready to read
        // If we have a selected conversation, update it with the latest data
          if (this.selectedConversation) {
            const updatedConv = this.conversations.find(
              c => c.conversationId === this.selectedConversation?.conversationId ||
                   (this.selectedConversation?.otherUser && 
                    c.otherUser?.auth0Id === this.selectedConversation.otherUser.auth0Id)
            );
            
            if (updatedConv) {
              // Preserve user info if it exists in selected conversation but not in updated
              if (this.selectedConversation.otherUser && !updatedConv.otherUser) {
                updatedConv.otherUser = this.selectedConversation.otherUser;
              }
              this.selectedConversation = updatedConv;
            }
          }
          
          this.isLoading = false;
          this.isInitialLoad = false; // Mark that we've loaded at least once
          
          resolve();
        },
        error: (error) => {
          console.error('❌ MessagesPage: Error loading conversations:', error);
          console.error('❌ Error details:', error.error);
          this.isLoading = false;
          this.isInitialLoad = false;
          reject(error);
        }
      });
    });
  }

  selectConversation(conversation: Conversation) {
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

    // CRITICAL: Clear old messages and set loading state SYNCHRONOUSLY
    // This must happen before any async operations to prevent flash
    this.messages = [];
    this.isLoadingMessages = true;
    this.cdr.detectChanges();
    
    // Set new conversation
    this.selectedConversation = conversation;
    
    // Small delay to ensure DOM has updated with loading state before fetching
    // This prevents any flash of old content
    setTimeout(() => {
      this.loadMessages(unreadCount, requestId);
    }, 0);
    
    // Mark as read and reload conversations to update unread count
    // Only mark as read if the page is actually visible to the user
    if (conversation.otherUser && this.isPageVisible) {
      this.messagingService.markAsRead(conversation.otherUser.auth0Id).subscribe({
        next: () => {
          // Reload conversations to update the unread count in the sidebar and badge
          this.loadConversations();
        }
      });
    } else if (conversation.otherUser && !this.isPageVisible) {
    }
  }

  loadMessages(unreadCount?: number, requestId?: number) {
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
      this.cdr.detectChanges();
      return;
    }
    
    this.isLoadingMessages = true;
    this.cdr.detectChanges();
    const receiverId = this.selectedConversation.otherUser.auth0Id;
    if (!receiverId) {
      console.error('❌ Cannot load messages: no auth0Id in otherUser');
      this.isLoadingMessages = false;
      this.cdr.detectChanges();
      return;
    }
    
    // Store unread count for scrolling (use provided value or get from conversation)
    const storedUnreadCount = unreadCount !== undefined ? unreadCount : (this.selectedConversation.unreadCount || 0);
    
    this.messagesSubscription = this.messagingService.getMessages(receiverId).subscribe({
      next: (response) => {
        if (activeRequestId !== this.messageLoadRequestId) {
          return; // Ignore stale response
        }
        
        // Ensure loading state is still true before setting messages
        // This prevents any flash during the brief moment messages are being set
        if (!this.isLoadingMessages) {
          this.isLoadingMessages = true;
        }
        
        // Set messages
        this.messages = response.messages || [];
        
        // Force change detection to update DOM
        this.cdr.detectChanges();
        
        setTimeout(async () => {
          if (activeRequestId !== this.messageLoadRequestId) {
            return; // Another request has started; do not update state
          }
          // Scroll to first unread message based on stored unread count
          // Note: Backend marks messages as read when fetching, so we use the stored count
          await this.scrollToFirstUnreadMessage(storedUnreadCount);

          this.isLoadingMessages = false;
          this.cdr.detectChanges();
        }, 40);
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
          this.scrollToBottom();
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

  scrollToBottom() {
    setTimeout(() => {
      const container = this.chatContainer?.nativeElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 100);
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
      // All messages are read, scroll to bottom
      this.scrollToBottom();
    }
  }

  private waitForMessagesRender(maxAttempts = 10): Promise<void> {
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
          requestAnimationFrame(() => resolve());
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

  // Navigate to the other user's public profile
  openOtherUserProfile() {
    const other = this.selectedConversation?.otherUser;
    if (!other) return;

    if (other.userType === 'tutor' && other.id) {
      this.router.navigate([`/tutor/${other.id}`]);
      return;
    }

    if (other.userType === 'student' && other.id) {
      this.router.navigate([`/student/${other.id}`]);
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
        
        // Add message to local messages array
        this.messages.push(response.message);
        this.scrollToBottom();
        
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
    console.log('📱 onMessageTap called', event.type);
    // Show context menu on long press (both mobile and desktop)
    await this.showMessageContextMenu(message, event);
  }

  onMessagePressStart(message: Message, event: any) {
    console.log('👇 Press start', event);
    
    // Store the event target for later use
    const pressedElement = event.target.closest('.message-bubble');
    
    this.longPressTimer = setTimeout(async () => {
      console.log('⏰ Long press triggered');
      // Create a new event-like object with the stored element
      const eventData = {
        target: pressedElement,
        type: 'longpress'
      };
      await this.showMessageContextMenu(message, eventData);
    }, 500);
  }

  onMessagePressEnd(event: any) {
    console.log('👆 Press end');
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  showMessageContextMenu(message: Message, event: any) {
    console.log('🎯 showMessageContextMenu called');
    
    // Get the position of the tapped message
    const target = event.target;
    if (!target) {
      console.log('❌ No message bubble found');
      return;
    }

    const rect = target.getBoundingClientRect();
    const screenHeight = window.innerHeight;
    const screenWidth = window.innerWidth;
    const menuWidth = 260;
    const menuHeight = this.isMyMessage(message) ? 300 : 350; // Different height with/without emojis
    
    console.log('📏 Message bubble rect:', {
      left: rect.left.toFixed(1),
      right: rect.right.toFixed(1),
      top: rect.top.toFixed(1),
      bottom: rect.bottom.toFixed(1),
      width: rect.width.toFixed(1),
      centerX: (rect.left + rect.width / 2).toFixed(1)
    });
    console.log('📱 Screen:', { width: screenWidth, height: screenHeight });
    
    // Determine if menu should show above or below the message
    const spaceBelow = screenHeight - rect.bottom;
    const spaceAbove = rect.top;
    const showBelow = spaceBelow > menuHeight || spaceBelow > spaceAbove;
    
    console.log('📊 Space analysis:', { 
      spaceBelow, 
      spaceAbove, 
      menuHeight,
      showBelow 
    });
    
    // Calculate the center of the message bubble
    const messageCenterX = rect.left + (rect.width / 2);
    
    // Position menu centered on the message bubble
    let menuLeft = messageCenterX - (menuWidth / 2);
    
    // Keep menu on screen (with 16px padding on sides)
    const minLeft = 16;
    const maxLeft = screenWidth - menuWidth - 16;
    
    const originalMenuLeft = menuLeft;
    if (menuLeft < minLeft) {
      menuLeft = minLeft;
    } else if (menuLeft > maxLeft) {
      menuLeft = maxLeft;
    }
    
    // Calculate where the arrow should point (relative to menu position)
    // Arrow should point to the center of the message bubble
    const arrowOffset = messageCenterX - menuLeft;
    
    // Clamp arrow offset to keep it within the menu bounds (with some padding)
    const clampedArrowOffset = Math.max(20, Math.min(arrowOffset, menuWidth - 20));
    
    this.contextMenuPosition = {
      top: showBelow ? rect.bottom + 12 : rect.top - menuHeight - 12,
      left: menuLeft,
      showBelow,
      arrowOffset: clampedArrowOffset
    };

    console.log('📍 Final position:', {
      ...this.contextMenuPosition,
      messageCenterX: messageCenterX.toFixed(1),
      originalMenuLeft: originalMenuLeft.toFixed(1),
      adjustedMenuLeft: menuLeft.toFixed(1),
      arrowWillPointAt: (menuLeft + clampedArrowOffset).toFixed(1)
    });

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
        // Already handled in the component
        break;
      case 'forward':
        // Implement forward functionality
        console.log('Forward message:', message.id);
        break;
      case 'delete':
        // Implement delete functionality
        console.log('Delete message:', message.id);
        break;
      case 'more':
        // Show more options
        console.log('More options for message:', message.id);
        break;
    }
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
    
    // Focus the input
    setTimeout(() => {
      this.messageInput?.nativeElement?.focus();
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
      this.scrollToBottom();
      return;
    }
    
    
    // Small delay to ensure DOM is ready
    setTimeout(() => {
      const messageElement = document.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement;
      
      
      if (!messageElement) {
        const allMessages = document.querySelectorAll('[data-message-id]');
        console.warn(`❌ Message ${messageId} not found. Total messages: ${allMessages.length}`);
        // Fallback to scrolling to bottom if message not found
        this.scrollToBottom();
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
      
    }, 100);
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
