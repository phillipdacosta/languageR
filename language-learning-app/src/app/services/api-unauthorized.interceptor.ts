import { Injectable, Injector } from '@angular/core';
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/**
 * When the backend rejects a session (401), clear local Auth0 state and
 * route to login. Uses a cooldown so parallel failing requests don't loop.
 */
@Injectable()
export class ApiUnauthorizedInterceptor implements HttpInterceptor {
  private cachedAuthService: AuthService | null = null;

  constructor(private injector: Injector) {}

  private get authService(): AuthService {
    if (!this.cachedAuthService) {
      this.cachedAuthService = this.injector.get(AuthService);
    }
    return this.cachedAuthService;
  }

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(req).pipe(
      catchError((error: unknown) => {
        if (this.shouldRecoverSession(req, error)) {
          this.authService.recoverSession('backend_401');
        }
        return throwError(() => error);
      })
    );
  }

  private shouldRecoverSession(req: HttpRequest<unknown>, error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
      return false;
    }

    if (this.authService.shouldSkipSessionRecovery()) {
      return false;
    }

    const backendUrl = environment.backendUrl;
    if (!backendUrl || !req.url.startsWith(backendUrl)) {
      return false;
    }

    // Public endpoints that may 401 without implying a dead session.
    if (req.url.includes('/users/by-email') || req.url.includes('/users/check-email')) {
      return false;
    }

    // Dev preview lessons — 401 is expected, not a dead session.
    if (req.url.includes('__mock_')) {
      return false;
    }

    return true;
  }
}
