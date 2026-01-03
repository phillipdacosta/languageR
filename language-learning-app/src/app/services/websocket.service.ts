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

  private lessonCancelledSubject = new Subject<{
    lessonId: string;
    cancelledBy: 'tutor' | 'student';
    cancellerName: string;
    reason: string;
  }>();
  public lessonCancelled$ = this.lessonCancelledSubject.asObservable();

  private officeHoursAcceptedSubject = new Subject<{
    lessonId: string;
    tutorName: string;
    message: string;
  }>();
  public officeHoursAccepted$ = this.officeHoursAcceptedSubject.asObservable();

  private newNotificationSubject = new Subject<any>();
  public newNotification$ = this.newNotificationSubject.asObservable();

  // Tutor video approval/rejection subjects
  private tutorVideoApprovedSubject = new Subject<{ message: string; timestamp: Date; tutorApproved: boolean }>();
  public tutorVideoApproved$ = this.tutorVideoApprovedSubject.asObservable();

  private tutorVideoRejectedSubject = new Subject<{ message: string; reason: string; timestamp: Date }>();
  public tutorVideoRejected$ = this.tutorVideoRejectedSubject.asObservable();

  private reactionUpdatedSubject = new Subject<{ 
    messageId: string; 
    message: Message; 
    conversationId: string;
    isReaction?: boolean;
    reactorName?: string;
    reactorId?: string;
    emoji?: string | null;
    messageAuthorId?: string;
  }>();
  public reactionUpdated$ = this.reactionUpdatedSubject.asObservable();

  private messageDeletedSubject = new Subject<{ messageId: string; conversationId: string }>();
  public messageDeleted$ = this.messageDeletedSubject.asObservable();

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
    this.socket.off('lesson_cancelled');
    this.socket.off('office_hours_accepted');
    this.socket.off('new_message');
    this.socket.off('message_sent');
    this.socket.off('user_typing');
    this.socket.off('message_error');
    this.socket.off('new_notification');
    this.socket.off('office_hours_booking');
    this.socket.off('reaction_updated');
    this.socket.off('message_deleted');
    this.socket.off('tutor_video_approved');
    this.socket.off('tutor_video_rejected');

    // Listen for new messages (incoming)
    this.socket.on('new_message', (message: Message) => {
      this.newMessageSubject.next(message);
    });

    // Listen for message sent confirmation (outgoing)
    this.socket.on('message_sent', (message: Message) => {
      this.newMessageSubject.next(message);
    });

    // Listen for reaction updates
    this.socket.on('reaction_updated', (data: { 
      messageId: string; 
      message: Message; 
      conversationId: string;
      isReaction?: boolean;
      reactorName?: string;
      reactorId?: string;
      emoji?: string | null;
      messageAuthorId?: string;
    }) => {
      console.log('🎉 Received reaction_updated:', data);
      this.reactionUpdatedSubject.next(data);
    });

    // Listen for message deletions
    this.socket.on('message_deleted', (data: { messageId: string; conversationId: string }) => {
      console.log('🗑️ Received message_deleted:', data);
      this.messageDeletedSubject.next(data);
    });

    // Listen for typing indicators
    this.socket.on('user_typing', (data: { userId: string; isTyping: boolean }) => {
      this.typingSubject.next(data);
    });

    // Listen for message errors
    this.socket.on('message_error', (error: any) => {
      console.error('❌ WebSocket message error:', error);
    });

    // Listen for lesson presence events
    this.socket.on('lesson_participant_joined', (data: any) => {
      this.lessonPresenceSubject.next(data);
    });

    // Listen for lesson participant left events
    this.socket.on('lesson_participant_left', (data: any) => {
      this.lessonPresenceLeftSubject.next(data);
    });

    // Listen for lesson cancelled events
    this.socket.on('lesson_cancelled', (data: any) => {
      console.log('🚫 Lesson cancelled event received:', data);
      this.lessonCancelledSubject.next(data);
    });

    // Listen for office hours accepted events
    this.socket.on('office_hours_accepted', (data: any) => {
      console.log('✅ Office hours accepted event received:', data);
      console.log('✅ Event details:', {
        lessonId: data.lessonId,
        tutorName: data.tutorName,
        message: data.message
      });
      this.officeHoursAcceptedSubject.next(data);
    });

    // Listen for new notifications
    this.socket.on('new_notification', (data: any) => {
      this.newNotificationSubject.next(data);
    });

    // Listen for payment received notifications (tutors only)
    this.socket.on('payment_received', (data: any) => {
      console.log('💰 Payment received notification:', data);
      this.newNotificationSubject.next({
        ...data,
        type: 'payment_received',
        urgent: true // Show immediately
      });
    });

    // Listen for office hours bookings (urgent notifications)
    this.socket.on('office_hours_booking', (data: any) => {
      console.log('⚡ Office hours booking received:', data);
      this.newNotificationSubject.next({
        ...data,
        urgent: true
      });
    });

    // Listen for tutor video approval
    this.socket.on('tutor_video_approved', (data: { message: string; timestamp: Date; tutorApproved: boolean }) => {
      console.log('🎉 Tutor video approved:', data);
      this.tutorVideoApprovedSubject.next(data);
    });

    // Listen for tutor video rejection
    this.socket.on('tutor_video_rejected', (data: { message: string; reason: string; timestamp: Date }) => {
      console.log('❌ Tutor video rejected:', data);
      this.tutorVideoRejectedSubject.next(data);
    });

    this.listenersSetup = true;
  }

  connect(): void {
    const startTime = performance.now();
    
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
      const socketStartTime = performance.now();
      
      this.socket = io(socketUrl, {
        auth: {
          token: token
        },
        transports: ['websocket', 'polling'],
        timeout: 5000  // 5 second timeout
      });

      console.log('🔌 WebSocket: Attempting to connect...', { socketUrl, token });

      this.socket.on('connect', () => {
        this.isConnected = true;
        this.connectionSubject.next(true);
        console.log('✅ WebSocket: Connected successfully!', { socketId: this.socket?.id });
        // Set up listeners after connection is established
        this.setupEventListeners();
      });

      this.socket.on('disconnect', () => {
        this.isConnected = false;
        this.connectionSubject.next(false);
        this.listenersSetup = false; // Reset so listeners are set up again on reconnect
        console.log('❌ WebSocket: Disconnected');
      });

      this.socket.on('connect_error', (error) => {
        const errorDuration = performance.now() - socketStartTime;
        console.error(`⏱️ [WebSocket] Connection error after ${errorDuration.toFixed(2)}ms:`, error);
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

  // Generic method to listen to any WebSocket event
  on(eventName: string): Observable<any> {
    return new Observable((observer) => {
      if (!this.socket) {
        console.warn(`⚠️ [WebSocket] Cannot listen to '${eventName}': socket not initialized`);
        return;
      }

      const handler = (data: any) => {
        observer.next(data);
      };

      this.socket.on(eventName, handler);

      // Cleanup
      return () => {
        if (this.socket) {
          this.socket.off(eventName, handler);
        }
      };
    });
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
    // Only add replyTo if it's a valid object with messageId
    if (replyTo && replyTo.messageId) {
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

