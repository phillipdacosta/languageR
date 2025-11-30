import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { TermsPrivacyPage } from './terms-privacy.page';

const routes: Routes = [
  {
    path: '',
    component: TermsPrivacyPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TermsPrivacyPageRoutingModule {}
