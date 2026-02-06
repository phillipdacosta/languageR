import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { LoadingController, AlertController, ToastController } from '@ionic/angular';
import { LessonAnalysis } from '../services/transcription.service';
import { UserService } from '../services/user.service';
import { LessonService } from '../services/lesson.service';
import { firstValueFrom } from 'rxjs';

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
export class PostLessonTutorPage implements OnInit {
  lessonId: string = '';
  lesson: LessonInfo | null = null;
  student: any = null;
  analysis: LessonAnalysis | null = null;
  analysisLoaded = false;
  
  // AI-enabled flag for this student
  studentAiEnabled: boolean = true;
  
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

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private userService: UserService,
    private lessonService: LessonService,
    private loadingCtrl: LoadingController,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {}

  async ngOnInit() {
    this.lessonId = this.route.snapshot.paramMap.get('id') || '';
    
    // Wait for user to be loaded first
    await this.ensureUserLoaded();
    
    if (this.lessonId) {
      this.loadLessonInfo();
      this.loadAnalysis();
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
        
        console.log('✅ POST-LESSON-TUTOR: Lesson info loaded:', this.lesson);
        console.log('✅ POST-LESSON-TUTOR: Student info:', this.student);
        console.log('🤖 POST-LESSON-TUTOR: Student AI enabled:', this.studentAiEnabled);
      }
    } catch (error) {
      console.error('❌ POST-LESSON-TUTOR: Error loading lesson info:', error);
    }
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

  isEnhancedFormValid(): boolean {
    if (this.studentAiEnabled) return true; // Standard form only needs noteText
    return !!(this.cefrLevel && this.grammarRating > 0 && this.fluencyRating > 0 && 
              this.noteText.trim() && this.selectedStrengths.length > 0 && 
              this.selectedAreasToImprove.length > 0);
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
    if (!this.studentAiEnabled && !this.isEnhancedFormValid()) {
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
        message: 'Your student has AI analysis disabled, so your feedback is mandatory. Your profile will be hidden from students until feedback is completed.',
        buttons: [
          {
            text: 'Leave Anyway',
            role: 'cancel',
            cssClass: 'secondary',
            handler: () => {
              this.router.navigate(['/tabs/home/lessons']);
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
    
    await this.router.navigate(['/tabs/home/lessons']);
  }

  formatDate(date: Date): string {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Check if today
    if (d.toDateString() === today.toDateString()) {
      return 'Today';
    }
    // Check if yesterday
    if (d.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  formatLessonDateTime(): string {
    if (!this.lesson?.startTime) return '';
    const date = this.formatDate(this.lesson.startTime);
    const startTime = this.formatTime(this.lesson.startTime);
    const endTime = this.lesson.endTime ? this.formatTime(this.lesson.endTime) : '';
    
    if (endTime) {
      return `${date} · ${startTime} - ${endTime}`;
    }
    return `${date} · ${startTime}`;
  }

  getStudentDisplayName(): string {
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

  getEarningsAmount(): number {
    // Platform takes 20% fee, tutor gets 80%
    if (this.lesson?.price) {
      return Math.round(this.lesson.price * 0.80 * 100) / 100;
    }
    return 0;
  }
}

