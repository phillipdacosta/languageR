import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { TutorSearchPage } from './tutor-search.page';

const routes: Routes = [
  {
    path: '',
    component: TutorSearchPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TutorSearchPageRoutingModule {}
