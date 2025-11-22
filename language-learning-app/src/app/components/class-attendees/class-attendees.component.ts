import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-class-attendees',
  templateUrl: './class-attendees.component.html',
  styleUrls: ['./class-attendees.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class ClassAttendeesComponent {
  @Input() attendees?: any[];
  @Input() capacity?: number;
  @Input() maxDisplay: number = 3; // Max avatars to show before "+X"

  getDisplayedAttendees(): any[] {
    return this.attendees?.slice(0, this.maxDisplay) || [];
  }

  getExtraCount(): number {
    return Math.max(0, (this.attendees?.length || 0) - this.maxDisplay);
  }

  getAttendeeInitials(attendee: any): string {
    if (!attendee) return '?';
    
    const firstName = attendee.firstName || '';
    const lastName = attendee.lastName || '';
    const name = attendee.name || '';
    
    if (firstName && lastName) {
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    }
    
    if (name) {
      const parts = name.split(' ');
      if (parts.length >= 2) {
        return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
      }
      return name.charAt(0).toUpperCase();
    }
    
    return '?';
  }

  getAttendeeName(attendee: any): string {
    if (!attendee) return 'Unknown';
    
    const firstName = attendee.firstName || '';
    const lastName = attendee.lastName || '';
    
    if (firstName && lastName) {
      return `${firstName} ${lastName}`;
    }
    
    return attendee.name || 'Unknown';
  }
}

