import { take } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import type { AuthService } from './auth.service';

/** Decode JWT exp without verifying signature — used only to pick a fresh token. */
function isJwtExpired(token: string, skewSeconds = 30): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (!payload.exp) {
      return false;
    }
    return Date.now() >= (payload.exp - skewSeconds) * 1000;
  } catch {
    return true;
  }
}

/**
 * Build the bearer token used to talk to the backend.
 *
 * - Prefer a non-expired Auth0 ID token (carries email for legacy user lookup).
 * - If the cached ID token is stale, use the access token from silent refresh
 *   instead. On web, ID token claims can linger in localStorage after expiry
 *   while `getAccessTokenSilently()` still succeeds — that mismatch caused
 *   repeated 401 "jwt expired" errors.
 *
 * - In NON-production builds, if Auth0 refresh fails we fall back to a
 *   `dev-token-{email}` shortcut so local dev keeps working.
 *
 * - In PRODUCTION builds, we DO NOT fall back to dev tokens.
 *
 * Returns the raw token string (no "Bearer " prefix).
 */
export async function buildBearerToken(authService: AuthService): Promise<string> {
  try {
    const accessToken = await authService.getAccessToken().pipe(take(1)).toPromise();

    const idTokenClaims = await authService.getIdTokenClaims();
    const idToken = idTokenClaims?.__raw;
    if (idToken && !isJwtExpired(idToken)) {
      return idToken;
    }

    // Local dev: Auth0 session is still valid but the cached ID token expired.
    // Backend accepts dev-token-* shortcuts; prefer that over a bare access token
    // (which may lack email and break legacy auth0Id lookups).
    if (!environment.production) {
      const user = await authService.user$.pipe(take(1)).toPromise();
      if (user?.email) {
        const tokenEmail = user.email.replace('@', '-').replace(/\./g, '-');
        return `dev-token-${tokenEmail}`;
      }
    }

    if (accessToken && !isJwtExpired(accessToken)) {
      return accessToken;
    }

    throw new Error('No valid Auth0 token available after refresh');
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
