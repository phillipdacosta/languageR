import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { LessonAnalysisPage } from './lesson-analysis.page';

const routes: Routes = [
  {
    path: '',
    component: LessonAnalysisPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes), LessonAnalysisPage],
  exports: [RouterModule],
})
export class LessonAnalysisPageRoutingModule {}
