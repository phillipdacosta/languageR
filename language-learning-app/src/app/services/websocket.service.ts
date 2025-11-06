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

  constructor(
    private authService: AuthService,
    private userService: UserService
  ) {
    // Note: We can't inject MessagingService here due to circular dependency
    // Will use a workaround to update unread count
  }

  connect(): void {
    if (this.socket?.connected) {
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
        console.log('WebSocket connected');
        this.isConnected = true;
        this.connectionSubject.next(true);
      });

      this.socket.on('disconnect', () => {
        console.log('WebSocket disconnected');
        this.isConnected = false;
        this.connectionSubject.next(false);
      });

      this.socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        this.isConnected = false;
        this.connectionSubject.next(false);
      });

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

