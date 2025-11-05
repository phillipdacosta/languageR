import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PlatformService } from '../services/platform.service';
import { MessagingService, Conversation, Message } from '../services/messaging.service';
import { WebSocketService } from '../services/websocket.service';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';
import { Subject, BehaviorSubject } from 'rxjs';
import { takeUntil, debounceTime } from 'rxjs/operators';

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
  isLoadingMessages = false;
  isSending = false;
  newMessage = '';
  
  // Typing indicator
  isTyping = false;
  otherUserTyping = false;
  typingTimeout: any;
  messageSendTimeout: any;

  // Platform detection
  isDesktop = false;
  currentUserId$ = new BehaviorSubject<string>('');
  currentUserType: 'student' | 'tutor' | null = null;

  constructor(
    private messagingService: MessagingService,
    private websocketService: WebSocketService,
    private authService: AuthService,
    private platformService: PlatformService,
    private userService: UserService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    this.isDesktop = !this.platformService.isSmallScreen();
    
    // Check if we're actually on the messages page
    const isOnMessagesPage = this.router.url.includes('/messages');
    console.log('📱 ngOnInit: Current URL:', this.router.url, 'isOnMessagesPage:', isOnMessagesPage);
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
        console.log('📬 Received message from WebSocket:', message.id, 'Content:', message.content?.substring(0, 20));
        const currentUserId = this.getCurrentUserId();
        console.log('🔍 CurrentUserId:', currentUserId, 'Message senderId:', message.senderId);
        const otherUserId = this.selectedConversation?.otherUser?.auth0Id;
        
        // Check if message belongs to current conversation
        if (this.selectedConversation && otherUserId &&
            (message.senderId === otherUserId || message.receiverId === otherUserId ||
             message.senderId === currentUserId || message.receiverId === currentUserId)) {
          
          // Check if this is my message (sent by me)
          // Handle both formats: with and without 'dev-user-' prefix
          const isMyMessage = message.senderId === currentUserId || 
                              message.senderId === currentUserId.replace('dev-user-', '') ||
                              `dev-user-${message.senderId}` === currentUserId;
          
          // Enhanced duplicate check - check by ID, or by content+timestamp if no ID match
          const existingMessage = this.messages.find(m => 
            m.id === message.id || 
            (m.content === message.content && 
             m.senderId === message.senderId && 
             Math.abs(new Date(m.createdAt).getTime() - new Date(message.createdAt).getTime()) < 1000)
          );
          
          if (existingMessage) {
            console.log('⚠️ Duplicate message detected, skipping:', message.id);
          } else {
            console.log('✅ Adding message to array:', message.id);
            this.messages.push(message);
            this.scrollToBottom();
            
            // If this is an incoming message (not sent by us) and we're actively viewing the conversation,
            // automatically mark it as read, then update conversations
            if (!isMyMessage && this.selectedConversation?.otherUser && this.isPageVisible) {
              console.log('📖 Auto-marking incoming message as read since we are ACTIVELY viewing the conversation');
              this.messagingService.markAsRead(this.selectedConversation.otherUser.auth0Id).subscribe({
                next: () => {
                  console.log('✅ Incoming message marked as read, now reloading conversations');
                  // Reload conversations AFTER marking as read, so unread count is correct
                  this.loadConversations();
                }
              });
            } else {
              // For outgoing messages or when not actively viewing conversation, just reload conversations
              console.log('📬 Not auto-marking as read (isPageVisible:', this.isPageVisible, ')');
              this.loadConversations();
            }
          }
          
          // If this is a message we sent, mark sending as complete
          if (isMyMessage && this.isSending) {
            console.log('✅ Message send confirmed via WebSocket, clearing timeout and setting isSending = false');
            this.isSending = false;
            // Clear the HTTP fallback timeout since WebSocket succeeded
            if (this.messageSendTimeout) {
              console.log('🗑️ Clearing HTTP fallback timeout');
              clearTimeout(this.messageSendTimeout);
              this.messageSendTimeout = null;
            } else {
              console.log('⚠️ No timeout to clear (already cleared or never set)');
            }
          } else {
            console.log('🔍 Received message - isMyMessage:', isMyMessage, 'isSending:', this.isSending);
          }
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
        console.log('🔑 AuthService user updated - email:', email, 'setting currentUserId to:', userId);
        this.currentUserId$.next(userId);
        
        // Load conversations once user is authenticated (important for page refresh)
        if (email && !this.conversations.length) {
          console.log('✅ User authenticated, loading conversations');
          this.loadConversations();
        }
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
    }

    // Note: loadConversations() is now called in the authService.user$ subscription above
    // This ensures the user is authenticated before making API calls
  }

  // Ionic lifecycle hook - called every time the view enters
  async ionViewWillEnter() {
    // Double-check we're actually on the messages page to avoid false triggers on refresh
    const isOnMessagesPage = this.router.url.includes('/messages');
    console.log('📱 ionViewWillEnter: Current URL:', this.router.url, 'isOnMessagesPage:', isOnMessagesPage);
    
    this.isPageVisible = isOnMessagesPage;
    
    // Only load conversations if user is authenticated
    const currentUserId = this.getCurrentUserId();
    if (currentUserId) {
      console.log('📱 ionViewWillEnter: User authenticated, loading conversations');
      await this.loadConversations();
    } else {
      console.log('📱 ionViewWillEnter: User not yet authenticated, skipping loadConversations');
    }
    
  }

  // Ionic lifecycle hook - called every time the view leaves
  ionViewWillLeave() {
    console.log('📱 ionViewWillLeave: Page is no longer visible');
    this.isPageVisible = false;
    
    // On mobile, clear selected conversation when leaving so it auto-selects again on return
    // On desktop, keep it selected so the user returns to the same conversation
    if (!this.isDesktop) {
      console.log('📱 Mobile: Clearing selected conversation');
      this.selectedConversation = null;
    }
  }

  private openConversationWithTutor(tutorId: string) {
    // First, ensure conversations are loaded
    this.messagingService.getConversations().subscribe({
      next: (response) => {
        this.conversations = response.conversations;
        
        // Find conversation with this tutor
        const conversation = this.conversations.find(
          conv => conv.otherUser?.auth0Id === tutorId || conv.otherUser?.id === tutorId
        );

        if (conversation) {
          // Conversation exists, select it
          this.selectConversation(conversation);
        } else {
          // No conversation exists yet - we need to create a placeholder
          // Fetch tutor info to create a conversation entry
          this.userService.getTutorPublic(tutorId).subscribe({
            next: (tutorRes) => {
              const tutor = tutorRes.tutor;
              // Create a placeholder conversation object with tutor details
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
              
              // On desktop, scroll to show the conversation
              if (this.isDesktop) {
                setTimeout(() => {
                  this.scrollToBottom();
                }, 100);
              }
            },
            error: (error) => {
              console.error('Error fetching tutor info:', error);
            }
          });
        }
      },
      error: (error) => {
        console.error('Error loading conversations:', error);
      }
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    if (this.messageSendTimeout) {
      clearTimeout(this.messageSendTimeout);
    }
  }

  loadConversations(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('📥 MessagesPage: loadConversations called');
      this.isLoading = true;
      this.messagingService.getConversations().subscribe({
        next: (response) => {
          console.log('✅ MessagesPage: Received conversations response:', response);
          console.log('✅ Number of conversations:', response.conversations?.length || 0);
          
          this.conversations = response.conversations;
          console.log('🔍 Conversations loaded:', this.conversations.length);
          console.log('🔍 Selected conversation before auto-select:', this.selectedConversation?.conversationId || 'none');
          console.log('🔍 isPageVisible:', this.isPageVisible);
          
          // If there's only 1 conversation, auto-select it when page becomes visible
          // Only select if it's NOT already the selected conversation (avoid infinite loop)
          if (this.conversations.length === 1 && this.isPageVisible) {
            const conv = this.conversations[0];
            const isAlreadySelected = this.selectedConversation?.conversationId === conv.conversationId ||
                                      (this.selectedConversation?.otherUser?.auth0Id === conv.otherUser?.auth0Id);
            
            if (!isAlreadySelected) {
              console.log('📱 Auto-selecting the only conversation (badge should disappear)');
              this.selectConversation(conv);
            } else {
              console.log('📱 Single conversation already selected, but checking if it needs to be marked as read');
              // If already selected but has unread messages, mark as read
              if (conv.unreadCount > 0 && conv.otherUser) {
                console.log('📱 Marking already-selected conversation as read (unreadCount:', conv.unreadCount, ')');
                this.messagingService.markAsRead(conv.otherUser.auth0Id).subscribe({
                  next: () => {
                    console.log('✅ Marked as read, badge should now disappear');
                    // Update the local unread count
                    conv.unreadCount = 0;
                    // Manually update the MessagingService's unreadCount to update the tab badge
                    const totalUnread = this.conversations.reduce((sum, c) => sum + c.unreadCount, 0);
                    console.log('📊 Updating badge count to:', totalUnread);
                    this.messagingService.updateUnreadCount(totalUnread);
                  }
                });
              }
            }
          }
          // On desktop, always auto-select first conversation if none selected
          else if (this.isDesktop && !this.selectedConversation && this.conversations.length > 0 && this.isPageVisible) {
            console.log('📱 Desktop: Auto-selecting first conversation');
            this.selectConversation(this.conversations[0]);
          }
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
          
          resolve();
        },
        error: (error) => {
          console.error('❌ MessagesPage: Error loading conversations:', error);
          console.error('❌ Error details:', error.error);
          this.isLoading = false;
          reject(error);
        }
      });
    });
  }

  selectConversation(conversation: Conversation) {
    this.selectedConversation = conversation;
    this.messages = [];
    this.loadMessages();
    
    // Mark as read and reload conversations to update unread count
    // Only mark as read if the page is actually visible to the user
    if (conversation.otherUser && this.isPageVisible) {
      console.log('✅ Marking conversation as read (page is visible)');
      this.messagingService.markAsRead(conversation.otherUser.auth0Id).subscribe({
        next: () => {
          console.log('✅ Messages marked as read, reloading conversations to update badge');
          // Reload conversations to update the unread count in the sidebar and badge
          this.loadConversations();
        }
      });
    } else if (conversation.otherUser && !this.isPageVisible) {
      console.log('⏸️ Not marking as read yet - page is not visible');
    }
  }

  loadMessages() {
    if (!this.selectedConversation?.otherUser) return;
    
    this.isLoadingMessages = true;
    this.messagingService.getMessages(this.selectedConversation.otherUser.auth0Id).subscribe({
      next: (response) => {
        this.messages = response.messages;
        this.isLoadingMessages = false;
        this.scrollToBottom();
      },
      error: (error) => {
        console.error('Error loading messages:', error);
        this.isLoadingMessages = false;
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
        
        console.log('📤 Sending message via WebSocket to:', receiverId, 'Content:', messageContent);
        this.websocketService.sendMessage(
          receiverId,
          messageContent
        );
        
        // Set a timeout to fallback to HTTP if WebSocket doesn't respond
        console.log('⏱️ Setting 2-second timeout for HTTP fallback');
        this.messageSendTimeout = setTimeout(() => {
          console.log('⏰ Timeout fired! isSending:', this.isSending);
          if (this.isSending) {
            console.log('⚠️ WebSocket timeout, falling back to HTTP');
            // WebSocket didn't respond, use HTTP fallback
            this.sendMessageViaHTTP(messageContent);
          } else {
            console.log('✅ Timeout fired but message already sent via WebSocket, skipping HTTP');
          }
        }, 2000);
      } else {
        // WebSocket not connected, use HTTP
        console.log('⚠️ WebSocket not connected, using HTTP');
        this.sendMessageViaHTTP(messageContent);
      }
    }
  }

  private sendMessageViaHTTP(content: string) {
    console.log('🌐 sendMessageViaHTTP called (isSending:', this.isSending, ')');
    
    // If not sending anymore, WebSocket already succeeded - don't send via HTTP
    if (!this.isSending) {
      console.log('⚠️ Not sending via HTTP - WebSocket already succeeded');
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

    console.log('📤 Sending message via HTTP to:', receiverId, 'Content:', content);

    this.messagingService.sendMessage(
      receiverId,
      content
    ).subscribe({
      next: (response) => {
        console.log('✅ Message sent successfully via HTTP:', response);
        const message = response.message;
        console.log('🔍 Checking for duplicate - message ID:', message.id, 'Content:', message.content?.substring(0, 20));
        console.log('🔍 Current messages in array:', this.messages.length);
        console.log('🔍 Existing message IDs:', this.messages.map(m => m.id));
        
        // Enhanced duplicate check - check by ID, or by content+timestamp if no ID match
        const existingMessage = this.messages.find(m => 
          m.id === message.id || 
          (m.content === message.content && 
           m.senderId === message.senderId && 
           Math.abs(new Date(m.createdAt).getTime() - new Date(message.createdAt).getTime()) < 1000)
        );
        
        if (existingMessage) {
          console.log('⚠️ Duplicate message detected in HTTP response, skipping:', message.id);
        } else {
          console.log('✅ Adding message from HTTP to array:', message.id);
          this.messages.push(message);
          this.scrollToBottom();
        }
        
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
          this.loadConversations();
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

  // TrackBy function for messages to prevent duplicate rendering
  trackByMessageId(index: number, message: Message): string {
    return message.id;
  }
}
