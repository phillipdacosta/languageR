import { Component, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';

@Component({
  selector: 'app-message-context-menu',
  template: `
    <div class="context-menu-backdrop" (click)="dismiss()">
      <div class="context-menu-container" 
           [style.top.px]="position.top" 
           [style.left.px]="position.left"
           [class.show-below]="position.showBelow"
           (click)="$event.stopPropagation()">
        
        <!-- Pointer Arrow -->
        <div class="menu-arrow" 
             [style.left.px]="position.arrowOffset"
             [class.arrow-above]="!position.showBelow"></div>
        
        <!-- Quick Emoji Reactions -->
        <div class="emoji-reactions" *ngIf="!isMyMessage">
          <button class="emoji-btn" *ngFor="let emoji of quickEmojis" (click)="onEmojiSelect(emoji)">
            {{ emoji }}
          </button>
        </div>

        <!-- Action Menu -->
        <div class="action-menu">
          <button class="action-item" (click)="onAction('reply')">
            <ion-icon name="arrow-undo-outline"></ion-icon>
            <span>Reply</span>
          </button>
          
          <button class="action-item" *ngIf="messageType === 'text'" (click)="onAction('copy')">
            <ion-icon name="copy-outline"></ion-icon>
            <span>Copy</span>
          </button>
          
          <button class="action-item" (click)="onAction('forward')">
            <ion-icon name="arrow-redo-outline"></ion-icon>
            <span>Forward</span>
          </button>
          
          <button class="action-item" *ngIf="isMyMessage" (click)="onAction('delete')">
            <ion-icon name="trash-outline" color="danger"></ion-icon>
            <span class="text-danger">Delete</span>
          </button>
          
          <button class="action-item" (click)="onAction('more')">
            <ion-icon name="ellipsis-horizontal"></ion-icon>
            <span>More...</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .context-menu-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: transparent;
      z-index: 10000;
      display: flex;
      align-items: flex-start;
      justify-content: center;
    }

    .context-menu-container {
      position: absolute;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
                  0 2px 8px rgba(0, 0, 0, 0.08);
      overflow: hidden;
      width: 260px;
      animation: menuSlideIn 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      transform-origin: top center;
    }

    .context-menu-container.show-below {
      transform-origin: bottom center;
    }

    .menu-arrow {
      position: absolute;
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-bottom: 10px solid rgba(247, 247, 247, 0.9);
      top: -10px;
      z-index: 1;
    }

    .menu-arrow.arrow-above {
      top: auto;
      bottom: -10px;
      border-bottom: none;
      border-top: 10px solid rgba(255, 255, 255, 0.95);
    }

    @keyframes menuSlideIn {
      from {
        opacity: 0;
        transform: scale(0.9) translateY(-8px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    .emoji-reactions {
      display: flex;
      justify-content: space-around;
      padding: 12px 8px;
      background: rgba(247, 247, 247, 0.9);
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
    }

    .emoji-btn {
      background: transparent;
      border: none;
      font-size: 28px;
      padding: 6px 8px;
      cursor: pointer;
      transition: transform 0.15s ease;
      border-radius: 8px;
    }

    .emoji-btn:hover {
      transform: scale(1.2);
      background: rgba(0, 0, 0, 0.05);
    }

    .emoji-btn:active {
      transform: scale(1.1);
    }

    .action-menu {
      padding: 6px 0;
    }

    .action-item {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 16px;
      color: #1c1c1e;
      transition: background 0.15s ease;
      border-bottom: 1px solid rgba(0, 0, 0, 0.04);
    }

    .action-item:last-child {
      border-bottom: none;
    }

    .action-item:hover {
      background: rgba(0, 0, 0, 0.05);
    }

    .action-item:active {
      background: rgba(0, 0, 0, 0.1);
    }

    .action-item ion-icon {
      font-size: 20px;
      color: #007aff;
    }

    .action-item span {
      flex: 1;
      text-align: left;
      font-weight: 400;
    }

    .text-danger {
      color: #ff3b30;
    }

    .action-item ion-icon[color="danger"] {
      color: #ff3b30;
    }
  `],
  standalone: false
})
export class MessageContextMenuComponent {
  @Input() position: { top: number; left: number; showBelow: boolean; arrowOffset: number } = { 
    top: 0, 
    left: 0, 
    showBelow: false,
    arrowOffset: 130
  };
  @Input() isMyMessage: boolean = false;
  @Input() messageType: string = 'text';
  @Input() messageContent: string = '';

  quickEmojis = ['❤️', '👍', '👎', '😂', '‼️', '❓', '🤔'];

  constructor(private modalController: ModalController) {}

  dismiss(action?: string, data?: any) {
    this.modalController.dismiss({ action, data });
  }

  onEmojiSelect(emoji: string) {
    this.dismiss('emoji', { emoji });
  }

  onAction(action: string) {
    if (action === 'copy') {
      // Copy to clipboard
      navigator.clipboard?.writeText(this.messageContent);
    }
    this.dismiss(action);
  }
}

