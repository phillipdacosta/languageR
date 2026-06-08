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
import { formatDateInTz, formatTimeInTz, formatTimeRangeInTz, toIntlLocale } from '../shared/timezone.utils';
import { buildMockLessonEntity } from './lesson-mock-preview';

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
  /** Just the end time portion of the lesson (e.g. "6:00 PM").
   * Shown on the "Analysis ready by …" spinner so the student knows the
   * eta even if they left the lesson early — the cron always finalizes
   * the analysis by the scheduled end time. */
  formattedEndTime: string;
  duration: number;
  price: number;
  formattedPrice: string;
  status: string;
  statusLabel: string;
  isTrial: boolean;
  isUpcoming: boolean;
  /** Lesson/class end time is before now */
  isPast: boolean;
  analysisStatus: 'available' | 'generating' | 'unavailable';
  hasTutorFeedbackAvailable: boolean;
  hasAIAnalysisAvailable: boolean;
  hasTutorNoteAvailable: boolean;
  canReportIssue: boolean;
  isIssueReported: boolean;
  isInvestigationResolved: boolean;
  /** Show bottom actions strip (1:1: completed / cancelled / can join; class: can join only) */
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
  classThumbnail: string;
  /** Card body: schedule line vs analysis summary vs empty */
  cardDescMode: 'schedule' | 'analysis' | 'analysis_generating' | 'analysis_empty';
  cardDescText: string;
  /** True when this card's schedule-line prose can be translated on demand
   * (previous-session summary from AI analysis / tutor feedback). */
  cardDescCanTranslate: boolean;
  /** Airbnb-style footer stats (4 columns) */
  cardStats: { value: string; label: string; sub?: string }[];
  isToday: boolean;
  durationLabel: string;
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

  /** Per-lesson opt-in translation state for schedule-line prose. */
  private readonly cardDescI18n = new Map<string, {
    original: string;
    translated: string | null;
    showingTranslated: boolean;
    loading: boolean;
  }>();

  private get userTz(): string | undefined { return this.currentUser?.profile?.timezone || undefined; }

  // Processed & filtered
  filteredLessons: Lesson[] = [];
  processedLessons: ProcessedLesson[] = [];
  processedDisplayed: ProcessedLesson[] = [];

  get displayedLessonCardCount(): number {
    return this.processedDisplayed.length;
  }

  get totalLessonCardCount(): number {
    return this.processedLessons.length;
  }

  // Pagination
  private pageSize = 15;
  private currentPage = 0;
  hasMoreLessonsAvailable = false;

  // Filters
  selectedStatusFilter: 'all' | 'upcoming' | 'completed' | 'cancelled' = 'all';
  selectedTimeFilter: 'all' | '7days' | '30days' | '3months' = 'all';
  selectedTutorFilter = 'all';
  selectedStudentFilter = 'all';
  selectedLessonTypeFilter: 'all' | 'one-on-one' | 'class' = 'all';
  selectedSubjectFilter = 'all';
  filterHasTip = false;
  filterOutstandingFeedback = false;
  filterIsTrial = false;
  uniqueTutors: Array<{ id: string; name: string; picture: string }> = [];
  uniqueStudents: Array<{ id: string; name: string; picture: string }> = [];
  uniqueSubjects: string[] = [];

  // Filter label strings
  lessonTypeFilterLabel = '';
  subjectFilterLabel = '';

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

  // Smart caching — prevents visible reload on re-entry
  private _lastDataFetch = 0;
  private _cacheValidityMs = 30000; // 30 seconds


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

    // Deep-link: /tabs/lessons/:id → navigate to detail page
    const deepLinkId = this.route.snapshot.paramMap.get('id');
    if (deepLinkId) {
      this.router.navigate(['/tabs/lessons', deepLinkId]);
    }
  }

  ionViewWillEnter() {
    if (!this.hasInitiallyLoaded || !this.currentUser) return;

    const cacheAge = Date.now() - this._lastDataFetch;
    if (cacheAge > this._cacheValidityMs) {
      this.loadLessons(true);
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async loadLessons(silent = false) {
    if (!silent) {
      this.isLoading = true;
      this.cdr.detectChanges();
    }
    try {
      const [lessonResponse, classResponse] = await Promise.all([
        firstValueFrom(this.lessonService.getMyLessons()),
        firstValueFrom(this.classService.getMyClasses()).catch(() => ({ success: false, classes: [] }))
      ]);

      const lessons: Lesson[] = lessonResponse?.success ? lessonResponse.lessons : [];

      const classesAsLessons: Lesson[] = classResponse?.success
        ? classResponse.classes.map((cls: any) => this.classToLessonShape(cls))
        : [];

      this.allLessons = [...lessons, ...classesAsLessons]
        .filter(l => !(l.status === 'cancelled' && (l as any).cancelReason === 'payment_failed'))
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

      this.extractUniqueParticipants();
      this.extractUniqueSubjects();
      this.applyFilters();
      this.hasInitiallyLoaded = true;
      this._lastDataFetch = Date.now();
    } catch (error) {
      console.error('Error loading lessons:', error);
      if (!silent) {
        const toast = await this.toastController.create({
          message: this.translate.instant('LESSONS_PAGE.TOAST_LOAD_FAILED'),
          duration: 3000,
          color: 'danger'
        });
        await toast.present();
      }
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
      classData: cls,
    } as any;
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
    this.selectedLessonTypeFilter = 'all';
    this.selectedSubjectFilter = 'all';
    this.filterHasTip = false;
    this.filterOutstandingFeedback = false;
    this.filterIsTrial = false;
    this.applyFilters();
  }

  hasSecondaryFilters(): boolean {
    return this.selectedStatusFilter !== 'all' ||
           this.selectedTutorFilter !== 'all' ||
           this.selectedStudentFilter !== 'all' ||
           this.selectedTimeFilter !== 'all' ||
           this.selectedLessonTypeFilter !== 'all' ||
           this.selectedSubjectFilter !== 'all' ||
           this.filterHasTip ||
           this.filterOutstandingFeedback ||
           this.filterIsTrial;
  }

  private updateFilterState() {
    let count = 0;
    if (this.selectedStatusFilter !== 'all') count++;
    if (this.selectedTimeFilter !== 'all') count++;
    if (this.isStudentUser && this.selectedTutorFilter !== 'all') count++;
    if (this.isTutorUser && this.selectedStudentFilter !== 'all') count++;
    if (this.selectedLessonTypeFilter !== 'all') count++;
    if (this.selectedSubjectFilter !== 'all') count++;
    if (this.filterHasTip) count++;
    if (this.filterOutstandingFeedback) count++;
    if (this.filterIsTrial) count++;
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

    switch (this.selectedLessonTypeFilter) {
      case 'one-on-one': this.lessonTypeFilterLabel = this.translate.instant('LESSONS_PAGE.FILTER_TYPE_ONE_ON_ONE'); break;
      case 'class': this.lessonTypeFilterLabel = this.translate.instant('LESSONS_PAGE.FILTER_TYPE_CLASS'); break;
      default: this.lessonTypeFilterLabel = ''; break;
    }

    this.subjectFilterLabel = this.selectedSubjectFilter !== 'all' ? this.selectedSubjectFilter : '';
  }

  applyFilters() {
    const now = new Date();
    let filtered = [...this.allLessons];

    // Status filter
    if (this.selectedStatusFilter === 'upcoming') {
      filtered = filtered.filter(l =>
        (l.status === 'scheduled' || l.status === 'confirmed' || l.status === 'in_progress' || l.status === 'pending_reschedule') &&
        new Date(l.endTime) >= now
      );
    } else if (this.selectedStatusFilter === 'completed') {
      filtered = filtered.filter(l => l.status === 'completed' || l.status === 'ended_early');
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

    // Lesson type filter
    if (this.selectedLessonTypeFilter === 'class') {
      filtered = filtered.filter(l => !!l.isClass);
    } else if (this.selectedLessonTypeFilter === 'one-on-one') {
      filtered = filtered.filter(l => !l.isClass);
    }

    // Subject/language filter (language-agnostic: uses whatever subject strings exist)
    if (this.selectedSubjectFilter !== 'all') {
      filtered = filtered.filter(l => (l.subject || '').trim() === this.selectedSubjectFilter);
    }

    this.filteredLessons = filtered;

    // Process lessons (pre-compute display data)
    let processed = this.filteredLessons.map(l => this.processLesson(l));

    // Post-process filters (require computed fields)
    if (this.filterHasTip) {
      processed = processed.filter(p => p.tipSent);
    }
    if (this.filterOutstandingFeedback && this.isTutorUser) {
      processed = processed.filter(p => p.needsTutorFeedback);
    }
    if (this.filterIsTrial) {
      processed = processed.filter(p => p.isTrial);
    }

    this.processedLessons = this.applyCardDescTranslations(this.appendPreviewMocks(processed));

    // Reset pagination
    this.currentPage = 0;
    this.loadFirstPage();

    // Update filter state for chips
    this.updateFilterState();
  }

  private reprocessLessons() {
    const processed = this.filteredLessons.map(l => this.processLesson(l));
    this.processedLessons = this.applyCardDescTranslations(this.appendPreviewMocks(processed));
    this.currentPage = 0;
    this.loadFirstPage();
  }

  /** Minimal lesson for preview mocks when the user has no lessons loaded. */
  private createShellLesson(): Lesson {
    const uid = String(this.currentUser?._id || this.currentUser?.id || 'user');
    const now = new Date();
    const other = { _id: 'other-preview', name: 'Other', email: 'o@example.com' };
    const isTutor = this.isTutorUser;
    return {
      _id: '__preview_shell__',
      tutorId: isTutor ? { _id: uid, name: 'Me', email: 'me@example.com' } : other,
      studentId: isTutor ? other : { _id: uid, name: 'Me', email: 'me@example.com' },
      startTime: now.toISOString(),
      endTime: new Date(now.getTime() + 45 * 60000).toISOString(),
      channelName: 'preview',
      status: 'completed',
      subject: 'Lesson',
      price: 25,
      duration: 45,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    } as Lesson;
  }

  /** Locale-aware date chip + time range for lesson cards (real + mock). */
  private formatCardDateFields(start: Date, end: Date): Pick<
    ProcessedLesson,
    'formattedMonth' | 'formattedDayNum' | 'formattedWeekday' | 'formattedDate' | 'formattedTimeRange' | 'formattedEndTime'
  > {
    const locale = toIntlLocale(this.translate.currentLang || this.translate.defaultLang || 'en');
    const tz = this.userTz;
    const fmtMonth = formatDateInTz(start, tz, { month: 'short', day: undefined, year: undefined }, locale);
    const fmtDayNum = formatDateInTz(start, tz, { day: 'numeric', month: undefined, year: undefined }, locale);
    const fmtWeekday = formatDateInTz(start, tz, { weekday: 'short', month: undefined, day: undefined, year: undefined }, locale);
    const fmtMonthLong = formatDateInTz(start, tz, { month: 'long', day: undefined, year: undefined }, locale);
    return {
      formattedMonth: fmtMonth,
      formattedDayNum: fmtDayNum,
      formattedWeekday: fmtWeekday,
      formattedDate: `${fmtMonthLong} ${fmtDayNum}`,
      formattedTimeRange: formatTimeRangeInTz(start, end, tz, locale),
      formattedEndTime: formatTimeInTz(end, tz, locale),
    };
  }

  private mockCardDateFields(mockId: string): Pick<
    ProcessedLesson,
    'formattedMonth' | 'formattedDayNum' | 'formattedWeekday' | 'formattedDate' | 'formattedTimeRange' | 'formattedEndTime'
  > {
    const lesson = buildMockLessonEntity(mockId, this.currentUser);
    if (!lesson?.startTime || !lesson?.endTime) {
      const now = new Date();
      return this.formatCardDateFields(now, now);
    }
    return this.formatCardDateFields(new Date(lesson.startTime), new Date(lesson.endTime));
  }

  private mockProcessedLesson(base: ProcessedLesson, o: Partial<ProcessedLesson> & { id: string }): ProcessedLesson {
    const merged: ProcessedLesson = {
      ...base,
      // Reset class-specific fields so 1:1 lesson mocks don't inherit class state
      isClass: false,
      classThumbnail: '',
      classAttendees: [],
      classAttendeesOverflow: 0,
      classStudentCount: 0,
      isPast: true,
      ...this.mockCardDateFields(o.id),
      ...o,
      lesson: { ...base.lesson, _id: o.id } as Lesson,
    };
    if (o.isPast === undefined) {
      merged.isPast =
        o.id === '__mock_student_upcoming__' ||
        o.id === '__mock_tutor_upcoming__' ||
        o.id === '__mock_preview_tutor_view__' ? false : true;
    }
    if (merged.cardDescCanTranslate === undefined) {
      merged.cardDescCanTranslate = false;
    }
    return merged;
  }

  /**
   * Preview cards for design QA — matches React Native LessonsScreen mocks.
   * Remove `appendPreviewMocks` usage when no longer needed.
   */
  private buildPreviewMockCards(base: ProcessedLesson): ProcessedLesson[] {
    const T = (k: string, params?: Record<string, string>) => this.translate.instant(k, params);
    const dur = T('LESSONS_PAGE.CARD_STAT_DURATION');
    const pri = T('LESSONS_PAGE.CARD_STAT_PRICE');
    const rec = T('LESSONS_PAGE.CARD_STAT_RECEIVED');
    const sta = T('LESSONS_PAGE.CARD_STAT_STATUS');
    const m = (partial: Partial<ProcessedLesson> & { id: string }) => this.mockProcessedLesson(base, partial);

    return [
      m({
        id: '__mock_preview_tutor_view__',
        role: 'student',
        roleLabel: T('LESSONS_PAGE.PREVIEW_TUTOR_VIEW_LABEL'),
        otherName: 'James L.',
        otherPicture: 'https://randomuser.me/api/portraits/men/22.jpg',
        otherInitials: 'JL',
        subject: 'Spanish',
        status: 'scheduled',
        statusLabel: T('LESSONS_PAGE.STATUS_SCHEDULED'),
        cardDescMode: 'schedule',
        cardDescText: T('LESSONS_PAGE.PREVIEW_TUTOR_VIEW_DESC'),
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$40', label: rec },
          { value: T('LESSONS_PAGE.STATUS_SCHEDULED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: true,
        showActions: false,
        canJoin: false,
      }),
      m({
        id: '__mock_student_completed__',
        role: 'student',
        roleLabel: T('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Maria G.',
        otherPicture: 'https://randomuser.me/api/portraits/women/44.jpg',
        otherInitials: 'MG',
        subject: 'Spanish',
        status: 'completed',
        statusLabel: T('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'analysis',
        cardDescText:
          'Great progress with past tense conjugations today. Your conversational fluency improved noticeably — keep practicing irregular verbs.',
        cardStats: [
          { value: '45 min', label: dur },
          { value: '$25', label: pri },
          { value: T('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: false,
        showActions: false,
        canJoin: false,
        analysisStatus: 'available',
      }),
      m({
        id: '__mock_student_upcoming__',
        role: 'student',
        roleLabel: T('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Carlos R.',
        otherPicture: 'https://randomuser.me/api/portraits/men/32.jpg',
        otherInitials: 'CR',
        subject: 'Spanish',
        status: 'scheduled',
        statusLabel: T('LESSONS_PAGE.STATUS_SCHEDULED'),
        cardDescMode: 'schedule',
        cardDescText: T('LESSONS_PAGE.LAST_SESSION_PREFIX') + 'Great progress with past tense conjugations — keep practicing irregular verbs.',
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$30', label: pri },
          { value: T('LESSONS_PAGE.STATUS_SCHEDULED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: true,
        showActions: false,
        canJoin: false,
      }),
      m({
        id: '__mock_student_cancelled__',
        role: 'student',
        roleLabel: T('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Lucia P.',
        otherPicture: 'https://randomuser.me/api/portraits/women/68.jpg',
        otherInitials: 'LP',
        subject: 'Spanish',
        status: 'cancelled',
        statusLabel: T('LESSONS_PAGE.STATUS_CANCELLED'),
        cardDescMode: 'schedule',
        cardDescText: T('LESSONS_PAGE.CANCELLED_BY_TUTOR') + ' — Tutor unavailable',
        cardStats: [
          { value: '30 min', label: dur },
          { value: '$15', label: pri },
          { value: T('LESSONS_PAGE.STATUS_CANCELLED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: false,
        showActions: false,
        canJoin: false,
      }),
      m({
        id: '__mock_student_awaiting__',
        role: 'student',
        roleLabel: T('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Elena V.',
        otherPicture: 'https://randomuser.me/api/portraits/women/21.jpg',
        otherInitials: 'EV',
        subject: 'Spanish',
        status: 'completed',
        statusLabel: T('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'analysis',
        cardDescText: '',
        feedbackPendingForStudent: true,
        cardStats: [
          { value: '45 min', label: dur },
          { value: '$25', label: pri },
          { value: T('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: false,
        showActions: false,
        canJoin: false,
      }),
      m({
        id: '__mock_student_generating__',
        role: 'student',
        roleLabel: T('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Rafael T.',
        otherPicture: 'https://randomuser.me/api/portraits/men/75.jpg',
        otherInitials: 'RT',
        subject: 'Spanish',
        status: 'completed',
        statusLabel: T('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'analysis_generating',
        cardDescText: '',
        cardStats: [
          { value: '45 min', label: dur },
          { value: '$25', label: pri },
          { value: T('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: false,
        showActions: false,
        canJoin: false,
        analysisStatus: 'generating',
      }),
      m({
        id: '__mock_student_trial__',
        role: 'student',
        roleLabel: T('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Sofia M.',
        otherPicture: 'https://randomuser.me/api/portraits/women/55.jpg',
        otherInitials: 'SM',
        subject: 'Spanish',
        status: 'completed',
        statusLabel: T('LESSONS_PAGE.STATUS_COMPLETED'),
        isTrial: true,
        cardDescMode: 'schedule',
        cardDescText: T('LESSONS_PAGE.FIRST_LESSON_STUDENT', { name: 'Sofia' }),
        cardStats: [
          { value: '30 min', label: dur },
          { value: '$0', label: pri },
          { value: T('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        tipSent: false,
        isUpcoming: false,
        showActions: false,
        canJoin: false,
      }),
      m({
        id: '__mock_student_tip__',
        role: 'student',
        roleLabel: T('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Maria G.',
        otherPicture: 'https://randomuser.me/api/portraits/women/44.jpg',
        otherInitials: 'MG',
        subject: 'Spanish',
        status: 'completed',
        statusLabel: T('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'analysis',
        cardDescText:
          'Excellent session on subjunctive mood — you nailed the conditional triggers. Review irregular stems before next week.',
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$35', label: pri, sub: T('LESSONS_PAGE.CARD_STAT_TIP_SUB', { amount: '$5' }) },
          { value: T('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        isTrial: false,
        tipSent: true,
        tipAmount: '5.00',
        isUpcoming: false,
        showActions: false,
        canJoin: false,
      }),
      m({
        id: '__mock_student_analysis_empty__',
        role: 'student',
        roleLabel: T('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Hana T.',
        otherPicture: 'https://randomuser.me/api/portraits/women/90.jpg',
        otherInitials: 'HT',
        subject: 'Spanish',
        status: 'completed',
        statusLabel: T('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'analysis_empty',
        cardDescText: '',
        cardStats: [
          { value: '45 min', label: dur },
          { value: '$20', label: pri },
          { value: T('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: false,
        showActions: false,
        canJoin: false,
      }),
      m({
        id: '__mock_student_tutor_feedback__',
        role: 'student',
        roleLabel: T('LESSONS_PAGE.ROLE_TUTOR'),
        otherName: 'Liam B.',
        otherPicture: 'https://randomuser.me/api/portraits/men/11.jpg',
        otherInitials: 'LB',
        subject: 'Spanish',
        status: 'completed',
        statusLabel: T('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'analysis',
        cardDescText: 'Student has a strong foundation in grammar but needs to work on listening comprehension. Recommend more exposure to native-speed audio content.',
        cardStats: [
          { value: '50 min', label: dur },
          { value: '$30', label: pri },
          { value: T('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: false,
        showActions: false,
        canJoin: false,
        analysisStatus: 'available',
        hasTutorFeedbackAvailable: true,
      }),
      m({
        id: '__mock_tutor_completed__',
        role: 'tutor',
        roleLabel: T('LESSONS_PAGE.ROLE_STUDENT'),
        otherName: 'Daniel K.',
        otherPicture: 'https://randomuser.me/api/portraits/men/46.jpg',
        otherInitials: 'DK',
        subject: 'Spanish',
        status: 'completed',
        statusLabel: T('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'schedule',
        cardDescText:
          'Covered ser vs estar in present tense. Student struggled with temporary vs permanent states — assign extra practice on contextual usage.',
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$28', label: rec },
          { value: T('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: false,
        showActions: false,
        canJoin: false,
      }),
      m({
        id: '__mock_tutor_upcoming__',
        role: 'tutor',
        roleLabel: T('LESSONS_PAGE.ROLE_STUDENT'),
        otherName: 'James L.',
        otherPicture: 'https://randomuser.me/api/portraits/men/22.jpg',
        otherInitials: 'JL',
        subject: 'Spanish',
        status: 'scheduled',
        statusLabel: T('LESSONS_PAGE.STATUS_SCHEDULED'),
        cardDescMode: 'schedule',
        cardDescText: T('LESSONS_PAGE.LAST_SESSION_PREFIX') + 'Covered ser vs estar in present tense. Student struggled with temporary vs permanent states.',
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$0', label: rec },
          { value: T('LESSONS_PAGE.STATUS_SCHEDULED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: true,
        showActions: false,
        canJoin: false,
      }),
      m({
        id: '__mock_tutor_feedback_needed__',
        role: 'tutor',
        roleLabel: T('LESSONS_PAGE.ROLE_STUDENT'),
        otherName: 'Amy W.',
        otherPicture: 'https://randomuser.me/api/portraits/women/33.jpg',
        otherInitials: 'AW',
        subject: 'Spanish',
        status: 'completed',
        statusLabel: T('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'schedule',
        cardDescText: '',
        needsTutorFeedback: true,
        cardStats: [
          { value: '45 min', label: dur },
          { value: '$20', label: rec },
          { value: T('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: false,
        showActions: false,
        canJoin: false,
      }),
      m({
        id: '__mock_tutor_feedback_optional__',
        role: 'tutor',
        roleLabel: T('LESSONS_PAGE.ROLE_STUDENT'),
        otherName: 'Olivia C.',
        otherPicture: 'https://randomuser.me/api/portraits/women/12.jpg',
        otherInitials: 'OC',
        subject: 'Spanish',
        status: 'completed',
        statusLabel: T('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'schedule',
        cardDescText: 'AI analysis handled this lesson — adding a note is optional.',
        // AI was enabled → no feedback banner; skip remains visible on post-lesson form
        needsTutorFeedback: false,
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$24', label: rec },
          { value: T('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: false,
        showActions: false,
        canJoin: false,
      }),
      m({
        id: '__mock_tutor_tip_received__',
        role: 'tutor',
        roleLabel: T('LESSONS_PAGE.ROLE_STUDENT'),
        otherName: 'Daniel K.',
        otherPicture: 'https://randomuser.me/api/portraits/men/46.jpg',
        otherInitials: 'DK',
        subject: 'Spanish',
        status: 'completed',
        statusLabel: T('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'schedule',
        cardDescText:
          'Reviewed reading comprehension strategies. Student showed strong analytical skills with short passages.',
        cardStats: [
          { value: '60 min', label: dur },
          { value: '$28', label: rec, sub: T('LESSONS_PAGE.CARD_STAT_TIP_SUB', { amount: '$8' }) },
          { value: T('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        isTrial: false,
        tipSent: true,
        tipAmount: '8.00',
        isUpcoming: false,
        showActions: false,
        canJoin: false,
      }),
      m({
        id: '__mock_tutor_no_notes__',
        role: 'tutor',
        roleLabel: T('LESSONS_PAGE.ROLE_STUDENT'),
        otherName: 'Priya S.',
        otherPicture: 'https://randomuser.me/api/portraits/women/77.jpg',
        otherInitials: 'PS',
        subject: 'Spanish',
        status: 'completed',
        statusLabel: T('LESSONS_PAGE.STATUS_COMPLETED'),
        cardDescMode: 'schedule',
        cardDescText: T('LESSONS_PAGE.TUTOR_NO_NOTES'),
        cardStats: [
          { value: '30 min', label: dur },
          { value: '$16', label: rec },
          { value: T('LESSONS_PAGE.STATUS_COMPLETED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: false,
        showActions: false,
        canJoin: false,
      }),
      m({
        id: '__mock_tutor_cancelled__',
        role: 'tutor',
        roleLabel: T('LESSONS_PAGE.ROLE_STUDENT'),
        otherName: 'Marco V.',
        otherPicture: 'https://randomuser.me/api/portraits/men/52.jpg',
        otherInitials: 'MV',
        subject: 'Spanish',
        status: 'cancelled',
        statusLabel: T('LESSONS_PAGE.STATUS_CANCELLED'),
        cardDescMode: 'schedule',
        cardDescText: T('LESSONS_PAGE.CANCELLED_BY_STUDENT') + ' — Schedule conflict',
        cardStats: [
          { value: '45 min', label: dur },
          { value: '$0', label: rec },
          { value: T('LESSONS_PAGE.STATUS_CANCELLED'), label: sta },
        ],
        isTrial: false,
        tipSent: false,
        isUpcoming: false,
        showActions: false,
        canJoin: false,
      }),
    ];
  }

  private appendPreviewMocks(processed: ProcessedLesson[]): ProcessedLesson[] {
    const base =
      processed.length > 0 ? processed[0] : this.processLesson(this.createShellLesson());
    const all = this.buildPreviewMockCards(base);

    const showRole = this.isTutorUser ? 'tutor' : 'student';
    const mocks = all.filter(p => p.role === showRole);

    return [...mocks, ...processed];
  }

  // ─── Pre-compute lesson display data ─────────────────
  private processLesson(lesson: Lesson): ProcessedLesson {
    const role = this.getUserRole(lesson);
    const other = this.getOtherParticipant(lesson);
    const start = new Date(lesson.startTime);
    const end = new Date(lesson.endTime);
    const now = new Date();

    const tz = this.userTz;
    const dateFields = this.formatCardDateFields(start, end);

    // Status
    let status = lesson.status;
    let statusLabel = this.getStatusText(lesson);
    const isUpcoming = (status === 'scheduled' || status === 'confirmed' || status === 'in_progress' || status === 'pending_reschedule') && end >= now;
    const isPast = end < now;

    // Analysis status.
    //
    // Backend's `LessonAnalysis.status` enum is
    //   pending | processing | completed | failed | insufficient_data
    // — there is no 'generating' value server-side. Treat both `pending`
    // (placeholder row created at call-end) and `processing` (analyzer is
    // actively running) as the UI's "generating" so the lesson card shows
    // a spinner from the moment the call ends until the analysis lands.
    // The legacy `'generating'` value is also accepted for backwards-compat
    // with the manual /generate-analysis route on the Lesson model.
    let analysisStatus: 'available' | 'generating' | 'unavailable' = 'unavailable';
    const aiAnalysis = lesson.aiAnalysis;
    const tutorFeedback = lesson.tutorFeedback;
    const inFlightStatuses = new Set(['generating', 'pending', 'processing']);
    if (tutorFeedback?.status === 'completed') {
      analysisStatus = 'available';
    } else if (aiAnalysis?.status && inFlightStatuses.has(aiAnalysis.status)) {
      analysisStatus = 'generating';
    } else if (aiAnalysis?.status === 'completed' || aiAnalysis?.hasAnalysis) {
      analysisStatus = 'available';
    }

    // Tutor note
    const tutorNote = lesson.tutorNote;
    const hasTutorNoteAvailable = !!(tutorNote && tutorNote.text);

    // Can report issue (within 24h of end, both students and tutors)
    const hoursSinceEnd = lesson.endTime ? (now.getTime() - new Date(lesson.endTime).getTime()) / (1000 * 60 * 60) : Infinity;
    const canReportIssue = status === 'completed' && !lesson.issueReported && !lesson.investigationResolvedAt && hoursSinceEnd <= 24;

    // Can join (upcoming or in-progress, within 10 min before start to end)
    const minutesUntilStart = (start.getTime() - now.getTime()) / (1000 * 60);
    const canJoin = (status === 'scheduled' || status === 'confirmed' || status === 'in_progress') && minutesUntilStart <= 10 && end > now;

    // Initials
    const nameParts = other.name.split(' ');
    const initials = nameParts.length > 1
      ? `${nameParts[0].charAt(0)}${nameParts[1].charAt(0)}`
      : nameParts[0].charAt(0);

    // Tutor needs to leave feedback only when:
    //   1. AI analysis was DISABLED for this lesson (aiAnalysisEnabledAtTime === false)
    //   2. A TutorFeedback record exists, is pending, and is required
    // Backend invariant: TutorFeedback records are only created for AI-disabled lessons.
    // We add the explicit AI check as a defensive guard against stray/legacy records.
    // Trial lessons are excluded — no feedback expected.
    const isTrial = !!lesson.isTrialLesson;
    const aiWasDisabled = lesson.aiAnalysisEnabledAtTime === false;
    const hasTutorFeedbackAvailable = tutorFeedback?.status === 'completed';
    const needsTutorFeedback = role === 'tutor'
      && status === 'completed'
      && !isTrial
      && aiWasDisabled
      && !!tutorFeedback
      && tutorFeedback.status === 'pending'
      && tutorFeedback.required !== false;

    // Student sees "awaiting feedback" only when AI analysis is NOT available AND
    // the lesson actually requires tutor feedback (AI wasn't supposed to handle it).
    // If AI was enabled, tutor feedback is optional — never show a pending badge.
    // Trial lessons are excluded — no feedback expected.
    const hasAiAnalysis = aiAnalysis?.status === 'completed' || !!aiAnalysis?.hasAnalysis;
    const aiWasEnabled = lesson.aiAnalysisEnabledAtTime === true;
    const requiresTutorFeedback = !!lesson.requiresTutorFeedback;
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

    // Footer strip: match reference (completed, joinable, cancelled — not empty for 1:1)
    const showActions =
      (!lesson.isClass && (canJoin || status === 'completed' || status === 'cancelled'))
      || (!!lesson.isClass && canJoin);

    let cardDescMode: ProcessedLesson['cardDescMode'] = 'schedule';
    let cardDescText = '';
    const T = (k: string, params?: Record<string, string>) => this.translate.instant(k, params);

    if (status === 'completed' || status === 'ended_early') {
      if (role === 'tutor') {
        const noteBody = tutorNote?.text;
        const feedbackNotes = tutorFeedback?.overallNotes;
        if (noteBody) {
          cardDescMode = 'schedule';
          cardDescText = this.truncateCardText(noteBody, 220);
        } else if (feedbackNotes && hasTutorFeedbackAvailable) {
          cardDescMode = 'schedule';
          cardDescText = this.truncateCardText(String(feedbackNotes), 220);
        } else if (needsTutorFeedback) {
          cardDescMode = 'schedule';
          // Card banner explains feedback needed — avoid duplicating TUTOR_FEEDBACK_NEEDED in desc
          cardDescText = '';
        } else {
          cardDescMode = 'schedule';
          cardDescText = T('LESSONS_PAGE.TUTOR_NO_NOTES');
        }
      } else {
        if (isTrial) {
          // no description — card has name + date + stats already
        } else if (analysisStatus === 'generating') {
          cardDescMode = 'analysis_generating';
        } else if (feedbackPendingForStudent) {
          cardDescMode = 'analysis';
          // Banner shows awaiting state — avoid duplicate line under it
          cardDescText = '';
        } else {
          const sum = aiAnalysis?.overallAssessment?.summary || aiAnalysis?.studentSummary;
          const firstImprovement = aiAnalysis?.progressionMetrics?.keyImprovements?.[0];
          const noteBody = tutorNote?.text;
          const feedbackNotes = tutorFeedback?.overallNotes;

          if (sum && String(sum).trim()) {
            cardDescMode = 'analysis';
            cardDescText = this.truncateCardText(String(sum), 220);
          } else if (firstImprovement) {
            cardDescMode = 'analysis';
            cardDescText = this.truncateCardText(firstImprovement, 220);
          } else if (noteBody) {
            cardDescMode = 'analysis';
            cardDescText = this.truncateCardText(noteBody, 220);
          } else if (feedbackNotes && hasTutorFeedbackAvailable) {
            cardDescMode = 'analysis';
            cardDescText = this.truncateCardText(String(feedbackNotes), 220);
          } else if (analysisStatus === 'available') {
            cardDescMode = 'analysis';
            cardDescText = T('LESSONS_PAGE.ANALYSIS_AVAILABLE_TAP');
          } else {
            cardDescMode = 'analysis_empty';
          }
        }
      }
    } else if (status === 'cancelled') {
      const cancelBy = lesson.cancelledBy;
      const reasonText = lesson.cancelReasonText || lesson.cancelReason || '';
      let byLabel = '';
      if (cancelBy === 'tutor') byLabel = T('LESSONS_PAGE.CANCELLED_BY_TUTOR');
      else if (cancelBy === 'student') byLabel = T('LESSONS_PAGE.CANCELLED_BY_STUDENT');
      else if (cancelBy === 'system' || cancelBy === 'admin') byLabel = T('LESSONS_PAGE.CANCELLED_BY_SYSTEM');

      if (byLabel && reasonText) {
        cardDescText = `${byLabel} — ${reasonText}`;
      } else if (byLabel) {
        cardDescText = byLabel;
      } else if (reasonText) {
        cardDescText = reasonText;
      }
    } else if (status === 'in_progress') {
      cardDescText = T('LESSONS_PAGE.LESSON_IN_PROGRESS');
    } else if (status === 'pending_reschedule') {
      cardDescText = T('LESSONS_PAGE.RESCHEDULE_PENDING');
    } else if (status === 'scheduled' || status === 'confirmed') {
      const ctx = lesson.lastSessionContext;
      const displayName = other?.name || '';
      if (ctx?.isFirstLesson) {
        const key = role === 'tutor'
          ? 'LESSONS_PAGE.FIRST_LESSON_TUTOR'
          : 'LESSONS_PAGE.FIRST_LESSON_STUDENT';
        cardDescText = T(key, { name: displayName });
      } else if (ctx?.summary) {
        cardDescText = T('LESSONS_PAGE.LAST_SESSION_PREFIX') + this.truncateCardText(ctx.summary, 180);
      }
    }

    const cardDescCanTranslate = !!(
      (status === 'scheduled' || status === 'confirmed') &&
      cardDescMode === 'schedule' &&
      !lesson.isClass &&
      !lesson.lastSessionContext?.isFirstLesson &&
      cardDescText &&
      this.lessonService.shouldOfferProseTranslation(lesson.lastSessionContext?.summaryLanguage)
    );

    const tipRaw = (lesson as any).tip?.amount;
    const tipAmt = tipRaw ? Number(tipRaw) : 0;
    const durLabel = this.translate.instant('LESSONS_PAGE.DURATION_MIN');
    const cardStats: { value: string; label: string; sub?: string }[] = [
      { value: `${lesson.duration}${durLabel}`, label: this.translate.instant('LESSONS_PAGE.CARD_STAT_DURATION') },
      this.lessonCardMoneyStat(lesson, role, tipAmt),
      { value: statusLabel, label: this.translate.instant('LESSONS_PAGE.CARD_STAT_STATUS') },
    ];
    return {
      id: lesson._id,
      lesson,
      subject: lesson.subject || this.translate.instant('LESSONS_PAGE.ROLE_LESSON'),
      role,
      roleLabel: role === 'student' ? this.translate.instant('LESSONS_PAGE.ROLE_TUTOR') : this.translate.instant('LESSONS_PAGE.ROLE_STUDENT'),
      otherName: other.name,
      otherPicture: other.picture === '/assets/default-avatar.png' ? '' : other.picture,
      otherInitials: initials.toUpperCase(),
      formattedMonth: dateFields.formattedMonth,
      formattedDayNum: dateFields.formattedDayNum,
      formattedWeekday: dateFields.formattedWeekday,
      formattedDate: dateFields.formattedDate,
      formattedTimeRange: dateFields.formattedTimeRange,
      formattedEndTime: dateFields.formattedEndTime,
      duration: lesson.duration,
      price: lesson.price,
      formattedPrice: (lesson.price || 0).toFixed(2),
      status,
      statusLabel,
      isTrial: !!lesson.isTrialLesson,
      isUpcoming,
      isPast,
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
      classThumbnail: (lesson as any).classData?.thumbnail || (lesson as any).thumbnail || '',
      cardDescMode,
      cardDescText,
      cardDescCanTranslate,
      cardStats,
      isToday: start.toDateString() === now.toDateString(),
      durationLabel: '',
    };
  }

  private truncateCardText(s: string, max: number): string {
    const t = (s || '').trim();
    if (!t) return '';
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1).trim()}…`;
  }

  showCardTranslateButton(pl: ProcessedLesson): boolean {
    if (!pl.cardDescCanTranslate) return false;
    return this.lessonService.canTranslateProse();
  }

  isCardDescTranslating(pl: ProcessedLesson): boolean {
    return this.cardDescI18n.get(pl.id)?.loading ?? false;
  }

  isCardDescTranslated(pl: ProcessedLesson): boolean {
    return this.cardDescI18n.get(pl.id)?.showingTranslated ?? false;
  }

  private applyCardDescTranslations(processed: ProcessedLesson[]): ProcessedLesson[] {
    return processed.map(pl => {
      const st = this.cardDescI18n.get(pl.id);
      if (!st) return pl;
      if (st.original !== pl.cardDescText && !st.showingTranslated) {
        st.original = pl.cardDescText;
        st.translated = null;
        st.showingTranslated = false;
      }
      if (st.showingTranslated && st.translated) {
        return { ...pl, cardDescText: st.translated };
      }
      return pl;
    });
  }

  private patchProcessedLessonCardText(lessonId: string, text: string): void {
    const patch = (arr: ProcessedLesson[]) => {
      const idx = arr.findIndex(p => p.id === lessonId);
      if (idx >= 0) arr[idx] = { ...arr[idx], cardDescText: text };
    };
    patch(this.processedLessons);
    patch(this.processedDisplayed);
  }

  toggleCardDescTranslation(pl: ProcessedLesson, event?: Event): void {
    event?.stopPropagation();
    if (!pl.cardDescCanTranslate || this.isCardDescTranslating(pl)) return;

    const lang = this.lessonService.getProseTranslationTarget();
    if (!lang) return;

    let st = this.cardDescI18n.get(pl.id);
    if (!st) {
      st = { original: pl.cardDescText, translated: null, showingTranslated: false, loading: false };
      this.cardDescI18n.set(pl.id, st);
    }

    if (st.showingTranslated) {
      st.showingTranslated = false;
      this.patchProcessedLessonCardText(pl.id, st.original);
      this.cdr.markForCheck();
      return;
    }

    if (st.translated) {
      st.showingTranslated = true;
      this.patchProcessedLessonCardText(pl.id, st.translated);
      this.cdr.markForCheck();
      return;
    }

    st.loading = true;
    this.cdr.markForCheck();

    this.lessonService.translateLessonContext(pl.id, lang).subscribe({
      next: (resp) => {
        st!.loading = false;
        if (resp?.success && resp.summary) {
          const prefix = this.translate.instant('LESSONS_PAGE.LAST_SESSION_PREFIX') || '';
          const translated = prefix + this.truncateCardText(resp.summary, 180);
          st!.translated = translated;
          st!.showingTranslated = true;
          this.patchProcessedLessonCardText(pl.id, translated);
        }
        this.cdr.markForCheck();
      },
      error: () => {
        st!.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private getInitials(name: string): string {
    return name.split(' ').map(p => p.charAt(0)).join('').toUpperCase().slice(0, 2);
  }

  /** Middle lesson-card column: list price for students, tutor net payout for tutors. */
  private lessonCardMoneyStat(lesson: Lesson, role: 'tutor' | 'student', tipAmt = 0): { value: string; label: string; sub?: string } {
    if (role === 'student') {
      const base = (lesson.price || 0).toFixed(0);
      return {
        value: `$${base}`,
        label: this.translate.instant('LESSONS_PAGE.CARD_STAT_PRICE'),
        sub: tipAmt > 0
          ? this.translate.instant('LESSONS_PAGE.CARD_STAT_TIP_SUB', {
              amount: `$${tipAmt.toFixed(tipAmt % 1 === 0 ? 0 : 2)}`,
            })
          : undefined,
      };
    }
    const raw = lesson.tutorPayout;
    const n = typeof raw === 'number' && !Number.isNaN(raw) ? Math.max(0, raw) : 0;
    const rounded = Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n) : Math.round(n * 100) / 100;
    const value = `$${rounded.toFixed(Number.isInteger(rounded) ? 0 : 2)}`;
    return {
      value,
      label: this.translate.instant('LESSONS_PAGE.CARD_STAT_RECEIVED'),
      sub: tipAmt > 0
        ? this.translate.instant('LESSONS_PAGE.CARD_STAT_TIP_SUB', {
            amount: `$${tipAmt.toFixed(tipAmt % 1 === 0 ? 0 : 2)}`,
          })
        : undefined,
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

  private extractUniqueSubjects() {
    const seen = new Set<string>();
    this.allLessons.forEach(l => {
      const s = (l.subject || '').trim();
      if (s && !l.isClass) seen.add(s);
    });
    this.uniqueSubjects = Array.from(seen).sort();
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
      case 'scheduled':
      case 'confirmed':
        return this.translate.instant('LESSONS_PAGE.STATUS_SCHEDULED');
      case 'in_progress': return this.translate.instant('LESSONS_PAGE.STATUS_IN_PROGRESS');
      case 'completed':
      case 'ended_early':
        return this.translate.instant('LESSONS_PAGE.STATUS_COMPLETED');
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

  onLessonClick(pl: ProcessedLesson) {
    if (pl.lesson && pl.id && !pl.id.startsWith('__mock_')) {
      this.lessonService.updateCachedLessonDetail(pl.id, {
        lesson: pl.lesson,
        isClass: !!pl.isClass,
      });
    }
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
