import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LoadingController, AlertController, ToastController } from '@ionic/angular';
import { LessonAnalysis } from '../services/transcription.service';
import { UserService } from '../services/user.service';
import { LessonService } from '../services/lesson.service';
import { TutorFeedbackService } from '../services/tutor-feedback.service';
import { LearningPlanService } from '../services/learning-plan.service';
import { firstValueFrom } from 'rxjs';
import { formatTimeInTz, formatDateInTz, isSameDayInTimezone } from '../shared/timezone.utils';

interface LessonInfo {
  _id: string;
  subject: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  actualDurationMinutes?: number;
  price?: number;
  aiAnalysisEnabledAtTime?: boolean | null;
  tutor: {
    _id: string;
    name: string;
    picture?: string;
  };
  student: {
    _id: string;
    name: string;
    firstName?: string;
    picture?: string;
  };
}

@Component({
  selector: 'app-post-lesson-tutor',
  templateUrl: './post-lesson-tutor.page.html',
  styleUrls: ['./post-lesson-tutor.page.scss'],
  standalone: false
})
export class PostLessonTutorPage implements OnInit, OnDestroy {
  lessonId: string = '';
  feedbackId: string = ''; // From TutorFeedback system (if navigated from pending feedback)
  isPostCall: boolean = false; // True when arriving directly after a video call
  backButtonLabel: string = 'Go back';
  lesson: LessonInfo | null = null;
  student: any = null;
  analysis: LessonAnalysis | null = null;
  analysisLoaded = false;
  
  // AI-enabled flag for this student
  studentAiEnabled: boolean = true;
  
  // Computed display properties (avoid function calls in template)
  studentDisplayName: string = 'Student';
  lessonDateTime: string = '';
  
  // Countdown timer (2-hour grace period before profile is hidden)
  countdownDisplay: string = '';
  countdownExpired: boolean = false;
  showCountdown: boolean = false;
  private countdownInterval: any = null;
  private graceDeadline: Date | null = null;
  private static readonly GRACE_PERIOD_MS = 2 * 60 * 60 * 1000; // 2 hours

  // Note form
  noteText: string = '';
  quickImpression: string = '';
  homework: string = '';
  submittingNote = false;
  noteSubmitted = false;
  
  // Enhanced tutor assessment fields (shown when AI is off)
  cefrLevel: string = '';
  grammarRating: number = 0;
  fluencyRating: number = 0;
  selectedErrorAreas: string[] = [];
  selectedStrengths: string[] = [];
  selectedAreasToImprove: string[] = [];
  customStrength: string = '';
  customAreaToImprove: string = '';

  // Optional structured corrections — go straight onto the student's
  // spaced-repetition deck server-side. Lazily expanded.
  showCorrections = false;
  capturedCorrections: Array<{ original: string; corrected: string; explanation?: string }> = [];

  // Learning Plan overrides
  showPlanOverride = false;
  planOverrideAction: string = '';
  planOverrideFocus: string = '';
  planOverrideNote: string = '';
  hasActivePlan = false;
  planStudentId: string = '';
  planLanguage: string = '';

  planOverrideActions = [
    { value: '', label: 'No change needed' },
    { value: 'advance_phase', label: 'Student is ready for the next phase' },
    { value: 'extend_phase', label: 'Student needs more time in this phase' },
    { value: 'adjust_focus', label: 'Adjust focus for next lesson' },
    { value: 'add_note', label: 'Add a note for other tutors' }
  ];

  impressionOptions = [
    { value: 'excellent', label: '🌟 Excellent Progress!', color: 'success' },
    { value: 'great', label: '✅ Great Job!', color: 'primary' },
    { value: 'good', label: '👍 Good Effort', color: 'secondary' },
    { value: 'needs-work', label: '💪 Needs More Practice', color: 'warning' }
  ];

  cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

  errorAreaOptions = [
    'Verb conjugation',
    'Gender agreement',
    'Prepositions',
    'Tense usage',
    'Vocabulary',
    'Pronunciation',
    'Sentence structure',
    'Articles'
  ];

  strengthOptions = [
    'Conversational fluency',
    'Vocabulary usage',
    'Grammar accuracy',
    'Pronunciation',
    'Listening comprehension',
    'Confidence',
    'Complex sentences',
    'Natural expressions'
  ];

  improvementOptions = [
    'Grammar accuracy',
    'Verb conjugation',
    'Vocabulary range',
    'Pronunciation',
    'Fluency/speed',
    'Listening skills',
    'Sentence complexity',
    'Idiomatic expressions'
  ];

  private get userTz(): string | undefined {
    return this.userService.getCurrentUserValue()?.profile?.timezone || undefined;
  }

  /** Disable submit button when form is incomplete */
  get isSubmitDisabled(): boolean {
    if (this.submittingNote) return true;
    if (!this.noteText.trim()) return true;
    if (!this.studentAiEnabled) {
      return !(this.cefrLevel && this.grammarRating > 0 && this.fluencyRating > 0 &&
        this.selectedStrengths.length > 0 && this.selectedAreasToImprove.length > 0);
    }
    return false;
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private http: HttpClient,
    private userService: UserService,
    private lessonService: LessonService,
    private loadingCtrl: LoadingController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private tutorFeedbackService: TutorFeedbackService,
    private learningPlanService: LearningPlanService
  ) {}

  async ngOnInit() {
    this.lessonId = this.route.snapshot.paramMap.get('id') || '';
    this.feedbackId = this.route.snapshot.queryParamMap.get('feedbackId') || '';
    this.isPostCall = this.route.snapshot.queryParamMap.get('fromPostCall') === 'true';
    this.backButtonLabel = this.isPostCall ? 'Home' : 'Go back';
    
    // Wait for user to be loaded first
    await this.ensureUserLoaded();
    
    if (this.lessonId) {
      this.loadLessonInfo();
      this.loadAnalysis();
    }
  }

  ngOnDestroy() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private async ensureUserLoaded(): Promise<void> {
    try {
      const user = await firstValueFrom(this.userService.getCurrentUser());
      console.log('✅ POST-LESSON-TUTOR: User loaded:', user);
      console.log('✅ POST-LESSON-TUTOR: Current user email:', user?.email);
    } catch (error) {
      console.error('❌ POST-LESSON-TUTOR: Error loading user:', error);
    }
  }

  async loadLessonInfo() {
    try {
      console.log('📚 POST-LESSON-TUTOR: Loading lesson info for:', this.lessonId);
      const response: any = await firstValueFrom(
        this.lessonService.getLesson(this.lessonId)
      );
      
      if (response?.lesson) {
        this.lesson = response.lesson;
        // Backend returns studentId and tutorId, not student and tutor
        this.student = response.lesson.studentId || response.lesson.student;
        
        // Use the lesson's snapshot of the AI setting (immutable at lesson completion).
        // Fall back to live student profile for legacy lessons without the snapshot.
        if (this.lesson!.aiAnalysisEnabledAtTime !== null && this.lesson!.aiAnalysisEnabledAtTime !== undefined) {
          this.studentAiEnabled = this.lesson!.aiAnalysisEnabledAtTime !== false;
        } else if (this.student && typeof this.student === 'object' && this.student.profile) {
          this.studentAiEnabled = this.student.profile.aiAnalysisEnabled !== false;
        } else {
          this.studentAiEnabled = true; // Default to enabled
        }
        
        // Compute display properties once (avoid function calls in template)
        this.studentDisplayName = this.computeStudentDisplayName();
        this.lessonDateTime = this.computeLessonDateTime();

        // Start countdown timer if student has AI disabled (feedback is required)
        if (!this.studentAiEnabled) {
          this.startCountdownTimer();
        }

        console.log('✅ POST-LESSON-TUTOR: Lesson info loaded:', this.lesson);
        console.log('✅ POST-LESSON-TUTOR: Student info:', this.student);
        console.log('🤖 POST-LESSON-TUTOR: Student AI enabled:', this.studentAiEnabled);

        this.checkForActivePlan();
      }
    } catch (error) {
      console.error('❌ POST-LESSON-TUTOR: Error loading lesson info:', error);
    }
  }

  private checkForActivePlan() {
    const studentId = typeof this.student === 'object' ? (this.student as any)?._id : this.student;
    if (!studentId) return;

    this.planStudentId = studentId;
    this.planLanguage = (this.lesson?.subject || '').replace(/\s*lesson$/i, '').trim() || this.lesson?.subject || '';

    this.learningPlanService.getStudentPlanSummary(studentId).subscribe({
      next: (res) => {
        if (res.success && res.summaries?.length) {
          this.hasActivePlan = true;
        }
      },
      error: () => {}
    });
  }

  async loadAnalysis() {
    try {
      const headers = this.userService.getAuthHeadersSync();
      console.log('🔑 POST-LESSON-TUTOR: Auth headers for analysis check:', headers);
      
      const response: any = await firstValueFrom(
        this.http.get(`${environment.apiUrl}/transcription/lesson/${this.lessonId}/analysis`, { headers })
      );
      
      if (response?.analysis?.status === 'completed') {
        this.analysis = response.analysis;
        this.analysisLoaded = true;
        console.log('✅ POST-LESSON-TUTOR: Analysis loaded:', this.analysis);
      }
    } catch (error: any) {
      // Analysis not ready yet - that's okay
      console.log('Analysis not ready yet');
    }
  }

  selectImpression(value: string) {
    this.quickImpression = value;
  }

  addCorrectionRow() {
    if (!this.showCorrections) this.showCorrections = true;
    this.capturedCorrections.push({ original: '', corrected: '', explanation: '' });
  }

  removeCorrectionRow(index: number) {
    this.capturedCorrections.splice(index, 1);
    if (this.capturedCorrections.length === 0) this.showCorrections = false;
  }

  trackByIndex(i: number) { return i; }

  private validCorrections() {
    return this.capturedCorrections
      .map(c => ({
        original: (c.original || '').trim(),
        corrected: (c.corrected || '').trim(),
        explanation: (c.explanation || '').trim()
      }))
      .filter(c => c.original.length >= 2 && c.corrected.length >= 2 && c.original.toLowerCase() !== c.corrected.toLowerCase());
  }

  toggleErrorArea(area: string) {
    const idx = this.selectedErrorAreas.indexOf(area);
    if (idx >= 0) {
      this.selectedErrorAreas.splice(idx, 1);
    } else {
      this.selectedErrorAreas.push(area);
    }
  }

  toggleStrength(strength: string) {
    const idx = this.selectedStrengths.indexOf(strength);
    if (idx >= 0) {
      this.selectedStrengths.splice(idx, 1);
    } else {
      this.selectedStrengths.push(strength);
    }
  }

  toggleAreaToImprove(area: string) {
    const idx = this.selectedAreasToImprove.indexOf(area);
    if (idx >= 0) {
      this.selectedAreasToImprove.splice(idx, 1);
    } else {
      this.selectedAreasToImprove.push(area);
    }
  }

  selectCefrLevel(level: string) {
    this.cefrLevel = level;
  }

  setGrammarRating(rating: number) {
    this.grammarRating = rating;
  }

  setFluencyRating(rating: number) {
    this.fluencyRating = rating;
  }

  async submitNote() {
    if (!this.noteText.trim()) {
      const alert = await this.alertCtrl.create({
        header: 'Note Required',
        message: 'Please write a note for your student before submitting.',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    // Validate enhanced form when AI is off
    if (!this.studentAiEnabled && !(this.cefrLevel && this.grammarRating > 0 && this.fluencyRating > 0 &&
        this.selectedStrengths.length > 0 && this.selectedAreasToImprove.length > 0)) {
      const alert = await this.alertCtrl.create({
        header: 'Assessment Required',
        message: 'Please complete the CEFR level, grammar rating, fluency rating, strengths, and areas to improve.',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    this.submittingNote = true;

    try {
      const headers = this.userService.getAuthHeadersSync();
      
      // Build payload - include enhanced fields when AI is off
      const payload: any = {
        text: this.noteText,
        quickImpression: this.quickImpression,
        homework: this.homework
      };

      const validCorrections = this.validCorrections();
      if (validCorrections.length > 0) {
        payload.capturedCorrections = validCorrections;
      }

      if (!this.studentAiEnabled) {
        payload.cefrLevel = this.cefrLevel;
        payload.grammarRating = this.grammarRating;
        payload.fluencyRating = this.fluencyRating;
        payload.keyErrorAreas = this.selectedErrorAreas;
        payload.strengths = [
          ...this.selectedStrengths,
          ...(this.customStrength.trim() ? [this.customStrength.trim()] : [])
        ];
        payload.areasToImprove = [
          ...this.selectedAreasToImprove,
          ...(this.customAreaToImprove.trim() ? [this.customAreaToImprove.trim()] : [])
        ];
        payload.isTutorAssessment = true;
      }
      
      const response: any = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/lessons/${this.lessonId}/tutor-note`, payload, { headers })
      );

      if (response.success) {
        this.noteSubmitted = true;
        
        // If this was opened from a pending TutorFeedback request, mark it as completed too
        if (this.feedbackId) {
          try {
            await firstValueFrom(this.tutorFeedbackService.submitFeedback(this.feedbackId, {
              strengths: this.selectedStrengths.length > 0 
                ? this.selectedStrengths 
                : [this.noteText.trim()],
              areasForImprovement: this.selectedAreasToImprove.length > 0 
                ? this.selectedAreasToImprove 
                : [],
              homework: this.homework || '',
              overallNotes: this.noteText || '',
              estimatedCefrLevel: this.cefrLevel || ''
            }));
            console.log('✅ POST-LESSON-TUTOR: TutorFeedback record also marked as completed');
          } catch (fbError) {
            console.warn('⚠️ POST-LESSON-TUTOR: Could not mark TutorFeedback as completed:', fbError);
            // Non-blocking — the tutor note was already saved successfully
          }
        }

        // Submit tutor override to learning plan if selected
        if (this.hasActivePlan && this.planOverrideAction && this.planStudentId) {
          try {
            await firstValueFrom(this.learningPlanService.submitTutorOverride({
              studentId: this.planStudentId,
              language: this.planLanguage,
              action: this.planOverrideAction,
              note: this.planOverrideNote || this.planOverrideFocus || undefined
            }));
          } catch (overrideErr) {
            console.warn('⚠️ Learning plan override failed (non-blocking):', overrideErr);
          }
        }

        // Always refresh the pending feedback cache so banners update everywhere instantly.
        // submitFeedback() above already triggers a refresh when feedbackId exists,
        // but this covers the post-call flow where there's no feedbackId.
        if (!this.feedbackId) {
          this.tutorFeedbackService.refreshPendingFeedback();
        }
        
        const toast = await this.toastCtrl.create({
          message: '✅ Note sent to student!',
          duration: 3000,
          color: 'success',
          position: 'top'
        });
        await toast.present();
        
        // Navigate to home after a short delay
        setTimeout(() => {
          this.goHome();
        }, 1500);
      }
    } catch (error: any) {
      console.error('Error submitting note:', error);
      
      const alert = await this.alertCtrl.create({
        header: 'Error',
        message: error.error?.error || 'Failed to send note. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      this.submittingNote = false;
    }
  }

  async skipNote() {
    const alert = await this.alertCtrl.create({
      header: 'Skip Note?',
      message: 'Are you sure you want to skip leaving a note for your student?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Skip',
          handler: () => {
            this.goHome();
          }
        }
      ]
    });
    await alert.present();
  }

  async goHome() {
    // If AI is disabled and tutor hasn't submitted feedback yet, warn them
    if (!this.studentAiEnabled && !this.noteSubmitted) {
      const alert = await this.alertCtrl.create({
        header: 'Feedback Required',
        message: this.countdownExpired
          ? 'Your student has AI analysis disabled, so your feedback is mandatory. Your profile is currently hidden from students — submit feedback to restore it.'
          : 'Your student has AI analysis disabled, so your feedback is mandatory. Your profile will be hidden from students if not submitted within the time shown.',
        buttons: [
          {
            text: 'Leave Anyway',
            role: 'cancel',
            cssClass: 'secondary',
            handler: () => {
              this.navigateBack();
            }
          },
          {
            text: 'Complete Feedback',
            handler: () => {
              // Stay on the page
            }
          }
        ]
      });
      await alert.present();
      return;
    }
    
    this.navigateBack();
  }

  private navigateBack() {
    if (this.isPostCall) {
      // Came directly from video call — go to lessons home
      this.router.navigate(['/tabs/lessons']);
    } else {
      // Came from calendar, home, lessons list, notifications, etc. — go back
      this.location.back();
    }
  }

  // ── Countdown Timer ──────────────────────────────────────
  private startCountdownTimer() {
    if (!this.lesson) return;

    // Use lesson end time as the reference for the 2-hour grace period
    const lessonEndTime = this.lesson.endTime
      ? new Date(this.lesson.endTime)
      : new Date(this.lesson.startTime);
    
    this.graceDeadline = new Date(lessonEndTime.getTime() + PostLessonTutorPage.GRACE_PERIOD_MS);
    this.showCountdown = true;

    // Update immediately, then every second
    this.updateCountdown();
    this.countdownInterval = setInterval(() => this.updateCountdown(), 1000);
  }

  private updateCountdown() {
    if (!this.graceDeadline) return;

    const now = new Date();
    const remainingMs = this.graceDeadline.getTime() - now.getTime();

    if (remainingMs <= 0) {
      this.countdownExpired = true;
      this.countdownDisplay = 'Expired';
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
      return;
    }

    const totalSeconds = Math.floor(remainingMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      this.countdownDisplay = `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
    } else {
      this.countdownDisplay = `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
    }
  }

  formatDate(date: Date): string {
    const d = new Date(date);
    const tz = this.userTz || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);

    if (isSameDayInTimezone(d, today, tz)) {
      return 'Today';
    }
    if (isSameDayInTimezone(d, yesterday, tz)) {
      return 'Yesterday';
    }

    return formatDateInTz(d, this.userTz, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  formatTime(date: Date): string {
    return formatTimeInTz(new Date(date), this.userTz);
  }

  private computeStudentDisplayName(): string {
    if (!this.student) return 'Student';
    
    const firstName = this.student.firstName;
    const lastName = this.student.lastName;
    
    // Best case: we have both firstName and lastName
    if (firstName && lastName) {
      const lastInitial = lastName.charAt(0).toUpperCase();
      return `${firstName} ${lastInitial}.`;
    }
    
    // If only firstName
    if (firstName) {
      return firstName;
    }
    
    // Fallback: try to parse from full name
    const name = this.student.name || '';
    const parts = name.trim().split(' ');
    
    if (parts.length > 1) {
      const first = parts[0];
      const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
      return `${first} ${lastInitial}.`;
    }
    
    // Last resort: just return whatever name we have
    return name || 'Student';
  }

  private computeLessonDateTime(): string {
    if (!this.lesson?.startTime) return '';
    const date = this.formatDate(this.lesson.startTime);
    const startTime = this.formatTime(this.lesson.startTime);
    const endTime = this.lesson.endTime ? this.formatTime(this.lesson.endTime) : '';

    if (endTime) {
      return `${date} · ${startTime} - ${endTime}`;
    }
    return `${date} · ${startTime}`;
  }
}

