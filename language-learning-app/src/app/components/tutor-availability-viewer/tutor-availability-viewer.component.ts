import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, LoadingController } from '@ionic/angular';
import { UserService } from '../../services/user.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

interface AvailabilityBlock {
  id: string;
  startTime: string;
  endTime: string;
  day: number;
  type: 'available' | 'unavailable' | 'break';
  title?: string;
  color?: string;
}

@Component({
  selector: 'app-tutor-availability-viewer',
  templateUrl: './tutor-availability-viewer.component.html',
  styleUrls: ['./tutor-availability-viewer.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class TutorAvailabilityViewerComponent implements OnInit, OnDestroy {
  @Input() tutorId!: string;
  @Input() tutorName!: string;
  // When true, render as an inline section (no modal chrome)
  @Input() inline = false;
  
  private destroy$ = new Subject<void>();
  availability: AvailabilityBlock[] = [];
  timezone: string = 'America/New_York';
  currentWeekStart: Date = new Date();
  isLoading = false;
  
  daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  timeSlots: string[] = [];
  timeLabels: string[] = [];
  weekDates: Date[] = [];
  // Fast lookup: key = `${day}-${HH:mm}`
  availabilitySet: Set<string> = new Set();
  private slotsCache: Map<string, { label: string; time: string }[]> = new Map();
  
  constructor(
    private userService: UserService,
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

  ngOnInit() {
    this.recomputeWeekDates();
    this.loadAvailability();
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
    // Generate time slots from 6 AM to 11 PM in 30-minute increments
    for (let hour = 6; hour <= 23; hour++) {
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

  async loadAvailability() {
    this.isLoading = true;
    const loading = await this.loadingController.create({
      message: 'Loading availability...',
      duration: 5000
    });
    await loading.present();

    this.userService.getTutorAvailability(this.tutorId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          console.log('📅 Availability response received:', response);
          console.log('📅 Availability array:', response.availability);
          this.availability = response.availability || [];
          this.timezone = response.timezone || 'America/New_York';
          console.log('📅 Building availability set with', this.availability.length, 'blocks');
          this.buildAvailabilitySet();
          console.log('📅 Availability set size:', this.availabilitySet.size);
          console.log('📅 First few availability set entries:', Array.from(this.availabilitySet).slice(0, 10));
          this.isLoading = false;
          loading.dismiss();
        },
        error: (error) => {
          console.error('Error loading availability:', error);
          this.isLoading = false;
          loading.dismiss();
        }
      });
  }

  isSlotAvailable(day: number, timeSlot: string): boolean {
    return this.availabilitySet.has(`${day}-${timeSlot}`);
  }

  private buildAvailabilitySet() {
    const set = new Set<string>();
    console.log('📅 Building availability set from', this.availability.length, 'blocks');
    console.log('📅 Raw availability blocks:', this.availability);
    
    for (const block of this.availability) {
      if (block.type !== 'available') {
        continue;
      }
      const start = this.timeToMinutes(block.startTime);
      const end = this.timeToMinutes(block.endTime);
      console.log(`📅 Block day=${block.day}, start=${block.startTime} (${start} min), end=${block.endTime} (${end} min)`);
      
      const generatedKeys: string[] = [];
      for (let m = start; m < end; m += 30) {
        const hh = Math.floor(m / 60).toString().padStart(2, '0');
        const mm = (m % 60).toString().padStart(2, '0');
        const key = `${block.day}-${hh}:${mm}`;
        set.add(key);
        generatedKeys.push(key);
      }
      console.log(`📅 Generated keys for block:`, generatedKeys);
    }
    this.availabilitySet = set;
    console.log('📅 Final availability set size:', set.size);
    console.log('📅 All keys:', Array.from(set).sort());
    this.slotsCache.clear();
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

  navigateWeek(direction: 'prev' | 'next') {
    const days = direction === 'next' ? 7 : -7;
    this.currentWeekStart.setDate(this.currentWeekStart.getDate() + days);
    this.recomputeWeekDates();
    // availability does not change across week navigation in this simple view
  }

  goToToday() {
    this.setCurrentWeekStart();
    this.recomputeWeekDates();
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

  // Return list of available slots with both label and 24h time for a given date
  getAvailableTimeLabelsForDate(date: Date): { label: string; time: string }[] {
    // Only show availability within the same calendar week as today
    const today = new Date();
    if (!this.isSameCalendarWeek(date, today)) {
      return [];
    }
    const cacheKey = this.dateKey(date);
    const cached = this.slotsCache.get(cacheKey);
    if (cached) return cached;
    const dayIndex = this.getSetupDayIndex(date);
    
    // Debug logging
    console.log(`📅 DEBUG: Getting availability for date ${date.toDateString()}`);
    console.log(`📅 DEBUG: Date.getDay() = ${date.getDay()} (0=Sun, 1=Mon, ..., 6=Sat)`);
    console.log(`📅 DEBUG: Setup day index = ${dayIndex} (0=Mon, 1=Tue, ..., 6=Sun)`);
    console.log(`📅 DEBUG: Available keys in set:`, Array.from(this.availabilitySet).filter(key => key.startsWith(`${dayIndex}-`)));
    
    const slots: { label: string; time: string }[] = [];
    for (let i = 0; i < this.timeSlots.length; i++) {
      const key = `${dayIndex}-${this.timeSlots[i]}`;
      if (this.availabilitySet.has(key)) {
        slots.push({ label: this.timeLabels[i], time: this.timeSlots[i] });
      }
    }
    
    console.log(`📅 DEBUG: Found ${slots.length} available slots for day ${dayIndex}`);
    
    this.slotsCache.set(cacheKey, slots);
    return slots;
  }

  onSelectSlot(date: Date, slot: { label: string; time: string }) {
    // Navigate to checkout with tutor/time
    const dateIso = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
    this.router.navigate(['/checkout'], {
      queryParams: {
        tutorId: this.tutorId,
        date: dateIso,
        time: slot.time
      }
    });
  }
  
}
