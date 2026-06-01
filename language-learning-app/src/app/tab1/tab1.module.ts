import { IonicModule } from '@ionic/angular';
import { NgModule, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
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
import { ScheduleClassPage } from '../tutor-calendar/schedule-class/schedule-class.page';
import { ForumPage } from '../forum/forum.page';
import { MobileQuickActionsComponent } from '../components/home/mobile-quick-actions.component';
import { MobileThisWeekComponent } from '../components/home/mobile-this-week.component';
import { MobilePendingActionsComponent } from '../components/home/mobile-pending-actions.component';
import { MobileRecentStudentsComponent } from '../components/home/mobile-recent-students.component';
import { JourneyWidgetComponent } from '../components/home/journey-widget.component';
import { PremiumWhenUnframedComponent } from '../components/home/premium-when-unframed.component';
import { MeshGradientBackgroundComponent } from '../components/mesh-gradient-background/mesh-gradient-background.component';
import { JourneyIntroComponent } from '../journey/journey-intro.component';
import { JourneyPage } from '../journey/journey.page';
import { TutorOnboardingComponent } from '../components/tutor-onboarding/tutor-onboarding.component';
import { SiteFooterComponent } from '../components/site-footer/site-footer.component';

import { Tab1PageRoutingModule } from './tab1-routing.module';

@NgModule({
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    RouterModule,
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
    ScheduleClassPage,
    ForumPage,
    MobileQuickActionsComponent,
    MobileThisWeekComponent,
    MobilePendingActionsComponent,
    MobileRecentStudentsComponent,
    JourneyWidgetComponent,
    PremiumWhenUnframedComponent,
    MeshGradientBackgroundComponent,
    JourneyIntroComponent,
    JourneyPage,
    TutorOnboardingComponent,
    SiteFooterComponent
  ],
  declarations: [Tab1Page],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class Tab1PageModule {}
