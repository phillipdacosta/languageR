import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AgoraService } from '../services/agora.service';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular';
import { UserService } from '../services/user.service';
import { LessonService } from '../services/lesson.service';
import { ClassService } from '../services/class.service';
import { MessagingService, Message } from '../services/messaging.service';
import { WebSocketService } from '../services/websocket.service';
import { AuthService } from '../services/auth.service';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { takeUntil, take } from 'rxjs/operators';
import { WhiteboardService } from '../services/whiteboard.service';
import { createFastboard, FastboardApp, mount } from '@netless/fastboard';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-video-call',
  templateUrl: './video-call.page.html',
  styleUrls: ['./video-call.page.scss'],
  standalone: false,
})
export class VideoCallPage implements OnInit, AfterViewInit, OnDestroy {

  private initializationComplete = false;

  @ViewChild('whiteboardContainer', { static: false }) whiteboardContainerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('localVideo', { static: false }) localVideoRef!: ElementRef<HTMLDivElement>;
  @ViewChild('remoteVideo', { static: false }) remoteVideoRef!: ElementRef<HTMLDivElement>;
  @ViewChild('remoteVideoTile', { static: false }) remoteVideoTileRef!: ElementRef<HTMLDivElement>;
  @ViewChild('tutorMainVideo', { static: false }) tutorMainVideoRef!: ElementRef<HTMLDivElement>;
  @ViewChild('localVideoGallery', { static: false }) localVideoGalleryRef!: ElementRef<HTMLDivElement>;
  @ViewChild('chatMessagesContainer', { static: false }) chatMessagesRef!: ElementRef<HTMLDivElement>;
  @ViewChild('screenShareVideo', { static: false }) screenShareVideoRef!: ElementRef<HTMLDivElement>;
  @ViewChild('localVideoPip', { static: false }) localVideoPipRef!: ElementRef<HTMLDivElement>;

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
  isScreenSharing = false;
  isRemoteScreenSharing = false; // Track if someone else is sharing
  
  // Whiteboard cursor sharing
  remoteCursors: Map<string, { x: number; y: number; name: string; color: string; lastUpdate: number }> = new Map();
  private cursorCleanupInterval: any = null;
  
  // Professional streaming properties
  private batchInterval: any = null; // Keep for cleanup only
  private lastPoint: {x: number; y: number} | null = null;
  private lastSentPoint: {x: number; y: number} | null = null;
  private lastSendTime = 0;
  private readonly MAX_SEND_RATE = 120; // Increased to 120fps for better stroke accuracy
  private readonly MIN_SEND_INTERVAL = 1000 / this.MAX_SEND_RATE; // ~8ms
  private incomingDrawQueue: any[] = []; // Legacy batch support
  private isProcessingDrawQueue = false;
  
  // Remote path tracking for continuous strokes
  private remoteActivePaths: Map<string, {
    points: {x: number; y: number}[];
    color: string;
    size: number;
    lastPoint?: {x: number; y: number};
  }> = new Map();
  
  channelName = 'languageRoom'; // Default channel name - must match AgoraService hardcoded value
  remoteUserCount = 0;
  userRole: 'tutor' | 'student' = 'student'; // Track user role for proper labeling
  remoteUserStates: Map<any, { isMuted?: boolean; isVideoOff?: boolean }> = new Map(); // Track remote user states
  remoteUserIdentities: Map<any, { userId: string; isTutor: boolean; name: string; profilePicture?: string }> = new Map(); // Track who each remote user actually is
  
  // Class support (multi-participant)
  isClass = false; // Track if this is a class vs 1:1 lesson
  allParticipants: Array<{
    uid: any;
    name: string;
    isLocal: boolean;
    isMuted: boolean;
    isVideoOff: boolean;
    userId?: string;
    isSpeaking?: boolean;
    isTutor?: boolean;
    agoraUid?: any; // Store Agora UID for proper identification
    profilePicture?: string; // Profile picture URL
  }> = [];
  
  // Speaking detection
  isLocalUserSpeaking = false;
  isRemoteUserSpeaking = false;
  private speakingTimeout: any = null;
  // Track speaking state per participant (for classes)
  participantSpeakingStates: Map<any, boolean> = new Map();
  private participantSpeakingTimeouts: Map<any, any> = new Map();
  
  // Web Audio API for smooth speaking detection (like pre-call)
  private audioContexts: Map<any, AudioContext> = new Map();
  private analysers: Map<any, AnalyserNode> = new Map();
  private audioMonitoringFrames: Map<any, number> = new Map();
  private audioLevels: Map<any, number> = new Map();
  
  // Participant names
  tutorName: string = '';
  studentName: string = '';
  tutorUserId: string = ''; // Store tutor's user ID for proper identification
  studentUserId: string = ''; // Store student's user ID
  tutorProfilePicture: string = ''; // Store tutor's profile picture
  studentProfilePicture: string = ''; // Store student's profile picture
  myProfilePicture: string = ''; // Store current user's profile picture
  // currentUserId is already defined in chat properties below
  isTrialLesson: boolean = false;
  
  // Next event warning (for tutors)
  showNextEventWarning: boolean = false;
  nextEventMinutesAway: number = 0;
  nextEventType: string = '';
  private nextEventCheckInterval: any = null;
  
  // My identity info (from query params)
  myAgoraUid: any = ''; // Store my Agora UID
  myName: string = ''; // Store my display name
  
  // Participant Registry: Maps Agora UID → User Info (from query params)
  // This allows immediate identification without waiting for broadcasts
  participantRegistry: Map<any, { userId: string; name: string; isTutor: boolean; agoraUid: any; profilePicture?: string }> = new Map();

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

  // Agora Fastboard properties
  fastboardApp: FastboardApp | null = null; // Made public for template access
  whiteboardRoomUUID: string = '';
  whiteboardRoomToken: string = '';
  isWhiteboardLoading = false;
  
  // Legacy whiteboard properties (for fallback/compatibility)
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
  classId: string = '';
  
  // Office hours timer tracking
  isOfficeHours: boolean = false;
  bookedDuration: number = 0; // Booked duration in minutes
  perMinuteRate: number = 0; // Rate per minute
  callStartTime: Date | null = null;
  elapsedSeconds: number = 0;
  elapsedMinutes: number = 0;
  currentCost: number = 0;
  showOverageWarning: boolean = false;
  private timerInterval: any = null;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private agoraService: AgoraService,
    private userService: UserService,
    private lessonService: LessonService,
    private classService: ClassService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private messagingService: MessagingService,
    private websocketService: WebSocketService,
    private authService: AuthService,
    private whiteboardService: WhiteboardService,
    private cdr: ChangeDetectorRef,
    private modalController: ModalController,
    private toastController: ToastController
  ) { }

  async ngOnInit() {
    const qp = this.route.snapshot.queryParams as any;

    // Detect if this is a class
    this.isClass = qp?.isClass === 'true';
    console.log('🎓 VIDEO-CALL: isClass =', this.isClass);

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
    
    this.agoraService.onParticipantIdentity = (uid, identity) => {
      console.log('👤 ===== RECEIVED PARTICIPANT IDENTITY =====');
      console.log('👤 UID:', uid);
      console.log('👤 Identity:', identity);
      console.log('👤 Current remoteUserIdentities before:', Array.from(this.remoteUserIdentities.entries()));
      
      this.remoteUserIdentities.set(uid, identity);
      
      // ALSO add to participantRegistry for consistency
      this.participantRegistry.set(uid, {
        userId: identity.userId,
        name: identity.name,
        isTutor: identity.isTutor,
        agoraUid: uid,
        profilePicture: (identity as any).profilePicture || ''
      });
      
      console.log('👤 Current remoteUserIdentities after:', Array.from(this.remoteUserIdentities.entries()));
      console.log('👤 Updated participantRegistry:', Array.from(this.participantRegistry.entries()));
      console.log('👤 ==========================================');
      
      // Rebuild participants list with correct identities
      if (this.isClass) {
        console.log('👥 Updating participants list after receiving identity');
        this.updateParticipantsList();
      }
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
    
    // Store classId if available
    if (qp?.classId) {
      this.classId = qp.classId;
      console.log('🎓 VideoCall: Stored classId:', this.classId);
    }

    // Set up WebSocket for messaging
    this.setupMessaging();
    
    // Start checking for next event warnings (tutors only)
    if (qp?.role === 'tutor') {
      this.startNextEventCheck();
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
      this.currentUserId = me?.id || ''; // Store current user's MongoDB ID
      
      // SIMPLE SOLUTION: Use query params for immediate identification
      this.myAgoraUid = qp.agoraUid || '';
      this.myName = qp.userName || (role === 'tutor' ? 'Tutor' : 'Student');
      const myUserId = qp.userId || me?.id || '';
      const iAmTutor = role === 'tutor';
      
      console.log('🆔 ===== MY IDENTITY FROM QUERY PARAMS =====');
      console.log('🆔 Role:', role);
      console.log('🆔 Name:', this.myName);
      console.log('🆔 Database ID:', myUserId);
      console.log('🆔 Agora UID:', this.myAgoraUid);
      console.log('🆔 =========================================');
      
      // Store my own identity in registry (will broadcast to others when connected)
      this.participantRegistry.set(this.myAgoraUid, {
        userId: myUserId,
        name: this.myName,
        isTutor: iAmTutor,
        agoraUid: this.myAgoraUid,
        profilePicture: this.myProfilePicture
      });

      // Load lesson data to get participant names and IDs
      if (qp.lessonId) {
        try {
          console.log('🎓 VIDEO-CALL: Loading lesson details', { 
            lessonId: qp.lessonId, 
            role: this.userRole 
          });
          
          const lessonResponse = await firstValueFrom(this.lessonService.getLesson(qp.lessonId));
          console.log('🎓 VIDEO-CALL: API Response:', lessonResponse);
          console.log('🎓 VIDEO-CALL: Response check:', {
            hasResponse: !!lessonResponse,
            hasSuccess: !!lessonResponse?.success,
            hasLesson: !!lessonResponse?.lesson,
            successValue: lessonResponse?.success,
            lessonValue: lessonResponse?.lesson
          });
          
          if (lessonResponse?.success && lessonResponse.lesson) {
            const lesson = lessonResponse.lesson;
            
            console.log('🔍 ===== LESSON DATA INSPECTION =====');
            console.log('🔍 Full lesson object:', lesson);
            console.log('🔍 lesson.tutorId:', lesson.tutorId);
            console.log('🔍 lesson.studentId:', lesson.studentId);
            console.log('🔍 lesson.tutorId?._id:', lesson.tutorId?._id);
            console.log('🔍 lesson.studentId?._id:', lesson.studentId?._id);
            console.log('🔍 typeof lesson.tutorId:', typeof lesson.tutorId);
            console.log('🔍 typeof lesson.studentId:', typeof lesson.studentId);
            console.log('🔍 ===================================');
            
            // Extract first names from tutor and student objects
            this.tutorName = this.getFirstName(lesson.tutorId) || 'Tutor';
            this.studentName = this.getFirstName(lesson.studentId) || 'Student';
            this.isTrialLesson = lesson.isTrialLesson || false;
            
            // Check if this is an office hours session and extract billing info
            this.isOfficeHours = lesson.isOfficeHours || false;
            if (this.isOfficeHours) {
              this.bookedDuration = lesson.duration || 7; // Default to 7 minutes if not specified
              
              // Calculate per-minute rate from lesson price and duration
              if (lesson.price && lesson.duration) {
                this.perMinuteRate = Math.round((lesson.price / lesson.duration) * 100) / 100;
              }
              
              console.log('⏱️ Office hours session detected:', {
                bookedDuration: this.bookedDuration,
                bookedPrice: lesson.price,
                perMinuteRate: this.perMinuteRate
              });
            }
            
            // Store tutor and student user IDs for proper role identification
            this.tutorUserId = lesson.tutorId?._id || '';
            this.studentUserId = lesson.studentId?._id || '';
            
            // Store profile pictures
            this.tutorProfilePicture = (lesson.tutorId as any)?.profilePicture || lesson.tutorId?.picture || '';
            this.studentProfilePicture = (lesson.studentId as any)?.profilePicture || lesson.studentId?.picture || '';
            
            // Store my own profile picture based on role
            this.myProfilePicture = this.userRole === 'tutor' ? this.tutorProfilePicture : this.studentProfilePicture;
            
            console.log('🎓 VIDEO-CALL: Lesson loaded', {
              lessonId: lesson._id,
              isTrialLesson: lesson.isTrialLesson,
              isTrialLessonComponent: this.isTrialLesson,
              role: this.userRole,
              tutorName: this.tutorName,
              studentName: this.studentName,
              tutorUserId: this.tutorUserId,
              studentUserId: this.studentUserId,
              tutorProfilePicture: this.tutorProfilePicture,
              studentProfilePicture: this.studentProfilePicture,
              myProfilePicture: this.myProfilePicture
            });
            
            console.log('🖼️ PROFILE PICTURE DEBUG:', {
              tutorIdObject: lesson.tutorId,
              studentIdObject: lesson.studentId,
              tutorHasPicture: !!lesson.tutorId?.picture,
              studentHasPicture: !!lesson.studentId?.picture,
              tutorHasProfilePicture: !!(lesson.tutorId as any)?.profilePicture,
              studentHasProfilePicture: !!(lesson.studentId as any)?.profilePicture
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
          } else {
            console.error('❌ VIDEO-CALL: Invalid lesson response format:', {
              lessonResponse,
              hasSuccess: !!lessonResponse?.success,
              hasLesson: !!lessonResponse?.lesson
            });
          }
        } catch (error) {
          console.error('❌ VIDEO-CALL: Error loading lesson data:', error);
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
      
      // For office hours, check if both participants are present before starting timer
      if (this.isOfficeHours) {
        // Wait a moment for remote user detection, then check
        setTimeout(() => {
          this.checkAndStartOfficeHoursTimer();
        }, 2000);
      }
      
      // Initialize participants list for classes
      if (this.isClass) {
        console.log('🎓 CLASS: Initializing participants list on connect');
        
        // Get my ACTUAL Agora UID (assigned by Agora, not from query params!)
        const myActualAgoraUid = this.agoraService.getLocalUID();
        console.log('🆔 My ACTUAL Agora UID after connecting:', myActualAgoraUid);
        
        // Update registry with actual UID
        if (myActualAgoraUid && this.myAgoraUid && myActualAgoraUid !== this.myAgoraUid) {
          const oldInfo = this.participantRegistry.get(this.myAgoraUid);
          if (oldInfo) {
            console.log('🔄 Updating registry: moving from query param UID to actual UID');
            this.participantRegistry.delete(this.myAgoraUid); // Remove old entry
            this.participantRegistry.set(myActualAgoraUid, {
              ...oldInfo,
              agoraUid: myActualAgoraUid,
              profilePicture: this.myProfilePicture // Ensure profile picture is included
            }); // Add with actual UID
          }
          this.myAgoraUid = myActualAgoraUid; // Update stored UID
        } else if (myActualAgoraUid) {
          this.myAgoraUid = myActualAgoraUid;
        }
        
        // Broadcast my identity to other participants IMMEDIATELY
        // Do this BEFORE updating participants list so others receive it right away
        // Use userRole as primary indicator (more reliable than ID comparison)
        const myInfo = this.participantRegistry.get(this.myAgoraUid);
        const iAmTheTutor = this.userRole === 'tutor';
        const myNameForBroadcast = myInfo?.name || (iAmTheTutor ? this.tutorName : this.studentName);
        
        console.log('📤 ===== BROADCASTING MY IDENTITY =====');
        console.log('📤 User Role:', this.userRole);
        console.log('📤 My Agora UID:', this.myAgoraUid);
        console.log('📤 My Name:', myNameForBroadcast);
        console.log('📤 Am I the tutor?', iAmTheTutor);
        console.log('📤 Channel:', this.channelName);
        console.log('📤 ====================================');
        
        // Send identity immediately (no delay)
        this.agoraService.sendParticipantIdentity(
          this.currentUserId,
          iAmTheTutor,
          myNameForBroadcast,
          this.myProfilePicture
        ).then(() => {
          console.log('✅ Successfully broadcasted my identity');
        }).catch(error => {
          console.error('❌ Failed to broadcast identity:', error);
        });
        
        // Broadcast initial mute and video state
        // Use minimal delay to ensure tracks are published but fast enough to avoid flicker
        setTimeout(() => {
          console.log('📤 Broadcasting initial state:', { isMuted: this.isMuted, isVideoOff: this.isVideoOff });
          
          // Send mute state
          this.agoraService.sendMuteStateUpdate(this.isMuted).then(() => {
            console.log('✅ Successfully broadcasted initial mute state:', this.isMuted);
          }).catch(error => {
            console.error('❌ Failed to broadcast initial mute state:', error);
          });
          
          // Send video state
          this.agoraService.sendVideoStateUpdate(this.isVideoOff).then(() => {
            console.log('✅ Successfully broadcasted initial video state:', this.isVideoOff);
          }).catch(error => {
            console.error('❌ Failed to broadcast initial video state:', error);
          });
        }, 150); // Minimal delay - tracks are already published with correct muted state
        
        // Update participants list
        this.updateParticipantsList();
        
        // Start Web Audio monitoring for local user
        console.log('🎤 Starting Web Audio monitoring for local user');
        setTimeout(() => {
          console.log('🎤 Attempting to start local audio monitoring now...');
          const localAudioTrack = this.agoraService.getLocalAudioTrack();
          console.log('🎤 Local audio track exists?', !!localAudioTrack);
          if (localAudioTrack) {
            console.log('🎤 Local audio track details:', {
              enabled: localAudioTrack.enabled,
              muted: localAudioTrack.muted
            });
          }
          
          // IMPORTANT: Use 'local' as the UID for monitoring
          // The updateParticipantsList will update the UI based on this.isLocalUserSpeaking
          this.startAudioMonitoringForParticipant('local', null);
        }, 1000); // Increased delay to ensure audio track is ready
      }
      
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
        
        // Enable adaptive quality monitoring for better video quality
        this.agoraService.enableAdaptiveQuality();
        console.log('📊 Adaptive video quality enabled');
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
            // For tutor in gallery mode, use gallery setup; otherwise use standard setup
            if (this.isClass && this.userRole === 'tutor' && !this.showWhiteboard) {
              console.log('🎓 Setting up tutor gallery view on initial connect');
              setTimeout(() => {
                this.playVideosInTutorGallery();
              }, 200);
            } else {
              this.setupLocalVideoDisplay();
            }
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
      isClass: this.isClass,
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

      // For classes, find the local video element using querySelector (since it's in *ngFor)
      let localVideoElement: HTMLElement | null = null;
      if (this.isClass) {
        localVideoElement = document.querySelector('[data-participant-uid="local"] .participant-video') as HTMLElement;
        console.log('🎥 CLASS: Found local video element:', !!localVideoElement);
      } else if (this.localVideoRef) {
        localVideoElement = this.localVideoRef.nativeElement;
      }

      if (!localVideoElement) {
        console.log(`⏳ Waiting for local video element (attempt ${attempts + 1})`);
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
          elementExists: !!localVideoElement,
          isConnected: this.isConnected,
          isClass: this.isClass
        });

        if (!this.isVideoOff && localVideoElement) {
          try {
            console.log('🎬 Playing local video in participant tile');
            localVideoElement.innerHTML = '';
            // Disable mirroring to prevent video from flipping
            localVideoTrack.play(localVideoElement, { mirror: false });
            console.log('✅ Local video setup complete - should be visible');
            
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

      // Check for remote screen sharing
      this.checkRemoteScreenSharing();

      // Log when remote user count changes
      if (previousCount !== this.remoteUserCount) {
        console.log(`👥 Remote user count changed: ${previousCount} → ${this.remoteUserCount}`);
        console.log(`📊 Remote users details:`, Array.from(remoteUsers.entries()).map(([uid, user]) => ({
          uid,
          hasVideo: !!user.videoTrack,
          hasAudio: !!user.audioTrack
        })));
        console.log(`🔍 DEBUG: allParticipants count: ${this.allParticipants.length}`);
        console.log(`🔍 DEBUG: isClass: ${this.isClass}, showWhiteboard: ${this.showWhiteboard}`);
        
        // For classes: When a new participant joins, re-broadcast my identity AND current state
        if (this.isClass && this.remoteUserCount > previousCount) {
          console.log('🔄 New participant joined, re-broadcasting my identity and current state...');
          const iAmTheTutor = this.userRole === 'tutor';
          const myInfo = this.participantRegistry.get(this.myAgoraUid);
          const myNameForBroadcast = myInfo?.name || (iAmTheTutor ? this.tutorName : this.studentName);
          
          setTimeout(() => {
            // Re-broadcast identity
            this.agoraService.sendParticipantIdentity(
              this.currentUserId,
              iAmTheTutor,
              myNameForBroadcast,
              this.myProfilePicture
            ).then(() => {
              console.log('📤 Re-broadcasted my identity for new participant:', { userId: this.currentUserId, isTutor: iAmTheTutor, name: myNameForBroadcast });
            });
            
            // Re-broadcast current mute state
            this.agoraService.sendMuteStateUpdate(this.isMuted).then(() => {
              console.log('📤 Re-broadcasted my mute state for new participant:', this.isMuted);
            }).catch(error => {
              console.error('❌ Failed to re-broadcast mute state:', error);
            });
            
            // Re-broadcast current video state
            this.agoraService.sendVideoStateUpdate(this.isVideoOff).then(() => {
              console.log('📤 Re-broadcasted my video state for new participant:', this.isVideoOff);
            }).catch(error => {
              console.error('❌ Failed to re-broadcast video state:', error);
            });
          }, 500); // Small delay to ensure new participant's polling is ready
        }
        
        // Force change detection when remote user count changes
        this.cdr.detectChanges();
        
        // When a new remote user joins (count increases), play their video
        if (this.remoteUserCount > previousCount) {
          console.log('🎬 Remote user count increased - new user joined, playing videos...');
          
          // For office hours: Start synchronized timer when second participant joins
          if (this.isOfficeHours && previousCount === 0 && this.remoteUserCount === 1) {
            console.log('⏱️ Second participant joined office hours session, starting timer...');
            setTimeout(() => {
              this.checkAndStartOfficeHoursTimer();
            }, 1000);
          }
          
          setTimeout(() => {
            if (this.isClass) {
              if (this.userRole === 'tutor' && !this.showWhiteboard) {
                // Tutor with whiteboard closed: use gallery view
                console.log('🎓 Using tutor gallery view');
                this.playVideosInTutorGallery();
              } else {
                // Student view or whiteboard open: use participant tiles
                console.log('👥 Using participant tiles');
                this.playRemoteVideosInParticipantTiles();
              }
            } else {
              this.playRemoteVideoInCorrectContainer();
            }
          }, 100);
          
          // Sync whiteboard state to the new participant (only if count was 0 before)
          if (previousCount === 0) {
            this.syncWhiteboardToNewParticipant();
          }
        }
        
        // Update participants list for multi-user classes ONLY when count changes
        if (this.isClass && this.remoteUserCount > 0) {
          console.log('👥 CLASS: Updating participants list due to user count change');
          this.updateParticipantsList();
        } else if (this.isClass) {
          // Even with no remote users, update list to show local user
          console.log('👥 CLASS: Updating participants list (no remote users yet)');
          this.updateParticipantsList();
        }
        
        // For classes: Start Web Audio monitoring for new remote participants
        if (this.isClass) {
          remoteUsers.forEach((user, uid) => {
            if (user.audioTrack && !this.analysers.has(uid)) {
              console.log('🎤 Starting monitoring for new remote participant:', uid);
              this.startAudioMonitoringForParticipant(uid, user.audioTrack);
            }
          });
          
          // Stop monitoring for participants who left
          this.analysers.forEach((_, uid) => {
            if (uid !== 'local' && !remoteUsers.has(uid)) {
              console.log('🛑 Stopping monitoring for departed participant:', uid);
              this.stopAudioMonitoringForParticipant(uid);
            }
          });
        }
      }

      // For classes, NEVER call playRemoteVideoInCorrectContainer repeatedly
      // Videos should only be attached when:
      // 1. User count changes (handled above)
      // 2. Video state changes from off to on (handled in handleRemoteUserStateChange)
      if (remoteUsers.size > 0 && !this.isClass) {
        // For 1:1 lessons only, use the original behavior
        this.playRemoteVideoInCorrectContainer();
      }
    }, 1000);
  }

  private checkRemoteScreenSharing() {
    const remoteUsers = this.agoraService.getRemoteUsers();
    let someoneElseSharing = false;

    // Check if any remote user has a screen sharing track
    remoteUsers.forEach((user, uid) => {
      // Screen sharing tracks typically have different properties
      // Check if the video track is a screen share (usually larger resolution)
      if (user.videoTrack) {
        const track = user.videoTrack.getMediaStreamTrack();
        if (track) {
          const settings = track.getSettings();
          // Screen shares typically have displaySurface property or very high resolution
          if (settings.displaySurface || (settings.width && settings.width > 1280)) {
            someoneElseSharing = true;
            console.log(`📺 Remote user ${uid} is screen sharing`);
          }
        }
      }
    });

    this.isRemoteScreenSharing = someoneElseSharing;
  }

  private playRemoteVideoInCorrectContainer() {
    const remoteUsers = this.agoraService.getRemoteUsers();
    if (remoteUsers.size === 0) return;

    // CLASS: If this is a class, play each remote user in their participant tile
    if (this.isClass) {
      this.playRemoteVideosInParticipantTiles();
      return;
    }

    // 1:1 LESSON: Original logic for single remote user
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

  // Play remote videos in participant tiles for multi-participant classes
  private playRemoteVideosInParticipantTiles() {
    const remoteUsers = this.agoraService.getRemoteUsers();
    
    console.log('🎬 CLASS: Playing remote videos in participant tiles for', remoteUsers.size, 'participants');
    console.log('🎬 CLASS: Remote user UIDs:', Array.from(remoteUsers.keys()));
    console.log('🎬 CLASS: Whiteboard open:', this.showWhiteboard);
    
    // Get the tutor participant to handle them specially
    const tutorParticipant = this.tutorParticipant;
    
    remoteUsers.forEach((user, uid) => {
      console.log(`🎬 CLASS: Processing participant ${uid}`, {
        hasVideoTrack: !!user.videoTrack,
        hasAudioTrack: !!user.audioTrack,
        isVideoOff: user.isVideoOff
      });
      
      if (!user.videoTrack) {
        console.log(`⚠️ No video track for participant ${uid}`);
        return;
      }
      
      // Check if this is the tutor
      const isTutor = tutorParticipant && tutorParticipant.uid === uid && !tutorParticipant.isLocal;
      
      // If this is the tutor and whiteboard is NOT open, play in main view instead of tile
      if (isTutor && !this.showWhiteboard) {
        console.log(`🎓 Playing tutor video in MAIN view (whiteboard closed)`);
        this.playTutorVideoInMainView(user);
        return;
      }
      
      // Otherwise, play in tile (for students always, and tutor when whiteboard is open)
      const tileElement = document.querySelector(`[data-participant-uid="${uid}"] .participant-video`) as HTMLElement;
      
      if (!tileElement) {
        console.log(`⚠️ Participant tile not found for participant ${uid}`);
        console.log(`⚠️ Available tiles:`, Array.from(document.querySelectorAll('.participant-tile')).map(el => el.getAttribute('data-participant-uid')));
        return;
      }
      
      console.log(`✅ Found tile element for participant ${uid}`, { 
        element: tileElement, 
        innerHTML: tileElement.innerHTML.substring(0, 100) 
      });
      
      try {
        // IMPORTANT: Check if video is ALREADY playing properly in this container
        const existingVideo = tileElement.querySelector('video');
        if (existingVideo) {
          // Check if the video element is playing and has the correct source
          const isPlaying = !existingVideo.paused && existingVideo.readyState >= 2;
          if (isPlaying) {
            console.log(`⏭️ Video already playing properly for participant ${uid}, skipping re-attach`);
            return;
          }
          console.log(`🔄 Video exists but not playing properly for ${uid}`, {
            paused: existingVideo.paused,
            readyState: existingVideo.readyState,
            videoWidth: existingVideo.videoWidth,
            videoHeight: existingVideo.videoHeight
          });
        }
        
        // Clear the container before playing to avoid duplicates
        console.log(`🧹 Clearing container for participant ${uid} before playing`);
        tileElement.innerHTML = '';
        
        // Play the video track in the tile
        user.videoTrack.play(tileElement);
        console.log(`✅ Playing video for participant ${uid} in participant tile`);
        
        // Verify video element was created
        setTimeout(() => {
          const videoElement = tileElement.querySelector('video');
          if (videoElement) {
            console.log(`✅ Video element confirmed for participant ${uid}`, {
              src: videoElement.src,
              readyState: videoElement.readyState,
              paused: videoElement.paused,
              width: videoElement.videoWidth,
              height: videoElement.videoHeight
            });
          } else {
            console.error(`❌ No video element found after play() for participant ${uid}`);
          }
        }, 500);
      } catch (error) {
        console.error(`❌ Error playing video for participant ${uid}:`, error);
      }
    });
  }

  // Play tutor video in the main view (for classes when whiteboard is closed)
  private playTutorVideoInMainView(user: any) {
    // Wait for ViewChild to be available
    const attemptPlay = (attempts = 0) => {
      if (attempts > 10) {
        console.error('❌ Failed to play tutor video in main view after 10 attempts');
        return;
      }

      if (!this.tutorMainVideoRef) {
        console.log(`⏳ Waiting for tutor main video ref (attempt ${attempts + 1})`);
        setTimeout(() => attemptPlay(attempts + 1), 100);
        return;
      }

      const mainVideoElement = this.tutorMainVideoRef.nativeElement;
      
      if (!mainVideoElement) {
        console.log(`⏳ Waiting for tutor main video element (attempt ${attempts + 1})`);
        setTimeout(() => attemptPlay(attempts + 1), 100);
        return;
      }

      try {
        // Check if video is already playing
        const existingVideo = mainVideoElement.querySelector('video');
        if (existingVideo) {
          const isPlaying = !existingVideo.paused && existingVideo.readyState >= 2;
          if (isPlaying) {
            console.log('⏭️ Tutor video already playing in main view, skipping re-attach');
            return;
          }
        }

        // Clear the container and play
        console.log('🧹 Clearing tutor main view container');
        mainVideoElement.innerHTML = '';
        
        console.log('🎬 Playing tutor video in main view');
        user.videoTrack.play(mainVideoElement);
        console.log('✅ Tutor video setup complete in main view');
        
        // Force change detection
        this.cdr.detectChanges();
      } catch (error) {
        console.error('❌ Error playing tutor video in main view:', error);
      }
    };

    attemptPlay();
  }

  // Play all videos in the tutor gallery view (tutor view with whiteboard closed)
  private playVideosInTutorGallery() {
    if (!this.isClass || this.userRole !== 'tutor' || this.showWhiteboard) {
      console.log('⚠️ Not showing tutor gallery:', { isClass: this.isClass, userRole: this.userRole, showWhiteboard: this.showWhiteboard });
      return;
    }
    
    console.log('🎬 TUTOR GALLERY: Setting up gallery view for all participants');
    
    // Set up local video in gallery
    this.setupLocalVideoInGallery();
    
    // Set up remote videos in gallery
    const remoteUsers = this.agoraService.getRemoteUsers();
    console.log(`🎬 TUTOR GALLERY: Found ${remoteUsers.size} remote participants`);
    
    remoteUsers.forEach((user, uid) => {
      if (!user.videoTrack) {
        console.log(`⚠️ No video track for participant ${uid} in gallery`);
        return;
      }
      
      const galleryElement = document.querySelector(`[data-gallery-uid="${uid}"] .video-display`) as HTMLElement;
      
      if (!galleryElement) {
        console.log(`⚠️ Gallery tile not found for participant ${uid}`);
        console.log(`Available gallery tiles:`, Array.from(document.querySelectorAll('[data-gallery-uid]')).map(el => el.getAttribute('data-gallery-uid')));
        return;
      }
      
      try {
        // Check if already playing
        const existingVideo = galleryElement.querySelector('video');
        if (existingVideo && !existingVideo.paused && existingVideo.readyState >= 2) {
          console.log(`⏭️ Video already playing in gallery for ${uid}`);
          return;
        }
        
        galleryElement.innerHTML = '';
        user.videoTrack.play(galleryElement);
        console.log(`✅ Playing video in gallery for participant ${uid}`);
      } catch (error) {
        console.error(`❌ Error playing video in gallery for ${uid}:`, error);
      }
    });
  }

  // Setup local video in tutor gallery
  private setupLocalVideoInGallery() {
    const attemptSetup = (attempts = 0) => {
      if (attempts > 10) {
        console.error('❌ Failed to setup local video in gallery after 10 attempts');
        return;
      }
      
      const galleryElement = document.querySelector('[data-gallery-uid="local"] .video-display') as HTMLElement;
      
      if (!galleryElement) {
        console.log(`⏳ Waiting for local gallery element (attempt ${attempts + 1})`);
        setTimeout(() => attemptSetup(attempts + 1), 100);
        return;
      }
      
      const localVideoTrack = this.agoraService.getLocalVideoTrack();
      
      if (!localVideoTrack) {
        console.log('⚠️ No local video track for gallery yet');
        setTimeout(() => attemptSetup(attempts + 1), 200);
        return;
      }
      
      // IMPORTANT: Sync UI state with actual Agora track state before displaying
      const actualVideoState = this.agoraService.isVideoEnabled();
      this.isVideoOff = !actualVideoState;
      
      console.log('✅ Synced video state for gallery:', {
        isVideoOff: this.isVideoOff,
        actualVideoState: actualVideoState,
        trackMuted: localVideoTrack.muted
      });
      
      if (!this.isVideoOff) {
        try {
          console.log('🎬 Playing local video in tutor gallery');
          galleryElement.innerHTML = '';
          localVideoTrack.play(galleryElement, { mirror: false });
          console.log('✅ Local video in gallery setup complete');
          this.cdr.detectChanges();
          
          // Apply virtual background after video display is ready
          setTimeout(() => {
            this.applyVirtualBackgroundAfterVideoSetup();
          }, 500);
        } catch (error) {
          console.error('❌ Error playing local video in gallery:', error);
        }
      } else {
        console.log('📹 Video is OFF in gallery - showing placeholder instead');
      }
    };
    
    attemptSetup();
  }

  // Method to manually refresh video display
  refreshVideoDisplay() {
    console.log('🔄 Manually refreshing video display...');
    this.setupLocalVideoDisplay();
  }

  // Update the list of all participants for class view
  private updateParticipantsList() {
    const remoteUsers = this.agoraService.getRemoteUsers();
    
    console.log('👥 CLASS: Updating participants list', {
      remoteUserCount: remoteUsers.size,
      userRole: this.userRole,
      remoteUIDs: Array.from(remoteUsers.keys())
    });
    
    // IN-PLACE UPDATE: Only modify what changed, don't rebuild entire array
    // This prevents flashing when participants join/leave or change state
    
    // Step 1: Update local participant (always first in logic, position determined later by sorting)
    const iAmActuallyTheTutor = this.userRole === 'tutor';
    let localName = 'You';
    if (iAmActuallyTheTutor && this.tutorName) {
      localName = `${this.tutorName} (You)`;
    } else if (!iAmActuallyTheTutor && this.studentName) {
      localName = `${this.studentName} (You)`;
    }
    
    let localParticipant = this.allParticipants.find(p => p.uid === 'local');
    if (!localParticipant) {
      // Local participant doesn't exist, create it
      localParticipant = {
        uid: 'local',
        name: localName,
        isLocal: true,
        isMuted: this.isMuted,
        isVideoOff: this.isVideoOff,
        isSpeaking: this.isLocalUserSpeaking,
        isTutor: iAmActuallyTheTutor,
        userId: this.currentUserId,
        profilePicture: this.myProfilePicture
      };
      this.allParticipants.push(localParticipant);
    } else {
      // Update existing local participant in-place
      localParticipant.name = localName;
      localParticipant.isMuted = this.isMuted;
      localParticipant.isVideoOff = this.isVideoOff;
      localParticipant.isSpeaking = this.isLocalUserSpeaking;
      localParticipant.isTutor = iAmActuallyTheTutor;
      localParticipant.profilePicture = this.myProfilePicture;
    }
    
    // Step 2: Update remote participants
    const remoteUIDs = Array.from(remoteUsers.keys());
    let remoteIndex = 1;
    
    // Remove participants who left (not in remoteUsers anymore)
    this.allParticipants = this.allParticipants.filter(p => {
      if (p.isLocal) return true; // Keep local
      return remoteUIDs.includes(p.uid); // Keep if still in remote users
    });
    
    remoteUsers.forEach((user, uid) => {
      // Get state from both remoteUserStates and the remoteUsers map
      const stateFromMap = this.remoteUserStates.get(uid) || {};
      const stateFromUser = {
        isVideoOff: user.isVideoOff !== undefined ? user.isVideoOff : (!user.videoTrack),
        isMuted: user.isMuted !== undefined ? user.isMuted : (!user.audioTrack)
      };
      
      // Merge states, preferring stateFromMap if available
      const finalState = {
        isVideoOff: stateFromMap.isVideoOff !== undefined ? stateFromMap.isVideoOff : stateFromUser.isVideoOff,
        isMuted: stateFromMap.isMuted !== undefined ? stateFromMap.isMuted : stateFromUser.isMuted
      };
      
      // Determine if this remote user is the tutor
      const registryInfo = this.participantRegistry.get(uid);
      const broadcastIdentity = this.remoteUserIdentities.get(uid);
      
      let isTutor = false;
      let participantName;
      
      if (registryInfo) {
        isTutor = registryInfo.isTutor;
        participantName = registryInfo.name;
        if (isTutor) {
          participantName = `${participantName} (Tutor)`;
        }
      } else if (broadcastIdentity) {
        isTutor = broadcastIdentity.isTutor;
        participantName = broadcastIdentity.name;
        if (isTutor) {
          participantName = `${participantName} (Tutor)`;
        }
      } else {
        isTutor = false;
        participantName = `Participant ${remoteIndex}`;
      }
      
      // Find existing participant or create new one
      let existingParticipant = this.allParticipants.find(p => p.uid === uid);
      
      // Get profile picture from registry or broadcast identity
      const profilePicture = registryInfo?.profilePicture || broadcastIdentity?.profilePicture || '';
      
      if (!existingParticipant) {
        // New participant - add to array
        this.allParticipants.push({
          uid,
          name: participantName,
          isLocal: false,
          isMuted: finalState.isMuted,
          isVideoOff: finalState.isVideoOff,
          isSpeaking: this.participantSpeakingStates.get(uid) || false,
          isTutor: isTutor,
          profilePicture: profilePicture
        });
      } else {
        // Update existing participant in-place
        existingParticipant.name = participantName;
        existingParticipant.isMuted = finalState.isMuted;
        existingParticipant.isVideoOff = finalState.isVideoOff;
        existingParticipant.isSpeaking = this.participantSpeakingStates.get(uid) || false;
        existingParticipant.isTutor = isTutor;
        existingParticipant.profilePicture = profilePicture;
      }
      
      remoteIndex++;
    });
    
    // Step 3: Sort participants (tutor first, then by original order)
    this.allParticipants.sort((a, b) => {
      // Tutor always first
      if (a.isTutor && !b.isTutor) return -1;
      if (!a.isTutor && b.isTutor) return 1;
      
      // If I'm a student, put local user after tutor
      if (!iAmActuallyTheTutor) {
        if (a.isLocal && !b.isLocal && !b.isTutor) return -1;
        if (!a.isLocal && b.isLocal && !a.isTutor) return 1;
      }
      
      // If I'm tutor, put local user first (already handled by isTutor check above)
      
      // Maintain original order for others
      return 0;
    });
    
    console.log('👥 CLASS: Final participants list:', this.allParticipants.map(p => ({
      uid: p.uid,
      name: p.name,
      isLocal: p.isLocal,
      isVideoOff: p.isVideoOff,
      isMuted: p.isMuted,
      isTutor: p.isTutor,
      isSpeaking: p.isSpeaking
    })));
    
    // Force change detection
    this.cdr.detectChanges();
  }

  // Check if we should show grid view (class with 2+ participants)
  shouldShowGridView(): boolean {
    const shouldShow = this.isClass && (this.remoteUserCount + 1) >= 2; // 1 local + 1+ remote = 2+ total
    if (shouldShow) {
      console.log('✅ CLASS: Showing grid view', {
        isClass: this.isClass,
        remoteUserCount: this.remoteUserCount,
        totalParticipants: this.remoteUserCount + 1,
        allParticipants: this.allParticipants.length
      });
    }
    return shouldShow;
  }

  // Get participant video element ref
  getParticipantVideoRef(participant: any): ElementRef | null {
    if (participant.isLocal) {
      return this.localVideoRef;
    }
    // For remote users, we'll need to create dynamic refs
    return null;
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

  // Get the profile picture for the remote participant based on current user's role
  // Using a getter to avoid multiple function calls in template
  get remoteParticipantProfilePicture(): string {
    if (this.userRole === 'tutor') {
      return this.studentProfilePicture || '';
    } else {
      return this.tutorProfilePicture || '';
    }
  }

  // Get the tutor participant for class view
  // Using a getter to avoid multiple function calls in template
  get tutorParticipant() {
    if (!this.isClass) return null;
    return this.allParticipants.find(p => p.isTutor);
  }

  // Check if tutor gallery view should be shown
  shouldShowTutorGallery(): boolean {
    return this.isClass && this.userRole === 'tutor' && !this.showWhiteboard;
  }

  // Filter participants based on whiteboard state
  // When whiteboard is closed: show only students
  // When whiteboard is open: show everyone
  // Using a getter to avoid multiple function calls in template
  get filteredParticipants() {
    if (!this.isClass) return this.allParticipants;
    
    if (this.showWhiteboard) {
      // Whiteboard is open: show all participants in tiles
      return this.allParticipants;
    } else {
      // Whiteboard is closed: show only students (tutor is in main view)
      return this.allParticipants.filter(p => !p.isTutor);
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
      
      // Update participants list for classes to reflect new mute state
      if (this.isClass) {
        this.updateParticipantsList();
      }
      
      // Force change detection to update UI
      this.cdr.detectChanges();
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
      
      // Update participants list for classes to reflect new video state
      if (this.isClass) {
        this.updateParticipantsList();
      }
      
      // Refresh video display after toggling and DOM updates
      setTimeout(() => {
        if (!this.isVideoOff) {
          // Video was turned ON - setup display based on current view mode
          console.log('📹 Video turned ON, setting up display...');
          
          // Check if we should be in tutor gallery mode
          if (this.isClass && this.userRole === 'tutor' && !this.showWhiteboard) {
            console.log('🎓 Tutor in gallery mode - refreshing gallery view');
            this.playVideosInTutorGallery();
          } else {
            // Regular mode or student mode
            this.setupLocalVideoDisplay();
          }
        } else {
          // Video was turned OFF - clear the video element(s)
          console.log('🚫 Turning video OFF - clearing display');
          
          // Clear gallery view if applicable
          const galleryElement = document.querySelector('[data-gallery-uid="local"] .video-display') as HTMLElement;
          if (galleryElement) {
            galleryElement.innerHTML = '';
          }
          
          // Clear regular tile view if applicable
          if (this.localVideoRef) {
            this.localVideoRef.nativeElement.innerHTML = '';
          }
        }
      }, 300); // Increased timeout to allow DOM update
    } catch (error) {
      console.error('Error toggling video:', error);
    }
  }


  async toggleWhiteboard() {
    this.showWhiteboard = !this.showWhiteboard;
    
    if (this.showWhiteboard && !this.fastboardApp) {
      // Initialize Agora Fastboard when first opened
      await this.initializeWhiteboard();
    }
    
    // Send whiteboard state change to other participant
    this.agoraService.sendWhiteboardData({
      type: 'toggle',
      isOpen: this.showWhiteboard,
      initiatedBy: this.userRole  // 'tutor' or 'student'
    });
    
    // Show enhanced sharing messages
    if (this.showWhiteboard) {
      const toast = await this.toastController.create({
        message: '🎨 Whiteboard opened - both users can collaborate in real-time! You can see each other\'s cursors.',
        duration: 4000,
        color: 'success',
        position: 'top',
        cssClass: 'whiteboard-toast'
      });
      await toast.present();
    }
    
    // Force change detection to update the DOM
    this.cdr.detectChanges();
    
    if (this.showWhiteboard) {
      // Whiteboard is OPENING
      // Start cursor cleanup interval
      this.cursorCleanupInterval = setInterval(() => {
        this.cleanupStaleRemoteCursors();
      }, 5000); // Clean up every 5 seconds
      
      setTimeout(async () => {
        await this.initializeWhiteboard();
        // Canvas size adjustment is handled by Fastboard
        setTimeout(() => {
          // Legacy canvas adjustment removed
        }, 100);
        
        // Handle video movement based on lesson type
        if (this.isClass) {
          // For classes: Move everyone to tiles (including tutor if they were in gallery)
          console.log('📹 Whiteboard opened - moving all participants to tiles');
          this.playRemoteVideosInParticipantTiles();
          this.setupLocalVideoDisplay(); // This will put local in tile too
        } else {
          // For 1:1 lessons: Move remote video to participant tile
          this.moveRemoteVideoToTile();
        }
      }, 50);
    } else {
      // Whiteboard is CLOSING
      if (this.isClass) {
        setTimeout(() => {
          if (this.userRole === 'tutor') {
            // Tutor: Show gallery view
            console.log('📹 Whiteboard closed - showing tutor gallery view');
            this.playVideosInTutorGallery();
          } else {
            // Student: Show tutor on big screen, students in tiles
            console.log('📹 Whiteboard closed - student view: tutor on main, students in tiles');
            this.playRemoteVideosInParticipantTiles();
          }
        }, 100);
      } else {
        // For 1:1 lessons: Move remote video back to main area
        this.moveRemoteVideoToMain();
      }
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

  // Legacy initializeWhiteboard removed - now using Agora Fastboard

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
        } else if (element.type === 'path') {
          // Render smooth paths
          if (element.points && element.points.length > 1) {
            this.ctx.strokeStyle = element.color;
            this.ctx.lineWidth = element.size;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.beginPath();
            this.ctx.moveTo(element.points[0].x, element.points[0].y);
            
            for (let i = 1; i < element.points.length; i++) {
              this.ctx.lineTo(element.points[i].x, element.points[i].y);
            }
            
            this.ctx.stroke();
          }
        } else if (element.type === 'draw') {
          // Legacy support for old draw format
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
    
    // Broadcast cursor position for whiteboard collaboration
    if (this.showWhiteboard && this.canvas) {
      this.broadcastCursorPosition(event);
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

  private currentPath: any = null;
  
  draw(event: MouseEvent) {
    if (!this.isDrawingActive || !this.ctx || !this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    // Set drawing properties for immediate local drawing
    this.ctx.strokeStyle = this.currentColor;
    this.ctx.lineWidth = this.currentBrushSize;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    // Draw immediately for local responsiveness
    this.ctx.beginPath();
    this.ctx.moveTo(this.lastX, this.lastY);
    this.ctx.lineTo(currentX, currentY);
    this.ctx.stroke();

    // Initialize current path if needed
    if (!this.currentPath) {
      this.currentPath = {
        type: 'path',
        points: [{ x: this.lastX, y: this.lastY }],
        color: this.currentColor,
        size: this.currentBrushSize,
        id: Date.now() + Math.random()
      };
    }
    
    // Add current point to path
    this.currentPath.points.push({ x: currentX, y: currentY });
    
    // PROFESSIONAL STREAMING: Adaptive rate with guaranteed smoothness
    const now = performance.now();
    const timeSinceLastSend = now - this.lastSendTime;
    
    // Reduced threshold to capture more stroke detail (1px instead of 2px)
    // This preserves the original drawing style better
    const significantMovement = !this.lastSentPoint || 
      Math.abs(currentX - this.lastSentPoint.x) >= 1 || 
      Math.abs(currentY - this.lastSentPoint.y) >= 1;
    
    if (timeSinceLastSend >= this.MIN_SEND_INTERVAL || significantMovement) {
      // Send individual point for ultra-smooth remote experience
      this.agoraService.sendWhiteboardData({
        type: 'draw_point',
        pathId: this.currentPath?.id || Date.now(),
        point: { x: currentX, y: currentY },
        fromPoint: { x: this.lastX, y: this.lastY }, // For line continuity
        color: this.currentColor,
        size: this.currentBrushSize,
        timestamp: now // For remote smoothing
      });
      
      this.lastSentPoint = { x: currentX, y: currentY };
      this.lastSendTime = now;
    }

    this.lastX = currentX;
    this.lastY = currentY;
  }

  stopDrawing() {
    if (this.isDrawingActive) {
      this.isDrawingActive = false;
      
      // Clear any pending timeouts (no more batching needed)
      if (this.batchInterval) {
        clearTimeout(this.batchInterval);
        this.batchInterval = null;
      }
      
      // Finalize the current path
      if (this.currentPath) {
        this.whiteboardElements.push(this.currentPath);
        
        // Send stroke complete notification
        this.agoraService.sendWhiteboardData({
          type: 'stroke_complete',
          pathId: this.currentPath.id
        });
        
        this.currentPath = null;
      }
      
      // Reset drawing state
      this.lastPoint = null;
      this.lastSentPoint = null;
      
      // Save to history when drawing stops
      this.saveToHistory();
    }
  }

  // Helper method removed - now using adaptive rate limiting instead

  // Legacy batch method (no longer used in streaming mode)
  private sendPointBatch() {
    // No-op in streaming mode - points are sent individually
  }

  // Process incoming draw queue with immediate rendering for ultra-smooth drawing
  private processDrawQueue() {
    // Process all queued batches immediately for maximum responsiveness
    while (this.incomingDrawQueue.length > 0) {
      const batch = this.incomingDrawQueue.shift();
      this.drawBatchToCanvas(batch);
    }
    this.isProcessingDrawQueue = false;
    
    // If more batches arrive while processing, schedule another frame
    if (this.incomingDrawQueue.length > 0) {
      requestAnimationFrame(() => this.processDrawQueue());
    }
  }

  // Draw individual point with professional smoothing (like Preply)
  private drawPointToCanvas(pointData: any) {
    if (!this.ctx || !pointData.point || !pointData.fromPoint) return;
    
    this.ctx.strokeStyle = pointData.color;
    this.ctx.lineWidth = pointData.size;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    
    const pathId = pointData.pathId;
    let activePath = this.remoteActivePaths.get(pathId);
    
    if (!activePath) {
      // Start new stroke
      activePath = {
        points: [pointData.fromPoint],
        color: pointData.color,
        size: pointData.size,
        lastPoint: pointData.fromPoint
      };
      this.remoteActivePaths.set(pathId, activePath);
    }
    
    // For maximum smoothness, check if we need to interpolate
    const lastPoint = activePath.lastPoint || pointData.fromPoint;
    const currentPoint = pointData.point;
    
    // Calculate distance between points
    const dx = currentPoint.x - lastPoint.x;
    const dy = currentPoint.y - lastPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    this.ctx.beginPath();
    this.ctx.moveTo(lastPoint.x, lastPoint.y);
    
    // Reduced interpolation to preserve original drawing style
    // Only interpolate for very large gaps (network issues)
    if (distance > 20) {
      const steps = Math.ceil(distance / 3); // Less aggressive interpolation
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const interpX = lastPoint.x + (dx * t);
        const interpY = lastPoint.y + (dy * t);
        this.ctx.lineTo(interpX, interpY);
      }
    } else {
      // Direct line for close points - preserves original stroke style
      this.ctx.lineTo(currentPoint.x, currentPoint.y);
    }
    
    this.ctx.stroke();
    
    // Update tracking
    activePath.points.push(currentPoint);
    activePath.lastPoint = currentPoint;
  }

  // Draw a batch of points to canvas with continuous stroke tracking
  private drawBatchToCanvas(batch: any) {
    if (!this.ctx || !batch.points || batch.points.length === 0) return;
    
    const pathId = batch.pathId;
    let activePath = this.remoteActivePaths.get(pathId);
    
    // Initialize path if it doesn't exist
    if (!activePath) {
      activePath = {
        points: [],
        color: batch.color,
        size: batch.size
      };
      this.remoteActivePaths.set(pathId, activePath);
    }
    
    this.ctx.strokeStyle = batch.color;
    this.ctx.lineWidth = batch.size;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    
    // Draw continuous lines from last point to new points
    this.ctx.beginPath();
    
    if (activePath.lastPoint && batch.points.length > 0) {
      // Continue from where we left off
      this.ctx.moveTo(activePath.lastPoint.x, activePath.lastPoint.y);
      this.ctx.lineTo(batch.points[0].x, batch.points[0].y);
    } else if (batch.points.length > 0) {
      // Start new path
      this.ctx.moveTo(batch.points[0].x, batch.points[0].y);
    }
    
    // Draw all points in the batch
    for (let i = 1; i < batch.points.length; i++) {
      this.ctx.lineTo(batch.points[i].x, batch.points[i].y);
    }
    
    this.ctx.stroke();
    
    // Update the last point for continuity
    if (batch.points.length > 0) {
      activePath.lastPoint = batch.points[batch.points.length - 1];
      activePath.points.push(...batch.points);
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

    // Listen for lesson cancelled events
    this.websocketService.lessonCancelled$.pipe(takeUntil(this.destroy$)).subscribe(async (cancellation) => {
      console.log('🚫 Received lesson_cancelled event in video-call:', cancellation);
      const normalizedEventId = String(cancellation.lessonId);
      const normalizedCurrentId = String(this.lessonId);
      if (normalizedEventId === normalizedCurrentId) {
        console.log('❌ Current lesson has been cancelled by:', cancellation.cancelledBy);
        await this.handleLessonCancellation(cancellation);
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

  async shareScreen() {
    try {
      if (this.isScreenSharing) {
        // Stop screen sharing
        await this.stopScreenShare();
      } else {
        // Start screen sharing
        await this.startScreenShare();
      }
    } catch (error: any) {
      console.error('❌ Screen sharing error:', error);
      
      let errorMessage = 'Failed to share screen';
      if (error.message?.includes('Permission denied')) {
        errorMessage = 'Screen sharing permission was denied. Please allow screen sharing and try again.';
      } else if (error.message?.includes('NotAllowedError')) {
        errorMessage = 'Screen sharing is not allowed. Please check your browser permissions.';
      } else if (error.message?.includes('NotSupportedError')) {
        errorMessage = 'Screen sharing is not supported in this browser.';
      }
      
      const alert = await this.alertController.create({
        header: 'Screen Sharing Error',
        message: errorMessage,
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  async startScreenShare() {
    console.log('🖥️ Starting screen share...');
    
    // Start screen sharing directly without modal
    await this.proceedWithScreenShare();
  }

  private async proceedWithScreenShare() {
    const loading = await this.loadingController.create({
      message: 'Starting screen share...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      await this.agoraService.startScreenShare();
      this.isScreenSharing = true;
      console.log('✅ Screen sharing started successfully');
      
      // Display the screen share video
      setTimeout(() => {
        this.displayScreenShare();
      }, 500);

      
      // Show success message with cursor tip
      const toast = await this.toastController.create({
        message: 'Screen sharing started. For cursor visibility, share "Entire Screen" not browser tabs.',
        duration: 4000,
        color: 'success',
        position: 'top'
      });
      await toast.present();
      
    } catch (error) {
      console.error('❌ Failed to start screen sharing:', error);
      throw error;
    } finally {
      await loading.dismiss();
    }
  }

  async stopScreenShare() {
    console.log('🖥️ Stopping screen share...');
    
    try {
      await this.agoraService.stopScreenShare();
      this.isScreenSharing = false;
      console.log('✅ Screen sharing stopped successfully');
      
      // Clear the screen share display
      if (this.screenShareVideoRef?.nativeElement) {
        this.screenShareVideoRef.nativeElement.innerHTML = '';
      }
      
      // Clear PiP displays
      if (this.localVideoPipRef?.nativeElement) {
        this.localVideoPipRef.nativeElement.innerHTML = '';
      }
      
      
      // Restore normal video layout
      setTimeout(() => {
        this.playRemoteVideoInCorrectContainer();
      }, 500);
      
      // Show success message
      const toast = await this.toastController.create({
        message: 'Screen sharing stopped',
        duration: 2000,
        color: 'primary',
        position: 'top'
      });
      await toast.present();
      
    } catch (error) {
      console.error('❌ Failed to stop screen sharing:', error);
      throw error;
    }
  }

  private displayScreenShare() {
    try {
      const screenTrack = this.agoraService.getScreenTrack();
      if (screenTrack && this.screenShareVideoRef?.nativeElement) {
        console.log('🖥️ Displaying screen share video in full screen mode');
        screenTrack.play(this.screenShareVideoRef.nativeElement);
        
        // Also display local camera in PiP
        this.displayLocalVideoPip();
        
        // Display remote participants in PiP
        this.displayRemoteParticipantsPip();
      }
    } catch (error) {
      console.error('❌ Error displaying screen share:', error);
    }
  }

  private displayLocalVideoPip() {
    try {
      const localTrack = this.agoraService.getLocalVideoTrack();
      if (localTrack && this.localVideoPipRef?.nativeElement) {
        console.log('📹 Displaying local camera in PiP');
        localTrack.play(this.localVideoPipRef.nativeElement);
      }
    } catch (error) {
      console.error('❌ Error displaying local video PiP:', error);
    }
  }

  private displayRemoteParticipantsPip() {
    try {
      // Wait a bit for DOM to update
      setTimeout(() => {
        const remoteUsers = this.agoraService.getRemoteUsers();
        remoteUsers.forEach((user: any, uid: any) => {
          if (user.videoTrack) {
            const pipElement = document.getElementById(`pip-remote-${uid}`);
            if (pipElement) {
              const videoContainer = pipElement.querySelector('.pip-video-element');
              if (videoContainer) {
                console.log(`📹 Displaying remote participant ${uid} in PiP`);
                user.videoTrack.play(videoContainer as HTMLElement);
              }
            }
          }
        });
      }, 100);
    } catch (error) {
      console.error('❌ Error displaying remote participants PiP:', error);
    }
  }

  getRemoteParticipants() {
    return this.allParticipants.filter((p: any) => !p.isLocal);
  }

  isMyScreenShare(): boolean {
    // Return true if the current user is the one sharing screen
    // This prevents showing their own camera PiP overlay
    return this.isScreenSharing;
  }

  // Whiteboard Screen Sharing Methods
  async shareWhiteboardScreen() {
    try {
      if (this.isScreenSharing) {
        // Already sharing - stop current share
        await this.stopScreenShare();
        return;
      }

      // Show options for whiteboard sharing
      const alert = await this.alertController.create({
        header: 'Share Whiteboard',
        message: 'How would you like to share the whiteboard?',
        buttons: [
          {
            text: 'Share Canvas Only',
            handler: () => this.shareCanvasAsVideo()
          },
          {
            text: 'Share Full Screen',
            handler: () => this.shareScreenWithWhiteboard()
          },
          {
            text: 'Cancel',
            role: 'cancel'
          }
        ]
      });

      await alert.present();

    } catch (error) {
      console.error('❌ Whiteboard screen sharing error:', error);
      
      const toast = await this.toastController.create({
        message: 'Failed to start whiteboard sharing. Please try again.',
        duration: 3000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    }
  }

  private async shareCanvasAsVideo() {
    try {
      if (!this.canvas) {
        throw new Error('Whiteboard canvas not available');
      }

      console.log('🎨 Starting canvas video share...');
      
      // Capture canvas as video stream at 120fps for ultra-smooth drawing
      const canvasStream = this.canvas.captureStream(120);
      
      if (!canvasStream) {
        throw new Error('Failed to capture canvas stream');
      }

      // Use existing Agora screen share infrastructure with canvas stream
      await this.agoraService.startScreenShare(canvasStream);
      this.isScreenSharing = true;
      
      // Display the shared canvas in screen share mode
      setTimeout(() => {
        this.displayScreenShare();
      }, 500);

      console.log('✅ Canvas sharing started successfully');
      
      const toast = await this.toastController.create({
        message: '🎨 Whiteboard canvas is now being shared!',
        duration: 3000,
        color: 'success',
        position: 'top'
      });
      await toast.present();

    } catch (error) {
      console.error('❌ Canvas sharing failed:', error);
      
      const toast = await this.toastController.create({
        message: 'Failed to share canvas. Please try again.',
        duration: 3000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    }
  }

  private async shareScreenWithWhiteboard() {
    try {
      // Guide user to avoid mirror effect
      const toast = await this.toastController.create({
        message: '💡 Tip: Select "Entire Screen" when prompted to avoid mirror effect',
        duration: 4000,
        color: 'primary',
        position: 'top'
      });
      await toast.present();
      
      // Use existing screen share method
      await this.startScreenShare();

    } catch (error) {
      console.error('❌ Full screen sharing failed:', error);
      
      const errorToast = await this.toastController.create({
        message: 'Failed to share screen. Please try again.',
        duration: 3000,
        color: 'danger',
        position: 'top'
      });
      await errorToast.present();
    }
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





  // Broadcast cursor position to other participants (immediate like Preply)
  private broadcastCursorPosition(event: MouseEvent) {
    if (!this.canvas) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Get user info for cursor display
    const myInfo = this.participantRegistry.get(this.myAgoraUid);
    const userName = myInfo?.name || this.myName || 'User';
    const userColor = this.userRole === 'tutor' ? '#4CAF50' : '#2196F3'; // Green for tutor, blue for student
    
    // Send immediately for Preply-like smoothness
    this.agoraService.sendWhiteboardData({
      type: 'cursor',
      x: x,
      y: y,
      userId: this.currentUserId,
      name: userName,
      color: userColor,
      timestamp: Date.now()
    });
  }
  
  // Track cursors for better Angular performance
  trackCursor(index: number, item: any) {
    return item.key; // Track by userId
  }
  
  // Clean up remote cursors that haven't been updated recently
  private cleanupStaleRemoteCursors() {
    const now = Date.now();
    const CURSOR_TIMEOUT = 2000; // 2 seconds
    
    for (const [userId, cursor] of this.remoteCursors.entries()) {
      if (now - cursor.lastUpdate > CURSOR_TIMEOUT) {
        this.remoteCursors.delete(userId);
      }
    }
  }

  handleRemoteWhiteboardData(data: any) {
    console.log('Received remote whiteboard data:', data);

    switch (data.type) {
      case 'cursor':
        // Handle remote cursor position updates (immediate like Preply)
        if (data.userId !== this.currentUserId && this.showWhiteboard) {
          this.remoteCursors.set(data.userId, {
            x: data.x,
            y: data.y,
            name: data.name || 'User',
            color: data.color || '#666666',
            lastUpdate: Date.now()
          });
          
          // Immediate change detection for smooth cursor movement
          this.cdr.detectChanges();
        }
        break;
        
      case 'toggle':
        // Tutor controls whiteboard state for both participants
        if (data.initiatedBy === 'tutor') {
          if (data.isOpen && !this.showWhiteboard) {
            // Tutor opened - auto-open for student
            console.log('🎨 Tutor opened whiteboard - auto-opening for student');
            this.showWhiteboard = true;
            
            // Force change detection
            this.cdr.detectChanges();
            
            setTimeout(async () => {
              await this.initializeWhiteboard();
              // Canvas size adjustment handled by Fastboard
              
              // Reposition videos based on lesson type
              if (this.isClass) {
                // For classes: Move tutor to tiles (students already in tiles)
                console.log('📹 Remote whiteboard opened - moving tutor to tiles');
                this.playRemoteVideosInParticipantTiles();
              } else {
                // For 1:1: Move remote to tile
                this.moveRemoteVideoToTile();
              }
            }, 100);
          } else if (!data.isOpen && this.showWhiteboard) {
            // Tutor closed - auto-close for student
            console.log('🎨 Tutor closed whiteboard - auto-closing for student');
            this.showWhiteboard = false;
            
            // Force change detection
            this.cdr.detectChanges();
            
            // Reposition videos based on lesson type
            if (this.isClass) {
              setTimeout(() => {
                // For classes: Move tutor back to main view (students stay in tiles)
                console.log('📹 Remote whiteboard closed - moving tutor to main view');
                this.playRemoteVideosInParticipantTiles();
              }, 100);
            } else {
              // For 1:1: Move remote back to main
              this.moveRemoteVideoToMain();
            }
          }
        }
        // Student can close independently, but doesn't affect tutor
        break;

      case 'draw_point':
        // Handle individual point streaming (like Preply/Figma)
        if (!this.showWhiteboard) {
          console.log('🎨 Received draw point - auto-opening whiteboard');
          this.showWhiteboard = true;
          this.cdr.detectChanges();
          
          setTimeout(() => {
            this.initializeWhiteboard();
            this.adjustCanvasSize();
            
            // Reposition videos when whiteboard auto-opens
            if (this.isClass) {
              this.playRemoteVideosInParticipantTiles();
            } else {
              this.moveRemoteVideoToTile();
            }
          }, 100);
        }
        
        // Draw individual point immediately for maximum smoothness
        this.drawPointToCanvas(data);
        break;

      case 'draw_batch':
        // Legacy support for batch format
        this.incomingDrawQueue.push(data);
        if (!this.isProcessingDrawQueue) {
          this.isProcessingDrawQueue = true;
          requestAnimationFrame(() => this.processDrawQueue());
        }
        break;

      case 'path_update':
        // Legacy support - convert to batch format
        if (data.points && data.points.length > 0) {
          this.incomingDrawQueue.push({
            type: 'draw_batch',
            points: data.points,
            color: data.color,
            size: data.size
          });
          if (!this.isProcessingDrawQueue) {
            this.isProcessingDrawQueue = true;
            requestAnimationFrame(() => this.processDrawQueue());
          }
        }
        break;
        
      case 'stroke_complete':
        // Stroke is complete - clean up active path tracking
        console.log('Remote stroke completed:', data.pathId);
        if (data.pathId && this.remoteActivePaths.has(data.pathId)) {
          const completedPath = this.remoteActivePaths.get(data.pathId);
          if (completedPath) {
            // Add to whiteboard elements for history/undo
            this.whiteboardElements.push({
              type: 'path',
              points: completedPath.points,
              color: completedPath.color,
              size: completedPath.size,
              id: data.pathId
            });
          }
          // Remove from active tracking
          this.remoteActivePaths.delete(data.pathId);
        }
        break;

      case 'path_complete':
        // Legacy support - Add completed path to elements
        if (data.path && this.ctx && this.canvas) {
          this.whiteboardElements.push(data.path);
        }
        break;

      case 'draw':
        // Legacy support for old draw format
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
          this.cdr.detectChanges();
          
          setTimeout(() => {
            this.initializeWhiteboard();
            this.adjustCanvasSize();
            
            // Reposition videos when whiteboard auto-opens
            if (this.isClass) {
              console.log('📹 Auto-opening whiteboard (text) - moving videos to tiles');
              this.playRemoteVideosInParticipantTiles();
            } else {
              this.moveRemoteVideoToTile();
            }
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
              setTimeout(async () => {
                await this.initializeWhiteboard();
                // Canvas operations handled by Fastboard
                // this.redrawCanvas(); // Not needed for Fastboard
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
    
    // For classes, check if we need to start audio monitoring for this user
    if (this.isClass && state.isMuted !== undefined) {
      console.log('🎤 Checking if we need to start audio monitoring for:', uid);
      console.log('🎤 isMuted:', state.isMuted);
      console.log('🎤 Already has analyser?', this.analysers.has(uid));
      
      const remoteUsers = this.agoraService.getRemoteUsers();
      const user = remoteUsers.get(uid);
      
      console.log('🎤 User from remoteUsers:', {
        exists: !!user,
        hasAudioTrack: !!user?.audioTrack
      });
      
      if (user && user.audioTrack && !this.analysers.has(uid)) {
        console.log('✅ All conditions met! Starting audio monitoring for user:', uid);
        this.startAudioMonitoringForParticipant(uid, user.audioTrack);
      } else {
        console.log('❌ Cannot start monitoring. Missing:', {
          noUser: !user,
          noAudioTrack: !user?.audioTrack,
          alreadyHasAnalyser: this.analysers.has(uid)
        });
      }
    }
    
    // For classes, update ONLY the specific participant's state (in-place)
    // This avoids rebuilding the entire list and re-attaching videos
    if (this.isClass) {
      console.log('🔄 CLASS: Updating specific participant state in-place (no rebuild)');
      const participant = this.allParticipants.find(p => p.uid === uid);
      if (participant) {
        // Update state in-place
        if (state.isMuted !== undefined) {
          participant.isMuted = state.isMuted;
          console.log(`🔄 Updated participant ${uid} muted state to ${state.isMuted}`);
        }
        if (state.isVideoOff !== undefined) {
          participant.isVideoOff = state.isVideoOff;
          console.log(`🔄 Updated participant ${uid} video state to ${state.isVideoOff}`);
          
          // If video just turned ON, play it in the appropriate view
          if (!state.isVideoOff) {
            setTimeout(() => {
              console.log('🎬 Video turned on for remote user, refreshing video displays for:', uid);
              
              // Check which view mode we're in
              if (this.userRole === 'tutor' && !this.showWhiteboard) {
                // Tutor viewing gallery - refresh gallery view
                console.log('🎓 Tutor in gallery mode - refreshing gallery');
                this.playVideosInTutorGallery();
              } else {
                // Viewing tiles (student view or whiteboard open)
                console.log('👥 Refreshing participant tiles');
                this.playRemoteVideosInParticipantTiles();
              }
            }, 100);
          } else {
            // Video turned OFF - clear the video element
            console.log('🚫 Video turned off for remote user:', uid);
            
            // Clear from gallery if in gallery mode
            if (this.userRole === 'tutor' && !this.showWhiteboard) {
              const galleryElement = document.querySelector(`[data-gallery-uid="${uid}"] .video-display`) as HTMLElement;
              if (galleryElement) {
                galleryElement.innerHTML = '';
              }
            }
            
            // Clear from tile
            const tileElement = document.querySelector(`[data-participant-uid="${uid}"] .participant-video`) as HTMLElement;
            if (tileElement) {
              tileElement.innerHTML = '';
            }
          }
        }
      } else {
        console.log('⚠️ Participant not found in list, rebuilding list');
        this.updateParticipantsList();
      }
    }
    
    // Force change detection to update UI immediately
    this.cdr.detectChanges();
  }

  handleVolumeIndicator(volumes: { uid: any; level: number }[]) {
    // NOTE: This method is now deprecated in favor of Web Audio API monitoring
    // Keeping for 1:1 lessons as fallback
    if (this.isClass) {
      // For classes, we use Web Audio API instead (smoother detection)
      return;
    }
    
    // Original logic for 1:1 lessons
    // Clear previous timeout
    if (this.speakingTimeout) {
      clearTimeout(this.speakingTimeout);
    }

    // Reset speaking states
    this.isLocalUserSpeaking = false;
    this.isRemoteUserSpeaking = false;

    // Process volume levels
    volumes.forEach(({ uid, level }) => {
      // Level is from 0-100, consider speaking if > 30
      const isSpeaking = level > 30;
      
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

  // Start Web Audio API monitoring for a participant (smooth detection like pre-call)
  private startAudioMonitoringForParticipant(uid: any, audioTrack: any): void {
    try {
      console.log('🎤 Starting Web Audio monitoring for participant:', uid);
      
      // Stop any existing monitoring for this participant
      this.stopAudioMonitoringForParticipant(uid);
      
      // Get MediaStreamTrack from the audio track
      let mediaStreamTrack: MediaStreamTrack;
      if (uid === 'local') {
        // Local Agora track
        const agoraTrack = this.agoraService.getLocalAudioTrack();
        if (!agoraTrack) {
          console.log('⚠️ No local audio track available');
          return;
        }
        mediaStreamTrack = agoraTrack.getMediaStreamTrack();
      } else {
        // Remote Agora track
        if (!audioTrack) {
          console.log('⚠️ No audio track provided for participant:', uid);
          return;
        }
        mediaStreamTrack = audioTrack.getMediaStreamTrack();
      }
      
      if (!mediaStreamTrack) {
        console.log('⚠️ Could not get MediaStreamTrack for participant:', uid);
        return;
      }
      
      console.log('🔍 MediaStreamTrack state:', {
        uid,
        enabled: mediaStreamTrack.enabled,
        muted: mediaStreamTrack.muted,
        readyState: mediaStreamTrack.readyState
      });
      
      // Create MediaStream from the track
      const audioStream = new MediaStream([mediaStreamTrack]);
      
      // Create audio context and analyser
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(audioStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      
      // Store references
      this.audioContexts.set(uid, audioContext);
      this.analysers.set(uid, analyser);
      
      // Start the monitoring loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let lastSpeakingTime = 0; // Track when we last detected speaking
      
      const updateLevel = () => {
        const currentAnalyser = this.analysers.get(uid);
        if (!currentAnalyser) {
          // Monitoring was stopped
          this.audioLevels.set(uid, 0);
          return;
        }
        
        currentAnalyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume (same as pre-call)
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        
        // Convert to percentage (0-100)
        const level = Math.min(100, (average / 128) * 100);
        this.audioLevels.set(uid, level);
        
        // Threshold: consider speaking if level > 15 (more sensitive than 30, but smoother)
        const isCurrentlySpeaking = level > 15;
        const wasAlreadySpeaking = this.participantSpeakingStates.get(uid);
        const currentTime = Date.now();
        
        if (isCurrentlySpeaking) {
          // Update last speaking time
          lastSpeakingTime = currentTime;
          
          // If not already marked as speaking, mark them
          if (!wasAlreadySpeaking) {
            this.participantSpeakingStates.set(uid, true);
            
            // Update participant in the list
            // For 'local' uid, find the local participant in the list
            const participant = uid === 'local' 
              ? this.allParticipants.find(p => p.isLocal)
              : this.allParticipants.find(p => p.uid === uid);
            
            console.log('🗣️ Setting speaking state for participant:', {
              uid,
              isLocal: uid === 'local',
              participantFound: !!participant,
              participantName: participant?.name,
              participantUID: participant?.uid
            });
            
            if (participant) {
              participant.isSpeaking = true;
              
              // Also update the dedicated local speaking flag for backward compatibility
              if (uid === 'local') {
                this.isLocalUserSpeaking = true;
              }
            } else {
              console.warn('⚠️ Cannot set speaking state - participant not found in allParticipants!');
            }
            
            // Trigger change detection only on state change
            this.cdr.detectChanges();
          }
        } else {
          // Not currently speaking, but check if we should keep the indicator on
          // Add 400ms grace period for natural speech pauses (like "one... two")
          const timeSinceLastSpeak = currentTime - lastSpeakingTime;
          const shouldStillShowSpeaking = wasAlreadySpeaking && timeSinceLastSpeak < 400;
          
          if (wasAlreadySpeaking && !shouldStillShowSpeaking) {
            // Mark as not speaking after grace period
            this.participantSpeakingStates.set(uid, false);
            
            // Update participant in the list
            // For 'local' uid, find the local participant in the list
            const participant = uid === 'local'
              ? this.allParticipants.find(p => p.isLocal)
              : this.allParticipants.find(p => p.uid === uid);
            
            if (participant) {
              participant.isSpeaking = false;
              
              // Also update the dedicated local speaking flag for backward compatibility
              if (uid === 'local') {
                this.isLocalUserSpeaking = false;
              }
            }
            
            // Trigger change detection only on state change
            this.cdr.detectChanges();
          }
        }
        
        // Continue monitoring
        const frameId = requestAnimationFrame(updateLevel);
        this.audioMonitoringFrames.set(uid, frameId);
      };
      
      updateLevel();
      console.log('✅ Web Audio monitoring started for participant:', uid);
    } catch (error) {
      console.error('❌ Failed to start Web Audio monitoring for participant:', uid, error);
    }
  }

  // Stop Web Audio API monitoring for a participant
  private stopAudioMonitoringForParticipant(uid: any): void {
    // Cancel animation frame
    const frameId = this.audioMonitoringFrames.get(uid);
    if (frameId) {
      cancelAnimationFrame(frameId);
      this.audioMonitoringFrames.delete(uid);
    }
    
    // Close audio context
    const audioContext = this.audioContexts.get(uid);
    if (audioContext) {
      audioContext.close();
      this.audioContexts.delete(uid);
    }
    
    // Remove analyser
    this.analysers.delete(uid);
    
    // Reset audio level
    this.audioLevels.delete(uid);
    
    console.log('🛑 Web Audio monitoring stopped for participant:', uid);
  }

  // Stop all audio monitoring (cleanup on destroy)
  private stopAllAudioMonitoring(): void {
    console.log('🛑 Stopping all Web Audio monitoring...');
    const allUids = Array.from(this.audioContexts.keys());
    allUids.forEach(uid => this.stopAudioMonitoringForParticipant(uid));
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

      // Navigate to tabs after ending call
      console.log('🚪 VideoCall: Navigating to tabs after ending call');
      this.router.navigate(['/tabs']);
    } catch (error) {
      console.error('Error ending call:', error);
      // Even on error, try to cleanup media
      this.cleanupAllMediaElements();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Navigate to tabs after ending call (error case)
      console.log('🚪 VideoCall: Navigating to tabs after ending call (error case)');
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

  // ==================== AGORA WHITEBOARD METHODS ====================
  
  /**
   * Initialize Agora Fastboard whiteboard
   */
  async initializeWhiteboard() {
    if (this.fastboardApp || this.isWhiteboardLoading) {
      console.log('🎨 Whiteboard already initialized or loading');
      return;
    }

    this.isWhiteboardLoading = true;
    console.log('🎨 Initializing Agora Fastboard...');

    try {
      // First, try to get existing whiteboard room UUID from the lesson/class
      if (!this.whiteboardRoomUUID) {
        console.log('🎨 Checking if lesson/class has existing whiteboard room...');
        
        try {
          const lessonId = this.lessonId || this.classId;
          if (lessonId) {
            // Fetch the lesson/class to check for existing whiteboard room
            let lessonData: any;
            
            if (this.isClass && this.classId) {
              // Fetch class data
              const classResponse = await this.classService.getClass(this.classId).toPromise();
              lessonData = classResponse?.class;
            } else if (this.lessonId) {
              // Fetch lesson data
              const lessonResponse = await this.lessonService.getLesson(this.lessonId).toPromise();
              lessonData = lessonResponse?.lesson;
            }
            
            if (lessonData?.whiteboardRoomUUID) {
              console.log('✅ Found existing whiteboard room:', lessonData.whiteboardRoomUUID);
              this.whiteboardRoomUUID = lessonData.whiteboardRoomUUID;
              
              // Generate a new room token for this user
              const tokenResponse = await this.whiteboardService.getRoomToken(
                this.whiteboardRoomUUID,
                'writer'
              ).toPromise();
              
              if (tokenResponse?.success) {
                this.whiteboardRoomToken = tokenResponse.roomToken;
                console.log('✅ Got room token for existing room');
              }
            }
          }
        } catch (error) {
          console.warn('⚠️ Could not fetch existing whiteboard room:', error);
        }
      }

      // Create whiteboard room if we still don't have one
      if (!this.whiteboardRoomUUID) {
        console.log('🎨 Creating new whiteboard room...');
        const roomResponse = await this.whiteboardService.createRoom().toPromise();
        
        if (roomResponse?.success) {
          this.whiteboardRoomUUID = roomResponse.roomUUID;
          this.whiteboardRoomToken = roomResponse.roomToken;
          console.log('✅ Whiteboard room created:', this.whiteboardRoomUUID);
          
          // Save the whiteboard room UUID to the lesson/class
          const lessonId = this.lessonId || this.classId;
          if (lessonId) {
            try {
              const updateData = {
                whiteboardRoomUUID: this.whiteboardRoomUUID,
                whiteboardCreatedAt: new Date()
              };
              
              if (this.isClass && this.classId) {
                // Update class
                await this.classService.updateClass(this.classId, updateData).toPromise();
                console.log('✅ Saved whiteboard room UUID to class');
              } else if (this.lessonId) {
                // Update lesson
                await this.lessonService.updateLesson(this.lessonId, updateData).toPromise();
                console.log('✅ Saved whiteboard room UUID to lesson');
              }
            } catch (error) {
              console.error('❌ Failed to save whiteboard room UUID:', error);
            }
          }
        } else {
          throw new Error('Failed to create whiteboard room');
        }
      }

      // Wait for container to be available
      if (!this.whiteboardContainerRef?.nativeElement) {
        console.log('⏳ Waiting for whiteboard container...');
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const container = this.whiteboardContainerRef?.nativeElement;
      if (!container) {
        throw new Error('Whiteboard container not found');
      }

      // Initialize Agora Fastboard
      console.log('🎨 Creating Fastboard instance...');
      this.fastboardApp = await createFastboard({
        sdkConfig: {
          appIdentifier: environment.agoraWhiteboard.appId,
          region: environment.agoraWhiteboard.region,
        },
        joinRoom: {
          uuid: this.whiteboardRoomUUID,
          roomToken: this.whiteboardRoomToken,
          uid: this.currentUserId,
          userPayload: {
            nickName: this.myName || 'User',
          }
        }
        // DO NOT pass managerConfig - let mount() handle it
      });

      // Mount the UI - this will create both the canvas AND the toolbar
      const ui = mount(this.fastboardApp, container);
      
      console.log('✅ Agora Fastboard mounted with full UI', ui);
      
      // Optional: Listen for whiteboard events
      this.fastboardApp.manager.emitter.on('ready', () => {
        console.log('🎨 Whiteboard ready with full toolbar');
      });

    } catch (error) {
      console.error('❌ Failed to initialize whiteboard:', error);
      
      // Show error toast
      const toast = await this.toastController.create({
        message: 'Failed to load whiteboard. Please try again.',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
      
      // Fall back to hiding whiteboard
      this.showWhiteboard = false;
    } finally {
      this.isWhiteboardLoading = false;
    }
  }

  /**
   * Cleanup whiteboard resources
   */
  async destroyWhiteboard() {
    if (this.fastboardApp) {
      console.log('🧹 Destroying Agora Fastboard...');
      try {
        await this.fastboardApp.destroy();
        this.fastboardApp = null;
        console.log('✅ Whiteboard destroyed');
      } catch (error) {
        console.error('❌ Error destroying whiteboard:', error);
      }
    }
  }

  async ngOnDestroy() {
    console.log('🚪 VideoCall: ngOnDestroy called');
    
    // Stop office hours timer
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    
    // Clean up drawing batch timeout
    if (this.batchInterval) {
      clearTimeout(this.batchInterval);
      this.batchInterval = null;
    }
    
    // Clean up cursor cleanup interval
    if (this.cursorCleanupInterval) {
      clearInterval(this.cursorCleanupInterval);
      this.cursorCleanupInterval = null;
    }
    
    // Stop all Web Audio monitoring
    this.stopAllAudioMonitoring();
    
    // Clean up cursor broadcasting
    if (this.cursorCleanupInterval) {
      clearInterval(this.cursorCleanupInterval);
      this.cursorCleanupInterval = null;
    }
    this.remoteCursors.clear();
    
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

    // Cleanup whiteboard
    await this.destroyWhiteboard();

    // Remove beforeunload listener
    window.removeEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    
    // Stop next event checking
    if (this.nextEventCheckInterval) {
      clearInterval(this.nextEventCheckInterval);
    }
  }

  /**
   * Start checking for upcoming events (tutors only)
   */
  private startNextEventCheck() {
    console.log('📅 Starting next event check for tutor');
    
    // Check immediately
    this.checkForNextEvent();
    
    // Check every 30 seconds for more accurate countdown
    this.nextEventCheckInterval = setInterval(() => {
      this.checkForNextEvent();
    }, 30000);
  }

  /**
   * Check if tutor has an upcoming event within 10 minutes
   */
  private async checkForNextEvent() {
    try {
      // Get all upcoming lessons for this tutor
      const response = await firstValueFrom(this.lessonService.getMyLessons());
      
      if (!response.success || !response.lessons) {
        return;
      }

      const now = new Date();
      const WARNING_THRESHOLD = 10 * 60 * 1000; // 10 minutes in milliseconds
      
      // Filter for scheduled lessons that start soon OR have already started (excluding current lesson)
      // Keep showing warning for lessons that have started but tutor is still in current call
      const relevantLessons = response.lessons
        .filter(lesson => {
          if (lesson._id === this.lessonId) return false; // Skip current lesson
          if (lesson.status !== 'scheduled') return false;
          
          const startTime = new Date(lesson.startTime);
          const timeUntilStart = startTime.getTime() - now.getTime();
          
          // Show warning if lesson is within 10 minutes OR has already started (negative time)
          return timeUntilStart <= WARNING_THRESHOLD;
        })
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      if (relevantLessons.length > 0) {
        const nextLesson = relevantLessons[0];
        const startTime = new Date(nextLesson.startTime);
        const minutesUntil = Math.round((startTime.getTime() - now.getTime()) / (60 * 1000));
        
        this.nextEventMinutesAway = minutesUntil;
        this.nextEventType = nextLesson.isClass ? 'class' : 'lesson';
        this.showNextEventWarning = true;
        
        if (minutesUntil <= 0) {
          console.log(`🚨 ${this.nextEventType} should have started ${Math.abs(minutesUntil)} minutes ago!`);
        } else {
          console.log(`⚠️ Next ${this.nextEventType} in ${minutesUntil} minutes`);
        }
      } else {
        this.showNextEventWarning = false;
      }
    } catch (error) {
      console.error('Error checking for next event:', error);
    }
  }

  /**
   * Get formatted display time for next event warning
   * Shows minutes only, with special handling for urgent cases
   */
  getNextEventDisplayTime(): string {
    if (this.nextEventMinutesAway <= 0) {
      return 'NOW!';
    } else if (this.nextEventMinutesAway === 1) {
      return '1 minute';
    } else {
      return `${this.nextEventMinutesAway} minutes`;
    }
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

  async handleLessonCancellation(cancellation: {
    lessonId: string;
    cancelledBy: 'tutor' | 'student';
    cancellerName: string;
    reason: string;
  }) {
    console.log('🚫 Handling lesson cancellation in video-call:', cancellation);

    // End the call immediately
    try {
      await this.agoraService.leaveChannel();
    } catch (error) {
      console.error('Error leaving channel during cancellation:', error);
    }

    // Show alert to user
    const alert = await this.alertController.create({
      header: 'Session Ended',
      message: cancellation.cancelledBy === 'tutor' 
        ? `Something came up for this tutor and they had to leave. Don't worry—you haven't been charged! Try finding another available tutor in the search.`
        : this.userRole === 'tutor' 
          ? `The student didn't enter the classroom in time, so the session was cancelled to avoid wasting your time.`
          : `The student has left the session.`,
      buttons: [
        {
          text: this.userRole === 'tutor' ? 'Back to Waiting Room' : 'Find Tutors',
          handler: () => {
            if (this.userRole === 'tutor') {
              // Tutor: Return to pre-call waiting room with office hours enabled
              this.router.navigate(['/pre-call'], {
                queryParams: {
                  role: 'tutor',
                  officeHours: 'true'
                }
              });
            } else {
              // Student: Navigate to tutor search
              // Clear any stale data to force refresh in tutor search
              localStorage.removeItem('returnToTutorId');
              localStorage.removeItem('tutorSearchHasLoadedOnce');
              localStorage.setItem('forceRefreshTutors', 'true');
              
              this.router.navigate(['/tabs/tutor-search']);
            }
          }
        }
      ],
      backdropDismiss: false
    });

    await alert.present();
  }

  /**
   * Check if both participants are in call, then start synchronized timer
   */
  private async checkAndStartOfficeHoursTimer() {
    if (this.timerInterval) {
      console.log('⏱️ Timer already running, skipping');
      return;
    }
    
    // Check if remote user is connected
    const hasRemoteUser = this.remoteUserCount > 0;
    console.log('⏱️ Checking office hours timer conditions:', {
      hasRemoteUser,
      remoteUserCount: this.remoteUserCount,
      lessonId: this.lessonId
    });
    
    if (hasRemoteUser && this.lessonId) {
      console.log('⏱️ Both participants present, fetching server start time...');
      
      // Fetch the actual call start time from server
      try {
        const billingResponse = await firstValueFrom(
          this.lessonService.getBillingSummary(this.lessonId)
        );
        
        if (billingResponse?.success && billingResponse.billing?.callStartTime) {
          const serverStartTime = new Date(billingResponse.billing.callStartTime);
          console.log('⏱️ Server call start time:', serverStartTime);
          
          // Calculate elapsed time from server timestamp
          const now = new Date();
          const elapsedMs = now.getTime() - serverStartTime.getTime();
          const elapsedSec = Math.floor(elapsedMs / 1000);
          
          console.log('⏱️ Starting timer from server time:', {
            serverStartTime,
            elapsedSeconds: elapsedSec
          });
          
          this.startOfficeHoursTimer(serverStartTime, elapsedSec);
        } else {
          console.log('⏱️ No server start time yet, will retry when remote user joins');
        }
      } catch (error) {
        console.error('⏱️ Error fetching billing summary:', error);
      }
    } else {
      console.log('⏱️ Waiting for both participants to join before starting timer');
      // Timer will be started when remote user joins (see user-published handler)
    }
  }
  
  /**
   * Start office hours timer - tracks elapsed time and calculates cost
   */
  private startOfficeHoursTimer(startTime?: Date, initialElapsedSeconds: number = 0) {
    if (this.timerInterval) {
      console.log('⏱️ Timer already running');
      return;
    }
    
    this.callStartTime = startTime || new Date();
    this.elapsedSeconds = initialElapsedSeconds;
    this.elapsedMinutes = Math.ceil(this.elapsedSeconds / 60);
    this.currentCost = Math.round(this.perMinuteRate * this.elapsedMinutes * 100) / 100;
    this.showOverageWarning = false;
    
    console.log('⏱️ Starting office hours timer:', {
      startTime: this.callStartTime,
      initialElapsedSeconds: this.elapsedSeconds,
      bookedDuration: this.bookedDuration,
      perMinuteRate: this.perMinuteRate
    });
    
    // Update timer every second
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds++;
      this.elapsedMinutes = Math.ceil(this.elapsedSeconds / 60);
      
      // Don't show negative values during grace period
      if (this.elapsedSeconds < 0) {
        this.elapsedSeconds = 0;
        this.elapsedMinutes = 0;
      }
      
      // Calculate current cost (only if time has actually started)
      if (this.elapsedSeconds >= 0) {
        this.currentCost = Math.round(this.perMinuteRate * this.elapsedMinutes * 100) / 100;
      } else {
        this.currentCost = 0;
      }
      
      // Check if we're 1 minute away from booked duration
      if (this.elapsedSeconds > 0) {
        const secondsUntilBookedEnd = (this.bookedDuration * 60) - this.elapsedSeconds;
        if (secondsUntilBookedEnd === 60 && !this.showOverageWarning) {
          this.showBookedTimeEndingWarning();
        }
      }
      
      // Force change detection to update UI
      this.cdr.detectChanges();
    }, 1000);
  }
  
  /**
   * Show warning when booked time is about to expire
   */
  private async showBookedTimeEndingWarning() {
    // Only show warning to students (they're the ones being charged)
    if (this.userRole !== 'student') {
      return;
    }
    
    this.showOverageWarning = true;
    
    const alert = await this.alertController.create({
      header: 'Time Warning',
      message: `Your booked ${this.bookedDuration} minutes is ending soon. You'll be charged $${this.perMinuteRate.toFixed(2)}/minute if you continue.`,
      buttons: ['OK']
    });
    
    await alert.present();
    console.log('⚠️ Showed booked time ending warning to student');
  }
  
  /**
   * Get formatted elapsed time string (MM:SS)
   */
  getFormattedElapsedTime(): string {
    // During grace period, show 0:00
    if (this.elapsedSeconds < 0) {
      return '0:00';
    }
    
    const minutes = Math.floor(this.elapsedSeconds / 60);
    const seconds = this.elapsedSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  
  /**
   * Check if session is in overage (past booked duration)
   */
  isInOverage(): boolean {
    return this.elapsedMinutes > this.bookedDuration;
  }
}
