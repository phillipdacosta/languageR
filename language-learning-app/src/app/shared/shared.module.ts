import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { VideoUploadComponent } from '../components/video-upload/video-upload.component';
import { FlagIconComponent } from '../components/flag-icon/flag-icon.component';
import { SafeUrlPipe } from './pipes/safe-url.pipe';

@NgModule({
  declarations: [
    VideoUploadComponent,
    FlagIconComponent,
    SafeUrlPipe
  ],
  imports: [
    CommonModule,
    FormsModule,
    IonicModule
  ],
  exports: [
    VideoUploadComponent,
    FlagIconComponent,
    SafeUrlPipe
  ]
})
export class SharedModule { }

