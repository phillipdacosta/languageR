import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController } from '@ionic/angular';
import { Router } from '@angular/router';
import { UserService } from '../../services/user.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

interface TimeSlot {
  hour: number;
  display: string;
}

interface WeekDay {
  name: string;
  shortName: string;
  index: number;
}

interface SelectedSlot {
  day: number;
  hour: number;
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
  showPopularSlots = true;
  selectedSlotsCount = 0;

  // Selection state
  isSelecting = false;
  selectionStart: SelectedSlot | null = null;
  selectedSlots = new Set<string>();

  // Data
  weekDays: WeekDay[] = [
    { name: 'Monday', shortName: 'Mon', index: 0 },
    { name: 'Tuesday', shortName: 'Tue', index: 1 },
    { name: 'Wednesday', shortName: 'Wed', index: 2 },
    { name: 'Thursday', shortName: 'Thu', index: 3 },
    { name: 'Friday', shortName: 'Fri', index: 4 },
    { name: 'Saturday', shortName: 'Sat', index: 5 },
    { name: 'Sunday', shortName: 'Sun', index: 6 }
  ];

  timeSlots: TimeSlot[] = [];

  // Popular time slots (9 AM - 9 PM)
  popularHours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

  constructor(
    private router: Router,
    private userService: UserService,
    private toastController: ToastController,
    private loadingController: LoadingController
  ) {
    this.initializeTimeSlots();
  }

  ngOnInit() {
    this.loadExistingAvailability();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeTimeSlots() {
    this.timeSlots = [];
    for (let hour = 0; hour < 24; hour++) {
      this.timeSlots.push({
        hour,
        display: `${hour.toString().padStart(2, '0')}:00`
      });
    }
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
            const startHour = parseInt(block.startTime.split(':')[0]);
            const endHour = parseInt(block.endTime.split(':')[0]);
            
            for (let hour = startHour; hour < endHour; hour++) {
              const slotKey = `${block.day}-${hour}`;
              console.log(`🔧 Adding existing slot: ${slotKey}`);
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
  startSelection(dayIndex: number, hourIndex: number, event: MouseEvent) {
    event.preventDefault();
    this.isSelecting = true;
    this.selectionStart = { day: dayIndex, hour: hourIndex };
    this.toggleSlot(dayIndex, hourIndex);
  }

  continueSelection(dayIndex: number, hourIndex: number) {
    if (!this.isSelecting || !this.selectionStart) return;

    // Clear previous selection in this drag
    this.clearSelectionRange();
    
    // Select new range
    const startDay = Math.min(this.selectionStart.day, dayIndex);
    const endDay = Math.max(this.selectionStart.day, dayIndex);
    const startHour = Math.min(this.selectionStart.hour, hourIndex);
    const endHour = Math.max(this.selectionStart.hour, hourIndex);

    for (let day = startDay; day <= endDay; day++) {
      for (let hour = startHour; hour <= endHour; hour++) {
        this.selectedSlots.add(`${day}-${hour}`);
      }
    }

    this.updateSelectedCount();
  }

  endSelection() {
    this.isSelecting = false;
    this.selectionStart = null;
  }

  private toggleSlot(dayIndex: number, hourIndex: number) {
    const slotKey = `${dayIndex}-${hourIndex}`;
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
    const startHour = Math.min(this.selectionStart.hour, this.selectionStart.hour);
    const endHour = Math.max(this.selectionStart.hour, this.selectionStart.hour);

    for (let day = startDay; day <= endDay; day++) {
      for (let hour = startHour; hour <= endHour; hour++) {
        this.selectedSlots.delete(`${day}-${hour}`);
      }
    }
  }

  isSlotSelected(dayIndex: number, hourIndex: number): boolean {
    return this.selectedSlots.has(`${dayIndex}-${hourIndex}`);
  }

  isPopularSlot(dayIndex: number, hourIndex: number): boolean {
    if (!this.showPopularSlots) return false;
    return this.popularHours.includes(hourIndex);
  }

  private updateSelectedCount() {
    this.selectedSlotsCount = this.selectedSlots.size;
  }

  // Quick actions
  setBusinessHours() {
    // Set 9 AM - 6 PM for weekdays
    this.selectedSlots.clear();
    for (let day = 0; day < 5; day++) { // Monday to Friday
      for (let hour = 9; hour < 18; hour++) {
        this.selectedSlots.add(`${day}-${hour}`);
      }
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
        const hour = slot.split('-')[1];
        this.selectedSlots.add(`${day}-${hour}`);
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
      const [dayStr, hourStr] = slotKey.split('-');
      const day = parseInt(dayStr);
      const hour = parseInt(hourStr);
      
      console.log(`🔧 Processing slot: ${slotKey} -> day=${day}, hour=${hour}`);
      
      if (!dayGroups.has(day)) {
        dayGroups.set(day, []);
      }
      dayGroups.get(day)!.push(hour);
    });
    
    // Convert each day's hours to blocks
    dayGroups.forEach((hours, day) => {
      hours.sort((a, b) => a - b);
      
      let startHour = hours[0];
      let endHour = hours[0] + 1;
      
      for (let i = 1; i < hours.length; i++) {
        if (hours[i] === endHour) {
          endHour++;
        } else {
          // Save current block and start new one
          const block = {
            id: `${day}-${startHour}-${endHour}`,
            day: day,
            startTime: `${startHour.toString().padStart(2, '0')}:00`,
            endTime: `${endHour.toString().padStart(2, '0')}:00`,
            type: 'available',
            title: 'Available',
            color: '#007bff'
          };
          console.log(`🔧 Created block:`, block);
          blocks.push(block);
          
          startHour = hours[i];
          endHour = hours[i] + 1;
        }
      }
      
      // Save the last block
      const lastBlock = {
        id: `${day}-${startHour}-${endHour}`,
        day: day,
        startTime: `${startHour.toString().padStart(2, '0')}:00`,
        endTime: `${endHour.toString().padStart(2, '0')}:00`,
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