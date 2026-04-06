import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Tab1Page } from './tab1.page';
import { AuthGuard } from '../guards/auth.guard';

const routes: Routes = [
  {
    path: '',
    component: Tab1Page,
    children: [
      {
        path: 'material/:id',
        loadComponent: () => import('../material-detail/material-detail.page').then(m => m.MaterialDetailPage),
        data: { embedInHomeMaterialsModal: true }
      },
      {
        path: 'bundle/:id',
        loadComponent: () => import('../bundle-detail/bundle-detail.page').then(m => m.BundleDetailPage),
        data: { embedInHomeMaterialsModal: true }
      }
    ]
  },
  {
    path: 'lessons',
    loadComponent: () => import('../lessons/lessons.page').then(m => m.LessonsPage),
    canActivate: [AuthGuard]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class Tab1PageRoutingModule {}
