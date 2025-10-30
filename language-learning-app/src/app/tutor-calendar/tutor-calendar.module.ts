import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { TutorCalendarPageRoutingModule } from './tutor-calendar-routing.module';
import { TutorCalendarPage } from './tutor-calendar.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TutorCalendarPage,
    TutorCalendarPageRoutingModule
  ]
})
export class TutorCalendarPageModule {}
