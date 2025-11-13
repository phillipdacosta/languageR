import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit, Input, OnChanges, ChangeDetectorRef } from '@angular/core';
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
export class AvailabilitySetupComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
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
    private alertController: AlertController,
    private cdr: ChangeDetectorRef
  ) {
    this.initializeTimeSlots();
    this.initializeCurrentWeek();
    this.updateResponsiveState();
    this.updateWeekDays(new Date());
  }

  ionViewWillEnter() {
    // this.forceRefreshAvailability();
    this.forceScrollToNowIndicator();
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
      
      // Reset scroll state and trigger scroll after view updates
      this.hasScrolledToNow = false;
      
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
      
      // Trigger scroll with a delay to allow view to settle
      // The parent page's ionViewDidEnter should also trigger this, but we have
      // a fallback here in case it doesn't fire (e.g., when navigating between child routes)
      setTimeout(() => {
        this.scrollToNowIndicator();
      }, 200);
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
  }

  // Force refresh availability data (with cache busting)
  forceRefreshAvailability() {
    console.log('🔄 Force refreshing availability data...');
    this.selectedSlots.clear();
    this.selectedSlotsCount = 0;
    this.loadExistingAvailability();
  }

  // Force scroll to current time indicator on page entry
  private async scrollUsingIonicAPI(ionContent: any, force: boolean, retryCount = 0) {
    const maxRetries = 20;
    const timeSlotsElement = this.timeSlotsContainer?.nativeElement as HTMLElement;
    if (!timeSlotsElement) {
      if (retryCount < maxRetries) {
        setTimeout(() => {
          this.scrollUsingIonicAPI(ionContent, force, retryCount + 1);
        }, 200);
      }
      return;
    }
    
    // Get the scroll element to check if it has scrollable content
    const scrollElement = await ionContent.getScrollElement();
    
    // Check if content is scrollable yet - need BOTH dimensions and actual content
    const hasValidDimensions = scrollElement.scrollHeight > 0 && scrollElement.clientHeight > 0;
    const hasScrollableContent = scrollElement.scrollHeight > scrollElement.clientHeight;
    
    if (!hasValidDimensions) {
      if (retryCount < maxRetries) {
        // Content not ready yet, wait and retry with progressive backoff
        const delay = Math.min(200 + (retryCount * 100), 1000); // Cap at 1000ms
        setTimeout(() => {
          this.scrollUsingIonicAPI(ionContent, force, retryCount + 1);
        }, delay);
        return;
      }
      // Try to scroll anyway, might work
    }
    
    // Calculate the scroll position relative to the scroll container
    // Walk up the DOM tree to get total offset
    let element: HTMLElement | null = timeSlotsElement;
    let totalOffsetTop = 0;
    
    while (element && element !== scrollElement) {
      totalOffsetTop += element.offsetTop;
      element = element.offsetParent as HTMLElement;
      
      if (element === document.body || element === document.documentElement) {
        break;
      }
    }
    
    const indicator = this.nowIndicatorTop;
    const indicatorPosition = totalOffsetTop + indicator;
    
    // Center the indicator in the viewport
    const targetY = indicatorPosition - (window.innerHeight / 2);
    
    // Use Ionic's scrollToPoint method - parameters are (x, y, duration)
    // Note: x is horizontal (left), y is vertical (top)
    try {
      await ionContent.scrollToPoint(0, Math.max(0, targetY), 300);
      this.hasScrolledToNow = true;
    } catch (error) {
      // Silently fail
    }
  }

  private forceScrollToNowIndicator() {
    this.hasScrolledToNow = false;
    
    // Always update and show the now indicator, even if not viewing today
    setTimeout(() => {
      this.updateNowIndicatorForced();
      // Wait for DOM to be ready, then scroll
      setTimeout(() => {
        this.scrollNowIndicatorIntoView(true);
      }, 300);
    }, 500);
  }

  // Update now indicator without checking if current week is in view
  private updateNowIndicatorForced() {
    const timeSlotsElement = this.timeSlotsContainer?.nativeElement as HTMLElement | undefined;
    if (!timeSlotsElement) {
      return;
    }
    
    // Find the scrollable container (.time-grid-container)
    const container = timeSlotsElement.closest('.time-grid-container') as HTMLElement;
    if (!container) {
      return;
    }

    // Calculate position based on current time
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const totalMinutes = 24 * 60;
    
    // Calculate position relative to the time slots content, not the scrollable container
    const timeSlotsHeight = timeSlotsElement.scrollHeight;
    const calculatedTop = Math.round((minutes / totalMinutes) * timeSlotsHeight);
    this.nowIndicatorTop = Math.max(0, Math.min(timeSlotsHeight - 1, calculatedTop));

    // Calculate left position and width (same logic as original)
    const timeLabels = timeSlotsElement.querySelectorAll('.time-label');
    let labelWidth = 60; // fallback
    if (timeLabels.length > 0) {
      const firstLabel = timeLabels[0] as HTMLElement;
      labelWidth = firstLabel.offsetWidth + 8;
    }

    const containerWidth = timeSlotsElement.clientWidth;
    
    if (this.isSingleDayMode) {
      // Single day mode: span the single day column
      this.nowIndicatorLeft = labelWidth;
      this.nowIndicatorWidth = Math.max(0, containerWidth - labelWidth);
    } else {
      // Regular mode: span all day columns
      this.nowIndicatorLeft = labelWidth;
      this.nowIndicatorWidth = Math.max(0, containerWidth - labelWidth);
    }

    // Always show the indicator when forced
    this.showNowIndicator = true;
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
    // Don't auto-scroll here - let the parent page's ionViewDidEnter trigger it
    // This ensures ion-content is fully initialized before we try to scroll
    
    // Update every minute (using regular update that respects current week view)
    this.nowIntervalId = setInterval(() => this.updateNowIndicator(), 60_000);
    // Recompute on resize
    window.addEventListener('resize', this.boundResizeHandler);
  }

  private isScrolling = false; // Prevent multiple simultaneous scroll attempts

  // Public method that can be called by parent page when view is ready
  public scrollToNowIndicator() {
    if (this.isScrolling) {
      return;
    }
    
    this.isScrolling = true;
    this.hasScrolledToNow = false;
    
    // Update the indicator position first
    this.updateNowIndicatorForced();
    
    // Force Angular to detect changes and apply style bindings to DOM
    this.cdr.detectChanges();
    
    // Wait for browser to paint the changes (minimal delay for fastest response)
    requestAnimationFrame(() => {
      // Query within the component's time slots container, not globally!
      // This prevents finding old elements from previous routes
      const timeSlotsElement = this.timeSlotsContainer?.nativeElement as HTMLElement;
      if (!timeSlotsElement) {
        this.isScrolling = false;
        return;
      }
      
      const nowIndicator = timeSlotsElement.querySelector('.now-indicator') as HTMLElement;
      
      if (nowIndicator) {
        const rect = nowIndicator.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(nowIndicator);
        
        if (rect.width === 0 || rect.height === 0) {
          this.isScrolling = false;
          return;
        }
        
        if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden') {
          this.isScrolling = false;
          return;
        }
        
        // On desktop, use custom scroll calculation to account for header-card
        if (!this.isMobileView) {
          const scrollContainer = timeSlotsElement.closest('.time-grid-container') as HTMLElement;
          if (scrollContainer) {
            const headerCard = document.querySelector('.header-card') as HTMLElement;
            const headerHeight = headerCard ? headerCard.getBoundingClientRect().height : 0;
            const headerPadding = 73; // Top padding from .content-header
            const totalHeaderSpace = headerHeight + headerPadding + 40; // Add buffer for spacing
            
            // Get the indicator's position relative to the scroll container
            const containerRect = scrollContainer.getBoundingClientRect();
            const indicatorRect = nowIndicator.getBoundingClientRect();
            const indicatorTopRelative = indicatorRect.top - containerRect.top + scrollContainer.scrollTop;
            
            // Calculate target scroll to position indicator below header
            const targetScroll = indicatorTopRelative - totalHeaderSpace;
            
            scrollContainer.scrollTo({
              top: Math.max(0, targetScroll),
              behavior: 'smooth'
            });
            
            this.hasScrolledToNow = true;
          } else {
            // Fallback to scrollIntoView if container not found
            nowIndicator.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'center',
              inline: 'nearest'
            });
            this.hasScrolledToNow = true;
          }
        } else {
          // On mobile, use standard scrollIntoView
          nowIndicator.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center',
            inline: 'nearest'
          });
          this.hasScrolledToNow = true;
        }
      }
      
      // Reset scrolling flag
      setTimeout(() => {
        this.isScrolling = false;
      }, 1500);
    });
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
        index: date.getDay(), // Use actual day of week (0=Sunday, 1=Monday, etc.)
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
        console.log('🔧 Raw availability data:', JSON.stringify(res, null, 2));
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
      this.showNowIndicator = false;
      return;
    }

    // Always show the now indicator regardless of which day/week is being viewed
    // This helps users see the current time even when viewing other dates

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
      } else {
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

    if (!this.hasScrolledToNow) {
      this.scrollNowIndicatorIntoView(true);
    }
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

  private scrollNowIndicatorIntoView(force = false, attempt = 0) {
    const timeSlotsElement = this.timeSlotsContainer?.nativeElement as HTMLElement | undefined;
    if (!timeSlotsElement) {
      if (attempt < 5) {
        setTimeout(() => this.scrollNowIndicatorIntoView(force, attempt + 1), 100);
      }
      return;
    }
    
    // On mobile, the entire page scrolls (window/document), not a container
    // On desktop, the .time-grid-container scrolls
    if (this.isMobileView) {
      // Mobile: Use Ionic's ion-content scrollToPoint API directly
      const ionContent = document.querySelector('ion-content');
      if (ionContent) {
        ionContent.getScrollElement().then((scrollElement) => {
          if (scrollElement && scrollElement.scrollHeight > 0) {
            // We have a valid scroll element, use it
            this.performScroll(scrollElement, false, force, attempt);
          } else {
            // Scroll element not ready, use Ionic's scrollToPoint which handles this better
            this.scrollUsingIonicAPI(ionContent, force);
          }
        }).catch(() => {
          this.scrollUsingIonicAPI(ionContent, force);
        });
      }
      return;
    } else {
      // Desktop: find the scrollable container (.time-grid-container)
      const gridContainer = timeSlotsElement.closest('.time-grid-container') as HTMLElement;
      if (!gridContainer) {
        if (attempt < 5) {
          setTimeout(() => this.scrollNowIndicatorIntoView(force, attempt + 1), 100);
        }
        return;
      }
      this.performScroll(gridContainer, false, force, attempt);
    }
  }

  private performScroll(container: HTMLElement | Window, isWindowScroll: boolean, force: boolean, attempt: number) {
    const timeSlotsElement = this.timeSlotsContainer?.nativeElement as HTMLElement;

    if (!this.showNowIndicator && !force) {
      return;
    }

    const maxAttempts = 5;
    let currentScroll: number;
    let viewHeight: number;
    let scrollHeight: number;
    
    if (isWindowScroll) {
      currentScroll = window.pageYOffset || document.documentElement.scrollTop;
      viewHeight = window.innerHeight;
      scrollHeight = document.documentElement.scrollHeight;
    } else {
      const containerEl = container as HTMLElement;
      currentScroll = containerEl.scrollTop;
      viewHeight = containerEl.clientHeight;
      scrollHeight = containerEl.scrollHeight;
    }
    
    const indicator = this.nowIndicatorTop;
    const buffer = 40;

    // Check if we have valid dimensions
    if (viewHeight === 0 || scrollHeight === 0) {
      if (attempt < maxAttempts) {
        setTimeout(() => this.performScroll(container, isWindowScroll, force, attempt + 1), 150);
      }
      return;
    }

    const needsScroll =
      force ||
      indicator < currentScroll + buffer ||
      indicator > currentScroll + viewHeight - buffer;

    if (needsScroll) {
      let indicatorScrollPosition: number;
      
      if (isWindowScroll) {
        // Window scroll: Calculate position relative to the document
        const timeSlotsRect = timeSlotsElement.getBoundingClientRect();
        const documentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const timeSlotsTopInDocument = timeSlotsRect.top + documentScrollTop;
        indicatorScrollPosition = timeSlotsTopInDocument + indicator;
      } else {
        // Container scroll: Calculate position relative to the scrollable container
        const containerEl = container as HTMLElement;
        
        // Get the absolute position of timeSlotsElement relative to the scroll container
        // We need to walk up the DOM tree and sum all offsetTops until we reach the scroll container
        let element: HTMLElement | null = timeSlotsElement;
        let totalOffsetTop = 0;
        
        while (element && element !== containerEl) {
          totalOffsetTop += element.offsetTop;
          element = element.offsetParent as HTMLElement;
          
          // Safety: stop if we've gone too far up
          if (element === document.body || element === document.documentElement) {
            break;
          }
        }
        
        indicatorScrollPosition = totalOffsetTop + indicator;
      }
      
      // Center the indicator in the view, but ensure we don't scroll past the content
      const idealTarget = indicatorScrollPosition - viewHeight / 2;
      const maxScroll = Math.max(0, scrollHeight - viewHeight);
      const target = Math.max(0, Math.min(maxScroll, idealTarget));
      
      requestAnimationFrame(() => {
        if (isWindowScroll) {
          // Mobile: scroll the window with fast smooth animation
          window.scrollTo({ 
            top: target, 
            behavior: 'smooth'
          });
        } else {
          // Desktop: scroll the container with fast smooth animation
          (container as HTMLElement).scrollTo({ 
            top: target, 
            behavior: 'smooth'
          });
        }
        this.hasScrolledToNow = true;
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
          
          // Navigate back to calendar with refresh parameter
          console.log('🔄 Navigating back to calendar with refresh flag...');
          this.router.navigate(['/tabs/tutor-calendar'], { 
            queryParams: { refreshAvailability: 'true' } 
          });
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

      // Find the weekDay that matches this day-of-week index
      // Note: 'day' here is already the day-of-week (0=Sun, 1=Mon, etc.) from the slotKey
      const matchingWeekDay = this.weekDays.find(wd => wd.index === day);
      if (!matchingWeekDay) {
        console.error(`🔧 No date found for day of week ${day}`);
        return;
      }
      
      const dayDate = matchingWeekDay.date;
      console.log(`🔧 Day of week ${day} maps to ${dayDate.toDateString()}`);

      // Create absolute start/end dates for this specific date
      const getAbsoluteDateTime = (date: Date, timeStr: string) => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const absoluteDate = new Date(date);
        absoluteDate.setHours(hours, minutes, 0, 0);
        return absoluteDate.toISOString();
      };

      for (let i = 1; i < indices.length; i++) {
        if (indices[i] === endIdx) {
          endIdx++;
        } else {
          const startTime = idxToTime(startIdx);
          const endTime = idxToTime(endIdx);
          const block = {
            id: `${day}-${startIdx}-${endIdx}`,
            day: day, // Use day of week (0=Sun, 1=Mon, ..., 6=Sat)
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
        id: `${day}-${startIdx}-${endIdx}`,
        day: day, // Use day of week (0=Sun, 1=Mon, ..., 6=Sat)
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
}