import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { VideoUploadComponent } from '../components/video-upload/video-upload.component';
import { VideoThumbnailComponent } from '../components/video-thumbnail/video-thumbnail.component';
import { FlagIconComponent } from '../components/flag-icon/flag-icon.component';
import { CountrySelectModalComponent } from '../components/country-select-modal/country-select-modal.component';
import { SafeUrlPipe } from './pipes/safe-url.pipe';
import { DisplayNamePipe } from './pipes/display-name.pipe';

@NgModule({
  declarations: [
    VideoUploadComponent,
    VideoThumbnailComponent,
    FlagIconComponent,
    CountrySelectModalComponent,
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
    SafeUrlPipe,
    DisplayNamePipe,
    TranslateModule
  ]
})
export class SharedModule { }

