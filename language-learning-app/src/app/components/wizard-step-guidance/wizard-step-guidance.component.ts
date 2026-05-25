import { Component, Input } from '@angular/core';
import { WizardGuidanceItem } from '../../shared/models/wizard-step-guidance.model';

@Component({
  selector: 'app-wizard-step-guidance',
  templateUrl: './wizard-step-guidance.component.html',
  styleUrls: ['./wizard-step-guidance.component.scss'],
  standalone: false,
})
export class WizardStepGuidanceComponent {
  @Input() titleKey = '';
  @Input() descKey = '';
  @Input() items: WizardGuidanceItem[] = [];
}
