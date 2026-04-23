import { Component, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-confirm-action-modal',
  templateUrl: './confirm-action-modal.component.html',
  styleUrls: ['./confirm-action-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class ConfirmActionModalComponent {
  @Input() title!: string;
  @Input() message!: string;
  @Input() notificationMessage?: string; // Separate notification line (e.g., "Jason G. will be notified...")
  @Input() confirmText: string = 'Confirm';
  @Input() cancelText: string = 'Cancel';
  @Input() confirmColor: string = 'primary';
  @Input() icon: string = 'alert-circle';
  @Input() iconColor: string = 'warning';
  @Input() participantName?: string;
  @Input() participantAvatar?: string;
  /** When true, the secondary (outline) button exits cancel-class and opens reschedule instead */
  @Input() secondaryDismissReschedules = false;

  constructor(private modalController: ModalController) {}

  dismiss() {
    this.modalController.dismiss({ confirmed: false });
  }

  /** Secondary row button: optionally signal reschedule instead of plain dismiss */
  secondaryClick() {
    if (this.secondaryDismissReschedules) {
      this.modalController.dismiss({ confirmed: false, rescheduleInstead: true });
    } else {
      this.dismiss();
    }
  }

  confirm() {
    this.modalController.dismiss({ confirmed: true });
  }
}

