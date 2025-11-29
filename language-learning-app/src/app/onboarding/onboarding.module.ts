import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { OnboardingPageRoutingModule } from './onboarding-routing.module';
import { OnboardingPage } from './onboarding.page';
import { SharedModule } from '../shared/shared.module';
import { CountrySelectModalComponent } from '../tutor-onboarding/country-select-modal.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    OnboardingPageRoutingModule,
    SharedModule
  ],
  declarations: [OnboardingPage, CountrySelectModalComponent]
})
export class OnboardingPageModule {}
