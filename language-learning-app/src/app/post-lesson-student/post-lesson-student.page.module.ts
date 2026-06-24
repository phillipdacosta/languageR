import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { PostLessonStudentPage } from './post-lesson-student.page';
import { TutorAvailabilityViewerComponent } from '../components/tutor-availability-viewer/tutor-availability-viewer.component';
import { CardManagementModalComponent } from '../components/card-management-modal/card-management-modal.component';
import { ClassGoingMessageModalComponent } from '../components/class-going-message-modal/class-going-message-modal.component';
import { TrialLessonRecapPanelComponent } from '../components/trial-lesson-recap-panel/trial-lesson-recap-panel.component';

const routes: Routes = [
  {
    path: '',
    component: PostLessonStudentPage
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslateModule,
    RouterModule.forChild(routes),
    TutorAvailabilityViewerComponent,
    CardManagementModalComponent,
    ClassGoingMessageModalComponent,
    TrialLessonRecapPanelComponent,
  ],
  declarations: [PostLessonStudentPage]
})
export class PostLessonStudentPageModule {}

