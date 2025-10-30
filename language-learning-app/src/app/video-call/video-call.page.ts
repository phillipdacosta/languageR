import { Component, OnInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AgoraService } from '../services/agora.service';
import { AlertController, LoadingController } from '@ionic/angular';
import { UserService } from '../services/user.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-video-call',
  templateUrl: './video-call.page.html',
  styleUrls: ['./video-call.page.scss'],
  standalone: false,
})
export class VideoCallPage implements OnInit, OnDestroy {

  @ViewChild('whiteboardCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('localVideo', { static: false }) localVideoRef!: ElementRef<HTMLDivElement>;
  @ViewChild('remoteVideo', { static: false }) remoteVideoRef!: ElementRef<HTMLDivElement>;
  @ViewChild('chatMessagesContainer', { static: false }) chatMessagesRef!: ElementRef<HTMLDivElement>;

  isMuted = false;
  isVideoOff = false;
  showWhiteboard = false;
  showChat = false;
  isDrawing = false;
  isConnected = false;
  channelName = 'language-class-001'; // Default channel name
  remoteUserCount = 0;

  // Chat properties
  chatMessages: any[] = [];
  newMessage = '';

  // Whiteboard properties
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  currentColor = '#000000';
  currentBrushSize = 5;
  private isDrawingActive = false;
  private lastX = 0;
  private lastY = 0;

  // Text tool properties
  currentTool: 'draw' | 'text' | 'move' = 'draw';
  currentTextColor = '#000000';
  currentTextSize = 24;
  showInlineTextInput = false;
  inlineTextValue = '';
  textInputX = 0;
  textInputY = 0;
  private textClickX = 0;
  private textClickY = 0;

  // Move/drag properties
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private draggedElement: any = null;

  // Whiteboard elements storage
  whiteboardElements: any[] = [];

  // Whiteboard sizing properties
  isWhiteboardFullscreen = false;
  whiteboardWidth = 450;
  whiteboardHeight = 400;
  canvasWidth = 400;
  canvasHeight = 300;

  // Whiteboard positioning properties
  whiteboardX = 20;
  whiteboardY = 100;
  isWhiteboardDragging = false;
  private whiteboardDragStartX = 0;
  private whiteboardDragStartY = 0;
  private whiteboardDragOffsetX = 0;
  private whiteboardDragOffsetY = 0;
  private globalMouseMoveHandler: any;
  private globalMouseUpHandler: any;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private agoraService: AgoraService,
    private userService: UserService,
    private alertController: AlertController,
    private loadingController: LoadingController
  ) { }

  async ngOnInit() {
    const qp = this.route.snapshot.queryParams as any;

    // If opened with lesson params, use secure join flow (fetch token from backend)
    if (qp?.lessonMode === 'true' && qp?.lessonId) {
      await this.initializeVideoCallViaLessonParams(qp);
    } else {
      // Initialize generic call (non-lesson)
      await this.initializeVideoCall();
    }

    // Set up real-time messaging callbacks
    this.agoraService.onWhiteboardMessage = (data) => {
      this.handleRemoteWhiteboardData(data);
    };

    this.agoraService.onChatMessage = (message) => {
      this.handleRemoteChatMessage(message);
    };

    // Add global mouse event listeners for resize
    this.globalMouseMoveHandler = this.handleGlobalMouseMove.bind(this);
    this.globalMouseUpHandler = this.handleGlobalMouseUp.bind(this);
    document.addEventListener('mousemove', this.globalMouseMoveHandler);
    document.addEventListener('mouseup', this.globalMouseUpHandler);
  }

  private async initializeVideoCallViaLessonParams(qp: any) {
    const loading = await this.loadingController.create({
      message: 'Joining lesson...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Browser support
      if (!this.agoraService.isBrowserSupported()) {
        throw new Error('Your browser does not support video calls. Please use a modern browser.');
      }

      // Permissions
      loading.message = 'Requesting camera and microphone access...';
      const permissionsGranted = await this.agoraService.requestPermissions();
      if (!permissionsGranted) {
        throw new Error('Camera and microphone permissions are required for video calls');
      }

      // Initialize client if needed
      if (!this.agoraService.getClient()) {
        loading.message = 'Connecting to video call...';
        await this.agoraService.initializeClient();
      }

      // Load current user id (for backend join)
      const me = await firstValueFrom(this.userService.getCurrentUser());
      const role = (qp.role === 'tutor' || qp.role === 'student') ? qp.role : 'student';

      // Secure join using backend-provided token/appId/uid (with connection state checking)
      console.log('🎯 Joining lesson via secure backend:', { lessonId: qp.lessonId, role });
      
      if (this.agoraService.isConnected() || this.agoraService.isConnecting()) {
        console.log('✅ Already connected/connecting to lesson, skipping join');
      } else {
        const joinResponse = await this.agoraService.joinLesson(qp.lessonId, role, me?.id);
        console.log('✅ Successfully joined lesson via backend');
      }

      // Set up local video (slight delay to ensure DOM is ready)
      setTimeout(() => {
        const localVideoTrack = this.agoraService.getLocalVideoTrack();
        if (localVideoTrack && this.localVideoRef) {
          localVideoTrack.play(this.localVideoRef.nativeElement);
        }
      }, 100);

      // Begin monitoring remote users
      this.monitorRemoteUsers();
      this.isConnected = true;
      console.log('Successfully connected to lesson video call');

    } catch (error) {
      console.error('Error initializing video call via lesson params:', error);
      await this.showError('Failed to connect to video call.');
    } finally {
      await loading.dismiss();
    }
  }

  async initializeVideoCall() {
    const loading = await this.loadingController.create({
      message: 'Requesting permissions...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Check browser support first
      if (!this.agoraService.isBrowserSupported()) {
        throw new Error('Your browser does not support video calls. Please use a modern browser like Chrome, Firefox, or Safari.');
      }

      // First, request permissions
      loading.message = 'Requesting camera and microphone access...';
      const permissionsGranted = await this.agoraService.requestPermissions();

      if (!permissionsGranted) {
        throw new Error('Camera and microphone permissions are required for video calls');
      }

      // If already connected (joined via lessons flow), just set up UI and skip re-join
      if (this.agoraService.isConnected()) {
        console.log('✅ Already connected to Agora, skipping initialization');
        this.isConnected = true;
      } else if (this.agoraService.isConnecting()) {
        console.log('⏳ Already connecting to Agora, waiting...');
        this.isConnected = true;
      } else {
        // Initialize Agora client and join when not already connected
        loading.message = 'Connecting to video call...';
        await this.agoraService.initializeClient();
        await this.agoraService.joinChannel(this.channelName);
        this.isConnected = true;
      }

      // Set up local video with a small delay to ensure DOM is ready
      setTimeout(() => {
        const localVideoTrack = this.agoraService.getLocalVideoTrack();
        if (localVideoTrack && this.localVideoRef) {
          console.log('Setting up local video display');
          localVideoTrack.play(this.localVideoRef.nativeElement);
        } else {
          console.log('Local video track or element not available');
          console.log('Local video track:', localVideoTrack);
          console.log('Local video ref:', this.localVideoRef);
        }
      }, 100);

      // Set up remote video monitoring
      this.monitorRemoteUsers();

      console.log('Successfully connected to video call');

    } catch (error) {
      console.error('Error initializing video call:', error);

      let errorMessage = 'Failed to connect to video call.';
      if (error instanceof Error) {
        if (error.message.includes('permission')) {
          errorMessage = 'Camera and microphone permissions are required. Please allow access and try again.';
        } else if (error.message.includes('NotAllowedError')) {
          errorMessage = 'Camera and microphone access was denied. Please check your browser settings and allow access.';
        } else if (error.message.includes('NotFoundError')) {
          errorMessage = 'No camera or microphone found. Please connect a camera and microphone and try again.';
        }
      }

      await this.showError(errorMessage);
    } finally {
      await loading.dismiss();
    }
  }

  private monitorRemoteUsers() {
    // Check for remote users periodically
    setInterval(() => {
      const remoteUsers = this.agoraService.getRemoteUsers();
      this.remoteUserCount = remoteUsers.size;

      if (remoteUsers.size > 0 && this.remoteVideoRef) {
        // Get the first remote user's video
        const firstRemoteUser = Array.from(remoteUsers.values())[0];
        if (firstRemoteUser.videoTrack) {
          firstRemoteUser.videoTrack.play(this.remoteVideoRef.nativeElement);
        }
      }
    }, 1000);
  }

  // Method to manually refresh video display
  refreshVideoDisplay() {
    console.log('Manually refreshing video display...');
    const localVideoTrack = this.agoraService.getLocalVideoTrack();
    if (localVideoTrack && this.localVideoRef) {
      console.log('Re-setting up local video display');
      localVideoTrack.play(this.localVideoRef.nativeElement);
    }
  }

  async toggleMute() {
    try {
      this.isMuted = await this.agoraService.toggleMute();
      console.log('Microphone:', this.isMuted ? 'Muted' : 'Unmuted');
    } catch (error) {
      console.error('Error toggling mute:', error);
    }
  }

  async toggleVideo() {
    try {
      this.isVideoOff = await this.agoraService.toggleVideo();
      console.log('Video:', this.isVideoOff ? 'Off' : 'On');
    } catch (error) {
      console.error('Error toggling video:', error);
    }
  }

  toggleWhiteboard() {
    this.showWhiteboard = !this.showWhiteboard;
    if (this.showWhiteboard) {
      // Add a small delay to ensure the canvas is rendered
      setTimeout(() => {
        this.initializeWhiteboard();
      }, 100);
    }
  }

  toggleChat() {
    this.showChat = !this.showChat;
    if (this.showChat) {
      // Scroll to bottom of chat
      setTimeout(() => {
        if (this.chatMessagesRef) {
          this.chatMessagesRef.nativeElement.scrollTop = this.chatMessagesRef.nativeElement.scrollHeight;
        }
      }, 100);
    }
  }

  initializeWhiteboard() {
    console.log('Initializing whiteboard...');
    if (this.canvasRef) {
      this.canvas = this.canvasRef.nativeElement;
      this.ctx = this.canvas.getContext('2d');
      if (this.ctx) {
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineWidth = this.currentBrushSize;
        console.log('Whiteboard initialized successfully');
        console.log('Canvas:', this.canvas);
        console.log('Context:', this.ctx);
      } else {
        console.error('Failed to get 2D context');
      }
    } else {
      console.error('Canvas reference not found');
    }
  }

  clearWhiteboard() {
    if (this.ctx && this.canvas) {
      this.whiteboardElements = [];
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      console.log('Whiteboard cleared');

      // Send clear command to other users
      this.agoraService.sendWhiteboardData({
        type: 'clear'
      });
    }
  }

  setBrushColor(color: string) {
    this.currentColor = color;
    if (this.ctx) {
      this.ctx.strokeStyle = color;
    }
  }

  setBrushSize(size: number) {
    this.currentBrushSize = size;
    if (this.ctx) {
      this.ctx.lineWidth = size;
    }
  }

  // Text tool methods
  setTool(tool: 'draw' | 'text' | 'move') {
    this.currentTool = tool;
    console.log('Tool changed to:', tool);
  }

  setTextColor(color: string) {
    this.currentTextColor = color;
    console.log('Text color changed to:', color);
  }

  setTextSize(size: number) {
    this.currentTextSize = size;
    console.log('Text size changed to:', size);
  }

  finishTextInput() {
    if (!this.inlineTextValue.trim() || !this.ctx || !this.canvas) {
      this.cancelTextInput();
      return;
    }

    console.log('Adding text to canvas:', this.inlineTextValue);

    // Create text element
    const textElement = {
      type: 'text',
      text: this.inlineTextValue,
      x: this.textClickX,
      y: this.textClickY,
      color: this.currentTextColor,
      size: this.currentTextSize,
      id: Date.now() + Math.random()
    };

    // Add to elements array
    this.whiteboardElements.push(textElement);

    // Redraw canvas with all elements
    this.redrawCanvas();

    // Send text data to other users
    this.agoraService.sendWhiteboardData(textElement);

    this.cancelTextInput();
  }

  cancelTextInput() {
    this.showInlineTextInput = false;
    this.inlineTextValue = '';
  }

  // Fullscreen functionality
  toggleFullscreen() {
    console.log('Toggle fullscreen called, current state:', this.isWhiteboardFullscreen);
    this.isWhiteboardFullscreen = !this.isWhiteboardFullscreen;

    if (this.isWhiteboardFullscreen) {
      // Set to fullscreen dimensions and position
      this.whiteboardWidth = window.innerWidth - 40;
      this.whiteboardHeight = window.innerHeight - 100;
      this.canvasWidth = this.whiteboardWidth - 30;
      this.canvasHeight = this.whiteboardHeight - 120;
      this.whiteboardX = 20;
      this.whiteboardY = 20;
    } else {
      // Reset to default dimensions and position
      this.whiteboardWidth = 450;
      this.whiteboardHeight = 400;
      this.canvasWidth = 400;
      this.canvasHeight = 300;
      this.whiteboardX = 20;
      this.whiteboardY = 100;
    }

    // Redraw canvas with new dimensions
    setTimeout(() => {
      this.redrawCanvas();
    }, 100);
  }

  // Whiteboard drag functionality
  startWhiteboardDrag(event: MouseEvent) {
    // Only allow dragging if not in fullscreen mode
    if (this.isWhiteboardFullscreen) return;

    // Don't start drag if clicking on buttons
    const target = event.target as HTMLElement;
    if (target.closest('ion-button')) return;

    console.log('Start whiteboard drag');
    event.preventDefault();
    event.stopPropagation();

    this.isWhiteboardDragging = true;
    this.whiteboardDragStartX = event.clientX;
    this.whiteboardDragStartY = event.clientY;
    this.whiteboardDragOffsetX = this.whiteboardX;
    this.whiteboardDragOffsetY = this.whiteboardY;

    // Add dragging class to body to prevent text selection
    document.body.classList.add('whiteboard-dragging');
  }

  handleWhiteboardDrag(event: MouseEvent) {
    if (!this.isWhiteboardDragging || this.isWhiteboardFullscreen) return;

    event.preventDefault();

    const deltaX = event.clientX - this.whiteboardDragStartX;
    const deltaY = event.clientY - this.whiteboardDragStartY;

    // Calculate new position
    let newX = this.whiteboardDragOffsetX + deltaX;
    let newY = this.whiteboardDragOffsetY + deltaY;

    // Keep whiteboard within screen bounds
    const maxX = window.innerWidth - this.whiteboardWidth;
    const maxY = window.innerHeight - this.whiteboardHeight;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    this.whiteboardX = newX;
    this.whiteboardY = newY;
  }

  stopWhiteboardDrag() {
    if (this.isWhiteboardDragging) {
      console.log('Stopped whiteboard drag');
      this.isWhiteboardDragging = false;

      // Remove dragging class from body
      document.body.classList.remove('whiteboard-dragging');
    }
  }

  // Global mouse event handlers for whiteboard dragging
  handleGlobalMouseMove(event: MouseEvent) {
    if (this.isWhiteboardDragging) {
      this.handleWhiteboardDrag(event);
    }
  }

  handleGlobalMouseUp(event: MouseEvent) {
    if (this.isWhiteboardDragging) {
      this.stopWhiteboardDrag();
    }
  }

  // Drag and move functionality
  startDragging(event: MouseEvent) {
    if (!this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Find element at click position
    this.draggedElement = this.getElementAtPosition(x, y);

    if (this.draggedElement) {
      this.isDragging = true;
      this.dragStartX = x;
      this.dragStartY = y;
      console.log('Started dragging element:', this.draggedElement);
    }
  }

  handleDragging(event: MouseEvent) {
    if (!this.isDragging || !this.draggedElement || !this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Calculate movement
    const deltaX = x - this.dragStartX;
    const deltaY = y - this.dragStartY;

    // Update element position
    this.draggedElement.x += deltaX;
    this.draggedElement.y += deltaY;

    // Update drag start position
    this.dragStartX = x;
    this.dragStartY = y;

    // Redraw canvas
    this.redrawCanvas();

    // Send updated position to other users
    this.agoraService.sendWhiteboardData({
      type: 'move',
      elementId: this.draggedElement.id,
      x: this.draggedElement.x,
      y: this.draggedElement.y
    });
  }

  stopDragging() {
    if (this.isDragging) {
      console.log('Stopped dragging element');
      this.isDragging = false;
      this.draggedElement = null;
    }
  }

  getElementAtPosition(x: number, y: number): any {
    // Check text elements (reverse order to get topmost element)
    for (let i = this.whiteboardElements.length - 1; i >= 0; i--) {
      const element = this.whiteboardElements[i];
      if (element.type === 'text') {
        // Simple bounding box check for text
        const textWidth = this.ctx?.measureText(element.text).width || 0;
        if (x >= element.x && x <= element.x + textWidth &&
          y >= element.y && y <= element.y + element.size) {
          return element;
        }
      }
    }
    return null;
  }

  redrawCanvas() {
    if (!this.ctx || !this.canvas) return;

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Redraw all elements
    this.whiteboardElements.forEach(element => {
      if (this.ctx) {
        if (element.type === 'text') {
          this.ctx.fillStyle = element.color;
          this.ctx.font = `${element.size}px Arial`;
          this.ctx.textBaseline = 'top';
          this.ctx.fillText(element.text, element.x, element.y);
        } else if (element.type === 'draw') {
          this.ctx.strokeStyle = element.color;
          this.ctx.lineWidth = element.size;
          this.ctx.lineCap = 'round';
          this.ctx.lineJoin = 'round';
          this.ctx.beginPath();
          this.ctx.moveTo(element.fromX, element.fromY);
          this.ctx.lineTo(element.toX, element.toY);
          this.ctx.stroke();
        }
      }
    });
  }

  handleCanvasClick(event: MouseEvent) {
    if (this.currentTool === 'draw') {
      this.startDrawing(event);
    } else if (this.currentTool === 'text') {
      this.startTextInput(event);
    } else if (this.currentTool === 'move') {
      this.startDragging(event);
    }
  }

  handleCanvasMove(event: MouseEvent) {
    if (this.currentTool === 'draw') {
      this.draw(event);
    } else if (this.currentTool === 'move') {
      this.handleDragging(event);
    }
  }

  handleCanvasMouseUp(event: MouseEvent) {
    if (this.currentTool === 'draw') {
      this.stopDrawing();
    } else if (this.currentTool === 'move') {
      this.stopDragging();
    }
  }

  handleCanvasMouseLeave(event: MouseEvent) {
    if (this.currentTool === 'draw') {
      this.stopDrawing();
    } else if (this.currentTool === 'move') {
      this.stopDragging();
    }
  }

  startDrawing(event: MouseEvent) {
    console.log('Start drawing...');
    if (!this.ctx || !this.canvas) {
      console.error('Canvas or context not available');
      return;
    }

    this.isDrawingActive = true;
    const rect = this.canvas.getBoundingClientRect();
    this.lastX = event.clientX - rect.left;
    this.lastY = event.clientY - rect.top;
    console.log('Drawing started at:', this.lastX, this.lastY);
  }

  startTextInput(event: MouseEvent) {
    if (!this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    this.textClickX = event.clientX - rect.left;
    this.textClickY = event.clientY - rect.top;
    this.textInputX = this.textClickX;
    this.textInputY = this.textClickY;

    console.log('Text input requested at:', this.textClickX, this.textClickY);
    this.showInlineTextInput = true;
    this.inlineTextValue = '';
  }

  draw(event: MouseEvent) {
    if (!this.isDrawingActive || !this.ctx || !this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    this.ctx.beginPath();
    this.ctx.moveTo(this.lastX, this.lastY);
    this.ctx.lineTo(currentX, currentY);
    this.ctx.stroke();

    // Create drawing stroke element
    const strokeElement = {
      type: 'draw',
      fromX: this.lastX,
      fromY: this.lastY,
      toX: currentX,
      toY: currentY,
      color: this.currentColor,
      size: this.currentBrushSize,
      id: Date.now() + Math.random()
    };

    // Add to elements array
    this.whiteboardElements.push(strokeElement);

    // Send drawing data to other users
    this.agoraService.sendWhiteboardData(strokeElement);

    this.lastX = currentX;
    this.lastY = currentY;
  }

  stopDrawing() {
    this.isDrawingActive = false;
  }

  // Chat methods
  sendMessage() {
    if (this.newMessage.trim()) {
      const message = {
        text: this.newMessage,
        sender: 'You',
        timestamp: new Date(),
        isOwn: true
      };

      console.log('Sending chat message:', message);
      this.chatMessages.push(message);
      console.log('Total chat messages after adding:', this.chatMessages.length);

      // Send message to other users via messaging service
      this.agoraService.sendChatMessage(message);

      this.newMessage = '';

      // Scroll to bottom
      setTimeout(() => {
        if (this.chatMessagesRef) {
          this.chatMessagesRef.nativeElement.scrollTop = this.chatMessagesRef.nativeElement.scrollHeight;
        }
      }, 100);
    }
  }

  receiveMessage(text: string) {
    const message = {
      text: text,
      sender: 'Tutor',
      timestamp: new Date(),
      isOwn: false
    };

    this.chatMessages.push(message);

    // Scroll to bottom
    setTimeout(() => {
      if (this.chatMessagesRef) {
        this.chatMessagesRef.nativeElement.scrollTop = this.chatMessagesRef.nativeElement.scrollHeight;
      }
    }, 100);
  }

  shareScreen() {
    // TODO: Implement screen sharing
    console.log('Screen sharing not implemented yet');
    alert('Screen sharing feature coming soon!');
  }

  // Handle remote whiteboard data
  handleRemoteWhiteboardData(data: any) {
    console.log('Received remote whiteboard data:', data);

    if (!this.ctx || !this.canvas) return;

    switch (data.type) {
      case 'draw':
        // Add drawing stroke to local storage
        this.whiteboardElements.push(data);
        this.redrawCanvas();
        break;

      case 'text':
        // Add text element to local storage
        this.whiteboardElements.push(data);
        this.redrawCanvas();
        break;

      case 'move':
        // Find and update element position
        const element = this.whiteboardElements.find(el => el.id === data.elementId);
        if (element) {
          element.x = data.x;
          element.y = data.y;
          this.redrawCanvas();
        }
        break;

      case 'clear':
        this.whiteboardElements = [];
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        break;
    }
  }

  // Handle remote chat messages
  handleRemoteChatMessage(message: any) {
    console.log('Received remote chat message:', message);

    // Don't add your own messages again
    if (message.isOwn) {
      console.log('Skipping own message to avoid duplication');
      return;
    }

    // Add the message to chat
    const chatMessage = {
      ...message,
      isOwn: false
    };

    console.log('Adding chat message to array:', chatMessage);
    this.chatMessages.push(chatMessage);
    console.log('Total chat messages:', this.chatMessages.length);

    // Scroll to bottom
    setTimeout(() => {
      if (this.chatMessagesRef) {
        this.chatMessagesRef.nativeElement.scrollTop = this.chatMessagesRef.nativeElement.scrollHeight;
      }
    }, 100);
  }

  async endCall() {
    try {
      console.log('Ending video call...');
      await this.agoraService.leaveChannel();
      this.isConnected = false;

      // Navigate back to home
      this.router.navigate(['/tabs']);
    } catch (error) {
      console.error('Error ending call:', error);
      // Still navigate back even if there's an error
      this.router.navigate(['/tabs']);
    }
  }

  async ngOnDestroy() {
    // Clean up when component is destroyed
    if (this.isConnected) {
      await this.endCall();
    }

    // Remove global event listeners
    if (this.globalMouseMoveHandler) {
      document.removeEventListener('mousemove', this.globalMouseMoveHandler);
    }
    if (this.globalMouseUpHandler) {
      document.removeEventListener('mouseup', this.globalMouseUpHandler);
    }
  }

  private async showError(message: string) {
    const alert = await this.alertController.create({
      header: 'Video Call Error',
      message: message,
      buttons: [
        {
          text: 'Try Again',
          handler: () => {
            this.initializeVideoCall();
          }
        },
        {
          text: 'Cancel',
          handler: () => {
            this.router.navigate(['/tabs']);
          }
        }
      ]
    });
    await alert.present();
  }

}
