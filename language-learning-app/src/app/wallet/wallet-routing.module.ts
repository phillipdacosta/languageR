import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { WalletPage } from './wallet.page';
import { StudentOnlyGuard } from '../guards/student-only.guard';

const routes: Routes = [
  {
    path: '',
    component: WalletPage,
    canActivate: [StudentOnlyGuard] // Only students can access wallet
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class WalletPageRoutingModule {}
