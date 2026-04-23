import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { environment } from '../../environments/environment';

export interface GroupParticipantSummary {
  id: string;
  auth0Id: string;
  name: string;
  picture?: string | null;
  userType?: string;
}

export interface Conversation {
  conversationId: string;
  otherUser: {
    id: string;
    auth0Id: string;
    name: string;
    picture?: string;
    userType: string;
    timezone?: string;
    // Optional tutor details
    languages?: string[];
    hourlyRate?: number;
    rating?: number;
    bio?: string;
  } | null;
  // Group-thread metadata (present when the conversation is a multi-participant group).
  isGroup?: boolean;
  groupId?: string;
  groupName?: string;
  /** Kind of group thread — class-broadcast threads are anchored to a Class. */
  type?: 'class-broadcast' | 'ad-hoc-group';
  /** Populated for class-broadcast threads so the UI can deep-link back. */
  classId?: string | null;
  /** Active members at query time (excludes students who have left the class). */
  participants?: GroupParticipantSummary[];
  /** Full roster including historical members; used for rendering old messages. */
  allParticipants?: GroupParticipantSummary[];
  /** True when the current user is no longer an active member (left the class). */
  archived?: boolean;
  /** Timestamp when the current user left the thread, if any. */
  leftAt?: string | null;
  /** Timestamp when the current user joined; frames their history window. */
  joinedAt?: string | null;
  /** Pre-computed in MessagesPage for list avatar cluster (see decorateGroupAvatarClusters). */
  displayParticipants?: GroupParticipantSummary[];
  /** How many participants are not shown in the cluster (shown as +N). */
  extraCount?: number;
  lastMessage: {
    content: string;
    senderId: string;
    createdAt: string;
    type: string;
    isSystemMessage?: boolean;
  };
  unreadCount: number;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  content: string;
  type: string;  // 'text', 'image', 'file', 'voice', 'system'
  read: boolean;
  createdAt: string;
  // File attachment fields
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  thumbnailUrl?: string;
  duration?: number;  // For voice notes (in seconds)
  sender?: {
    id: string;
    name: string;
    picture?: string;
  };
  // Reply-to message field
  replyTo?: {
    messageId: string;
    content?: string;
    senderId?: string;
    senderName?: string;
    type?: string;
    fileUrl?: string;
    fileName?: string;
  };
  // System message fields
  isSystemMessage?: boolean;
  visibleToTutorOnly?: boolean;
  triggerType?: 'favorite' | 'book_lesson';
  // Reactions
  reactions?: Array<{ emoji: string; userId: string; userName: string }>;
}

@Injectable({
  providedIn: 'root'
})
export class MessagingService {
  private apiUrl = `${environment.backendUrl}/api/messaging`;
  
  // Observable for real-time unread count updates
  private unreadCountSubject = new BehaviorSubject<number>(0);
  public unreadCount$ = this.unreadCountSubject.asObservable();
  
  // Observable for tracking when a conversation is selected (for hiding tabs on mobile)
  private hasSelectedConversationSubject = new BehaviorSubject<boolean>(false);
  public hasSelectedConversation$ = this.hasSelectedConversationSubject.asObservable();
  
  // Shared conversations list (single source of truth for all components)
  private conversationsSubject = new BehaviorSubject<Conversation[]>([]);
  public conversations$ = this.conversationsSubject.asObservable();

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private userService: UserService
  ) {}
  
  // Method to update unread count from outside
  updateUnreadCount(count: number) {
    this.unreadCountSubject.next(count);
  }
  
  // Method to update conversation selection state
  setHasSelectedConversation(hasSelection: boolean) {
    this.hasSelectedConversationSubject.next(hasSelection);
  }
  
  // Method to increment unread count when a new message arrives
  incrementUnreadCount() {
    const currentCount = this.unreadCountSubject.value;
    this.unreadCountSubject.next(currentCount + 1);
  }

  // Create potential student conversation
  createPotentialStudent(tutorId: string, triggerType: 'favorite' | 'book_lesson'): Observable<{ success: boolean; conversationId?: string; alreadyExists?: boolean }> {
    const headers = this.getHeaders();
    return this.http.post<{ success: boolean; conversationId?: string; alreadyExists?: boolean }>(
      `${this.apiUrl}/potential-student`,
      { tutorId, triggerType },
      { headers }
    );
  }

  private getHeaders(): HttpHeaders {
    return this.userService.getAuthHeadersSync();
  }

  // Get all conversations
  getConversations(): Observable<{ success: boolean; conversations: Conversation[] }> {
    // Add cache-busting headers to ensure fresh data
    const headers = this.getHeaders()
      .set('Cache-Control', 'no-cache')
      .set('Pragma', 'no-cache');
    
    return this.http.get<{ success: boolean; conversations: Conversation[] }>(
      `${this.apiUrl}/conversations`,
      { headers }
    ).pipe(
      tap(response => {
        // Update the shared conversations subject (single source of truth)
        this.conversationsSubject.next(response.conversations);
        
        // Update the unread count: total unread messages across all conversations
        const totalUnread = response.conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
        this.updateUnreadCount(totalUnread);
      })
    );
  }

  // Get messages for a conversation
  getMessages(otherUserId: string, limit: number = 50, before?: string): Observable<{ success: boolean; messages: Message[] }> {
    let url = `${this.apiUrl}/conversations/${otherUserId}/messages?limit=${limit}`;
    if (before) {
      url += `&before=${before}`;
    }
    
    // Add cache-busting headers to ensure fresh data
    const headers = this.getHeaders()
      .set('Cache-Control', 'no-cache')
      .set('Pragma', 'no-cache');
    
    return this.http.get<{ success: boolean; messages: Message[] }>(
      url,
      { headers }
    );
  }

  // Send a message
  sendMessage(
    receiverId: string, 
    content: string, 
    type: string = 'text',
    replyTo?: {
      messageId: string;
      content?: string;
      senderId?: string;
      senderName?: string;
      type?: string;
      fileUrl?: string;
      fileName?: string;
    }
  ): Observable<{ success: boolean; message: Message }> {
    
    const body: any = { content, type };
    if (replyTo) {
      body.replyTo = replyTo;
    }
    
    return this.http.post<{ success: boolean; message: Message }>(
      `${this.apiUrl}/conversations/${receiverId}/messages`,
      body,
      { headers: this.getHeaders() }
    );
  }

  // Mark messages as read
  markAsRead(otherUserId: string): Observable<{ success: boolean; message: string }> {
    return this.http.put<{ success: boolean; message: string }>(
      `${this.apiUrl}/conversations/${otherUserId}/read`,
      {},
      { headers: this.getHeaders() }
    );
  }

  // Add reaction to a message
  addReaction(messageId: string, emoji: string): Observable<{ success: boolean; message: Message }> {
    return this.http.post<{ success: boolean; message: Message }>(
      `${this.apiUrl}/messages/${messageId}/reactions`,
      { emoji },
      { headers: this.getHeaders() }
    );
  }

  // Delete a message
  deleteMessage(messageId: string): Observable<{ success: boolean; message: string; messageId: string }> {
    return this.http.delete<{ success: boolean; message: string; messageId: string }>(
      `${this.apiUrl}/messages/${messageId}`,
      { headers: this.getHeaders() }
    );
  }

  // Upload file (image, document, or voice note)
  uploadFile(receiverId: string, file: File, messageType: 'image' | 'file' | 'voice', caption?: string): Observable<{ success: boolean; message: Message }> {
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('messageType', messageType);
    if (caption) {
      formData.append('caption', caption);
    }

    const headers = this.userService.getAuthHeadersSync();
    // Remove Content-Type header - let browser set it with boundary for multipart
    const uploadHeaders = new HttpHeaders({
      'Authorization': headers.get('Authorization') || ''
    });

    return this.http.post<{ success: boolean; message: Message }>(
      `${this.apiUrl}/conversations/${receiverId}/upload`,
      formData,
      { headers: uploadHeaders }
    );
  }

  // ===== Group conversations =====

  /**
   * Create or get an existing group conversation.
   *
   * Two modes:
   *   - Pass `classId` to open/create the class-anchored broadcast thread.
   *     The server is authoritative about membership (synced from
   *     `Class.tutorId + confirmedStudents`); `participantIds` is ignored.
   *   - Omit `classId` and pass `participantIds` to open/create an ad-hoc
   *     group thread keyed by the hash of the participant set.
   */
  createOrGetGroup(
    participantIds: string[],
    name?: string,
    classId?: string
  ): Observable<{
    success: boolean;
    groupId: string;
    type?: 'class-broadcast' | 'ad-hoc-group';
    classId?: string | null;
    participants: GroupParticipantSummary[];
    participantIds: string[];
    name: string;
    alreadyExists: boolean;
    archived?: boolean;
    joinedAt?: string | null;
    leftAt?: string | null;
  }> {
    const body: any = {
      participantIds: participantIds || [],
      name: name || ''
    };
    if (classId) body.classId = classId;
    return this.http.post<{
      success: boolean;
      groupId: string;
      type?: 'class-broadcast' | 'ad-hoc-group';
      classId?: string | null;
      participants: GroupParticipantSummary[];
      participantIds: string[];
      name: string;
      alreadyExists: boolean;
      archived?: boolean;
      joinedAt?: string | null;
      leftAt?: string | null;
    }>(
      `${this.apiUrl}/groups`,
      body,
      { headers: this.getHeaders() }
    );
  }

  sendGroupMessage(
    groupId: string,
    content: string,
    opts: {
      type?: string;
      participantIds?: string[];
      name?: string;
      replyTo?: Message['replyTo'];
    } = {}
  ): Observable<{ success: boolean; message: Message }> {
    const body: any = {
      content,
      type: opts.type || 'text'
    };
    if (opts.participantIds && opts.participantIds.length) body.participantIds = opts.participantIds;
    if (opts.name) body.name = opts.name;
    if (opts.replyTo) body.replyTo = opts.replyTo;

    return this.http.post<{ success: boolean; message: Message }>(
      `${this.apiUrl}/groups/${groupId}/messages`,
      body,
      { headers: this.getHeaders() }
    );
  }

  getGroupMessages(
    groupId: string,
    limit: number = 50,
    before?: string
  ): Observable<{
    success: boolean;
    messages: Message[];
    participants: string[];
    archived?: boolean;
    leftAt?: string | null;
    joinedAt?: string | null;
    type?: 'class-broadcast' | 'ad-hoc-group';
    classId?: string | null;
  }> {
    let url = `${this.apiUrl}/groups/${groupId}/messages?limit=${limit}`;
    if (before) url += `&before=${before}`;
    const headers = this.getHeaders()
      .set('Cache-Control', 'no-cache')
      .set('Pragma', 'no-cache');
    return this.http.get<{
      success: boolean;
      messages: Message[];
      participants: string[];
      archived?: boolean;
      leftAt?: string | null;
      joinedAt?: string | null;
      type?: 'class-broadcast' | 'ad-hoc-group';
      classId?: string | null;
    }>(url, { headers });
  }

  markGroupAsRead(groupId: string): Observable<{ success: boolean; message: string }> {
    return this.http.put<{ success: boolean; message: string }>(
      `${this.apiUrl}/groups/${groupId}/read`,
      {},
      { headers: this.getHeaders() }
    );
  }

  // Get total unread count across all conversations
  getTotalUnreadCount(): Observable<number> {
    return new Observable(observer => {
      this.getConversations().subscribe({
        next: (response) => {
          const totalUnread = response.conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
          observer.next(totalUnread);
          observer.complete();
        },
        error: (error) => {
          console.error('Error getting unread count:', error);
          observer.next(0);
          observer.complete();
        }
      });
    });
  }
}

