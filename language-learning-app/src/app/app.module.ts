import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy, UrlSerializer } from '@angular/router';
import { HttpClientModule, HttpClient, HTTP_INTERCEPTORS } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { IonicStorageModule } from '@ionic/storage-angular';

import { AuthModule, AuthHttpInterceptor } from '@auth0/auth0-angular';
import { environment } from '../environments/environment';

// Translation imports
import { TranslateModule } from '@ngx-translate/core';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { TutorSearchPageModule } from './tutor-search/tutor-search.module';
import { AgoraService } from './services/agora.service';
import { TokenGeneratorService } from './services/token-generator.service';
import { PlatformService } from './services/platform.service';
import { CustomUrlSerializerService } from './services/custom-url-serializer.service';
import { GlobalLoadingComponent } from './components/global-loading/global-loading.component';
import { ReminderNotificationComponent } from './components/reminder-notification/reminder-notification.component';
import { EarlyExitModalComponent } from './components/early-exit-modal/early-exit-modal.component';
import { CommonModule } from '@angular/common';
import { IonicModule as IonicModuleImport } from '@ionic/angular';


@NgModule({
  declarations: [AppComponent, GlobalLoadingComponent],
  imports: [
    BrowserModule, 
    IonicModule.forRoot(), 
    AppRoutingModule,
    HttpClientModule,
    FormsModule,
    CommonModule,
    TutorSearchPageModule,
    EarlyExitModalComponent,
    ReminderNotificationComponent, // Standalone component
    IonicStorageModule.forRoot(),
    AuthModule.forRoot({
      domain: environment.auth0.domain,
      clientId: environment.auth0.clientId,
      authorizationParams: {
        redirect_uri: environment.auth0.redirectUri,
        audience: environment.auth0.audience,
        scope: 'openid profile email'
      },
      // Disable HTTP interceptor for now - we'll use dev tokens
      httpInterceptor: {
        allowedList: []
      },
      useRefreshTokens: false,
      cacheLocation: 'localstorage',
      skipRedirectCallback: false
    }),
    TranslateModule.forRoot()
  ],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: UrlSerializer, useClass: CustomUrlSerializerService },
    // Removed AuthHttpInterceptor - using dev tokens instead
    AgoraService,
    TokenGeneratorService,
    PlatformService,
    provideAnimationsAsync()
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
