import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { ReviewDeckPage } from './review-deck.page';

const routes: Routes = [
  {
    path: '',
    component: ReviewDeckPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ReviewDeckPageRoutingModule {}








