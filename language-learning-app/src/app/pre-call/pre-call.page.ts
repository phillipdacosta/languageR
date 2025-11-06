import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { AlertController, LoadingController } from '@ionic/angular';
import { UserService } from '../services/user.service';
import { LessonService } from '../services/lesson.service';
import { AgoraService } from '../services/agora.service';
import { firstValueFrom } from 'rxjs';

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

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private userService: UserService,
    private lessonService: LessonService,
    private agoraService: AgoraService,
    private alertController: AlertController,
    private loadingController: LoadingController
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
      }
    } catch (error) {
      console.error('Error loading lesson details:', error);
      this.lessonTitle = 'Language Lesson';
      this.tutorName = 'Tutor';
      this.studentName = 'Student';
      this.participantName = this.isTutor ? this.studentName : this.tutorName;
    }
  }

  updateVideoPreview() {
    if (this.videoPreviewRef?.nativeElement) {
      if (this.localStream && !this.isVideoOff) {
        this.videoPreviewRef.nativeElement.srcObject = this.localStream;
        // Ensure video plays
        this.videoPreviewRef.nativeElement.play().catch(err => {
          console.error('Error playing video:', err);
        });
      } else if (this.isVideoOff) {
        this.videoPreviewRef.nativeElement.srcObject = null;
      }
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
      const alert = await this.alertController.create({
        header: 'Error',
        message: error?.message || 'Failed to enter classroom',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  goBack() {
    // Stop preview stream before navigating away
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    // Navigate back to previous page
    this.location.back();
  }

  ngOnDestroy() {
    // Clean up media stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
}

