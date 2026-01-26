import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { PostLessonStudentPage } from './post-lesson-student.page';
import { TutorAvailabilityViewerComponent } from '../components/tutor-availability-viewer/tutor-availability-viewer.component';

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
    RouterModule.forChild(routes),
    TutorAvailabilityViewerComponent
  ],
  declarations: [PostLessonStudentPage]
})
export class PostLessonStudentPageModule {}

