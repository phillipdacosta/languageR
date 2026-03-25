import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

import { PreCallPageRoutingModule } from './pre-call-routing.module';

import { PreCallPage } from './pre-call.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PreCallPageRoutingModule,
    TranslateModule
  ],
  declarations: [PreCallPage]
})
export class PreCallPageModule {}

