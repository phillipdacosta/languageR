import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

import { AuthDebugPageRoutingModule } from './auth-debug-routing.module';
import { AuthDebugPage } from './auth-debug.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    AuthDebugPageRoutingModule
  ],
  declarations: [AuthDebugPage]
})
export class AuthDebugPageModule {}

