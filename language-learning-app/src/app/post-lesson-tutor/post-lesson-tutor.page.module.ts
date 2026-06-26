import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { PostLessonTutorPage } from './post-lesson-tutor.page';
import { JourneySnapshotPanelComponent } from '../journey/journey-snapshot-panel/journey-snapshot-panel.component';

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
    TranslateModule,
    RouterModule.forChild(routes),
    JourneySnapshotPanelComponent
  ],
  declarations: [PostLessonTutorPage]
})
export class PostLessonTutorPageModule {}

