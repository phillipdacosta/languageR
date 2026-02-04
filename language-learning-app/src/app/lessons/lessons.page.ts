import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, LoadingController, ToastController, AlertController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { LessonService, Lesson } from '../services/lesson.service';
import { UserService } from '../services/user.service';
import { AgoraService } from '../services/agora.service';
import { TutorFeedbackService } from '../services/tutor-feedback.service';
import { Subject, interval, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-lessons',
  templateUrl: './lessons.page.html',
  styleUrls: ['./lessons.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class LessonsPage implements OnInit, OnDestroy {
  allCompletedLessons: Lesson[] = []; // All completed lessons (before filtering)
  completedLessons: Lesson[] = []; // Filtered completed lessons
  displayedLessons: Lesson[] = [];
  currentUser: any = null;
  isLoading = true;
  private destroy$ = new Subject<void>();
  
  // Lazy loading pagination
  private pageSize = 10; // Load 10 lessons at a time
  private currentPage = 0;
  
  // Filtering
  selectedTimeFilter: 'all' | '7days' | '30days' | '3months' = 'all';
  selectedTutorFilter: string = 'all'; // 'all' or tutorId (for students)
  selectedStudentFilter: string = 'all'; // 'all' or studentId (for tutors)
  uniqueTutors: Array<{ id: string; name: string; picture: string }> = [];
  uniqueStudents: Array<{ id: string; name: string; picture: string }> = [];
  
  // Coaching metrics
  coachingMetrics: any = null;

  constructor(
    private lessonService: LessonService,
    private userService: UserService,
    private agoraService: AgoraService,
    private tutorFeedbackService: TutorFeedbackService,
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private alertController: AlertController,
    private http: HttpClient
  ) {}

  async ngOnInit() {
    await this.loadCurrentUser();
    await this.loadLessons();
    
    // Load coaching metrics for tutors
    if (this.isTutor()) {
      await this.loadCoachingMetrics();
    }
    
    // Check for scrollToLesson query param
    this.route.queryParams.subscribe(params => {
      const lessonId = params['scrollToLesson'];
      if (lessonId) {
        // Wait a bit for the view to render
        setTimeout(() => {
          this.scrollToLesson(lessonId);
        }, 800);
      }
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
        console.log('🔍 DEBUG: API Response received:', response.lessons.length, 'lessons');
        
        // Log lessons with analysis status
        response.lessons.forEach((lesson: any) => {
          if (lesson.aiAnalysis) {
            console.log('  📊 Lesson', lesson._id, '- aiAnalysis:', lesson.aiAnalysis);
          }
        });
        
        const now = new Date();
        // Show completed lessons: EITHER status='completed' OR (endTime in past AND not cancelled)
        // This handles both properly completed lessons and lessons that ended but status wasn't updated
        this.allCompletedLessons = response.lessons
          .filter(lesson => {
            // Explicitly completed
            if (lesson.status === 'completed') return true;
            
            // Or ended naturally (fallback for lessons without status update)
            const lessonEndTime = new Date(lesson.endTime);
            return lessonEndTime < now && lesson.status !== 'cancelled';
          })
          .sort((a, b) => 
            // Most recent first (sort by startTime descending)
            new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
          );
        
        console.log('📅 Loaded completed lessons:', this.allCompletedLessons.length);
        console.log('📊 Lessons with analysis:', this.allCompletedLessons.filter(l => (l as any).aiAnalysis?.status === 'completed').length);
        
        // Extract unique tutors for filter (from all lessons)
        this.extractUniqueTutors();
        
        // Apply filters and load first page
        this.applyFilters();
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
  
  private extractUniqueTutors() {
    const tutorMap = new Map<string, { id: string; name: string; picture: string }>();
    const studentMap = new Map<string, { id: string; name: string; picture: string }>();
    
    this.allCompletedLessons.forEach(lesson => {
      const role = this.getUserRole(lesson);
      
      if (role === 'student') {
        // Student sees tutors
        const tutor = lesson.tutorId as any;
        const tutorId = tutor._id || tutor.id;
        
        if (!tutorMap.has(tutorId)) {
          const participant = this.getOtherParticipant(lesson);
          tutorMap.set(tutorId, {
            id: tutorId,
            name: participant.name,
            picture: participant.picture
          });
        }
      } else {
        // Tutor sees students
        const student = lesson.studentId as any;
        const studentId = student._id || student.id;
        
        if (!studentMap.has(studentId)) {
          const participant = this.getOtherParticipant(lesson);
          studentMap.set(studentId, {
            id: studentId,
            name: participant.name,
            picture: participant.picture
          });
        }
      }
    });
    
    this.uniqueTutors = Array.from(tutorMap.values());
    this.uniqueStudents = Array.from(studentMap.values());
  }
  
  applyFilters() {
    let filtered = [...this.allCompletedLessons];
    
    // Apply time filter
    if (this.selectedTimeFilter !== 'all') {
      const now = new Date();
      let cutoffDate = new Date();
      
      switch (this.selectedTimeFilter) {
        case '7days':
          cutoffDate.setDate(now.getDate() - 7);
          break;
        case '30days':
          cutoffDate.setDate(now.getDate() - 30);
          break;
        case '3months':
          cutoffDate.setMonth(now.getMonth() - 3);
          break;
      }
      
      filtered = filtered.filter(lesson => 
        new Date(lesson.startTime) >= cutoffDate
      );
    }
    
    // Apply tutor filter (for students)
    if (this.selectedTutorFilter !== 'all' && this.isStudent()) {
      filtered = filtered.filter(lesson => {
        const tutor = lesson.tutorId as any;
        const tutorId = tutor._id || tutor.id;
        return tutorId === this.selectedTutorFilter;
      });
    }
    
    // Apply student filter (for tutors)
    if (this.selectedStudentFilter !== 'all' && this.isTutor()) {
      filtered = filtered.filter(lesson => {
        const student = lesson.studentId as any;
        const studentId = student._id || student.id;
        return studentId === this.selectedStudentFilter;
      });
    }
    
    // Update filtered completed lessons
    this.completedLessons = filtered;
    
    // Reset pagination and load first page
    this.currentPage = 0;
    this.loadFirstPage();
  }
  
  onTimeFilterChange(event: any) {
    this.selectedTimeFilter = event.detail.value;
    this.applyFilters();
  }
  
  onTutorFilterChange(event: any) {
    this.selectedTutorFilter = event.detail.value;
    this.applyFilters();
  }
  
  onStudentFilterChange(event: any) {
    this.selectedStudentFilter = event.detail.value;
    this.applyFilters();
  }
  
  isStudent(): boolean {
    return this.currentUser?.userType === 'student';
  }
  
  isTutor(): boolean {
    return this.currentUser?.userType === 'tutor';
  }
  
  private loadFirstPage() {
    const endIndex = Math.min(this.pageSize, this.completedLessons.length);
    this.displayedLessons = this.completedLessons.slice(0, endIndex);
    this.currentPage = 1;
  }
  
  loadMoreLessons(event: any) {
    setTimeout(() => {
      const startIndex = this.currentPage * this.pageSize;
      const endIndex = Math.min(startIndex + this.pageSize, this.completedLessons.length);
      
      if (startIndex < this.completedLessons.length) {
        const newLessons = this.completedLessons.slice(startIndex, endIndex);
        this.displayedLessons = [...this.displayedLessons, ...newLessons];
        this.currentPage++;
      }
      
      event.target.complete();
    }, 500); // Simulate network delay
  }
  
  hasMoreLessons(): boolean {
    return this.displayedLessons.length < this.completedLessons.length;
  }
  
  goBack() {
    this.location.back();
  }

  goToHome() {
    this.router.navigate(['/tabs/home']);
  }

  // No longer needed for completed lessons only
  // private async updateLessonStatuses() { ... }
  // canJoinLesson() - removed
  // getTimeUntilJoin() - removed
  // joinLesson() - removed
  // cancelLesson() - removed

  getUserRole(lesson: Lesson): 'tutor' | 'student' {
    if (!this.currentUser) return 'student';
    return lesson.tutorId._id === this.currentUser.id ? 'tutor' : 'student';
  }

  getOtherParticipant(lesson: Lesson): { name: string; picture: string } {
    const role = this.getUserRole(lesson);
    const participant = role === 'tutor' ? lesson.studentId : lesson.tutorId;
    
    if (!participant) {
      return { name: 'Unknown', picture: '/assets/default-avatar.png' };
    }
    
    const participantData = participant as any;
    
    // Format name as "FirstName L."
    let formattedName = '';
    if (participantData.firstName && participantData.lastName) {
      const lastInitial = participantData.lastName.charAt(0).toUpperCase();
      formattedName = `${participantData.firstName} ${lastInitial}.`;
    } else if (participantData.firstName) {
      formattedName = participantData.firstName;
    } else if (participantData.name) {
      // If full name is in 'name' field, split it
      const nameParts = participantData.name.trim().split(' ');
      if (nameParts.length > 1) {
        const firstName = nameParts[0];
        const lastInitial = nameParts[nameParts.length - 1].charAt(0).toUpperCase();
        formattedName = `${firstName} ${lastInitial}.`;
      } else {
        formattedName = participantData.name;
      }
    } else {
      formattedName = participantData.email || 'Unknown';
    }
    
    const picture = participantData.picture || participantData.profilePicture || '/assets/default-avatar.png';
    
    return { name: formattedName, picture };
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

  viewAnalysis(lesson: Lesson) {
    this.router.navigate(['/lesson-analysis', lesson._id]);
  }
  
  // Check analysis availability status
  getAnalysisStatus(lesson: Lesson): 'available' | 'generating' | 'unavailable' {
    // Check if lesson has AI analysis data
    const aiAnalysis = (lesson as any).aiAnalysis;
    
    // Check if lesson has tutor feedback
    const tutorFeedback = (lesson as any).tutorFeedback;
    
    // If tutor feedback is completed, show as available
    if (tutorFeedback?.status === 'completed') {
      return 'available';
    }
    
    // If generating AI analysis
    if (aiAnalysis?.status === 'generating') {
      return 'generating';
    }
    
    // If AI analysis is completed
    if (aiAnalysis?.status === 'completed' || aiAnalysis?.summary) {
      return 'available';
    }
    
    // No analysis or feedback data yet
    return 'unavailable';
  }

  hasTutorFeedback(lesson: Lesson): boolean {
    const tutorFeedback = (lesson as any).tutorFeedback;
    return tutorFeedback?.status === 'completed';
  }

  hasAIAnalysis(lesson: Lesson): boolean {
    const aiAnalysis = (lesson as any).aiAnalysis;
    return aiAnalysis?.status === 'completed' || aiAnalysis?.summary;
  }

  async viewFeedback(lesson: Lesson) {
    const lessonId = lesson._id;
    
    // Check if this lesson has tutor feedback
    if (this.hasTutorFeedback(lesson)) {
      // Navigate to a feedback view page or open modal
      // For now, we'll just show it in an alert (you can enhance this later)
      try {
        const response = await firstValueFrom(this.tutorFeedbackService.getFeedbackForLesson(lessonId));
        if (response.success && response.feedback) {
          const feedback = response.feedback;
          
          let message = '';
          if (feedback.strengths.length > 0) {
            message += `<strong>Strengths:</strong><br>`;
            feedback.strengths.forEach(s => message += `• ${s}<br>`);
            message += '<br>';
          }
          if (feedback.areasForImprovement.length > 0) {
            message += `<strong>Areas for Improvement:</strong><br>`;
            feedback.areasForImprovement.forEach(a => message += `• ${a}<br>`);
            message += '<br>';
          }
          if (feedback.homework) {
            message += `<strong>Homework:</strong><br>${feedback.homework}<br><br>`;
          }
          if (feedback.overallNotes) {
            message += `<strong>Notes:</strong><br>${feedback.overallNotes}`;
          }
          
          const alert = await this.alertController.create({
            header: 'Tutor Feedback',
            message,
            buttons: ['OK']
          });
          await alert.present();
        }
      } catch (error) {
        console.error('Error loading feedback:', error);
        const toast = await this.toastController.create({
          message: 'Failed to load feedback',
          duration: 3000,
          color: 'danger'
        });
        await toast.present();
      }
      return;
    }
    
    // Otherwise, view AI analysis
    if (this.hasAIAnalysis(lesson)) {
      this.router.navigate(['/lesson-analysis', lessonId]);
    }
  }
  
  // TODO: Implement payment status check when payment logic is added
  // For now, all completed lessons are considered "Settled"
  getPaymentStatus(lesson: Lesson): 'settled' | 'pending' | 'refunded' {
    // Future: Check lesson.paymentStatus or call payment service
    // For now, completed lessons = settled
    return 'settled';
  }
  
  // Load coaching badge metrics (for tutors)
  async loadCoachingMetrics() {
    if (!this.isTutor()) return;
    
    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/users/coaching-metrics`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );
      
      if (response.success) {
        this.coachingMetrics = response.data;
        console.log('🎓 Loaded coaching metrics:', this.coachingMetrics);
      }
    } catch (error: any) {
      console.error('❌ Error loading coaching metrics:', error);
      // Don't show error to user - just silently fail
    }
  }

  scrollToLesson(lessonId: string) {
    console.log('📍 Attempting to scroll to lesson:', lessonId);
    
    // Find the lesson element by lesson ID
    const element = document.getElementById(`lesson-${lessonId}`);
    
    if (element) {
      // Scroll into view with smooth animation
      element.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
      
      // Add highlight animation
      element.classList.add('highlight-lesson');
      setTimeout(() => {
        element.classList.remove('highlight-lesson');
      }, 2000);
      
      console.log('✅ Scrolled to lesson:', lessonId);
    } else {
      console.log('⚠️ Lesson element not found for lesson:', lessonId);
    }
  }
  
  /**
   * Check if student can report an issue for this lesson
   * Only allowed within 24 hours of lesson completion
   */
  canReportIssue(lesson: Lesson): boolean {
    if (!lesson.endTime || lesson.issueReported) {
      return false;
    }
    
    const lessonEndTime = new Date(lesson.endTime).getTime();
    const now = new Date().getTime();
    const hoursSinceEnd = (now - lessonEndTime) / (1000 * 60 * 60);
    
    // Can report within 24 hours
    return hoursSinceEnd <= 24;
  }
  
  /**
   * Report an issue with a lesson
   */
  async reportIssue(lesson: Lesson) {
    const alert = await this.alertController.create({
      header: 'Report Issue',
      message: 'Please select the issue you experienced with this lesson:',
      inputs: [
        {
          type: 'radio',
          label: 'Tutor didn\'t show up',
          value: 'tutor_no_show'
        },
        {
          type: 'radio',
          label: 'Lesson ended early without notice',
          value: 'ended_early'
        },
        {
          type: 'radio',
          label: 'Poor lesson quality',
          value: 'poor_quality'
        },
        {
          type: 'radio',
          label: 'Inappropriate behavior',
          value: 'inappropriate'
        },
        {
          type: 'radio',
          label: 'Technical issues prevented lesson',
          value: 'technical'
        },
        {
          type: 'radio',
          label: 'Other',
          value: 'other'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Next',
          handler: (issueType) => {
            if (!issueType) {
              this.showToast('Please select an issue type', 'warning');
              return false;
            }
            // Show details input
            this.showIssueDetailsInput(lesson, issueType);
            return true;
          }
        }
      ]
    });
    
    await alert.present();
  }
  
  /**
   * Show input for issue details
   */
  private async showIssueDetailsInput(lesson: Lesson, issueType: string) {
    const alert = await this.alertController.create({
      header: 'Issue Details',
      message: 'Please provide additional details about the issue:',
      inputs: [
        {
          name: 'details',
          type: 'textarea',
          placeholder: 'Describe what happened...',
          attributes: {
            minlength: 10,
            maxlength: 500
          }
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Submit Report',
          handler: async (data) => {
            if (!data.details || data.details.length < 10) {
              this.showToast('Please provide at least 10 characters of details', 'warning');
              return false;
            }
            
            await this.submitIssueReport(lesson, issueType, data.details);
            return true;
          }
        }
      ]
    });
    
    await alert.present();
  }
  
  /**
   * Submit issue report to backend
   */
  private async submitIssueReport(lesson: Lesson, issueType: string, details: string) {
    const loading = await this.loadingController.create({
      message: 'Submitting report...'
    });
    await loading.present();
    
    try {
      const response = await firstValueFrom(
        this.http.post<any>(
          `${environment.apiUrl}/lessons/${lesson._id}/report-issue`,
          {
            issueType,
            details
          },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );
      
      if (response.success) {
        // Update local lesson state
        lesson.issueReported = true;
        
        await this.showToast('Issue reported successfully. Our team will review it shortly.', 'success');
        
        // Reload lessons to get updated state
        await this.loadLessons();
      }
    } catch (error: any) {
      console.error('Error reporting issue:', error);
      await this.showToast(
        error?.error?.message || 'Failed to report issue. Please try again.',
        'danger'
      );
    } finally {
      await loading.dismiss();
    }
  }
  
  /**
   * Show toast message
   */
  private async showToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  /**
   * Check if tutor has already added a note for this lesson
   */
  hasTutorNote(lesson: Lesson): boolean {
    const tutorNote = (lesson as any).tutorNote;
    return !!(tutorNote && tutorNote.text);
  }

  /**
   * Navigate to add/edit tutor note for a lesson
   */
  addTutorNote(lesson: Lesson) {
    // Navigate to the post-lesson-tutor page to add a note
    this.router.navigate(['/post-lesson-tutor', lesson._id]);
  }

  /**
   * View the tutor's note for a lesson
   */
  async viewTutorNote(lesson: Lesson) {
    const tutorNote = (lesson as any).tutorNote;
    
    if (!tutorNote || !tutorNote.text) {
      await this.showToast('No note found for this lesson', 'warning');
      return;
    }

    let message = '';
    
    if (tutorNote.quickImpression) {
      message += `<strong>Quick Impression:</strong> ${tutorNote.quickImpression}<br><br>`;
    }
    
    message += `<strong>Your Note:</strong><br>${tutorNote.text}`;
    
    if (tutorNote.homework) {
      message += `<br><br><strong>Homework:</strong><br>${tutorNote.homework}`;
    }

    const alert = await this.alertController.create({
      header: 'Your Note for This Lesson',
      message,
      buttons: [
        {
          text: 'Edit',
          handler: () => {
            this.addTutorNote(lesson);
          }
        },
        {
          text: 'Close',
          role: 'cancel'
        }
      ]
    });
    await alert.present();
  }
}
