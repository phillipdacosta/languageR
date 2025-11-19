import { Component, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter, ViewDidEnter } from '@ionic/angular';
import { Router, NavigationEnd } from '@angular/router';
import { UserService, User } from '../services/user.service';
import { LessonService, Lesson } from '../services/lesson.service';
import { Calendar, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { filter } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { PlatformService } from '../services/platform.service';
import { trigger, state, style, transition, animate, query, stagger } from '@angular/animations';

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
  imports: [CommonModule, IonicModule, FormsModule],
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
  
  // Custom full-width now indicator state
  enableCustomNowIndicator = false;
  customNowVisible = false;
  customNowTop = 0;
  customNowLeft = 0;
  customNowWidth = 0;
  private customNowInterval: any;
  
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

  constructor(
    private userService: UserService,
    private lessonService: LessonService,
    private router: Router,
    private platformService: PlatformService
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

    // First, separate lessons from availability blocks
    const lessons: TimelineEntry[] = [];
    const availabilityBlocks: TimelineEntry[] = [];

    for (const entry of entries) {
      // Check if this is a lesson (has avatar or subtitle which indicates student info)
      const isLesson = entry.avatarUrl || entry.subtitle;
      
      if (isLesson) {
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
    this.mobileTimeline = this.buildDayEntries(dayStart, dayEnd);
    
    // Debug: Log all timeline entries for the selected day
    console.log('📅 Building mobile timeline for:', activeDay.date.toLocaleDateString());
    console.log('📋 All timeline entries:', this.mobileTimeline.map(item => ({
      type: item.type,
      title: item.title,
      subtitle: item.subtitle,
      start: item.start.toLocaleString(),
      hasAvatar: !!item.avatarUrl
    })));
    
    // Filter to only actual lessons (exclude free time slots and availability blocks)
    // Lessons have subtitles, avatarUrls, or titles that aren't "Available"/"Open time slot"
    this.mobileTimelineEvents = this.mobileTimeline.filter(item => {
      if (item.type !== 'event') return false;
      // Exclude availability blocks (they have "Available" or "Open time slot" as title and no lesson indicators)
      const isAvailabilityBlock = (item.title === 'Available' || item.title === 'Open time slot') && 
                                 !item.subtitle && 
                                 !item.avatarUrl;
      return !isAvailabilityBlock;
    });
    
    // Debug: Log filtered events
    console.log('✅ Filtered lesson events:', this.mobileTimelineEvents.map(item => ({
      title: item.title,
      subtitle: item.subtitle,
      start: item.start.toLocaleString()
    })));
  }

  private collectEventsForDay(dayStart: Date, dayEnd: Date): TimelineEntry[] {
    const results: TimelineEntry[] = [];
    
    for (const event of this.events || []) {
      if (!event.start || !event.end) {
        continue;
      }
      const rawStart = new Date(event.start as string | number | Date);
      const rawEnd = new Date(event.end as string | number | Date);
      if (isNaN(rawStart.getTime()) || isNaN(rawEnd.getTime())) {
        continue;
      }
      
      if (rawStart >= dayEnd || rawEnd <= dayStart) {
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
    
    // Debug logging for the 12:00-1:00 PM slot
    const debugStartTimeStr = start.toLocaleTimeString();
    const debugEndTimeStr = end.toLocaleTimeString();
    if (debugStartTimeStr.includes('12:00') || debugEndTimeStr.includes('1:00')) {
      console.log('🔍 Building timeline event for 12:00-1:00 PM slot:', {
        eventTitle: event.title,
        isLesson,
        lessonId: extended.lessonId,
        studentName: extended.studentName,
        studentDisplayName: extended.studentDisplayName,
        backgroundColor: event.backgroundColor,
        extendedProps: extended
      });
    }
    
    const title = isLesson ? (extended.studentDisplayName || extended.studentName || 'Lesson') : (event.title || extended.subject || 'Available');
    const subtitle = isLesson ? (extended.subject || extended.status) : (extended.studentName || extended.subject);
    const meta = isLesson ? this.formatDuration(durationMinutes) : (extended.timeStr || extended.status);
    // Availability blocks should be blue (#007bff), lessons use their status color
    const color = isLesson ? ((event.backgroundColor as string) || '#10b981') : '#007bff';
    const location = extended.location || extended.platform;
    const avatarUrl = isLesson ? extended.studentAvatar : undefined;
    
    // Check if event is in the past
    const now = new Date();
    const isPast = end.getTime() < now.getTime();

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
      isPast
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
    this.evaluateViewport();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.viewportResizeHandler);
    }
    if (this.isMobileView) {
      this.setupMobileDays(new Date());
      this.buildMobileTimeline();
    }
    this.loadCurrentUser();
    
    // Fallback: Initialize calendar after 2 seconds if user loading fails
    setTimeout(() => {
      if (!this.isInitialized) {
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
    this.customNowInterval = setInterval(() => this.updateCustomNowIndicator(), 60_000);
    window.addEventListener('resize', this.updateCustomNowIndicatorBound);
    
  }
  

  ngAfterViewInit() {
    console.log('📅 ngAfterViewInit called');
    if (this.isMobileView) {
      console.log('📅 Mobile view detected - skipping FullCalendar initialization');
      this.buildMobileTimeline();
      return;
    }
    
    // Immediate simple test
    const calendarEl = document.getElementById('tutor-calendar-container');
    console.log('📅 Container found in ngAfterViewInit:', !!calendarEl);
    console.log('📅 Container dimensions in ngAfterViewInit:', {
      width: calendarEl?.offsetWidth,
      height: calendarEl?.offsetHeight,
      clientWidth: calendarEl?.clientWidth,
      clientHeight: calendarEl?.clientHeight
    });
    
    // Then try to initialize calendar after delay
    setTimeout(() => {
      this.initCalendar();
    }, 2000);
  }

  ngOnDestroy() {
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
    window.removeEventListener('resize', this.updateCustomNowIndicatorBound);
    
    // Clean up session storage
  }

  ionViewWillEnter() {
    console.log('Tutor calendar page will enter');
    // Reset initialization attempts when entering the page
    this.initializationAttempts = 0;
  }

  ionViewDidEnter() {
    console.log('Tutor calendar page did enter');
    console.log('📅 Current user state:', this.currentUser);
    
    // Check if we're coming from availability setup
    const currentUrl = this.router.url;
    console.log('📅 Current URL:', currentUrl);
    
    // Check for refresh parameter from availability setup
    const urlParams = new URLSearchParams(window.location.search);
    const shouldRefreshAvailability = urlParams.get('refreshAvailability') === 'true';
    
    if (shouldRefreshAvailability) {
      console.log('🔄 Detected return from availability setup - forcing refresh...');
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
      console.warn('📅 No user found, reloading user...');
      this.loadCurrentUser();
    }
  }

  ionViewWillLeave() {
    console.log('Tutor calendar page will leave');
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
        console.log('📅 Current user loaded for calendar:', user);
        
        // Initialize calendar first, then load data
        if (!this.isInitialized) {
          this.initializeCalendarWithData();
        } else {
          // Calendar already initialized, just load data
          this.loadAndUpdateCalendarData();
        }
        
        // Load lessons after user is loaded
        if (user && user.id) {
          this.loadLessons(user.id);
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
    console.log('📅 Loading lessons for tutor:', tutorId);
    // Fetch all lessons (including past ones)
    this.lessonService.getLessonsByTutor(tutorId, true).subscribe({
      next: (response) => {
        if (response.success && response.lessons) {
          console.log(`📅 Loaded ${response.lessons.length} lessons`);
          this.convertLessonsToEvents(response.lessons);
          this.updateCalendarEvents();
        }
      },
      error: (error) => {
        console.error('📅 Error loading lessons:', error);
      }
    });
  }

  private convertLessonsToEvents(lessons: Lesson[]): void {
    // Convert lessons to events but don't replace existing events (availability/classes)
    console.log('🔍 Converting lessons to events:', lessons.length, 'lessons');
    
    const lessonEvents = lessons.map(lesson => {
      const student = lesson.studentId as any;
      const studentFirst = typeof student?.firstName === 'string' ? student.firstName.trim() : '';
      const studentLast = typeof student?.lastName === 'string' ? student.lastName.trim() : '';
      const studentFullName = [studentFirst, studentLast].filter(Boolean).join(' ');
      const studentName = studentFullName || student?.name || student?.displayName || student?.email || 'Student';
      const subject = lesson.subject || 'Language Lesson';
      
      // Debug logging for 12:00 PM lesson
      const debugStartTime = new Date(lesson.startTime);
      if (debugStartTime.getHours() === 12 && debugStartTime.getMinutes() === 0) {
        console.log('🔍 Converting 12:00 PM lesson:', {
          id: lesson._id,
          lessonId: lesson._id,
          startTime: lesson.startTime,
          endTime: lesson.endTime,
          status: lesson.status,
          studentId: lesson.studentId,
          student: lesson.studentId,
          studentName: studentName
        });
      }
      
      // Determine color based on status
      let backgroundColor = '#667eea'; // Default purple
      let borderColor = '#5568d3';
      
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
        textColor: '#ffffff',
        classNames: [isPast ? 'is-past' : 'is-future', 'calendar-lesson-event'],
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
          notes: lesson.notes
        }
      } as EventInput;
      
      // Debug logging for 12:00 PM lesson event creation
      if (debugStartTime.getHours() === 12 && debugStartTime.getMinutes() === 0) {
        console.log('🔍 Created event for 12:00 PM lesson:', {
          eventId: eventData.id,
          eventTitle: eventData.title,
          lessonIdInProps: eventData.extendedProps?.['lessonId'],
          studentNameInProps: eventData.extendedProps?.['studentName'],
          backgroundColor: eventData.backgroundColor
        });
      }
      
      return eventData;
    });
    
    // Merge lesson events with existing events (availability/classes)
    // Remove any existing lesson events first to avoid duplicates
    const nonLessonEvents = this.events.filter(event => !event.extendedProps?.['lessonId']);
    this.events = [...nonLessonEvents, ...lessonEvents];
    
    console.log(`📅 Converted ${lessons.length} lessons to events, total events: ${this.events.length}`);
    
    // Debug: Check what 12:00 PM events exist in this.events
    const noon12Events = this.events.filter(event => {
      if (!event.start) return false;
      const eventStart = new Date(event.start as string | number | Date);
      return eventStart.getHours() === 12 && eventStart.getMinutes() === 0;
    });
    
    console.log('🔍 12:00 PM events in this.events array:', noon12Events.map(event => ({
      title: event.title,
      id: event.id,
      backgroundColor: event.backgroundColor,
      extendedProps: event.extendedProps,
      hasLessonId: !!event.extendedProps?.['lessonId']
    })));
  }

  private initCalendar(): boolean {
    if (this.isMobileView) {
      console.log('📅 Skipping FullCalendar init on mobile view');
      this.isInitialized = false;
      return false;
    }
    // Prevent multiple initialization attempts
    if (this.initializationAttempts > 3) {
      console.warn('📅 Too many initialization attempts, stopping');
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

    console.log('Initializing FullCalendar...');
    console.log('Calendar container found:', calendarEl);
    console.log('Container dimensions:', {
      width: calendarEl.offsetWidth,
      height: calendarEl.offsetHeight,
      clientWidth: calendarEl.clientWidth,
      clientHeight: calendarEl.clientHeight
    });
    console.log('Current events:', this.events);
    
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
      console.log('FullCalendar initialized successfully');
      console.log('Calendar instance:', this.calendar);
      
      // Force a re-render after a short delay to ensure it's visible
      setTimeout(() => {
        if (this.calendar) {
          this.calendar.updateSize();
          this.calendar.render();
          console.log('Calendar updated size and re-rendered');
          
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
  }

  private forceReinitializeCalendar() {
    console.log('🔄 Force re-initializing calendar...');
    
    // Only destroy if calendar exists and is initialized
    if (this.calendar && this.isInitialized) {
      console.log('Destroying existing calendar...');
      this.calendar.destroy();
      this.calendar = undefined;
      this.isInitialized = false;
    }
    
    // Clear events array
    this.events = [];
    
    // Multiple attempts to ensure calendar renders
    this.attemptCalendarInitialization(0);
  }

  private attemptCalendarInitialization(attempt: number) {
    const maxAttempts = 5;
    const delay = Math.min(200 * Math.pow(2, attempt), 2000); // Exponential backoff, max 2s
    
    console.log(`🔄 Calendar initialization attempt ${attempt + 1}/${maxAttempts} (delay: ${delay}ms)`);
    
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
      console.log('Container dimensions:', {
        width: calendarEl.offsetWidth,
        height: calendarEl.offsetHeight,
        hasDimensions
      });
      
      if (!hasDimensions && attempt < maxAttempts - 1) {
        console.warn(`Container has no dimensions (attempt ${attempt + 1}), retrying...`);
        this.attemptCalendarInitialization(attempt + 1);
        return;
      }
      
      // Try to initialize calendar
      this.initializeCalendarWithData();
      
    }, delay);
  }

  private initializeCalendarWithData() {
    console.log('🔄 Initializing calendar with data...');
    
    // First try to initialize calendar (skip when mobile)
    const success = this.isMobileView ? true : this.initCalendar();
    
    if (!success && !this.isMobileView) {
      console.error('📅 Calendar initialization failed');
      return;
    }
    
    // Then load data and update calendar (if user exists)
    this.loadAndUpdateCalendarData();
    
    // Load lessons if we have a user
    if (this.currentUser && this.currentUser.id) {
      this.loadLessons(this.currentUser.id);
    }
    
    if (this.isMobileView) {
      this.buildMobileTimeline();
    }
  }

  private loadAndUpdateCalendarData() {
    if (this.currentUser) {
      console.log('🔄 Loading availability data...');
      console.log('📅 Current user:', this.currentUser);
      
      // Preserve user state before making API call
      const preservedUser = { ...this.currentUser };
      
      this.userService.getAvailability().subscribe({
        next: (res) => {
          console.log('📅 Raw availability response:', res);
          console.log('📅 Availability array:', res.availability);
          console.log('📅 Availability length:', res.availability?.length || 0);
          
          // Restore user state if it was lost
          if (!this.currentUser) {
            console.warn('📅 User state lost during API call, restoring...');
            this.currentUser = preservedUser;
          }
          
          if (!res.availability || res.availability.length === 0) {
            console.warn('📅 No availability data found');
            this.events = [];
            this.updateCalendarEvents();
            
            // Update mobile views even when no data
            if (this.isMobileView) {
              console.log('📱 Updating mobile views with empty data...');
              this.buildMobileTimeline();
              this.buildMobileAgenda();
            }
            return;
          }
          
          this.events = res.availability.map((b, index) => {
            return this.blockToEvent(b);
          });
          console.log('📅 Total events loaded:', this.events.length);
          
          // Update calendar with events smoothly
          this.updateCalendarEvents();
          
          // Also update mobile views if in mobile mode
          if (this.isMobileView) {
            console.log('📱 Also updating mobile views...');
            this.buildMobileTimeline();
            this.buildMobileAgenda();
          }
        },
        error: (error) => {
          console.error('📅 Error loading availability:', error);
          console.error('📅 Error details:', error.error);
          console.error('📅 Error status:', error.status);
          
          // Restore user state if it was lost
          if (!this.currentUser) {
            console.warn('📅 User state lost during API call, restoring...');
            this.currentUser = preservedUser;
          }
        }
      });
    } else {
      console.warn('📅 No current user found, initializing empty calendar');
      this.events = [];
      this.updateCalendarEvents();
      
      // Update mobile views even when no user
      if (this.isMobileView) {
        console.log('📱 Updating mobile views with empty data (no user)...');
        this.buildMobileTimeline();
        this.buildMobileAgenda();
      }
    }
  }

  private updateCalendarEvents() {
    console.log('📅 Updating calendar events...');
    console.log('📅 Calendar instance exists:', !!this.calendar);
    console.log('📅 Events to add:', this.events);
    
    if (this.calendar) {
      // Add loading class for smooth transition
      const calendarEl = document.querySelector('.fc');
      if (calendarEl) {
        calendarEl.classList.add('fc-loading');
        console.log('📅 Added loading class to calendar');
      }
      
      // Update events
      console.log('📅 Removing all existing events...');
      this.calendar.removeAllEvents();
      
      // Force calendar to re-render after clearing events
      this.calendar.render();
      
      console.log('📅 Adding new events...');
      console.log('📅 Events to add:', this.events.map(e => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        backgroundColor: e.backgroundColor
      })));
      this.calendar.addEventSource(this.events);
      console.log('📅 Events added to calendar');
      
      // Use proper FullCalendar API refresh
      setTimeout(() => {
        if (this.calendar) {
          this.calendar.updateSize();
          this.calendar.render();
          console.log('📅 Calendar updated size and re-rendered');
          this.updateCustomNowIndicator();
        }
      }, 0);
      
      // Verify events were added
      setTimeout(() => {
        if (this.calendar) {
          const allEvents = this.calendar.getEvents();
          console.log('📅 Calendar now has events:', allEvents.length);
          if (allEvents.length > 0) {
            console.log('📅 Sample events:', allEvents.slice(0, 3).map(e => ({
              id: e.id,
              title: e.title,
              start: e.startStr,
              end: e.endStr,
              display: e.display
            })));
          } else {
            console.warn('📅 ⚠️ No events found in calendar after adding!');
            console.log('📅 Original events array:', this.events.length, 'events');
            console.log('📅 Calendar view:', {
              type: this.calendar.view.type,
              start: this.calendar.view.activeStart.toDateString(),
              end: this.calendar.view.activeEnd.toDateString()
            });
            console.log('📅 Sample original event:', this.events[0]);
          }
        }
      }, 100);
      
      // Remove loading class after a short delay
      setTimeout(() => {
        if (calendarEl) {
          calendarEl.classList.remove('fc-loading');
          calendarEl.classList.add('fc-loaded');
          console.log('📅 Removed loading class, added loaded class');
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

    if (this.isMobileView) {
      this.buildMobileTimeline();
    }
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
    console.log('Re-initializing calendar after navigation...');
    
    // Force destroy existing calendar
    if (this.calendar) {
      this.calendar.destroy();
      this.calendar = undefined;
      this.isInitialized = false;
    }
    
    // First load the data, then initialize calendar
    if (this.currentUser) {
      console.log('🔄 Reloading availability data...');
      this.userService.getAvailability().subscribe({
        next: (res) => {
          console.log('📅 Raw availability data:', res);
          this.events = (res.availability || []).map(b => {
            const event = this.blockToEvent(b);
            console.log('📅 Converted block to event:', b, '->', event);
            return event;
          });
          console.log('📅 Final events array:', this.events);
          
                  // Now initialize calendar with the loaded events
                  setTimeout(() => {
                    this.initCalendar();
                    // Force refresh after initialization
                    setTimeout(() => {
                      if (this.calendar) {
                        this.calendar.updateSize();
                        this.calendar.render();
                        console.log('📅 Calendar refreshed after reinitialization');
                      }
                    }, 0);
                    console.log('📅 Calendar initialized with events');
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

  handleEventClick(clickInfo: any) {
    const event = clickInfo.event;
    const extendedProps = event.extendedProps;
    
    // Check if this is a lesson event (has lessonId) or an availability block
    if (extendedProps?.lessonId) {
      // Save current view before navigating
      if (this.calendar) {
        const currentView = this.calendar.view.type;
        localStorage.setItem('tutor-calendar-view', currentView);
      }
      // This is a lesson - navigate to event details page
      this.router.navigate(['/tabs/tutor-calendar/event', extendedProps.lessonId]);
    } else {
      // This is an availability block - keep existing delete behavior
      if (confirm('Delete this availability block?')) {
        clickInfo.event.remove();
        this.deleteEvent(clickInfo.event.id);
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
        console.log('📅 Availability updated:', response);
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
        console.log('📅 Availability updated after delete:', response);
      },
      error: (error) => {
        console.error('📅 Error updating availability after delete:', error);
      }
    });
  }

  // Mapping helpers
  private blockToEvent(b: any): EventInput {
    // Process availability block
    console.log('📅 Converting block to event:', {
      blockId: b.id,
      day: b.day,
      startTime: b.startTime,
      endTime: b.endTime,
      type: b.type
    });
    
    // Prefer absolute one-off dates when provided (e.g., classes)
    let start: Date;
    let end: Date;
    if (b.absoluteStart && b.absoluteEnd) {
      start = new Date(b.absoluteStart);
      end = new Date(b.absoluteEnd);
      console.log('📅 Using absolute dates for class/lesson');
    } else {
      // Weekly availability: map to current week
      const today = new Date();
      
      // Calculate the start of the current week (Sunday)
      const currentDay = today.getDay();
      const sundayOffset = -currentDay; // Sunday is 0, so offset from current day
      const sunday = new Date(today);
      sunday.setDate(today.getDate() + sundayOffset);
      sunday.setHours(0, 0, 0, 0);
      
      // Add the day index directly to Sunday to get the correct day
      const dayDate = new Date(sunday);
      dayDate.setDate(sunday.getDate() + b.day);
      
      start = this.withTime(dayDate, b.startTime);
      end = this.withTime(dayDate, b.endTime);
      
      console.log('📅 Mapped availability:', {
        day: b.day,
        dayName: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][b.day],
        date: dayDate.toDateString(),
        time: `${b.startTime}-${b.endTime}`
      });
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
      ]
    };
    
    // Log class events for debugging
    if (b.type === 'class') {
      console.log(`🎓 Class event: ${event.title} at ${event.start}`);
    }
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
    console.log('Schedule lesson clicked');
    this.router.navigate(['/tabs/tutor-calendar/schedule-class']);
  }

  onAddTimeOff() {
    console.log('Add time off clicked');
    // TODO: Implement time off modal
  }

  onAddExtraSlots() {
    console.log('Add extra slots clicked');
    // TODO: Implement extra slots modal
  }

  onSetUpAvailability(date?: Date) {
    console.log('Set up availability clicked', date ? `for date: ${date.toDateString()}` : '');
    
    if (date) {
      // Format date as YYYY-MM-DD using local timezone to avoid UTC conversion issues
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const dayOfMonth = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${dayOfMonth}`;
      
      console.log('Navigating to availability setup for date:', dateStr);
      this.router.navigate(['/tabs/availability-setup', dateStr]);
    } else {
      // Fallback to general availability setup if no date provided
      this.router.navigate(['/tabs/availability-setup']);
    }
  }

  connectGoogleCalendar() {
    console.log('Connect Google Calendar clicked');
    // TODO: Implement Google Calendar integration
  }

  // Method to refresh calendar when returning from availability setup
  refreshCalendar() {
    if (this.calendar && this.isInitialized) {
      console.log('🔄 Force refreshing calendar data...');
      this.loadAndUpdateCalendarData();
    } else {
      console.log('🔄 Calendar not initialized, reinitializing...');
      this.forceReinitializeCalendar();
    }
  }

  // Force refresh availability data after saving from availability setup
  private forceRefreshAvailability() {
    console.log('🔄 Force refreshing availability after setup...');
    
    if (!this.currentUser) {
      console.warn('📅 No current user for availability refresh');
      return;
    }

    // Clear existing events to avoid stale data
    this.events = [];
    
    // Force reload availability data
    this.userService.getAvailability().subscribe({
      next: (res) => {
        console.log('📅 Fresh availability data loaded:', res.availability?.length || 0, 'blocks');
        
        if (res.availability && res.availability.length > 0) {
          this.events = res.availability.map(b => this.blockToEvent(b));
          console.log('📅 Converted to', this.events.length, 'calendar events');
        } else {
          this.events = [];
          console.log('📅 No availability blocks found');
        }
        
        // Update calendar display
        if (this.isMobileView) {
          // Mobile view: update mobile timeline and agenda
          console.log('📱 Updating mobile calendar views...');
          this.buildMobileTimeline();
          this.buildMobileAgenda();
          console.log('✅ Mobile calendar views updated successfully');
        } else if (this.calendar && this.isInitialized) {
          // Desktop view: update FullCalendar
          this.updateCalendarEvents();
          console.log('✅ Desktop calendar events updated successfully');
        } else {
          console.log('🔄 Calendar not ready, reinitializing...');
          this.forceReinitializeCalendar();
        }
        
        // Also reload lessons to ensure complete data
        if (this.currentUser?.id) {
          this.loadLessons(this.currentUser.id);
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
    console.log('🔄 Refreshing calendar data after navigation...');
    console.log('📅 User state before refresh:', this.currentUser);
    console.log('📅 Is mobile view:', this.isMobileView);
    
    // Handle mobile view refresh
    if (this.isMobileView) {
      console.log('📅 Refreshing mobile view...');
      this.loadAndUpdateCalendarData();
      // Reload lessons if we have a user
      if (this.currentUser && this.currentUser.id) {
        this.loadLessons(this.currentUser.id);
      }
      return;
    }
    
    // Handle desktop view refresh
    if (this.calendar && this.isInitialized) {
      console.log('📅 Calendar exists and is initialized, refreshing data...');
      this.loadAndUpdateCalendarData();
      // Reload lessons if we have a user
      if (this.currentUser && this.currentUser.id) {
        this.loadLessons(this.currentUser.id);
      }
    } else {
      console.log('📅 Calendar not ready, initializing...');
      this.forceReinitializeCalendar();
    }
  }

  onHelpClick() {
    console.log('Help clicked');
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
      
      console.log('📅 Calendar visibility check:');
      console.log('📅 Calendar dimensions:', {
        width: calendarRect.width,
        height: calendarRect.height,
        visible: calendarRect.width > 0 && calendarRect.height > 0
      });
      console.log('📅 Container dimensions:', {
        width: containerRect.width,
        height: containerRect.height
      });
      
      // If calendar has no dimensions, log warning
      if (calendarRect.width === 0 || calendarRect.height === 0) {
        console.warn('📅 Calendar has no dimensions');
      }
    } else {
      console.warn('📅 Calendar or container element not found for visibility check');
    }
  }

  private forceCalendarVisibility(calendarEl: HTMLElement) {
    console.log('📅 Forcing calendar visibility...');
    
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
      console.log('📅 Container dimensions forced');
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
    
    console.log('📅 Calendar visibility forced');
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
}

