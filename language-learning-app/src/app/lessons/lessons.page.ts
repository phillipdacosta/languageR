import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, LoadingController, ToastController, AlertController, ViewWillEnter, NavController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { LessonService, Lesson } from '../services/lesson.service';
import { ClassService } from '../services/class.service';
import { UserService } from '../services/user.service';
import { AgoraService } from '../services/agora.service';
import { TutorFeedbackService } from '../services/tutor-feedback.service';
import { FlipTransitionService } from '../services/flip-transition.service';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil, filter, take } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { formatTimeInTz, formatDateInTz } from '../shared/timezone.utils';

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
  isInvestigationResolved: boolean;
  showActions: boolean;
  canJoin: boolean;
  needsTutorFeedback: boolean;
  feedbackPendingForStudent: boolean;
  canAddOptionalNote: boolean;
  tipSent: boolean;
  tipAmount: string;
  canTip: boolean;
  isClass: boolean;
  className: string;
  classStudentCount: number;
  classCapacity: number;
  classAttendees: { name: string; picture?: string; initials: string }[];
  classAttendeesOverflow: number;
}

@Component({
  selector: 'app-lessons',
  templateUrl: './lessons.page.html',
  styleUrls: ['./lessons.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, TranslateModule]
})
export class LessonsPage implements OnInit, OnDestroy, ViewWillEnter {
  // Raw data
  allLessons: Lesson[] = [];
  currentUser: any = null;
  isLoading = true;
  private destroy$ = new Subject<void>();
  private hasInitiallyLoaded = false;

  private get userTz(): string | undefined { return this.currentUser?.profile?.timezone || undefined; }

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

  // (Feedback modal removed — navigates to /lesson-analysis instead)

  // Expanded lesson row (for actions)
  expandedLessonId: string | null = null;

  constructor(
    private lessonService: LessonService,
    private classService: ClassService,
    private userService: UserService,
    private agoraService: AgoraService,
    private tutorFeedbackService: TutorFeedbackService,
    private flipTransition: FlipTransitionService,
    private router: Router,
    private route: ActivatedRoute,
    private navCtrl: NavController,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private alertController: AlertController,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private translate: TranslateService
  ) {}

  ngOnInit() {
    this.userService.currentUser$.pipe(
      filter(user => !!user),
      takeUntil(this.destroy$)
    ).subscribe(user => {
      const prevTz = this.currentUser?.profile?.timezone;
      this.currentUser = user;
      this.isStudentUser = user?.userType === 'student';
      this.isTutorUser = user?.userType === 'tutor';
      if (!this.hasInitiallyLoaded) {
        this.loadLessons();
      } else if (prevTz !== user?.profile?.timezone) {
        this.reprocessLessons();
      }
    });

    // Trigger user load if not already cached
    this.userService.getCurrentUser().pipe(
      takeUntil(this.destroy$)
    ).subscribe();

    this.translate.onLangChange.pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      if (this.hasInitiallyLoaded) {
        this.reprocessLessons();
        this.updateFilterState();
      }
    });

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
      const [lessonResponse, classResponse] = await Promise.all([
        firstValueFrom(this.lessonService.getMyLessons()),
        firstValueFrom(this.classService.getMyClasses()).catch(() => ({ success: false, classes: [] }))
      ]);

      const lessons: Lesson[] = lessonResponse?.success ? lessonResponse.lessons : [];

      const classesAsLessons: Lesson[] = classResponse?.success
        ? classResponse.classes.map((cls: any) => this.classToLessonShape(cls))
        : [];

      this.allLessons = [...lessons, ...classesAsLessons].sort((a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      );

      this.computeCounts();
      this.extractUniqueParticipants();
      this.applyFilters();
      this.hasInitiallyLoaded = true;
    } catch (error) {
      console.error('Error loading lessons:', error);
      const toast = await this.toastController.create({
        message: this.translate.instant('LESSONS_PAGE.TOAST_LOAD_FAILED'),
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  private classToLessonShape(cls: any): Lesson {
    const isTutor = cls.tutorId?._id === this.currentUser?._id;
    const firstStudent = cls.confirmedStudents?.[0];
    return {
      _id: cls._id,
      tutorId: cls.tutorId || { _id: '', name: this.translate.instant('LESSONS_PAGE.UNKNOWN'), email: '' },
      studentId: isTutor
        ? (firstStudent || { _id: '', name: `${cls.confirmedStudents?.length || 0}${this.translate.instant('LESSONS_PAGE.CLASS_STUDENTS')}`, email: '' })
        : { _id: this.currentUser?._id || '', name: this.currentUser?.name || '', email: this.currentUser?.email || '' },
      startTime: cls.startTime,
      endTime: cls.endTime,
      channelName: cls._id,
      status: cls.status === 'scheduled' ? 'scheduled' : cls.status === 'in_progress' ? 'in_progress' : cls.status === 'completed' ? 'completed' : 'cancelled',
      subject: cls.name || this.translate.instant('LESSONS_PAGE.CLASS'),
      price: cls.price || 0,
      duration: cls.duration || 60,
      isClass: true,
      className: cls.name,
      attendees: cls.confirmedStudents || [],
      capacity: cls.capacity || 1,
    } as any;
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

    switch (this.selectedStatusFilter) {
      case 'upcoming': this.statusFilterLabel = this.translate.instant('LESSONS_PAGE.STAT_UPCOMING'); break;
      case 'completed': this.statusFilterLabel = this.translate.instant('LESSONS_PAGE.STAT_COMPLETED'); break;
      case 'cancelled': this.statusFilterLabel = this.translate.instant('LESSONS_PAGE.STAT_CANCELLED'); break;
      default: this.statusFilterLabel = ''; break;
    }

    switch (this.selectedTimeFilter) {
      case '7days': this.timeFilterLabel = this.translate.instant('LESSONS_PAGE.LAST_7_DAYS'); break;
      case '30days': this.timeFilterLabel = this.translate.instant('LESSONS_PAGE.LAST_30_DAYS'); break;
      case '3months': this.timeFilterLabel = this.translate.instant('LESSONS_PAGE.LAST_3_MONTHS'); break;
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

  private reprocessLessons() {
    this.processedLessons = this.filteredLessons.map(l => this.processLesson(l));
    this.currentPage = 0;
    this.loadFirstPage();
  }

  // ─── Pre-compute lesson display data ─────────────────
  private processLesson(lesson: Lesson): ProcessedLesson {
    const role = this.getUserRole(lesson);
    const other = this.getOtherParticipant(lesson);
    const start = new Date(lesson.startTime);
    const end = new Date(lesson.endTime);
    const now = new Date();

    const tz = this.userTz;
    const startStr = formatTimeInTz(start, tz);
    const endStr = formatTimeInTz(end, tz);

    const fmtMonth = formatDateInTz(start, tz, { month: 'short', day: undefined, year: undefined });
    const fmtDayNum = formatDateInTz(start, tz, { day: 'numeric', month: undefined, year: undefined });
    const fmtWeekday = formatDateInTz(start, tz, { weekday: 'long', month: undefined, day: undefined, year: undefined });
    const fmtMonthLong = formatDateInTz(start, tz, { month: 'long', day: undefined, year: undefined });

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

    // Can report issue (within 24h of end, both students and tutors)
    const hoursSinceEnd = lesson.endTime ? (now.getTime() - new Date(lesson.endTime).getTime()) / (1000 * 60 * 60) : Infinity;
    const canReportIssue = status === 'completed' && !lesson.issueReported && !lesson.investigationResolvedAt && hoursSinceEnd <= 24;

    // Can join (upcoming or in-progress, within 10 min before start to end)
    const minutesUntilStart = (start.getTime() - now.getTime()) / (1000 * 60);
    const canJoin = (status === 'scheduled' || status === 'in_progress') && minutesUntilStart <= 10 && end > now;

    // Initials
    const nameParts = other.name.split(' ');
    const initials = nameParts.length > 1
      ? `${nameParts[0].charAt(0)}${nameParts[1].charAt(0)}`
      : nameParts[0].charAt(0);

    // Tutor needs to leave feedback? Only when a TutorFeedback record exists, is pending, and is required
    // Trial lessons are excluded — no feedback expected
    const isTrial = !!lesson.isTrialLesson;
    const hasTutorFeedbackAvailable = tutorFeedback?.status === 'completed';
    const needsTutorFeedback = role === 'tutor'
      && status === 'completed'
      && !isTrial
      && !!tutorFeedback
      && tutorFeedback.status === 'pending'
      && tutorFeedback.required !== false;

    // Student sees "awaiting feedback" only when AI analysis is NOT available AND
    // the lesson actually requires tutor feedback (AI wasn't supposed to handle it).
    // If AI was enabled, tutor feedback is optional — never show a pending badge.
    // Trial lessons are excluded — no feedback expected.
    const hasAiAnalysis = aiAnalysis?.status === 'completed' || !!aiAnalysis?.hasAnalysis;
    const aiWasEnabled = (lesson as any).aiAnalysisEnabledAtTime === true;
    const requiresTutorFeedback = !!(lesson as any).requiresTutorFeedback;
    const hasPendingFeedbackRecord = !!tutorFeedback && tutorFeedback.status === 'pending';
    const feedbackPendingForStudent = role === 'student'
      && status === 'completed'
      && !isTrial
      && !hasTutorFeedbackAvailable
      && !hasTutorNoteAvailable
      && !hasAiAnalysis
      && (requiresTutorFeedback || hasPendingFeedbackRecord || !aiWasEnabled);

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
      subject: lesson.subject || this.translate.instant('LESSONS_PAGE.ROLE_LESSON'),
      role,
      roleLabel: role === 'student' ? this.translate.instant('LESSONS_PAGE.ROLE_TUTOR') : this.translate.instant('LESSONS_PAGE.ROLE_STUDENT'),
      otherName: other.name,
      otherPicture: other.picture === '/assets/default-avatar.png' ? '' : other.picture,
      otherInitials: initials.toUpperCase(),
      formattedMonth: fmtMonth,
      formattedDayNum: fmtDayNum,
      formattedWeekday: fmtWeekday,
      formattedDate: `${fmtWeekday}, ${fmtMonthLong} ${fmtDayNum}`,
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
      isInvestigationResolved: !!lesson.investigationResolvedAt,
      showActions,
      canJoin,
      needsTutorFeedback,
      feedbackPendingForStudent,
      canAddOptionalNote,
      tipSent: !!(lesson as any).tip && !!(lesson as any).tip.amount,
      tipAmount: (lesson as any).tip?.amount ? (lesson as any).tip.amount.toFixed(2) : '0.00',
      canTip: role === 'student' && status === 'completed' && !isTrial
        && !((lesson as any).tip && (lesson as any).tip.amount),
      isClass: !!lesson.isClass,
      className: lesson.className || '',
      classStudentCount: lesson.attendees?.length || 0,
      classCapacity: lesson.capacity || 0,
      classAttendees: (lesson.attendees || []).slice(0, 3).map((a: any) => ({
        name: a.name || a.firstName || '',
        picture: a.picture || a.profilePicture,
        initials: this.getInitials(a.name || a.firstName || ''),
      })),
      classAttendeesOverflow: Math.max(0, (lesson.attendees?.length || 0) - 3),
    };
  }

  private getInitials(name: string): string {
    return name.split(' ').map(p => p.charAt(0)).join('').toUpperCase().slice(0, 2);
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
      return { name: this.translate.instant('LESSONS_PAGE.UNKNOWN'), picture: '/assets/default-avatar.png' };
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
      formattedName = p.email || this.translate.instant('LESSONS_PAGE.UNKNOWN');
    }

    const picture = p.picture || p.profilePicture || '/assets/default-avatar.png';
    return { name: formattedName, picture };
  }

  private getStatusText(lesson: Lesson): string {
    switch (lesson.status) {
      case 'scheduled': return this.translate.instant('LESSONS_PAGE.STATUS_SCHEDULED');
      case 'in_progress': return this.translate.instant('LESSONS_PAGE.STATUS_IN_PROGRESS');
      case 'completed': return this.translate.instant('LESSONS_PAGE.STATUS_COMPLETED');
      case 'cancelled': return this.translate.instant('LESSONS_PAGE.STATUS_CANCELLED');
      case 'pending_reschedule': return this.translate.instant('LESSONS_PAGE.STATUS_PENDING');
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

  onLessonClick(pl: ProcessedLesson, _event?: MouseEvent) {
    this.router.navigate(['/tabs/lessons', pl.id]);
  }

  viewFeedback(pl: ProcessedLesson) {
    // Navigate straight to the analysis page for both AI and tutor-sourced analyses
    this.router.navigate(['/lesson-analysis', pl.lesson._id]);
  }

  viewTutorNote(pl: ProcessedLesson) {
    this.selectedNoteLesson = pl.lesson;
    this.selectedNoteLessonHasFeedback = pl.hasTutorFeedbackAvailable;
    this.isNoteModalOpen = true;
  }

  addTutorNote(pl: ProcessedLesson) {
    this.router.navigate(['/post-lesson-tutor', pl.lesson._id]);
  }

  tipTutor(pl: ProcessedLesson) {
    this.router.navigate(['/post-lesson-student', pl.lesson._id]);
  }

  joinLesson(pl: ProcessedLesson) {
    if (!pl.lesson || !this.currentUser) return;
    
    const lesson = pl.lesson;
    const isClass = !!lesson.isClass;
    
    console.log('🎯 LESSONS: joinLesson navigating to pre-call:', {
      lessonId: lesson._id,
      isClass
    });
    
    // Navigate to pre-call page with proper query parameters
    // SECURITY: role is determined from lesson data + auth, not passed in URL
    this.router.navigate(['/pre-call'], {
      queryParams: {
        lessonId: lesson._id,
        lessonMode: 'true',
        isClass: isClass ? 'true' : 'false'
      }
    });
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
    const isStudentRole = pl.role === 'student';

    // Different issue types for students vs tutors
    const studentIssueTypes: { type: 'radio'; label: string; value: string }[] = [
      { type: 'radio', label: this.translate.instant('LESSONS_PAGE.ISSUE_TUTOR_NO_SHOW'), value: 'tutor_no_show' },
      { type: 'radio', label: this.translate.instant('LESSONS_PAGE.ISSUE_ENDED_EARLY'), value: 'ended_early' },
      { type: 'radio', label: this.translate.instant('LESSONS_PAGE.ISSUE_POOR_QUALITY'), value: 'poor_quality' },
      { type: 'radio', label: this.translate.instant('LESSONS_PAGE.ISSUE_INAPPROPRIATE'), value: 'inappropriate' },
      { type: 'radio', label: this.translate.instant('LESSONS_PAGE.ISSUE_TECHNICAL'), value: 'technical' },
      { type: 'radio', label: this.translate.instant('LESSONS_PAGE.ISSUE_OTHER'), value: 'other' }
    ];
    const tutorIssueTypes: { type: 'radio'; label: string; value: string }[] = [
      { type: 'radio', label: this.translate.instant('LESSONS_PAGE.ISSUE_STUDENT_NO_SHOW'), value: 'student_no_show' },
      { type: 'radio', label: this.translate.instant('LESSONS_PAGE.ISSUE_ENDED_EARLY'), value: 'ended_early' },
      { type: 'radio', label: this.translate.instant('LESSONS_PAGE.ISSUE_INAPPROPRIATE'), value: 'inappropriate' },
      { type: 'radio', label: this.translate.instant('LESSONS_PAGE.ISSUE_TECHNICAL'), value: 'technical' },
      { type: 'radio', label: this.translate.instant('LESSONS_PAGE.ISSUE_OTHER'), value: 'other' }
    ];

    const alert = await this.alertController.create({
      header: this.translate.instant('LESSONS_PAGE.ALERT_REPORT_HEADER'),
      message: this.translate.instant('LESSONS_PAGE.ALERT_REPORT_MESSAGE'),
      inputs: isStudentRole ? studentIssueTypes : tutorIssueTypes,
      buttons: [
        { text: this.translate.instant('LESSONS_PAGE.ALERT_CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('LESSONS_PAGE.ALERT_NEXT'),
          handler: (issueType) => {
            if (!issueType) {
              this.showToast(this.translate.instant('LESSONS_PAGE.ALERT_SELECT_ISSUE'), 'warning');
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
      header: this.translate.instant('LESSONS_PAGE.ALERT_DETAILS_HEADER'),
      message: this.translate.instant('LESSONS_PAGE.ALERT_DETAILS_MESSAGE'),
      inputs: [
        { name: 'details', type: 'textarea', placeholder: this.translate.instant('LESSONS_PAGE.ALERT_DETAILS_PLACEHOLDER'), attributes: { minlength: 10, maxlength: 500 } }
      ],
      buttons: [
        { text: this.translate.instant('LESSONS_PAGE.ALERT_CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('LESSONS_PAGE.ALERT_SUBMIT'),
          handler: async (data) => {
            if (!data.details || data.details.length < 10) {
              this.showToast(this.translate.instant('LESSONS_PAGE.ALERT_MIN_CHARS'), 'warning');
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
    const loading = await this.loadingController.create({ message: this.translate.instant('LESSONS_PAGE.TOAST_SUBMITTING') });
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
        await this.showToast(this.translate.instant('LESSONS_PAGE.TOAST_ISSUE_REPORTED'), 'success');
        await this.loadLessons();
      }
    } catch (error: any) {
      console.error('Error reporting issue:', error);
      await this.showToast(error?.error?.message || this.translate.instant('LESSONS_PAGE.TOAST_REPORT_FAILED'), 'danger');
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
