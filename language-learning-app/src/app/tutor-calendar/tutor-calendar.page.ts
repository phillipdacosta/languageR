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

@Component({
  selector: 'app-tutor-calendar-page',
  templateUrl: './tutor-calendar.page.html',
  styleUrls: ['./tutor-calendar.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class TutorCalendarPage implements OnInit, AfterViewInit, OnDestroy, ViewWillEnter, ViewDidEnter {
  currentUser: User | null = null;
  private calendar?: Calendar;
  events: EventInput[] = [];
  isInitialized = false;
  private initializationAttempts = 0; // Track initialization attempts
  
  // Custom full-width now indicator state
  customNowVisible = false;
  customNowTop = 0;
  customNowLeft = 0;
  customNowWidth = 0;
  private customNowInterval: any;
  
  // Mobile expandable sections
  sidebarExpanded = false;
  tagsExpanded = false;
  lessonStatusExpanded = false;

  constructor(
    private userService: UserService,
    private lessonService: LessonService,
    private router: Router
  ) { }

  ngOnInit() {
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
    
    // Immediate simple test
    const calendarEl = document.getElementById('tutor-calendar-container');
    console.log('📅 Container found in ngAfterViewInit:', !!calendarEl);
    console.log('📅 Container dimensions in ngAfterViewInit:', {
      width: calendarEl?.offsetWidth,
      height: calendarEl?.offsetHeight,
      clientWidth: calendarEl?.clientWidth,
      clientHeight: calendarEl?.clientHeight
    });
    
    // Show a simple test div to confirm container is working
    if (calendarEl) {
      calendarEl.innerHTML = `
        <div style="background: red; color: white; padding: 40px; font-size: 24px; text-align: center;">
          TEST: If you can see this RED box, the container is working!<br>
          Container dimensions: ${calendarEl.offsetWidth}x${calendarEl.offsetHeight}
        </div>
      `;
    }
    
    // Then try to initialize calendar after delay
    setTimeout(() => {
      this.initCalendar();
    }, 2000);
  }

  ngOnDestroy() {
    if (this.calendar) {
      this.calendar.destroy();
      this.calendar = undefined;
    }
    this.isInitialized = false;
    if (this.customNowInterval) clearInterval(this.customNowInterval);
    window.removeEventListener('resize', this.updateCustomNowIndicatorBound);
  }

  ionViewWillEnter() {
    console.log('Tutor calendar page will enter');
  }

  ionViewDidEnter() {
    console.log('Tutor calendar page did enter');
    console.log('📅 Current user state:', this.currentUser);
    
    // Check if we're coming from availability setup
    const currentUrl = this.router.url;
    console.log('📅 Current URL:', currentUrl);
    
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
    const lessonEvents = lessons.map(lesson => {
      // Determine color based on status
      let backgroundColor = '#667eea'; // Default purple
      let borderColor = '#5568d3';
      
      switch (lesson.status) {
        case 'scheduled':
          backgroundColor = '#667eea'; // Purple - upcoming
          borderColor = '#5568d3';
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
      }

      // Format student name for display
      const studentName = lesson.studentId?.name || 'Unknown Student';
      const subject = lesson.subject || 'Language Lesson';
      
      // Format time for display (12-hour format like availability-setup)
      const startTime = new Date(lesson.startTime);
      const endTime = new Date(lesson.endTime);
      const timeStr = `${this.formatTime12Hour(startTime.getHours(), startTime.getMinutes())} - ${this.formatTime12Hour(endTime.getHours(), endTime.getMinutes())}`;
      
      const isPast = endTime.getTime() < Date.now();
      return {
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
          subject: subject,
          status: lesson.status,
          timeStr: timeStr,
          price: lesson.price,
          duration: lesson.duration,
          notes: lesson.notes
        }
      } as EventInput;
    });
    
    // Merge lesson events with existing events (availability/classes)
    // Remove any existing lesson events first to avoid duplicates
    const nonLessonEvents = this.events.filter(event => !event.extendedProps?.['lessonId']);
    this.events = [...nonLessonEvents, ...lessonEvents];
    
    console.log(`📅 Converted ${lessons.length} lessons to events, total events: ${this.events.length}`);
  }

  private initCalendar(): boolean {
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
      const defaultView = isMobile ? 'timeGridDay' : 'timeGridWeek';
      const initialView = savedView && ['dayGridMonth', 'timeGridWeek', 'timeGridDay'].includes(savedView) 
        ? savedView 
        : defaultView;
      
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
        businessHours: {
          daysOfWeek: [1, 2, 3, 4, 5, 6, 0],
          startTime: '08:00',
          endTime: '20:00'
        },
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
      // Compute custom now indicator after first render
      setTimeout(() => this.updateCustomNowIndicator());
      this.isInitialized = true;
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
    
    // First try to initialize calendar
    const success = this.initCalendar();
    
    if (!success) {
      console.error('📅 Calendar initialization failed');
      return;
    }
    
    // Then load data and update calendar (if user exists)
    this.loadAndUpdateCalendarData();
    
    // Load lessons if we have a user
    if (this.currentUser && this.currentUser.id) {
      this.loadLessons(this.currentUser.id);
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
            return;
          }
          
          this.events = res.availability.map((b, index) => {
            return this.blockToEvent(b);
          });
          console.log('📅 Total events loaded:', this.events.length);
          
          // Update calendar with events smoothly
          this.updateCalendarEvents();
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
          console.log('📅 Calendar events:', allEvents.map(e => ({
            id: e.id,
            title: e.title,
            start: e.startStr,
            end: e.endStr
          })));
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
  }

  private updateCustomNowIndicatorBound = () => this.updateCustomNowIndicator();

  private updateCustomNowIndicator() {
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
    
    // Prefer absolute one-off dates when provided (e.g., classes)
    let start: Date;
    let end: Date;
    if (b.absoluteStart && b.absoluteEnd) {
      start = new Date(b.absoluteStart);
      end = new Date(b.absoluteEnd);
      // Using absolute dates for one-off events (classes)
    } else {
      // Weekly availability fallback: map to current week
      const today = new Date();
      const currentDay = today.getDay();
      const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay; // Monday = 1, Sunday = 0
      const monday = new Date(today);
      monday.setDate(today.getDate() + mondayOffset);
      monday.setHours(0, 0, 0, 0);
      const dayDate = new Date(monday);
      dayDate.setDate(monday.getDate() + b.day);
      start = this.withTime(dayDate, b.startTime);
      end = this.withTime(dayDate, b.endTime);
      // Using weekly mapping for recurring availability
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

  onSetUpAvailability() {
    console.log('Set up availability clicked');
    this.router.navigate(['/tabs/availability-setup']);
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

  private refreshCalendarData() {
    console.log('🔄 Refreshing calendar data after navigation...');
    console.log('📅 User state before refresh:', this.currentUser);
    
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
}
