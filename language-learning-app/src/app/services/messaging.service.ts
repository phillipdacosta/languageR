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
  type: string;
  read: boolean;
  createdAt: string;
  sender?: {
    id: string;
    name: string;
    picture?: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class MessagingService {
  private apiUrl = `${environment.backendUrl}/api/messaging`;
  
  // Observable for real-time unread count updates
  private unreadCountSubject = new BehaviorSubject<number>(0);
  public unreadCount$ = this.unreadCountSubject.asObservable();

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private userService: UserService
  ) {}
  
  // Method to update unread count from outside
  updateUnreadCount(count: number) {
    console.log('📊 MessagingService: Updating unread count to:', count);
    this.unreadCountSubject.next(count);
  }
  
  // Method to increment unread count when a new message arrives
  incrementUnreadCount() {
    const currentCount = this.unreadCountSubject.value;
    console.log('📈 MessagingService: Incrementing unread count from', currentCount, 'to', currentCount + 1);
    this.unreadCountSubject.next(currentCount + 1);
  }

  private getHeaders(): HttpHeaders {
    return this.userService.getAuthHeadersSync();
  }

  // Get all conversations
  getConversations(): Observable<{ success: boolean; conversations: Conversation[] }> {
    console.log('📥 MessagingService: getConversations called');
    console.log('📥 API URL:', `${this.apiUrl}/conversations`);
    
    // Add cache-busting headers to ensure fresh data
    const headers = this.getHeaders()
      .set('Cache-Control', 'no-cache')
      .set('Pragma', 'no-cache');
    
    console.log('📥 Headers:', headers);
    
    return this.http.get<{ success: boolean; conversations: Conversation[] }>(
      `${this.apiUrl}/conversations`,
      { headers }
    ).pipe(
      tap(response => {
        // Update the unread count whenever conversations are fetched
        console.log('📊 MessagingService: getConversations response received:', response);
        const totalUnread = response.conversations.reduce((sum, conv) => sum + conv.unreadCount, 0);
        console.log('📊 MessagingService: Calculated total unread:', totalUnread);
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
  sendMessage(receiverId: string, content: string, type: string = 'text'): Observable<{ success: boolean; message: Message }> {
    console.log('📤 MessagingService.sendMessage called:', { receiverId, content, type });
    console.log('📤 API URL:', `${this.apiUrl}/conversations/${receiverId}/messages`);
    console.log('📤 Headers:', this.getHeaders());
    
    return this.http.post<{ success: boolean; message: Message }>(
      `${this.apiUrl}/conversations/${receiverId}/messages`,
      { content, type },
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

