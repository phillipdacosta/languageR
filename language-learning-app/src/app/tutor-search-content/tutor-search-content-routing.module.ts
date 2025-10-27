import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { TutorSearchContentPage } from './tutor-search-content.page';

const routes: Routes = [
  {
    path: '',
    component: TutorSearchContentPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TutorSearchContentPageRoutingModule {}
