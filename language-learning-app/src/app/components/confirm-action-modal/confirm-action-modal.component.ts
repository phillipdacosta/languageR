import { Component, Input, OnInit } from '@angular/core';
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
export class ConfirmActionModalComponent implements OnInit {
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

  constructor(private modalController: ModalController) {}
  
  ngOnInit() {
    console.log('🔍 ConfirmActionModal initialized with:', {
      title: this.title,
      message: this.message,
      notificationMessage: this.notificationMessage,
      participantName: this.participantName,
      participantAvatar: this.participantAvatar,
      icon: this.icon,
      iconColor: this.iconColor
    });
  }

  dismiss() {
    this.modalController.dismiss({ confirmed: false });
  }

  confirm() {
    this.modalController.dismiss({ confirmed: true });
  }
}

