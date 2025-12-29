import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, LoadingController, ToastController, AlertController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { LessonService, Lesson } from '../services/lesson.service';
import { UserService } from '../services/user.service';
import { AgoraService } from '../services/agora.service';
import { TutorFeedbackService } from '../services/tutor-feedback.service';
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
    private alertController: AlertController
  ) {}

  async ngOnInit() {
    await this.loadCurrentUser();
    await this.loadLessons();
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
}
