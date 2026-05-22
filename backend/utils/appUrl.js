const LOCAL_DEV_ORIGIN = 'http://localhost:8100';

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

  const configuredFrontend = normalizeOrigin(process.env.FRONTEND_URL);
  if (configuredFrontend) {
    return configuredFrontend;
  }

  if (process.env.NODE_ENV !== 'production') {
    return LOCAL_DEV_ORIGIN;
  }

  throw new Error(
    'Unable to resolve frontend URL for Stripe redirect. Set FRONTEND_URL (or pass frontendOrigin from the client).'
  );
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
  resolveFrontendOrigin,
  resolveReturnUrl,
  normalizeOrigin,
};
