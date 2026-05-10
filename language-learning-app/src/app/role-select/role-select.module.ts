import { NgModule, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

import { RoleSelectRoutingModule } from './role-select-routing.module';
import { RoleSelectPage } from './role-select.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslateModule,
    RoleSelectRoutingModule
  ],
  declarations: [RoleSelectPage],
  schemas: [CUSTOM_ELEMENTS_SCHEMA]
})
export class RoleSelectPageModule {}
