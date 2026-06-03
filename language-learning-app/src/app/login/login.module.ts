import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

import { LoginPageRoutingModule } from './login-routing.module';
import { LoginPage } from './login.page';
import { SiteFooterComponent } from '../components/site-footer/site-footer.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslateModule,
    LoginPageRoutingModule,
    SiteFooterComponent
  ],
  declarations: [LoginPage]
})
export class LoginPageModule {}

