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
  private fallbackUsed = false; // Prevent infinite fallback calls
  private initializationAttempts = 0; // Track initialization attempts
  
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
    this.events = lessons.map(lesson => {
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
      
      // Format time for display
      const startTime = new Date(lesson.startTime);
      const endTime = new Date(lesson.endTime);
      const timeStr = `${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      
      return {
        id: lesson._id,
        title: `${studentName} - ${subject}`,
        start: lesson.startTime,
        end: lesson.endTime,
        backgroundColor: backgroundColor,
        borderColor: borderColor,
        textColor: '#ffffff',
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
    
    console.log(`📅 Converted ${lessons.length} lessons to ${this.events.length} calendar events`);
  }

  private initCalendar(): boolean {
    // Prevent multiple initialization attempts
    if (this.initializationAttempts > 3) {
      console.warn('📅 Too many initialization attempts, using fallback');
      this.fallbackCalendarInitialization();
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
        slotMinTime: '06:00:00',
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
        slotLabelFormat: {
          hour: 'numeric',
          minute: '2-digit',
          hour12: false
        }
      });

      this.calendar.render();
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
      console.error('📅 Calendar initialization failed, trying fallback...');
      this.fallbackCalendarInitialization();
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
            console.log(`📅 Processing availability block ${index + 1}:`, b);
            const event = this.blockToEvent(b);
            console.log(`📅 Converted block ${index + 1} to event:`, event);
            return event;
          });
          
          console.log('📅 Final events array:', this.events);
          console.log('📅 Events count:', this.events.length);
          
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

  private fallbackCalendarInitialization() {
    // Prevent infinite loops
    if (this.fallbackUsed) {
      console.log('📅 Fallback already used, skipping...');
      return;
    }
    
    this.fallbackUsed = true;
    console.log('🔄 Using fallback calendar initialization...');
    
    // Create a simple fallback display with basic calendar
    const calendarEl = document.getElementById('tutor-calendar-container');
    if (calendarEl) {
      calendarEl.innerHTML = `
        <div style="width: 100%; height: 500px; background: white; border-radius: 8px; padding: 20px; box-sizing: border-box;">
          <h3 style="margin: 0 0 20px 0; color: #333;">Your Availability Calendar</h3>
          <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; background: #ddd; border: 1px solid #ddd;">
            <div style="background: #f8f9fa; padding: 10px; text-align: center; font-weight: bold;">Sun</div>
            <div style="background: #f8f9fa; padding: 10px; text-align: center; font-weight: bold;">Mon</div>
            <div style="background: #f8f9fa; padding: 10px; text-align: center; font-weight: bold;">Tue</div>
            <div style="background: #f8f9fa; padding: 10px; text-align: center; font-weight: bold;">Wed</div>
            <div style="background: #f8f9fa; padding: 10px; text-align: center; font-weight: bold;">Thu</div>
            <div style="background: #f8f9fa; padding: 10px; text-align: center; font-weight: bold;">Fri</div>
            <div style="background: #f8f9fa; padding: 10px; text-align: center; font-weight: bold;">Sat</div>
            ${Array.from({length: 35}, (_, i) => {
              const day = i + 1;
              const isMonday = (i + 1) % 7 === 2; // Monday is day 2
              const isTuesday = (i + 1) % 7 === 3; // Tuesday is day 3
              const hasAvailability = (isMonday || isTuesday) && day <= 31;
              return `<div style="background: ${hasAvailability ? '#e3f2fd' : 'white'}; padding: 10px; text-align: center; min-height: 40px; ${hasAvailability ? 'border: 2px solid #007bff;' : ''}">${day <= 31 ? day : ''}</div>`;
            }).join('')}
          </div>
          <div style="margin-top: 20px; padding: 10px; background: #e3f2fd; border-radius: 4px;">
            <strong>Your Availability:</strong><br>
            Monday 6:00 AM - 7:00 AM<br>
            Tuesday 6:00 AM - 7:00 AM
          </div>
          <p style="margin-top: 20px; color: #666; font-size: 14px;">
            Calendar is loading... If this persists, please refresh the page.
          </p>
        </div>
      `;
      
      // Don't try to initialize calendar again - just show the fallback
      console.log('📅 Fallback calendar displayed');
    }
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
    // Use current week's Monday as base
    const today = new Date();
    const currentDay = today.getDay();
    const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay; // Monday = 1, Sunday = 0
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);
    
    // Calculate the specific day
    const dayDate = new Date(monday);
    dayDate.setDate(monday.getDate() + b.day);
    
    const start = this.withTime(dayDate, b.startTime);
    const end = this.withTime(dayDate, b.endTime);
    
    console.log(`📅 Converting block: day=${b.day}, startTime=${b.startTime}, endTime=${b.endTime}`);
    console.log(`📅 Day date: ${dayDate.toDateString()}, Start: ${start.toISOString()}, End: ${end.toISOString()}`);
    
    const event = {
      id: b.id || `${Date.now()}-${Math.random()}`,
      title: b.title || 'Available',
      start: start.toISOString(),
      end: end.toISOString(),
      backgroundColor: b.color || '#007bff',
      borderColor: b.color || '#007bff'
    };
    
    console.log(`📅 Final event object:`, event);
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
      title: e.title || 'Available',
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
    // TODO: Implement lesson scheduling modal
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
      
      // If calendar has no dimensions and we haven't used fallback yet, use it
      if ((calendarRect.width === 0 || calendarRect.height === 0) && !this.fallbackUsed) {
        console.warn('📅 Calendar has no dimensions, using fallback...');
        this.fallbackCalendarInitialization();
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
}
