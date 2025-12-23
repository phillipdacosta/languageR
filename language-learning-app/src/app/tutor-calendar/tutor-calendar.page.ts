import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter, ViewDidEnter, ActionSheetController, ModalController, ToastController, AlertController } from '@ionic/angular';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { UserService, User } from '../services/user.service';
import { LessonService, Lesson } from '../services/lesson.service';
import { ClassService } from '../services/class.service';
import { WebSocketService } from '../services/websocket.service';
import { Calendar, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { filter, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { PlatformService } from '../services/platform.service';
import { trigger, state, style, transition, animate, query, stagger } from '@angular/animations';
import { ClassAttendeesComponent } from '../components/class-attendees/class-attendees.component';
import { BlockTimeComponent } from '../modals/block-time/block-time.component';
// Performance pipes
import { EventsForDayPipe } from './pipes/events-for-day.pipe';
import { EventsForSelectedDayPipe } from './pipes/events-for-selected-day.pipe';
import { EventTopPipe } from './pipes/event-top.pipe';
import { EventHeightPipe } from './pipes/event-height.pipe';
import { EventTimePipe } from './pipes/event-time.pipe';
import { IsTodayPipe } from './pipes/is-today.pipe';
import { IsEventPastPipe } from './pipes/is-event-past.pipe';
import { FreeHoursPipe } from './pipes/free-hours.pipe';
import { TotalAvailabilityPipe } from './pipes/total-availability.pipe';
import { BookedHoursPipe } from './pipes/booked-hours.pipe';

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
    TotalAvailabilityPipe,
    BookedHoursPipe
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
  panelAnimating = false;
  activeSettingsTab = 'availability';
  showPopularSlots = false;
  mobileViewMode: 'day' | 'agenda' = 'day';
  readonly mobileDaysToShow = 4;
  readonly agendaDaysToShow = 7;
  private mobileWeekStart: Date = new Date();
  mobileDays: MobileDayContext[] = [];
  mobileAgendaSections: AgendaSection[] = [];
  selectedMobileDayIndex = 0;
  mobileTimeline: TimelineEntry[] = [];
  mobileTimelineEvents: TimelineEntry[] = []; // Pre-filtered events only
  isLoadingMobileData = true; // Track loading state to prevent empty state flash
  private availabilityLoaded = false;
  private lessonsLoaded = false;
  
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

  private viewportResizeHandler = () => this.evaluateViewport();

  get agendaRangeLabel(): string {
    const start = this.mobileWeekStart ? this.getStartOfDay(this.mobileWeekStart) : this.getStartOfDay(new Date());
    const end = this.addDays(start, this.agendaDaysToShow - 1);
    return "".concat(
      start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      ' – ',
      end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

  formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const parts: string[] = [];
    if (hours) {
      parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    }
    if (mins) {
      parts.push(`${mins} ${mins === 1 ? 'minute' : 'minutes'}`);
    }
    if (!parts.length) {
      return 'less than a minute';
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
    private cdr: ChangeDetectorRef
  ) { }

  private evaluateViewport() {
    if (typeof window === 'undefined') {
      this.isMobileView = false;
      return;
    }
    const wasMobile = this.isMobileView;
    this.isMobileView = window.innerWidth <= 768;
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

  private setupMobileDays(anchor: Date, focus: Date = anchor) {
    const start = this.getStartOfDay(anchor);
    this.mobileWeekStart = start;
    const days: MobileDayContext[] = [];
    const count = this.mobileViewMode === 'agenda' ? this.agendaDaysToShow : this.mobileDaysToShow;
    for (let i = 0; i < count; i++) {
      const current = this.addDays(start, i);
      days.push({
        date: current,
        dayName: current.toLocaleDateString('en-US', { weekday: 'long' }),
        shortDay: current.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNumber: current.getDate().toString(),
        monthLabel: current.toLocaleDateString('en-US', { month: 'long' }),
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
        title: 'Open time slot',
        meta: `+ Add Availability (${this.formatDurationShort(minutes)})`
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
      // Check if this is a lesson (has avatar or subtitle which indicates student info)
      // OR a class (has a title that's not "Available")
      const isLesson = entry.avatarUrl || entry.subtitle;
      const isClass = entry.title && entry.title !== 'Available' && entry.title.includes('Class');
      
      if (isLesson || isClass) {
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

      // Check if they're adjacent or overlapping (within 30 minutes)
      const gap = entry.start.getTime() - current.end.getTime();
      const thirtyMinutes = 30 * 60 * 1000;

      if (gap <= thirtyMinutes) {
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
      return;
    }
    const activeDay = this.selectedMobileDay;
    if (!activeDay) {
      this.mobileTimeline = [];
      this.mobileTimelineEvents = [];
      return;
    }
    const dayStart = this.getStartOfDay(activeDay.date);
    const dayEnd = this.addDays(dayStart, 1);
    
    console.log('📱 [DAY-VIEW] Building timeline for:', dayStart.toISOString());
    
    // Build timeline in temporary variable to avoid flashing
    const timeline = this.buildDayEntries(dayStart, dayEnd);
    
    // Filter to show lessons and classes (exclude free time slots, generic availability blocks, and cancelled events)
    // Lessons have subtitles/avatarUrls, Classes have specific titles
    const timelineEvents = timeline.filter(item => {
      if (item.type !== 'event') return false;
      // Exclude generic availability blocks (they have "Available" as title and no lesson indicators)
      // But keep classes (which have custom titles like "Class", "Spanish Class", etc.)
      const isGenericAvailability = item.title === 'Available' && !item.subtitle && !item.avatarUrl;
      const isFreeSlot = item.title === 'Open time slot';
      // Exclude cancelled events from mobile day view
      const isCancelled = item.isCancelled === true;
      // Show ALL events (past and future) - don't filter by time, but exclude cancelled
      return !isGenericAvailability && !isFreeSlot && !isCancelled;
    });
    
    console.log('📱 [DAY-VIEW] Timeline events:', {
      total: timelineEvents.length,
      events: timelineEvents.map(e => ({
        title: e.title,
        isClass: e.isClass,
        isCancelled: e.isCancelled
      }))
    });
    
    // Assign all at once to prevent intermediate empty states
    this.mobileTimeline = timeline;
    this.mobileTimelineEvents = timelineEvents;
  }

  private collectEventsForDay(dayStart: Date, dayEnd: Date): TimelineEntry[] {
    const results: TimelineEntry[] = [];
    
    // Log for debugging
    const dayStr = dayStart.toISOString().split('T')[0]; // Get YYYY-MM-DD
    console.log('📅 [COLLECT] collectEventsForDay called for:', dayStr, {
      dayStart: dayStart.toISOString(),
      dayEnd: dayEnd.toISOString(),
      totalEvents: this.events?.length || 0
    });
    
    // Log all class events in this.events
    const classEventsInArray = (this.events || []).filter(e => {
      const ext = e.extendedProps as any;
      return ext?.isClass || ext?.classId;
    });
    console.log('📅 [COLLECT] Class events in this.events:', classEventsInArray.map(e => ({
      id: e.id,
      title: e.title,
      start: e.start,
      classId: (e.extendedProps as any)?.classId,
      isCancelled: (e.extendedProps as any)?.isCancelled
    })));
    
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
        console.log('🔴 [CANCELLED-CLASS] Checking cancelled class:', {
          title: event.title,
          classId: ext.classId,
          rawStart: rawStart.toISOString(),
          rawEnd: rawEnd.toISOString(),
          dayStart: dayStart.toISOString(),
          dayEnd: dayEnd.toISOString(),
          isInRange,
          startBeforeDayEnd: rawStart < dayEnd,
          endAfterDayStart: rawEnd > dayStart,
          comparison: {
            'rawStart < dayEnd': rawStart < dayEnd,
            'rawEnd > dayStart': rawEnd > dayStart,
            'both': rawStart < dayEnd && rawEnd > dayStart
          }
        });
      }
      
      if (!isInRange) {
        continue;
      }
      
      const clampedStart = rawStart.getTime() < dayStart.getTime() ? new Date(dayStart.getTime()) : rawStart;
      const clampedEnd = rawEnd.getTime() > dayEnd.getTime() ? new Date(dayEnd.getTime()) : rawEnd;
      
      results.push(this.buildTimelineEvent(event, clampedStart, clampedEnd));
    }
    
    console.log('📅 [COLLECT] Collected timeline entries:', {
      total: results.length,
      classLessonCount: results.filter(e => e.isClass || e.isLesson).length,
      events: results.filter(e => e.isClass || e.isLesson).map(e => ({
        title: e.title,
        isClass: e.isClass,
        isCancelled: e.isCancelled
      }))
    });
    
    return results.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  private buildTimelineEvent(event: EventInput, start: Date, end: Date): TimelineEntry {
    const extended = (event.extendedProps as any) || {};
    const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    const isLesson = Boolean(extended.lessonId);
    const isClass = extended.isClass || (event.title && event.title !== 'Available' && event.title.includes('Class'));
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
    
    const title = isLesson ? (extended.studentDisplayName || extended.studentName || 'Lesson') : (event.title || extended.subject || 'Available');
    const subtitle = isLesson ? (extended.subject || extended.status) : (extended.studentName || extended.subject);
    const meta = isLesson ? this.formatDuration(durationMinutes) : (extended.timeStr || extended.status);
    
    // Color coding:
    // Office hours: Gold (#f59e0b)
    // Classes: Purple (#8b5cf6)  
    // Regular lessons: Green (#10b981)
    // Availability: Blue (#007bff)
    let color = '#007bff'; // Default to availability blue
    if (isOfficeHours) {
      color = '#f59e0b'; // Gold for office hours
    } else if (isClass) {
      color = '#8b5cf6'; // Purple for classes
    } else if (isLesson) {
      color = '#10b981'; // Green for regular lessons
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
      id: extended.lessonId || extended.classId, // Store the ID for navigation
      isLesson: isLesson
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
    const dateLabel = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const dayLabel = date.toLocaleDateString('en-US', { weekday: 'long' });
    let relative: string | undefined;
    if (offset === 1) {
      relative = 'Tomorrow';
    }
    return {
      dayLabel,
      dateLabel,
      relative
    };
  }
  ngOnInit() {
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
        
        console.log('📅 Reschedule mode activated:', {
          lessonId: this.rescheduleLessonId,
          participantId: this.rescheduleParticipantId
        });
        
        // Load participant's availability
        if (this.rescheduleParticipantId) {
          this.loadParticipantAvailability(this.rescheduleParticipantId);
        }
      }
    });
    
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
          console.log('⚡ Received urgent office hours booking notification');
          
          // Don't show toast if tutor is currently on pre-call page (they already see the modal)
          const currentUrl = this.router.url;
          if (currentUrl.includes('/pre-call')) {
            console.log('⚡ Skipping toast - tutor is on pre-call page');
            return;
          }
          
          // Show toast notification
          const toast = await this.toastController.create({
            message: notification.message || 'New office hours session booked!',
            duration: 5000,
            color: 'warning',
            icon: 'flash',
            position: 'top',
            buttons: [
              {
                text: 'View',
                handler: () => {
                  if (notification.lessonId || notification.data?.lessonId) {
                    const lessonId = notification.lessonId || notification.data?.lessonId;
                    this.router.navigate(['/tabs/tutor-calendar/event', lessonId]);
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
          console.log('🔔 [TUTOR-CALENDAR] Received class cancellation notification:', notification);
          
          // Refresh calendar to show the cancelled class
          this.refreshCalendar();
          
          // Show toast notification
          const toast = await this.toastController.create({
            message: notification.message || 'A class has been cancelled',
            duration: 5000,
            position: 'top',
            color: 'warning',
            buttons: [
              {
                text: 'OK',
                role: 'cancel'
              }
            ]
          });
          await toast.present();
        }
        
        // Handle lesson cancelled notifications
        if (notification.type === 'lesson_cancelled' && notification.data?.lessonId) {
          console.log('🔔 [TUTOR-CALENDAR] Received lesson cancellation notification:', notification);
          
          // Refresh calendar to show the cancelled lesson
          this.refreshCalendar();
          
          // Show toast notification
          const toast = await this.toastController.create({
            message: notification.message || 'A lesson has been cancelled',
            duration: 5000,
            position: 'top',
            color: 'warning',
            buttons: [
              {
                text: 'OK',
                role: 'cancel'
              }
            ]
          });
          await toast.present();
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

  ngOnDestroy() {
    // Clean up subscriptions
    this.destroy$.next();
    this.destroy$.complete();
    
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
    
    // Clean up session storage
  }

  ionViewWillEnter() {
    // Reset initialization attempts when entering the page
    this.initializationAttempts = 0;
    
    // Always set loading state when entering view to prevent flash
    this.availabilityLoaded = false;
    this.lessonsLoaded = false;
    // Classes load separately and don't block initial render
    
    if (this.isMobileView) {
      this.isLoadingMobileData = true;
    }
  }

  ionViewDidEnter() {
    // Check if we're coming from availability setup
    const currentUrl = this.router.url;
    
    // Check for refresh parameter from availability setup
    const urlParams = new URLSearchParams(window.location.search);
    const shouldRefreshAvailability = urlParams.get('refreshAvailability') === 'true';
    
    if (shouldRefreshAvailability) {
      // Clear the query parameter to avoid repeated refreshes
      this.router.navigate(['/tabs/tutor-calendar'], { replaceUrl: true });
      
      // Force refresh regardless of user state
      if (this.currentUser) {
        this.forceRefreshAvailability();
      } else {
        // Load user first, then refresh
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
    // Reset counter when leaving
    this.initializationAttempts = 0;
    // Clean up when leaving the page
    if (this.calendar) {
      this.calendar.destroy();
      this.calendar = undefined;
      this.isInitialized = false;
    }
  }

  private loadCurrentUser() {
    this.userService.getCurrentUser().subscribe({
      next: (user) => {
        this.currentUser = user;
        
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

  private loadLessons(tutorId: string) {
    console.log('📚 [LOAD-DEBUG] loadLessons START');
    
    // Fetch all lessons (including past ones)
    this.lessonService.getLessonsByTutor(tutorId, true).subscribe({
      next: (response) => {
        if (response.success && response.lessons) {
          this.convertLessonsToEvents(response.lessons);
        }
        // Mark lessons as loaded - this will trigger checkIfBothLoaded()
        this.lessonsLoaded = true;
        console.log('📚 [LOAD-DEBUG] Lessons loaded, calling checkIfBothLoaded');
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
    this.loadLessons(tutorId);
    this.loadClasses(tutorId);
  }

  private loadClasses(tutorId: string) {
    this.classService.getClassesForTutor(tutorId).subscribe({
      next: (response) => {
        if (response.success && response.classes) {
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
              title: cls.name || 'Class',
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
                className: cls.name || 'Class',
                classThumbnail: cls.thumbnail,
                type: 'class',
                classData: cls,
                isCancelled: isCancelled,
                cancelReason: cls.cancelReason,
                status: cls.status
              }
            } as EventInput;
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

  private convertLessonsToEvents(lessons: Lesson[]): void {
    // Convert all lessons to events (including cancelled) to show them crossed out
    const allLessons = lessons;
    
    const lessonEvents = allLessons.map(lesson => {
      const student = lesson.studentId as any;
      const studentFirst = typeof student?.firstName === 'string' ? student.firstName.trim() : '';
      const studentLast = typeof student?.lastName === 'string' ? student.lastName.trim() : '';
      const studentFullName = [studentFirst, studentLast].filter(Boolean).join(' ');
      const studentName = studentFullName || student?.name || student?.displayName || student?.email || 'Student';
      const subject = lesson.subject || 'Language Lesson';
      const isCancelled = lesson.status === 'cancelled';
      
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
      
      // Format time for display (12-hour format like availability-setup)
      const startTime = new Date(lesson.startTime);
      const endTime = new Date(lesson.endTime);
      const timeStr = `${this.formatTime12Hour(startTime.getHours(), startTime.getMinutes())} - ${this.formatTime12Hour(endTime.getHours(), endTime.getMinutes())}`;
      
      const isPast = endTime.getTime() < Date.now();
      const eventData = {
        id: lesson._id,
        title: `${studentName} - ${subject}`,
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
          subject: subject,
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
    console.log('📅 FullCalendar disabled - using custom calendar');
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
          meridiem: 'short',
          hour12: true
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
          hour12: true
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
    console.log('📅 [FORCE-REINIT-DESKTOP] Reloading calendar data for custom calendar');
    
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
    console.log('📅 FullCalendar attemptCalendarInitialization disabled - using custom calendar');
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
    console.log('📅 Using custom calendar - skipping FullCalendar initialization');
    
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
            this.events = [];
            this.updateCalendarEvents();
            // Mark availability as loaded
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
          

          
          // Merge with existing events (keep lessons/classes, replace availability)
          const nonAvailabilityEvents = this.events.filter(event => {
            const extendedProps = event.extendedProps as any;
            // Keep lessons (have lessonId) AND keep classes (have isClass or classId)
            // Don't keep availability blocks - they'll be re-added from res.availability
            return extendedProps?.lessonId || extendedProps?.isClass || extendedProps?.classId;
          });
          
          console.log('📅 [CLASS-DEBUG] Keeping', nonAvailabilityEvents.length, 'lesson events');
          
          this.events = [...availabilityEvents, ...nonAvailabilityEvents];
          const afterCount = this.events.length;
          
          console.log('📅 [CLASS-DEBUG] Final events array:', this.events.length, 'events');
          console.log('🟢 [AVAIL-DEBUG] Availability events count:', availabilityEvents.length);
          console.log('🟢 [AVAIL-DEBUG] First few availability events:', availabilityEvents.slice(0, 3).map(e => ({
            title: e.title,
            type: (e.extendedProps as any)?.type,
            start: e.start,
            end: e.end
          })));
          
          // Update calendar with events smoothly
          this.updateCalendarEvents();
          // Mark availability as loaded
          this.availabilityLoaded = true;
          this.checkIfBothLoaded();
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
    console.log('🔍 [LOAD-DEBUG] checkIfBothLoaded called - availability:', this.availabilityLoaded, 'lessons:', this.lessonsLoaded);
    
    if (this.availabilityLoaded && this.lessonsLoaded) {
      console.log('✅ [LOAD-DEBUG] Both availability and lessons loaded! Triggering change detection. Events:', this.events.length);
      // Both API calls completed - trigger ONE final change detection
      // Classes will load asynchronously and update without a full re-render
      this.cdr.detectChanges();
      
      // Update reminders with upcoming events
      // NOTE: Disabled because reminders are now tracked globally in app.component.ts
      // This prevents conflicts with global reminder tracking
      // this.updateReminders();
      
      // Mark mobile data as loaded
      if (this.isMobileView) {
        this.isLoadingMobileData = false;
      }
    } else {
      console.log('⏳ [LOAD-DEBUG] Still waiting...');
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
    console.log('📅 FullCalendar updateCalendarEvents disabled - using custom calendar');
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

    // Position from minutes since midnight (calendar configured with slotMinTime 00:00)
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const totalMinutes = 24 * 60;
    const height = body.clientHeight || bodyRect.height;
    this.customNowTop = Math.max(0, Math.min(height - 1, Math.round((minutes / totalMinutes) * height)));
    this.customNowLeft = Math.round(axisWidth);
    this.customNowWidth = Math.max(0, Math.round(colsRect.width));
    this.customNowVisible = true;
  }


  private reinitializeCalendar() {
    // CUSTOM CALENDAR: FullCalendar reinitialization disabled
    console.log('📅 FullCalendar reinitializeCalendar disabled - using custom calendar');
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
    const title = prompt('Enter availability title:') || 'Available';
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

  handleEventClick(clickInfoOrEvent: any) {
    // Handle both FullCalendar format (clickInfo.event) and custom calendar format (direct event)
    const event = clickInfoOrEvent.event || clickInfoOrEvent;
    const extendedProps = event.extendedProps;
    
    // Check if this is a lesson event (has lessonId) or an availability block
    if (extendedProps?.lessonId) {
      // Save current view before navigating (only if FullCalendar is active)
      if (this.calendar) {
        const currentView = this.calendar.view.type;
        localStorage.setItem('tutor-calendar-view', currentView);
      }
      // This is a lesson - navigate to event details page
      this.router.navigate(['/tabs/tutor-calendar/event', extendedProps.lessonId]);
    } else {
      // This is an availability block - keep existing delete behavior
      if (confirm('Delete this availability block?')) {
        event.remove();
        this.deleteEvent(event.id);
      }
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
      title: isClass ? (b.title || 'Class') : '',
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
          className: b.title || b.className || 'Class',
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
    console.log('Block time modal dismissed:', event);
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
      header: 'Manage This Time Slot',
      cssClass: 'availability-action-sheet',
      buttons: [
        {
          text: 'Set Regular Availability',
          icon: 'time-outline',
          handler: async () => {
            // Delay to let action sheet dismiss first
            setTimeout(() => {
              this.onSetUpAvailability(date, timeSlot);
            }, 100);
            return true; // Allow action sheet to dismiss
          }
        },
        {
          text: officeHoursEnabled ? 'Disable Office Hours' : 'Enable Office Hours',
          icon: 'flash-outline',
          handler: async () => {
            // Delay to let action sheet dismiss first
            setTimeout(() => {
              this.onEnableOfficeHours();
            }, 100);
            return true; // Allow action sheet to dismiss
          }
        },
        {
          text: 'Block This Time',
          icon: 'ban-outline',
          handler: async () => {
            // Delay to let action sheet dismiss first
            setTimeout(() => {
              this.onAddTimeOff(date, timeSlot);
            }, 100);
            return true; // Allow action sheet to dismiss
          }
        },
        {
          text: 'Cancel',
          role: 'cancel',
          icon: 'close-outline'
        }
      ]
    });

    await actionSheet.present();
  }

  async onEnableOfficeHours() {
    const currentStatus = this.userService.getOfficeHoursStatus();
    console.log('🎯 onEnableOfficeHours called, current status:', currentStatus);
    
    // Check for schedule conflicts before enabling
    if (!currentStatus) {
      const conflict = this.checkOfficeHoursConflicts();
      
      if (conflict.hasConflict) {
        // Show error alert
        const alert = await this.alertController.create({
          header: '⚠️ Schedule Conflict',
          message: conflict.message,
          buttons: ['OK']
        });
        await alert.present();
        return; // Stop here
      }
    }
    
    if (currentStatus) {
      // If currently enabled, just show simple confirmation to disable
      const alert = await this.alertController.create({
        header: 'Disable Office Hours?',
        message: 'Students will no longer be able to instantly book sessions with you.',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              console.log('❌ Office hours disable cancelled');
            }
          },
          {
            text: 'Disable',
            handler: async () => {
              console.log('✅ Disabling office hours');
              try {
                await this.userService.toggleOfficeHours(false).toPromise();
                console.log('✅ Office hours disabled');
                
                const toast = await this.toastController.create({
                  message: 'Office Hours disabled',
                  duration: 3000,
                  color: 'success',
                  icon: 'checkmark-circle'
                });
                toast.present();
              } catch (error) {
                console.error('❌ Error disabling office hours:', error);
                const toast = await this.toastController.create({
                  message: 'Failed to update office hours settings',
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
        header: '⚡ Enable Office Hours',
        message: `⚠️ Only enable this when you're ready to accept calls immediately!

When enabled:
• Students can join instantly
• You must respond within a minute
• You'll be taken to the Pre-Call Waiting Room
• You must stay on that page to remain available

💡 You'll get a full-screen prompt when a student tries to join`,
        cssClass: 'office-hours-warning-alert',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              console.log('❌ Office hours enable cancelled');
            }
          },
          {
            text: 'Enable & Go to Waiting Room',
            handler: async () => {
              console.log('✅ Enabling office hours and navigating to pre-call');
              try {
                await this.userService.toggleOfficeHours(true).toPromise();
                console.log('✅ Office hours enabled');
                
                // Show success toast
                const toast = await this.toastController.create({
                  message: '⚡ Office Hours enabled! Taking you to waiting room...',
                  duration: 2000,
                  color: 'success',
                  icon: 'flash'
                });
                await toast.present();
                
                // Navigate to pre-call page after short delay
                // For office hours, we navigate without a specific lessonId
                // The pre-call page will handle office hours mode differently
                setTimeout(() => {
                  this.router.navigate(['/pre-call'], {
                    queryParams: {
                      role: 'tutor',
                      officeHours: 'true'
                    }
                  });
                }, 2000);
              } catch (error) {
                console.error('❌ Error enabling office hours:', error);
                const toast = await this.toastController.create({
                  message: 'Failed to enable office hours',
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

    console.log('🔍 Checking office hours conflicts...', {
      now: now.toISOString(),
      bufferTime: bufferTime.toISOString(),
      eventsCount: this.mobileTimelineEvents.length
    });

    // Check all timeline events for conflicts
    for (const event of this.mobileTimelineEvents) {
      if (!event.start || !event.end) continue;
      
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);

      // Check if currently in an event
      if (now >= eventStart && now <= eventEnd) {
        console.log('⚠️ Conflict: Currently in event', event);
        const eventType = event.isClass ? 'class' : 'lesson';
        return {
          hasConflict: true,
          message: `You're currently in a ${eventType}. Please finish it before enabling office hours.`,
          nextEvent: event
        };
      }

      // Check if event starts within buffer period
      if (eventStart > now && eventStart <= bufferTime) {
        const minutesUntil = Math.round((eventStart.getTime() - now.getTime()) / (60 * 1000));
        console.log('⚠️ Conflict: Event starting soon', { event, minutesUntil });
        const eventType = event.isClass ? 'class' : 'lesson';
        return {
          hasConflict: true,
          message: `You have a ${eventType} starting in ${minutesUntil} minute${minutesUntil !== 1 ? 's' : ''}. Please wait until after it ends.`,
          nextEvent: event
        };
      }
    }

    console.log('✅ No conflicts found');
    return { hasConflict: false };
  }

  onSetUpAvailability(date?: Date, timeSlot?: TimelineEntry) {
    
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
          queryParams.startHour = startTime.getHours();
          queryParams.startMinute = startTime.getMinutes();
        }
        if (timeSlot.end) {
          const endTime = timeSlot.end;
          queryParams.endHour = endTime.getHours();
          queryParams.endMinute = endTime.getMinutes();
        }
        if (timeSlot.durationMinutes) {
          queryParams.duration = timeSlot.durationMinutes;
        }
      }
      
      this.router.navigate(['/tabs/availability-setup', dateStr], { queryParams });
    } else {
      // Fallback to general availability setup if no date provided
      this.router.navigate(['/tabs/availability-setup']);
    }
  }

  connectGoogleCalendar() {
    // TODO: Implement Google Calendar integration
  }

  // Method to refresh calendar when returning from availability setup
  refreshCalendar() {
    console.log('🔄 [REFRESH] refreshCalendar() called');
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
    console.log('🔄 [FORCE-REFRESH-AVAIL] forceRefreshAvailability() called');
    
    if (!this.currentUser) {
      console.warn('📅 No current user for availability refresh');
      return;
    }

    // DON'T clear all events - only update availability, preserve lessons/classes
    // this.events = [];  // REMOVED
    
    // Force reload availability data
    this.userService.getAvailability().subscribe({
      next: (res) => {
        console.log('📅 [FORCE-REFRESH-AVAIL] Got availability data');
        
        // Remove old availability events, keep lessons and classes
        const nonAvailabilityEvents = this.events.filter(event => {
          const extendedProps = event.extendedProps as any;
          return extendedProps?.type !== 'availability' && extendedProps?.isLesson !== undefined || extendedProps?.isClass;
        });
        
        if (res.availability && res.availability.length > 0) {
          const availEvents = res.availability.map(b => this.blockToEvent(b));
          this.events = [...availEvents, ...nonAvailabilityEvents];
        } else {
          this.events = nonAvailabilityEvents;
        }
        
        // Update calendar display
        if (this.isMobileView) {
          // Mobile view: update mobile timeline and agenda
          this.buildMobileTimeline();
          this.buildMobileAgenda();
        } else if (this.calendar && this.isInitialized) {
          // Desktop view: update FullCalendar
          this.updateCalendarEvents();
        } else {
          this.forceReinitializeCalendar();
        }
        
        // Also reload lessons to ensure complete data
        if (this.currentUser?.id) {
          this.loadLessonsAndClasses(this.currentUser.id);
        }
      },
      error: (error) => {
        console.error('❌ Error force refreshing availability:', error);
        // Try to reinitialize calendar as fallback
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
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
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
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const displayMinute = minute === 0 ? '00' : minute.toString().padStart(2, '0');
    return `${displayHour}:${displayMinute} ${period}`;
  }

  // 12-hour compact range for event chip, e.g. "12:00–12:30 AM"
  private formatCompactRange(start: Date, end: Date): string {
    const s = this.formatTimeParts(start);
    const e = this.formatTimeParts(end);
    if (s.period === e.period) {
      return `${s.time}–${e.time} ${s.period}`;
    }
    return `${s.time} ${s.period}–${e.time} ${e.period}`;
  }

  // Ultra-compact for tiny chips, e.g. "12–12:30a" or "12a" when 15–20px tall
  private formatTinyRange(start: Date, end: Date): string {
    const s = this.formatTimeParts(start);
    const e = this.formatTimeParts(end);
    const sp = s.period === 'AM' ? 'a' : 'p';
    const ep = e.period === 'AM' ? 'a' : 'p';
    // Drop minutes when :00 on start to save space
    const sTime = s.time.endsWith(':00') ? s.time.replace(':00', '') : s.time;
    const eTime = e.time.endsWith(':00') ? e.time.replace(':00', '') : e.time;
    if (s.period === e.period) {
      return `${sTime}–${eTime}${sp}`;
    }
    return `${sTime}${sp}–${eTime}${ep}`;
  }

  private formatTimeParts(d: Date): { time: string; period: string } {
    const hour = d.getHours();
    const minute = d.getMinutes();
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const displayMinute = minute.toString().padStart(2, '0');
    return { time: `${displayHour}:${displayMinute}`, period };
  }

  isScreenLocked(): boolean {
    return this.showMobileSettings || this.panelAnimating;
  }
  
  // Load participant's availability for reschedule mode
  private loadParticipantAvailability(participantId: string) {
    console.log('📅 Loading availability for participant:', participantId);
    
    this.userService.getTutorAvailability(participantId).subscribe({
      next: (response) => {
        if (response.success && response.availability) {
          this.participantAvailability = response.availability;
          console.log('✅ Loaded participant availability:', this.participantAvailability);
          
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
    console.log('📅 Refreshing calendar for reschedule mode');
  }

  // Navigate to event details page
  onEventClick(item: TimelineEntry) {
    if (!item.id || item.type === 'free') {
      return; // Don't navigate for free slots or items without ID
    }
    
    // Navigate to the event details page
    this.router.navigate(['/tabs/tutor-calendar/event', item.id]);
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
      console.log('🔄 [INIT] Reloading availability for displayed week');
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
        shortDay: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNumber: date.getDate().toString(),
        dayName: date.toLocaleDateString('en-US', { weekday: 'long' })
      });
    }
  }
  
  private updateSelectedDayForDayView(date: Date) {
    this.selectedDayForDayView = {
      date: new Date(date),
      shortDay: date.toLocaleDateString('en-US', { weekday: 'short' }),
      dayNumber: date.getDate().toString(),
      dayName: date.toLocaleDateString('en-US', { weekday: 'long' }),
      monthLabel: date.toLocaleDateString('en-US', { month: 'long' }),
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
    
    // Only calculate for the calendar's visible hours (6 AM to 11 PM)
    const dayStart = new Date(this.selectedDayForDayView.date);
    dayStart.setHours(6, 0, 0, 0); // Start at 6 AM
    const dayEnd = new Date(this.selectedDayForDayView.date);
    dayEnd.setHours(23, 0, 0, 0); // End at 11 PM
    
    let totalAvailableMinutes = 0;
    let totalBookedMinutes = 0;
    
    console.log('🔍 Calculating free hours for:', this.selectedDayForDayView.date);
    console.log('🔍 Total events:', this.events?.length || 0);
    
    // Loop through all events for this day
    for (const event of this.events || []) {
      if (!event.start || !event.end) continue;
      
      const eventStart = new Date(event.start as string | number | Date);
      const eventEnd = new Date(event.end as string | number | Date);
      
      if (isNaN(eventStart.getTime()) || isNaN(eventEnd.getTime())) continue;
      
      // Check if event overlaps with this day's visible hours
      if (eventStart >= dayEnd || eventEnd <= dayStart) continue;
      
      // Clamp to visible hours
      const clampedStart = eventStart.getTime() < dayStart.getTime() ? dayStart : eventStart;
      const clampedEnd = eventEnd.getTime() > dayEnd.getTime() ? dayEnd : eventEnd;
      const durationMinutes = Math.round((clampedEnd.getTime() - clampedStart.getTime()) / 60000);
      
      const extended = (event.extendedProps as any) || {};
      // Check for 'available' (not 'availability')
      const isAvailability = extended.type === 'available';
      const isLesson = Boolean(extended.lessonId);
      const isClass = Boolean(extended.classId || extended.isClass);
      
      if (isAvailability) {
        // Count availability blocks
        totalAvailableMinutes += durationMinutes;
        console.log('✅ Found availability:', durationMinutes, 'min', eventStart, '-', eventEnd);
      } else if (isLesson || isClass) {
        // Count booked lessons/classes
        totalBookedMinutes += durationMinutes;
        console.log('📚 Found lesson/class:', durationMinutes, 'min', eventStart, '-', eventEnd);
      }
    }
    
    console.log('📊 Total available:', totalAvailableMinutes, 'min');
    console.log('📊 Total booked:', totalBookedMinutes, 'min');
    
    // Available but not booked = total availability - booked lessons
    const freeMinutes = Math.max(0, totalAvailableMinutes - totalBookedMinutes);
    const freeHours = Math.round((freeMinutes / 60) * 10) / 10;
    
    console.log('📊 Free hours result:', freeHours);
    
    // Convert to hours (rounded to 1 decimal place)
    return freeHours;
  }
  
  private generateTimeSlots() {
    this.timeSlots = [];
    // Generate from 6 AM to 11 PM (hour 6 to hour 23)
    for (let hour = 6; hour <= 23; hour++) {
      const period = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      this.timeSlots.push(`${displayHour} ${period}`);
    }
    console.log('Time slots generated:', this.timeSlots.length, this.timeSlots);
  }
  
  private updateWeekTitle() {
    const startMonth = this.currentWeekStart.toLocaleDateString('en-US', { month: 'long' });
    const endDate = new Date(this.currentWeekStart);
    endDate.setDate(this.currentWeekStart.getDate() + 6);
    const endMonth = endDate.toLocaleDateString('en-US', { month: 'long' });
    
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
      // Regenerate availability events for the new week
      this.loadAndUpdateCalendarData();
    } else {
      // Day view - go back one day
      const newDate = new Date(this.selectedDayForDayView.date);
      newDate.setDate(newDate.getDate() - 1);
      this.updateSelectedDayForDayView(newDate);
    }
  }
  
  navigateNext() {
    if (this.customView === 'week') {
      this.currentWeekStart.setDate(this.currentWeekStart.getDate() + 7);
      this.updateWeekDays();
      this.updateWeekTitle();
      // Regenerate availability events for the new week
      this.loadAndUpdateCalendarData();
    } else {
      // Day view - go forward one day
      const newDate = new Date(this.selectedDayForDayView.date);
      newDate.setDate(newDate.getDate() + 1);
      this.updateSelectedDayForDayView(newDate);
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
    
    const filteredEvents = this.events.filter(event => {
      if (!event.start) return false;
      const eventStart = new Date(event.start as any);
      const isInRange = eventStart >= dayStart && eventStart <= dayEnd;
      
      // Show lessons AND availability blocks (experimenting with showing availability)
      const extendedProps = (event.extendedProps || {}) as any;
      const isAvailability = extendedProps.type === 'availability' || extendedProps.type === 'available';
      const isLesson = extendedProps.lessonId || extendedProps.lesson || extendedProps.classId;
      
      // Debug logging for first day
      if (day.dayNumber === 23 && isAvailability) {
        console.log('🟢 [AVAIL-DEBUG] Found availability event:', {
          title: event.title,
          type: extendedProps.type,
          start: eventStart,
          isInRange
        });
      }
      
      // Show both lessons and availability
      return isInRange && (isLesson || isAvailability);
    }).map(event => {
      const extendedProps = (event.extendedProps || {}) as any;
      const studentName = extendedProps.studentName || extendedProps.student?.name || '';
      const formattedName = this.formatNameWithInitial(studentName);
      const isAvailability = extendedProps.type === 'availability' || extendedProps.type === 'available';
      
      return {
        ...event,
        title: isAvailability ? 'Available' : (event.title || 'Untitled Event'),
        studentName: isAvailability ? '' : formattedName,
        studentAvatar: isAvailability ? '' : (extendedProps.studentAvatar || extendedProps.student?.profilePicture || ''),
        isAvailability: isAvailability,
        isClass: extendedProps.isClass || extendedProps.classId,
        start: new Date(event.start as any),
        end: new Date(event.end as any)
      };
    });
    
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
    const startHour = event.start.getHours();
    const startMinute = event.start.getMinutes();
    const startOffset = 6; // Calendar starts at 6 AM
    const slotHeight = 70; // 70px per hour (increased from 60px)
    
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
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const startOffset = 6; // Calendar starts at 6 AM
    const slotHeight = 110; // 110px per hour (must match CSS .hour-line height)
    
    this.currentTimePosition = ((currentHour - startOffset) * slotHeight) + (currentMinute / 60 * slotHeight);
    
    console.log('🕐 [TIME-DEBUG] Time indicator:', {
      now: now.toLocaleTimeString(),
      currentHour,
      currentMinute,
      startOffset,
      calculatedPosition: this.currentTimePosition,
      expectedHourFromTop: (currentHour - startOffset)
    });
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
    const className = upcomingClass.title || 'Class';
    
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
}

