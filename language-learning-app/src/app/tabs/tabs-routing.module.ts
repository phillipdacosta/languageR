import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

const routes: Routes = [
  {
    path: '',
    component: TabsPage,
    children: [
      {
        path: 'home',
        loadChildren: () => import('../tab1/tab1.module').then(m => m.Tab1PageModule)
      },
      {
        path: 'tutor-search',
        loadChildren: () => import('../tutor-search-content/tutor-search-content.module').then(m => m.TutorSearchContentPageModule)
      },
      {
        path: 'tutor-calendar',
        loadChildren: () => import('../tutor-calendar/tutor-calendar.module').then(m => m.TutorCalendarPageModule)
      },
      {
        path: 'progress',
        loadChildren: () => import('../tab3/tab3.module').then(m => m.Tab3PageModule)
      },
      {
        path: 'profile',
        loadChildren: () => import('../profile/profile.module').then(m => m.ProfilePageModule)
      },
      {
        path: 'availability-setup',
        loadComponent: () => import('../pages/availability-setup/availability-setup.page').then(m => m.AvailabilitySetupPage)
      },
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full'
      }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
})
export class TabsPageRoutingModule {}
