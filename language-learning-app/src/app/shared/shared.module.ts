import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { VideoUploadComponent } from '../components/video-upload/video-upload.component';
import { VideoThumbnailComponent } from '../components/video-thumbnail/video-thumbnail.component';
import { FlagIconComponent } from '../components/flag-icon/flag-icon.component';
import { CountrySelectModalComponent } from '../components/country-select-modal/country-select-modal.component';
import { PaymentDisputeModalComponent } from '../components/payment-dispute-modal/payment-dispute-modal.component';
import { SafeUrlPipe } from './pipes/safe-url.pipe';
import { DisplayNamePipe } from './pipes/display-name.pipe';
import { WizardStepGuidanceComponent } from '../components/wizard-step-guidance/wizard-step-guidance.component';

@NgModule({
  declarations: [
    VideoUploadComponent,
    VideoThumbnailComponent,
    FlagIconComponent,
    CountrySelectModalComponent,
    PaymentDisputeModalComponent,
    WizardStepGuidanceComponent,
    SafeUrlPipe,
    DisplayNamePipe
  ],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslateModule
  ],
  exports: [
    VideoUploadComponent,
    VideoThumbnailComponent,
    FlagIconComponent,
    CountrySelectModalComponent,
    PaymentDisputeModalComponent,
    WizardStepGuidanceComponent,
    SafeUrlPipe,
    DisplayNamePipe,
    TranslateModule
  ]
})
export class SharedModule { }

