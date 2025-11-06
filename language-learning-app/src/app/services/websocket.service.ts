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

    console.log('📚 WebSocket: Setting up event listeners');

    // Listen for new messages (incoming)
    this.socket.on('new_message', (message: Message) => {
      console.log('📨 WebSocket: Received new_message event', message);
      this.newMessageSubject.next(message);
    });

    // Listen for message sent confirmation (outgoing)
    this.socket.on('message_sent', (message: Message) => {
      console.log('✅ WebSocket: Received message_sent event', message);
      this.newMessageSubject.next(message);
    });

    // Listen for typing indicators
    this.socket.on('user_typing', (data: { userId: string; isTyping: boolean }) => {
      this.typingSubject.next(data);
    });

    // Listen for message errors
    this.socket.on('message_error', (error: any) => {
      console.error('Message error:', error);
    });

    // Listen for lesson presence events - register BEFORE onAny to catch it
    this.socket.on('lesson_participant_joined', (data: any) => {
      console.log('📚 WebSocket: ✅✅✅✅✅ RECEIVED lesson_participant_joined event!', data);
      console.log('📚 WebSocket: Event data type:', typeof data);
      console.log('📚 WebSocket: Event data:', JSON.stringify(data, null, 2));
      console.log('📚 WebSocket: Emitting to lessonPresenceSubject');
      this.lessonPresenceSubject.next(data);
    });

    // Listen for lesson participant left events
    this.socket.on('lesson_participant_left', (data: any) => {
      console.log('📚 WebSocket: ❌❌❌❌❌ RECEIVED lesson_participant_left event!', data);
      console.log('📚 WebSocket: Emitting to lessonPresenceLeftSubject');
      this.lessonPresenceLeftSubject.next(data);
    });
    
    // Log ALL socket events for debugging (register this AFTER specific handlers)
    this.socket.onAny((eventName, ...args) => {
      console.log('📚 WebSocket: onAny - Received ANY event:', eventName, 'with args:', args);
      if (eventName === 'lesson_participant_joined') {
        console.log('📚 WebSocket: ⚠️⚠️⚠️ onAny ALSO caught lesson_participant_joined!', args);
      }
      if (eventName === 'lesson_participant_left') {
        console.log('📚 WebSocket: ⚠️⚠️⚠️ onAny ALSO caught lesson_participant_left!', args);
      }
    });

    this.listenersSetup = true;
    console.log('📚 WebSocket: Event listeners set up');
  }

  connect(): void {
    // If already connected, just ensure listeners are set up
    if (this.socket?.connected) {
      console.log('📚 WebSocket: Already connected, ensuring listeners are set up');
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
      
      console.log('📚 WebSocket: Creating new connection to', socketUrl);
      this.socket = io(socketUrl, {
        auth: {
          token: token
        },
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        console.log('WebSocket connected');
        this.isConnected = true;
        this.connectionSubject.next(true);
        // Set up listeners after connection is established
        this.setupEventListeners();
      });

      this.socket.on('disconnect', () => {
        console.log('WebSocket disconnected');
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
      console.error('❌ WebSocket: Socket not connected');
      return;
    }

    console.log('📤 WebSocket: Emitting send_message event', { receiverId, content, type, replyTo });
    
    const data: any = { receiverId, content, type };
    if (replyTo) {
      data.replyTo = replyTo;
    }
    
    this.socket.emit('send_message', data);
    
    console.log('✅ WebSocket: send_message event emitted');
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

