import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, OnDestroy, ChangeDetectorRef, HostListener, NgZone } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AgoraService } from '../services/agora.service';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular';
import { UserService } from '../services/user.service';
import { LessonService } from '../services/lesson.service';
import { ClassService } from '../services/class.service';
import { MessagingService, Message } from '../services/messaging.service';
import { WebSocketService } from '../services/websocket.service';
import { AuthService } from '../services/auth.service';
import { EarlyExitService } from '../services/early-exit.service';
import { ReminderService } from '../services/reminder.service';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { takeUntil, take } from 'rxjs/operators';
import { WhiteboardService } from '../services/whiteboard.service';
import { TranscriptionService } from '../services/transcription.service';
import { DeepgramAudioService } from '../services/deepgram-audio.service';
import { LessonSummaryComponent } from '../modals/lesson-summary/lesson-summary.component';
import { createFastboard, FastboardApp, mount } from '@netless/fastboard';
import { VocabularyService, VocabEntry, GoalEntry } from '../services/vocabulary.service';
import { environment } from '../../environments/environment';
import { formatTimeInTz } from '../shared/timezone.utils';
import { TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../services/language.service';

@Component({
  selector: 'app-video-call',
  templateUrl: './video-call.page.html',
  styleUrls: ['./video-call.page.scss'],
  standalone: false,
})
export class VideoCallPage implements OnInit, AfterViewInit, OnDestroy {

  private initializationComplete = false;
  private hasEndedCall = false; // Tracks whether endCall() already ran to prevent double cleanup in ngOnDestroy

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
  showNotes = false;
  
  // Notes form properties (for tutors during lesson)
  lessonNoteText: string = '';
  lessonQuickImpression: string = '';
  lessonHomework: string = '';
  lessonSelectedStrengths: string[] = [];
  lessonSelectedAreasToImprove: string[] = [];
  lessonSelectedErrorAreas: string[] = [];
  savingNotes = false;
  notesLastSaved: Date | null = null;
  private notesAutoSaveInterval: any = null;
  
  // Vocabulary panel properties (shared between tutor and student)
  showVocabulary = false;
  vocabularyItems: Array<{ word: string; translation: string; example: string; addedBy: string; id: string }> = [];
  newVocabWord = '';
  newVocabTranslation = '';
  newVocabExample = '';
  isAddingVocab = false;
  vocabLastSaved: Date | null = null;
  private vocabAutoSaveInterval: any = null;
  private vocabSaving = false;
  
  // Lesson goals/agenda (optional, shared between tutor and student)
  showGoals = false;
  goalItems: Array<{ text: string; completed: boolean; addedBy: string; id: string }> = [];
  newGoalText = '';
  isAddingGoal = false;
  
  // Correction input mode (for tutors in chat)
  showCorrectionInput = false;
  correctionOriginal = '';
  correctionFixed = '';
  
  // Resources/Documents section in chat
  showResourcesSection = false;
  
  // Options for notes form (labels filled from i18n in applyVideoCallI18n)
  impressionOptions: Array<{ value: string; label: string; color: string }> = [];
  strengthOptions: string[] = [];
  improvementOptions: string[] = [];
  errorAreaOptions: string[] = [];
  
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
  
  // Pre-computed properties for template binding (avoid function calls in templates)
  isRemoteUserMuted = false;
  isRemoteUserVideoOff = false;
  remoteParticipantLabel = '';
  
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
  
  // Snapshot of student's AI analysis setting, locked at lesson start.
  // Mid-lesson changes do NOT affect the current lesson — only the next one.
  aiAnalysisEnabledAtTime: boolean | null = null;

  // Student lesson intent (shown to tutor)
  studentLessonIntent: string | null = null;
  showIntentBanner = false;
  intentDisplay: Record<string, { emoji: string; label: string; hint: string }> = {};
  intentBannerLabelKey = '';
  intentBannerHintKey = '';
  nextLessonStartsText = '';
  replyingToYourselfLabel = '';
  recordingDurationLabel = '';
  
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
  showMoreMenu = false;

  // AI Transcription & Analysis properties
  private isTranscriptionEnabled = false;
  private lessonLanguage = 'en'; // Will be set from lesson data
  private TRANSCRIPTION_SESSION_KEY = 'activeTranscriptionSession';
  private currentTranscriptId: string = '';
  
  // Pre-emptive analysis: stop transcription 1 min before lesson end so analysis is ready
  private preEmptiveAnalysisTimer: any = null;
  private transcriptionCompletedEarly = false; // True if transcription was completed pre-emptively
  private isCompletingTranscription = false;    // Mutex: prevents concurrent transcription completion
  
  // End-call responsiveness
  isEndingCall = false; // Drives the "Leaving..." overlay in the template
  
  // OpenAI Audio recording for transcription
  private transcriptionRecorder: MediaRecorder | null = null;
  private transcriptionAudioChunks: Blob[] = [];
  private transcriptionUploadInterval: any = null;
  
  // Window-based audio sampling (record 3x5min windows instead of continuous)
  private samplingWindows: { startMin: number; endMin: number }[] = [];
  private samplingCheckInterval: any = null;
  private lessonStartTimestamp: number = 0;
  private isCurrentlyRecording = false;
  private batchAudioBlobs: Blob[] = []; // All recorded audio stored for batch upload
  private transcriptionStream: MediaStream | null = null;
  private transcriptionMimeType: string = 'audio/webm';

  // Tutor reference capture (Agora remote audio track) — used for VAD-only
  // mic-bleed filtering on the backend. Mirrors the student sampling-window
  // lifecycle so both streams stay aligned in batch-time.
  private tutorReferenceRecorder: MediaRecorder | null = null;
  private tutorReferenceAudioChunks: Blob[] = [];
  private batchTutorReferenceBlobs: Blob[] = [];
  private tutorReferenceStream: MediaStream | null = null;
  private tutorReferenceMimeType: string = 'audio/webm';
  private isCurrentlyRecordingTutorRef = false;
  
  // Deepgram real-time transcription
  private deepgramService: DeepgramAudioService | null = null;
  private deepgramSubscriptions: Subscription[] = [];

  // Chat properties
  chatMessages: Message[] = [];
  messages: Message[] = [];  // Alias for compatibility
  newMessage = '';
  isSending = false;
  isLoadingMessages = false;
  currentUserId: string = '';
  currentUser: any = null;
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

  // Real-time talk time tracking
  private speakingTimeAccumulator: Map<any, number> = new Map(); // uid → total seconds
  private speakingStartTime: Map<any, number> = new Map(); // uid → timestamp when current speaking started
  showTalkTimePopup: boolean = false;
  private talkTimePopupShown: boolean = false; // prevent showing twice
  private talkTimeCheckInterval: any = null;
  talkTimePopupDismissed: boolean = false; // user dismissed the popup
  private talkTimeAutoHideTimer: any = null; // auto-hide after 10 seconds
  private scheduledLessonStartTime: number = 0; // Scheduled start time timestamp — talk time only tracked after this
  isWaitingForLessonStart: boolean = false; // True if user joined early, before scheduled start
  // Pre-calculated display properties (no functions in template)
  localSpeakingPercent: number = 0;
  remoteSpeakingPercent: number = 0;
  localSpeakingPercentFormatted: string = '0%';
  remoteSpeakingPercentFormatted: string = '0%';
  localSpeakerName: string = 'You';
  remoteSpeakerName: string = 'Participant';
  // Synced remote speaking time — received from the other participant's self-measurement
  private syncedRemoteSpeakingSeconds: number = 0;

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
    private toastController: ToastController,
    private transcriptionService: TranscriptionService,
    private deepgramAudioService: DeepgramAudioService,
    private earlyExitService: EarlyExitService,
    private ngZone: NgZone,
    private reminderService: ReminderService,
    private vocabularyService: VocabularyService,
    private translate: TranslateService,
    private languageService: LanguageService
  ) { }

  async ngOnInit() {
    this.languageService.whenTranslationsReady().pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.applyVideoCallI18n();
    });
    this.translate.onLangChange.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.applyVideoCallI18n();
    });

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
    
    // Receive remote participant's self-reported speaking time for synchronized display
    this.agoraService.onRemoteTalkTimeUpdate = (speakingSeconds: number) => {
      this.syncedRemoteSpeakingSeconds = speakingSeconds;
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
        profilePicture: identity.profilePicture || ''
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
    
    // Listen for early exit confirmation to stop transcription
    this.earlyExitService.lessonEndedEarly$.subscribe(async (lessonId) => {
      console.log('🛑 VIDEO-CALL: Received lesson ended early notification for:', lessonId);
      if (lessonId === this.lessonId) {
        console.log('🛑 VIDEO-CALL: Stopping transcription for current lesson');
        await this.stopTranscriptionImmediately();
      }
    });

    // Store query params for later use in ngAfterViewInit
    this.queryParams = qp;
    
    // Store lessonId if available
    if (qp?.lessonId) {
      this.lessonId = qp.lessonId;
      console.log('📚 VideoCall: Stored lessonId:', this.lessonId);
      
      // Suppress the lesson reminder for this lesson while we're in the call
      this.reminderService.suppressForLesson(this.lessonId!);
      
      // Check for existing transcription session and auto-resume if valid
      await this.checkAndResumeTranscription();
    }
    
    // Store classId if available
    if (qp?.classId) {
      this.classId = qp.classId;
      console.log('🎓 VideoCall: Stored classId:', this.classId);
    }

    // Set up WebSocket for messaging
    this.setupMessaging();
    
    // Note: next event check for tutors is started after role is determined
    // in initializeVideoCallViaLessonParams (from lesson data, not URL params)
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
      message: this.t('VIDEO_CALL.JOINING_LESSON'),
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Browser support
      if (!this.agoraService.isBrowserSupported()) {
        throw new Error(this.t('VIDEO_CALL.ERROR_BROWSER_UNSUPPORTED'));
      }

      // Permissions
      loading.message = this.t('VIDEO_CALL.REQUESTING_CAMERA_ACCESS');
      const permissionsGranted = await this.agoraService.requestPermissions();
      if (!permissionsGranted) {
        throw new Error(this.t('VIDEO_CALL.ERROR_PERMISSIONS_REQUIRED'));
      }

      // CRITICAL: Always start with a completely fresh Agora client.
      // Pre-call creates a client + tracks for virtual background preview, but reusing that
      // client can cause subtle issues where remote users aren't detected on rejoin.
      // Resetting guarantees the same clean state as a page refresh (which always works).
      loading.message = this.t('VIDEO_CALL.CONNECTING_TO_CALL');
      await this.agoraService.resetForVideoCall();
      await this.agoraService.initializeClient();

      // SECURITY: Get identity from authenticated user (never trust URL params for identity/role)
      const me = await firstValueFrom(this.userService.getCurrentUser());
      this.currentUser = me ?? null;
      this.currentUserId = me?.id || ''; // Store current user's MongoDB ID
      this.myAgoraUid = me?.id || ''; // Use MongoDB ID as Agora UID
      this.myName = (me as any)?.firstName || me?.name?.split(' ')[0] || 'User';
      const myUserId = me?.id || '';
      
      // Role will be determined from lesson data below (not from URL)
      // Default to 'student' — will be corrected after lesson data loads
      let role: 'tutor' | 'student' = 'student';
      
      console.log('🔐 ===== MY IDENTITY FROM AUTH =====');
      console.log('🔐 Name:', this.myName);
      console.log('🔐 Database ID:', myUserId);
      console.log('🔐 Agora UID:', this.myAgoraUid);
      console.log('🔐 Initial role (will be confirmed from lesson data):', role);
      console.log('🔐 ===================================');

      // Load lesson/class data to get participant names and IDs
      if (qp.lessonId) {
        try {
          console.log('🎓 VIDEO-CALL: Loading session details', { 
            sessionId: qp.lessonId, 
            role: this.userRole,
            isClass: this.isClass
          });
          
          // Use class service for classes, lesson service for lessons
          let sessionResponse: any;
          let session: any;
          
          if (this.isClass) {
            sessionResponse = await firstValueFrom(this.classService.getClass(qp.lessonId));
            session = sessionResponse?.class;
            console.log('🎓 VIDEO-CALL: Class API Response:', sessionResponse);
          } else {
            sessionResponse = await firstValueFrom(this.lessonService.getLesson(qp.lessonId));
            session = sessionResponse?.lesson;
            console.log('🎓 VIDEO-CALL: Lesson API Response:', sessionResponse);
          }
          
          console.log('🎓 VIDEO-CALL: Response check:', {
            hasResponse: !!sessionResponse,
            hasSuccess: !!sessionResponse?.success,
            hasSession: !!session,
            isClass: this.isClass
          });
          
          if (sessionResponse?.success && session) {
            const lesson = session; // Keep variable name for compatibility with existing code
            
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
            
            // Set bookedDuration for standard lessons (needed for audio sampling windows)
            if (!this.isOfficeHours && lesson.duration) {
              this.bookedDuration = lesson.duration;
              console.log(`📊 Standard lesson duration set: ${this.bookedDuration} minutes`);
            }
            
            // Store scheduled lesson start time for talk time gating
            // Talk time is only tracked after the lesson officially starts
            if (lesson.startTime) {
              this.scheduledLessonStartTime = new Date(lesson.startTime).getTime();
              console.log(`⏰ Scheduled lesson start time: ${new Date(this.scheduledLessonStartTime).toLocaleTimeString()}`);
            }
            
            // Store tutor and student user IDs for proper role identification
            this.tutorUserId = lesson.tutorId?._id || '';
            this.studentUserId = lesson.studentId?._id || '';
            
            // SECURITY: Determine role from authenticated user + lesson data (never trust URL)
            // Primary: Compare MongoDB _id (always available from populated lesson data)
            const tutorMongoId = lesson.tutorId?._id?.toString() || '';
            const studentMongoId = lesson.studentId?._id?.toString() || '';
            const myMongoId = (me?.id || '').toString();
            
            if (myMongoId && myMongoId === tutorMongoId) {
              role = 'tutor';
            } else if (myMongoId && myMongoId === studentMongoId) {
              role = 'student';
            } else {
              // Fallback: Compare auth0Id if available
              const tutorAuth0Id = (lesson.tutorId as any)?.auth0Id;
              const studentAuth0Id = (lesson.studentId as any)?.auth0Id;
              const myAuth0Id = (me as any)?.auth0Id;
              
              if (myAuth0Id && myAuth0Id === tutorAuth0Id) {
                role = 'tutor';
              } else if (myAuth0Id && myAuth0Id === studentAuth0Id) {
                role = 'student';
              }
              // else keep default 'student'
            }
            
            this.userRole = role;
            console.log('🔐 Role determined from lesson data:', {
              role: this.userRole,
              myMongoId,
              tutorMongoId,
              studentMongoId
            });
            
            // Store profile pictures
            this.tutorProfilePicture = (lesson.tutorId as any)?.profilePicture || lesson.tutorId?.picture || '';
            
            // For classes, studentId doesn't exist - use confirmedStudents or current user's picture
            if (this.isClass) {
              // For classes, get the current user's picture from authenticated user
              // This ensures the student has their own picture for broadcasting
              const myPicture = (me as any)?.picture || '';
              this.studentProfilePicture = myPicture;
              
              console.log('🖼️ CLASS: Using current user picture for student:', myPicture);
            } else {
              // For 1:1 lessons, use the studentId from the lesson
              this.studentProfilePicture = (lesson.studentId as any)?.profilePicture || lesson.studentId?.picture || '';
            }
            
            // Store my own profile picture based on role
            if (this.userRole === 'tutor') {
              this.myProfilePicture = this.tutorProfilePicture;
            } else {
              // For students: use current user's picture directly (works for both lessons and classes)
              this.myProfilePicture = (me as any)?.picture || this.studentProfilePicture || '';
            }
            
            if (lesson.studentLessonIntent && this.userRole === 'tutor') {
              this.studentLessonIntent = lesson.studentLessonIntent;
              this.refreshIntentBannerKeys();
              this.showIntentBanner = true;
            }

            console.log('🎓 VIDEO-CALL: Session loaded', {
              sessionId: lesson._id,
              isClass: this.isClass,
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
              confirmedStudents: this.isClass ? lesson.confirmedStudents : 'N/A (lesson)',
              tutorHasPicture: !!lesson.tutorId?.picture,
              studentHasPicture: !this.isClass && !!lesson.studentId?.picture,
              tutorHasProfilePicture: !!(lesson.tutorId as any)?.profilePicture,
              studentHasProfilePicture: !this.isClass && !!(lesson.studentId as any)?.profilePicture,
              myPictureFromUser: (me as any)?.picture
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
            console.error(`❌ VIDEO-CALL: Invalid ${this.isClass ? 'class' : 'lesson'} response format:`, {
              sessionResponse,
              hasSuccess: !!sessionResponse?.success,
              hasSession: !!session
            });
          }
        } catch (error) {
          console.error(`❌ VIDEO-CALL: Error loading ${this.isClass ? 'class' : 'lesson'} data:`, error);
          // Fallback to default labels
          this.tutorName = 'Tutor';
          this.studentName = 'Student';
        }
      }

      // Now that role is determined from lesson data, set up identity
      const iAmTutor = this.userRole === 'tutor';
      this.participantRegistry.set(this.myAgoraUid, {
        userId: myUserId,
        name: this.myName,
        isTutor: iAmTutor,
        agoraUid: this.myAgoraUid,
        profilePicture: this.myProfilePicture
      });
      
      // Start checking for next event warnings (tutors only)
      if (this.userRole === 'tutor') {
        this.startNextEventCheck();
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
          videoEnabled,
          isClass: this.isClass
        });
        
        // Update channel name from the join response
        if (joinResponse.agora.channelName) {
          this.channelName = joinResponse.agora.channelName;
        }
        
        // Store the AI analysis snapshot (locked at lesson start, immutable for this lesson)
        if (joinResponse.lesson?.aiAnalysisEnabledAtTime !== undefined) {
          this.aiAnalysisEnabledAtTime = joinResponse.lesson.aiAnalysisEnabledAtTime ?? null;
          console.log('📸 AI analysis snapshot from join response:', this.aiAnalysisEnabledAtTime);
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
        
        // Start periodic state re-broadcasting to ensure remote users stay in sync
        this.agoraService.startStateRebroadcast();
        
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
      
      // ⏱️ CRITICAL: Record call start time in database
      // This is essential for billing, transcription, and analytics
      if (this.lessonId) {
        try {
          console.log('⏱️ Recording call start time for lesson:', this.lessonId);
          const callStartResponse = await firstValueFrom(
            this.lessonService.recordCallStart(this.lessonId)
          );
          console.log('✅ Call start recorded:', callStartResponse);
        } catch (error) {
          console.error('❌ Failed to record call start (non-fatal):', error);
          // Don't block the call if this fails
        }
      }
      
      // Start AI transcription for scheduled lessons (students only)
      console.log('🔵 About to call startLessonTranscription() [VIA LESSON PARAMS]...');
      await this.startLessonTranscription();
      console.log('🔵 Finished calling startLessonTranscription() [VIA LESSON PARAMS]');
      
      // Start real-time talk time tracking & popup (both tutor and student see this)
      this.startTalkTimeTracking();
      
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
      await this.showError(this.mapVideoCallConnectError(error));
    } finally {
      await loading.dismiss();
    }
  }

  async initializeVideoCall() {
    const loading = await this.loadingController.create({
      message: this.t('VIDEO_CALL.REQUESTING_PERMISSIONS'),
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Check browser support first
      if (!this.agoraService.isBrowserSupported()) {
        throw new Error(this.t('VIDEO_CALL.ERROR_BROWSER_UNSUPPORTED'));
      }

      // First, request permissions
      loading.message = this.t('VIDEO_CALL.REQUESTING_CAMERA_ACCESS');
      const permissionsGranted = await this.agoraService.requestPermissions();

      if (!permissionsGranted) {
        throw new Error(this.t('VIDEO_CALL.ERROR_PERMISSIONS_REQUIRED'));
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
        loading.message = this.t('VIDEO_CALL.CONNECTING_TO_CALL');
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

      // ⏱️ CRITICAL: Record call start time in database
      // This is essential for billing, transcription, and analytics
      if (this.lessonId) {
        try {
          console.log('⏱️ Recording call start time for lesson:', this.lessonId);
          const callStartResponse = await firstValueFrom(
            this.lessonService.recordCallStart(this.lessonId)
          );
          console.log('✅ Call start recorded:', callStartResponse);
        } catch (error) {
          console.error('❌ Failed to record call start (non-fatal):', error);
          // Don't block the call if this fails
        }
      }

      // Start AI transcription for scheduled lessons (students only)
      console.log('🔵 About to call startLessonTranscription()...');
      await this.startLessonTranscription();
      console.log('🔵 Finished calling startLessonTranscription()');

      // Start real-time talk time tracking & popup timer
      this.startTalkTimeTracking();

      console.log('Successfully connected to video call');

    } catch (error: any) {
      console.error('Error initializing video call:', error);

      await this.showError(this.mapVideoCallConnectError(error));
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

  private remoteUserMonitorInterval: any = null;
  private joinSoundEnabled: boolean = false; // Prevent sound during initial join

  private monitorRemoteUsers() {
    // Prevent multiple intervals from being created
    if (this.remoteUserMonitorInterval) {
      console.log('⚠️ Remote user monitoring already active, skipping duplicate setup');
      return;
    }
    
    console.log('👀 Starting remote user monitoring...');
    
    // Enable join sound after 2 seconds (after initial connection stabilizes)
    setTimeout(() => {
      this.joinSoundEnabled = true;
      console.log('🔔 Join sound notifications enabled');
    }, 2000);
    
    // Check for remote users periodically
    this.remoteUserMonitorInterval = setInterval(() => {
      const remoteUsers = this.agoraService.getRemoteUsers();
      const previousCount = this.remoteUserCount;
      this.remoteUserCount = remoteUsers.size;
      
      // Keep template-bound remote user properties in sync
      this.updateRemoteUserProperties();

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

          if (this.userRole === 'tutor' && !this.studentLessonIntent) {
            this.lessonService.getLesson(this.lessonId).subscribe(res => {
              if (res?.lesson?.studentLessonIntent && !this.studentLessonIntent) {
                this.studentLessonIntent = res.lesson.studentLessonIntent;
                this.refreshIntentBannerKeys();
                this.showIntentBanner = true;
                this.cdr.detectChanges();
              }
            });
          }

          // Play join sound notification - but ONLY if:
          // 1. There's actually a remote user (remoteUserCount > 0)
          // 2. We're past the initial join phase (joinSoundEnabled = true)
          if (this.remoteUserCount > 0 && this.joinSoundEnabled) {
            console.log('🔔 [VIDEO-CALL] Playing join sound for new participant (count:', this.remoteUserCount, ')');
            this.playJoinSound();
          } else if (!this.joinSoundEnabled) {
            console.log('ℹ️ [VIDEO-CALL] Skipping join sound (still in initial connection phase)');
          } else {
            console.log('ℹ️ [VIDEO-CALL] Skipping join sound (no remote users yet)');
          }
          
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
      
      // Force change detection to update DOM (show/hide overlay, toggle .hidden class)
      this.cdr.detectChanges();
      
      // Update participants list for classes to reflect new video state
      if (this.isClass) {
        this.updateParticipantsList();
      }
      
      // NOTE: We intentionally do NOT clear innerHTML or re-call setupLocalVideoDisplay() here.
      // setMuted(true/false) in agoraService.toggleVideo() pauses/resumes the Agora
      // video track while keeping the <video> element alive. The CSS .hidden class
      // (opacity:0) hides the container and the avatar overlay covers it visually.
      // This avoids the flash caused by destroying and re-creating the video element,
      // which is especially visible with virtual background (processor pipeline restart).
      
      if (!this.isVideoOff) {
        console.log('📹 Video turned ON — track resumed via setMuted(false), no re-play needed');
        
        // Edge case: if the video element was never set up (e.g. joined with camera off),
        // we need to play the track for the first time
        const localVideoTrack = this.agoraService.getLocalVideoTrack();
        const localVideoElement = this.isClass
          ? document.querySelector('[data-participant-uid="local"] .participant-video') as HTMLElement
          : this.localVideoRef?.nativeElement;
        
        if (localVideoTrack && localVideoElement && !localVideoElement.querySelector('video, div[id]')) {
          console.log('📹 No video child found — first-time play needed');
          setTimeout(() => {
            localVideoTrack.play(localVideoElement!, { mirror: false });
            console.log('✅ First-time local video play complete');
          }, 100);
        }
      } else {
        console.log('🚫 Video turned OFF — track muted via setMuted(true), element kept alive');
      }
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
    // if (this.showWhiteboard) {
    //   const toast = await this.toastController.create({
    //     message: '🎨 Whiteboard opened - both users can collaborate in real-time! You can see each other\'s cursors.',
    //     duration: 4000,
    //     color: 'success',
    //     position: 'top',
    //     cssClass: 'whiteboard-toast'
    //   });
    //   await toast.present();
    // }
    
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

  // Notes panel for tutors to write notes during lesson
  toggleNotes() {
    this.showNotes = !this.showNotes;
    
    if (this.showNotes && this.userRole === 'tutor') {
      // Start auto-save when notes panel opens
      this.startNotesAutoSave();
      // Load any existing notes
      this.loadLessonNotes();
    } else {
      // Stop auto-save when panel closes
      this.stopNotesAutoSave();
    }
  }
  
  toggleLessonStrength(strength: string) {
    const index = this.lessonSelectedStrengths.indexOf(strength);
    if (index > -1) {
      this.lessonSelectedStrengths.splice(index, 1);
    } else {
      this.lessonSelectedStrengths.push(strength);
    }
    this.autoSaveNotes();
  }
  
  toggleLessonAreaToImprove(area: string) {
    const index = this.lessonSelectedAreasToImprove.indexOf(area);
    if (index > -1) {
      this.lessonSelectedAreasToImprove.splice(index, 1);
    } else {
      this.lessonSelectedAreasToImprove.push(area);
    }
    this.autoSaveNotes();
  }
  
  toggleLessonErrorArea(area: string) {
    const index = this.lessonSelectedErrorAreas.indexOf(area);
    if (index > -1) {
      this.lessonSelectedErrorAreas.splice(index, 1);
    } else {
      this.lessonSelectedErrorAreas.push(area);
    }
    this.autoSaveNotes();
  }
  
  formatNotesSaveTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    return formatTimeInTz(date, this.userTz);
  }

  private get userTz(): string | undefined {
    return this.currentUser?.profile?.timezone || undefined;
  }
  
  startNotesAutoSave() {
    // Auto-save every 30 seconds
    this.notesAutoSaveInterval = setInterval(() => {
      this.autoSaveNotes();
    }, 30000);
  }
  
  stopNotesAutoSave() {
    if (this.notesAutoSaveInterval) {
      clearInterval(this.notesAutoSaveInterval);
      this.notesAutoSaveInterval = null;
    }
  }
  
  async autoSaveNotes() {
    if (!this.lessonId || this.userRole !== 'tutor') return;
    if (this.savingNotes) return; // Prevent concurrent saves
    
    this.savingNotes = true;
    
    try {
      // Save notes to localStorage as backup
      const notesData = {
        lessonId: this.lessonId,
        noteText: this.lessonNoteText,
        quickImpression: this.lessonQuickImpression,
        homework: this.lessonHomework,
        strengths: this.lessonSelectedStrengths,
        areasToImprove: this.lessonSelectedAreasToImprove,
        errorAreas: this.lessonSelectedErrorAreas,
        savedAt: new Date().toISOString()
      };
      
      localStorage.setItem(`lesson_notes_${this.lessonId}`, JSON.stringify(notesData));
      
      // TODO: Also save to backend API endpoint for persistence across devices
      // For now, localStorage is sufficient for same-session persistence
      
      this.notesLastSaved = new Date();
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error auto-saving notes:', error);
    } finally {
      this.savingNotes = false;
    }
  }
  
  loadLessonNotes() {
    if (!this.lessonId) return;
    
    try {
      const saved = localStorage.getItem(`lesson_notes_${this.lessonId}`);
      if (saved) {
        const notesData = JSON.parse(saved);
        this.lessonNoteText = notesData.noteText || '';
        this.lessonQuickImpression = notesData.quickImpression || '';
        this.lessonHomework = notesData.homework || '';
        this.lessonSelectedStrengths = notesData.strengths || [];
        this.lessonSelectedAreasToImprove = notesData.areasToImprove || [];
        this.lessonSelectedErrorAreas = notesData.errorAreas || [];
        if (notesData.savedAt) {
          this.notesLastSaved = new Date(notesData.savedAt);
        }
      }
    } catch (error) {
      console.error('Error loading notes:', error);
    }
  }

  // ═══════════════════════════════════════════════════════
  // VOCABULARY PANEL METHODS
  // ═══════════════════════════════════════════════════════
  
  toggleVocabulary() {
    this.showVocabulary = !this.showVocabulary;
    
    if (this.showVocabulary) {
      this.loadVocabulary();
      this.startVocabAutoSave();
    } else {
      this.stopVocabAutoSave();
    }
  }
  
  addVocabularyItem() {
    if (!this.newVocabWord.trim() || !this.newVocabTranslation.trim()) return;
    
    const item = {
      word: this.newVocabWord.trim(),
      translation: this.newVocabTranslation.trim(),
      example: this.newVocabExample.trim(),
      addedBy: this.userRole,
      id: `vocab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    };
    
    this.vocabularyItems.push(item);
    this.newVocabWord = '';
    this.newVocabTranslation = '';
    this.newVocabExample = '';
    this.isAddingVocab = false;
    this.autoSaveVocabulary();
    this.cdr.detectChanges();
  }
  
  removeVocabularyItem(id: string) {
    this.vocabularyItems = this.vocabularyItems.filter(v => v.id !== id);
    this.autoSaveVocabulary();
    this.cdr.detectChanges();
  }
  
  cancelAddVocab() {
    this.newVocabWord = '';
    this.newVocabTranslation = '';
    this.newVocabExample = '';
    this.isAddingVocab = false;
  }
  
  private startVocabAutoSave() {
    this.vocabAutoSaveInterval = setInterval(() => {
      this.autoSaveVocabulary();
    }, 15000); // Auto-save every 15 seconds
  }
  
  private stopVocabAutoSave() {
    if (this.vocabAutoSaveInterval) {
      clearInterval(this.vocabAutoSaveInterval);
      this.vocabAutoSaveInterval = null;
    }
  }
  
  private autoSaveVocabulary() {
    if (!this.lessonId || this.vocabSaving) return;
    
    // Always save to localStorage as backup
    try {
      const vocabData = {
        lessonId: this.lessonId,
        items: this.vocabularyItems,
        goals: this.goalItems,
        savedAt: new Date().toISOString()
      };
      localStorage.setItem(`lesson_vocab_${this.lessonId}`, JSON.stringify(vocabData));
    } catch (error) {
      console.error('Error saving vocabulary to localStorage:', error);
    }
    
    // Save to backend
    this.vocabSaving = true;
    const vocabEntries: VocabEntry[] = this.vocabularyItems.map(v => ({
      word: v.word,
      translation: v.translation,
      example: v.example,
      addedBy: (v.addedBy as 'tutor' | 'student') || 'tutor'
    }));
    const goalEntries: GoalEntry[] = this.goalItems.map(g => ({
      text: g.text,
      completed: g.completed,
      addedBy: (g.addedBy as 'tutor' | 'student') || 'student'
    }));
    
    this.vocabularyService.saveVocabulary(this.lessonId, vocabEntries, goalEntries).subscribe({
      next: () => {
        this.vocabLastSaved = new Date();
        this.vocabSaving = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error saving vocabulary to backend:', err);
        this.vocabSaving = false;
        // localStorage backup already saved above
        this.vocabLastSaved = new Date();
        this.cdr.detectChanges();
      }
    });
  }
  
  private loadVocabulary() {
    if (!this.lessonId) return;
    
    // Try backend first
    this.vocabularyService.getVocabulary(this.lessonId).subscribe({
      next: (response) => {
        if (response?.data) {
          const data = response.data;
          if (data.vocabulary && data.vocabulary.length > 0) {
            this.vocabularyItems = data.vocabulary.map((v: any) => ({
              word: v.word,
              translation: v.translation,
              example: v.example || '',
              addedBy: v.addedBy || 'tutor',
              id: v._id || `vocab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
            }));
          }
          if (data.goals && data.goals.length > 0) {
            this.goalItems = data.goals.map((g: any) => ({
              text: g.text,
              completed: g.completed || false,
              addedBy: g.addedBy || 'student',
              id: g._id || `goal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
            }));
          }
          if (data.updatedAt) {
            this.vocabLastSaved = new Date(data.updatedAt);
          }
          this.cdr.detectChanges();
        }
      },
      error: (err) => {
        console.warn('Could not load vocabulary from backend, falling back to localStorage:', err);
        this.loadVocabularyFromLocalStorage();
      }
    });
  }
  
  private loadVocabularyFromLocalStorage() {
    if (!this.lessonId) return;
    try {
      const saved = localStorage.getItem(`lesson_vocab_${this.lessonId}`);
      if (saved) {
        const vocabData = JSON.parse(saved);
        this.vocabularyItems = vocabData.items || [];
        this.goalItems = vocabData.goals || [];
        if (vocabData.savedAt) {
          this.vocabLastSaved = new Date(vocabData.savedAt);
        }
        this.cdr.detectChanges();
      }
    } catch (error) {
      console.error('Error loading vocabulary from localStorage:', error);
    }
  }
  
  // ═══════════════════════════════════════════════════════
  // LESSON GOALS/AGENDA METHODS
  // ═══════════════════════════════════════════════════════
  
  toggleGoals() {
    this.showGoals = !this.showGoals;
    if (this.showGoals && this.goalItems.length === 0 && this.vocabularyItems.length === 0) {
      // Goals panel shares the same backend doc as vocab, load if not already loaded
      this.loadVocabulary();
    }
  }
  
  addGoalItem() {
    if (!this.newGoalText.trim()) return;
    
    const item = {
      text: this.newGoalText.trim(),
      completed: false,
      addedBy: this.userRole,
      id: `goal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    };
    
    this.goalItems.push(item);
    this.newGoalText = '';
    this.isAddingGoal = false;
    this.autoSaveVocabulary(); // Goals save alongside vocab
    this.cdr.detectChanges();
  }
  
  toggleGoalCompleted(id: string) {
    const goal = this.goalItems.find(g => g.id === id);
    if (goal) {
      goal.completed = !goal.completed;
      this.autoSaveVocabulary();
      this.cdr.detectChanges();
    }
  }
  
  removeGoalItem(id: string) {
    this.goalItems = this.goalItems.filter(g => g.id !== id);
    this.autoSaveVocabulary();
    this.cdr.detectChanges();
  }
  
  cancelAddGoal() {
    this.newGoalText = '';
    this.isAddingGoal = false;
  }

  // ═══════════════════════════════════════════════════════
  // CORRECTION MESSAGE METHODS (sent as special chat messages)
  // ═══════════════════════════════════════════════════════
  
  toggleCorrectionInput() {
    this.showCorrectionInput = !this.showCorrectionInput;
    if (!this.showCorrectionInput) {
      this.correctionOriginal = '';
      this.correctionFixed = '';
    }
  }
  
  sendCorrection() {
    if (!this.correctionOriginal.trim() || !this.correctionFixed.trim()) return;
    if (!this.otherUserAuth0Id || this.isSending) return;
    
    // Format as a special correction message with markers
    const correctionContent = `[CORRECTION]\n❌ ${this.correctionOriginal.trim()}\n✅ ${this.correctionFixed.trim()}`;
    
    this.isSending = true;
    
    if (this.websocketService.getConnectionStatus()) {
      this.websocketService.sendMessage(
        this.otherUserAuth0Id,
        correctionContent,
        'text'
      );
      
      this.messageSendTimeout = setTimeout(() => {
        if (this.isSending) {
          this.sendCorrectionViaHTTP(correctionContent);
        }
      }, 2000);
    } else {
      this.sendCorrectionViaHTTP(correctionContent);
    }
    
    // Clear inputs
    this.correctionOriginal = '';
    this.correctionFixed = '';
    this.showCorrectionInput = false;
    this.cdr.detectChanges();
  }
  
  private sendCorrectionViaHTTP(content: string) {
    if (!this.isSending) return;
    if (!this.otherUserAuth0Id) return;
    
    this.messagingService.sendMessage(
      this.otherUserAuth0Id,
      content,
      'text'
    ).subscribe({
      next: (response) => {
        const message = response.message;
        const exists = this.chatMessages.find(m => m.id === message.id);
        if (!exists) {
          this.chatMessages.push(message);
          this.messages = this.chatMessages;
          this.scrollChatToBottom();
        }
        this.isSending = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('❌ Error sending correction via HTTP:', error);
        this.isSending = false;
        this.cdr.detectChanges();
      }
    });
  }
  
  isCorrection(message: Message): boolean {
    return message.content?.startsWith('[CORRECTION]') || false;
  }
  
  getCorrectionOriginal(message: Message): string {
    if (!this.isCorrection(message)) return '';
    const lines = message.content.split('\n');
    const originalLine = lines.find(l => l.startsWith('❌'));
    return originalLine ? originalLine.replace('❌ ', '') : '';
  }
  
  getCorrectionFixed(message: Message): string {
    if (!this.isCorrection(message)) return '';
    const lines = message.content.split('\n');
    const fixedLine = lines.find(l => l.startsWith('✅'));
    return fixedLine ? fixedLine.replace('✅ ', '') : '';
  }

  // ═══════════════════════════════════════════════════════
  // RESOURCES/DOCUMENTS SECTION METHODS
  // ═══════════════════════════════════════════════════════
  
  toggleResourcesSection() {
    this.showResourcesSection = !this.showResourcesSection;
  }
  
  get resourceMessages(): Message[] {
    return this.chatMessages.filter(m => 
      m.type === 'file' || m.type === 'image' || this.isLinkMessage(m)
    );
  }
  
  isLinkMessage(message: Message): boolean {
    if (message.type !== 'text') return false;
    if (this.isCorrection(message)) return false;
    const urlRegex = /https?:\/\/[^\s]+/;
    return urlRegex.test(message.content || '');
  }
  
  extractLink(message: Message): string {
    const urlRegex = /https?:\/\/[^\s]+/;
    const match = message.content?.match(urlRegex);
    return match ? match[0] : '';
  }
  
  extractLinkDomain(message: Message): string {
    try {
      const url = this.extractLink(message);
      if (!url) return '';
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return '';
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

    // Listen for WebSocket reconnection during video call
    this.websocketService.connection$.pipe(takeUntil(this.destroy$)).subscribe(isConnected => {
      console.log('🔌 [VIDEO-CALL] WebSocket connection status changed:', isConnected);
      if (isConnected && this.lessonId) {
        console.log('🔌 [VIDEO-CALL] WebSocket reconnected during call - refreshing chat');
        // Reload chat messages after reconnection
        setTimeout(() => {
          this.loadChatMessages();
        }, 500);
      }
    });

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
    
    // Listen for when the other participant ends the lesson early
    this.websocketService.on('lesson_ended_by_participant').pipe(takeUntil(this.destroy$)).subscribe(async (data: any) => {
      console.log('📭 Other participant ended lesson:', data);
      
      if (data.lessonId === this.lessonId) {
        // Show alert to current user
        const alert = await this.alertController.create({
          header: this.t('VIDEO_CALL.LESSON_ENDED_HEADER'),
          message: this.t('VIDEO_CALL.LESSON_ENDED_MESSAGE', { message: data.message || '' }),
          buttons: [
            {
              text: this.t('VIDEO_CALL.OK'),
              handler: async () => {
                // Leave the call without showing early exit modal (other participant ended it)
                await this.endCall(true); // Pass true to indicate other participant ended
                
                // After navigation completes, check if feedback is required (tutors only)
                if (this.userRole === 'tutor') {
                  // Small delay to ensure navigation is complete
                  setTimeout(() => {
                    // The home page will handle showing the feedback prompt
                    console.log('📝 Tutor will see feedback prompt on home page');
                  }, 1000);
                }
              }
            }
          ],
          backdropDismiss: false
        });
        await alert.present();
      }
    });
    
    /* 
    TEMPORARILY DISABLED: Feedback Required Toast (in video call)
    TODO: Re-enable if we want to support AI-disabled mode
    
    // Listen for feedback_required events (tutors only - shown while in call)
    if (this.userRole === 'tutor') {
      this.websocketService.on('feedback_required').pipe(takeUntil(this.destroy$)).subscribe(async (data: any) => {
        console.log('📝 [VIDEO-CALL] Feedback required:', data);
        
        // Show toast notification (less intrusive than alert while in call)
        const toast = await this.toastController.create({
          header: data.title || '📝 Feedback Needed',
          message: data.message || 'Please provide feedback for this lesson when you finish.',
          duration: 5000,
          color: 'primary',
          position: 'top',
          buttons: [
            {
              text: 'Dismiss',
              role: 'cancel'
            }
          ]
        });
        await toast.present();
      });
    }
    */
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
        this.recordingDurationLabel = this.formatRecordingDuration();
        
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
    return formatTimeInTz(date, this.userTz);
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
      
      // User cancelled the browser picker — not an error, just a no-op
      const errorName = error?.name || '';
      const errorMsg = error?.message || '';
      if (errorName === 'NotAllowedError' || errorMsg.includes('Permission denied') || errorMsg.includes('PERMISSION_DENIED')) {
        console.log('ℹ️ User cancelled screen sharing picker');
        return; // Silent return — no alert needed
      }
      
      let errorMessage = this.t('VIDEO_CALL.SCREEN_SHARE_FAILED');
      if (errorName === 'NotSupportedError' || errorMsg.includes('NotSupportedError')) {
        errorMessage = this.t('VIDEO_CALL.SCREEN_SHARE_NOT_SUPPORTED');
      } else if (errorName === 'NotReadableError' || errorMsg.includes('NotReadableError')) {
        errorMessage = this.t('VIDEO_CALL.SCREEN_SHARE_NOT_READABLE');
      }
      
      const alert = await this.alertController.create({
        header: this.t('VIDEO_CALL.SCREEN_SHARE_ERROR_HEADER'),
        message: errorMessage,
        buttons: [this.t('VIDEO_CALL.OK')]
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
      message: this.t('VIDEO_CALL.STARTING_SCREEN_SHARE'),
      spinner: 'crescent'
    });
    await loading.present();

    try {
      await this.agoraService.startScreenShare();
      this.isScreenSharing = true;
      console.log('✅ Screen sharing started successfully');
      
      // Register callback for when browser's "Stop sharing" button is clicked.
      // This fires from outside Angular zone, so we wrap in ngZone.run + detectChanges.
      this.agoraService.onScreenShareStopped(() => {
        this.ngZone.run(() => {
          console.log('🖥️ Screen share stopped externally — syncing page state');
          this.isScreenSharing = false;
          
          // Clean up the screen share display
          if (this.screenShareVideoRef?.nativeElement) {
            this.screenShareVideoRef.nativeElement.innerHTML = '';
          }
          if (this.localVideoPipRef?.nativeElement) {
            this.localVideoPipRef.nativeElement.innerHTML = '';
          }
          
          // Restore normal video layout
          setTimeout(() => {
            this.playRemoteVideoInCorrectContainer();
          }, 300);
          
          this.cdr.detectChanges();
        });
      });
      
      // Display the screen share video after change detection runs
      this.cdr.detectChanges();
      setTimeout(() => {
        this.displayScreenShare();
      }, 200);

      
      // Show success message with cursor tip
      const toast = await this.toastController.create({
        message: this.t('VIDEO_CALL.SCREEN_SHARE_STARTED'),
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
    
    // Guard: if already stopped (e.g. browser "Stop sharing" already ran), just sync UI
    if (!this.isScreenSharing) {
      console.log('ℹ️ Screen sharing already stopped, skipping');
      return;
    }
    
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
      }, 300);
      
      this.cdr.detectChanges();
      
      // Show success message
      const toast = await this.toastController.create({
        message: this.t('VIDEO_CALL.SCREEN_SHARE_STOPPED'),
        duration: 2000,
        color: 'primary',
        position: 'top'
      });
      await toast.present();
      
    } catch (error) {
      console.error('❌ Failed to stop screen sharing:', error);
      // Ensure UI state is always reset even on error
      this.isScreenSharing = false;
      this.cdr.detectChanges();
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
        header: this.t('VIDEO_CALL.SHARE_WHITEBOARD_HEADER'),
        message: this.t('VIDEO_CALL.SHARE_WHITEBOARD_MESSAGE'),
        buttons: [
          {
            text: this.t('VIDEO_CALL.SHARE_CANVAS_ONLY'),
            handler: () => this.shareCanvasAsVideo()
          },
          {
            text: this.t('VIDEO_CALL.SHARE_FULL_SCREEN'),
            handler: () => this.shareScreenWithWhiteboard()
          },
          {
            text: this.t('VIDEO_CALL.CANCEL'),
            role: 'cancel'
          }
        ]
      });

      await alert.present();

    } catch (error) {
      console.error('❌ Whiteboard screen sharing error:', error);
      
      const toast = await this.toastController.create({
        message: this.t('VIDEO_CALL.WHITEBOARD_SHARE_FAILED'),
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
      
      // Register callback for external stop (browser "Stop sharing" button)
      this.agoraService.onScreenShareStopped(() => {
        this.ngZone.run(() => {
          console.log('🖥️ Canvas share stopped externally — syncing page state');
          this.isScreenSharing = false;
          if (this.screenShareVideoRef?.nativeElement) {
            this.screenShareVideoRef.nativeElement.innerHTML = '';
          }
          if (this.localVideoPipRef?.nativeElement) {
            this.localVideoPipRef.nativeElement.innerHTML = '';
          }
          setTimeout(() => this.playRemoteVideoInCorrectContainer(), 300);
          this.cdr.detectChanges();
        });
      });
      
      // Display the shared canvas in screen share mode
      this.cdr.detectChanges();
      setTimeout(() => {
        this.displayScreenShare();
      }, 200);

      console.log('✅ Canvas sharing started successfully');
      
      const toast = await this.toastController.create({
        message: this.t('VIDEO_CALL.WHITEBOARD_CANVAS_SHARED'),
        duration: 3000,
        color: 'success',
        position: 'top'
      });
      await toast.present();

    } catch (error) {
      console.error('❌ Canvas sharing failed:', error);
      
      const toast = await this.toastController.create({
        message: this.t('VIDEO_CALL.WHITEBOARD_CANVAS_FAILED'),
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
        message: this.t('VIDEO_CALL.SCREEN_SHARE_TIP'),
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
        message: this.t('VIDEO_CALL.SCREEN_SHARE_FAILED'),
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

  toggleMoreMenu(): void {
    this.showMoreMenu = !this.showMoreMenu;
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
        header: this.t('VIDEO_CALL.BLUR_ERROR_HEADER'),
        message: this.t('VIDEO_CALL.BLUR_ERROR_MESSAGE'),
        buttons: [this.t('VIDEO_CALL.OK')]
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
        header: this.t('VIDEO_CALL.COLOR_ERROR_HEADER'),
        message: this.t('VIDEO_CALL.COLOR_ERROR_MESSAGE'),
        buttons: [this.t('VIDEO_CALL.OK')]
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
    
    // Recompute template-bound properties for 1:1 view
    this.updateRemoteUserProperties();
    
    // Force change detection to update UI immediately
    this.cdr.detectChanges();
  }

  /**
   * Recompute pre-calculated remote user properties for 1:1 template bindings.
   * Called whenever remote user states or participants change.
   */
  private updateRemoteUserProperties(): void {
    const remoteUsers = this.agoraService.getRemoteUsers();
    if (remoteUsers.size > 0) {
      const firstRemoteUid = Array.from(remoteUsers.keys())[0];
      const firstRemoteUser = Array.from(remoteUsers.values())[0];
      const state = this.remoteUserStates.get(firstRemoteUid);
      
      this.isRemoteUserMuted = state?.isMuted || false;
      this.isRemoteUserVideoOff = state?.isVideoOff || !firstRemoteUser.videoTrack || false;
    } else {
      this.isRemoteUserMuted = false;
      this.isRemoteUserVideoOff = false;
    }
    
    // Update remote participant label
    if (this.userRole === 'tutor') {
      this.remoteParticipantLabel = this.studentName || 'Student';
    } else {
      this.remoteParticipantLabel = this.tutorName || 'Tutor';
    }
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

    const now = Date.now();

    const lessonStarted = this.hasLessonStarted();

    // Process volume levels
    volumes.forEach(({ uid, level }) => {
      // Level is from 0-100, consider speaking if > 30
      const isSpeaking = level > 30;
      const trackingUid = (uid === 0 || uid === this.agoraService.getClient()?.uid) ? 'local' : uid;
      
      if (trackingUid === 'local') {
        const wasSpeaking = this.isLocalUserSpeaking;
        this.isLocalUserSpeaking = isSpeaking;
        
        // Only accumulate speaking time after lesson officially starts
        if (lessonStarted) {
          if (isSpeaking && !wasSpeaking) {
            this.speakingStartTime.set('local', now);
          } else if (!isSpeaking && wasSpeaking) {
            const startTime = this.speakingStartTime.get('local');
            if (startTime) {
              const dur = (now - startTime) / 1000;
              const existing = this.speakingTimeAccumulator.get('local') || 0;
              this.speakingTimeAccumulator.set('local', existing + dur);
              this.speakingStartTime.delete('local');
            }
          } else if (isSpeaking && wasSpeaking && !this.speakingStartTime.has('local')) {
            // Lesson just started while user was already speaking — begin tracking now
            this.speakingStartTime.set('local', now);
          }
        }
      } else {
        const wasSpeaking = this.isRemoteUserSpeaking;
        this.isRemoteUserSpeaking = isSpeaking;
        
        // Only accumulate speaking time after lesson officially starts
        if (lessonStarted) {
          if (isSpeaking && !wasSpeaking) {
            this.speakingStartTime.set('remote', now);
          } else if (!isSpeaking && wasSpeaking) {
            const startTime = this.speakingStartTime.get('remote');
            if (startTime) {
              const dur = (now - startTime) / 1000;
              const existing = this.speakingTimeAccumulator.get('remote') || 0;
              this.speakingTimeAccumulator.set('remote', existing + dur);
              this.speakingStartTime.delete('remote');
            }
          } else if (isSpeaking && wasSpeaking && !this.speakingStartTime.has('remote')) {
            // Lesson just started while user was already speaking — begin tracking now
            this.speakingStartTime.set('remote', now);
          }
        }
      }
    });

    // Set timeout to reset speaking state after 500ms of silence
    this.speakingTimeout = setTimeout(() => {
      // Flush any in-progress speaking time (only if lesson has started)
      if (this.hasLessonStarted()) {
        const flushTime = Date.now();
        if (this.isLocalUserSpeaking) {
          const startTime = this.speakingStartTime.get('local');
          if (startTime) {
            const dur = (flushTime - startTime) / 1000;
            const existing = this.speakingTimeAccumulator.get('local') || 0;
            this.speakingTimeAccumulator.set('local', existing + dur);
            this.speakingStartTime.delete('local');
          }
        }
        if (this.isRemoteUserSpeaking) {
          const startTime = this.speakingStartTime.get('remote');
          if (startTime) {
            const dur = (flushTime - startTime) / 1000;
            const existing = this.speakingTimeAccumulator.get('remote') || 0;
            this.speakingTimeAccumulator.set('remote', existing + dur);
            this.speakingStartTime.delete('remote');
          }
        }
      }
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
            
            // Only track speaking time for accumulation AFTER the lesson has officially started
            if (this.hasLessonStarted()) {
              this.speakingStartTime.set(uid, currentTime);
            }
            
            // Update participant in the list (visual indicator always works, even pre-lesson)
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
          } else if (this.hasLessonStarted() && !this.speakingStartTime.has(uid)) {
            // Edge case: participant was speaking before lesson started and is still speaking.
            // Now that the lesson has started, begin tracking from this moment.
            this.speakingStartTime.set(uid, currentTime);
          }
        } else {
          // Not currently speaking, but check if we should keep the indicator on
          // Add 400ms grace period for natural speech pauses (like "one... two")
          const timeSinceLastSpeak = currentTime - lastSpeakingTime;
          const shouldStillShowSpeaking = wasAlreadySpeaking && timeSinceLastSpeak < 400;
          
          if (wasAlreadySpeaking && !shouldStillShowSpeaking) {
            // Mark as not speaking after grace period
            this.participantSpeakingStates.set(uid, false);
            
            // Accumulate speaking time only if lesson has started
            const startTime = this.speakingStartTime.get(uid);
            if (startTime && this.hasLessonStarted()) {
              const durationSeconds = (currentTime - startTime) / 1000;
              const existing = this.speakingTimeAccumulator.get(uid) || 0;
              this.speakingTimeAccumulator.set(uid, existing + durationSeconds);
            }
            this.speakingStartTime.delete(uid);
            
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

  async confirmEndCall() {
    const alert = await this.alertController.create({
      header: this.t('VIDEO_CALL.LEAVE_LESSON_HEADER'),
      message: this.t('VIDEO_CALL.LEAVE_LESSON_MESSAGE'),
      cssClass: 'leave-confirmation-alert',
      buttons: [
        {
          text: this.t('VIDEO_CALL.CANCEL'),
          role: 'cancel'
        },
        {
          text: this.t('VIDEO_CALL.LEAVE'),
          role: 'destructive',
          handler: () => {
            this.endCall();
          }
        }
      ]
    });
    await alert.present();
  }

  async endCall(otherParticipantEnded: boolean = false) {
    try {
      this.hasEndedCall = true; // Prevent ngOnDestroy from doing redundant cleanup
      this.isEndingCall = true; // Show "Leaving..." overlay instantly
      this.cdr.detectChanges();  // Force immediate UI update so user sees feedback NOW
      console.log('🚪 VideoCall: Ending video call...', { otherParticipantEnded });

      // ── 1. INSTANT: Cancel timers, stop audio monitoring, persist local state ──
      
      // Cancel pre-emptive analysis timer
      if (this.preEmptiveAnalysisTimer) {
        clearTimeout(this.preEmptiveAnalysisTimer);
        this.preEmptiveAnalysisTimer = null;
      }
      
      // Stop audio monitoring (purely local — instant)
      this.stopAllAudioMonitoring();
      
      // Persist talk time locally (synchronous)
      const flushNow = Date.now();
      let flushLocalSeconds = this.speakingTimeAccumulator.get('local') || 0;
      const flushLocalStart = this.speakingStartTime.get('local');
      if (flushLocalStart) flushLocalSeconds += (flushNow - flushLocalStart) / 1000;
      this.persistTalkTimeToStorage(flushLocalSeconds, this.syncedRemoteSpeakingSeconds);

      // ── 2. Determine end-type using CACHED data (no API call) ──
      let isPermanentEnd = false;
      let scheduledEndTime: Date | null = null;
      if (this.scheduledLessonStartTime && this.bookedDuration) {
        const scheduledEndMs = this.scheduledLessonStartTime + (this.bookedDuration * 60 * 1000);
        scheduledEndTime = new Date(scheduledEndMs);
        isPermanentEnd = Date.now() >= scheduledEndMs;
        console.log('🕐 End call timing (from cache):', {
          scheduledEndTime: scheduledEndTime.toISOString(),
          isPermanentEnd,
          minutesRemaining: Math.round((scheduledEndMs - Date.now()) / 60000)
        });
      }

      // Clear persisted talk time when the lesson is permanently ending
      if (isPermanentEnd || otherParticipantEnded) {
        this.clearTalkTimeStorage();
        this.clearLessonLocalStorage();
      }

      // ── 3. FAST: Leave Agora channel + cleanup media (essential before navigation) ──
      console.log('🚪 VideoCall: Leaving Agora channel...');
      await this.agoraService.leaveChannel();
      this.isConnected = false;
      this.cleanupAllMediaElements();

      // ── 4. NAVIGATE IMMEDIATELY — don't wait for backend calls ──
      // Capture values we need for background work before navigating
      const lessonId = this.lessonId;
      const userRole = this.userRole;
      const isTrialLesson = this.isTrialLesson;
      const isClass = this.isClass;
      const transcriptionEnabled = this.isTranscriptionEnabled;
      const transcriptId = this.currentTranscriptId;
      const transcriptionAlreadyDone = this.transcriptionCompletedEarly || this.isCompletingTranscription;
      const vocabItems = [...this.vocabularyItems];
      const goalItems = [...this.goalItems];
      
      if (!isPermanentEnd && !otherParticipantEnded) {
        // Early exit — navigate to tabs, then show modal
        console.log('🚪 Navigating to tabs (early exit)...');
        await this.router.navigate(['/tabs']);
        
        if (lessonId && scheduledEndTime) {
          const now = new Date();
          const minutesRemaining = Math.round((scheduledEndTime.getTime() - now.getTime()) / 60000);
          setTimeout(() => {
            this.earlyExitService.triggerEarlyExit({
              lessonId,
              scheduledEndTime,
              currentTime: now,
              minutesRemaining: Math.max(0, minutesRemaining),
              isClass
            });
          }, 200);
        }
      } else if (isPermanentEnd) {
        // On-time exit — go straight to post-lesson page (call-end fires in background)
        console.log('🚪 On-time exit — navigating to post-lesson page...');
        if (userRole === 'student') {
          await this.router.navigate(['/post-lesson-student', lessonId]);
        } else if (isTrialLesson) {
          await this.router.navigate(['/tabs/lessons']);
        } else {
          await this.router.navigate(['/post-lesson-tutor', lessonId], {
            queryParams: { fromPostCall: 'true' }
          });
        }
      } else if (otherParticipantEnded) {
        // Other participant ended — navigate to post-lesson page
        console.log('🚪 Other participant ended — navigating to post-lesson page...');
        if (userRole === 'student') {
          await this.router.navigate(['/post-lesson-student', lessonId]);
        } else if (isTrialLesson) {
          await this.router.navigate(['/tabs/lessons']);
        } else {
          await this.router.navigate(['/post-lesson-tutor', lessonId], {
            queryParams: { fromPostCall: 'true' }
          });
        }
      }

      // ── 5. BACKGROUND: Fire-and-forget cleanup (runs AFTER navigation) ──
      // These are all non-blocking. If any fail, cron jobs provide a safety net.
      const localSpeakingSeconds = flushLocalSeconds;
      const remoteSpeakingSeconds = this.syncedRemoteSpeakingSeconds;
      const clientSpeakingSeconds = userRole === 'student'
        ? { studentSeconds: Math.round(localSpeakingSeconds), tutorSeconds: Math.round(remoteSpeakingSeconds) }
        : { studentSeconds: Math.round(remoteSpeakingSeconds), tutorSeconds: Math.round(localSpeakingSeconds) };
      this.runBackgroundCleanup({
        lessonId, userRole, isPermanentEnd, otherParticipantEnded,
        transcriptionEnabled, transcriptId, transcriptionAlreadyDone,
        vocabItems, goalItems, clientSpeakingSeconds
      });
      
      // After navigation, prompt tutor to add note (always for tutors, regardless of who ended)
      if (this.userRole === 'tutor') {
        setTimeout(() => {
          this.promptTutorNote();
        }, 2000); // Give tutor a moment to breathe after lesson
      }
    } catch (error) {
      console.error('Error ending call:', error);
      // Even on error, try to cleanup media
      this.cleanupAllMediaElements();
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Navigate to tabs after ending call (error case)
      console.log('🚪 VideoCall: Navigating to tabs after ending call (error case)');
      await this.router.navigate(['/tabs']);
      
      // Don't try to show anything on error - user can access from lesson history if needed
    }
  }

  /**
   * Fire-and-forget background cleanup after navigation.
   * All calls here are non-critical — cron jobs catch anything that fails.
   */
  private async runBackgroundCleanup(ctx: {
    lessonId: string | undefined;
    userRole: string;
    isPermanentEnd: boolean;
    otherParticipantEnded: boolean;
    transcriptionEnabled: boolean;
    transcriptId: string;
    transcriptionAlreadyDone: boolean;
    vocabItems: any[];
    goalItems: any[];
    clientSpeakingSeconds: { studentSeconds: number; tutorSeconds: number };
  }): Promise<void> {
    try {
      // 1. Stop audio capture (if still running)
      if (ctx.transcriptionEnabled && !ctx.transcriptionAlreadyDone) {
        try {
          await this.stopAudioCapture_FIXED();
          // Brief wait for final upload
          await new Promise(resolve => setTimeout(resolve, 1500));
        } catch (e) { console.warn('⚠️ Background: stopAudioCapture failed:', e); }
      }

      // 2. Complete transcription (if not already done by pre-emptive trigger)
      if (ctx.transcriptionEnabled && ctx.transcriptId && !ctx.transcriptionAlreadyDone) {
        try {
          console.log('📝 Background: completing transcription...');
          await firstValueFrom(this.transcriptionService.completeTranscription());
          console.log('✅ Background: transcription completed');
        } catch (e) { console.warn('⚠️ Background: completeTranscription failed (cron will retry):', e); }
        this.clearTranscriptionSession();
        this.isTranscriptionEnabled = false;
      }

      // 3. Call leave endpoint
      if (ctx.lessonId) {
        try {
          await firstValueFrom(this.lessonService.leaveLesson(ctx.lessonId));
          console.log('✅ Background: leave endpoint called');
        } catch (e) { console.warn('⚠️ Background: leave endpoint failed:', e); }
      }

      // 4. Finalize lesson (for permanent/on-time exits)
      if (ctx.isPermanentEnd && ctx.lessonId) {
        try {
          await firstValueFrom(this.lessonService.endCall(ctx.lessonId, ctx.clientSpeakingSeconds));
          console.log('✅ Background: lesson finalized via call-end');
        } catch (e) { console.warn('⚠️ Background: call-end failed (cron will finalize):', e); }
      }

      // 5. Save vocabulary/goals
      if (ctx.lessonId && (ctx.vocabItems.length > 0 || ctx.goalItems.length > 0)) {
        try {
          const vocabEntries: VocabEntry[] = ctx.vocabItems.map((v: any) => ({
            word: v.word, translation: v.translation, example: v.example,
            addedBy: (v.addedBy as 'tutor' | 'student') || 'tutor'
          }));
          const goalEntries: GoalEntry[] = ctx.goalItems.map((g: any) => ({
            text: g.text, completed: g.completed,
            addedBy: (g.addedBy as 'tutor' | 'student') || 'student'
          }));
          await firstValueFrom(this.vocabularyService.saveVocabulary(ctx.lessonId, vocabEntries, goalEntries));
          console.log('✅ Background: vocabulary/goals saved');
        } catch (e) { console.warn('⚠️ Background: vocab save failed:', e); }
      }

      console.log('✅ Background cleanup complete');
    } catch (error) {
      console.error('❌ Background cleanup error (non-fatal):', error);
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
        message: this.t('VIDEO_CALL.WHITEBOARD_LOAD_FAILED'),
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

  dismissIntentBanner() {
    this.showIntentBanner = false;
  }

  async ngOnDestroy() {
    console.log('🚪 VideoCall: ngOnDestroy called');
    
    // Unsuppress the lesson reminder now that we're leaving the call
    if (this.lessonId) {
      this.reminderService.unsuppressForLesson(this.lessonId);
    }
    
    // CRITICAL: Always stop audio recording when page is destroyed
    // This prevents orphaned MediaRecorder from continuing to record/upload
    if (this.transcriptionRecorder || this.transcriptionUploadInterval || this.samplingCheckInterval) {
      console.log('🛑🛑🛑 SAFETY: Stopping audio recording in ngOnDestroy');
      try {
        await this.stopAudioCapture_FIXED();
        console.log('✅ Audio recording stopped in ngOnDestroy');
      } catch (error) {
        console.error('❌ Error stopping audio in ngOnDestroy:', error);
      }
    }
    
    // Clear pre-emptive analysis timer
    if (this.preEmptiveAnalysisTimer) {
      clearTimeout(this.preEmptiveAnalysisTimer);
      this.preEmptiveAnalysisTimer = null;
    }
    
    // Stop office hours timer
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    
    // Stop talk time tracking
    if (this.talkTimeCheckInterval) {
      clearInterval(this.talkTimeCheckInterval);
      this.talkTimeCheckInterval = null;
    }
    if (this.talkTimeAutoHideTimer) {
      clearTimeout(this.talkTimeAutoHideTimer);
      this.talkTimeAutoHideTimer = null;
    }
    
    // Stop remote user monitoring
    if (this.remoteUserMonitorInterval) {
      clearInterval(this.remoteUserMonitorInterval);
      this.remoteUserMonitorInterval = null;
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
    
    if (this.hasEndedCall) {
      // endCall() already handled all cleanup (leaveLesson, leaveChannel, track cleanup).
      // Only clean up remaining DOM elements as a safety net.
      console.log('🚪 VideoCall: endCall already ran, skipping redundant cleanup in ngOnDestroy');
      this.cleanupAllMediaElements();
    } else if (this.isConnected) {
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
      // Not connected and endCall didn't run — user navigated away without ending call
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

    // Cleanup notes auto-save
    this.stopNotesAutoSave();
    
    // Cleanup vocabulary auto-save
    this.stopVocabAutoSave();
    
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
        this.refreshNextLessonStartsText();
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
  private refreshNextLessonStartsText(): void {
    if (this.nextEventMinutesAway <= 0) {
      this.nextLessonStartsText = this.t('VIDEO_CALL.NEXT_LESSON_NOW');
    } else if (this.nextEventMinutesAway === 1) {
      this.nextLessonStartsText = this.t('VIDEO_CALL.NEXT_LESSON_ONE_MIN');
    } else {
      this.nextLessonStartsText = this.t('VIDEO_CALL.NEXT_LESSON_N_MINS', {
        count: String(this.nextEventMinutesAway),
      });
    }
  }

  private handleBeforeUnload(event: BeforeUnloadEvent) {
    console.log('🚪 VideoCall: Browser beforeunload event');

    // Final persist of talk time (synchronous — survives browser close)
    const now = Date.now();
    let localSeconds = this.speakingTimeAccumulator.get('local') || 0;
    const localStart = this.speakingStartTime.get('local');
    if (localStart) localSeconds += (now - localStart) / 1000;
    this.persistTalkTimeToStorage(localSeconds, this.syncedRemoteSpeakingSeconds);

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
      header: this.t('VIDEO_CALL.VIDEO_CALL_ERROR_HEADER'),
      message: message,
      buttons: [
        {
          text: this.t('VIDEO_CALL.TRY_AGAIN'),
          handler: () => {
            this.initializeVideoCall();
          }
        },
        {
          text: this.t('VIDEO_CALL.CANCEL'),
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
      header: this.t('VIDEO_CALL.SESSION_ENDED_HEADER'),
      message: cancellation.cancelledBy === 'tutor'
        ? this.t('VIDEO_CALL.SESSION_CANCELLED_TUTOR_LEFT')
        : this.userRole === 'tutor'
          ? this.t('VIDEO_CALL.SESSION_CANCELLED_STUDENT_NO_SHOW')
          : this.t('VIDEO_CALL.SESSION_CANCELLED_STUDENT_LEFT'),
      buttons: [
        {
          text: this.userRole === 'tutor'
            ? this.t('VIDEO_CALL.BACK_TO_WAITING_ROOM')
            : this.t('VIDEO_CALL.FIND_TUTORS'),
          handler: () => {
            if (this.userRole === 'tutor') {
              // Tutor: Return to pre-call waiting room with office hours enabled
              // SECURITY: role is determined from lesson data + auth, not passed in URL
              this.router.navigate(['/pre-call'], {
                queryParams: {
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
      header: this.t('VIDEO_CALL.TIME_WARNING_HEADER'),
      message: this.t('VIDEO_CALL.TIME_WARNING_MESSAGE', {
        minutes: String(this.bookedDuration),
        rate: this.perMinuteRate.toFixed(2),
      }),
      buttons: [this.t('VIDEO_CALL.OK')]
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

  // ========================================
  // REAL-TIME TALK TIME TRACKING & POPUP
  // ========================================

  /**
   * Returns true if the scheduled lesson start time has arrived (or if no start time is known).
   * Talk time is only accumulated after the lesson officially starts.
   */
  private hasLessonStarted(): boolean {
    // If no scheduled start time is known, default to "started" (e.g. ad-hoc calls)
    if (!this.scheduledLessonStartTime) return true;
    return Date.now() >= this.scheduledLessonStartTime;
  }

  /**
   * Start tracking talk time. The popup appears at 60% of the booked lesson 
   * duration (measured from the scheduled start time) and auto-dismisses 
   * after 10 seconds. Both tutor and student see this.
   */
  private startTalkTimeTracking(): void {
    console.log('🗣️ startTalkTimeTracking called', {
      isOfficeHours: this.isOfficeHours,
      isClass: this.isClass,
      userRole: this.userRole,
      tutorName: this.tutorName,
      studentName: this.studentName,
      bookedDuration: this.bookedDuration,
      scheduledLessonStartTime: this.scheduledLessonStartTime 
        ? new Date(this.scheduledLessonStartTime).toLocaleTimeString() 
        : 'N/A',
      hasLessonStarted: this.hasLessonStarted()
    });

    // Set speaker names
    this.refreshSpeakerLabels();

    // Skip for classes, trial lessons, and office hours (quick lessons)
    if (this.isClass || this.isTrialLesson || this.isOfficeHours) {
      console.log('⏭️ Talk time tracking skipped', {
        isClass: this.isClass,
        isTrialLesson: this.isTrialLesson,
        isOfficeHours: this.isOfficeHours
      });
      return;
    }

    // Restore persisted talk time data if user refreshed / rejoined mid-lesson
    this.restoreTalkTimeFromStorage();

    // Check if we joined early (before scheduled start)
    this.isWaitingForLessonStart = !this.hasLessonStarted();
    if (this.isWaitingForLessonStart) {
      console.log('⏳ User joined before lesson start time — talk time tracking paused until lesson begins');
    }

    // Don't show popup yet — it will appear at 60% of booked time
    this.computeTalkTimeDisplay();
    this.cdr.detectChanges();
    console.log('🗣️ Talk time tracking started (popup will appear at 60% of lesson time)');

    // Update display live every 2 seconds and check if it's time to show the popup
    this.talkTimeCheckInterval = setInterval(() => {
      // Re-sync remote speaker name in case it loaded late
      const updatedRemoteName = this.getRemoteSpeakerLabel();
      if (updatedRemoteName !== this.remoteSpeakerName) {
        this.remoteSpeakerName = updatedRemoteName;
      }
      
      // Update waiting state — once lesson starts, flip this flag
      if (this.isWaitingForLessonStart && this.hasLessonStarted()) {
        this.isWaitingForLessonStart = false;
        console.log('🎬 Lesson has officially started — talk time tracking activated');
      }
      
      this.computeTalkTimeDisplay();

      // Show popup at 60% of booked lesson time (only once, and only if not dismissed)
      if (!this.talkTimePopupShown && !this.talkTimePopupDismissed && this.shouldShowTalkTimePopup()) {
        this.showTalkTimePopup = true;
        this.talkTimePopupShown = true;
        console.log('🗣️ Talk time popup shown at 60% of lesson time');

        // Auto-dismiss after 10 seconds
        this.talkTimeAutoHideTimer = setTimeout(() => {
          if (this.showTalkTimePopup && !this.talkTimePopupDismissed) {
            this.dismissTalkTimePopup();
            console.log('🗣️ Talk time popup auto-dismissed after 10 seconds');
          }
        }, 10000);
      }

      this.cdr.detectChanges();
    }, 2000);
  }

  /**
   * Checks whether 60% of the booked lesson duration has elapsed since the
   * scheduled start time.
   */
  private shouldShowTalkTimePopup(): boolean {
    if (!this.scheduledLessonStartTime || !this.bookedDuration) return false;
    if (!this.hasLessonStarted()) return false;

    const elapsedMs = Date.now() - this.scheduledLessonStartTime;
    const bookedMs = this.bookedDuration * 60 * 1000;
    const threshold = bookedMs * 0.6; // 60%

    return elapsedMs >= threshold;
  }

  // ── Talk Time Persistence (survives page refresh) ────────────────

  private getTalkTimeStorageKey(): string | null {
    return this.lessonId ? `talkTime_${this.lessonId}` : null;
  }

  private persistTalkTimeToStorage(localSeconds: number, remoteSeconds: number): void {
    const key = this.getTalkTimeStorageKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({
        localSeconds,
        remoteSeconds,
        timestamp: Date.now()
      }));
    } catch (_) { /* quota exceeded — non-critical */ }
  }

  private restoreTalkTimeFromStorage(): void {
    const key = this.getTalkTimeStorageKey();
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const data = JSON.parse(raw);

      // If the lesson's scheduled end time has passed, discard stale data
      if (this.scheduledLessonStartTime && this.bookedDuration) {
        const scheduledEndMs = this.scheduledLessonStartTime + (this.bookedDuration * 60 * 1000);
        // Add 30-min grace period (users can stay a bit past end time)
        if (Date.now() > scheduledEndMs + 30 * 60 * 1000) {
          console.log('🗑️ Lesson has ended — discarding stale talk time data');
          localStorage.removeItem(key);
          return;
        }
      }

      // Fallback: discard if data is more than 4 hours old
      if (Date.now() - data.timestamp > 4 * 60 * 60 * 1000) {
        localStorage.removeItem(key);
        return;
      }

      // Seed the accumulators with the persisted values
      const existingLocal = this.speakingTimeAccumulator.get('local') || 0;
      const existingRemote = this.syncedRemoteSpeakingSeconds;
      if (data.localSeconds > existingLocal) {
        this.speakingTimeAccumulator.set('local', data.localSeconds);
        console.log(`🔄 Restored local talk time from storage: ${Math.round(data.localSeconds)}s`);
      }
      if (data.remoteSeconds > existingRemote) {
        this.syncedRemoteSpeakingSeconds = data.remoteSeconds;
        console.log(`🔄 Restored remote talk time from storage: ${Math.round(data.remoteSeconds)}s`);
      }
    } catch (_) { /* corrupt data — ignore */ }
  }

  private clearTalkTimeStorage(): void {
    const key = this.getTalkTimeStorageKey();
    if (key) {
      localStorage.removeItem(key);
      console.log('🗑️ Cleared persisted talk time data');
    }
  }

  /**
   * Clear lesson-specific localStorage items (vocab, notes) after a permanent end.
   * Backend already has the persisted data, so these local copies can go.
   */
  private clearLessonLocalStorage(): void {
    if (!this.lessonId) return;
    try {
      localStorage.removeItem(`lesson_vocab_${this.lessonId}`);
      localStorage.removeItem(`lesson_notes_${this.lessonId}`);
      console.log('🗑️ Cleared lesson localStorage (vocab, notes) for lesson', this.lessonId);
    } catch (e) {
      // Non-critical — ignore
    }
  }

  /**
   * Compute the display values for talk time (runs once when popup triggers)
   */
  private computeTalkTimeDisplay(): void {
    // Get current accumulated LOCAL speaking time (self-measured, most accurate)
    const now = Date.now();
    let localSeconds = this.speakingTimeAccumulator.get('local') || 0;
    const localStart = this.speakingStartTime.get('local');
    if (localStart) {
      localSeconds += (now - localStart) / 1000;
    }

    // REMOTE speaking time — use the SYNCED value from the other participant
    // They measure their own mic, which is far more accurate than our decoded audio
    const remoteSeconds = this.syncedRemoteSpeakingSeconds;

    // Broadcast our local speaking time to the other participant
    this.agoraService.sendTalkTimeUpdate(localSeconds);

    // Persist to localStorage so data survives page refreshes
    this.persistTalkTimeToStorage(localSeconds, remoteSeconds);

    // Calculate percentages
    const total = localSeconds + remoteSeconds;
    if (total > 0) {
      this.localSpeakingPercent = Math.round((localSeconds / total) * 100);
      this.remoteSpeakingPercent = Math.round((remoteSeconds / total) * 100);
    } else {
      this.localSpeakingPercent = 0;
      this.remoteSpeakingPercent = 0;
    }

    // Format as percentages for display
    this.localSpeakingPercentFormatted = `${this.localSpeakingPercent}%`;
    this.remoteSpeakingPercentFormatted = `${this.remoteSpeakingPercent}%`;

    console.log('🗣️ Talk time computed (synced):', {
      localSeconds: Math.round(localSeconds),
      remoteSeconds: Math.round(remoteSeconds),
      localPercent: this.localSpeakingPercent,
      remotePercent: this.remoteSpeakingPercent
    });
  }

  // formatSpeakingTime removed — now displaying percentages only

  /**
   * Dismiss the talk time popup
   */
  dismissTalkTimePopup(): void {
    this.showTalkTimePopup = false;
    this.talkTimePopupDismissed = true;
    if (this.talkTimeAutoHideTimer) {
      clearTimeout(this.talkTimeAutoHideTimer);
      this.talkTimeAutoHideTimer = null;
    }
    this.cdr.detectChanges();
  }

  // ========================================
  // AI TRANSCRIPTION & ANALYSIS
  // ========================================

  /**
   * Start lesson transcription for AI analysis using Deepgram
   * Only starts for scheduled lessons with students
   */
  private async startLessonTranscription() {
    console.log('🎤 === DEEPGRAM TRANSCRIPTION CHECK START ===');
    console.log('🎤 lessonId:', this.lessonId);
    console.log('🎤 userRole:', this.userRole);
    console.log('🎤 isClass:', this.isClass);
    console.log('🎤 isOfficeHours:', this.isOfficeHours);
    console.log('🎤 isTrialLesson:', this.isTrialLesson);
    
    // Only transcribe if:
    // 1. This is a 1:1 lesson (not a class)
    // 2. This is a scheduled lesson (not office hours, not trial)
    // 3. User is a student (to avoid race conditions)
    // 4. We have a lessonId
    if (!this.lessonId || this.userRole !== 'student' || this.isClass || this.isOfficeHours || this.isTrialLesson) {
      console.log('⏭️ SKIPPING DEEPGRAM TRANSCRIPTION - Reason:', {
        noLessonId: !this.lessonId,
        notStudent: this.userRole !== 'student',
        isClass: this.isClass,
        isOfficeHours: this.isOfficeHours,
        isTrialLesson: this.isTrialLesson
      });
      return;
    }

    console.log('✅ All conditions met - Starting Deepgram transcription...');

    try {
      // Get lesson details to find language being learned
      console.log('📋 Fetching lesson details...');
      const lessonResponse = await firstValueFrom(this.lessonService.getLesson(this.lessonId));
      const lesson = lessonResponse?.lesson;
      
      console.log('📋 Lesson data:', {
        hasLesson: !!lesson,
        subject: lesson?.subject,
        isTrialLesson: lesson?.isTrialLesson,
        studentId: lesson?.studentId
      });
      
      if (!lesson) {
        console.warn('⚠️ Could not load lesson for transcription');
        return;
      }

      // Check the AI setting snapshot that was locked at lesson start (join time).
      // Mid-lesson changes do NOT affect the current lesson — only the next one.
      console.log('🤖 Checking AI analysis snapshot (locked at lesson start):', this.aiAnalysisEnabledAtTime);
      
      if (this.aiAnalysisEnabledAtTime === false) {
        console.log('⏭️ SKIPPING TRANSCRIPTION - AI analysis was disabled at lesson start');
        console.log('🎤 === TRANSCRIPTION CHECK END (AI DISABLED AT START) ===');
        return;
      }
      
      console.log('✅ AI analysis enabled at lesson start - proceeding with transcription');

      // Determine language being learned and convert to ISO code
      const languageMap: { [key: string]: string } = {
        'Spanish': 'es',
        'French': 'fr',
        'German': 'de',
        'Italian': 'it',
        'Portuguese': 'pt',
        'English': 'en',
        'Chinese': 'zh',
        'Japanese': 'ja',
        'Korean': 'ko',
        'Russian': 'ru',
        'Arabic': 'ar'
      };
      
      // Normalize "Spanish Lesson" → "Spanish", etc.
      const rawSubject = lesson.subject || 'English';
      const subjectLanguage = rawSubject.replace(/\s*Lesson$/i, '').trim();
      this.lessonLanguage = languageMap[subjectLanguage] || 'en';
      
      console.log(`🎙️ Deepgram language conversion:`, {
        subjectLanguage,
        lessonLanguage: this.lessonLanguage,
        subjectType: typeof lesson.subject,
        languageType: typeof this.lessonLanguage
      });
      
      if (!this.lessonLanguage) {
        console.error('❌ Failed to determine lesson language!');
        return;
      }
      
      console.log(`🎙️ Starting Deepgram transcription for ${subjectLanguage} (${this.lessonLanguage}) lesson`);
      
      // Use the working OpenAI Whisper approach instead of Deepgram
      console.log(`🎙️ Starting OpenAI Whisper transcription for ${subjectLanguage} (${this.lessonLanguage}) lesson`);
      console.log(`🎙️ Calling startTranscription with lessonId: ${this.lessonId}, language: ${this.lessonLanguage}`);
      
      this.transcriptionService.startTranscription(this.lessonId, this.lessonLanguage)
        .subscribe({
          next: (response) => {
            this.isTranscriptionEnabled = true;
            this.currentTranscriptId = response?.transcriptId || '';
            
            // CRITICAL: Also set the transcript ID in the transcription service
            // This is needed for completeTranscription() to work
            this.transcriptionService.currentTranscriptId = response?.transcriptId || '';
            
            console.log('✅ ✅ ✅ WHISPER TRANSCRIPTION STARTED SUCCESSFULLY ✅ ✅ ✅');
              console.log('Response:', response);
              console.log('TranscriptId from response:', response?.transcriptId);
              console.log('✅ Set transcriptionService.currentTranscriptId:', response?.transcriptId);
            
            // Save session to localStorage
            this.saveTranscriptionSession(this.currentTranscriptId);
            
            // Start capturing audio from local microphone
            this.startAudioCapture_FIXED();
            
            // Schedule pre-emptive analysis trigger (1 min before lesson ends)
            this.schedulePreEmptiveAnalysis();
          },
          error: (error) => {
            console.error('❌ ❌ ❌ FAILED TO START WHISPER TRANSCRIPTION ❌ ❌ ❌');
            console.error('Error:', error);
            console.error('Error details:', error?.error || error?.message);
            // Fail silently - don't interrupt the lesson
          }
        });
      
    } catch (error) {
      console.error('❌ Error in startLessonTranscription (Deepgram):', error);
      // Fail silently - don't interrupt the lesson
    }
    
    console.log('🎤 === DEEPGRAM TRANSCRIPTION CHECK END ===');
  }

  /**
   * Schedule a pre-emptive analysis trigger 1 minute before the lesson's scheduled end.
   * This stops transcription and sends it for analysis early, so the student
   * sees the completed analysis immediately on the post-lesson page.
   */
  private schedulePreEmptiveAnalysis(): void {
    // Need both the scheduled start time and booked duration to calculate the end
    if (!this.scheduledLessonStartTime || !this.bookedDuration) {
      console.warn('⏰ Cannot schedule pre-emptive analysis: missing scheduledLessonStartTime or bookedDuration');
      return;
    }

    const scheduledEndMs = this.scheduledLessonStartTime + (this.bookedDuration * 60 * 1000);
    const triggerMs = scheduledEndMs - (60 * 1000); // 1 minute before scheduled end
    const delayMs = triggerMs - Date.now();

    if (delayMs <= 0) {
      console.warn('⏰ Pre-emptive analysis: trigger time is already in the past — skipping timer');
      return;
    }

    // Clear any existing timer
    if (this.preEmptiveAnalysisTimer) {
      clearTimeout(this.preEmptiveAnalysisTimer);
    }

    console.log(`⏰ Pre-emptive analysis scheduled in ${Math.round(delayMs / 1000)}s (1 min before lesson end at ${new Date(scheduledEndMs).toLocaleTimeString()})`);

    this.preEmptiveAnalysisTimer = setTimeout(async () => {
      await this.triggerPreEmptiveAnalysis();
    }, delayMs);
  }

  /**
   * Stop transcription and trigger analysis 1 minute before the lesson ends.
   * The audio capture is stopped, final chunks uploaded, and completeTranscription() called.
   * When the student later clicks "End Call", the analysis should already be done.
   */
  private async triggerPreEmptiveAnalysis(): Promise<void> {
    // Guard: only run once, only if transcription is active, and not already in progress
    if (this.transcriptionCompletedEarly || this.isCompletingTranscription ||
        !this.isTranscriptionEnabled || !this.currentTranscriptId) {
      console.log('⏰ Pre-emptive analysis: skipping (already completed, in progress, or transcription not active)');
      return;
    }

    // If the user is already ending the call, don't interfere
    if (this.isEndingCall) {
      console.log('⏰ Pre-emptive analysis: skipping — endCall() is already running');
      return;
    }

    this.isCompletingTranscription = true; // Acquire mutex
    console.log('⏰🤖 === PRE-EMPTIVE ANALYSIS TRIGGER (1 min before end) ===');

    try {
      // 1. Stop audio capture
      console.log('⏰ Stopping audio capture for pre-emptive analysis...');
      await this.stopAudioCapture_FIXED();
      console.log('⏰ ✅ Audio capture stopped');

      // 2. Wait for final upload to be processed by the backend
      console.log('⏰ Waiting 3s for final upload processing...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 3. Complete the transcription — this triggers Whisper processing + GPT-4 analysis
      console.log('⏰ Completing transcription and triggering analysis...');
      await firstValueFrom(this.transcriptionService.completeTranscription());
      console.log('⏰ ✅ Transcription completed — analysis is now running on the backend');

      // 4. Mark as completed so endCall() doesn't try to do it again
      this.transcriptionCompletedEarly = true;
      this.clearTranscriptionSession();

      console.log('⏰🤖 === PRE-EMPTIVE ANALYSIS COMPLETE ===');
    } catch (error) {
      console.error('⏰ ❌ Pre-emptive analysis failed (non-fatal — endCall will retry):', error);
      // Don't set transcriptionCompletedEarly — let endCall() handle it as a fallback
    } finally {
      this.isCompletingTranscription = false; // Release mutex
    }
  }

  /**
   * Save transcription session to localStorage
   */
  private saveTranscriptionSession(transcriptId: string) {
    if (!transcriptId || !this.lessonId) {
      console.warn('⚠️ Cannot save transcription session: missing transcriptId or lessonId');
      return;
    }
    
    const sessionData = {
      transcriptId,
      lessonId: this.lessonId,
      startTime: new Date().toISOString(),
      language: this.lessonLanguage
    };
    
    try {
      localStorage.setItem(this.TRANSCRIPTION_SESSION_KEY, JSON.stringify(sessionData));
      console.log('💾 Saved transcription session to localStorage:', sessionData);
    } catch (error) {
      console.error('❌ Error saving transcription session:', error);
    }
  }

  /**
   * Check for existing transcription session and auto-resume if valid
   */
  private async checkAndResumeTranscription() {
    try {
      const sessionJson = localStorage.getItem(this.TRANSCRIPTION_SESSION_KEY);
      
      if (!sessionJson) {
        console.log('📝 No saved transcription session found');
        return;
      }
      
      const session = JSON.parse(sessionJson);
      console.log('🔍 Found saved transcription session:', session);
      
      // Validation 1: Is this the same lesson?
      if (session.lessonId !== this.lessonId) {
        console.log('⚠️ Session is for different lesson, cleaning up');
        this.clearTranscriptionSession();
        return;
      }
      
      // Validation 2: Is session too old? (> 2 hours = stale)
      const sessionAge = Date.now() - new Date(session.startTime).getTime();
      const TWO_HOURS = 2 * 60 * 60 * 1000;
      
      if (sessionAge > TWO_HOURS) {
        console.log('⚠️ Session is stale (>2 hours old), cleaning up');
        this.clearTranscriptionSession();
        return;
      }
      
      // Validation 3: Is the lesson still active? (check backend)
      try {
        const response = await firstValueFrom(this.lessonService.getLesson(this.lessonId));
        const lesson = response.lesson;
        
        if (lesson.status === 'completed' || lesson.status === 'cancelled') {
          console.log('⚠️ Lesson already ended, cleaning up session');
          this.clearTranscriptionSession();
          return;
        }
      } catch (lessonError) {
        console.warn('⚠️ Could not validate lesson status:', lessonError);
        // Continue anyway - lesson might just not be loaded yet
      }
      
      // Validation 4: Does the transcription session still exist on backend?
      try {
        const transcript = await firstValueFrom(
          this.transcriptionService.getTranscript(session.transcriptId)
        );
        
        if (transcript.status === 'completed' || transcript.status === 'failed') {
          console.log('⚠️ Transcription already completed/failed, cleaning up');
          this.clearTranscriptionSession();
          return;
        }
      } catch (transcriptError: any) {
        // 404 or error = session doesn't exist anymore
        console.log('⚠️ Transcription session invalid on backend, cleaning up');
        this.clearTranscriptionSession();
        return;
      }
      
      // All validations passed - RESUME transcription!
      console.log('✅ All validations passed - Resuming transcription session automatically');
      this.isTranscriptionEnabled = true;
      this.lessonLanguage = session.language;
      this.currentTranscriptId = session.transcriptId;
      
      // CRITICAL: Also set the transcript ID in the transcription service
      // Without this, completeTranscription() will fail with "No active transcription"
      this.transcriptionService.currentTranscriptId = session.transcriptId;
      console.log('✅ Set transcriptionService.currentTranscriptId:', session.transcriptId);
      
      // Start capturing audio again
      console.log('🎙️ Restarting audio capture for resumed session...');
      setTimeout(() => {
        this.startAudioCapture_FIXED();
      }, 1000); // Small delay to ensure Agora is initialized
      
      // Show a subtle toast (non-blocking)
      this.showToast(this.t('VIDEO_CALL.TRANSCRIPTION_RESUMED'), 'success', 2000);
      
    } catch (error) {
      console.error('❌ Error checking transcription session:', error);
      this.clearTranscriptionSession();
    }
  }

  /**
   * Clear transcription session from localStorage
   */
  private clearTranscriptionSession() {
    try {
      localStorage.removeItem(this.TRANSCRIPTION_SESSION_KEY);
      console.log('🧹 Cleared transcription session from localStorage');
    } catch (error) {
      console.error('❌ Error clearing transcription session:', error);
    }
  }

  /**
   * Show toast message
   */
  private async showToast(message: string, color: 'success' | 'warning' | 'danger' = 'success', duration: number = 2000) {
    try {
      const toast = await this.toastController.create({
        message,
        duration,
        color,
        position: 'bottom'
      });
      await toast.present();
    } catch (error) {
      console.error('❌ Error showing toast:', error);
    }
  }

  /**
   * UNUSED: Old OpenAI transcription method - keeping as fallback
   * Start capturing audio from local microphone for transcription
   */
  private async startAudioCapture_UNUSED() {
    try {
      console.log('🎙️ ========== STARTING AUDIO CAPTURE ==========');
      console.log('🎙️ Starting audio capture for transcription...');
      
      // Get the local audio track from Agora
      const localAudioTrack = this.agoraService.getLocalAudioTrack();
      console.log('🎙️ Local audio track from Agora:', !!localAudioTrack);
      
      if (!localAudioTrack) {
        console.error('❌ No local audio track available');
        return;
      }
      
      // Get the MediaStream from the Agora track
      const mediaStream = localAudioTrack.getMediaStreamTrack();
      console.log('🎙️ Media stream from audio track:', !!mediaStream);
      
      if (!mediaStream) {
        console.error('❌ Could not get media stream from audio track');
        return;
      }
      
      // Create a new MediaStream with just the audio track
      const audioStream = new MediaStream([mediaStream]);
      console.log('🎙️ Created audio stream:', {
        active: audioStream.active,
        id: audioStream.id,
        trackCount: audioStream.getTracks().length
      });
      
      // Create MediaRecorder
      const options: MediaRecorderOptions = {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000 // 128 kbps for good quality
      };
      
      console.log('🎙️ Creating MediaRecorder with options:', options);
      this.transcriptionRecorder = new MediaRecorder(audioStream, options);
      this.transcriptionAudioChunks = [];
      
      console.log('🎙️ MediaRecorder created:', {
        state: this.transcriptionRecorder.state,
        mimeType: this.transcriptionRecorder.mimeType
      });
      
      // Collect audio data
      this.transcriptionRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.transcriptionAudioChunks.push(event.data);
          console.log(`🎙️ ✅ Audio chunk captured: ${event.data.size} bytes (Total chunks: ${this.transcriptionAudioChunks.length})`);
        } else {
          console.warn('⚠️ Audio chunk with 0 bytes received');
        }
      };
      
      this.transcriptionRecorder.onerror = (event) => {
        console.error('❌ MediaRecorder error:', event);
      };
      
      this.transcriptionRecorder.onstart = () => {
        console.log('✅ MediaRecorder STARTED');
      };
      
      this.transcriptionRecorder.onstop = () => {
        console.log('🛑 MediaRecorder STOPPED');
      };
      
      // Start recording with timeslice to get periodic ondataavailable events
      console.log('🎙️ Starting MediaRecorder with 1-second timeslice...');
      this.transcriptionRecorder.start(1000); // Request data every 1 second
      console.log('✅ Audio recording started for transcription, state:', this.transcriptionRecorder.state);
      
      // Upload audio chunks every 10 seconds
      console.log('🎙️ Setting up upload interval (every 10 seconds)...');
      this.transcriptionUploadInterval = setInterval(() => {
        console.log('⏰ Upload interval triggered');
        this.uploadAudioChunk_UNUSED();
      }, 10000); // 10 seconds
      
      console.log('🎙️ ========== AUDIO CAPTURE SETUP COMPLETE ==========');
      
    } catch (error) {
      console.error('❌ Error starting audio capture:', error);
    }
  }

  /**
   * UNUSED: Upload captured audio chunk for transcription
   */
  private uploadAudioChunk_UNUSED() {
    console.log('🎙️ ========== UPLOAD AUDIO CHUNK CALLED ==========');
    console.log('🎙️ Recorder exists:', !!this.transcriptionRecorder);
    console.log('🎙️ Chunks count:', this.transcriptionAudioChunks.length);
    
    if (!this.transcriptionRecorder) {
      console.log('⏭️ Skipping upload - no recorder');
      return;
    }
    
    // If no chunks yet, request data and wait for next interval
    if (this.transcriptionAudioChunks.length === 0) {
      console.log('⏭️ No chunks yet, requesting data...');
      if (this.transcriptionRecorder.state === 'recording') {
        this.transcriptionRecorder.requestData();
      }
      return;
    }
    
    try {
      console.log(`🎙️ Uploading audio chunk (${this.transcriptionAudioChunks.length} chunks)...`);
      console.log('🎙️ Recorder state:', this.transcriptionRecorder.state);
      
      // Create blob from accumulated chunks
      const audioBlob = new Blob(this.transcriptionAudioChunks, { type: 'audio/webm' });
      console.log(`📦 Created audio blob: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
      
      // Skip empty or too-small blobs (likely malformed)
      if (audioBlob.size < 1000) {
        console.warn('⚠️ Audio blob too small, skipping upload');
        this.transcriptionAudioChunks = [];
        return;
      }
      
      // Upload to backend
      const transcriptId = this.transcriptionService.currentTranscriptId;
      console.log('🆔 Transcript ID:', transcriptId);
      
      if (transcriptId) {
        console.log('📤 Uploading to backend...');
        this.transcriptionService.uploadAudio(transcriptId, audioBlob, 'student')
          .subscribe({
            next: (response) => {
              console.log('✅ ✅ ✅ Audio uploaded successfully:', response);
            },
            error: (error) => {
              console.error('❌ ❌ ❌ Error uploading audio:', error);
              // Don't stop recording - just log the error and continue
              // Some chunks may fail due to webm format issues, but that's okay
              console.log('⏩ Continuing to next recording interval...');
            }
          });
      } else {
        console.error('❌ No transcript ID available for upload');
      }
      
      // Clear chunks for next batch (keep recording without stopping)
      console.log('🔄 Clearing chunks, keeping recorder running...');
      this.transcriptionAudioChunks = [];
      
      // Request new data for next upload cycle
      if (this.transcriptionRecorder.state === 'recording') {
        this.transcriptionRecorder.requestData();
        console.log('📝 Requested new data from recorder');
      }
      
      console.log('🎙️ ========== UPLOAD COMPLETE ==========');
      
    } catch (error) {
      console.error('❌ Error uploading audio chunk:', error);
    }
  }

  /**
   * UNUSED: Stop audio capture for transcription
   */
  private stopAudioCapture_UNUSED() {
    console.log('🛑 Stopping audio capture...');
    
    // Stop upload interval
    if (this.transcriptionUploadInterval) {
      clearInterval(this.transcriptionUploadInterval);
      this.transcriptionUploadInterval = null;
    }
    
    // Upload final chunk
    if (this.transcriptionRecorder && this.transcriptionAudioChunks.length > 0) {
      this.uploadAudioChunk_UNUSED();
    }
    
    // Stop recorder
    if (this.transcriptionRecorder && this.transcriptionRecorder.state === 'recording') {
      this.transcriptionRecorder.stop();
      this.transcriptionRecorder = null;
    }
    
    console.log('✅ Audio capture stopped');
  }

  /**
   * Calculate sampling windows based on lesson duration.
   * Only 25-min and 50-min standard lessons are supported.
   * All other durations (trial, office hours, quick, etc.) return empty = no recording.
   */
  private calculateSamplingWindows(durationMinutes: number): { startMin: number; endMin: number }[] {
    if (durationMinutes === 25) {
      // 25-min lesson: 3 windows = 15 min recorded (60%)
      // ┌──────────────────────────────────────────────────────────┐
      // │  [🔴 min 1-6]  ...  [🔴 min 10-15]  ...  [🔴 min 19-24] │
      // │  ▲ Opening        ▲ Mid-lesson core     ▲ Closing        │
      // └──────────────────────────────────────────────────────────┘
      return [
        { startMin: 1, endMin: 6 },     // Opening/warm-up
        { startMin: 10, endMin: 15 },   // Mid-lesson core practice
        { startMin: 19, endMin: 24 },   // Closing/wrap-up
      ];
    }
    
    if (durationMinutes === 50) {
      // 50-min lesson: 3 windows = 15 min recorded (30%)
      // ┌──────────────────────────────────────────────────────────────────┐
      // │  [🔴 min 2-7]  ...silence...  [🔴 min 22-27]  ...  [🔴 min 42-47]  │
      // │  ▲ Opening        ▲ Mid-lesson core         ▲ Closing           │
      // └──────────────────────────────────────────────────────────────────┘
      return [
        { startMin: 2, endMin: 7 },      // Opening/warm-up
        { startMin: 22, endMin: 27 },    // Mid-lesson core practice
        { startMin: 42, endMin: 47 },    // Closing/natural speech
      ];
    }
    
    // Any other duration: no recording
    console.log(`⏭️ No sampling windows for ${durationMinutes}min lesson — only 25 and 50 min lessons are recorded`);
    return [];
  }

  /**
   * Start capturing audio using window-based sampling.
   * Only records for 25-min and 50-min standard lessons.
   * Trial lessons, office hours, quick lessons, and classes are never recorded.
   */
  private async startAudioCapture_FIXED() {
    try {
      console.log('🎙️ ========== STARTING SAMPLED AUDIO CAPTURE ==========');
      
      // Guard: no recording for trial lessons
      if (this.isTrialLesson) {
        console.log('⏭️ SKIPPING audio capture — trial lesson');
        return;
      }
      
      // Guard: no recording for classes (group sessions)
      if (this.isClass) {
        console.log('⏭️ SKIPPING audio capture — class (group session)');
        return;
      }
      
      // Guard: no recording for office hours
      if (this.isOfficeHours) {
        console.log('⏭️ SKIPPING audio capture — office hours');
        return;
      }
      
      // Guard: only 25-min and 50-min lessons get recorded
      const lessonDuration = this.bookedDuration;
      if (lessonDuration !== 25 && lessonDuration !== 50) {
        console.log(`⏭️ SKIPPING audio capture — unsupported duration: ${lessonDuration}min (only 25 and 50 min supported)`);
        return;
      }
      
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      
      this.transcriptionStream = stream;
      console.log('✅ Got direct microphone access');
      
      // Determine audio format
      let selectedType = 'audio/webm';
      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/wav'
      ];
      
      for (const type of preferredTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          selectedType = type;
          console.log(`✅ Using supported audio format: ${type}`);
          break;
        }
      }
      this.transcriptionMimeType = selectedType;
      // Tutor reference uses the same mime type so both batches decode
      // identically on the backend.
      this.tutorReferenceMimeType = selectedType;

      // Calculate sampling windows (guaranteed to be non-empty for 25/50 min)
      this.samplingWindows = this.calculateSamplingWindows(lessonDuration);
      this.lessonStartTimestamp = Date.now();
      this.batchAudioBlobs = [];
      this.transcriptionAudioChunks = [];
      this.isCurrentlyRecording = false;
      this.batchTutorReferenceBlobs = [];
      this.tutorReferenceAudioChunks = [];
      this.isCurrentlyRecordingTutorRef = false;
      
      console.log(`📊 Sampling strategy for ${lessonDuration}min lesson:`, this.samplingWindows);
      console.log(`📊 Total recording time: ${this.samplingWindows.reduce((sum, w) => sum + (w.endMin - w.startMin), 0)} minutes`);
      
      // Check every 10 seconds whether we should be recording
      this.samplingCheckInterval = setInterval(() => {
        this.checkSamplingWindow();
      }, 10000);
      
      // Do an immediate check
      this.checkSamplingWindow();
      
      console.log('🎙️ ========== SAMPLED AUDIO CAPTURE READY ==========');
      
    } catch (error) {
      console.error('❌ Error in sampled audio capture:', error);
    }
  }

  /**
   * Check if we should be recording based on current time in the lesson.
   * Starts/stops the MediaRecorder based on sampling windows.
   */
  private checkSamplingWindow(): void {
    const elapsedMs = Date.now() - this.lessonStartTimestamp;
    const elapsedMin = elapsedMs / 60000;
    
    // Check if we're inside any sampling window
    const shouldRecord = this.samplingWindows.some(
      w => elapsedMin >= w.startMin && elapsedMin < w.endMin
    );
    
    if (shouldRecord && !this.isCurrentlyRecording) {
      // START recording for this window
      this.startWindowRecording();
    } else if (!shouldRecord && this.isCurrentlyRecording) {
      // STOP recording for this window and save the audio
      this.stopWindowRecording();
    }
  }

  /**
   * Start recording for a sampling window. Starts the student-mic recorder
   * AND a parallel tutor-reference recorder (pulling from Agora's remote
   * audio track) so both streams stay aligned in batch-time. The tutor
   * reference is used server-side for VAD-only mic-bleed filtering — it is
   * NEVER transcribed.
   */
  private startWindowRecording(): void {
    if (!this.transcriptionStream || this.isCurrentlyRecording) return;
    
    try {
      const elapsedMin = ((Date.now() - this.lessonStartTimestamp) / 60000).toFixed(1);
      console.log(`🟢 Starting sampling window recording at minute ${elapsedMin}`);
      
      this.transcriptionRecorder = new MediaRecorder(this.transcriptionStream, {
        mimeType: this.transcriptionMimeType,
        audioBitsPerSecond: 64000
      });
      
      this.transcriptionAudioChunks = [];
      
      this.transcriptionRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.transcriptionAudioChunks.push(event.data);
        }
      };
      
      this.transcriptionRecorder.onerror = (event) => {
        console.error('❌ MediaRecorder error:', event);
      };
      
      // Collect data every 30 seconds within the window
      this.transcriptionRecorder.start(30000);
      this.isCurrentlyRecording = true;

      // Kick off the parallel tutor-reference recorder for this window.
      // Started immediately after the student recorder so the two streams
      // begin within milliseconds of each other (drift is absorbed by the
      // overlap tolerance on the backend).
      this.startTutorReferenceWindowRecording();
      
    } catch (error) {
      console.error('❌ Error starting window recording:', error);
    }
  }

  /**
   * Stop recording for a sampling window and save the audio blob. Stops
   * both the student-mic recorder and the tutor-reference recorder.
   */
  private stopWindowRecording(): void {
    if (!this.transcriptionRecorder || !this.isCurrentlyRecording) return;
    
    const elapsedMin = ((Date.now() - this.lessonStartTimestamp) / 60000).toFixed(1);
    console.log(`🔴 Stopping sampling window recording at minute ${elapsedMin}`);
    
    const recorder = this.transcriptionRecorder;
    
    recorder.onstop = () => {
      // Save this window's audio as a blob for batch upload later
      if (this.transcriptionAudioChunks.length > 0) {
        const windowBlob = new Blob(this.transcriptionAudioChunks, { type: this.transcriptionMimeType });
        if (windowBlob.size > 1000) {
          this.batchAudioBlobs.push(windowBlob);
          console.log(`📦 Window audio saved: ${windowBlob.size} bytes (${this.batchAudioBlobs.length} windows stored)`);
        }
      }
      this.transcriptionAudioChunks = [];
    };
    
    if (recorder.state === 'recording') {
      recorder.stop();
    }
    
    this.transcriptionRecorder = null;
    this.isCurrentlyRecording = false;

    // Stop the parallel tutor-reference recorder for this window
    this.stopTutorReferenceWindowRecording();
  }

  /**
   * Locate the tutor's IRemoteAudioTrack via Agora and build a MediaStream
   * from it. Returns null if the tutor hasn't published audio yet (e.g.
   * they joined a moment after the student started recording). The next
   * sampling window will simply retry.
   */
  private getTutorMediaStream(): MediaStream | null {
    try {
      const remoteUsers = this.agoraService.getRemoteUsers();
      if (!remoteUsers || remoteUsers.size === 0) {
        return null;
      }

      for (const [uid, user] of remoteUsers.entries()) {
        const audioTrack = (user as any).audioTrack;
        if (!audioTrack) continue;

        // In 1:1 lessons the only remote audio track IS the tutor's
        // (guards in startLessonTranscription ensure userRole === 'student').
        // If the lesson is a class, identify by isTutor flag.
        const identity = this.remoteUserIdentities.get(uid);
        if (this.isClass && identity && !identity.isTutor) {
          continue;
        }

        const mediaStreamTrack: MediaStreamTrack | undefined = audioTrack.getMediaStreamTrack?.();
        if (!mediaStreamTrack) continue;

        return new MediaStream([mediaStreamTrack]);
      }
    } catch (error) {
      console.warn('⚠️ Failed to acquire tutor MediaStream from Agora (non-fatal):', error);
    }
    return null;
  }

  /**
   * Start the tutor-reference MediaRecorder for the current sampling window.
   * Silently no-ops if the tutor audio track isn't published yet.
   */
  private startTutorReferenceWindowRecording(): void {
    if (this.isCurrentlyRecordingTutorRef) return;

    const tutorStream = this.getTutorMediaStream();
    if (!tutorStream) {
      console.log('⏭️ Tutor reference: no remote audio track available yet — skipping this window');
      return;
    }

    this.tutorReferenceStream = tutorStream;

    try {
      this.tutorReferenceRecorder = new MediaRecorder(tutorStream, {
        mimeType: this.tutorReferenceMimeType,
        audioBitsPerSecond: 32000
      });

      this.tutorReferenceAudioChunks = [];

      this.tutorReferenceRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.tutorReferenceAudioChunks.push(event.data);
        }
      };

      this.tutorReferenceRecorder.onerror = (event) => {
        console.error('❌ Tutor reference MediaRecorder error:', event);
      };

      this.tutorReferenceRecorder.start(30000);
      this.isCurrentlyRecordingTutorRef = true;
      console.log('🎯 Tutor reference recording started for window');
    } catch (error) {
      console.error('❌ Error starting tutor reference recording:', error);
      this.tutorReferenceRecorder = null;
      this.tutorReferenceStream = null;
    }
  }

  /**
   * Stop the tutor-reference recorder for the current sampling window and
   * save the blob for batch upload.
   */
  private stopTutorReferenceWindowRecording(): void {
    if (!this.tutorReferenceRecorder || !this.isCurrentlyRecordingTutorRef) return;

    const recorder = this.tutorReferenceRecorder;

    recorder.onstop = () => {
      if (this.tutorReferenceAudioChunks.length > 0) {
        const windowBlob = new Blob(this.tutorReferenceAudioChunks, { type: this.tutorReferenceMimeType });
        if (windowBlob.size > 1000) {
          this.batchTutorReferenceBlobs.push(windowBlob);
          console.log(`🎯 Tutor reference window saved: ${windowBlob.size} bytes (${this.batchTutorReferenceBlobs.length} windows stored)`);
        }
      }
      this.tutorReferenceAudioChunks = [];
    };

    if (recorder.state === 'recording') {
      recorder.stop();
    }

    this.tutorReferenceRecorder = null;
    this.tutorReferenceStream = null;
    this.isCurrentlyRecordingTutorRef = false;
  }

  /**
   * BATCH UPLOAD: Upload all sampled audio windows as a single concatenated blob at lesson end.
   * This replaces the old per-30-second upload approach.
   *
   * Also uploads the parallel tutor-reference batch BEFORE the student
   * batch, so the backend has the tutor speech intervals ready when the
   * student transcript is completed and analysis runs.
   */
  private async uploadBatchAudio(): Promise<void> {
    console.log('🎙️ ========== BATCH UPLOAD CALLED ==========');
    
    // If currently recording, stop and save the current window first
    if (this.isCurrentlyRecording && this.transcriptionRecorder) {
      await new Promise<void>((resolve) => {
        const recorder = this.transcriptionRecorder!;
        recorder.onstop = () => {
          if (this.transcriptionAudioChunks.length > 0) {
            const windowBlob = new Blob(this.transcriptionAudioChunks, { type: this.transcriptionMimeType });
            if (windowBlob.size > 1000) {
              this.batchAudioBlobs.push(windowBlob);
            }
          }
          this.transcriptionAudioChunks = [];
          resolve();
        };
        if (recorder.state === 'recording') {
          recorder.stop();
        } else {
          resolve();
        }
      });
      this.transcriptionRecorder = null;
      this.isCurrentlyRecording = false;
    }

    // Flush any in-flight tutor reference window in parallel
    if (this.isCurrentlyRecordingTutorRef && this.tutorReferenceRecorder) {
      await new Promise<void>((resolve) => {
        const recorder = this.tutorReferenceRecorder!;
        recorder.onstop = () => {
          if (this.tutorReferenceAudioChunks.length > 0) {
            const windowBlob = new Blob(this.tutorReferenceAudioChunks, { type: this.tutorReferenceMimeType });
            if (windowBlob.size > 1000) {
              this.batchTutorReferenceBlobs.push(windowBlob);
            }
          }
          this.tutorReferenceAudioChunks = [];
          resolve();
        };
        if (recorder.state === 'recording') {
          recorder.stop();
        } else {
          resolve();
        }
      });
      this.tutorReferenceRecorder = null;
      this.tutorReferenceStream = null;
      this.isCurrentlyRecordingTutorRef = false;
    }
    
    if (this.batchAudioBlobs.length === 0) {
      console.log('⏭️ No audio windows to upload');
      return;
    }

    const transcriptId = this.transcriptionService.currentTranscriptId;
    if (!transcriptId) {
      console.error('❌ No transcript ID for batch upload');
      return;
    }

    // Upload tutor reference FIRST so its intervals are stored before the
    // student transcript triggers analysis. Failures here are non-fatal —
    // the student analysis still runs, just without the mic-bleed filter.
    if (this.batchTutorReferenceBlobs.length > 0) {
      const tutorBlob = new Blob(this.batchTutorReferenceBlobs, { type: this.tutorReferenceMimeType });
      console.log(`🎯 Uploading tutor reference batch: ${tutorBlob.size} bytes from ${this.batchTutorReferenceBlobs.length} windows`);

      if (tutorBlob.size >= 1000) {
        try {
          await new Promise<void>((resolve, reject) => {
            this.transcriptionService.uploadTutorReference(transcriptId, tutorBlob)
              .subscribe({
                next: (response) => {
                  console.log('✅ Tutor reference upload success:', response);
                  resolve();
                },
                error: (error) => {
                  console.error('⚠️ Tutor reference upload failed (non-fatal):', error);
                  reject(error);
                }
              });
          });
        } catch (error) {
          // Swallow — analysis will proceed without mic-bleed filter
          console.warn('⚠️ Proceeding without tutor reference (mic-bleed filter disabled for this lesson)');
        }
      } else {
        console.log('⏭️ Tutor reference blob too small, skipping upload');
      }
      this.batchTutorReferenceBlobs = [];
    } else {
      console.log('ℹ️ No tutor reference windows captured — likely tutor audio track was unavailable');
    }

    // Concatenate all student window blobs into one
    const combinedBlob = new Blob(this.batchAudioBlobs, { type: this.transcriptionMimeType });
    console.log(`📦 Combined batch audio: ${combinedBlob.size} bytes from ${this.batchAudioBlobs.length} windows`);
    
    if (combinedBlob.size < 1000) {
      console.log('⏭️ Combined blob too small, skipping');
      return;
    }
    
    console.log('📤 Uploading batch audio to Whisper...');
    try {
      await new Promise<void>((resolve, reject) => {
        this.transcriptionService.uploadAudio(transcriptId, combinedBlob, 'student')
          .subscribe({
            next: (response) => {
              console.log('✅ ✅ ✅ BATCH WHISPER UPLOAD SUCCESS:', response);
              resolve();
            },
            error: (error) => {
              console.error('❌ ❌ ❌ BATCH WHISPER UPLOAD ERROR:', error);
              reject(error);
            }
          });
      });
    } catch (error) {
      console.error('❌ Batch upload failed:', error);
    }
    
    // Clear stored blobs
    this.batchAudioBlobs = [];
  }

  /**
   * Legacy compatibility wrapper - redirects to batch upload.
   */
  private uploadAudioChunk_FIXED(): Promise<void> {
    return this.uploadBatchAudio();
  }

  /**
   * Legacy compatibility wrapper - no longer needed with sampling approach.
   */
  private restartRecorder(_mimeType: string): void {
    // No-op: sampling approach handles recorder lifecycle via window start/stop
  }

  /**
   * Stop audio capture and perform batch upload of all sampled windows.
   */
  private async stopAudioCapture_FIXED(): Promise<void> {
    console.log('🛑 Stopping sampled audio capture...');
    
    try {
      // Stop the sampling check interval
      if (this.samplingCheckInterval) {
        clearInterval(this.samplingCheckInterval);
        this.samplingCheckInterval = null;
        console.log('✅ Sampling check interval cleared');
      }
      
      // Stop legacy upload interval if still running
      if (this.transcriptionUploadInterval) {
        clearInterval(this.transcriptionUploadInterval);
        this.transcriptionUploadInterval = null;
      }
      
      // Perform batch upload of all sampled audio
      console.log('📤 Performing batch upload of all sampled windows...');
      try {
        await Promise.race([
          this.uploadBatchAudio(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Batch upload timeout after 30 seconds')), 30000)
          )
        ]);
        console.log('✅ Batch upload completed');
      } catch (error) {
        console.error('❌ Error in batch upload:', error);
      }
      
      // Stop recorder if still active
      if (this.transcriptionRecorder) {
        if (this.transcriptionRecorder.state === 'recording') {
          this.transcriptionRecorder.stop();
        }
        this.transcriptionRecorder = null;
      }

      // Stop tutor reference recorder if still active. Do NOT stop the
      // underlying MediaStreamTrack — it belongs to Agora and the tutor's
      // audio still needs to be playable.
      if (this.tutorReferenceRecorder) {
        if (this.tutorReferenceRecorder.state === 'recording') {
          this.tutorReferenceRecorder.stop();
        }
        this.tutorReferenceRecorder = null;
      }
      this.tutorReferenceStream = null;
      
      // Release microphone
      if (this.transcriptionStream) {
        this.transcriptionStream.getTracks().forEach(track => {
          track.stop();
          console.log('🛑 Stopped audio track:', track.kind);
        });
        this.transcriptionStream = null;
      }
      
      // Clear all audio data
      this.transcriptionAudioChunks = [];
      this.batchAudioBlobs = [];
      this.isCurrentlyRecording = false;
      this.tutorReferenceAudioChunks = [];
      this.batchTutorReferenceBlobs = [];
      this.isCurrentlyRecordingTutorRef = false;
      
      console.log('✅ Sampled audio capture stopped');
    } catch (error) {
      console.error('❌ Error in stopAudioCapture_FIXED:', error);
    }
  }
  
  /**
   * Stop transcription immediately (called when early exit is confirmed)
   */
  private async stopTranscriptionImmediately(): Promise<void> {
    console.log('🛑🛑🛑 STOPPING TRANSCRIPTION IMMEDIATELY (Early Exit)');
    
    // Cancel pre-emptive analysis timer — we're ending now
    if (this.preEmptiveAnalysisTimer) {
      clearTimeout(this.preEmptiveAnalysisTimer);
      this.preEmptiveAnalysisTimer = null;
    }
    
    // If pre-emptive analysis already completed, nothing more to do
    if (this.transcriptionCompletedEarly) {
      console.log('⏰ Transcription already completed pre-emptively — skipping immediate stop');
      return;
    }
    
    try {
      // Stop audio capture
      await this.stopAudioCapture_FIXED();
      console.log('✅ Audio capture stopped');
      
      // Wait for final upload to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Complete transcription
      if (this.isTranscriptionEnabled && this.currentTranscriptId) {
        console.log('📝 Completing transcription for early exit...');
        this.transcriptionService.completeTranscription().subscribe({
          next: (response) => {
            console.log('✅ Transcription completed after early exit:', response);
          },
          error: (error) => {
            console.error('❌ Error completing transcription:', error);
          }
        });
      }
      
      // Clear session
      this.clearTranscriptionSession();
      this.isTranscriptionEnabled = false;
      
      console.log('✅ Transcription stopped completely');
    } catch (error) {
      console.error('❌ Error stopping transcription immediately:', error);
    }
  }

  /**
   * Complete transcription and show lesson summary
   */
  private async completeLessonWithSummary() {
    console.log('🎯 completeLessonWithSummary called');
    console.log('🎯 isTranscriptionEnabled:', this.isTranscriptionEnabled);
    console.log('🎯 lessonId:', this.lessonId);
    
    // Clear transcription session from localStorage
    this.clearTranscriptionSession();
    
    if (!this.isTranscriptionEnabled) {
      console.warn('⚠️ Transcription was not enabled, skipping analysis modal');
      return;
    }

    try {
      console.log('🎯 Completing Whisper transcription and generating analysis...');
      
      // Stop fixed audio capture and WAIT for final upload
      console.log('🛑 Stopping fixed audio capture and uploading final chunk...');
      await this.stopAudioCapture_FIXED();
      console.log('✅ Audio capture stopped and final chunk uploaded');
      
      // Wait a bit more to be absolutely sure uploads are processed (5 seconds)
      console.log('⏳ Waiting 5 seconds for upload processing...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Complete transcription using OpenAI Whisper
      console.log('📝 Completing transcription now...');
      this.transcriptionService.completeTranscription().subscribe({
        next: async (response) => {
          console.log('✅ Whisper transcription completed:', response);
          console.log('📊 Transcript metadata:', response.metadata);
        },
        error: (error) => {
          console.error('❌ Error completing transcription:', error);
        }
      });
      
      // Poll for analysis instead of fixed timeout
      console.log('⏳ Polling for GPT-4 analysis to complete...');
      let analysisReady = false;
      let attempts = 0;
      const maxAttempts = 60; // 60 attempts × 2 seconds = 2 minutes max
      
      while (!analysisReady && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Check every 2 seconds
        attempts++;
        
        try {
          console.log(`🔍 Checking for analysis (attempt ${attempts}/${maxAttempts})...`);
          const analysis = await firstValueFrom(
            this.transcriptionService.getLessonAnalysis(this.lessonId!)
          );
          
          if (analysis && analysis.status === 'completed') {
            console.log('✅ Analysis ready!', analysis);
            analysisReady = true;
          } else if (analysis && analysis.status === 'failed') {
            console.error('❌ Analysis failed:', analysis);
            break; // Stop polling if analysis failed
          } else {
            console.log(`⏳ Analysis status: ${analysis?.status || 'not found'}, continuing to poll...`);
          }
        } catch (error: any) {
          // Analysis not found yet or still processing - keep polling
          if (error.status === 404) {
            console.log(`⏳ Analysis not ready yet (404), continuing to poll...`);
          } else {
            console.warn(`⚠️ Error checking for analysis:`, error);
          }
        }
      }
      
      if (!analysisReady) {
        console.warn(`⚠️ Analysis not ready after ${maxAttempts} attempts (${maxAttempts * 2} seconds)`);
      }
      
      console.log('📊 Opening lesson summary modal...');
      
      // Show lesson summary modal (use NgZone to avoid assertion errors after navigation)
      try {
        await this.ngZone.run(async () => {
          const modal = await this.modalController.create({
            component: LessonSummaryComponent,
            componentProps: {
              lessonId: this.lessonId
            },
            backdropDismiss: false,
            cssClass: 'fullscreen-modal'  // Use fullscreen modal
          });

          await modal.present();
          console.log('✅ Lesson summary modal presented');
        });
        
      } catch (modalError) {
        console.error('❌ Error showing lesson summary modal:', modalError);
      }
      
    } catch (error) {
      console.error('❌ Error in completeLessonWithSummary:', error);
    }
  }

  /**
   * Prompt tutor to add a quick note after lesson
   */
  async promptTutorNote() {
    try {
      const toast = await this.toastController.create({
        header: this.t('VIDEO_CALL.QUICK_NOTE_HEADER'),
        message: this.t('VIDEO_CALL.QUICK_NOTE_MESSAGE'),
        duration: 8000,
        position: 'bottom',
        cssClass: 'tutor-note-toast',
        buttons: [
          {
            text: this.t('VIDEO_CALL.SKIP'),
            role: 'cancel'
          },
          {
            text: this.t('VIDEO_CALL.ADD_NOTE'),
            handler: () => {
              // Navigate to home tab and trigger modal opening via localStorage
              this.router.navigate(['/tabs/home']).then(() => {
                // Signal to home page to open tutor note modal
                localStorage.setItem('openTutorNoteModal', JSON.stringify({
                  lessonId: this.lessonId,
                  timestamp: Date.now()
                }));
                // Dispatch custom event to trigger modal
                window.dispatchEvent(new CustomEvent('openTutorNoteModal'));
              });
            }
          }
        ]
      });
      await toast.present();
    } catch (error) {
      console.error('❌ Error showing tutor note toast:', error);
    }
  }

  /**
   * Play a notification sound when a participant joins the call
   */
  private playJoinSound(): void {
    console.log('🔔 [VIDEO-CALL] Attempting to play join notification sound...');
    try {
      const audio = new Audio('assets/participant-entry-tone.wav');
      audio.volume = 0.6; // 60% volume
      
      const playPromise = audio.play();
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log('✅ [VIDEO-CALL] Successfully played join notification sound!');
          })
          .catch(err => {
            console.error('❌ [VIDEO-CALL] Failed to play sound:', err);
            console.error('❌ [VIDEO-CALL] Error details:', err.message);
          });
      }
    } catch (error) {
      console.error('❌ [VIDEO-CALL] Exception creating/playing audio:', error);
    }
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.translate.instant(key, params);
  }

  private mapVideoCallConnectError(error: any): string {
    const msg = String(error?.message || error?.error?.message || '');
    if (msg.includes('permission') || msg.includes('NotAllowedError')) {
      return this.t('PRE_CALL.ERROR_PERMISSION');
    }
    if (msg.includes('NotFoundError')) {
      return this.t('PRE_CALL.ERROR_NO_DEVICE');
    }
    if (msg.includes('browser does not support') || msg.includes('ERROR_BROWSER_UNSUPPORTED')) {
      return this.t('VIDEO_CALL.ERROR_BROWSER_UNSUPPORTED');
    }
    if (msg.includes('permissions are required') || msg.includes('ERROR_PERMISSIONS_REQUIRED')) {
      return this.t('VIDEO_CALL.ERROR_PERMISSIONS_REQUIRED');
    }
    return this.t('VIDEO_CALL.ERROR_CONNECT_FAILED');
  }

  private intentTranslationSuffix(intent: string): string {
    const map: Record<string, string> = {
      easy: 'EASY',
      conversational: 'CONVERSATIONAL',
      focused: 'FOCUSED',
      challenge: 'CHALLENGE',
    };
    return map[intent] || 'FOCUSED';
  }

  private refreshIntentBannerKeys(): void {
    if (!this.studentLessonIntent) {
      this.intentBannerLabelKey = '';
      this.intentBannerHintKey = '';
      return;
    }
    const suffix = this.intentTranslationSuffix(this.studentLessonIntent);
    this.intentBannerLabelKey = `VIDEO_CALL.INTENT_${suffix}_LABEL`;
    this.intentBannerHintKey = `VIDEO_CALL.INTENT_${suffix}_HINT`;
  }

  private getRemoteSpeakerLabel(): string {
    return this.userRole === 'tutor'
      ? (this.studentName || this.t('VIDEO_CALL.STUDENT'))
      : (this.tutorName || this.t('VIDEO_CALL.TUTOR'));
  }

  private refreshSpeakerLabels(): void {
    this.localSpeakerName = this.t('VIDEO_CALL.YOU');
    this.remoteSpeakerName = this.getRemoteSpeakerLabel();
  }

  private applyVideoCallI18n(): void {
    this.replyingToYourselfLabel = this.t('VIDEO_CALL.REPLYING_TO_SELF');
    this.refreshIntentBannerKeys();
    this.refreshSpeakerLabels();
    this.impressionOptions = [
      { value: 'excellent', label: this.t('VIDEO_CALL.IMPRESSION_EXCELLENT'), color: 'success' },
      { value: 'great', label: this.t('VIDEO_CALL.IMPRESSION_GREAT'), color: 'primary' },
      { value: 'good', label: this.t('VIDEO_CALL.IMPRESSION_GOOD'), color: 'secondary' },
      { value: 'needs-work', label: this.t('VIDEO_CALL.IMPRESSION_NEEDS_WORK'), color: 'warning' },
    ];
    this.strengthOptions = [
      this.t('VIDEO_CALL.STRENGTH_CONVERSATIONAL_FLUENCY'),
      this.t('VIDEO_CALL.STRENGTH_VOCABULARY'),
      this.t('VIDEO_CALL.STRENGTH_GRAMMAR'),
      this.t('VIDEO_CALL.STRENGTH_PRONUNCIATION'),
      this.t('VIDEO_CALL.STRENGTH_LISTENING'),
      this.t('VIDEO_CALL.STRENGTH_CONFIDENCE'),
      this.t('VIDEO_CALL.STRENGTH_COMPLEX_SENTENCES'),
      this.t('VIDEO_CALL.STRENGTH_NATURAL_EXPRESSIONS'),
    ];
    this.improvementOptions = [
      this.t('VIDEO_CALL.IMPROVE_GRAMMAR'),
      this.t('VIDEO_CALL.IMPROVE_VERB_CONJUGATION'),
      this.t('VIDEO_CALL.IMPROVE_VOCABULARY'),
      this.t('VIDEO_CALL.IMPROVE_PRONUNCIATION'),
      this.t('VIDEO_CALL.IMPROVE_FLUENCY'),
      this.t('VIDEO_CALL.IMPROVE_LISTENING'),
      this.t('VIDEO_CALL.IMPROVE_SENTENCE_COMPLEXITY'),
      this.t('VIDEO_CALL.IMPROVE_IDIOMATIC'),
    ];
    this.errorAreaOptions = [
      this.t('VIDEO_CALL.ERROR_VERB_CONJUGATION'),
      this.t('VIDEO_CALL.ERROR_GENDER_AGREEMENT'),
      this.t('VIDEO_CALL.ERROR_PREPOSITIONS'),
      this.t('VIDEO_CALL.ERROR_TENSE'),
      this.t('VIDEO_CALL.ERROR_VOCABULARY'),
      this.t('VIDEO_CALL.ERROR_PRONUNCIATION'),
      this.t('VIDEO_CALL.ERROR_SENTENCE_STRUCTURE'),
      this.t('VIDEO_CALL.ERROR_ARTICLES'),
    ];
    this.intentDisplay = {
      easy: {
        emoji: '😌',
        label: this.t('VIDEO_CALL.INTENT_EASY_LABEL'),
        hint: this.t('VIDEO_CALL.INTENT_EASY_HINT'),
      },
      conversational: {
        emoji: '💬',
        label: this.t('VIDEO_CALL.INTENT_CONVERSATIONAL_LABEL'),
        hint: this.t('VIDEO_CALL.INTENT_CONVERSATIONAL_HINT'),
      },
      focused: {
        emoji: '🎯',
        label: this.t('VIDEO_CALL.INTENT_FOCUSED_LABEL'),
        hint: this.t('VIDEO_CALL.INTENT_FOCUSED_HINT'),
      },
      challenge: {
        emoji: '🔥',
        label: this.t('VIDEO_CALL.INTENT_CHALLENGE_LABEL'),
        hint: this.t('VIDEO_CALL.INTENT_CHALLENGE_HINT'),
      },
    };
    this.refreshNextLessonStartsText();
    this.cdr.detectChanges();
  }
}
