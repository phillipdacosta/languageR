import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { PopoverController } from '@ionic/angular';
import { MessageSettingsService } from '../../services/message-settings.service';

@Component({
  selector: 'app-messages-settings-popover',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  template: `
    <div class="messages-settings-popover">
      <div class="messages-settings-section">
        <div class="messages-settings-toggle-row">
          <div>
            <p class="messages-settings-label">{{ 'MESSAGES.SETTINGS_PREVIEW_LABEL' | translate }}</p>
            <p class="messages-settings-hint">{{ 'MESSAGES.SETTINGS_PREVIEW_HINT' | translate }}</p>
          </div>
          <ion-toggle
            [checked]="showIncomingPreview"
            (ionChange)="onPreviewToggle($event)"
            aria-label="{{ 'MESSAGES.SETTINGS_PREVIEW_LABEL' | translate }}">
          </ion-toggle>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .messages-settings-popover {
      padding: 8px 0 4px;
      min-width: 280px;
    }

    .messages-settings-section {
      padding: 0 4px;
    }

    .messages-settings-label {
      margin: 0 0 4px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: #717171;
    }

    .messages-settings-hint {
      margin: 0;
      font-size: 12px;
      line-height: 1.4;
      color: #717171;
    }

    .messages-settings-toggle-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 12px 12px;
    }

    :host-context(html.ion-palette-dark) {
      .messages-settings-label,
      .messages-settings-hint {
        color: #8e8e93;
      }
    }
  `],
})
export class MessagesSettingsPopoverComponent {
  showIncomingPreview: boolean;

  constructor(
    private readonly popoverController: PopoverController,
    private readonly messageSettingsService: MessageSettingsService
  ) {
    this.showIncomingPreview = this.messageSettingsService.showIncomingPreview;
  }

  onPreviewToggle(event: CustomEvent): void {
    const enabled = !!(event.detail as { checked?: boolean }).checked;
    this.showIncomingPreview = enabled;
    this.messageSettingsService.setShowIncomingPreview(enabled);
  }
}
