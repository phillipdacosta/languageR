import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { TutorCalendarPage } from './tutor-calendar.page';

const routes: Routes = [
  {
    path: '',
    component: TutorCalendarPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TutorCalendarPageRoutingModule {}
