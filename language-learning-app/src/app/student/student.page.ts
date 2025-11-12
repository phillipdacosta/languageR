import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, Platform } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../services/user.service';
import { MessagingService, Message } from '../services/messaging.service';
import { WebSocketService } from '../services/websocket.service';
import { AuthService } from '../services/auth.service';
import { ImageViewerModal } from '../messages/image-viewer-modal.component';
import { SharedModule } from '../shared/shared.module';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-student-page',
  templateUrl: './student.page.html',
  styleUrls: ['./student.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, SharedModule]
})
export class StudentPage implements OnInit, OnDestroy {
  studentId = '';
  student: any = null;
  isLoading = true;
  private backButtonSubscription: any;
  private routerSubscription: any;
  
  // Messaging sidebar
  showMessagingSidebar = false;
  messages: Message[] = [];
  newMessage = '';
  isLoadingMessages = false;
  isSending = false;
  currentUserId = '';
  private destroy$ = new Subject<void>();
  
  // File upload and voice recording
  isUploading = false;
  isRecording = false;
  recordingDuration = 0;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recordingTimer: any;
  private messageSendTimeout: any;
  
  // Typing indicator
  isTyping = false;
  otherUserTyping = false;
  typingTimeout: any;
  
  // Reply functionality
  replyingToMessage: Message | null = null;
  private longPressTimeout: any;
  private readonly LONG_PRESS_DURATION = 500; // ms
  highlightedMessageId: string | null = null;
  
  @ViewChild('chatMessagesContainer', { static: false }) chatMessagesRef?: ElementRef<HTMLDivElement>;
  @ViewChild('messageInput', { static: false }) messageInput?: ElementRef;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService,
    private modalController: ModalController,
    private platform: Platform,
    private messagingService: MessagingService,
    private websocketService: WebSocketService,
    private authService: AuthService
  ) {}

  ngOnInit() {
    this.studentId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.studentId) {
      this.router.navigate(['/tabs']);
      return;
    }
    
    this.userService.getUserPublic(this.studentId).subscribe({
      next: (res) => {
        if (res.student) {
          this.student = res.student;
          this.isLoading = false;
        } else {
          this.isLoading = false;
        }
      },
      error: () => {
        this.isLoading = false;
      }
    });
    
    // Get current user ID for messaging
    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      const email = user?.email || '';
      this.currentUserId = email ? `dev-user-${email}` : user?.sub || '';
    });
    
    // Connect to WebSocket for real-time messaging
    this.websocketService.connect();
    
    // Listen for new messages
    this.websocketService.newMessage$.pipe(takeUntil(this.destroy$)).subscribe(message => {
      if (this.showMessagingSidebar && this.student && 
          (message.senderId === this.student.auth0Id || message.receiverId === this.student.auth0Id)) {
        const isMyMessage = message.senderId === this.currentUserId || 
                            message.senderId === this.currentUserId.replace('dev-user-', '') ||
                            `dev-user-${message.senderId}` === this.currentUserId;
        
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
        
        if (isMyMessage && this.isSending) {
          this.isSending = false;
          if (this.messageSendTimeout) {
            clearTimeout(this.messageSendTimeout);
            this.messageSendTimeout = null;
          }
        }
      }
    });
    
    // Listen for typing indicators
    this.websocketService.typing$.pipe(takeUntil(this.destroy$)).subscribe(data => {
      if (this.showMessagingSidebar && this.student && data.userId === this.student.auth0Id) {
        this.otherUserTyping = data.isTyping;
      }
    });
  }

  ngOnDestroy() {
    if (this.backButtonSubscription) {
      this.backButtonSubscription.unsubscribe();
    }
    
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
    
    this.destroy$.next();
    this.destroy$.complete();
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  async messageStudent() {
    if (!this.student) return;
    
    this.showMessagingSidebar = true;
    
    this.userService.getCurrentUser().subscribe({
      next: (user) => {
        if (user?.email) {
          this.loadMessages();
          setTimeout(() => {
            this.scrollToBottom();
          }, 300);
        }
      },
      error: () => {
        this.loadMessages();
      }
    });
  }
  
  toggleMessagingSidebar() {
    this.showMessagingSidebar = !this.showMessagingSidebar;
    if (this.showMessagingSidebar) {
      this.userService.getCurrentUser().subscribe({
        next: (user) => {
          if (user?.email) {
            this.loadMessages();
            setTimeout(() => {
              this.scrollToBottom();
            }, 300);
          }
        },
        error: () => {
          this.loadMessages();
        }
      });
    }
  }
  
  loadMessages() {
    if (!this.student) return;
    
    if (!this.student.auth0Id) {
      this.userService.getUserPublic(this.studentId).subscribe({
        next: (res) => {
          if (res.student) {
            this.student = res.student;
            this.loadMessagesWithAuth0Id();
          }
        },
        error: () => {
          this.isLoadingMessages = false;
        }
      });
      return;
    }
    
    this.loadMessagesWithAuth0Id();
  }
  
  private loadMessagesWithAuth0Id() {
    if (!this.student?.auth0Id) {
      this.isLoadingMessages = false;
      return;
    }
    
    const receiverId = this.student.auth0Id;
    this.isLoadingMessages = true;
    
    this.messagingService.getMessages(receiverId).subscribe({
      next: (response) => {
        this.messages = response.messages || [];
        this.isLoadingMessages = false;
        this.scrollToBottom();
      },
      error: (error) => {
        this.isLoadingMessages = false;
        if (error.status === 404) {
          this.messages = [];
        } else {
          this.messages = [];
        }
      }
    });
  }
  
  sendMessage() {
    if (!this.newMessage.trim() || !this.student?.auth0Id || this.isSending || this.isUploading || this.isRecording) {
      return;
    }

    const content = this.newMessage.trim();
    this.newMessage = '';
    this.isSending = true;

    this.sendTypingIndicator(false);

    let replyTo: any = undefined;
    if (this.replyingToMessage && this.replyingToMessage.id) {
      let senderName = 'Unknown';
      if (this.isMyMessage(this.replyingToMessage)) {
        senderName = 'You';
      } else {
        senderName = this.student?.name || 'Unknown';
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
      
      this.clearReply();
    }

    const receiverId = this.student.auth0Id;
    
    if (this.websocketService.getConnectionStatus()) {
      const replyToToSend = replyTo ? replyTo : undefined;
      this.websocketService.sendMessage(receiverId, content, 'text', replyToToSend);
      
      this.messageSendTimeout = setTimeout(() => {
        if (this.isSending) {
          const replyToToSend = replyTo ? replyTo : undefined;
          this.sendMessageViaHTTP(content, replyToToSend);
        }
      }, 2000);
    } else {
      const replyToToSend = replyTo ? replyTo : undefined;
      this.sendMessageViaHTTP(content, replyToToSend);
    }
  }
  
  private sendMessageViaHTTP(content: string, replyTo?: any) {
    if (!this.student?.auth0Id || !this.isSending) {
      return;
    }

    const replyToToSend = replyTo && replyTo.messageId ? replyTo : undefined;
    this.messagingService.sendMessage(this.student.auth0Id, content, 'text', replyToToSend).subscribe({
      next: (response) => {
        const message = response.message;
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
        
        this.isSending = false;
      },
      error: () => {
        this.isSending = false;
      }
    });
  }
  
  onInputChange() {
    if (!this.isTyping) {
      this.isTyping = true;
      this.sendTypingIndicator(true);
    }

    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }

    this.typingTimeout = setTimeout(() => {
      this.isTyping = false;
      this.sendTypingIndicator(false);
    }, 1000);
  }

  sendTypingIndicator(isTyping: boolean) {
    if (!this.student?.auth0Id) return;
    this.websocketService.sendTypingIndicator(this.student.auth0Id, isTyping);
  }
  
  onFileSelected(event: Event, messageType: 'image' | 'file') {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    this.uploadFile(file, messageType);
    input.value = '';
  }

  private uploadFile(file: File, messageType: 'image' | 'file' | 'voice', caption?: string) {
    if (!this.student?.auth0Id) return;

    this.isUploading = true;
    const receiverId = this.student.auth0Id;

    this.messagingService.uploadFile(receiverId, file, messageType, caption).subscribe({
      next: (response) => {
        this.messages.push(response.message);
        this.scrollToBottom();
        this.isUploading = false;
      },
      error: () => {
        this.isUploading = false;
      }
    });
  }

  async toggleVoiceRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

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
        this.uploadFile(audioFile, 'voice');
        stream.getTracks().forEach(track => track.stop());
      };
      
      this.mediaRecorder.start();
      this.isRecording = true;
      
      this.recordingTimer = setInterval(() => {
        this.recordingDuration++;
        if (this.recordingDuration >= 60) {
          this.stopRecording();
        }
      }, 1000);
      
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  }

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

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

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

  async openFile(fileUrl: string, fileType?: string, fileName?: string) {
    const isImage = fileType?.startsWith('image/') || 
                    fileUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i);
    
    if (isImage) {
      await this.openImageViewer(fileUrl, fileName);
    } else {
      window.open(fileUrl, '_blank');
    }
  }

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

  onMessageMouseDown(message: Message, event: MouseEvent | TouchEvent) {
    if (window.innerWidth >= 769) {
      this.longPressTimeout = setTimeout(() => {
        this.setReplyTo(message);
      }, this.LONG_PRESS_DURATION);
    }
  }

  onMessageMouseUp() {
    if (this.longPressTimeout) {
      clearTimeout(this.longPressTimeout);
      this.longPressTimeout = null;
    }
  }

  onMessageDoubleClick(message: Message) {
    if (window.innerWidth >= 769) {
      this.setReplyTo(message);
    }
  }

  setReplyTo(message: Message) {
    let senderName = 'Unknown';
    if (this.isMyMessage(message)) {
      senderName = 'You';
    } else {
      senderName = this.student?.name || 'Unknown';
    }
    
    this.replyingToMessage = message;
    
    setTimeout(() => {
      if (this.messageInput?.nativeElement) {
        const inputElement = this.messageInput.nativeElement.querySelector('input');
        if (inputElement) {
          inputElement.focus();
        }
      }
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

  scrollToMessageById(messageId: string, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (!messageId) return;
    
    setTimeout(() => {
      const messageElement = document.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement;
      if (!messageElement) return;
      
      const container = this.chatMessagesRef?.nativeElement;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const elementRect = messageElement.getBoundingClientRect();
        const scrollTop = container.scrollTop;
        const elementTop = elementRect.top - containerRect.top + scrollTop;
        const centerOffset = container.clientHeight / 2 - elementRect.height / 2;
        const targetScroll = Math.max(0, elementTop - centerOffset);
        
        container.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });
      } else {
        messageElement.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }
      
      this.highlightedMessageId = messageId;
      setTimeout(() => {
        this.highlightedMessageId = null;
      }, 2000);
    }, 100);
  }

  scrollToRepliedMessage(event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (!this.replyingToMessage) return;
    
    const messageId = this.replyingToMessage.id;
    if (messageId) {
      this.scrollToMessageById(messageId, event);
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
  
  trackByMessageId(index: number, message: Message): string {
    return message.id;
  }
  
  scrollToBottom() {
    setTimeout(() => {
      if (this.chatMessagesRef?.nativeElement) {
        const container = this.chatMessagesRef.nativeElement;
        container.scrollTop = container.scrollHeight;
      }
    }, 100);
  }
  
  isMyMessage(message: Message): boolean {
    const currentUserId = this.currentUserId;
    return message.senderId === currentUserId || 
           message.senderId === currentUserId.replace('dev-user-', '') ||
           `dev-user-${message.senderId}` === currentUserId;
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
}

