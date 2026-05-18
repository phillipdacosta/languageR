import { NgModule, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { SharedModule } from '../shared/shared.module';
import { SignupLanguagePageRoutingModule } from './signup-language-routing.module';
import { SignupLanguagePage } from './signup-language.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SharedModule,
    SignupLanguagePageRoutingModule,
  ],
  declarations: [SignupLanguagePage],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class SignupLanguagePageModule {}
