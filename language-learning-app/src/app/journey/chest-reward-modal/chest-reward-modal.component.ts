import { Component, Input, OnInit, ChangeDetectionStrategy, ChangeDetectorRef, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { resolveChestFrameUrls, JourneyChestSide } from '../journey-map-assets';

type ChestTier = 'bronze' | 'silver' | 'gold';

/** Treasure-chest reveal — same card shell as the roadblock checkpoint modal. */
@Component({
  selector: 'app-chest-reward-modal',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  templateUrl: './chest-reward-modal.component.html',
  styleUrls: ['../journey.page.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChestRewardModalComponent implements OnInit {
  @Input() tier: ChestTier = 'bronze';
  @Input() xp = 0;
  @Input() totalXp = 0;
  @Input() alreadyClaimed = false;
  @Input() chestSide: JourneyChestSide = 'left';

  chestIconClosed = '';
  chestIconOpen = '';
  revealed = false;
  headerTitle = '';
  tierLabel = '';
  titleText = '';
  totalLabel = '';
  footerLabelKey = 'JOURNEY.CHEST.OPEN';

  constructor(
    private modalCtrl: ModalController,
    private cdr: ChangeDetectorRef,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const frames = resolveChestFrameUrls(this.chestSide);
    this.chestIconClosed = frames[0];
    this.chestIconOpen = frames[1];
    this.headerTitle = this.translate.instant('JOURNEY.CHEST.TITLE');
    this.tierLabel = this.translate.instant(`JOURNEY.CHEST.TIER_${this.tier.toUpperCase()}`);
    this.titleText = this.alreadyClaimed
      ? this.translate.instant('JOURNEY.CHEST.ALREADY_COLLECTED')
      : this.translate.instant('JOURNEY.CHEST.UNLOCKED');
    this.totalLabel = this.translate.instant('JOURNEY.CHEST.TOTAL_XP', { total: this.totalXp });
    if (this.alreadyClaimed) {
      this.revealed = true;
    }
    this.updateFooter();
  }

  onFooterPrimary(): void {
    if (!this.revealed) {
      this.revealed = true;
      this.updateFooter();
      this.cdr.markForCheck();
      return;
    }
    void this.modalCtrl.dismiss(null, 'done');
  }

  private updateFooter(): void {
    this.footerLabelKey = this.revealed ? 'JOURNEY.CHEST.AWESOME' : 'JOURNEY.CHEST.OPEN';
  }
}
