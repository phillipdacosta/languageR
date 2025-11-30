import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { TermsPrivacyPageRoutingModule } from './terms-privacy-routing.module';

import { TermsPrivacyPage } from './terms-privacy.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TermsPrivacyPageRoutingModule
  ],
  declarations: [TermsPrivacyPage]
})
export class TermsPrivacyPageModule {}
