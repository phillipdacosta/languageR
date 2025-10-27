import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { DebugPermissionsPageRoutingModule } from './debug-permissions-routing.module';
import { DebugPermissionsPage } from './debug-permissions.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    DebugPermissionsPageRoutingModule
  ],
  declarations: [DebugPermissionsPage]
})
export class DebugPermissionsPageModule {}

