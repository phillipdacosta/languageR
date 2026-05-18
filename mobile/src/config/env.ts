/**
 * Mobile environment configuration.
 *
 * Resolution order for the backend URL:
 *   1. `EXPO_PUBLIC_API_BASE` env var — set in `mobile/.env` to point at a
 *      local backend (e.g. `http://192.168.1.10:3000` for an Expo Go dev
 *      client on a phone hitting your laptop's LAN IP).
 *   2. In production builds (`__DEV__ === false`) we always use the deployed
 *      backend regardless of any env override, so a leftover `.env` value
 *      never accidentally ships to a production build.
 *   3. Default for dev builds: the deployed backend. This preserves the
 *      previous behavior (RN dev hits prod) when no env var is set.
 *
 * Auth0 config is the same tenant in dev and prod for now. When you provision
 * a separate Auth0 tenant or Application for production, swap the values via
 * `EXPO_PUBLIC_AUTH0_DOMAIN` / `EXPO_PUBLIC_AUTH0_CLIENT_ID` env vars and the
 * resolver below will pick them up automatically in dev builds. Production
 * builds intentionally pin the prod values.
 */

const PROD_API_BASE = 'https://api.barnabi.ai';

const PROD_AUTH0 = {
  domain: 'dev-h6q8nxbfbq8psb4k.us.auth0.com',
  clientId: 'veJihab93y2EdvOK10ve1TvwSffMTflj',
  audience: 'https://dev-h6q8nxbfbq8psb4k.us.auth0.com/api/v2/',
} as const;

// In dev, allow env-driven overrides so contributors can point at a local
// backend or a sandbox Auth0 app without editing source.
const DEV_API_BASE = process.env.EXPO_PUBLIC_API_BASE || PROD_API_BASE;
const DEV_AUTH0 = {
  domain: process.env.EXPO_PUBLIC_AUTH0_DOMAIN || PROD_AUTH0.domain,
  clientId: process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID || PROD_AUTH0.clientId,
  audience: process.env.EXPO_PUBLIC_AUTH0_AUDIENCE || PROD_AUTH0.audience,
} as const;

const API_BASE = __DEV__ ? DEV_API_BASE : PROD_API_BASE;
const AUTH0 = __DEV__ ? DEV_AUTH0 : PROD_AUTH0;

export const env = {
  apiUrl: `${API_BASE}/api`,
  backendUrl: API_BASE,
  auth0: AUTH0,
  agora: {
    appId: '134e5b056b944b66b14fc9e275726131',
  },
} as const;
