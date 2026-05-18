import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { SignupLanguagePage } from './signup-language.page';

const routes: Routes = [
  {
    path: '',
    component: SignupLanguagePage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SignupLanguagePageRoutingModule {}
