import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { UserService } from '../../services/user.service';
import { LessonService, Lesson } from '../../services/lesson.service';
import { ClassService } from '../../services/class.service';
import { Subject, asyncScheduler } from 'rxjs';
import { takeUntil, timeout, observeOn } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { detectUserTimezone, TIMEZONES, TimezoneOption, getTimezoneOffset } from '../../shared/timezone.constants';
import { getTimezoneLabel, convertTimeToTimezone, utcToWallClock, wallClockToUtc, getGlobalHour12 } from '../../shared/timezone.utils';

interface AvailabilityBlock {
  id: string;
  startTime: string;
  endTime: string;
  day: number;
  type: 'available' | 'unavailable' | 'break';
  title?: string;
  color?: string;
  absoluteStart?: string;
  absoluteEnd?: string;
}

export interface BookableSlotPreview {
  date: Date;
  dateIso: string;
  time: string;
  timeLabel: string;
  dateLabel: string;
  pillLabel: string;
}

export interface BookableSlotsScanResult {
  slots: BookableSlotPreview[];
  hasMore: boolean;
}

@Component({
  selector: 'app-tutor-availability-viewer',
  templateUrl: './tutor-availability-viewer.component.html',
  styleUrls: ['./tutor-availability-viewer.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class TutorAvailabilityViewerComponent implements OnInit, OnDestroy, OnChanges {
  @Input() tutorId!: string;
  @Input() tutorName!: string;
  // When true, render as an inline section (no modal chrome)
  @Input() inline = false;
  /** Embedded card styling for post-lesson and similar compact hosts */
  @Input() embedStyle: 'default' | 'card' = 'default';
  // Trigger refresh when this value changes
  @Input() refreshTrigger: number = 0;
  // Current user's auth0Id - if this matches tutor's auth0Id, disable slot selection
  @Input() currentUserAuth0Id?: string;
  // Tutor's auth0Id for comparison
  @Input() tutorAuth0Id?: string;
  // When true, allow tutors to select from their own availability (for scheduling classes)
  @Input() selectionMode = false;
  // When true, dismiss modal on slot selection (for programmatically opened modals)
  @Input() dismissOnSelect = false;
  // Student's busy time slots - filter these out when showing availability
  @Input() studentBusySlots?: Set<string>;
  // When true, show duration selector (only on tutor profile page)
  @Input() showDurationSelector = false;
  // Selected duration for filtering available slots (25 or 50 minutes)
  @Input() selectedDuration: 25 | 50 = 25; // Default to 25 minutes
  @Output() slotSelected = new EventEmitter<{ selectedDate: string; selectedTime: string; timezone?: string }>();
  @Output() paymentRequested = new EventEmitter<{ tutorId: string; date: string; time: string; duration: number; isTrialLesson: boolean; timezone: string }>();
  /** Emitted after availability data is fetched so hosts can short-circuit empty states. */
  @Output() availabilityLoaded = new EventEmitter<{ hasAvailability: boolean; tutorBlocked: boolean }>();
  
  private destroy$ = new Subject<void>();
  availability: AvailabilityBlock[] = [];
  timezone: string = 'America/New_York'; // Tutor's timezone
  viewerTimezone: string = ''; // Viewer's timezone (detected from browser)
  selectedTimezone: string = ''; // Currently selected timezone for display (dropdown)
  currentWeekStart: Date = new Date();
  isLoading = false;

  // Timezone dropdown options
  timezoneOptions: { value: string; label: string }[] = [];

  // Raw booked lessons stored for re-processing on timezone change
  private rawBookedLessons: any[] = [];
  
  daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  readonly skeletonDays = [0, 1, 2, 3, 4, 5, 6];
  readonly skeletonSlots = [0, 1, 2, 3, 4, 5];
  timeSlots: string[] = [];
  timeLabels: string[] = [];
  weekDates: Date[] = [];
  // Fast lookup: key = `${day}-${HH:mm}`
  availabilitySet: Set<string> = new Set();
  // Fast lookup for booked slots: key = `${day}-${HH:mm}`
  bookedSlots: Set<string> = new Set();
  private slotsCache: Map<string, { label: string; time: string; booked: boolean; isPast: boolean }[]> = new Map();
  // Pre-computed slots for each date in the current week (to avoid function calls in template)
  dateSlotsMap: Map<string, { label: string; time: string; booked: boolean; isPast: boolean }[]> = new Map();
  durationOptions = [
    { value: 25, label: '25 min', buffer: 5 },
    { value: 50, label: '50 min', buffer: 10 }
  ];
  
  // Trial lesson flag
  isTrialLesson = false;
  isCheckingTrial = false;
  
  // Tutor blocked flag (has pending feedback, not accepting bookings)
  tutorBlocked = false;
  
  // Computed properties to avoid function calls in template
  currentUserIsTutor = false;
  weekRangeDisplay = '';
  timezoneMessage = '';
  tutorTimezoneLabel = '';
  showTutorTimezoneHint = false;
  
  // Pre-computed date-to-slots array for direct template iteration (avoids function calls in *ngFor)
  weekDateSlots: { date: Date; slots: { label: string; time: string; booked: boolean; isPast: boolean }[] }[] = [];

  // Confirmation step state
  showConfirmation = false;
  confirmedDate: Date | null = null;
  confirmedDateIso = '';
  confirmedTime = '';
  confirmedDateFormatted = '';
  confirmedTimeFormatted = '';
  confirmedTimeEndFormatted = '';
  confirmDuration: 25 | 50 | null = null;
  canFit50Min = true;
  confirmedSlotLabel = '';
  confirmedSlotKey = '';
  private lastSlotRect: { left: number; top: number; width: number; height: number } | null = null;

  // Format tutor name as "FirstName L."
  get formattedTutorName(): string {
    if (!this.tutorName) return '';
    
    const parts = this.tutorName.trim().split(' ');
    if (parts.length === 1) {
      return parts[0]; // Just first name
    }
    
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    const lastInitial = lastName.charAt(0).toUpperCase();
    
    return `${firstName} ${lastInitial}.`;
  }

  get isCardEmbed(): boolean {
    return this.inline && this.embedStyle === 'card';
  }
  
  constructor(
    private userService: UserService,
    private lessonService: LessonService,
    private classService: ClassService,
    private modalController: ModalController,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    this.initializeTimeSlots();
    this.setCurrentWeekStart();
  }

  async close() {
    if (this.inline) return; // no-op when embedded inline
    try {
      await this.modalController.dismiss();
    } catch {}
  }

  ngOnInit() {
    // Set loading immediately
    this.isLoading = true;
    
    // Validate tutorId before proceeding
    if (!this.tutorId || this.tutorId.trim() === '') {
      console.error('❌ [Availability] Invalid tutorId:', this.tutorId);
      this.isLoading = false;
      if (!this.inline) {
        this.close();
      }
      return;
    }
    
    // Initialize computed properties (lightweight, synchronous operations only)
    this.currentUserIsTutor = this.isCurrentUserTutor();
    this.updateWeekRangeDisplay();
    this.updateTimezoneMessage();
    
    // Detect viewer's timezone and set as default selection
    this.viewerTimezone = detectUserTimezone();
    this.selectedTimezone = this.viewerTimezone;
    this.buildTimezoneOptions();
    
    // Check if this would be a trial lesson (only for students viewing tutor availability)
    // Wait for user to load first to ensure auth headers are available
    if ((this.showDurationSelector || this.embedStyle === 'card') && !this.currentUserIsTutor) {
      this.ensureUserLoadedThenCheckTrial();
    }
    
    // Initialize week dates
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(this.currentWeekStart);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    this.weekDates = dates;
    
    this.loadDataAndComputeSlots();
  }
  
  private async loadDataAndComputeSlots() {
    try {
      await Promise.all([
        this.loadAvailability().catch(() => {}),
        this.loadBookedLessons().catch(() => {}),
      ]);
      this.precomputeDateSlots();
    } catch (error) {
      console.error('❌ [Availability] Error loading data:', error);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }
  
  // TrackBy functions for better performance (arrow functions to preserve 'this' context)
  trackByDate = (_: number, dateSlot: { date: Date; slots: any[] }): string => {
    return this.dateKey(dateSlot.date);
  }
  
  trackBySlot = (_: number, slot: { label: string; time: string }): string => {
    return slot.time;
  }
  
  // Update computed properties when needed
  private updateWeekRangeDisplay() {
    this.weekRangeDisplay = this.getWeekRange();
  }
  
  private updateTimezoneMessage() {
    this.timezoneMessage = this.getTimezoneMessage();
    this.showTutorTimezoneHint = !this.isViewerTimezoneSameAsTutor();
    this.tutorTimezoneLabel = getTimezoneLabel(this.timezone);
  }

  ngOnChanges(changes: SimpleChanges) {
    // Reload availability if tutorId changes (and we have a valid new tutorId)
    if (changes['tutorId'] && !changes['tutorId'].firstChange) {
      const newTutorId = changes['tutorId'].currentValue;
      if (newTutorId) {
        console.log('🔄 [AvailabilityViewer] tutorId changed to:', newTutorId);
        // Clear ALL caches before reloading
        this.slotsCache.clear();
        this.availabilitySet.clear();
        this.bookedSlots.clear();
        this.isLoading = true;
        
        this.loadDataAndComputeSlots();
      }
    }
    
    // Reload availability if refreshTrigger changes
    if (changes['refreshTrigger']) {
      if (!changes['refreshTrigger'].firstChange) {
        // Clear ALL caches before reloading
        this.slotsCache.clear();
        this.availabilitySet.clear();
        this.bookedSlots.clear();
        
        Promise.all([
          this.loadAvailability().catch(() => {}),
          this.loadBookedLessons().catch(() => {}),
        ]).then(() => {
          this.precomputeDateSlots();
          this.cdr.markForCheck();
        });
      }
    }
    
    // Recompute slots if studentBusySlots changes
    if (changes['studentBusySlots']) {
      this.precomputeDateSlots();
    }
    
    // Recompute slots if selectedDuration changes
    if (changes['selectedDuration'] && !changes['selectedDuration'].firstChange) {
      // Clear cache to force recalculation with new duration
      this.slotsCache.clear();
      // Recompute slots for current week with new duration
      this.precomputeDateSlots();
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  selectTimeSlot(dayIndex: number, timeSlot: string) {
    // Handle time slot selection
    // You can add booking logic here
  }

  formatTimeSlot(timeSlot: string): string {
    const hour = parseInt(timeSlot);
    if (!getGlobalHour12()) {
      return `${String(hour).padStart(2, '0')}:00`;
    }
    const isPM = hour >= 12;
    const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    const period = isPM ? 'PM' : 'AM';
    return `${displayHour}:00 ${period}`;
  }

  private initializeTimeSlots() {
    // Generate time slots from 12:00 AM (midnight) to 11:30 PM in 30-minute increments
    // This matches the tutor calendar which starts at midnight
    for (let hour = 0; hour <= 23; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        this.timeSlots.push(time);
        this.timeLabels.push(this.formatTime(time));
      }
    }
  }

  private setCurrentWeekStart() {
    // Start the 7-day window at "today" (not week start)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.currentWeekStart = today;
  }

  async loadAvailability(): Promise<void> {
    // Guard: Don't make API call if tutorId is invalid
    if (!this.tutorId) {
      console.warn('⚠️ [AvailabilityViewer] Cannot load availability: tutorId is empty');
      return Promise.resolve();
    }
    
    return new Promise((resolve, reject) => {
      // Add timeout to the Observable itself
      this.userService.getTutorAvailability(this.tutorId)
        .pipe(
          observeOn(asyncScheduler), // Make emissions async to prevent freezing
          takeUntil(this.destroy$),
          timeout(5000) // 5 second timeout
        )
        .subscribe({
          next: async (response) => {
            this.availability = response.availability || [];
            this.timezone = response.timezone || 'America/New_York';
            this.updateTimezoneMessage();

            // Check if tutor is accepting bookings
            if (response.acceptingBookings === false) {
              this.tutorBlocked = true;
              console.log('⚠️ [AvailabilityViewer] Tutor is not accepting bookings (pending feedback)');
            } else {
              this.tutorBlocked = false;
            }
            
            this.slotsCache.clear();
            this.availabilitySet.clear();
            this.buildAvailabilitySet();
            this.availabilityLoaded.emit({
              hasAvailability: this.availability.length > 0,
              tutorBlocked: this.tutorBlocked
            });
            resolve();
          },
          error: (error) => {
            console.error('Error loading availability:', error);
            reject(error);
          }
        });
    });
  }

  isSlotAvailable(day: number, timeSlot: string): boolean {
    return this.availabilitySet.has(`${day}-${timeSlot}`);
  }

  isSlotBooked(day: number, timeSlot: string): boolean {
    return this.bookedSlots.has(`${day}-${timeSlot}`);
  }

  async loadBookedLessons() {
    // Guard: Don't make API call if tutorId is invalid
    if (!this.tutorId) {
      console.warn('⚠️ [AvailabilityViewer] Cannot load booked lessons: tutorId is empty');
      return;
    }
    
    try {
      const rangeStart = new Date(this.currentWeekStart);
      const rangeEnd = new Date(this.currentWeekStart);
      rangeEnd.setDate(rangeEnd.getDate() + 28);
      const sd = rangeStart.toISOString();
      const ed = rangeEnd.toISOString();

      const lessonsRace = Promise.race([
        firstValueFrom(this.lessonService.getLessonsByTutor(this.tutorId, false, sd, ed)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Lessons timeout')), 5000)),
      ]).catch(() => ({ success: false, lessons: [] }));

      const classesRace = Promise.race([
        firstValueFrom(this.classService.getClassesForTutor(this.tutorId, sd, ed)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Classes timeout')), 5000)),
      ]).catch(() => ({ success: false, classes: [] }));

      const [lessonsResponse, classesResponse]: any[] = await Promise.all([lessonsRace, classesRace]);
      
      // Combine lessons and classes into a single array
      const allBookedSlots: any[] = [];
      
      if (lessonsResponse.success && lessonsResponse.lessons) {
        allBookedSlots.push(...lessonsResponse.lessons);
      }
      
      // Convert classes to lesson-like format for processing
      if (classesResponse.success && classesResponse.classes) {
        // Filter out cancelled classes - they shouldn't block availability
        const activeClasses = classesResponse.classes.filter((cls: any) => cls.status !== 'cancelled');
        
        const classesAsLessons = activeClasses.map((cls: any) => ({
          startTime: cls.startTime,
          endTime: cls.endTime,
          status: cls.status || 'scheduled', // Preserve actual status
          _id: cls._id,
          subject: cls.name
        }));
        allBookedSlots.push(...classesAsLessons);
      }
      
      if (allBookedSlots.length > 0) {
        this.buildBookedSlotsSet(allBookedSlots);
      } else {
        this.bookedSlots = new Set();
      }
    } catch (error) {
      console.error('Error loading booked lessons:', error);
      // Don't fail silently - set empty set if error
      this.bookedSlots = new Set();
    }
  }

  private buildBookedSlotsSet(lessons: any[]) {
    this.rawBookedLessons = lessons;
    const set = new Set<string>();

    const weekDateKeys = new Set<string>();
    for (const wd of this.weekDates) {
      weekDateKeys.add(this.dateKey(wd));
    }

    for (const lesson of lessons) {
      if (lesson.status !== 'scheduled' && lesson.status !== 'in_progress' && lesson.status !== 'pending_reschedule') {
        continue;
      }

      const startTime = new Date(lesson.startTime);
      const lessonDurationMinutes = lesson.duration || 60;
      const bufferMinutes = lessonDurationMinutes === 25 ? 5 : lessonDurationMinutes === 50 ? 10 : 10;

      // Calculate blocked window from startTime + (duration + buffer) to avoid
      // double-buffering if endTime already includes the buffer, and to avoid
      // millisecond precision issues at 30-min boundaries.
      const endTimeWithBuffer = new Date(startTime.getTime() + (lessonDurationMinutes + bufferMinutes) * 60000);
      endTimeWithBuffer.setSeconds(0, 0);

      // Round start down to nearest 30-min boundary
      let currentUTC = new Date(startTime);
      currentUTC.setMinutes(Math.floor(currentUTC.getMinutes() / 30) * 30, 0, 0);

      while (currentUTC < endTimeWithBuffer) {
        // Convert UTC lesson time → viewer's selected timezone
        const inViewer = utcToWallClock(currentUTC, this.selectedTimezone);
        // Use date-specific key so lessons from different weeks don't collide
        if (weekDateKeys.has(inViewer.date)) {
          set.add(`${inViewer.date}-${inViewer.time}`);
        }
        currentUTC = new Date(currentUTC.getTime() + 30 * 60000);
      }
    }

    console.log('🔒 [BookedSlots] Final booked slots:', [...set].sort());

    this.bookedSlots = set;
    this.slotsCache.clear();
  }

  private buildAvailabilitySet() {
    const set = new Set<string>();
    
    // Build a map for quick date lookups: dateKey -> weekIndex
    const dateIndexMap = new Map<string, number>();
    for (let i = 0; i < this.weekDates.length; i++) {
      const dateKey = this.dateKey(this.weekDates[i]);
      dateIndexMap.set(dateKey, i);
    }
    
    // Limit processing to prevent freezing
    const maxBlocksToProcess = 1000;
    const blocksToProcess = this.availability.slice(0, maxBlocksToProcess);
    
    if (this.availability.length > maxBlocksToProcess) {
      console.warn(`⚠️ Too many availability blocks (${this.availability.length}), limiting to ${maxBlocksToProcess}`);
    }
    
    for (const block of blocksToProcess) {
      if (block.type !== 'available') {
        continue;
      }
      
      // Check if block has specific date range
      if (block.absoluteStart && block.absoluteEnd) {
        const blockStart = new Date(block.absoluteStart);
        const blockEnd = new Date(block.absoluteEnd);
        
        // Normalize to start of day for comparison
        blockStart.setHours(0, 0, 0, 0);
        blockEnd.setHours(0, 0, 0, 0);
        
        // Check if this block applies to any date in the current week
        let appliestoThisWeek = false;
        for (const weekDate of this.weekDates) {
          const checkDate = new Date(weekDate);
          checkDate.setHours(0, 0, 0, 0);
          
          if (checkDate.getTime() >= blockStart.getTime() && checkDate.getTime() <= blockEnd.getTime()) {
            appliestoThisWeek = true;
            break;
          }
        }
        
        // Skip this block if it doesn't apply to any day in the displayed week
        if (!appliestoThisWeek) {
          continue;
        }
      } else if (block.id && typeof block.id === 'string') {
        // If no absoluteStart, try to parse date from the id field (format: "YYYY-MM-DD-...")
        const idParts = block.id.split('-');
        if (idParts.length >= 3) {
          // Parse as local date to avoid timezone shifts
          const year = parseInt(idParts[0]);
          const month = parseInt(idParts[1]) - 1; // Month is 0-indexed
          const day = parseInt(idParts[2]);
          const blockDate = new Date(year, month, day, 0, 0, 0, 0);
          
          // Check if this date is in the current week
          let appliesToThisWeek = false;
          for (const weekDate of this.weekDates) {
            const checkDate = new Date(weekDate);
            checkDate.setHours(0, 0, 0, 0);
            
            if (blockDate.getTime() === checkDate.getTime()) {
              appliesToThisWeek = true;
              break;
            }
          }
          
          // Skip this block if it doesn't apply to the current week
          if (!appliesToThisWeek) {
            continue;
          }
        }
      }
      
      const start = this.timeToMinutes(block.startTime);
      const end = this.timeToMinutes(block.endTime);
      
      for (let m = start; m < end; m += 30) {
        const hh = Math.floor(m / 60).toString().padStart(2, '0');
        const mm = (m % 60).toString().padStart(2, '0');
        const key = `${block.day}-${hh}:${mm}`;
        set.add(key);
      }
    }
    this.availabilitySet = set;
    this.slotsCache.clear();
    
    // DON'T recompute slots here - let the caller handle it to avoid race conditions
    // This allows ngOnInit to wait for BOTH availability and bookedLessons before computing
  }

  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private recomputeWeekDates() {
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(this.currentWeekStart);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    this.weekDates = dates;
    this.slotsCache.clear();
    // NOTE: intentionally NOT calling precomputeDateSlots() here.
    // Callers (navigateWeek, goToToday) must call buildAvailabilitySet() +
    // loadBookedLessons() first, then call precomputeDateSlots() once at the end.
  }

  // Pre-compute slots for all dates in the current week
  private precomputeDateSlots() {
    this.dateSlotsMap.clear();
    const newWeekDateSlots: { date: Date; slots: { label: string; time: string; booked: boolean; isPast: boolean }[] }[] = [];
    
    // Process all dates at once instead of in batches to avoid multiple render cycles
    for (let i = 0; i < this.weekDates.length; i++) {
      const date = this.weekDates[i];
      const dateKey = this.dateKey(date);
      
      try {
        const slots = this.computeAvailableTimeLabelsForDate(date);
        this.dateSlotsMap.set(dateKey, slots);
        
        // Build weekDateSlots array for direct template iteration (avoids function calls)
        newWeekDateSlots.push({ date, slots });
      } catch (error) {
        console.error(`❌ Error computing slots for ${dateKey}:`, error);
        // Set empty array on error to prevent crashes
        this.dateSlotsMap.set(dateKey, []);
        newWeekDateSlots.push({ date, slots: [] });
      }
    }
    
    // Update the array once to trigger a single change detection cycle
    this.weekDateSlots = newWeekDateSlots;
  }

  // Get pre-computed slots for a date (used in template)
  getSlotsForDate(date: Date): { label: string; time: string; booked: boolean; isPast: boolean }[] {
    const dateKey = this.dateKey(date);
    return this.dateSlotsMap.get(dateKey) || [];
  }

  getWeekRange(): string {
    const start = new Date(this.currentWeekStart);
    const end = new Date(this.currentWeekStart);
    end.setDate(end.getDate() + 6);
    
    const startMonth = start.toLocaleString('default', { month: 'short' });
    const endMonth = end.toLocaleString('default', { month: 'short' });
    const startDate = start.getDate();
    const endDate = end.getDate();
    const year = end.getFullYear();
    
    if (startMonth === endMonth) {
      return `${startMonth} ${startDate} - ${endDate}, ${year}`;
    }
    return `${startMonth} ${startDate} - ${endMonth} ${endDate}, ${year}`;
  }

  async navigateWeek(direction: 'prev' | 'next') {
    const days = direction === 'next' ? 7 : -7;
    this.currentWeekStart.setDate(this.currentWeekStart.getDate() + days);
    this.recomputeWeekDates();
    this.updateWeekRangeDisplay();
    // Reload availability + booked lessons in parallel for the new week
    await Promise.all([
      this.loadAvailability().catch(() => {}),
      this.loadBookedLessons().catch(() => {}),
    ]);
    this.precomputeDateSlots();
    this.cdr.markForCheck();
  }

  async goToToday() {
    this.setCurrentWeekStart();
    this.recomputeWeekDates();
    this.updateWeekRangeDisplay();
    await Promise.all([
      this.loadAvailability().catch(() => {}),
      this.loadBookedLessons().catch(() => {}),
    ]);
    this.precomputeDateSlots();
    this.cdr.markForCheck();
  }

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    if (!getGlobalHour12()) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  }

  getDayNumber(date: Date): number { return date.getDate(); }
  getDayIndex(date: Date): number { return date.getDay(); }

  // Availability-setup uses 0=Mon ... 6=Sun; convert Date.getDay() (0=Sun) to that
  getSetupDayIndex(date: Date): number { return (date.getDay() + 6) % 7; }

  private isSameCalendarWeek(dateA: Date, dateB: Date): boolean {
    const a = new Date(dateA);
    const b = new Date(dateB);
    // Set to Thursday in current week to avoid week boundary issues
    const dayA = (a.getDay() + 6) % 7; // 0=Mon
    const dayB = (b.getDay() + 6) % 7; // 0=Mon
    a.setDate(a.getDate() - dayA + 3);
    b.setDate(b.getDate() - dayB + 3);
    // Compare year-week numbers
    return a.getFullYear() === b.getFullYear() && this.getWeekNumber(a) === this.getWeekNumber(b);
  }

  private getWeekNumber(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
    const weekNo = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
    return weekNo;
  }

  dateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  private isSlotInPast(date: Date, timeSlot: string): boolean {
    const dateStr = this.dateKey(date);
    const utcTime = wallClockToUtc(dateStr, timeSlot, this.selectedTimezone);
    return utcTime < new Date();
  }

  /**
   * Compute available time slots for a given date.
   * Times are displayed in the viewer's selected timezone.
   * Availability is checked by converting each viewer-tz slot → tutor-tz and matching against blocks.
   */
  private computeAvailableTimeLabelsForDate(date: Date): { label: string; time: string; booked: boolean; isPast: boolean }[] {
    // Note: no window-range guard here — this private function is only called
    // from precomputeDateSlots, which already iterates over this.weekDates
    // (dates that are by construction within the current week).

    const shouldCache = !this.studentBusySlots || this.studentBusySlots.size === 0;
    const cacheKey = `${this.dateKey(date)}_${Math.floor(Date.now() / 60000)}_${this.selectedDuration}_${this.selectedTimezone}`;
    const cached = shouldCache ? this.slotsCache.get(cacheKey) : undefined;
    if (cached) return cached;

    if (this.slotsCache.size > 10) {
      const firstKey = this.slotsCache.keys().next().value;
      if (firstKey) this.slotsCache.delete(firstKey);
    }

    const viewerDateStr = this.dateKey(date);
    const dayIndex = date.getDay();
    const sameTimezone = this.selectedTimezone === this.timezone;

    const slots: { label: string; time: string; booked: boolean; isPast: boolean }[] = [];

    for (let i = 0; i < this.timeSlots.length; i++) {
      const viewerTime = this.timeSlots[i];

      // Convert viewer's (date + time) → tutor's (date + time) for availability lookup
      let tutorDayIndex: number;
      let tutorTimeStr: string;
      let tutorDateStr: string;

      if (sameTimezone) {
        tutorDayIndex = dayIndex;
        tutorTimeStr = viewerTime;
        tutorDateStr = viewerDateStr;
      } else {
        const converted = convertTimeToTimezone(viewerDateStr, viewerTime, this.selectedTimezone, this.timezone);
        tutorDayIndex = converted.dayOfWeek;
        tutorTimeStr = converted.time;
        tutorDateStr = converted.date;
      }

      const tutorTimeMinutes = this.timeToMinutes(tutorTimeStr);

      // Check if any tutor availability block covers this time
      const hasAvailability = this.availability.some(block => {
        if (block.type !== 'available') return false;
        if (block.day !== tutorDayIndex) return false;

        // Date-specific blocks: check if this block applies to tutorDateStr.
        // Prefer id-based date matching (format "YYYY-MM-DD-...") because the id
        // always reflects the tutor's LOCAL calendar date, avoiding UTC-to-local
        // timezone conversion issues with absoluteStart/absoluteEnd.
        if (block.absoluteStart && block.absoluteEnd) {
          if (block.id && typeof block.id === 'string') {
            const idParts = block.id.split('-');
            if (idParts.length >= 3 && /^\d{4}$/.test(idParts[0])) {
              // id is in "YYYY-MM-DD-..." format — compare date strings directly
              const blockDateStr = `${idParts[0]}-${idParts[1]}-${idParts[2]}`;
              if (blockDateStr !== tutorDateStr) return false;
            } else {
              // Fallback: use absoluteStart, normalized to midnight in browser tz
              const blockStart = new Date(block.absoluteStart);
              const blockEnd = new Date(block.absoluteEnd);
              blockStart.setHours(0, 0, 0, 0);
              blockEnd.setHours(0, 0, 0, 0);
              const [ty, tm, td] = tutorDateStr.split('-').map(Number);
              const tutorDate = new Date(ty, tm - 1, td, 0, 0, 0, 0);
              if (tutorDate < blockStart || tutorDate > blockEnd) return false;
            }
          } else {
            // No id — fall back to absoluteStart/absoluteEnd date check
            const blockStart = new Date(block.absoluteStart);
            const blockEnd = new Date(block.absoluteEnd);
            blockStart.setHours(0, 0, 0, 0);
            blockEnd.setHours(0, 0, 0, 0);
            const [ty, tm, td] = tutorDateStr.split('-').map(Number);
            const tutorDate = new Date(ty, tm - 1, td, 0, 0, 0, 0);
            if (tutorDate < blockStart || tutorDate > blockEnd) return false;
          }
        } else if (block.id && typeof block.id === 'string') {
          // No absoluteStart — try id-based date (format: "YYYY-MM-DD-...")
          const idParts = block.id.split('-');
          if (idParts.length >= 3 && /^\d{4}$/.test(idParts[0])) {
            const blockDateStr = `${idParts[0]}-${idParts[1]}-${idParts[2]}`;
            if (blockDateStr !== tutorDateStr) return false;
          }
        }

        const blockStart = this.timeToMinutes(block.startTime);
        const blockEnd = this.timeToMinutes(block.endTime);
        return tutorTimeMinutes >= blockStart && tutorTimeMinutes < blockEnd;
      });

      if (hasAvailability) {
        // Booked check uses date-specific key in viewer timezone
        const bookedKey = `${viewerDateStr}-${viewerTime}`;
        const isBooked = this.bookedSlots.has(bookedKey);
        const isPast = this.isSlotInPast(date, viewerTime);

        const isStudentBusy = this.isStudentBusyAtSlot(dayIndex, viewerTime, viewerDateStr);

        const shouldFilterByDuration = this.showDurationSelector || this.selectionMode;
        const hasEnoughTime = shouldFilterByDuration && !isBooked && !isPast
          ? this.hasEnoughConsecutiveTime(date, viewerTime, dayIndex)
          : true;

        if (!isStudentBusy && hasEnoughTime) {
          slots.push({ label: this.timeLabels[i], time: viewerTime, booked: isBooked, isPast: isPast });
        }
      }
    }

    const available = slots.filter(s => !s.booked && !s.isPast);

    if (shouldCache) this.slotsCache.set(cacheKey, available);
    return available;
  }

  // Check if student has a conflicting lesson at this time slot
  private isStudentBusyAtSlot(dayIndex: number, timeSlot: string, dateKey: string): boolean {
    if (!this.studentBusySlots || this.studentBusySlots.size === 0) {
      return false;
    }
    
    // Check both day-based and date-specific keys
    const dayBasedKey = `${dayIndex}-${timeSlot}`;
    const dateSpecificKey = `${dateKey}-${timeSlot}`;
    
    const isBusy = this.studentBusySlots.has(dayBasedKey) || this.studentBusySlots.has(dateSpecificKey);
    
    return isBusy;
  }

  isCurrentUserTutor(): boolean {
    if (!this.currentUserAuth0Id || !this.tutorAuth0Id) {
      return false;
    }
    return (
      this.currentUserAuth0Id === this.tutorAuth0Id ||
      this.currentUserAuth0Id === this.tutorAuth0Id.replace('dev-user-', '') ||
      `dev-user-${this.currentUserAuth0Id}` === this.tutorAuth0Id
    );
  }

  onDurationChange(duration: 25 | 50) {
    this.selectedDuration = duration;
    
    // Clear cache to force recalculation with new duration
    this.slotsCache.clear();
    
    // Recompute slots for current week with new duration
    this.precomputeDateSlots();
  }

  private buildTimezoneOptions() {
    const seen = new Set<string>();
    const options: { value: string; label: string }[] = [];

    // Always include the detected browser timezone first
    if (this.viewerTimezone) {
      seen.add(this.viewerTimezone);
      options.push({ value: this.viewerTimezone, label: `${getTimezoneLabel(this.viewerTimezone)} (You)` });
    }

    for (const tz of TIMEZONES) {
      if (!seen.has(tz.value)) {
        seen.add(tz.value);
        const offset = getTimezoneOffset(tz.value);
        options.push({ value: tz.value, label: `${tz.label} (${offset})` });
      }
    }

    this.timezoneOptions = options;
  }

  onTimezoneChange(newTimezone: string) {
    if (newTimezone === this.selectedTimezone) return;
    this.selectedTimezone = newTimezone;
    this.slotsCache.clear();
    this.updateTimezoneMessage();

    // Rebuild booked slots in new timezone
    if (this.rawBookedLessons.length > 0) {
      this.buildBookedSlotsSet(this.rawBookedLessons);
    }

    this.precomputeDateSlots();
  }

  /**
   * Check if a time slot has enough consecutive available time for the selected duration + buffer.
   * Uses viewer-timezone keys for booked-slot lookups (matching how bookedSlots was built).
   */
  private hasEnoughConsecutiveTime(date: Date, timeSlot: string, _dayIndex: number): boolean {
    const bufferMinutes = this.selectedDuration === 25 ? 5 : 10;
    const totalMinutesNeeded = this.selectedDuration + bufferMinutes;
    const viewerDateStr = this.dateKey(date);
    const [startH, startM] = timeSlot.split(':').map(Number);
    const startMinutes = startH * 60 + startM;

    for (let offset = 0; offset < totalMinutesNeeded; offset += 30) {
      const checkMinutes = startMinutes + offset;
      const hh = Math.floor(checkMinutes / 60).toString().padStart(2, '0');
      const mm = (checkMinutes % 60).toString().padStart(2, '0');
      if (this.bookedSlots.has(`${viewerDateStr}-${hh}:${mm}`)) return false;
    }

    return true;
  }

  onSelectSlot(date: Date, slot: { label: string; time: string; booked?: boolean; isPast?: boolean }, event?: Event) {
    // Don't allow booking if tutor is blocked (pending feedback)
    if (this.tutorBlocked) {
      return;
    }
    
    // Don't allow booking if slot is already booked or in the past
    if (slot.booked || slot.isPast) {
      return;
    }
    
    // If in selection mode, emit event and optionally dismiss modal
    if (this.selectionMode) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      this.slotSelected.emit({
        selectedDate: dateString,
        selectedTime: slot.time,
        timezone: this.selectedTimezone
      });

      if (this.dismissOnSelect) {
        this.modalController.dismiss({
          selectedDate: dateString,
          selectedTime: slot.time,
          lessonMinutes: this.selectedDuration,
          timezone: this.selectedTimezone
        });
      }

      return;
    }

    if (this.isCurrentUserTutor()) return;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateIso = `${year}-${month}-${day}`;

    // Capture the clicked slot's position BEFORE we swap panels
    const slotEl = (event?.target as HTMLElement)?.closest('.slot') as HTMLElement | null;
    const srcRect = slotEl ? slotEl.getBoundingClientRect() : null;
    const slotLabel = slot.label;

    // Store for the reverse animation so we don't need to query the DOM later
    this.lastSlotRect = srcRect ? { left: srcRect.left, top: srcRect.top, width: srcRect.width, height: srcRect.height } : null;

    this.confirmedDate = date;
    this.confirmedDateIso = dateIso;
    this.confirmedTime = slot.time;
    this.confirmedSlotLabel = slot.label;
    this.confirmedSlotKey = `${date.toISOString().slice(0, 10)}-${slot.time}`;
    this.canFit50Min = this.checkCanFit(date, slot.time, 50);
    this.confirmDuration = null;
    this.updateConfirmationLabels();

    // Swap panels instantly (*ngIf)
    this.showConfirmation = true;
    this.cdr.detectChanges();

    if (!srcRect) return;

    // Build clone at the slot's original position
    const clone = document.createElement('div');
    clone.textContent = slotLabel;
    const t = '0.46s cubic-bezier(0.32,0.72,0,1)';
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${srcRect.left}px`,
      top: `${srcRect.top}px`,
      width: `${srcRect.width}px`,
      height: `${srcRect.height}px`,
      zIndex: '10000',
      pointerEvents: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
      fontSize: '11px',
      fontWeight: '500',
      letterSpacing: '-0.2px',
      color: '#222222',
      backgroundColor: '#ffffff',
      border: '1px solid #DDDDDD',
      borderRadius: '8px',
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      transition: `left ${t}, top ${t}, width ${t}, height ${t}, border-radius ${t}, font-size 0.3s ease 0.06s, color 0.2s ease 0.06s, box-shadow 0.36s ease`,
      overflow: 'hidden',
    });
    document.body.appendChild(clone);

    // Hide the real receipt card — the clone will stand in for it
    const receipt = document.querySelector('.confirm-receipt') as HTMLElement;
    if (receipt) {
      receipt.style.transition = 'none';
      receipt.style.opacity = '0';
    }

    // Next frame: receipt is in final layout position, morph the clone to it
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!receipt) { clone.remove(); return; }
        const destRect = receipt.getBoundingClientRect();

        // Morph: small pill → full card
        clone.style.left = `${destRect.left}px`;
        clone.style.top = `${destRect.top}px`;
        clone.style.width = `${destRect.width}px`;
        clone.style.height = `${destRect.height}px`;
        clone.style.borderRadius = '14px';
        clone.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)';
        clone.style.color = 'transparent';

        // Once morph lands, reveal the real card and remove clone
        setTimeout(() => {
          receipt.style.transition = 'opacity 0.15s ease';
          receipt.style.opacity = '1';
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (clone.parentNode) clone.remove();
              // Clean up inline styles
              setTimeout(() => { receipt.style.transition = ''; receipt.style.opacity = ''; }, 200);
            });
          });
        }, 440);
      });
    });
  }

  /**
   * Check whether a lesson of `duration` minutes fits at the given slot
   * by verifying no booked slots overlap within duration + buffer.
   * The starting slot's availability is already guaranteed (only available slots are selectable).
   * Server-side booking validates full tutor availability before confirming.
   */
  private checkCanFit(date: Date, timeSlot: string, duration: number): boolean {
    const bufferMinutes = duration === 25 ? 5 : 10;
    const totalMinutesNeeded = duration + bufferMinutes;
    const viewerDateStr = this.dateKey(date);

    const [startH, startM] = timeSlot.split(':').map(Number);
    const startMinutes = startH * 60 + startM;

    for (let offset = 0; offset < totalMinutesNeeded; offset += 30) {
      const viewerMinutes = startMinutes + offset;
      const hh = Math.floor(viewerMinutes / 60).toString().padStart(2, '0');
      const mm = (viewerMinutes % 60).toString().padStart(2, '0');
      if (this.bookedSlots.has(`${viewerDateStr}-${hh}:${mm}`)) return false;
    }

    return true;
  }

  updateConfirmationLabels() {
    if (!this.confirmedDate) return;
    const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' };
    this.confirmedDateFormatted = this.confirmedDate.toLocaleDateString(undefined, opts);

    const [h, m] = this.confirmedTime.split(':').map(Number);
    const startDate = new Date(this.confirmedDate);
    startDate.setHours(h, m, 0, 0);

    const timeFmt: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: getGlobalHour12() };
    this.confirmedTimeFormatted = startDate.toLocaleTimeString(undefined, timeFmt);

    if (this.confirmDuration) {
      const endDate = new Date(startDate.getTime() + this.confirmDuration * 60000);
      this.confirmedTimeEndFormatted = endDate.toLocaleTimeString(undefined, timeFmt);
    } else {
      this.confirmedTimeEndFormatted = '';
    }
  }

  onConfirmDurationChange(dur: 25 | 50) {
    this.confirmDuration = dur;
    this.updateConfirmationLabels();
  }

  backToCalendar() {
    // Step 1: Capture the receipt card's position BEFORE the swap
    const receipt = document.querySelector('.confirm-receipt') as HTMLElement;
    if (!receipt) { this.showConfirmation = false; this.cdr.detectChanges(); return; }
    const srcRect = receipt.getBoundingClientRect();
    const destRect = this.lastSlotRect;

    // Step 2: Create a clone that looks exactly like the receipt card
    const clone = document.createElement('div');
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${srcRect.left}px`,
      top: `${srcRect.top}px`,
      width: `${srcRect.width}px`,
      height: `${srcRect.height}px`,
      zIndex: '10000',
      pointerEvents: 'none',
      boxSizing: 'border-box',
      backgroundColor: '#ffffff',
      border: '1px solid #DDDDDD',
      borderRadius: '14px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      overflow: 'hidden',
    });
    document.body.appendChild(clone);

    // Step 3: Swap panels
    this.showConfirmation = false;
    this.cdr.detectChanges();

    if (!destRect) {
      // No stored slot position — just fade out
      clone.style.transition = 'opacity 0.25s ease';
      clone.style.opacity = '0';
      setTimeout(() => { if (clone.parentNode) clone.remove(); }, 300);
      return;
    }

    // Step 4: Next frame — apply transition, then morph from card → slot position
    requestAnimationFrame(() => {
      const t = '0.46s cubic-bezier(0.32,0.72,0,1)';
      clone.style.transition = `left ${t}, top ${t}, width ${t}, height ${t}, border-radius ${t}, box-shadow ${t}`;

      requestAnimationFrame(() => {
        clone.style.left = `${destRect.left}px`;
        clone.style.top = `${destRect.top}px`;
        clone.style.width = `${destRect.width}px`;
        clone.style.height = `${destRect.height}px`;
        clone.style.borderRadius = '8px';
        clone.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)';

        // After morph lands, fade out clone
        setTimeout(() => {
          clone.style.transition = 'opacity 0.15s ease';
          clone.style.opacity = '0';
          setTimeout(() => { if (clone.parentNode) clone.remove(); }, 180);
        }, 460);
      });
    });
  }

  goToPayment() {
    if (!this.confirmDuration) return;

    const paymentData = {
      tutorId: this.tutorId,
      date: this.confirmedDateIso,
      time: this.confirmedTime,
      duration: this.confirmDuration,
      isTrialLesson: this.isTrialLesson,
      timezone: this.selectedTimezone
    };

    if (this.paymentRequested.observed) {
      this.paymentRequested.emit(paymentData);
      return;
    }

    this.router.navigate(['/checkout'], { queryParams: paymentData });
  }
  
  /**
   * Get formatted timezone label
   */
  getTimezoneLabel(timezone: string): string {
    return getTimezoneLabel(timezone);
  }
  
  isViewerTimezoneSameAsTutor(): boolean {
    return this.selectedTimezone === this.timezone;
  }

  getTimezoneMessage(): string {
    const label = this.getTimezoneLabel(this.selectedTimezone);
    if (this.isViewerTimezoneSameAsTutor()) {
      return `Times shown in: ${label}`;
    }
    return `Times shown in: ${label} (Tutor is in ${this.getTimezoneLabel(this.timezone)})`;
  }
  
  /**
   * Ensure user is loaded before checking trial lesson status
   */
  private async ensureUserLoadedThenCheckTrial() {
    try {
      // Wait for user to be loaded
      await firstValueFrom(this.userService.getCurrentUser());
      console.log('✅ User loaded, checking trial lesson status...');
      
      // Now check trial lesson
      await this.checkTrialLesson();
    } catch (error) {
      console.error('❌ Error ensuring user loaded:', error);
    }
  }
  
  /**
   * Check if booking with this tutor would be a trial lesson
   */
  private async checkTrialLesson() {
    if (!this.tutorId) return;
    
    this.isCheckingTrial = true;
    try {
      const result = await firstValueFrom(
        this.lessonService.checkTrialLesson(this.tutorId)
      );
      
      this.isTrialLesson = result.isTrialLesson;
      
      // If it's a trial lesson, force 25min selection and disable 50min
      if (this.isTrialLesson && this.selectedDuration === 50) {
        this.selectedDuration = 25;
        this.onDurationChange(25);
      }
      
      console.log('🔍 Trial lesson check:', {
        tutorId: this.tutorId,
        isTrialLesson: this.isTrialLesson,
        previousLessons: result.previousLessons
      });
      
      // Trigger change detection
      this.cdr.detectChanges();
    } catch (error) {
      console.error('❌ Error checking trial lesson status:', error);
      // Default to not trial on error
      this.isTrialLesson = false;
    } finally {
      this.isCheckingTrial = false;
      this.cdr.detectChanges();
    }
  }

  /** Collect the next N bookable slots by scanning forward day-by-day (no week reloads). */
  async scanBookableSlots(previewLimit = 3, maxDays = 42): Promise<BookableSlotsScanResult> {
    if (this.tutorBlocked || this.availability.length === 0) {
      return { slots: [], hasMore: false };
    }

    const collected: BookableSlotPreview[] = [];
    let hasMore = false;
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    for (let offset = 0; offset < maxDays && !hasMore; offset++) {
      const date = new Date(start);
      date.setDate(start.getDate() + offset);

      const slots = this.computeAvailableTimeLabelsForDate(date);
      for (const slot of slots) {
        if (slot.booked || slot.isPast) continue;

        collected.push({
          date: new Date(date),
          dateIso: this.toDateIso(date),
          time: slot.time,
          timeLabel: slot.label,
          dateLabel: this.formatPreviewDate(date),
          pillLabel: `${this.formatPreviewDate(date)} · ${slot.label}`,
        });

        if (collected.length > previewLimit) {
          hasMore = true;
          break;
        }
      }
    }

    return {
      slots: collected.slice(0, previewLimit),
      hasMore,
    };
  }

  /** Move the 7-day window to the week that contains the first bookable slot. */
  async jumpToFirstAvailableWeek(maxDays = 90): Promise<boolean> {
    const result = await this.scanBookableSlots(1, maxDays);
    if (result.slots.length === 0) {
      return false;
    }
    await this.jumpToWeekContaining(result.slots[0].date);
    return true;
  }

  /** Align the 7-day window so it starts on the given date. */
  async jumpToWeekContaining(date: Date): Promise<void> {
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    this.currentWeekStart = target;
    this.recomputeWeekDates();
    this.updateWeekRangeDisplay();
    await this.loadBookedLessons().catch(() => {});
    this.buildAvailabilitySet();
    this.precomputeDateSlots();
    this.cdr.markForCheck();
  }

  /** Programmatically open the booking confirmation for a preview pill. */
  openBookableSlot(preview: BookableSlotPreview): void {
    if (this.tutorBlocked) return;
    this.onSelectSlot(
      preview.date,
      { label: preview.timeLabel, time: preview.time, booked: false, isPast: false },
      undefined
    );
  }

  private toDateIso(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatPreviewDate(date: Date): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (target.getTime() === today.getTime()) {
      return 'Today';
    }
    if (target.getTime() === tomorrow.getTime()) {
      return 'Tomorrow';
    }

    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  
}

