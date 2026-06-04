import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-paypal-connect-card',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, TranslateModule],
  templateUrl: './paypal-connect-card.component.html',
  styleUrls: ['./payout-connect-card.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class PaypalConnectCardComponent {
  readonly paypalPrivacyPolicyUrl = 'https://www.paypal.com/us/legalhub/privacy-full';

  @Input() connected = false;
  @Input() loading = false;
  @Input() connectDisabled = false;
  @Input() connectedEmail = '';
  @Input() email = '';
  @Input() emailErrorKey = '';
  @Input() emailInputId = 'paypal-connect-email';
  @Input() reasonKey = '';
  @Input() reasonParams: Record<string, string> | null = null;
  @Input() showWizardLegacySummary = false;
  @Input() isUSPersonForTax: boolean | null = null;
  @Input() hasUSBankAccount: boolean | null = null;
  @Input() showSecondaryAction = false;
  @Input() secondaryActionLabelKey = '';
  @Input() compactLayout = false;

  @Output() connectClick = new EventEmitter<void>();
  @Output() emailChange = new EventEmitter<string>();
  @Output() editEmailClick = new EventEmitter<void>();
  @Output() editTaxInfoClick = new EventEmitter<void>();
  @Output() backClick = new EventEmitter<void>();
  @Output() secondaryActionClick = new EventEmitter<void>();

  onEmailInput(value: string): void {
    this.emailChange.emit(value);
  }
}
