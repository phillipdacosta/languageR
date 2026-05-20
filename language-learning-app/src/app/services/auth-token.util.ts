import { take } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import type { AuthService } from './auth.service';

/**
 * Build the bearer token used to talk to the backend.
 *
 * - In any environment, first try to mint a real Auth0 ID token by silently
 *   refreshing the access token and reading idTokenClaims. The backend
 *   verifies it via JWKS.
 *
 * - In NON-production builds (environment.production === false), if Auth0
 *   refresh fails we fall back to a `dev-token-{email}` shortcut so local dev
 *   keeps working without forcing a full Auth0 round-trip.
 *
 * - In PRODUCTION builds, we DO NOT fall back. We surface the underlying
 *   error so the caller can prompt the user to re-login. Silently sending
 *   `dev-token-…` to a prod backend would just be rejected with 401 anyway,
 *   and worse, it hides the real auth failure.
 *
 * Returns the raw token string (no "Bearer " prefix).
 */
export async function buildBearerToken(authService: AuthService): Promise<string> {
  try {
    await authService.getAccessToken().pipe(take(1)).toPromise();
    const idTokenClaims = await authService.getIdTokenClaims();
    const idToken = idTokenClaims?.__raw;
    if (!idToken) {
      throw new Error('No ID token available after refresh');
    }
    return idToken;
  } catch (error) {
    if (environment.production) {
      throw error;
    }
    const user = await authService.user$.pipe(take(1)).toPromise();
    const email = user?.email || 'unknown';
    const tokenEmail = email.replace('@', '-').replace(/\./g, '-');
    return `dev-token-${tokenEmail}`;
  }
}

/** Convenience: build the `Bearer …` header value. */
export async function buildAuthorizationHeader(authService: AuthService): Promise<string> {
  const token = await buildBearerToken(authService);
  return `Bearer ${token}`;
}
