import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-mobile-this-week',
  templateUrl: './mobile-this-week.component.html',
  styleUrls: ['./mobile-this-week.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  encapsulation: ViewEncapsulation.None
})
export class MobileThisWeekComponent {
  @Input() showNothingYet = true;
  @Input() emptyLabel = '';
  @Input() avatars: { name: string; avatar: string | null; lessonCount: number }[] = [];
  @Input() lessonCount = 0;
  @Input() staggerReady = false;
  @Input() staggerDone = false;
  @Output() thisWeekTap = new EventEmitter<void>();
}
