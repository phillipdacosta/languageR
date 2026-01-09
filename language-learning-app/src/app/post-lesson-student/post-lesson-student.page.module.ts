import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { PostLessonStudentPage } from './post-lesson-student.page';

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
    RouterModule.forChild(routes)
  ],
  declarations: [PostLessonStudentPage]
})
export class PostLessonStudentPageModule {}

