import { IonicModule } from '@ionic/angular';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { TabsPageRoutingModule } from './tabs-routing.module';
import { SharedModule } from '../shared/shared.module';
import { NotificationFilterPipe } from './notification-filter.pipe';

import { TabsPage } from './tabs.page';

@NgModule({
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    RouterModule,
    TabsPageRoutingModule,
    SharedModule,
    NotificationFilterPipe  // Import standalone pipe
  ],
  declarations: [TabsPage]
})
export class TabsPageModule {}
