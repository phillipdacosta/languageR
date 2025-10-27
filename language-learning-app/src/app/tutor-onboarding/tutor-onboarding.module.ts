import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { TutorOnboardingPageRoutingModule } from './tutor-onboarding-routing.module';

import { TutorOnboardingPage } from './tutor-onboarding.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TutorOnboardingPageRoutingModule
  ],
  declarations: [TutorOnboardingPage]
})
export class TutorOnboardingPageModule {}
