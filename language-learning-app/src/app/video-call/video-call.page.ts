import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AgoraService } from '../services/agora.service';
import { AlertController, LoadingController, ModalController } from '@ionic/angular';
import { UserService } from '../services/user.service';
import { LessonService } from '../services/lesson.service';
import { MessagingService, Message } from '../services/messaging.service';
import { WebSocketService } from '../services/websocket.service';
import { AuthService } from '../services/auth.service';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { takeUntil, take } from 'rxjs/operators';

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
  @ViewChild('remoteVideoTile', { static: false }) remoteVideoTileRef!: ElementRef<HTMLDivElement>;
  @ViewChild('chatMessagesContainer', { static: false }) chatMessagesRef!: ElementRef<HTMLDivElement>;

  // Listen for window resize to adjust canvas size
  @HostListener('window:resize')
  onWindowResize() {
    if (this.showWhiteboard && this.canvas) {
      setTimeout(() => {
        this.adjustCanvasSize();
      }, 100);
    }
  }

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
  
  // Speaking detection
  isLocalUserSpeaking = false;
  isRemoteUserSpeaking = false;
  private speakingTimeout: any = null;
  
  // Participant names
  tutorName: string = '';
  studentName: string = '';
  isTrialLesson: boolean = false;

  // Virtual background properties
  showVirtualBackgroundControls = false;
  isVirtualBackgroundEnabled = false;

  // Chat properties
  chatMessages: Message[] = [];
  messages: Message[] = [];  // Alias for compatibility
  newMessage = '';
  isSending = false;
  isLoadingMessages = false;
  currentUserId: string = '';
  otherUserAuth0Id: string = '';
  messageSendTimeout: any;
  private destroy$ = new Subject<void>();
  private messagesSubscription?: Subscription;
  
  // File upload and voice recording
  isUploading = false;
  isRecording = false;
  recordingDuration = 0;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recordingTimer: any;
  pendingVoiceNote: { file: File; url: string; duration: number } | null = null;
  
  // Reply functionality
  replyingToMessage: Message | null = null;
  
  // Context menu for messages (long-press)
  showContextMenu = false;
  contextMenuMessage: Message | null = null;
  contextMenuPosition: { top: number; left: number; showBelow: boolean; arrowOffset: number } | null = null;
  longPressTimer: any = null;

  // Whiteboard properties
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  currentColor = '#000000';
  currentBrushSize = 5;
  private isDrawingActive = false;
  private lastX = 0;
  private lastY = 0;

  // Text tool properties
  currentTool: 'draw' | 'text' | 'move' | 'eraser' = 'draw';
  currentTextColor = '#000000';
  currentTextSize = 24;
  textBold = false;
  textItalic = false;
  textUnderline = false;
  textAlign: 'left' | 'center' | 'right' = 'left';
  showInlineTextInput = false;
  inlineTextValue = '';
  textInputX = 0;
  textInputY = 0;
  private textClickX = 0;
  private textClickY = 0;
  
  // Undo/Redo
  private whiteboardHistory: any[][] = [];
  private historyIndex = -1;
  private maxHistorySize = 50;

  // Move/drag properties
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private draggedElement: any = null;

  // Whiteboard elements storage
  whiteboardElements: any[] = [];

  // Canvas sizing properties (responsive to container)
  canvasWidth = 800;
  canvasHeight = 600;

  lessonId: string = '';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private agoraService: AgoraService,
    private userService: UserService,
    private lessonService: LessonService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private messagingService: MessagingService,
    private websocketService: WebSocketService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef,
    private modalController: ModalController
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

    this.agoraService.onVolumeIndicator = (volumes) => {
      this.handleVolumeIndicator(volumes);
    };

    // Add beforeunload listener to handle browser close/refresh
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));

    // Store query params for later use in ngAfterViewInit
    this.queryParams = qp;
    
    // Store lessonId if available
    if (qp?.lessonId) {
      this.lessonId = qp.lessonId;
      console.log('📚 VideoCall: Stored lessonId:', this.lessonId);
    }

    // Set up WebSocket for messaging
    this.setupMessaging();
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
      
      // Sync virtual background state after initialization
      setTimeout(() => {
        this.syncVirtualBackgroundState();
      }, 1500); // Give time for Agora to fully initialize
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

      // Load lesson data to get participant names and IDs
      if (qp.lessonId) {
        try {
          console.log('🎓 VIDEO-CALL: Loading lesson details', { 
            lessonId: qp.lessonId, 
            role: this.userRole 
          });
          
          const lessonResponse = await firstValueFrom(this.lessonService.getLesson(qp.lessonId));
          console.log('🎓 VIDEO-CALL: API Response:', lessonResponse);
          
          if (lessonResponse?.success && lessonResponse.lesson) {
            const lesson = lessonResponse.lesson;
            // Extract first names from tutor and student objects
            this.tutorName = this.getFirstName(lesson.tutorId) || 'Tutor';
            this.studentName = this.getFirstName(lesson.studentId) || 'Student';
            this.isTrialLesson = lesson.isTrialLesson || false;
            
            console.log('🎓 VIDEO-CALL: Lesson loaded', {
              lessonId: lesson._id,
              isTrialLesson: lesson.isTrialLesson,
              isTrialLessonComponent: this.isTrialLesson,
              role: this.userRole,
              tutorName: this.tutorName,
              studentName: this.studentName
            });
            
            // Get the other participant's email to look up their auth0Id
            const otherUserEmail = this.userRole === 'tutor' 
              ? lesson.studentId?.email 
              : lesson.tutorId?.email;
            
            if (otherUserEmail) {
              try {
                // Look up the full user profile to get auth0Id
                const otherUser = await firstValueFrom(
                  this.userService.getUserByEmail(otherUserEmail)
                );
                if (otherUser?.auth0Id) {
                  this.otherUserAuth0Id = otherUser.auth0Id;
                }
              } catch (userError) {
                console.error('Error looking up other user:', userError);
              }
            }
          }
        } catch (error) {
          console.error('Error loading lesson data:', error);
          // Fallback to default labels
          this.tutorName = 'Tutor';
          this.studentName = 'Student';
        }
      }

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
      
      // Force change detection to show participant tiles immediately
      this.cdr.detectChanges();
      
      console.log('✅ Successfully connected to lesson video call');
      console.log('📊 Participant box state:', {
        isConnected: this.isConnected,
        isVideoOff: this.isVideoOff,
        isMuted: this.isMuted,
        hasVideoTrack: !!this.agoraService.getLocalVideoTrack(),
        hasAudioTrack: !!this.agoraService.getLocalAudioTrack()
      });

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
        this.cdr.detectChanges(); // Force UI update
      } else if (this.agoraService.isConnecting()) {
        console.log('⏳ Already connecting to Agora, waiting...');
        this.isConnected = true;
        this.cdr.detectChanges(); // Force UI update
      } else {
        // Initialize Agora client and join when not already connected
        loading.message = 'Connecting to video call...';
        await this.agoraService.initializeClient();
        await this.agoraService.joinChannel(this.channelName);
        this.isConnected = true;
        this.cdr.detectChanges(); // Force UI update
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
          isVideoEnabled: this.agoraService.isVideoEnabled(),
          isVideoOff: this.isVideoOff
        });
        
        // Wait for at least one track (video OR audio)
        if (localVideoTrack || localAudioTrack) {
          console.log('✅ Local tracks are ready, setting up display...');
          
          // Sync audio state
          if (localAudioTrack) {
            this.isMuted = localAudioTrack.muted;
          }
          
          // Sync video state
          if (localVideoTrack) {
            this.isVideoOff = localVideoTrack.muted;
          }
          
          // Only setup video display if video track exists and is not off
          if (localVideoTrack && !this.isVideoOff) {
            this.setupLocalVideoDisplay();
          }
          
          // Force change detection to show participant box
          this.cdr.detectChanges();
          
          console.log('✅ Participant box should now be visible with state:', {
            isConnected: this.isConnected,
            isVideoOff: this.isVideoOff,
            isMuted: this.isMuted
          });
          
          resolve();
        } else {
          console.log(`⏳ Waiting for tracks (attempt ${attempts + 1})`);
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
    console.log('🔍 Current state:', {
      isConnected: this.isConnected,
      isVideoOff: this.isVideoOff,
      localVideoRef: !!this.localVideoRef
    });
    
    // Wait for ViewChild to be available
    const attemptSetup = (attempts = 0) => {
      if (attempts > 10) {
        console.error('❌ Failed to setup local video after 10 attempts');
        console.error('❌ Final state:', {
          isConnected: this.isConnected,
          isVideoOff: this.isVideoOff,
          localVideoRef: !!this.localVideoRef,
          hasVideoTrack: !!this.agoraService.getLocalVideoTrack()
        });
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
          elementExists: !!this.localVideoRef?.nativeElement,
          isConnected: this.isConnected
        });

        if (!this.isVideoOff && this.localVideoRef) {
          try {
            console.log('🎬 Playing local video in participant tile (top-right corner)');
            this.localVideoRef.nativeElement.innerHTML = '';
            // Disable mirroring to prevent video from flipping
            localVideoTrack.play(this.localVideoRef.nativeElement, { mirror: false });
            console.log('✅ Local video setup complete - should be visible in top-right corner');
            
            // Force change detection
            this.cdr.detectChanges();
            
            // Apply virtual background after video display is ready
            setTimeout(() => {
              this.applyVirtualBackgroundAfterVideoSetup();
            }, 500);
          } catch (error) {
            console.error('❌ Error playing local video:', error);
          }
        } else if (this.isVideoOff) {
          console.log('📹 Video is OFF - showing placeholder instead');
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
        
        // Force change detection when remote user count changes
        this.cdr.detectChanges();
        
        // When remote user count changes from 0 to >0, wait for the element to render
        if (previousCount === 0 && this.remoteUserCount > 0) {
          console.log('🎬 New remote user detected - waiting for element to render...');
          setTimeout(() => {
            this.playRemoteVideoInCorrectContainer();
          }, 100);
          
          // Sync whiteboard state to the new participant
          this.syncWhiteboardToNewParticipant();
        }
      }

      if (remoteUsers.size > 0) {
        // Ensure remote video is playing in the correct container
        this.playRemoteVideoInCorrectContainer();
      }
    }, 1000);
  }

  private playRemoteVideoInCorrectContainer() {
    const remoteUsers = this.agoraService.getRemoteUsers();
    if (remoteUsers.size === 0) return;

    // Get the first remote user's video
    const firstRemoteUser = Array.from(remoteUsers.values())[0];
    
    if (!firstRemoteUser.videoTrack) return;

    // IMPORTANT: Only play in main view if whiteboard is NOT open
    // If whiteboard is open, the video should be in the tile instead
    if (this.showWhiteboard && this.remoteVideoTileRef?.nativeElement) {
      // Whiteboard is open - play in tile
      try {
        const element = this.remoteVideoTileRef.nativeElement;
        // Only play if not already playing in this container
        if (!element.querySelector('video') || element.querySelector('video')?.paused) {
          firstRemoteUser.videoTrack.play(element);
          console.log('✅ Playing remote video in tile');
        }
      } catch (error) {
        console.error('❌ Error playing remote video in tile:', error);
      }
    } else if (!this.showWhiteboard && this.remoteVideoRef?.nativeElement) {
      // Whiteboard is closed - play in main view
      try {
        const element = this.remoteVideoRef.nativeElement;
        // Only play if not already playing in this container
        if (!element.querySelector('video') || element.querySelector('video')?.paused) {
          firstRemoteUser.videoTrack.play(element);
          console.log('✅ Playing remote video in main view');
        }
      } catch (error) {
        console.error('❌ Error playing remote video in main view:', error);
      }
    } else {
      // Element not available yet - will retry on next interval
      console.log('⏳ Remote video container not available yet, will retry...');
    }
  }

  // Method to manually refresh video display
  refreshVideoDisplay() {
    console.log('🔄 Manually refreshing video display...');
    this.setupLocalVideoDisplay();
  }

  // Get the label for the remote participant based on current user's role
  getRemoteParticipantLabel(): string {
    // Return first name of the remote participant
    if (this.userRole === 'tutor') {
      return this.studentName || 'Student';
    } else {
      return this.tutorName || 'Tutor';
    }
  }

  // Extract first name from user object
  private getFirstName(user: any): string {
    if (!user) return '';
    
    // Try firstName first
    if (user.firstName) {
      return this.capitalize(user.firstName);
    }
    
    // Fall back to name property and extract first name
    if (user.name) {
      const parts = user.name.trim().split(' ');
      if (parts.length > 0) {
        return this.capitalize(parts[0]);
      }
    }
    
    // Fall back to email
    if (user.email) {
      const emailParts = user.email.split('@')[0].split(/[.\s_]+/);
      if (emailParts.length > 0) {
        return this.capitalize(emailParts[0]);
      }
    }
    
    return '';
  }

  private capitalize(value: string): string {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
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
      
      // Force change detection to update DOM (show/hide video element)
      this.cdr.detectChanges();
      
      // Refresh video display after toggling and DOM updates
      setTimeout(() => {
        if (!this.isVideoOff) {
          // Video was turned ON - setup display
          console.log('📹 Video turned ON, setting up display...');
          this.setupLocalVideoDisplay();
        } else {
          // Video was turned OFF - clear the video element
          if (this.localVideoRef) {
            console.log('🚫 Turning video OFF - clearing display');
            this.localVideoRef.nativeElement.innerHTML = '';
          }
        }
      }, 300); // Increased timeout to allow DOM update
    } catch (error) {
      console.error('Error toggling video:', error);
    }
  }


  toggleWhiteboard() {
    this.showWhiteboard = !this.showWhiteboard;
    
    // Send whiteboard state change to other participant
    this.agoraService.sendWhiteboardData({
      type: 'toggle',
      isOpen: this.showWhiteboard,
      initiatedBy: this.userRole  // 'tutor' or 'student'
    });
    
    // Force change detection to update the DOM
    this.cdr.detectChanges();
    
    if (this.showWhiteboard) {
      // Wait for animation to start, then initialize
      setTimeout(() => {
        this.initializeWhiteboard();
        // Adjust canvas size after panel animation completes
        setTimeout(() => {
          this.adjustCanvasSize();
        }, 100);
        
        // Move remote video to participant tile
        this.moveRemoteVideoToTile();
      }, 50);
    } else {
      // Move remote video back to main area
      this.moveRemoteVideoToMain();
    }
  }
  
  // Move remote video to participant tile when whiteboard opens
  private moveRemoteVideoToTile() {
    console.log('📹 moveRemoteVideoToTile called');
    
    // Force change detection to ensure the tile element exists
    this.cdr.detectChanges();
    
    // Wait for the DOM to update
    setTimeout(() => {
      if (!this.remoteVideoTileRef?.nativeElement) {
        console.log('❌ Remote video tile ref not available yet, will retry...');
        return;
      }
      
      const tileContainer = this.remoteVideoTileRef.nativeElement;
      tileContainer.innerHTML = ''; // Clear any existing content
      
      // Use the centralized method to play video
      this.playRemoteVideoInCorrectContainer();
    }, 200);
  }
  
  // Move remote video back to main area when whiteboard closes
  private moveRemoteVideoToMain() {
    console.log('📹 moveRemoteVideoToMain called');
    
    // Clear the tile if it exists
    if (this.remoteVideoTileRef?.nativeElement) {
      this.remoteVideoTileRef.nativeElement.innerHTML = '';
    }
    
    // Force change detection to update the DOM
    this.cdr.detectChanges();
    
    // Wait for DOM update, then play video in main view
    setTimeout(() => {
      if (!this.remoteVideoRef?.nativeElement) {
        console.log('❌ Remote video main ref not available yet');
        return;
      }
      
      const remoteContainer = this.remoteVideoRef.nativeElement;
      remoteContainer.innerHTML = ''; // Clear any existing content
      
      // Use the centralized method to play video
      this.playRemoteVideoInCorrectContainer();
    }, 100);
  }
  
  // Adjust canvas size based on available space
  private adjustCanvasSize() {
    // Get the actual canvas container element
    const canvasContainer = document.querySelector('.canvas-container') as HTMLElement;
    if (!canvasContainer) {
      console.warn('Canvas container not found');
      return;
    }
    
    // Get the actual available space in the container
    const containerWidth = canvasContainer.clientWidth;
    const containerHeight = canvasContainer.clientHeight;
    
    // Set canvas to fill container with some padding for border/shadow
    this.canvasWidth = Math.max(containerWidth - 8, 400); // Min 400px
    this.canvasHeight = Math.max(containerHeight - 8, 300); // Min 300px
    
    console.log(`📐 Canvas resized: ${this.canvasWidth}x${this.canvasHeight}`);
    
    // Redraw after resize
    if (this.canvas) {
      setTimeout(() => {
        this.redrawCanvas();
      }, 50);
    }
  }

  toggleChat() {
    this.showChat = !this.showChat;
    
    // Adjust whiteboard canvas size when chat opens/closes
    if (this.showWhiteboard) {
      setTimeout(() => {
        this.adjustCanvasSize();
      }, 450); // Wait for animation to complete
    }
    
    if (this.showChat) {
      // Load messages when opening chat for the first time
      if (this.chatMessages.length === 0 && this.otherUserAuth0Id) {
        this.loadChatMessages();
      } else {
        // If messages already loaded, scroll to bottom instantly
        this.cdr.detectChanges();
        this.scrollChatToBottomInstant();
      }
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
      this.whiteboardHistory = [];
      this.historyIndex = -1;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      console.log('Whiteboard cleared');

      // Send clear command to other users
      this.agoraService.sendWhiteboardData({
        type: 'clear'
      });
    }
  }
  
  // Undo/Redo functionality
  saveToHistory() {
    // Remove any history after current index (if we undid and then made a new action)
    this.whiteboardHistory = this.whiteboardHistory.slice(0, this.historyIndex + 1);
    
    // Deep copy current elements
    const snapshot = JSON.parse(JSON.stringify(this.whiteboardElements));
    this.whiteboardHistory.push(snapshot);
    
    // Limit history size
    if (this.whiteboardHistory.length > this.maxHistorySize) {
      this.whiteboardHistory.shift();
    } else {
      this.historyIndex++;
    }
  }
  
  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.whiteboardElements = JSON.parse(JSON.stringify(this.whiteboardHistory[this.historyIndex]));
      this.redrawCanvas();
      
      // Send undo state to other users
      this.agoraService.sendWhiteboardData({
        type: 'undo',
        elements: this.whiteboardElements
      });
    }
  }
  
  redo() {
    if (this.historyIndex < this.whiteboardHistory.length - 1) {
      this.historyIndex++;
      this.whiteboardElements = JSON.parse(JSON.stringify(this.whiteboardHistory[this.historyIndex]));
      this.redrawCanvas();
      
      // Send redo state to other users
      this.agoraService.sendWhiteboardData({
        type: 'redo',
        elements: this.whiteboardElements
      });
    }
  }
  
  canUndo(): boolean {
    return this.historyIndex > 0;
  }
  
  canRedo(): boolean {
    return this.historyIndex < this.whiteboardHistory.length - 1;
  }

  setBrushColor(color: string) {
    this.currentColor = color;
    this.currentTextColor = color; // Also update text color
    if (this.ctx) {
      this.ctx.strokeStyle = color;
    }
    // Apply color to selected text if in text mode
    if (this.showInlineTextInput) {
      document.execCommand('foreColor', false, color);
    }
    this.refocusTextInput(); // Keep focus on textarea if editing text
  }

  setBrushSize(size: number) {
    this.currentBrushSize = size;
    if (this.ctx) {
      this.ctx.lineWidth = size;
    }
  }

  setTool(tool: 'draw' | 'text' | 'move' | 'eraser') {
    this.currentTool = tool;
    console.log('Tool changed to:', tool);
  }
  
  // Text formatting methods - now work with contenteditable and selection
  toggleTextBold() {
    document.execCommand('bold', false);
    this.updateFormattingState();
    this.refocusTextInput();
  }
  
  toggleTextItalic() {
    document.execCommand('italic', false);
    this.updateFormattingState();
    this.refocusTextInput();
  }
  
  toggleTextUnderline() {
    document.execCommand('underline', false);
    this.updateFormattingState();
    this.refocusTextInput();
  }
  
  setTextAlign(align: 'left' | 'center' | 'right') {
    this.textAlign = align;
    const alignCommand = align === 'left' ? 'justifyLeft' : align === 'center' ? 'justifyCenter' : 'justifyRight';
    document.execCommand(alignCommand, false);
    this.refocusTextInput();
  }
  
  // Update formatting state based on current selection
  updateFormattingState() {
    if (this.showInlineTextInput) {
      this.textBold = document.queryCommandState('bold');
      this.textItalic = document.queryCommandState('italic');
      this.textUnderline = document.queryCommandState('underline');
    }
  }
  
  // Handle rich text input
  onRichTextInput(event: any) {
    const element = event.target as HTMLElement;
    this.inlineTextValue = element.innerHTML;
  }
  
  // Helper method to refocus the textarea after formatting changes
  private refocusTextInput() {
    if (this.showInlineTextInput) {
      setTimeout(() => {
        const textarea = document.querySelector('.inline-text-input') as HTMLDivElement;
        if (textarea) {
          textarea.focus();
        }
      }, 0);
    }
  }

  setTextColor(color: string) {
    this.currentTextColor = color;
    this.refocusTextInput();
    console.log('Text color changed to:', color);
  }

  setTextSize(size: number) {
    this.currentTextSize = size;
    // Apply font size to selected text if in text mode
    if (this.showInlineTextInput) {
      // execCommand fontSize uses 1-7 scale, we need to apply direct style
      const element = document.querySelector('.inline-text-input') as HTMLDivElement;
      if (element) {
        element.style.fontSize = size + 'px';
      }
    }
    this.refocusTextInput();
    console.log('Text size changed to:', size);
  }

  finishTextInput() {
    const element = document.querySelector('.inline-text-input') as HTMLDivElement;
    if (!element || !element.textContent?.trim() || !this.ctx || !this.canvas) {
      this.cancelTextInput();
      return;
    }

    console.log('Adding rich text to canvas:', element.innerHTML);

    const textElement = {
      type: 'text',
      text: element.textContent || '',  // Plain text for fallback
      html: element.innerHTML,  // Rich HTML content
      x: this.textClickX,
      y: this.textClickY,
      color: this.currentTextColor,
      size: this.currentTextSize,
      bold: this.textBold,
      italic: this.textItalic,
      underline: this.textUnderline,
      align: this.textAlign,
      id: Date.now() + Math.random()
    };

    this.whiteboardElements.push(textElement);
    this.saveToHistory();
    this.redrawCanvas();
    this.agoraService.sendWhiteboardData(textElement);
    this.cancelTextInput();
  }

  cancelTextInput() {
    this.showInlineTextInput = false;
    this.inlineTextValue = '';
    // Reset formatting states
    this.textBold = false;
    this.textItalic = false;
    this.textUnderline = false;
  }
  
  // Auto-resize is no longer needed for contenteditable (it grows automatically)
  
  // New method: Handle keyboard shortcuts for text input
  handleTextInputKeydown(event: KeyboardEvent) {
    // Enter to finish (unless Shift is held for new line)
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.finishTextInput();
    }
    // ESC to cancel
    else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelTextInput();
    }
    // Keyboard shortcuts for formatting
    else if (event.ctrlKey || event.metaKey) {
      if (event.key === 'b' || event.key === 'B') {
        event.preventDefault();
        this.toggleTextBold();
      } else if (event.key === 'i' || event.key === 'I') {
        event.preventDefault();
        this.toggleTextItalic();
      } else if (event.key === 'u' || event.key === 'U') {
        event.preventDefault();
        this.toggleTextUnderline();
      }
    }
    // Shift+Enter for new line - allow default behavior
  }
  
  // New method: Save text when clicking outside (blur)
  onTextInputBlur() {
    // Small delay to allow click events to process first
    setTimeout(() => {
      if (this.showInlineTextInput) {
        const element = document.querySelector('.inline-text-input') as HTMLDivElement;
        if (element && element.textContent?.trim()) {
          // Save the text if there's content
          this.finishTextInput();
        } else {
          // Cancel if empty
          this.cancelTextInput();
        }
      }
    }, 100);
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
    if (!this.ctx) return null;
    
    // Iterate in reverse (most recent elements first)
    for (let i = this.whiteboardElements.length - 1; i >= 0; i--) {
      const element = this.whiteboardElements[i];
      if (element.type === 'text') {
        // Set the font to measure text correctly
        let fontStyle = '';
        if (element.italic) fontStyle += 'italic ';
        if (element.bold) fontStyle += 'bold ';
        this.ctx.font = `${fontStyle}${element.size}px Arial, sans-serif`;
        
        // Handle multi-line text
        const lines = element.text.split('\n');
        const lineHeight = element.size * 1.4;
        
        // Find the widest line
        let maxWidth = 0;
        lines.forEach((line: string) => {
          const lineWidth = this.ctx?.measureText(line).width || 0;
          if (lineWidth > maxWidth) maxWidth = lineWidth;
        });
        
        const totalHeight = lines.length * lineHeight;
        
        // Calculate bounding box based on alignment
        let boxX = element.x;
        let boxWidth = maxWidth;
        
        if (element.align === 'center') {
          boxX = element.x - maxWidth / 2;
        } else if (element.align === 'right') {
          boxX = element.x - maxWidth;
        }
        
        // Add some padding for easier clicking (20px on each side, 10px top/bottom)
        const padding = 20;
        boxX -= padding;
        boxWidth += padding * 2;
        const boxY = element.y - 10;
        const boxHeight = totalHeight + 20;
        
        // Check if click is within text bounding box
        if (x >= boxX && x <= boxX + boxWidth &&
          y >= boxY && y <= boxY + boxHeight) {
          console.log('Found text element at position:', element);
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
          // Render rich HTML text if available, otherwise fall back to plain text
          if (element.html) {
            this.renderRichText(element);
          } else {
            this.renderPlainText(element);
          }
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

  // Render plain text (fallback for old text elements)
  renderPlainText(element: any) {
    if (!this.ctx) return;
    
    // Build font string with bold/italic
    let fontStyle = '';
    if (element.italic) fontStyle += 'italic ';
    if (element.bold) fontStyle += 'bold ';
    
    this.ctx.fillStyle = element.color;
    this.ctx.font = `${fontStyle}${element.size}px Arial, sans-serif`;
    this.ctx.textBaseline = 'top';
    
    // Apply text alignment
    if (element.align === 'center') {
      this.ctx.textAlign = 'center';
    } else if (element.align === 'right') {
      this.ctx.textAlign = 'right';
    } else {
      this.ctx.textAlign = 'left';
    }
    
    // Handle multi-line text
    const lines = element.text.split('\n');
    const lineHeight = element.size * 1.4; // 1.4 line height
    
    lines.forEach((line: string, index: number) => {
      const yPos = element.y + (index * lineHeight);
      this.ctx!.fillText(line, element.x, yPos);
      
      // Draw underline if needed
      if (element.underline && line.trim()) {
        const metrics = this.ctx!.measureText(line);
        this.ctx!.beginPath();
        this.ctx!.strokeStyle = element.color;
        this.ctx!.lineWidth = Math.max(1, element.size / 12);
        let underlineX = element.x;
        if (element.align === 'center') {
          underlineX = element.x - metrics.width / 2;
        } else if (element.align === 'right') {
          underlineX = element.x - metrics.width;
        }
        this.ctx!.moveTo(underlineX, yPos + element.size + 2);
        this.ctx!.lineTo(underlineX + metrics.width, yPos + element.size + 2);
        this.ctx!.stroke();
      }
    });
    
    // Reset text align for next drawing
    this.ctx.textAlign = 'left';
  }

  // Render rich HTML text with partial formatting
  renderRichText(element: any) {
    if (!this.ctx) return;
    
    // Create a temporary div to parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = element.html;
    tempDiv.style.fontSize = `${element.size}px`;
    tempDiv.style.fontFamily = 'Arial, sans-serif';
    
    this.ctx.textBaseline = 'top';
    this.ctx.textAlign = 'left';
    
    const lineHeight = element.size * 1.4;
    let currentY = element.y;
    let currentX = element.x;
    
    // Process each child node (lines, spans, etc.)
    const processNode = (node: Node, isBold: boolean = false, isItalic: boolean = false, isUnderline: boolean = false, color: string = element.color) => {
      if (!this.ctx) return;
      
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (text.length === 0) return;
        
        // Split by line breaks
        const lines = text.split('\n');
        
        lines.forEach((line, lineIndex) => {
          if (lineIndex > 0) {
            currentY += lineHeight;
            currentX = element.x;
          }
          
          if (line.length === 0) return;
          
          // Set font style
          let fontStyle = '';
          if (isItalic) fontStyle += 'italic ';
          if (isBold) fontStyle += 'bold ';
          this.ctx!.font = `${fontStyle}${element.size}px Arial, sans-serif`;
          this.ctx!.fillStyle = color;
          
          // Draw text
          this.ctx!.fillText(line, currentX, currentY);
          
          // Draw underline if needed
          if (isUnderline) {
            const metrics = this.ctx!.measureText(line);
            this.ctx!.beginPath();
            this.ctx!.strokeStyle = color;
            this.ctx!.lineWidth = Math.max(1, element.size / 12);
            this.ctx!.moveTo(currentX, currentY + element.size + 2);
            this.ctx!.lineTo(currentX + metrics.width, currentY + element.size + 2);
            this.ctx!.stroke();
          }
          
          // Move x position for next text
          const metrics = this.ctx!.measureText(line);
          currentX += metrics.width;
        });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tagName = el.tagName.toLowerCase();
        
        // Determine formatting from tag
        const newBold = isBold || tagName === 'b' || tagName === 'strong';
        const newItalic = isItalic || tagName === 'i' || tagName === 'em';
        const newUnderline = isUnderline || tagName === 'u';
        
        // Get color from inline style or inherit
        let newColor = color;
        const styleColor = el.style.color;
        if (styleColor) {
          newColor = styleColor;
        }
        
        // Handle line breaks
        if (tagName === 'br') {
          currentY += lineHeight;
          currentX = element.x;
          return;
        }
        
        // Process children
        el.childNodes.forEach(child => {
          processNode(child, newBold, newItalic, newUnderline, newColor);
        });
      }
    };
    
    // Process all nodes
    tempDiv.childNodes.forEach(node => {
      processNode(node);
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
    
    // Clear the contenteditable after it's created
    setTimeout(() => {
      const element = document.querySelector('.inline-text-input') as HTMLDivElement;
      if (element) {
        element.innerHTML = '';
        element.focus();
      }
    }, 0);
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
    if (this.isDrawingActive) {
      this.isDrawingActive = false;
      // Save to history when drawing stops
      this.saveToHistory();
    }
  }

  // Setup messaging system
  private setupMessaging() {
    // Get current user - use same format as messages page (dev-user-email)
    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      if (user) {
        const email = user?.email || '';
        this.currentUserId = email ? `dev-user-${email}` : user?.sub || '';
      }
    });

    // Connect WebSocket
    if (!this.websocketService.getConnectionStatus()) {
      this.websocketService.connect();
    }

    // Listen for new messages
    this.websocketService.newMessage$.pipe(takeUntil(this.destroy$)).subscribe(message => {
      if (message) {
        // Enhanced duplicate check (by ID or by content+timestamp)
        const exists = this.chatMessages.some(m => 
          m.id === message.id || 
          (m.content === message.content && 
           m.senderId === message.senderId && 
           m.type === message.type &&
           Math.abs(new Date(m.createdAt).getTime() - new Date(message.createdAt).getTime()) < 2000)
        );
        
        if (!exists) {
          this.chatMessages.push(message);
          this.messages = this.chatMessages;
          this.scrollChatToBottom();
          this.isSending = false;
          this.cdr.detectChanges();
        }
      }
    });

    // Listen for typing indicators
    this.websocketService.typing$.pipe(takeUntil(this.destroy$)).subscribe(data => {
      if (data && data.userId === this.otherUserAuth0Id) {
        // Show typing indicator (implement if needed)
      }
    });
  }

  // Load messages for the current conversation
  private loadChatMessages() {
    if (!this.otherUserAuth0Id) {
      console.error('❌ Cannot load messages: no other user auth0Id');
      return;
    }

    this.isLoadingMessages = true;
    this.messagesSubscription = this.messagingService.getMessages(this.otherUserAuth0Id).subscribe({
      next: (response) => {
        this.chatMessages = response.messages || [];
        this.messages = this.chatMessages; // Update alias
        this.isLoadingMessages = false;
        
        // Scroll to bottom immediately (synchronously) before rendering
        this.cdr.detectChanges();
        this.scrollChatToBottomInstant();
      },
      error: (error) => {
        console.error('❌ Error loading messages:', error);
        this.isLoadingMessages = false;
        this.cdr.detectChanges();
        if (error.status === 404) {
          this.chatMessages = [];
          this.messages = [];
        }
      }
    });
  }

  sendMessage() {
    if (!this.newMessage.trim() || !this.otherUserAuth0Id || this.isSending) {
      return;
    }

    const content = this.newMessage.trim();
    const messageContent = content;
    this.newMessage = '';
    this.isSending = true;

    // Try WebSocket first (preferred for real-time)
    if (this.websocketService.getConnectionStatus()) {
      // Prepare replyTo data if replying
      let replyTo = undefined;
      if (this.replyingToMessage) {
        let senderName = 'Unknown';
        if (this.isMyMessage(this.replyingToMessage)) {
          senderName = 'You';
        } else {
          senderName = this.getRemoteParticipantLabel();
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
      }
      
      this.websocketService.sendMessage(
        this.otherUserAuth0Id,
        messageContent,
        'text',
        replyTo
      );
      
      // Clear reply after sending
      this.clearReply();
      
      // Set a timeout to fallback to HTTP if WebSocket doesn't respond
      this.messageSendTimeout = setTimeout(() => {
        if (this.isSending) {
          this.sendMessageViaHTTP(messageContent);
        }
      }, 2000);
    } else {
      // WebSocket not connected, use HTTP
      this.sendMessageViaHTTP(messageContent);
    }
  }

  private sendMessageViaHTTP(content: string) {
    if (!this.isSending) {
      return;
    }
    
    if (!this.otherUserAuth0Id) {
      console.error('❌ Cannot send message: no otherUserAuth0Id');
      return;
    }

    // Prepare replyTo data if replying
    let replyTo = undefined;
    if (this.replyingToMessage) {
      let senderName = 'Unknown';
      if (this.isMyMessage(this.replyingToMessage)) {
        senderName = 'You';
      } else {
        senderName = this.getRemoteParticipantLabel();
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
    }

    this.messagingService.sendMessage(
      this.otherUserAuth0Id,
      content,
      'text',
      replyTo
    ).subscribe({
      next: (response) => {
        const message = response.message;
        
        // Enhanced duplicate check
        const existingMessage = this.chatMessages.find(m => 
          m.id === message.id || 
          (m.content === message.content && 
           m.senderId === message.senderId && 
           Math.abs(new Date(m.createdAt).getTime() - new Date(message.createdAt).getTime()) < 1000)
        );
        
        if (!existingMessage) {
          this.chatMessages.push(message);
          this.messages = this.chatMessages;
          this.scrollChatToBottom();
        }
        
        // Clear reply after successful send
        this.clearReply();
        
        this.isSending = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('❌ Error sending message via HTTP:', error);
        this.isSending = false;
        this.cdr.detectChanges();
      }
    });
  }

  // Legacy method - kept for Agora chat compatibility but messages should use WebSocket
  receiveMessage(text: string) {
    // This is called by Agora's old chat system, but we're using WebSocket now
    // Only use this as a fallback
    console.log('Legacy receiveMessage called:', text);
  }

  // Check if message is from current user (same logic as messages page)
  isMyMessage(message: Message): boolean {
    if (!this.currentUserId || !message.senderId) {
      return false;
    }
    
    return message.senderId === this.currentUserId || 
           message.senderId === this.currentUserId.replace('dev-user-', '') ||
           `dev-user-${message.senderId}` === this.currentUserId;
  }

  // File upload methods
  triggerFileInput() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,application/pdf,.doc,.docx';
    fileInput.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const messageType = file.type.startsWith('image/') ? 'image' : 'file';
        this.uploadFile(file, messageType);
      }
    };
    fileInput.click();
  }

  private uploadFile(file: File, messageType: 'image' | 'file' | 'voice', caption?: string) {
    if (!this.otherUserAuth0Id) {
      console.error('No other user selected');
      return;
    }

    this.isUploading = true;

    this.messagingService.uploadFile(this.otherUserAuth0Id, file, messageType, caption).subscribe({
      next: (response) => {
        // Don't add message here - let WebSocket handle it to avoid duplicates
        // The message will come back via newMessage$ subscription
        this.isUploading = false;
        this.cdr.detectChanges();
        
        // Scroll to bottom after a brief delay (wait for WebSocket)
        setTimeout(() => {
          this.scrollChatToBottom();
        }, 100);
      },
      error: (error) => {
        console.error('❌ Error uploading file:', error);
        this.isUploading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // Voice recording methods
  async toggleVoiceRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.clearPendingVoiceNote();
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

        this.setPendingVoiceNote(audioFile, this.recordingDuration);

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        this.recordingDuration = 0;
        this.cdr.detectChanges();
      };
      
      this.mediaRecorder.start();
      this.isRecording = true;
      
      // Start timer
      this.recordingTimer = setInterval(() => {
        this.recordingDuration++;
        
        // Auto-stop after 60 seconds
        if (this.recordingDuration >= 60) {
          this.stopRecording();
        }
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error starting recording:', error);
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

  private setPendingVoiceNote(file: File, duration: number) {
    const url = URL.createObjectURL(file);
    this.pendingVoiceNote = { file, url, duration };
    this.cdr.detectChanges();
  }

  clearPendingVoiceNote() {
    if (this.pendingVoiceNote) {
      URL.revokeObjectURL(this.pendingVoiceNote.url);
      this.pendingVoiceNote = null;
      this.cdr.detectChanges();
    }
  }

  sendPendingVoiceNote() {
    if (this.pendingVoiceNote) {
      const voiceNote = this.pendingVoiceNote;
      this.clearPendingVoiceNote();
      this.uploadFile(voiceNote.file, 'voice');
    }
  }

  // Reply functionality
  // Long-press handlers for reply context menu
  onMessagePressStart(message: Message, event: any) {
    // Store the event target for later use
    const pressedElement = event.target.closest('.message-content');
    
    this.longPressTimer = setTimeout(async () => {
      // Create a new event-like object with the stored element
      const eventData = {
        target: pressedElement,
        clientX: event.clientX || (event.touches && event.touches[0]?.clientX),
        clientY: event.clientY || (event.touches && event.touches[0]?.clientY)
      };
      await this.showMessageContextMenu(message, eventData);
    }, 500); // 500ms for long press
  }

  onMessagePressEnd(event: any) {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  async showMessageContextMenu(message: Message, event: any) {
    // Get the position of the tapped message
    const target = event.target;
    if (!target) {
      return;
    }

    const rect = target.getBoundingClientRect();
    const screenHeight = window.innerHeight;
    const screenWidth = window.innerWidth;
    const menuWidth = 260;
    const menuHeight = 200;
    
    // Determine if menu should show above or below the message
    const spaceBelow = screenHeight - rect.bottom;
    const spaceAbove = rect.top;
    const showBelow = spaceBelow > menuHeight || spaceBelow > spaceAbove;
    
    // Calculate the center of the message bubble
    const messageCenterX = rect.left + (rect.width / 2);
    
    // Position menu centered on the message bubble
    let menuLeft = messageCenterX - (menuWidth / 2);
    
    // Keep menu on screen (with 16px padding on sides)
    const minLeft = 16;
    const maxLeft = screenWidth - menuWidth - 16;
    
    if (menuLeft < minLeft) {
      menuLeft = minLeft;
    } else if (menuLeft > maxLeft) {
      menuLeft = maxLeft;
    }
    
    // Calculate where the arrow should point (relative to menu position)
    const arrowOffset = messageCenterX - menuLeft;
    const clampedArrowOffset = Math.max(20, Math.min(arrowOffset, menuWidth - 20));
    
    this.contextMenuPosition = {
      top: showBelow ? rect.bottom + 12 : rect.top - menuHeight - 12,
      left: menuLeft,
      showBelow,
      arrowOffset: clampedArrowOffset
    };

    this.contextMenuMessage = message;
    this.showContextMenu = true;
    this.cdr.detectChanges();
  }

  closeContextMenu() {
    this.showContextMenu = false;
    this.contextMenuMessage = null;
    this.contextMenuPosition = null;
    this.cdr.detectChanges();
  }

  onContextMenuAction(action: string) {
    if (!this.contextMenuMessage) return;
    
    switch (action) {
      case 'reply':
        this.setReplyTo(this.contextMenuMessage);
        break;
      case 'copy':
        if (this.contextMenuMessage.content) {
          navigator.clipboard.writeText(this.contextMenuMessage.content);
        }
        break;
    }
    
    this.closeContextMenu();
  }

  setReplyTo(message: Message) {
    this.replyingToMessage = message;
    this.cdr.detectChanges();
  }

  clearReply() {
    this.replyingToMessage = null;
    this.cdr.detectChanges();
  }

  // Scroll chat to bottom
  private scrollChatToBottom() {
    setTimeout(() => {
      if (this.chatMessagesRef) {
        this.chatMessagesRef.nativeElement.scrollTop = this.chatMessagesRef.nativeElement.scrollHeight;
      }
    }, 100);
  }

  private scrollChatToBottomInstant() {
    // Multiple immediate attempts to ensure scroll happens before any render
    if (this.chatMessagesRef) {
      const element = this.chatMessagesRef.nativeElement;
      // Immediate scroll
      element.scrollTop = element.scrollHeight;
      
      // Use requestAnimationFrame for next paint cycle
      requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight;
      });
      
      // Also use setTimeout 0 for next event loop
      setTimeout(() => {
        element.scrollTop = element.scrollHeight;
      }, 0);
      
      // And one more for safety after a tiny delay
      setTimeout(() => {
        element.scrollTop = element.scrollHeight;
      }, 10);
    }
  }

  // Format file size
  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Get file icon
  getFileIcon(fileType: string): string {
    if (fileType.startsWith('image/')) return 'image-outline';
    if (fileType.startsWith('audio/')) return 'musical-note-outline';
    if (fileType.startsWith('video/')) return 'videocam-outline';
    if (fileType.includes('pdf')) return 'document-text-outline';
    if (fileType.includes('word') || fileType.includes('doc')) return 'document-outline';
    if (fileType.includes('excel') || fileType.includes('sheet')) return 'grid-outline';
    if (fileType.includes('powerpoint') || fileType.includes('presentation')) return 'easel-outline';
    return 'attach-outline';
  }

  // Download file
  downloadFile(message: Message, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    
    if (message.fileUrl) {
      const link = document.createElement('a');
      link.href = message.fileUrl;
      link.download = message.fileName || 'download';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  // Format recording duration
  formatRecordingDuration(): string {
    const minutes = Math.floor(this.recordingDuration / 60);
    const seconds = this.recordingDuration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  // Format time for messages
  formatMessageTime(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  shareScreen() {
    console.log('Screen sharing not implemented yet');
    alert('Screen sharing feature coming soon!');
  }

  // Virtual Background Methods (following official Agora example)
  toggleVirtualBackgroundControls(): void {
    this.showVirtualBackgroundControls = !this.showVirtualBackgroundControls;
  }

  async setBackgroundBlur(): Promise<void> {
    try {
      console.log('🌀 Setting background blur in video call...');
      await this.agoraService.setBackgroundBlur(2); // Medium blur
      this.isVirtualBackgroundEnabled = true;
      console.log('✅ Background blur enabled successfully in video call');
      
      // Close the virtual background controls panel
      this.showVirtualBackgroundControls = false;
    } catch (error) {
      console.error('❌ Failed to set background blur in video call:', error);
      
      const alert = await this.alertController.create({
        header: 'Background Blur Error',
        message: 'Failed to enable background blur. Make sure your browser supports this feature.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  async setBackgroundColor(color: string = '#00ff00'): Promise<void> {
    try {
      console.log('🎨 Setting background color in video call:', color);
      await this.agoraService.setBackgroundColor(color);
      this.isVirtualBackgroundEnabled = true;
      console.log('✅ Background color set successfully in video call');
      
      // Close the virtual background controls panel
      this.showVirtualBackgroundControls = false;
    } catch (error) {
      console.error('❌ Failed to set background color in video call:', error);
      
      const alert = await this.alertController.create({
        header: 'Background Color Error',
        message: 'Failed to set background color. Make sure your browser supports this feature.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  async disableVirtualBackground(): Promise<void> {
    try {
      console.log('🚫 Disabling virtual background in video call...');
      await this.agoraService.disableVirtualBackground();
      this.isVirtualBackgroundEnabled = false;
      console.log('✅ Virtual background disabled successfully in video call');
      
      // Close the virtual background controls panel
      this.showVirtualBackgroundControls = false;
    } catch (error) {
      console.error('❌ Failed to disable virtual background in video call:', error);
    }
  }

  // Sync virtual background state from Agora service (for preserving pre-call settings)
  private syncVirtualBackgroundState(): void {
    try {
      const vbState = this.agoraService.getVirtualBackgroundState();
      console.log('🔍 DEBUG: Syncing virtual background state in video-call:', JSON.stringify(vbState, null, 2));
      
      this.isVirtualBackgroundEnabled = vbState.enabled;
      
      if (vbState.enabled) {
        console.log('🔄 Virtual background state synced from pre-call:', vbState);
        
        // If state shows enabled but Agora service says not enabled, try force restore
        if (!this.agoraService.isVirtualBackgroundEnabled()) {
          console.log('🔧 State mismatch detected, attempting force restore...');
          setTimeout(async () => {
            const restored = await this.agoraService.forceRestoreVirtualBackground();
            if (restored) {
              console.log('✅ Force restore successful');
              this.isVirtualBackgroundEnabled = true;
            } else {
              console.log('❌ Force restore failed');
              this.isVirtualBackgroundEnabled = false;
            }
          }, 500);
        }
      }
    } catch (error) {
      console.error('❌ Failed to sync virtual background state:', error);
    }
  }

  // Apply virtual background after video display is set up (fixes timing issues)
  private async applyVirtualBackgroundAfterVideoSetup(): Promise<void> {
    try {
      console.log('🎯 Applying virtual background after video setup...');
      
      const vbState = this.agoraService.getVirtualBackgroundState();
      console.log('🔍 Virtual background state to apply:', JSON.stringify(vbState, null, 2));
      
      if (vbState.enabled && vbState.type) {
        console.log('🔄 Restoring virtual background now that video is ready...');
        
        const restored = await this.agoraService.forceRestoreVirtualBackground();
        if (restored) {
          this.isVirtualBackgroundEnabled = true;
          console.log('✅ Virtual background applied successfully after video setup');
          console.log('👥 Other participants should now see your virtual background');
        } else {
          console.log('❌ Failed to apply virtual background after video setup');
        }
      } else {
        console.log('ℹ️ No virtual background state to apply');
      }
    } catch (error) {
      console.error('❌ Error applying virtual background after video setup:', error);
    }
  }

  // Debug method to manually force restore virtual background
  async debugForceRestore(): Promise<void> {
    console.log('🔧 DEBUG: Manually forcing virtual background restore...');
    
    const vbState = this.agoraService.getVirtualBackgroundState();
    console.log('🔍 DEBUG: Current VB state:', JSON.stringify(vbState, null, 2));
    console.log('🔍 DEBUG: Agora VB enabled:', this.agoraService.isVirtualBackgroundEnabled());
    console.log('🔍 DEBUG: UI VB enabled:', this.isVirtualBackgroundEnabled);
    
    const restored = await this.agoraService.forceRestoreVirtualBackground();
    
    if (restored) {
      this.isVirtualBackgroundEnabled = true;
      console.log('✅ DEBUG: Force restore successful');
      
      const alert = await this.alertController.create({
        header: 'Debug: Force Restore',
        message: 'Virtual background force restore successful!',
        buttons: ['OK']
      });
      await alert.present();
    } else {
      console.log('❌ DEBUG: Force restore failed');
      
      const alert = await this.alertController.create({
        header: 'Debug: Force Restore',
        message: 'Virtual background force restore failed. Check console for details.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }





  handleRemoteWhiteboardData(data: any) {
    console.log('Received remote whiteboard data:', data);

    switch (data.type) {
      case 'toggle':
        // Tutor controls whiteboard state for both participants
        if (data.initiatedBy === 'tutor') {
          if (data.isOpen && !this.showWhiteboard) {
            // Tutor opened - auto-open for student
            console.log('🎨 Tutor opened whiteboard - auto-opening for student');
            this.showWhiteboard = true;
            setTimeout(() => {
              this.initializeWhiteboard();
              this.adjustCanvasSize();
            }, 100);
          } else if (!data.isOpen && this.showWhiteboard) {
            // Tutor closed - auto-close for student
            console.log('🎨 Tutor closed whiteboard - auto-closing for student');
            this.showWhiteboard = false;
          }
        }
        // Student can close independently, but doesn't affect tutor
        break;

      case 'draw':
        // Auto-open whiteboard if receiving draw data while closed
        if (!this.showWhiteboard) {
          console.log('🎨 Received drawing data - auto-opening whiteboard');
          this.showWhiteboard = true;
          setTimeout(() => {
            this.initializeWhiteboard();
            this.adjustCanvasSize();
          }, 100);
        }
        
        // Wait for canvas to be ready if it was just opened
        const addDrawElement = () => {
          if (this.ctx && this.canvas) {
            this.whiteboardElements.push(data);
            this.redrawCanvas();
          } else {
            setTimeout(addDrawElement, 50);
          }
        };
        addDrawElement();
        break;

      case 'text':
        // Auto-open whiteboard if receiving text data while closed
        if (!this.showWhiteboard) {
          console.log('🎨 Received text data - auto-opening whiteboard');
          this.showWhiteboard = true;
          setTimeout(() => {
            this.initializeWhiteboard();
            this.adjustCanvasSize();
          }, 100);
        }
        
        // Wait for canvas to be ready if it was just opened
        const addTextElement = () => {
          if (this.ctx && this.canvas) {
            this.whiteboardElements.push(data);
            this.redrawCanvas();
          } else {
            setTimeout(addTextElement, 50);
          }
        };
        addTextElement();
        break;

      case 'move':
        if (!this.ctx || !this.canvas) return;
        
        const element = this.whiteboardElements.find(el => el.id === data.elementId);
        if (element) {
          element.x = data.x;
          element.y = data.y;
          this.redrawCanvas();
        }
        break;

      case 'clear':
        if (!this.ctx || !this.canvas) return;
        
        this.whiteboardElements = [];
        this.whiteboardHistory = [];
        this.historyIndex = -1;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        break;
        
      case 'undo':
      case 'redo':
        // Sync undo/redo states
        if (!this.ctx || !this.canvas) return;
        
        if (data.elements) {
          this.whiteboardElements = data.elements;
          this.redrawCanvas();
        }
        break;

      case 'sync':
        // Received full whiteboard state from existing participant
        console.log('🔄 Syncing whiteboard state from existing participant...');
        if (data.elements && Array.isArray(data.elements)) {
          this.whiteboardElements = data.elements;
          
          // If whiteboard has content and is open, ensure it's initialized and rendered
          if (data.isWhiteboardOpen && this.whiteboardElements.length > 0) {
            if (!this.showWhiteboard) {
              this.showWhiteboard = true;
              setTimeout(() => {
                this.initializeWhiteboard();
                this.adjustCanvasSize();
                this.redrawCanvas();
              }, 100);
            } else {
              this.redrawCanvas();
            }
          }
          console.log(`✅ Synced ${this.whiteboardElements.length} whiteboard elements`);
        }
        break;
    }
  }

  // Sync whiteboard state to newly joined participant
  syncWhiteboardToNewParticipant() {
    // Only sync if we have whiteboard content or if whiteboard is open
    if (this.whiteboardElements.length > 0 || this.showWhiteboard) {
      console.log(`🔄 Syncing ${this.whiteboardElements.length} whiteboard elements to new participant...`);
      this.agoraService.sendWhiteboardData({
        type: 'sync',
        elements: this.whiteboardElements,
        isWhiteboardOpen: this.showWhiteboard
      });
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
    console.log('🔄 UI should now show:', {
      muted: state.isMuted !== undefined ? (state.isMuted ? 'MUTED' : 'UNMUTED') : 'NO CHANGE',
      videoOff: state.isVideoOff !== undefined ? (state.isVideoOff ? 'CAMERA OFF' : 'CAMERA ON') : 'NO CHANGE'
    });
    
    // Force change detection to update UI immediately
    this.cdr.detectChanges();
  }

  handleVolumeIndicator(volumes: { uid: any; level: number }[]) {
    // Clear previous timeout
    if (this.speakingTimeout) {
      clearTimeout(this.speakingTimeout);
    }

    // Reset speaking states
    this.isLocalUserSpeaking = false;
    this.isRemoteUserSpeaking = false;

    // Process volume levels
    volumes.forEach(({ uid, level }) => {
      // Level is from 0-100, consider speaking if > 10
      const isSpeaking = level > 10;
      
      if (uid === 0 || uid === this.agoraService.getClient()?.uid) {
        // Local user (uid is 0 in volume indicator for local user)
        this.isLocalUserSpeaking = isSpeaking;
      } else {
        // Remote user
        this.isRemoteUserSpeaking = isSpeaking;
      }
    });

    // Set timeout to reset speaking state after 500ms of silence
    this.speakingTimeout = setTimeout(() => {
      this.isLocalUserSpeaking = false;
      this.isRemoteUserSpeaking = false;
      this.cdr.detectChanges();
    }, 500);

    // Trigger change detection
    this.cdr.detectChanges();
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

  // Get the video off state for the first remote user
  getRemoteUserVideoOffState(): boolean {
    const remoteUsers = this.agoraService.getRemoteUsers();
    if (remoteUsers.size > 0) {
      const firstRemoteUid = Array.from(remoteUsers.keys())[0];
      const firstRemoteUser = Array.from(remoteUsers.values())[0];
      const state = this.remoteUserStates.get(firstRemoteUid);
      
      // Video is off if either:
      // 1. The state explicitly says it's off, OR
      // 2. There's no video track available
      return state?.isVideoOff || !firstRemoteUser.videoTrack || false;
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
      
      console.log('🚪 VideoCall: Leaving Agora channel and cleaning up tracks...');
      await this.agoraService.leaveChannel();
      this.isConnected = false;

      // Explicitly cleanup all video/audio elements and their MediaStreams
      console.log('🚪 VideoCall: Cleaning up all video/audio elements...');
      this.cleanupAllMediaElements();

      // Longer delay to ensure camera/mic hardware is fully released before navigation
      console.log('🚪 VideoCall: Waiting for camera/mic release...');
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('🚪 VideoCall: Camera/mic released, navigating...');

      this.router.navigate(['/tabs']);
    } catch (error) {
      console.error('Error ending call:', error);
      // Even on error, try to cleanup media
      this.cleanupAllMediaElements();
      await new Promise(resolve => setTimeout(resolve, 500));
      this.router.navigate(['/tabs']);
    }
  }

  private cleanupAllMediaElements(): void {
    try {
      // Get all video elements in the page
      const videoElements = document.querySelectorAll('video');
      console.log(`🎥 Found ${videoElements.length} video elements to cleanup`);
      
      videoElements.forEach((video, index) => {
        try {
          // Stop all tracks in the video's srcObject
          if (video.srcObject) {
            const stream = video.srcObject as MediaStream;
            const tracks = stream.getTracks();
            console.log(`  🎥 Video ${index}: Stopping ${tracks.length} tracks`);
            tracks.forEach(track => {
              track.stop();
              console.log(`    ⏹️ Stopped ${track.kind} track: ${track.label}`);
            });
          }
          
          // Clear the srcObject
          video.srcObject = null;
          video.load();
          video.remove(); // Remove the element completely
          console.log(`  ✅ Video ${index}: Cleaned up and removed`);
        } catch (err) {
          console.error(`  ❌ Error cleaning up video ${index}:`, err);
        }
      });

      // Get all audio elements in the page
      const audioElements = document.querySelectorAll('audio');
      console.log(`🎤 Found ${audioElements.length} audio elements to cleanup`);
      
      audioElements.forEach((audio, index) => {
        try {
          // Stop all tracks in the audio's srcObject
          if (audio.srcObject) {
            const stream = audio.srcObject as MediaStream;
            const tracks = stream.getTracks();
            console.log(`  🎤 Audio ${index}: Stopping ${tracks.length} tracks`);
            tracks.forEach(track => {
              track.stop();
              console.log(`    ⏹️ Stopped ${track.kind} track: ${track.label}`);
            });
          }
          
          // Clear the srcObject
          audio.srcObject = null;
          audio.load();
          audio.remove(); // Remove the element completely
          console.log(`  ✅ Audio ${index}: Cleaned up and removed`);
        } catch (err) {
          console.error(`  ❌ Error cleaning up audio ${index}:`, err);
        }
      });
    } catch (error) {
      console.error('❌ Error in cleanupAllMediaElements:', error);
    }
  }

  async ngOnDestroy() {
    console.log('🚪 VideoCall: ngOnDestroy called');
    
    // Clean up messaging subscriptions
    this.destroy$.next();
    this.destroy$.complete();
    
    if (this.messagesSubscription) {
      this.messagesSubscription.unsubscribe();
    }
    
    // Stop recording if active
    if (this.isRecording) {
      this.stopRecording();
    }
    
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
    }
    
    // Clear long press timer
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    
    // Clear pending voice note
    this.clearPendingVoiceNote();
    
    if (this.isConnected) {
      console.log('🚪 VideoCall: Still connected, calling endCall from ngOnDestroy');
      try {
        await this.endCall();
      } catch (error) {
        console.error('🚪 VideoCall: Error in endCall during ngOnDestroy, attempting cleanup fallback:', error);
        // Fallback: ensure tracks are cleaned up even if endCall fails
        try {
          await this.agoraService.cleanupLocalTracks();
          this.cleanupAllMediaElements(); // Explicit DOM cleanup
        } catch (cleanupError) {
          console.error('🚪 VideoCall: Error in cleanup fallback:', cleanupError);
        }
      }
    } else if (this.lessonId) {
      // Even if not connected to Agora, still call leave endpoint
      console.log('🚪 VideoCall: Not connected but have lessonId, calling leave endpoint');
      try {
        const leaveResponse = await firstValueFrom(this.lessonService.leaveLesson(this.lessonId));
        console.log('🚪 VideoCall: Leave endpoint response from ngOnDestroy:', leaveResponse);
      } catch (leaveError: any) {
        console.error('🚪 VideoCall: Error calling leave endpoint from ngOnDestroy:', leaveError);
      }
      
      // Safety: Clean up tracks even if not connected (in case tracks were created but channel join failed)
      try {
        const videoTrack = this.agoraService.getLocalVideoTrack();
        const audioTrack = this.agoraService.getLocalAudioTrack();
        if (videoTrack || audioTrack) {
          console.log('🧹 VideoCall: Cleaning up tracks that may have been created but not joined...');
          await this.agoraService.cleanupLocalTracks();
        }
        // Always cleanup DOM elements
        this.cleanupAllMediaElements();
      } catch (cleanupError) {
        console.error('🚪 VideoCall: Error cleaning up tracks in ngOnDestroy:', cleanupError);
      }
    } else {
      // Last resort: cleanup any remaining media elements
      console.log('🧹 VideoCall: No lesson connection, but cleaning up any media elements...');
      this.cleanupAllMediaElements();
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