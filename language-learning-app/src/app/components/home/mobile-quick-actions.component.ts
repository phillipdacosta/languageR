import { Component, Input, Output, EventEmitter, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-mobile-quick-actions',
  templateUrl: './mobile-quick-actions.component.html',
  styleUrls: ['./mobile-quick-actions.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  encapsulation: ViewEncapsulation.None
})
export class MobileQuickActionsComponent {
  @Input() quickActionsReady = false;
  @Input() quickActionsAnimated = false;
  @Input() staggerReady = false;
  @Input() staggerDone = false;
  @Input() isDarkModeActive = false;
  /** Tutors only — students get Practice in this slot instead. */
  @Input() showCreateMaterial = true;
  @Input() isTutorUser = false;
  /** Student-only — opens spaced-repetition deck. */
  @Input() showPractice = false;
  /** Live count of cards due for review. 0 = no badge. */
  @Input() practiceDueCount = 0;
  @Output() navigateToExplore = new EventEmitter<void>();
  @Output() navigateToCreateMaterial = new EventEmitter<MouseEvent>();
  @Output() navigateToForum = new EventEmitter<void>();
  @Output() navigateToPractice = new EventEmitter<void>();
}
