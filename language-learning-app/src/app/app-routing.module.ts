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
    path: 'booking-success',
    loadComponent: () => import('./pages/booking-success/booking-success.page').then(m => m.BookingSuccessPage),
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
            path: 'tutor-approval',
            loadComponent: () => import('./components/tutor-onboarding/tutor-onboarding.component').then(m => m.TutorOnboardingComponent),
            canActivate: [AuthGuard]
          },
          {
            path: 'admin',
            loadComponent: () => import('./admin/admin-dashboard.page').then(m => m.AdminDashboardPage),
            canActivate: [AuthGuard],
            children: [
              {
                path: '',
                redirectTo: 'revenue',
                pathMatch: 'full'
              },
              {
                path: 'revenue',
                loadComponent: () => import('./admin/admin.page').then(m => m.AdminPage)
              },
              {
                path: 'reported-lessons',
                loadComponent: () => import('./admin/reported-lessons.page').then(m => m.ReportedLessonsPage)
              },
              {
                path: 'tutor-review',
                loadComponent: () => import('./admin/tutor-review/tutor-review.page').then(m => m.TutorReviewPage)
              },
              {
                path: 'material-reports',
                loadComponent: () => import('./admin/material-reports.page').then(m => m.MaterialReportsPage)
              },
              {
                path: 'material-review',
                loadComponent: () => import('./admin/material-review.page').then(m => m.MaterialReviewPage)
              },
              {
                path: 'payment-review',
                loadChildren: () => import('./admin/payment-review/payment-review.module').then(m => m.PaymentReviewPageModule)
              }
            ]
          },
          // Legacy admin routes (redirect to new structure)
          {
            path: 'admin/tutor-review',
            redirectTo: 'admin/tutor-review',
            pathMatch: 'full'
          },
          {
            path: 'admin/payment-review',
            redirectTo: 'admin/payment-review',
            pathMatch: 'full'
          },
          {
            path: 'admin/revenue',
            redirectTo: 'admin/revenue',
            pathMatch: 'full'
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
    // Intentionally public for shareability and SEO
  },
  {
    path: 'student/:id',
    loadComponent: () => import('./student/student.page').then(m => m.StudentPage),
    canActivate: [AuthGuard] // Student profiles are private
  },
  {
    path: 'pre-call',
    loadChildren: () => import('./pre-call/pre-call.module').then( m => m.PreCallPageModule),
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
  // Removed duplicate routes and auth-debug (security risk)
  {
    path: 'availability-setup',
    loadComponent: () => import('./pages/availability-setup/availability-setup.page').then( m => m.AvailabilitySetupPage),
    canActivate: [AuthGuard]
  },
  {
    path: 'terms-privacy',
    loadChildren: () => import('./legal/terms-privacy/terms-privacy.module').then( m => m.TermsPrivacyPageModule)
  },
  {
    path: 'review-deck',
    loadChildren: () => import('./review-deck/review-deck.module').then( m => m.ReviewDeckPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'event/:id',
    loadComponent: () => import('./tutor-calendar/event-details/event-details.page').then(m => m.EventDetailsPage),
    canActivate: [AuthGuard]
  },
  {
    path: 'material/:id',
    loadComponent: () => import('./material-detail/material-detail.page').then(m => m.MaterialDetailPage)
  },
  {
    path: 'lesson-analysis/:id',
    loadComponent: () => import('./lesson-analysis/lesson-analysis.page').then( m => m.LessonAnalysisPage),
    canActivate: [AuthGuard]
  },
  {
    path: 'post-lesson-student/:id',
    loadChildren: () => import('./post-lesson-student/post-lesson-student.page.module').then(m => m.PostLessonStudentPageModule),
    canActivate: [AuthGuard]
  },
  {
    path: 'post-lesson-tutor/:id',
    loadChildren: () => import('./post-lesson-tutor/post-lesson-tutor.page.module').then(m => m.PostLessonTutorPageModule),
    canActivate: [AuthGuard]
  },
  // tutor-feedback route removed — consolidated into /post-lesson-tutor/:id
  {
    path: 'wallet',
    loadChildren: () => import('./wallet/wallet.module').then( m => m.WalletPageModule)
  }
];
@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
