import { Injectable } from '@angular/core';
import { Observable, Subject, BehaviorSubject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { environment } from '../../environments/environment';
import { Message } from './messaging.service';
import { take } from 'rxjs/operators';
import { buildBearerToken } from './auth-token.util';

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

  // Tutor video upload subject (for admin notifications)
  private tutorVideoUploadedSubject = new Subject<{ 
    tutorId: string; 
    tutorName: string; 
    tutorEmail: string;
    videoUrl: string;
    thumbnailUrl: string;
    timestamp: Date;
  }>();
  public tutorVideoUploaded$ = this.tutorVideoUploadedSubject.asObservable();

  // Tutor credential upload subject (for admin notifications)
  private tutorCredentialUploadedSubject = new Subject<{
    tutorId: string;
    tutorName: string;
    tutorEmail: string;
    credentialType: string;
    fileName: string;
    timestamp: Date;
  }>();
  public tutorCredentialUploaded$ = this.tutorCredentialUploadedSubject.asObservable();

  // Tutor credential approval/rejection subjects (for tutor notifications)
  private credentialApprovedSubject = new Subject<any>();
  public credentialApproved$ = this.credentialApprovedSubject.asObservable();

  private credentialRejectedSubject = new Subject<any>();
  public credentialRejected$ = this.credentialRejectedSubject.asObservable();

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

  private conversationArchivedSubject = new Subject<{ conversationId: string }>();
  public conversationArchived$ = this.conversationArchivedSubject.asObservable();

  private conversationUnarchivedSubject = new Subject<{ conversationId: string }>();
  public conversationUnarchived$ = this.conversationUnarchivedSubject.asObservable();

  // Lesson status change subjects
  private lessonStatusChangedSubject = new Subject<{ lessonId: string; status: string; updatedAt: Date }>();
  public lessonStatusChanged$ = this.lessonStatusChangedSubject.asObservable();

  // Payment status change subjects
  private paymentStatusChangedSubject = new Subject<{ paymentId: string; lessonId: string; status: string; updatedAt: Date }>();
  public paymentStatusChanged$ = this.paymentStatusChangedSubject.asObservable();

  // Student AI-analysis setting change — used by the pre-call screen to keep the
  // displayed AI status in sync for both parties before the lesson starts.
  private aiAnalysisSettingChangedSubject = new Subject<{
    studentId: string;
    studentAuth0Id: string;
    aiAnalysisEnabled: boolean;
  }>();
  public aiAnalysisSettingChanged$ = this.aiAnalysisSettingChangedSubject.asObservable();

  /**
   * Real-time class detail updates. Fired for every viewer subscribed to a
   * class room via `joinClassRoom(classId)`. The `state` object is a compact
   * projection of the class doc (see backend `classStateBroadcaster`); merge
   * it into your local model rather than refetching.
   */
  private classStateChangedSubject = new Subject<{
    classId: string;
    version: string | null;
    reason: string;
    actorId?: string | null;
    timestamp?: string;
    state: {
      confirmedStudents: Array<{ id: string; name: string; picture?: string }>;
      studentPayments: { [studentId: string]: string };
      capacity: number | null;
      minStudents: number | null;
      flexibleMinimum: boolean;
      price: number | null;
      status: string;
      cancelReason?: string | null;
    };
  }>();
  public classStateChanged$ = this.classStateChangedSubject.asObservable();

  /** Rooms we've asked the server to subscribe us to. Reclaimed on reconnect. */
  private subscribedClassRooms = new Set<string>();

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
    this.socket.off('tutor_video_uploaded');
    this.socket.off('tutor_credential_uploaded');
    this.socket.off('credential_approved');
    this.socket.off('credential_rejected');
    this.socket.off('lesson_status_changed');
    this.socket.off('payment_status_changed');
    this.socket.off('class_state_changed');

    // Listen for new messages (incoming)
    this.socket.on('new_message', (message: Message) => {
      console.log('📨 [WebSocket] Received new_message event:', {
        id: message.id,
        content: message.content?.slice(0, 30),
        senderId: message.senderId,
        receiverId: message.receiverId
      });
      this.newMessageSubject.next(message);
    });

    // Listen for message sent confirmation (outgoing)
    this.socket.on('message_sent', (message: Message) => {
      console.log('📤 [WebSocket] Received message_sent confirmation:', {
        id: message.id,
        content: message.content?.slice(0, 30)
      });
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
    this.socket.on('conversation_archived', (data: { conversationId: string }) => {
      this.conversationArchivedSubject.next(data);
    });

    this.socket.on('conversation_unarchived', (data: { conversationId: string }) => {
      this.conversationUnarchivedSubject.next(data);
    });

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

    // Listen for tutor video uploads (for admins)
    this.socket.on('tutor_video_uploaded', (data: { 
      tutorId: string; 
      tutorName: string; 
      tutorEmail: string;
      videoUrl: string;
      thumbnailUrl: string;
      timestamp: Date;
    }) => {
      console.log('📹 Tutor video uploaded (admin notification):', data);
      this.tutorVideoUploadedSubject.next(data);
    });

    // Listen for tutor credential uploads (for admins)
    this.socket.on('tutor_credential_uploaded', (data: {
      tutorId: string;
      tutorName: string;
      tutorEmail: string;
      credentialType: string;
      fileName: string;
      timestamp: Date;
    }) => {
      console.log('📄 Tutor credential uploaded (admin notification):', data);
      this.tutorCredentialUploadedSubject.next(data);
    });

    // Listen for credential approval (for tutors)
    this.socket.on('credential_approved', (data: any) => {
      console.log('✅ Credential approved:', data);
      this.credentialApprovedSubject.next(data);
      // Refresh user data to update onboarding status
      this.userService.getCurrentUser(true).subscribe();
    });

    // Listen for credential rejection (for tutors)
    this.socket.on('credential_rejected', (data: any) => {
      console.log('❌ Credential rejected:', data);
      this.credentialRejectedSubject.next(data);
      // Refresh user data to update onboarding status
      this.userService.getCurrentUser(true).subscribe();
    });

    // Listen for lesson status changes
    this.socket.on('lesson_status_changed', (data: { lessonId: string; status: string; updatedAt: Date }) => {
      console.log('📚 Lesson status changed:', data);
      this.lessonStatusChangedSubject.next(data);
    });

    // Listen for payment status changes
    this.socket.on('payment_status_changed', (data: { paymentId: string; lessonId: string; status: string; updatedAt: Date }) => {
      console.log('💳 Payment status changed:', data);
      this.paymentStatusChangedSubject.next(data);
    });

    // Listen for a student's AI-analysis setting changing (pre-call sync)
    this.socket.on('ai_analysis_setting_changed', (data: { studentId: string; studentAuth0Id: string; aiAnalysisEnabled: boolean }) => {
      console.log('🤖 AI analysis setting changed:', data);
      this.aiAnalysisSettingChangedSubject.next(data);
    });

    // Listen for compact "class state changed" patches. Every viewer of a
    // class detail page calls `joinClassRoom(id)` on enter and receives a
    // patch for that class on every mutation (enroll, unenroll, remove,
    // cancel, payment status change). The page merges `state` into its
    // local model — no refetch.
    this.socket.on('class_state_changed', (data: any) => {
      if (!data || !data.classId || !data.state) return;
      this.classStateChangedSubject.next(data);
    });

    this.listenersSetup = true;

    // After a (re)connect we re-ask the server to put us back into any rooms
    // we had joined. The server has a fresh socket id and no longer knows us.
    if (this.subscribedClassRooms.size > 0) {
      for (const classId of this.subscribedClassRooms) {
        this.socket.emit('class:subscribe', { classId }, (ack: any) => {
          if (ack && ack.ok && ack.state) {
            this.classStateChangedSubject.next(ack.state);
          }
        });
      }
    }
  }

  /**
   * Join a class detail room. Safe to call multiple times — de-duped on the
   * client and idempotent on the server. The optional ack callback receives
   * the initial snapshot (same shape as `class_state_changed`).
   */
  joinClassRoom(classId: string, onInitialState?: (snapshot: any) => void): void {
    if (!classId) return;
    this.subscribedClassRooms.add(classId);
    if (!this.socket || !this.socket.connected) {
      this.ensureConnected();
      return;
    }
    this.socket.emit('class:subscribe', { classId }, (ack: any) => {
      if (ack && ack.ok && ack.state) {
        if (onInitialState) onInitialState(ack.state);
        this.classStateChangedSubject.next(ack.state);
      }
    });
  }

  /** Leave a class detail room. */
  leaveClassRoom(classId: string): void {
    if (!classId) return;
    this.subscribedClassRooms.delete(classId);
    if (this.socket && this.socket.connected) {
      this.socket.emit('class:unsubscribe', { classId });
    }
  }

  connect(): void {
    const startTime = performance.now();
    
    // If already connected, just ensure listeners are set up
    if (this.socket?.connected) {
      console.log('🔌 WebSocket: Already connected, socket.id:', this.socket.id);
      this.setupEventListeners();
      return;
    }

    // If socket exists but not connected, try to reconnect
    if (this.socket && !this.socket.connected) {
      console.log('🔌 WebSocket: Socket exists but disconnected, attempting to reconnect...');
      this.socket.connect();
      return;
    }

    this.authService.user$.pipe(take(1)).subscribe(async user => {
      if (!user) {
        console.error('❌ WebSocket: No user available for connection');
        return;
      }

      const userEmail = user.email || 'unknown';

      let token: string;
      try {
        token = await buildBearerToken(this.authService);
      } catch (err) {
        console.error('❌ WebSocket: Failed to acquire auth token, aborting connect:', err);
        return;
      }

      const socketUrl = environment.backendUrl;
      const socketStartTime = performance.now();

      console.log('🔌 WebSocket: Creating new socket connection for user:', userEmail);

      this.socket = io(socketUrl, {
        auth: {
          token: token
        },
        transports: ['websocket', 'polling'],
        timeout: 10000,  // 10 second timeout
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000
      });

      console.log('🔌 WebSocket: Attempting to connect...', { socketUrl, userEmail });

      this.socket.on('connect', () => {
        this.isConnected = true;
        this.connectionSubject.next(true);
        console.log('✅ WebSocket: Connected successfully!', { socketId: this.socket?.id, userEmail });
        // Set up listeners after connection is established
        this.setupEventListeners();
      });

      this.socket.on('disconnect', (reason) => {
        this.isConnected = false;
        this.connectionSubject.next(false);
        this.listenersSetup = false; // Reset so listeners are set up again on reconnect
        console.log('❌ WebSocket: Disconnected, reason:', reason);
        
        // If the server disconnected us, try to reconnect
        if (reason === 'io server disconnect') {
          console.log('🔄 WebSocket: Server disconnected, attempting to reconnect...');
          this.socket?.connect();
        }
      });

      this.socket.on('reconnect', (attemptNumber) => {
        console.log('🔄 WebSocket: Reconnected after', attemptNumber, 'attempts');
        this.isConnected = true;
        this.connectionSubject.next(true);
        this.setupEventListeners();
      });

      this.socket.on('reconnect_attempt', (attemptNumber) => {
        console.log('🔄 WebSocket: Reconnection attempt', attemptNumber);
      });

      this.socket.on('reconnect_error', (error) => {
        console.error('❌ WebSocket: Reconnection error:', error);
      });

      this.socket.on('connect_error', (error) => {
        const errorDuration = performance.now() - socketStartTime;
        console.error(`❌ [WebSocket] Connection error after ${errorDuration.toFixed(2)}ms:`, error.message);
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

  // Ensure connection is active, reconnect if needed
  ensureConnected(): void {
    console.log('🔌 WebSocket: ensureConnected called, current status:', {
      hasSocket: !!this.socket,
      isConnected: this.isConnected,
      socketConnected: this.socket?.connected
    });
    
    if (!this.socket) {
      console.log('🔌 WebSocket: No socket, calling connect()');
      this.connect();
    } else if (!this.socket.connected) {
      console.log('🔌 WebSocket: Socket exists but not connected, attempting reconnect');
      this.socket.connect();
    } else {
      console.log('🔌 WebSocket: Already connected, socket.id:', this.socket.id);
    }
  }

  // Force a fresh connection (disconnect and reconnect)
  forceReconnect(): void {
    console.log('🔄 WebSocket: Force reconnect requested');
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.listenersSetup = false;
    }
    this.connect();
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

