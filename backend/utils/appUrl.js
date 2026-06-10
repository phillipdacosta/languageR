const LOCAL_DEV_ORIGIN = 'http://localhost:8100';
const DEFAULT_DEV_FRONTEND_URL = 'https://languager-frontend.onrender.com';
const DEFAULT_PUBLIC_BACKEND_URL = 'https://api.barnabi.ai';

function normalizeOrigin(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function collectConfiguredOrigins() {
  const origins = new Set();
  for (const key of ['FRONTEND_URL', 'PUBLIC_APP_URL', 'CORS_ORIGIN']) {
    const raw = process.env[key];
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const origin = normalizeOrigin(part);
      if (origin) origins.add(origin);
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    origins.add(LOCAL_DEV_ORIGIN);
    origins.add('http://localhost:4200');
  }
  return origins;
}

function isLocalhostOrigin(origin) {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function originIsAllowed(origin, allowedOrigins) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  if (process.env.NODE_ENV === 'production' && !isLocalhostOrigin(origin)) {
    return true;
  }
  return false;
}

/**
 * Public frontend origin for email images and links.
 * Email clients cannot load localhost URLs, so when FRONTEND_URL is local we fall back
 * to EMAIL_PUBLIC_FRONTEND_URL, FRONTEND_URL_DEV, or the Render dev frontend.
 *
 * On Render, FRONTEND_URL may point at a custom domain still being provisioned (e.g.
 * app.barnabi.ai). Until EMAIL_PUBLIC_FRONTEND_URL is set to that domain, email links
 * use FRONTEND_URL_DEV so "View lesson" opens the deployed static app.
 */
function resolveEmailFrontendUrl() {
  for (const key of ['EMAIL_PUBLIC_FRONTEND_URL']) {
    const origin = normalizeOrigin(process.env[key]?.split(',')[0]);
    if (origin && !isLocalhostOrigin(origin)) {
      return origin;
    }
  }

  const frontendDev = normalizeOrigin(process.env.FRONTEND_URL_DEV?.split(',')[0])
    || DEFAULT_DEV_FRONTEND_URL;

  if (process.env.RENDER === 'true' && !isLocalhostOrigin(frontendDev)) {
    return frontendDev;
  }

  const configured = normalizeOrigin(process.env.FRONTEND_URL?.split(',')[0]);
  if (configured && !isLocalhostOrigin(configured)) {
    return configured;
  }

  for (const key of ['PUBLIC_APP_URL']) {
    const origin = normalizeOrigin(process.env[key]?.split(',')[0]);
    if (origin && !isLocalhostOrigin(origin)) {
      return origin;
    }
  }

  return frontendDev;
}

/**
 * Public base URL for email image assets (served from backend /email-assets).
 * Email clients cannot load localhost or undeployed frontend /assets URLs.
 * When developing locally, defaults to the deployed backend (BACKEND_URL_DEV or api.barnabi.ai).
 */
function resolveEmailAssetBaseUrl() {
  const explicit = process.env.EMAIL_ASSET_BASE_URL?.trim().replace(/\/$/, '');
  if (explicit) return explicit;

  for (const key of ['BACKEND_PUBLIC_URL', 'RENDER_EXTERNAL_URL']) {
    const origin = normalizeOrigin(process.env[key]?.split(',')[0]);
    if (origin && !isLocalhostOrigin(origin)) {
      return `${origin}/email-assets`;
    }
  }

  const frontend = normalizeOrigin(process.env.FRONTEND_URL?.split(',')[0]);
  const runningLocally = isLocalhostOrigin(frontend) || process.env.NODE_ENV !== 'production';

  if (runningLocally) {
    const port = process.env.PORT || 3000;
    return `http://localhost:${port}/email-assets`;
  }

  const devBackend = normalizeOrigin(process.env.BACKEND_URL_DEV?.split(',')[0])
    || DEFAULT_PUBLIC_BACKEND_URL;
  return `${devBackend}/email-assets`;
}

/**
 * Default frontend origin for server-initiated links (emails, etc.).
 * - Local machine → localhost:8100 (or FRONTEND_URL from config.env)
 * - Render deploy → FRONTEND_URL if set, else FRONTEND_URL_DEV, else languager-frontend.onrender.com
 */
function resolveDefaultFrontendUrl() {
  const isOnRender = process.env.RENDER === 'true';

  if (isOnRender) {
    return normalizeOrigin(process.env.FRONTEND_URL?.split(',')[0])
      || normalizeOrigin(process.env.FRONTEND_URL_DEV?.split(',')[0])
      || normalizeOrigin(process.env.PUBLIC_APP_URL?.split(',')[0])
      || DEFAULT_DEV_FRONTEND_URL;
  }

  return normalizeOrigin(process.env.FRONTEND_URL?.split(',')[0])
    || normalizeOrigin(process.env.PUBLIC_APP_URL?.split(',')[0])
    || LOCAL_DEV_ORIGIN;
}

function resolveFrontendOrigin({ req, explicitOrigin } = {}) {
  const allowedOrigins = collectConfiguredOrigins();

  const explicit = normalizeOrigin(explicitOrigin);
  if (explicit && originIsAllowed(explicit, allowedOrigins)) {
    return explicit;
  }

  const headerOrigin = normalizeOrigin(req?.headers?.origin);
  if (headerOrigin && originIsAllowed(headerOrigin, allowedOrigins)) {
    return headerOrigin;
  }

  if (req?.headers?.referer) {
    try {
      const refererOrigin = new URL(req.headers.referer).origin;
      if (originIsAllowed(refererOrigin, allowedOrigins)) {
        return refererOrigin;
      }
    } catch {
      // ignore invalid referer
    }
  }

  for (const key of ['FRONTEND_URL', 'PUBLIC_APP_URL', 'CORS_ORIGIN']) {
    const configured = normalizeOrigin(process.env[key]?.split(',')[0]);
    if (configured && !isLocalhostOrigin(configured)) {
      return configured;
    }
  }

  return resolveDefaultFrontendUrl();
}

function normalizePath(path, fallback) {
  const value = (path || fallback || '').trim();
  if (!value) return fallback;
  return value.startsWith('/') ? value : `/${value}`;
}

function resolveReturnUrl({
  req,
  explicitOrigin,
  returnPath = '/tabs/profile?stripe_success=true',
  refreshPath = '/tabs/profile?stripe_refresh=true',
} = {}) {
  const origin = resolveFrontendOrigin({ req, explicitOrigin });
  return {
    origin,
    returnUrl: `${origin}${normalizePath(returnPath, '/tabs/profile?stripe_success=true')}`,
    refreshUrl: `${origin}${normalizePath(refreshPath, '/tabs/profile?stripe_refresh=true')}`,
  };
}

module.exports = {
  resolveDefaultFrontendUrl,
  resolveEmailFrontendUrl,
  resolveEmailAssetBaseUrl,
  resolveFrontendOrigin,
  resolveReturnUrl,
  normalizeOrigin,
};
