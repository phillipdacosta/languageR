import { Component, OnInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-block-time',
  templateUrl: './block-time.component.html',
  styleUrls: ['./block-time.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class BlockTimeComponent implements OnInit {
  @Input() date!: Date;
  @Input() startTime?: Date;
  @Input() endTime?: Date;
  @Input() durationMinutes?: number;

  reason: string = '';
  title: string = 'Time Off';
  selectedStartTime: string = '';
  selectedEndTime: string = '';
  isLoading = false;

  reasonOptions = [
    { value: 'personal', label: 'Personal Time' },
    { value: 'appointment', label: 'Appointment' },
    { value: 'vacation', label: 'Vacation' },
    { value: 'sick', label: 'Sick Day' },
    { value: 'holiday', label: 'Holiday' },
    { value: 'other', label: 'Other' }
  ];

  constructor(
    private modalController: ModalController,
    private userService: UserService,
    private toastController: ToastController
  ) {}

  ngOnInit() {
    // Set default time range if provided
    if (this.startTime) {
      this.selectedStartTime = this.formatTimeForInput(this.startTime);
    } else {
      this.selectedStartTime = '09:00';
    }

    if (this.endTime) {
      this.selectedEndTime = this.formatTimeForInput(this.endTime);
    } else if (this.startTime && this.durationMinutes) {
      const end = new Date(this.startTime.getTime() + this.durationMinutes * 60000);
      this.selectedEndTime = this.formatTimeForInput(end);
    } else {
      this.selectedEndTime = '10:00';
    }
  }

  formatTimeForInput(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  formatDateString(date: Date): string {
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  dismiss() {
    this.modalController.dismiss();
  }

  async blockTime() {
    if (!this.reason) {
      const toast = await this.toastController.create({
        message: 'Please select a reason',
        duration: 2000,
        color: 'warning'
      });
      toast.present();
      return;
    }

    this.isLoading = true;

    try {
      // Get current availability
      const currentAvailability = await this.userService.getAvailability().toPromise();
      const availabilityBlocks = currentAvailability?.availability || [];

      // Create the time-off block
      const dayOfWeek = this.date.getDay(); // 0 = Sunday, 1 = Monday, etc.
      
      const timeOffBlock = {
        id: `timeoff-${Date.now()}`,
        day: dayOfWeek,
        startTime: this.selectedStartTime,
        endTime: this.selectedEndTime,
        type: 'unavailable',
        title: this.title || 'Time Off',
        color: '#f59e0b', // Orange color for time off
        absoluteStart: this.getAbsoluteDateTime(this.date, this.selectedStartTime).toISOString(),
        absoluteEnd: this.getAbsoluteDateTime(this.date, this.selectedEndTime).toISOString()
      };

      // Add the new block to existing availability
      const updatedBlocks = [...availabilityBlocks, timeOffBlock];

      // Save to backend
      await this.userService.updateAvailability(updatedBlocks).toPromise();

      const toast = await this.toastController.create({
        message: 'Time blocked successfully',
        duration: 2000,
        color: 'success',
        icon: 'checkmark-circle'
      });
      toast.present();

      // Close modal and pass success
      this.modalController.dismiss({ success: true });
    } catch (error) {
      console.error('Error blocking time:', error);
      const toast = await this.toastController.create({
        message: 'Failed to block time. Please try again.',
        duration: 3000,
        color: 'danger'
      });
      toast.present();
    } finally {
      this.isLoading = false;
    }
  }

  private getAbsoluteDateTime(date: Date, timeString: string): Date {
    const [hours, minutes] = timeString.split(':').map(Number);
    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }
}
