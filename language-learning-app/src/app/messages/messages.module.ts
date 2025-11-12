import { IonicModule } from '@ionic/angular';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MessagesPage } from './messages.page';
import { ImageViewerModal } from './image-viewer-modal.component';
import { MessageContextMenuComponent } from './message-context-menu.component';
import { SharedModule } from '../shared/shared.module';

import { MessagesPageRoutingModule } from './messages-routing.module';

@NgModule({
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MessagesPageRoutingModule,
    SharedModule
  ],
  declarations: [MessagesPage, ImageViewerModal, MessageContextMenuComponent]
})
export class MessagesPageModule {}

