import { Injectable, Injector } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
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
 * - In production builds the token is a valid Auth0 ID token when available,
 *   otherwise a freshly refreshed access token. If token acquisition fails,
 *   the request is aborted (not sent without auth) so a transient failure
 *   right after OAuth does not produce a false-positive 401 logout.
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
      catchError(err => {
        console.error(
          '[ApiAuthInterceptor] Failed to obtain Auth0 token; request aborted:',
          req.url,
          err
        );
        return throwError(() => err);
      }),
      switchMap(token => {
        const authed = req.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        });
        return next.handle(authed);
      })
    );
  }

  private shouldAttachAuth(req: HttpRequest<any>): boolean {
    const backendUrl = environment.backendUrl;
    if (!backendUrl) return false;
    return req.url.startsWith(backendUrl);
  }
}
