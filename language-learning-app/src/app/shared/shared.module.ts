import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { VideoUploadComponent } from '../components/video-upload/video-upload.component';
import { FlagIconComponent } from '../components/flag-icon/flag-icon.component';
import { CountrySelectModalComponent } from '../components/country-select-modal/country-select-modal.component';
import { SafeUrlPipe } from './pipes/safe-url.pipe';
import { DisplayNamePipe } from './pipes/display-name.pipe';

@NgModule({
  declarations: [
    VideoUploadComponent,
    FlagIconComponent,
    CountrySelectModalComponent,
    SafeUrlPipe,
    DisplayNamePipe
  ],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule
  ],
  exports: [
    VideoUploadComponent,
    FlagIconComponent,
    CountrySelectModalComponent,
    SafeUrlPipe,
    DisplayNamePipe
  ]
})
export class SharedModule { }

