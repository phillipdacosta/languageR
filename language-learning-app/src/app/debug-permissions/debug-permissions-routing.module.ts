import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { DebugPermissionsPage } from './debug-permissions.page';

const routes: Routes = [
  {
    path: '',
    component: DebugPermissionsPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class DebugPermissionsPageRoutingModule {}

