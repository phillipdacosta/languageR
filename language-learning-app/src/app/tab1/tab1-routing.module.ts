import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Tab1Page } from './tab1.page';
import { AuthGuard } from '../guards/auth.guard';

const routes: Routes = [
  {
    path: '',
    component: Tab1Page,
  },
  {
    path: 'explore',
    loadComponent: () => import('../explore/explore.page').then(m => m.ExplorePage),
    canActivate: [AuthGuard]
  },
  {
    path: 'explore/:id',
    loadComponent: () => import('../explore-details/explore-details.page').then(m => m.ExploreDetailsPage),
    canActivate: [AuthGuard]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class Tab1PageRoutingModule {}
