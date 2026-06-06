import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { trigger, transition, style, animate } from '@angular/animations';
import { MessagePreviewPayload, MessagePreviewService } from '../../services/message-preview.service';

@Component({
  selector: 'app-message-preview-toast',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  templateUrl: './message-preview-toast.component.html',
  styleUrls: ['./message-preview-toast.component.scss'],
  animations: [
    trigger('previewAnim', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(calc(100% + 20px))' }),
        animate('340ms cubic-bezier(0.22, 1, 0.36, 1)', style({ opacity: 1, transform: 'translateX(0)' })),
      ]),
      transition(':leave', [
        animate('260ms cubic-bezier(0.4, 0, 1, 1)', style({ opacity: 0, transform: 'translateX(calc(100% + 20px))' })),
      ]),
    ]),
  ],
})
export class MessagePreviewToastComponent implements OnInit, OnDestroy {
  preview: MessagePreviewPayload | null = null;
  private readonly destroy$ = new Subject<void>();

  constructor(private readonly messagePreviewService: MessagePreviewService) {}

  ngOnInit(): void {
    this.messagePreviewService.preview$
      .pipe(takeUntil(this.destroy$))
      .subscribe(preview => {
        this.preview = preview;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onPreviewClick(): void {
    if (!this.preview) return;
    void this.messagePreviewService.openPreviewConversation(this.preview);
  }

  onDismiss(event: Event): void {
    event.stopPropagation();
    this.messagePreviewService.dismissPreview();
  }
}
