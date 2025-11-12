import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { AlertController, LoadingController } from '@ionic/angular';
import { UserService } from '../services/user.service';
import { LessonService } from '../services/lesson.service';
import { AgoraService } from '../services/agora.service';
import { WebSocketService } from '../services/websocket.service';
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

  lessonId: string = '';
  lessonTitle: string = '';
  tutorName: string = '';
  studentName: string = '';
  participantName: string = ''; // The other participant (student for tutors, tutor for students)
  isMuted = false; // Default to unmuted (users can toggle off)
  isVideoOff = false; // Default to video on (users can toggle off)
  localStream: MediaStream | null = null;
  isLoading = true;
  errorMessage: string = '';
  isTutor: boolean = false;
  otherParticipantJoined: boolean = false;
  otherParticipantName: string = '';
  otherParticipantPicture: string = '';
  private destroy$ = new Subject<void>();

  // Virtual background properties
  showVirtualBackgroundControls = false;
  isVirtualBackgroundEnabled = false;


  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private userService: UserService,
    private lessonService: LessonService,
    private agoraService: AgoraService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private websocketService: WebSocketService
  ) {}

  async ngOnInit() {
    const params = this.route.snapshot.queryParams;
    this.lessonId = params['lessonId'] || '';
    
    if (!this.lessonId) {
      this.errorMessage = 'Lesson ID is required';
      this.isLoading = false;
      return;
    }

    // Load lesson details
    await this.loadLessonDetails();

    // Connect to WebSocket and listen for lesson presence
    this.websocketService.connect();
    
    // Listen for participant joined events
    this.websocketService.lessonPresence$
      .pipe(takeUntil(this.destroy$))
      .subscribe(presence => {
        const normalizedEventId = String(presence.lessonId);
        const normalizedCurrentId = String(this.lessonId);
        if (normalizedEventId === normalizedCurrentId) {
          this.otherParticipantJoined = true;
          this.otherParticipantName = presence.participantName;
          this.otherParticipantPicture = presence.participantPicture || '';
        }
      });
    
    // Listen for participant left events
    this.websocketService.lessonPresenceLeft$
      .pipe(takeUntil(this.destroy$))
      .subscribe(presence => {
        const normalizedEventId = String(presence.lessonId);
        const normalizedCurrentId = String(this.lessonId);
        if (normalizedEventId === normalizedCurrentId) {
          this.otherParticipantJoined = false;
          this.otherParticipantName = '';
          this.otherParticipantPicture = '';
        }
      });
  }

  async ngAfterViewInit() {
    // Request camera/mic access for preview after view is initialized
    // This ensures videoPreviewRef is available
    await this.setupPreview();
  }

  async loadLessonDetails() {
    try {
      // Get current user to determine role
      const currentUser = await firstValueFrom(this.userService.getCurrentUser());
      const params = this.route.snapshot.queryParams;
      const role = (params['role'] === 'tutor' || params['role'] === 'student') ? params['role'] : 'student';
      this.isTutor = role === 'tutor';
      
      const response = await firstValueFrom(this.lessonService.getLesson(this.lessonId));
      if (response?.success && response.lesson) {
        const lesson = response.lesson;
        this.tutorName = lesson.tutorId?.name || 'Tutor';
        this.studentName = lesson.studentId?.name || 'Student';
        
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
        if (lesson.participants && typeof lesson.participants === 'object') {
          const otherParticipantId = this.isTutor 
            ? lesson.studentId?._id 
            : lesson.tutorId?._id;
          
          if (otherParticipantId) {
            const otherParticipantKey = String(otherParticipantId);
            const participantData = lesson.participants[otherParticipantKey];
            
            // If the other participant has joined (has joinedAt) and hasn't left (no leftAt or leftAt is null)
            if (participantData && participantData.joinedAt && !participantData.leftAt) {
              // Other participant has already joined
              this.otherParticipantJoined = true;
              if (this.isTutor) {
                this.otherParticipantName = this.studentName;
                this.otherParticipantPicture = lesson.studentId?.picture || '';
              } else {
                this.otherParticipantName = this.tutorName;
                this.otherParticipantPicture = lesson.tutorId?.picture || '';
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error loading lesson details:', error);
      this.lessonTitle = 'Language Lesson';
      this.tutorName = 'Tutor';
      this.studentName = 'Student';
      this.participantName = this.isTutor ? this.studentName : this.tutorName;
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

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      this.isLoading = false;
      
      // Update video preview after loading is false so element is visible
      // Use setTimeout to ensure Angular change detection has run
      setTimeout(() => {
        this.updateVideoPreview();
        // Initialize Agora client for virtual background support
        this.initializeAgoraForVirtualBackground();
      }, 0);
    } catch (error: any) {
      console.error('Error setting up preview:', error);
      this.isLoading = false;
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        this.errorMessage = 'Camera and microphone permissions are required. Please allow access and refresh.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        this.errorMessage = 'No camera or microphone found. Please connect a device.';
      } else {
        this.errorMessage = 'Unable to access camera or microphone. Please check your device settings.';
      }
    }
  }

  toggleMicrophone() {
    this.isMuted = !this.isMuted;
    
    if (this.localStream) {
      const audioTracks = this.localStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !this.isMuted;
      });
    } else if (!this.isMuted) {
      // If stream doesn't exist and user wants to enable mic, request it
      this.setupPreview();
    }
  }

  async toggleCamera() {
    this.isVideoOff = !this.isVideoOff;
    
    if (this.localStream) {
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
    const loading = await this.loadingController.create({
      message: 'Entering classroom...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Stop preview stream - it will be recreated in video-call page
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      }

      // Initialize Agora client if needed
      if (!this.agoraService.getClient()) {
        await this.agoraService.initializeClient();
      }

      // Get current user and join lesson
      const currentUser = await firstValueFrom(this.userService.getCurrentUser());
      const params = this.route.snapshot.queryParams;
      const role = (params['role'] === 'tutor' || params['role'] === 'student') ? params['role'] : 'student';
      
      
      const joinResponse = await this.agoraService.joinLesson(
        this.lessonId,
        role,
        currentUser?.id,
        {
          micEnabled: !this.isMuted,
          videoEnabled: !this.isVideoOff
        }
      );
      

      await loading.dismiss();

      // Navigate to video-call with lesson info
      this.router.navigate(['/video-call'], {
        queryParams: {
          lessonId: this.lessonId,
          channelName: joinResponse.agora.channelName,
          role,
          lessonMode: 'true',
          micOn: !this.isMuted,
          videoOn: !this.isVideoOff
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
    
    // Stop preview stream before navigating away
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    // Call leave endpoint if we have a lessonId
    if (this.lessonId) {
      try {
        const leaveResponse = await firstValueFrom(this.lessonService.leaveLesson(this.lessonId));
      } catch (error) {
        console.error('🚪 PreCall: Error calling leave endpoint:', error);
        // Continue with navigation even if leave fails
      }
    } else {
    }
    
    // Navigate back to previous page
    this.location.back();
  }

  ngOnDestroy() {
    // Clean up subscriptions
    this.destroy$.next();
    this.destroy$.complete();
    
    // Clean up media stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    
    // Call leave endpoint when leaving the pre-call page (if not already called via goBack)
    // Note: We can't use async/await in ngOnDestroy, so we fire and forget
    if (this.lessonId) {
      firstValueFrom(this.lessonService.leaveLesson(this.lessonId))
        .then(() => {
        })
        .catch((error) => {
          console.error('🚪 PreCall: Error calling leave endpoint in ngOnDestroy:', error);
        });
    }
  }


















  // Update the video preview (simple MediaStream only)
  updateVideoPreview() {
    const videoElement = this.videoPreviewRef?.nativeElement;
    if (!videoElement) return;

    if (this.isVideoOff) {
      videoElement.srcObject = null;
      return;
    }

    // Use MediaStream for video preview
    if (this.localStream) {
      videoElement.srcObject = this.localStream;
      videoElement.play().catch(err => {
        console.error('Error playing video:', err);
      });
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
      
      console.log('✅ Agora tracks created successfully for virtual background support');
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
      
      // Switch back to original MediaStream
      this.updateVideoPreview();
      
      console.log('✅ Virtual background disabled successfully');
    } catch (error) {
      console.error('❌ Failed to disable virtual background:', error);
    }
  }

  // Update video preview to show Agora track (with virtual background effects)
  private updateVideoPreviewWithAgoraTrack(): void {
    const videoElement = this.videoPreviewRef?.nativeElement;
    const agoraVideoTrack = this.agoraService.getLocalVideoTrack();
    
    if (videoElement && agoraVideoTrack) {
      try {
        // Play the Agora track (which has virtual background processing)
        agoraVideoTrack.play(videoElement);
        console.log('✅ Switched to Agora video track with virtual background');
      } catch (error) {
        console.error('❌ Failed to play Agora video track:', error);
        // Fallback to original MediaStream
        this.updateVideoPreview();
      }
    }
  }
}

