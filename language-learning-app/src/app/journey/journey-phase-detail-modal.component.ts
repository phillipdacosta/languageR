import { Component, Input, ViewEncapsulation, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

/** Phase detail card presented via ModalController (avoids inline-panel clipping). */
@Component({
  selector: 'app-journey-phase-detail-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, TranslateModule],
  templateUrl: './journey-phase-detail-modal.component.html',
  styleUrls: ['./journey.page.scss'],
  encapsulation: ViewEncapsulation.None
})
export class JourneyPhaseDetailModalComponent {
  @Input({ required: true }) host!: any;
  @Input({ required: true }) selectedRow!: any;

  constructor(private cdr: ChangeDetectorRef) {}

  markForCheck() {
    this.cdr.markForCheck();
  }
}
