import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { TutorSearchContentPageRoutingModule } from './tutor-search-content-routing.module';

import { TutorSearchContentPage } from './tutor-search-content.page';
import { VideoPlayerModalComponent } from './video-player-modal.component';
import { CountryFilterPopoverComponent } from './country-filter-popover.component';
import { SharedModule } from '../shared/shared.module';
import { TutorFiltersModalComponent } from '../components/tutor-filters-modal/tutor-filters-modal.component';
import { SiteFooterComponent } from '../components/site-footer/site-footer.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TutorSearchContentPageRoutingModule,
    SharedModule,
    TutorFiltersModalComponent,
    SiteFooterComponent
  ],
  declarations: [TutorSearchContentPage, VideoPlayerModalComponent, CountryFilterPopoverComponent],
  exports: [TutorSearchContentPage, VideoPlayerModalComponent]
})
export class TutorSearchContentPageModule {}
