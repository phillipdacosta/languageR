import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { TutorSearchPageRoutingModule } from './tutor-search-routing.module';

import { TutorSearchPage } from './tutor-search.page';
import { TutorSearchContentPageModule } from '../tutor-search-content/tutor-search-content.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TutorSearchPageRoutingModule,
    TutorSearchContentPageModule
  ],
  declarations: [TutorSearchPage]
})
export class TutorSearchPageModule {}
