import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Message, MessagingService } from './messaging.service';
import { MessageSettingsService } from './message-settings.service';
import { AuthService } from './auth.service';
import { UserService } from './user.service';
import { WebSocketService } from './websocket.service';

export type MessagePreviewKind = 'text' | 'image' | 'voice' | 'file' | 'material';

export interface MessagePreviewPayload {
  /** Unique id, changes on every new batch so @if / *ngIf re-animates */
  id: string;
  /** null when aggregated across multiple conversations */
  conversationId: string | null;
  senderName: string;
  senderPicture?: string | null;
  contextLabel?: string;
  previewText: string;
  previewKind: MessagePreviewKind;
  mediaUrl?: string | null;
  /** How many distinct senders contributed to this batch */
  aggregateCount: number;
  /** Extra sender names when aggregateCount > 1 */
  extraSenders: string[];
}

/** ms to wait before flushing the batch after the first message */
const BATCH_WINDOW_MS = 600;
const PREVIEW_DURATION_MS = 5000;

@Injectable({
  providedIn: 'root',
})
export class MessagePreviewService {
  private readonly destroy$ = new Subject<void>();
  private readonly previewSubject = new BehaviorSubject<MessagePreviewPayload | null>(null);
  readonly preview$ = this.previewSubject.asObservable();

  private initialized = false;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Messages collected during the current batch window */
  private pendingBatch: Array<{
    message: Message;
    senderName: string;
    senderPicture: string | null;
    contextLabel?: string;
    previewKind: MessagePreviewKind;
    previewText: string;
    mediaUrl: string | null;
  }> = [];

  private currentUserId = '';
  private messagesPageVisible = false;
  private activeConversationId: string | null = null;

  constructor(
    private readonly websocketService: WebSocketService,
    private readonly messagingService: MessagingService,
    private readonly messageSettingsService: MessageSettingsService,
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly translateService: TranslateService,
    private readonly router: Router,
    private readonly ngZone: NgZone
  ) {
    this.initialize();
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      const email = user?.email || '';
      this.currentUserId = email ? `dev-user-${email}` : user?.sub || '';
    });

    this.userService.currentUser$.pipe(takeUntil(this.destroy$)).subscribe(user => {
      if (!this.currentUserId && user?.auth0Id) {
        this.currentUserId = user.auth0Id;
      }
    });

    this.websocketService.newMessage$.pipe(takeUntil(this.destroy$)).subscribe(message => {
      this.handleIncomingMessage(message);
    });
  }

  setMessagesPageContext(conversationId: string | null, pageVisible: boolean): void {
    this.messagesPageVisible = pageVisible;
    this.activeConversationId = conversationId;
  }

  dismissPreview(): void {
    this.clearDismissTimer();
    this.previewSubject.next(null);
  }

  async openPreviewConversation(preview: MessagePreviewPayload): Promise<void> {
    this.dismissPreview();
    if (preview.conversationId) {
      await this.router.navigate(['/tabs/messages'], {
        queryParams: { conversationId: preview.conversationId },
      });
    } else {
      await this.router.navigate(['/tabs/messages']);
    }
  }

  private handleIncomingMessage(message: Message): void {
    if (!this.messageSettingsService.showIncomingPreview) return;
    if (!this.currentUserId) return;
    if (message.type === 'system' || message.isSystemMessage) return;
    if (this.isMyMessage(message)) return;

    if (
      this.messagesPageVisible &&
      this.activeConversationId &&
      message.conversationId === this.activeConversationId
    ) {
      return;
    }

    const normalizedSenderId = this.normalizeUserId(message.senderId);
    const isGroupMessage = !!(message as Message & { isGroup?: boolean }).isGroup;
    const matched = this.messagingService
      .getCachedConversations()
      .find(c => c.conversationId === message.conversationId);

    const senderName =
      message.sender?.name ||
      matched?.participants?.find(p => this.normalizeUserId(p.auth0Id) === normalizedSenderId)?.name ||
      matched?.otherUser?.name ||
      'Someone';

    const contextLabel = matched?.isGroup || isGroupMessage
      ? matched?.groupName || (message as Message & { groupName?: string }).groupName || 'Group chat'
      : undefined;

    const previewKind = this.resolvePreviewKind(message);
    const previewText = this.getPreviewText(message, previewKind);
    if (!previewText) return;

    const mediaUrl = previewKind === 'image'
      ? (message.thumbnailUrl || message.fileUrl || null)
      : null;

    this.pendingBatch.push({
      message,
      senderName,
      senderPicture:
        message.sender?.picture ||
        matched?.participants?.find(p => this.normalizeUserId(p.auth0Id) === normalizedSenderId)?.picture ||
        matched?.otherUser?.picture ||
        null,
      contextLabel,
      previewKind,
      previewText,
      mediaUrl,
    });

    // Start the batch timer only on the first message in the window
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.flushBatch();
      }, BATCH_WINDOW_MS);
    }
  }

  private flushBatch(): void {
    this.batchTimer = null;
    const batch = this.pendingBatch.slice();
    this.pendingBatch = [];

    if (batch.length === 0) return;

    // Use the first (or only) message as the primary display item
    const first = batch[0];

    // Collect unique sender names (preserving order of first appearance)
    const seenNames = new Set<string>();
    const orderedSenders: string[] = [];
    for (const item of batch) {
      if (!seenNames.has(item.senderName)) {
        seenNames.add(item.senderName);
        orderedSenders.push(item.senderName);
      }
    }

    const aggregateCount = orderedSenders.length;
    const extraSenders = orderedSenders.slice(1);

    // If multiple conversations involved, clear conversationId so click goes to inbox
    const allSameConversation = batch.every(
      b => b.message.conversationId === first.message.conversationId
    );

    const payload: MessagePreviewPayload = {
      id: `preview-${Date.now()}`,
      conversationId: allSameConversation ? first.message.conversationId : null,
      senderName: first.senderName,
      senderPicture: first.senderPicture,
      contextLabel: first.contextLabel,
      previewText: first.previewText,
      previewKind: first.previewKind,
      mediaUrl: first.mediaUrl,
      aggregateCount,
      extraSenders,
    };

    this.ngZone.run(() => {
      this.previewSubject.next(payload);
      this.scheduleDismiss();
    });
  }

  private resolvePreviewKind(message: Message): MessagePreviewKind {
    const type = (message.type || 'text').toLowerCase();
    if (type === 'image' || type === 'voice' || type === 'file' || type === 'material') {
      return type as MessagePreviewKind;
    }
    return 'text';
  }

  private scheduleDismiss(): void {
    this.clearDismissTimer();
    this.dismissTimer = setTimeout(() => {
      this.previewSubject.next(null);
      this.dismissTimer = null;
    }, PREVIEW_DURATION_MS);
  }

  private clearDismissTimer(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }

  private isMyMessage(message: Message): boolean {
    const id = this.currentUserId;
    return (
      message.senderId === id ||
      message.senderId === id.replace('dev-user-', '') ||
      `dev-user-${message.senderId}` === id
    );
  }

  private normalizeUserId(id: string | undefined | null): string {
    if (!id) return '';
    return id.startsWith('dev-user-') ? id.replace('dev-user-', '') : id;
  }

  private getPreviewText(message: Message, kind: MessagePreviewKind): string {
    const caption = (message.content || '').trim();

    if (kind === 'text') return this.truncatePreview(caption);

    if (kind === 'image') {
      return caption || this.translateService.instant('MESSAGES.PREVIEW_PHOTO');
    }
    if (kind === 'file') {
      return caption || message.fileName || this.translateService.instant('MESSAGES.PREVIEW_FILE');
    }
    if (kind === 'voice') {
      if (caption) return caption;
      if (message.duration && message.duration > 0) {
        return this.translateService.instant('MESSAGES.VOICE_NOTE', { duration: message.duration });
      }
      return this.translateService.instant('MESSAGES.PREVIEW_VOICE');
    }
    if (kind === 'material') {
      return caption || message.material?.title || this.translateService.instant('MESSAGES.PREVIEW_MATERIAL');
    }

    return this.truncatePreview(caption);
  }

  private truncatePreview(text: string, maxLength = 140): string {
    const trimmed = (text || '').trim();
    if (trimmed.length <= maxLength) return trimmed;
    return `${trimmed.slice(0, maxLength - 1)}…`;
  }
}
