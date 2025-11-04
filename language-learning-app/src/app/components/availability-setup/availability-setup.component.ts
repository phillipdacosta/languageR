import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController } from '@ionic/angular';
import { Router } from '@angular/router';
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
export class AvailabilitySetupComponent implements OnInit, OnDestroy {
  @ViewChild('timeSlotsContainer', { static: false }) timeSlotsContainer?: ElementRef;

  private destroy$ = new Subject<void>();

  // UI State
  activeTab = 'availability';
  showPopularSlots = false;
  selectedSlotsCount = 0;
  currentWeek: Date = new Date(); // The Monday of the current week being viewed

  // Selection state
  isSelecting = false;
  selectionStart: SelectedSlot | null = null;
  selectedSlots = new Set<string>();

  // Data
  weekDays: WeekDay[] = [];

  timeSlots: TimeSlot[] = [];

  // Popular time slots (9:00 AM - 9:00 PM) in 30-min indices
  // 9:00 -> index 18, 9:30 -> 19, ..., 20:30 -> 41. We'll highlight indices in [18, 41].
  popularStartIndex = 18;
  popularEndIndex = 41;
  // Night time starts at 6:00 PM local (index 36)
  nightStartIndex = 36;

  constructor(
    private router: Router,
    private userService: UserService,
    private toastController: ToastController,
    private loadingController: LoadingController
  ) {
    this.initializeTimeSlots();
    this.initializeCurrentWeek();
    this.updateWeekDays();
  }

  ngOnInit() {
    this.loadExistingAvailability();
  }

  private initializeCurrentWeek() {
    // Set currentWeek to the Monday of the current week
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday = 1, Sunday = 0
    this.currentWeek = new Date(today);
    this.currentWeek.setDate(today.getDate() + mondayOffset);
    this.currentWeek.setHours(0, 0, 0, 0);
  }

  private updateWeekDays() {
    const monday = new Date(this.currentWeek);
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const shortNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    this.weekDays = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      
      const dayOfMonth = date.getDate();
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthName = monthNames[date.getMonth()];
      
      this.weekDays.push({
        name: dayNames[i],
        shortName: shortNames[i],
        index: i,
        date: date,
        displayDate: dayOfMonth.toString(),
        displayMonth: monthName
      });
    }
  }

  getWeekRange(): string {
    const startDate = this.weekDays[0]?.date;
    const endDate = this.weekDays[6]?.date;
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
    const days = direction === 'prev' ? -7 : 7;
    this.currentWeek = new Date(this.currentWeek);
    this.currentWeek.setDate(this.currentWeek.getDate() + days);
    this.updateWeekDays();
  }

  navigateMonth(direction: 'prev' | 'next') {
    const months = direction === 'prev' ? -1 : 1;
    this.currentWeek = new Date(this.currentWeek);
    this.currentWeek.setMonth(this.currentWeek.getMonth() + months);
    // Ensure we're still on a Monday
    const dayOfWeek = this.currentWeek.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    this.currentWeek.setDate(this.currentWeek.getDate() + mondayOffset);
    this.updateWeekDays();
  }

  goToToday() {
    this.initializeCurrentWeek();
    this.updateWeekDays();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
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
    console.log('🔧 Loading existing availability...');
    this.userService.getAvailability().subscribe({
      next: (res) => {
        console.log('🔧 Loaded existing availability:', res);
        // Convert existing availability to selected slots
        if (res.availability && res.availability.length > 0) {
          res.availability.forEach(block => {
            console.log(`🔧 Processing existing block: day=${block.day}, time=${block.startTime}-${block.endTime}`);
            const [sh, sm] = block.startTime.split(':').map((v: string) => parseInt(v, 10));
            const [eh, em] = block.endTime.split(':').map((v: string) => parseInt(v, 10));

            const startIndex = sh * 2 + (sm >= 30 ? 1 : 0);
            const endIndex = eh * 2 + (em >= 30 ? 1 : 0);

            for (let idx = startIndex; idx < endIndex; idx++) {
              const slotKey = `${block.day}-${idx}`;
              this.selectedSlots.add(slotKey);
            }
          });
          this.updateSelectedCount();
          console.log('🔧 Final selected slots after loading:', Array.from(this.selectedSlots));
        }
      },
      error: (error) => {
        console.error('Error loading existing availability:', error);
      }
    });
  }

  // Navigation
  goBack() {
    console.log('Going back to calendar...');
    this.router.navigate(['/tabs/tutor-calendar']);
  }

  setActiveTab(tab: string) {
    this.activeTab = tab;
  }

  // Selection logic
  startSelection(dayIndex: number, slotIndex: number, event: MouseEvent) {
    event.preventDefault();
    this.isSelecting = true;
    this.selectionStart = { day: dayIndex, index: slotIndex };
    this.toggleSlot(dayIndex, slotIndex);
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
        this.selectedSlots.add(`${day}-${idx}`);
      }
    }

    this.updateSelectedCount();
  }

  endSelection() {
    this.isSelecting = false;
    this.selectionStart = null;
  }

  private toggleSlot(dayIndex: number, slotIndex: number) {
    const slotKey = `${dayIndex}-${slotIndex}`;
    if (this.selectedSlots.has(slotKey)) {
      this.selectedSlots.delete(slotKey);
    } else {
      this.selectedSlots.add(slotKey);
    }
    this.updateSelectedCount();
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

  isToday(day: WeekDay): boolean {
    const today = new Date();
    return day.date.getDate() === today.getDate() &&
           day.date.getMonth() === today.getMonth() &&
           day.date.getFullYear() === today.getFullYear();
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
            day: day,
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
        day: day,
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