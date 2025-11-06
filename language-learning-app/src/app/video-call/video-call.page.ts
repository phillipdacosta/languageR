import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AgoraService } from '../services/agora.service';
import { AlertController, LoadingController } from '@ionic/angular';
import { UserService } from '../services/user.service';
import { LessonService } from '../services/lesson.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-video-call',
  templateUrl: './video-call.page.html',
  styleUrls: ['./video-call.page.scss'],
  standalone: false,
})
export class VideoCallPage implements OnInit, AfterViewInit, OnDestroy {

  private initializationComplete = false;

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
  channelName = 'languageRoom'; // Default channel name - must match AgoraService hardcoded value
  remoteUserCount = 0;
  userRole: 'tutor' | 'student' = 'student'; // Track user role for proper labeling
  remoteUserStates: Map<any, { isMuted?: boolean; isVideoOff?: boolean }> = new Map(); // Track remote user states

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

  lessonId: string = '';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private agoraService: AgoraService,
    private userService: UserService,
    private lessonService: LessonService,
    private alertController: AlertController,
    private loadingController: LoadingController
  ) { }

  async ngOnInit() {
    const qp = this.route.snapshot.queryParams as any;

    // Set up real-time messaging callbacks first
    this.agoraService.onWhiteboardMessage = (data) => {
      this.handleRemoteWhiteboardData(data);
    };

    this.agoraService.onChatMessage = (message) => {
      this.handleRemoteChatMessage(message);
    };

    this.agoraService.onRemoteUserStateChange = (uid, state) => {
      this.handleRemoteUserStateChange(uid, state);
    };

    // Add global mouse event listeners for resize
    this.globalMouseMoveHandler = this.handleGlobalMouseMove.bind(this);
    this.globalMouseUpHandler = this.handleGlobalMouseUp.bind(this);
    document.addEventListener('mousemove', this.globalMouseMoveHandler);
    document.addEventListener('mouseup', this.globalMouseUpHandler);
    
    // Add beforeunload listener to handle browser close/refresh
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));

    // Store query params for later use in ngAfterViewInit
    this.queryParams = qp;
    
    // Store lessonId if available
    if (qp?.lessonId) {
      this.lessonId = qp.lessonId;
      console.log('📚 VideoCall: Stored lessonId:', this.lessonId);
    }
  }

  private queryParams: any;

  ngAfterViewInit() {
    // Initialize video call after view is fully initialized
    setTimeout(async () => {
      if (this.queryParams?.lessonMode === 'true' && this.queryParams?.lessonId) {
        await this.initializeVideoCallViaLessonParams(this.queryParams);
      } else {
        await this.initializeVideoCall();
      }
      this.initializationComplete = true;
    }, 200);
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
      this.userRole = role; // Store user role for participant labeling

      // Secure join using backend-provided token/appId/uid (with connection state checking)
      // Check for mic/video preferences from pre-call screen
      // Query params are strings, so check explicitly
      const micEnabled = qp.micOn === undefined || qp.micOn === 'true';
      const videoEnabled = qp.videoOn === undefined || qp.videoOn === 'true';
      
      // Update UI state to match preferences
      this.isMuted = !micEnabled;
      this.isVideoOff = !videoEnabled;
      
      console.log('🎯 Joining lesson via secure backend:', { lessonId: qp.lessonId, role, micEnabled, videoEnabled });
      
      if (this.agoraService.isConnected() || this.agoraService.isConnecting()) {
        console.log('✅ Already connected/connecting to lesson, skipping join');
        // Update track states if already connected
        // Use setMuted() instead of setEnabled() so tracks can be toggled later
        const audioTrack = this.agoraService.getLocalAudioTrack();
        const videoTrack = this.agoraService.getLocalVideoTrack();
        if (audioTrack) {
          const currentlyMuted = audioTrack.muted;
          if (micEnabled && currentlyMuted) {
            audioTrack.setMuted(false);
          } else if (!micEnabled && !currentlyMuted) {
            audioTrack.setMuted(true);
          }
        }
        if (videoTrack) {
          const currentlyMuted = videoTrack.muted;
          if (videoEnabled && currentlyMuted) {
            videoTrack.setMuted(false);
          } else if (!videoEnabled && !currentlyMuted) {
            videoTrack.setMuted(true);
          }
        }
      } else {
        const joinResponse = await this.agoraService.joinLesson(qp.lessonId, role, me?.id, {
          micEnabled,
          videoEnabled
        });
        
        // Update channel name from the join response
        if (joinResponse.agora.channelName) {
          this.channelName = joinResponse.agora.channelName;
        }
        
        console.log('✅ Successfully joined lesson via backend, channel:', this.channelName);
      }

      // Set up local video display - wait for tracks to be ready
      await this.waitForTracksAndSetupVideo();
      
      // If still no video after waiting, try manual setup immediately
      if (!this.agoraService.getLocalVideoTrack() && this.localVideoRef) {
        console.log('🔄 No Agora tracks found, trying manual setup immediately...');
        this.tryManualVideoSetup();
      }
      
      // Sync audio state
      const localAudioTrack = this.agoraService.getLocalAudioTrack();
      if (localAudioTrack) {
        this.isMuted = localAudioTrack.muted;
      }

      // Begin monitoring remote users
      this.monitorRemoteUsers();
      this.isConnected = true;
      console.log('Successfully connected to lesson video call');

    } catch (error: any) {
      console.error('Error initializing video call via lesson params:', error);
      
      // Extract error message from Error object
      let errorMessage = 'Failed to connect to video call.';
      if (error?.message) {
        errorMessage = error.message;
      } else if (error?.error?.message) {
        errorMessage = error.error.message;
      }
      
      await this.showError(errorMessage);
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

      // Set up local video display - wait for tracks to be ready
      await this.waitForTracksAndSetupVideo();
      
      // If still no video after waiting, try manual setup immediately
      if (!this.agoraService.getLocalVideoTrack() && this.localVideoRef) {
        console.log('🔄 No Agora tracks found, trying manual setup immediately...');
        this.tryManualVideoSetup();
      }

      // Set up remote video monitoring
      this.monitorRemoteUsers();

      console.log('Successfully connected to video call');

    } catch (error: any) {
      console.error('Error initializing video call:', error);

      let errorMessage = 'Failed to connect to video call.';
      if (error?.message) {
        errorMessage = error.message;
      } else if (error?.error?.message) {
        errorMessage = error.error.message;
      } else if (error instanceof Error) {
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

  private async waitForTracksAndSetupVideo(): Promise<void> {
    console.log('🎥 Waiting for Agora tracks to be ready...');
    
    return new Promise((resolve) => {
      const checkTracks = (attempts = 0) => {
        if (attempts > 20) {
          console.error('❌ Failed to get video tracks after 20 attempts');
          console.error('❌ Debug info:', {
            isConnected: this.agoraService.isConnected(),
            isVideoEnabled: this.agoraService.isVideoEnabled(),
            client: !!this.agoraService.getClient(),
            localVideoTrack: !!this.agoraService.getLocalVideoTrack(),
            localAudioTrack: !!this.agoraService.getLocalAudioTrack()
          });
          
          // Try manual fallback approach
          console.log('🔄 Attempting manual video setup fallback...');
          this.tryManualVideoSetup();
          resolve();
          return;
        }

        const localVideoTrack = this.agoraService.getLocalVideoTrack();
        const localAudioTrack = this.agoraService.getLocalAudioTrack();
        
        console.log(`🔍 Track check attempt ${attempts + 1}:`, {
          videoTrack: !!localVideoTrack,
          audioTrack: !!localAudioTrack,
          isConnected: this.agoraService.isConnected(),
          isVideoEnabled: this.agoraService.isVideoEnabled()
        });
        
        if (localVideoTrack) {
          console.log('✅ Local video track is ready, setting up display...');
          
          // Sync audio state
          if (localAudioTrack) {
            this.isMuted = localAudioTrack.muted;
          }
          
          this.setupLocalVideoDisplay();
          resolve();
        } else {
          console.log(`⏳ Waiting for video track (attempt ${attempts + 1})`);
          setTimeout(() => checkTracks(attempts + 1), 500); // Increased delay
        }
      };

      checkTracks();
    });
  }

  private tryManualVideoSetup() {
    console.log('🔧 Trying manual video setup with getUserMedia...');
    
    if (!this.localVideoRef) {
      console.error('❌ No localVideoRef available for manual setup');
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        console.log('✅ Got manual video stream');
        
        // Create video element and play the stream
        const videoElement = document.createElement('video');
        videoElement.srcObject = stream;
        videoElement.autoplay = true;
        videoElement.muted = true; // Mute to avoid feedback
        videoElement.style.width = '100%';
        videoElement.style.height = '100%';
        videoElement.style.objectFit = 'cover';
        
        // Clear and add the video element
        this.localVideoRef.nativeElement.innerHTML = '';
        this.localVideoRef.nativeElement.appendChild(videoElement);
        
        console.log('✅ Manual video setup complete');
        this.isVideoOff = false;
      })
      .catch(error => {
        console.error('❌ Manual video setup failed:', error);
        this.isVideoOff = true;
      });
  }

  private setupLocalVideoDisplay() {
    console.log('🎥 Setting up local video display...');
    
    // Wait for ViewChild to be available
    const attemptSetup = (attempts = 0) => {
      if (attempts > 10) {
        console.error('❌ Failed to setup local video after 10 attempts');
        return;
      }

      if (!this.localVideoRef) {
        console.log(`⏳ Waiting for localVideoRef (attempt ${attempts + 1})`);
        setTimeout(() => attemptSetup(attempts + 1), 100);
        return;
      }

      const localVideoTrack = this.agoraService.getLocalVideoTrack();
      
      // Sync UI state with actual track state
      if (localVideoTrack) {
        const actualVideoState = this.agoraService.isVideoEnabled();
        this.isVideoOff = !actualVideoState;
        console.log('✅ Synced video state:', {
          isVideoOff: this.isVideoOff,
          actualVideoState: actualVideoState,
          trackMuted: localVideoTrack.muted,
          elementExists: !!this.localVideoRef?.nativeElement
        });

        if (!this.isVideoOff && this.localVideoRef) {
          try {
            console.log('🎬 Playing local video in participant tile');
            this.localVideoRef.nativeElement.innerHTML = '';
            localVideoTrack.play(this.localVideoRef.nativeElement);
            console.log('✅ Local video setup complete');
          } catch (error) {
            console.error('❌ Error playing local video:', error);
          }
        }
      } else {
        console.log('⚠️ No local video track available yet');
        // Retry after a short delay
        setTimeout(() => attemptSetup(attempts + 1), 200);
      }
    };

    attemptSetup();
  }

  private monitorRemoteUsers() {
    // Check for remote users periodically
    setInterval(() => {
      const remoteUsers = this.agoraService.getRemoteUsers();
      const previousCount = this.remoteUserCount;
      this.remoteUserCount = remoteUsers.size;

      // Log when remote user count changes
      if (previousCount !== this.remoteUserCount) {
        console.log(`👥 Remote user count changed: ${previousCount} → ${this.remoteUserCount}`);
        console.log(`📊 Remote users details:`, Array.from(remoteUsers.entries()).map(([uid, user]) => ({
          uid,
          hasVideo: !!user.videoTrack,
          hasAudio: !!user.audioTrack
        })));
      }

      if (remoteUsers.size > 0) {
        // Get the first remote user's video
        const firstRemoteUser = Array.from(remoteUsers.values())[0];
        
        // Play remote user ONLY in main view (big screen)
        if (firstRemoteUser.videoTrack && this.remoteVideoRef) {
          console.log('🎬 Playing remote user video in main view (big screen)');
          console.log('📺 Video layout: Remote user → Main screen, Local user → Small tile');
          try {
            firstRemoteUser.videoTrack.play(this.remoteVideoRef.nativeElement);
          } catch (error) {
            console.error('❌ Error playing remote video in main view:', error);
          }
        }
        
        // Note: Remote user should NOT be in the small participant tile
        // The small tile is only for the local user (yourself)
      }
    }, 1000);
  }

  // Method to manually refresh video display
  refreshVideoDisplay() {
    console.log('🔄 Manually refreshing video display...');
    this.setupLocalVideoDisplay();
  }

  // Get the label for the remote participant based on current user's role
  getRemoteParticipantLabel(): string {
    return this.userRole === 'tutor' ? 'Student' : 'Tutor';
  }

  // Debug method to check connection status
  debugConnectionStatus() {
    console.log('🔍 Connection Debug Info:', {
      isConnected: this.isConnected,
      agoraConnected: this.agoraService.isConnected(),
      remoteUserCount: this.remoteUserCount,
      userRole: this.userRole,
      channelName: this.channelName,
      localVideoTrack: !!this.agoraService.getLocalVideoTrack(),
      localAudioTrack: !!this.agoraService.getLocalAudioTrack(),
      remoteUsers: Array.from(this.agoraService.getRemoteUsers().entries()).map(([uid, user]) => ({
        uid,
        hasVideo: !!user.videoTrack,
        hasAudio: !!user.audioTrack,
        isMuted: user.isMuted,
        isVideoOff: user.isVideoOff
      })),
      remoteUserStates: Array.from(this.remoteUserStates.entries())
    });
  }

  async toggleMute() {
    try {
      console.log('🎤 Toggling mute state...');
      this.isMuted = await this.agoraService.toggleMute();
      console.log('🎤 Mute toggled successfully:', this.isMuted ? 'Muted' : 'Unmuted');
      console.log('🎤 Should send mute state update to other users now...');
    } catch (error) {
      console.error('❌ Error toggling mute:', error);
    }
  }

  async toggleVideo() {
    try {
      const previousState = this.isVideoOff;
      this.isVideoOff = await this.agoraService.toggleVideo();
      console.log('Video toggled from', previousState, 'to', this.isVideoOff);
      console.log('Video:', this.isVideoOff ? 'Off' : 'On');
      
      // Refresh video display after toggling
      setTimeout(() => {
        if (!this.isVideoOff) {
          // Video was turned ON - setup display
          this.setupLocalVideoDisplay();
        } else {
          // Video was turned OFF - clear the video element
          if (this.localVideoRef) {
            console.log('🚫 Turning video OFF - clearing display');
            this.localVideoRef.nativeElement.innerHTML = '';
          }
        }
      }, 200);
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

    const textElement = {
      type: 'text',
      text: this.inlineTextValue,
      x: this.textClickX,
      y: this.textClickY,
      color: this.currentTextColor,
      size: this.currentTextSize,
      id: Date.now() + Math.random()
    };

    this.whiteboardElements.push(textElement);
    this.redrawCanvas();
    this.agoraService.sendWhiteboardData(textElement);
    this.cancelTextInput();
  }

  cancelTextInput() {
    this.showInlineTextInput = false;
    this.inlineTextValue = '';
  }

  toggleFullscreen() {
    console.log('Toggle fullscreen called, current state:', this.isWhiteboardFullscreen);
    this.isWhiteboardFullscreen = !this.isWhiteboardFullscreen;

    if (this.isWhiteboardFullscreen) {
      const rightOffset = this.showChat ? 400 : 40;
      this.whiteboardWidth = window.innerWidth - rightOffset - 40;
      this.whiteboardHeight = window.innerHeight - 100;
      this.canvasWidth = this.whiteboardWidth - 30;
      this.canvasHeight = this.whiteboardHeight - 120;
      this.whiteboardX = 20;
      this.whiteboardY = 20;
    } else {
      this.whiteboardWidth = 450;
      this.whiteboardHeight = 400;
      this.canvasWidth = 400;
      this.canvasHeight = 300;
      this.whiteboardX = 20;
      this.whiteboardY = 100;
    }

    setTimeout(() => {
      this.redrawCanvas();
    }, 100);
  }

  startWhiteboardDrag(event: MouseEvent) {
    if (this.isWhiteboardFullscreen) return;

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

    document.body.classList.add('whiteboard-dragging');
  }

  handleWhiteboardDrag(event: MouseEvent) {
    if (!this.isWhiteboardDragging || this.isWhiteboardFullscreen) return;

    event.preventDefault();

    const deltaX = event.clientX - this.whiteboardDragStartX;
    const deltaY = event.clientY - this.whiteboardDragStartY;

    let newX = this.whiteboardDragOffsetX + deltaX;
    let newY = this.whiteboardDragOffsetY + deltaY;

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
      document.body.classList.remove('whiteboard-dragging');
    }
  }

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

  startDragging(event: MouseEvent) {
    if (!this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

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

    const deltaX = x - this.dragStartX;
    const deltaY = y - this.dragStartY;

    this.draggedElement.x += deltaX;
    this.draggedElement.y += deltaY;

    this.dragStartX = x;
    this.dragStartY = y;

    this.redrawCanvas();

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
    for (let i = this.whiteboardElements.length - 1; i >= 0; i--) {
      const element = this.whiteboardElements[i];
      if (element.type === 'text') {
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

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

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

    this.whiteboardElements.push(strokeElement);
    this.agoraService.sendWhiteboardData(strokeElement);

    this.lastX = currentX;
    this.lastY = currentY;
  }

  stopDrawing() {
    this.isDrawingActive = false;
  }

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
      this.agoraService.sendChatMessage(message);
      this.newMessage = '';

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

    setTimeout(() => {
      if (this.chatMessagesRef) {
        this.chatMessagesRef.nativeElement.scrollTop = this.chatMessagesRef.nativeElement.scrollHeight;
      }
    }, 100);
  }

  shareScreen() {
    console.log('Screen sharing not implemented yet');
    alert('Screen sharing feature coming soon!');
  }

  handleRemoteWhiteboardData(data: any) {
    console.log('Received remote whiteboard data:', data);

    if (!this.ctx || !this.canvas) return;

    switch (data.type) {
      case 'draw':
        this.whiteboardElements.push(data);
        this.redrawCanvas();
        break;

      case 'text':
        this.whiteboardElements.push(data);
        this.redrawCanvas();
        break;

      case 'move':
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

  handleRemoteChatMessage(message: any) {
    console.log('Received remote chat message:', message);

    if (message.isOwn) {
      console.log('Skipping own message to avoid duplication');
      return;
    }

    const chatMessage = {
      ...message,
      isOwn: false
    };

    console.log('Adding chat message to array:', chatMessage);
    this.chatMessages.push(chatMessage);
    console.log('Total chat messages:', this.chatMessages.length);

    setTimeout(() => {
      if (this.chatMessagesRef) {
        this.chatMessagesRef.nativeElement.scrollTop = this.chatMessagesRef.nativeElement.scrollHeight;
      }
    }, 100);
  }

  handleRemoteUserStateChange(uid: any, state: { isMuted?: boolean; isVideoOff?: boolean }) {
    console.log('🔄 Remote user state changed:', { uid, state });
    console.log('🔄 Before update - remoteUserStates:', Array.from(this.remoteUserStates.entries()));
    
    this.remoteUserStates.set(uid, { ...this.remoteUserStates.get(uid), ...state });
    
    console.log('🔄 After update - remoteUserStates:', Array.from(this.remoteUserStates.entries()));
    console.log('🔄 UI should now show mute state:', state.isMuted !== undefined ? (state.isMuted ? 'MUTED' : 'UNMUTED') : 'NO CHANGE');
    
    // Force change detection to update UI
    setTimeout(() => {
      // This will trigger Angular change detection
      console.log('🔄 Angular change detection triggered');
    }, 0);
  }

  // Get the mute state for the first remote user (for display in main video overlay)
  getRemoteUserMuteState(): boolean {
    const remoteUsers = this.agoraService.getRemoteUsers();
    if (remoteUsers.size > 0) {
      const firstRemoteUid = Array.from(remoteUsers.keys())[0];
      const state = this.remoteUserStates.get(firstRemoteUid);
      return state?.isMuted || false;
    }
    return false;
  }

  // Test method to manually send mute state update
  async testMuteSync() {
    console.log('🧪 Testing mute synchronization...');
    const testMuteState = !this.isMuted; // Toggle current state for testing
    await this.agoraService.sendMuteStateUpdate(testMuteState);
    console.log('🧪 Test mute state sent:', testMuteState);
  }

  async endCall() {
    try {
      console.log('🚪 VideoCall: Ending video call...');
      
      // Call leave endpoint if we have a lessonId
      if (this.lessonId) {
        console.log('🚪 VideoCall: Calling leave endpoint for lesson:', this.lessonId);
        console.log('🚪 VideoCall: Current user info:', await firstValueFrom(this.userService.getCurrentUser()));
        try {
          const leaveResponse = await firstValueFrom(this.lessonService.leaveLesson(this.lessonId));
          console.log('🚪 VideoCall: ✅ Leave endpoint SUCCESS:', leaveResponse);
        } catch (leaveError: any) {
          console.error('🚪 VideoCall: ❌ Error calling leave endpoint:', leaveError);
          console.error('🚪 VideoCall: Error details:', leaveError?.error || leaveError?.message || 'Unknown error');
          // Continue with call ending even if leave fails
        }
      } else {
        console.log('🚪 VideoCall: ⚠️ No lessonId available, skipping leave endpoint');
        console.log('🚪 VideoCall: Query params were:', this.queryParams);
      }
      
      await this.agoraService.leaveChannel();
      this.isConnected = false;

      this.router.navigate(['/tabs']);
    } catch (error) {
      console.error('Error ending call:', error);
      this.router.navigate(['/tabs']);
    }
  }

  async ngOnDestroy() {
    console.log('🚪 VideoCall: ngOnDestroy called');
    
    if (this.isConnected) {
      console.log('🚪 VideoCall: Still connected, calling endCall from ngOnDestroy');
      await this.endCall();
    } else if (this.lessonId) {
      // Even if not connected to Agora, still call leave endpoint
      console.log('🚪 VideoCall: Not connected but have lessonId, calling leave endpoint');
      try {
        const leaveResponse = await firstValueFrom(this.lessonService.leaveLesson(this.lessonId));
        console.log('🚪 VideoCall: Leave endpoint response from ngOnDestroy:', leaveResponse);
      } catch (leaveError: any) {
        console.error('🚪 VideoCall: Error calling leave endpoint from ngOnDestroy:', leaveError);
      }
    }

    if (this.globalMouseMoveHandler) {
      document.removeEventListener('mousemove', this.globalMouseMoveHandler);
    }
    if (this.globalMouseUpHandler) {
      document.removeEventListener('mouseup', this.globalMouseUpHandler);
    }
    
    // Remove beforeunload listener
    window.removeEventListener('beforeunload', this.handleBeforeUnload.bind(this));
  }

  private handleBeforeUnload(event: BeforeUnloadEvent) {
    console.log('🚪 VideoCall: Browser beforeunload event');
    // Call leave endpoint synchronously (best effort)
    if (this.lessonId) {
      // Get auth headers for the request
      const headers = this.userService.getAuthHeadersSync();
      const authToken = headers.get('Authorization');
      
      if (authToken) {
        // Create a FormData with the auth token since sendBeacon doesn't support custom headers
        const formData = new FormData();
        formData.append('authToken', authToken);
        
        const leaveUrl = `http://localhost:3000/api/lessons/${this.lessonId}/leave-beacon`;
        
        try {
          const success = navigator.sendBeacon(leaveUrl, formData);
          console.log('🚪 VideoCall: Sent leave beacon with auth, success:', success);
        } catch (error) {
          console.error('🚪 VideoCall: Error sending leave beacon:', error);
        }
      } else {
        console.log('🚪 VideoCall: No auth token available for beacon');
      }
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