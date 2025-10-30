import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, LoadingController, ToastController, AlertController } from '@ionic/angular';
import { Router } from '@angular/router';
import { LessonService, Lesson } from '../services/lesson.service';
import { UserService } from '../services/user.service';
import { AgoraService } from '../services/agora.service';
import { Subject, interval, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-lessons',
  templateUrl: './lessons.page.html',
  styleUrls: ['./lessons.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class LessonsPage implements OnInit, OnDestroy {
  lessons: Lesson[] = [];
  currentUser: any = null;
  isLoading = true;
  private destroy$ = new Subject<void>();
  private statusTimer$ = interval(30000); // Update every 30 seconds

  constructor(
    private lessonService: LessonService,
    private userService: UserService,
    private agoraService: AgoraService,
    private router: Router,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private alertController: AlertController
  ) {}

  async ngOnInit() {
    await this.loadCurrentUser();
    await this.loadLessons();
    
    // Update lesson statuses periodically
    this.statusTimer$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.updateLessonStatuses();
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadCurrentUser() {
    try {
      this.currentUser = await firstValueFrom(this.userService.getCurrentUser());
    } catch (error) {
      console.error('Error loading current user:', error);
    }
  }

  async loadLessons() {
    this.isLoading = true;
    try {
      const response = await firstValueFrom(this.lessonService.getMyLessons());
      if (response?.success) {
        this.lessons = response.lessons.sort((a, b) => 
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        );
        console.log('📅 Loaded lessons:', this.lessons);
      }
    } catch (error) {
      console.error('Error loading lessons:', error);
      const toast = await this.toastController.create({
        message: 'Failed to load lessons',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
    } finally {
      this.isLoading = false;
    }
  }

  private async updateLessonStatuses() {
    // Update lesson statuses without showing loading
    for (const lesson of this.lessons) {
      if (lesson.status === 'scheduled') {
        try {
          const status = await firstValueFrom(this.lessonService.getLessonStatus(lesson._id));
          if (status?.success) {
            // Update lesson with current status info
            (lesson as any).canJoin = status.canJoin;
            (lesson as any).timeUntilJoin = status.timeUntilJoin;
            (lesson as any).serverTime = status.serverTime;
          }
        } catch (error) {
          // Silently handle errors for status updates
        }
      }
    }
  }

  canJoinLesson(lesson: Lesson): boolean {
    if (lesson.status !== 'scheduled') return false;
    return this.lessonService.canJoinLesson(lesson, (lesson as any).serverTime);
  }

  getTimeUntilJoin(lesson: Lesson): string {
    const timeUntil = this.lessonService.getTimeUntilJoin(lesson, (lesson as any).serverTime);
    return this.lessonService.formatTimeUntil(timeUntil);
  }

  getUserRole(lesson: Lesson): 'tutor' | 'student' {
    if (!this.currentUser) return 'student';
    return lesson.tutorId._id === this.currentUser.id ? 'tutor' : 'student';
  }

  getOtherParticipant(lesson: Lesson): any {
    const role = this.getUserRole(lesson);
    return role === 'tutor' ? lesson.studentId : lesson.tutorId;
  }

  async joinLesson(lesson: Lesson) {
    const loading = await this.loadingController.create({
      message: 'Joining lesson...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Initialize Agora client if not already done
      if (!this.agoraService.getClient()) {
        await this.agoraService.initializeClient();
      }

      const userRole = this.getUserRole(lesson);
      
      // Join via AgoraService to use backend-provided token/appId/uid
      const joinResponse = await this.agoraService.joinLesson(lesson._id, userRole, this.currentUser?.id);

      // Navigate to video call page with lesson context
      this.router.navigate(['/video-call'], {
        queryParams: {
          lessonId: lesson._id,
          channelName: joinResponse.agora.channelName,
          role: userRole,
          lessonMode: true
        }
      });

    } catch (error: any) {
      console.error('❌ Error joining lesson:', error);
      
      const toast = await this.toastController.create({
        message: error.message || 'Failed to join lesson',
        duration: 4000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    } finally {
      await loading.dismiss();
    }
  }

  async cancelLesson(lesson: Lesson) {
    const alert = await this.alertController.create({
      header: 'Cancel Lesson',
      message: 'Are you sure you want to cancel this lesson? This action cannot be undone.',
      buttons: [
        {
          text: 'Keep Lesson',
          role: 'cancel'
        },
        {
          text: 'Cancel Lesson',
          role: 'destructive',
          handler: () => {
            // TODO: Implement lesson cancellation
            console.log('Cancel lesson:', lesson._id);
          }
        }
      ]
    });
    await alert.present();
  }

  formatLessonTime(lesson: Lesson): string {
    const start = new Date(lesson.startTime);
    const end = new Date(lesson.endTime);
    
    const dateOptions: Intl.DateTimeFormatOptions = { 
      weekday: 'long', 
      month: 'short', 
      day: 'numeric' 
    };
    
    const timeOptions: Intl.DateTimeFormatOptions = { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    };
    
    const dateStr = start.toLocaleDateString('en-US', dateOptions);
    const timeStr = `${start.toLocaleTimeString('en-US', timeOptions)} - ${end.toLocaleTimeString('en-US', timeOptions)}`;
    
    return `${dateStr}, ${timeStr}`;
  }

  getStatusColor(lesson: Lesson): string {
    switch (lesson.status) {
      case 'scheduled': return 'primary';
      case 'in_progress': return 'success';
      case 'completed': return 'medium';
      case 'cancelled': return 'danger';
      default: return 'medium';
    }
  }

  getStatusText(lesson: Lesson): string {
    switch (lesson.status) {
      case 'scheduled': return 'Scheduled';
      case 'in_progress': return 'In Progress';
      case 'completed': return 'Completed';
      case 'cancelled': return 'Cancelled';
      default: return lesson.status;
    }
  }

  async doRefresh(event: any) {
    await this.loadLessons();
    event.target.complete();
  }

  trackByLessonId(index: number, lesson: Lesson): string {
    return lesson._id;
  }
}
