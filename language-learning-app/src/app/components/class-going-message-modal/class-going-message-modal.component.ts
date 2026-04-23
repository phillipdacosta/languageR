import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { MessagingService } from '../../services/messaging.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-class-going-message-modal',
  templateUrl: './class-going-message-modal.component.html',
  styleUrls: ['./class-going-message-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, TranslateModule],
})
export class ClassGoingMessageModalComponent implements OnInit, OnChanges {
  @Input() attendees: any[] = [];
  /** Single recipient (student → tutor case). */
  @Input() receiverId = '';
  /** Multiple recipients (tutor → all participants). Takes precedence over `receiverId` when populated. */
  @Input() receiverIds: string[] = [];
  @Input() className = '';
  /**
   * When provided, the group thread is anchored to this class (stable
   * `groupId = grp_class_<classId>`) and the backend manages membership
   * from the class roster. Without it, we fall back to hash-keyed ad-hoc
   * groups — that path still works for non-class contexts.
   */
  @Input() classId = '';
  @Input() minChars = 20;
  @Input() maxChars = 2000;

  messageText = '';
  messageCharCount = 0;
  canSendMessage = false;
  sending = false;
  attendeeDisplays: { imageUrl: string | null; initials: string }[] = [];
  extraAttendeeCount = 0;
  hasRecipients = false;

  constructor(
    private readonly modalController: ModalController,
    private readonly messagingService: MessagingService,
    private readonly toastController: ToastController,
  ) {}

  ngOnInit(): void {
    this.rebuildAttendeeRow();
    this.onMessageTextChange();
  }

  dismiss(): void {
    this.modalController.dismiss();
  }

  onMessageTextChange(): void {
    this.messageCharCount = this.messageText.length;
    const recipientCount = this.resolveRecipientIds().length;
    this.hasRecipients = recipientCount > 0;
    this.canSendMessage =
      this.messageCharCount >= this.minChars &&
      this.messageCharCount <= this.maxChars &&
      this.hasRecipients &&
      !this.sending;
  }

  private resolveRecipientIds(): string[] {
    const list = Array.isArray(this.receiverIds) ? this.receiverIds : [];
    const deduped = Array.from(
      new Set(list.map((id) => (id || '').trim()).filter(Boolean))
    );
    if (deduped.length > 0) return deduped;
    const single = (this.receiverId || '').trim();
    return single ? [single] : [];
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.rebuildAttendeeRow();
    this.onMessageTextChange();
  }

  private rebuildAttendeeRow(): void {
    const list = this.attendees || [];
    this.extraAttendeeCount = Math.max(0, list.length - 5);
    this.attendeeDisplays = list.slice(0, 5).map((a) => ({
      imageUrl: a?.picture || a?.profilePicture || null,
      initials: this.computeInitials(a),
    }));
  }

  private computeInitials(attendee: any): string {
    if (!attendee) return '?';
    const firstName = attendee.firstName || '';
    const lastName = attendee.lastName || '';
    const name = attendee.name || '';
    if (firstName && lastName) {
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    }
    if (name) {
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
      }
      return name.slice(0, 2).toUpperCase();
    }
    return '?';
  }

  async send(): Promise<void> {
    this.onMessageTextChange();
    if (!this.canSendMessage) return;
    const recipients = this.resolveRecipientIds();
    if (recipients.length === 0) return;
    this.sending = true;
    this.onMessageTextChange();
    const body = this.messageText.trim();
    try {
      if (recipients.length === 1) {
        // 1:1 DM — keep the existing direct-conversation path.
        await firstValueFrom(this.messagingService.sendMessage(recipients[0], body, 'text'));
        await this.modalController.dismiss({
          sent: true,
          kind: 'direct',
          total: 1,
          succeededIds: recipients,
          userId: recipients[0],
        });
        return;
      }

      // Multi-recipient — create/get the class-anchored thread (or fall back
      // to an ad-hoc one if no classId). Backend is authoritative for the
      // class-broadcast membership; participantIds here are a hint only.
      const groupResp = await firstValueFrom(
        this.messagingService.createOrGetGroup(
          recipients,
          this.className || '',
          this.classId || undefined
        )
      );
      if (!groupResp?.groupId) {
        throw new Error('Could not resolve groupId');
      }

      await firstValueFrom(
        this.messagingService.sendGroupMessage(groupResp.groupId, body, {
          participantIds: groupResp.participantIds,
          name: this.className || groupResp.name || '',
        })
      );

      await this.modalController.dismiss({
        sent: true,
        kind: 'group',
        total: groupResp.participants.length,
        groupId: groupResp.groupId,
        participantIds: groupResp.participantIds,
        alreadyExists: groupResp.alreadyExists,
      });
    } catch {
      const t = await this.toastController.create({
        message: 'Could not send message. Try again.',
        duration: 2500,
        color: 'danger',
        position: 'bottom',
      });
      await t.present();
    } finally {
      this.sending = false;
      this.onMessageTextChange();
    }
  }
}
