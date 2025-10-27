import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { TutorOnboardingPage } from './tutor-onboarding.page';

const routes: Routes = [
  {
    path: '',
    component: TutorOnboardingPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TutorOnboardingPageRoutingModule {}
