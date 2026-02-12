import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, LoadingController, ToastController, AlertController, ViewWillEnter } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { LessonService, Lesson } from '../services/lesson.service';
import { UserService } from '../services/user.service';
import { AgoraService } from '../services/agora.service';
import { TutorFeedbackService } from '../services/tutor-feedback.service';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil, filter, take } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// Pre-computed lesson display model (avoids function calls in template)
interface ProcessedLesson {
  id: string;
  lesson: Lesson;
  subject: string;
  role: 'tutor' | 'student';
  roleLabel: string;
  otherName: string;
  otherPicture: string;
  otherInitials: string;
  formattedMonth: string;
  formattedDayNum: string;
  formattedWeekday: string;
  formattedDate: string;
  formattedTimeRange: string;
  duration: number;
  price: number;
  formattedPrice: string;
  status: string;
  statusLabel: string;
  isTrial: boolean;
  isUpcoming: boolean;
  analysisStatus: 'available' | 'generating' | 'unavailable';
  hasTutorFeedbackAvailable: boolean;
  hasAIAnalysisAvailable: boolean;
  hasTutorNoteAvailable: boolean;
  canReportIssue: boolean;
  isIssueReported: boolean;
  showActions: boolean;
  canJoin: boolean;
  needsTutorFeedback: boolean;
  canAddOptionalNote: boolean;
  tipSent: boolean;
  tipAmount: string;
}

@Component({
  selector: 'app-lessons',
  templateUrl: './lessons.page.html',
  styleUrls: ['./lessons.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class LessonsPage implements OnInit, OnDestroy, ViewWillEnter {
  // Raw data
  allLessons: Lesson[] = [];
  currentUser: any = null;
  isLoading = true;
  private destroy$ = new Subject<void>();
  private hasInitiallyLoaded = false;

  // Processed & filtered
  filteredLessons: Lesson[] = [];
  processedLessons: ProcessedLesson[] = [];
  processedDisplayed: ProcessedLesson[] = [];

  // Pagination
  private pageSize = 15;
  private currentPage = 0;
  hasMoreLessonsAvailable = false;

  // Filters
  selectedStatusFilter: 'all' | 'upcoming' | 'completed' | 'cancelled' = 'all';
  selectedTimeFilter: 'all' | '7days' | '30days' | '3months' = 'all';
  selectedTutorFilter = 'all';
  selectedStudentFilter = 'all';
  uniqueTutors: Array<{ id: string; name: string; picture: string }> = [];
  uniqueStudents: Array<{ id: string; name: string; picture: string }> = [];

  // Pre-computed counts
  totalCount = 0;
  upcomingCount = 0;
  completedCount = 0;
  cancelledCount = 0;

  // Pre-computed user type flags (no function calls in template)
  isStudentUser = false;
  isTutorUser = false;

  // Filters modal
  isFiltersModalOpen = false;
  activeFilterCount = 0;
  hasActiveSecondaryFilters = false;
  statusFilterLabel = '';
  timeFilterLabel = '';
  participantFilterLabel = '';

  // Note modal
  isNoteModalOpen = false;
  selectedNoteLesson: any = null;
  selectedNoteLessonHasFeedback = false;

  // Feedback modal
  isFeedbackModalOpen = false;
  private isOpeningFeedbackModal = false; // Prevent duplicate opens
  selectedFeedbackStrengths: string[] = [];
  selectedFeedbackAreas: string[] = [];
  selectedFeedbackHomework = '';
  selectedFeedbackNotes = '';

  // Expanded lesson row (for actions)
  expandedLessonId: string | null = null;

  constructor(
    private lessonService: LessonService,
    private userService: UserService,
    private agoraService: AgoraService,
    private tutorFeedbackService: TutorFeedbackService,
    private router: Router,
    private route: ActivatedRoute,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private alertController: AlertController,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    // Subscribe to currentUser$ – only load lessons once we have a valid user
    // This avoids the race condition where Auth0 hasn't initialized yet
    this.userService.currentUser$.pipe(
      filter(user => !!user),
      take(1),
      takeUntil(this.destroy$)
    ).subscribe(user => {
      this.currentUser = user;
      this.isStudentUser = user?.userType === 'student';
      this.isTutorUser = user?.userType === 'tutor';
      this.loadLessons();
    });

    // Trigger user load if not already cached
    this.userService.getCurrentUser().pipe(
      takeUntil(this.destroy$)
    ).subscribe();

    // Check for scrollToLesson query param
    this.route.queryParams.pipe(
      takeUntil(this.destroy$)
    ).subscribe(params => {
      const lessonId = params['scrollToLesson'];
      if (lessonId) {
        setTimeout(() => this.scrollToLesson(lessonId), 800);
      }
    });
  }

  ionViewWillEnter() {
    // On re-entry, reload lessons if we've already loaded once
    if (this.hasInitiallyLoaded && this.currentUser) {
      this.loadLessons();
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async loadLessons() {
    this.isLoading = true;
    this.cdr.detectChanges();
    try {
      const response = await firstValueFrom(this.lessonService.getMyLessons());
      if (response?.success) {
        // Include ALL lessons, sorted by most recent first
        this.allLessons = response.lessons.sort((a, b) =>
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
        );

        // Compute counts from all lessons
        this.computeCounts();

        // Extract unique tutors/students for filter
        this.extractUniqueParticipants();

        // Apply filters and process
        this.applyFilters();

        this.hasInitiallyLoaded = true;
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
      this.cdr.detectChanges();
    }
  }

  // ─── Counts ──────────────────────────────────────────
  private computeCounts() {
    const now = new Date();
    this.totalCount = this.allLessons.length;
    this.upcomingCount = this.allLessons.filter(l =>
      (l.status === 'scheduled' || l.status === 'in_progress' || l.status === 'pending_reschedule') &&
      new Date(l.endTime) >= now
    ).length;
    this.completedCount = this.allLessons.filter(l => l.status === 'completed').length;
    this.cancelledCount = this.allLessons.filter(l => l.status === 'cancelled').length;
  }

  // ─── Filters ─────────────────────────────────────────
  setStatusFilter(status: 'all' | 'upcoming' | 'completed' | 'cancelled') {
    this.selectedStatusFilter = status;
    this.applyFilters();
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

  // ─── Filters Modal ──────────────────────────────────
  openFiltersModal() {
    this.isFiltersModalOpen = true;
  }

  closeFiltersModal() {
    this.isFiltersModalOpen = false;
  }

  clearSecondaryFilters() {
    this.selectedStatusFilter = 'all';
    this.selectedTutorFilter = 'all';
    this.selectedStudentFilter = 'all';
    this.selectedTimeFilter = 'all';
    this.applyFilters();
  }

  hasSecondaryFilters(): boolean {
    return this.selectedStatusFilter !== 'all' ||
           this.selectedTutorFilter !== 'all' ||
           this.selectedStudentFilter !== 'all' ||
           this.selectedTimeFilter !== 'all';
  }

  private updateFilterState() {
    let count = 0;
    if (this.selectedStatusFilter !== 'all') count++;
    if (this.selectedTimeFilter !== 'all') count++;
    if (this.isStudentUser && this.selectedTutorFilter !== 'all') count++;
    if (this.isTutorUser && this.selectedStudentFilter !== 'all') count++;
    this.activeFilterCount = count;
    this.hasActiveSecondaryFilters = count > 0;

    // Status label
    switch (this.selectedStatusFilter) {
      case 'upcoming': this.statusFilterLabel = 'Upcoming'; break;
      case 'completed': this.statusFilterLabel = 'Completed'; break;
      case 'cancelled': this.statusFilterLabel = 'Cancelled'; break;
      default: this.statusFilterLabel = ''; break;
    }

    // Time label
    switch (this.selectedTimeFilter) {
      case '7days': this.timeFilterLabel = 'Last 7 days'; break;
      case '30days': this.timeFilterLabel = 'Last 30 days'; break;
      case '3months': this.timeFilterLabel = 'Last 3 months'; break;
      default: this.timeFilterLabel = ''; break;
    }

    // Participant label
    if (this.isStudentUser && this.selectedTutorFilter !== 'all') {
      const t = this.uniqueTutors.find(t => t.id === this.selectedTutorFilter);
      this.participantFilterLabel = t?.name || this.selectedTutorFilter;
    } else if (this.isTutorUser && this.selectedStudentFilter !== 'all') {
      const s = this.uniqueStudents.find(s => s.id === this.selectedStudentFilter);
      this.participantFilterLabel = s?.name || this.selectedStudentFilter;
    } else {
      this.participantFilterLabel = '';
    }
  }

  applyFilters() {
    const now = new Date();
    let filtered = [...this.allLessons];

    // Status filter
    if (this.selectedStatusFilter === 'upcoming') {
      filtered = filtered.filter(l =>
        (l.status === 'scheduled' || l.status === 'in_progress' || l.status === 'pending_reschedule') &&
        new Date(l.endTime) >= now
      );
    } else if (this.selectedStatusFilter === 'completed') {
      filtered = filtered.filter(l => l.status === 'completed');
    } else if (this.selectedStatusFilter === 'cancelled') {
      filtered = filtered.filter(l => l.status === 'cancelled');
    }

    // Time filter
    if (this.selectedTimeFilter !== 'all') {
      let cutoffDate = new Date();
      switch (this.selectedTimeFilter) {
        case '7days': cutoffDate.setDate(now.getDate() - 7); break;
        case '30days': cutoffDate.setDate(now.getDate() - 30); break;
        case '3months': cutoffDate.setMonth(now.getMonth() - 3); break;
      }
      filtered = filtered.filter(l => new Date(l.startTime) >= cutoffDate);
    }

    // Tutor filter (for students)
    if (this.selectedTutorFilter !== 'all' && this.isStudentUser) {
      filtered = filtered.filter(l => {
        const tutor = l.tutorId as any;
        const id = String(tutor?._id || tutor?.id || tutor || '');
        return id === this.selectedTutorFilter;
      });
    }

    // Student filter (for tutors)
    if (this.selectedStudentFilter !== 'all' && this.isTutorUser) {
      filtered = filtered.filter(l => {
        const student = l.studentId as any;
        const id = String(student?._id || student?.id || student || '');
        return id === this.selectedStudentFilter;
      });
    }

    this.filteredLessons = filtered;

    // Process lessons (pre-compute display data)
    this.processedLessons = this.filteredLessons.map(l => this.processLesson(l));

    // Reset pagination
    this.currentPage = 0;
    this.loadFirstPage();

    // Update filter state for chips
    this.updateFilterState();
  }

  // ─── Pre-compute lesson display data ─────────────────
  private processLesson(lesson: Lesson): ProcessedLesson {
    const role = this.getUserRole(lesson);
    const other = this.getOtherParticipant(lesson);
    const start = new Date(lesson.startTime);
    const end = new Date(lesson.endTime);
    const now = new Date();

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
    const startStr = start.toLocaleTimeString('en-US', timeOpts);
    const endStr = end.toLocaleTimeString('en-US', timeOpts);

    // Status
    let status = lesson.status;
    let statusLabel = this.getStatusText(lesson);
    const isUpcoming = (status === 'scheduled' || status === 'in_progress' || status === 'pending_reschedule') && end >= now;

    // Analysis status
    let analysisStatus: 'available' | 'generating' | 'unavailable' = 'unavailable';
    const aiAnalysis = (lesson as any).aiAnalysis;
    const tutorFeedback = (lesson as any).tutorFeedback;
    if (tutorFeedback?.status === 'completed') {
      analysisStatus = 'available';
    } else if (aiAnalysis?.status === 'generating') {
      analysisStatus = 'generating';
    } else if (aiAnalysis?.status === 'completed' || aiAnalysis?.hasAnalysis) {
      analysisStatus = 'available';
    }

    // Tutor note
    const tutorNote = (lesson as any).tutorNote;
    const hasTutorNoteAvailable = !!(tutorNote && tutorNote.text);

    // Can report issue (within 24h of end)
    const hoursSinceEnd = lesson.endTime ? (now.getTime() - new Date(lesson.endTime).getTime()) / (1000 * 60 * 60) : Infinity;
    const canReportIssue = role === 'student' && status === 'completed' && !lesson.issueReported && hoursSinceEnd <= 24;

    // Can join (upcoming or in-progress, within 10 min before start to end)
    const minutesUntilStart = (start.getTime() - now.getTime()) / (1000 * 60);
    const canJoin = (status === 'scheduled' || status === 'in_progress') && minutesUntilStart <= 10 && end > now;

    // Initials
    const nameParts = other.name.split(' ');
    const initials = nameParts.length > 1
      ? `${nameParts[0].charAt(0)}${nameParts[1].charAt(0)}`
      : nameParts[0].charAt(0);

    // Tutor needs to leave feedback? Only when a TutorFeedback record exists, is pending, and is required
    const hasTutorFeedbackAvailable = tutorFeedback?.status === 'completed';
    const needsTutorFeedback = role === 'tutor'
      && status === 'completed'
      && !!tutorFeedback
      && tutorFeedback.status === 'pending'
      && tutorFeedback.required !== false;

    // Tutor can optionally add a note to AI-analyzed lessons (no TutorFeedback record = AI handled it)
    const canAddOptionalNote = role === 'tutor'
      && status === 'completed'
      && !hasTutorFeedbackAvailable
      && !needsTutorFeedback;

    // Show actions row? (completed, joinable, or needs feedback badge)
    const showActions = status === 'completed' || canJoin;

    return {
      id: lesson._id,
      lesson,
      subject: lesson.subject || 'Lesson',
      role,
      roleLabel: role === 'student' ? 'Tutor' : 'Student',
      otherName: other.name,
      otherPicture: other.picture === '/assets/default-avatar.png' ? '' : other.picture,
      otherInitials: initials.toUpperCase(),
      formattedMonth: monthNames[start.getMonth()],
      formattedDayNum: String(start.getDate()),
      formattedWeekday: dayNames[start.getDay()],
      formattedDate: `${dayNames[start.getDay()]}, ${monthNames[start.getMonth()]} ${start.getDate()}`,
      formattedTimeRange: `${startStr} – ${endStr}`,
      duration: lesson.duration,
      price: lesson.price,
      formattedPrice: (lesson.price || 0).toFixed(2),
      status,
      statusLabel,
      isTrial: !!lesson.isTrialLesson,
      isUpcoming,
      analysisStatus,
      hasTutorFeedbackAvailable,
      hasAIAnalysisAvailable: aiAnalysis?.status === 'completed' || !!aiAnalysis?.hasAnalysis,
      hasTutorNoteAvailable,
      canReportIssue,
      isIssueReported: !!lesson.issueReported,
      showActions,
      canJoin,
      needsTutorFeedback,
      canAddOptionalNote,
      tipSent: !!(lesson as any).tip && !!(lesson as any).tip.amount,
      tipAmount: (lesson as any).tip?.amount ? (lesson as any).tip.amount.toFixed(2) : '0.00'
    };
  }

  // ─── Pagination ──────────────────────────────────────
  private loadFirstPage() {
    const endIndex = Math.min(this.pageSize, this.processedLessons.length);
    this.processedDisplayed = this.processedLessons.slice(0, endIndex);
    this.currentPage = 1;
    this.hasMoreLessonsAvailable = this.processedDisplayed.length < this.processedLessons.length;
  }

  loadMoreLessons(event: any) {
    setTimeout(() => {
      const startIndex = this.currentPage * this.pageSize;
      const endIndex = Math.min(startIndex + this.pageSize, this.processedLessons.length);

      if (startIndex < this.processedLessons.length) {
        const more = this.processedLessons.slice(startIndex, endIndex);
        this.processedDisplayed = [...this.processedDisplayed, ...more];
        this.currentPage++;
      }

      this.hasMoreLessonsAvailable = this.processedDisplayed.length < this.processedLessons.length;
      event.target.complete();
    }, 400);
  }

  // ─── Extract unique participants ─────────────────────
  private extractUniqueParticipants() {
    const tutorMap = new Map<string, { id: string; name: string; picture: string }>();
    const studentMap = new Map<string, { id: string; name: string; picture: string }>();

    this.allLessons.forEach(lesson => {
      const role = this.getUserRole(lesson);

      if (role === 'student') {
        const tutor = lesson.tutorId as any;
        if (!tutor) return;
        const tutorId = String(tutor._id || tutor.id || tutor);
        if (tutorId && !tutorMap.has(tutorId)) {
          const p = this.getOtherParticipant(lesson);
          tutorMap.set(tutorId, { id: tutorId, name: p.name, picture: p.picture });
        }
      } else {
        const student = lesson.studentId as any;
        if (!student) return;
        const studentId = String(student._id || student.id || student);
        if (studentId && !studentMap.has(studentId)) {
          const p = this.getOtherParticipant(lesson);
          studentMap.set(studentId, { id: studentId, name: p.name, picture: p.picture });
        }
      }
    });

    this.uniqueTutors = Array.from(tutorMap.values());
    this.uniqueStudents = Array.from(studentMap.values());
  }

  // ─── Helper methods (called in TS only, NOT template) ─
  private getUserRole(lesson: Lesson): 'tutor' | 'student' {
    if (!this.currentUser) return 'student';
    const tutorId = String((lesson.tutorId as any)?._id || (lesson.tutorId as any)?.id || lesson.tutorId || '');
    const currentUserId = String(this.currentUser._id || this.currentUser.id || '');
    return tutorId === currentUserId ? 'tutor' : 'student';
  }

  private getOtherParticipant(lesson: Lesson): { name: string; picture: string } {
    const role = this.getUserRole(lesson);
    const participant = role === 'tutor' ? lesson.studentId : lesson.tutorId;

    if (!participant) {
      return { name: 'Unknown', picture: '/assets/default-avatar.png' };
    }

    const p = participant as any;

    let formattedName = '';
    if (p.firstName && p.lastName) {
      formattedName = `${p.firstName} ${p.lastName.charAt(0).toUpperCase()}.`;
    } else if (p.firstName) {
      formattedName = p.firstName;
    } else if (p.name) {
      const parts = p.name.trim().split(' ');
      if (parts.length > 1) {
        formattedName = `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
      } else {
        formattedName = p.name;
      }
    } else {
      formattedName = p.email || 'Unknown';
    }

    const picture = p.picture || p.profilePicture || '/assets/default-avatar.png';
    return { name: formattedName, picture };
  }

  private getStatusText(lesson: Lesson): string {
    switch (lesson.status) {
      case 'scheduled': return 'Scheduled';
      case 'in_progress': return 'In Progress';
      case 'completed': return 'Completed';
      case 'cancelled': return 'Cancelled';
      case 'pending_reschedule': return 'Pending';
      default: return lesson.status;
    }
  }

  // ─── Actions (called from template click handlers) ───
  goBack() {
    this.router.navigate(['/tabs/home']);
  }

  goToHome() {
    this.router.navigate(['/tabs/home']);
  }

  async doRefresh(event: any) {
    await this.loadLessons();
    event.target.complete();
  }

  toggleExpand(pl: ProcessedLesson) {
    this.expandedLessonId = this.expandedLessonId === pl.id ? null : pl.id;
  }

  onLessonClick(pl: ProcessedLesson) {
    this.router.navigate(['/tabs/tutor-calendar/event', pl.id]);
  }

  viewFeedback(pl: ProcessedLesson) {
    const lesson = pl.lesson;
    if (pl.hasTutorFeedbackAvailable) {
      this.showTutorFeedback(lesson);
    } else if (pl.hasAIAnalysisAvailable) {
      this.router.navigate(['/lesson-analysis', lesson._id]);
    }
  }

  private async showTutorFeedback(lesson: Lesson) {
    // Prevent duplicate modals
    if (this.isFeedbackModalOpen || this.isOpeningFeedbackModal) {
      return;
    }

    this.isOpeningFeedbackModal = true;

    // Close note modal if open
    if (this.isNoteModalOpen) {
      this.closeNoteModal();
    }

    try {
      const response = await firstValueFrom(this.tutorFeedbackService.getFeedbackForLesson(lesson._id));
      if (response.success && response.feedback) {
        const fb = response.feedback;
        this.selectedFeedbackStrengths = fb.strengths || [];
        this.selectedFeedbackAreas = fb.areasForImprovement || [];
        this.selectedFeedbackHomework = fb.homework || '';
        this.selectedFeedbackNotes = fb.overallNotes || '';
        this.isFeedbackModalOpen = true;
        this.cdr.detectChanges();
      }
    } catch (error) {
      console.error('Error loading feedback:', error);
      await this.showToast('Failed to load feedback', 'danger');
    } finally {
      this.isOpeningFeedbackModal = false;
    }
  }

  closeFeedbackModal() {
    this.isFeedbackModalOpen = false;
    this.isOpeningFeedbackModal = false;
    this.selectedFeedbackStrengths = [];
    this.selectedFeedbackAreas = [];
    this.selectedFeedbackHomework = '';
    this.selectedFeedbackNotes = '';
    this.cdr.detectChanges();
  }

  viewTutorNote(pl: ProcessedLesson) {
    this.selectedNoteLesson = pl.lesson;
    this.selectedNoteLessonHasFeedback = pl.hasTutorFeedbackAvailable;
    this.isNoteModalOpen = true;
  }

  addTutorNote(pl: ProcessedLesson) {
    this.router.navigate(['/post-lesson-tutor', pl.lesson._id]);
  }

  joinLesson(pl: ProcessedLesson) {
    this.router.navigate(['/video-call', pl.lesson._id]);
  }

  closeNoteModal() {
    this.isNoteModalOpen = false;
    this.selectedNoteLesson = null;
    this.selectedNoteLessonHasFeedback = false;
  }

  editNoteFromModal() {
    if (this.selectedNoteLesson) {
      const lesson = this.selectedNoteLesson;
      this.closeNoteModal();
      this.router.navigate(['/post-lesson-tutor', lesson._id]);
    }
  }

  async reportIssue(pl: ProcessedLesson) {
    const lesson = pl.lesson;
    const alert = await this.alertController.create({
      header: 'Report Issue',
      message: 'Please select the issue you experienced:',
      inputs: [
        { type: 'radio', label: "Tutor didn't show up", value: 'tutor_no_show' },
        { type: 'radio', label: 'Lesson ended early', value: 'ended_early' },
        { type: 'radio', label: 'Poor lesson quality', value: 'poor_quality' },
        { type: 'radio', label: 'Inappropriate behavior', value: 'inappropriate' },
        { type: 'radio', label: 'Technical issues', value: 'technical' },
        { type: 'radio', label: 'Other', value: 'other' }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Next',
          handler: (issueType) => {
            if (!issueType) {
              this.showToast('Please select an issue type', 'warning');
              return false;
            }
            this.showIssueDetailsInput(lesson, issueType);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  private async showIssueDetailsInput(lesson: Lesson, issueType: string) {
    const alert = await this.alertController.create({
      header: 'Issue Details',
      message: 'Please describe what happened:',
      inputs: [
        { name: 'details', type: 'textarea', placeholder: 'Describe what happened...', attributes: { minlength: 10, maxlength: 500 } }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Submit Report',
          handler: async (data) => {
            if (!data.details || data.details.length < 10) {
              this.showToast('Please provide at least 10 characters', 'warning');
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

  private async submitIssueReport(lesson: Lesson, issueType: string, details: string) {
    const loading = await this.loadingController.create({ message: 'Submitting report...' });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.http.post<any>(`${environment.apiUrl}/lessons/${lesson._id}/report-issue`,
          { issueType, details },
          { headers: this.userService.getAuthHeadersSync() }
        )
      );

      if (response.success) {
        lesson.issueReported = true;
        await this.showToast('Issue reported successfully.', 'success');
        await this.loadLessons();
      }
    } catch (error: any) {
      console.error('Error reporting issue:', error);
      await this.showToast(error?.error?.message || 'Failed to report issue.', 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  scrollToLesson(lessonId: string) {
    const el = document.getElementById(`lesson-${lessonId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight-lesson');
      setTimeout(() => el.classList.remove('highlight-lesson'), 2000);
    }
  }

  trackByProcessedId(index: number, pl: ProcessedLesson): string {
    return pl.id;
  }

  private async showToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }
}
