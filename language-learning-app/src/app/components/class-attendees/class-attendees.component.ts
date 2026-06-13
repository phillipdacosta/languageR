import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { Router } from '@angular/router';
import { ClassGoingMessageModalComponent } from '../class-going-message-modal/class-going-message-modal.component';

@Component({
  selector: 'app-class-attendees',
  templateUrl: './class-attendees.component.html',
  styleUrls: ['./class-attendees.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, ClassGoingMessageModalComponent],
})
export class ClassAttendeesComponent {
  @Input() attendees?: any[];
  @Input() capacity?: number;
  @Input() maxDisplay: number = 3; // Max avatars to show before "+X"
  @Input() showLabel = true;
  @Input() showCapacity = true;
  /** Single recipient (student → tutor). */
  @Input() receiverId = '';
  /** Multiple recipients (tutor → all participants). */
  @Input() receiverIds: string[] = [];
  @Input() className = '';
  /**
   * Optional class anchor — forwarded to the message modal so the group
   * thread routes to the stable class-broadcast conversation instead of a
   * hash-keyed ad-hoc one.
   */
  @Input() classId = '';
  /** When true, clicking the row opens the broadcast/message modal.
   * Defaults to `false` so unrelated usages (home, calendar tiles) don't
   * spawn an empty modal — only callers that wire `receiverId`/`receiverIds`
   * explicitly opt in (e.g. class detail page).
   */
  @Input() clickable = false;

  constructor(
    private readonly modalController: ModalController,
    private readonly router: Router,
  ) {}
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
  async openAttendeesModal(ev?: Event): Promise<void> {
    if (!this.clickable) return;
    ev?.stopPropagation();

    const rid = (this.receiverId || '').trim();
    const rids = this.resolveAttendeeIds();

    try {
      const modal = await this.modalController.create({
        component: ClassGoingMessageModalComponent,
        componentProps: {
          attendees: this.attendees ?? [],
          receiverId: rid,
          receiverIds: rids,
          className: this.className || '',
          classId: this.classId || '',
        },
        cssClass: 'class-going-message-modal',
      });
      await modal.present();
      const { data } = await modal.onDidDismiss();
      if (data?.sent) {
        if (data?.kind === 'group' && data?.groupId) {
          await this.router.navigate(['/tabs/messages'], { queryParams: { groupId: data.groupId } });
        } else if (data?.kind === 'direct' && data?.userId) {
          await this.router.navigate(['/tabs/messages'], { queryParams: { userId: data.userId } });
        } else {
          await this.router.navigate(['/tabs/messages']);
        }
      }
    } catch (err) {
      console.error('[ClassAttendees] modal create/present failed', err);
    }
  }

  private resolveAttendeeIds(): string[] {
    const explicit = Array.isArray(this.receiverIds) ? this.receiverIds : [];
    if (explicit.length > 0) {
      return Array.from(new Set(explicit.map((id) => (id || '').trim()).filter(Boolean)));
    }
    const fromAttendees = (this.attendees || [])
      .map((a: any) => {
        // Prefer explicit auth0Id (used by seeded mock previews), then fall
        // back to Mongo `_id`/`id`. Backend resolver handles both shapes.
        const v = a?.auth0Id ?? a?._id ?? a?.id;
        if (v == null) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'object' && typeof v.$oid === 'string') return v.$oid;
        return typeof v.toString === 'function' ? String(v) : '';
      })
      .filter((id: string) => id && id !== '[object Object]');
    return Array.from(new Set(fromAttendees));
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

