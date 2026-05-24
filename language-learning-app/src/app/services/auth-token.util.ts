import { take, timeout } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { AuthService } from './auth.service';

const SILENT_AUTH_TIMEOUT_MS = 8000;

/** Decode JWT exp without verifying signature — used only to pick a fresh token. */
export function isJwtExpired(token: string, skewSeconds = 30): boolean {
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

function devTokenForEmail(email: string): string {
  const tokenEmail = email.replace('@', '-').replace(/\./g, '-');
  return `dev-token-${tokenEmail}`;
}

async function getValidIdToken(authService: AuthService): Promise<string | null> {
  const idTokenClaims = await authService.getIdTokenClaims();
  const idToken = idTokenClaims?.__raw;
  if (idToken && !isJwtExpired(idToken)) {
    return idToken;
  }
  return null;
}

async function refreshAccessTokenWithTimeout(authService: AuthService): Promise<string | null> {
  try {
    return await firstValueFrom(
      authService.refreshAccessToken().pipe(timeout(SILENT_AUTH_TIMEOUT_MS))
    );
  } catch {
    return null;
  }
}

/**
 * Build the bearer token used to talk to the backend.
 *
 * - Prefer a non-expired Auth0 ID token (carries email for legacy user lookup).
 * - When the ID token is stale, force a network refresh via refresh tokens
 *   (web + native) and prefer a freshly cached ID token afterward.
 * - Fall back to a verified access token only when the ID token is unavailable.
 *
 * - In NON-production builds, if Auth0 refresh fails we fall back to a
 *   `dev-token-{email}` shortcut so local dev keeps working.
 *
 * - In PRODUCTION builds, we DO NOT fall back to dev tokens.
 *
 * Returns the raw token string (no "Bearer " prefix).
 */
export async function buildBearerToken(authService: AuthService): Promise<string> {
  const cachedIdToken = await getValidIdToken(authService);
  if (cachedIdToken) {
    return cachedIdToken;
  }

  const user = await authService.user$.pipe(take(1)).toPromise();

  // Local dev: never block on silent refresh when we already know who the user is.
  if (!environment.production && user?.email) {
    return devTokenForEmail(user.email);
  }

  const accessToken = await refreshAccessTokenWithTimeout(authService);

  // Refresh rotates tokens — re-read ID token claims after network refresh.
  const refreshedIdToken = await getValidIdToken(authService);
  if (refreshedIdToken) {
    return refreshedIdToken;
  }

  if (accessToken && !isJwtExpired(accessToken)) {
    return accessToken;
  }

  if (environment.production) {
    throw new Error('No valid Auth0 token available after refresh');
  }

  const email = user?.email || 'unknown';
  return devTokenForEmail(email);
}

/** Convenience: build the `Bearer …` header value. */
export async function buildAuthorizationHeader(authService: AuthService): Promise<string> {
  const token = await buildBearerToken(authService);
  return `Bearer ${token}`;
}
