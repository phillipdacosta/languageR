import { Injectable, Injector } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { buildBearerToken } from './auth-token.util';

/**
 * Single source of truth for `Authorization` headers on backend traffic.
 *
 * - Every outgoing `HttpClient` request to `environment.backendUrl` gets an
 *   `Authorization: Bearer <token>` header attached automatically.
 *
 * - In production builds the token is always a real Auth0 ID token
 *   (refreshed silently). If we can't get one we still send the request
 *   without auth so the backend can 401 cleanly and the UI can react —
 *   but we do not paper over the failure with a dev token.
 *
 * - In non-production builds, if Auth0 silent auth fails we fall back to
 *   the legacy `dev-token-{email}` shortcut (handled inside
 *   `buildBearerToken`). This keeps local dev painless.
 *
 * - Requests that go anywhere other than our backend pass through
 *   unchanged. Any `Authorization` header set manually by a caller on a
 *   backend request is **overwritten** so legacy code paths can't smuggle
 *   stale dev tokens through to prod.
 *
 * Note: This interceptor only fires for Angular's HttpClient. Direct
 * `fetch()` and socket.io traffic must continue to call
 * `buildBearerToken()` themselves (see `deepgram-audio.service.ts` and
 * `websocket.service.ts`).
 */
@Injectable()
export class ApiAuthInterceptor implements HttpInterceptor {
  // Lazy-inject AuthService to avoid a "Circular dependency detected for
  // InjectionToken HTTP_INTERCEPTORS" error. AuthService depends on
  // HttpClient (which itself depends on HTTP_INTERCEPTORS); resolving it
  // eagerly in the constructor closes the cycle. Using Injector.get() at
  // intercept time breaks it.
  private cachedAuthService: AuthService | null = null;

  constructor(private injector: Injector) {}

  private get authService(): AuthService {
    if (!this.cachedAuthService) {
      this.cachedAuthService = this.injector.get(AuthService);
    }
    return this.cachedAuthService;
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    if (!this.shouldAttachAuth(req)) {
      return next.handle(req);
    }

    return from(buildBearerToken(this.authService)).pipe(
      switchMap(token => {
        const authed = req.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        });
        return next.handle(authed);
      }),
      catchError(err => {
        if (environment.production) {
          console.error(
            '[ApiAuthInterceptor] Failed to obtain Auth0 token for request; backend will 401:',
            req.url,
            err
          );
        }
        // Strip any caller-supplied Authorization so we never accidentally
        // smuggle a stale/dev token to prod. Backend returns 401 cleanly.
        const stripped = req.clone({ headers: req.headers.delete('Authorization') });
        return next.handle(stripped);
      })
    );
  }

  private shouldAttachAuth(req: HttpRequest<any>): boolean {
    const backendUrl = environment.backendUrl;
    if (!backendUrl) return false;
    return req.url.startsWith(backendUrl);
  }
}
