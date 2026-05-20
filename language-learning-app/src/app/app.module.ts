import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy, UrlSerializer } from '@angular/router';
import { HttpClientModule, HttpClient, HTTP_INTERCEPTORS } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { IonicStorageModule } from '@ionic/storage-angular';

import { AuthModule, AuthHttpInterceptor } from '@auth0/auth0-angular';
import { Capacitor } from '@capacitor/core';
import { environment } from '../environments/environment';

const authRedirectUri = Capacitor.isNativePlatform()
  ? 'com.languageapp.learning://callback'
  : environment.auth0.redirectUri;

// Translation imports
import { TranslateModule } from '@ngx-translate/core';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { TokenGeneratorService } from './services/token-generator.service';
import { PlatformService } from './services/platform.service';
import { CustomUrlSerializerService } from './services/custom-url-serializer.service';
import { ApiAuthInterceptor } from './services/api-auth.interceptor';
import { GlobalLoadingComponent } from './components/global-loading/global-loading.component';
import { ReminderNotificationComponent } from './components/reminder-notification/reminder-notification.component';
import { EarlyExitModalComponent } from './components/early-exit-modal/early-exit-modal.component';
import { CommonModule } from '@angular/common';


@NgModule({
  declarations: [AppComponent, GlobalLoadingComponent],
  imports: [
    BrowserModule, 
    IonicModule.forRoot(), 
    AppRoutingModule,
    HttpClientModule,
    FormsModule,
    CommonModule,
    EarlyExitModalComponent,
    ReminderNotificationComponent,
    IonicStorageModule.forRoot(),
    AuthModule.forRoot({
      domain: environment.auth0.domain,
      clientId: environment.auth0.clientId,
      authorizationParams: {
        redirect_uri: authRedirectUri,
        audience: environment.auth0.audience,
        scope: 'openid profile email'
      },
      httpInterceptor: {
        allowedList: []
      },
      useRefreshTokens: Capacitor.isNativePlatform(),
      cacheLocation: 'localstorage',
      skipRedirectCallback: Capacitor.isNativePlatform()
    }),
    TranslateModule.forRoot()
  ],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: UrlSerializer, useClass: CustomUrlSerializerService },
    // Attach Auth0 bearer token to every backend request. This is the single
    // source of truth for `Authorization` headers on HttpClient traffic; per-
    // call header construction in pages/services is now redundant.
    { provide: HTTP_INTERCEPTORS, useClass: ApiAuthInterceptor, multi: true },
    TokenGeneratorService,
    PlatformService,
    provideAnimationsAsync()
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
