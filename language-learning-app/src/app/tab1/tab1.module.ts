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
import { CancelReasonModalComponent } from '../components/cancel-reason-modal/cancel-reason-modal.component';
import { RescheduleLessonModalComponent } from '../components/reschedule-lesson-modal/reschedule-lesson-modal.component';
import { RescheduleProposalModalComponent } from '../components/reschedule-proposal-modal/reschedule-proposal-modal.component';
import { ClassInvitationModalComponent } from '../components/class-invitation-modal/class-invitation-modal.component';
import { InviteStudentModalComponent } from '../components/invite-student-modal/invite-student-modal.component';
import { InvitationsListModalComponent } from '../components/invitations-list-modal/invitations-list-modal.component';
import { TutorAvailabilityViewerComponent } from '../components/tutor-availability-viewer/tutor-availability-viewer.component';
import { TutorNoteModalComponent } from '../components/tutor-note-modal/tutor-note-modal.component';
import { SmartIslandComponent } from '../components/smart-island/smart-island.component';
import { EarningsPage } from '../earnings/earnings.page';
import { ExplorePage } from '../explore/explore.page';
import { CreateMaterialPage } from '../create-material/create-material.page';
import { MobileQuickActionsComponent } from '../components/home/mobile-quick-actions.component';
import { MobileThisWeekComponent } from '../components/home/mobile-this-week.component';
import { MobilePendingActionsComponent } from '../components/home/mobile-pending-actions.component';
import { MobileRecentStudentsComponent } from '../components/home/mobile-recent-students.component';

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
    CancelReasonModalComponent,
    RescheduleLessonModalComponent,
    RescheduleProposalModalComponent,
    ClassInvitationModalComponent,
    InviteStudentModalComponent,
    InvitationsListModalComponent,
    TutorAvailabilityViewerComponent,
    TutorNoteModalComponent,
    SmartIslandComponent,
    EarningsPage,
    ExplorePage,
    CreateMaterialPage,
    MobileQuickActionsComponent,
    MobileThisWeekComponent,
    MobilePendingActionsComponent,
    MobileRecentStudentsComponent
  ],
  declarations: [Tab1Page]
})
export class Tab1PageModule {}
