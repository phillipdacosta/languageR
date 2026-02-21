import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { UserService } from '../services/user.service';
import { LessonService } from '../services/lesson.service';
import { ClassService } from '../services/class.service';
import { AgoraService } from '../services/agora.service';
import { WebSocketService } from '../services/websocket.service';
import { TranscriptionService, LessonAnalysis } from '../services/transcription.service';
import { ReminderService } from '../services/reminder.service';
import { firstValueFrom } from 'rxjs';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-pre-call',
  templateUrl: './pre-call.page.html',
  styleUrls: ['./pre-call.page.scss'],
  standalone: false,
})
export class PreCallPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoPreview', { static: false }) videoPreviewRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('agoraPreview', { static: false }) agoraPreviewRef!: ElementRef<HTMLDivElement>;

  lessonId: string = '';
  lessonTitle: string = '';
  tutorName: string = '';
  studentName: string = '';
  participantName: string = ''; // The other participant (student for tutors, tutor for students)
  isMuted = false; // Default to unmuted (users can toggle off)
  isVideoOff = false; // Default to video on (users can toggle off)
  localStream: MediaStream | null = null;
  isLoading = true; // Camera/mic preview loading (cosmetic only — does NOT block Enter button)
  isLessonReady = false; // True once lesson data is loaded — controls Enter button
  errorMessage: string = '';
  useAgoraForPreview = false; // True when Agora tracks are used for display (after VB activation)
  isTutor: boolean = false;
  isTrialLesson: boolean = false;
  isClass: boolean = false; // Track if this is a class or 1:1 lesson
  otherParticipantJoined: boolean = false;
  otherParticipantName: string = '';
  otherParticipantPicture: string = '';
  private destroy$ = new Subject<void>();
  // Track the tutor for this session so we can adjust tutor-search UI after cancellations
  private lessonTutorId: string | null = null;
  
  // Office Hours waiting room
  isOfficeHoursWaitingRoom: boolean = false;
  waitingForTutorAcceptance: boolean = false; // Student waiting for tutor to accept
  tutorHasAccepted: boolean = false; // Tutor has accepted, student can now enter
  showOfficeHoursRequestModal: boolean = false;
  pendingOfficeHoursRequest: any = null;
  officeHoursRequestTimeout: any = null;
  requestTimeRemaining: number = 30;
  requestCountdownInterval: any = null;
  heartbeatInterval: any = null;
  
  // Track all active intervals to ensure complete cleanup
  private activeIntervals: Set<any> = new Set();
  private isCountdownActive: boolean = false;

  // Student entry countdown (after tutor accepts)
  studentEntryCountdown: number = 60; // 1 minute
  studentEntryTimeout: any = null;
  showStudentEntryCountdown: boolean = false;

  // Virtual background properties
  showVirtualBackgroundControls = false;
  isVirtualBackgroundEnabled = false;
  
  // AI Previous Lesson Notes (for tutors)
  previousLessonNotes: LessonAnalysis | null = null;
  loadingPreviousNotes = false;
  
  // Error recovery
  showRetryButton = false;
  
  // Flag to prevent ngOnDestroy from calling leaveLesson when navigating to video-call
  private isEnteringClassroom = false;
  
  // Audio level monitoring
  audioLevel: number = 0;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animationFrame: number | null = null;


  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private userService: UserService,
    private lessonService: LessonService,
    private classService: ClassService,
    private agoraService: AgoraService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private transcriptionService: TranscriptionService,
    private websocketService: WebSocketService,
    private cdr: ChangeDetectorRef,
    private reminderService: ReminderService
  ) {}

  async ngOnInit() {
    const params = this.route.snapshot.queryParams;
    this.lessonId = params['lessonId'] || '';
    this.isClass = params['isClass'] === 'true';
    const isOfficeHours = params['officeHours'] === 'true';
    
    // Suppress the lesson reminder for this lesson while on pre-call
    if (this.lessonId) {
      this.reminderService.suppressForLesson(this.lessonId);
    }
    const waitingForTutor = params['waitingForTutor'] === 'true';
    
    console.log('🚀 PRE-CALL ngOnInit() - Query Params:', {
      lessonId: this.lessonId,
      isClass: this.isClass,
      isOfficeHours,
      waitingForTutor
    });

    
    // Handle student waiting for tutor to accept office hours request
    // (waitingForTutor flag means this is always a student)
    if (isOfficeHours && waitingForTutor && this.lessonId) {
      console.log('⏳ Student waiting for tutor acceptance');
      console.log('⏳ Lesson ID:', this.lessonId);
      this.isTutor = false;
      this.waitingForTutorAcceptance = true;
      this.tutorHasAccepted = false;
      this.lessonTitle = 'Waiting for Tutor...';
      this.participantName = 'Tutor will join soon';
      
      // Connect to WebSocket to listen for tutor acceptance
      console.log('🔌 Connecting to WebSocket...');
      this.websocketService.connect();
      
      // Wait for connection before setting up listeners
      setTimeout(() => {
        console.log('🔌 WebSocket connected, setting up office hours listener');
        
        // Listen for office hours accepted event
        this.websocketService.officeHoursAccepted$
          .pipe(takeUntil(this.destroy$))
          .subscribe(async (acceptance) => {
            console.log('✅ Received office hours accepted event:', acceptance);
            console.log('✅ Comparing lessonIds:', {
              eventLessonId: acceptance.lessonId,
              currentLessonId: this.lessonId,
              match: acceptance.lessonId === this.lessonId
            });
            
            if (acceptance.lessonId === this.lessonId) {
              console.log('✅ Lesson IDs match! Enabling classroom entry');
              this.tutorHasAccepted = true;
              this.waitingForTutorAcceptance = false;
              this.participantName = acceptance.tutorName;
              
              // Start student entry countdown (1 minute to enter classroom)
              this.startStudentEntryCountdown();
              
              // Force change detection
              this.cdr.detectChanges();
              
              // Show success notification
              const toast = await this.toastController.create({
                message: `${acceptance.tutorName} is ready! You can now enter the classroom.`,
                duration: 4000,
                color: 'success',
                icon: 'checkmark-circle',
                position: 'top'
              });
              await toast.present();
            }
          });
        
        // Also listen for tutor joining the video call
        this.websocketService.lessonPresence$
          .pipe(takeUntil(this.destroy$))
          .subscribe(presence => {
            console.log('👋 Received lesson_participant_joined event (student pre-call):', presence);
            const normalizedEventId = String(presence.lessonId);
            const normalizedCurrentId = String(this.lessonId);
            if (normalizedEventId === normalizedCurrentId && presence.participantRole === 'tutor') {
              console.log('✅ Tutor joined the video call!');
              this.otherParticipantJoined = true;
              this.otherParticipantName = presence.participantName;
              this.otherParticipantPicture = presence.participantPicture || '';
              this.cdr.detectChanges();
            }
          });
        
        // Listen for tutor leaving
        this.websocketService.lessonPresenceLeft$
          .pipe(takeUntil(this.destroy$))
          .subscribe(presence => {
            console.log('👋 Received lesson_participant_left event (student pre-call):', presence);
            const normalizedEventId = String(presence.lessonId);
            const normalizedCurrentId = String(this.lessonId);
            if (normalizedEventId === normalizedCurrentId) {
              console.log('❌ Tutor left the video call');
              this.otherParticipantJoined = false;
              this.otherParticipantName = '';
              this.otherParticipantPicture = '';
              this.cdr.detectChanges();
            }
          });
        
        // IMPORTANT: Listen for lesson cancelled events (when tutor declines)
        this.websocketService.lessonCancelled$
          .pipe(takeUntil(this.destroy$))
          .subscribe(async (cancellation) => {
            console.log('🚫 Received lesson_cancelled event (student waiting):', cancellation);
            const normalizedEventId = String(cancellation.lessonId);
            const normalizedCurrentId = String(this.lessonId);
            if (normalizedEventId === normalizedCurrentId) {
              console.log('❌ Lesson cancelled by tutor - handling cancellation');
              await this.handleLessonCancellation(cancellation);
            }
          });
      }, 1000); // Give WebSocket time to connect
      
      // Load lesson details to get tutor name
      await this.loadLessonDetails();
      this.isLoading = false;
      this.isLessonReady = true;
      return;
    }
    
    // Handle office hours waiting room (tutor waiting for students)
    // No lessonId + officeHours = tutor entering waiting room
    if (isOfficeHours && !this.lessonId) {
      console.log('⚡ Office Hours Waiting Room Mode');
      this.isTutor = true;
      this.isOfficeHoursWaitingRoom = true;
      this.lessonTitle = 'Office Hours - Waiting Room';
      this.participantName = 'Waiting for student...';
      this.isLoading = false;
      
      // Ensure office hours are enabled when entering waiting room
      try {
        await this.userService.toggleOfficeHours(true).toPromise();
        console.log('✅ Office hours enabled for waiting room');
      } catch (error) {
        console.error('❌ Error enabling office hours:', error);
      }
      
      // Connect to WebSocket to listen for office hours bookings
      this.websocketService.connect();
      
      // Start heartbeat to indicate tutor is actively available
      this.startHeartbeat();
      
      // Listen for office hours booking requests
      this.websocketService.newNotification$
        .pipe(takeUntil(this.destroy$))
        .subscribe(notification => {
          console.log('🔔 Notification received in pre-call:', notification);
          if (notification.type === 'office_hours_booking' && notification.urgent) {
            this.handleOfficeHoursRequest(notification);
          }
        });
      
      // Note: Media setup will happen in ngAfterViewInit via setupPreview()
      return;
    }
    
    console.log('✅ Pre-call in regular mode (not waiting room), lessonId:', this.lessonId, 'isOfficeHoursWaitingRoom:', this.isOfficeHoursWaitingRoom);
    
    if (!this.lessonId) {
      this.errorMessage = this.isClass ? 'Class ID is required' : 'Lesson ID is required';
      this.isLoading = false;
      console.log('❌ No lessonId provided, stopping initialization');
      return;
    }

    // Load lesson/class details
    console.log('⏰ About to call loadLessonDetails()...');
    await this.loadLessonDetails();
    console.log('⏰ loadLessonDetails() returned');
    
    console.log('📊 After loadLessonDetails():', {
      isTutor: this.isTutor,
      isTrialLesson: this.isTrialLesson,
      isClass: this.isClass,
      shouldLoadNotes: this.isTutor && !this.isTrialLesson
    });

    // Load previous lesson notes for tutors and students (skip for trial lessons)
    if (!this.isTrialLesson) {
      console.log('✅ Calling loadPreviousLessonNotes() from ngOnInit');
      this.loadPreviousLessonNotes();
    } else {
      console.log('⏭️ NOT calling loadPreviousLessonNotes() - Reason: isTrialLesson');
    }

    // Connect to WebSocket and listen for lesson presence
    this.websocketService.connect();
    
    console.log('🔌 WebSocket connected, setting up presence listeners for lesson:', this.lessonId);
    console.log('🔌 WebSocket connection status:', this.websocketService.getConnectionStatus());
    
    // Listen for participant joined events
    this.websocketService.lessonPresence$
      .pipe(takeUntil(this.destroy$))
      .subscribe(presence => {
        console.log('👋 Received lesson_participant_joined event:', presence);
        const normalizedEventId = String(presence.lessonId);
        const normalizedCurrentId = String(this.lessonId);
        console.log('🔍 Comparing lesson IDs:', { eventId: normalizedEventId, currentId: normalizedCurrentId, match: normalizedEventId === normalizedCurrentId });
        if (normalizedEventId === normalizedCurrentId) {
          console.log('✅ Other participant joined!', presence.participantName);
          this.otherParticipantJoined = true;
          this.otherParticipantName = presence.participantName;
          this.otherParticipantPicture = presence.participantPicture || '';
        }
      });
    
    // Listen for participant left events
    this.websocketService.lessonPresenceLeft$
      .pipe(takeUntil(this.destroy$))
      .subscribe(presence => {
        console.log('👋 Received lesson_participant_left event:', presence);
        const normalizedEventId = String(presence.lessonId);
        const normalizedCurrentId = String(this.lessonId);
        if (normalizedEventId === normalizedCurrentId) {
          console.log('❌ Other participant left');
          this.otherParticipantJoined = false;
          this.otherParticipantName = '';
          this.otherParticipantPicture = '';
        }
      });

    // Listen for lesson cancelled events
    console.log('🚫 Setting up lesson_cancelled listener for lessonId:', this.lessonId);
    this.websocketService.lessonCancelled$
      .pipe(takeUntil(this.destroy$))
      .subscribe(async (cancellation) => {
        console.log('🚫 Received lesson_cancelled event:', cancellation);
        const normalizedEventId = String(cancellation.lessonId);
        const normalizedCurrentId = String(this.lessonId);
        console.log('🔍 Comparing lessonIds:', { eventId: normalizedEventId, currentId: normalizedCurrentId });
        if (normalizedEventId === normalizedCurrentId) {
          console.log('❌ Lesson has been cancelled by:', cancellation.cancelledBy);
          await this.handleLessonCancellation(cancellation);
        } else {
          console.log('⚠️ Lesson ID mismatch, ignoring cancellation');
        }
      });
  }

  async ngAfterViewInit() {
    // Request camera/mic access for preview after view is initialized
    // This ensures videoPreviewRef is available
    await this.setupPreview();
    
    // Safety: ensure isLoading never stays stuck (e.g., if getUserMedia hangs)
    setTimeout(() => {
      if (this.isLoading) {
        console.warn('⚠️ Camera preview loading timed out after 8s — forcing isLoading=false');
        this.isLoading = false;
      }
    }, 8000);
  }

  // Store lesson data to avoid re-fetching
  private currentLessonData: any = null;

  async loadLessonDetails() {
    try {
      console.log('🎓 PRE-CALL: loadLessonDetails() called', {
        lessonId: this.lessonId,
        isClass: this.isClass,
        isOfficeHoursWaitingRoom: this.isOfficeHoursWaitingRoom
      });
      
      // Get current user to determine role from lesson data (not query params)
      const currentUser = await firstValueFrom(this.userService.getCurrentUser());
      const currentUserId = (currentUser as any)?._id || (currentUser as any)?.id;
      
      console.log('🎓 PRE-CALL: Loading session details', { 
        sessionId: this.lessonId, 
        isClass: this.isClass,
        currentUserId
      });
      
      // Load lesson or class details based on isClass flag
      const response = this.isClass 
        ? await firstValueFrom(this.classService.getClass(this.lessonId))
        : await firstValueFrom(this.lessonService.getLesson(this.lessonId));
      
      console.log('🎓 PRE-CALL: API Response:', response);
      
      // Handle both lesson and class responses
      const session = (response as any)?.lesson || (response as any)?.class;
      
      // Store lesson data for later use
      this.currentLessonData = session;
      
      // Check if lesson is already completed (prevents rejoining after early exit)
      if (session?.status === 'completed') {
        console.log('⛔ Lesson already completed, preventing rejoin');
        const alert = await this.alertController.create({
          header: 'Lesson Already Ended',
          message: 'This lesson has already been completed and cannot be rejoined.',
          buttons: [
            {
              text: 'OK',
              handler: () => {
                this.router.navigate(['/tabs/home']);
              }
            }
          ],
          backdropDismiss: false
        });
        await alert.present();
        return;
      }
      
      if (response?.success && session) {
        const lesson = session;
        // Use the entire user object for proper formatting (firstName, lastName, etc.)
        this.tutorName = this.formatName(lesson.tutorId);
        this.studentName = this.formatName(lesson.studentId);
        this.isTrialLesson = lesson.isTrialLesson || false;
        // Cache tutor id for later use (e.g., after cancellations)
        this.lessonTutorId = lesson.tutorId?._id?.toString() || (lesson.tutorId as any)?.id?.toString() || null;
        
        // SECURITY: Determine role from authenticated user + lesson data (never trust URL params)
        const tutorId = lesson.tutorId?._id?.toString() || (typeof lesson.tutorId === 'string' ? lesson.tutorId : '');
        this.isTutor = (currentUserId === tutorId);
        
        console.log('🔐 PRE-CALL: Role determined from lesson data', {
          currentUserId,
          tutorId,
          isTutor: this.isTutor
        });
        
        console.log('🎓 PRE-CALL: Lesson loaded', {
          lessonId: lesson._id,
          isTrialLesson: lesson.isTrialLesson,
          isTrialLessonComponent: this.isTrialLesson,
          isTutor: this.isTutor,
          tutorName: this.tutorName,
          studentName: this.studentName
        });
        
        // For tutors, show student info. For students, show tutor info.
        if (this.isTutor) {
          this.participantName = this.studentName;
          this.lessonTitle = `Class with ${this.studentName}`;
        } else {
          this.participantName = this.tutorName;
          this.lessonTitle = `${this.tutorName}'s Lesson`;
        }
        
        // Check if the other participant has already joined
        // The lesson.participants object contains join/leave info
        console.log('👥 Checking participant presence:', {
          hasParticipants: !!lesson.participants,
          participants: lesson.participants,
          studentId: lesson.studentId?._id,
          tutorId: lesson.tutorId?._id,
          isTutor: this.isTutor
        });
        
        if (lesson.participants && typeof lesson.participants === 'object') {
          const otherParticipantId = this.isTutor 
            ? lesson.studentId?._id 
            : lesson.tutorId?._id;
          
          if (otherParticipantId) {
            const otherParticipantKey = String(otherParticipantId);
            const participantData = lesson.participants[otherParticipantKey];
            
            console.log('👥 Checking participant data:', {
              otherParticipantKey,
              participantData
            });
            
            // If the other participant has joined (has joinedAt) and hasn't left (no leftAt or leftAt is null)
            if (participantData && participantData.joinedAt && !participantData.leftAt) {
              // Other participant has already joined
              console.log('✅ Other participant already in lesson:', {
                isTutor: this.isTutor,
                otherParticipantName: this.isTutor ? this.studentName : this.tutorName,
                joinedAt: participantData.joinedAt
              });
              this.otherParticipantJoined = true;
              if (this.isTutor) {
                this.otherParticipantName = this.studentName;
                this.otherParticipantPicture = lesson.studentId?.picture || '';
              } else {
                this.otherParticipantName = this.tutorName;
                this.otherParticipantPicture = lesson.tutorId?.picture || '';
              }
            } else {
              console.log('⏳ Other participant not yet in lesson');
            }
          }
        }
        
        // Lesson data loaded successfully — enable the Enter button
        this.isLessonReady = true;
        console.log('✅ Lesson is ready — Enter button enabled');
      }
    } catch (error) {
      console.error('Error loading session details:', error);
      this.lessonTitle = this.isClass ? 'Language Class' : 'Language Lesson';
      this.tutorName = 'Tutor';
      this.studentName = 'Student';
      this.participantName = this.isTutor ? this.studentName : this.tutorName;
      // Still allow entry even if lesson details partially failed
      this.isLessonReady = true;
    } finally {
      // NOTE: Do NOT set this.isLoading here — isLoading is the camera preview
      // loading state, managed exclusively by setupPreview(). Lesson-data
      // readiness is tracked by this.isLessonReady instead.
      console.log('✅ loadLessonDetails complete:', {
        isLoading: this.isLoading,
        isLessonReady: this.isLessonReady,
        errorMessage: this.errorMessage,
        isOfficeHoursWaitingRoom: this.isOfficeHoursWaitingRoom,
        buttonShouldBeEnabled: this.isLessonReady && !this.isOfficeHoursWaitingRoom
      });
    }
  }


  async setupPreview() {
    try {
      this.isLoading = true;
      
      // Request camera and microphone permissions
      const constraints: MediaStreamConstraints = {
        video: !this.isVideoOff,
        audio: !this.isMuted
      };

      console.log('📷 setupPreview: requesting getUserMedia with constraints:', constraints);
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      console.log('📷 setupPreview: getUserMedia succeeded', {
        videoTracks: this.localStream.getVideoTracks().length,
        audioTracks: this.localStream.getAudioTracks().length,
        videoTrackState: this.localStream.getVideoTracks()[0]?.readyState,
        audioTrackState: this.localStream.getAudioTracks()[0]?.readyState
      });
      
      // STEP 1: Attach the stream to the video element IMMEDIATELY — even while
      // the element is still visibility:hidden. This starts the browser's video
      // decode pipeline so the feed is ready to display the moment we unhide it.
      const videoElement = this.videoPreviewRef?.nativeElement;
      if (videoElement && !this.isVideoOff) {
        videoElement.muted = true;
        videoElement.srcObject = this.localStream;
        videoElement.play().catch(() => {});
        console.log('📷 setupPreview: attached stream to video element (still hidden)');
      }
      
      // STEP 2: Unhide the video element
      this.isLoading = false;
      this.cdr.detectChanges();
      
      // STEP 3: Re-trigger play() now that the element is fully visible.
      // Some browsers need this after a visibility change.
      if (videoElement) {
        videoElement.play().catch(err => {
          console.warn('⚠️ setupPreview: play() after unhide failed:', err);
        });
      }
      
      // Start audio level monitoring
      this.startAudioMonitoring();
      
      // NOTE: Agora tracks are NOT created here to avoid a dual camera capture
      // conflict that kills the MediaStream preview. Agora is lazily initialized
      // when virtual background is first activated (setBackgroundBlur/setBackgroundColor).
      
      // Safety: retry once after 500ms in case the first play didn't work
      setTimeout(() => {
        const ve = this.videoPreviewRef?.nativeElement;
        if (ve && this.localStream && !this.isVideoOff && !this.useAgoraForPreview) {
          if (!ve.srcObject) {
            console.warn('⚠️ setupPreview: video srcObject was null, retrying...');
            ve.srcObject = this.localStream;
          }
          ve.play().catch(() => {});
        }
      }, 500);
    } catch (error: any) {
      console.error('Error setting up preview:', error);
      this.isLoading = false;
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        this.errorMessage = 'Camera and microphone permissions are required. Please allow access and try again.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        this.errorMessage = 'No camera or microphone found. Please connect a device and try again.';
      } else {
        this.errorMessage = 'Unable to access camera or microphone. Please check your device settings and try again.';
      }
      
      // Add retry button functionality
      this.showRetryButton = true;
    }
  }

  /**
   * Retry camera/microphone setup after error
   */
  async retrySetup() {
    console.log('🔄 Retrying camera/microphone setup...');
    this.errorMessage = '';
    this.showRetryButton = false;
    await this.setupPreview();
  }

  async toggleMicrophone() {
    this.isMuted = !this.isMuted;
    
    // Note: We don't actually disable audio tracks during pre-call
    // The video element is already muted to prevent feedback
    // This just tracks the mute state for when entering the classroom
    // and the UI will show the audio level at 0% when muted
    
    console.log(`🎤 Microphone state toggled: ${this.isMuted ? 'muted' : 'unmuted'} (for call entry only - audio monitoring continues)`);
  }

  async toggleCamera() {
    this.isVideoOff = !this.isVideoOff;
    
    // Check if we're using Agora tracks (for virtual background)
    const agoraVideoTrack = this.agoraService.getLocalVideoTrack();
    
    if (agoraVideoTrack && this.useAgoraForPreview) {
      // If using Agora tracks, toggle the Agora video track
      await agoraVideoTrack.setEnabled(!this.isVideoOff);
      console.log(`📹 Camera ${this.isVideoOff ? 'OFF' : 'ON'} (Agora track)`);
      
      // Re-play the Agora track on the div container when turning camera back on
      if (!this.isVideoOff) {
        const agoraContainer = this.agoraPreviewRef?.nativeElement;
        if (agoraContainer) {
          agoraContainer.innerHTML = '';
          agoraVideoTrack.play(agoraContainer, { mirror: false });
        }
      }
    } else if (this.localStream) {
      // If using MediaStream, toggle MediaStream video tracks
      const videoTracks = this.localStream.getVideoTracks();
      if (videoTracks.length > 0) {
        // Video tracks exist, just enable/disable them
        videoTracks.forEach(track => {
          track.enabled = !this.isVideoOff;
        });
      } else if (!this.isVideoOff) {
        // Video tracks don't exist and user wants to enable video, add them
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
          const newVideoTrack = videoStream.getVideoTracks()[0];
          this.localStream.addTrack(newVideoTrack);
          // Stop the temporary stream (we only need the track)
          videoStream.getTracks().forEach(track => {
            if (track.kind === 'audio') track.stop();
          });
        } catch (error) {
          console.error('Error adding video track:', error);
          this.isVideoOff = true; // Revert the toggle if failed
          return;
        }
      }
      
      // Update video element
      this.updateVideoPreview();
    } else if (!this.isVideoOff) {
      // If stream doesn't exist and user wants to enable video, request it
      await this.setupPreview();
    }
  }

  async testDevices() {
    const alert = await this.alertController.create({
      header: 'Test Devices',
      message: 'This will open device settings. You can test your microphone and camera here.',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Open Settings',
          handler: () => {
            // Request devices again to trigger permission dialog
            this.setupPreview();
          }
        }
      ]
    });
    await alert.present();
  }

  async enterClassroom() {
    // Mark that we're entering the classroom so ngOnDestroy doesn't call leaveLesson
    this.isEnteringClassroom = true;
    
    // Clear student entry countdown since they're entering
    if (this.studentEntryTimeout) {
      clearTimeout(this.studentEntryTimeout);
      this.studentEntryTimeout = null;
      this.showStudentEntryCountdown = false;
      console.log('✅ Cleared student entry countdown - entering classroom');
    }
    
    // Don't allow entering classroom if in office hours waiting mode
    if (this.isOfficeHoursWaitingRoom) {
      console.log('⚠️ Cannot enter classroom while in office hours waiting mode');
      return;
    }
    
    const loading = await this.loadingController.create({
      message: 'Entering classroom...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Stop preview stream - it will be recreated in video-call page
      if (this.localStream) {
        console.log('🛑 Stopping pre-call MediaStream before entering classroom');
        this.localStream.getTracks().forEach(track => {
          track.stop();
          console.log(`🛑 Stopped ${track.kind} track`);
        });
        this.localStream = null;
      }
      
      // Clear Agora preview container (Agora tracks are cleaned up in ngOnDestroy)
      const agoraContainer = this.agoraPreviewRef?.nativeElement;
      if (agoraContainer) {
        agoraContainer.innerHTML = '';
      }

      // DON'T join Agora or initialize client here
      // Let video-call page handle the entire Agora lifecycle
      // This prevents track/DOM attachment issues when navigating
      console.log('🎯 Navigating to video-call - video-call will handle Agora join');

      console.log('🎯 PRE-CALL: Navigating to video-call:', {
        sessionId: this.lessonId,
        isClass: this.isClass,
        isTutor: this.isTutor
      });

      await loading.dismiss();
      
      // Navigate to video-call with minimal params
      // SECURITY: role, userId, userName, agoraUid are derived server-side from the auth token
      this.router.navigate(['/video-call'], {
        queryParams: {
          lessonId: this.lessonId,
          lessonMode: 'true',
          micOn: !this.isMuted,
          videoOn: !this.isVideoOff,
          isClass: this.isClass ? 'true' : 'false'
        }
      });
    } catch (error: any) {
      await loading.dismiss();
      
      // Extract error message from Error object
      let errorMessage = 'Failed to enter classroom';
      if (error?.message) {
        errorMessage = error.message;
      } else if (error?.error?.message) {
        errorMessage = error.error.message;
      }
      
      const alert = await this.alertController.create({
        header: 'Unable to Join Lesson',
        message: errorMessage,
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  async goBack() {
    console.log('🚪 PreCall: goBack() called - cleaning up resources...');
    
    // If in office hours waiting mode, disable office hours
    if (this.isOfficeHoursWaitingRoom) {
      console.log('🔒 Disabling office hours - tutor leaving waiting room');
      try {
        await this.userService.toggleOfficeHours(false).toPromise();
        
        // If there's a pending request, decline it
        if (this.showOfficeHoursRequestModal && this.pendingOfficeHoursRequest) {
          await this.declineOfficeHoursRequest();
        }
      } catch (error) {
        console.error('Error disabling office hours:', error);
      }
    }
    
    // Stop audio monitoring
    this.stopAudioMonitoring();
    
    // Clear video element srcObject first to release camera
    const videoElement = this.videoPreviewRef?.nativeElement;
    if (videoElement) {
      console.log('🎥 Clearing video element srcObject...');
      videoElement.srcObject = null;
      videoElement.load(); // Reset the video element
    }
    
    // Clear Agora preview container
    const agoraContainer = this.agoraPreviewRef?.nativeElement;
    if (agoraContainer) {
      agoraContainer.innerHTML = '';
    }
    
    // Stop preview stream before navigating away
    if (this.localStream) {
      console.log('🛑 Stopping preview MediaStream tracks...');
      this.localStream.getTracks().forEach(track => {
        track.stop();
        console.log('  ⏹️ Stopped track:', track.kind, track.label);
      });
      this.localStream = null;
    }
    
    // Clean up Agora tracks if they were created for virtual background
    try {
      const videoTrack = this.agoraService.getLocalVideoTrack();
      const audioTrack = this.agoraService.getLocalAudioTrack();
      if (videoTrack || audioTrack) {
        console.log('🧹 Cleaning up Agora tracks created for virtual background...');
        await this.agoraService.cleanupLocalTracks();
      }
    } catch (error) {
      console.error('❌ Error cleaning up Agora tracks:', error);
      // Continue with navigation even if cleanup fails
    }
    
    // Call leave endpoint if we have a lessonId/classId
    if (this.lessonId) {
      try {
        if (this.isClass) {
          await firstValueFrom(this.classService.leaveClass(this.lessonId));
        } else {
          await firstValueFrom(this.lessonService.leaveLesson(this.lessonId));
        }
      } catch (error) {
        console.error('🚪 PreCall: Error calling leave endpoint:', error);
        // Continue with navigation even if leave fails
      }
    }
    
    // Navigate back to previous page
    this.location.back();
  }

  /**
   * Load previous lesson notes for tutors
   * Shows AI analysis from last lesson with this student
   * Note: Not shown for trial lessons
   */
  private async loadPreviousLessonNotes() {
    console.log('🔍 loadPreviousLessonNotes() called', {
      isTutor: this.isTutor,
      lessonId: this.lessonId,
      isTrialLesson: this.isTrialLesson,
      isClass: this.isClass,
      hasLessonData: !!this.currentLessonData
    });
    
    if (!this.lessonId || this.isTrialLesson) {
      console.log('⏭️ Skipping previous notes: lessonId=%s, isTrialLesson=%s', 
        this.lessonId, this.isTrialLesson);
      return;
    }

    console.log('✅ Passed first check (lessonId && !isTrialLesson)');

    try {
      console.log('🔄 Getting current user...');
      // Get current user
      const currentUser = await firstValueFrom(this.userService.getCurrentUser());
      console.log('✅ Got current user:', !!currentUser);
      
      if (this.isClass) {
        console.log('⏭️ Skipping previous notes - this is a class (group lesson)');
        return;
      }
      
      console.log('✅ Not a class, proceeding...');
      
      // Use cached lesson data instead of re-fetching
      const lesson = this.currentLessonData;
      
      console.log('🔍 Checking lesson and user data:', {
        hasLesson: !!lesson,
        hasCurrentUser: !!currentUser,
        lessonType: typeof lesson
      });
      
      if (!lesson || !currentUser) {
        console.log('⏭️ Missing lesson or user data for previous notes', {
          hasLesson: !!lesson,
          hasCurrentUser: !!currentUser
        });
        return;
      }
      
      console.log('✅ Have both lesson and user data');
      
      console.log('🔍 Lesson details for notes check:', {
        isOfficeHours: lesson.isOfficeHours,
        isTrialLesson: lesson.isTrialLesson,
        duration: lesson.duration,
        studentId: lesson.studentId?._id || lesson.studentId
      });
      
      // Skip if this is an office hours session (quick session)
      if (lesson.isOfficeHours) {
        console.log('⏭️ Skipping previous notes - this is an office hours session');
        return;
      }

      console.log('✅ Not an office hours session, proceeding...');

      const studentId = lesson.studentId?._id || lesson.studentId;
      const tutorId = lesson.tutorId?._id || lesson.tutorId;

      console.log('🔍 Extracted IDs:', { 
        studentId, 
        tutorId,
        currentUserKeys: Object.keys(currentUser || {})
      });

      if (!studentId || !tutorId) {
        console.log('⏭️ Missing IDs for previous notes', { studentId, tutorId });
        return;
      }

      console.log(`📋 Loading previous lesson notes for student ${studentId} with tutor ${tutorId}...`);
      console.log(`📋 Excluding current lesson: ${this.lessonId}`);
      
      // Only show loading state after we've confirmed we'll make the API call
      this.loadingPreviousNotes = true;

      this.transcriptionService.getLatestAnalysis(studentId, tutorId, this.lessonId).subscribe({
        next: (analysis) => {
          console.log('✅ Previous lesson notes loaded:', {
            lessonDate: analysis.lessonDate,
            lessonId: analysis.lessonId,
            proficiencyLevel: analysis.overallAssessment?.proficiencyLevel,
            hasRecommendedFocus: !!analysis.recommendedFocus?.length
          });
          this.previousLessonNotes = analysis;
          this.loadingPreviousNotes = false;
        },
        error: (error) => {
          // No previous non-trial lessons - that's okay
          console.log('ℹ️ No previous lesson notes available (first regular lesson or no analyses yet)', {
            status: error.status,
            message: error.message
          });
          this.previousLessonNotes = null;
          this.loadingPreviousNotes = false;
        }
      });
    } catch (error) {
      console.error('❌ Error loading previous lesson notes:', error);
      this.previousLessonNotes = null;
      this.loadingPreviousNotes = false;
    }
  }

  ngOnDestroy() {
    console.log('🚪 PreCall: ngOnDestroy() called - cleaning up resources...');
    
    // Unsuppress the lesson reminder (unless entering classroom — video-call will suppress it)
    if (this.lessonId && !this.isEnteringClassroom) {
      this.reminderService.unsuppressForLesson(this.lessonId);
    }
    
    // If in office hours waiting mode, disable office hours
    // (tutor is navigating away without accepting a booking)
    if (this.isOfficeHoursWaitingRoom) {
      console.log('🔒 Disabling office hours - component destroyed');
      this.userService.toggleOfficeHours(false).subscribe({
        next: () => console.log('✅ Office hours disabled on destroy'),
        error: (err) => console.error('❌ Error disabling office hours on destroy:', err)
      });
    }
    
    // Clear office hours timeout and all countdown intervals
    if (this.officeHoursRequestTimeout) {
      clearTimeout(this.officeHoursRequestTimeout);
    }
    this.clearAllCountdownIntervals();
    
    // Clear student entry timeout
    if (this.studentEntryTimeout) {
      clearTimeout(this.studentEntryTimeout);
      this.studentEntryTimeout = null;
    }
    
    // Stop heartbeat
    this.stopHeartbeat();
    
    // Clean up subscriptions
    this.destroy$.next();
    this.destroy$.complete();
    
    // Stop audio monitoring
    this.stopAudioMonitoring();
    
    // Clear video element srcObject to release camera
    try {
      const videoElement = this.videoPreviewRef?.nativeElement;
      if (videoElement) {
        console.log('🎥 Clearing video element srcObject in ngOnDestroy...');
        videoElement.srcObject = null;
        videoElement.load(); // Reset the video element
      }
    } catch (error) {
      console.error('❌ Error clearing video element:', error);
    }
    
    // Clear Agora preview container
    try {
      const agoraContainer = this.agoraPreviewRef?.nativeElement;
      if (agoraContainer) {
        agoraContainer.innerHTML = '';
      }
    } catch (error) {
      console.error('❌ Error clearing Agora container:', error);
    }
    
    // Clean up media stream
    if (this.localStream) {
      console.log('🛑 Stopping preview MediaStream tracks in ngOnDestroy...');
      this.localStream.getTracks().forEach(track => {
        track.stop();
        console.log('  ⏹️ Stopped track:', track.kind, track.label);
      });
      this.localStream = null;
    }
    
    // Only clean up Agora tracks and call leave endpoint if NOT entering the classroom
    // When entering classroom, the video-call page will handle Agora lifecycle
    // Calling leaveLesson here would race with the video-call's joinLesson and mark the user as "left"
    if (!this.isEnteringClassroom) {
      // Clean up Agora tracks if they were created for virtual background
      // Note: We can't use async/await in ngOnDestroy, so we fire and forget
      const videoTrack = this.agoraService.getLocalVideoTrack();
      const audioTrack = this.agoraService.getLocalAudioTrack();
      if (videoTrack || audioTrack) {
        console.log('🧹 Cleaning up Agora tracks in ngOnDestroy (fire and forget)...');
        this.agoraService.cleanupLocalTracks()
          .then(() => {
            console.log('✅ Agora tracks cleaned up successfully in ngOnDestroy');
          })
          .catch((error) => {
            console.error('❌ Error cleaning up Agora tracks in ngOnDestroy:', error);
          });
      }
      
      // Call leave endpoint when leaving the pre-call page (going back, not entering classroom)
      // Note: We can't use async/await in ngOnDestroy, so we fire and forget
      if (this.lessonId) {
        console.log('🚪 PreCall: Calling leave endpoint (user went back, not entering classroom)');
        const leaveObservable = this.isClass 
          ? this.classService.leaveClass(this.lessonId)
          : this.lessonService.leaveLesson(this.lessonId);
        
        firstValueFrom(leaveObservable)
          .then(() => {
          })
          .catch((error) => {
            console.error('🚪 PreCall: Error calling leave endpoint in ngOnDestroy:', error);
          });
      }
    } else {
      console.log('🚪 PreCall: Skipping leaveLesson/cleanupTracks - entering classroom');
    }
  }


















  // Update the video preview (simple MediaStream only)
  updateVideoPreview() {
    const videoElement = this.videoPreviewRef?.nativeElement;
    
    console.log('📷 updateVideoPreview called:', {
      hasVideoElement: !!videoElement,
      isVideoOff: this.isVideoOff,
      hasLocalStream: !!this.localStream,
      useAgoraForPreview: this.useAgoraForPreview,
      isLoading: this.isLoading
    });
    
    if (!videoElement) {
      console.warn('⚠️ updateVideoPreview: videoPreviewRef is null — element not in DOM yet');
      return;
    }

    if (this.isVideoOff) {
      videoElement.srcObject = null;
      return;
    }

    // Use MediaStream for video preview
    if (this.localStream) {
      // Ensure video element is muted to prevent audio feedback
      videoElement.muted = true;
      videoElement.srcObject = this.localStream;
      
      const playPromise = videoElement.play();
      if (playPromise) {
        playPromise.then(() => {
          console.log('✅ updateVideoPreview: video play() succeeded');
        }).catch(err => {
          console.error('❌ updateVideoPreview: video play() failed:', err);
          // Retry play after a short delay (some browsers need user interaction first)
          setTimeout(() => {
            videoElement.play().catch(() => {});
          }, 300);
        });
      }
      
      // Start monitoring audio levels for visual feedback
      this.startAudioMonitoring();
    } else {
      console.warn('⚠️ updateVideoPreview: no localStream available');
    }
  }

  // Initialize Agora client for virtual background support
  async initializeAgoraForVirtualBackground(): Promise<void> {
    try {
      console.log('🎯 Initializing Agora client for virtual background...');
      
      // Initialize Agora client (this will also initialize the virtual background extension)
      await this.agoraService.initializeClient();
      
      // Create Agora tracks - this is essential for virtual background to work
      console.log('🎯 Creating Agora video and audio tracks...');
      await this.agoraService.createMicrophoneAndCameraTracks();
      
      // Verify tracks were created
      const videoTrack = this.agoraService.getLocalVideoTrack();
      const audioTrack = this.agoraService.getLocalAudioTrack();
      
      console.log('🔍 DEBUG: Agora tracks created:', {
        videoTrack: !!videoTrack,
        audioTrack: !!audioTrack
      });
      
      if (!videoTrack) {
        throw new Error('Failed to create Agora video track');
      }
      
      // Keep the Agora audio track enabled for monitoring
      // The video element is muted so there won't be any feedback
      // This allows the audio level indicator to work properly
      console.log('✅ Agora tracks created successfully for virtual background support (audio enabled for monitoring)');
    } catch (error) {
      console.error('❌ Failed to initialize Agora for virtual background:', error);
      throw error; // Re-throw so calling code knows it failed
    }
  }

  // Virtual Background Methods (following official Agora example)
  toggleVirtualBackgroundControls(): void {
    this.showVirtualBackgroundControls = !this.showVirtualBackgroundControls;
  }

  async setBackgroundBlur(): Promise<void> {
    try {
      console.log('🌀 Setting background blur...');
      
      // Ensure Agora tracks are available
      const videoTrack = this.agoraService.getLocalVideoTrack();
      if (!videoTrack) {
        console.log('🔄 No Agora video track found, initializing...');
        await this.initializeAgoraForVirtualBackground();
      }
      
      // Verify track is now available
      const verifyTrack = this.agoraService.getLocalVideoTrack();
      if (!verifyTrack) {
        throw new Error('Failed to create Agora video track for virtual background');
      }
      
      await this.agoraService.setBackgroundBlur(2); // Medium blur
      this.isVirtualBackgroundEnabled = true;
      
      // Update video preview to show Agora track with blur
      this.updateVideoPreviewWithAgoraTrack();
      
      // Debug: Check if state was stored correctly
      const vbState = this.agoraService.getVirtualBackgroundState();
      console.log('🔍 DEBUG: Virtual background state after setting blur:', JSON.stringify(vbState, null, 2));
      
      console.log('✅ Background blur enabled successfully');
      
      // Close the virtual background controls panel
      this.showVirtualBackgroundControls = false;
    } catch (error) {
      console.error('❌ Failed to set background blur:', error);
      
      const alert = await this.alertController.create({
        header: 'Background Blur Error',
        message: `Failed to enable background blur: ${error instanceof Error ? error.message : 'Unknown error'}`,
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  async setBackgroundColor(color: string = '#00ff00'): Promise<void> {
    try {
      console.log('🎨 Setting background color:', color);
      
      // Ensure Agora tracks are available
      const videoTrack = this.agoraService.getLocalVideoTrack();
      if (!videoTrack) {
        console.log('🔄 No Agora video track found, initializing...');
        await this.initializeAgoraForVirtualBackground();
      }
      
      // Verify track is now available
      const verifyTrack = this.agoraService.getLocalVideoTrack();
      if (!verifyTrack) {
        throw new Error('Failed to create Agora video track for virtual background');
      }
      
      await this.agoraService.setBackgroundColor(color);
      this.isVirtualBackgroundEnabled = true;
      
      // Update video preview to show Agora track with color background
      this.updateVideoPreviewWithAgoraTrack();
      
      console.log('✅ Background color set successfully');
      
      // Close the virtual background controls panel
      this.showVirtualBackgroundControls = false;
    } catch (error) {
      console.error('❌ Failed to set background color:', error);
      
      const alert = await this.alertController.create({
        header: 'Background Color Error',
        message: `Failed to set background color: ${error instanceof Error ? error.message : 'Unknown error'}`,
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  async disableVirtualBackground(): Promise<void> {
    try {
      console.log('🚫 Disabling virtual background...');
      await this.agoraService.disableVirtualBackground();
      this.isVirtualBackgroundEnabled = false;
      
      // Keep using Agora track for display (just without VB processing now).
      // No need to recreate MediaStream — the Agora track shows the raw camera.
      const agoraContainer = this.agoraPreviewRef?.nativeElement;
      const agoraVideoTrack = this.agoraService.getLocalVideoTrack();
      if (agoraContainer && agoraVideoTrack) {
        agoraContainer.innerHTML = '';
        agoraVideoTrack.play(agoraContainer, { mirror: false });
        console.log('✅ Replayed Agora track without VB processing');
      }
      
      console.log('✅ Virtual background disabled successfully');
      
      // Close the virtual background controls panel
      this.showVirtualBackgroundControls = false;
    } catch (error) {
      console.error('❌ Failed to disable virtual background:', error);
    }
  }

  // Update video preview to show Agora track (with virtual background effects)
  // Uses the dedicated #agoraPreview div container — Agora's play() creates a <video> child inside it
  private updateVideoPreviewWithAgoraTrack(): void {
    const agoraContainer = this.agoraPreviewRef?.nativeElement;
    const agoraVideoTrack = this.agoraService.getLocalVideoTrack();
    
    if (agoraContainer && agoraVideoTrack) {
      try {
        // Stop the original MediaStream since Agora has taken over the camera
        if (this.localStream) {
          this.localStream.getTracks().forEach(track => {
            track.stop();
            console.log(`🔇 Stopped MediaStream ${track.kind} track — Agora taking over`);
          });
          this.localStream = null;
        }
        
        // Clear the original video element
        const videoElement = this.videoPreviewRef?.nativeElement;
        if (videoElement) {
          videoElement.srcObject = null;
        }
        
        // Switch display mode to Agora
        this.useAgoraForPreview = true;
        
        // Use setTimeout to let Angular update DOM (show the div, hide the video)
        setTimeout(() => {
          // Clear previous Agora rendering
          agoraContainer.innerHTML = '';
          
          // Play the Agora track into the div container
          // Agora creates its own <video> child element inside the div
          agoraVideoTrack.play(agoraContainer, { mirror: false });
          console.log('✅ Switched to Agora video track display (mirror disabled)');
          
          // Start monitoring Agora audio levels
          this.startAudioMonitoring();
        }, 0);
      } catch (error) {
        console.error('❌ Failed to play Agora video track:', error);
        // Fallback to original MediaStream
        this.useAgoraForPreview = false;
        this.setupPreview();
      }
    }
  }

  // Start monitoring audio levels for visual feedback
  private startAudioMonitoring(): void {
    try {
      // Stop any existing monitoring
      this.stopAudioMonitoring();
      
      // Get the active audio track (Agora or MediaStream)
      const agoraAudioTrack = this.agoraService.getLocalAudioTrack();
      let audioStream: MediaStream | null = null;
      
      if (agoraAudioTrack) {
        // Get MediaStreamTrack from Agora track
        console.log('🎤 Using Agora audio track for monitoring');
        const mediaStreamTrack = agoraAudioTrack.getMediaStreamTrack();
        console.log('🔍 Agora audio track state:', {
          enabled: mediaStreamTrack.enabled,
          muted: mediaStreamTrack.muted,
          readyState: mediaStreamTrack.readyState
        });
        audioStream = new MediaStream([mediaStreamTrack]);
      } else if (this.localStream) {
        console.log('🎤 Using MediaStream audio track for monitoring');
        audioStream = this.localStream;
      }
      
      if (!audioStream) {
        console.log('⚠️ No audio stream available for monitoring');
        return;
      }
      
      // Create audio context and analyser
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(audioStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      
      // Start the monitoring loop
      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      
      const updateLevel = () => {
        if (!this.analyser) {
          this.audioLevel = 0;
          return;
        }
        
        this.analyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        
        // Convert to percentage (0-100) and smooth it out
        // The UI will handle showing 0 when muted, but we keep monitoring
        this.audioLevel = Math.min(100, (average / 128) * 100);
        
        // Continue monitoring
        this.animationFrame = requestAnimationFrame(updateLevel);
      };
      
      updateLevel();
      console.log('🎤 Audio level monitoring started');
    } catch (error) {
      console.error('❌ Failed to start audio monitoring:', error);
    }
  }

  // Stop monitoring audio levels
  private stopAudioMonitoring(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.analyser = null;
    this.audioLevel = 0;
    console.log('🎤 Audio level monitoring stopped');
  }

  // Format user name to "First L." format (e.g., "Phillip D.")
  private formatName(user: any): string {
    if (!user) return 'User';
    
    // Try firstName and lastName first
    if (user.firstName && user.lastName) {
      return `${this.capitalize(user.firstName)} ${user.lastName.charAt(0).toUpperCase()}.`;
    }
    
    // Try just firstName
    if (user.firstName) {
      return this.capitalize(user.firstName);
    }
    
    // Fall back to name property
    if (user.name) {
      return this.formatNameString(user.name);
    }
    
    // Fall back to email
    if (user.email) {
      return this.formatNameString(user.email);
    }
    
    return 'User';
  }

  // Format a name string to "First L." format
  private formatNameString(nameStr: string): string {
    if (!nameStr || typeof nameStr !== 'string') {
      return 'User';
    }

    const name = nameStr.trim();

    // If it's an email, use the part before @
    if (name.includes('@')) {
      const base = name.split('@')[0];
      if (!base) return 'User';
      const parts = base.split(/[.\s_]+/).filter(Boolean);
      const first = parts[0];
      const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : '';
      return lastInitial
        ? `${this.capitalize(first)} ${lastInitial.toUpperCase()}.`
        : this.capitalize(first);
    }

    // Split by spaces
    const parts = name.split(' ').filter(Boolean);
    if (parts.length === 1) {
      return this.capitalize(parts[0]);
    }

    const first = this.capitalize(parts[0]);
    const last = parts[parts.length - 1];
    const lastInitial = last ? last[0].toUpperCase() : '';
    return lastInitial ? `${first} ${lastInitial}.` : first;
  }

  private capitalize(value: string): string {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }

  // Clear all countdown intervals with detailed logging
  private clearAllCountdownIntervals() {
    console.log('🧹 Clearing all countdown intervals');
    console.log('🧹 Before cleanup - activeIntervals size:', this.activeIntervals.size);
    console.log('🧹 Before cleanup - requestCountdownInterval:', this.requestCountdownInterval);
    
    // Clear the main tracked interval
    if (this.requestCountdownInterval) {
      console.log('🧹 Clearing main countdown interval:', this.requestCountdownInterval);
      clearInterval(this.requestCountdownInterval);
      this.activeIntervals.delete(this.requestCountdownInterval);
      this.requestCountdownInterval = null;
    }
    
    // Clear all tracked intervals
    this.activeIntervals.forEach(intervalId => {
      console.log('🧹 Clearing tracked interval:', intervalId);
      clearInterval(intervalId);
    });
    this.activeIntervals.clear();
    
    // Reset timer state and flag
    this.requestTimeRemaining = 30;
    this.isCountdownActive = false;
    
    console.log('✅ Cleanup complete - activeIntervals size:', this.activeIntervals.size);
    console.log('✅ Cleanup complete - requestCountdownInterval:', this.requestCountdownInterval);
    console.log('✅ Cleanup complete - isCountdownActive:', this.isCountdownActive);
    console.log('✅ Timer reset to:', this.requestTimeRemaining);
  }

  // Handle incoming office hours booking request
  async handleOfficeHoursRequest(notification: any) {
    console.log('⚡ Office Hours Request:', notification);
    
    // Aggressively clear ALL countdown intervals first
    this.clearAllCountdownIntervals();
    
    // Clear any existing timeout
    if (this.officeHoursRequestTimeout) {
      console.log('🧹 Clearing previous office hours timeout');
      clearTimeout(this.officeHoursRequestTimeout);
      this.officeHoursRequestTimeout = null;
    }
    
    // Reset modal state
    this.showOfficeHoursRequestModal = false;
    this.pendingOfficeHoursRequest = null;
    
    // Small delay to ensure UI state is clean
    setTimeout(() => {
      console.log('🔄 Setting up new office hours request with fresh timer');
      this.pendingOfficeHoursRequest = notification;
      this.showOfficeHoursRequestModal = true;
      this.requestTimeRemaining = 30;
      
      // Prevent multiple intervals with flag check
      if (this.isCountdownActive) {
        console.error('❌ COUNTDOWN ALREADY ACTIVE! Preventing duplicate interval creation');
        return;
      }
      
      console.log('✅ Creating new countdown interval...');
      this.isCountdownActive = true;
      
      // Start countdown timer and track it
      this.requestCountdownInterval = setInterval(() => {
        this.requestTimeRemaining--;
        console.log('⏰ Countdown:', this.requestTimeRemaining, 'active flag:', this.isCountdownActive, 'intervals tracked:', this.activeIntervals.size);
      }, 1000);
      
      // Add to tracked intervals
      this.activeIntervals.add(this.requestCountdownInterval);
      console.log('✅ Started new countdown, interval ID:', this.requestCountdownInterval, 'total intervals:', this.activeIntervals.size);
      
      // Auto-decline after 30 seconds
      this.officeHoursRequestTimeout = setTimeout(async () => {
        this.clearAllCountdownIntervals();
        if (this.showOfficeHoursRequestModal) {
          console.log('⏰ Office hours request timed out');
          await this.handleRequestTimeout();
        }
      }, 30000);
    }, 100);
  }

  // Start student entry countdown after tutor accepts
  startStudentEntryCountdown() {
    console.log('⏰ Starting student entry countdown (60 seconds)');
    this.showStudentEntryCountdown = true;
    this.studentEntryCountdown = 60;
    
    // Update countdown every second
    const countdownInterval = setInterval(() => {
      this.studentEntryCountdown--;
      this.cdr.detectChanges();
      
      if (this.studentEntryCountdown <= 0) {
        clearInterval(countdownInterval);
      }
    }, 1000);
    
    // Auto-cancel session after 60 seconds if student doesn't enter
    this.studentEntryTimeout = setTimeout(async () => {
      clearInterval(countdownInterval);
      if (this.showStudentEntryCountdown) {
        console.log('⏰ Student entry timeout - cancelling session');
        await this.handleStudentEntryTimeout();
      }
    }, 60000);
  }

  // Handle student entry timeout
  async handleStudentEntryTimeout() {
    this.showStudentEntryCountdown = false;
    
    // Cancel the lesson
    if (this.lessonId) {
      try {
        await this.lessonService.updateLessonStatus(this.lessonId, 'cancelled').toPromise();
        console.log('✅ Lesson cancelled due to student entry timeout');
      } catch (error) {
        console.error('Error cancelling lesson on student timeout:', error);
      }
    }
    
    // Show alert to student
    const alert = await this.alertController.create({
      header: 'Session Expired',
      message: 'You took too long to enter the classroom. The session has been cancelled to avoid wasting the tutor\'s time. You have not been charged.',
      buttons: [
        {
          text: 'Find Another Tutor',
          handler: async () => {
            console.log('🚪 Student timeout - using goBack() logic');
            
            // Stop audio monitoring
            this.stopAudioMonitoring();
            
            // Clear video element srcObject first to release camera
            const videoElement = this.videoPreviewRef?.nativeElement;
            if (videoElement) {
              console.log('🎥 Clearing video element srcObject...');
              videoElement.srcObject = null;
              videoElement.load(); // Reset the video element
            }
            
            // Stop preview stream before navigating away
            if (this.localStream) {
              console.log('🛑 Stopping preview MediaStream tracks...');
              this.localStream.getTracks().forEach(track => {
                track.stop();
                console.log('  ⏹️ Stopped track:', track.kind, track.label);
              });
              this.localStream = null;
            }
            
            // Clean up Agora tracks if they were created for virtual background
            try {
              const videoTrack = this.agoraService.getLocalVideoTrack();
              const audioTrack = this.agoraService.getLocalAudioTrack();
              if (videoTrack || audioTrack) {
                console.log('🧹 Cleaning up Agora tracks created for virtual background...');
                await this.agoraService.cleanupLocalTracks();
              }
            } catch (error) {
              console.error('❌ Error cleaning up Agora tracks:', error);
              // Continue with navigation even if cleanup fails
            }
            
            // Call leave endpoint if we have a lessonId/classId
            if (this.lessonId) {
              try {
                if (this.isClass) {
                  await firstValueFrom(this.classService.leaveClass(this.lessonId));
                } else {
                  await firstValueFrom(this.lessonService.leaveLesson(this.lessonId));
                }
              } catch (error) {
                console.error('🚪 PreCall: Error calling leave endpoint:', error);
                // Continue with navigation even if leave fails
              }
            }
            
            // Navigate to tutor search and force refresh data
            // Clear any stale data to force refresh in tutor search
            localStorage.removeItem('tutorSearchHasLoadedOnce');
            localStorage.setItem('forceRefreshTutors', 'true');
            
            this.router.navigate(['/tabs/tutor-search']);
            
            return true; // Allow alert to dismiss
          }
        }
      ],
      backdropDismiss: false
    });
    await alert.present();
  }

  // Start sending heartbeat to backend
  startHeartbeat() {
    console.log('💓 Starting office hours heartbeat...');
    
    // Send initial heartbeat immediately
    this.userService.sendOfficeHoursHeartbeat().subscribe({
      next: (res) => console.log('💓 Initial heartbeat sent:', res),
      error: (err) => this.handleHeartbeatError(err)
    });
    
    // Send heartbeat every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      this.userService.sendOfficeHoursHeartbeat().subscribe({
        next: (res) => console.log('💓 Heartbeat sent:', res),
        error: (err) => this.handleHeartbeatError(err)
      });
    }, 30000);
  }

  // Handle heartbeat errors (e.g., schedule conflicts)
  async handleHeartbeatError(err: any) {
    console.error('💓 Heartbeat error:', err);
    
    // If there's a schedule conflict (409), show alert and redirect
    if (err.status === 409) {
      this.stopHeartbeat();
      
      const alert = await this.alertController.create({
        header: '⚠️ Schedule Conflict',
        message: err.error?.message || 'You have a lesson/class starting soon. Office Hours have been disabled.',
        buttons: [
          {
            text: 'OK',
            handler: () => {
              this.router.navigate(['/tabs/tutor-calendar']);
            }
          }
        ]
      });
      await alert.present();
    }
  }

  // Stop heartbeat
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      console.log('💓 Stopping office hours heartbeat...');
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async handleRequestTimeout() {
    const lessonId = this.pendingOfficeHoursRequest?.lessonId || this.pendingOfficeHoursRequest?.data?.lessonId;
    console.log('⏰ Office hours request timed out, lessonId:', lessonId);
    
    this.showOfficeHoursRequestModal = false;
    this.pendingOfficeHoursRequest = null;
    
    // Cancel the lesson to notify the student
    if (lessonId) {
      try {
        await this.lessonService.updateLessonStatus(lessonId, 'cancelled').toPromise();
        console.log('✅ Lesson cancelled due to timeout');
      } catch (error) {
        console.error('Error cancelling lesson on timeout:', error);
      }
    }
    
    // Disable office hours since tutor didn't respond
    try {
      await this.userService.toggleOfficeHours(false).toPromise();
      
      const alert = await this.alertController.create({
        header: 'Office Hours Disabled',
        message: 'You missed a student request. Office Hours have been automatically disabled. Please only enable when you\'re actively monitoring.',
        buttons: ['OK']
      });
      await alert.present();
      
      // Navigate back to calendar
      this.router.navigate(['/tabs/tutor-calendar']);
    } catch (error) {
      console.error('Error disabling office hours:', error);
    }
  }

  async acceptOfficeHoursRequest() {
    if (!this.pendingOfficeHoursRequest) return;
    
    // Clear timeout and all countdown intervals
    if (this.officeHoursRequestTimeout) {
      clearTimeout(this.officeHoursRequestTimeout);
      this.officeHoursRequestTimeout = null;
    }
    this.clearAllCountdownIntervals();
    
    const lessonId = this.pendingOfficeHoursRequest.lessonId || this.pendingOfficeHoursRequest.data?.lessonId;
    console.log('✅ Accepting office hours request, lessonId:', lessonId);
    
    this.showOfficeHoursRequestModal = false;
    
    // Update lesson status to 'confirmed' on backend (this will notify the student)
    try {
      await this.lessonService.updateLessonStatus(lessonId, 'confirmed').toPromise();
      console.log('✅ Lesson status updated to confirmed, student has been notified');
    } catch (error) {
      console.error('Error updating lesson status:', error);
    }
    
    // Disable office hours to prevent double bookings
    // (tutor is now committed to this session)
    console.log('🔒 Disabling office hours - tutor committed to session');
    try {
      await this.userService.toggleOfficeHours(false).toPromise();
    } catch (error) {
      console.error('Error disabling office hours:', error);
    }
    
    // Clean up waiting room state
    this.stopHeartbeat();
    this.isOfficeHoursWaitingRoom = false;
    this.showOfficeHoursRequestModal = false;
    
    // Update the current route query params and manually reinitialize
    console.log('🔄 Transitioning from waiting room to lesson session, lessonId:', lessonId);
    
    // Update query params using replaceUrl to avoid navigation history issues
    // SECURITY: role is determined from lesson data + auth, not passed in URL
    await this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: lessonId,
        lessonMode: 'true',
        officeHours: 'true'
      },
      replaceUrl: true // Replace current URL instead of adding to history
    });
    
    // Manually trigger re-initialization after navigation
    setTimeout(async () => {
      console.log('🔄 Manually re-initializing pre-call page with lessonId:', lessonId);
      
      // Reset all relevant state
      this.lessonId = lessonId;
      this.isClass = false; // Office hours are always 1:1 lessons
      this.isOfficeHoursWaitingRoom = false;
      this.isLoading = true; // Show loading while fetching lesson data
      this.isLessonReady = false; // Reset until lesson data loads
      this.errorMessage = '';
      
      // Load lesson details
      await this.loadLessonDetails();
      
      // Set loading to false after data loads
      this.isLoading = false;
      
      // Restart camera preview for tutor after acceptance
      console.log('📹 Restarting camera preview after acceptance...');
      try {
        await this.setupPreview();
      } catch (error) {
        console.error('⚠️ Failed to restart camera preview after acceptance:', error);
        // Don't block the flow - user can manually retry or continue without preview
        this.errorMessage = 'Camera preview failed to restart. You can still enter the classroom.';
      }
      
      // Setup presence listeners (these weren't set up in waiting room mode)
      this.websocketService.connect();
      console.log('🔌 WebSocket connected, setting up presence listeners for lesson:', this.lessonId);
      
      // Listen for participant joined events
      this.websocketService.lessonPresence$
        .pipe(takeUntil(this.destroy$))
        .subscribe(presence => {
          console.log('👋 Received lesson_participant_joined event (after accept):', presence);
          const normalizedEventId = String(presence.lessonId);
          const normalizedCurrentId = String(this.lessonId);
          console.log('🔍 Comparing lesson IDs:', { eventId: normalizedEventId, currentId: normalizedCurrentId, match: normalizedEventId === normalizedCurrentId });
          if (normalizedEventId === normalizedCurrentId) {
            console.log('✅ Other participant joined!', presence.participantName);
            this.otherParticipantJoined = true;
            this.otherParticipantName = presence.participantName;
            this.otherParticipantPicture = presence.participantPicture || '';
          }
        });
      
      // Listen for participant left events
      this.websocketService.lessonPresenceLeft$
        .pipe(takeUntil(this.destroy$))
        .subscribe(presence => {
          console.log('👋 Received lesson_participant_left event (after accept):', presence);
          const normalizedEventId = String(presence.lessonId);
          const normalizedCurrentId = String(this.lessonId);
          if (normalizedEventId === normalizedCurrentId) {
            console.log('❌ Other participant left');
            this.otherParticipantJoined = false;
            this.otherParticipantName = '';
            this.otherParticipantPicture = '';
          }
        });
      
      // Listen for lesson cancelled events (IMPORTANT: Added for office hours acceptance flow)
      this.websocketService.lessonCancelled$
        .pipe(takeUntil(this.destroy$))
        .subscribe(async (cancellation) => {
          console.log('🚫 Received lesson_cancelled event (after accept):', cancellation);
          const normalizedEventId = String(cancellation.lessonId);
          const normalizedCurrentId = String(this.lessonId);
          if (normalizedEventId === normalizedCurrentId) {
            console.log('❌ Lesson has been cancelled by:', cancellation.cancelledBy);
            await this.handleLessonCancellation(cancellation);
          }
        });
    }, 200);
  }

  async declineOfficeHoursRequest() {
    if (!this.pendingOfficeHoursRequest) return;
    
    // Clear timeout and all countdown intervals
    if (this.officeHoursRequestTimeout) {
      clearTimeout(this.officeHoursRequestTimeout);
      this.officeHoursRequestTimeout = null;
    }
    this.clearAllCountdownIntervals();
    
    const lessonId = this.pendingOfficeHoursRequest.lessonId || this.pendingOfficeHoursRequest.data?.lessonId;
    console.log('❌ Declining office hours request, lessonId:', lessonId);
    
    this.showOfficeHoursRequestModal = false;
    this.pendingOfficeHoursRequest = null;
    
    // Call backend to cancel the lesson
    try {
      await this.lessonService.updateLessonStatus(lessonId, 'cancelled').toPromise();
      console.log('✅ Lesson cancelled');
    } catch (error) {
      console.error('Error cancelling lesson:', error);
    }
    
    // Auto-disable office hours to prevent student confusion
    // (Student won't see you as "still available" after being declined)
    try {
      console.log('🔒 Disabling office hours...');
      const result = await this.userService.toggleOfficeHours(false).toPromise();
      console.log('✅ Office hours disabled successfully');
      console.log('✅ Updated user officeHoursEnabled:', result?.profile?.officeHoursEnabled);
      
      // Add extra delay to ensure backend has propagated the change
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('✅ Waited 500ms for backend sync');
      
      // Show clear notification to tutor
      const alert = await this.alertController.create({
        header: 'Office Hours Disabled',
        message: 'Your Office Hours have been automatically disabled to prevent student confusion. You can re-enable them anytime from your calendar.',
        buttons: [
          {
            text: 'OK',
            handler: () => {
              this.router.navigate(['/tabs/tutor-calendar']);
            }
          },
          {
            text: 'Re-enable Now',
            handler: async () => {
              try {
                await this.userService.toggleOfficeHours(true).toPromise();
                console.log('✅ Office hours re-enabled by tutor');
                // Navigate to calendar and show success
                this.router.navigate(['/tabs/tutor-calendar']);
                
                const toast = await this.toastController.create({
                  message: '✅ Office Hours re-enabled',
                  duration: 2000,
                  color: 'success',
                  position: 'top'
                });
                await toast.present();
              } catch (error) {
                console.error('Error re-enabling office hours:', error);
              }
            }
          }
        ]
      });
      await alert.present();
      
    } catch (error) {
      console.error('Error disabling office hours:', error);
      // Navigate to calendar even if disable fails
      this.router.navigate(['/tabs/tutor-calendar']);
    }
  }

  async handleLessonCancellation(cancellation: {
    lessonId: string;
    cancelledBy: 'tutor' | 'student';
    cancellerName: string;
    reason: string;
  }) {
    console.log('🚫 Handling lesson cancellation:', cancellation);

    // Only stop media if tutor is not continuing to wait for other students
    // (i.e., if this is not a student timeout where tutor stays in waiting room)
    const tutorContinuesWaiting = this.isTutor && cancellation.cancelledBy === 'student';
    
    if (!tutorContinuesWaiting && this.localStream) {
      console.log('🛑 Stopping preview MediaStream tracks due to cancellation...');
      this.localStream.getTracks().forEach(track => {
        track.stop();
        console.log(`🛑 Stopped ${track.kind} track`);
      });
      this.localStream = null;
    } else if (tutorContinuesWaiting) {
      console.log('📹 Keeping camera/microphone active - tutor continues waiting for other students');
    }

    // Show alert to user
    const alert = await this.alertController.create({
      header: this.isTutor ? 'Session Cancelled' : 'Session Unavailable',
      message: this.isTutor
        ? (cancellation.cancelledBy === 'student' 
            ? `The student didn't enter the classroom in time, so the session was cancelled. You can continue waiting for other students.`
            : `The session has been cancelled.`)
        : (cancellation.cancelledBy === 'tutor' 
            ? `Something came up for this tutor and they're unable to join right now. Don't worry—you haven't been charged! Try finding another available tutor in the search.`
            : `The student has cancelled this session.`),
      buttons: [
        {
          text: this.isTutor 
            ? (cancellation.cancelledBy === 'student' ? 'OK' : 'Continue Waiting')
            : 'Find Tutors',
          handler: async () => {
            if (this.isTutor) {
              // Tutor: Stay in waiting room and re-enable office hours if student timed out
              if (cancellation.cancelledBy === 'student') {
                console.log('🔄 Re-enabling office hours after student timeout');
                try {
                  await this.userService.toggleOfficeHours(true).toPromise();
                  console.log('✅ Office hours re-enabled');
                  
                  // Restore waiting room state to listen for new requests
                  console.log('🔄 Restoring office hours waiting room state');
                  this.isOfficeHoursWaitingRoom = true;
                  this.lessonTitle = 'Office Hours - Waiting Room';
                  this.participantName = 'Waiting for student...';
                  this.lessonId = ''; // Clear the cancelled lesson ID
                  
                  // Restart heartbeat to show as actively available in tutor search
                  console.log('💓 Restarting heartbeat after student timeout');
                  this.startHeartbeat();
                  
                  // Re-setup notification listeners for new office hours requests
                  console.log('🔔 Re-setting up notification listeners');
                  this.websocketService.newNotification$
                    .pipe(takeUntil(this.destroy$))
                    .subscribe(notification => {
                      console.log('🔔 Notification received after timeout:', notification);
                      if (notification.type === 'office_hours_booking' && notification.urgent) {
                        this.handleOfficeHoursRequest(notification);
                      }
                    });
                } catch (error) {
                  console.error('❌ Error re-enabling office hours:', error);
                }
              }
              console.log('✅ Tutor staying in waiting room after student timeout');
              return;
              } else {
                // Student: Use same logic as goBack() method
                console.log('🚪 Student cancellation - using goBack() logic');
                
                // Stop audio monitoring
                this.stopAudioMonitoring();
                
                // Clear video element srcObject first to release camera
                const videoElement = this.videoPreviewRef?.nativeElement;
                if (videoElement) {
                  console.log('🎥 Clearing video element srcObject...');
                  videoElement.srcObject = null;
                  videoElement.load(); // Reset the video element
                }
                
                // Stop preview stream before navigating away
                if (this.localStream) {
                  console.log('🛑 Stopping preview MediaStream tracks...');
                  this.localStream.getTracks().forEach(track => {
                    track.stop();
                    console.log('  ⏹️ Stopped track:', track.kind, track.label);
                  });
                  this.localStream = null;
                }
                
                // Clean up Agora tracks if they were created for virtual background
                try {
                  const videoTrack = this.agoraService.getLocalVideoTrack();
                  const audioTrack = this.agoraService.getLocalAudioTrack();
                  if (videoTrack || audioTrack) {
                    console.log('🧹 Cleaning up Agora tracks created for virtual background...');
                    await this.agoraService.cleanupLocalTracks();
                  }
                } catch (error) {
                  console.error('❌ Error cleaning up Agora tracks:', error);
                  // Continue with navigation even if cleanup fails
                }
                
                // Call leave endpoint if we have a lessonId/classId
                if (this.lessonId) {
                  try {
                    if (this.isClass) {
                      await firstValueFrom(this.classService.leaveClass(this.lessonId));
                    } else {
                      await firstValueFrom(this.lessonService.leaveLesson(this.lessonId));
                    }
                  } catch (error) {
                    console.error('🚪 PreCall: Error calling leave endpoint:', error);
                    // Continue with navigation even if leave fails
                  }
                }
                
                // Navigate to tutor search and force refresh data
                // Clear any stale data to force refresh in tutor search
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
}

