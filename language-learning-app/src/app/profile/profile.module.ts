import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { ProfilePageRoutingModule } from './profile-routing.module';
import { ProfilePage } from './profile.page';
import { SharedModule } from '../shared/shared.module';
import { PicturePreviewModalComponent } from '../components/picture-preview-modal/picture-preview-modal.component';
import { SafeUrlPipe } from '../pipes/safe-url.pipe';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ProfilePageRoutingModule,
    SharedModule
  ],
  declarations: [
    ProfilePage,
    PicturePreviewModalComponent,
    SafeUrlPipe
  ]
})
export class ProfilePageModule {}
