import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { ProfilePageRoutingModule } from './profile-routing.module';
import { ProfilePage } from './profile.page';
import { SharedModule } from '../shared/shared.module';
import { PicturePreviewModalComponent } from '../components/picture-preview-modal/picture-preview-modal.component';
import { InterfaceLanguageSelectModalComponent } from '../components/interface-language-select-modal/interface-language-select-modal.component';
import { LanguagePlanManageModalComponent } from '../components/language-plan-manage-modal/language-plan-manage-modal.component';
import { SafeUrlPipe } from '../pipes/safe-url.pipe';
import { TutorOnboardingComponent } from '../components/tutor-onboarding/tutor-onboarding.component';
import { StripeConnectCardComponent } from '../components/payout-connect/stripe-connect-card.component';
import { PaypalConnectCardComponent } from '../components/payout-connect/paypal-connect-card.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ProfilePageRoutingModule,
    SharedModule,
    InterfaceLanguageSelectModalComponent,
    LanguagePlanManageModalComponent,
    TutorOnboardingComponent,
    StripeConnectCardComponent,
    PaypalConnectCardComponent
  ],
  declarations: [
    ProfilePage,
    PicturePreviewModalComponent,
    SafeUrlPipe
  ]
})
export class ProfilePageModule {}
