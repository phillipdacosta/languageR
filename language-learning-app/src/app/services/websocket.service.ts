import { Injectable } from '@angular/core';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { environment } from '../../environments/environment';
import { Message } from './messaging.service';
import { take } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class WebSocketService {
  private socket: Socket | null = null;
  private isConnected = false;
  private connectionSubject = new BehaviorSubject<boolean>(false);
  public connection$ = this.connectionSubject.asObservable();

  private newMessageSubject = new Subject<Message>();
  public newMessage$ = this.newMessageSubject.asObservable();

  private typingSubject = new Subject<{ userId: string; isTyping: boolean }>();
  public typing$ = this.typingSubject.asObservable();

  private lessonPresenceSubject = new Subject<{
    lessonId: string;
    participantId: string;
    participantRole: 'tutor' | 'student';
    participantName: string;
    participantPicture?: string;
    joinedAt: string;
  }>();
  public lessonPresence$ = this.lessonPresenceSubject.asObservable();

  private lessonPresenceLeftSubject = new Subject<{
    lessonId: string;
    participantId: string;
    participantRole: 'tutor' | 'student';
    participantName: string;
    leftAt: string;
  }>();
  public lessonPresenceLeft$ = this.lessonPresenceLeftSubject.asObservable();

  private newNotificationSubject = new Subject<any>();
  public newNotification$ = this.newNotificationSubject.asObservable();

  constructor(
    private authService: AuthService,
    private userService: UserService
  ) {
    // Note: We can't inject MessagingService here due to circular dependency
    // Will use a workaround to update unread count
  }

  private listenersSetup = false;

  private setupEventListeners(): void {
    if (!this.socket || this.listenersSetup) {
      return;
    }

    // Remove any existing listeners first to prevent duplicates
    this.socket.off('lesson_participant_joined');
    this.socket.off('lesson_participant_left');

    // Listen for new messages (incoming)
    this.socket.on('new_message', (message: Message) => {
      this.newMessageSubject.next(message);
    });

    // Listen for message sent confirmation (outgoing)
    this.socket.on('message_sent', (message: Message) => {
      this.newMessageSubject.next(message);
    });

    // Listen for typing indicators
    this.socket.on('user_typing', (data: { userId: string; isTyping: boolean }) => {
      this.typingSubject.next(data);
    });

    // Listen for message errors
    this.socket.on('message_error', (error: any) => {
      console.error('WebSocket message error:', error);
    });

    // Listen for lesson presence events
    this.socket.on('lesson_participant_joined', (data: any) => {
      this.lessonPresenceSubject.next(data);
    });

    // Listen for lesson participant left events
    this.socket.on('lesson_participant_left', (data: any) => {
      this.lessonPresenceLeftSubject.next(data);
    });

    // Listen for new notifications
    this.socket.on('new_notification', (data: any) => {
      this.newNotificationSubject.next(data);
    });

    this.listenersSetup = true;
  }

  connect(): void {
    // If already connected, just ensure listeners are set up
    if (this.socket?.connected) {
      this.setupEventListeners();
      return;
    }

    this.authService.user$.pipe(take(1)).subscribe(user => {
      if (!user) {
        console.error('No user available for WebSocket connection');
        return;
      }

      // Get token using the same method as UserService
      const userEmail = user.email || 'unknown';
      const tokenEmail = userEmail.replace('@', '-').replace(/\./g, '-');
      const token = `dev-token-${tokenEmail}`;
      
      const socketUrl = environment.backendUrl;
      
      this.socket = io(socketUrl, {
        auth: {
          token: token
        },
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        this.isConnected = true;
        this.connectionSubject.next(true);
        // Set up listeners after connection is established
        this.setupEventListeners();
      });

      this.socket.on('disconnect', () => {
        this.isConnected = false;
        this.connectionSubject.next(false);
        this.listenersSetup = false; // Reset so listeners are set up again on reconnect
      });

      this.socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        this.isConnected = false;
        this.connectionSubject.next(false);
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.connectionSubject.next(false);
    }
  }

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
  ): void {
    if (!this.socket?.connected) {
      console.error('WebSocket: Socket not connected');
      return;
    }
    
    const data: any = { receiverId, content, type };
    if (replyTo) {
      data.replyTo = replyTo;
    }
    
    this.socket.emit('send_message', data);
  }

  sendTypingIndicator(receiverId: string, isTyping: boolean): void {
    if (!this.socket?.connected) {
      return;
    }

    this.socket.emit('typing', {
      receiverId,
      isTyping
    });
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}

