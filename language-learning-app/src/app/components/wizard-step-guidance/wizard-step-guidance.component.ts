import { Component, Input, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { WizardGuidanceItem } from '../../shared/models/wizard-step-guidance.model';

@Component({
  selector: 'app-wizard-step-guidance',
  templateUrl: './wizard-step-guidance.component.html',
  styleUrls: ['./wizard-step-guidance.component.scss'],
  standalone: false,
  animations: [
    trigger('guidanceSlideUp', [
      transition(
        (from, to) => {
          const nextStep = Number(to);
          const prevStep = Number(from);
          return nextStep >= 2 && nextStep !== prevStep;
        },
        [
          style({ opacity: 0, transform: 'translateY(10px)' }),
          animate(
            '320ms cubic-bezier(0.32, 0.72, 0, 1)',
            style({ opacity: 1, transform: 'translateY(0)' })
          ),
        ]
      ),
    ]),
  ],
})
export class WizardStepGuidanceComponent implements OnInit, OnDestroy {
  @Input() greetingKey = '';
  @Input() titleKey = '';
  @Input() descKey = '';
  @Input() items: WizardGuidanceItem[] = [];
  @Input() stepNumber = 1;

  private langChangeSub?: Subscription;

  constructor(
    private translate: TranslateService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.langChangeSub = this.translate.onLangChange.subscribe(() => {
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.langChangeSub?.unsubscribe();
  }
}
