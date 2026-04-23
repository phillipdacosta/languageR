import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter, ViewDidEnter, ActionSheetController, ModalController, ToastController, AlertController, NavController } from '@ionic/angular';
import { EventDetailsModalComponent } from '../components/event-details-modal/event-details-modal.component';
import { Router, RouterModule, NavigationEnd, ActivatedRoute } from '@angular/router';
import { UserService, User } from '../services/user.service';
import { LessonService, Lesson } from '../services/lesson.service';
import { ClassService } from '../services/class.service';
import { WebSocketService } from '../services/websocket.service';
import { Calendar, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { filter, takeUntil } from 'rxjs/operators';
import { Subject, firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { PlatformService } from '../services/platform.service';
import { trigger, state, style, transition, animate, query, stagger } from '@angular/animations';
import { ClassAttendeesComponent } from '../components/class-attendees/class-attendees.component';
import { BlockTimeComponent } from '../modals/block-time/block-time.component';
import { HttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Haptics, NotificationType } from '@capacitor/haptics';
import { Browser } from '@capacitor/browser';
import { environment } from '../../environments/environment';
import { TutorFeedbackService } from '../services/tutor-feedback.service';
import { getHoursInTz, getMinutesInTz, formatTimeInTz, formatDateInTz } from '../shared/timezone.utils';
// Performance pipes
import { EventsForDayPipe } from './pipes/events-for-day.pipe';
import { EventsForSelectedDayPipe } from './pipes/events-for-selected-day.pipe';
import { EventTopPipe } from './pipes/event-top.pipe';
import { EventHeightPipe } from './pipes/event-height.pipe';
import { EventTimePipe } from './pipes/event-time.pipe';
import { IsTodayPipe } from './pipes/is-today.pipe';
import { IsEventPastPipe } from './pipes/is-event-past.pipe';
import { FreeHoursPipe } from './pipes/free-hours.pipe';
import { GrossFreeHoursPipe } from './pipes/gross-free-hours.pipe';
import { TotalAvailabilityPipe } from './pipes/total-availability.pipe';
import { BookedHoursPipe } from './pipes/booked-hours.pipe';
import { futureAvailabilityRange, overlapMinutes, computeFutureFreeHoursFromEvents, computeGrossFreeHoursFromEvents } from './utils/future-availability.util';

interface MobileDayContext {
  date: Date;
  dayName: string;
  shortDay: string;
  dayNumber: string;
  monthLabel: string;
  isToday: boolean;
}

type TimelineEntryType = 'event' | 'free';

interface TimelineEntry {
  type: TimelineEntryType;
  start: Date;
  end: Date;
  durationMinutes: number;
  title?: string;
  subtitle?: string;
  meta?: string;
  color?: string;
  location?: string;
  avatarUrl?: string;
  isPast?: boolean;
  isHappeningNow?: boolean;
  isTrialLesson?: boolean;
  isClass?: boolean;
  isOfficeHours?: boolean; // True if this is an office hours session
  isCancelled?: boolean; // True if this event is cancelled
  attendees?: any[];
  capacity?: number;
  id?: string; // Lesson ID or Class ID
  isLesson?: boolean; // True if this is a 1:1 lesson
  isGoogleCalendar?: boolean;
  thumbnail?: string; // Thumbnail image for classes
}

interface AgendaSection {
  date: Date;
  dayLabel: string;
  dateLabel: string;
  isToday: boolean;
  relativeLabel?: string;
  events: TimelineEntry[];
}

@Component({
  selector: 'app-tutor-calendar-page',
  templateUrl: './tutor-calendar.page.html',
  styleUrls: ['./tutor-calendar.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule, 
    IonicModule, 
    FormsModule, 
    ClassAttendeesComponent,
    BlockTimeComponent, // Preload to avoid JIT compilation freeze
    // Performance pipes
    EventsForDayPipe,
    EventsForSelectedDayPipe,
    EventTopPipe,
    EventHeightPipe,
    EventTimePipe,
    IsTodayPipe,
    IsEventPastPipe,
    FreeHoursPipe,
    GrossFreeHoursPipe,
    TotalAvailabilityPipe,
    BookedHoursPipe,
    TranslateModule,
    RouterModule
  ],
  animations: [
    trigger('slideInUp', [
      state('void', style({})),
      state('in', style({
        opacity: 1,
        transform: 'translateY(0) scale(1)'
      })),
      transition('void => in', [
        style({
          opacity: 0,
          transform: 'translateY(20px) scale(0.98)'
        }),
        animate('400ms cubic-bezier(0.4, 0, 0.2, 1)', style({
          opacity: 1,
          transform: 'translateY(0) scale(1)'
        }))
      ]),
      transition('void => void', [])
    ]),
    trigger('listAnimation', [
      transition('* => *', [
        query(':enter', [
          style({ opacity: 0, transform: 'translateY(20px) scale(0.98)' }),
          stagger(80, [
            animate('400ms cubic-bezier(0.4, 0, 0.2, 1)', style({
              opacity: 1,
              transform: 'translateY(0) scale(1)'
            }))
          ])
        ], { optional: true })
      ])
    ])
  ]
})
export class TutorCalendarPage implements OnInit, AfterViewInit, OnDestroy, ViewWillEnter, ViewDidEnter {
  currentUser: User | null = null;
  userTz: string | undefined = undefined;
  hasCustomProfilePhoto = false; // True only if user has uploaded a custom photo (not Google photo)
  isMobilePlatform = false;
  isCompactToolbar = false;
  
  get isOnboardingIncomplete(): boolean {
    const user = this.currentUser;
    const creds = user?.tutorCredentials;
    const hasPayoutSetup = user?.stripeConnectOnboarded || user?.payoutProvider === 'paypal' || user?.payoutProvider === 'manual';
    const govIdUploaded = !!(creds?.governmentId?.url && creds.governmentId.status !== 'not_uploaded');
    const certsUploaded = !!(creds?.teachingCertifications && creds.teachingCertifications.length > 0);
    return !this.hasCustomProfilePhoto ||
           !user?.tutorOnboarding?.videoApproved ||
           !(govIdUploaded && certsUploaded) ||
           !hasPayoutSetup;
  }

  /** True when government ID or teaching certs are missing (calendar onboarding banner). */
  get bannerCredentialsIncomplete(): boolean {
    const creds = this.currentUser?.tutorCredentials;
    const gov = creds?.governmentId;
    const govIdUploaded = !!(gov?.url && gov.status !== 'not_uploaded');
    const certsUploaded = (creds?.teachingCertifications?.length ?? 0) > 0;
    return !(govIdUploaded && certsUploaded);
  }

  get profileChecklist(): { id: string; label: string; done: boolean; route: string }[] {
    const user = this.currentUser;
    if (!user) return [];
    const creds = user.tutorCredentials;
    const hasVideo = !!(user.onboardingData?.introductionVideo || user.onboardingData?.pendingVideo);
    const videoApproved = user.tutorOnboarding?.videoApproved === true;
    const govIdUploaded = !!(creds?.governmentId?.url && creds.governmentId.status !== 'not_uploaded');
    const certsUploaded = (creds?.teachingCertifications?.length ?? 0) > 0;
    const credsComplete = govIdUploaded && certsUploaded;
    const credsApproved = creds?.governmentId?.status === 'approved' && !!(creds?.teachingCertifications?.some((c: any) => c.status === 'approved'));
    const hasPayout = user.stripeConnectOnboarded || user.payoutProvider === 'paypal' || user.payoutProvider === 'manual';
    return [
      { id: 'photo', label: 'Profile photo', done: this.hasCustomProfilePhoto, route: '/tutor-approval' },
      { id: 'video', label: hasVideo && !videoApproved ? 'Intro video (pending review)' : 'Introduction video', done: hasVideo, route: '/tabs/profile' },
      { id: 'creds', label: credsComplete && !credsApproved ? 'Credentials (pending review)' : 'Credentials', done: credsComplete, route: '/tutor-approval' },
      { id: 'payout', label: 'Payout method', done: !!hasPayout, route: '/tutor-approval' },
    ];
  }

  get profileChecklistDoneCount(): number {
    return this.profileChecklist.filter(i => i.done).length;
  }

  // Outstanding feedback
  pendingFeedbackCount = 0;
  pendingFeedbackItems: any[] = [];
  isFeedbackModalOpen = false;
  feedbackBannerSubtitle: string = '';
  feedbackGraceExpired: boolean = false;
  private feedbackGraceInterval: any = null;
  private static readonly FEEDBACK_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours
  
  private calendar?: Calendar;
  events: EventInput[] = [];
  isInitialized = false;
  private initializationAttempts = 0; // Track initialization attempts
  
  // Custom Calendar Properties
  customView: 'week' | 'day' = 'week';
  currentWeekStart: Date = new Date();
  weekDays: Array<{date: Date, shortDay: string, dayNumber: string, dayName: string}> = [];
  selectedDayForDayView: {date: Date, shortDay: string, dayNumber: string, dayName: string, monthLabel: string, year: number} = {
    date: new Date(),
    shortDay: '',
    dayNumber: '',
    dayName: '',
    monthLabel: '',
    year: new Date().getFullYear()
  };
  timeSlots: string[] = [];
  currentTimePosition: number = 0;
  currentWeekTitle: string = '';
  private timeUpdateInterval: any;
  
  // ViewChild references for scroll containers
  @ViewChild('weekBodyContainer', { read: ElementRef }) weekBodyContainer?: ElementRef;
  @ViewChild('dayViewBodyContainer', { read: ElementRef }) dayViewBodyContainer?: ElementRef;
  
  // Custom full-width now indicator state
  enableCustomNowIndicator = false;
  customNowVisible = false;
  customNowTop = 0;
  customNowLeft = 0;
  customNowWidth = 0;
  private customNowInterval: any;
  private hasScrolledToNow = false; // Track if we've already scrolled to prevent repeated scrolls
  
  // Mobile expandable sections
  sidebarExpanded = false;
  tagsExpanded = false;
  lessonStatusExpanded = false;

  // Mobile timeline state
  isMobileView = false;
  showMobileSettings = false;
  fabMenuOpen = false;
  isOfficeHoursEnabled = false;
  panelAnimating = false;
  activeSettingsTab = 'availability';
  showPopularSlots = false;
  mobileViewMode: 'day' | 'agenda' = 'day';
  readonly mobileDaysToShow = 7;
  readonly agendaDaysToShow = 7;
  private mobileWeekStart: Date = new Date();
  mobileDays: MobileDayContext[] = [];
  mobileAgendaSections: AgendaSection[] = [];
  selectedMobileDayIndex = 0;
  mobileTimeline: TimelineEntry[] = [];
  mobileTimelineEvents: TimelineEntry[] = [];
  isLoadingMobileData = true;

  // Today summary (computed once per timeline build)
  todaySummaryLessonCount = 0;
  todaySummaryHoursAvailable = 0;
  /** Mobile avail pill visibility: includes past slots for the selected day. */
  todaySummaryGrossHoursAvailable = 0;
  todaySummaryNextUp: TimelineEntry | null = null;

  // Mobile availability blocks for day view
  mobileAvailabilityBlocks: TimelineEntry[] = [];
  private availabilityLoaded = false;
  private lessonsLoaded = false;

  // Availability modal + summary
  isAvailabilityModalOpen = false;
  availabilityJustSaved = false;
  private _pendingAvailPop = false;
  weekAvailabilityHours = 0;
  /** Sum of free hours across the week including past slots — controls pill visibility. */
  weekAvailabilityGrossHours = 0;
  weekAvailabilityByDay: {
    label: string;
    totalHours: number;
    blocks: { startTime: string; endTime: string; duration: string }[];
    totalMinutes?: number;
  }[] = [];
  /** Rows shown in the availability detail modal (full week or single day from day view) */
  availabilityModalRows: {
    label: string;
    totalHours: number;
    blocks: { startTime: string; endTime: string; duration: string }[];
    totalMinutes?: number;
  }[] = [];
  availabilityModalDescription = '';

  // Smart caching — prevents visible reload on re-entry
  private _lastDataFetch = 0;
  private _cacheValidityMs = 30000;
  
  // Lazy loading state
  private earliestLoadedDate: Date | null = null;
  private latestLoadedDate: Date | null = null;
  private readonly LOAD_WINDOW_WEEKS = 4; // Load 4 weeks at a time
  private readonly INITIAL_PAST_WEEKS = 2; // Initially load 2 weeks in the past
  private readonly INITIAL_FUTURE_WEEKS = 8; // Initially load 8 weeks in the future
  private loadedEvents: Map<string, EventInput> = new Map(); // Store all loaded events by ID
  
  // Inline modal state for Block Time modal
  isBlockTimeModalOpen = false;
  blockTimeModalData: {
    date: Date;
    startTime?: Date;
    endTime?: Date;
    durationMinutes?: number;
  } | null = null;
  // Note: Classes load separately and update asynchronously - they don't block initial render
  
  // Computed property to check if desktop calendar is ready
  get isDesktopCalendarReady(): boolean {
    return this.availabilityLoaded && this.lessonsLoaded; // Classes can load after
  }
  
  // Reschedule mode state
  rescheduleMode = false;
  rescheduleLessonId: string | null = null;
  rescheduleParticipantId: string | null = null;
  rescheduleOriginalStartTime: string | null = null;
  rescheduleOriginalEndTime: string | null = null;
  participantAvailability: any[] = [];

  // Stripe Connect status - subscribe to UserService
  stripeConnectOnboarded = false; // Legacy name, but now checks for ANY payout method (Stripe/PayPal/Manual)
  approvalStatus: any; // Tutor approval status from UserService
  private approvalStatusSubscription?: any;
  private userSubscription?: any;

  private viewportResizeHandler = () => this.evaluateViewport();
  private appResumeHandler = () => {
    if (document.visibilityState === 'visible') this.onAppResume();
  };

  get agendaRangeLabel(): string {
    const start = this.mobileWeekStart ? this.getStartOfDay(this.mobileWeekStart) : this.getStartOfDay(new Date());
    const end = this.addDays(start, this.agendaDaysToShow - 1);
    return "".concat(
      formatDateInTz(start, this.userTz, { month: 'short', day: 'numeric', year: undefined }),
      ' – ',
      formatDateInTz(end, this.userTz, { month: 'short', day: 'numeric', year: undefined })
    );
  }

  get selectedMobileDay(): MobileDayContext | null {
    return this.mobileDays[this.selectedMobileDayIndex] ?? null;
  }

  toggleMobileSettings() {
    if (this.showMobileSettings) {
      this.panelAnimating = true;
      this.showMobileSettings = false;
      setTimeout(() => {
        this.panelAnimating = false;
      }, 250);
    } else {
      this.panelAnimating = true;
      this.showMobileSettings = true;
      setTimeout(() => {
        this.panelAnimating = false;
      }, 0);
    }
  }

  setMobileViewMode(mode: 'day' | 'agenda') {
    if (this.mobileViewMode === mode) {
      return;
    }
    this.mobileViewMode = mode;
    if (mode === 'day') {
      this.showMobileSettings = false;
      this.setupDayMode(new Date());
    } else {
      this.showMobileSettings = false;
      this.setupAgendaMode(new Date());
    }
  }

  setActiveTab(tab: string) {
    this.activeSettingsTab = tab;
  }

  togglePopularSlots() {
    this.showPopularSlots = !this.showPopularSlots;
  }

  shiftMobileDays(offset: number) {
    if (!this.isMobileView || !this.mobileWeekStart) {
      return;
    }
    const newAnchor = this.addDays(this.mobileWeekStart, offset);
    if (this.mobileViewMode === 'day') {
      this.setupDayMode(newAnchor);
    } else {
      this.setupAgendaMode(newAnchor);
    }
    this.showMobileSettings = false;
  }

  selectMobileDay(index: number) {
    if (!this.isMobileView) {
      return;
    }
    if (index < 0 || index >= this.mobileDays.length) {
      return;
    }
    this.selectedMobileDayIndex = index;
    this.showMobileSettings = false;
    this.buildMobileTimeline();
  }

  goToMobileToday() {
    const today = new Date();
    if (this.mobileViewMode === 'day') {
      this.setupDayMode(today);
    } else {
      this.setupAgendaMode(today);
    }
    this.showMobileSettings = false;
  }

  get is24h(): boolean {
    return false;
  }

  formatTime(date: Date): string {
    return formatTimeInTz(date, this.userTz, undefined, !this.is24h);
  }

  formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const parts: string[] = [];
    if (hours) {
      parts.push(`${hours} ${hours === 1 ? this.translate.instant('TUTOR_CALENDAR.HOUR') : this.translate.instant('TUTOR_CALENDAR.HOURS')}`);
    }
    if (mins) {
      parts.push(`${mins} ${mins === 1 ? this.translate.instant('TUTOR_CALENDAR.MINUTE') : this.translate.instant('TUTOR_CALENDAR.MINUTES')}`);
    }
    if (!parts.length) {
      return this.translate.instant('TUTOR_CALENDAR.LESS_THAN_A_MINUTE');
    }
    return parts.join(' ');
  }

  formatDurationShort(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const parts: string[] = [];
    if (hours) {
      parts.push(`${hours}h`);
    }
    if (mins) {
      parts.push(`${mins}m`);
    }
    if (!parts.length) {
      return '<1m';
    }
    return parts.join(' ');
  }

  private classesMap: Map<string, any> = new Map(); // Map class ID to class data with attendees
  private destroy$ = new Subject<void>();

  constructor(
    private userService: UserService,
    private lessonService: LessonService,
    private classService: ClassService,
    public router: Router,
    private platformService: PlatformService,
    private route: ActivatedRoute,
    private actionSheetController: ActionSheetController,
    private modalController: ModalController,
    private toastController: ToastController,
    private alertController: AlertController,
    private websocketService: WebSocketService,
    private cdr: ChangeDetectorRef,
    private http: HttpClient,
    private tutorFeedbackService: TutorFeedbackService,
    private translate: TranslateService,
    private navCtrl: NavController
  ) { }

  private evaluateViewport() {
    if (typeof window === 'undefined') {
      this.isMobileView = false;
      this.isCompactToolbar = false;
      return;
    }
    const wasMobile = this.isMobileView;
    const width = window.innerWidth;
    this.isMobileView = width <= 768;
    this.isCompactToolbar = width <= 1200;
    if (this.isMobileView) {
      const today = new Date();
      if (this.mobileViewMode === 'day') {
        this.setupDayMode(today);
      } else {
        this.setupAgendaMode(today);
      }
    } else if (wasMobile) {
      this.showMobileSettings = false;
    }
  }

  private setupDayMode(reference: Date) {
    this.setupMobileDays(reference, reference);
    this.buildMobileTimeline();
  }

  private setupAgendaMode(reference: Date) {
    this.setupMobileDays(reference, reference);
    this.buildMobileAgenda();
  }

  private getMonday(date: Date): Date {
    const d = this.getStartOfDay(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    return this.addDays(d, diff);
  }

  private setupMobileDays(anchor: Date, focus: Date = anchor) {
    const start = this.mobileViewMode === 'day' ? this.getMonday(anchor) : this.getStartOfDay(anchor);
    this.mobileWeekStart = start;
    const days: MobileDayContext[] = [];
    const count = this.mobileViewMode === 'agenda' ? this.agendaDaysToShow : this.mobileDaysToShow;
    for (let i = 0; i < count; i++) {
      const current = this.addDays(start, i);
      days.push({
        date: current,
        dayName: formatDateInTz(current, this.userTz, { weekday: 'long', month: undefined, day: undefined, year: undefined }),
        shortDay: formatDateInTz(current, this.userTz, { weekday: 'short', month: undefined, day: undefined, year: undefined }),
        dayNumber: current.getDate().toString(),
        monthLabel: formatDateInTz(current, this.userTz, { month: 'long', day: undefined, year: undefined }),
        isToday: this.isSameDay(current, new Date())
      });
    }
    this.mobileDays = days;
    const focusIndex = days.findIndex(day => this.isSameDay(day.date, focus));
    this.selectedMobileDayIndex = focusIndex >= 0 ? focusIndex : 0;
  }

  private addDays(date: Date, amount: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + amount);
    return result;
  }

  private getStartOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  }

  private buildDayEntries(dayStart: Date, dayEnd: Date): TimelineEntry[] {
    const eventEntries = this.collectEventsForDay(dayStart, dayEnd);
    
    // Merge contiguous availability blocks
    const mergedEvents = this.mergeAvailabilityBlocks(eventEntries);
    
    const entries: TimelineEntry[] = [];
    let cursor = new Date(dayStart.getTime());

    const pushFreeBlock = (start: Date, end: Date) => {
      const diffMs = end.getTime() - start.getTime();
      const minutes = Math.round(diffMs / 60000);
      if (minutes <= 0) {
        return;
      }
      entries.push({
        type: 'free',
        start: new Date(start.getTime()),
        end: new Date(end.getTime()),
        durationMinutes: minutes,
        title: this.translate.instant('TUTOR_CALENDAR.OPEN_TIME_SLOT'),
        meta: `${this.translate.instant('TUTOR_CALENDAR.ADD_AVAILABILITY_BUTTON')} (${this.formatDurationShort(minutes)})`
      });
    };

    for (const entry of mergedEvents) {
      if (entry.start.getTime() > cursor.getTime()) {
        pushFreeBlock(cursor, entry.start);
      }
      entries.push(entry);
      if (entry.end.getTime() > cursor.getTime()) {
        cursor = new Date(entry.end.getTime());
      }
    }

    if (cursor.getTime() < dayEnd.getTime()) {
      pushFreeBlock(cursor, dayEnd);
    }

    return entries;
  }

  private mergeAvailabilityBlocks(entries: TimelineEntry[]): TimelineEntry[] {
    if (entries.length === 0) {
      return entries;
    }

    // First, separate lessons/classes from availability blocks
    const lessons: TimelineEntry[] = [];
    const availabilityBlocks: TimelineEntry[] = [];

    for (const entry of entries) {
      const isLesson = entry.avatarUrl || entry.subtitle;
      const isClass = entry.title && entry.title !== this.translate.instant('TUTOR_CALENDAR.AVAILABLE_FALLBACK') && entry.title.includes(this.translate.instant('TUTOR_CALENDAR.CLASS_FALLBACK'));
      
      if (isLesson || isClass || entry.isGoogleCalendar) {
        lessons.push(entry);
      } else {
        availabilityBlocks.push(entry);
      }
    }

    // Filter out availability blocks that overlap with any lesson
    const nonOverlappingAvailability = availabilityBlocks.filter(availability => {
      return !lessons.some(lesson => {
        // Check if availability block overlaps with this lesson
        const availStart = availability.start.getTime();
        const availEnd = availability.end.getTime();
        const lessonStart = lesson.start.getTime();
        const lessonEnd = lesson.end.getTime();
        
        // Overlaps if: availability starts before lesson ends AND availability ends after lesson starts
        return availStart < lessonEnd && availEnd > lessonStart;
      });
    });

    // Now merge contiguous availability blocks
    const merged: TimelineEntry[] = [];
    let current: TimelineEntry | null = null;

    for (const entry of nonOverlappingAvailability) {
      if (!current) {
        current = { ...entry };
        continue;
      }

      // Merge only truly adjacent/overlapping blocks (gap < 1 min handles rounding)
      const gap = entry.start.getTime() - current.end.getTime();

      if (gap < 60_000) {
        // Merge: extend the current block's end time
        current.end = new Date(Math.max(current.end.getTime(), entry.end.getTime()));
        current.durationMinutes = Math.round((current.end.getTime() - current.start.getTime()) / 60000);
        continue;
      }

      // If we can't merge, push the current and start a new one
      merged.push(current);
      current = { ...entry };
    }

    // Push the last availability block
    if (current) {
      merged.push(current);
    }

    // Combine lessons and merged availability blocks, then sort by start time
    const combined = [...lessons, ...merged];
    combined.sort((a, b) => a.start.getTime() - b.start.getTime());

    return combined;
  }

  private buildMobileTimeline() {
    if (!this.isMobileView) {
      this.mobileTimeline = [];
      this.mobileTimelineEvents = [];
      this.mobileAvailabilityBlocks = [];
      return;
    }
    const activeDay = this.selectedMobileDay;
    if (!activeDay) {
      this.mobileTimeline = [];
      this.mobileTimelineEvents = [];
      this.mobileAvailabilityBlocks = [];
      return;
    }
    const dayStart = this.getStartOfDay(activeDay.date);
    const dayEnd = this.addDays(dayStart, 1);

    const timeline = this.buildDayEntries(dayStart, dayEnd);

    const availabilityBlocks: TimelineEntry[] = [];
    const timelineEvents = timeline.filter(item => {
      if (item.type !== 'event') return false;
      const isGenericAvailability = item.title === this.translate.instant('TUTOR_CALENDAR.AVAILABLE_FALLBACK') && !item.subtitle && !item.avatarUrl;
      const isFreeSlot = item.title === this.translate.instant('TUTOR_CALENDAR.OPEN_TIME_SLOT');
      if (isGenericAvailability) {
        availabilityBlocks.push(item);
        return false;
      }
      return !isFreeSlot;
    });

    this.mobileTimeline = timeline;
    this.mobileTimelineEvents = timelineEvents;
    this.mobileAvailabilityBlocks = availabilityBlocks;

    this.computeTodaySummary(activeDay, timelineEvents, availabilityBlocks);
  }

  private computeTodaySummary(day: MobileDayContext, events: TimelineEntry[], availability: TimelineEntry[]) {
    const now = new Date();
    const lessons = events.filter(e => !e.isCancelled && (e.isLesson || e.isClass));
    this.todaySummaryLessonCount = lessons.length;

    let grossAvailMinutes = 0;
    for (const block of availability) {
      grossAvailMinutes += block.durationMinutes;
    }
    this.todaySummaryGrossHoursAvailable = Math.round((grossAvailMinutes / 60) * 10) / 10;

    const range = futureAvailabilityRange(day.date, now, 'fullDay');
    let availMinutes = 0;
    if (range) {
      for (const block of availability) {
        availMinutes += overlapMinutes(block.start, block.end, range.winStart, range.winEnd);
      }
    }
    this.todaySummaryHoursAvailable = Math.round((availMinutes / 60) * 10) / 10;

    const upcoming = lessons.filter(e => e.start.getTime() > now.getTime());
    this.todaySummaryNextUp = upcoming.length > 0 ? upcoming[0] : null;
  }

  openAvailabilityModal() {
    this.computeWeekAvailability();
    this.availabilityModalRows = this.weekAvailabilityByDay.slice();
    this.availabilityModalDescription = this.translate.instant('TUTOR_CALENDAR.AVAIL_MODAL_SUBTITLE_WEEK', {
      hours: this.weekAvailabilityHours
    });
    this.isAvailabilityModalOpen = true;
    this.cdr.detectChanges();
  }

  openDayViewAvailabilityModal() {
    const row = this.buildAvailabilityRowForCalendarDay(this.selectedDayForDayView.date);
    this.availabilityModalRows = [row];
    this.availabilityModalDescription = this.translate.instant('TUTOR_CALENDAR.AVAIL_MODAL_SUBTITLE_DAY', {
      hours: row.totalHours
    });
    this.isAvailabilityModalOpen = true;
    this.cdr.detectChanges();
  }

  private buildAvailabilityRowForCalendarDay(dayAnchor: Date): {
    label: string;
    totalHours: number;
    totalMinutes: number;
    blocks: { startTime: string; endTime: string; duration: string }[];
  } {
    const dayStart = new Date(dayAnchor);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);

    const dayEvents = this.collectEventsForDay(dayStart, dayEnd);
    const merged = this.mergeAvailabilityBlocks(dayEvents);
    const availOnly = merged.filter(e => {
      const title = e.title || '';
      return title === '' || title === this.translate.instant('TUTOR_CALENDAR.AVAILABLE_FALLBACK');
    }).filter(e => !e.avatarUrl && !e.subtitle);

    const now = new Date();
    const range = futureAvailabilityRange(dayAnchor, now, 'fullDay');

    let dayMinutes = 0;
    const blocks: { startTime: string; endTime: string; duration: string }[] = [];
    if (range) {
      for (const b of availOnly) {
        const mins = overlapMinutes(b.start, b.end, range.winStart, range.winEnd);
        if (mins <= 0) {
          continue;
        }
        dayMinutes += mins;
        const clipStart = new Date(Math.max(b.start.getTime(), range.winStart.getTime()));
        const clipEnd = new Date(Math.min(b.end.getTime(), range.winEnd.getTime()));
        blocks.push({
          startTime: this.formatTime(clipStart),
          endTime: this.formatTime(clipEnd),
          duration: this.formatDurationShort(mins)
        });
      }
    }

    const dateLabel = dayStart.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    return {
      label: dateLabel,
      totalHours: Math.round((dayMinutes / 60) * 10) / 10,
      totalMinutes: dayMinutes,
      blocks
    };
  }

  private computeWeekAvailability() {
    const weekStart = new Date(this.currentWeekStart);
    const result: typeof this.weekAvailabilityByDay = [];
    let totalFutureMinutes = 0;
    let totalGrossHours = 0;
    const evs = this.events || [];

    for (let d = 0; d < 7; d++) {
      const dayStart = new Date(weekStart);
      dayStart.setDate(weekStart.getDate() + d);
      dayStart.setHours(0, 0, 0, 0);
      const row = this.buildAvailabilityRowForCalendarDay(dayStart);
      totalFutureMinutes += row.totalMinutes;
      totalGrossHours += computeGrossFreeHoursFromEvents(evs, dayStart, 'fullDay');
      result.push({
        label: row.label,
        totalHours: row.totalHours,
        totalMinutes: row.totalMinutes,
        blocks: row.blocks
      });
    }

    this.weekAvailabilityByDay = result;
    this.weekAvailabilityHours = Math.round((totalFutureMinutes / 60) * 10) / 10;
    this.weekAvailabilityGrossHours = Math.round(totalGrossHours * 10) / 10;
  }

  private collectEventsForDay(dayStart: Date, dayEnd: Date): TimelineEntry[] {
    const results: TimelineEntry[] = [];
    
    // Log for debugging
    const dayStr = dayStart.toISOString().split('T')[0]; // Get YYYY-MM-DD
    
    
    // Log all class events in this.events
    const classEventsInArray = (this.events || []).filter(e => {
      const ext = e.extendedProps as any;
      return ext?.isClass || ext?.classId;
    });
    
    
    for (const event of this.events || []) {
      if (!event.start || !event.end) {
        continue;
      }
      const rawStart = new Date(event.start as string | number | Date);
      const rawEnd = new Date(event.end as string | number | Date);
      if (isNaN(rawStart.getTime()) || isNaN(rawEnd.getTime())) {
        continue;
      }
      
      // Check if this event falls within the day range
      const isInRange = rawStart < dayEnd && rawEnd > dayStart;
      
      // Log cancelled class specifically
      const ext = event.extendedProps as any;
      if ((ext?.isClass || ext?.classId) && ext?.isCancelled) {
        
      }
      
      if (!isInRange) {
        continue;
      }
      
      const clampedStart = rawStart.getTime() < dayStart.getTime() ? new Date(dayStart.getTime()) : rawStart;
      const clampedEnd = rawEnd.getTime() > dayEnd.getTime() ? new Date(dayEnd.getTime()) : rawEnd;
      
      results.push(this.buildTimelineEvent(event, clampedStart, clampedEnd));
    }
    
    
    
    return results.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  private buildTimelineEvent(event: EventInput, start: Date, end: Date): TimelineEntry {
    const extended = (event.extendedProps as any) || {};
    const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    const isLesson = Boolean(extended.lessonId);
    const isClass = extended.isClass || (event.title && event.title !== this.translate.instant('TUTOR_CALENDAR.AVAILABLE_FALLBACK') && event.title.includes(this.translate.instant('TUTOR_CALENDAR.CLASS_FALLBACK')));
    const isOfficeHours = Boolean(extended.isOfficeHours);
    
    // For classes, check the classesMap for the latest status
    let isCancelled = extended.isCancelled || false;
    if (isClass && extended.classId) {
      const classId = String(extended.classId);
      const classData = this.classesMap.get(classId);
      if (classData) {
        isCancelled = classData.status === 'cancelled';
      }
    }
    
    // For lessons, show student name and lesson type (e.g., "John - Spanish lesson")
    const studentName = isLesson ? (extended.studentDisplayName || extended.studentName || this.translate.instant('TUTOR_CALENDAR.STUDENT')) : '';
    const lessonType = isLesson ? (extended.subject || this.translate.instant('TUTOR_CALENDAR.LESSON_FALLBACK')) : '';
    const title = isLesson 
      ? `${studentName} - ${lessonType}` 
      : (event.title || extended.subject || this.translate.instant('TUTOR_CALENDAR.AVAILABLE_FALLBACK'));
    const subtitle = isLesson ? (extended.subject || extended.status) : (extended.studentName || extended.subject);
    const meta = isLesson ? this.formatDuration(durationMinutes) : (extended.timeStr || extended.status);
    
    // Color coding:
    // Office hours: Gold (#f59e0b)
    // Classes: Purple (#8b5cf6)  
    // Regular lessons: Green (#10b981)
    // Availability: Blue (#007bff)
    const isGoogleCalendar = Boolean(extended.isGoogleCalendar);
    
    let color = '#007bff';
    if (isGoogleCalendar) {
      color = '#6b7280';
    } else if (isOfficeHours) {
      color = '#f59e0b';
    } else if (isClass) {
      color = '#8b5cf6';
    } else if (isLesson) {
      color = '#10b981';
    }
    
    const location = extended.location || extended.platform;
    const avatarUrl = isLesson ? extended.studentAvatar : undefined;
    const isTrialLesson = isLesson ? (extended.isTrialLesson || false) : false;
    
    // Check if event is in the past and if it's happening now
    const now = new Date();
    const isPast = end.getTime() < now.getTime();
    const isHappeningNow = start.getTime() <= now.getTime() && end.getTime() > now.getTime();

    // Look up class data from classesMap if this is a class
    let attendees: any[] | undefined = undefined;
    let capacity: number | undefined = undefined;
    let thumbnail: string | undefined = undefined;
    if (isClass && extended.classId) {
      const classId = String(extended.classId); // Ensure string for lookup
      const classData = this.classesMap.get(classId);
      if (classData) {
        // Get confirmed students (attendees) - these are the students who accepted
        attendees = classData.attendees || classData.confirmedStudents || [];
        capacity = classData.capacity || 1;
        thumbnail = classData.thumbnail; // Extract thumbnail for mobile display
      }
    }

    return {
      type: 'event',
      start: new Date(start.getTime()),
      end: new Date(end.getTime()),
      durationMinutes,
      title,
      subtitle,
      meta,
      color,
      location,
      avatarUrl,
      isPast,
      isHappeningNow,
      isTrialLesson,
      isClass: isClass || false,
      isOfficeHours: isOfficeHours || false,
      isCancelled: isCancelled, // Use the local variable that was updated from classesMap
      attendees,
      capacity,
      thumbnail,
      id: extended.lessonId || extended.classId,
      isLesson: isLesson,
      isGoogleCalendar
    };
  }

  private buildMobileAgenda() {
    if (!this.isMobileView) {
      this.mobileAgendaSections = [];
      return;
    }

    const sections: AgendaSection[] = [];
    const anchor = this.mobileWeekStart ? this.getStartOfDay(this.mobileWeekStart) : this.getStartOfDay(new Date());
    for (let i = 0; i < this.agendaDaysToShow; i++) {
      const dayDate = this.addDays(anchor, i);
      const dayStart = this.getStartOfDay(dayDate);
      const dayEnd = this.addDays(dayStart, 1);
      const events = this.buildDayEntries(dayStart, dayEnd);
      const isToday = this.isSameDay(dayDate, new Date());
      const { dayLabel, dateLabel, relative } = this.getAgendaLabels(dayDate, i);
      sections.push({
        date: dayDate,
        dayLabel,
        dateLabel,
        isToday,
        relativeLabel: relative,
        events
      });
    }
    this.mobileAgendaSections = sections;
  }

  private getAgendaLabels(date: Date, offset: number): { dayLabel: string; dateLabel: string; relative?: string } {
    const dateLabel = formatDateInTz(date, this.userTz, { month: 'long', day: 'numeric', year: undefined });
    const dayLabel = formatDateInTz(date, this.userTz, { weekday: 'long', month: undefined, day: undefined, year: undefined });
    let relative: string | undefined;
    if (offset === 1) {
      relative = this.translate.instant('TUTOR_CALENDAR.TOMORROW');
    }
    return {
      dayLabel,
      dateLabel,
      relative
    };
  }
  // Handler for lesson cancelled event
  private lessonCancelledHandler = (event: any) => {
    
    this.refreshCalendar();
  };

  private gcalWsSub: any = null;

  ngOnInit() {
    // Listen for lesson cancelled events (from event-details-modal)
    window.addEventListener('lesson-cancelled', this.lessonCancelledHandler);

    // Listen for real-time Google Calendar push updates via WebSocket
    this.gcalWsSub = this.websocketService.on('gcal-events-updated')
      .pipe(takeUntil(this.destroy$))
      .subscribe((data: any) => {
        if (!data?.events || !this.gcalConnected) return;
        this.mergeGcalWebSocketEvents(data.events);
      });

    // Re-fetch Google Calendar events whenever WebSocket reconnects,
    // but skip if we fetched recently (debounce avoids redundant API calls)
    this.websocketService.connection$
      .pipe(takeUntil(this.destroy$))
      .subscribe((connected: boolean) => {
        if (connected && this.gcalConnected) {
          const elapsed = Date.now() - this.gcalLastFetchTime;
          if (elapsed > TutorCalendarPage.GCAL_DEBOUNCE_MS) {
            this.loadGoogleCalendarEvents();
          }
        }
      });
    
    // Subscribe to approval status from UserService
    this.approvalStatusSubscription = this.userService.tutorApprovalStatus$.subscribe(status => {
      if (status) {
        this.approvalStatus = status;
        this.stripeConnectOnboarded = status.stripeComplete;
        
      }
    });
    
    // Subscribe to availability updates so we can trigger pop animation on re-entry
    this.userService.availabilityUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this._pendingAvailPop = true;
      });

    // Subscribe to user changes to keep hasCustomProfilePhoto in sync
    this.userSubscription = this.userService.currentUser$.subscribe(user => {
      if (user) {
        const prevTimezone = this.currentUser?.profile?.timezone;
        this.currentUser = user;
        this.userTz = user.profile?.timezone || undefined;
        // Check if user has a custom uploaded photo (not just Google/Auth0 photo)
        this.hasCustomProfilePhoto = !!(user.picture && (
          user.picture.includes('storage.googleapis.com') || // GCS uploaded photo
          (user.auth0Picture && user.picture !== user.auth0Picture) // Different from original Auth0 photo
        ));

        // Immediately update time indicator and scroll to it when timezone changes
        if (prevTimezone && user.profile?.timezone && prevTimezone !== user.profile.timezone) {
          this.updateCurrentTimePosition();
          this.hasScrolledToNow = false;
          setTimeout(() => this.scrollToNowIndicator(), 100);
        }

        // Load outstanding feedback for tutors
        if (user.userType === 'tutor') {
          this.loadPendingFeedback();
        }
      }
    });

    // Subscribe to feedback updates
    this.tutorFeedbackService.pendingFeedback$
      .pipe(takeUntil(this.destroy$))
      .subscribe(response => {
        this.pendingFeedbackCount = response.count || 0;
        this.pendingFeedbackItems = response.pendingFeedback || [];

        // Update grace period countdown for feedback banner
        this.updateFeedbackGraceCountdown();

        // Auto-reopen the feedback modal after submitting one item
        if (this.tutorFeedbackService.consumeReopenFlag() && this.pendingFeedbackCount > 0) {
          setTimeout(() => { this.isFeedbackModalOpen = true; }, 400);
        }
      });
    
    // Initialize custom calendar
    this.initializeCustomCalendar();
    this.startTimeUpdater();
    
    // Check if we're in reschedule mode
    this.route.queryParams.subscribe(params => {
      if (params['mode'] === 'reschedule') {
        this.rescheduleMode = true;
        this.rescheduleLessonId = params['lessonId'] || null;
        this.rescheduleParticipantId = params['participantId'] || null;
        this.rescheduleOriginalStartTime = params['originalStartTime'] || null;
        this.rescheduleOriginalEndTime = params['originalEndTime'] || null;
        
        
        
        // Load participant's availability
        if (this.rescheduleParticipantId) {
          this.loadParticipantAvailability(this.rescheduleParticipantId);
        }
      }
    });
    
    this.isMobilePlatform = this.platformService.isMobile();
    this.evaluateViewport();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.viewportResizeHandler);
    }
    if (this.isMobileView) {
      this.setupMobileDays(new Date());
      // Don't build timeline here - wait for data to load
    }
    this.loadCurrentUser();
    
    // Fallback: Initialize calendar after 2 seconds if user loading fails
    setTimeout(() => {
      if (!this.isInitialized && !this.isMobileView) {
        console.warn('📅 User loading timeout, initializing calendar anyway...');
        this.initializeCalendarWithData();
      }
    }, 2000);
    
    // Listen for navigation events to re-initialize calendar
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        if (event.url === '/tabs/tutor-calendar' && this.isInitialized) {
          // Re-initialize calendar after navigation
          setTimeout(() => {
            this.reinitializeCalendar();
          }, 100);
        }
      });

    // Start updater for custom now indicator
    setTimeout(() => this.updateCustomNowIndicator());
    this.customNowInterval = setInterval(() => {
      this.updateCustomNowIndicator();
      // Also refresh mobile timeline more frequently to handle short office hours sessions
      if (this.isMobileView && this.selectedMobileDay) {
        this.buildMobileTimeline();
      }
    }, 60_000); // Every 60 seconds
    window.addEventListener('resize', this.updateCustomNowIndicatorBound);
    
    // Subscribe to office hours notifications for real-time calendar updates
    this.websocketService.newNotification$
      .pipe(takeUntil(this.destroy$))
      .subscribe(async (notification) => {
        // Handle office hours bookings
        if (notification.type === 'office_hours_booking' && notification.urgent) {
          
          
          // Don't show toast if tutor is currently on pre-call page (they already see the modal)
          const currentUrl = this.router.url;
          if (currentUrl.includes('/pre-call')) {
            
            return;
          }
          
          // Show toast notification
          const toast = await this.toastController.create({
            message: notification.message || this.translate.instant('TUTOR_CALENDAR.TOAST_OFFICE_HOURS_BOOKED'),
            duration: 5000,
            color: 'warning',
            icon: 'flash',
            position: 'top',
            buttons: [
              {
                text: this.translate.instant('TUTOR_CALENDAR.VIEW'),
                handler: () => {
                  if (notification.lessonId || notification.data?.lessonId) {
                    const lessonId = notification.lessonId || notification.data?.lessonId;
                    this.router.navigate(['/tabs/lessons', lessonId]);
                  }
                }
              }
            ]
          });
          toast.present();
          
          // Refresh calendar to show the new booking
          this.refreshCalendar();
        }
        
        // Handle class auto-cancelled notifications
        if (notification.type === 'class_auto_cancelled' && notification.data?.classId) {
          
          
          // Refresh calendar to show the cancelled class
          this.refreshCalendar();
          
          // Show toast notification
          const toast = await this.toastController.create({
            message: notification.message || this.translate.instant('TUTOR_CALENDAR.TOAST_CLASS_CANCELLED'),
            duration: 5000,
            position: 'top',
            color: 'warning',
            buttons: [
              {
                text: this.translate.instant('TUTOR_CALENDAR.OK'),
                role: 'cancel'
              }
            ]
          });
          await toast.present();
        }
        
        // Handle lesson cancelled notifications
        if (notification.type === 'lesson_cancelled' && notification.data?.lessonId) {
          
          
          // Refresh calendar to show the cancelled lesson
          this.refreshCalendar();
        }
      });
    
  }
  

  ngAfterViewInit() {
    if (this.isMobileView) {
      // Don't build timeline here - wait for data to load
      return;
    }
    
    // Scroll to current time indicator after view is ready
    setTimeout(() => {
      this.scrollToNowIndicator();
    }, 500); // Delay to ensure DOM is fully rendered
    
    // CUSTOM CALENDAR - No FullCalendar initialization needed
    // FullCalendar initialization commented out
    /*
    // Immediate simple test
    const calendarEl = document.getElementById('tutor-calendar-container');
    
    // Then try to initialize calendar after delay
    setTimeout(() => {
      this.initCalendar();
    }, 2000);
    */
  }

  // ── Feedback Grace Period Countdown ──────────────────────
  private updateFeedbackGraceCountdown() {
    // Clear existing interval
    if (this.feedbackGraceInterval) {
      clearInterval(this.feedbackGraceInterval);
      this.feedbackGraceInterval = null;
    }

    if (this.pendingFeedbackItems.length === 0) {
      this.feedbackBannerSubtitle = '';
      this.feedbackGraceExpired = false;
      return;
    }

    // Find the oldest pending feedback's createdAt
    const oldestCreatedAt = Math.min(
      ...this.pendingFeedbackItems.map((f: any) => new Date(f.createdAt).getTime())
    );
    const deadline = oldestCreatedAt + TutorCalendarPage.FEEDBACK_GRACE_MS;

    // Helper to compute display
    const tick = () => {
      const now = Date.now();
      const remainingMs = deadline - now;

      if (remainingMs <= 0) {
        this.feedbackGraceExpired = true;
        this.feedbackBannerSubtitle = this.translate.instant('TUTOR_CALENDAR.PROFILE_HIDDEN_UNTIL_COMPLETE');
        if (this.feedbackGraceInterval) {
          clearInterval(this.feedbackGraceInterval);
          this.feedbackGraceInterval = null;
        }
        return;
      }

      this.feedbackGraceExpired = false;
      const totalSec = Math.floor(remainingMs / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);

      if (h > 0) {
        this.feedbackBannerSubtitle = this.translate.instant('TUTOR_CALENDAR.COMPLETE_WITHIN_HM', { h, m: m.toString().padStart(2, '0') });
      } else {
        this.feedbackBannerSubtitle = this.translate.instant('TUTOR_CALENDAR.COMPLETE_WITHIN_M', { m });
      }
    };

    // Run immediately, then every 30 seconds
    tick();
    this.feedbackGraceInterval = setInterval(tick, 30000);
  }

  ngOnDestroy() {
    // Clean up subscriptions
    this.destroy$.next();
    this.destroy$.complete();
    
    if (this.feedbackGraceInterval) {
      clearInterval(this.feedbackGraceInterval);
    }
    
    if (this.approvalStatusSubscription) {
      this.approvalStatusSubscription.unsubscribe();
    }
    
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
    
    // Clean up lesson cancelled event listener
    window.removeEventListener('lesson-cancelled', this.lessonCancelledHandler);
    
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.viewportResizeHandler);
    }
    if (this.calendar) {
      this.calendar.destroy();
      this.calendar = undefined;
    }
    this.isInitialized = false;
    this.initializationAttempts = 0; // Reset counter
    if (this.customNowInterval) clearInterval(this.customNowInterval);
    if (this.timeUpdateInterval) clearInterval(this.timeUpdateInterval);
    window.removeEventListener('resize', this.updateCustomNowIndicatorBound);
    document.removeEventListener('visibilitychange', this.appResumeHandler);
    this.stopGcalPolling();
  }

  ionViewWillEnter() {
    this.initializationAttempts = 0;
    this.isOfficeHoursEnabled = this.userService.getOfficeHoursStatus();

    // Don't show skeleton when returning from availability save — data is already present
    if (!this._pendingAvailPop) {
      const cacheAge = Date.now() - this._lastDataFetch;
      const isCacheFresh = this._lastDataFetch > 0 && cacheAge <= this._cacheValidityMs;

      if (!isCacheFresh) {
        this.availabilityLoaded = false;
        this.lessonsLoaded = false;
        if (this.isMobileView) {
          this.isLoadingMobileData = true;
        }
      }
    }

    // Always refresh Google Calendar events on re-entry to catch deletions/changes
    if (this.gcalConnected && this.gcalEventsLoaded) {
      this.loadGoogleCalendarEvents();
    }

    // Refresh gcal events when the user switches back from another app (e.g. Google Calendar)
    document.addEventListener('visibilitychange', this.appResumeHandler);
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) this.onAppResume();
      });
    }
  }

  ionViewDidEnter() {
    // Check if we're coming from availability setup
    const currentUrl = this.router.url;
    
    // Check for refresh parameter from availability setup (URL fallback)
    const urlParams = new URLSearchParams(window.location.search);
    const shouldRefreshAvailability = urlParams.get('refreshAvailability') === 'true';
    
    if (shouldRefreshAvailability) {
      this.router.navigate(['/tabs/tutor-calendar'], { replaceUrl: true });
      this._pendingAvailPop = true;
    }

    // Trigger refresh + pop animation if availability was saved (via service event or URL param)
    if (this._pendingAvailPop) {
      if (this.currentUser) {
        this.forceRefreshAvailability();
      } else {
        this.loadCurrentUser();
      }
      return;
    }
    
    // Only refresh if we have a user
    if (this.currentUser) {
      if (currentUrl === '/tabs/tutor-calendar') {
        // Force refresh calendar data when returning to calendar
        this.refreshCalendarData();
      } else {
        // Force re-initialize calendar when page becomes active
        this.forceReinitializeCalendar();
      }
    } else {
      this.loadCurrentUser();
    }
  }

  ionViewWillLeave() {
    this.initializationAttempts = 0;
    if (this.calendar) {
      this.calendar.destroy();
      this.calendar = undefined;
      this.isInitialized = false;
    }
    document.removeEventListener('visibilitychange', this.appResumeHandler);
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.removeAllListeners();
    }
  }

  private loadCurrentUser() {
    this.userService.getCurrentUser().subscribe({
      next: (user) => {
        this.currentUser = user;
        this.userTz = user?.profile?.timezone || undefined;

        // Check if user has a custom uploaded photo (not just Google/Auth0 photo)
        this.hasCustomProfilePhoto = !!(user.picture && (
          user.picture.includes('storage.googleapis.com') || // GCS uploaded photo
          (user.auth0Picture && user.picture !== user.auth0Picture) // Different from original Auth0 photo
        ));
        
        // Initialize calendar first, then load data
        if (!this.isInitialized) {
          this.initializeCalendarWithData();
        } else {
          // Calendar already initialized, just load data
          this.loadAndUpdateCalendarData();
        }
        
        // Load lessons after user is loaded
        if (user && user.id) {
          this.loadLessonsAndClasses(user.id);
        }
        
        // Calendar settings
        this.calendarTimeFormat = user?.profile?.calendarTimeFormat || '12h';
        this.calendarDefaultView = user?.profile?.calendarDefaultView || 'week';
        this.tutorTimezoneLabel = user?.profile?.timezone
          ? user.profile.timezone.replace(/_/g, ' ')
          : Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ');
        this.generateTimeSlots();
        if (this.customView !== this.calendarDefaultView) {
          this.customView = this.calendarDefaultView;
        }

        // Check Google Calendar connection status and load events if connected
        this.userService.getGoogleCalendarStatus().subscribe({
          next: (status) => {
            this.gcalConnected = status.connected;
            this.gcalEmail = status.email || null;
            this.gcalSyncEnabled = status.syncEnabled ?? true;
            this.gcalPushToGoogle = status.pushToGoogle ?? true;
            this.gcalLastSyncAt = status.lastSyncAt ? new Date(status.lastSyncAt) : null;
            if (this.gcalConnected) {
              this.startGcalPolling();
              if (!this.gcalEventsLoaded) {
                this.loadGoogleCalendarEvents();
              }
              // Auto-register webhook if not active (e.g. BACKEND_PUBLIC_URL was set after initial connect)
              if (!(status as any).watchActive) {
                this.userService.registerGoogleCalendarWatch().subscribe({
                  error: (err: any) => console.warn('[GCal] Watch registration failed:', err?.error?.error || err.message)
                });
              }
            }
            this.cdr.detectChanges();
          }
        });
      },
      error: (error) => {
        console.error('📅 Error loading current user:', error);
        // Initialize calendar anyway, even without user data
        if (!this.isInitialized) {
          this.initializeCalendarWithData();
        }
      }
    });
  }

  private loadLessons(tutorId: string, startDate?: Date, endDate?: Date) {
    
    
    const startDateStr = startDate ? startDate.toISOString() : undefined;
    const endDateStr = endDate ? endDate.toISOString() : undefined;
    
    
    
    
    
    // Fetch lessons with optional date range
    this.lessonService.getLessonsByTutor(tutorId, true, startDateStr, endDateStr).subscribe({
      next: (response) => {
        if (response.success && response.lessons) {
          this.convertLessonsToEvents(response.lessons);
          
          // Update loaded date range
          if (startDate && (!this.earliestLoadedDate || startDate < this.earliestLoadedDate)) {
            this.earliestLoadedDate = startDate;
          }
          if (endDate && (!this.latestLoadedDate || endDate > this.latestLoadedDate)) {
            this.latestLoadedDate = endDate;
          }
        }
        // Mark lessons as loaded - this will trigger checkIfBothLoaded()
        this.lessonsLoaded = true;
        
        this.checkIfBothLoaded();
      },
      error: (error) => {
        console.error('Error loading lessons:', error);
        // Mark lessons as loaded (even on error)
        this.lessonsLoaded = true;
        this.checkIfBothLoaded();
      }
    });
  }
  
  // Helper to load both lessons and classes in parallel
  private loadLessonsAndClasses(tutorId: string) {
    // Calculate initial date range: 2 weeks past, 8 weeks future
    const today = new Date();
    const startDate = this.addDays(today, -this.INITIAL_PAST_WEEKS * 7);
    const endDate = this.addDays(today, this.INITIAL_FUTURE_WEEKS * 7);
    
    
    this.loadLessons(tutorId, startDate, endDate);
    this.loadClasses(tutorId, startDate, endDate);
  }

  private loadClasses(tutorId: string, startDate?: Date, endDate?: Date) {
    
    
    const startDateStr = startDate ? startDate.toISOString() : undefined;
    const endDateStr = endDate ? endDate.toISOString() : undefined;
    
    
    
    
    
    this.classService.getClassesForTutor(tutorId, startDateStr, endDateStr).subscribe({
      next: (response) => {
        
        
        if (response.success && response.classes) {
          // Log all classes including cancelled ones
          
          response.classes.forEach((cls: any) => {
            
          });
          
          // Update loaded date range
          if (startDate && (!this.earliestLoadedDate || startDate < this.earliestLoadedDate)) {
            this.earliestLoadedDate = startDate;
          }
          if (endDate && (!this.latestLoadedDate || endDate > this.latestLoadedDate)) {
            this.latestLoadedDate = endDate;
          }
          
          // Clear and update classes map
          this.classesMap.clear();
          response.classes.forEach((cls: any) => {
            this.classesMap.set(String(cls._id), cls);
          });
          
          // Create class events
          const allClasses = response.classes;
          
          const classEvents = allClasses.map((cls: any) => {
            const isCancelled = cls.status === 'cancelled';
            return {
              id: String(cls._id),
              title: cls.name || this.translate.instant('TUTOR_CALENDAR.CLASS_FALLBACK'),
              start: new Date(cls.startTime).toISOString(),
              end: new Date(cls.endTime).toISOString(),
              backgroundColor: isCancelled ? '#9ca3af' : '#8b5cf6',
              borderColor: isCancelled ? '#6b7280' : '#6d28d9',
              textColor: isCancelled ? '#6b7280' : '#ffffff',
              classNames: [
                'calendar-class-event', 
                new Date(cls.endTime).getTime() < Date.now() ? 'is-past' : 'is-future',
                isCancelled ? 'is-cancelled' : ''
              ].filter(Boolean),
              extendedProps: {
                classId: String(cls._id),
                isClass: true,
                className: cls.name || this.translate.instant('TUTOR_CALENDAR.CLASS_FALLBACK'),
                classThumbnail: cls.thumbnail,
                type: 'class',
                classData: cls,
                isCancelled: isCancelled,
                cancelReason: cls.cancelReason,
                status: cls.status,
                createdAt: cls.createdAt // Include createdAt for overlap logic
              }
            } as EventInput;
          });
          
          
          classEvents.forEach(evt => {
            const extProps = evt.extendedProps as any;
            
          });
          
          // Filter out ALL class events (from availability AND from previous loads)
          const nonClassEvents = this.events.filter(event => {
            const extendedProps = event.extendedProps as any;
            // Remove if it's a class OR if it's an availability block of type 'class'
            return !extendedProps?.isClass && !extendedProps?.classId && extendedProps?.type !== 'class';
          });
          
          
          // Merge new class events
          this.events = [...nonClassEvents, ...classEvents];
          
          
          // Rebuild mobile views
          if (this.isMobileView) {
            this.buildMobileTimeline();
            this.buildMobileAgenda();
          }
          
          this.cdr.detectChanges();
        }
      },
      error: (error) => {
        console.error('📅 Error loading classes:', error);
      }
    });
  }
  
  // Check if we need to load more data for a given date range
  private checkAndLoadMoreData(viewStart: Date, viewEnd: Date) {
    if (!this.currentUser?.id) return;
    
    
    
    
    
    
    const needsEarlierData = !this.earliestLoadedDate || viewStart < this.earliestLoadedDate;
    const needsLaterData = !this.latestLoadedDate || viewEnd > this.latestLoadedDate;
    
    
    
    
    if (needsEarlierData) {
      // Load more past data
      const newStart = this.addDays(viewStart, -this.LOAD_WINDOW_WEEKS * 7);
      const newEnd = this.earliestLoadedDate || viewStart;
      
      
      this.loadLessons(this.currentUser.id, newStart, newEnd);
      this.loadClasses(this.currentUser.id, newStart, newEnd);
    }
    
    if (needsLaterData) {
      // Load more future data
      const newStart = this.latestLoadedDate || viewEnd;
      const newEnd = this.addDays(viewEnd, this.LOAD_WINDOW_WEEKS * 7);
      
      
      this.loadLessons(this.currentUser.id, newStart, newEnd);
      this.loadClasses(this.currentUser.id, newStart, newEnd);
    }
    
    if (!needsEarlierData && !needsLaterData) {
    }
  }

  private convertLessonsToEvents(lessons: Lesson[]): void {

    // Filter out orphaned lessons from failed payments
    const allLessons = lessons.filter(l => !(l.status === 'cancelled' && (l as any).cancelReason === 'payment_failed'));
    
    const lessonEvents = allLessons.map(lesson => {
      const student = lesson.studentId as any;
      const studentFirst = typeof student?.firstName === 'string' ? student.firstName.trim() : '';
      const studentLast = typeof student?.lastName === 'string' ? student.lastName.trim() : '';
      const studentFullName = [studentFirst, studentLast].filter(Boolean).join(' ');
      const studentName = studentFullName || student?.name || student?.displayName || student?.email || this.translate.instant('TUTOR_CALENDAR.STUDENT');
      const subject = lesson.subject || 'Language';
      const isCancelled = lesson.status === 'cancelled';
      
      // Format subject with "lesson" suffix (e.g., "Spanish lesson")
      const subjectWithType = subject.toLowerCase().includes('lesson') 
        ? subject 
        : `${subject} lesson`;
      
      // Debug logging for 12:00 PM lesson
      const debugStartTime = new Date(lesson.startTime);
      if (debugStartTime.getHours() === 12 && debugStartTime.getMinutes() === 0) {
      }
      
      // Determine color based on type and status
      let backgroundColor = '#667eea'; // Default purple
      let borderColor = '#5568d3';
      
      // Office hours get gold color regardless of status
      if (lesson.isOfficeHours) {
        backgroundColor = '#f59e0b'; // Gold for office hours
        borderColor = '#d97706';
      } else if (isCancelled) {
        backgroundColor = '#9ca3af'; // Gray for cancelled
        borderColor = '#6b7280';
      } else {
        switch (lesson.status) {
          case 'scheduled':
            backgroundColor = '#10b981'; // Green - booked lesson
            borderColor = '#059669';
            break;
          case 'in_progress':
            backgroundColor = '#10b981'; // Green - happening now
            borderColor = '#059669';
            break;
          case 'completed':
            backgroundColor = '#6b7280'; // Gray - completed
            borderColor = '#4b5563';
            break;
          case 'cancelled':
            backgroundColor = '#ef4444'; // Red - cancelled
            borderColor = '#dc2626';
            break;
          default:
            backgroundColor = '#10b981';
            borderColor = '#059669';
            break;
        }
      }
      
      const startTime = new Date(lesson.startTime);
      const endTime = new Date(lesson.endTime);
      const tz = this.userTz;
      const timeStr = `${this.formatTime12Hour(getHoursInTz(startTime, tz), getMinutesInTz(startTime, tz))} - ${this.formatTime12Hour(getHoursInTz(endTime, tz), getMinutesInTz(endTime, tz))}`;
      
      const isPast = endTime.getTime() < Date.now();
      const eventData = {
        id: lesson._id,
        title: `${studentName} - ${subjectWithType}`,
        start: lesson.startTime,
        end: lesson.endTime,
        backgroundColor: backgroundColor,
        borderColor: borderColor,
        textColor: isCancelled ? '#6b7280' : '#ffffff',
        classNames: [
          isPast ? 'is-past' : 'is-future', 
          'calendar-lesson-event',
          isCancelled ? 'is-cancelled' : ''
        ].filter(Boolean),
        extendedProps: {
          lessonId: lesson._id,
          studentName: studentName,
          studentDisplayName: studentName,
          studentAvatar: student?.picture || student?.avatar || student?.photoUrl,
          subject: subjectWithType,
          status: lesson.status,
          timeStr: timeStr,
          price: lesson.price,
          duration: lesson.duration,
          notes: lesson.notes,
          isTrialLesson: lesson.isTrialLesson || false,
          isOfficeHours: lesson.isOfficeHours || false,
          officeHoursType: lesson.officeHoursType || null,
          isCancelled: isCancelled,
          cancelReason: lesson.cancelReason
        }
      } as EventInput;
      
      // Debug logging for 12:00 PM lesson event creation
      if (debugStartTime.getHours() === 12 && debugStartTime.getMinutes() === 0) {
      }
      
      return eventData;
    });
    
    // Merge lesson events with existing events (availability/classes)
    // Remove any existing lesson events first to avoid duplicates, but keep classes and availability
    const nonLessonEvents = this.events.filter(event => {
      const extendedProps = event.extendedProps as any;
      // Keep everything except lessons (we're replacing lessons)
      return !extendedProps?.lessonId;
    });
    
    
    this.events = [...nonLessonEvents, ...lessonEvents];
    
    
    // Don't trigger change detection here - let the caller handle it
  }

  private initCalendar(): boolean {
    // CUSTOM CALENDAR: FullCalendar completely disabled
    
    return true; // Return true to prevent retry attempts
    
    /* FullCalendar initialization code (completely commented out)
    if (this.isMobileView) {
      this.isInitialized = false;
      return false;
    }
    
    this.initializationAttempts++;
    
    const calendarEl = document.getElementById('tutor-calendar-container');
    if (!calendarEl) {
      console.warn('Calendar container not found');
      return false;
    }

    // Destroy existing calendar if it exists
    if (this.calendar) {
      this.calendar.destroy();
      this.calendar = undefined;
    }

    
    try {
      // Detect if mobile
      const isMobile = window.innerWidth <= 768;
      
      // Get saved view from localStorage, or use default
      const savedView = localStorage.getItem('tutor-calendar-view');
      let initialView: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay';
      if (isMobile) {
        initialView = 'timeGridDay';
      } else {
        initialView = savedView === 'dayGridMonth'
          ? 'dayGridMonth'
          : 'timeGridWeek';
      }
      
      this.calendar = new Calendar(calendarEl, {
        plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
        initialView: initialView,
        headerToolbar: isMobile ? {
          left: 'prev,next',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay'
        } : {
          left: 'prev,next',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
      height: '100%', // Use 100% to fit container, scroller handles scrolling
      contentHeight: 'auto',
        slotMinTime: '00:00:00', // Start at midnight (12:00am) to match availability-setup
        slotMaxTime: '23:59:00', // Extended to allow very late lessons
        slotDuration: '00:30:00',
        slotLabelInterval: '01:00:00',
        scrollTime: '09:00:00',
        nowIndicator: true,
        allDaySlot: false,
        editable: true,
        selectable: true,
        selectMirror: true,
        dayMaxEvents: true,
        weekends: true,
        events: this.events,
        select: (arg) => this.handleSelect(arg),
        eventChange: (arg) => this.handleEventChange(arg),
        eventClick: (arg) => this.handleEventClick(arg),
        viewDidMount: (arg) => this.handleViewChange(arg),
        dayHeaderFormat: { weekday: 'short', day: 'numeric' },
        eventTimeFormat: {
          hour: 'numeric',
          minute: '2-digit',
          meridiem: this.is24h ? false : 'short' as any,
          hour12: !this.is24h
        },
        // Compact custom time label so it fits in small mobile cells
        eventContent: (arg) => {
          try {
            const start = arg.event.start as Date;
            const end = arg.event.end as Date;
            if (!start || !end) {
              return undefined as any;
            }
            const label = this.formatCompactRange(start, end);
            const tiny = this.formatTinyRange(start, end);
            // Default: show normal, hide tiny via inline style; CSS toggles for tiny chips
            return {
              html: `<div class=\"fc-event-custom-time\"><span class=\"normal\" style=\"display:inline\">${label}</span><span class=\"tiny\" style=\"display:none\">${tiny}</span></div>`
            } as any;
          } catch (_) {
            return undefined as any;
          }
        },
        eventDidMount: (info) => {
          // Mark very small chips so CSS can switch to the tiny label
          const el = info.el as HTMLElement;
          const h = el.offsetHeight;
          if (h && h < 22) {
            el.classList.add('fc-event--tiny');
          }
        },
        slotLabelFormat: {
          hour: 'numeric',
          minute: '2-digit',
          hour12: !this.is24h
        }
      });

      this.calendar.render();
      setTimeout(() => this.updateCustomNowIndicator());
      this.isInitialized = true;
      this.initializationAttempts = 0; // Reset counter on success
      
      // Force a re-render after a short delay to ensure it's visible
      setTimeout(() => {
        if (this.calendar) {
          this.calendar.updateSize();
          this.calendar.render();
          
          // Check calendar visibility once
          setTimeout(() => {
            this.checkCalendarVisibility();
          }, 100);
        }
      }, 100);
      
      return true;
      
    } catch (error) {
      console.error('Error initializing FullCalendar:', error);
      return false;
    }
    */
  }

  private forceReinitializeCalendar() {
    // Skip FullCalendar operations on mobile view
    if (this.isMobileView) {
      // Just reload the mobile timeline data
      this.loadAndUpdateCalendarData();
      if (this.currentUser && this.currentUser.id) {
        this.loadLessonsAndClasses(this.currentUser.id);
      }
      return;
    }
    
    // Desktop view: Using custom calendar, just reload data
    
    
    // DON'T clear events - let loaders merge data properly
    // this.events = [];  // REMOVED
    
    this.loadAndUpdateCalendarData();
    if (this.currentUser && this.currentUser.id) {
      this.loadLessonsAndClasses(this.currentUser.id);
    }
    // Trigger change detection to ensure events render
    this.cdr.detectChanges();
    
    /* FullCalendar reinitialization (commented out - using custom calendar)
    // Desktop view: Only destroy if calendar exists and is initialized
    if (this.calendar && this.isInitialized) {
      this.calendar.destroy();
      this.calendar = undefined;
      this.isInitialized = false;
    }
    
    // Clear events array
    this.events = [];
    
    // Multiple attempts to ensure calendar renders
    this.attemptCalendarInitialization(0);
    */
  }

  private attemptCalendarInitialization(attempt: number) {
    // CUSTOM CALENDAR: FullCalendar initialization attempts disabled
    
    return;
    
    /* FullCalendar initialization attempts commented out
    const maxAttempts = 5;
    const delay = Math.min(200 * Math.pow(2, attempt), 2000); // Exponential backoff, max 2s
    
    
    setTimeout(() => {
      const calendarEl = document.getElementById('tutor-calendar-container');
      
      if (!calendarEl) {
        console.warn(`Calendar container not found (attempt ${attempt + 1})`);
        if (attempt < maxAttempts - 1) {
          this.attemptCalendarInitialization(attempt + 1);
        } else {
          console.error('Failed to find calendar container after all attempts');
        }
        return;
      }
      
      // Check if container has dimensions
      const hasDimensions = calendarEl.offsetWidth > 0 && calendarEl.offsetHeight > 0;
      
      if (!hasDimensions && attempt < maxAttempts - 1) {
        console.warn(`Container has no dimensions (attempt ${attempt + 1}), retrying...`);
        this.attemptCalendarInitialization(attempt + 1);
        return;
      }
      
      // Try to initialize calendar
      this.initializeCalendarWithData();
      
    }, delay);
    */
  }

  private initializeCalendarWithData() {
    // CUSTOM CALENDAR: Skip FullCalendar initialization
    
    
    // Load data for the custom calendar
    this.loadAndUpdateCalendarData();
    
    // Load lessons if we have a user
    if (this.currentUser && this.currentUser.id) {
      this.loadLessonsAndClasses(this.currentUser.id);
    }
  }

  private loadAndUpdateCalendarData() {
    if (this.currentUser) {
      
      // Preserve user state before making API call
      const preservedUser = { ...this.currentUser };
      
      this.userService.getAvailability().subscribe({
        next: (res) => {
          
          // Restore user state if it was lost
          if (!this.currentUser) {
            this.currentUser = preservedUser;
          }
          
 
          if (!res.availability || res.availability.length === 0) {
            const gcalEvents = this.events.filter(e => (e.extendedProps as any)?.isGoogleCalendar);
            this.events = [...gcalEvents];
            this.updateCalendarEvents();
            this.availabilityLoaded = true;
            this.checkIfBothLoaded();
            return;
          }
          
  
          
          const beforeCount = this.events.length;
          
          // Filter OUT ghost class blocks before converting to events
          // Classes should come from Classes API, not availability array
          const actualAvailability = res.availability.filter(b => b.type !== 'class');
          
          // Map availability blocks to events (excluding ghost classes)
          const availabilityEvents = actualAvailability.map((b, index) => {
            return this.blockToEvent(b);
          });
          

          
          // Merge with existing events (keep lessons/classes/gcal, replace availability)
          const nonAvailabilityEvents = this.events.filter(event => {
            const extendedProps = event.extendedProps as any;
            return extendedProps?.lessonId || extendedProps?.isClass || extendedProps?.classId || extendedProps?.isGoogleCalendar;
          });
          
          
          
          this.events = [...availabilityEvents, ...nonAvailabilityEvents];
          const afterCount = this.events.length;
          
          
          
          
          
          this.updateCalendarEvents();
          this.availabilityLoaded = true;
          this.checkIfBothLoaded();

          // Load Google Calendar events only on first load (not on subsequent availability refreshes)
          if (this.gcalConnected && !this.gcalEventsLoaded) {
            this.loadGoogleCalendarEvents();
          }
        },
        error: (error) => {
          
          // Restore user state if it was lost
          if (!this.currentUser) {
            this.currentUser = preservedUser;
          }
          
          // Mark availability as loaded (even on error) to prevent infinite loading
          this.availabilityLoaded = true;
          this.checkIfBothLoaded();
        }
      });
    } else {
      this.events = [];
      this.updateCalendarEvents();
      // Mark both as loaded since we're not loading any data
      this.availabilityLoaded = true;
      this.lessonsLoaded = true;
      this.checkIfBothLoaded();
    }
  }
  
  private checkIfBothLoaded() {
    
    
    if (this.availabilityLoaded && this.lessonsLoaded) {
      
      this._lastDataFetch = Date.now();
      this.computeWeekAvailability();
      this.cdr.detectChanges();
      
      // Mark mobile data as loaded
      if (this.isMobileView) {
        this.isLoadingMobileData = false;
      }
    } else {
      
    }
  }

  private updateCalendarEvents() {
    // Handle mobile view separately - mobile doesn't use FullCalendar
    if (this.isMobileView) {
      this.buildMobileTimeline();
      this.buildMobileAgenda();
      // Don't mark as loaded here - wait for both availability and lessons to load
      return;
    }
    
    // Desktop view: Update FullCalendar - DISABLED FOR CUSTOM CALENDAR
    // CUSTOM CALENDAR: All FullCalendar code disabled
    
    return;
    
    /* FullCalendar code commented out
    if (this.calendar) {
      // Add loading class for smooth transition
      const calendarEl = document.querySelector('.fc');
      if (calendarEl) {
        calendarEl.classList.add('fc-loading');
      }
      
      // Update events
      this.calendar.removeAllEvents();
      
      // Force calendar to re-render after clearing events
      this.calendar.render();
      
      this.calendar.addEventSource(this.events);
      
      // Use proper FullCalendar API refresh
      setTimeout(() => {
        if (this.calendar) {
          this.calendar.updateSize();
          this.calendar.render();
          this.updateCustomNowIndicator();
        }
      }, 0);
      
      // Verify events were added
      setTimeout(() => {
        if (this.calendar) {
          const allEvents = this.calendar.getEvents();
          if (allEvents.length > 0) {
          } else {
            console.warn('📅 ⚠️ No events found in calendar after adding!');
          }
        }
      }, 100);
      
      // Remove loading class after a short delay
      setTimeout(() => {
        if (calendarEl) {
          calendarEl.classList.remove('fc-loading');
          calendarEl.classList.add('fc-loaded');
        }
      }, 200);
    } else {
      console.error('📅 Calendar not initialized, retrying...');
      this.initCalendar();
      setTimeout(() => {
        if (this.calendar) {
          this.updateCalendarEvents();
        }
      }, 100);
    }
    */
  }

  private updateCustomNowIndicatorBound = () => this.updateCustomNowIndicator();

  private updateCustomNowIndicator() {
    if (!this.enableCustomNowIndicator) {
      this.customNowVisible = false;
      return;
    }
    const container = document.getElementById('tutor-calendar-container');
    if (!container || !this.isInitialized) {
      this.customNowVisible = false;
      return;
    }

    // Ensure we are on a timeGrid view where vertical scale exists
    const hasTimeGrid = !!container.querySelector('.fc-timegrid-body');
    if (!hasTimeGrid) {
      this.customNowVisible = false;
      return;
    }

    const body = container.querySelector('.fc-timegrid-body') as HTMLElement | null;
    const axis = container.querySelector('.fc-timegrid-axis-chunk, .fc-timegrid-axis') as HTMLElement | null;
    const cols = container.querySelector('.fc-timegrid-cols') as HTMLElement | null;
    if (!body || !cols) {
      this.customNowVisible = false;
      return;
    }

    const bodyRect = body.getBoundingClientRect();
    const colsRect = cols.getBoundingClientRect();
    const axisWidth = axis ? axis.getBoundingClientRect().width : 42;

    const tz = this.currentUser?.profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const nowFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    const nowParts = nowFormatter.formatToParts(new Date());
    const nowHour = parseInt(nowParts.find(p => p.type === 'hour')?.value || '0', 10);
    const nowMin = parseInt(nowParts.find(p => p.type === 'minute')?.value || '0', 10);
    const minutes = nowHour * 60 + nowMin;
    const totalMinutes = 24 * 60;
    const height = body.clientHeight || bodyRect.height;
    this.customNowTop = Math.max(0, Math.min(height - 1, Math.round((minutes / totalMinutes) * height)));
    this.customNowLeft = Math.round(axisWidth);
    this.customNowWidth = Math.max(0, Math.round(colsRect.width));
    this.customNowVisible = true;
  }


  private reinitializeCalendar() {
    // CUSTOM CALENDAR: FullCalendar reinitialization disabled
    
    return;
    
    /* FullCalendar reinitialize code commented out
    // Skip FullCalendar reinitialization on mobile view
    if (this.isMobileView) {
      // Just reload the mobile timeline data
      this.loadAndUpdateCalendarData();
      if (this.currentUser && this.currentUser.id) {
        this.loadLessonsAndClasses(this.currentUser.id);
      }
      return;
    }
    
    // Desktop view: Force destroy existing calendar
    if (this.calendar) {
      this.calendar.destroy();
      this.calendar = undefined;
      this.isInitialized = false;
    }
    
    // First load the data, then initialize calendar
    if (this.currentUser) {
      this.userService.getAvailability().subscribe({
        next: (res) => {
          this.events = (res.availability || []).map(b => {
            const event = this.blockToEvent(b);
            return event;
          });
          
                  // Now initialize calendar with the loaded events
                  setTimeout(() => {
                    this.initCalendar();
                    // Force refresh after initialization
                    setTimeout(() => {
                      if (this.calendar) {
                        this.calendar.updateSize();
                        this.calendar.render();
                      }
                    }, 0);
                  }, 100);
        },
        error: (error) => {
          console.error('📅 Error loading availability:', error);
          // Initialize calendar anyway
          setTimeout(() => {
            this.initCalendar();
          }, 100);
        }
      });
    } else {
      // Initialize calendar without events
      setTimeout(() => {
        this.initCalendar();
      }, 100);
    }
    */
  }

  // FullCalendar handlers
  handleSelect(selectInfo: any) {
    const title = prompt('Enter availability title:') || this.translate.instant('TUTOR_CALENDAR.AVAILABLE_FALLBACK');
    if (title) {
      const event: EventInput = {
        id: Date.now().toString(),
        title: title,
        start: selectInfo.startStr,
        end: selectInfo.endStr,
        backgroundColor: '#007bff',
        borderColor: '#007bff'
      };

      this.calendar?.addEvent(event);
      this.persistEvent(event);
    }
  }

  handleEventChange(changeInfo: any) {
    const event = changeInfo.event;
    const updatedEvent: EventInput = {
      id: event.id,
      title: event.title,
      start: event.startStr,
      end: event.endStr,
      backgroundColor: event.backgroundColor,
      borderColor: event.borderColor
    };

    this.persistEvent(updatedEvent);
  }

  async handleEventClick(clickInfoOrEvent: any, domEvent?: any) {
    // Handle both FullCalendar format (clickInfo.event) and custom calendar format (direct event)
    const event = clickInfoOrEvent.event || clickInfoOrEvent;
    const extendedProps = event.extendedProps || {};
    
    // Google Calendar event — lightweight detail card
    if (extendedProps?.isGoogleCalendar) {
      const start = event.start ? new Date(event.start) : new Date();
      const end = event.end ? new Date(event.end) : new Date();
      const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

      const eventDetails = {
        title: extendedProps.summary || event.title || 'Google Calendar Event',
        start,
        end,
        durationMinutes,
        isGoogleCalendar: true,
        color: '#6b7280'
      };

      const clickEvt = domEvent || (clickInfoOrEvent.jsEvent) || { target: null };
      await this.openEventDetailsModal(eventDetails, clickEvt);
      return;
    }

    // Check if this is a lesson event (has lessonId) or an availability block
    if (extendedProps?.lessonId || extendedProps?.classId) {
      // Convert to TimelineEntry format for the modal
      const start = event.start ? new Date(event.start) : new Date();
      const end = event.end ? new Date(event.end) : new Date();
      const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
      
      // Look up class data from classesMap if this is a class
      let attendees: any[] | undefined = extendedProps.attendees;
      let capacity: number | undefined = extendedProps.capacity;
      let thumbnail: string | undefined = extendedProps.thumbnail;
      let isCancelled = extendedProps.isCancelled || false;
      
      if (extendedProps.isClass && extendedProps.classId) {
        const classId = String(extendedProps.classId);
        const classData = this.classesMap.get(classId);
        if (classData) {
          attendees = classData.attendees || classData.confirmedStudents || [];
          capacity = classData.capacity || 1;
          thumbnail = classData.thumbnail;
          isCancelled = classData.status === 'cancelled';
        }
      }
      
      const eventDetails = {
        id: extendedProps.lessonId || extendedProps.classId,
        lessonId: extendedProps.lessonId,
        classId: extendedProps.classId,
        title: event.title || extendedProps.subject || 'Event',
        subtitle: extendedProps.studentName || extendedProps.subject,
        start,
        end,
        durationMinutes,
        location: extendedProps.location || extendedProps.platform,
        avatarUrl: extendedProps.studentAvatar,
        isTrialLesson: extendedProps.isTrialLesson || false,
        isClass: extendedProps.isClass || false,
        isOfficeHours: extendedProps.isOfficeHours || false,
        isCancelled: isCancelled,
        isLesson: Boolean(extendedProps.lessonId),
        studentName: extendedProps.studentName,
        studentDisplayName: extendedProps.studentDisplayName || extendedProps.studentName,
        subject: extendedProps.subject,
        color: this.getEventColor(event),
        attendees: attendees,
        capacity: capacity,
        thumbnail: thumbnail
      };
      
      // Get the DOM event for positioning
      const clickEvent = domEvent || (clickInfoOrEvent.jsEvent) || { target: null };
      await this.openEventDetailsModal(eventDetails, clickEvent);
    } else {
      // This is an availability block - keep existing delete behavior
      if (confirm('Delete this availability block?')) {
        event.remove();
        this.deleteEvent(event.id);
      }
    }
  }
  
  private getEventColor(event: any): string {
    const extended = event.extendedProps || {};
    if (extended.isOfficeHours) return '#f59e0b';
    if (extended.isClass) return '#8b5cf6';
    if (extended.lessonId) return '#10b981';
    return '#007bff';
  }
  
  async openEventDetailsModal(eventDetails: any, clickEvent?: any) {
    const isMobile = this.isMobileView;
    const modal = await this.modalController.create({
      component: EventDetailsModalComponent,
      componentProps: {
        event: eventDetails,
        clickEvent: isMobile ? undefined : clickEvent,
        bottomSheet: isMobile
      },
      cssClass: 'event-details-modal',
      showBackdrop: false,
      animated: !isMobile
    });
    
    await modal.present();
    
    // Handle modal dismiss - refresh calendar if lesson was cancelled
    const { data } = await modal.onDidDismiss();
    if (data?.cancelled && data?.lessonId) {
      
      this.refreshCalendar();
    }
  }

  handleViewChange(viewInfo: any) {
    // Save the current view whenever it changes
    if (viewInfo && viewInfo.view) {
      const currentView = viewInfo.view.type;
      localStorage.setItem('tutor-calendar-view', currentView);
      this.updateCustomNowIndicator();
    }
  }

  private persistEvent(event: EventInput) {
    const block = this.eventToBlock(event);
    const allBlocks = this.events.map(e => this.eventToBlock(e));
    
    // Update or add the block
    const existingIndex = allBlocks.findIndex(b => b.id === block.id);
    if (existingIndex >= 0) {
      allBlocks[existingIndex] = block;
    } else {
      allBlocks.push(block);
    }

    this.userService.updateAvailability(allBlocks).subscribe({
      next: (response) => {
      },
      error: (error) => {
        console.error('📅 Error updating availability:', error);
      }
    });
  }

  private deleteEvent(eventId: string) {
    const allBlocks = this.events
      .filter(e => e.id !== eventId)
      .map(e => this.eventToBlock(e));

    this.userService.updateAvailability(allBlocks).subscribe({
      next: (response) => {
      },
      error: (error) => {
        console.error('📅 Error updating availability after delete:', error);
      }
    });
  }

  // Mapping helpers
  private blockToEvent(b: any): EventInput {
    // Process availability block
    
    // Prefer absolute one-off dates when provided (e.g., classes)
    let start: Date;
    let end: Date;
    if (b.absoluteStart && b.absoluteEnd) {
      start = new Date(b.absoluteStart);
      end = new Date(b.absoluteEnd);
    } else {
      // Weekly availability: map to the DISPLAYED week, not the current week
      // Use currentWeekStart to ensure availability shows on the correct week
      const weekStart = this.currentWeekStart || new Date();
      
      // Calculate the target day in the displayed week
      const dayDate = new Date(weekStart);
      dayDate.setDate(weekStart.getDate() + b.day);
      
      start = this.withTime(dayDate, b.startTime);
      end = this.withTime(dayDate, b.endTime);
      
    }
    
    const isClass = b.type === 'class';
    const isAvailability = b.type === 'available';
    const baseColor = isClass
      ? (b.color || '#8b5cf6')
      : (isAvailability ? (b.color || '#0d9488') : (b.color || '#007bff'));
    const borderCol = isClass ? '#6d28d9' : baseColor;

    const isPast = new Date(end).getTime() < Date.now();
    const event: EventInput = {
      id: b.id || `${Date.now()}-${Math.random()}`,
      title: isClass ? (b.title || this.translate.instant('TUTOR_CALENDAR.CLASS_FALLBACK')) : '',
      start: start.toISOString(),
      end: end.toISOString(),
      backgroundColor: baseColor,
      borderColor: borderCol,
      textColor: '#ffffff',
      classNames: [
        isClass ? 'calendar-class-event' : (isAvailability ? 'calendar-availability-event' : 'calendar-other-event'),
        isPast ? 'is-past' : 'is-future'
      ],
      extendedProps: {
        ...(b.extendedProps || {}),
        ...(isClass ? {
          classId: b.id, // b.id contains the class _id
          isClass: true,
          className: b.title || b.className || this.translate.instant('TUTOR_CALENDAR.CLASS_FALLBACK'),
          classThumbnail: b.thumbnail,
          // Store original class data for access
          classData: b
        } : {}),
        type: b.type // Preserve the type
      }
    };
    
    return event;
  }

  private eventToBlock(e: EventInput): any {
    const startDate = new Date(e.start as string);
    const endDate = new Date(e.end as string);
    const day = startDate.getDay();
    
    return {
      id: e.id || `${Date.now()}-${Math.random()}`,
      day,
      startTime: this.timeString(startDate),
      endTime: this.timeString(endDate),
      type: 'available',
      title: e.title || '',
      color: e.backgroundColor || '#007bff'
    };
  }

  private startOfWeek(d: Date): Date {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private withTime(dayDate: Date, hhmm: string): Date {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(dayDate);
    d.setHours(h, m, 0, 0);
    return d;
  }

  goBack() {
    this.showMobileSettings = false;
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      this.router.navigate(['/tabs']);
    }
  }

  // Sidebar button handlers
  onScheduleLesson() {
    if (!this.stripeConnectOnboarded) {
      this.showStripeOnboardingAlert();
      return;
    }
    this.router.navigate(['/tabs/tutor-calendar/schedule-class']);
  }

  async onAddTimeOff(date?: Date, timeSlot?: TimelineEntry) {
    // Set modal data and open inline modal (no programmatic creation = no freeze)
    this.blockTimeModalData = {
      date: date || new Date(),
      startTime: timeSlot?.start,
      endTime: timeSlot?.end,
      durationMinutes: timeSlot?.durationMinutes
    };
    
    this.isBlockTimeModalOpen = true;
  }
  
  // Handle block time modal dismissal
  onBlockTimeModalDismiss(event: any) {
    
    this.isBlockTimeModalOpen = false;
    
    const data = event.detail?.data;
    if (data?.success) {
      // Refresh calendar to show the new time-off block
      this.refreshCalendar();
    }
  }

  onAddExtraSlots() {
    // TODO: Implement extra slots modal
  }

  async onFreeSlotClick(date: Date, timeSlot?: TimelineEntry) {
    // Check current office hours status to show correct button text
    const officeHoursEnabled = this.userService.getOfficeHoursStatus();
    
    // Show action sheet for managing this open time slot
    const actionSheet = await this.actionSheetController.create({
      header: this.translate.instant('TUTOR_CALENDAR.MANAGE_TIME_SLOT'),
      cssClass: 'availability-action-sheet',
      buttons: [
        {
          text: this.translate.instant('TUTOR_CALENDAR.SET_REGULAR_AVAILABILITY'),
          icon: 'time-outline',
          handler: async () => {
            setTimeout(() => {
              this.onSetUpAvailability(date, timeSlot);
            }, 100);
            return true;
          }
        },
        {
          text: officeHoursEnabled ? this.translate.instant('TUTOR_CALENDAR.DISABLE_OFFICE_HOURS') : this.translate.instant('TUTOR_CALENDAR.ENABLE_OFFICE_HOURS'),
          icon: 'flash-outline',
          handler: async () => {
            setTimeout(() => {
              this.onEnableOfficeHours();
            }, 100);
            return true;
          }
        },
        {
          text: this.translate.instant('TUTOR_CALENDAR.BLOCK_THIS_TIME'),
          icon: 'ban-outline',
          handler: async () => {
            setTimeout(() => {
              this.onAddTimeOff(date, timeSlot);
            }, 100);
            return true;
          }
        },
        {
          text: this.translate.instant('TUTOR_CALENDAR.CANCEL'),
          role: 'cancel',
          icon: 'close-outline'
        }
      ]
    });

    await actionSheet.present();
  }

  async onEnableOfficeHours() {
    const currentStatus = this.userService.getOfficeHoursStatus();
    
    
    // Check for schedule conflicts before enabling
    if (!currentStatus) {
      const conflict = this.checkOfficeHoursConflicts();
      
      if (conflict.hasConflict) {
        // Show error alert
        const alert = await this.alertController.create({
          header: this.translate.instant('TUTOR_CALENDAR.SCHEDULE_CONFLICT'),
          message: conflict.message,
          buttons: [this.translate.instant('TUTOR_CALENDAR.OK')]
        });
        await alert.present();
        return; // Stop here
      }
    }
    
    if (currentStatus) {
      // If currently enabled, just show simple confirmation to disable
      const alert = await this.alertController.create({
        header: this.translate.instant('TUTOR_CALENDAR.DISABLE_OFFICE_HOURS_CONFIRM'),
        message: this.translate.instant('TUTOR_CALENDAR.DISABLE_OFFICE_HOURS_MSG'),
        buttons: [
          {
            text: this.translate.instant('TUTOR_CALENDAR.CANCEL'),
            role: 'cancel',
            handler: () => {
              
            }
          },
          {
            text: this.translate.instant('TUTOR_CALENDAR.DISABLE'),
            handler: async () => {
              
              try {
                await this.userService.toggleOfficeHours(false).toPromise();
                this.isOfficeHoursEnabled = false;
                
                
                const toast = await this.toastController.create({
                  message: this.translate.instant('TUTOR_CALENDAR.TOAST_OFFICE_HOURS_DISABLED'),
                  duration: 3000,
                  color: 'success',
                  icon: 'checkmark-circle'
                });
                toast.present();
              } catch (error) {
                console.error('❌ Error disabling office hours:', error);
                const toast = await this.toastController.create({
                  message: this.translate.instant('TUTOR_CALENDAR.TOAST_OFFICE_HOURS_UPDATE_FAILED'),
                  duration: 3000,
                  color: 'danger'
                });
                toast.present();
              }
            }
          }
        ]
      });
      await alert.present();
    } else {
      // Show warning modal before enabling
      const alert = await this.alertController.create({
        header: this.translate.instant('TUTOR_CALENDAR.ENABLE_OFFICE_HOURS_HEADER'),
        message: this.translate.instant('TUTOR_CALENDAR.OFFICE_HOURS_WARNING'),
        cssClass: 'office-hours-warning-alert',
        buttons: [
          {
            text: this.translate.instant('TUTOR_CALENDAR.CANCEL'),
            role: 'cancel',
            handler: () => {
              
            }
          },
          {
            text: this.translate.instant('TUTOR_CALENDAR.ENABLE_GO_WAITING_ROOM'),
            handler: async () => {
              
              try {
                await this.userService.toggleOfficeHours(true).toPromise();
                this.isOfficeHoursEnabled = true;
                
                
                const toast = await this.toastController.create({
                  message: this.translate.instant('TUTOR_CALENDAR.TOAST_OFFICE_HOURS_ENABLED'),
                  duration: 2000,
                  color: 'success',
                  icon: 'flash'
                });
                await toast.present();
                
                // Navigate to pre-call page after short delay
                // For office hours, we navigate without a specific lessonId
                // The pre-call page will handle office hours mode differently
                setTimeout(() => {
                  // SECURITY: role is determined from lesson data + auth, not passed in URL
                  this.router.navigate(['/pre-call'], {
                    queryParams: {
                      officeHours: 'true'
                    }
                  });
                }, 2000);
              } catch (error) {
                console.error('❌ Error enabling office hours:', error);
                const toast = await this.toastController.create({
                  message: this.translate.instant('TUTOR_CALENDAR.TOAST_ENABLE_OFFICE_HOURS_FAILED'),
                  duration: 3000,
                  color: 'danger'
                });
                toast.present();
              }
            }
          }
        ]
      });
      await alert.present();
    }
  }

  /**
   * Check if tutor has any schedule conflicts that would prevent office hours
   */
  private checkOfficeHoursConflicts(): { hasConflict: boolean; message?: string; nextEvent?: TimelineEntry } {
    const now = new Date();
    const BUFFER_MINUTES = 5; // Minimum time before next event
    const bufferTime = new Date(now.getTime() + BUFFER_MINUTES * 60 * 1000);

    

    // Check all timeline events for conflicts
    for (const event of this.mobileTimelineEvents) {
      if (!event.start || !event.end) continue;
      
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);

      // Check if currently in an event
      if (now >= eventStart && now <= eventEnd) {
        
        const eventType = event.isClass ? 'class' : 'lesson';
        return {
          hasConflict: true,
          message: this.translate.instant('TUTOR_CALENDAR.CONFLICT_IN_EVENT', { type: eventType }),
          nextEvent: event
        };
      }

      // Check if event starts within buffer period
      if (eventStart > now && eventStart <= bufferTime) {
        const minutesUntil = Math.round((eventStart.getTime() - now.getTime()) / (60 * 1000));
        
        const eventType = event.isClass ? 'class' : 'lesson';
        return {
          hasConflict: true,
          message: this.translate.instant('TUTOR_CALENDAR.CONFLICT_STARTING_SOON', { type: eventType, minutes: minutesUntil }),
          nextEvent: event
        };
      }
    }

    
    return { hasConflict: false };
  }

  async onSetUpAvailability(date?: Date, timeSlot?: TimelineEntry) {
    if (this.isOnboardingIncomplete) {
      const alert = await this.alertController.create({
        header: this.translate.instant('TUTOR_CALENDAR.COMPLETE_PROFILE_SETUP'),
        message: this.translate.instant('TUTOR_CALENDAR.COMPLETE_PROFILE_BEFORE_AVAILABILITY'),
        buttons: [
          { text: this.translate.instant('TUTOR_CALENDAR.CANCEL'), role: 'cancel' },
          { text: this.translate.instant('TUTOR_CALENDAR.CONTINUE_SETUP'), handler: () => this.router.navigate(['/tutor-approval']) }
        ]
      });
      await alert.present();
      return;
    }
    
    if (date) {
      // Format date as YYYY-MM-DD using local timezone to avoid UTC conversion issues
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const dayOfMonth = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${dayOfMonth}`;
      
      // Build query params to pre-populate the form
      const queryParams: any = {};
      
      if (timeSlot) {
        // Add time slot information as query params
        if (timeSlot.start) {
          const startTime = timeSlot.start;
          queryParams.startHour = getHoursInTz(startTime, this.userTz);
          queryParams.startMinute = getMinutesInTz(startTime, this.userTz);
        }
        if (timeSlot.end) {
          const endTime = timeSlot.end;
          queryParams.endHour = getHoursInTz(endTime, this.userTz);
          queryParams.endMinute = getMinutesInTz(endTime, this.userTz);
        }
        if (timeSlot.durationMinutes) {
          queryParams.duration = timeSlot.durationMinutes;
        }
      }
      
      this.navCtrl.navigateForward(['/tabs/availability-setup', dateStr], {
        queryParams,
        animated: true,
        animationDirection: 'forward'
      });
    } else {
      this.navCtrl.navigateForward('/tabs/availability-setup', {
        animated: true,
        animationDirection: 'forward'
      });
    }
  }

  // Calendar settings
  calendarTimeFormat: '12h' | '24h' = '12h';
  calendarDefaultView: 'week' | 'day' = 'week';
  get shortDateTimeFormat(): string { return this.calendarTimeFormat === '24h' ? 'M/d/yy, HH:mm' : 'M/d/yy, h:mm a'; }
  tutorTimezoneLabel = '';
  calendarSettingsExpanded = false;
  gcalSettingsExpanded = false;

  // Google Calendar
  gcalConnected = false;
  gcalSyncing = false;
  gcalEmail: string | null = null;
  gcalSyncEnabled = true;
  gcalPushToGoogle = true;
  gcalLastSyncAt: Date | null = null;
  private gcalEventsLoaded = false;
  private gcalLoadingInProgress = false;
  private gcalPollInterval: any = null;
  private gcalLastFetchTime = 0;
  private static readonly GCAL_POLL_MS = 2 * 60 * 1000;
  private static readonly GCAL_DEBOUNCE_MS = 10 * 1000;

  connectGoogleCalendar() {
    this.userService.getGoogleCalendarAuthUrl().subscribe({
      error: async (err) => {
        console.error('❌ Failed to get Google Calendar auth URL:', err);
        const toast = await this.toastController.create({
          message: 'Could not connect to Google Calendar. Please try again.',
          duration: 3000,
          color: 'danger'
        });
        await toast.present();
      },
      next: async (res) => {
        if (!res?.url) {
          console.error('❌ No auth URL returned from server');
          const toast = await this.toastController.create({
            message: 'Could not get Google sign-in URL. Please try again.',
            duration: 3000,
            color: 'danger'
          });
          await toast.present();
          return;
        }

        let handled = false;
        let nativePollTimer: any = null;
        let pollTimer: any = null;

        const onLinked = async (success: boolean) => {
          if (handled) return;
          handled = true;
          window.removeEventListener('message', messageHandler);
          if (pollTimer) clearInterval(pollTimer);
          if (nativePollTimer) clearInterval(nativePollTimer);

          if (Capacitor.isNativePlatform()) {
            Browser.close().catch(() => {});
            Browser.removeAllListeners().catch(() => {});
          }

          if (success) {
            Haptics.notification({ type: NotificationType.Success }).catch(() => {});
            const toast = await this.toastController.create({
              message: 'Google Calendar connected!',
              duration: 2500,
              position: 'bottom',
              color: 'success'
            });
            await toast.present();
            this.userService.getGoogleCalendarStatus().subscribe({
              next: (status) => {
                this.gcalConnected = status.connected;
                this.gcalEmail = status.email || null;
                this.gcalSyncEnabled = status.syncEnabled ?? true;
                this.gcalPushToGoogle = status.pushToGoogle ?? true;
                this.gcalLastSyncAt = status.lastSyncAt ? new Date(status.lastSyncAt) : null;
                this.loadGoogleCalendarEvents();
                this.startGcalPolling();
                this.cdr.detectChanges();
              }
            });
          }
        };

        const messageHandler = (event: MessageEvent) => {
          if (event.data?.type === 'google_calendar_linked') {
            onLinked(event.data.success);
          }
        };
        window.addEventListener('message', messageHandler);

        if (Capacitor.isNativePlatform()) {
          Browser.addListener('browserFinished', () => {
            if (!handled) {
              this.userService.getGoogleCalendarStatus().subscribe({
                next: (status) => {
                  if (status.connected && !handled) {
                    onLinked(true);
                  } else if (!handled) {
                    handled = true;
                    window.removeEventListener('message', messageHandler);
                  }
                }
              });
            }
          });
          try {
            await Browser.open({ url: res.url });
          } catch (browserErr) {
            console.error('❌ Browser.open failed:', browserErr);
            window.open(res.url, '_system');
          }

          // Poll connection status while browser is open so we can auto-close it
          nativePollTimer = setInterval(() => {
            if (handled) { clearInterval(nativePollTimer); return; }
            this.userService.getGoogleCalendarStatus().subscribe({
              next: (status) => {
                if (status.connected && !handled) {
                  onLinked(true);
                }
              }
            });
          }, 1500);
        } else {
          // Web: open popup window
          const popup = window.open(res.url, 'google-calendar-auth', 'width=500,height=700,left=200,top=100');
          pollTimer = setInterval(() => {
            if (!popup || popup.closed) {
              clearInterval(pollTimer);
              if (!handled) {
                this.userService.getGoogleCalendarStatus().subscribe({
                  next: (status) => {
                    if (status.connected && !handled) {
                      onLinked(true);
                    } else if (!handled) {
                      handled = true;
                      window.removeEventListener('message', messageHandler);
                    }
                  }
                });
              }
            }
          }, 500);
        }

      }
    });
  }

  disconnectGoogleCalendar() {
    this.userService.disconnectGoogleCalendar().subscribe({
      next: async () => {
        this.gcalConnected = false;
        this.gcalEmail = null;
        this.gcalSyncEnabled = true;
        this.gcalPushToGoogle = true;
        this.gcalLastSyncAt = null;
        this.stopGcalPolling();
        this.gcalEventsLoaded = false;
        this.events = this.events.filter(e => !(e.extendedProps as any)?.isGoogleCalendar);
        this.updateCalendarEvents();
        this.cdr.detectChanges();

        Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
        const toast = await this.toastController.create({
          message: 'Google Calendar disconnected.',
          duration: 2500,
          position: 'bottom',
          color: 'medium'
        });
        await toast.present();
      }
    });
  }

  async showGcalActions() {
    const sheet = await this.actionSheetController.create({
      header: `Google Calendar${this.gcalEmail ? ' · ' + this.gcalEmail : ''}`,
      buttons: [
        {
          text: this.gcalSyncEnabled ? 'Disable sync' : 'Enable sync',
          icon: this.gcalSyncEnabled ? 'pause-circle-outline' : 'play-circle-outline',
          handler: () => {
            this.gcalSyncEnabled = !this.gcalSyncEnabled;
            this.onGcalSettingChange('syncEnabled');
          }
        },
        {
          text: this.gcalPushToGoogle ? 'Stop pushing lessons' : 'Push lessons to Google',
          icon: this.gcalPushToGoogle ? 'arrow-undo-outline' : 'arrow-redo-outline',
          handler: () => {
            this.gcalPushToGoogle = !this.gcalPushToGoogle;
            this.onGcalSettingChange('pushToGoogle');
          }
        },
        {
          text: 'Disconnect',
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => {
            this.disconnectGoogleCalendar();
          }
        },
        {
          text: 'Cancel',
          icon: 'close-outline',
          role: 'cancel'
        }
      ]
    });
    await sheet.present();
  }

  onGcalSettingChange(key: 'syncEnabled' | 'pushToGoogle') {
    const payload: any = {};
    if (key === 'syncEnabled') payload.syncEnabled = this.gcalSyncEnabled;
    if (key === 'pushToGoogle') payload.pushToGoogle = this.gcalPushToGoogle;
    this.userService.updateGoogleCalendarSettings(payload).subscribe();
  }

  updateCalendarSetting(type: 'timeFormat' | 'defaultView', value: string) {
    if (type === 'timeFormat') {
      this.calendarTimeFormat = value as '12h' | '24h';
      this.generateTimeSlots();
    } else if (type === 'defaultView') {
      this.calendarDefaultView = value as 'week' | 'day';
      this.switchView(value as 'week' | 'day');
    }
    this.cdr.detectChanges();

    const profileUpdate: any = {};
    if (type === 'timeFormat') profileUpdate.calendarTimeFormat = value;
    if (type === 'defaultView') profileUpdate.calendarDefaultView = value;
    this.userService.updateProfile(profileUpdate).subscribe();
  }

  toggleCalendarSettings(event?: Event) {
    this.calendarSettingsExpanded = !this.calendarSettingsExpanded;
    if (this.calendarSettingsExpanded && event) {
      this.scrollSectionIntoView(event);
    }
  }

  toggleGcalSettings(event?: Event) {
    this.gcalSettingsExpanded = !this.gcalSettingsExpanded;
    if (this.gcalSettingsExpanded && event) {
      this.scrollSectionIntoView(event);
    }
  }

  private scrollSectionIntoView(event: Event) {
    const target = (event.currentTarget as HTMLElement)?.closest('.calendar-settings-section, .gcal-settings-section, .panel-section');
    if (target) {
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 350);
    }
  }

  syncGoogleCalendar() {
    if (!this.gcalConnected || this.gcalSyncing) return;
    this.gcalSyncing = true;
    this.cdr.detectChanges();
    this.loadGoogleCalendarEvents();
  }

  private mergeGcalWebSocketEvents(rawEvents: any[]) {
    const nonGcalEvents = this.events.filter(e => !(e.extendedProps as any)?.isGoogleCalendar);

    const gcalEvents: EventInput[] = rawEvents
      .filter((evt: any) => !evt.allDay)
      .map((evt: any) => ({
        id: `gcal-${evt.id}`,
        title: evt.summary || 'Busy',
        start: new Date(evt.start).toISOString(),
        end: new Date(evt.end).toISOString(),
        backgroundColor: '#6b7280',
        borderColor: '#4b5563',
        textColor: '#ffffff',
        classNames: ['calendar-gcal-event'],
        extendedProps: {
          isGoogleCalendar: true,
          summary: evt.summary || 'Busy',
          type: 'google-calendar'
        }
      }));

    this.events = [...nonGcalEvents, ...gcalEvents];
    this.updateCalendarEvents();
    this.cdr.detectChanges();
  }

  private startGcalPolling() {
    this.stopGcalPolling();
    this.gcalPollInterval = setInterval(() => {
      if (this.gcalConnected) {
        this.loadGoogleCalendarEvents();
      }
    }, TutorCalendarPage.GCAL_POLL_MS);
  }

  private stopGcalPolling() {
    if (this.gcalPollInterval) {
      clearInterval(this.gcalPollInterval);
      this.gcalPollInterval = null;
    }
  }

  private onAppResume() {
    this.websocketService.ensureConnected();
    if (this.gcalConnected) {
      const elapsed = Date.now() - this.gcalLastFetchTime;
      if (elapsed > TutorCalendarPage.GCAL_DEBOUNCE_MS) {
        this.gcalLoadingInProgress = false;
        this.loadGoogleCalendarEvents();
      }
    }
  }

  private loadGoogleCalendarEvents() {
    if (!this.gcalConnected || this.gcalLoadingInProgress) return;
    this.gcalLoadingInProgress = true;
    this.gcalLastFetchTime = Date.now();

    const weekStart = new Date(this.currentWeekStart);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // Safety: reset loading flag after 15s if the request hangs (prevents stuck state)
    const safetyTimer = setTimeout(() => {
      if (this.gcalLoadingInProgress) {
        this.gcalLoadingInProgress = false;
      }
    }, 15000);

    this.userService.getGoogleCalendarEvents(weekStart.toISOString(), weekEnd.toISOString()).subscribe({
      next: (res) => {
        clearTimeout(safetyTimer);
        const nonGcalEvents = this.events.filter(e => !(e.extendedProps as any)?.isGoogleCalendar);

        const gcalEvents: EventInput[] = (res.events || [])
          .filter((evt: any) => !evt.allDay)
          .map((evt: any) => ({
            id: `gcal-${evt.id}`,
            title: evt.summary || 'Busy',
            start: new Date(evt.start).toISOString(),
            end: new Date(evt.end).toISOString(),
            backgroundColor: '#6b7280',
            borderColor: '#4b5563',
            textColor: '#ffffff',
            classNames: ['calendar-gcal-event'],
            extendedProps: {
              isGoogleCalendar: true,
              summary: evt.summary || 'Busy',
              type: 'google-calendar'
            }
          }));

        this.events = [...nonGcalEvents, ...gcalEvents];
        this.gcalEventsLoaded = true;
        this.gcalSyncing = false;
        this.gcalLoadingInProgress = false;
        this.updateCalendarEvents();
        this.cdr.detectChanges();
      },
      error: () => {
        clearTimeout(safetyTimer);
        this.gcalEventsLoaded = true;
        this.gcalSyncing = false;
        this.gcalLoadingInProgress = false;
        this.cdr.detectChanges();
      }
    });
  }

  // Method to refresh calendar when returning from availability setup
  refreshCalendar() {
    
    if (this.calendar && this.isInitialized) {
      // Don't clear events - just reload data and merge
      if (this.currentUser && this.currentUser.id) {
        this.loadLessonsAndClasses(this.currentUser.id);
      }
      this.loadAndUpdateCalendarData();
    } else {
      this.forceReinitializeCalendar();
    }
  }

  // Force refresh availability data after saving from availability setup
  private forceRefreshAvailability() {
    
    
    if (!this.currentUser) {
      console.warn('📅 No current user for availability refresh');
      return;
    }

    // DON'T clear all events - only update availability, preserve lessons/classes
    // this.events = [];  // REMOVED
    
    // Force reload availability data
    this.userService.getAvailability().subscribe({
      next: (res) => {
        
        
        // Remove old availability events, keep lessons, classes, and gcal
        const nonAvailabilityEvents = this.events.filter(event => {
          const extendedProps = event.extendedProps as any;
          return extendedProps?.lessonId || extendedProps?.isClass || extendedProps?.classId || extendedProps?.isGoogleCalendar;
        });
        
        if (res.availability && res.availability.length > 0) {
          const availEvents = res.availability.map(b => this.blockToEvent(b));
          this.events = [...availEvents, ...nonAvailabilityEvents];
        } else {
          this.events = nonAvailabilityEvents;
        }
        
        this.computeWeekAvailability();

        if (this.isMobileView) {
          this.buildMobileTimeline();
          this.buildMobileAgenda();
        } else if (this.calendar && this.isInitialized) {
          this.updateCalendarEvents();
        } else {
          this.forceReinitializeCalendar();
        }

        // Fire pop animation after data is rendered
        if (this._pendingAvailPop) {
          this._pendingAvailPop = false;
          this.cdr.detectChanges();
          setTimeout(() => {
            this.availabilityJustSaved = true;
            this.cdr.detectChanges();
            setTimeout(() => { this.availabilityJustSaved = false; this.cdr.detectChanges(); }, 1500);
          }, 100);
        }
        
        if (this.currentUser?.id) {
          this.loadLessonsAndClasses(this.currentUser.id);
        }
      },
      error: (error) => {
        console.error('❌ Error force refreshing availability:', error);
        this.forceReinitializeCalendar();
      }
    });
  }

  private refreshCalendarData() {
    
    // Handle mobile view refresh
    if (this.isMobileView) {
      // Don't set loading state during refresh to avoid flash
      // Data will update smoothly in the background
      this.loadAndUpdateCalendarData();
      // Reload lessons if we have a user
      if (this.currentUser && this.currentUser.id) {
        this.loadLessonsAndClasses(this.currentUser.id);
      }
      return;
    }
    
    // Handle desktop view refresh
    if (this.calendar && this.isInitialized) {
      this.loadAndUpdateCalendarData();
      // Reload lessons if we have a user
      if (this.currentUser && this.currentUser.id) {
        this.loadLessonsAndClasses(this.currentUser.id);
      }
    } else {
      this.forceReinitializeCalendar();
    }
  }

  onHelpClick() {
    // TODO: Implement help modal or documentation
  }

  private timeString(d: Date): string {
    const h = getHoursInTz(d, this.userTz).toString().padStart(2, '0');
    const m = getMinutesInTz(d, this.userTz).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  private checkCalendarVisibility() {
    const calendarEl = document.querySelector('.fc');
    const containerEl = document.getElementById('tutor-calendar-container');
    
    if (calendarEl && containerEl) {
      const calendarRect = calendarEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      
      
      // If calendar has no dimensions, log warning
      if (calendarRect.width === 0 || calendarRect.height === 0) {
        console.warn('📅 Calendar has no dimensions');
      }
    } else {
      console.warn('📅 Calendar or container element not found for visibility check');
    }
  }

  private forceCalendarVisibility(calendarEl: HTMLElement) {
    
    // First fix the container dimensions
    const containerEl = document.getElementById('tutor-calendar-container');
    if (containerEl) {
      containerEl.style.cssText = `
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        width: 100% !important;
        height: 500px !important;
        min-height: 500px !important;
        background: white !important;
        position: relative !important;
        padding: 20px !important;
      `;
    }
    
    // Apply aggressive visibility styles to calendar
    calendarEl.style.cssText = `
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      width: 100% !important;
      height: 400px !important;
      min-height: 400px !important;
      background: white !important;
      border: 1px solid #ccc !important;
      position: relative !important;
      z-index: 1 !important;
    `;
    
    // Force all child elements to be visible
    const allElements = calendarEl.querySelectorAll('*');
    allElements.forEach(el => {
      const htmlEl = el as HTMLElement;
      htmlEl.style.display = htmlEl.style.display || 'block';
      htmlEl.style.visibility = 'visible';
      htmlEl.style.opacity = '1';
    });
    
  }

  // Mobile expandable section toggles
  toggleSidebar() {
    this.sidebarExpanded = !this.sidebarExpanded;
  }

  toggleTags() {
    this.tagsExpanded = !this.tagsExpanded;
  }

  toggleLessonStatus() {
    this.lessonStatusExpanded = !this.lessonStatusExpanded;
  }

  private formatTime12Hour(hour: number, minute: number): string {
    const displayMinute = minute.toString().padStart(2, '0');
    if (this.is24h) {
      return `${hour.toString().padStart(2, '0')}:${displayMinute}`;
    }
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${displayMinute} ${period}`;
  }

  // Compact range for event chip, e.g. "12:00–12:30 AM" or "14:00–14:30"
  private formatCompactRange(start: Date, end: Date): string {
    const s = this.formatTimeParts(start);
    const e = this.formatTimeParts(end);
    if (this.is24h) {
      return `${s.time}–${e.time}`;
    }
    if (s.period === e.period) {
      return `${s.time}–${e.time} ${s.period}`;
    }
    return `${s.time} ${s.period}–${e.time} ${e.period}`;
  }

  // Ultra-compact for tiny chips, e.g. "12–12:30a" or "14:00–14:30"
  private formatTinyRange(start: Date, end: Date): string {
    const s = this.formatTimeParts(start);
    const e = this.formatTimeParts(end);
    if (this.is24h) {
      const sTime = s.time.endsWith(':00') ? s.time.replace(':00', '') : s.time;
      const eTime = e.time.endsWith(':00') ? e.time.replace(':00', '') : e.time;
      return `${sTime}–${eTime}`;
    }
    const sp = s.period === 'AM' ? 'a' : 'p';
    const ep = e.period === 'AM' ? 'a' : 'p';
    const sTime = s.time.endsWith(':00') ? s.time.replace(':00', '') : s.time;
    const eTime = e.time.endsWith(':00') ? e.time.replace(':00', '') : e.time;
    if (s.period === e.period) {
      return `${sTime}–${eTime}${sp}`;
    }
    return `${sTime}${sp}–${eTime}${ep}`;
  }

  private formatTimeParts(d: Date): { time: string; period: string } {
    const hour = getHoursInTz(d, this.userTz);
    const minute = getMinutesInTz(d, this.userTz);
    const displayMinute = minute.toString().padStart(2, '0');
    if (this.is24h) {
      return { time: `${hour.toString().padStart(2, '0')}:${displayMinute}`, period: '' };
    }
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return { time: `${displayHour}:${displayMinute}`, period };
  }

  isScreenLocked(): boolean {
    return this.showMobileSettings || this.panelAnimating;
  }
  
  // Load participant's availability for reschedule mode
  private loadParticipantAvailability(participantId: string) {
    
    
    this.userService.getTutorAvailability(participantId).subscribe({
      next: (response) => {
        if (response.success && response.availability) {
          this.participantAvailability = response.availability;
          
          
          // Refresh calendar to show mutual availability
          this.refreshCalendarForReschedule();
        }
      },
      error: (error) => {
        console.error('❌ Error loading participant availability:', error);
      }
    });
  }
  
  // Refresh calendar to show only mutual availability slots
  private refreshCalendarForReschedule() {
    // TODO: Filter calendar events to show only times when both tutor and student are available
    // This would involve:
    // 1. Getting current user's (tutor's) availability
    // 2. Comparing with participant's availability
    // 3. Only showing time slots where both are available
    // 4. Highlighting these mutual slots in the calendar
    
  }

  // Navigate to event details page
  async onEventClick(item: TimelineEntry, event?: any) {
    if (item.type === 'free') return;

    if (item.isGoogleCalendar) {
      const eventDetails = {
        title: item.title || 'Google Calendar Event',
        start: item.start,
        end: item.end,
        durationMinutes: item.durationMinutes,
        isGoogleCalendar: true,
        color: '#6b7280'
      };
      await this.openEventDetailsModal(eventDetails, event);
      return;
    }

    if (!item.id) return;
    
    // Look up class data from classesMap if this is a class (to ensure we have latest attendees)
    let attendees: any[] | undefined = item.attendees;
    let capacity: number | undefined = item.capacity;
    let thumbnail: string | undefined = item.thumbnail;
    let isCancelled = item.isCancelled || false;
    
    if (item.isClass && item.id) {
      const classId = String(item.id);
      const classData = this.classesMap.get(classId);
      if (classData) {
        attendees = classData.attendees || classData.confirmedStudents || [];
        capacity = classData.capacity || 1;
        thumbnail = classData.thumbnail;
        isCancelled = classData.status === 'cancelled';
      }
    }
    
    // Convert TimelineEntry to event details format
    const eventDetails = {
      id: item.id,
      lessonId: item.isLesson ? item.id : undefined,
      classId: item.isClass ? item.id : undefined,
      title: item.title,
      subtitle: item.subtitle,
      start: item.start,
      end: item.end,
      durationMinutes: item.durationMinutes,
      location: item.location,
      avatarUrl: item.avatarUrl,
      isTrialLesson: item.isTrialLesson,
      isClass: item.isClass,
      isOfficeHours: item.isOfficeHours,
      isCancelled: isCancelled,
      isLesson: item.isLesson,
      studentName: item.subtitle,
      studentDisplayName: item.subtitle,
      subject: item.subtitle,
      color: item.color,
      attendees: attendees,
      capacity: capacity,
      thumbnail: thumbnail,
      meta: item.meta
    };
    
    await this.openEventDetailsModal(eventDetails, event);
  }

  // ============ CUSTOM CALENDAR METHODS ============
  
  private initializeCustomCalendar() {
    // Set current week start (Sunday)
    const today = new Date();
    const dayOfWeek = today.getDay();
    this.currentWeekStart = new Date(today);
    this.currentWeekStart.setDate(today.getDate() - dayOfWeek);
    this.currentWeekStart.setHours(0, 0, 0, 0);
    
    // Generate week days
    this.updateWeekDays();
    
    // Initialize selected day for day view (today)
    this.updateSelectedDayForDayView(today);
    
    // Generate time slots (6 AM to 10 PM)
    this.generateTimeSlots();
    
    // Update week title
    this.updateWeekTitle();
    
    // Reload availability data to map it to the correct week
    // This is needed because availability was loaded before currentWeekStart was initialized
    if (this.currentUser && this.currentUser.id) {
      
      this.loadAndUpdateCalendarData();
    }
    
    // Trigger change detection to ensure events render
    setTimeout(() => {
      this.cdr.detectChanges();
    }, 100);
  }
  
  private updateWeekDays() {
    this.weekDays = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(this.currentWeekStart);
      date.setDate(this.currentWeekStart.getDate() + i);
      
      this.weekDays.push({
        date: date,
        shortDay: formatDateInTz(date, this.userTz, { weekday: 'short', month: undefined, day: undefined, year: undefined }),
        dayNumber: date.getDate().toString(),
        dayName: formatDateInTz(date, this.userTz, { weekday: 'long', month: undefined, day: undefined, year: undefined })
      });
    }
  }

  private updateSelectedDayForDayView(date: Date) {
    this.selectedDayForDayView = {
      date: new Date(date),
      shortDay: formatDateInTz(date, this.userTz, { weekday: 'short', month: undefined, day: undefined, year: undefined }),
      dayNumber: date.getDate().toString(),
      dayName: formatDateInTz(date, this.userTz, { weekday: 'long', month: undefined, day: undefined, year: undefined }),
      monthLabel: formatDateInTz(date, this.userTz, { month: 'long', day: undefined, year: undefined }),
      year: date.getFullYear()
    };
  }
  
  getEventsForSelectedDay(): any[] {
    return this.getEventsForDay(this.selectedDayForDayView);
  }
  
  getFreeHoursForSelectedDay(): number {
    if (!this.selectedDayForDayView || !this.selectedDayForDayView.date) {
      return 0;
    }
    return computeFutureFreeHoursFromEvents(this.events || [], this.selectedDayForDayView.date, new Date(), 'visible6to23');
  }
  
  private generateTimeSlots() {
    this.timeSlots = [];
    for (let hour = 6; hour <= 23; hour++) {
      if (this.is24h) {
        this.timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
      } else {
        const period = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
        this.timeSlots.push(`${displayHour} ${period}`);
      }
    }
  }
  
  private updateWeekTitle() {
    const startMonth = formatDateInTz(this.currentWeekStart, this.userTz, { month: 'long', day: undefined, year: undefined });
    const endDate = new Date(this.currentWeekStart);
    endDate.setDate(this.currentWeekStart.getDate() + 6);
    const endMonth = formatDateInTz(endDate, this.userTz, { month: 'long', day: undefined, year: undefined });

    if (startMonth === endMonth) {
      this.currentWeekTitle = `${startMonth} ${this.currentWeekStart.getFullYear()}`;
    } else {
      this.currentWeekTitle = `${startMonth} - ${endMonth} ${endDate.getFullYear()}`;
    }
  }
  
  navigatePrevious() {
    if (this.customView === 'week') {
      this.currentWeekStart.setDate(this.currentWeekStart.getDate() - 7);
      this.updateWeekDays();
      this.updateWeekTitle();
      // Check if we need to load more data for this week
      const weekEnd = this.addDays(this.currentWeekStart, 6);
      this.checkAndLoadMoreData(this.currentWeekStart, weekEnd);
      // Regenerate availability events for the new week
      this.loadAndUpdateCalendarData();
    } else {
      // Day view - go back one day
      const newDate = new Date(this.selectedDayForDayView.date);
      newDate.setDate(newDate.getDate() - 1);
      this.updateSelectedDayForDayView(newDate);
      // Check if we need to load more data for this day
      this.checkAndLoadMoreData(newDate, newDate);
    }
  }
  
  navigateNext() {
    if (this.customView === 'week') {
      this.currentWeekStart.setDate(this.currentWeekStart.getDate() + 7);
      this.updateWeekDays();
      this.updateWeekTitle();
      // Check if we need to load more data for this week
      const weekEnd = this.addDays(this.currentWeekStart, 6);
      this.checkAndLoadMoreData(this.currentWeekStart, weekEnd);
      // Regenerate availability events for the new week
      this.loadAndUpdateCalendarData();
    } else {
      // Day view - go forward one day
      const newDate = new Date(this.selectedDayForDayView.date);
      newDate.setDate(newDate.getDate() + 1);
      this.updateSelectedDayForDayView(newDate);
      // Check if we need to load more data for this day
      this.checkAndLoadMoreData(newDate, newDate);
    }
  }
  
  navigateToday() {
    const today = new Date();
    if (this.customView === 'week') {
      const dayOfWeek = today.getDay();
      this.currentWeekStart = new Date(today);
      this.currentWeekStart.setDate(today.getDate() - dayOfWeek);
      this.currentWeekStart.setHours(0, 0, 0, 0);
      this.updateWeekDays();
      this.updateWeekTitle();
      // Regenerate availability events for today's week
      this.loadAndUpdateCalendarData();
    } else {
      // Day view - go to today
      this.updateSelectedDayForDayView(today);
    }
  }
  
  isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  }
  
  getEventsForDay(day: any): any[] {
    const dayStart = new Date(day.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day.date);
    dayEnd.setHours(23, 59, 59, 999);
    
    // Log all events for debugging
    if (day.dayNumber === 23 || day.dayNumber === 24) {
      
      
    }
    
    const filteredEvents = this.events.filter(event => {
      if (!event.start) return false;
      const eventStart = new Date(event.start as any);
      const isInRange = eventStart >= dayStart && eventStart <= dayEnd;
      
      // Show lessons AND availability blocks (experimenting with showing availability)
      const extendedProps = (event.extendedProps || {}) as any;
      const isAvailability = extendedProps.type === 'availability' || extendedProps.type === 'available';
      const isLesson = extendedProps.lessonId || extendedProps.lesson || extendedProps.classId;
      
      // Debug logging for first couple days
      if (day.dayNumber === 23 || day.dayNumber === 24) {
        
      }
      
      if (isInRange && isAvailability) {
        
      }
      
      // Show both lessons and availability
      return isInRange && (isLesson || isAvailability);
    }).map(event => {
      const extendedProps = (event.extendedProps || {}) as any;
      const studentName = extendedProps.studentName || extendedProps.student?.name || '';
      const formattedName = this.formatNameWithInitial(studentName);
      const isAvailability = extendedProps.type === 'availability' || extendedProps.type === 'available';
      const isLesson = Boolean(extendedProps.lessonId);
      
      // For lessons, include the lesson type (e.g., "John - Spanish lesson")
      const subject = extendedProps.subject || '';
      const displayName = isLesson && subject 
        ? `${formattedName} - ${subject}`
        : formattedName;
      
      return {
        ...event,
        title: isAvailability ? this.translate.instant('TUTOR_CALENDAR.AVAILABLE_FALLBACK') : (event.title || 'Untitled Event'),
        studentName: isAvailability ? '' : displayName,
        studentAvatar: isAvailability ? '' : (extendedProps.studentAvatar || extendedProps.student?.profilePicture || ''),
        isAvailability: isAvailability,
        isClass: extendedProps.isClass || extendedProps.classId,
        start: new Date(event.start as any),
        end: new Date(event.end as any)
      };
    });
    
    if (day.dayNumber === 23 || day.dayNumber === 24) {
      
    }
    
    return filteredEvents;
  }
  
  private formatNameWithInitial(fullName: string): string {
    if (!fullName) return '';
    
    const parts = fullName.trim().split(' ');
    if (parts.length === 1) return parts[0]; // Only first name
    
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    const lastInitial = lastName.charAt(0).toUpperCase();
    
    return `${firstName} ${lastInitial}.`;
  }
  
  calculateEventTop(event: any): number {
    const startHour = getHoursInTz(event.start, this.userTz);
    const startMinute = getMinutesInTz(event.start, this.userTz);
    const startOffset = 6;
    const slotHeight = 70;

    return ((startHour - startOffset) * slotHeight) + (startMinute / 60 * slotHeight);
  }
  
  calculateEventHeight(event: any): number {
    const durationMs = event.end.getTime() - event.start.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);
    return durationHours * 70; // 70px per hour (increased from 60px)
  }
  
  formatEventTime(event: any): string {
    const startTime = this.formatTime(event.start);
    const durationMs = event.end.getTime() - event.start.getTime();
    const durationMinutes = Math.round(durationMs / (1000 * 60));
    
    return `${startTime} (${durationMinutes}min)`;
  }
  
  isEventPast(event: any): boolean {
    return event.end.getTime() < Date.now();
  }
  
  
  private startTimeUpdater() {
    this.updateCurrentTimePosition();
    this.timeUpdateInterval = setInterval(() => {
      this.updateCurrentTimePosition();
    }, 60000); // Update every minute
  }
  
  private updateCurrentTimePosition() {
    const tz = this.currentUser?.profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(new Date());
    const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    const startOffset = 6;
    const slotHeight = 110;

    this.currentTimePosition = ((currentHour - startOffset) * slotHeight) + (currentMinute / 60 * slotHeight);
  }
  
  // Scroll to "now" indicator on page load
  scrollToNowIndicator() {
    if (this.hasScrolledToNow) {
      return; // Only scroll once per view
    }
    
    // Update position first
    this.updateCurrentTimePosition();
    this.cdr.detectChanges();
    
    // Wait for next frame
    requestAnimationFrame(() => {
      const container = this.customView === 'week' 
        ? this.weekBodyContainer?.nativeElement 
        : this.dayViewBodyContainer?.nativeElement;
      
      if (!container) {
        return;
      }
      
      // Find the time indicator element
      const indicator = container.querySelector('.time-indicator') as HTMLElement;
      
      if (indicator) {
        const rect = indicator.getBoundingClientRect();
        
        // Check if indicator is visible
        if (rect.width === 0 || rect.height === 0) {
          return;
        }
        
        // Calculate scroll position to center the indicator in view
        const containerRect = container.getBoundingClientRect();
        const indicatorTopRelative = rect.top - containerRect.top + container.scrollTop;
        const targetScroll = indicatorTopRelative - (containerRect.height / 3); // Position at top third of view
        
        container.scrollTo({
          top: Math.max(0, targetScroll),
          behavior: 'smooth'
        });
        
        this.hasScrolledToNow = true;
      }
    });
  }
  
  // Switch between week and day view with scroll to now
  switchView(view: 'week' | 'day') {
    this.customView = view;
    this.hasScrolledToNow = false; // Reset scroll flag
    
    // Wait for view to render, then scroll to now
    setTimeout(() => {
      this.scrollToNowIndicator();
    }, 100);
  }
  
  // 🧪 DEV TEST: Manually trigger auto-cancel for testing
  async testAutoCancelClass() {
    // Find first upcoming class from events
    const upcomingClass = this.events.find((e: any) => 
      e.extendedProps?.isClass && 
      e.extendedProps?.status === 'scheduled' &&
      new Date(e.start) > new Date()
    );
    
    if (!upcomingClass) {
      const toast = await this.toastController.create({
        message: 'No upcoming scheduled classes to test',
        duration: 2000,
        color: 'warning'
      });
      await toast.present();
      return;
    }
    
    const classId = upcomingClass.extendedProps?.['classId'] || upcomingClass.id;
    const className = upcomingClass.title || this.translate.instant('TUTOR_CALENDAR.CLASS_FALLBACK');
    
    if (!classId) {
      const toast = await this.toastController.create({
        message: 'Could not find class ID',
        duration: 2000,
        color: 'danger'
      });
      await toast.present();
      return;
    }
    
    // Confirm before triggering
    const alert = await this.alertController.create({
      header: 'Test Auto-Cancel',
      message: `This will cancel "${className}" and send notifications. Continue?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Test Cancel',
          role: 'confirm',
          handler: async () => {
            await this.executeTestAutoCancel(classId, className);
          }
        }
      ]
    });
    
    await alert.present();
  }
  
  private async executeTestAutoCancel(classId: string, className: string) {
    const loading = await this.toastController.create({
      message: 'Testing auto-cancel...',
      duration: 0
    });
    await loading.present();
    
    try {
      const headers = this.userService.getAuthHeadersSync();
      const response = await fetch(`http://localhost:3000/api/classes/${classId}/test-auto-cancel`, {
        method: 'POST',
        headers: {
          'Authorization': headers.get('Authorization') || '',
          'Content-Type': 'application/json'
        }
      });
      
      const result = await response.json();
      await loading.dismiss();
      
      if (result.success) {
        const toast = await this.toastController.create({
          message: `✅ "${className}" test cancelled successfully`,
          duration: 3000,
          color: 'success'
        });
        await toast.present();
        
        // Refresh calendar to show the cancelled class
        this.refreshCalendar();
      } else {
        throw new Error(result.message || 'Test failed');
      }
    } catch (error) {
      await loading.dismiss();
      console.error('Test auto-cancel error:', error);
      
      const toast = await this.toastController.create({
        message: `❌ Test failed: ${error}`,
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
    }
  }

  // Check Stripe Connect status
  private async checkStripeConnectStatus() {
    
    
    
    
    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${environment.apiUrl}/payments/stripe-connect/status`, {
          headers: this.userService.getAuthHeadersSync()
        })
      );
      
      
      
      if (response.success) {
        this.stripeConnectOnboarded = response.onboarded;
        
        
        this.cdr.detectChanges(); // Force change detection
      }
    } catch (error) {
      console.error('❌ Error checking Stripe Connect status:', error);
      this.stripeConnectOnboarded = false;
      this.cdr.detectChanges();
    }
  }

  // Show alert when trying to use features without Stripe onboarding
  private async showStripeOnboardingAlert() {
    const alert = await this.alertController.create({
      header: this.translate.instant('TUTOR_CALENDAR.PAYMENT_SETUP_REQUIRED'),
      message: this.translate.instant('TUTOR_CALENDAR.PAYMENT_SETUP_MSG'),
      buttons: [
        {
          text: this.translate.instant('TUTOR_CALENDAR.CANCEL'),
          role: 'cancel'
        },
        {
          text: this.translate.instant('TUTOR_CALENDAR.GO_TO_PROFILE'),
          handler: () => {
            this.router.navigate(['/tabs/profile']);
          }
        }
      ]
    });
    await alert.present();
  }

  // ── Outstanding Feedback ──

  loadPendingFeedback(): void {
    if (this.tutorFeedbackService.isCacheLoaded) {
      const cached = this.tutorFeedbackService.getCachedPendingFeedback();
      this.pendingFeedbackCount = cached.count || 0;
      this.pendingFeedbackItems = cached.pendingFeedback || [];
      this.updateFeedbackGraceCountdown();
    }
    this.tutorFeedbackService.refreshPendingFeedback();
  }

  openFeedbackModal(): void {
    if (this.pendingFeedbackItems.length === 0) return;
    this.isFeedbackModalOpen = true;
  }

  closeFeedbackModal(): void {
    this.isFeedbackModalOpen = false;
  }

  navigateToFeedback(lessonId: string, feedbackId: string): void {
    this.closeFeedbackModal();
    this.router.navigate(['/post-lesson-tutor', lessonId], {
      queryParams: { feedbackId }
    });
  }

  formatFeedbackDate(dateStr: any): string {
    if (!dateStr) return '';
    return formatDateInTz(dateStr, this.userTz, { weekday: 'short', month: 'short', day: 'numeric', year: undefined });
  }

  formatFeedbackTime(dateStr: any): string {
    if (!dateStr) return '';
    return formatTimeInTz(dateStr, this.userTz, undefined, !this.is24h);
  }

  trackByIndex(index: number): number { return index; }
  trackByDayDate(index: number, day: any): string { return day?.date?.toISOString?.() || index.toString(); }
  trackByEventId(index: number, item: any): string { return item?.id || index.toString(); }
  trackByBlockStart(index: number, block: any): string { return block?.start?.getTime?.()?.toString() || index.toString(); }
  trackByFbId(index: number, fb: any): string { return fb?.lessonId || fb?.id || index.toString(); }
  trackByDayLabel(index: number, day: any): string { return day?.dayName || index.toString(); }
}

