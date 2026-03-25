import { IonicModule } from '@ionic/angular';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MessagesPage } from './messages.page';
import { ImageViewerModal } from './image-viewer-modal.component';
import { MessageContextMenuComponent } from './message-context-menu.component';
import { SharedModule } from '../shared/shared.module';
import { TutorAvailabilityViewerComponent } from '../components/tutor-availability-viewer/tutor-availability-viewer.component';
import { TutorAvailabilitySelectionModalComponent } from '../components/tutor-availability-selection-modal/tutor-availability-selection-modal.component';
import { CheckoutPage } from '../checkout/checkout.page';
import { MarkdownLinkPipe } from './pipes/markdown-link.pipe';

import { MessagesPageRoutingModule } from './messages-routing.module';

@NgModule({
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MessagesPageRoutingModule,
    SharedModule,
    TutorAvailabilityViewerComponent,
    TutorAvailabilitySelectionModalComponent,
    CheckoutPage
  ],
  declarations: [MessagesPage, ImageViewerModal, MessageContextMenuComponent, MarkdownLinkPipe]
})
export class MessagesPageModule {}

