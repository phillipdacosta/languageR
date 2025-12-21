import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { environment } from '../../environments/environment';

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
        
        // Update the unread count whenever conversations are fetched
        const totalUnread = response.conversations.reduce((sum, conv) => sum + conv.unreadCount, 0);
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

