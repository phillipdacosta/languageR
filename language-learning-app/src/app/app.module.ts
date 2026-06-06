import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy, UrlSerializer } from '@angular/router';
import { HttpClientModule, HttpClient, HTTP_INTERCEPTORS } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { IonicStorageModule } from '@ionic/storage-angular';

import { AuthModule } from '@auth0/auth0-angular';
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
import { ApiUnauthorizedInterceptor } from './services/api-unauthorized.interceptor';
import { GlobalLoadingComponent } from './components/global-loading/global-loading.component';
import { ReminderNotificationComponent } from './components/reminder-notification/reminder-notification.component';
import { MessagePreviewToastComponent } from './components/message-preview-toast/message-preview-toast.component';
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
    ReminderNotificationComponent,
    MessagePreviewToastComponent,
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
      // Refresh-token rotation on web + native so sessions survive ID token
      // expiry without fragile silent-iframe hangs. Requires "Refresh Token
      // Rotation" enabled for this SPA in the Auth0 dashboard.
      useRefreshTokens: true,
      useRefreshTokensFallback: true,
      cacheLocation: 'localstorage',
      skipRedirectCallback: Capacitor.isNativePlatform()
    }),
    TranslateModule.forRoot()
  ],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: UrlSerializer, useClass: CustomUrlSerializerService },
    // ApiAuthInterceptor attaches tokens; ApiUnauthorizedInterceptor handles 401 recovery.
    { provide: HTTP_INTERCEPTORS, useClass: ApiAuthInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: ApiUnauthorizedInterceptor, multi: true },
    TokenGeneratorService,
    PlatformService,
    provideAnimationsAsync()
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
