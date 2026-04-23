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
  @Output() navigateToExplore = new EventEmitter<void>();
  @Output() navigateToCreateMaterial = new EventEmitter<MouseEvent>();
  @Output() navigateToForum = new EventEmitter<void>();
}
