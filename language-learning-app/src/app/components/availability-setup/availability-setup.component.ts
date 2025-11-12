import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit, Input } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController, AlertController, NavController } from '@ionic/angular';
import { Router, NavigationExtras } from '@angular/router';
import { UserService } from '../../services/user.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

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
  imports: [CommonModule, FormsModule, IonicModule]
})
export class AvailabilitySetupComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('timeSlotsContainer', { static: false }) timeSlotsContainer?: ElementRef;

  @Input() targetDate: string | null = null; // Date parameter from route (YYYY-MM-DD format)
  
  private destroy$ = new Subject<void>();
  
  // Single day mode flag
  isSingleDayMode = false;

  // UI State
  activeTab = 'availability';
  showPopularSlots = false;
  selectedSlotsCount = 0;
  currentWeek: Date = new Date(); // First day currently shown in grid
  hasUnsavedChanges = false;
  initialSelectedSlotsCount = 0; // Track initial count when page loads

  // Now indicator state
  showNowIndicator = false;
  nowIndicatorTop = 0;
  nowIndicatorLeft = 0;
  nowIndicatorWidth = 0;
  private nowIntervalId: any;
  private boundResizeHandler = () => {
    const previousMobile = this.isMobileView;
    this.updateResponsiveState();
    if (this.isMobileView !== previousMobile) {
      this.refreshDisplayedWeekDays(new Date());
    } else {
      this.refreshDisplayedWeekDays();
    }
    this.updateNowIndicator();
  };
  private hasScrolledToNow = false;

  // Selection state
  isSelecting = false;
  selectionStart: SelectedSlot | null = null;
  selectedSlots = new Set<string>();

  // Data
  weekDays: WeekDay[] = [];
  displayedWeekDays: WeekDay[] = [];
  private isMobileView = false;
  private readonly mobileDaysToShow = 4;
  private mobileStartIndex = 0;
  showMobileSettings = false;
  panelAnimating = false;

  timeSlots: TimeSlot[] = [];

  // Popular time slots (9:00 AM - 9:00 PM) in 30-min indices
  // 9:00 -> index 18, 9:30 -> 19, ..., 20:30 -> 41. We'll highlight indices in [18, 41].
  popularStartIndex = 18;
  popularEndIndex = 41;
  // Night time starts at 6:00 PM local (index 36)
  nightStartIndex = 36;

  constructor(
    private router: Router,
    private navController: NavController,
    private location: Location,
    private userService: UserService,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private alertController: AlertController
  ) {
    this.initializeTimeSlots();
    this.initializeCurrentWeek();
    this.updateResponsiveState();
    this.updateWeekDays(new Date());
  }

  ngOnInit() {
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
    this.loadExistingAvailability();
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
    const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' });
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
    // Initial compute after view renders
    this.hasScrolledToNow = false;
    // Use longer delay for single day mode to ensure DOM is ready
    const delay = this.isSingleDayMode ? 500 : 100;
    setTimeout(() => {
      this.updateNowIndicator();
      // Wait a bit more for DOM to be fully ready, then scroll
      setTimeout(() => {
        if (!this.hasScrolledToNow) {
          this.scrollNowIndicatorIntoView(true);
        }
      }, 300);
    }, delay);
    // Update every minute
    this.nowIntervalId = setInterval(() => this.updateNowIndicator(), 60_000);
    // Recompute on resize
    window.addEventListener('resize', this.boundResizeHandler);
  }

  private initializeCurrentWeek() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    this.currentWeek = new Date(today);
    this.currentWeek.setDate(today.getDate() + mondayOffset);
    this.currentWeek.setHours(0, 0, 0, 0);
  }

  private updateWeekDays(focusDate?: Date) {
    const start = new Date(this.currentWeek);
    
    this.weekDays = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
      const shortName = date.toLocaleDateString('en-US', { weekday: 'short' });
      const dayOfMonth = date.getDate();
      const monthName = date.toLocaleDateString('en-US', { month: 'short' });
      
      this.weekDays.push({
        name: dayName,
        shortName,
        index: i,
        date,
        displayDate: dayOfMonth.toString(),
        displayMonth: monthName
      });
    }

    this.refreshDisplayedWeekDays(focusDate);
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
    
    const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
    const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });
    const startDay = startDate.getDate();
    const endDay = endDate.getDate();
    const year = startDate.getFullYear();
    
    if (startMonth === endMonth) {
      return `${startMonth} ${startDay} - ${endDay}, ${year}`;
    } else {
      return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`;
    }
  }

  navigateWeek(direction: 'prev' | 'next') {
    // Don't allow navigation in single day mode
    if (this.isSingleDayMode) return;
    
    const step = this.isMobileView ? this.mobileDaysToShow : 7;
    const days = direction === 'prev' ? -step : step;
    this.currentWeek = new Date(this.currentWeek);
    this.currentWeek.setDate(this.currentWeek.getDate() + days);
    if (this.isMobileView) {
      this.mobileStartIndex = 0;
    }
    this.updateWeekDays();
    // Recompute indicator after DOM updates
    this.hasScrolledToNow = false;
    setTimeout(() => {
      this.updateNowIndicator();
      setTimeout(() => {
        if (!this.hasScrolledToNow) {
          this.scrollNowIndicatorIntoView(true);
        }
      }, 200);
    });
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
    this.hasScrolledToNow = false;
  }

  goToToday() {
    this.initializeCurrentWeek();
    this.mobileStartIndex = 0;
    this.updateWeekDays(new Date());
    this.hasScrolledToNow = false;
    setTimeout(() => {
      this.updateNowIndicator();
      setTimeout(() => {
        if (!this.hasScrolledToNow) {
          this.scrollNowIndicatorIntoView(true);
        }
      }, 200);
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.nowIntervalId) clearInterval(this.nowIntervalId);
    window.removeEventListener('resize', this.boundResizeHandler);
  }

  private initializeTimeSlots() {
    this.timeSlots = [];
    let idx = 0;
    for (let hour = 0; hour < 24; hour++) {
      for (let min of [0, 30]) {
        this.timeSlots.push({
          index: idx++,
          display: this.formatTime12Hour(hour, min)
        });
      }
    }
  }

  private formatTime12Hour(hour: number, minute: number): string {
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const displayMinute = minute === 0 ? '00' : '30';
    return `${displayHour}:${displayMinute} ${period}`;
  }

  private loadExistingAvailability() {
    console.log('🔧 Loading existing availability...', { isSingleDayMode: this.isSingleDayMode });
    this.userService.getAvailability().subscribe({
      next: (res) => {
        console.log('🔧 Loaded existing availability:', res);
        // Convert existing availability to selected slots
        if (res.availability && res.availability.length > 0) {
          console.log('🔧 All availability blocks:', res.availability);
          res.availability.forEach(block => {
            console.log(`🔧 Processing existing block: day=${block.day}, time=${block.startTime}-${block.endTime}`);
            const [sh, sm] = block.startTime.split(':').map((v: string) => parseInt(v, 10));
            const [eh, em] = block.endTime.split(':').map((v: string) => parseInt(v, 10));

            const startIndex = sh * 2 + (sm >= 30 ? 1 : 0);
            const endIndex = eh * 2 + (em >= 30 ? 1 : 0);

            // Handle both numeric day indices and day name strings
            let dayIndex: number;
            if (typeof block.day === 'number') {
              dayIndex = block.day;
            } else {
              dayIndex = this.dayNameToIndex(block.day);
            }
            console.log(`🔧 Day mapping: ${block.day} (${typeof block.day}) -> ${dayIndex}`);
            
            // In single day mode, only load slots for the selected day
            if (this.isSingleDayMode) {
              const selectedDayIndex = this.displayedWeekDays[0]?.index;
              console.log(`🔧 Single day mode check:`, {
                selectedDayIndex,
                blockDayIndex: dayIndex,
                blockDay: block.day,
                match: dayIndex === selectedDayIndex
              });
              if (dayIndex !== selectedDayIndex) {
                console.log(`🔧 Skipping block for day ${block.day} (index ${dayIndex}) - not the selected day (index ${selectedDayIndex})`);
                return;
              }
              console.log(`🔧 ✅ Block matches selected day, processing...`);
            }

            console.log(`🔧 Adding slots from index ${startIndex} to ${endIndex} for day ${dayIndex}`);
            for (let idx = startIndex; idx < endIndex; idx++) {
              const slotKey = `${dayIndex}-${idx}`;
              console.log(`🔧 Adding slot: ${slotKey}`);
              this.selectedSlots.add(slotKey);
            }
          });
          this.updateSelectedCount();
          // Store the initial count after loading existing availability
          this.initialSelectedSlotsCount = this.selectedSlotsCount;
          console.log('🔧 Final selected slots after loading:', Array.from(this.selectedSlots));
        } else {
          // No existing availability, so initial count is 0
          this.initialSelectedSlotsCount = 0;
        }
        // Loaded selections reflect saved state; reset dirty flag
        this.hasUnsavedChanges = false;
      },
      error: (error) => {
        console.error('Error loading existing availability:', error);
      }
    });
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
    const newIsMobile = window.innerWidth <= 768;
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
      this.mobileStartIndex = startIndex;
      const totalDays = this.weekDays.length;
      const days: WeekDay[] = [];
      for (let i = 0; i < this.mobileDaysToShow; i++) {
        const idx = (startIndex + i) % totalDays;
        days.push(this.weekDays[idx]);
      }
      this.displayedWeekDays = days;
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

  // Navigate to single-day availability setup for a specific date
  selectDate(day: WeekDay) {
    if (!day || !day.date) return;
    
    // Format date as YYYY-MM-DD
    const dateStr = day.date.toISOString().split('T')[0];
    
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
    this.isSelecting = true;
    this.selectionStart = { day: dayIndex, index: slotIndex };
    this.toggleSlot(dayIndex, slotIndex);
    this.hasUnsavedChanges = true;
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

    for (let day = startDay; day <= endDay; day++) {
      for (let idx = startIdx; idx <= endIdx; idx++) {
        if (this.isPastSlot(day, idx)) continue;
        this.selectedSlots.add(`${day}-${idx}`);
      }
    }

    this.updateSelectedCount();
    this.hasUnsavedChanges = true;
  }

  endSelection() {
    this.isSelecting = false;
    this.selectionStart = null;
  }

  private toggleSlot(dayIndex: number, slotIndex: number) {
    if (this.isPastSlot(dayIndex, slotIndex)) return;
    const slotKey = `${dayIndex}-${slotIndex}`;
    if (this.selectedSlots.has(slotKey)) {
      this.selectedSlots.delete(slotKey);
    } else {
      this.selectedSlots.add(slotKey);
    }
    this.updateSelectedCount();
    this.hasUnsavedChanges = true;
  }

  private clearSelectionRange() {
    if (!this.selectionStart) return;
    
    const startDay = Math.min(this.selectionStart.day, this.selectionStart.day);
    const endDay = Math.max(this.selectionStart.day, this.selectionStart.day);
    const startHour = Math.min(this.selectionStart.index, this.selectionStart.index);
    const endHour = Math.max(this.selectionStart.index, this.selectionStart.index);

    for (let day = startDay; day <= endDay; day++) {
      for (let hour = startHour; hour <= endHour; hour++) {
        this.selectedSlots.delete(`${day}-${hour}`);
      }
    }
  }

  isSlotSelected(dayIndex: number, slotIndex: number): boolean {
    return this.selectedSlots.has(`${dayIndex}-${slotIndex}`);
  }

  isPopularSlot(dayIndex: number, slotIndex: number): boolean {
    if (!this.showPopularSlots) return false;
    // Do not mark popular during night hours
    if (slotIndex >= this.nightStartIndex) return false;
    return slotIndex >= this.popularStartIndex && slotIndex <= this.popularEndIndex;
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

  private updateNowIndicator() {
    const container = this.timeSlotsContainer?.nativeElement as HTMLElement | undefined;
    if (!container) {
      console.log('🔴 No container found for now indicator');
      this.showNowIndicator = false;
      return;
    }

    // Only show if viewing the week that includes today
    if (!this.isCurrentWeekInView()) {
      console.log('🔴 Current week/day not in view');
      this.showNowIndicator = false;
      return;
    }
    
    console.log('🔴 Updating now indicator...');

    // Top position based on minutes since midnight across full 24h height
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const totalMinutes = 24 * 60;
    const containerRect = container.getBoundingClientRect();
    const height = container.clientHeight;
    this.nowIndicatorTop = Math.max(0, Math.min(height - 1, Math.round((minutes / totalMinutes) * height)));

    // Left and width: measure the first time-label width to start the line after labels
    const firstLabel = container.querySelector('.time-slot-row .time-label') as HTMLElement | null;
    const containerWidth = container.clientWidth;
    const labelWidth = firstLabel ? firstLabel.offsetWidth : 80; // fallback
    
    // In single day mode, the line should span only the single day column
    if (this.isSingleDayMode) {
      const dayColumn = container.querySelector('.day-column') as HTMLElement | null;
      if (dayColumn) {
        const dayColumnRect = dayColumn.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        this.nowIndicatorLeft = dayColumnRect.left - containerRect.left;
        this.nowIndicatorWidth = dayColumn.offsetWidth;
        console.log('🔴 Single day mode positioning:', {
          left: this.nowIndicatorLeft,
          width: this.nowIndicatorWidth,
          top: this.nowIndicatorTop
        });
      } else {
        console.log('🔴 Day column not found, using fallback');
        // Fallback: span from label to end
        this.nowIndicatorLeft = labelWidth;
        this.nowIndicatorWidth = Math.max(0, containerWidth - labelWidth);
      }
    } else {
      // Regular mode: span all day columns
      this.nowIndicatorLeft = labelWidth;
      this.nowIndicatorWidth = Math.max(0, containerWidth - labelWidth);
    }

    this.showNowIndicator = true;
    console.log('🔴 Now indicator set:', {
      show: this.showNowIndicator,
      top: this.nowIndicatorTop,
      left: this.nowIndicatorLeft,
      width: this.nowIndicatorWidth
    });

    if (!this.hasScrolledToNow) {
      this.scrollNowIndicatorIntoView(true);
    }
  }

  private scrollNowIndicatorIntoView(force = false, attempt = 0) {
    const container = this.timeSlotsContainer?.nativeElement as HTMLElement | undefined;
    if (!container) {
      if (attempt < 5) {
        setTimeout(() => this.scrollNowIndicatorIntoView(force, attempt + 1), 100);
      }
      return;
    }

    if (!this.showNowIndicator && !force) {
      return;
    }

    const maxAttempts = 5;
    const currentScroll = container.scrollTop;
    const viewHeight = container.clientHeight;
    const indicator = this.nowIndicatorTop;
    const buffer = 40;

    // Check if we have valid dimensions
    if (viewHeight === 0 || container.scrollHeight === 0) {
      if (attempt < maxAttempts) {
        setTimeout(() => this.scrollNowIndicatorIntoView(force, attempt + 1), 150);
      }
      return;
    }

    const needsScroll =
      force ||
      indicator < currentScroll + buffer ||
      indicator > currentScroll + viewHeight - buffer;

    if (needsScroll) {
      const target = Math.max(0, indicator - viewHeight / 2);
      requestAnimationFrame(() => {
        container.scrollTo({ 
          top: target, 
          behavior: attempt === 0 ? 'smooth' : 'auto' 
        });
        this.hasScrolledToNow = true;
        console.log(`⏰ Scrolled availability setup to now indicator at position ${target}`);
      });
    } else {
      this.hasScrolledToNow = true;
    }
  }

  private updateSelectedCount() {
    this.selectedSlotsCount = this.selectedSlots.size;
  }

  // Quick actions
  setBusinessHours() {
    // Set 9:00 AM - 6:00 PM for weekdays (30-min slots)
    this.selectedSlots.clear();
    for (let day = 0; day < 5; day++) { // Monday to Friday
      const startIdx = 9 * 2; // 9:00
      const endIdx = 18 * 2; // 18:00 (exclusive)
      for (let idx = startIdx; idx < endIdx; idx++) this.selectedSlots.add(`${day}-${idx}`);
    }
    this.updateSelectedCount();
  }

  clearAll() {
    this.selectedSlots.clear();
    this.updateSelectedCount();
  }

  copyWeek() {
    // Copy Monday's schedule to all other days
    const mondaySlots = Array.from(this.selectedSlots).filter(slot => slot.startsWith('0-'));
    this.selectedSlots.clear();
    
    for (let day = 0; day < 7; day++) {
      mondaySlots.forEach(slot => {
        const idx = slot.split('-')[1];
        this.selectedSlots.add(`${day}-${idx}`);
      });
    }
    this.updateSelectedCount();
  }

  togglePopularSlots() {
    // Toggle popular slots visibility
    console.log('Popular slots toggled:', this.showPopularSlots);
  }

  // Integration
  connectGoogleCalendar() {
    console.log('Connecting Google Calendar...');
    // TODO: Implement Google Calendar integration
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
    if (this.selectedSlotsCount === 0) {
      const toast = await this.toastController.create({
        message: 'Please select at least one time slot',
        duration: 2000,
        position: 'bottom'
      });
      await toast.present();
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Saving availability...',
      duration: 0
    });
    await loading.present();

    try {
      // Convert selected slots to availability blocks
      const availabilityBlocks = this.convertSlotsToBlocks();
      
      console.log('Saving availability blocks:', availabilityBlocks);
      
      this.userService.updateAvailability(availabilityBlocks).subscribe({
        next: async (response) => {
          await loading.dismiss();
          console.log('Availability saved successfully:', response);
          
          const toast = await this.toastController.create({
            message: 'Availability saved successfully!',
            duration: 2000,
            position: 'bottom',
            color: 'success'
          });
          await toast.present();
          
          this.hasUnsavedChanges = false;
          // Update initial count to reflect saved state
          this.initialSelectedSlotsCount = this.selectedSlotsCount;
          // Navigate back to calendar
          this.router.navigate(['/tabs/tutor-calendar']);
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
    const dayGroups = new Map<number, number[]>();
    
    console.log('🔧 Converting slots to blocks. Selected slots:', Array.from(this.selectedSlots));
    
    // Group slots by day
    this.selectedSlots.forEach(slotKey => {
      const [dayStr, idxStr] = slotKey.split('-');
      const day = parseInt(dayStr);
      const idx = parseInt(idxStr);
      
      console.log(`🔧 Processing slot: ${slotKey} -> day=${day}, index=${idx}`);
      
      if (!dayGroups.has(day)) {
        dayGroups.set(day, []);
      }
      dayGroups.get(day)!.push(idx);
    });
    
    // Convert each day's hours to blocks
    dayGroups.forEach((indices, day) => {
      indices.sort((a, b) => a - b);

      let startIdx = indices[0];
      let endIdx = indices[0] + 1; // exclusive

      const idxToTime = (idx: number) => {
        const h = Math.floor(idx / 2);
        const m = idx % 2 === 1 ? '30' : '00';
        return `${h.toString().padStart(2, '0')}:${m}`;
      };

      for (let i = 1; i < indices.length; i++) {
        if (indices[i] === endIdx) {
          endIdx++;
        } else {
          const block = {
            id: `${day}-${startIdx}-${endIdx}`,
            day: day, // Keep as number (0-6) to match backend schema
            startTime: idxToTime(startIdx),
            endTime: idxToTime(endIdx),
            type: 'available',
            title: 'Available',
            color: '#007bff'
          };
          console.log(`🔧 Created block:`, block);
          blocks.push(block);

          startIdx = indices[i];
          endIdx = indices[i] + 1;
        }
      }

      const lastBlock = {
        id: `${day}-${startIdx}-${endIdx}`,
        day: day, // Keep as number (0-6) to match backend schema
        startTime: idxToTime(startIdx),
        endTime: idxToTime(endIdx),
        type: 'available',
        title: 'Available',
        color: '#007bff'
      };
      console.log(`🔧 Created last block:`, lastBlock);
      blocks.push(lastBlock);
    });
    
    return blocks;
  }
}