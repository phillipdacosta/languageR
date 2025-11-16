import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { TutorSearchContentPageRoutingModule } from './tutor-search-content-routing.module';

import { TutorSearchContentPage } from './tutor-search-content.page';
import { VideoPlayerModalComponent } from './video-player-modal.component';
import { SharedModule } from '../shared/shared.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TutorSearchContentPageRoutingModule,
    SharedModule
  ],
  declarations: [TutorSearchContentPage, VideoPlayerModalComponent],
  exports: [TutorSearchContentPage]
})
export class TutorSearchContentPageModule {}
