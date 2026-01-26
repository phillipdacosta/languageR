import { Component, OnInit, OnDestroy } from '@angular/core';
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
    firstName?: string;
  };
  student: {
    _id: string;
    name: string;
    picture?: string;
  };
}

@Component({
  selector: 'app-post-lesson-student',
  templateUrl: './post-lesson-student.page.html',
  styleUrls: ['./post-lesson-student.page.scss'],
  standalone: false
})
export class PostLessonStudentPage implements OnInit, OnDestroy {
  lessonId: string = '';
  lesson: LessonInfo | null = null;
  tutor: any = null;
  analysis: LessonAnalysis | null = null;
  analysisReady = false;
  
  // Trial lesson properties
  isTrialLesson = false;
  tutorFirstName = '';
  tutorDisplayName = 'Tutor';
  
  // Tip functionality
  showTipSection = false;
  selectedTipAmount: number | null = null;
  selectedTipPercentage: number | null = null;
  customTipAmount: number | null = null;
  tipSubmitted = false;
  submittingTip = false;
  
  // Polling
  private pollingInterval: any = null;
  pollCount = 0;
  maxPollAttempts = 60;

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
    console.log('🎓 POST-LESSON-STUDENT: Initializing with lessonId:', this.lessonId);
    
    // Wait for user to be loaded first
    await this.ensureUserLoaded();
    
    if (this.lessonId) {
      this.loadLessonInfo();
      this.startAnalysisPolling();
    } else {
      console.error('❌ POST-LESSON-STUDENT: No lesson ID provided!');
    }
  }

  private async ensureUserLoaded(): Promise<void> {
    try {
      const user = await firstValueFrom(this.userService.getCurrentUser());
      console.log('✅ POST-LESSON-STUDENT: User loaded:', user);
      console.log('✅ POST-LESSON-STUDENT: Current user email:', user?.email);
    } catch (error) {
      console.error('❌ POST-LESSON-STUDENT: Error loading user:', error);
    }
  }

  ngOnDestroy() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }

  async loadLessonInfo() {
    console.log('📚 POST-LESSON-STUDENT: Loading lesson info for:', this.lessonId);
    try {
      const response: any = await firstValueFrom(
        this.lessonService.getLesson(this.lessonId)
      );
      
      console.log('📚 POST-LESSON-STUDENT: Raw response:', response);
      
      if (response?.lesson) {
        this.lesson = response.lesson;
        // Backend returns tutorId and studentId, not tutor and student
        this.tutor = response.lesson.tutorId || response.lesson.tutor;
        console.log('✅ POST-LESSON-STUDENT: Lesson info loaded:', this.lesson);
        console.log('✅ POST-LESSON-STUDENT: Tutor info:', this.tutor);
        
        // Set trial lesson flag and tutor name properties
        this.isTrialLesson = response.lesson.isTrial || response.lesson.isTrialLesson || false;
        this.updateTutorProperties();
      } else {
        console.warn('⚠️ POST-LESSON-STUDENT: Response missing lesson data');
      }
    } catch (error) {
      console.error('❌ POST-LESSON-STUDENT: Error loading lesson info:', error);
    }
  }

  private updateTutorProperties() {
    if (!this.tutor) {
      this.tutorFirstName = '';
      this.tutorDisplayName = 'Tutor';
      return;
    }
    
    this.tutorFirstName = this.tutor.firstName || this.tutor.name?.split(' ')[0] || '';
    
    const firstName = this.tutor.firstName || this.tutor.name?.split(' ')[0];
    const lastName = this.tutor.lastName || this.tutor.name?.split(' ')[1];
    
    if (firstName && lastName) {
      this.tutorDisplayName = `${firstName} ${lastName.charAt(0)}.`;
    } else {
      this.tutorDisplayName = this.tutor.name || 'Tutor';
    }
  }

  startAnalysisPolling() {
    // Initial load
    this.checkAnalysis();
    
    // Poll every 3 seconds
    this.pollingInterval = setInterval(() => {
      this.pollCount++;
      if (this.pollCount >= this.maxPollAttempts) {
        clearInterval(this.pollingInterval);
        console.log('⏰ Max poll attempts reached');
        return;
      }
      this.checkAnalysis();
    }, 3000);
  }

  async checkAnalysis() {
    try {
      const headers = this.userService.getAuthHeadersSync();
      console.log('🔑 POST-LESSON-STUDENT: Auth headers for analysis check:', headers);
      
      const response: any = await firstValueFrom(
        this.http.get(`${environment.apiUrl}/transcription/lesson/${this.lessonId}/analysis`, { headers })
      );
      
      if (response?.analysis?.status === 'completed') {
        this.analysis = response.analysis;
        this.analysisReady = true;
        
        // Stop polling
        if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
        }
        
        console.log('✅ Analysis ready:', this.analysis);
      }
    } catch (error: any) {
      // Analysis not ready yet - continue polling
      if (error.status !== 404) {
        console.error('Error checking analysis:', error);
      }
    }
  }

  toggleTipSection() {
    this.showTipSection = !this.showTipSection;
  }

  selectTipAmount(amount: number) {
    this.selectedTipAmount = amount;
    this.selectedTipPercentage = null;
    this.customTipAmount = null;
  }

  selectTipPercentage(percentage: number) {
    this.selectedTipPercentage = percentage;
    this.selectedTipAmount = null;
    this.customTipAmount = null;
  }

  onCustomTipInput() {
    this.selectedTipAmount = null;
    this.selectedTipPercentage = null;
  }

  calculatePercentageTip(percentage: number): number {
    if (!this.lesson?.price) return 0;
    // Don't round - show exact percentage amount with cents
    return Math.round((this.lesson.price * percentage / 100) * 100) / 100;
  }

  getTipAmount(): number {
    if (this.customTipAmount && this.customTipAmount > 0) {
      return this.customTipAmount;
    }
    if (this.selectedTipAmount) {
      return this.selectedTipAmount;
    }
    if (this.selectedTipPercentage) {
      return this.calculatePercentageTip(this.selectedTipPercentage);
    }
    return 0;
  }

  async submitTip() {
    const tipAmount = this.getTipAmount();
    if (tipAmount <= 0 || this.submittingTip) return;

    this.submittingTip = true;

    try {
      const response: any = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/lessons/${this.lessonId}/tip`, {
          amount: tipAmount
        })
      );

      if (response.success) {
        this.tipSubmitted = true;
        this.showTipSection = false;
        
        const toast = await this.toastCtrl.create({
          message: `✅ $${tipAmount} tip sent to ${this.tutor?.name.split(' ')[0]}!`,
          duration: 3000,
          color: 'success',
          position: 'top'
        });
        await toast.present();
      }
    } catch (error: any) {
      console.error('Error submitting tip:', error);
      
      const alert = await this.alertCtrl.create({
        header: 'Tip Failed',
        message: error.error?.error || 'Failed to send tip. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      this.submittingTip = false;
    }
  }

  async leaveReview() {
    // Navigate to tutor profile with review section
    if (this.tutor) {
      await this.router.navigate(['/tabs/profile'], {
        queryParams: { userId: this.tutor._id, action: 'review' }
      });
    }
  }

  async bookAgain() {
    // Navigate to tutor profile to book
    if (this.tutor) {
      await this.router.navigate(['/tutor', this.tutor._id]);
    }
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

  viewFullAnalysis() {
    this.router.navigate(['/lesson-analysis', this.lessonId]);
  }
}

