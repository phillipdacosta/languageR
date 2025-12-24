import { IonicModule } from '@ionic/angular';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Tab1Page } from './tab1.page';
import { ExploreContainerComponentModule } from '../explore-container/explore-container.module';
import { SharedModule } from '../shared/shared.module';
import { ClassAttendeesComponent } from '../components/class-attendees/class-attendees.component';
import { DisplayNamePipe } from '../pipes/display-name.pipe';
// Import modal components to preload them and prevent first-load freeze
import { ConfirmActionModalComponent } from '../components/confirm-action-modal/confirm-action-modal.component';
import { RescheduleLessonModalComponent } from '../components/reschedule-lesson-modal/reschedule-lesson-modal.component';
import { RescheduleProposalModalComponent } from '../components/reschedule-proposal-modal/reschedule-proposal-modal.component';
import { ClassInvitationModalComponent } from '../components/class-invitation-modal/class-invitation-modal.component';
import { InviteStudentModalComponent } from '../components/invite-student-modal/invite-student-modal.component';

import { Tab1PageRoutingModule } from './tab1-routing.module';

@NgModule({
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    ExploreContainerComponentModule,
    Tab1PageRoutingModule,
    SharedModule,
    ClassAttendeesComponent,
    DisplayNamePipe,
    // Import standalone modal components to preload and compile them
    ConfirmActionModalComponent,
    RescheduleLessonModalComponent,
    RescheduleProposalModalComponent,
    ClassInvitationModalComponent,
    InviteStudentModalComponent
  ],
  declarations: [Tab1Page]
})
export class Tab1PageModule {}
