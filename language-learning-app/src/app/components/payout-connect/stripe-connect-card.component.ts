import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { buildStripeActionDetailText } from '../../utils/stripe-requirements.util';

@Component({
  selector: 'app-stripe-connect-card',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  templateUrl: './stripe-connect-card.component.html',
  styleUrls: ['./payout-connect-card.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class StripeConnectCardComponent implements OnChanges {
  readonly stripePrivacyPolicyUrl = 'https://stripe.com/privacy';

  @Input() connected = false;
  @Input() pendingReview = false;
  @Input() actionRequired = false;
  @Input() stripeRequirementsCurrentlyDue: string[] = [];
  @Input() loading = false;
  @Input() connectDisabled = false;
  @Input() showWizardLegacySummary = false;
  @Input() showLegacyEdit = true;
  @Input() showLegacyBack = true;
  @Input() isUSPersonForTax: boolean | null = null;
  @Input() hasUSBankAccount: boolean | null = null;
  @Input() showSecondaryAction = false;
  @Input() secondaryActionLabelKey = '';
  @Input() compactLayout = false;
  @Input() connectedHeroLayout = false;

  @Output() connectClick = new EventEmitter<void>();
  @Output() editTaxInfoClick = new EventEmitter<void>();
  @Output() backClick = new EventEmitter<void>();
  @Output() secondaryActionClick = new EventEmitter<void>();

  actionRequiredDetailText = '';

  constructor(private translate: TranslateService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['actionRequired'] || changes['stripeRequirementsCurrentlyDue']) {
      this.syncActionRequiredDetailText();
    }
  }

  private syncActionRequiredDetailText(): void {
    if (!this.actionRequired) {
      this.actionRequiredDetailText = '';
      return;
    }
    this.actionRequiredDetailText = buildStripeActionDetailText(
      this.translate,
      this.stripeRequirementsCurrentlyDue
    );
  }
}
