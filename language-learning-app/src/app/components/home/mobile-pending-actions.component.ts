import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-mobile-pending-actions',
  templateUrl: './mobile-pending-actions.component.html',
  styleUrls: ['./mobile-pending-actions.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  encapsulation: ViewEncapsulation.None
})
export class MobilePendingActionsComponent {
  @Input() pendingActionItems: any[] = [];
  @Input() staggerReady = false;
  @Input() staggerDone = false;
  @Output() openFeedback = new EventEmitter<{ lessonId: string; feedbackId: string }>();
  @Output() showReschedule = new EventEmitter<any>();

  onItemClick(item: any) {
    if (item.type === 'feedback') {
      this.openFeedback.emit({ lessonId: item.lessonId, feedbackId: item.feedbackId });
    } else {
      this.showReschedule.emit(item.lesson);
    }
  }
}
