import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

import { CallbackPageRoutingModule } from './callback-routing.module';
import { CallbackPage } from './callback.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    TranslateModule,
    CallbackPageRoutingModule
  ],
  declarations: [CallbackPage]
})
export class CallbackPageModule {}

