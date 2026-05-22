import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit, Input, Output, EventEmitter, OnChanges, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController, AlertController, NavController } from '@ionic/angular';
import { Router, NavigationExtras } from '@angular/router';
import { UserService } from '../../services/user.service';
import { LessonService } from '../../services/lesson.service';
import { ClassService } from '../../services/class.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { getTimezoneLabel } from '../../shared/timezone.utils';
import { fromZonedTime } from 'date-fns-tz';
import { trigger, state, style, transition, animate } from '@angular/animations';

interface TimeSlot {
  index: number; // 0..47 (30-minute increments)
  display: string; // HH:mm
}

interface WeekDay {
  name: string;
  shortName: string;
  index: number;
  date: Date;
  displayDate: string;
  displayMonth: string;
}

interface SelectedSlot {
  day: number;
  index: number; // 30-minute slot index
}

@Component({
  selector: 'app-availability-setup',
  templateUrl: './availability-setup.component.html',
  styleUrls: ['./availability-setup.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  animations: [
    trigger('slideUp', [
      transition(':enter', [
        style({ transform: 'translateY(100%)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateY(0)', opacity: 1 }))
      ]),
      transition(':leave', [
        animate('300ms ease-in', style({ transform: 'translateY(100%)', opacity: 0 }))
      ])
    ])
  ]
})
export class AvailabilitySetupComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @ViewChild('timeSlotsContainer', { static: false }) timeSlotsContainer?: ElementRef;
  @ViewChild('mobileHeaderRef', { static: false }) mobileHeaderRef?: ElementRef;

  @Input() targetDate: string | null = null; // Date parameter from route (YYYY-MM-DD format)
  @Input() embeddedMode: boolean = false; // When true, hides navigation elements and emits events instead
  @Output() availabilitySaved = new EventEmitter<void>(); // Emitted when availability is saved in embedded mode
  
  private destroy$ = new Subject<void>();
  
  // Single day mode flag
  isSingleDayMode = false;
  
  // Tutor's timezone
  tutorTimezone: string = '';
  tutorTimezoneLabel: string = '';

  // UI State
  activeTab = 'availability';
  showPopularSlots = false;

  // Calendar settings
  calendarTimeFormat: '12h' | '24h' = '12h';
  calendarDefaultView: 'week' | 'day' = 'week';

  // Google Calendar state
  gcalConnected = false;
  gcalEmail: string | null = null;
  gcalSyncEnabled = true;
  gcalPushToGoogle = false;
  gcalLastSyncAt: Date | null = null;
  private gcalBusySlots = new Set<string>();
  selectedSlotsCount = 0;
  currentWeek: Date = new Date(); // First day currently shown in grid
  hasUnsavedChanges = false;
  initialSelectedSlotsCount = 0; // Track initial count when page loads
  initialSelectedSlots = new Set<string>(); // Track which slots were initially selected
  isLoading = true; // Loading state for data fetch
  loadError = false; // Error state for data fetch
  private bookedSlotsLoaded = false; // Track if booked slots have been loaded
  private availabilityLoaded = false; // Track if availability data has been loaded
  showStickyBackButton = false;
  private headerObserver?: IntersectionObserver;

  // Getter for new slots count (only newly selected, not already saved)
  get newSlotsCount(): number {
    let count = 0;
    this.selectedSlots.forEach(slot => {
      if (!this.initialSelectedSlots.has(slot)) {
        count++;
      }
    });
    return count;
  }

  // Getter to convert slots to hours
  get newHoursCount(): number {
    return this.newSlotsCount * 0.5; // Each slot is 30 minutes = 0.5 hours
  }

  // Helper to get the target date for week calculations (based on selected slots or displayed days)
  private getTargetDateForWeek(): Date | null {
    // Find a date from the newly selected slots (not initial slots)
    let targetDate: Date | null = null;
    
    // Look for a newly selected slot (one that wasn't in the initial set)
    for (const slotKey of this.selectedSlots) {
      if (!this.initialSelectedSlots.has(slotKey)) {
        // Parse the date from the slot key (format: YYYY-MM-DD-slotIndex)
        const [year, month, day] = slotKey.split('-').slice(0, 3).map(Number);
        targetDate = new Date(year, month - 1, day);
        break;
      }
    }
    
    // If no new slots, fall back to any selected slot
    if (!targetDate && this.selectedSlots.size > 0) {
      const firstSlotKey = Array.from(this.selectedSlots)[0];
      const [year, month, day] = firstSlotKey.split('-').slice(0, 3).map(Number);
      targetDate = new Date(year, month - 1, day);
    }
    
    // If still no date, use the first displayed day
    if (!targetDate) {
      const daysToCheck = this.displayedWeekDays.length > 0 ? this.displayedWeekDays : this.weekDays;
      if (daysToCheck.length > 0) {
        targetDate = daysToCheck[0].date;
      }
    }
    
    return targetDate;
  }

  // Getter for total weekly hours (saved + new selections for the current week)
  get totalWeeklyHours(): number {
    const targetDate = this.getTargetDateForWeek();
    if (!targetDate) return 0;

    // Calculate the Sunday-Saturday week containing this date
    const weekStartDate = this.getStartOfWeek(targetDate);
    weekStartDate.setHours(0, 0, 0, 0);
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekStartDate.getDate() + 6);
    weekEndDate.setHours(23, 59, 59, 999);

    // Count all slots within this week range (both saved and new)
    const allSlots = new Set<string>();
    
    // Add initial (saved) slots
    this.initialSelectedSlots.forEach(slot => {
      const [year, month, day] = slot.split('-').slice(0, 3).map(Number);
      const slotDate = new Date(year, month - 1, day);
      slotDate.setHours(12, 0, 0, 0);
      if (slotDate >= weekStartDate && slotDate <= weekEndDate) {
        allSlots.add(slot);
      }
    });
    
    // Add currently selected slots (includes both saved and new)
    this.selectedSlots.forEach(slot => {
      const [year, month, day] = slot.split('-').slice(0, 3).map(Number);
      const slotDate = new Date(year, month - 1, day);
      slotDate.setHours(12, 0, 0, 0);
      if (slotDate >= weekStartDate && slotDate <= weekEndDate) {
        allSlots.add(slot);
      }
    });

    return allSlots.size * 0.5; // Convert to hours
  }

  // Getter for the week range display (e.g., "Nov 23-29")
  get weekRangeDisplay(): string {
    const targetDate = this.getTargetDateForWeek();
    if (!targetDate) return '';

    // Calculate the Sunday of the week that contains this date
    const weekStartDate = this.getStartOfWeek(targetDate);
    // End is Saturday of that week (6 days after Sunday)
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekStartDate.getDate() + 6);

    const startMonth = weekStartDate.toLocaleDateString('en-US', { month: 'short' });
    const startDay = weekStartDate.getDate();
    const endMonth = weekEndDate.toLocaleDateString('en-US', { month: 'short' });
    const endDay = weekEndDate.getDate();

    // If same month, show "Nov 23-29", otherwise "Nov 23 - Dec 5"
    if (startMonth === endMonth) {
      return `${startMonth} ${startDay}-${endDay}`;
    } else {
      return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
    }
  }

  // Helper to get start of week (Sunday)
  private getStartOfWeek(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const diff = day; // Distance from Sunday (0 = already Sunday, 1 = go back 1 day, etc.)
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // Now indicator state (simple, like tutor-calendar)
  currentTimePosition: number = 0;
  private nowIntervalId: any;
  private boundResizeHandler = () => {
    const previousMobile = this.isMobileView;
    this.updateResponsiveState();
    if (this.isMobileView !== previousMobile) {
      this.refreshDisplayedWeekDays(new Date());
    } else {
      this.refreshDisplayedWeekDays();
    }
    this.updateCurrentTimePosition();
  };

  // Selection state
  isSelecting = false;
  selectionStart: SelectedSlot | null = null;
  hoveredSlotIndex: number | null = null;
  private readonly deviceSupportsHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;
  selectedSlots = new Set<string>();
  bookedSlots = new Set<string>(); // New: Track booked lessons/classes

  // Data
  weekDays: WeekDay[] = [];
  displayedWeekDays: WeekDay[] = [];
  private isMobileView = false;
  private readonly mobileDaysToShow = 4;
  private mobileStartIndex = 0;
  showMobileSettings = false;
  panelAnimating = false;

  timeSlots: TimeSlot[] = [];

  // Data-driven popular slots loaded from API
  private popularSlotsSet = new Set<string>(); // "dayOfWeek-slotIndex"
  private popularSlotsIntensity = new Map<string, number>(); // 0–1 intensity
  popularSlotsLoaded = false;
  popularSlotsIsEstimate = false; // true when using static fallback
  // Night time starts at 6:00 PM local (index 36)
  nightStartIndex = 36;

  constructor(
    private router: Router,
    private navController: NavController,
    private location: Location,
    private userService: UserService,
    private lessonService: LessonService,
    private classService: ClassService,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private cdr: ChangeDetectorRef
  ) {
    this.initializeTimeSlots();
    this.initializeCurrentWeek();
    this.updateResponsiveState();
    this.updateWeekDays(new Date());
  }

  ionViewWillEnter() {
    console.log('📍 ionViewWillEnter: Refreshing availability data');
    // Update the time position
    this.updateCurrentTimePosition();
    // Reload availability data to ensure fresh state (scroll will happen after load)
    this.forceRefreshAvailability();
  }

  ngOnChanges(changes: any) {
    // Watch for targetDate changes when navigating between routes
    if (changes['targetDate'] && !changes['targetDate'].firstChange) {
      // Update single day mode
      this.isSingleDayMode = !!this.targetDate;
      
      // Re-initialize for new date
      if (this.targetDate) {
        const [year, month, day] = this.targetDate.split('-').map(Number);
        const targetDateObj = new Date(year, month - 1, day);
        targetDateObj.setHours(0, 0, 0, 0);
        this.currentWeek = targetDateObj;
        this.updateWeekDays(targetDateObj);
        this.loadExistingAvailability();
      } else {
        this.updateWeekDays(new Date());
        this.loadExistingAvailability();
      }
      
      // Reset scroll position to top when switching between views
      // This is needed because Ionic preserves scroll position, but content changes
      const ionContent = document.querySelector('ion-content');
      if (ionContent) {
        ionContent.getScrollElement().then((scrollElement) => {
          if (scrollElement) {
            scrollElement.scrollTop = 0;
          }
        }).catch(() => {
          // Silently fail
        });
      }
      
      // Also try to reset window scroll
      window.scrollTo(0, 0);
      
      // Just update time position - no need for complex scrolling
      this.updateCurrentTimePosition();
    }
  }

  // Helper to wait for ion-content to have valid scrollable dimensions
  private async waitForScrollableContent(attempt = 0, maxAttempts = 50): Promise<void> {
    // First, wait for ion-content element to exist
    const ionContent = document.querySelector('ion-content');
    if (!ionContent) {
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 200));
        return this.waitForScrollableContent(attempt + 1, maxAttempts);
      }
      return;
    }

    try {
      // Force Ionic to initialize the scroll element
      let scrollElement;
      try {
        scrollElement = await ionContent.getScrollElement();
      } catch (error) {
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 300));
          return this.waitForScrollableContent(attempt + 1, maxAttempts);
        }
        return;
      }
      
      if (!scrollElement) {
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 300));
          return this.waitForScrollableContent(attempt + 1, maxAttempts);
        }
        return;
      }
      
      const timeSlotsElement = this.timeSlotsContainer?.nativeElement as HTMLElement | undefined;
      
      // Check multiple conditions to ensure content is truly ready
      const hasValidScrollElement = scrollElement.scrollHeight > 0 && 
                                    scrollElement.clientHeight > 0;
      
      const hasRenderedTimeSlots = timeSlotsElement && 
                                   timeSlotsElement.scrollHeight > 0 &&
                                   timeSlotsElement.children.length > 0;
      
      const isContentReady = hasValidScrollElement && hasRenderedTimeSlots;

      if (isContentReady) {
        // Mobile needs extra time for rendering - add longer delay
        const additionalDelay = this.isMobileView ? 600 : 300;
        await new Promise(resolve => setTimeout(resolve, additionalDelay));
        return;
      }

      if (attempt < maxAttempts) {
        // Wait longer on each attempt, especially for mobile
        const baseDelay = this.isMobileView ? 300 : 150;
        const delay = Math.min(baseDelay + (attempt * 50), 800); // Cap at 800ms per retry
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.waitForScrollableContent(attempt + 1, maxAttempts);
      }
    } catch (error) {
      // On error, wait a bit and retry if we haven't hit max attempts
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 300));
        return this.waitForScrollableContent(attempt + 1, maxAttempts);
      }
    }
  }

  ngOnInit() {
    // Reactively track tutor's timezone and calendar preferences
    this.userService.currentUser$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      const tz = user?.profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      if (tz !== this.tutorTimezone) {
        this.tutorTimezone = tz;
        this.tutorTimezoneLabel = getTimezoneLabel(tz);
        this.updateCurrentTimePosition();
        setTimeout(() => this.scrollToCurrentTime(), 100);
        this.loadPopularSlots(tz);
      }

      const fmt = (user?.profile as any)?.calendarTimeFormat || '12h';
      if (fmt !== this.calendarTimeFormat) {
        this.calendarTimeFormat = fmt;
        this.initializeTimeSlots();
        this.cdr.detectChanges();
      }
    });
    
    // Check if we're in single day mode
    if (this.targetDate) {
      this.isSingleDayMode = true;
      // Parse the date string (YYYY-MM-DD format) in local timezone
      // Use local date construction to avoid timezone shifts
      const [year, month, day] = this.targetDate.split('-').map(Number);
      const targetDateObj = new Date(year, month - 1, day); // month is 0-indexed
      targetDateObj.setHours(0, 0, 0, 0); // Normalize to midnight local time
      
      console.log('🔴 Single day mode - target date:', {
        input: this.targetDate,
        parsed: targetDateObj.toDateString(),
        dayIndex: targetDateObj.getDay(),
        localTime: targetDateObj.toLocaleString(),
        utcTime: targetDateObj.toUTCString(),
        isToday: this.isSameDay(targetDateObj, new Date())
      });
      
      // Set current week to the week containing the target date
      this.currentWeek = this.getWeekStart(targetDateObj);
      // Update week days to show only the target day
      this.updateWeekDaysForSingleDay(targetDateObj);
    } else {
      this.isSingleDayMode = false;
    }
    this.forceRefreshAvailability();
    this.loadCalendarPreferences();
    this.loadGoogleCalendarStatus();
  }

  // Force refresh availability data (with cache busting)
  forceRefreshAvailability() {
    console.log('🔄 Force refreshing availability data...');
    this.isLoading = true;
    this.loadError = false;
    this.bookedSlotsLoaded = false;
    this.availabilityLoaded = false;
    this.selectedSlots.clear();
    this.bookedSlots.clear();
    this.initialSelectedSlots.clear();
    this.selectedSlotsCount = 0;
    this.initialSelectedSlotsCount = 0;
    
    // Ensure weekDays are properly set before loading
    if (this.weekDays.length === 0 && this.displayedWeekDays.length === 0) {
      console.log('🔧 WeekDays not initialized, initializing now...');
      if (this.isSingleDayMode && this.targetDate) {
        const [year, month, day] = this.targetDate.split('-').map(Number);
        const targetDateObj = new Date(year, month - 1, day);
        targetDateObj.setHours(0, 0, 0, 0);
        this.updateWeekDaysForSingleDay(targetDateObj);
      } else {
        this.updateWeekDays(new Date());
      }
    }
    
    // Safety timeout - if loading takes too long, show error
    const loadingTimeout = setTimeout(() => {
      if (this.isLoading) {
        console.warn('⚠️ Loading timeout - forcing error state');
        this.isLoading = false;
        this.loadError = true;
        this.cdr.detectChanges();
      }
    }, 15000); // 15 second timeout
    
    this.loadExistingAvailability();
    this.loadBookedSlots();
    this.loadGoogleCalendarEvents();
    
    // Clear timeout when loading completes (handled in loadExistingAvailability callback)
    // Store timeout ID for potential cleanup
    (this as any)._loadingTimeout = loadingTimeout;
  }

  private getWeekStart(date: Date): Date {
    // Create a new date to avoid mutating the original
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();
    const diff = d.getDate() - day; // Adjust to get Sunday as start of week
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  
  private updateWeekDaysForSingleDay(targetDate: Date) {
    this.weekDays = [];
    this.displayedWeekDays = [];
    
    // Use local timezone for display
    const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'short' });
    const shortName = targetDate.toLocaleDateString('en-US', { weekday: 'short' });
    const dayOfMonth = targetDate.getDate();
    const monthName = targetDate.toLocaleDateString('en-US', { month: 'short' });
    
    // Get day index in local timezone
    const dayIndex = targetDate.getDay();
    
    console.log('🔧 Single day setup:', {
      targetDate: targetDate.toDateString(),
      dayName,
      dayIndex,
      localTime: targetDate.toLocaleString(),
      isToday: this.isSameDay(targetDate, new Date())
    });
    
    // Create a clean date object for this day
    const cleanDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    
    this.weekDays.push({
      name: dayName,
      shortName,
      index: dayIndex,
      date: cleanDate,
      displayDate: dayOfMonth.toString(),
      displayMonth: monthName
    });
    
    this.displayedWeekDays = [...this.weekDays];
    
    console.log('🔧 displayedWeekDays after single day setup:', this.displayedWeekDays);
  }

  ngAfterViewInit() {
    this.startTimeUpdater();
    window.addEventListener('resize', this.boundResizeHandler);
    this.setupHeaderObserver();
  }

  private setupHeaderObserver() {
    if (this.embeddedMode) return;
    setTimeout(() => {
      const headerEl = this.mobileHeaderRef?.nativeElement as HTMLElement;
      if (!headerEl || window.innerWidth > 768) return;

      const ionContent = headerEl.closest('ion-content') as any;
      if (!ionContent) return;

      ionContent.getScrollElement().then((scrollEl: HTMLElement) => {
        this.headerObserver = new IntersectionObserver(
          (entries) => {
            this.showStickyBackButton = !entries[0].isIntersecting;
            this.cdr.detectChanges();
          },
          { root: scrollEl, threshold: 0 }
        );
        this.headerObserver.observe(headerEl);
      });
    }, 500);
  }
  
  /**
   * Scroll to the current time indicator with retry logic
   * Called after data loads to ensure the grid is rendered
   */
  private async scrollToCurrentTime(retryCount = 0) {
    const maxRetries = 15;

    if (this.isLoading) {
      if (retryCount < maxRetries) {
        setTimeout(() => this.scrollToCurrentTime(retryCount + 1), 300);
      }
      return;
    }

    const timeSlotsElement = this.timeSlotsContainer?.nativeElement as HTMLElement | undefined;
    if (!timeSlotsElement) {
      if (retryCount < maxRetries) {
        setTimeout(() => this.scrollToCurrentTime(retryCount + 1), 300);
      }
      return;
    }

    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      const ionContent = timeSlotsElement.closest('ion-content') as any;
      const scrollEl = ionContent ? await ionContent.getScrollElement() : null;

      if (!scrollEl) {
        if (retryCount < maxRetries) {
          setTimeout(() => this.scrollToCurrentTime(retryCount + 1), 300);
        }
        return;
      }

      const timeIndicator = timeSlotsElement.querySelector('.time-indicator') as HTMLElement;
      if (timeIndicator) {
        const indicatorRect = timeIndicator.getBoundingClientRect();
        const scrollElRect = scrollEl.getBoundingClientRect();
        const scrollTarget = scrollEl.scrollTop + (indicatorRect.top - scrollElRect.top) - (window.innerHeight / 3);
        scrollEl.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });
        return;
      }

      if (this.currentTimePosition > 0) {
        const gridContainer = timeSlotsElement.closest('.time-grid-container') as HTMLElement;
        if (gridContainer) {
          const gridRect = gridContainer.getBoundingClientRect();
          const scrollElRect = scrollEl.getBoundingClientRect();
          const scrollTarget = scrollEl.scrollTop + (gridRect.top - scrollElRect.top) + this.currentTimePosition - (window.innerHeight / 3);
          scrollEl.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });
          return;
        }
      }

      if (retryCount < maxRetries) {
        setTimeout(() => this.scrollToCurrentTime(retryCount + 1), 300);
      }
      return;
    }

    const scrollContainer = timeSlotsElement.closest('.time-grid-container') as HTMLElement;
    if (!scrollContainer) {
      if (retryCount < maxRetries) {
        setTimeout(() => this.scrollToCurrentTime(retryCount + 1), 300);
      }
      return;
    }

    if (scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
      if (retryCount < maxRetries) {
        setTimeout(() => this.scrollToCurrentTime(retryCount + 1), 300);
      }
      return;
    }

    const targetScroll = Math.max(0, this.currentTimePosition - 200);

    scrollContainer.scrollTo({
      top: targetScroll,
      behavior: 'smooth'
    });
  }

  private initializeCurrentWeek() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const sundayOffset = -dayOfWeek; // Get to Sunday of current week
    this.currentWeek = new Date(today);
    this.currentWeek.setDate(today.getDate() + sundayOffset);
    this.currentWeek.setHours(0, 0, 0, 0);
  }

  private updateWeekDays(focusDate?: Date) {
    const start = new Date(this.currentWeek);
    
    this.weekDays = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      const shortName = date.toLocaleDateString('en-US', { weekday: 'short' });
      const dayOfMonth = date.getDate();
      const monthName = date.toLocaleDateString('en-US', { month: 'short' });
      
      this.weekDays.push({
        name: dayName,
        shortName,
        index: date.getDay(), // Use actual day of week (0=Sunday, 1=Monday, etc.)
        date,
        displayDate: dayOfMonth.toString(),
        displayMonth: monthName
      });
    }

    this.refreshDisplayedWeekDays(focusDate);
    
    // Just update the time position (no complex indicator logic needed)
    this.updateCurrentTimePosition();
  }

  getWeekRange(): string {
    if (this.isSingleDayMode && this.displayedWeekDays.length > 0) {
      const day = this.displayedWeekDays[0];
      return `${day.displayMonth} ${day.displayDate}, ${day.date.getFullYear()}`;
    }
    
    const days = this.displayedWeekDays.length ? this.displayedWeekDays : this.weekDays;
    const startDate = days[0]?.date;
    const endDate = days[days.length - 1]?.date;
    if (!startDate || !endDate) return '';
    
    // Just show the month and year (full month name)
    // If week spans two months, show the end month (where most of the week is)
    const displayDate = endDate; // Use end date's month
    const month = displayDate.toLocaleDateString('en-US', { month: 'long' });
    const year = displayDate.getFullYear();
    
    return `${month} ${year}`;
  }

  navigateWeek(direction: 'prev' | 'next') {
    if (this.isSingleDayMode) {
      // In single day mode, navigate to previous/next day
      if (this.displayedWeekDays.length === 0) return;
      const currentDate = new Date(this.displayedWeekDays[0].date);
      const days = direction === 'prev' ? -1 : 1;
      currentDate.setDate(currentDate.getDate() + days);
      this.updateWeekDaysForSingleDay(currentDate);
      this.updateCurrentTimePosition();
      // Reload availability for the new day
      this.forceRefreshAvailability();
      return;
    }
    
    const step = this.isMobileView ? this.mobileDaysToShow : 7;
    const days = direction === 'prev' ? -step : step;
    this.currentWeek = new Date(this.currentWeek);
    this.currentWeek.setDate(this.currentWeek.getDate() + days);
    if (this.isMobileView) {
      this.mobileStartIndex = 0;
    }
    this.updateWeekDays();
    this.updateCurrentTimePosition();
    // Reload availability for the new week (same as single-day mode does)
    this.forceRefreshAvailability();
  }

  navigateMonth(direction: 'prev' | 'next') {
    const months = direction === 'prev' ? -1 : 1;
    this.currentWeek = new Date(this.currentWeek);
    this.currentWeek.setMonth(this.currentWeek.getMonth() + months);
    const dayOfWeek = this.currentWeek.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    this.currentWeek.setDate(this.currentWeek.getDate() + mondayOffset);
    if (this.isMobileView) {
      this.mobileStartIndex = 0;
    }
    this.updateWeekDays();
    this.forceRefreshAvailability();
  }

  goToToday() {
    if (this.isSingleDayMode) {
      const today = new Date();
      this.updateWeekDaysForSingleDay(today);
      this.updateCurrentTimePosition();
      this.forceRefreshAvailability();
      return;
    }
    this.initializeCurrentWeek();
    this.mobileStartIndex = 0;
    this.updateWeekDays(new Date());
    this.updateCurrentTimePosition();
    this.forceRefreshAvailability();
  }

  switchToWeekView() {
    if (!this.isSingleDayMode) return; // Already in week view
    
    // Switch to week view
    this.isSingleDayMode = false;
    this.initializeCurrentWeek();
    this.updateWeekDays(new Date());
    this.updateCurrentTimePosition();
  }

  switchToDayView() {
    if (this.isSingleDayMode) return; // Already in day view
    
    // Switch to single day view (today)
    const today = new Date();
    this.isSingleDayMode = true;
    this.updateWeekDaysForSingleDay(today);
    this.updateCurrentTimePosition();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.nowIntervalId) clearInterval(this.nowIntervalId);
    if (this.headerObserver) this.headerObserver.disconnect();
    window.removeEventListener('resize', this.boundResizeHandler);
  }

  private initializeTimeSlots() {
    this.timeSlots = [];
    let idx = 0;
    // Generate slots from 12:00 AM to 11:30 PM
    for (let hour = 0; hour < 24; hour++) {
      for (let min of [0, 30]) {
        this.timeSlots.push({
          index: idx++,
          display: this.formatTime12Hour(hour, min)
        });
      }
    }
    // Add final slot for 12:00 AM (midnight end)
    this.timeSlots.push({
      index: idx++,
      display: this.formatTime12Hour(24, 0)
    });
  }

  private formatTime12Hour(hour: number, minute: number): string {
    const displayMinute = minute === 0 ? '00' : '30';

    if (this.calendarTimeFormat === '24h') {
      const h = hour === 24 ? 0 : hour;
      return `${String(h).padStart(2, '0')}:${displayMinute}`;
    }

    if (hour === 24) return '12:00 AM';
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${displayMinute} ${period}`;
  }

  private loadExistingAvailability(retryCount = 0) {
    const maxRetries = 3;
    console.log('🔧 Loading existing availability...', { 
      isSingleDayMode: this.isSingleDayMode, 
      retryCount,
      weekDaysCount: this.weekDays.length,
      displayedWeekDaysCount: this.displayedWeekDays.length 
    });
    
    // Verify weekDays are populated before making API call
    const dayArray = this.isSingleDayMode ? this.displayedWeekDays : this.weekDays;
    if (!dayArray || dayArray.length === 0) {
      console.warn('🔧 ⚠️ Day array is empty, retrying after delay...');
      if (retryCount < maxRetries) {
        setTimeout(() => {
          this.loadExistingAvailability(retryCount + 1);
        }, 200 * (retryCount + 1)); // Exponential backoff: 200ms, 400ms, 600ms
        return;
      } else {
        console.error('🔧 ❌ Failed to initialize day array after retries');
        this.isLoading = false;
        this.loadError = true;
        this.cdr.detectChanges();
        return;
      }
    }
    
    this.userService.getAvailability().subscribe({
      next: (res) => {
        console.log('🔧 Loaded existing availability:', res);
        // Convert existing availability to selected slots
        if (res.availability && res.availability.length > 0) {
          console.log('🔧 All availability blocks:', res.availability.length);
          // Hard guardrails to keep the editor honest:
          // 1. Skip non-`available` blocks (class/break/unavailable). Those
          //    are managed elsewhere; if we let them in, saving converts
          //    them into user-set "available" slots and they leak forever.
          // 2. Skip far-future sentinels (e.g. 2099-01-01 placeholders that
          //    a draft class can produce).
          const MAX_YEAR = new Date().getFullYear() + 5;
          res.availability = res.availability.filter((b: any) => {
            if (b?.type && b.type !== 'available') return false;
            const probe = b?.absoluteStart ? new Date(b.absoluteStart) : null;
            if (probe && probe.getUTCFullYear() > MAX_YEAR) return false;
            return true;
          });
          console.log('🔧 Editable availability blocks after filter:', res.availability.length);
          res.availability.forEach(block => {
            // Prefer calendar date from block id ("YYYY-MM-DD-...") — matches save keys and
            // avoids UTC/local shifts from absoluteStart for evening slots.
            let blockDate: Date | null = null;
            if (block.id && typeof block.id === 'string') {
              const idM = block.id.match(/^(\d{4})-(\d{2})-(\d{2})/);
              if (idM) {
                blockDate = new Date(Number(idM[1]), Number(idM[2]) - 1, Number(idM[3]), 0, 0, 0, 0);
              }
            }
            if (!blockDate) {
              if (block.absoluteStart) {
                blockDate = new Date(block.absoluteStart);
              } else {
                let dayIndex: number;
                if (typeof block.day === 'number') {
                  dayIndex = block.day;
                } else {
                  dayIndex = this.dayNameToIndex(block.day);
                }
                const currentDayArray = this.isSingleDayMode ? this.displayedWeekDays : this.weekDays;
                const matchingDay = currentDayArray.find(d => d.index === dayIndex);
                if (!matchingDay) {
                  return;
                }
                blockDate = matchingDay.date;
              }
            }

            const dateStr = this.formatDateKey(blockDate);

            // For dated blocks, only load if that calendar day falls in the displayed week
            if (block.absoluteStart && block.absoluteEnd) {
              const currentDayArray = this.isSingleDayMode ? this.displayedWeekDays : this.weekDays;
              const firstDisplayedDate = currentDayArray[0]?.date;
              const lastDisplayedDate = currentDayArray[currentDayArray.length - 1]?.date;

              if (!firstDisplayedDate || !lastDisplayedDate) {
                return;
              }

              const firstDate = new Date(firstDisplayedDate);
              const lastDate = new Date(lastDisplayedDate);
              firstDate.setHours(0, 0, 0, 0);
              lastDate.setHours(0, 0, 0, 0);

              const anchor = new Date(blockDate);
              anchor.setHours(0, 0, 0, 0);
              const blockApplies = anchor >= firstDate && anchor <= lastDate;

              if (!blockApplies) {
                return;
              }
            }
            
            // In single day mode, only load slots for the selected day
            if (this.isSingleDayMode) {
              const selectedDate = this.displayedWeekDays[0]?.date;
              if (!selectedDate || !this.isSameDay(blockDate, selectedDate)) {
                return;
              }
            }

            // Parse time slots
            const [sh, sm] = block.startTime.split(':').map((v: string) => parseInt(v, 10));
            const [eh, em] = block.endTime.split(':').map((v: string) => parseInt(v, 10));

            const startIndex = sh * 2 + (sm >= 30 ? 1 : 0);
            const endIndex = eh * 2 + (em >= 30 ? 1 : 0);

            for (let idx = startIndex; idx < endIndex; idx++) {
              const slotKey = `${dateStr}-${idx}`;
              this.selectedSlots.add(slotKey);
              this.initialSelectedSlots.add(slotKey); // Track as initially selected
            }
          });
          this.updateSelectedCount();
          // Store the initial count after loading existing availability
          this.initialSelectedSlotsCount = this.selectedSlotsCount;
          console.log('🔧 ✅ Final selected slots count:', this.selectedSlots.size);
        } else {
          // No existing availability, so initial count is 0
          this.initialSelectedSlotsCount = 0;
          console.log('🔧 No existing availability found');
        }
        // Loaded selections reflect saved state; reset dirty flag
        this.hasUnsavedChanges = false;
        this.availabilityLoaded = true;
        this.loadError = false;
        this.checkAllDataLoaded();
      },
      error: (error) => {
        console.error('❌ Error loading existing availability:', error);
        if (retryCount < maxRetries) {
          console.log(`🔧 Retrying... (${retryCount + 1}/${maxRetries})`);
          setTimeout(() => {
            this.loadExistingAvailability(retryCount + 1);
          }, 500 * (retryCount + 1));
        } else {
          this.isLoading = false;
          this.loadError = true;
          // Clear loading timeout
          if ((this as any)._loadingTimeout) {
            clearTimeout((this as any)._loadingTimeout);
          }
          this.cdr.detectChanges();
        }
      }
    });
  }
  
  // Load booked lessons and classes to mark slots as unavailable
  private loadBookedSlots() {
    const currentUser = this.userService.getCurrentUserValue();
    if (!currentUser?.id) {
      console.error('No current user found');
      this.bookedSlotsLoaded = true;
      return;
    }
    
    console.log('📅 Loading booked lessons and classes...');
    
    // Track how many async calls are pending
    const isTutor = currentUser.userType === 'tutor';
    let pendingCalls = isTutor ? 2 : 1; // lessons + classes (if tutor)
    
    const onCallComplete = () => {
      pendingCalls--;
      if (pendingCalls <= 0) {
        this.bookedSlotsLoaded = true;
        console.log('✅ All booked slots loaded:', this.bookedSlots.size, 'slots');
        this.checkAllDataLoaded();
      }
    };
    
    // Load lessons
    this.lessonService.getMyLessons(currentUser.id).subscribe({
      next: (response: any) => {
        console.log('✅ Lessons loaded:', response?.lessons?.length || 0);
        
        if (response && response.success && response.lessons) {
          response.lessons.forEach((lesson: any) => {
            // Only count non-cancelled, future lessons
            if (lesson.status !== 'cancelled') {
              this.addBookedSlot(lesson.startTime, lesson.endTime);
            }
          });
        }
        onCallComplete();
      },
      error: (error) => {
        console.error('❌ Error loading lessons:', error);
        onCallComplete();
      }
    });
    
    // Load classes (if user is a tutor)
    if (isTutor) {
      this.classService.getClassesForTutor(currentUser.id).subscribe({
        next: (response: any) => {
          console.log('✅ Classes loaded:', response?.classes?.length || 0);
          
          if (response && response.success && response.classes) {
            response.classes.forEach((cls: any) => {
              // Only count upcoming/active classes
              const classDate = new Date(cls.startTime);
              if (classDate >= new Date()) {
                this.addBookedSlot(cls.startTime, cls.endTime);
              }
            });
          }
          onCallComplete();
        },
        error: (error) => {
          console.error('❌ Error loading classes:', error);
          onCallComplete();
        }
      });
    }
  }
  
  // Helper to add a booked time slot
  private addBookedSlot(startTime: string, endTime: string) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    
    // Get the date key
    const dateStr = this.formatDateKey(start);
    
    // Calculate slot indices using floor for start (which 30-min slot does it land in?)
    // and ceil for end (any partial use of a slot means it's occupied)
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    
    const startIndex = Math.floor(startMinutes / 30);
    const endIndex = Math.ceil(endMinutes / 30);
    
    console.log(`📅 Marking booked: ${dateStr} from ${start.getHours()}:${String(start.getMinutes()).padStart(2, '0')} to ${end.getHours()}:${String(end.getMinutes()).padStart(2, '0')} (indices ${startIndex}-${endIndex})`);
    
    // Mark all slots in this time range as booked
    for (let idx = startIndex; idx < endIndex; idx++) {
      const slotKey = `${dateStr}-${idx}`;
      this.bookedSlots.add(slotKey);
      console.log(`🔒 Booked slot: ${slotKey}`);
    }
  }
  
  // Check if a slot is booked
  isSlotBooked(dayIndex: number, slotIndex: number): boolean {
    const dayArray = this.isSingleDayMode ? this.displayedWeekDays : this.weekDays;
    const day = dayArray?.find(d => d.index === dayIndex);
    if (!day) return false;
    
    const dateStr = this.formatDateKey(day.date);
    return this.bookedSlots.has(`${dateStr}-${slotIndex}`);
  }
  
  // Show feedback when user tries to remove a slot that has a scheduled lesson/class
  private async showBookedSlotToast() {
    const toast = await this.toastController.create({
      message: 'This time slot has a scheduled lesson and cannot be removed.',
      duration: 2500,
      position: 'bottom',
      color: 'dark',
      icon: 'lock-closed'
    });
    await toast.present();
  }
  
  // Called when either availability or booked slots finish loading
  // Only hides the loading spinner when BOTH have completed
  private checkAllDataLoaded() {
    if (this.availabilityLoaded && this.bookedSlotsLoaded) {
      this.isLoading = false;
      // Clear loading timeout
      if ((this as any)._loadingTimeout) {
        clearTimeout((this as any)._loadingTimeout);
      }
      // Trigger change detection to ensure view updates
      this.cdr.detectChanges();
      
      // Scroll to current time after grid is rendered (longer delay on mobile for *ngIf to resolve)
      const delay = window.innerWidth <= 768 ? 400 : 100;
      setTimeout(() => {
        this.scrollToCurrentTime();
      }, delay);
    }
  }
  
  private dayNameToIndex(dayName: string): number {
    const dayMap: { [key: string]: number } = {
      'sunday': 0,
      'monday': 1,
      'tuesday': 2,
      'wednesday': 3,
      'thursday': 4,
      'friday': 5,
      'saturday': 6
    };
    return dayMap[dayName.toLowerCase()] ?? 0;
  }
  
  private indexToDayName(dayIndex: number): string {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return dayNames[dayIndex] ?? 'sunday';
  }

  private updateResponsiveState() {
    if (typeof window === 'undefined') {
      return;
    }
    // Match the CSS breakpoint: max-width: 1024px means mobile when <= 1024
    const newIsMobile = window.innerWidth <= 1024;
    if (newIsMobile !== this.isMobileView) {
      this.isMobileView = newIsMobile;
      if (this.isMobileView) {
        this.mobileStartIndex = 0;
        this.refreshDisplayedWeekDays(new Date());
      } else {
        this.refreshDisplayedWeekDays();
        this.showMobileSettings = false;
      }
    } else {
      this.isMobileView = newIsMobile;
    }
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

  private refreshDisplayedWeekDays(focusDate?: Date) {
    if (this.isMobileView) {
      let startIndex = this.mobileStartIndex;
      if (focusDate) {
        const targetIdx = this.weekDays.findIndex(day => this.isSameDay(day.date, focusDate));
        if (targetIdx >= 0) {
          startIndex = targetIdx;
        }
      }
      if (startIndex < 0) {
        startIndex = 0;
      }
      
      // Ensure we don't exceed the week bounds
      const totalDays = this.weekDays.length;
      const maxStartIndex = Math.max(0, totalDays - this.mobileDaysToShow);
      startIndex = Math.min(startIndex, maxStartIndex);
      
      this.mobileStartIndex = startIndex;
      
      // Simply slice the array instead of using modulo to avoid date jumps
      this.displayedWeekDays = this.weekDays.slice(startIndex, startIndex + this.mobileDaysToShow);
    } else {
      this.mobileStartIndex = 0;
      this.displayedWeekDays = [...this.weekDays];
    }
  }

  private isSameDay(a: Date, b: Date): boolean {
    // Compare dates in local timezone
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  }

  // Navigation
  goBack() {
    this.showMobileSettings = false;
    if (this.selectedSlotsCount > 0 && this.hasUnsavedChanges) {
      this.confirmLeaveWithUnsavedChanges();
      return;
    }
    
    // In single day mode, go back to regular availability setup with forward animation (left to right)
    if (this.isSingleDayMode) {
      // Try using window.history.back() to go back in browser history
      // This should trigger the correct animation direction
      window.history.back();
    } else {
      // In regular mode, go back to calendar
      this.router.navigate(['/tabs/tutor-calendar']);
    }
  }

  navigateToWeekView() {
    // Check for unsaved changes
    if (this.selectedSlotsCount > 0 && this.hasUnsavedChanges) {
      this.confirmLeaveWithUnsavedChanges();
      return;
    }
    
    // Navigate to week view
    this.router.navigate(['/tabs/availability-setup']);
  }

  // Navigate to single-day availability setup for a specific date
  selectDate(day: WeekDay) {
    if (!day || !day.date) return;
    
    // Format date as YYYY-MM-DD using local timezone to avoid UTC conversion issues
    const year = day.date.getFullYear();
    const month = String(day.date.getMonth() + 1).padStart(2, '0');
    const dayOfMonth = String(day.date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${dayOfMonth}`;
    
    console.log('🗓️ Navigating to availability setup:', {
      originalDate: day.date.toDateString(),
      localDate: day.date.toLocaleDateString(),
      formattedForURL: dateStr,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });
    
    // Navigate to single-day availability setup page
    this.router.navigate(['/tabs/availability-setup', dateStr]);
  }

  private async confirmLeaveWithUnsavedChanges() {
    const alert = await this.alertController.create({
      header: 'Selection not saved',
      message: 'You have selected time slots that are not saved.',
      buttons: [
        {
          text: "Don't save",
          role: 'destructive',
          handler: () => {
            this.selectedSlots.clear();
            this.selectedSlotsCount = 0;
            this.hasUnsavedChanges = false;
            this.router.navigate(['/tabs/tutor-calendar']);
          }
        },
        {
          text: 'Save',
          handler: async () => {
            await this.saveAvailability();
          }
        }
      ]
    });
    await alert.present();
  }

  setActiveTab(tab: string) {
    this.activeTab = tab;
  }

  // Selection logic
  startSelection(dayIndex: number, slotIndex: number, event: MouseEvent) {
    event.preventDefault();
    if (this.isPastSlot(dayIndex, slotIndex)) return;
    if (this.isSlotBooked(dayIndex, slotIndex)) {
      this.showBookedSlotToast();
      return;
    }
    this.isSelecting = true;
    this.selectionStart = { day: dayIndex, index: slotIndex };
    this.toggleSlot(dayIndex, slotIndex);
  }

  onSlotMouseEnter(dayIndex: number, slotIndex: number) {
    if (this.deviceSupportsHover) {
      this.hoveredSlotIndex = slotIndex;
    }
    this.continueSelection(dayIndex, slotIndex);
  }

  continueSelection(dayIndex: number, slotIndex: number) {
    if (!this.isSelecting || !this.selectionStart) return;

    // Clear previous selection in this drag
    this.clearSelectionRange();
    
    // Select new range
    const startDay = Math.min(this.selectionStart.day, dayIndex);
    const endDay = Math.max(this.selectionStart.day, dayIndex);
    const startIdx = Math.min(this.selectionStart.index, slotIndex);
    const endIdx = Math.max(this.selectionStart.index, slotIndex);

    const dayArray = this.isSingleDayMode ? this.displayedWeekDays : this.weekDays;
    
    for (let day = startDay; day <= endDay; day++) {
      const dayObj = dayArray?.find(d => d.index === day);
      if (!dayObj) continue;
      
      const dateStr = this.formatDateKey(dayObj.date);
      
      for (let idx = startIdx; idx <= endIdx; idx++) {
        if (this.isPastSlot(day, idx) || this.isSlotBooked(day, idx)) continue;
        this.selectedSlots.add(`${dateStr}-${idx}`);
      }
    }

    this.updateSelectedCount();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent) {
    if (this.hasUnsavedChanges) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  @HostListener('document:mouseup')
  @HostListener('document:touchend')
  endSelection() {
    this.isSelecting = false;
    this.selectionStart = null;
    this.hoveredSlotIndex = null;
  }

  private toggleSlot(dayIndex: number, slotIndex: number) {
    if (this.isPastSlot(dayIndex, slotIndex) || this.isSlotBooked(dayIndex, slotIndex)) return;
    
    // Find the specific date for this dayIndex
    const dayArray = this.isSingleDayMode ? this.displayedWeekDays : this.weekDays;
    const day = dayArray?.find(d => d.index === dayIndex);
    if (!day) return;
    
    // Use specific date in slot key (YYYY-MM-DD format)
    const dateStr = this.formatDateKey(day.date);
    const slotKey = `${dateStr}-${slotIndex}`;
    
    if (this.selectedSlots.has(slotKey)) {
      this.selectedSlots.delete(slotKey);
    } else {
      this.selectedSlots.add(slotKey);
    }
    this.updateSelectedCount();
  }
  
  // Helper to format date as YYYY-MM-DD for slot keys
  private formatDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private clearSelectionRange() {
    if (!this.selectionStart) return;
    
    const startDay = Math.min(this.selectionStart.day, this.selectionStart.day);
    const endDay = Math.max(this.selectionStart.day, this.selectionStart.day);
    const startHour = Math.min(this.selectionStart.index, this.selectionStart.index);
    const endHour = Math.max(this.selectionStart.index, this.selectionStart.index);

    const dayArray = this.isSingleDayMode ? this.displayedWeekDays : this.weekDays;
    
    for (let day = startDay; day <= endDay; day++) {
      const dayObj = dayArray?.find(d => d.index === day);
      if (!dayObj) continue;
      
      const dateStr = this.formatDateKey(dayObj.date);
      
      for (let hour = startHour; hour <= endHour; hour++) {
        this.selectedSlots.delete(`${dateStr}-${hour}`);
      }
    }
  }

  isSlotSelected(dayIndex: number, slotIndex: number): boolean {
    const dayArray = this.isSingleDayMode ? this.displayedWeekDays : this.weekDays;
    const day = dayArray?.find(d => d.index === dayIndex);
    if (!day) return false;
    
    const dateStr = this.formatDateKey(day.date);
    return this.selectedSlots.has(`${dateStr}-${slotIndex}`);
  }

  isPopularSlot(dayIndex: number, slotIndex: number): boolean {
    if (!this.showPopularSlots || !this.popularSlotsLoaded) return false;
    return this.popularSlotsSet.has(`${dayIndex}-${slotIndex}`);
  }

  getPopularIntensity(dayIndex: number, slotIndex: number): number {
    return this.popularSlotsIntensity.get(`${dayIndex}-${slotIndex}`) || 0;
  }

  private loadPopularSlots(timezone: string) {
    this.lessonService.getPopularSlots(timezone).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        this.popularSlotsSet.clear();
        this.popularSlotsIntensity.clear();

        if (response.success && response.slots.length > 0 && !response.insufficientData) {
          this.popularSlotsIsEstimate = false;
          for (const slot of response.slots) {
            if (slot.count >= response.threshold) {
              const key = `${slot.dayOfWeek}-${slot.slotIndex}`;
              this.popularSlotsSet.add(key);
              this.popularSlotsIntensity.set(key, slot.intensity);
            }
          }
        } else {
          this.buildStaticFallbackSlots();
        }

        this.popularSlotsLoaded = true;
        this.cdr.detectChanges();
      },
      error: () => {
        this.buildStaticFallbackSlots();
        this.popularSlotsLoaded = true;
        this.cdr.detectChanges();
      }
    });
  }

  private buildStaticFallbackSlots() {
    this.popularSlotsIsEstimate = true;
    this.popularSlotsSet.clear();
    this.popularSlotsIntensity.clear();

    // Static recommendation: 9 AM – 9 PM (slot indices 18–41), all 7 days
    // Peak hours 10 AM – 1 PM (slots 20–25) and 5 PM – 8 PM (slots 34–39) get higher intensity
    for (let day = 0; day <= 6; day++) {
      for (let slot = 18; slot <= 41; slot++) {
        const key = `${day}-${slot}`;
        this.popularSlotsSet.add(key);

        const isPeakMorning = slot >= 20 && slot <= 25;
        const isPeakEvening = slot >= 34 && slot <= 39;
        this.popularSlotsIntensity.set(key, isPeakMorning || isPeakEvening ? 0.7 : 0.3);
      }
    }
  }

  isNightSlot(slotIndex: number): boolean {
    return slotIndex >= this.nightStartIndex;
  }

  // Disallow selecting time slots in the past (relative to now)
  isPastSlot(dayIndex: number, slotIndex: number): boolean {
    // In single-day mode, use displayedWeekDays; otherwise use weekDays
    const dayArray = this.isSingleDayMode ? this.displayedWeekDays : this.weekDays;
    const day = dayArray?.find(d => d.index === dayIndex) || dayArray?.[dayIndex];
    
    if (!day) return false;
    
    const slotDate = new Date(day.date);
    const hour = Math.floor(slotIndex / 2);
    const minute = slotIndex % 2 === 1 ? 30 : 0;
    slotDate.setHours(hour, minute, 0, 0);
    return slotDate.getTime() < Date.now();
  }

  isToday(day: WeekDay): boolean {
    const today = new Date();
    return day.date.getDate() === today.getDate() &&
           day.date.getMonth() === today.getMonth() &&
           day.date.getFullYear() === today.getFullYear();
  }

  private isCurrentWeekInView(): boolean {
    // In single day mode, check if the selected day is today
    if (this.isSingleDayMode) {
      if (!this.displayedWeekDays || this.displayedWeekDays.length === 0) {
        console.log('🔴 Single day mode: No displayed days');
        return false;
      }
      const selectedDay = new Date(this.displayedWeekDays[0].date);
      const now = new Date();
      const isToday = this.isSameDay(selectedDay, now);
      console.log('🔴 Single day mode check:', { 
        selectedDay: selectedDay.toDateString(), 
        today: now.toDateString(), 
        isToday 
      });
      return isToday;
    }
    
    // Regular week mode
    if (!this.weekDays || this.weekDays.length !== 7) return false;
    const start = new Date(this.weekDays[0].date);
    const end = new Date(this.weekDays[6].date);
    // End of day for the last day
    end.setHours(23, 59, 59, 999);
    const now = new Date();
    return now >= start && now <= end;
  }

  // Simple time position update (like tutor-calendar)
  private startTimeUpdater() {
    this.updateCurrentTimePosition();
    this.nowIntervalId = setInterval(() => {
      this.updateCurrentTimePosition();
    }, 60000); // Update every minute
  }
  
  private updateCurrentTimePosition() {
    const tz = this.tutorTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(new Date());
    const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    const startOffset = 0;
    const slotHeight = window.innerWidth <= 768 ? 37 : 26;

    const totalSlotsFromStart = ((currentHour - startOffset) * 2) + Math.floor(currentMinute / 30);
    const minutesIntoCurrentSlot = currentMinute % 30;

    this.currentTimePosition = (totalSlotsFromStart * slotHeight) + (minutesIntoCurrentSlot / 30 * slotHeight);
  }

  private async getScrollContainer(retryCount = 0): Promise<HTMLElement | Window | null> {
    const maxRetries = 5;
    
    // Try to find the ion-content scroll container (for mobile Ionic pages)
    const ionContent = document.querySelector('ion-content');
    if (ionContent) {
      try {
        // Get the inner scroll element of ion-content
        const scrollElement = await ionContent.getScrollElement();
        if (scrollElement) {
          // Verify it has valid dimensions
          const hasValidDimensions = scrollElement.clientHeight > 0 && scrollElement.scrollHeight > 0;
          
          if (hasValidDimensions) {
            return scrollElement;
          } else if (retryCount < maxRetries) {
            // Wait progressively longer on each retry
            const delay = 300 + (retryCount * 200); // 300ms, 500ms, 700ms, etc.
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.getScrollContainer(retryCount + 1);
          }
        }
      } catch (error) {
        // Silently fail
      }
    }
    
    // Fallback to window for non-Ionic pages
    return window;
  }


  private updateSelectedCount() {
    this.selectedSlotsCount = this.selectedSlots.size;
    this.hasUnsavedChanges = this.hasDirtySlots();
  }

  private hasDirtySlots(): boolean {
    if (this.selectedSlots.size !== this.initialSelectedSlots.size) return true;
    for (const slot of this.selectedSlots) {
      if (!this.initialSelectedSlots.has(slot)) return true;
    }
    return false;
  }

  // Quick actions
  setBusinessHours() {
    // Set 9:00 AM - 6:00 PM for weekdays (30-min slots)
    this.selectedSlots.clear();
    const dayArray = this.isSingleDayMode ? this.displayedWeekDays : this.weekDays;
    
    dayArray.forEach(dayObj => {
      // Only apply to weekdays (Mon-Fri, indices 1-5)
      if (dayObj.index >= 1 && dayObj.index <= 5) {
        const dateStr = this.formatDateKey(dayObj.date);
        const startIdx = 9 * 2; // 9:00
        const endIdx = 18 * 2; // 18:00 (exclusive)
        for (let idx = startIdx; idx < endIdx; idx++) {
          this.selectedSlots.add(`${dateStr}-${idx}`);
        }
      }
    });
    
    this.updateSelectedCount();
  }

  clearAll() {
    this.selectedSlots.clear();
    this.updateSelectedCount();
  }

  copyWeek() {
    // Copy currently selected time slots to all FUTURE days (next 8 weeks)
    if (this.selectedSlots.size === 0) {
      console.warn('No slots selected to copy');
      return;
    }
    
    // Extract all unique time slot indices from current selections (regardless of date)
    const timeSlotIndices = new Set<number>();
    this.selectedSlots.forEach(slotKey => {
      const parts = slotKey.split('-');
      if (parts.length >= 4) {
        const idx = parseInt(parts[3]); // Last part is the slot index
        if (!isNaN(idx)) {
          timeSlotIndices.add(idx);
        }
      }
    });
    
    if (timeSlotIndices.size === 0) {
      console.warn('No valid time slot indices found');
      return;
    }
    
    console.log('Copying time slot indices to all future days (next 8 weeks):', Array.from(timeSlotIndices));
    
    // Get tomorrow's date at midnight
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    // Calculate end date (8 weeks from now)
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + (8 * 7)); // 8 weeks = 56 days
    endDate.setHours(23, 59, 59, 999);
    
    console.log(`Applying to dates from ${tomorrow.toDateString()} to ${endDate.toDateString()}`);
    
    // Clear all selections
    this.selectedSlots.clear();
    
    let appliedDays = 0;
    
    // Generate all future days from tomorrow to 8 weeks ahead
    const currentDate = new Date(tomorrow);
    while (currentDate <= endDate) {
      const dateStr = this.formatDateKey(currentDate);
      timeSlotIndices.forEach(idx => {
        this.selectedSlots.add(`${dateStr}-${idx}`);
      });
      appliedDays++;
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    this.updateSelectedCount();
    this.hasUnsavedChanges = true;
    
    console.log(`✅ Applied slots to ${appliedDays} future days. Total slots: ${this.selectedSlots.size}`);
  }

  togglePopularSlots() {
    if (this.showPopularSlots && !this.popularSlotsLoaded && this.tutorTimezone) {
      this.loadPopularSlots(this.tutorTimezone);
    }
  }

  async showPopularSlotsInfo() {
    const message = this.popularSlotsIsEstimate
      ? 'Highlighted slots show generally popular times for online tutoring based on industry data. As more lessons are booked on the platform, this will update to reflect real student demand.'
      : 'Highlighted slots show the most popular booking times across the platform over the last 90 days. Darker slots have higher demand. Offering availability during these times can help you get more bookings.';
    const alert = await this.alertController.create({
      header: 'Popular with Students',
      message,
      buttons: ['Got it']
    });
    await alert.present();
  }

  // ── Google Calendar ──────────────────────────────

  connectGoogleCalendar() {
    this.userService.getGoogleCalendarAuthUrl().subscribe({
      next: (res) => {
        const popup = window.open(res.url, 'google-calendar-auth', 'width=500,height=700,left=200,top=100');
        let handled = false;

        const onLinked = (success: boolean) => {
          if (handled) return;
          handled = true;
          window.removeEventListener('message', messageHandler);
          if (pollTimer) clearInterval(pollTimer);

          if (success) {
            this.loadGoogleCalendarStatus();
            this.showToast('Google Calendar connected!', 'success');
          } else {
            this.showToast('Failed to connect Google Calendar.', 'danger');
          }
        };

        const messageHandler = (event: MessageEvent) => {
          if (event.data?.type === 'google_calendar_linked') {
            onLinked(event.data.success);
          }
        };
        window.addEventListener('message', messageHandler);

        // Poll for popup close -- if user completes flow but postMessage doesn't fire
        const pollTimer = setInterval(() => {
          if (!popup || popup.closed) {
            clearInterval(pollTimer);
            if (!handled) {
              // Popup closed -- check if connection succeeded
              this.userService.getGoogleCalendarStatus().subscribe({
                next: (status) => {
                  if (status.connected && !handled) {
                    onLinked(true);
                  } else if (!handled) {
                    handled = true;
                    window.removeEventListener('message', messageHandler);
                  }
                  this.cdr.detectChanges();
                }
              });
            }
          }
        }, 500);
      },
      error: () => this.showToast('Failed to start Google Calendar connection.', 'danger')
    });
  }

  async disconnectGoogleCalendar() {
    const alert = await this.alertController.create({
      header: 'Disconnect Google Calendar?',
      message: 'Your calendar events will no longer be synced.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Disconnect',
          role: 'destructive',
          handler: () => {
            this.userService.disconnectGoogleCalendar().subscribe({
              next: () => {
                this.gcalConnected = false;
                this.gcalEmail = null;
                this.gcalSyncEnabled = false;
                this.gcalPushToGoogle = false;
                this.gcalLastSyncAt = null;
                this.gcalBusySlots.clear();
                this.cdr.detectChanges();
                this.showToast('Google Calendar disconnected.', 'medium');
              },
              error: () => this.showToast('Failed to disconnect.', 'danger')
            });
          }
        }
      ]
    });
    await alert.present();
  }

  onGcalSettingChange(setting: 'syncEnabled' | 'pushToGoogle') {
    const updates: any = {};
    if (setting === 'syncEnabled') updates.syncEnabled = this.gcalSyncEnabled;
    if (setting === 'pushToGoogle') updates.pushToGoogle = this.gcalPushToGoogle;

    this.userService.updateGoogleCalendarSettings(updates).subscribe({
      next: () => {
        if (setting === 'syncEnabled' && this.gcalSyncEnabled) {
          this.loadGoogleCalendarEvents();
        } else if (setting === 'syncEnabled' && !this.gcalSyncEnabled) {
          this.gcalBusySlots.clear();
        }
      }
    });
  }

  private loadGoogleCalendarStatus() {
    this.userService.getGoogleCalendarStatus().subscribe({
      next: (status) => {
        this.gcalConnected = status.connected;
        this.gcalEmail = status.email;
        this.gcalSyncEnabled = status.syncEnabled;
        this.gcalPushToGoogle = status.pushToGoogle;
        this.gcalLastSyncAt = status.lastSyncAt ? new Date(status.lastSyncAt) : null;
        this.cdr.detectChanges();

        if (this.gcalConnected && this.gcalSyncEnabled) {
          this.loadGoogleCalendarEvents();
        }
      }
    });
  }

  private loadGoogleCalendarEvents() {
    if (!this.gcalConnected || !this.gcalSyncEnabled) return;

    const dayArray = this.isSingleDayMode ? this.displayedWeekDays : this.weekDays;
    if (!dayArray || dayArray.length === 0) return;

    const firstDay = dayArray[0].date;
    const lastDay = dayArray[dayArray.length - 1].date;

    const timeMin = new Date(firstDay);
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(lastDay);
    timeMax.setHours(23, 59, 59, 999);

    this.userService.getGoogleCalendarEvents(timeMin.toISOString(), timeMax.toISOString()).subscribe({
      next: (res) => {
        this.gcalBusySlots.clear();
        for (const evt of res.events) {
          if (evt.allDay) continue;
          const start = new Date(evt.start);
          const end = new Date(evt.end);
          this.markGcalBusy(start, end);
        }
        this.cdr.detectChanges();
      }
    });
  }

  private markGcalBusy(start: Date, end: Date) {
    const dateStr = this.formatDateKey(start);
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    const startIdx = Math.floor(startMinutes / 30);
    const endIdx = Math.ceil(endMinutes / 30);

    for (let i = startIdx; i < endIdx; i++) {
      this.gcalBusySlots.add(`${dateStr}-${i}`);
    }
  }

  isGcalBusySlot(day: any, slotIndex: number): boolean {
    if (!this.gcalSyncEnabled || this.gcalBusySlots.size === 0) return false;
    const dateStr = this.formatDateKey(day.date);
    return this.gcalBusySlots.has(`${dateStr}-${slotIndex}`);
  }

  // ── Calendar Settings ──────────────────────────────

  updateCalendarSetting(setting: string, value: string) {
    if (setting === 'timeFormat') {
      this.calendarTimeFormat = value as '12h' | '24h';
      this.userService.updateProfile({ calendarTimeFormat: value } as any).subscribe();
      this.initializeTimeSlots();
    } else if (setting === 'defaultView') {
      this.calendarDefaultView = value as 'week' | 'day';
      this.userService.updateProfile({ calendarDefaultView: value } as any).subscribe();
    }
  }

  private loadCalendarPreferences() {
    const user = this.userService.getCurrentUserValue();
    if (user?.profile) {
      this.calendarTimeFormat = (user.profile as any).calendarTimeFormat || '12h';
      this.calendarDefaultView = (user.profile as any).calendarDefaultView || 'week';
      this.initializeTimeSlots();
    }
  }

  private async showToast(message: string, color: string) {
    const toast = await this.toastController.create({ message, duration: 2500, position: 'bottom', color });
    await toast.present();
  }

  // Actions
  async previewSchedule() {
    console.log('Previewing schedule...');
    const toast = await this.toastController.create({
      message: `Preview: ${this.selectedSlotsCount} time slots selected`,
      duration: 2000,
      position: 'bottom'
    });
    await toast.present();
  }

  async saveAvailability() {
    const loading = await this.loadingController.create({
      message: 'Saving availability...',
      duration: 0
    });
    await loading.present();

    try {
      // Safety net: re-add any booked slots that may have been removed
      // This ensures availability is never deleted for time slots with scheduled lessons/classes
      this.bookedSlots.forEach(bookedSlotKey => {
        if (!this.selectedSlots.has(bookedSlotKey)) {
          console.log(`🔒 Re-adding booked slot to preserve availability: ${bookedSlotKey}`);
          this.selectedSlots.add(bookedSlotKey);
        }
      });
      
      // Convert selected slots to availability blocks
      const availabilityBlocks = this.convertSlotsToBlocks();
      
      // Get the dates being edited (so backend knows what to clear)
      const editedDates = this.getEditedDates();
      
      console.log('Saving availability blocks:', availabilityBlocks);
      console.log('Edited dates:', editedDates);
      
      this.userService.updateAvailability(availabilityBlocks, editedDates).subscribe({
        next: async (response) => {
          await loading.dismiss();
          console.log('✅ Availability saved successfully:', response);
          console.log('✅ Response availability:', response.availability?.length, 'blocks');
          
          const toast = await this.toastController.create({
            message: 'Availability saved successfully!',
            duration: 2000,
            position: 'bottom',
            color: 'success'
          });
          await toast.present();
          
          this.hasUnsavedChanges = false;
          // Update initial count and slots to reflect saved state
          this.initialSelectedSlotsCount = this.selectedSlotsCount;
          this.initialSelectedSlots = new Set(this.selectedSlots);
          
          // Note: The UserService emits availabilityUpdated$ event in tap()
          // which will be received by tab1 to update hasAvailability immediately
          
          // Emit event in embedded mode
          if (this.embeddedMode) {
            this.availabilitySaved.emit();
          }
        },
        error: async (error) => {
          await loading.dismiss();
          console.error('Error saving availability:', error);
          
          const toast = await this.toastController.create({
            message: 'Error saving availability. Please try again.',
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          await toast.present();
        }
      });
    } catch (error) {
      await loading.dismiss();
      console.error('Error converting slots to blocks:', error);
    }
  }

  private convertSlotsToBlocks(): any[] {
    const blocks: any[] = [];
    const dateGroups = new Map<string, number[]>(); // Group by date string instead of day index
    
    console.log('🔧 Converting slots to blocks. Selected slots:', Array.from(this.selectedSlots));
    
    // Group slots by date (YYYY-MM-DD)
    this.selectedSlots.forEach(slotKey => {
      // Slot key format: YYYY-MM-DD-slotIndex
      const parts = slotKey.split('-');
      if (parts.length < 4) {
        console.error(`🔧 Invalid slot key format: ${slotKey}`);
        return;
      }
      
      // Extract date (YYYY-MM-DD) and slot index
      const dateStr = `${parts[0]}-${parts[1]}-${parts[2]}`; // YYYY-MM-DD
      const idx = parseInt(parts[3]); // slot index
      
      console.log(`🔧 Processing slot: ${slotKey} -> date=${dateStr}, index=${idx}`);
      
      if (!dateGroups.has(dateStr)) {
        dateGroups.set(dateStr, []);
      }
      dateGroups.get(dateStr)!.push(idx);
    });
    
    // Convert each date's hours to blocks
    dateGroups.forEach((indices, dateStr) => {
      indices.sort((a, b) => a - b);

      let startIdx = indices[0];
      let endIdx = indices[0] + 1; // exclusive

      const idxToTime = (idx: number) => {
        const h = Math.floor(idx / 2);
        const m = idx % 2 === 1 ? '30' : '00';
        return `${h.toString().padStart(2, '0')}:${m}`;
      };

      // Parse the date from the date string (YYYY-MM-DD)
      // Use explicit local timezone parsing to avoid shifts
      const [year, month, day] = dateStr.split('-').map(Number);
      const dayDate = new Date(year, month - 1, day, 0, 0, 0, 0);
      const dayOfWeek = dayDate.getDay(); // Get day of week for backward compatibility
      console.log(`🔧 Date ${dateStr} maps to ${dayDate.toDateString()}, day of week: ${dayOfWeek}`);

      // Create absolute start/end dates for this specific date, in the tutor's profile timezone
      const tz = this.tutorTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const getAbsoluteDateTime = (date: Date, timeStr: string) => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const wallClock = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0);
        return fromZonedTime(wallClock, tz).toISOString();
      };

      for (let i = 1; i < indices.length; i++) {
        if (indices[i] === endIdx) {
          endIdx++;
        } else {
          const startTime = idxToTime(startIdx);
          const endTime = idxToTime(endIdx);
          const block = {
            id: `${dateStr}-${startIdx}-${endIdx}`,
            day: dayOfWeek, // Use day of week (0=Sun, 1=Mon, ..., 6=Sat) for backend compatibility
            startTime: startTime,
            endTime: endTime,
            absoluteStart: getAbsoluteDateTime(dayDate, startTime),
            absoluteEnd: getAbsoluteDateTime(dayDate, endTime),
            type: 'available',
            title: 'Available',
            color: '#007bff'
          };
          console.log(`🔧 Created block with absolute dates:`, block);
          blocks.push(block);

          startIdx = indices[i];
          endIdx = indices[i] + 1;
        }
      }

      const startTime = idxToTime(startIdx);
      const endTime = idxToTime(endIdx);
      const lastBlock = {
        id: `${dateStr}-${startIdx}-${endIdx}`,
        day: dayOfWeek, // Use day of week (0=Sun, 1=Mon, ..., 6=Sat) for backend compatibility
        startTime: startTime,
        endTime: endTime,
        absoluteStart: getAbsoluteDateTime(dayDate, startTime),
        absoluteEnd: getAbsoluteDateTime(dayDate, endTime),
        type: 'available',
        title: 'Available',
        color: '#007bff'
      };
      console.log(`🔧 Created last block with absolute dates:`, lastBlock);
      blocks.push(lastBlock);
    });
    
    return blocks;
  }
  
  /**
   * Get formatted timezone label
   */
  getTimezoneLabel(timezone: string): string {
    return getTimezoneLabel(timezone);
  }

  /**
   * Get the dates currently being edited (displayed in the grid)
   * This tells the backend which dates to clear before adding new blocks
   */
  private getEditedDates(): string[] {
    const dates: string[] = [];
    const dayArray = this.isSingleDayMode ? this.displayedWeekDays : this.weekDays;
    
    dayArray.forEach(day => {
      if (day.date) {
        const dateStr = this.formatDateKey(day.date);
        dates.push(dateStr);
      }
    });
    
    return dates;
  }
}