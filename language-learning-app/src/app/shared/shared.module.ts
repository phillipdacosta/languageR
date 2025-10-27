import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { VideoUploadComponent } from '../components/video-upload/video-upload.component';

@NgModule({
  declarations: [
    VideoUploadComponent
  ],
  imports: [
    CommonModule,
    IonicModule
  ],
  exports: [
    VideoUploadComponent
  ]
})
export class SharedModule { }

