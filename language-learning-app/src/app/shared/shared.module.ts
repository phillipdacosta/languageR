import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { VideoUploadComponent } from '../components/video-upload/video-upload.component';
import { FlagIconComponent } from '../components/flag-icon/flag-icon.component';

@NgModule({
  declarations: [
    VideoUploadComponent,
    FlagIconComponent
  ],
  imports: [
    CommonModule,
    IonicModule
  ],
  exports: [
    VideoUploadComponent,
    FlagIconComponent
  ]
})
export class SharedModule { }

