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
    path: 'checkout',
    loadComponent: () => import('./checkout/checkout.page').then(m => m.CheckoutPage),
    canActivate: [AuthGuard]
  },
  {
    path: 'lessons',
    loadComponent: () => import('./lessons/lessons.page').then(m => m.LessonsPage),
    canActivate: [AuthGuard]
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
    path: 'tutor/:id',
    loadComponent: () => import('./tutor/tutor.page').then(m => m.TutorPage)
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
  },
  {
    path: 'tutor-calendar',
    loadChildren: () => import('./tutor-calendar/tutor-calendar.module').then( m => m.TutorCalendarPageModule)
  },
  {
    path: 'availability-setup',
    loadComponent: () => import('./pages/availability-setup/availability-setup.page').then( m => m.AvailabilitySetupPage),
    canActivate: [AuthGuard]
  }
];
@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
