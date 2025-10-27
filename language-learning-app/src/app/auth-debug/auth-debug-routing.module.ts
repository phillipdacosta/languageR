import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { AuthDebugPage } from './auth-debug.page';

const routes: Routes = [
  {
    path: '',
    component: AuthDebugPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AuthDebugPageRoutingModule {}

