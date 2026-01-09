import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { PostLessonTutorPage } from './post-lesson-tutor.page';

const routes: Routes = [
  {
    path: '',
    component: PostLessonTutorPage
  }
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild(routes)
  ],
  declarations: [PostLessonTutorPage]
})
export class PostLessonTutorPageModule {}

