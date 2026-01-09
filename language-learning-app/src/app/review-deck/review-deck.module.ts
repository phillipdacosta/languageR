import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ReviewDeckPageRoutingModule } from './review-deck-routing.module';
import { ReviewDeckPage } from './review-deck.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ReviewDeckPageRoutingModule
  ],
  declarations: [ReviewDeckPage]
})
export class ReviewDeckPageModule {}








