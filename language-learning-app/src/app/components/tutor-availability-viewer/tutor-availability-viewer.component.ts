import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, Output, EventEmitter } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, LoadingController } from '@ionic/angular';
import { UserService } from '../../services/user.service';
import { LessonService, Lesson } from '../../services/lesson.service';
import { ClassService } from '../../services/class.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { detectUserTimezone } from '../../shared/timezone.constants';
import { getTimezoneLabel } from '../../shared/timezone.utils';

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
  // Trigger refresh when this value changes
  @Input() refreshTrigger: number = 0;
  // Current user's auth0Id - if this matches tutor's auth0Id, disable slot selection
  @Input() currentUserAuth0Id?: string;
  // Tutor's auth0Id for comparison
  @Input() tutorAuth0Id?: string;
  // When true, allow tutors to select from their own availability (for scheduling classes)
  @Input() selectionMode = false;
  // Student's busy time slots - filter these out when showing availability
  @Input() studentBusySlots?: Set<string>;
  // When true, show duration selector (only on tutor profile page)
  @Input() showDurationSelector = false;
  // Selected duration for filtering available slots (25 or 50 minutes)
  @Input() selectedDuration: 25 | 50 = 25; // Default to 25 minutes
  // Emit event when slot is selected (instead of dismissing modal)
  @Output() slotSelected = new EventEmitter<{ selectedDate: string; selectedTime: string }>();
  
  private destroy$ = new Subject<void>();
  availability: AvailabilityBlock[] = [];
  timezone: string = 'America/New_York'; // Tutor's timezone
  viewerTimezone: string = ''; // Viewer's timezone (detected from browser)
  currentWeekStart: Date = new Date();
  isLoading = false;
  
  daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
  
  constructor(
    private userService: UserService,
    private lessonService: LessonService,
    private classService: ClassService,
    private modalController: ModalController,
    private loadingController: LoadingController,
    private router: Router
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

  async ngOnInit() {
    // Detect viewer's timezone
    this.viewerTimezone = detectUserTimezone();
    console.log('🌍 Viewer timezone detected:', this.viewerTimezone);
    
    // Initialize week dates but DON'T precompute slots yet (bookedSlots not loaded)
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(this.currentWeekStart);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    this.weekDates = dates;
    
    // Load data first, THEN compute slots
    await Promise.all([
      this.loadAvailability(),
      this.loadBookedLessons()
    ]);
    
    // Now that both availability and bookedSlots are loaded, compute slots
    console.log('✅ Data loaded, now computing slots with bookedSlots:', Array.from(this.bookedSlots));
    this.precomputeDateSlots();
  }

  ngOnChanges(changes: SimpleChanges) {
    // Reload availability if refreshTrigger changes
    if (changes['refreshTrigger']) {
      console.log('🔄 Refresh trigger change detected:', {
        firstChange: changes['refreshTrigger'].firstChange,
        previousValue: changes['refreshTrigger'].previousValue,
        currentValue: changes['refreshTrigger'].currentValue
      });
      
      if (!changes['refreshTrigger'].firstChange) {
        console.log('🔄 Reloading availability and booked lessons...');
        // Clear ALL caches before reloading
        this.slotsCache.clear();
        this.availabilitySet.clear();
        this.bookedSlots.clear();
        
        // Force async to ensure UI updates
        setTimeout(() => {
          Promise.all([
            this.loadAvailability(),
            this.loadBookedLessons()
          ]).then(() => {
            console.log('🔄 Refresh complete, recomputing slots with', this.bookedSlots.size, 'booked slots');
            this.precomputeDateSlots();
          });
        }, 100);
      }
    }
    
    // Recompute slots if studentBusySlots changes
    if (changes['studentBusySlots']) {
      console.log('🔄 Student busy slots changed, recomputing date slots...');
      this.precomputeDateSlots();
    }
    
    // Recompute slots if selectedDuration changes
    if (changes['selectedDuration'] && !changes['selectedDuration'].firstChange) {
      console.log('🔄 Duration changed to:', changes['selectedDuration'].currentValue, 'minutes - recalculating available slots');
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
    console.log('Selected time slot:', dayIndex, timeSlot);
    // You can add booking logic here
  }

  formatTimeSlot(timeSlot: string): string {
    // Format time slot for display (e.g., "12:30 PM")
    const hour = parseInt(timeSlot);
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
    const startTime = performance.now();
    console.log(`⏱️ [Availability] Starting to load for tutor: ${this.tutorId}`);
    console.log(`⏱️ [Availability] Current cache size: ${this.slotsCache.size}`);
    
    this.isLoading = true;
    
    // Only show loading spinner for standalone modal, not inline view
    let loading: HTMLIonLoadingElement | null = null;
    if (!this.inline) {
      loading = await this.loadingController.create({
        message: 'Loading availability...',
        duration: 5000
      });
      await loading.present();
    }

    return new Promise((resolve, reject) => {
      this.userService.getTutorAvailability(this.tutorId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (response) => {
            const duration = performance.now() - startTime;
            console.log(`⏱️ [Availability] Data received in ${duration.toFixed(2)}ms`);
            console.log(`⏱️ [Availability] Total blocks received: ${response.availability?.length || 0}`);
            this.availability = response.availability || [];
            this.timezone = response.timezone || 'America/New_York';
            
            // Clear slot caches but NOT bookedSlots (that's managed separately)
            this.slotsCache.clear();
            this.availabilitySet.clear();
            
            console.log(`⏱️ [Availability] Caches cleared, rebuilding availability set...`);
            this.buildAvailabilitySet();
            console.log(`⏱️ [Availability] Availability set built with ${this.availabilitySet.size} slots`);
            // DON'T call precomputeDateSlots here - let ngOnInit handle it after BOTH availability and bookedLessons are ready
            this.isLoading = false;
            if (loading) loading.dismiss();
            resolve();
          },
          error: (error) => {
            const duration = performance.now() - startTime;
            console.log(`⏱️ [Availability] Error after ${duration.toFixed(2)}ms`);
            console.error('Error loading availability:', error);
            this.isLoading = false;
            if (loading) loading.dismiss();
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
    const startTime = performance.now();
    console.log(`⏱️ [Booked Lessons] Starting to load for tutor: ${this.tutorId}`);
    console.log(`🔑 [Booked Lessons] Tutor ID type: ${typeof this.tutorId}, value: "${this.tutorId}"`);
    
    try {
      // Load both lessons and classes for the tutor
      const [lessonsResponse, classesResponse] = await Promise.all([
        firstValueFrom(this.lessonService.getLessonsByTutor(this.tutorId)),
        firstValueFrom(this.classService.getClassesForTutor(this.tutorId))
      ]);
      
      const duration = performance.now() - startTime;
      console.log(`⏱️ [Booked Lessons] Data received in ${duration.toFixed(2)}ms - ${lessonsResponse.lessons?.length || 0} lessons, ${classesResponse.classes?.length || 0} classes`);
      console.log(`📊 [Booked Lessons] Lessons response:`, lessonsResponse);
      console.log(`📊 [Booked Lessons] Classes response:`, classesResponse);
      
      // Combine lessons and classes into a single array
      const allBookedSlots: any[] = [];
      
      if (lessonsResponse.success && lessonsResponse.lessons) {
        console.log('📚 Lessons loaded:', lessonsResponse.lessons.map((l: any) => ({
          startTime: l.startTime,
          endTime: l.endTime,
          status: l.status,
          subject: l.subject
        })));
        allBookedSlots.push(...lessonsResponse.lessons);
      }
      
      // Convert classes to lesson-like format for processing
      if (classesResponse.success && classesResponse.classes) {
        console.log(`🎓 Classes loaded: ${classesResponse.classes.length} total`);
        classesResponse.classes.forEach((c: any, index: number) => {
          console.log(`  Class ${index + 1}: ${c.name}`);
          console.log(`    Start: ${c.startTime}`);
          console.log(`    End: ${c.endTime}`);
          console.log(`    Start Date: ${new Date(c.startTime).toLocaleString()}`);
          console.log(`    End Date: ${new Date(c.endTime).toLocaleString()}`);
        });
        const classesAsLessons = classesResponse.classes.map((cls: any) => ({
          startTime: cls.startTime,
          endTime: cls.endTime,
          status: 'scheduled', // Classes are scheduled events
          _id: cls._id,
          subject: cls.name
        }));
        console.log(`🎓 Converted ${classesAsLessons.length} classes to lesson format`);
        allBookedSlots.push(...classesAsLessons);
      } else {
        console.log(`⚠️ No classes returned or response not successful:`, classesResponse);
      }
      
      console.log(`📊 Total booked slots to process: ${allBookedSlots.length}`);
      
      if (allBookedSlots.length > 0) {
        this.buildBookedSlotsSet(allBookedSlots);
        console.log(`✅ Booked slots Set now contains ${this.bookedSlots.size} entries:`, Array.from(this.bookedSlots));
      } else {
        console.warn('⚠️ No booked lessons or classes found - all slots will show as available');
        this.bookedSlots = new Set();
      }
    } catch (error) {
      const duration = performance.now() - startTime;
      console.log(`⏱️ [Booked Lessons] Error after ${duration.toFixed(2)}ms`);
      console.error('Error loading booked lessons:', error);
      // Don't fail silently - set empty set if error
      this.bookedSlots = new Set();
    }
  }

  private buildBookedSlotsSet(lessons: Lesson[]) {
    const set = new Set<string>();
    
    // Get the current week's date range
    const weekStart = new Date(this.currentWeekStart);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    console.log(`📅 Building booked slots for week: ${weekStart.toISOString()} to ${weekEnd.toISOString()}`);
    console.log(`📅 Current week dates:`, this.weekDates.map(d => d.toDateString()));
    
    // Create a map of dates to their index in weekDates array (0-6)
    const dateToIndexMap = new Map<string, number>();
    for (let i = 0; i < this.weekDates.length; i++) {
      const dateKey = this.dateKey(this.weekDates[i]);
      dateToIndexMap.set(dateKey, i);
    }
    
    let processedCount = 0;
    let skippedCount = 0;
    
    for (const lesson of lessons) {
      // Only consider scheduled or in_progress lessons
      if (lesson.status !== 'scheduled' && lesson.status !== 'in_progress') {
        console.log(`⏭️ Skipping lesson with status: ${lesson.status}`);
        skippedCount++;
        continue;
      }

      const startTime = new Date(lesson.startTime);
      const endTime = new Date(lesson.endTime);
      
      // Calculate buffer time based on lesson duration
      const lessonDurationMinutes = lesson.duration || 60;
      const bufferMinutes = lessonDurationMinutes === 25 ? 5 : lessonDurationMinutes === 50 ? 10 : 10;
      
      // Extend end time to include buffer
      const endTimeWithBuffer = new Date(endTime);
      endTimeWithBuffer.setMinutes(endTimeWithBuffer.getMinutes() + bufferMinutes);
      
      console.log(`🔍 Processing lesson: ${startTime.toISOString()} to ${endTime.toISOString()} (${lessonDurationMinutes}min + ${bufferMinutes}min buffer = ${endTimeWithBuffer.toISOString()})`);
      
      // Only include lessons that fall within the current week being displayed
      if (endTimeWithBuffer < weekStart || startTime > weekEnd) {
        console.log(`⏭️ Lesson outside current week range, skipping`);
        skippedCount++;
        continue;
      }
      
      // Get the actual date of the lesson (normalized to midnight)
      const lessonDate = new Date(startTime);
      lessonDate.setHours(0, 0, 0, 0);
      const lessonDateKey = this.dateKey(lessonDate);
      
      console.log(`📅 Lesson date key: ${lessonDateKey}`);
      
      // Find which column (0-6) this date corresponds to in the displayed week
      const weekIndex = dateToIndexMap.get(lessonDateKey);
      if (weekIndex === undefined) {
        console.log(`⚠️ Lesson date not in current week: ${lessonDateKey}`);
        skippedCount++;
        continue;
      }
      
      // Get the day index (0=Sun, 1=Mon, ..., 6=Sat) for the actual date
      // This matches how availability is stored (by day of week, not specific date)
      const dayIndex = lessonDate.getDay();
      
      console.log(`✅ Marking slots for day index ${dayIndex} (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayIndex]}) including buffer`);
      
      // Generate 30-minute slots between start and end+buffer
      // Round down to nearest 30-minute slot for starting point
      let currentTime = new Date(startTime);
      currentTime.setMinutes(Math.floor(currentTime.getMinutes() / 30) * 30, 0, 0);
      
      const slotsMarked: string[] = [];
      while (currentTime < endTimeWithBuffer) {
        const hours = currentTime.getHours().toString().padStart(2, '0');
        const minutes = currentTime.getMinutes().toString().padStart(2, '0');
        const timeSlot = `${hours}:${minutes}`;
        const key = `${dayIndex}-${timeSlot}`;
        set.add(key);
        slotsMarked.push(key);
        
        // Move to next 30-minute slot
        currentTime.setMinutes(currentTime.getMinutes() + 30);
      }
      
      console.log(`  ✓ Marked ${slotsMarked.length} slots (with buffer): ${slotsMarked.join(', ')}`);
      processedCount++;
    }
    
    console.log(`📊 Booked slots summary: ${processedCount} processed, ${skippedCount} skipped, ${set.size} total slots marked`);
    console.log(`📊 All booked slot keys:`, Array.from(set));
    
    this.bookedSlots = set;
    this.slotsCache.clear();
    console.log('✅ Booked slots set updated, size:', this.bookedSlots.size);
    // DON'T recompute slots here - let the caller handle it to avoid race conditions
    // This allows ngOnInit to wait for BOTH availability and bookedLessons before computing
  }

  private buildAvailabilitySet() {
    const set = new Set<string>();
    
    // Build a map for quick date lookups: dateKey -> weekIndex
    const dateIndexMap = new Map<string, number>();
    for (let i = 0; i < this.weekDates.length; i++) {
      const dateKey = this.dateKey(this.weekDates[i]);
      dateIndexMap.set(dateKey, i);
    }
    
    for (const block of this.availability) {
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
    console.log('✅ Availability set built, size:', this.availabilitySet.size);
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
    // Pre-compute slots for all dates to avoid function calls in template
    this.precomputeDateSlots();
  }

  // Pre-compute slots for all dates in the current week
  private precomputeDateSlots() {
    console.log('📅 precomputeDateSlots called with bookedSlots:', Array.from(this.bookedSlots));
    this.dateSlotsMap.clear();
    for (const date of this.weekDates) {
      const dateKey = this.dateKey(date);
      const slots = this.computeAvailableTimeLabelsForDate(date);
      console.log(`  Date ${dateKey} (day ${date.getDay()}): ${slots.length} total slots, ${slots.filter(s => s.booked).length} booked`);
      this.dateSlotsMap.set(dateKey, slots);
    }
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
    // Rebuild availability set for the new week to apply date filtering
    this.buildAvailabilitySet();
    // Reload booked lessons for the new week
    await this.loadBookedLessons();
    // Now recompute slots with both availability and bookedSlots ready
    console.log('✅ Week navigated, recomputing slots with', this.bookedSlots.size, 'booked slots');
    this.precomputeDateSlots();
  }

  async goToToday() {
    this.setCurrentWeekStart();
    this.recomputeWeekDates();
    // Rebuild availability set for the new week to apply date filtering
    this.buildAvailabilitySet();
    // Reload booked lessons for the current week
    await this.loadBookedLessons();
    // Now recompute slots with both availability and bookedSlots ready
    console.log('✅ Returned to today, recomputing slots with', this.bookedSlots.size, 'booked slots');
    this.precomputeDateSlots();
  }

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
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

  private dateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  // Check if a time slot is in the past
  private isSlotInPast(date: Date, timeSlot: string): boolean {
    const [hours, minutes] = timeSlot.split(':').map(Number);
    const slotDateTime = new Date(date);
    slotDateTime.setHours(hours, minutes, 0, 0);
    
    const now = new Date();
    return slotDateTime < now;
  }

  // Internal method to compute slots (called by precomputeDateSlots)
  private computeAvailableTimeLabelsForDate(date: Date): { label: string; time: string; booked: boolean; isPast: boolean }[] {
    // Only show availability within the displayed 7-day window
    const dateToCheck = new Date(date);
    dateToCheck.setHours(0, 0, 0, 0);
    
    const windowStart = new Date(this.currentWeekStart);
    windowStart.setHours(0, 0, 0, 0);
    
    const windowEnd = new Date(this.currentWeekStart);
    windowEnd.setDate(windowEnd.getDate() + 6);
    windowEnd.setHours(23, 59, 59, 999);
    
    if (dateToCheck < windowStart || dateToCheck > windowEnd) {
      return [];
    }
    
    // Don't cache when studentBusySlots is provided (for mutual availability)
    const shouldCache = !this.studentBusySlots || this.studentBusySlots.size === 0;
    
    // Include duration in cache key so different durations have different caches
    const cacheKey = this.dateKey(date) + '_' + Math.floor(Date.now() / 60000) + '_' + this.selectedDuration;
    const cached = shouldCache ? this.slotsCache.get(cacheKey) : undefined;
    if (cached) {
      return cached;
    }
    
    // Clear old cache entries (keep last 10)
    if (this.slotsCache.size > 10) {
      const firstKey = this.slotsCache.keys().next().value;
      if (firstKey) {
        this.slotsCache.delete(firstKey);
      }
    }
    
    // Use native getDay() to match how availability is stored (0=Sun, 1=Mon, ..., 6=Sat)
    const dayIndex = date.getDay();
    
    // Filter blocks that apply to this specific date
    const applicableBlocks = this.availability.filter(block => {
      if (block.type !== 'available') return false;
      if (block.day !== dayIndex) return false;
      
      // If block has absolute dates, check if this date is within the range
      if (block.absoluteStart && block.absoluteEnd) {
        const blockStart = new Date(block.absoluteStart);
        const blockEnd = new Date(block.absoluteEnd);
        blockStart.setHours(0, 0, 0, 0);
        blockEnd.setHours(0, 0, 0, 0);
        
        const checkDateNormalized = new Date(dateToCheck);
        checkDateNormalized.setHours(0, 0, 0, 0);
        
        return checkDateNormalized.getTime() >= blockStart.getTime() && 
               checkDateNormalized.getTime() <= blockEnd.getTime();
      }
      
      // If no absoluteStart, try to parse date from the id field (format: "YYYY-MM-DD-...")
      if (block.id && typeof block.id === 'string') {
        const idParts = block.id.split('-');
        if (idParts.length >= 3) {
          // Extract YYYY-MM-DD from id  
          // Parse as local date to avoid timezone shifts
          const year = parseInt(idParts[0]);
          const month = parseInt(idParts[1]) - 1; // Month is 0-indexed
          const day = parseInt(idParts[2]);
          const blockDate = new Date(year, month, day, 0, 0, 0, 0);
          
          const checkDateNormalized = new Date(dateToCheck);
          checkDateNormalized.setHours(0, 0, 0, 0);
          
          
          // Only show if dates match exactly
          return blockDate.getTime() === checkDateNormalized.getTime();
        }
      }
      
      // If no date info at all, it's a recurring pattern - always applies
      return true;
    });
    
    const slots: { label: string; time: string; booked: boolean; isPast: boolean }[] = [];
    const dateKeyStr = this.dateKey(dateToCheck);
    
    for (let i = 0; i < this.timeSlots.length; i++) {
      const key = `${dayIndex}-${this.timeSlots[i]}`;
      
      // Check if this time slot falls within any applicable block
      const timeInMinutes = this.timeToMinutes(this.timeSlots[i]);
      const hasAvailability = applicableBlocks.some(block => {
        const blockStart = this.timeToMinutes(block.startTime);
        const blockEnd = this.timeToMinutes(block.endTime);
        return timeInMinutes >= blockStart && timeInMinutes < blockEnd;
      });
      
      if (hasAvailability) {
        const isBooked = this.bookedSlots.has(key);
        const isPast = this.isSlotInPast(date, this.timeSlots[i]);
        
        // Debug log for Wednesday 12:00 PM
        if (dayIndex === 3 && this.timeSlots[i] === '12:00') {
          console.log(`🔍 Checking Wed 12:00 PM:`, {
            key,
            dateKeyStr,
            dayIndex,
            timeSlot: this.timeSlots[i],
            isBooked,
            bookedSlotsHasKey: this.bookedSlots.has(key),
            bookedSlotsSize: this.bookedSlots.size,
            allBookedKeys: Array.from(this.bookedSlots)
          });
        }
        
        // Check if student is busy at this time (if studentBusySlots provided)
        const isStudentBusy = this.isStudentBusyAtSlot(dayIndex, this.timeSlots[i], dateKeyStr);
        
        // Check if there's enough consecutive time for selected duration
        // Apply this filter when: 1) duration selector is shown OR 2) in selection mode (scheduling a class)
        const shouldFilterByDuration = this.showDurationSelector || this.selectionMode;
        const hasEnoughTime = shouldFilterByDuration && !isBooked && !isPast 
          ? this.hasEnoughConsecutiveTime(date, this.timeSlots[i], dayIndex) 
          : true; // If not filtering by duration, don't apply this filter
        
        // Only show slot if:
        // 1. Student is NOT busy (or no busy slots provided)
        // 2. There's enough consecutive time for the selected duration
        if (!isStudentBusy && hasEnoughTime) {
          slots.push({ label: this.timeLabels[i], time: this.timeSlots[i], booked: isBooked, isPast: isPast });
        }
      }
    }
    
    // Cache with timestamp key (auto-invalidates after 1 minute)
    if (shouldCache) {
      this.slotsCache.set(cacheKey, slots);
    }
    return slots;
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
    
    if (isBusy) {
      console.log('🔴 Filtering out busy slot:', {
        dateKey,
        dayIndex,
        timeSlot,
        dayBasedKey,
        dateSpecificKey,
        matchedDayBased: this.studentBusySlots.has(dayBasedKey),
        matchedDateSpecific: this.studentBusySlots.has(dateSpecificKey)
      });
    }
    
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
    console.log('Duration changed to:', duration, 'minutes - recalculating available slots');
    
    // Clear cache to force recalculation with new duration
    this.slotsCache.clear();
    
    // Recompute slots for current week with new duration
    this.precomputeDateSlots();
  }

  /**
   * Check if a time slot has enough consecutive available time for the selected duration + buffer
   * @param date The date of the slot
   * @param timeSlot The time slot (HH:mm format)
   * @param dayIndex The day index (0-6)
   * @returns true if there's enough time, false otherwise
   */
  private hasEnoughConsecutiveTime(date: Date, timeSlot: string, dayIndex: number): boolean {
    // Calculate total time needed (lesson + buffer)
    const bufferMinutes = this.selectedDuration === 25 ? 5 : 10;
    const totalMinutesNeeded = this.selectedDuration + bufferMinutes; // 30 or 60
    
    // Parse the starting time
    const [hours, minutes] = timeSlot.split(':').map(Number);
    let checkTime = new Date(date);
    checkTime.setHours(hours, minutes, 0, 0);
    
    const endTime = new Date(checkTime);
    endTime.setMinutes(endTime.getMinutes() + totalMinutesNeeded);
    
    // Check every 30-minute slot from start to end (exclusive of end)
    let currentCheck = new Date(checkTime);
    
    while (currentCheck < endTime) {
      const checkHours = currentCheck.getHours().toString().padStart(2, '0');
      const checkMinutes = currentCheck.getMinutes().toString().padStart(2, '0');
      const checkSlot = `${checkHours}:${checkMinutes}`;
      const checkKey = `${dayIndex}-${checkSlot}`;
      
      // If any slot in the range is booked, return false
      if (this.bookedSlots.has(checkKey)) {
        return false;
      }
      
      // Move to next 30-minute slot
      currentCheck.setMinutes(currentCheck.getMinutes() + 30);
    }
    
    return true;
  }

  onSelectSlot(date: Date, slot: { label: string; time: string; booked?: boolean; isPast?: boolean }) {
    // Don't allow booking if slot is already booked or in the past
    if (slot.booked || slot.isPast) {
      return;
    }
    
    // If in selection mode, emit event AND dismiss modal with data
    if (this.selectionMode) {
      console.log('selectionMode', this.selectionMode);
      console.log('slot', slot, 'booked', slot.booked, 'isPast', slot.isPast);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;
      
      // Emit event for parent component to handle (for inline usage)
      this.slotSelected.emit({
        selectedDate: dateString,
        selectedTime: slot.time
      });
      
      // If used as a modal, also dismiss with data
      if (!this.inline) {
        this.modalController.dismiss({
          selectedDate: dateString,
          selectedTime: slot.time,
          lessonMinutes: this.selectedDuration
        });
      }
      return;
    }
    
    // Don't allow tutors to book their own slots (except in selection mode)
    if (this.isCurrentUserTutor()) {
      console.log('Tutors cannot book their own availability slots');
      return;
    }
    
    // Navigate to checkout with tutor/time and selected duration
    const dateIso = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
    this.router.navigate(['/checkout'], {
      queryParams: {
        tutorId: this.tutorId,
        date: dateIso,
        time: slot.time,
        duration: this.selectedDuration
      }
    });
  }
  
  /**
   * Get formatted timezone label
   */
  getTimezoneLabel(timezone: string): string {
    return getTimezoneLabel(timezone);
  }
  
  /**
   * Check if viewer's timezone matches tutor's timezone
   */
  isViewerTimezoneSameAsTutor(): boolean {
    return this.viewerTimezone === this.timezone;
  }
  
  /**
   * Get timezone display message
   */
  getTimezoneMessage(): string {
    if (this.isViewerTimezoneSameAsTutor()) {
      return `Times shown in your timezone: ${this.getTimezoneLabel(this.viewerTimezone)}`;
    }
    return `Times shown in your timezone: ${this.getTimezoneLabel(this.viewerTimezone)}`;
  }
  
}

