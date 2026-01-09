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
  price?: number; // Changed from lessonCost
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
  
  // Note form
  noteText: string = '';
  quickImpression: string = '';
  homework: string = '';
  submittingNote = false;
  noteSubmitted = false;

  impressionOptions = [
    { value: 'excellent', label: '🌟 Excellent Progress!', color: 'success' },
    { value: 'great', label: '✅ Great Job!', color: 'primary' },
    { value: 'good', label: '👍 Good Effort', color: 'secondary' },
    { value: 'needs-work', label: '💪 Needs More Practice', color: 'warning' }
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
        console.log('✅ POST-LESSON-TUTOR: Lesson info loaded:', this.lesson);
        console.log('✅ POST-LESSON-TUTOR: Student info:', this.student);
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

    this.submittingNote = true;

    try {
      const headers = this.userService.getAuthHeadersSync();
      const response: any = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/lessons/${this.lessonId}/tutor-note`, {
          text: this.noteText,
          quickImpression: this.quickImpression,
          homework: this.homework
        }, { headers })
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
    await this.router.navigate(['/tabs/home']);
  }

  formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  getEarningsAmount(): number {
    // Platform takes 20% fee, tutor gets 80%
    if (this.lesson?.price) {
      return Math.round(this.lesson.price * 0.80 * 100) / 100;
    }
    return 0;
  }
}

