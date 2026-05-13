/**
 * Authentication middleware (Stage 1).
 *
 * Replaces the unsafe legacy `verifyToken` that lived in
 * `videoUploadMiddleware.js`. The legacy version decoded Auth0 JWTs WITHOUT
 * verifying the signature, so any client could forge a token and impersonate
 * any user. This middleware:
 *
 *   1. Verifies real Auth0 tokens against the tenant's JWKS
 *      (RS256 + issuer + audience). Both ID tokens and Access tokens are
 *      supported because we accept either audience.
 *   2. Accepts the existing `dev-token-{email-with-hyphens}` shortcut ONLY
 *      when `ALLOW_DEV_TOKENS === 'true'`. By default this is enabled when
 *      `NODE_ENV !== 'production'`, and force-disabled in production.
 *   3. Preserves the existing `req.user.sub` shape (`dev-user-{email}` for
 *      Auth0 users that have an email claim) so existing User documents
 *      and `User.findOne({ auth0Id: req.user.sub })` lookups keep working.
 *      Stage 2 will migrate to the real Auth0 sub.
 *
 * The export is named `verifyToken` to match the legacy import sites — every
 * route already does `const { verifyToken } = require('../middleware/...')`
 * so re-exporting from `videoUploadMiddleware.js` keeps the call sites
 * unchanged.
 *
 * Required env vars (set in `config.env` locally, Render dashboard in prod):
 *   AUTH0_DOMAIN          e.g. dev-h6q8nxbfbq8psb4k.us.auth0.com
 *   AUTH0_AUDIENCE        e.g. https://api.barnabi.com   (the custom Auth0 API audience)
 *   AUTH0_CLIENT_ID       e.g. veJihab93y2EdvOK10ve1TvwSffMTflj  (ID token aud)
 *   ALLOW_DEV_TOKENS      'true' to allow dev-token-... in dev (optional; off in prod)
 */

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const isProd = process.env.NODE_ENV === 'production';
// Dev tokens default to allowed in non-prod environments. In production they
// are unconditionally rejected even if the env var leaked.
const allowDevTokens = !isProd && (process.env.ALLOW_DEV_TOKENS !== 'false');

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || '';
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || '';
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID || '';

// Hard fail in production if Auth0 isn't configured. We don't want to silently
// fall back to the dev-token branch in a deployed environment.
if (isProd && !AUTH0_DOMAIN) {
  throw new Error('[verifyAuth] AUTH0_DOMAIN must be set in production');
}

// Lazily initialize the JWKS client. We do it on first verification rather
// than at module load so dev environments without Auth0 vars can still boot.
let jwks = null;
function getJwks() {
  if (!AUTH0_DOMAIN) return null;
  if (!jwks) {
    jwks = jwksClient({
      jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000, // 10 min
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }
  return jwks;
}

function getSigningKey(header, callback) {
  const client = getJwks();
  if (!client) return callback(new Error('JWKS not configured'));
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

// Both ID tokens (aud = client_id) and Access tokens (aud = API audience)
// are accepted. `jsonwebtoken` lets us pass an array.
function buildAcceptedAudiences() {
  const auds = [];
  if (AUTH0_AUDIENCE) auds.push(AUTH0_AUDIENCE);
  if (AUTH0_CLIENT_ID) auds.push(AUTH0_CLIENT_ID);
  return auds.length ? auds : undefined;
}

function verifyAuth0Token(token) {
  return new Promise((resolve, reject) => {
    if (!AUTH0_DOMAIN) {
      return reject(new Error('AUTH0_DOMAIN not configured'));
    }
    jwt.verify(
      token,
      getSigningKey,
      {
        audience: buildAcceptedAudiences(),
        issuer: `https://${AUTH0_DOMAIN}/`,
        algorithms: ['RS256'],
      },
      (err, decoded) => {
        if (err) reject(err);
        else resolve(decoded);
      }
    );
  });
}

/**
 * Build the legacy-shaped `req.user` from a verified Auth0 payload.
 * We keep `sub = dev-user-{email}` for backward compat with existing User
 * documents in the DB. Stage 2 will switch to using `decodedPayload.sub`.
 */
function buildUserInfoFromAuth0Payload(payload) {
  const email = payload.email
    || payload['https://your-domain.com/email']
    || payload['http://your-domain.com/email'];
  const name = payload.name
    || payload.nickname
    || payload.given_name
    || payload['https://your-domain.com/name']
    || (email ? email.split('@')[0] : 'User');
  const picture = payload.picture
    || payload.picture_url
    || payload['https://your-domain.com/picture']
    || null;

  // Legacy normalized sub keeps `User.findOne({ auth0Id })` lookups working.
  // Stage 2 will swap to using `payload.sub` directly.
  const normalizedSub = email ? `dev-user-${email}` : payload.sub;

  return {
    sub: normalizedSub,
    auth0Sub: payload.sub,
    email,
    name,
    email_verified: payload.email_verified,
    picture,
    given_name: payload.given_name,
    family_name: payload.family_name,
  };
}

/**
 * Decode a `dev-token-...` shortcut into the same `req.user` shape the
 * legacy middleware produced. Only allowed when `allowDevTokens` is true.
 */
function buildUserInfoFromDevToken(token) {
  const emailPart = token.replace('dev-token-', '');
  const parts = emailPart.split('-');
  let email;
  if (parts.length >= 2) {
    // Last 2 parts are the domain (eg. ['gmail', 'com']), the rest is the
    // local part of the email with dots originally encoded as hyphens.
    const domainParts = parts.slice(-2);
    const usernameParts = parts.slice(0, -2);
    email = `${usernameParts.join('.')}@${domainParts.join('.')}`;
  } else {
    email = emailPart.replace(/-/g, '.');
  }
  return {
    sub: `dev-user-${email}`,
    email,
    name: email.split('@')[0],
    picture: null,
  };
}

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      return res.status(401).json({ error: 'Empty bearer token' });
    }

    // Dev token shortcut (rejected in production)
    if (token.startsWith('dev-token-')) {
      if (!allowDevTokens) {
        return res.status(401).json({ error: 'Dev tokens not accepted in this environment' });
      }
      req.user = buildUserInfoFromDevToken(token);
      return next();
    }

    // Auth0 JWT path — must be a 3-part token
    if (token.split('.').length === 3) {
      try {
        const payload = await verifyAuth0Token(token);
        req.user = buildUserInfoFromAuth0Payload(payload);
        return next();
      } catch (verifyErr) {
        console.warn('[verifyAuth] JWT verification failed:', verifyErr?.message || verifyErr);
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    }

    return res.status(401).json({ error: 'Unrecognized token format' });
  } catch (err) {
    console.error('[verifyAuth] unexpected error:', err);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = {
  verifyToken,
  // Surfaced for tests / future migration scripts.
  __internal: {
    verifyAuth0Token,
    buildUserInfoFromAuth0Payload,
    buildUserInfoFromDevToken,
    isProd,
    allowDevTokens,
  },
};
