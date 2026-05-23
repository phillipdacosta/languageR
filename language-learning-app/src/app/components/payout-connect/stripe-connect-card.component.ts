import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-stripe-connect-card',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  templateUrl: './stripe-connect-card.component.html',
  styleUrls: ['./payout-connect-card.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class StripeConnectCardComponent {
  readonly stripePrivacyPolicyUrl = 'https://stripe.com/privacy';

  @Input() connected = false;
  @Input() loading = false;
  @Input() connectDisabled = false;
  @Input() showWizardLegacySummary = false;
  @Input() isUSPersonForTax: boolean | null = null;
  @Input() hasUSBankAccount: boolean | null = null;
  @Input() showSecondaryAction = false;
  @Input() secondaryActionLabelKey = '';

  @Output() connectClick = new EventEmitter<void>();
  @Output() editTaxInfoClick = new EventEmitter<void>();
  @Output() backClick = new EventEmitter<void>();
  @Output() secondaryActionClick = new EventEmitter<void>();
}
