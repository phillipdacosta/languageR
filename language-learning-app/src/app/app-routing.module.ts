import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';
import { OnboardingGuard } from './guards/onboarding.guard';

const routes: Routes = [
  {
    path: '',
    redirectTo: '/login',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadChildren: () => import('./login/login.module').then(m => m.LoginPageModule)
  },
  {
    path: 'callback',
    loadChildren: () => import('./callback/callback.module').then(m => m.CallbackPageModule)
  },
          {
            path: 'onboarding',
            loadChildren: () => import('./onboarding/onboarding.module').then(m => m.OnboardingPageModule),
            canActivate: [AuthGuard]
          },
          {
            path: 'tutor-onboarding',
            loadChildren: () => import('./tutor-onboarding/tutor-onboarding.module').then(m => m.TutorOnboardingPageModule),
            canActivate: [AuthGuard]
          },
  {
    path: 'tabs',
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule),
    canActivate: [OnboardingGuard]
  },
  {
    path: 'tutor-search-content',
    loadChildren: () => import('./tutor-search-content/tutor-search-content.module').then( m => m.TutorSearchContentPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'video-call',
    loadChildren: () => import('./video-call/video-call.module').then( m => m.VideoCallPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'debug-permissions',
    loadChildren: () => import('./debug-permissions/debug-permissions.module').then( m => m.DebugPermissionsPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'auth-debug',
    loadChildren: () => import('./auth-debug/auth-debug.module').then( m => m.AuthDebugPageModule)
  },
  {
    path: 'tutor-onboarding',
    loadChildren: () => import('./tutor-onboarding/tutor-onboarding.module').then( m => m.TutorOnboardingPageModule)
  }
];
@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
