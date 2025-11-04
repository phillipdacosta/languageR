import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { TutorCalendarPage } from './tutor-calendar.page';

const routes: Routes = [
  {
    path: '',
    component: TutorCalendarPage
  },
  {
    path: 'event/:id',
    loadComponent: () => import('./event-details/event-details.page').then(m => m.EventDetailsPage)
  },
  {
    path: 'schedule-class',
    loadComponent: () => import('./schedule-class/schedule-class.page').then(m => m.ScheduleClassPage)
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TutorCalendarPageRoutingModule {}
