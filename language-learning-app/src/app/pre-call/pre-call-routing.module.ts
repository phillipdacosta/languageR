import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { PreCallPage } from './pre-call.page';

const routes: Routes = [
  {
    path: '',
    component: PreCallPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class PreCallPageRoutingModule {}

