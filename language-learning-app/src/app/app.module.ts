import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy, UrlSerializer } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { IonicStorageModule } from '@ionic/storage-angular';

import { AuthModule } from '@auth0/auth0-angular';
import { environment } from '../environments/environment';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { TutorSearchPageModule } from './tutor-search/tutor-search.module';
import { AgoraService } from './services/agora.service';
import { TokenGeneratorService } from './services/token-generator.service';
import { PlatformService } from './services/platform.service';
import { CustomUrlSerializerService } from './services/custom-url-serializer.service';
import { GlobalLoadingComponent } from './components/global-loading/global-loading.component';

@NgModule({
  declarations: [AppComponent, GlobalLoadingComponent],
  imports: [
    BrowserModule, 
    IonicModule.forRoot(), 
    AppRoutingModule,
    HttpClientModule,
    FormsModule,
    TutorSearchPageModule,
    IonicStorageModule.forRoot(),
    AuthModule.forRoot({
      domain: environment.auth0.domain,
      clientId: environment.auth0.clientId,
      authorizationParams: {
        redirect_uri: environment.auth0.redirectUri,
        scope: 'openid profile email'
      },
      httpInterceptor: {
        allowedList: [
          {
            uri: '/api/*'
          }
        ]
      },
      useRefreshTokens: false,
      cacheLocation: 'localstorage',
      skipRedirectCallback: false
    })
  ],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: UrlSerializer, useClass: CustomUrlSerializerService },
    AgoraService,
    TokenGeneratorService,
    PlatformService
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
